import { resolve } from "node:path";
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
} from "@zmzai/agent-framework";
import { currentCookieHeader } from "./request-cookie";

/**
 * 同构运行时（Web/App 共用的服务端单例）：
 * - 会话 / 转录 / 事件流：agent-framework 的 JSONL store + 内存事件总线
 * - 推理：全部走 relay（OpenAI 兼容），登录 cookie 从请求上下文动态注入
 * - 执行：本机沙箱环境——workspace 文件挂本机工作区，bash 走本机子进程
 *   沙箱，git/terminal 工具直接绑定本机仓库（与 legacy 引擎同策略）
 *
 * 单例挂在 globalThis 上，避免 Next.js dev 热重载时重复实例化导致
 * JSONL store 状态与事件订阅错乱。
 */
export const dataDir = resolve(process.env.HARNESS_DATA_DIR ?? process.cwd(), "data");

/** 本机 agent 工作区：默认 harness 项目下 .workspace/，可用 HARNESS_WORKSPACE
 *  或 ZMZAI_WORKSPACE 覆盖（兼容 legacy 引擎的约定）。 */
export const workspaceRoot = resolve(
  process.env.HARNESS_WORKSPACE ?? process.env.ZMZAI_WORKSPACE ?? resolve(process.cwd(), ".workspace"),
);

declare global {
  // eslint-disable-next-line no-var
  var __cloudRuntime: AgentFramework | undefined;
  // eslint-disable-next-line no-var
  var __harnessTerminalManager: TerminalManager | undefined;
}

/** 终端会话管理器单例：既供 agent 的 terminal 工具使用，
 *  也供 Inspector 终端面板的 HTTP API 使用（同一实例，避免双份子进程）。 */
export function terminalManager(): TerminalManager {
  if (globalThis.__harnessTerminalManager) return globalThis.__harnessTerminalManager;
  const mgr = new TerminalManager(createHostTerminalBackend());
  process.once("exit", () => mgr.disposeAll());
  globalThis.__harnessTerminalManager = mgr;
  return mgr;
}

export function cloudRuntime(): AgentFramework {
  if (globalThis.__cloudRuntime) return globalThis.__cloudRuntime;
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  // git 工具直接跑本机真实仓库（沙箱快照是隔离副本，git 操作会丢上下文）；
  // 终端工具用宿主后端（node-pty 可用即真 PTY，否则降级管道模式）。
  const localTools = [
    ...createGitTools({ cwd: () => workspaceRoot }),
    ...createTerminalTools(terminalManager(), { workspaceRoot: () => workspaceRoot }),
  ];

  const runtime = createServer({
    store: createJsonlSessionStore({ dataDir }),
    eventLog: createMemoryEventLog(),
    modelProvider: createOpenAiModelProvider({
      headers: async () => {
        const cookie = currentCookieHeader();
        const headers: Record<string, string> = {};
        if (cookie) headers.cookie = cookie;
        return headers;
      },
    }),
    // 本机工作区：builtin 的 read/write/edit/glob/grep 直接落在 workspaceRoot
    workspaceFor: () => createFsWorkspaceFiles({ root: workspaceRoot }),
    // 本机子进程沙箱：bash 工具在本机执行（程序白名单，产物回传）
    sandbox: createSubprocessSandbox(),
    localTools,
    // 工作区 .zmzai/agents/*.md 自定义 Agent（与 legacy 引擎一致）
    loadWorkspaceAgents: async () => {
      const { agents } = await loadCustomAgents(createFsWorkspaceFiles({ root: workspaceRoot }));
      return agents;
    },
  });
  globalThis.__cloudRuntime = runtime;
  return runtime;
}
