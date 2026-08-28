import { useEffect, useState } from "react";
import { Badge, Button, Logo, Wordmark } from "@zmzai/theme";
import type { AgentInfo, SessionInfo, HarnessEvent, PermissionRequest, TranscriptMessage, AuthStatus } from "./types";
import SessionList from "./components/SessionList";
import ChatView from "./components/ChatView";

/** 把引擎持久化的转录（MessageWithParts[]）转换成 ChatView 已支持的
 *  message.updated + message.part.updated 事件流，从而跨会话恢复历史。 */
function transcriptToEvents(messages: TranscriptMessage[]): HarnessEvent[] {
  const out: HarnessEvent[] = [];
  for (const m of messages) {
    out.push({ type: "message.updated", data: { message: { id: m.info.id, role: m.info.role } } });
    for (const p of m.parts) {
      out.push({ type: "message.part.updated", data: { part: p } });
    }
  }
  return out;
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

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string>("default");
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [pending, setPending] = useState<PermissionRequest | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    void window.harness.authStatus().then(setAuth);
    // 登录窗口关闭后刷新登录态（用户可能刚完成登录）
    return window.harness.onAuthChanged(() => {
      void window.harness.authStatus().then(setAuth);
    });
  }, []);

  useEffect(() => {
    void window.harness.listAgents().then(setAgents);
    void window.harness.listSessions().then(setSessions);
  }, []);

  useEffect(() => {
    if (!activeId) {
      setEvents([]);
      setStatus("idle");
      setPending(null);
      return;
    }
    let cancelled = false;
    // 历史恢复与实时流的竞态防护：订阅先建立（不丢事件），转录异步载入期间
    // 实时事件先进 buffer；转录渲染完成后再合并——顺序仍是 历史→实时。
    let historyLoaded = false;
    const liveBuffer: HarnessEvent[] = [];
    setEvents([]);
    setStatus("idle");
    setPending(null);
    const unsub = window.harness.subscribe(activeId, (ev) => {
      if (ev.type === "session.status") setStatus((ev.data as { status: string }).status);
      else if (ev.type === "permission.asked") setPending((ev.data as { request: PermissionRequest }).request);
      else if (ev.type === "permission.replied") setPending(null);
      if (!historyLoaded) liveBuffer.push(ev);
      else setEvents((prev) => [...prev, ev]);
    });
    // 跨会话恢复：载入该会话已持久化的历史转录，渲染成消息树
    window.harness.getMessages(activeId).then((msgs) => {
      if (cancelled) return;
      setEvents(transcriptToEvents(msgs));
      historyLoaded = true;
      if (liveBuffer.length) setEvents((prev) => [...prev, ...liveBuffer]);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeId]);

  const newSession = async () => {
    const s = await window.harness.createSession(activeAgent);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const send = async (text: string) => {
    if (!activeId || !text.trim()) return;
    await window.harness.prompt(activeId, text, activeAgent);
    // prompt 可能排队返回，刷新标题等元数据
    void window.harness.listSessions().then(setSessions);
  };

  const reply = async (r: "once" | "always" | "reject", feedback?: string) => {
    if (!activeId || !pending) return;
    await window.harness.replyPermission(activeId, pending.id, r, feedback);
    setPending(null);
  };

  // 渲染进程没有 process 全局对象，模型信息从 agent 配置取
  const activeModel = agents.find((a) => a.name === activeAgent)?.model;
  const modelLabel = activeModel ? `${activeModel.providerId}/${activeModel.modelId}` : "default";

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      {/* 品牌顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg px-4">
        <Logo size={22} />
        <Wordmark sublabel="agent harness" size={15} weight={650} />
        <div className="flex-1" />
        {auth && (
          auth.loggedIn ? (
            <Badge variant="accent" size="sm">已登录 relay</Badge>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void window.harness.login()}>
              登录 relay
            </Button>
          )
        )}
        <Button variant="primary" size="sm" onClick={() => void newSession()}>
          + 新建会话
        </Button>
      </header>

      {/* 主体：侧栏 + 聊天 */}
      <div className="flex min-h-0 flex-1">
        <SessionList
          agents={agents}
          sessions={sessions}
          activeId={activeId}
          activeAgent={activeAgent}
          onSelectAgent={setActiveAgent}
          onSelectSession={setActiveId}
        />
        <ChatView
          events={events}
          status={status}
          pending={pending}
          onSend={send}
          onReply={reply}
          onAbort={() => activeId && window.harness.abort(activeId)}
        />
      </div>

      {/* 底部状态栏：低调一行 */}
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-surface px-4 text-[0.6875rem] text-ink-3">
        <span className={`h-1.5 w-1.5 rounded-full ${status === "running" ? "animate-pulse bg-accent-strong" : "bg-ink-3"}`} />
        <span>{statusLabel(status)}</span>
        <span className="text-line-strong">·</span>
        <span>agent: {activeAgent}</span>
        <span className="text-line-strong">·</span>
        <span className="font-mono">model: {modelLabel}</span>
      </footer>
    </div>
  );
}
