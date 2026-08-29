"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar, navItemClass } from "@zmzai/theme";

import CommandPalette, { type Command } from "@/components/CommandPalette";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import SessionList from "@/components/SessionList";
import ChatView from "@/components/ChatView";
import WorkbenchPanel from "@/components/WorkbenchPanel";
import AccountBlock from "@/components/AccountBlock";
import { client } from "@/lib/client";
import type { SessionInfo, HarnessEvent, PermissionRequest, TranscriptMessage, AuthStatus, ModelRef, ThinkingEffort } from "@/lib/types";

/** 把引擎持久化的转录（MessageWithParts[]）转换成 ChatView 已支持的
 *  message.updated + message.part.updated 事件流，从而跨会话恢复历史。 */
function transcriptToEvents(messages: TranscriptMessage[]): HarnessEvent[] {
  const out: HarnessEvent[] = [];
  for (const m of messages) {
    out.push({ type: "message.updated", data: { message: { id: m.info.id, role: m.info.role, ...(m.info.error ? { error: m.info.error } : {}) } } });
    for (const p of m.parts) {
      out.push({ type: "message.part.updated", data: { part: p } });
    }
  }
  return out;
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "运行中";
    case "waiting_permission":
      return "等待授权";
    case "waiting_input":
      return "等待输入";
    default:
      return "空闲";
  }
}

/** 把最新回调同步进 ref 桥（避免命令面板捕获旧闭包）。 */
function PaletteBridge({ bridge, action }: { bridge: React.RefObject<{ newSession: () => void }>; action: () => void }) {
  useEffect(() => {
    bridge.current = { newSession: action };
  }, [bridge, action]);
  return null;
}

