"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Textarea, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { ModelRef, ModelsState, SkillOption, ThinkingEffort, UsageInfo } from "@/lib/types";

/** token 数缩写：1234 → 1.2k */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

type ModelChoice = { id: string; name: string; channel: string; maxInputTokens?: number; routable: boolean };

type FileHit = { path: string; type: "dir" | "file" };

/** 解析光标前的 @ 引用："@quer" → "quer"；不在 @ 引用中返回 null。 */
function parseAtQuery(value: string, caret: number): string | null {
  const m = value.slice(0, caret).match(/(^|\s)@([^\s@]*)$/);
  return m ? m[2] : null;
}

type Props = {
  sessionId: string | null;
  running: boolean;
  selectedModel: ModelRef | null;
  onSelectModel: (m: ModelRef | null) => void;
  onSend: (text: string, images?: { url: string; mediaType: string }[], effort?: ThinkingEffort) => void;
  onAbort: () => void;
  /** 外部回填草稿（用户消息「编辑重发」）；消费后回调清空。 */
  draft: string | null;
  onDraftConsumed: () => void;
};

/**
 * 底部 Composer：输入区 + 能力条（模型选择 / Skill 注入 / 推理力度 / 上下文用量与压缩）。
 * 模型为 per-prompt 覆盖（framework runner.prompt 的 model 参数）；Skill 选中后把
 * SKILL.md 的 markdown 随本次 prompt 注入（与 framework PluginSkill 同源约定）；
 * 推理力度随本次 prompt 下发（relay reasoning_effort，framework thinkingLevel）。
 */
