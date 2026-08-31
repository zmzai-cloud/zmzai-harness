import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown, PermissionCard, Reasoning, ToolCard, ToolGroup, cn } from "@zmzai/theme";

import type { ConnectionState } from "@/lib/client";
import type { ChatViewData, TodoItem } from "@/lib/chat-projector";
import type { ModelRef, Part, PermissionRequest } from "@/lib/types";
import Composer from "./Composer";
import DiffView, { diffStat } from "./DiffView";

type SubagentActivity = import("@/lib/chat-projector").SubagentActivity;
type UiPart = import("@/lib/chat-projector").UiPart;
type UiMessage = import("@/lib/chat-projector").UiMessage;

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

/** 内联 diff 卡片：edit/write 工具调用落盘后的变更预览（写入已即时生效）。
 *  标题行带「在文件 Tab 打开」（F3 联动）。 */
function EditDiffCard({ path, diff, onOpenFile }: { path: string; diff: string; onOpenFile?: (path: string, line?: number) => void }) {
  const [open, setOpen] = useState(false);
  const { additions, deletions } = diffStat(diff);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex w-full items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-ink">
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
        <button
          type="button"
          onClick={() => onOpenFile?.(path)}
          title="在文件 Tab 打开完整文件"
          className="shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium text-ink-2 transition-colors hover:text-ink"
        >
          打开
        </button>
      </div>
      {open && <DiffView diff={diff} className="max-h-72 border-t border-line" path={path} />}
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
            running ? "bg-live-tint text-live" : failed ? "bg-danger-tint text-danger" : "bg-surface-2 text-ink-3",
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

function PartView({ part, diff, markdown = false, onOpenFile, subagent }: { part: Part; diff?: string; markdown?: boolean; onOpenFile?: (path: string, line?: number) => void; subagent?: SubagentActivity }) {
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
        return <EditDiffCard path={path} diff={diff} onOpenFile={onOpenFile} />;
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
              className="text-[0.6875rem] text-warning transition-colors hover:underline"
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
  /** 已投影的渲染数据（page.tsx 的 ChatProjector 增量产出，rAF 批量快照）。 */
  data: ChatViewData;
  status: string;
  pending: PermissionRequest | null;
  sessionId: string | null;
  /** SSE 连接状态（断线自动重连；reconnecting/offline 时顶栏出横幅）。 */
  connState: ConnectionState;
  selectedModel: ModelRef | null;
  onSelectModel: (m: ModelRef | null) => void;
  onSend: (t: string) => void;
  onReply: (r: "once" | "always" | "reject", feedback?: string) => void;
  onAbort: () => void;
  /** 点击消息内的文件路径（可带行号）→ 产物侧文件 Tab 打开并滚动定位（P1-10/F2 联动）。 */
  onOpenFile: (path: string, line?: number) => void;
  /** 自治档位（P1-7）：确认 = 每次授权弹卡；自动 = 自动授 always。 */
  autoMode: boolean;
  onToggleAuto: () => void;
  /** 历史分页：还有更早消息 + 触顶时回调（page.tsx 分页拉取并 prepend）。 */
  hasMore: boolean;
  onLoadMore: () => void;
  /** 乐观回显：发送瞬间的用户消息（真实 message.updated 到达后自动让位）。 */
  echo: { text: string; images: { url: string; mediaType: string }[] } | null;
};

/** 任务计划卡：todo.updated 投影（Agent 拆解步骤的实时进度）。 */
function TodoCard({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  const icon = (status: TodoItem["status"]) => {
    if (status === "completed")
      return <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-[8px] font-bold text-bg">✓</span>;
    if (status === "in_progress")
      return <span className="h-3.5 w-3.5 animate-pulse rounded-full border-2 border-live" />;
    if (status === "cancelled")
      return <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-2 text-[8px] text-ink-3">—</span>;
    return <span className="h-3.5 w-3.5 rounded-full border border-ink-3" />;
  };
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[0.6875rem] font-semibold tracking-wide text-ink-3">任务计划</span>
        <span className="font-mono text-[0.625rem] text-ink-3">{done}/{todos.length}</span>
        <span className="h-1 flex-1 overflow-hidden rounded-pill bg-surface-2">
          <span
            className="block h-full rounded-pill bg-live transition-all"
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

export default function ChatView({ data, status, pending, sessionId, connState, selectedModel, onSelectModel, onSend, onReply, onAbort, onOpenFile, autoMode, onToggleAuto, hasMore, onLoadMore, echo }: Props) {
  const { messages, todos, reads } = data;
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
  // 断线时长：从进入非 connected 状态开始计时，恢复即清零（横幅展示「已断 Xs」）
  const [downSince, setDownSince] = useState<number | null>(null);
  const [downSeconds, setDownSeconds] = useState(0);
  useEffect(() => {
    if (connState === "connected") {
      setDownSince(null);
      setDownSeconds(0);
      return;
    }
    setDownSince((prev) => prev ?? Date.now());
  }, [connState]);
  useEffect(() => {
    if (downSince == null) return;
    const t = setInterval(() => setDownSeconds(Math.round((Date.now() - downSince) / 1000)), 1000);
    return () => clearInterval(t);
  }, [downSince]);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  // 用户消息「编辑重发」草稿：回填给 Composer，消费后清空
  const [draft, setDraft] = useState<string | null>(null);
  // 历史翻页的视口锚定：prepend 后恢复滚动位置；平时新消息到达滚到底部
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const handleLoadMore = () => {
    const el = messagesRef.current;
    if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    onLoadMore();
  };
  // 新消息/片段到达时自动滚到底（流式输出的基本体验）；触顶加载更早时锚定原视口
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    if (anchorRef.current) {
      const a = anchorRef.current;
      el.scrollTop = el.scrollHeight - a.height + a.top;
      anchorRef.current = null;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-xs font-semibold text-ink">对话</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[0.6875rem] font-medium ${
            running
              ? "bg-live-tint text-live"
              : status === "waiting_permission"
                ? "bg-warning-tint text-warning"
                : "bg-surface-2 text-ink-2"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${running ? "animate-pulse bg-live" : "bg-ink-3"}`} />
          {statusLabel(status)}
        </span>
        <span className="flex-1" />
        {/* SSE 连接态：正常不占视觉；断线时黄点转圈 / 红点 + 横幅 */}
        {connState !== "connected" && (
          <span
            title={connState === "offline" ? "连接已中断，点击面板可重试" : "连接中断，正在自动恢复…"}
            className={cn(
              "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[0.6875rem] font-medium",
              connState === "offline" ? "bg-danger-tint text-danger" : "bg-warning-tint text-warning",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", connState === "offline" ? "bg-danger" : "animate-pulse bg-warning")} />
            {connState === "offline" ? "已断开" : "重连中"}
          </span>
        )}
        {/* 自治档位（P1-7）：对标 Qoder 的 Quest 自动执行 */}
        <button
          type="button"
          onClick={onToggleAuto}
          title={autoMode ? "自动档：写文件/命令不再逐次确认，点击切回确认档" : "确认档：敏感操作逐次确认，点击切到自动档"}
          className={cn(
            "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[0.6875rem] font-medium transition-colors",
            autoMode ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2 hover:text-ink",
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
      {/* 断线横幅：reconnecting 提示自动恢复；offline 提示手动刷新（重连仍在后台退避重试） */}
      {connState !== "connected" && (
        <div
          className={cn(
            "flex h-7 shrink-0 items-center gap-2 border-b px-4 text-[0.6875rem]",
            connState === "offline" ? "border-danger/30 bg-danger-tint text-danger" : "border-line bg-warning-tint text-warning",
          )}
        >
          {connState === "offline"
            ? `连接已断开（${downSeconds}s）——正在后台重试，也可点击会话列表重建连接`
            : `连接中断，正在恢复…（已断 ${downSeconds}s，恢复后自动补齐缺失消息）`}
        </div>
      )}
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
        className="messages mx-auto w-full max-w-3xl min-[1440px]:max-w-4xl min-[1920px]:max-w-5xl flex-1 space-y-7 overflow-y-auto px-6 py-6"
        ref={messagesRef}
        onScroll={(e) => {
          // 触顶自动加载更早历史（hasMore 且未在加载中——防抖在 page 层）
          const el = e.currentTarget;
          if (hasMore && el.scrollTop < 80) handleLoadMore();
        }}
        onClick={(e) => {
          // F2 路径联动：点击 Markdown 正文中的 code/a 元素，若文本像工作区内路径
          // 则打开文件 Tab；支持 path:line 形式（滚动定位到行）
          const el = (e.target as HTMLElement).closest("code, a");
          const raw = el?.textContent ?? "";
          const m = raw.trim().match(/^([.\w-]+(?:\/[.\w-]+)*\.[A-Za-z0-9]{1,6})(?::(\d{1,6}))?$/);
          if (m) {
            e.preventDefault();
            onOpenFile(m[1]!, m[2] ? Number(m[2]) : undefined);
          }
        }}
      >
      {/* 「加载更早」提示：触顶自动触发，仅作状态提示 */}
      {hasMore && (
        <div className="py-2 text-center text-[0.6875rem] text-ink-3">上滑加载更早消息…</div>
      )}
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
              <div key={m.id} className="group flex justify-end [content-visibility:auto] [contain-intrinsic-size:auto_120px]">
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
          // M3：连续已完成的普通工具折叠为 ToolGroup 摘要行（防瀑布淹没正文）——
          // 任何运行中/失败/带 diff/其他类型片段都会把组切断
          const blocks: React.ReactNode[] = [];
          let group: UiPart[] = [];
          const flushGroup = (keyPrefix: string) => {
            if (!group.length) return;
            if (group.length === 1) {
              const p = group[0]!;
              blocks.push(
                <PartView key={`${keyPrefix}-tool-${p.part.id}`} part={p.part} diff={p.diff} markdown onOpenFile={onOpenFile} subagent={p.subagent} />,
              );
            } else {
              blocks.push(
                <ToolGroup
                  key={`${keyPrefix}-toolgrp-${group[0]!.part.id}`}
                  calls={group.map((p) => {
                    const t = p.part as Extract<Part, { type: "tool" }>;
                    return { id: t.callId, tool: t.tool, state: t.state };
                  })}
                  sessionIdle={false}
                />,
              );
            }
            group = [];
          };
          for (const p of m.parts) {
            const plainDone = p.part.type === "tool" && p.part.state.status === "completed" && !p.diff && !p.subagent;
            if (plainDone) {
              group.push(p);
              continue;
            }
            flushGroup(m.id);
            blocks.push(
              <PartView key={`${m.id}-part-${p.part.id}`} part={p.part} diff={p.diff} markdown onOpenFile={onOpenFile} subagent={p.subagent} />,
            );
          }
          flushGroup(m.id);
          return (
            <div key={m.id} className="space-y-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_120px]">
              {blocks}
              {m.error && (
                <div className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-xs leading-5 text-danger">
                  上游请求失败（{m.error.name}）：{m.error.message}
                </div>
              )}
              {lastActive && (
                <div className="flex items-center gap-2 pt-0.5 text-[0.6875rem] text-live">
                  <span className="streaming-caret" />
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