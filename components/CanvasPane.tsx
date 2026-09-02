"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, cn } from "@zmzai/theme";

import { client } from "@/lib/client";

type Props = {
  /** 要在成果预览中打开的工作区文件路径（相对工作区根）。 */
  path: string | null;
  onPathChange: (path: string) => void;
  sessionId?: string | null;
};

/**
 * 成果预览：把工作区生成的 HTML 产物在 iframe（srcDoc）中实时渲染。
 * 组件名仍为 CanvasPane（内部实现名，spec 明示避免无谓重命名），
 * 但用户可见文案一律为「成果预览」。
 * HTML 用 srcDoc 隔离渲染（不落临时路由）；其余文本文件回退为代码预览。
 */
export default function CanvasPane({ path, onPathChange, sessionId }: Props) {
  const [draft, setDraft] = useState(path ?? "");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDraft(path ?? "");
  }, [path]);

  const open = useCallback(async (p: string) => {
    if (!p.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const f = await client.fsFile(p.trim(), sessionId);
      setContent(f.content);
      onPathChange(f.path);
    } catch (err) {
      setContent(null);
      setError(err instanceof Error ? err.message : "打开失败");
    } finally {
      setLoading(false);
    }
  }, [onPathChange, sessionId]);

  const isHtml = (path ?? "").toLowerCase().endsWith(".html") || (path ?? "").toLowerCase().endsWith(".htm");

  useEffect(() => {
    if (path) void open(path);
  }, [open, path]);

  if (!path) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-ink-3">
          <rect x="2.5" y="4" width="19" height="15" rx="2" />
          <path d="M2.5 8.5h19M6 6.2h.01M8.5 6.2h.01" strokeLinecap="round" />
          <path d="M9 13l-2 2 2 2M15 13l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="text-sm font-semibold text-ink-2">成果预览</div>
        <div className="max-w-60 text-xs leading-5 text-ink-3">
          当前任务生成 HTML 成果后会自动显示在这里；也可从「文件」中手动打开一个 HTML 文件。
        </div>
        <div className="flex w-full max-w-72 items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void open(draft);
            }}
            placeholder="工作区文件路径…"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-ink"
          />
          <Button variant="secondary" size="sm" disabled={!draft.trim() || loading} onClick={() => void open(draft)}>
            打开
          </Button>
        </div>
        {error && <div className="text-xs text-danger">{error}</div>}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="truncate font-mono text-[0.6875rem] text-ink-2" title={path}>
          {path}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void open(path)}
          className={cn("text-[0.6875rem] transition-colors hover:text-ink", loading ? "text-ink-3" : "text-ink-3")}
        >
          {loading ? "加载中…" : "刷新"}
        </button>
      </div>
      {isHtml ? (
        <iframe
          title="成果预览"
          srcDoc={content ?? ""}
          sandbox="allow-scripts"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5 text-ink-2">{content}</pre>
      )}
    </div>
  );
}
