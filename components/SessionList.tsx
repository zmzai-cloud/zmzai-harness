"use client";

import { useState } from "react";
import { Badge, cn } from "@zmzai/theme";
import type { AgentInfo, SessionInfo } from "@/lib/types";

function timeLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

type Props = {
  agents: AgentInfo[];
  sessions: SessionInfo[];
  activeId: string | null;
  activeAgent: string;
  onSelectAgent: (name: string) => void;
  onSelectSession: (id: string) => void;
};

export default function SessionList({ agents, sessions, activeId, activeAgent, onSelectAgent, onSelectSession }: Props) {
  const [query, setQuery] = useState("");
  // 标题/代理/模型任意字段命中即保留
  const filtered = query.trim()
    ? sessions.filter((s) =>
        `${s.title} ${s.agent} ${s.model?.modelId ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : sessions;
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      {/* Agent 选择 */}
      <div className="shrink-0 border-b border-line px-3 py-3">
        <div className="mb-2 px-1 text-[0.6875rem] font-semibold tracking-wide text-ink-3">代理</div>
        <div className="flex flex-wrap gap-1.5">
          {agents.length === 0 && <span className="px-1 text-xs text-ink-3">未发现代理</span>}
          {agents.map((a) => (
            <button
              key={a.name}
              onClick={() => onSelectAgent(a.name)}
              className={cn(
                "rounded-pill px-2.5 py-1 text-xs font-medium transition-colors",
                activeAgent === a.name
                  ? "bg-ink text-paper"
                  : "bg-surface-2 text-ink-2 hover:bg-line hover:text-ink",
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>

      {/* 会话列表 */}
      <div className="shrink-0 px-2 pt-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话…"
          className="h-7 w-full rounded-sm border border-line bg-bg px-2.5 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-ink"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <span className="text-[0.6875rem] font-semibold tracking-wide text-ink-3">会话</span>
          <Badge variant="outline" size="sm">{sessions.length}</Badge>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs leading-5 text-ink-3">
              {query ? "没有匹配的会话。" : (
                <>
                  还没有会话。
                  <br />
                  在右上角新建一个。
                </>
              )}
            </div>
          )}
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className={cn(
                "mb-0.5 block w-full rounded-sm px-3 py-2 text-left transition-colors",
                activeId === s.id ? "bg-bg shadow-sm ring-1 ring-line" : "hover:bg-surface-2",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("truncate text-[0.8125rem] font-medium", activeId === s.id ? "text-ink" : "text-ink-2")}>
                  {s.title || "未命名会话"}
                </span>
                <span className="shrink-0 font-mono text-[0.625rem] text-ink-3">{timeLabel(s.time.updated ?? s.time.created)}</span>
              </div>
              <div className="mt-0.5 truncate text-[0.6875rem] text-ink-3">
                {s.agent}
                {s.model ? ` · ${s.model.providerId}/${s.model.modelId}` : ""}
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
