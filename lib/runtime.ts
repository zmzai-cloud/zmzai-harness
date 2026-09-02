import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import {
  createAgentRuntime,
  createSqliteSessionStore,
  createSqliteEventLog,
  createMemoryEventLog,
  createOpenAiModelProvider,
  createFsWorkspaceFiles,
  createGitTools,
  createTerminalTools,
  createHostTerminalBackend,
  loadCustomAgents,
  startMcpServers,
  reclaimExpiredLeases,
  listActiveSessions,
  TerminalManager,
  type AgentFramework,
  type EventLog,
  type FailoverEndpoint,
  type FailoverEvent,
  type McpServerStatus,
  type McpPoolResult,
  type ModelProvider,
  type ModelRef,
  type SqliteSessionStore,
} from "@zmzai/agent-framework";
import { currentCookieHeader } from "./request-cookie";
import { authHeaders, ollamaBase } from "./settings";
import { relayBase } from "./relay";
import { loadMcpConfig } from "./mcp-config";
import { dataDirFor, getActiveProject, listProjects, projectStore } from "./projects";
import { worktreeForSession } from "./worktree";
import { dataDir as baseDataDir, defaultWorkspaceRoot } from "./runtime-constants";

/**
 * 同构运行时（Web/App 共用的服务端）：
 * - 会话 / 转录 / 事件流：agent-framework 的 SQLite store（单文件 zmzai.db，
 *   首次启动自动导入旧 JSONL 数据）+ 内存事件总线
 * - 推理：走 relay（OpenAI 兼容）；鉴权头 = 个人 key（Bearer）优先，否则登录 cookie；
 *   providerId=ollama 的模型分流到本地 Ollama（settings.ollamaUrl）；
 *   配置 LECTERN_FALLBACK_BASE_URL 等环境变量时主端点失败自动降级备用端点
 * - 工具：本机沙箱 + git/终端 localTools + MCP server 工具（.zmzai/mcp.json 等）
 * - 自动上下文压缩（compaction）：接近上下文窗口时折叠旧消息为摘要，
 *   并暴露 runner.compactSession 供 UI「压缩当前会话」手动触发
 *
 * 多项目：项目 = 本地文件夹。runtime 按项目路径缓存（会话库 per-project 分离）；
 * active 项目切换后，cloudRuntime() 与 workspaceRoot（ESM live binding）随之切换。
 */

export { defaultWorkspaceRoot } from "./runtime-constants";
export const dataDir = baseDataDir;

/** active 项目的工作区路径（ESM live binding：切换项目时由 switchProject 更新，
 *  所有 import 该绑定的模块读到的都是最新值）。 */
export let workspaceRoot = defaultWorkspaceRoot;

declare global {
  // eslint-disable-next-line no-var
  var __lecternRuntimes: Map<string, AgentFramework> | undefined;
  // eslint-disable-next-line no-var
  var __lecternTerminalManager: TerminalManager | undefined;
  // eslint-disable-next-line no-var
  var __lecternMcp: Map<string, McpRuntimeState> | undefined;
  // eslint-disable-next-line no-var
  var __lecternFailoverLog: FailoverEvent[] | undefined;
  // eslint-disable-next-line no-var
  var __lecternLeaseTargets: Set<{ store: SqliteSessionStore; log: EventLog }> | undefined;
  // eslint-disable-next-line no-var
  var __lecternLeaseTimer: ReturnType<typeof setInterval> | undefined;
}

/** 每项目的 MCP 连接态（/api/mcp 透出；localTools/baseTools 为内部装配引用，
 *  仅供 rescan 复用，不序列化）。 */
export type McpRuntimeState = {
  statuses: McpServerStatus[];
  configErrors: string[];
  sources: string[];
  pool: McpPoolResult | null;
  /** runtime 闭包里的 localTools 数组（就地重置目标）与基础工具集。 */
  localTools?: unknown[];
  baseTools?: unknown[];
  /** 进行中的装配（懒启动 vs rescan 并发防护）。 */
  loading?: Promise<void>;
  /** mcp.json / plugins 目录监听（P1 热加载），rescan 复用不重开。 */
  watchers?: FSWatcher[];
};

