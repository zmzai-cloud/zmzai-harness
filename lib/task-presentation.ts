/**
 * 任务呈现派生模型（state-driven workbench UI spec §6）。
 *
 * `deriveTaskPresentation` 是纯函数：把活跃会话、对话投影、终端元数据、git/diff
 * 状态与可预览产物路径，折叠成一个六态 `TaskPresentationState`，并附带视觉所需的
 * label / icon kind / priority / badge model。**本文件不写 JSX、不引入 React、不
 * 读写任何外部状态**，只做有序谓词表的求值，供 TaskContextStrip / SessionList /
 * WorkbenchPanel 等视觉组件消费。
 *
 * 关键约束（spec §6 明文）：
 * - running 优先于 failed（表行 3 vs 4）；agent 持续工作时命令瞬时非零退出不得把
 *   状态条翻成 failed。
 * - failed 与 delivered 非互斥：失败但产物在 → delivered，失败仅作次级 badge
 *   （§7.6），绝不吞掉可追溯的失败。
 * - delivered 优先于 review_ready（行 5 vs 6）：产物是比「一批编辑」更强的结果。
 * - 每一条谓词都必须有单测（§13）。
 */

export type TaskPresentationState =
  | "idle"
  | "running"
  | "needs_input"
  | "review_ready"
  | "delivered"
  | "failed";

/** 会话级状态域（与 spec §6 对齐；waiting 对应「等待用户输入」的会话态）。 */
export type SessionStatus =
  | "idle"
  | "running"
  | "waiting"
  | "completed"
  | "failed";

/** 权限/澄清请求的最小形态（字段足够判断「是否有面向用户的待处理输入」）。 */
export type PresentationPermission = {
  id: string;
  permission: string;
};

/** 终端元数据（hasLiveProcess 表示存在活动 PTY 进程）。 */
export type PresentationTerminal = {
  hasLiveProcess: boolean;
  lastExitCode?: number;
};

/** 纯函数输入（spec §6 PresentationContext）。 */
export type PresentationContext = {
  sessionId: string | null;
  sessionStatus: SessionStatus;
  permissionRequest: PresentationPermission | null;
  editedPaths: string[];
  previewablePaths: string[];
  terminal: PresentationTerminal;
  /** 用户显式选定的右侧 tab（automatic/user 契约的 user 侧；此处仅记录，不影响状态派生）。 */
  explicitWorkbenchTab: "review" | "files" | "preview" | null;
  /** 用户显式选定的底部 debug tab（同上）。 */
  explicitDebugTab: "terminal" | "problems" | "output" | "debug" | null;
  /** 是否存在可审查的 git 变更（diff 非空）。 */
  hasGitChanges?: boolean;
};

/** 图标语义（icon kind）：不绑定具体 SVG，只给语义类型，视觉组件据此选图标。 */
export type IconKind =
  | "spark" // idle / 开始任务
  | "spinner" // running
  | "question" // needs_input
  | "diff" // review_ready
  | "artifact" // delivered
  | "error"; // failed

/** 次级失败 badge：delivered/review_ready 状态下仍要露出的底层失败（§7.6）。 */
export type FailureBadge = {
  /** 失败来源（会话失败 / 命令非零退出）。 */
  kind: "session_failed" | "command_failed";
  /** 简短可读提示，如「命令以非零退出」。 */
  label: string;
};

/** 派生结果。 */
export type TaskPresentation = {
  state: TaskPresentationState;
  /** 可读状态文案（中文）。 */
  label: string;
  icon: IconKind;
  /** 视觉主角优先级：数值越大越该在屏上占据主要视线（配合 §2.2 层级表）。 */
  priority: number;
  /** 次级失败 badge（仅当状态非 failed、但底层确有失败时非 null）。 */
  failureBadge: FailureBadge | null;
};

const LABELS: Record<TaskPresentationState, string> = {
  idle: "就绪",
  running: "运行中",
  needs_input: "需输入",
  review_ready: "待审查",
  delivered: "已交付",
  failed: "失败",
};

