"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import CanvasPane from "./CanvasPane";
import FileEditor from "./FileEditor";
import MapPane from "./MapPane";
import FileTree from "./FileTree";
import ReviewPane from "./ReviewPane";
import TerminalPane from "./TerminalPane";

type Tab = "review" | "files" | "map" | "canvas" | "terminal";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: "review",
    label: "审查",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M2.5 8s2-4 5.5-4 5.5 4 5.5 4-2 4-5.5 4S2.5 8 2.5 8z" strokeLinejoin="round" />
        <circle cx="8" cy="8" r="1.6" />
      </svg>
    ),
  },
  {
    key: "files",
    label: "文件",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" strokeLinejoin="round" />
        <path d="M10 2.5v3h3" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "map",
    label: "地图",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M2 3.5l4-1.5 4 1.5 4-1.5v10.5l-4 1.5-4-1.5-4 1.5V3.5z" strokeLinejoin="round" />
        <path d="M6 2v10.5M10 3.5V14" />
      </svg>
    ),
  },
  {
    key: "canvas",
    label: "画布",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1.5" y="2.5" width="13" height="10" rx="1.2" />
        <path d="M5.5 15h5M8 12.5V15" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "terminal",
    label: "终端",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.2" />
        <path d="M4 6l2.5 2L4 10M8 10.5h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

/**
 * 产物侧工作台：审查（git diff）/ 文件（树+预览+编辑）/ 画布（HTML 产物渲染）/ 终端（xterm）。
 * 「画布打开」把文件 Tab 的 HTML 产物送进画布 Tab；openRequest 是外部联动
 * （消息内路径点击 / ⌘P 文件快开）请求打开某个文件。
 */
export default function WorkbenchPanel({ openRequest }: { openRequest?: { path: string; ts: number } | null }) {
  const [tab, setTab] = useState<Tab>("review");
  const [preview, setPreview] = useState<{ path: string; content: string; size: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [canvasPath, setCanvasPath] = useState<string | null>(null);
  const loadSeq = useRef(0);

  // 外部联动：打开指定文件（切到文件 Tab 并加载）
  useEffect(() => {
    if (!openRequest) return;
    const seq = ++loadSeq.current;
    setTab("files");
    setEditing(false);
    void client
      .fsFile(openRequest.path)
      .then((f) => {
        if (seq !== loadSeq.current) return;
        setPreview({ path: f.path, content: f.content, size: f.size });
        if (/\.(html?|htm)$/i.test(f.path)) setCanvasPath(f.path);
      })
      .catch((err: Error) => {
        if (seq === loadSeq.current) setPreview({ path: openRequest.path, content: `无法预览：${err.message}`, size: 0 });
      });
  }, [openRequest]);

  // 切 Tab 时清掉文件预览（画布路径保留，方便来回对照）
  const select = (t: Tab) => {
    setTab(t);
    setPreview(null);
    setEditing(false);
  };

  const previewIsHtml = preview ? /\.(html?|htm)$/i.test(preview.path) : false;

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      {/* Tab 栏 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => select(t.key)}
            className={cn(
              "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-medium transition-colors",
              tab === t.key ? "bg-ink text-paper" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {tab === "review" && <ReviewPane />}
      {tab === "files" &&
        (preview ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setEditing(false);
                }}
                className="text-[0.6875rem] text-ink-3 transition-colors hover:text-ink"
              >
                ← 返回
              </button>
              <span className="truncate font-mono text-[0.6875rem] text-ink-2" title={preview.path}>
                {preview.path}
              </span>
              <span className="ml-auto shrink-0 text-[0.625rem] text-ink-3">
                {preview.size < 1024 ? `${preview.size}B` : `${Math.round(preview.size / 1024)}KB`}
              </span>
              {/* 预览/编辑切换（P1-6）：编辑模式 ⌘S 保存回写 */}
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className={cn(
                  "shrink-0 rounded-pill px-2 py-0.5 text-[0.625rem] font-medium transition-colors",
                  editing ? "bg-accent/15 text-accent-strong hover:bg-accent/25" : "bg-surface-2 text-ink-2 hover:text-ink",
                )}
              >
                {editing ? "预览" : "编辑"}
              </button>
              {previewIsHtml && (
                <button
                  type="button"
                  onClick={() => select("canvas")}
                  className="shrink-0 rounded-pill bg-accent/15 px-2 py-0.5 text-[0.625rem] font-medium text-accent-strong transition-colors hover:bg-accent/25"
                >
                  画布打开
                </button>
              )}
            </div>
            {editing ? (
              <FileEditor
                key={preview.path}
                path={preview.path}
                initialContent={preview.content}
                onSaved={() => {
                  // 保存后重新拉取，保持预览态与画布候选同步
                  void client.fsFile(preview.path).then((f) => setPreview({ path: f.path, content: f.content, size: f.size })).catch(() => undefined);
                }}
              />
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5 text-ink-2">{preview.content}</pre>
            )}
          </div>
        ) : (
          <FileTree
            onOpenFile={(path) => {
              const seq = ++loadSeq.current;
              void client
                .fsFile(path)
                .then((f) => {
                  if (seq !== loadSeq.current) return;
                  setPreview({ path: f.path, content: f.content, size: f.size });
                  setEditing(false);
                  // HTML 产物顺手记为画布候选（点「画布打开」即用）
                  if (/\.(html?|htm)$/i.test(f.path)) setCanvasPath(f.path);
                })
                .catch((err: Error) => {
                  if (seq === loadSeq.current) setPreview({ path, content: `无法预览：${err.message}`, size: 0 });
                });
            }}
          />
        ))}
      {tab === "map" && <MapPane />}
      {tab === "canvas" && <CanvasPane path={canvasPath} onPathChange={setCanvasPath} />}
      {tab === "terminal" && <TerminalPane />}
    </div>
  );
}