/** Ollama 分流：providerId=ollama 的模型引用重定向到本地 Ollama 的 OpenAI 兼容
 *  端点（未配置 ollamaUrl 时原样透传，工具调用会明确报错）。streamFn 无需分流
 *  ——streamSimple 按 model.baseUrl 发请求。 */
function providerWithOllama(inner: ModelProvider): ModelProvider {
  return {
    getModel(ref: ModelRef) {
      const model = inner.getModel(ref);
      if (ref.providerId !== "ollama") return model;
      const base = ollamaBase();
      if (!base) return model;
      return { ...model, id: ref.modelId, name: ref.modelId, provider: "ollama", baseUrl: base } as never;
    },
    streamFor(session) {
      return inner.streamFor(session);
    },
  };
}

/** 路由降级端点（env 配置，可选）：LECTERN_FALLBACK_BASE_URL 必填（旧 HARNESS_FALLBACK_BASE_URL 兼容），
 *  LECTERN_FALLBACK_API_KEY / LECTERN_FALLBACK_MODEL 选填。 */
function failoverEndpointsFromEnv(): FailoverEndpoint[] {
  const baseUrl = process.env.LECTERN_FALLBACK_BASE_URL ?? process.env.HARNESS_FALLBACK_BASE_URL;
  if (!baseUrl) return [];
  return [
    {
      baseUrl,
      apiKey: process.env.LECTERN_FALLBACK_API_KEY ?? process.env.HARNESS_FALLBACK_API_KEY,
      modelId: process.env.LECTERN_FALLBACK_MODEL ?? process.env.HARNESS_FALLBACK_MODEL,
    },
  ];
}

/** 路由降级环形日志（P0 可观测）：最近 20 次端点切换，/api/models 透出。 */
export function failoverLog(): FailoverEvent[] {
  return (globalThis.__lecternFailoverLog ??= []);
}

/** 租约恢复注册（会话稳定性 P0-③）：每项目一个 SQLite store，全进程共用一条
 *  60s 扫描循环遍历所有已注册 store。进程崩溃/重启后，遗留过期租约的会话在
 *  ≤60s 内被收尾：pending 权限自动拒、running 工具归 error、发出"运行因服务
 *  重启中断，可在同一会话继续"事件（事件持久化在 SQLite，重启前挂着的页面
 *  SSE 重连后也能收到）。首个扫描在启动时立即执行。 */
function registerLeaseRecovery(target: { store: SqliteSessionStore; log: EventLog }): void {
  const targets = (globalThis.__lecternLeaseTargets ??= new Set());
  targets.add(target);
  if (globalThis.__lecternLeaseTimer) return;
  const scan = async () => {
    for (const t of globalThis.__lecternLeaseTargets ?? []) {
      await reclaimExpiredLeases({ store: t.store, log: t.log, finalizeStore: t.store }).catch(() => undefined);
    }
  };
  void scan().catch(() => undefined);
  const timer = setInterval(() => void scan().catch(() => undefined), 60_000);
  timer.unref?.();
  globalThis.__lecternLeaseTimer = timer;
}

/** 终端会话管理器单例：既供 agent 的 terminal 工具使用，
 *  也供产物侧终端面板的 HTTP API 使用（同一实例，避免双份子进程）。 */
export function terminalManager(): TerminalManager {
  if (globalThis.__lecternTerminalManager) return globalThis.__lecternTerminalManager;
  const mgr = new TerminalManager(createHostTerminalBackend());
  process.once("exit", () => mgr.disposeAll());
  globalThis.__lecternTerminalManager = mgr;
  return mgr;
}

/** 当前项目的工作区路径（routes 统一从这里取，避免误用旧常量）。 */
export function activeWorkspaceRoot(): string {
  return getActiveProject().path;
}

/**
 * UI/API 的会话有效根目录。隔离会话必须始终查看和修改其 worktree，
 * 不能因为页面上的当前项目切换而落回主工作区。
 */
export function workspaceRootForSession(sessionId?: string | null): string {
  const worktree = sessionId ? worktreeForSession(sessionId) : null;
  return worktree?.path ?? activeWorkspaceRoot();
}

/** 切换项目后同步 live binding 与 runtime 缓存指向。 */
export function switchProjectWorkspace(path: string) {
  workspaceRoot = path;
}

