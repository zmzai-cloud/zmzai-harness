"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { KeyStatus } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * 设置弹窗：个人 key（relay zrk_，控制台签发后粘贴）。
 * 保存即生效——服务端 authHeaders() 对 relay 请求改用 Bearer；key 全量不出服务端，仅掩码回显。
 */
export default function SettingsDialog({ open, onClose }: Props) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft("");
    setError(null);
    setSaved(false);
    void client.keyStatus().then(setStatus).catch(() => undefined);
  }, [open]);

  const save = useCallback(async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await client.keySave(key));
      setDraft("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const clear = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await client.keyClear());
      setSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "清除失败");
    } finally {
      setBusy(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-md rounded-md border border-line bg-bg p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="设置"
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink">设置</span>
          <button type="button" onClick={onClose} className="text-ink-3 transition-colors hover:text-ink" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="mb-4 text-xs leading-5 text-ink-3">
          配置个人 key 后，模型请求以 Bearer 直连 relay（不依赖浏览器登录态）；未配置时继续沿用登录会话。
        </p>

        <div className="mb-1 text-[0.6875rem] font-semibold text-ink-2">个人 key</div>
        {status?.configured ? (
          <div className="mb-3 flex items-center gap-2 rounded-sm border border-line bg-surface px-2.5 py-2">
            <span className="font-mono text-xs text-ink">{status.masked}</span>
            <span className="flex-1" />
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear()}
              className="text-[0.6875rem] text-ink-3 transition-colors hover:text-danger"
            >
              清除
            </button>
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="zrk_…（relay 控制台 → API Keys 签发）"
              spellCheck={false}
              autoComplete="off"
              className="h-9 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-ink"
            />
            <Button variant="primary" size="sm" disabled={busy || !draft.trim()} onClick={() => void save()}>
              保存
            </Button>
          </div>
        )}
        {saved && <div className="mb-2 text-[0.6875rem] text-success">已保存，后续请求将使用个人 key。</div>}
        {error && <div className="mb-2 text-[0.6875rem] text-danger">{error}</div>}

        <div className="rounded-sm bg-surface px-2.5 py-2 text-[0.6875rem] leading-5 text-ink-3">
          <div>
            relay：<span className="font-mono">{status?.relayUrl ?? "…"}</span>
          </div>
          <div>申请入口：relay 控制台 → API Keys → 新建 key（zrk_ 开头）。</div>
        </div>
      </div>
    </div>
  );
}
