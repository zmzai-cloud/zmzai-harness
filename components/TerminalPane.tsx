"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import "@xterm/xterm/css/xterm.css";

type Mode = "boot" | "shell" | "runner" | "dead";

/** VSCode Dark+ 终端配色。 */
const VSC_THEME = {
  background: "#1d1d1d",
  foreground: "#cccccc",
  cursor: "#cccccc",
  cursorAccent: "#1d1d1d",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e513",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
} as const;

type XTerm = InstanceType<Awaited<ReturnType<typeof loadXterm>>["Terminal"]>;

type FitAddonInstance = InstanceType<Awaited<ReturnType<typeof loadXterm>>["FitAddon"]>;

async function loadXterm() {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]);
  return { Terminal, FitAddon };
}

/**
 * 终端面板（VSCode 式）：xterm.js 全真渲染——深色终端体、ANSI 颜色、
 * 光标内联在输出流（无独立输入框）。两种后端两种形态：
 * - pty（node-pty 可用）：常驻交互 zsh，键盘输入 onData 直写 stdin，
 *   回显/补全/ctrl-c 全由真实 shell 处理，与 VSCode 内置终端同感；
 * - pipe（降级）：命令运行器，onData 聚合成行，Enter 提交并回显。
 * 输出经 300ms 轮询增量拉取，原文 write 进 xterm（保留 ANSI）。
 */
export default function TerminalPane() {
  const [mode, setMode] = useState<Mode>("boot");
  const [backend, setBackend] = useState<"pty" | "pipe">("pty");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddonInstance | null>(null);
  const activeRef = useRef<{ id: string; status: string } | null>(null);
  const modeRef = useRef<Mode>("boot");
  const cursorRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lineBufRef = useRef("");
  const obsRef = useRef<ResizeObserver | null>(null);

  const setModeSafe = useCallback((m: Mode) => {
    modeRef.current = m;
    setMode(m);
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** 轮询循环：增量读 → 原文 write（保留 ANSI 颜色），会话退出即标记 dead。 */
  const startPoll = useCallback(
    (sessionId: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const chunk = await client.terminalRead(sessionId, cursorRef.current);
          cursorRef.current = chunk.cursor;
          if (chunk.output) termRef.current?.write(chunk.output);
          if (chunk.session.status !== "running") {
            stopPoll();
            activeRef.current = null;
            setModeSafe("dead");
            termRef.current?.write("\r\n\x1b[90m[进程已退出]\x1b[0m\r\n");
          }
        } catch {
          stopPoll();
          activeRef.current = null;
          setModeSafe("dead");
        }
      }, 300);
    },
    [stopPoll, setModeSafe],
  );

  /** 启动会话并进入轮询（pty 起交互 zsh / pipe 起命令运行器）。 */
  const boot = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;
    term.reset();
    stopPoll();
    cursorRef.current = 0;
    activeRef.current = null;
    setModeSafe("boot");
    try {
      const { backendKind } = await client.terminalList();
      setBackend(backendKind);
      if (backendKind === "pty") {
        const s = await client.terminalStart("zsh -i");
        activeRef.current = s;
        setModeSafe("shell");
        startPoll(s.id);
      } else {
        setModeSafe("runner");
        term.write("\x1b[90m输入命令并回车执行（降级模式：每条命令独立会话）\x1b[0m\r\n");
      }
    } catch {
      setModeSafe("dead");
      term.write("\x1b[31m[终端服务不可达]\x1b[0m\r\n");
    }
  }, [startPoll, stopPoll, setModeSafe]);

  // 挂载：建 xterm 实例 + 输入接线 + 自适应尺寸 + 启动会话
  useEffect(() => {
    let disposed = false;
    (async () => {
      const { Terminal, FitAddon } = await loadXterm();
      if (disposed || !containerRef.current) return;
      const term = new Terminal({
        fontSize: 12,
        fontFamily: '"SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
        lineHeight: 1.3,
        cursorBlink: true,
        convertEol: false,
        scrollback: 5000,
        theme: VSC_THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      // 键盘直写 stdin（pty）；pipe 模式聚合行，Enter 提交
      term.onData((d) => {
        const m = modeRef.current;
        const s = activeRef.current;
        if (m === "shell" && s) {
          void client.terminalInput(s.id, d).catch(() => undefined);
          return;
        }
        if (m === "runner" && !s) {
          if (d === "\r") {
            const cmd = lineBufRef.current.trim();
            lineBufRef.current = "";
            if (!cmd) {
              term.write("\r\n\x1b[90m$\x1b[0m ");
              return;
            }
            term.write("\r\n");
            (async () => {
              try {
                const session = await client.terminalStart(cmd);
                activeRef.current = session;
                cursorRef.current = 0;
                startPoll(session.id);
              } catch (err) {
                term.write(`\x1b[31m[启动失败：${err instanceof Error ? err.message : "未知错误"}]\x1b[0m\r\n`);
              }
            })();
          } else if (d === "\x7f") {
            if (lineBufRef.current.length > 0) {
              lineBufRef.current = lineBufRef.current.slice(0, -1);
              term.write("\b \b");
            }
          } else if (d >= " ") {
            lineBufRef.current += d;
            term.write(d);
          }
        }
      });

      // 容器尺寸变化时自适应（侧栏拖拽/窗口缩放）
      const obs = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          // 容器不可见时 fit 会抛错，忽略
        }
      });
      obs.observe(containerRef.current);
      obsRef.current = obs;

      void boot();
    })();
    return () => {
      disposed = true;
      obsRef.current?.disconnect();
      // shell 会话随面板关闭回收，避免子进程泄漏
      const s = activeRef.current;
      if (s && s.status === "running") void client.terminalKill(s.id).catch(() => undefined);
      activeRef.current = null;
      stopPoll();
      termRef.current?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerLabel =
    mode === "boot" ? "启动中…" : mode === "dead" ? "已退出" : backend === "pty" ? "zsh" : "命令运行";

  const iconBtn =
    "flex h-6 w-6 items-center justify-center rounded-sm text-[#cccccc]/60 transition-colors hover:bg-white/10 hover:text-[#cccccc]";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#1d1d1d]">
      {/* VSCode 式终端头：左标签 + 右动作（清屏/重启） */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/10 px-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-t-sm px-2 py-1 text-[0.6875rem] font-medium",
            mode === "dead" ? "text-[#cccccc]/50" : "bg-white/10 text-[#e7e7e7]",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              mode === "shell" || mode === "runner" ? "bg-[#0dbc79]" : mode === "boot" ? "bg-[#e5e513] animate-pulse" : "bg-[#666]",
            )}
          />
          {headerLabel}
        </span>
        <span className="flex-1" />
        <button type="button" title="清屏" onClick={() => termRef.current?.clear()} className={iconBtn}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 4.5h12M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M4 4.5l.7 8a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" title="重启终端" onClick={() => void boot()} className={iconBtn}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {/* 终端体：xterm 挂载点（光标内联，无独立输入框） */}
      <div ref={containerRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  );
}