function contextWindowFor(): number {
  // relay 主流模型 128k（kimi 256k）；精确窗口由 /api/models 提供给 UI 展示，
  // 压缩触发窗口用保守下限即可。
  return Number(process.env.LECTERN_CONTEXT_WINDOW ?? process.env.HARNESS_CONTEXT_WINDOW ?? 128_000);
}

/** 按项目路径缓存 runtime（切换项目 → 新 store/工作区；同一项目复用单例）。
 *  opts.workspaceRoot：worktree 隔离覆盖（robustness-plan §9）——fs/git/终端/沙箱/
 *  repo_map/自定义 Agent 全部落到隔离副本；缓存键带根路径，与主工作区 runtime 互不干扰
 *  （store 仍按项目分库，隔离会话的转录消息与普通会话同库）。 */
export function runtimeFor(projectPath: string, opts?: { workspaceRoot?: string }): AgentFramework {
  const root = opts?.workspaceRoot ? resolve(opts.workspaceRoot) : projectPath;
  const cacheKey = opts?.workspaceRoot ? `${projectPath}::${root}` : projectPath;
  const cache = (globalThis.__lecternRuntimes ??= new Map());
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // store 分库按项目（隔离 runtime 与主 runtime 同库同转录）；找不到项目条目时回落 active
  const project = listProjects().find((p) => resolve(p.path) === resolve(projectPath)) ?? getActiveProject();
  const dir = dataDirFor(project);
  mkdirSync(dir, { recursive: true });
  mkdirSync(root, { recursive: true });

  // 隔离会话的工作区固定为 worktree；普通会话保持 active 项目跟随（live 语义不变）
  const wsRoot = () => (opts?.workspaceRoot ? root : activeWorkspaceRoot());

  // git 工具直接跑本机真实仓库（沙箱快照是隔离副本，git 操作会丢上下文）；
  // 终端工具用宿主后端（node-pty 可用即真 PTY，否则降级管道模式）。
  // repo_map（R1）由 createAgentRuntime 能力接线自动注入，不再手工注册。
  const baseLocalTools = [
    ...createGitTools({ cwd: wsRoot }),
    ...createTerminalTools(terminalManager(), { workspaceRoot: wsRoot }),
  ];
  // MCP 装配采用就地重置：数组引用稳定（runner 每次 run 重读 deps.localTools），
  // MCP server 连接完成后替换内容，下一次 prompt 即带上 mcp__server__tool。
  const localTools = [...baseLocalTools];

  // MCP server 懒启动：不阻塞首个 prompt；单 server 失败不影响其它（statuses 透出）
  const mcpStates = (globalThis.__lecternMcp ??= new Map());
  const mcpState: McpRuntimeState = { statuses: [], configErrors: [], sources: [], pool: null, localTools, baseTools: baseLocalTools };
  mcpStates.set(cacheKey, mcpState);
  mcpState.loading = startProjectMcp(root, mcpState)
    .then(() => watchProjectMcp(root, mcpState))
    .catch(() => undefined);

  const provider = providerWithOllama(
    createOpenAiModelProvider({
      // relay 端点：设置页可改（settings.json 优先，函数形式每请求求值即时生效）
      baseUrl: () => relayBase(),
      // 鉴权头：个人 key（Bearer）优先，否则透传浏览器登录 cookie
      headers: async () => authHeaders(currentCookieHeader()),
      // 路由降级（N2a）：主端点首个流事件即报错时依次切备用端点
      failoverEndpoints: failoverEndpointsFromEnv(),
      // 降级可观测（P0）：切换事件进环形日志，/api/models 透出给 UI
      onFailover: (event) => {
        const log = failoverLog();
        log.unshift({ ...event });
        if (log.length > 20) log.length = 20;
      },
    }),
  );

  const summaryModelRef: ModelRef = {
    providerId: "openai",
    modelId: process.env.OPENAI_MODEL ?? "gpt-4o",
  };

  // 会话与事件同库持久化（会话稳定性 P0-①④）：SQLite store + SQLite eventLog
  // 共用 <dataDir>/zmzai.db——事件跨进程重启留存，SSE since 续传跨重启无缝；
  // 租约接线（P0-③）：runner 起 run 盖章、结束清除，崩溃后由恢复循环收尾。
  const sessionStore = createSqliteSessionStore({ dataDir: dir });
  const eventLog = createSqliteEventLog({ dataDir: dir });
  registerLeaseRecovery({ store: sessionStore, log: eventLog });

  const runtime = createAgentRuntime({
    // SQLite 存储升级（N4）：单文件 zmzai.db 替代多文件 JSONL；首次自动导入旧数据
    store: sessionStore,
    eventLog,
    modelProvider: provider,
    // 本机工作区：builtin 的 read/write/edit/glob/grep 直接落在工作区；
    // repo_map 能力（R1）随 fs 工作区默认开启（隔离会话落 worktree）
    workspace: { kind: "fs", root },
    // 本机子进程沙箱：bash 工具在本机执行（程序白名单，产物回传）
    // 快照从当前工作区采集、新产物回写（隔离会话固定 worktree，普通会话随项目切换）
    sandbox: { kind: "subprocess", workspaceRoot: wsRoot },
    localTools,
    capabilities: { repoMap: { workspaceRoot: wsRoot }, subagents: 1 },
    // 自动上下文压缩（spec §8.3）：摘要模型沿用主模型，接近窗口时折叠
    runnerOptions: {
      // 租约接线（P0-③）：runner 起 run 盖章、结束清除；崩溃/重启后由
      // registerLeaseRecovery 的扫描循环收尾过期租约
      leaseStore: sessionStore,
      compaction: {
        enabled: true,
        contextWindow: contextWindowFor(),
        summaryModel: provider.getModel(summaryModelRef),
      },
      // 工作区 .zmzai/agents/*.md 自定义 Agent（与 legacy 引擎一致）
      loadWorkspaceAgents: async () => {
        const { agents } = await loadCustomAgents(createFsWorkspaceFiles({ root }));
        return agents;
      },
    },
  });
  cache.set(cacheKey, runtime);
  return runtime;
}

