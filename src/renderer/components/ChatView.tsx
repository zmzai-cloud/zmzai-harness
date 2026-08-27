import { useEffect, useMemo, useRef, useState } from "react";
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
      return <>{part.text}</>;
    case "reasoning":
      return <div className="reasoning">{part.text}</div>;
    case "tool":
      return <ToolCard part={part} />;
    case "subtask":
      return <div className="muted">子任务（{part.agent}）：{part.description}</div>;
    case "file":
      return <div className="muted">产物文件：{part.filename}</div>;
    case "image":
      return <div className="muted">产物图片</div>;
    case "compaction":
      return <div className="muted">上下文已压缩</div>;
    default:
      return null;
  }
}

function ToolCard({ part }: { part: Extract<Part, { type: "tool" }> }) {
  const st = part.state;
  return (
    <div className="tool-card">
      <div className="tool-head">
        <span>{part.tool}</span>
        <span className={`tool-state ${st.status}`}>
          {st.status}
          {(st as { title?: string }).title ? ` · ${(st as { title?: string }).title}` : ""}
        </span>
      </div>
      <div className="tool-body">
        {st.input != null && <div className="tool-input">输入: {JSON.stringify(st.input)}</div>}
        {st.status === "completed" && <div>输出: {st.output}</div>}
        {st.status === "error" && <div style={{ color: "var(--danger)" }}>错误: {st.error}</div>}
      </div>
    </div>
  );
}

function PermissionCard({ req, onReply }: { req: PermissionRequest; onReply: (r: "once" | "always" | "reject") => void }) {
  const meta = req.metadata ?? {};
  const detail =
    (meta.summary as string) ?? (meta.command as string) ?? (meta.filePath as string) ?? JSON.stringify(meta, null, 2);
  return (
    <div className="permission-card">
      <div className="permission-title">
        需要授权：{req.permission} {req.patterns.join(" ")}
      </div>
      <div className="permission-meta">{String(detail)}</div>
      <div className="permission-actions">
        <button className="btn btn-primary btn-sm" onClick={() => onReply("once")}>
          允许一次
        </button>
        <button className="btn btn-sm" onClick={() => onReply("always")}>
          总是允许
        </button>
        <button className="btn btn-danger btn-sm" onClick={() => onReply("reject")}>
          拒绝
        </button>
      </div>
    </div>
  );
}

function Composer({ onSend, onAbort, running }: { onSend: (t: string) => void; onAbort: () => void; running: boolean }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className="composer">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="给 Agent 下达任务… (⌘/Ctrl+Enter 发送)"
      />
      {running ? (
        <button className="btn btn-danger" onClick={onAbort}>
          中止
        </button>
      ) : (
        <button className="btn btn-primary" onClick={submit}>
          发送
        </button>
      )}
    </div>
  );
}

type Props = {
  events: HarnessEvent[];
  status: string;
  pending: PermissionRequest | null;
  onSend: (t: string) => void;
  onReply: (r: "once" | "always" | "reject") => void;
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
    <div className="chat">
      <div className="chat-header">
        <span>对话</span>
        <span className={`status-pill ${status}`}>{statusLabel(status)}</span>
      </div>
      <div className="messages" ref={messagesRef}>
        {messages.length === 0 && <div className="empty">新建会话并发送消息，Agent 会在这里工作。</div>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="bubble">
              {m.parts.map((p, i) => (
                <PartView key={i} part={p} />
              ))}
            </div>
          </div>
        ))}
        {pending && <PermissionCard req={pending} onReply={onReply} />}
      </div>
      <Composer onSend={onSend} onAbort={onAbort} running={running} />
    </div>
  );
}
