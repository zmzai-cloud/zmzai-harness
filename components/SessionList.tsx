"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@zmzai/theme";
import type { SessionListItem } from "@/lib/types";

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
  sessions: SessionListItem[];
  activeId: string | null;
  /** 顶部插槽（项目切换器）。 */
  top?: ReactNode;
  /** 底部插槽（账户块）。 */
  bottom?: ReactNode;
  /** 主行动：新建会话（Qoder 式「+ 创建」按钮，不传则不渲染）。 */
  onNewSession?: () => void;
  /** 新建会话是否可用（未登录 relay 时禁用）。 */
  canCreate?: boolean;
  /** 新会话默认使用隔离副本（git worktree，robustness-plan §9），持久化开关。 */
  isolateNew?: boolean;
  onToggleIsolateNew?: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  width?: number;
};

export default function SessionList({ sessions, activeId, top, bottom, onNewSession, canCreate, isolateNew, onToggleIsolateNew, onSelectSession, onRenameSession, onDeleteSession, width }: Props) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  // 标题/代理/模型/项目名任意字段命中即保留
  const filtered = query.trim()
    ? sessions.filter((s) =>
        `${s.title} ${s.agent} ${s.model?.modelId ?? ""} ${s.projectName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : sessions;
  return (
    <aside className="flex shrink-0 flex-col border-r border-line bg-surface" style={width ? { width } : undefined}>
      {/* 项目切换器（关联本地文件夹） */}
      {top}

      {/* 主行动按钮（Qoder 式）：+ 新建会话 / ⌘N */}
      {onNewSession && (
        <div className="shrink-0 px-3 pb-1 pt-3">
          <button
            type="button"
            disabled={!canCreate}
            onClick={onNewSession}
            title={canCreate ? "新建会话（⌘N）" : "登录 relay 后可新建会话"}
            className="flex h-9 w-full items-center gap-2 rounded-sm border border-line bg-bg px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
              <path d="M8 2.5v11M2.5 8h11" strokeLinecap="round" />
            </svg>
            <span>新建会话</span>
            <span className="ml-auto font-mono text-[0.625rem] text-ink-3">⌘N</span>
          </button>
          {onToggleIsolateNew && (
            <button
              type="button"
              onClick={onToggleIsolateNew}
              title={
                isolateNew
                  ? "新会话将使用隔离副本（git worktree）：改动只进副本，合并前主工作区零污染"
                  : "开启后新会话使用隔离副本（git worktree）：改动只进副本，合并前主工作区零污染"
              }
              className={cn(
                "mt-1.5 flex h-7 w-full items-center gap-1.5 rounded-sm px-2 text-[0.6875rem] transition-colors",
                isolateNew ? "bg-accent text-accent-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="shrink-0">
                <circle cx="4.5" cy="3.5" r="1.7" />
                <circle cx="4.5" cy="12.5" r="1.7" />
                <circle cx="11.5" cy="6.5" r="1.7" />
                <path d="M4.5 5.2v5.6M11.5 8.2c0 2-2 2.6-5.2 2.8" strokeLinecap="round" />
              </svg>
              <span>新会话隔离副本</span>
              <span className="ml-auto font-mono text-[0.625rem]">{isolateNew ? "ON" : "OFF"}</span>
            </button>
          )}
        </div>
      )}

      {/* 会话列表：节头（标题 + 搜索切换） + 列表 */}
      <div className="flex min-h-0 flex-1 flex-col pt-3">
        <div className="flex shrink-0 items-center justify-between gap-2 pl-4 pr-2.5 pb-1">
          <span className="text-[0.6875rem] font-semibold tracking-wide text-ink-3">会话</span>
          <div className="flex items-center gap-1">
            {searchOpen && (
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
                placeholder="搜索会话…"
                className="h-6 w-32 rounded-sm bg-surface-2 px-2 text-xs text-ink outline-none placeholder:text-ink-3"
              />
            )}
            <button
              type="button"
              title="搜索会话"
              onClick={() => {
                setSearchOpen((v) => !v);
                if (searchOpen) setQuery("");
              }}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-sm transition-colors hover:bg-surface-2 hover:text-ink",
                searchOpen ? "text-ink" : "text-ink-3",
              )}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {query.trim() && filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-ink-3">没有匹配的会话。</div>
          )}
          {filtered.map((s) => {
            const renaming = editingId === s.id;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => !renaming && onSelectSession(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !renaming) onSelectSession(s.id);
                }}
                className={cn(
                  "group relative mb-0.5 block w-full cursor-pointer rounded-sm px-3 py-2 text-left transition-colors",
                  activeId === s.id ? "bg-selected shadow-sm ring-1 ring-line-strong" : "hover:bg-surface-2",
                )}
              >
                {renaming ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editingTitle.trim()) {
                        onRenameSession(s.id, editingTitle.trim());
                        setEditingId(null);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => setEditingId(null)}
                    className="h-6 w-full rounded-sm border border-line bg-bg px-1.5 text-[0.8125rem] text-ink outline-none focus:border-ink"
                  />
                ) : (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-[0.8125rem] font-medium", activeId === s.id ? "text-ink" : "text-ink-2")}>
                      {s.title || "未命名会话"}
                    </span>
                    <span className="shrink-0 font-mono text-[0.625rem] text-ink-3 group-hover:invisible">
                      {timeLabel(s.time.updated ?? s.time.created)}
                    </span>
                  </div>
                )}
                <div className="mt-0.5 flex items-center gap-1.5 truncate text-[0.6875rem] text-ink-3">
                  {/* P2-15 多会话并行状态点 */}
                  <span
                    title={s.running ? "运行中" : "空闲"}
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      s.running ? "animate-pulse bg-live" : "bg-ink-3",
                    )}
                  />
                  <span className="truncate">
                    {s.agent}
                    {s.model ? ` · ${s.model.providerId}/${s.model.modelId}` : ""}
                  </span>
                </div>
                {/* hover 操作：重命名 / 删除 */}
                {!renaming && (
                  <div className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(s.id);
                        setEditingTitle(s.title || "");
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded-sm bg-surface text-ink-3 transition-colors hover:text-ink"
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M11.3 2.3a1.5 1.5 0 0 1 2.1 2.1L5 12.8l-3 .7.7-3 8.6-8.2z" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="删除会话"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`删除会话「${s.title || "未命名"}」？消息记录将一并删除。`)) onDeleteSession(s.id);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded-sm bg-surface text-ink-3 transition-colors hover:text-danger"
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {bottom && <div className="shrink-0 border-t border-line p-3">{bottom}</div>}
    </aside>
  );
}
