"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Textarea, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { ModelRef, ModelsState, SkillOption, UsageInfo } from "@/lib/types";

/** token 数缩写：1234 → 1.2k */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

type ModelChoice = { id: string; name: string; channel: string };

type Props = {
  sessionId: string | null;
  running: boolean;
  selectedModel: ModelRef | null;
  onSelectModel: (m: ModelRef | null) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
};

/**
 * 底部 Composer：输入区 + 能力条（模型选择 / Skill 注入 / 上下文用量与压缩）。
 * 模型为 per-prompt 覆盖（framework runner.prompt 的 model 参数）；Skill 选中后把
 * SKILL.md 的 markdown 随本次 prompt 注入（与 framework PluginSkill 同源约定）。
 */
export default function Composer({ sessionId, running, selectedModel, onSelectModel, onSend, onAbort }: Props) {
  const [text, setText] = useState("");
  const [models, setModels] = useState<ModelsState | null>(null);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skill, setSkill] = useState<SkillOption | null>(null);
  const [popup, setPopup] = useState<"model" | "skill" | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [compacting, setCompacting] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 模型目录与技能列表（会话无关，进页面拉一次）
  useEffect(() => {
    void client.listModels().then(setModels).catch(() => undefined);
    void client.listSkills().then((r) => setSkills(r.skills)).catch(() => undefined);
  }, []);

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

  const modelChoices = useMemo<ModelChoice[]>(() => {
    const msd = models?.modelSelectorData;
    if (!msd) return [];
    const seen = new Set<string>();
    const out: ModelChoice[] = [];
    for (const f of msd.featured) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        out.push({ id: f.id, name: f.name, channel: f.channel });
      }
    }
    for (const c of msd.channels) {
      for (const m of c.models) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          out.push({ id: m.id, name: m.name, channel: c.name });
        }
      }
    }
    return out;
  }, [models]);

  const submit = useCallback(() => {
    const body = text.trim();
    if (!body || !sessionId) return;
    let full = body;
    if (skill) {
      full += `\n\n---\n\n<skill name="${skill.name}">\n${skill.markdown}\n</skill>`;
    }
    onSend(full);
    setText("");
    setSkill(null);
  }, [text, sessionId, skill, onSend]);

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

  const modelLabel = selectedModel?.modelId ?? "跟随代理";
  const pct = usage && usage.contextWindow > 0 ? Math.min(100, Math.round((usage.used / usage.contextWindow) * 100)) : 0;
  const pctColor = pct >= 85 ? "bg-danger" : pct >= 60 ? "bg-warning" : "bg-accent-strong";

  return (
    <div ref={rootRef} className="relative shrink-0 border-t border-line bg-bg">
      {/* 弹层：模型选择 / Skill 选择 */}
      {popup === "model" && (
        <div className="absolute bottom-full left-3 mb-2 max-h-72 w-80 overflow-y-auto rounded-md border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-2 py-1.5 text-[0.6875rem] font-semibold text-ink-3">模型（对本条消息生效）</div>
          <button
            type="button"
            onClick={() => {
              onSelectModel(null);
              setPopup(null);
            }}
            className={cn(
              "block w-full rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
              !selectedModel ? "bg-bg text-ink" : "text-ink-2 hover:bg-bg",
            )}
          >
            跟随代理默认模型
          </button>
          {modelChoices.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onSelectModel({ providerId: "openai", modelId: m.id });
                setPopup(null);
              }}
              className={cn(
                "block w-full rounded-sm px-2 py-1.5 text-left transition-colors",
                selectedModel?.modelId === m.id ? "bg-bg text-ink" : "text-ink-2 hover:bg-bg",
              )}
            >
              <span className="text-xs font-medium">{m.name}</span>
              <span className="ml-1.5 font-mono text-[0.625rem] text-ink-3">{m.channel}</span>
            </button>
          ))}
          {modelChoices.length === 0 && (
            <div className="px-2 py-3 text-xs leading-5 text-ink-3">
              {models && !models.authenticated
                ? "未接入 relay（登录或配置个人 key 后可选拖模型）"
                : "暂无可用模型"}
            </div>
          )}
        </div>
      )}
      {popup === "skill" && (
        <div className="absolute bottom-full left-3 mb-2 max-h-72 w-80 overflow-y-auto rounded-md border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-2 py-1.5 text-[0.6875rem] font-semibold text-ink-3">
            Skill（注入本次 prompt · .zmzai/skills）
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

      {/* 已选 Skill chip */}
      {skill && (
        <div className="flex items-center gap-1.5 px-3 pt-2">
          <span className="inline-flex max-w-64 items-center gap-1 rounded-pill bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent-strong">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 10.9l-3.7 2.1.8-4.2L2 5.9l4.2-.5L8 1.5z" strokeLinejoin="round" />
            </svg>
            <span className="truncate">{skill.name}</span>
          </span>
          <button
            type="button"
            onClick={() => setSkill(null)}
            className="text-[0.6875rem] text-ink-3 transition-colors hover:text-ink"
          >
            移除
          </button>
        </div>
      )}

      {/* 输入区 */}
      <div className="flex items-end gap-2 p-3">
        <Textarea
          className="h-11 flex-1 resize-none rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={sessionId ? "给 Agent 下达任务…（⌘/Ctrl+Enter 发送）" : "先新建或选择一个会话"}
          disabled={!sessionId}
        />
        {running ? (
          <Button variant="danger" size="md" onClick={onAbort}>
            中止
          </Button>
        ) : (
          <Button variant="primary" size="md" onClick={submit} disabled={!sessionId || !text.trim()}>
            发送
          </Button>
        )}
      </div>

      {/* 能力条：模型 / Skill / 上下文用量+压缩 */}
      <div className="flex h-9 items-center gap-1 border-t border-line px-3">
        <button
          type="button"
          onClick={() => setPopup((p) => (p === "model" ? null : "model"))}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-[0.6875rem] font-medium transition-colors",
            popup === "model" ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
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
          onClick={() => setPopup((p) => (p === "skill" ? null : "skill"))}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-[0.6875rem] font-medium transition-colors",
            popup === "skill" ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 10.9l-3.7 2.1.8-4.2L2 5.9l4.2-.5L8 1.5z" strokeLinejoin="round" />
          </svg>
          Skill
        </button>

        <span className="flex-1" />

        {/* 上下文用量条 + 压缩 */}
        {usage && usage.steps > 0 && (
          <button
            type="button"
            onClick={() => void compact()}
            disabled={compacting}
            title={`上下文约 ${fmtTokens(usage.used)} / ${fmtTokens(usage.contextWindow)} tokens · 点击压缩会话`}
            className="group mr-1 inline-flex items-center gap-1.5"
          >
            <span className="font-mono text-[0.625rem] text-ink-3 group-hover:text-ink-2">
              {pct}% · {fmtTokens(usage.used)}
            </span>
            <span className="h-1 w-16 overflow-hidden rounded-pill bg-surface-2">
              <span className={cn("block h-full rounded-pill transition-all", pctColor)} style={{ width: `${pct}%` }} />
            </span>
            <span className="text-[0.625rem] text-ink-3 group-hover:text-ink">
              {compacting ? "压缩中…" : "压缩"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
