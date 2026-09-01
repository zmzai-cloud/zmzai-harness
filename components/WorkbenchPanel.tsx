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

/** 顶部 tab：终端不再单独占位，常驻底部面板。 */
type Tab = "review" | "files" | "canvas" | "map";

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
    key: "map",
    label: "地图",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M2 3.5l4-1.5 4 1.5 4-1.5v10.5l-4 1.5-4-1.5-4 1.5V3.5z" strokeLinejoin="round" />
        <path d="M6 2v10.5M10 3.5V14" />
      </svg>
    ),
  },
];

/** 文件 Tab 栈的单个标签（F1：多文件并行查看，LRU 上限 8）。 */
type FileTab = { path: string; content: string; size: number };

const MAX_FILE_TABS = 8;

/** 上下分割拖拽条：拖动时实时改 height，松手即持久化（下游 useEffect 落 localStorage）。 */
function SplitHandle({
  onChange,
  min,
}: {
  onChange: (r: number) => void;
  min?: number; // px，下半面板的最小高度
}) {
  const startRef = useRef<{ y: number; ratio: number; containerH: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    // 从 ref 拿当前 ratio；这里只用于记录起点，比从闭包外读更稳
    const startRatio = startRef.current?.ratio ?? 0.45;
    startRef.current = { y: e.clientY, ratio: startRatio, containerH: rect.height };
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      const dy = e.clientY - start.y;
      const next = start.ratio - dy / start.containerH;
      const lower = min ? min / start.containerH : 0.15;
      const upper = 0.85;
      const clamped = Math.min(upper, Math.max(lower, next));
      // 把最新值写回 ref（用于下次 mouseDown 起点）
      startRef.current = { ...start, ratio: clamped };
      onChange(clamped);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      startRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onMouseDown={onMouseDown}
      className="h-1 shrink-0 cursor-row-resize border-y border-line transition-colors hover:bg-selected-strong"
    />
  );
}

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

const TERMINAL_RATIO_KEY = "lectern:terminal-panel-ratio";
const FILE_TREE_WIDTH_KEY = "lectern:file-tree-width";

/**
 * 产物侧工作台（VS Code 风格）：
 *  ┌──────────────────────────────────────────────┐
 *  │ 顶部 tab：[审查][文件][画布][地图]             │
 *  ├──────────┬───────────────────────────────────┤
 *  │ FileTree │   内容区（preview/review/canvas/map）│
 *  │  (左)    ├───────────────────────────────────┤
 *  │          │   终端（多 zsh tab，常驻）          │
 *  └──────────┴───────────────────────────────────┘
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

  // 上下面板比例（下半 = terminal 占比）；localStorage 记忆
  const [terminalRatio, setTerminalRatio] = useState<number>(() => {
    if (typeof window === "undefined") return 0.45;
    try {
      const v = window.localStorage.getItem(TERMINAL_RATIO_KEY);
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n > 0.1 && n < 0.9 ? n : 0.45;
    } catch {
      return 0.45;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(TERMINAL_RATIO_KEY, String(terminalRatio));
    } catch {
      /* 忽略 */
    }
  }, [terminalRatio]);

  // 文件树列宽（VSCode 默认 ~240）
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 200;
    try {
      const v = window.localStorage.getItem(FILE_TREE_WIDTH_KEY);
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n >= 140 && n <= 480 ? n : 200;
    } catch {
      return 200;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(FILE_TREE_WIDTH_KEY, String(treeWidth));
    } catch {
      /* 忽略 */
    }
  }, [treeWidth]);

  const treeDragRef = useRef<{ x: number; w: number } | null>(null);
  const onTreeDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    treeDragRef.current = { x: e.clientX, w: treeWidth };
    const onMove = (e: MouseEvent) => {
      const start = treeDragRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      setTreeWidth(Math.min(480, Math.max(140, start.w + dx)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      treeDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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

  const select = (t: Tab) => {
    setTab(t);
    setEditing(false);
  };

  const activeIsHtml = activeFile ? /\.(html?|htm)$/i.test(activeFile.path) : false;

  // 预览/编辑区：根据 active tab 决定渲染内容
  const renderPreview = () => {
    switch (tab) {
        case "files":
          return activeFile ? (
            <div className="flex min-h-0 flex-1 flex-col">
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
                  onSaved={() => openFile(activeFile.path)}
                />
              ) : (
                <NumberedPreview content={activeFile.content} anchorLine={anchorLine} />
              )}
            </div>
          ) : (
            /* 无激活文件：显示本轮改动 chips（预览区中央） */
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              {editedPaths && editedPaths.length > 0 ? (
                <div className="flex max-w-md flex-col items-center gap-3 text-center">
                  <span className="text-[0.6875rem] uppercase tracking-wider text-ink-3">
                    本轮改动 {editedPaths.length}
                  </span>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {editedPaths.slice(0, 8).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => openFile(p)}
                        title={p}
                        className="max-w-44 truncate rounded-pill bg-live-tint px-2.5 py-1 font-mono text-xs text-live transition-colors hover:bg-live/20"
                      >
                        {p.split("/").pop()}
                      </button>
                    ))}
                  </div>
                  <span className="text-[0.625rem] text-ink-3">从左侧文件树选择，或点击上面任一文件打开预览</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-ink-3">
                  <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M14 10h16l8 8v22a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2z" strokeLinejoin="round" />
                    <path d="M30 10v8h8M18 24h12M18 30h12M18 36h8" strokeLinecap="round" />
                  </svg>
                  <span className="text-sm">从左侧文件树选择文件预览</span>
                </div>
              )}
            </div>
          );
        case "review":
          return <ReviewPane editedPaths={editedPaths ?? []} />;
        case "canvas":
          return <CanvasPane path={canvasPath} onPathChange={setCanvasPath} />;
        case "map":
          return <MapPane />;
      }
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      {/* 顶部 tab 行（终端不再占位，常驻底部） */}
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

      {/* 上半：左侧 tree + 右侧预览/审查/画布/地图；下半：多 zsh 终端。
          flex 列布局：top flex:1 1 0% 占满，handle 固定 4px，bottom 按 ratio 固定 calc。 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0" style={{ flex: "1 1 0%" }}>
          {/* 左侧文件树（VSCode 风格 explorer，仅文件 tab 显示；其他 tab 让出全部宽度） */}
          {tab === "files" && (
            <>
              <div className="flex min-h-0 shrink-0 flex-col border-r border-line bg-surface" style={{ width: treeWidth }}>
                {/* 树头部 */}
                <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line px-2 text-[0.6875rem] font-medium uppercase tracking-wider text-ink-3">
                  <span>资源管理器</span>
                  <span className="ml-auto text-[0.625rem] normal-case tracking-normal text-ink-3">↻</span>
                </div>
                <FileTree onOpenFile={(path) => openFile(path)} />
              </div>
              {/* 文件树 ↔ 预览拖拽条 */}
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={onTreeDragStart}
                className="w-1 shrink-0 cursor-col-resize border-x border-line transition-colors hover:bg-selected-strong"
              />
            </>
          )}
          {/* 右侧预览区 */}
          <div className="flex min-h-0 flex-1 flex-col">
            {renderPreview()}
          </div>
        </div>

        {/* 上下拖拽条 */}
        <SplitHandle onChange={setTerminalRatio} min={120} />

        {/* 下半：终端（多 zsh tab，常驻） */}
        <div
          className="flex min-h-0"
          style={{ flex: `0 0 calc(${terminalRatio * 100}% - 4px)`, minHeight: 120 }}
        >
          <TerminalPane />
        </div>
      </div>
    </div>
  );
}