export default function Composer({ sessionId, running, selectedModel, onSelectModel, onSend, onAbort, draft, onDraftConsumed }: Props) {
  const [text, setText] = useState("");
  const [models, setModels] = useState<ModelsState | null>(null);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skill, setSkill] = useState<SkillOption | null>(null);
  const [popup, setPopup] = useState<"model" | "skill" | "effort" | null>(null);
  // 推理力度（N3）：off = 不发字段（默认，对所有模型安全）
  const [effort, setEffort] = useState<ThinkingEffort>("off");
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [compacting, setCompacting] = useState(false);
  // 图片附件（P2-11）：data URL 随 prompt 下发，framework 多模态输入；
  // imgNotice：选图/粘贴被拒的短暂提示（超限、非图片）
  const [images, setImages] = useState<{ url: string; mediaType: string; name: string }[]>([]);
  const [imgNotice, setImgNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // @ 文件引用：atQuery 非 null 表示浮层打开，值为 @ 后的过滤串
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [atItems, setAtItems] = useState<FileHit[]>([]);
  const [atIndex, setAtIndex] = useState(0);

  // 模型目录与技能列表（会话无关，进页面拉一次）
  useEffect(() => {
    void client.listModels().then(setModels).catch(() => undefined);
    void client.listSkills().then((r) => setSkills(r.skills)).catch(() => undefined);
  }, []);

  // 编辑重发：草稿回填并聚焦
  useEffect(() => {
    if (draft == null) return;
    setText(draft);
    onDraftConsumed();
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(draft.length, draft.length);
    }
  }, [draft, onDraftConsumed]);

  // @ 引用：按已输入路径懒加载目录，按最后一段过滤
  useEffect(() => {
    if (atQuery == null) return;
    const slash = atQuery.lastIndexOf("/");
    const dir = slash >= 0 ? atQuery.slice(0, slash) : "";
    const base = slash >= 0 ? atQuery.slice(slash + 1).toLowerCase() : atQuery.toLowerCase();
    let disposed = false;
    void client
      .fsTree(dir)
      .then((r) => {
        if (disposed) return;
        const hits = r.nodes
          .filter((n) => !base || n.name.toLowerCase().includes(base))
          .slice(0, 8)
          .map((n) => ({ path: dir ? `${dir}/${n.name}` : n.name, type: n.type }));
        setAtItems(hits);
        setAtIndex(0);
      })
      .catch(() => setAtItems([]));
    return () => {
      disposed = true;
    };
  }, [atQuery]);

  // 上下文用量轮询：空闲 6s、运行中 2.5s
  useEffect(() => {
    if (!sessionId) {
      setUsage(null);
      return;
    }
    let disposed = false;
    const tick = () => {
      if (disposed) return;
      void client.usage(sessionId).then((u) => !disposed && setUsage(u)).catch(() => undefined);
    };
    tick();
    const period = running ? 2500 : 6000;
    const timer = setInterval(tick, period);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [sessionId, running]);

  // 弹层点击外部关闭
  useEffect(() => {
    if (!popup) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPopup(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popup]);

  // 模型维度平铺：relay /v1/models 已按调用者身份过滤
  // （个人 key → allowedModels 子集；登录会话 → 全部），直接用它而非渠道分组视图
  const modelChoices = useMemo<ModelChoice[]>(() => {
    const seen = new Set<string>();
    const out: ModelChoice[] = [];
    for (const m of models?.models ?? []) {
      if (!m.model || seen.has(m.model)) continue;
      seen.add(m.model);
      const ch = m.availableChannels ?? 0;
      out.push({
        id: m.model,
        name: m.model,
        channel: ch > 0 ? `${ch} 渠道` : "无可用渠道",
        maxInputTokens: m.maxInputTokens,
        routable: ch > 0,
      });
    }
    return out;
  }, [models]);

  // 默认推荐模型（需求：侧栏去代理后，底部选择器默认选一个稳定模型）：
  // 优先 deepseek-v4-flash，否则第一个可路由模型；只在用户未手动选择时生效一次。
  const defaultModelApplied = useRef(false);
  useEffect(() => {
    if (defaultModelApplied.current || selectedModel) return;
    const routable = modelChoices.filter((m) => m.routable);
    if (routable.length === 0) return;
    const pick = routable.find((m) => m.id === "deepseek-v4-flash") ?? routable[0]!;
    defaultModelApplied.current = true;
    onSelectModel({ providerId: "openai", modelId: pick.id });
  }, [modelChoices, selectedModel, onSelectModel]);
  // 弹层内搜索过滤（模型可能很多）
  const [modelFilter, setModelFilter] = useState("");
  const shownModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    return q ? modelChoices.filter((m) => m.id.toLowerCase().includes(q)) : modelChoices;
  }, [modelChoices, modelFilter]);

  /** 选中 @ 浮层项：把光标前的 "@过滤串" 替换为完整路径。 */
  const pickAt = useCallback(
    (hit: FileHit) => {
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? text.length;
      const start = caret - (atQuery?.length ?? 0) - 1;
      setText(text.slice(0, start) + `@${hit.path} ` + text.slice(caret));
      setAtQuery(null);
      requestAnimationFrame(() => {
        const pos = start + hit.path.length + 2;
        textareaRef.current?.setSelectionRange(pos, pos);
        textareaRef.current?.focus();
      });
    },
    [text, atQuery],
  );

  const onTextChange = useCallback((value: string, caret: number) => {
    setText(value);
    setAtQuery(parseAtQuery(value, caret));
  }, []);

  /** 已知不支持视觉输入的模型前缀（deepseek 官方 API 对 image content 直接 400，
   *  上游报错/挂起表现为会话「卡住」，发送前拦截）。 */
  const VISION_UNSAFE = /^(deepseek|o3-mini|gpt-4o-mini)/i;
  const currentModelId = selectedModel?.modelId ?? "deepseek-v4-flash";

  const submit = useCallback(() => {
    const body = text.trim();
    // 无会话也可发送（page.send 会自动建会话）
    if (!body && images.length === 0) return;
    if (images.length > 0 && VISION_UNSAFE.test(currentModelId)) {
      setImgNotice(`${currentModelId} 不支持图片输入，请点击底部模型名切换（如 gpt-5.6-*）`);
      return;
    }
    let full = body || "（见附件图片）";
    if (skill) {
      full += `\n\n---\n\n<skill name="${skill.name}">\n${skill.markdown}\n</skill>`;
    }
    // @ 引用的文件收集为上下文提示（agent 有 fs 工具，按路径自行读取）
    const refs = [...body.matchAll(/(^|\s)@([^\s@]+)/g)].map((m) => m[2]);
    if (refs.length > 0) {
      full += `\n\n---\n\n<context-files>\n用户在消息中引用了以下文件，处理前请先读取：\n${[...new Set(refs)].join("\n")}\n</context-files>`;
    }
    onSend(
      full,
      images.map((im) => ({ url: im.url, mediaType: im.mediaType })),
      effort === "off" ? undefined : effort,
    );
    setText("");
    setSkill(null);
    setAtQuery(null);
    setImages([]);
  }, [text, sessionId, skill, onSend, images, effort, currentModelId]);

  /** 本地选图 → data URL（限 4MB/张，最多 4 张）。被拒时给短暂提示（不再静默丢）。 */
  const pickImages = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const list = [...files];
    let skipped = 0;
    for (const file of list.slice(0, 4)) {
      if (!file.type.startsWith("image/")) { skipped += 1; continue; }
      if (file.size > 4 * 1024 * 1024) {
        setImgNotice(`「${file.name}」超过 4MB，未添加`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setImages((prev) =>
          prev.length >= 4 || prev.some((p) => p.url === reader.result)
            ? prev
            : [...prev, { url: String(reader.result), mediaType: file.type, name: file.name }],
        );
      };
      reader.readAsDataURL(file);
    }
    if (skipped > 0) setImgNotice(`${skipped} 个非图片文件未添加`);
  }, []);

  // 粘贴图片：剪贴板里的图片文件直接进附件（与选图同一 4MB/张限制）
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return; // 纯文本粘贴走默认行为
      e.preventDefault();
      pickImages(files);
    },
    [pickImages],
  );

  // 提示自动消失
  useEffect(() => {
    if (!imgNotice) return;
    const t = setTimeout(() => setImgNotice(null), 4000);
    return () => clearTimeout(t);
  }, [imgNotice]);

  const compact = useCallback(async () => {
    if (!sessionId || compacting) return;
    setCompacting(true);
    try {
      await client.compact(sessionId);
      // 压缩完成后立刻刷新用量（摘要落库后下一次 step-finish 才反映，先给个即时反馈）
      await new Promise((r) => setTimeout(r, 800));
      setUsage(await client.usage(sessionId).catch(() => null));
    } finally {
      setCompacting(false);
    }
  }, [sessionId, compacting]);

  const modelLabel = selectedModel?.modelId ?? "默认模型";
  const pct = usage && usage.contextWindow > 0 ? Math.min(100, Math.round((usage.used / usage.contextWindow) * 100)) : 0;
  const pctColor = pct >= 85 ? "bg-danger" : pct >= 60 ? "bg-warning" : "bg-accent-strong";

  return (
    <div ref={rootRef} className="relative shrink-0 px-6 pb-4">
      {/* @ 文件引用浮层 */}
      {atQuery != null && (
        <div className="absolute bottom-full left-1/2 mb-2 max-h-64 w-full max-w-3xl -translate-x-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-2 py-1.5 text-[0.6875rem] font-semibold text-ink-3">引用文件 · @路径</div>
          {atItems.map((hit, i) => (
            <button
              key={hit.path}
              type="button"
              onClick={() => pickAt(hit)}
              onMouseEnter={() => setAtIndex(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
                i === atIndex ? "bg-bg" : "hover:bg-bg",
              )}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-ink-3">
                {hit.type === "dir" ? (
                  <path d="M1.5 4a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" strokeLinejoin="round" />
                ) : (
                  <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2zM9 2v4h4" strokeLinejoin="round" />
                )}
              </svg>
              <span className="truncate font-mono text-xs text-ink">{hit.path}</span>
            </button>
          ))}
          {atItems.length === 0 && (
            <div className="px-2 py-3 text-xs leading-5 text-ink-3">没有匹配的文件或目录。</div>
          )}
          <div className="border-t border-line px-2 pt-1.5 text-[0.625rem] text-ink-3">↑↓ 选择 · ⏎ 确认 · Esc 关闭</div>
        </div>
      )}

      {/* 弹层：模型选择 / Skill 选择（与输入卡片同宽） */}
      {popup === "model" && (
        <div className="absolute bottom-full left-1/2 mb-2 max-h-72 w-full max-w-3xl -translate-x-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[0.6875rem] font-semibold text-ink-3">模型 · 对本条消息生效</span>
            <span className="font-mono text-[0.625rem] text-ink-3">{modelChoices.length} 个可用</span>
          </div>
          {modelChoices.length > 6 && (
            <input
              autoFocus
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="搜索模型…"
              className="mx-1 mb-1 h-6 w-[calc(100%-0.5rem)] rounded-sm bg-surface-2 px-2 text-xs text-ink outline-none placeholder:text-ink-3"
            />
          )}
          <button
            type="button"
            onClick={() => {
              onSelectModel(null);
              setPopup(null);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
              !selectedModel ? "bg-bg" : "hover:bg-bg",
            )}
          >
            <span className="flex-1 truncate text-xs text-ink-2">跟随代理默认模型</span>
            {!selectedModel && <CheckIcon />}
          </button>
          {shownModels.map((m) => {
            const active = selectedModel?.modelId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!m.routable}
                title={m.routable ? undefined : "当前无健康渠道，提交会失败"}
                onClick={() => {
                  onSelectModel({ providerId: "openai", modelId: m.id });
                  setPopup(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
                  active ? "bg-bg" : "hover:bg-bg",
                  !m.routable && "opacity-50",
                )}
              >
                <span className="truncate text-xs font-medium text-ink">{m.name}</span>
                <span className={cn("ml-auto shrink-0 font-mono text-[0.625rem]", m.routable ? "text-ink-3" : "text-danger")}>
                  {m.channel}
                  {m.routable && m.maxInputTokens ? ` · ${fmtTokens(m.maxInputTokens)}` : ""}
                </span>
                {active && <CheckIcon />}
              </button>
            );
          })}
          {modelChoices.length === 0 && (
            <div className="px-2 py-3 text-xs leading-5 text-ink-3">
              {models && !models.authenticated ? (
                <Link
                  href="/settings"
                  onClick={() => setPopup(null)}
                  className="transition-colors hover:text-ink"
                >
                  未接入 relay，点击前往设置（登录或配置个人 key）
                </Link>
              ) : (
                "暂无可用模型"
              )}
            </div>
          )}
          {modelChoices.length > 0 && shownModels.length === 0 && (
            <div className="px-2 py-3 text-xs leading-5 text-ink-3">没有匹配的模型。</div>
          )}
          {/* 本地 Ollama（N2b）：在线时追加本地模型分组（runtime 分流到本地端点） */}
          {models?.failover && models.failover.length > 0 && (
            <div className="mx-1 mt-1 rounded-sm bg-surface px-2 py-1.5 text-[0.625rem] leading-4 text-ink-3">
              最近降级：{models.failover[0].from ?? "主端点"} → {models.failover[0].to}
            </div>
          )}
          {models?.ollama && models.ollama.models.length > 0 && (
            <>
              <div className="mt-1 border-t border-line px-2 pt-1.5 pb-0.5 text-[0.6875rem] font-semibold text-ink-3">
                本地 · Ollama（{models.ollama.baseUrl}）
              </div>
              {models.ollama.models.map((m) => {
                const active = selectedModel?.providerId === "ollama" && selectedModel?.modelId === m.id;
                return (
                  <button
                    key={`ollama:${m.id}`}
                    type="button"
                    onClick={() => {
                      onSelectModel({ providerId: "ollama", modelId: m.id });
                      setPopup(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
                      active ? "bg-bg" : "hover:bg-bg",
                    )}
                  >
                    <span className="truncate text-xs font-medium text-ink">{m.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-ink-3">local</span>
                    {active && <CheckIcon />}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
      {popup === "effort" && (
        <div className="absolute bottom-full left-1/2 mb-2 max-h-72 w-full max-w-3xl -translate-x-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-2 py-1.5 text-[0.6875rem] font-semibold text-ink-3">推理力度 · 对本条消息生效</div>
          {([
            { value: "off" as const, label: "默认", hint: "不发送 reasoning_effort（最兼容）" },
            { value: "minimal" as const, label: "最小", hint: "minimal" },
            { value: "low" as const, label: "低", hint: "low" },
            { value: "medium" as const, label: "中", hint: "medium" },
            { value: "high" as const, label: "高", hint: "high（模型不支持时 relay 返回 400）" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setEffort(opt.value);
                setPopup(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
                effort === opt.value ? "bg-bg" : "hover:bg-bg",
              )}
            >
              <span className="text-xs font-medium text-ink">{opt.label}</span>
              <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-ink-3">{opt.hint}</span>
              {effort === opt.value && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
      {popup === "skill" && (
        <div className="absolute bottom-full left-1/2 mb-2 max-h-72 w-full max-w-3xl -translate-x-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-2 py-1.5 text-[0.6875rem] font-semibold text-ink-3">
            Skill · 注入本次 prompt（.zmzai/skills）
          </div>
          {skills.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSkill(s);
                setPopup(null);
              }}
              className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-bg"
            >
              <span className="text-xs font-medium text-ink">{s.name}</span>
              {s.description && <span className="mt-0.5 block text-[0.6875rem] leading-4 text-ink-3">{s.description}</span>}
            </button>
          ))}
          {skills.length === 0 && (
            <div className="px-2 py-3 text-xs leading-5 text-ink-3">
              工作区还没有技能：在 .zmzai/skills/&lt;name&gt;/SKILL.md 放置技能定义。
            </div>
          )}
        </div>
      )}

      {/* 输入卡片：textarea 内嵌 + 底部工具行（opencode/Claude 式：与消息列同宽居中） */}
      <div className="mx-auto max-w-3xl rounded-xl border border-line bg-surface transition-colors focus-within:border-line-strong">
        {/* 图片附件预览 chips */}
        {images.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {images.map((im, i) => (
              <span key={i} className="group relative inline-flex items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt={im.name} className="h-12 w-12 rounded-sm border border-line object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  title="移除图片"
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-ink text-[8px] text-bg group-hover:flex"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {skill && (
          <div className="flex items-center gap-1 px-3 pt-2.5">
            <span className="inline-flex max-w-64 items-center gap-1 rounded-pill bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent-strong">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 10.9l-3.7 2.1.8-4.2L2 5.9l4.2-.5L8 1.5z" strokeLinejoin="round" />
              </svg>
              <span className="truncate">{skill.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setSkill(null)}
              title="移除 Skill"
              className="text-ink-3 transition-colors hover:text-ink"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <Textarea
          ref={textareaRef}
          onPaste={onPaste}
          className="max-h-44 min-h-[52px] w-full resize-none border-0 bg-transparent px-3.5 py-3 text-sm text-ink shadow-none outline-none placeholder:text-ink-3 focus-visible:ring-0"
          value={text}
          onChange={(e) => onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => {
            // @ 浮层打开时优先响应键盘导航
            if (atQuery != null && atItems.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtIndex((i) => (i + 1) % atItems.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtIndex((i) => (i - 1 + atItems.length) % atItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickAt(atItems[atIndex]);
                return;
              }
            }
            if (atQuery != null && e.key === "Escape") {
              e.preventDefault();
              setAtQuery(null);
              return;
            }
            // Enter 发送（Shift+Enter 换行）；输入法组合中不触发；⌘/Ctrl+Enter 兼容
            if (e.key !== "Enter") return;
            if (e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
          placeholder="给 Agent 下达任务…（可直接粘贴图片）"
        />
        {/* 选图/粘贴/发图拦截的短暂提示（4s 自动消失） */}
        {imgNotice && <p className="px-3.5 pb-1 text-xs text-warning">{imgNotice}</p>}
        {/* 图片选择（隐藏 input，回形针触发） */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            pickImages(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <button
            type="button"
            onClick={() => setPopup((p) => (p === "model" ? null : "model"))}
            title="选择模型（对本条消息生效）"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[0.6875rem] font-medium transition-colors",
              popup === "model" ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
              <path d="M9 4.5h2.5a2 2 0 0 1 2 2V9M7 11.5H4.5a2 2 0 0 1-2-2V7" strokeLinecap="round" />
            </svg>
            <span className="max-w-40 truncate font-mono">{modelLabel}</span>
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 6l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="添加图片（多模态输入）"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M13.5 7.5l-5.8 5.8a3.1 3.1 0 0 1-4.4-4.4l6-6a2.1 2.1 0 0 1 3 3l-6 6a1.1 1.1 0 0 1-1.6-1.6l5.3-5.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPopup((p) => (p === "skill" ? null : "skill"))}
            title="注入 Skill"
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-surface-2 hover:text-ink",
              popup === "skill" || skill ? "text-ink" : "text-ink-3",
            )}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 10.9l-3.7 2.1.8-4.2L2 5.9l4.2-.5L8 1.5z" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setPopup((p) => (p === "effort" ? null : "effort"))}
            title={`推理力度（对本条消息生效）${effort !== "off" ? ` · 当前 ${effort}` : ""}`}
            className={cn(
              "inline-flex h-7 items-center gap-0.5 rounded-full px-1.5 transition-colors hover:bg-surface-2 hover:text-ink",
              popup === "effort" || effort !== "off" ? "text-ink" : "text-ink-3",
            )}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M8 1.5v13M3.5 5.5L8 1.5l4.5 4M3.5 10.5L8 14.5l4.5-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {effort !== "off" && <span className="font-mono text-[0.625rem]">{effort}</span>}
          </button>

          <span className="flex-1" />

          {/* 上下文用量 + 压缩 */}
          {usage && usage.steps > 0 && (
            <button
              type="button"
              onClick={() => void compact()}
              disabled={compacting}
              title={`上下文约 ${fmtTokens(usage.used)} / ${fmtTokens(usage.contextWindow)} tokens · 点击压缩会话`}
              className="group mr-1.5 inline-flex items-center gap-1.5"
            >
              <span className="h-1 w-14 overflow-hidden rounded-pill bg-surface-2">
                <span className={cn("block h-full rounded-pill transition-all", pctColor)} style={{ width: `${pct}%` }} />
              </span>
              <span className="font-mono text-[0.625rem] text-ink-3 group-hover:text-ink-2">{pct}%</span>
            </button>
          )}

          {running ? (
            <button
              type="button"
              onClick={onAbort}
              title="中止"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-danger/50 text-danger transition-colors hover:bg-danger/10"
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-danger" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() && images.length === 0}
              title="发送（⏎）"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-bg transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="shrink-0 text-accent-strong" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 8.5l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
