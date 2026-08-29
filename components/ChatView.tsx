import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown, PermissionCard, Reasoning, ToolCard, cn } from "@zmzai/theme";

import type { HarnessEvent, ModelRef, Part, PermissionRequest } from "@/lib/types";
import Composer from "./Composer";
import DiffView, { diffStat } from "./DiffView";

export type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" | "cancelled" };

type SubagentStep = { tool: string; title?: string; state?: string };
type SubagentActivity = { steps: SubagentStep[]; finished?: { state: string; durationMs?: number; toolCalls?: number } };
type UiPart = { part: Part; diff?: string; subagent?: SubagentActivity };
type UiMessage = { id: string; role: string; parts: UiPart[]; error?: { name: string; message: string } };

/** 把事件流投影成消息树：message.updated 建壳，part.updated 定稿，part.delta 增量文本。
 *  file.edited（引擎在 write/edit 落盘时发出，带现成 unified diff）按 path 挂到
 *  对应的 edit/write 工具调用上，渲染为内联 diff 卡片。
 *  同时收集 read 工具读取过的文件（去重，最新在前）→ 上下文读取 pill 列表。 */
function project(events: HarnessEvent[]): { messages: UiMessage[]; todos: TodoItem[] | null; reads: string[] } {
  const messages = new Map<string, { id: string; role: string; parts: Map<string, UiPart>; error?: { name: string; message: string } }>();
  const order: string[] = [];
  // 未消费的 file.edited：path → diff 队列（事件序在前，tool part 定稿在后）
  const pendingEdits = new Map<string, string[]>();
  // 子代理活动（R3）：childSessionId → steps/finished，subtask part 挂同一引用，
  // part 定稿前后的 step/finished 事件都能体现在最终对象上
  const subagentActivity = new Map<string, SubagentActivity>();
  let todos: TodoItem[] | null = null;
  const reads: string[] = [];
  for (const ev of events) {
    if (ev.type === "message.updated") {
      const m = (ev.data as { message: { id: string; role: string; error?: { name: string; message: string } } }).message;
      const existing = messages.get(m.id);
      if (existing) {
        // 失败收尾会补发带 error 的 message.updated——保留最新错误供 UI 展示
        if (m.error) existing.error = m.error;
      } else {
        messages.set(m.id, { id: m.id, role: m.role, parts: new Map(), ...(m.error ? { error: m.error } : {}) });
        order.push(m.id);
      }
    } else if (ev.type === "message.part.updated") {
      const p = (ev.data as { part: Part }).part;
      const m = messages.get(p.messageId);
      if (!m) continue;
      // read 类工具调用 → 上下文读取列表（去重，最新在前）
      if (p.type === "tool" && (p.tool === "read" || p.tool === "glob" || p.tool === "grep")) {
        const path = (p.state.input as { path?: string } | undefined)?.path;
        if (path) {
          const i = reads.indexOf(path);
          if (i >= 0) reads.splice(i, 1);
          reads.unshift(path);
        }
      }
      // edit/write 工具定稿时，把该 path 最早的未消费 diff 挂上
      let diff: string | undefined;
      if ((p.type === "tool" && (p.tool === "edit" || p.tool === "write"))) {
        const path = (p.state.input as { path?: string } | undefined)?.path;
        const queue = path ? pendingEdits.get(path) : undefined;
        if (queue?.length) diff = queue.shift();
      }
      m.parts.set(p.id, { part: p, diff, ...(p.type === "subtask" ? { subagent: subagentActivity.get(p.childSessionId) } : {}) });
    } else if (ev.type === "message.part.delta") {
      const d = ev.data as { messageId: string; partId: string; delta: string };
      const m = messages.get(d.messageId);
      if (!m) continue;
      const existing = m.parts.get(d.partId);
      if (existing && existing.part.type === "text") {
        m.parts.set(d.partId, { part: { ...existing.part, text: existing.part.text + d.delta } });
      } else {
        m.parts.set(d.partId, { part: { id: d.partId, type: "text", text: d.delta, messageId: d.messageId, sessionId: "" } });
      }
    } else if (ev.type === "file.edited") {
      const d = ev.data as { path: string; diff: string };
      const queue = pendingEdits.get(d.path) ?? [];
      queue.push(d.diff);
      pendingEdits.set(d.path, queue);
    } else if (ev.type === "todo.updated") {
      todos = (ev.data as { todos: TodoItem[] }).todos;
    } else if (ev.type === "subagent.started") {
      const d = ev.data as { id: string };
      subagentActivity.set(d.id, { steps: [] });
    } else if (ev.type === "subagent.step") {
      const d = ev.data as { id: string; tool: string; title?: string; state?: string };
      const activity = subagentActivity.get(d.id) ?? { steps: [] };
      activity.steps.push({ tool: d.tool, title: d.title, state: d.state });
      subagentActivity.set(d.id, activity);
    } else if (ev.type === "subagent.finished") {
      const d = ev.data as { id: string; state: string; durationMs?: number; toolCalls?: number };
      const activity = subagentActivity.get(d.id) ?? { steps: [] };
      activity.finished = { state: d.state, durationMs: d.durationMs, toolCalls: d.toolCalls };
      subagentActivity.set(d.id, activity);
    }
  }
  return {
    messages: order.map((id) => {
      const m = messages.get(id)!;
      return { id: m.id, role: m.role, parts: [...m.parts.values()], ...(m.error ? { error: m.error } : {}) };
    }),
    todos,
    reads: reads.slice(0, 8),
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "运行中";
    case "waiting_permission":
      return "等待授权";
    case "waiting_input":
      return "等待输入";
    default:
      return "空闲";
  }
}

