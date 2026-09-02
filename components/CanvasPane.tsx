"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import { isPreviewable } from "@/lib/task-presentation";

type Props = {
  /** 要在成果预览中打开的工作区文件路径（相对工作区根）。 */
  path: string | null;
  onPathChange: (path: string) => void;
  sessionId?: string | null;
  /** 跳到「文件」Tab 的路线（§4.5：成果预览空态要给出「查看当前任务文件」的路线）。 */
  onOpenFiles?: () => void;
};

/**
 * 成果预览：把工作区生成的 HTML 产物在 iframe（srcDoc）中实时渲染。
 * 组件名仍为 CanvasPane（内部实现名，spec 明示避免无谓重命名），
 * 但用户可见文案一律为「成果预览」。
 * HTML 用 srcDoc 隔离渲染（不落临时路由）；其余文本文件回退为代码预览。
 */
export default function CanvasPane({ path, onPathChange, sessionId, onOpenFiles }: Props) {
  const [draft, setDraft] = useState(path ?? "");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // §7.5：结果头部提供桌面/移动视口切换。HTML 产物常是页面，视口是真实需要的能力。
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

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

  // 统一到共享判定：原先这里用 endsWith(".html")||endsWith(".htm") 就地判断，
  // 与 WorkbenchPanel 的正则各写一份——是典型的漂移源，改一处就会不一致。
  const isHtml = path ? isPreviewable(path) : false;

  useEffect(() => {
    if (path) void open(path);
  }, [open, path]);

  // §4.5 空态：说明「可预览的产物类型」+ 给出到文件的路线，而不是一大片空白。
  if (!path) {
    return (
      <div className="wb-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-ink-3">
          <rect x="2.5" y="4" width="19" height="15" rx="2" />
          <path d="M2.5 8.5h19M6 6.2h.01M8.5 6.2h.01" strokeLinecap="round" />
          <path d="M9 13l-2 2 2 2M15 13l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="text-sm font-semibold text-ink-2">还没有可预览的成果</div>
        <div className="max-w-60 text-center text-xs leading-5 text-ink-3">
          可预览的类型是 <code className="font-mono">.html</code> / <code className="font-mono">.htm</code>。
          当前任务产出后会在这里自动打开；其他产物请到「文件」查看源码。
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
        {onOpenFiles && (
          <button
            type="button"
            onClick={onOpenFiles}
            className="rounded-[3px] bg-surface-2 px-2 py-1 text-[0.6875rem] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            查看当前任务文件
          </button>
        )}
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
        {/* 视口切换：HTML 产物常是页面，移动端宽度是真实需要的能力 */}
        {isHtml && (
          <span className="flex shrink-0 items-center gap-0.5">
            {(["desktop", "mobile"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setViewport(v)}
                title={v === "desktop" ? "桌面视口" : "移动视口（390px）"}
                aria-pressed={viewport === v}
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-sm transition-colors",
                  viewport === v ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {v === "desktop" ? (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="1.5" y="2.5" width="13" height="9" rx="1.2" />
                    <path d="M5.5 14h5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="4.5" y="1.5" width="7" height="13" rx="1.2" />
                    <path d="M7 12.5h2" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            ))}
          </span>
        )}
        <button
          type="button"
          onClick={() => void open(path)}
          className="shrink-0 text-[0.6875rem] text-ink-3 transition-colors hover:text-ink"
        >
          {loading ? "加载中…" : "刷新"}
        </button>
      </div>
      {isHtml ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-surface-2">
          <iframe
            title="成果预览"
            srcDoc={content ?? ""}
            sandbox="allow-scripts"
            className="min-h-0 shrink-0 border-0 bg-white"
            style={
              viewport === "mobile"
                ? { inlineSize: 390, blockSize: "100%", maxInlineSize: "100%" }
                : { inlineSize: "100%", blockSize: "100%" }
            }
          />
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5 text-ink-2">{content}</pre>
      )}
    </div>
  );
}
