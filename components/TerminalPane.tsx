"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { ShellCandidate } from "@/lib/types";
import "@xterm/xterm/css/xterm.css";

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
 * 单个会话的本地镜像：buffer 与 cursor 维持着 xterm 内容的真实副本，
 * 切 tab 时切换 buffer 来重建——单 xterm 实例 + 多会话历史快照。
 */
type Sess = {
  id: string;
  name: string;
  /** 底层 shell 名（zsh/bash/fish/pwsh），用于同 shell 多开时的序号编排。 */
  shell: string;
  /** shell 可执行文件绝对路径，tab 悬停时展示，便于确认用的是哪一个。 */
  shellFile?: string;
  status: "running" | "exited" | "killed" | "boot";
  /** 累计输出（含 ANSI 颜色），与 xterm 实际显示始终同步。 */
  buffer: string;
  /** 服务端 read 游标。 */
  cursor: number;
};

/**
 * 终端面板（VSCode 式 + 多 shell tab）：
 * - 单 xterm 实例承载当前激活会话；其他会话用 buffer 快照缓存，切换时回放。
 * - 头部 "N 个终端 [+ ⌄]" —— 对齐 VSCode；tab 行每个会话一个 chip：图标 + 名 + ×。
 * - 起的是**系统默认 shell**（$SHELL → /etc/passwd → 常见路径兜底），不写死 zsh：
 *   用户装了 zsh 就是 zsh，只有 bash 就是 bash，Windows 退到 pwsh/PowerShell/cmd。
 *   shell 解析在服务端 lib/shell.ts，面板只拿到探测结果。
 * - pty 后端：交互 shell 常驻；pipe 后端（无 node-pty）降级为「输入一行跑一条命令」。
 */
