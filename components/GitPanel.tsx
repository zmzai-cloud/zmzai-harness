"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { GitStatus } from "@/lib/types";

/** 变更状态码 → 语义标签与颜色（X=Y 合并展示，X!=Y 双标）。 */
function statusBadge(x: string, y: string) {
  const code = x !== " " && x === y ? x : x !== " " ? `${x}${y}`.trim() : y;
  const map: Record<string, { label: string; tone: string }> = {
    M: { label: "修改", tone: "bg-warning/15 text-warning" },
    A: { label: "新增", tone: "bg-accent/20 text-accent-strong" },
    D: { label: "删除", tone: "bg-danger/15 text-danger" },
    R: { label: "重命名", tone: "bg-surface-2 text-ink-2" },
    "??": { label: "未跟踪", tone: "bg-surface-2 text-ink-2" },
  };
  const hit = map[code] ?? { label: code || "变更", tone: "bg-surface-2 text-ink-2" };
  return { label: hit.label, cls: hit.tone };
}

/** 工作区 Git 面板：分支 + ahead/behind + 变更文件列表（只读）。 */
export default function GitPanel() {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await client.gitStatus());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!status) {
    return <div className="px-4 py-3 text-xs text-ink-3">{loading ? "读取中…" : "暂无数据"}</div>;
  }
  if (status.error) {
    return (
      <div className="px-4 py-3 text-xs text-ink-3">
        工作区不是 git 仓库或 git 不可用。
        <button type="button" onClick={() => void refresh()} className="ml-2 text-accent-strong hover:underline">
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="4.5" cy="4" r="2" />
            <circle cx="4.5" cy="12" r="2" />
            <circle cx="11.5" cy="6" r="2" />
            <path d="M4.5 6v4M6.5 4.8C9 5.5 9.5 6 11.5 6M6.4 10.6C8 9.5 9.5 8 11.5 7.6" />
          </svg>
          {status.branch}
        </span>
        {(status.ahead > 0 || status.behind > 0) && (
          <Badge size="sm" variant="outline">
            ↑{status.ahead} ↓{status.behind}
          </Badge>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          className={cn("text-[0.6875rem] text-ink-3 transition-colors hover:text-ink", loading && "animate-pulse")}
        >
          刷新
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {status.changes.length === 0 ? (
          <div className="px-2 py-3 text-xs text-ink-3">工作区干净，没有未提交变更。</div>
        ) : (
          <ul>
            {status.changes.map((c) => {
              const { label, cls } = statusBadge(c.x, c.y);
              return (
                <li
                  key={`${c.x}${c.y}${c.path}`}
                  className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                  title={c.origPath ? `${c.origPath} → ${c.path}` : c.path}
                >
                  <span className={cn("shrink-0 rounded-sm px-1.5 py-0.5 text-[0.625rem] font-medium", cls)}>{label}</span>
                  <span className="truncate">{c.path}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
