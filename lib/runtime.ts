import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import {
  createAgentRuntime,
  createSqliteSessionStore,
  createMemoryEventLog,
  createOpenAiModelProvider,
  createFsWorkspaceFiles,
  createGitTools,
  createTerminalTools,
  createHostTerminalBackend,
  loadCustomAgents,
  startMcpServers,
  TerminalManager,
  type AgentFramework,
  type FailoverEndpoint,
  type FailoverEvent,
  type McpServerStatus,
  type McpPoolResult,
  type ModelProvider,
  type ModelRef,
} from "@zmzai/agent-framework";
import { currentCookieHeader } from "./request-cookie";
import { authHeaders, ollamaBase } from "./settings";
import { relayBase } from "./relay";
import { loadMcpConfig } from "./mcp-config";
import { dataDirFor, getActiveProject } from "./projects";
import { dataDir as baseDataDir, defaultWorkspaceRoot } from "./runtime-constants";

/**
 * 同构运行时（Web/App 共用的服务端）：
 * - 会话 / 转录 / 事件流：agent-framework 的 SQLite store（单文件 zmzai.db，
 *   首次启动自动导入旧 JSONL 数据）+ 内存事件总线
 * - 推理：走 relay（OpenAI 兼容）；鉴权头 = 个人 key（Bearer）优先，否则登录 cookie；
 *   providerId=ollama 的模型分流到本地 Ollama（settings.ollamaUrl）；
 *   配置 HARNESS_FALLBACK_BASE_URL 等环境变量时主端点失败自动降级备用端点
 * - 工具：本机沙箱 + git/终端 localTools + MCP server 工具（.zmzai/mcp.json 等）
 * - 自动上下文压缩（compaction）：接近上下文窗口时折叠旧消息为摘要，
 *   并暴露 runner.compactSession 供 UI「压缩当前会话」手动触发
 *
 * 多项目：项目 = 本地文件夹。runtime 按项目路径缓存（会话库 per-project 分离）；
 * active 项目切换后，cloudRuntime() 与 workspaceRoot（ESM live binding）随之切换。
 */

export { dataDir as harnessDataDir, defaultWorkspaceRoot } from "./runtime-constants";
export const dataDir = baseDataDir;

/** active 项目的工作区路径（ESM live binding：切换项目时由 switchProject 更新，
 *  所有 import 该绑定的模块读到的都是最新值）。 */
export let workspaceRoot = defaultWorkspaceRoot;

