import { useEffect, useMemo, useRef, useState } from "react";
import { Button, MessageItem, PermissionCard, Reasoning, Textarea, ToolCard } from "@zmzai/theme";
import type { HarnessEvent, Part, PermissionRequest } from "../types";

type UiMessage = { id: string; role: string; parts: Part[] };

/** 把事件流投影成消息树：message.updated 建壳，part.updated 定稿，part.delta 增量文本 */
function project(events: HarnessEvent[]): UiMessage[] {
  const messages = new Map<string, { id: string; role: string; parts: Map<string, Part> }>();
  const order: string[] = [];
  for (const ev of events) {
    if (ev.type === "message.updated") {
      const m = (ev.data as { message: { id: string; role: string } }).message;
      if (!messages.has(m.id)) {
        messages.set(m.id, { id: m.id, role: m.role, parts: new Map() });
        order.push(m.id);
      }
    } else if (ev.type === "message.part.updated") {
      const p = (ev.data as { part: Part }).part;
      const m = messages.get(p.messageId);
      if (!m) continue;
      m.parts.set(p.id, p);
    } else if (ev.type === "message.part.delta") {
      const d = ev.data as { messageId: string; partId: string; delta: string };
      const m = messages.get(d.messageId);
      if (!m) continue;
      const existing = m.parts.get(d.partId);
      if (existing && existing.type === "text") {
        m.parts.set(d.partId, { ...existing, text: existing.text + d.delta });
      } else {
        m.parts.set(d.partId, { id: d.partId, type: "text", text: d.delta, messageId: d.messageId, sessionId: "" });
      }
    }
  }
  return order.map((id) => {
    const m = messages.get(id)!;
    return { id: m.id, role: m.role, parts: [...m.parts.values()] };
  });
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

function PartView({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return (
        <div className="whitespace-pre-wrap text-[0.875rem] leading-[1.65] text-ink">{part.text}</div>
      );
    case "reasoning":
      return <Reasoning text={part.text} />;
    case "tool":
      return (
        <ToolCard call={{ id: part.callId, tool: part.tool, state: part.state }} sessionIdle={false} />
      );
    case "subtask":
      return <div className="text-xs text-ink-2">子任务（{part.agent}）：{part.description}</div>;
    case "file":
      return <div className="text-xs text-ink-2">产物文件：{part.filename}</div>;
    case "image":
      return <div className="text-xs text-ink-2">产物图片</div>;
    case "compaction":
      return <div className="text-xs text-ink-2">上下文已压缩：{part.summary}</div>;
    default:
      return null;
  }
}

function Composer({ onSend, onAbort, running }: { onSend: (t: string) => void; onAbort: () => void; running: boolean }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className="flex items-end gap-2 border-t border-line bg-bg p-3">
      <Textarea
        className="h-11 flex-1 resize-none rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="给 Agent 下达任务…（⌘/Ctrl+Enter 发送）"
      />
      {running ? (
        <Button variant="danger" size="md" onClick={onAbort}>
          中止
        </Button>
      ) : (
        <Button variant="primary" size="md" onClick={submit}>
          发送
        </Button>
      )}
    </div>
  );
}

type Props = {
  events: HarnessEvent[];
  status: string;
  pending: PermissionRequest | null;
  onSend: (t: string) => void;
  onReply: (r: "once" | "always" | "reject", feedback?: string) => void;
  onAbort: () => void;
};

export default function ChatView({ events, status, pending, onSend, onReply, onAbort }: Props) {
  const messages = useMemo(() => project(events), [events]);
  const running = status === "running";
  const messagesRef = useRef<HTMLDivElement | null>(null);
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
      </div>
      <div className="messages flex-1 space-y-5 overflow-y-auto px-6 py-5" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-sm font-semibold text-ink-2">还没有消息</div>
            <div className="max-w-sm text-xs leading-6 text-ink-3">
              新建会话并发送任务，Agent 会在左侧会话中工作，需要授权时会在这里向你确认。
            </div>
          </div>
        )}
        {messages.map((m, idx) => {
          const isAssistant = m.role === "assistant";
          const lastActive = isAssistant && idx === messages.length - 1 && running;
          return (
            <MessageItem
              key={m.id}
              role={m.role as "user" | "assistant"}
              avatar={isAssistant ? "智" : "我"}
              name={isAssistant ? "Agent" : "我"}
              status={lastActive ? { active: true } : undefined}
            >
              {m.parts.map((p, i) => (
                <PartView key={i} part={p} />
              ))}
            </MessageItem>
          );
        })}
        {pending && (
          <PermissionCard
            request={{ id: pending.id, permission: pending.permission, patterns: pending.patterns, metadata: pending.metadata }}
            onReply={(reply, feedback) => onReply(reply, feedback)}
          />
        )}
      </div>
      <Composer onSend={onSend} onAbort={onAbort} running={running} />
    </div>
  );
}
