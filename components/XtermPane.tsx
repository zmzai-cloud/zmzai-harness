"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { TerminalSession } from "@/lib/types";
import TerminalPane from "./TerminalPane";

/** xterm 双主题配色（跟随 html[data-theme]，与 @zmzai/theme 明暗两套 token 对齐）。 */
const TERM_THEMES = {
  light: { background: "#faf9f7", foreground: "#1c1917", cursor: "#1c1917", selectionBackground: "#1c191722" },
  dark: { background: "#141210", foreground: "#e7e5e4", cursor: "#e7e5e4", selectionBackground: "#e7e5e433" },
} as const;

type ThemeMode = keyof typeof TERM_THEMES;

function currentTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * 终端 Tab（xterm.js 渲染）：pty 后端 → 完整交互 shell（保留 ANSI 颜色/光标控制，
 * 输出增量写入 xterm，键盘输入直写 stdin）；pipe 降级 → 沿用旧只读日志面板。
 * 主题跟随全局明暗切换（MutationObserver 监听 data-theme）。
 */
export default function XtermPane() {
  const [backend, setBackend] = useState<"pty" | "pipe" | "boot">("boot");
  const [session, setSession] = useState<TerminalSession | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{ dispose: () => void } | null>(null);
  const cursorRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // onData 回调需要最新会话 id，用 ref 桥接（避免重建 xterm 实例）
  const sessionRef = useRef<TerminalSession | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      // 后端能力探测：pty 才走 xterm，pipe 降级旧面板
      let kind: "pty" | "pipe" = "pipe";
      try {
        kind = (await client.terminalList()).backendKind;
      } catch {
        /* 探测失败按 pipe 处理 */
      }
      if (disposed) return;
      if (kind === "pipe") {
        setBackend("pipe");
        return;
      }

      // 动态加载 xterm（避免 SSR / 首屏代价）
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;

      const theme = TERM_THEMES[currentTheme()];
      const term = new Terminal({
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        cursorBlink: true,
        convertEol: false,
        theme,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      if (containerRef.current) term.open(containerRef.current);
      termRef.current = term;
      // 世代检查：StrictMode 双挂载时旧实例的 onData 仍会触发，只有当前实例才发送输入
      term.onData((d) => {
        if (termRef.current !== term) return;
        const s = sessionRef.current;
        if (s) void client.terminalInput(s.id, d).catch(() => undefined);
      });
      cleanups.push(() => term.dispose());

      // 容器尺寸变化时自适应重排
      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* 容器不可见时跳过 */
        }
      });
      if (containerRef.current) ro.observe(containerRef.current);
      cleanups.push(() => ro.disconnect());

      // 主题跟随：监听 data-theme 变化换配色
      const mo = new MutationObserver(() => {
        term.options.theme = TERM_THEMES[currentTheme()];
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      cleanups.push(() => mo.disconnect());

      try {
        const s = await client.terminalStart("sh -i");
        if (disposed) {
          void client.terminalKill(s.id).catch(() => undefined);
          return;
        }
        sessionRef.current = s;
        setSession(s);
        setBackend("pty");
        cursorRef.current = 0;
        term.clear();

        // 输出轮询（保留 ANSI 原样交给 xterm 渲染）
        pollRef.current = setInterval(async () => {
          const cur = sessionRef.current;
          if (!cur) return;
          try {
            const chunk = await client.terminalRead(cur.id, cursorRef.current);
            cursorRef.current = chunk.cursor;
            if (chunk.output) term.write(chunk.output);
            if (chunk.session.status !== "running") {
              term.write("\r\n\x1b[90m[会话已退出]\x1b[0m\r\n");
              stopPoll();
            }
          } catch {
            stopPoll();
          }
        }, 150);
      } catch {
        if (!disposed) setBackend("pipe");
      }
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      stopPoll();
      const s = sessionRef.current;
      if (s && s.status === "running") void client.terminalKill(s.id).catch(() => undefined);
      sessionRef.current = null;
      termRef.current = null;
    };
  }, [stopPoll]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  if (backend === "pipe") {
    // pipe 降级：无 pty 能力，沿用只读日志面板
    return <TerminalPane />;
  }
  // 容器常驻挂载（boot 期间也在）：xterm 需要在 effect 里立刻 open 到已存在节点
  return (
    <div className="relative min-h-0 flex-1 p-1">
      {backend === "boot" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-ink-3">
          终端启动中…
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