declare global {
  // eslint-disable-next-line no-var
  var __harnessRuntimes: Map<string, AgentFramework> | undefined;
  // eslint-disable-next-line no-var
  var __harnessTerminalManager: TerminalManager | undefined;
  // eslint-disable-next-line no-var
  var __harnessMcp: Map<string, McpRuntimeState> | undefined;
  // eslint-disable-next-line no-var
  var __harnessFailoverLog: FailoverEvent[] | undefined;
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

/** 路由降级端点（env 配置，可选）：HARNESS_FALLBACK_BASE_URL 必填，
 *  HARNESS_FALLBACK_API_KEY / HARNESS_FALLBACK_MODEL 选填。 */
function failoverEndpointsFromEnv(): FailoverEndpoint[] {
  const baseUrl = process.env.HARNESS_FALLBACK_BASE_URL;
  if (!baseUrl) return [];
  return [{ baseUrl, apiKey: process.env.HARNESS_FALLBACK_API_KEY, modelId: process.env.HARNESS_FALLBACK_MODEL }];
}

/** 路由降级环形日志（P0 可观测）：最近 20 次端点切换，/api/models 透出。 */
export function failoverLog(): FailoverEvent[] {
  return (globalThis.__harnessFailoverLog ??= []);
}

/** 终端会话管理器单例：既供 agent 的 terminal 工具使用，
 *  也供产物侧终端面板的 HTTP API 使用（同一实例，避免双份子进程）。 */
export function terminalManager(): TerminalManager {
  if (globalThis.__harnessTerminalManager) return globalThis.__harnessTerminalManager;
  const mgr = new TerminalManager(createHostTerminalBackend());
  process.once("exit", () => mgr.disposeAll());
  globalThis.__harnessTerminalManager = mgr;
  return mgr;
}

/** 当前项目的工作区路径（routes 统一从这里取，避免误用旧常量）。 */
export function activeWorkspaceRoot(): string {
  return getActiveProject().path;
}

/** 切换项目后同步 live binding 与 runtime 缓存指向。 */
export function switchProjectWorkspace(path: string) {
  workspaceRoot = path;
}

function contextWindowFor(): number {
  // relay 主流模型 128k（kimi 256k）；精确窗口由 /api/models 提供给 UI 展示，
  // 压缩触发窗口用保守下限即可。
  return Number(process.env.HARNESS_CONTEXT_WINDOW ?? 128_000);
}

/** 按项目路径缓存 runtime（切换项目 → 新 store/工作区；同一项目复用单例）。 */
export function runtimeFor(projectPath: string): AgentFramework {
  const cache = (globalThis.__harnessRuntimes ??= new Map());
  const cached = cache.get(projectPath);
  if (cached) return cached;

  const project = getActiveProject();
  const dir = dataDirFor(project);
  mkdirSync(dir, { recursive: true });
  mkdirSync(projectPath, { recursive: true });

  // git 工具直接跑本机真实仓库（沙箱快照是隔离副本，git 操作会丢上下文）；
  // 终端工具用宿主后端（node-pty 可用即真 PTY，否则降级管道模式）。
  // repo_map（R1）由 createAgentRuntime 能力接线自动注入，不再手工注册。
  const baseLocalTools = [
    ...createGitTools({ cwd: () => activeWorkspaceRoot() }),
    ...createTerminalTools(terminalManager(), { workspaceRoot: () => activeWorkspaceRoot() }),
  ];
  // MCP 装配采用就地重置：数组引用稳定（runner 每次 run 重读 deps.localTools），
  // MCP server 连接完成后替换内容，下一次 prompt 即带上 mcp__server__tool。
  const localTools = [...baseLocalTools];

  // MCP server 懒启动：不阻塞首个 prompt；单 server 失败不影响其它（statuses 透出）
  const mcpStates = (globalThis.__harnessMcp ??= new Map());
  const mcpState: McpRuntimeState = { statuses: [], configErrors: [], sources: [], pool: null, localTools, baseTools: baseLocalTools };
  mcpStates.set(projectPath, mcpState);
  mcpState.loading = startProjectMcp(projectPath, mcpState)
    .then(() => watchProjectMcp(projectPath, mcpState))
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

  const runtime = createAgentRuntime({
    // SQLite 存储升级（N4）：单文件 zmzai.db 替代多文件 JSONL；首次自动导入旧数据
    store: createSqliteSessionStore({ dataDir: dir }),
    eventLog: createMemoryEventLog(),
    modelProvider: provider,
    // 本机工作区：builtin 的 read/write/edit/glob/grep 直接落在工作区；
    // repo_map 能力（R1）随 fs 工作区默认开启
    workspace: { kind: "fs", root: projectPath },
    // 本机子进程沙箱：bash 工具在本机执行（程序白名单，产物回传）
    // 快照从当前项目工作区采集、新产物回写（函数形式随项目切换即时生效）
    sandbox: { kind: "subprocess", workspaceRoot: () => activeWorkspaceRoot() },
    localTools,
    capabilities: { repoMap: { workspaceRoot: () => activeWorkspaceRoot() }, subagents: 1 },
    // 自动上下文压缩（spec §8.3）：摘要模型沿用主模型，接近窗口时折叠
    runnerOptions: {
      compaction: {
        enabled: true,
        contextWindow: contextWindowFor(),
        summaryModel: provider.getModel(summaryModelRef),
      },
      // 工作区 .zmzai/agents/*.md 自定义 Agent（与 legacy 引擎一致）
      loadWorkspaceAgents: async () => {
        const { agents } = await loadCustomAgents(createFsWorkspaceFiles({ root: projectPath }));
        return agents;
      },
    },
  });
  cache.set(projectPath, runtime);
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
  // stdio 命令白名单（P0 隔离）：HARNESS_MCP_ALLOWED_COMMANDS=npx,node,... 逗号分隔；
  // 未配置 = 不限制。防恶意 mcp.json 拉起任意本地可执行文件。
  const allowedCommands = (process.env.HARNESS_MCP_ALLOWED_COMMANDS ?? "")
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
  const states = (globalThis.__harnessMcp ??= new Map());
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
