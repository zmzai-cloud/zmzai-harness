"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";

type EditorLanguage = {
  label: string;
  extension:
    | ReturnType<typeof markdown>
    | ReturnType<typeof javascript>
    | ReturnType<typeof json>
    | ReturnType<typeof html>
    | ReturnType<typeof css>
    | ReturnType<typeof yaml>;
};

function languageOf(path: string): EditorLanguage {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "md":
    case "mdx":
      return { label: "Markdown", extension: markdown() };
    case "ts":
      return { label: "TypeScript", extension: javascript({ typescript: true }) };
    case "tsx":
      return { label: "TSX", extension: javascript({ jsx: true, typescript: true }) };
    case "js":
    case "mjs":
    case "cjs":
      return { label: "JavaScript", extension: javascript() };
    case "jsx":
      return { label: "JSX", extension: javascript({ jsx: true }) };
    case "json":
      return { label: "JSON", extension: json() };
    case "html":
    case "htm":
      return { label: "HTML", extension: html() };
    case "css":
    case "scss":
      return { label: "CSS", extension: css() };
    case "yml":
    case "yaml":
      return { label: "YAML", extension: yaml() };
    default:
      return { label: "纯文本", extension: markdown() };
  }
}

function lineColumn(state: EditorState): { line: number; column: number } {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1 };
}

/**
 * 文件编辑器：CodeMirror 6 实例只在文件切换时重建，文本内容由父层持有，
 * 因而可在 Markdown「预览 / 源代码」间切换而不丢草稿。保存始终带 sessionId，
 * 防止隔离会话误写主工作区。
 */
export default function FileEditor({
  path,
  anchorLine,
  value,
  savedContent,
  sessionId,
  onChange,
  onSaved,
  onDiscard,
}: {
  path: string;
  /** 从消息路径链接 / 快开传入，打开后将光标定位到指定行。 */
  anchorLine?: number;
  value: string;
  savedContent: string;
  sessionId?: string | null;
  onChange: (content: string) => void;
  onSaved?: (content: string, size: number) => void;
  onDiscard?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const savingRef = useRef<() => void>(() => undefined);
  const syncingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const language = languageOf(path);
  const dirty = value !== savedContent;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await client.fsSave(path, value, sessionId);
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      onSaved?.(value, result.size);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [dirty, onSaved, path, saving, sessionId, value]);

  savingRef.current = () => {
    void save();
  };

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;

    const editorTheme = EditorView.theme({
      "&": { height: "100%", backgroundColor: "var(--color-bg)", color: "var(--color-ink)" },
      ".cm-scroller": { overflow: "auto", fontFamily: '"SF Mono", Menlo, Monaco, "Cascadia Code", monospace', lineHeight: "1.65" },
      ".cm-content": { minHeight: "100%", padding: "12px 0" },
      ".cm-line": { padding: "0 14px" },
      ".cm-gutters": { minHeight: "100%", borderRight: "1px solid var(--color-line)", backgroundColor: "var(--color-surface)", color: "var(--color-ink-3)" },
      ".cm-activeLine": { backgroundColor: "var(--color-surface-2)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--color-surface-2)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent-strong)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--color-selected-strong)" },
      ".cm-tooltip": { border: "1px solid var(--color-line)", backgroundColor: "var(--color-surface)", color: "var(--color-ink)" },
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          highlightActiveLine(),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { savingRef.current(); return true; } },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          language.extension,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) setCursor(lineColumn(update.state));
          }),
        ],
      }),
      parent,
    });
    viewRef.current = view;
    setCursor(lineColumn(view.state));
    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
    // 文件路径是编辑器实例边界；value 的同步由下一条 effect 增量处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    syncingRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !anchorLine) return;
    const line = view.state.doc.line(Math.min(Math.max(1, anchorLine), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }, [anchorLine, path]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1 text-[0.75rem]" />
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-surface px-3 font-mono text-[0.625rem] text-ink-3">
        <span className={cn(dirty && "text-warning")}>{saving ? "保存中…" : dirty ? "未保存" : "已同步"}</span>
        {savedAt && !dirty && <span>保存于 {savedAt}</span>}
        {error && <span className="max-w-64 truncate font-sans text-danger" title={error}>{error}</span>}
        <span className="ml-auto">{language.label}</span>
        <span>Ln {cursor.line}, Col {cursor.column}</span>
        <button
          type="button"
          onClick={onDiscard}
          disabled={!dirty || saving}
          className="rounded-[3px] px-1.5 py-0.5 font-sans text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-35"
        >
          还原
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-[3px] bg-ink px-1.5 py-0.5 font-sans font-medium text-bg transition-opacity hover:opacity-85 disabled:opacity-35"
        >
          保存（⌘S）
        </button>
      </div>
    </div>
  );
}
