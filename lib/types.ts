// 与 @zmzai/agent-framework 事件契约对应的本地类型（UI 层不直接依赖引擎包）

export type ModelRef = { providerId: string; modelId: string };

export type AgentInfo = {
  name: string;
  description?: string;
  mode: "primary" | "subagent" | "all";
  model?: ModelRef;
  steps?: number;
  permission: unknown[];
};

export type SessionInfo = {
  id: string;
  title: string;
  agent: string;
  model: ModelRef;
  time: { created: string; updated?: string };
};

export type ToolState =
  | { status: "pending"; input: unknown }
  | { status: "running"; input: unknown; title?: string; time: { start: string } }
  | { status: "completed"; input: unknown; output: string; title: string; time: { start: string; end: string } }
  | { status: "error"; input: unknown; error: string; time: { start: string; end: string } };

export type Part =
  | { id: string; type: "text"; text: string; messageId: string; sessionId: string }
  | { id: string; type: "reasoning"; text: string; messageId: string; sessionId: string }
  | { id: string; type: "tool"; callId: string; tool: string; state: ToolState; messageId: string; sessionId: string }
  | { id: string; type: "subtask"; prompt: string; description: string; agent: string; childSessionId: string; messageId: string; sessionId: string }
  | { id: string; type: "file"; mime: string; filename: string; url: string; messageId: string; sessionId: string }
  | { id: string; type: "image"; url: string; mediaType: string; messageId: string; sessionId: string }
  | { id: string; type: "compaction"; summary: string; messageId: string; sessionId: string };

export type PermissionRequest = {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata?: { summary?: string; filePath?: string; command?: string; [k: string]: unknown };
  always: string[];
  tool?: { messageId: string; callId: string };
};

export type HarnessEvent = { type: string; data: unknown };

/** 会话已持久化的转录（来自引擎 getMessages）。info 仅用 id/role，parts 即完整片段。 */
export type TranscriptMessage = { info: { id: string; role: string }; parts: Part[] };

export type AuthStatus = {
  loggedIn: boolean;
  cookieName: string;
};

// ===== Inspector（文件树 / Git / 终端）=====

export type TreeNode = {
  name: string;
  type: "dir" | "file";
  size?: number;
  mtime: string;
};

export type GitChange = { x: string; y: string; path: string; origPath?: string };

export type GitStatus = {
  branch: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  error?: string;
};

export type TerminalSession = {
  id: string;
  name?: string;
  status: string;
  backend: "pty" | "pipe";
  exitCode?: number | null;
  startedAt: string;
};

export type TerminalChunk = {
  output: string;
  cursor: number;
  session: TerminalSession;
};