export default function TerminalPane() {
  const [backend, setBackend] = useState<"pty" | "pipe">("pty");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shells, setShells] = useState<ShellCandidate[]>([]);
  const [defaultShell, setDefaultShell] = useState<ShellCandidate | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddonInstance | null>(null);
  const sessionsRef = useRef<Sess[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const defaultShellRef = useRef<ShellCandidate | null>(null);
  const backendRef = useRef<"pty" | "pipe">("pty");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const obsRef = useRef<ResizeObserver | null>(null);
  const lineBufRef = useRef(""); // pipe 模式输入缓冲

  useEffect(() => {
    defaultShellRef.current = defaultShell;
  }, [defaultShell]);
  // onData 回调只在挂载时注册一次，backend 必须走 ref 才能读到探测结果
  useEffect(() => {
    backendRef.current = backend;
  }, [backend]);

  // 把 React state 同步到 ref（轮询循环只读 ref，避免闭包陈旧）
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * 起一条交互式 shell 会话并加入列表。
   * 不传 shell 时服务端用系统默认 shell；tab 名 = 「shell 名 + 同名序号」，
   * 同名多开时读作 zsh 1 / zsh 2，混开时读作 zsh 1 / bash 1。
   */
  const newSession = useCallback(async (shellFile?: string) => {
    try {
      const s = await client.terminalStartShell(shellFile);
      const label = s.name?.trim() || defaultShellRef.current?.label || "shell";
      const file = shellFile ?? defaultShellRef.current?.file;
      const seq = sessionsRef.current.filter((x) => x.shell === label).length + 1;
      const sess: Sess = {
        id: s.id,
        name: `${label} ${seq}`,
        shell: label,
        ...(file ? { shellFile: file } : {}),
        status: (s.status as Sess["status"]) ?? "running",
        buffer: "",
        cursor: 0,
      };
      setSessions((prev) => [...prev, sess]);
      setActiveId(s.id);
      return sess.id;
    } catch (err) {
      termRef.current?.write(
        `\r\n\x1b[31m[启动失败：${err instanceof Error ? err.message : "未知错误"}]\x1b[0m\r\n`,
      );
      return null;
    }
  }, []);

  /** 关闭会话：发 DELETE 回收子进程，从列表移除；若是当前激活会话则切到邻居。 */
  const killSession = useCallback(async (id: string) => {
    const list = sessionsRef.current;
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const s = list[idx];
    void client.terminalKill(id).catch(() => undefined);
    setSessions((prev) => prev.filter((x) => x.id !== id));
    if (activeIdRef.current === id) {
      const next = list[idx + 1] ?? list[idx - 1] ?? null;
      setActiveId(next ? next.id : null);
    }
  }, []);

  /** 切换激活会话：xterm.reset() 清屏并写入新会话 buffer。 */
  const switchSession = useCallback((id: string) => {
    if (id === activeIdRef.current) return;
    const target = sessionsRef.current.find((s) => s.id === id);
    if (!target) return;
    termRef.current?.reset();
    if (target.buffer) termRef.current?.write(target.buffer);
    setActiveId(id);
  }, []);

  // 轮询循环：所有会话都读增量；只有激活会话写 xterm，否则只追加到会话 buffer。
  const startPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      const list = sessionsRef.current;
      const active = activeIdRef.current;
      for (const s of list) {
        try {
          const chunk = await client.terminalRead(s.id, s.cursor);
          s.cursor = chunk.cursor;
          if (chunk.output) {
            s.buffer += chunk.output;
            if (s.id === active) termRef.current?.write(chunk.output);
          }
          const next = chunk.session.status as Sess["status"];
          if (next !== s.status) s.status = next;
          if (chunk.session.status !== "running" && s.status !== "killed") {
            if (s.id === active) {
              termRef.current?.write("\r\n\x1b[90m[进程已退出]\x1b[0m\r\n");
            }
          }
        } catch {
          // 单会话读失败不连累其他；保留原状态
        }
      }
      // 触发一次 re-render（buffer/cursor 变化不会自动反映到 UI 列表里）
      setSessions((prev) => prev.slice());
    }, 300);
  }, [stopPoll]);

  // 挂载：建 xterm + 输入接线 + 自适应 + 拉取/补建会话 + 启动轮询
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

      // 键盘输入：pipe 降级为「逐行缓冲 + Enter 提交」——降级态本来就没有常驻
      // 会话，所以 pipe 分支不要求活跃会话，首条命令也能直接提交；
      // pty 把按键透传给激活会话。backend 走 ref（回调只在挂载注册一次）。
      term.onData((d) => {
        if (backendRef.current === "pipe") {
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
                const s = await client.terminalStart(cmd);
                const next: Sess = {
                  id: s.id,
                  name: cmd.slice(0, 30),
                  shell: defaultShellRef.current?.label ?? "shell",
                  status: "running",
                  buffer: "",
                  cursor: 0,
                };
                setSessions((prev) => [...prev, next]);
                setActiveId(s.id);
                sessionsRef.current = [...sessionsRef.current, next];
              } catch (err) {
                term.write(
                  `\r\n\x1b[31m[启动失败：${err instanceof Error ? err.message : "未知错误"}]\x1b[0m\r\n`,
                );
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
          return;
        }
        // pty：需要活跃会话才透传
        const active = activeIdRef.current;
        const list = sessionsRef.current;
        const sess = list.find((s) => s.id === active) ?? null;
        if (!sess || sess.status !== "running") {
          if (d === "\r") term.write("\r\n");
          return;
        }
        void client.terminalInput(sess.id, d).catch(() => undefined);
      });

      // 自适应尺寸
      const obs = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* 容器不可见时 fit 会抛 */
        }
      });
      obs.observe(containerRef.current);
      obsRef.current = obs;

      // 探测后端 + 系统 shell，然后补建/同步会话（重载时拉历史输出，避免黑屏）
      try {
        const probe = await client.terminalList();
        if (disposed) return;
        setBackend(probe.backendKind);
        backendRef.current = probe.backendKind;
        setShells(probe.shells ?? []);
        setDefaultShell(probe.defaultShell ?? null);
        defaultShellRef.current = probe.defaultShell ?? null;

        // pipe 后端没有 TTY，交互 shell 没法用（无回显/无行编辑），
        // 降级成「输入一行跑一条命令」，不给用户开一个看不见的 shell。
        if (probe.backendKind === "pipe") {
          term.write(
            `\x1b[90m Lectern 终端（管道模式）：无 PTY，交互 shell 不可用，每行回车即执行一条命令\x1b[0m\r\n\x1b[32m$\x1b[0m `,
          );
          startPoll();
          return;
        }

        const live = probe.sessions.filter((e) => e.status === "running");
        if (live.length === 0) {
          await newSession();
        } else {
          // 并行回放历史：每个会话从 cursor=0 拉一遍把 buffer 填上，再激活首个
          const mirrored: Sess[] = await Promise.all(
            live.map(async (e) => {
              const label = e.name?.trim() || probe.defaultShell?.label || "shell";
              try {
                const c = await client.terminalRead(e.id, 0);
                return {
                  id: e.id,
                  name: label,
                  shell: label,
                  status: "running" as const,
                  buffer: c.output,
                  cursor: c.cursor,
                };
              } catch {
                return {
                  id: e.id,
                  name: label,
                  shell: label,
                  status: "running" as const,
                  buffer: "",
                  cursor: 0,
                };
              }
            }),
          );
          if (disposed) return;
          // 同名会话按出现顺序编号（zsh 1 / zsh 2），否则重载回来全叫 zsh
          const seen = new Map<string, number>();
          const numbered = mirrored.map((m) => {
            const n = (seen.get(m.shell) ?? 0) + 1;
            seen.set(m.shell, n);
            return { ...m, name: `${m.shell} ${n}` };
          });
          setSessions(numbered);
          setActiveId(numbered[0]?.id ?? null);
          // 立刻把首个会话的 buffer 写到 xterm（switchSession 只处理非激活态变更）
          if (numbered[0]?.buffer) term.write(numbered[0]?.buffer);
        }
      } catch {
        term.write("\x1b[31m[终端服务不可达]\x1b[0m\r\n");
        return;
      }

      startPoll();
    })();
    return () => {
      disposed = true;
      obsRef.current?.disconnect();
      // 卸载时关闭所有仍在运行的会话，避免孤儿 zsh
      for (const s of sessionsRef.current) {
        if (s.status === "running") void client.terminalKill(s.id).catch(() => undefined);
      }
      stopPoll();
      termRef.current?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSess = sessions.find((s) => s.id === activeId) ?? null;
  const runningCount = sessions.filter((s) => s.status === "running").length;

  const iconBtn =
    "flex h-6 w-6 items-center justify-center rounded-sm text-[#cccccc]/60 transition-colors hover:bg-white/10 hover:text-[#cccccc]";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#1d1d1d]">
      {/* 头：左侧计数与新增；右侧清屏/重启 */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-white/10 px-2 text-[#cccccc]">
        <span className="text-[0.6875rem] font-medium">{sessions.length} 个终端</span>
        {backend === "pty" && (
          <div className="relative flex items-center">
            <button
              type="button"
              title={`新建终端（${defaultShell?.label ?? "系统 shell"}）`}
              onClick={() => void newSession()}
              className={iconBtn}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
            </button>
            {shells.length > 1 && (
              <button
                type="button"
                title="选择要启动的 shell"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-6 w-4 items-center justify-center rounded-sm text-[#cccccc]/60 transition-colors hover:bg-white/10 hover:text-[#cccccc]"
              >
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 6l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 min-w-52 overflow-hidden rounded-md border border-white/10 bg-[#252526] py-1 shadow-lg">
                  <div className="px-2.5 py-1 text-[0.625rem] uppercase tracking-wide text-[#cccccc]/40">
                    选择 shell
                  </div>
                  {shells.map((sh, i) => (
                    <button
                      key={sh.file}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void newSession(sh.file);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.6875rem] text-[#cccccc] transition-colors hover:bg-white/10"
                    >
                      <span className="font-medium">{sh.label}</span>
                      {i === 0 && (
                        <span className="rounded-pill bg-white/10 px-1.5 py-px text-[0.5625rem] text-[#cccccc]/70">
                          默认
                        </span>
                      )}
                      <span className="flex-1" />
                      <span className="max-w-32 truncate text-[0.625rem] text-[#cccccc]/40">{sh.file}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {backend === "pipe" && (
          <span className="text-[0.625rem] text-[#cccccc]/40">管道模式</span>
        )}
        {activeSess && (
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              activeSess.status === "running" ? "bg-[#0dbc79]" : "bg-[#666]",
            )}
            title={activeSess.status}
          />
        )}
        <span className="flex-1" />
        <button type="button" title="清屏" onClick={() => termRef.current?.clear()} className={iconBtn}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 4.5h12M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M4 4.5l.7 8a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" title="重启当前终端" onClick={() => void (async () => {
          if (!activeSess) return;
          await killSession(activeSess.id);
          await newSession();
        })()} className={iconBtn}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Tab 行：每个会话一个 chip；激活态高亮 */}
      {sessions.length > 0 && (
        <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 px-1">
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => switchSession(s.id)}
                className={cn(
                  "group inline-flex shrink-0 items-center gap-1.5 rounded-t-sm px-2 py-1 text-[0.6875rem] transition-colors",
                  isActive
                    ? "bg-white/10 text-[#e7e7e7]"
                    : "text-[#cccccc]/60 hover:bg-white/5 hover:text-[#cccccc]",
                )}
                title={s.shellFile ? `${s.name} · ${s.shellFile}` : s.id}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    s.status === "running" ? "bg-[#0dbc79]" : "bg-[#666]",
                  )}
                />
                {/* 终端图标 */}
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.2" />
                  <path d="M4 6l2.5 2L4 10M8 10.5h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="max-w-28 truncate">{s.name}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  title="关闭"
                  onClick={(e) => {
                    e.stopPropagation();
                    void killSession(s.id);
                  }}
                  className="hidden shrink-0 text-[#cccccc]/60 hover:text-danger group-hover:block"
                >
                  ✕
                </span>
              </button>
            );
          })}
          {runningCount === 0 && sessions.length > 0 && (
            <span className="ml-2 text-[0.625rem] text-[#cccccc]/40">所有会话已退出</span>
          )}
        </div>
      )}

      {/* xterm 挂载点 */}
      <div ref={containerRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  );
}