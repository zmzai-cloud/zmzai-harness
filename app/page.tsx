"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Navbar, navItemClass } from "@zmzai/theme";

import ProjectSwitcher from "@/components/ProjectSwitcher";
import SessionList from "@/components/SessionList";
import ChatView from "@/components/ChatView";
import WorkbenchPanel from "@/components/WorkbenchPanel";
import SettingsDialog from "@/components/SettingsDialog";
import ThemeToggle from "@/components/ThemeToggle";
import { client } from "@/lib/client";
import type { AgentInfo, SessionInfo, HarnessEvent, PermissionRequest, TranscriptMessage, AuthStatus, ModelRef } from "@/lib/types";

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
  const router = useRouter();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string>("default");
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [pending, setPending] = useState<PermissionRequest | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void client.authStatus().then(setAuth);
  }, []);

  useEffect(() => {
    void client.listAgents().then((list) => {
      setAgents(list);
      // 云端模式 agent 名来自 relay 模型目录（如 deepseek-chat），
      // 默认选中第一个；若当前选中已失效则自动切回
      if (list.length > 0) {
        setActiveAgent((prev) => (list.some((a) => a.name === prev) ? prev : list[0].name));
      }
    });
    void client.listSessions().then(setSessions);
  }, [auth?.loggedIn]);

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
    const unsub = client.subscribe(activeId, (ev) => {
      if (ev.type === "session.status") setStatus((ev.data as { status: string }).status);
      else if (ev.type === "permission.asked") setPending((ev.data as { request: PermissionRequest }).request);
      else if (ev.type === "permission.replied") setPending(null);
      if (!historyLoaded) liveBuffer.push(ev);
      else setEvents((prev) => [...prev, ev]);
    });
    // 跨会话恢复：载入该会话已持久化的历史转录，渲染成消息树
    client.getMessages(activeId).then((msgs) => {
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

  const newSession = useCallback(async () => {
    if (!auth?.loggedIn) return;
    const s = await client.createSession(activeAgent);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  }, [activeAgent, auth?.loggedIn]);

  const send = useCallback(
    async (text: string) => {
      if (!activeId || !text.trim()) return;
      // per-prompt 模型覆盖：composer 选了模型则随本条消息下发，否则跟随代理默认
      await client.prompt(activeId, text, activeAgent, selectedModel ?? undefined);
      // prompt 可能排队返回，刷新标题等元数据
      void client.listSessions().then(setSessions);
    },
    [activeId, activeAgent, selectedModel],
  );

  const reply = useCallback(
    async (r: "once" | "always" | "reject", feedback?: string) => {
      if (!activeId || !pending) return;
      await client.replyPermission(activeId, pending.id, r, feedback);
      setPending(null);
    },
    [activeId, pending],
  );

  const abort = useCallback(() => {
    if (activeId) void client.abort(activeId);
  }, [activeId]);

  // 未选模型时展示代理默认模型（与 per-prompt 覆盖互不干扰）
  const agentModel = agents.find((a) => a.name === activeAgent)?.model;
  const modelLabel = selectedModel
    ? `${selectedModel.providerId}/${selectedModel.modelId}`
    : agentModel
      ? `${agentModel.providerId}/${agentModel.modelId}`
      : "default";

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      {/* 品牌顶栏：全域统一 Navbar + 主题/设置/登录/新建会话 */}
      <Navbar
        sublabel="harness"
        className="h-12"
        actions={
          <>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="设置（个人 key）"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="8" cy="8" r="2.2" />
                <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" strokeLinecap="round" />
              </svg>
            </button>
            {auth &&
              (auth.loggedIn ? (
                <Badge variant="accent" size="sm">已登录 relay</Badge>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => router.push("/login")}>
                  登录 relay
                </Button>
              ))}
            <Button variant="primary" size="sm" disabled={!auth?.loggedIn} onClick={() => void newSession()}>
              + 新建会话
            </Button>
          </>
        }
      >
        <span className={navItemClass(false)}>工作台</span>
      </Navbar>

      {/* 主体：项目/会话侧栏 + 对话 + 产物侧工作台（审查/文件/画布/终端） */}
      <div className="flex min-h-0 flex-1">
        <SessionList
          top={<ProjectSwitcher />}
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
          sessionId={activeId}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          onSend={send}
          onReply={reply}
          onAbort={abort}
        />
        <div className="hidden w-96 shrink-0 min-[1180px]:block">
          <WorkbenchPanel />
        </div>
      </div>

      {/* 底部状态栏：低调一行 */}
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-surface px-4 text-[0.6875rem] text-ink-3">
        <span className={`h-1.5 w-1.5 rounded-full ${status === "running" ? "animate-pulse bg-accent-strong" : "bg-ink-3"}`} />
        <span>{statusLabel(status)}</span>
        <span className="text-line-strong">·</span>
        <span>agent: {activeAgent}</span>
        <span className="text-line-strong">·</span>
        <span className="font-mono">
          model: {modelLabel}
          {selectedModel ? "（本会话消息覆盖）" : ""}
        </span>
      </footer>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