export default function App() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 侧栏已去代理分组：会话固定用 default agent，模型选择交给底部 Composer（默认推荐）
  const activeAgent = "default";
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  // 乐观回显：send 时暂存本条用户消息，切会话后作废
  const [echo, setEcho] = useState<{ text: string; images: { url: string; mediaType: string }[] } | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [pending, setPending] = useState<PermissionRequest | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null);
  // P1-10 文件联动：消息路径点击 / ⌘P 快开 → 产物侧文件 Tab（ts 保证重复触发同一文件也生效）
  const [openFileReq, setOpenFileReq] = useState<{ path: string; ts: number } | null>(null);
  // P1-7 自治档位：自动 = 授权请求自动「始终允许」
  const [autoMode, setAutoMode] = useState(false);
  // P2-12 命令面板
  const [palette, setPalette] = useState<"commands" | "files" | null>(null);
  const paletteActionsRef = useRef<{ newSession: () => void }>({ newSession: () => undefined });
  // 左侧栏收起/展开（Qoder 同款，持久化）
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    void client.authStatus().then(setAuth);
  }, []);

  // 自治档位持久化（localStorage，纯前端语义）
  useEffect(() => {
    setAutoMode(window.localStorage.getItem("harness.autoMode") === "1");
    setSidebarOpen(window.localStorage.getItem("harness.sidebar") !== "0");
  }, []);
  const toggleAuto = useCallback(() => {
    setAutoMode((v) => {
      window.localStorage.setItem("harness.autoMode", v ? "0" : "1");
      return !v;
    });
  }, []);

  // P2-12 全局快捷键：⌘K 命令 / ⌘P 文件（输入类元素聚焦时不抢）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "k" && key !== "p") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      setPalette(key === "k" ? "commands" : "files");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    void client.listSessions().then(setSessions);
  }, [auth?.loggedIn]);

  useEffect(() => {
    if (!activeId) {
      setEvents([]);
      setStatus("idle");
      setPending(null);
      setEcho(null);
      return;
    }
    let cancelled = false;
    // 历史恢复与实时流的竞态防护：订阅先建立（不丢事件），转录异步载入期间
    // 实时事件先进 buffer；转录渲染完成后再合并——顺序仍是 历史→实时。
    let historyLoaded = false;
    const liveBuffer: HarnessEvent[] = [];
    setEvents([]);
    setStatus("idle");
    setPending(null);
    setEcho(null);
    const unsub = client.subscribe(activeId, (ev) => {
      if (ev.type === "session.status") setStatus((ev.data as { status: string }).status);
      else if (ev.type === "permission.asked") {
        const req = (ev.data as { request: PermissionRequest }).request;
        // P1-7 自动档：直接「始终允许」，不打断工作流
        if (autoMode) {
          void client.replyPermission(activeId, req.id, "always").catch(() => undefined);
        } else {
          setPending(req);
        }
      } else if (ev.type === "permission.replied") setPending(null);
      if (!historyLoaded) liveBuffer.push(ev);
      else setEvents((prev) => [...prev, ev]);
    });
    // 跨会话恢复：载入该会话已持久化的历史转录，渲染成消息树
    client.getMessages(activeId).then((msgs) => {
      if (cancelled) return;
      setEvents(transcriptToEvents(msgs));
      historyLoaded = true;
      if (liveBuffer.length) setEvents((prev) => [...prev, ...liveBuffer]);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeId, autoMode]);

  // P2-14 任务完成通知：running → idle 且窗口不在前台时系统通知 + 标题标记
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === "running" && status === "idle") {
      document.title = "✓ 任务完成 — ZMZAI harness";
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("ZMZAI harness", { body: "任务已完成，回来看看结果" });
      }
    } else if (status === "running") {
      document.title = "ZMZAI harness";
    }
  }, [status]);

  // P2-15 多会话并行状态：10s 轮询刷新运行态点
  useEffect(() => {
    const timer = setInterval(() => {
      void client.listSessions().then(setSessions).catch(() => undefined);
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  const newSession = useCallback(async () => {
    if (!auth?.loggedIn) return;
    const s = await client.createSession(activeAgent);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  }, [activeAgent, auth?.loggedIn]);

  // 全局快捷键：⌘/Ctrl+N 新建会话（侧栏主按钮同款提示）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newSession]);

  const send = useCallback(
    async (text: string, images?: { url: string; mediaType: string }[], effort?: ThinkingEffort) => {
      if (!text.trim() && !images?.length) return;
      // 无会话时自动建（composer 不再强制先选会话）
      let sid = activeId;
      if (!sid) {
        if (!auth?.loggedIn) return;
        const s = await client.createSession(activeAgent);
        setSessions((prev) => [s, ...prev]);
        setActiveId(s.id);
        sid = s.id;
      }
      // 乐观回显：发送瞬间显示用户气泡，真实 message.updated 到达后自动让位
      setEcho({ text, images: images ?? [] });
      // P1-9 任务前自动快照（git 仓库且有变更时才落 commit；失败不阻塞发送）
      void client.checkpointCreate(`任务前快照 · ${text.trim().slice(0, 30) || "图片任务"}`).catch(() => undefined);
      // per-prompt 模型/推理力度覆盖：composer 选了则随本条消息下发，否则跟随代理默认
      try {
        await client.prompt(sid, text, activeAgent, selectedModel ?? undefined, images, effort);
      } catch {
        setEcho(null); // 发送失败：撤回乐观气泡，错误经其它途径提示
      }
      // prompt 可能排队返回，刷新标题等元数据
      void client.listSessions().then(setSessions);
    },
    [activeId, activeAgent, auth?.loggedIn, selectedModel],
  );

  const reply = useCallback(
    async (r: "once" | "always" | "reject", feedback?: string) => {
      if (!activeId || !pending) return;
      await client.replyPermission(activeId, pending.id, r, feedback);
      setPending(null);
    },
    [activeId, pending],
  );

  const abort = useCallback(() => {
    if (activeId) void client.abort(activeId);
  }, [activeId]);

  const renameSession = useCallback(async (id: string, title: string) => {
    await client.renameSession(id, title);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    await client.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  // P2-12 命令面板命令表
  const commands: Command[] = [
    { id: "new-session", label: "新建会话", hint: "⌘N 不支持时用这里", run: () => paletteActionsRef.current.newSession() },
    { id: "open-files", label: "搜索文件…", hint: "⌘P", run: () => setPalette("files") },
    { id: "toggle-auto", label: autoMode ? "切到确认档（逐次授权）" : "切到自动档（自动授权）", hint: "档位", run: toggleAuto },
    { id: "open-settings", label: "打开设置", hint: "个人 key / relay / MCP / 插件", run: () => router.push("/settings") },
  ];

  // 模型标签：选中（含 Composer 默认推荐）展示之，否则 fallback
  const modelLabel = selectedModel
    ? `${selectedModel.providerId}/${selectedModel.modelId}`
    : "默认模型";

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      {/* 品牌顶栏：全域统一 Navbar + 主题/设置/登录/新建会话 */}
      <Navbar
        sublabel="harness"
        className="h-12"
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                setSidebarOpen((v) => {
                  window.localStorage.setItem("harness.sidebar", v ? "0" : "1");
                  return !v;
                })
              }
              title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                <path d="M6 2.5v11" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => router.push("/settings")}
              title="设置（个人 key / relay / MCP / 插件）"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="8" cy="8" r="2.2" />
                <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" strokeLinecap="round" />
              </svg>
            </button>
          </>
        }
      >
        <span className={navItemClass(false)}>工作台</span>
      </Navbar>
      {/* 命令面板的「新建会话」需要拿最新 newSession */}
      <PaletteBridge bridge={paletteActionsRef} action={newSession} />

      {/* 主体：项目/会话侧栏 + 对话 + 产物侧工作台（审查/文件/画布/终端） */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
        <SessionList
          top={<ProjectSwitcher />}
          bottom={<AccountBlock />}
          sessions={sessions}
          activeId={activeId}
          onNewSession={() => void newSession()}
          canCreate={!!auth?.loggedIn}
          onSelectSession={setActiveId}
          onRenameSession={(id, title) => void renameSession(id, title)}
          onDeleteSession={(id) => void deleteSession(id)}
        />
        )}
        <ChatView
          events={events}
          status={status}
          pending={pending}
          sessionId={activeId}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          onSend={send}
          onReply={reply}
          onAbort={abort}
          onOpenFile={(path) => setOpenFileReq({ path, ts: Date.now() })}
          autoMode={autoMode}
          onToggleAuto={toggleAuto}
          echo={echo}
        />
        <div className="hidden w-96 shrink-0 min-[1180px]:block">
          <WorkbenchPanel openRequest={openFileReq} />
        </div>
      </div>

      {/* P2-12 命令面板（⌘K 命令 / ⌘P 文件快开） */}
      {palette && (
        <CommandPalette
          mode={palette}
          commands={commands}
          onOpenFile={(path) => setOpenFileReq({ path, ts: Date.now() })}
          onClose={() => setPalette(null)}
        />
      )}

      {/* 底部状态栏：低调一行 */}
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-surface px-4 text-[0.6875rem] text-ink-3">
        <span className={`h-1.5 w-1.5 rounded-full ${status === "running" ? "animate-pulse bg-accent-strong" : "bg-ink-3"}`} />
        <span>{statusLabel(status)}</span>
        <span className="text-line-strong">·</span>
        <span className="font-mono">
          model: {modelLabel}
          {selectedModel ? "（本会话消息覆盖）" : ""}
        </span>
      </footer>
    </div>
  );
}
