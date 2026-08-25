import { useEffect, useState } from "react";
import type { AgentInfo, SessionInfo, HarnessEvent, PermissionRequest } from "./types";
import SessionList from "./components/SessionList";
import ChatView from "./components/ChatView";
import FileTree from "./components/FileTree";
import PluginPanel from "./components/PluginPanel";

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string>("default");
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [pending, setPending] = useState<PermissionRequest | null>(null);

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
    setEvents([]);
    setStatus("idle");
    setPending(null);
    const unsub = window.harness.subscribe(activeId, (ev) => {
      if (ev.type === "session.status") setStatus((ev.data as { status: string }).status);
      else if (ev.type === "permission.asked") setPending((ev.data as { request: PermissionRequest }).request);
      else if (ev.type === "permission.replied") setPending(null);
      setEvents((prev) => [...prev, ev]);
    });
    return unsub;
  }, [activeId]);

  const refreshSessions = () => window.harness.listSessions().then(setSessions);

  const newSession = async () => {
    const s = await window.harness.createSession(activeAgent);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const send = async (text: string) => {
    if (!activeId || !text.trim()) return;
    await window.harness.prompt(activeId, text, activeAgent);
  };

  const reply = async (r: "once" | "always" | "reject") => {
    if (!activeId || !pending) return;
    await window.harness.replyPermission(activeId, pending.id, r);
    setPending(null);
  };

  return (
    <div className="app">
      <SessionList
        agents={agents}
        sessions={sessions}
        activeId={activeId}
        activeAgent={activeAgent}
        onSelectAgent={setActiveAgent}
        onSelectSession={setActiveId}
        onNew={newSession}
      />
      <ChatView
        events={events}
        status={status}
        pending={pending}
        onSend={send}
        onReply={reply}
        onAbort={() => activeId && window.harness.abort(activeId)}
      />
      <div className="panel">
        <FileTree />
        <div style={{ height: 18 }} />
        <PluginPanel onInstalled={refreshSessions} />
      </div>
    </div>
  );
}
