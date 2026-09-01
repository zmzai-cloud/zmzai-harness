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
import { client, type ConnectionState } from "@/lib/client";
import { ChatProjector, EMPTY_CHAT_VIEW, transcriptToEvents, type ChatViewData } from "@/lib/chat-projector";
import { readPref, writePref, clearPref } from "@/lib/prefs";
import type { SessionInfo, SessionListItem, PermissionRequest, PermissionSettings, LecternEvent, ModelRef, ThinkingEffort, AuthStatus, SessionIsolation, Project } from "@/lib/types";
import { PERMISSION_DOMAIN_OF } from "@/lib/types";

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
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 跨项目会话列表（P1）：当前项目条目（点击归属其它项目的会话 → 切项目 + 恢复会话）
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  // 侧栏已去代理分组：会话固定用 default agent，模型选择交给底部 Composer（默认推荐）
  const activeAgent = "default";
  // 消息流投影：事件不再累积进 state（无限增长 + 每 delta 全量重投影 O(n²)），
  // 改为增量折叠进 ChatProjector，rAF 批量取快照渲染（lib/chat-projector.ts）
  const projectorRef = useRef<ChatProjector | null>(null);
  const rafRef = useRef<number | null>(null);
  const [chatData, setChatData] = useState<ChatViewData>(EMPTY_CHAT_VIEW);
  // 乐观回显：send 时暂存本条用户消息，切会话后作废
  const [echo, setEcho] = useState<{ text: string; images: { url: string; mediaType: string }[] } | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [pending, setPending] = useState<PermissionRequest | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  // SSE 连接状态（断线自动重连；offline 时 UI 出手动重试）
  const [connState, setConnState] = useState<ConnectionState>("connected");
  const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null);
  // P1-10/F2 文件联动：消息路径点击（可带行号）/ ⌘P 快开 → 产物侧文件 Tab（ts 保证重复触发也生效）
  const [openFileReq, setOpenFileReq] = useState<{ path: string; ts: number; line?: number } | null>(null);
  // P1-7 自治档位：自动 = 授权请求自动「始终允许」
  const [autoMode, setAutoMode] = useState(false);
  // 设置 → 通用 → 权限：细粒度自动执行配置（terminal/edit/task/gitWrite）。
  // ref 镜像：SSE 订阅闭包读最新值，配置变更不重订阅。
  const [permAuto, setPermAuto] = useState<PermissionSettings>({});
  const permAutoRef = useRef<PermissionSettings>({});
  // P2-12 命令面板
  const [palette, setPalette] = useState<"commands" | "files" | "search" | null>(null);
  const paletteActionsRef = useRef<{ newSession: () => void }>({ newSession: () => undefined });
  // 左侧栏收起/展开（Qoder 同款，持久化）
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 会话级 worktree 隔离（robustness-plan §9）：新建会话默认勾选「隔离副本」（持久化）
  const [isolateNew, setIsolateNew] = useState(false);
  // active 会话的隔离状态（切换会话时按服务端为准查询）+ 操作结果横幅
  const [activeIsolation, setActiveIsolation] = useState<SessionIsolation | null>(null);
  const [wtNotice, setWtNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const toggleIsolateNew = useCallback(() => {
    setIsolateNew((v) => {
      writePref("isolateNew", v ? "0" : "1");
      return !v;
    });
  }, []);

  // 隔离操作横幅自动消退（8s）
  useEffect(() => {
    if (!wtNotice) return;
    const t = setTimeout(() => setWtNotice(null), 8000);
    return () => clearTimeout(t);
  }, [wtNotice]);

  useEffect(() => {
    void client.authStatus().then(setAuth);
    void client.listProjects().then((s) => setActiveProject(s.active)).catch(() => undefined);
  }, []);

  // 投影快照的 rAF 批处理：同一帧内任意多条事件只触发一次渲染
  const flushProjection = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setChatData(projectorRef.current?.data() ?? EMPTY_CHAT_VIEW);
    });
  }, []);
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  // 自治档位持久化（localStorage，纯前端语义）+ 权限自动执行配置（settings.json）
  useEffect(() => {
    setAutoMode(readPref("autoMode") === "1");
    setSidebarOpen(readPref("sidebar") !== "0");
    setIsolateNew(readPref("isolateNew") === "1");    void client.permissionsGet().then((permissions) => {
      setPermAuto(permissions);
      permAutoRef.current = permissions;
    }).catch(() => undefined);
  }, []);
  const toggleAuto = useCallback(() => {
    setAutoMode((v) => {
      writePref("autoMode", v ? "0" : "1");
      return !v;
    });
  }, []);

  // P2-12 全局快捷键：⌘K 命令 / ⌘P 文件 / ⌘⇧F 全文搜索（输入类元素聚焦时不抢）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "k" && key !== "p" && !(key === "f" && e.shiftKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      setPalette(key === "k" ? "commands" : key === "p" ? "files" : "search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    void client.listSessions(true).then(setSessions);
  }, [auth?.loggedIn]);

  // P1 会话稳定性：boot 恢复。pendingSession（跨项目跳转目标，switchProject+reload
  // 前写入）优先——无条件恢复；否则恢复 lastSession（上次活跃会话，仅当前项目
  // 库里存在时才恢复，防止项目切换后指向失效 id）。
  const bootRestoredRef = useRef(false);
  useEffect(() => {
    if (bootRestoredRef.current || !auth?.loggedIn) return;
    // 会话列表至少拉到一版再做恢复判断（空列表 = 真没有会话，不再等）
    if (sessions.length === 0) {
      bootRestoredRef.current = true;
      return;
    }
    bootRestoredRef.current = true;
    const pending = readPref("pendingSession");
    clearPref("pendingSession");
    const last = readPref("lastSession");
    if (pending) setActiveId(pending);
    else if (last && sessions.some((s) => s.id === last)) setActiveId(last);
  }, [auth?.loggedIn, sessions]);

  // lastSession 持久化：活跃会话变化即写（下次启动自动回到上次会话）
  useEffect(() => {
    if (activeId) writePref("lastSession", activeId);
  }, [activeId]);

  // 会话选择（P1 跨项目）：归属其它项目的会话 → switchProject（全站跟随语义）
  // + pendingSession 暂存目标 + reload 后由上面的 boot 恢复逻辑选中。
  const selectSession = useCallback(
    (id: string) => {
      if (id === activeId) return;
      const target = sessions.find((s) => s.id === id);
      const targetProject = target?.projectId ?? activeProject?.id ?? "default";
      if (activeProject && targetProject !== activeProject.id) {
        writePref("pendingSession", id);
        void client
          .switchProject(targetProject)
          .then(() => window.location.reload())
          .catch(() => clearPref("pendingSession"));
        return;
      }
      setActiveId(id);
    },
    [activeId, activeProject, sessions],
  );

  useEffect(() => {
    const projector = projectorRef.current ?? (projectorRef.current = new ChatProjector());
    if (!activeId) {
      projector.reset();
      setChatData(EMPTY_CHAT_VIEW);
      setStatus("idle");
      setPending(null);
      setEcho(null);
      setConnState("connected");
      return;
    }
    let cancelled = false;
    // 历史恢复与实时流的竞态防护（语义与旧 events 数组版一致）：
    // 订阅先建立（不丢事件），转录异步载入期间实时事件进 buffer；
    // 转录 ingest 完成后再合并 buffer——投影顺序仍是 历史→实时。
    let historyLoaded = false;
    const liveBuffer: LecternEvent[] = [];
    projector.reset();
    setChatData(EMPTY_CHAT_VIEW);
    setStatus("idle");
    setPending(null);
    setEcho(null);
    setConnState("connected");
    setActiveIsolation(null);
    setWtNotice(null);
    // 隔离副本状态以服务端为准（worktree 映射在 worktrees.db）
    client.worktreeStatus(activeId).then((st) => !cancelled && setActiveIsolation(st)).catch(() => undefined);
    const unsub = client.subscribe(activeId, (ev) => {
      if (ev.type === "session.status") setStatus((ev.data as { status: string }).status);
      else if (ev.type === "permission.asked") {
        const req = (ev.data as { request: PermissionRequest }).request;
        // P1-7 自动档：全部「始终允许」；细粒度权限（设置 → 通用）：命中的域自动「始终允许」
        const domain = PERMISSION_DOMAIN_OF[req.permission];
        const autoHit = autoMode || (domain && permAutoRef.current[domain] === "auto");
        if (autoHit) {
          void client
            .replyPermission(activeId, req.id, "always", undefined, {
              source: autoMode ? "auto" : "fine-grained",
              permission: req.permission,
              summary: req.metadata?.summary ?? req.metadata?.command ?? req.metadata?.filePath ?? "",
            })
            .catch(() => undefined);
        } else {
          setPending(req);
        }
      } else if (ev.type === "permission.replied") setPending(null);
      if (!historyLoaded) liveBuffer.push(ev);
      else {
        projector.ingest(ev);
        flushProjection();
      }
    }, setConnState);
    // 跨会话恢复：尾部分页拉取转录（首屏 50 条），逐条折叠进投影器
    client.getMessagesPage(activeId, 0).then((page) => {
      if (cancelled) return;
      loadedCountRef.current = page.messages.length;
      for (const ev of transcriptToEvents(page.messages)) projector.ingest(ev);
      historyLoaded = true;
      for (const ev of liveBuffer) projector.ingest(ev);
      setHasMore(page.hasMore);
      flushProjection();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeId, autoMode, flushProjection]);

  // 触顶加载更早历史：prepend 进投影器（不破坏已折叠的实时事件），视口锚定在 ChatView。
  // 投影按消息 id 幂等 upsert，SSE 重连的重放事件天然去重，无需额外标记。
  const [hasMore, setHasMore] = useState(false);
  const loadedCountRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const loadOlder = useCallback(async () => {
    const sid = activeId;
    if (!sid || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    try {
      const page = await client.getMessagesPage(sid, loadedCountRef.current);
      if (!page.messages.length) {
        setHasMore(false);
        return;
      }
      loadedCountRef.current += page.messages.length;
      projectorRef.current?.ingestBatch(transcriptToEvents(page.messages), true);
      setHasMore(page.hasMore);
      flushProjection();
    } catch {
      /* 拉取失败静默，下次触顶重试 */
    } finally {
      loadingOlderRef.current = false;
    }
  }, [activeId, flushProjection]);

  // P2-14 任务完成通知：running → idle 且窗口不在前台时系统通知 + 标题标记。
  // Electron 下优先走主进程 Notification（未聚焦更可靠），Web 走 Web Notification。
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === "running" && status === "idle") {
      document.title = "✓ 任务完成 — Lectern";
      const bridge = window.lecternNative;
      if (document.hidden && bridge?.notifyTaskDone) {
        bridge.notifyTaskDone();
      } else if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("Lectern", { body: "任务已完成，回来看看结果" });
      }
    } else if (status === "running") {
      document.title = "Lectern";
    }
  }, [status]);

  // P2-15 多会话并行状态：轮询刷新运行态点（兜底——运行态主链路是 SSE
  // session.status）。前台 10s，页面隐藏降到 60s 省电省请求。
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => {
        void client.listSessions(true).then(setSessions).catch(() => undefined);
      }, document.hidden ? 60_000 : 10_000);
    };
    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(timer);
    };
  }, []);

  const newSession = useCallback(async () => {
    if (!auth?.loggedIn) return;
    const s = await client.createSession(activeAgent, undefined, isolateNew);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setActiveIsolation(s.isolation ? { ...s.isolation } : { enabled: false });
    if (s.isolation && !s.isolation.enabled && s.isolation.reason) {
      setWtNotice({ kind: "error", text: "隔离副本未启用（当前项目不是 git 仓库），本次会话直接在主工作区进行。" });
    }
  }, [activeAgent, auth?.loggedIn, isolateNew]);

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
        const s = await client.createSession(activeAgent, undefined, isolateNew);
        setSessions((prev) => [s, ...prev]);
        setActiveId(s.id);
        setActiveIsolation(s.isolation ?? { enabled: false });
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
      // prompt 可能排队返回，刷新标题等元数据；AI 摘要标题异步落库，延迟再刷一次
      void client.listSessions(true).then(setSessions);
      setTimeout(() => void client.listSessions(true).then(setSessions), 4000);
    },
    [activeId, activeAgent, auth?.loggedIn, selectedModel, isolateNew],
  );

  // worktree 隔离副本操作：合并回主工作区 / 丢弃副本（结果用横幅提示，冲突给引导）
  const handleWorktreeAction = useCallback(
    async (action: "merge" | "discard") => {
      if (!activeId) return;
      if (action === "merge" && !window.confirm("把隔离副本的提交合并回主工作区当前分支？合并成功后副本将删除。")) return;
      if (action === "discard" && !window.confirm("丢弃隔离副本？未合并的提交将一并删除，不可恢复。")) return;
      try {
        const result = await client.worktreeAction(activeId, action);
        if (result.ok) {
          setActiveIsolation({ enabled: false });
          setWtNotice({ kind: "ok", text: action === "merge" ? "已合并回主工作区，隔离副本已清理。" : "隔离副本已丢弃。" });
        } else {
          setWtNotice({ kind: "error", text: result.output ?? result.error ?? "操作失败" });
        }
      } catch (err) {
        setWtNotice({ kind: "error", text: err instanceof Error ? err.message : "操作失败" });
      }
    },
    [activeId],
  );

  const reply = useCallback(
    async (r: "once" | "always" | "reject", feedback?: string) => {
      if (!activeId || !pending) return;
      await client.replyPermission(activeId, pending.id, r, feedback, {
        source: "manual",
        permission: pending.permission,
        summary: pending.metadata?.summary ?? pending.metadata?.command ?? pending.metadata?.filePath ?? "",
      });
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
    { id: "search-sessions", label: "搜索会话内容…", hint: "⌘⇧F", run: () => setPalette("search") },
    { id: "toggle-auto", label: autoMode ? "切到确认档（逐次授权）" : "切到自动档（自动授权）", hint: "档位", run: toggleAuto },
    { id: "open-settings", label: "打开设置", hint: "个人 key / relay / MCP / 插件", run: () => router.push("/settings") },
  ];

  // 模型标签：选中（含 Composer 默认推荐）展示之，否则 fallback
  const modelLabel = selectedModel
    ? `${selectedModel.providerId}/${selectedModel.modelId}`
    : "默认模型";

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      {/* 品牌顶栏：全域统一 Navbar + 侧栏开关（主题 / 设置入口在左下角账户块菜单） */}
      <Navbar
        sublabel="lectern"
        className="h-12"
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                setSidebarOpen((v) => {
                  writePref("sidebar", v ? "0" : "1");
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
          isolateNew={isolateNew}
          onToggleIsolateNew={toggleIsolateNew}
          onSelectSession={selectSession}
          activeProjectId={activeProject?.id}
          onRenameSession={(id, title) => void renameSession(id, title)}
          onDeleteSession={(id) => void deleteSession(id)}
        />
        )}
        <ChatView
          data={chatData}
          hasMore={hasMore}
          onLoadMore={() => void loadOlder()}
          status={status}
          pending={pending}
          sessionId={activeId}
          connState={connState}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          onSend={send}
          onReply={reply}
          onAbort={abort}
          onOpenFile={(path, line) => setOpenFileReq({ path, ts: Date.now(), line })}
          autoMode={autoMode}
          onToggleAuto={toggleAuto}
          echo={echo}
          isolation={activeIsolation}
          onWorktreeAction={handleWorktreeAction}
          wtNotice={wtNotice}
        />
        <div className="hidden w-96 shrink-0 min-[1180px]:block">
          <WorkbenchPanel openRequest={openFileReq} editedPaths={chatData.editedPaths} />
        </div>
      </div>

      {/* P2-12 命令面板（⌘K 命令 / ⌘P 文件快开 / ⌘⇧F 全文搜索） */}
      {palette && (
        <CommandPalette
          mode={palette}
          commands={commands}
          onOpenFile={(path, line) => setOpenFileReq({ path, ts: Date.now(), line })}
          onSelectSession={selectSession}
          onClose={() => setPalette(null)}
        />
      )}

      {/* 底部状态栏：低调一行 */}
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-surface px-4 text-[0.6875rem] text-ink-3">
        <span className={`h-1.5 w-1.5 rounded-full ${status === "running" ? "animate-pulse bg-live" : "bg-ink-3"}`} />
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
