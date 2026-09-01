// 与 @zmzai/agent-framework 事件契约对应的本地类型（避免 renderer 直接依赖引擎包）

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

export type LecternEvent = { type: string; data: unknown };

/** MCP server 连接状态（来自 harness:mcp-init / mcp-status）。 */
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

export type RunToolResult = {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
};

export type AuthStatus = {
  loggedIn: boolean;
  cookieName: string;
};

/** 会话已持久化的转录（来自引擎 getMessages）。info 仅用 id/role，parts 即完整片段。 */
export type TranscriptMessage = { info: { id: string; role: string }; parts: Part[] };
