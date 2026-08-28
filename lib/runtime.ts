import { mkdirSync } from "node:fs";
import {
  createServer,
  createJsonlSessionStore,
  createMemoryEventLog,
  createOpenAiModelProvider,
  createFsWorkspaceFiles,
  createSubprocessSandbox,
  createGitTools,
  createTerminalTools,
  createHostTerminalBackend,
  loadCustomAgents,
  TerminalManager,
  type AgentFramework,
  type ModelRef,
} from "@zmzai/agent-framework";
import { currentCookieHeader } from "./request-cookie";
import { authHeaders } from "./settings";
import { dataDirFor, getActiveProject } from "./projects";
import { dataDir as baseDataDir, defaultWorkspaceRoot } from "./runtime-constants";

/**
 * 同构运行时（Web/App 共用的服务端）：
 * - 会话 / 转录 / 事件流：agent-framework 的 JSONL store + 内存事件总线
 * - 推理：走 relay（OpenAI 兼容）；鉴权头 = 个人 key（Bearer）优先，否则登录 cookie
 * - 执行：本机沙箱环境——workspace 文件挂本机工作区，bash 走本机子进程沙箱
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
  const localTools = [
    ...createGitTools({ cwd: () => activeWorkspaceRoot() }),
    ...createTerminalTools(terminalManager(), { workspaceRoot: () => activeWorkspaceRoot() }),
  ];

  const provider = createOpenAiModelProvider({
    // 鉴权头：个人 key（Bearer）优先，否则透传浏览器登录 cookie
    headers: async () => authHeaders(currentCookieHeader()),
  });

  const summaryModelRef: ModelRef = {
    providerId: "openai",
    modelId: process.env.OPENAI_MODEL ?? "gpt-4o",
  };

  const runtime = createServer({
    store: createJsonlSessionStore({ dataDir: dir }),
    eventLog: createMemoryEventLog(),
    modelProvider: provider,
    // 本机工作区：builtin 的 read/write/edit/glob/grep 直接落在工作区
    workspaceFor: () => createFsWorkspaceFiles({ root: projectPath }),
    // 本机子进程沙箱：bash 工具在本机执行（程序白名单，产物回传）
    sandbox: createSubprocessSandbox(),
    localTools,
    // 自动上下文压缩（spec §8.3）：摘要模型沿用主模型，接近窗口时折叠
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
  });
  cache.set(projectPath, runtime);
  return runtime;
}

/** active 项目的 runtime（全站 routes 的默认入口）。 */
export function cloudRuntime(): AgentFramework {
  const project = getActiveProject();
  switchProjectWorkspace(project.path);
  return runtimeFor(project.path);
}
