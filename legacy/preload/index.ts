import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type LecternEvent = { type: string; data: unknown };

export type McpServerStatus = {
  name: string;
  state: "connected" | "error";
  transport: string;
  tools: string[];
  error?: string;
};

export type TerminalSessionStatus = "running" | "exited" | "killed";

export type TerminalSessionInfo = {
  id: string;
  name?: string;
  status: TerminalSessionStatus;
  backend: "pty" | "pipe";
  pid?: number;
  exitCode?: number | null;
  signal?: string | null;
  startedAt: string;
  bytesTotal: number;
};

export type TerminalReadResult = {
  output: string;
  cursor: number;
  totalDropped: number;
  truncatedHead: boolean;
  session: TerminalSessionInfo;
};

/** 渲染进程通过 window.harness 调主进程引擎。事件流用 onEvent 订阅。 */
const harness = {
  createSession: (agent?: string, model?: { providerId: string; modelId: string }) =>
    ipcRenderer.invoke("harness:create-session", agent, model),
  prompt: (sessionId: string, text: string, agent?: string, model?: { providerId: string; modelId: string }) =>
    ipcRenderer.invoke("harness:prompt", sessionId, text, agent, model),
  replyPermission: (sessionId: string, requestId: string, reply: "once" | "always" | "reject", feedback?: string) =>
    ipcRenderer.invoke("harness:reply-permission", sessionId, requestId, reply, feedback),
  abort: (sessionId: string) => ipcRenderer.invoke("harness:abort", sessionId),
  listAgents: () => ipcRenderer.invoke("harness:list-agents"),
  listSessions: () => ipcRenderer.invoke("harness:list-sessions"),
  getMessages: (sessionId: string) => ipcRenderer.invoke("harness:get-messages", sessionId),
  listDir: (relPath: string) => ipcRenderer.invoke("harness:list-dir", relPath),
  readFile: (relPath: string) => ipcRenderer.invoke("harness:read-file", relPath),
  loadPlugin: (root: string) => ipcRenderer.invoke("harness:load-plugin", root),
  installPlugin: (root: string) => ipcRenderer.invoke("harness:install-plugin", root),
  trustedPlugins: () => ipcRenderer.invoke("harness:trusted-plugins"),
  /** 启动/重扫已装插件的 MCP server；返回各 server 连接状态。 */
  initMcp: () => ipcRenderer.invoke("harness:mcp-init") as Promise<McpServerStatus[]>,
  mcpStatus: () => ipcRenderer.invoke("harness:mcp-status") as Promise<McpServerStatus[]>,

  // 交互式终端：增量 read 轮询模型（cursor 由 UI 持有）
  termStart: (input: { name?: string; command: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke("harness:term-start", input) as Promise<TerminalSessionInfo>,
  termRead: (id: string, sinceBytes?: number) =>
    ipcRenderer.invoke("harness:term-read", id, sinceBytes) as Promise<TerminalReadResult | null>,
  termWrite: (id: string, text: string) => ipcRenderer.invoke("harness:term-write", id, text) as Promise<boolean>,
  termResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke("harness:term-resize", id, cols, rows) as Promise<boolean>,
  termKill: (id: string) => ipcRenderer.invoke("harness:term-kill", id) as Promise<boolean>,
  termList: () => ipcRenderer.invoke("harness:term-list") as Promise<TerminalSessionInfo[]>,

  /** 直接执行已注入的本机工具（git_* 等），供 Git 面板等 UI 使用。 */
  runLocalTool: (id: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke("harness:run-local-tool", id, args) as Promise<{ title: string; output: string; metadata?: Record<string, unknown> }>,

  /** relay 登录态（zmzai 体系）：打开 muzhi 登录窗口 / 查询是否已登录 */
  login: () => ipcRenderer.invoke("harness:login") as Promise<{ opened: boolean; url: string }>,
  authStatus: () => ipcRenderer.invoke("harness:auth-status") as Promise<{ loggedIn: boolean; cookieName: string }>,
  /** 登录窗口关闭后触发（用户可能刚完成登录），回调里应重新 authStatus() */
  onAuthChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("harness:auth-changed", listener);
    return () => ipcRenderer.removeListener("harness:auth-changed", listener);
  },

  /** 订阅某会话事件流。返回取消函数。 */
  subscribe: (sessionId: string, cb: (ev: LecternEvent) => void) => {
    const listener = (_e: IpcRendererEvent, sid: string, ev: LecternEvent) => {
      if (sid === sessionId) cb(ev);
    };
    ipcRenderer.on("harness:event", listener);
    ipcRenderer.send("harness:subscribe", sessionId);
    return () => {
      ipcRenderer.removeListener("harness:event", listener);
      ipcRenderer.send("harness:unsubscribe", sessionId);
    };
  },
};

contextBridge.exposeInMainWorld("harness", harness);

export type HarnessApi = typeof harness;