/** 连接项目的 MCP server 并把工具注入 localTools（就地重置模式）。 */
async function startProjectMcp(projectPath: string, state: McpRuntimeState): Promise<void> {
  const baseTools = state.baseTools ?? [];
  const localTools = state.localTools ?? [];
  const config = loadMcpConfig(projectPath);
  state.configErrors = config.errors;
  state.sources = config.sources;
  state.pool?.dispose(); // rescan 场景：先关停旧连接
  state.pool = null;
  if (config.entries.length === 0) {
    state.statuses = [];
    // 无 MCP 配置：恢复为纯本机工具（清理上次注入的 mcp__ 工具）
    localTools.splice(0, localTools.length, ...baseTools);
    return;
  }
  // stdio 命令白名单（P0 隔离）：LECTERN_MCP_ALLOWED_COMMANDS=npx,node,... 逗号分隔；
  // 未配置 = 不限制。防恶意 mcp.json 拉起任意本地可执行文件。
  const allowedCommands = (process.env.LECTERN_MCP_ALLOWED_COMMANDS ?? process.env.HARNESS_MCP_ALLOWED_COMMANDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pool = await startMcpServers(config.entries, {
    connectTimeoutMs: 8_000,
    ...(allowedCommands.length > 0 ? { allowedCommands } : {}),
  });
  state.pool = pool;
  state.statuses = pool.statuses;
  localTools.splice(0, localTools.length, ...baseTools, ...pool.defs);
}

/** mcp.json / plugins 热加载（P1）：监听全局与项目级配置的父目录，
 *  变更去抖 800ms 后自动 rescan（watcher 对目录级事件去抖，避免编辑器
 *  原子替换触发的多双事件）。dev server 模块重载时经 globalThis 复用。 */
function watchProjectMcp(projectPath: string, state: McpRuntimeState): void {
  if (state.watchers?.length) return;
  const configDirs = [
    resolve(dataDir),
    resolve(projectPath, ".zmzai"),
  ];
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | null = null;
  for (const dir of configDirs) {
    try {
      const watcher = watch(dir, { persistent: false }, (_event, filename) => {
        const name = filename ?? "";
        const relevant = name === "mcp.json" || name === "plugins" || name.startsWith("plugins/") || name.startsWith("plugins\\");
        if (!relevant) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          mcpRescan(projectPath).catch(() => undefined);
        }, 800);
        timer.unref();
      });
      watcher.unref();
      watchers.push(watcher);
    } catch {
      // 目录不存在等情况：静默跳过（无热加载不影响功能）
    }
  }
  state.watchers = watchers;
}

