"use client";

import { useEffect, useState } from "react";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import FileTree from "./FileTree";
import GitPanel from "./GitPanel";
import TerminalPane from "./TerminalPane";

type Tab = "files" | "git" | "terminal";

const TABS: { key: Tab; label: string }[] = [
  { key: "files", label: "文件" },
  { key: "git", label: "Git" },
  { key: "terminal", label: "终端" },
];

/**
 * 右侧 Inspector：文件树 / Git / 终端三个分区。
 * 文件 Tab 内含懒加载目录树 + 点击预览（预览占满 Inspector）。
 */
export default function Inspector() {
  const [tab, setTab] = useState<Tab>("files");
  const [preview, setPreview] = useState<{ path: string; content: string; size: number } | null>(null);

  // 终端 Tab 常驻挂载意义不大（切走时轮询停止），按需挂载即可
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      {/* Tab 栏 */}
      <div className="wb-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setPreview(null);
            }}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              tab === t.key ? "bg-ink text-paper" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="flex-1" />
        <span className="pr-1 text-[0.625rem] text-ink-3">.workspace</span>
      </div>

      {/* 内容区 */}
      {tab === "files" &&
        (preview ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="wb-bar-sm">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-[0.6875rem] text-ink-3 transition-colors hover:text-ink"
              >
                ← 返回
              </button>
              <span className="truncate text-[0.6875rem] text-ink-2" title={preview.path}>
                {preview.path}
              </span>
              <span className="ml-auto shrink-0 text-[0.625rem] text-ink-3">
                {preview.size < 1024 ? `${preview.size}B` : `${Math.round(preview.size / 1024)}KB`}
              </span>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5 text-ink-2">{preview.content}</pre>
          </div>
        ) : (
          <FileTree
            onOpenFile={(path) => {
              void client
                .fsFile(path)
                .then((f) => setPreview({ path: f.path, content: f.content, size: f.size }))
                .catch((err: Error) => setPreview({ path, content: `无法预览：${err.message}`, size: 0 }));
            }}
          />
        ))}
      {tab === "git" && <GitPanel />}
      {tab === "terminal" && <TerminalPane />}
    </div>
  );
}
