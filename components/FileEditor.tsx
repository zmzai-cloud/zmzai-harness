"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";

/**
 * 轻量编辑器（P1-6）：产物侧文件 Tab 的编辑模式。
 * 等宽 textarea + ⌘S/Ctrl+S 保存回写（PUT /api/fs/file）+ 未保存标记。
 */
export default function FileEditor({
  path,
  initialContent,
  onSaved,
}: {
  path: string;
  initialContent: string;
  onSaved?: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.fsSave(path, content);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // Tab 键输入两空格（编辑器基本体验）
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart, selectionEnd, value } = el;
      const next = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
      setContent(next);
      setDirty(true);
      requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <textarea
        ref={areaRef}
        value={content}
        spellCheck={false}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 resize-none bg-bg p-3 font-mono text-xs leading-5 text-ink outline-none"
      />
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line px-3 text-[0.625rem] text-ink-3">
        <span className={cn(dirty && "text-warning")}>{dirty ? "未保存" : "已同步"}</span>
        {savedAt && <span>保存于 {savedAt}</span>}
        {error && <span className="text-danger">{error}</span>}
        <span className="flex-1" />
        <span>Tab 缩进</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-pill bg-ink px-2 py-0.5 font-medium text-bg transition-opacity hover:opacity-85 disabled:opacity-25"
        >
          {saving ? "保存中…" : "保存（⌘S）"}
        </button>
      </div>
    </div>
  );
}
