"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@zmzai/theme";

/** unified diff 逐行渲染：+ 增 / - 删 / @@ 定位 / 其余上下文。
 *  行内容经 Shiki 做语法高亮（highlighter 单例 + 语言按需懒加载；双主题
 *  跟随 html[data-theme]）。超长 diff（>3000 行或 >100KB）降级纯文本。
 *  审查 Tab 与消息流内的编辑 diff 卡片共用。 */

const FALLBACK_LIMIT_LINES = 3000;
const FALLBACK_LIMIT_CHARS = 100_000;

/** 扩展名 → Shiki 语言（覆盖工作区最常见的；未命中回落纯文本）。 */
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", css: "css", scss: "scss", html: "html", htm: "html", vue: "vue", svelte: "svelte",
  md: "markdown", mdx: "mdx", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", yml: "yaml", yaml: "yaml", toml: "toml", php: "php", swift: "swift", kt: "kotlin",
};

function langOf(path?: string): string {
  if (!path) return "text";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "text";
}

type ShikiModule = Awaited<typeof import("shiki")>;
type ShikiHighlighter = Awaited<ReturnType<ShikiModule["createHighlighter"]>>;

let shikiModulePromise: Promise<ShikiModule> | null = null;
let highlighterPromise: Promise<ShikiHighlighter> | null = null;

function loadShikiModule(): Promise<ShikiModule> {
  shikiModulePromise ??= import("shiki");
  return shikiModulePromise;
}

function getHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= loadShikiModule().then((shiki) =>
    shiki.createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }),
  );
  return highlighterPromise;
}

type Token = { content: string; color: string | undefined };

/** 当前应使用的 Shiki 主题（跟随 html[data-theme]，system 态看实际生效值）。 */
function activeTheme(): "github-light" | "github-dark" {
  if (typeof document === "undefined") return "github-light";
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return "github-dark";
  if (t === "light") return "github-light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "github-dark" : "github-light";
}

/** 高亮整段 diff → 逐行 tokens（与源行一一对应）；失败/不支持的语言返回 null。 */
async function highlightLines(lines: string[], lang: string, theme: "github-light" | "github-dark"): Promise<Token[][] | null> {
  try {
    if (lang === "text") return null;
    const shiki = await loadShikiModule();
    const bundled = (shiki.bundledLanguages as Record<string, ShikiModule["bundledLanguages"][keyof ShikiModule["bundledLanguages"]]>)[lang];
    if (!bundled) return null;
    const highlighter = await getHighlighter();
    await highlighter.loadLanguage(bundled); // 已加载则幂等跳过
    const result = highlighter.codeToTokens(lines.join("\n"), { lang: lang as never, theme });
    return result.tokens.map((lineTokens) => lineTokens.map((t) => ({ content: t.content, color: t.color })));
  } catch {
    return null;
  }
}

export default function DiffView({ diff, className, path }: { diff: string; className?: string; path?: string }) {
  const lines = useMemo(() => diff.split("\n"), [diff]);
  const lang = useMemo(() => langOf(path), [path]);
  const skipHighlight = lang === "text" || lines.length > FALLBACK_LIMIT_LINES || diff.length > FALLBACK_LIMIT_CHARS;

  const [theme, setTheme] = useState<"github-light" | "github-dark">("github-light");
  const [tokenLines, setTokenLines] = useState<Token[][] | null>(null);
  const loadSeq = useRef(0);

  // 主题跟随：显式切换（html[data-theme]）与系统切换都监听
  useEffect(() => {
    setTheme(activeTheme());
    const observer = new MutationObserver(() => setTheme(activeTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setTheme(activeTheme());
    mq.addEventListener("change", onScheme);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", onScheme);
    };
  }, []);

  // 异步高亮：纯文本先行渲染，tokens 就绪后原位替换（行结构一致，无跳变）
  useEffect(() => {
    if (skipHighlight) {
      setTokenLines(null);
      return;
    }
    const seq = ++loadSeq.current;
    setTokenLines(null);
    void highlightLines(lines, lang, theme).then((result) => {
      if (seq === loadSeq.current) setTokenLines(result);
    });
  }, [lines, lang, theme, skipHighlight]);

  return (
    <pre className={cn("min-h-0 flex-1 overflow-auto p-3 font-mono text-[0.6875rem] leading-[1.45]", className)}>
      {lines.map((line, i) => {
        let cls = "text-ink-2";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "bg-success/10";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "bg-danger/10";
        else if (line.startsWith("@@")) cls = "text-accent-strong";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-ink-3";
        const tokens = tokenLines?.[i];
        return (
          <div key={i} className={cn("whitespace-pre-wrap break-all px-1", cls)}>
            {tokens
              ? tokens.length
                ? tokens.map((t, j) => (
                    <span key={j} style={t.color ? { color: t.color } : undefined}>
                      {t.content}
                    </span>
                  ))
                : " "
              : line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/** 从 unified diff 文本统计 +/- 行数（头部 @@/diff/index 行不计）。 */
export function diffStat(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}