/** MCP 连接态（/api/mcp GET 数据源）。 */
export function mcpStatusFor(projectPath: string): McpRuntimeState {
  const states = (globalThis.__lecternMcp ??= new Map());
  return states.get(projectPath) ?? { statuses: [], configErrors: [], sources: [], pool: null };
}

/** 重新扫描 MCP 配置（/api/mcp POST）：关停旧连接后重建。
 *  首次调用同时建立文件监听（P1 热加载）。 */
export async function mcpRescan(projectPath: string): Promise<McpRuntimeState> {
  const state = mcpStatusFor(projectPath);
  await state.loading; // 等待进行中的懒启动，避免并发 dispose 竞争
  await startProjectMcp(projectPath, state);
  watchProjectMcp(projectPath, state);
  return state;
}

/** active 项目的 runtime（全站 routes 的默认入口）。 */
export function cloudRuntime(): AgentFramework {
  const project = getActiveProject();
  switchProjectWorkspace(project.path);
  return runtimeFor(project.path);
}

/** 会话感知的 runtime 解析：隔离副本会话 → worktree runtime（fs/git/沙箱全落副本），
 *  其余会话 → active 项目 runtime（行为与历史版本一致）。
 *  所有会话级 route（prompt/events/messages/permission/usage/compact/abort）统一走这里，
 *  保证事件总线与工作区都命中创建会话时的那个 runtime 实例。 */
export function sessionRuntime(sessionId: string): AgentFramework {
  const wt = worktreeForSession(sessionId);
  if (wt) return runtimeFor(wt.projectPath, { workspaceRoot: wt.path });
  return cloudRuntime();
}

/** 会话所在项目的 store（跨项目重命名/删除用，P1）：先查 active 项目库，
 *  再遍历其余项目库（轻量 projectStore）。找不到返回 null。 */
export async function sessionStoreFor(id: string): Promise<{ store: SqliteSessionStore; projectId: string } | null> {
  const active = getActiveProject();
  const activeStore = cloudRuntime().store as SqliteSessionStore;
  if (await activeStore.getSession(id)) return { store: activeStore, projectId: active.id };
  for (const project of listProjects()) {
    if (project.id === active.id) continue;
    try {
      const store = projectStore(project.id);
      if (await store.getSession(id)) return { store, projectId: project.id };
    } catch {
      /* 单项目库异常跳过 */
    }
  }
  return null;
}

/** 优雅收尾（会话稳定性 P2，Electron before-quit 经 HTTP 触发）：
 *  遍历全局 running 会话逐个 abort（走正常收尾链：tool parts 归 error、
 *  事件落库、lease 清除），再对所有已打开 SQLite store 做 wal_checkpoint
 *  把 WAL 刷回主库。相比直接 kill 子进程，运行中会话不会被砍在半截。
 *  返回收尾统计（abort 数 / checkpoint 数），供调用方日志与超时兜底判断。 */
export async function gracefulShutdown(): Promise<{ aborted: number; checkpointed: number }> {
  // 1) 中止所有 running 会话。listActiveSessions 是 framework 模块级
  //    globalThis 单例，跨项目/跨 worktree runtime 共享，拿全量。
  const activeIds = listActiveSessions();
  let aborted = 0;
  for (const id of activeIds) {
    try {
      await sessionRuntime(id).runner.abort(id);
      aborted += 1;
    } catch {
      /* 单个会话 abort 失败不阻塞整体退出 */
    }
  }

  // 2) checkpoint 所有已打开 store。runtime 闭包里已创建的 SqliteSessionStore
  //    都在 __lecternRuntimes 缓存里（含 worktree 隔离 runtime，与主项目同库——
  //    按 store 引用去重，避免同库重复 checkpoint）。
  const runtimes = globalThis.__lecternRuntimes;
  let checkpointed = 0;
  if (runtimes) {
    const seen = new Set<SqliteSessionStore>();
    for (const rt of runtimes.values()) {
      const store = rt.store as SqliteSessionStore;
      if (seen.has(store)) continue;
      seen.add(store);
      try {
        await store.checkpoint();
        checkpointed += 1;
      } catch {
        /* 单库 checkpoint 失败不阻塞 */
      }
    }
  }
  return { aborted, checkpointed };
}