const ICONS: Record<TaskPresentationState, IconKind> = {
  idle: "spark",
  running: "spinner",
  needs_input: "question",
  review_ready: "diff",
  delivered: "artifact",
  failed: "error",
};

/** §2.2 层级表映射出的视觉主角优先级（failed 与 running 同层，delivered 最高）。 */
const PRIORITIES: Record<TaskPresentationState, number> = {
  idle: 0,
  needs_input: 3,
  running: 2,
  failed: 2,
  review_ready: 1,
  delivered: 4,
};

/**
 * 有序谓词表：逐行求值，第一行条件命中的状态即返回。无跨行状态，每行只引用
 * PresentationContext 的字段（spec §6「no cross-row state」）。
 */
type PredicateRow = {
  state: TaskPresentationState;
  match: (ctx: PresentationContext) => boolean;
};

const ROWS: PredicateRow[] = [
  // 1. 无会话，或会话无有意义任务事件 → idle
  //    （有意义事件 = 权限请求 / 编辑 / 可预览产物 / git 变更 / 活动进程之一）
  {
    state: "idle",
    match: (ctx) =>
      ctx.sessionId === null ||
      (ctx.sessionStatus === "idle" &&
        ctx.permissionRequest === null &&
        ctx.editedPaths.length === 0 &&
        ctx.previewablePaths.length === 0 &&
        ctx.hasGitChanges !== true &&
        !ctx.terminal.hasLiveProcess),
  },
  // 2. 有面向用户的权限/澄清请求 → needs_input
  { state: "needs_input", match: (ctx) => ctx.permissionRequest !== null },
  // 3. 运行中，或有活动 PTY 进程 → running（优先于 failed）
  {
    state: "running",
    match: (ctx) => ctx.sessionStatus === "running" || ctx.terminal.hasLiveProcess,
  },
  // 4. 失败且无产物无编辑可看 → failed
  {
    state: "failed",
    match: (ctx) =>
      ctx.sessionStatus === "failed" &&
      ctx.previewablePaths.length === 0 &&
      ctx.editedPaths.length === 0,
  },
  // 5. 有可预览产物 → delivered（优先于 review_ready）
  { state: "delivered", match: (ctx) => ctx.previewablePaths.length > 0 },
  // 6. 有编辑或 git 变更 → review_ready
  {
    state: "review_ready",
    match: (ctx) => ctx.editedPaths.length > 0 || ctx.hasGitChanges === true,
  },
  // 7. 兜底 → idle
  { state: "idle", match: () => true },
];

/**
 * 派生底层失败 badge（§7.6）：当最终态是 delivered/review_ready，但底层确有失败时，
 * 仍要露出失败作为次级信息，而非吞掉。
 */
function deriveFailureBadge(
  ctx: PresentationContext,
  state: TaskPresentationState,
): FailureBadge | null {
  if (state === "failed") return null; // failed 本身就是主态，无需次级 badge
  if (ctx.sessionStatus === "failed") {
    return { kind: "session_failed", label: "会话执行失败" };
  }
  if (
    ctx.terminal.lastExitCode !== undefined &&
    ctx.terminal.lastExitCode !== 0
  ) {
    return { kind: "command_failed", label: "命令以非零退出" };
  }
  return null;
}

/**
 * 纯函数：把 PresentationContext 折叠为 TaskPresentation。
 * 无副作用、无 IO，同一输入恒得同一输出。
 */
export function deriveTaskPresentation(
  ctx: PresentationContext,
): TaskPresentation {
  for (const row of ROWS) {
    if (row.match(ctx)) {
      const state = row.state;
      return {
        state,
        label: LABELS[state],
        icon: ICONS[state],
        priority: PRIORITIES[state],
        failureBadge: deriveFailureBadge(ctx, state),
      };
    }
  }
  // 兜底（ROWS 末行恒真，理论不可达，防御性保留）
  return {
    state: "idle",
    label: LABELS.idle,
    icon: ICONS.idle,
    priority: PRIORITIES.idle,
    failureBadge: null,
  };
}
