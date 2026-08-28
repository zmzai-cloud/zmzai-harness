"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { TerminalSession } from "@/lib/types";

/** 剥除 ANSI 转义序列（颜色/光标控制）——只读日志面板不需要保留。 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

type Mode = "boot" | "shell" | "runner" | "dead";

/**
 * 终端面板。两种后端两种形态：
 * - pty（node-pty 可用）：启动常驻交互 sh，cd/变量等状态跨命令延续，write 直写 stdin；
 * - pipe（降级）：命令运行器，每条命令一个 sh -c 会话，游标增量读输出。
 * 输出统一为只读日志流（剥 ANSI），300ms 轮询增量拉取。
 */
export default function TerminalPane() {
  const [mode, setMode] = useState<Mode>("boot");
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [active, setActive] = useState<TerminalSession | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const outRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const append = useCallback((text: string) => {
    if (!text) return;
    setLines((prev) => {
      // 流式增量可能不带换行——最后一段先拼进末行
      const chunks = stripAnsi(text).split("\n");
      const next = [...prev];
      if (next.length > 0) next[next.length - 1] += chunks[0] ?? "";
      next.push(...chunks.slice(1));
      return next;
    });
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** 轮询循环：读到会话退出为止（shell 退出后允许重启）。 */
  const startPoll = useCallback(
    (sessionId: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const chunk = await client.terminalRead(sessionId, cursorRef.current);
          cursorRef.current = chunk.cursor;
          append(chunk.output);
          if (chunk.session.status !== "running") {
            stopPoll();
            setActive(null);
            setMode("dead");
          }
        } catch {
          stopPoll();
          setActive(null);
          setMode("dead");
        }
      }, 300);
    },
    [append, stopPoll],
  );

  // 挂载即建终端：pty 起交互 shell，pipe 直接命令运行器
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const { backendKind } = await client.terminalList();
        if (disposed) return;
        if (backendKind === "pty") {
          const s = await client.terminalStart("sh -i");
          if (disposed) return;
          cursorRef.current = 0;
          setActive(s);
          setMode("shell");
          startPoll(s.id);
        } else {
          setMode("runner");
        }
      } catch {
        if (!disposed) setMode("dead");
      }
    })();
    return () => {
      disposed = true;
      // shell 会话随面板关闭回收，避免子进程泄漏
      setActive((s) => {
        if (s && s.status === "running") void client.terminalKill(s.id).catch(() => undefined);
        return null;
      });
      stopPoll();
    };
  }, [startPoll, stopPoll]);

  const submit = useCallback(
    async (cmd: string) => {
      if (!cmd.trim()) return;
      setHistory((prev) => [...prev.filter((h) => h !== cmd), cmd].slice(-50));
      setHistoryIdx(-1);
      setCommand("");
      if (mode === "shell" && active) {
        setLines((prev) => [...prev, `$ ${cmd}`]);
        void client.terminalInput(active.id, `${cmd}\n`).catch(() => undefined);
        return;
      }
      if (mode === "runner" && !active) {
        setLines((prev) => [...prev, `$ ${cmd}`]);
        try {
          const s = await client.terminalStart(cmd);
          cursorRef.current = 0;
          setActive(s);
          startPoll(s.id);
        } catch (err) {
          append(`[启动失败：${err instanceof Error ? err.message : "未知错误"}]\n`);
        }
      }
    },
    [mode, active, startPoll, append],
  );

  const abort = useCallback(async () => {
    if (!active) return;
    stopPoll();
    await client.terminalKill(active.id).catch(() => undefined);
    append("[已中止]\n");
    setActive(null);
    setMode(mode === "shell" ? "dead" : "runner");
  }, [active, stopPoll, append, mode]);

  const restart = useCallback(() => {
    setLines([]);
    cursorRef.current = 0;
    // 重新走挂载逻辑：pty 重起 shell / runner 回命令模式
    setMode("boot");
    (async () => {
      try {
        const { backendKind } = await client.terminalList();
        if (backendKind === "pty") {
          const s = await client.terminalStart("sh -i");
          cursorRef.current = 0;
          setActive(s);
          setMode("shell");
          startPoll(s.id);
        } else {
          setMode("runner");
        }
      } catch {
        setMode("dead");
      }
    })();
  }, [startPoll]);

  // 输出增长时自动滚底
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit(command);
    } else if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      const idx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx);
      setCommand(history[idx] ?? "");
    } else if (e.key === "ArrowDown" && history.length > 0) {
      e.preventDefault();
      if (historyIdx < 0) return;
      const idx = historyIdx + 1;
      if (idx >= history.length) {
        setHistoryIdx(-1);
        setCommand("");
      } else {
        setHistoryIdx(idx);
        setCommand(history[idx] ?? "");
      }
    }
  };

  const inputDisabled = mode !== "shell" && mode !== "runner";

  return (
    <div className="flex min-h-0 flex-1 flex-col font-mono">
      <div ref={outRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {lines.length === 0 ? (
          <div className="text-xs leading-6 text-ink-3">
            {mode === "boot"
              ? "终端启动中…"
              : mode === "runner"
                ? "在下方输入命令，于工作区目录执行。输出实时回传，支持 ↑/↓ 翻历史。"
                : mode === "dead"
                  ? "终端已退出。"
                  : ""}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-all text-xs leading-5 text-ink-2">{lines.join("\n")}</pre>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
        <span className={cn("text-xs font-semibold", active ? "text-warning" : "text-accent-strong")}>$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKey}
          disabled={inputDisabled}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          placeholder={
            mode === "shell"
              ? "交互 shell 已就绪（cd/环境变量状态延续）"
              : active
                ? `正在执行：${active.name ?? ""}`
                : "输入命令，Enter 执行"
          }
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-3"
        />
        {active ? (
          <Button variant="danger" size="sm" onClick={() => void abort()}>
            中止
          </Button>
        ) : mode === "dead" ? (
          <Button variant="secondary" size="sm" onClick={restart}>
            重启
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => void submit(command)}>
            执行
          </Button>
        )}
      </div>
    </div>
  );
}
