import type {
  AgentInfo,
  AuthStatus,
  GitDiff,
  GitStatus,
  HarnessEvent,
  KeyStatus,
  McpStatuses,
  ModelRef,
  ModelsState,
  PluginInfo,
  PermissionSettings,
  Project,
  RelayKeyInfo,
  ProjectsState,
  SessionInfo,
  SkillOption,
  TerminalChunk,
  TerminalSession,
  ThinkingEffort,
  TranscriptMessage,
  TreeNode,
  UsageInfo,
} from "./types";

/**
 * 浏览器端 API 客户端：Web 与 Electron 共用同一套页面、同一套 HTTP 接口。
 * 替代旧版 window.harness（IPC），同构后 UI 不再感知宿主差异。
 */

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

const post = (path: string, body?: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const send = (method: string, path: string, body?: unknown) =>
  fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const client = {
  authStatus: () => fetch("/api/auth/status").then((r) => j<AuthStatus>(r)),

  authLogout: () => post("/api/auth/logout").then((r) => j<{ ok: boolean }>(r)),

  login: (email: string, password: string) =>
    post("/api/auth/login", { email, password }).then((r) => j<{ error?: string }>(r)),

  listAgents: () => fetch("/api/agents").then((r) => j<AgentInfo[]>(r)),

  listSessions: () => fetch("/api/sessions").then((r) => j<SessionInfo[]>(r)),

  createSession: (agent?: string, model?: ModelRef) =>
    post("/api/sessions", { agent, model }).then((r) => j<SessionInfo>(r)),

  renameSession: (sessionId: string, title: string) =>
    send("PATCH", `/api/sessions/${sessionId}`, { title }).then((r) => j<{ ok?: boolean; error?: string }>(r)),

  deleteSession: (sessionId: string) =>
    send("DELETE", `/api/sessions/${sessionId}`).then((r) => j<{ ok?: boolean; error?: string }>(r)),

  getMessages: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/messages`).then((r) => j<TranscriptMessage[]>(r)),

  prompt: (
    sessionId: string,
    text: string,
    agent?: string,
    model?: ModelRef,
    images?: { url: string; mediaType: string }[],
    effort?: ThinkingEffort,
  ) => post(`/api/sessions/${sessionId}/prompt`, { text, agent, model, images, effort }).then((r) => j<{ ok: boolean }>(r)),

  replyPermission: (sessionId: string, requestId: string, reply: "once" | "always" | "reject", feedback?: string) =>
    post(`/api/sessions/${sessionId}/permission`, { requestId, reply, feedback }).then((r) => j<{ ok: boolean }>(r)),

  abort: (sessionId: string) =>
    post(`/api/sessions/${sessionId}/abort`).then((r) => j<{ ok: boolean }>(r)),

  // ===== Inspector =====

  fsTree: (path: string) =>
    fetch(`/api/fs/tree?path=${encodeURIComponent(path)}`).then((r) =>
      j<{ path: string; nodes: TreeNode[] }>(r),
    ),

  fsFile: (path: string) =>
    fetch(`/api/fs/file?path=${encodeURIComponent(path)}`).then((r) =>
      j<{ path: string; size: number; content: string }>(r),
    ),

  fsSave: (path: string, content: string) =>
    send("PUT", "/api/fs/file", { path, content }).then((r) => j<{ ok: boolean; size: number }>(r)),

  fsSearch: (q: string) =>
    fetch(`/api/fs/search?q=${encodeURIComponent(q)}`).then((r) =>
      j<{ query: string; results: { path: string; type: "dir" | "file" }[] }>(r),
    ),

  gitStatus: () => fetch("/api/git/status").then((r) => j<GitStatus>(r)),

  terminalList: () =>
    fetch("/api/terminal").then((r) => j<{ backendKind: "pty" | "pipe"; sessions: TerminalSession[] }>(r)),

  terminalStart: (command: string) => post("/api/terminal", { command }).then((r) => j<TerminalSession>(r)),

  terminalRead: (id: string, cursor: number) =>
    fetch(`/api/terminal/${id}/read?cursor=${cursor}`).then((r) => j<TerminalChunk>(r)),

  terminalInput: (id: string, data: string) =>
    post(`/api/terminal/${id}/input`, { data }).then((r) => j<{ ok: boolean }>(r)),

  terminalKill: (id: string) =>
    fetch(`/api/terminal/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  // ===== 工作台（多项目 / 模型 / Skill / 上下文 / 审查 / key）=====

  listProjects: () => fetch("/api/projects").then((r) => j<ProjectsState>(r)),

  addProject: (path: string) => post("/api/projects", { path }).then((r) => j<{ project: Project }>(r)),

  switchProject: (id: string) => send("PUT", "/api/projects", { id }).then((r) => j<{ project: Project }>(r)),

  listModels: () => fetch("/api/models").then((r) => j<ModelsState>(r)),

  listSkills: () => fetch("/api/skills").then((r) => j<{ skills: SkillOption[] }>(r)),

  usage: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/usage`).then((r) => j<UsageInfo>(r)),

  compact: (sessionId: string) =>
    post(`/api/sessions/${sessionId}/compact`).then((r) => j<{ ok: boolean; reason?: string }>(r)),

  gitDiff: (path?: string) =>
    fetch(`/api/git/diff${path ? `?path=${encodeURIComponent(path)}` : ""}`).then((r) => j<GitDiff>(r)),

  checkpoints: () =>
    fetch("/api/git/checkpoint").then((r) =>
      j<{ points: { hash: string; time: string; subject: string; checkpoint: boolean }[] }>(r),
    ),

  checkpointCreate: (label: string) =>
    post("/api/git/checkpoint", { label }).then((r) => j<{ ok: boolean; skipped?: boolean; reason?: string; hash?: string }>(r)),

  checkpointRestore: (hash: string) =>
    send("PUT", "/api/git/checkpoint", { hash }).then((r) => j<{ ok: boolean }>(r)),

  keyStatus: () => fetch("/api/settings/key").then((r) => j<KeyStatus>(r)),

  keySave: (key: string, ollamaUrl?: string | null) =>
    send("PUT", "/api/settings/key", { key, ollamaUrl }).then((r) => j<KeyStatus>(r)),

  keySaveOllama: (ollamaUrl: string | null) =>
    send("PUT", "/api/settings/key", { ollamaUrl }).then((r) => j<KeyStatus>(r)),

  keySaveRelay: (relayUrl: string | null) =>
    send("PUT", "/api/settings/key", { relayUrl }).then((r) => j<KeyStatus>(r)),

  keyClear: () => fetch("/api/settings/key", { method: "DELETE" }).then((r) => j<KeyStatus>(r)),

  mcpStatus: () => fetch("/api/mcp").then((r) => j<McpStatuses>(r)),

  mcpRescan: () => post("/api/mcp").then((r) => j<McpStatuses>(r)),

  pluginsList: () => fetch("/api/plugins").then((r) => j<{ plugins: PluginInfo[] }>(r)),

  pluginInstall: (sourcePath: string) =>
    post("/api/plugins", { sourcePath }).then((r) => j<{ ok: boolean; plugin?: PluginInfo; error?: string }>(r)),

  pluginUninstall: (name: string) =>
    post("/api/plugins", { action: "uninstall", name }).then((r) => j<{ ok: boolean; error?: string }>(r)),

  keyRotate: () => post("/api/settings/key").then((r) => j<KeyStatus & { rotated: boolean; keyMigrated: boolean }>(r)),

  /** 权限自动执行配置（设置 → 通用 → 权限）：读 / 部分更新（保存即生效）。 */
  permissionsGet: () =>
    fetch("/api/settings/permissions").then((r) => j<{ permissions: PermissionSettings }>(r)).then((r) => r.permissions),
  permissionsSave: (patch: PermissionSettings) =>
    send("PUT", "/api/settings/permissions", { permissions: patch })
      .then((r) => j<{ permissions: PermissionSettings }>(r))
      .then((r) => r.permissions),

  /** relay 账号联动：key 列表 / 一键签发并绑定（明文只在 relay 响应中转一次）。 */
  relayKeys: () => fetch("/api/settings/keys").then((r) => j<RelayKeyInfo>(r)),

  relayKeyIssue: () => post("/api/settings/keys").then((r) => j<KeyStatus & { prefix?: string | null; error?: string }>(r)),

  /** 订阅某会话事件流（SSE）。返回取消函数。 */
  subscribe: (sessionId: string, cb: (ev: HarnessEvent) => void) => {
    const es = new EventSource(`/api/sessions/${sessionId}/events`);
    es.onmessage = (e) => {
      try {
        cb(JSON.parse(e.data) as HarnessEvent);
      } catch {
        /* 忽略无法解析的帧 */
      }
    };
    return () => es.close();
  },
};

