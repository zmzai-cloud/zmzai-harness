"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/** 文件 Tab 栈的单个标签（F1：多文件并行查看，LRU 上限 8）。 */
type FileTab = { path: string; content: string; size: number };

const MAX_FILE_TABS = 8;

/** 带行号的纯文本预览（F3：path:line 锚点滚动定位）。 */
function NumberedPreview({ content, anchorLine }: { content: string; anchorLine?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lines = content.split("\n");
  useEffect(() => {
    if (!anchorLine || !ref.current) return;
    ref.current.querySelector(`[data-line="${anchorLine}"]`)?.scrollIntoView({ block: "center" });
  }, [anchorLine, content]);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto py-1">
      {lines.map((l, i) => (
        <div
          key={i}
          data-line={i + 1}
          className={cn("flex px-2 font-mono text-xs leading-5", anchorLine === i + 1 && "bg-warning-tint")}
        >
          <span className="w-10 shrink-0 select-none pr-2 text-right text-ink-3">{i + 1}</span>
          <span className="whitespace-pre-wrap break-all text-ink-2">{l || " "}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 产物侧工作台：审查（git diff）/ 文件（树 + Tab 栈预览/编辑）/ 画布 / 地图 / 终端。
 * 「画布打开」把文件 Tab 的 HTML 产物送进画布 Tab；openRequest 是外部联动
 * （消息内路径点击 / ⌘P 文件快开 / 工具卡路径）请求打开某个文件（可带行号）。
 */
export default function WorkbenchPanel({
  openRequest,
  editedPaths,
}: {
  openRequest?: { path: string; ts: number; line?: number } | null;
  /** 本轮 Agent 触碰过的文件（file.edited 投影，最新在前）——文件 Tab 顶部 chips + Git 高亮。 */
  editedPaths?: string[];
}) {
  const [tab, setTab] = useState<Tab>("review");
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [canvasPath, setCanvasPath] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const activeFile = fileTabs.find((t) => t.path === activePath) ?? null;

  // 外部联动：打开指定文件（切到文件 Tab、LRU 入栈并激活；line 用于锚点滚动）
  const [anchorLine, setAnchorLine] = useState<number | undefined>(undefined);
  const openFile = useCallback((path: string, line?: number) => {
    const seq = ++loadSeq.current;
    setTab("files");
    setEditing(false);
    setAnchorLine(line);
    setActivePath(path);
    void client
      .fsFile(path)
      .then((f) => {
        if (seq !== loadSeq.current) return;
        setFileTabs((prev) => {
          const idx = prev.findIndex((t) => t.path === f.path);
          const kept = prev.filter((t) => t.path !== f.path);
          kept.unshift({ path: f.path, content: f.content, size: f.size });
          // LRU 挤出时，若当前激活 tab 恰好被挤走，激活相邻 tab 而不是落回文件树
          const next = kept.slice(0, MAX_FILE_TABS);
          setActivePath((cur) => (next.some((t) => t.path === cur) ? cur : (next[Math.min(idx, next.length - 1)]?.path ?? null)));
          return next;
        });
        if (/\.(html?|htm)$/i.test(f.path)) setCanvasPath(f.path);
      })
      .catch((err: Error) => {
        if (seq !== loadSeq.current) return;
        setFileTabs((prev) => {
          const next = prev.filter((t) => t.path !== path);
          next.unshift({ path, content: `无法预览：${err.message}`, size: 0 });
          return next.slice(0, MAX_FILE_TABS);
        });
      });
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    openFile(openRequest.path, openRequest.line);
  }, [openRequest, openFile]);

  const closeTab = (path: string) => {
    setFileTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      const next = prev.filter((t) => t.path !== path);
      if (path === activePath) setActivePath(next[Math.min(idx, next.length - 1)]?.path ?? null);
      return next;
    });
  };

  // 切顶级 Tab 时清编辑态（文件内容与画布路径保留，方便来回对照）
  const select = (t: Tab) => {
    setTab(t);
    setEditing(false);
  };

  const activeIsHtml = activeFile ? /\.(html?|htm)$/i.test(activeFile.path) : false;

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
      {tab === "review" && <ReviewPane editedPaths={editedPaths ?? []} />}
      {tab === "files" &&
        (activeFile ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 文件 Tab 条（F1）：多文件并行查看，点标签切换，× 关闭 */}
            <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-1.5">
              {fileTabs.map((t) => (
                <button
                  key={t.path}
                  type="button"
                  onClick={() => {
                    setActivePath(t.path);
                    setEditing(false);
                    setAnchorLine(undefined);
                  }}
                  title={t.path}
                  className={cn(
                    "group flex max-w-44 shrink-0 items-center gap-1 rounded-sm px-2 py-1 text-left font-mono text-[0.6875rem] transition-colors",
                    t.path === activePath ? "bg-selected text-ink" : "text-ink-3 hover:bg-surface-3 hover:text-ink",
                  )}
                >
                  <span className="truncate">{t.path.split("/").pop()}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    title="关闭"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.path);
                    }}
                    className="hidden shrink-0 text-ink-3 hover:text-danger group-hover:block"
                  >
                    ✕
                  </span>
                </button>
              ))}
            </div>
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
              <span className="truncate font-mono text-[0.6875rem] text-ink-2" title={activeFile.path}>
                {activeFile.path}
              </span>
              <span className="ml-auto shrink-0 text-[0.625rem] text-ink-3">
                {activeFile.size < 1024 ? `${activeFile.size}B` : `${Math.round(activeFile.size / 1024)}KB`}
              </span>
              {/* 预览/编辑切换（P1-6）：编辑模式 ⌘S 保存回写 */}
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className={cn(
                  "shrink-0 rounded-pill px-2 py-0.5 text-[0.625rem] font-medium transition-colors",
                  editing ? "bg-selected text-ink hover:bg-selected-strong" : "bg-surface-2 text-ink-2 hover:text-ink",
                )}
              >
                {editing ? "预览" : "编辑"}
              </button>
              {activeIsHtml && (
                <button
                  type="button"
                  onClick={() => {
                    setCanvasPath(activeFile.path);
                    select("canvas");
                  }}
                  className="shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium text-ink-2 transition-colors hover:text-ink"
                >
                  画布打开
                </button>
              )}
            </div>
            {editing ? (
              <FileEditor
                key={activeFile.path}
                path={activeFile.path}
                initialContent={activeFile.content}
                onSaved={() => {
                  // 保存后重新拉取，保持预览态与画布候选同步
                  openFile(activeFile.path);
                }}
              />
            ) : (
              <NumberedPreview content={activeFile.content} anchorLine={anchorLine} />
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 本轮变更 chips（F3）：Agent 触碰过的文件，点击直开 */}
            {editedPaths && editedPaths.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
                <span className="text-[0.625rem] text-ink-3">本轮改动 {editedPaths.length}</span>
                {editedPaths.slice(0, 6).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => openFile(p)}
                    title={`${p} · 点击打开`}
                    className="max-w-40 truncate rounded-pill bg-live-tint px-2 py-0.5 font-mono text-[0.625rem] text-live transition-colors hover:bg-live/20"
                  >
                    {p.split("/").pop()}
                  </button>
                ))}
              </div>
            )}
            <FileTree onOpenFile={(path) => openFile(path)} />
          </div>
        ))}
      {tab === "map" && <MapPane />}
      {tab === "canvas" && <CanvasPane path={canvasPath} onPathChange={setCanvasPath} />}
      {tab === "terminal" && <TerminalPane />}
    </div>
  );
}