/** 内联 diff 卡片：edit/write 工具调用落盘后的变更预览（写入已即时生效）。 */
function EditDiffCard({ path, diff }: { path: string; diff: string }) {
  const [open, setOpen] = useState(false);
  const { additions, deletions } = diffStat(diff);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-ink-3">
          <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z" strokeLinejoin="round" />
          <path d="M9 2v4h4" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ink-2" title={path}>{path}</span>
        <span className="shrink-0 font-mono text-[0.625rem]">
          <span className="text-success">+{additions}</span> <span className="text-danger">-{deletions}</span>
        </span>
        <svg
          width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
          className={cn("shrink-0 text-ink-3 transition-transform", open && "rotate-180")}
        >
          <path d="M3 6l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <DiffView diff={diff} className="max-h-72 border-t border-line" />}
    </div>
  );
}

/** 子任务可展开卡片（R3，opencode 式联动）：默认一行（agent + 描述 + 状态），
 *  展开看任务全文 + 子会话工具步骤实时流 + 结束统计。活动数据来自
 *  subagent.started/step/finished 事件投影（framework 桥接自子 runner）。 */
function SubtaskCard({ part, activity }: { part: Extract<Part, { type: "subtask" }>; activity?: SubagentActivity }) {
  const [open, setOpen] = useState(false);
  const running = !activity?.finished;
  const failed = activity?.finished?.state === "error";
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-ink-3">
          <circle cx="8" cy="8" r="2" />
          <circle cx="13.2" cy="3.5" r="1.4" />
          <circle cx="13.2" cy="12.5" r="1.4" />
          <path d="M9.7 7.1l2.3-2.4M9.7 8.9l2.3 2.4" />
        </svg>
        <span className="shrink-0 text-[0.6875rem] font-medium text-ink-2">子任务·{part.agent}</span>
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-ink-3" title={part.description}>{part.description}</span>
        <span
          className={cn(
            "shrink-0 rounded-pill px-1.5 py-0.5 text-[0.625rem]",
            running ? "bg-accent/15 text-accent-strong" : failed ? "bg-danger/15 text-danger" : "bg-surface-2 text-ink-3",
          )}
        >
          {running ? "执行中" : failed ? "失败" : "完成"}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
          className={cn("shrink-0 text-ink-3 transition-transform", open && "rotate-180")}
        >
          <path d="M3 6l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="space-y-1 border-t border-line px-3 py-2">
          <div className="whitespace-pre-wrap text-[0.6875rem] leading-5 text-ink-3">{part.prompt}</div>
          {activity?.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 font-mono text-[0.625rem] text-ink-3">
              <span className={cn("h-1 w-1 shrink-0 rounded-full", step.state === "error" ? "bg-danger" : "bg-success")} />
              <span className="shrink-0 text-ink-2">{step.tool}</span>
              {step.title && <span className="min-w-0 truncate">{step.title}</span>}
            </div>
          ))}
          {activity?.finished && (
            <div className="pt-1 text-[0.625rem] text-ink-3">
              {activity.finished.toolCalls ?? activity.steps.length} 次工具调用
              {typeof activity.finished.durationMs === "number" ? ` · ${(activity.finished.durationMs / 1000).toFixed(1)}s` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PartView({ part, diff, markdown = false, onOpenFile, subagent }: { part: Part; diff?: string; markdown?: boolean; onOpenFile?: (path: string) => void; subagent?: SubagentActivity }) {
  switch (part.type) {
    case "text":
      // assistant 正文用 Markdown（流式稳定、代码高亮）；用户消息保持纯文本
      return markdown ? (
        <div className="text-[0.875rem] leading-[1.65] text-ink">
          <Markdown text={part.text} />
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-[0.875rem] leading-[1.65] text-ink">{part.text}</div>
      );
    case "reasoning":
      return <Reasoning text={part.text} />;
    case "tool": {
      // edit/write 且拿到 file.edited 的 diff → 渲染内联 diff 卡片（替代 ToolCard）
      if (diff && (part.tool === "edit" || part.tool === "write")) {
        const path = (part.state.input as { path?: string } | undefined)?.path ?? "";
        return <EditDiffCard path={path} diff={diff} />;
      }
      // 入口截流（R2）：输出超限被截断且全文已落盘 → 提示条点击跳文件 tab 看全文
      const meta = part.state.status === "completed" ? part.state.metadata : undefined;
      if (meta?.truncated && typeof meta.outputPath === "string") {
        return (
          <div className="space-y-1">
            <ToolCard call={{ id: part.callId, tool: part.tool, state: part.state }} sessionIdle={false} />
            <button
              type="button"
              onClick={() => onOpenFile?.(meta.outputPath as string)}
              className="text-[0.6875rem] text-accent-strong transition-colors hover:underline"
            >
              输出已截流{typeof meta.omittedBytes === "number" ? `（省略 ${Math.round((meta.omittedBytes as number) / 1024)}KB）` : ""}，点击在文件页查看全文 →
            </button>
          </div>
        );
      }
      return (
        <ToolCard call={{ id: part.callId, tool: part.tool, state: part.state }} sessionIdle={false} />
      );
    }
    case "subtask": {
      return <SubtaskCard part={part} activity={subagent} />;
    }
    case "file":
      return <div className="text-xs text-ink-2">产物文件：{part.filename}</div>;
    case "image":
      // 多模态图片输入（P2-11）：用户随消息上传的图片直接内联展示
      return part.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={part.url} alt="附件图片" className="max-h-64 rounded-lg border border-line" />
      ) : (
        <div className="text-xs text-ink-2">产物图片</div>
      );
    case "compaction":
      return <div className="text-xs text-ink-2">上下文已压缩：{part.summary}</div>;
    default:
      return null;
  }
}

type Props = {
  events: HarnessEvent[];
  status: string;
  pending: PermissionRequest | null;
  sessionId: string | null;
  selectedModel: ModelRef | null;
  onSelectModel: (m: ModelRef | null) => void;
  onSend: (t: string) => void;
  onReply: (r: "once" | "always" | "reject", feedback?: string) => void;
  onAbort: () => void;
  /** 点击消息内的文件路径 → 产物侧文件 Tab 打开（P1-10 联动）。 */
  onOpenFile: (path: string) => void;
  /** 自治档位（P1-7）：确认 = 每次授权弹卡；自动 = 自动授 always。 */
  autoMode: boolean;
  onToggleAuto: () => void;
  /** 乐观回显：发送瞬间的用户消息（真实 message.updated 到达后自动让位）。 */
  echo: { text: string; images: { url: string; mediaType: string }[] } | null;
};

/** 任务计划卡：todo.updated 投影（Agent 拆解步骤的实时进度）。 */
function TodoCard({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  const icon = (status: TodoItem["status"]) => {
    if (status === "completed")
      return <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent-strong text-[8px] font-bold text-bg">✓</span>;
    if (status === "in_progress")
      return <span className="h-3.5 w-3.5 animate-pulse rounded-full border-2 border-accent-strong" />;
    if (status === "cancelled")
      return <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-2 text-[8px] text-ink-3">—</span>;
    return <span className="h-3.5 w-3.5 rounded-full border border-line-strong" />;
  };
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[0.6875rem] font-semibold tracking-wide text-ink-3">任务计划</span>
        <span className="font-mono text-[0.625rem] text-ink-3">{done}/{todos.length}</span>
        <span className="h-1 flex-1 overflow-hidden rounded-pill bg-surface-2">
          <span
            className="block h-full rounded-pill bg-accent-strong transition-all"
            style={{ width: `${todos.length ? Math.round((done / todos.length) * 100) : 0}%` }}
          />
        </span>
      </div>
      <div className="space-y-1.5">
        {todos.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            {icon(t.status)}
            <span
              className={cn(
                "text-xs leading-5",
                t.status === "completed" ? "text-ink-3 line-through" : t.status === "in_progress" ? "font-medium text-ink" : "text-ink-2",
              )}
            >
              {t.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatView({ events, status, pending, sessionId, selectedModel, onSelectModel, onSend, onReply, onAbort, onOpenFile, autoMode, onToggleAuto, echo }: Props) {
  const { messages, todos, reads } = useMemo(() => project(events), [events]);
  // 乐观回显：runLoop 首事件前有装配开销（workspace agents/记忆/历史重建），
  // 用户气泡不等 SSE，发送瞬间就显示；真实同文本 user 消息到达后不重复追加
  const visible = useMemo(() => {
    if (!echo) return messages;
    const echoed = messages.some(
      (m) => m.role === "user" && m.parts.map((p) => (p.part.type === "text" ? p.part.text : "")).join("") === echo.text,
    );
    if (echoed) return messages;
    const echoMessage: UiMessage = {
      id: "__echo__",
      role: "user",
      parts: [
        ...echo.images.map((im, i) => ({ part: { id: `__echo_img_${i}`, type: "image", url: im.url, mediaType: im.mediaType, messageId: "__echo__", sessionId: "" } as Part })),
        ...(echo.text ? [{ part: { id: "__echo_text", type: "text", text: echo.text, messageId: "__echo__", sessionId: "" } as Part }] : []),
      ],
    };
    return [...messages, echoMessage];
  }, [messages, echo]);
  const running = status === "running";
  const messagesRef = useRef<HTMLDivElement | null>(null);
  // 用户消息「编辑重发」草稿：回填给 Composer，消费后清空
  const [draft, setDraft] = useState<string | null>(null);
  // 新消息/片段到达时自动滚到底（流式输出的基本体验）
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-xs font-semibold text-ink">对话</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[0.6875rem] font-medium ${
            running
              ? "bg-accent/20 text-accent-strong"
              : status === "waiting_permission"
                ? "bg-warning/20 text-warning"
                : "bg-surface-2 text-ink-2"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${running ? "animate-pulse bg-accent-strong" : "bg-ink-3"}`} />
          {statusLabel(status)}
        </span>
        <span className="flex-1" />
        {/* 自治档位（P1-7）：对标 Qoder 的 Quest 自动执行 */}
        <button
          type="button"
          onClick={onToggleAuto}
          title={autoMode ? "自动档：写文件/命令不再逐次确认，点击切回确认档" : "确认档：敏感操作逐次确认，点击切到自动档"}
          className={cn(
            "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[0.6875rem] font-medium transition-colors",
            autoMode ? "bg-accent/20 text-accent-strong" : "bg-surface-2 text-ink-2 hover:text-ink",
          )}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            {autoMode ? (
              <path d="M2.5 8.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <>
                <rect x="3.5" y="6.5" width="9" height="7" rx="1.2" />
                <path d="M5.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5" />
              </>
            )}
          </svg>
          {autoMode ? "自动" : "确认"}
        </button>
      </div>
      {/* 上下文读取 pill（P2-13）：本轮 Agent 读过的文件，点击联动打开 */}
      {reads.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-4 py-1.5">
          <span className="text-[0.625rem] text-ink-3">读过</span>
          {reads.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => onOpenFile(path)}
              title={`${path} · 点击在文件 Tab 打开`}
              className="max-w-44 truncate rounded-pill bg-surface-2 px-2 py-0.5 font-mono text-[0.625rem] text-ink-2 transition-colors hover:bg-line hover:text-ink"
            >
              {path}
            </button>
          ))}
        </div>
      )}
      <div
        className="messages max-w-3xl flex-1 space-y-7 overflow-y-auto px-6 py-6"
        ref={messagesRef}
        onClick={(e) => {
          // P1-10 路径联动：点击 Markdown 正文中的 code/a 元素，若文本像工作区内路径则打开文件 Tab
          const el = (e.target as HTMLElement).closest("code, a");
          const raw = el?.textContent ?? "";
          const m = raw.trim().match(/^[.\w-]+(?:\/[.\w-]+)*\.[A-Za-z0-9]{1,6}$/);
          if (m) {
            e.preventDefault();
            onOpenFile(m[0]);
          }
        }}
      >
        {todos && todos.length > 0 && <TodoCard todos={todos} />}
        {visible.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M8 1.5l1.6 3.6 3.9.4-2.9 2.6.8 3.9L8 10l-3.4 2l.8-3.9L2.5 5.5l3.9-.4L8 1.5z" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="text-base font-semibold tracking-tight text-ink">今天要做点什么？</div>
            <div className="max-w-sm text-xs leading-6 text-ink-3">
              给 Agent 下达任务，它会直接在当前项目里工作；需要改动文件时你会在这里收到授权确认。
            </div>
          </div>
        )}
        {visible.map((m, idx) => {
          const isAssistant = m.role === "assistant";
          const lastActive = isAssistant && idx === visible.length - 1 && running;
          if (!isAssistant) {
            // IDE 式用户消息：右侧浅色圆角气泡（含图片附件内联展示） + hover 操作（复制/编辑回填）
            const text = m.parts
              .map((p) => (p.part.type === "text" ? p.part.text : ""))
              .join("");
            const imageParts = m.parts.filter((p) => p.part.type === "image" && p.part.url);
            return (
              <div key={m.id} className="group flex justify-end">
                <div className="relative max-w-[85%]">
                  <div className="whitespace-pre-wrap rounded-lg rounded-br-sm bg-surface-2 px-3.5 py-2.5 text-[0.875rem] leading-[1.65] text-ink">
                    {imageParts.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
                        {imageParts.map((p) =>
                          p.part.type === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={p.part.id} src={p.part.url} alt="附件图片" className="max-h-48 rounded-md border border-line" />
                          ) : null,
                        )}
                      </div>
                    )}
                    {text}
                  </div>
                  <div className="absolute -left-14 top-1 hidden items-center gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      title="复制"
                      onClick={() => void navigator.clipboard.writeText(text)}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                        <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
                        <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="编辑重发"
                      onClick={() => setDraft(text)}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                        <path d="M11.3 2.3a1.5 1.5 0 0 1 2.1 2.1L5 12.8l-3 .7.7-3 8.6-8.2z" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          }
          // Agent 消息：全宽开放排版（主流惯例：无头像无标签，运行指示放内容尾部）
          return (
            <div key={m.id} className="space-y-2.5">
              {m.parts.map((p, i) => (
                <PartView key={i} part={p.part} diff={p.diff} markdown onOpenFile={onOpenFile} subagent={p.subagent} />
              ))}
              {m.error && (
                <div className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-xs leading-5 text-danger">
                  上游请求失败（{m.error.name}）：{m.error.message}
                </div>
              )}
              {lastActive && (
                <div className="flex items-center gap-1.5 pt-0.5 text-[0.6875rem] text-accent-strong">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-strong" />
                  正在工作…
                </div>
              )}
            </div>
          );
        })}
        {pending && (
          <PermissionCard
            request={{ id: pending.id, permission: pending.permission, patterns: pending.patterns, metadata: pending.metadata }}
            onReply={(reply, feedback) => onReply(reply, feedback)}
          />
        )}
      </div>
      <Composer
        sessionId={sessionId}
        running={running}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        onSend={onSend}
        onAbort={onAbort}
        draft={draft}
        onDraftConsumed={() => setDraft(null)}
      />
    </div>
  );
}