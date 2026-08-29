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
  /** 运行态（GET /api/sessions 附带，来自 runner activeRuns）。 */
  running?: boolean;
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
  /** 已登录时的用户 profile（name/email，账户块展示用）。 */
  user?: { name: string; email: string } | null;
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

// ===== 工作台（多项目 / 模型选择 / Skill / 上下文 / 个人 key）=====

export type Project = { id: string; name: string; path: string; createdAt: string };

export type ProjectsState = { projects: Project[]; active: Project };

/** relay /models 响应（透传归一，composer 选择器数据源）。 */
export type FeaturedModel = {
  id: string;
  name: string;
  description?: string;
  channel: string;
  maxInputTokens: number;
};

export type ModelChannel = {
  id: string;
  name: string;
  models: { id: string; name: string; maxInputTokens: number }[];
};

export type ModelsState = {
  /** relay /v1/models 已按调用者身份过滤（个人 key → allowedModels 子集；登录会话 → 全部）；availableChannels 为当前健康渠道数（0 表示提交即失败）。 */
  models: { model: string; maxInputTokens: number; availableChannels?: number }[];
  modelSelectorData: { featured: FeaturedModel[]; channels: ModelChannel[] } | null;
  authenticated: boolean;
  /** 本地 Ollama（在线时非 null）：模型以 providerId=ollama 的 ModelRef 使用。 */
  ollama: { baseUrl: string; models: { id: string; name: string }[] } | null;
  /** 路由降级环形日志（P0 可观测，最近在前）。 */
  failover: { from?: string; to: string; error: string; attempt: number }[];
};

export type SkillOption = { id: string; name: string; description?: string; markdown: string };

/** 会话上下文用量：取最近一次 step-finish 的 input+output+cacheRead ≈ 窗口占用。 */
export type UsageInfo = {
  used: number;
  contextWindow: number;
  input: number;
  output: number;
  cacheRead: number;
  steps: number;
};

export type DiffFile = { path: string; additions: number; deletions: number; binary?: boolean };

export type GitDiff = { available: boolean; files: DiffFile[]; diff: string; truncated?: boolean };

/** 个人 key 状态（仅掩码回显）。 */
export type KeyStatus = { configured: boolean; masked: string | null; relayUrl?: string; ollamaUrl?: string | null };

/** relay 账号下的 API key（控制面列表，prefix 掩码；明文只在签发时一次性返回）。 */
export type RelayKeyInfo = {
  loggedIn: boolean;
  keys: { id: string; name: string; prefix: string; status: "active" | "revoked"; quotaUsedTokens: number; monthlySpendUsedMicros: number; monthlySpendLimitMicros: number; lastUsedAt: string | null }[];
  /** harness 当前绑定 key 的 prefix（前 12 位，与列表匹配「使用中」）。 */
  currentPrefix: string | null;
  error?: string;
};

/** 推理力度档位（N3）：与 relay reasoning_effort 对齐；off = 不发字段。 */
export type ThinkingEffort = "off" | "minimal" | "low" | "medium" | "high";

/** MCP server 连接态（设置弹窗透出）。 */
export type McpStatuses = {
  statuses: { name: string; state: "connected" | "error"; transport: string; tools: string[]; error?: string }[];
  configErrors: string[];
  sources: string[];
};

/** 已安装插件（P1：plugin.json 目录，可携带 mcp.json / skills）。 */
export type PluginInfo = {
  name: string;
  version?: string;
  description?: string;
  scope: "project" | "global";
  root: string;
  hasMcp: boolean;
};

/** Electron 宿主桥（preload.cjs 注入 window.harnessNative；Web 端不存在，需能力探测降级）。 */
export type HarnessNativeBridge = {
  pickFolder?: () => Promise<string | null>;
};

declare global {
  interface Window {
    harnessNative?: HarnessNativeBridge;
  }
}
