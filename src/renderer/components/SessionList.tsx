import type { AgentInfo, SessionInfo } from "../types";

type Props = {
  agents: AgentInfo[];
  sessions: SessionInfo[];
  activeId: string | null;
  activeAgent: string;
  onSelectAgent: (name: string) => void;
  onSelectSession: (id: string) => void;
  onNew: () => void;
};

export default function SessionList({ agents, sessions, activeId, activeAgent, onSelectAgent, onSelectSession, onNew }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="logo-dot" />
        zmzai Harness
      </div>
      <div className="sidebar-section">
        <div className="section-title">Agent</div>
        <select value={activeAgent} onChange={(e) => onSelectAgent(e.target.value)}>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} — {a.description ?? ""}
            </option>
          ))}
        </select>
        <div style={{ height: 8 }} />
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={onNew}>
          + 新建会话
        </button>
      </div>
      <div className="sidebar-section" style={{ flex: 1, overflowY: "auto" }}>
        <div className="section-title">会话</div>
        {sessions.length === 0 && <div className="muted">暂无会话</div>}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? "active" : ""}`}
            onClick={() => onSelectSession(s.id)}
          >
            <div className="session-title">{s.title}</div>
            <div className="session-meta">
              {s.agent} · {new Date(s.time.created).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
