"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Logo, Wordmark } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { SsoCookiePayload } from "@/lib/types";

/**
 * 登录页：Electron 宿主优先走 auth SSO 子窗口（auth.zmzai.cloud，
 * 支持 GitHub OAuth——本地代理表单做不到 OAuth 回调）；
 * Web 宿主 / SSO 不可用时保留邮箱密码表单（服务端转发 muzhi 登录）。
 */

/** 把 SSO 捕获的会话 cookie 落成本地 host-only cookie，成功后整页刷新。
 *  expiresAt 是秒级 Unix 时间戳（来自 Electron Cookie.expirationDate），随值一起
 *  交给服务端，让本地 cookie 与上游 session 同步过期；上游为 session cookie 时
 *  传 null，由服务端按 30 天兜底。 */
async function ingestSsoCookie(value: string, expiresAt: number | null) {
  const res = await fetch("/api/auth/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value, expiresAt }),
  });
  if (!res.ok) throw new Error("会话写入失败");
  window.location.href = "/";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Electron 下可走 auth SSO（GitHub 登录）；能力探测一次即可
  const [ssoReady, setSsoReady] = useState(false);
  const [ssoHint, setSsoHint] = useState<string | null>(null);
  const ssoHandled = useRef(false);

  // 主进程推送的是 { value, expiresAt } 载荷；老版本宿主可能仍只推字符串，做兼容
  const finishSso = useCallback((payload: SsoCookiePayload | string) => {
    if (ssoHandled.current) return; // cookie changed 可能连发多次，只吃第一颗
    const value = typeof payload === "string" ? payload : payload?.value;
    if (!value) return;
    const expiresAt = typeof payload === "string" ? null : (payload.expiresAt ?? null);
    ssoHandled.current = true;
    setSsoHint("登录成功，正在进入工作台…");
    void ingestSsoCookie(value, expiresAt).catch(() => {
      ssoHandled.current = false;
      setSsoHint(null);
      setError("会话写入失败，请重试");
    });
  }, []);

  useEffect(() => {
    const bridge = window.lecternNative;
    if (!bridge?.openAuthWindow || !bridge.onSsoCookie) return;
    setSsoReady(true);
    bridge.onSsoCookie(finishSso);
  }, [finishSso]);

  const openSso = async () => {
    setError(null);
    setSsoHint("正在打开登录窗口…");
    // 已有共享会话（此前登录过）时主进程直接返回 cookie，免再登一次
    const existing = await window.lecternNative!.openAuthWindow!();
    if (existing) finishSso(existing);
    else setSsoHint("在登录窗口完成 GitHub 或账号登录后会自动返回");
  };

  const submit = async () => {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.login(email.trim(), password);
      // 整页刷新：让会话 cookie 生效，重新探测登录态
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败，请重试");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-bg text-ink">
      <div className="flex items-center gap-3">
        <Logo size={28} />
        <Wordmark sublabel="agent harness" size={18} weight={650} />
      </div>

      <div className="w-full max-w-xs rounded-sm border border-line bg-surface p-6">
        {ssoReady && (
          <>
            <Button variant="primary" size="md" className="w-full" onClick={() => void openSso()}>
              用户登录
            </Button>
            <div className="mt-2 text-center text-[0.6875rem] leading-5 text-ink-3">
              打开 auth.zmzai.cloud 登录，支持 GitHub；完成后自动返回
            </div>
            {ssoHint && <div className="mt-2 text-center text-[0.6875rem] leading-5 text-success">{ssoHint}</div>}
            <div className="my-5 flex items-center gap-3 text-[0.625rem] text-ink-3">
              <span className="h-px flex-1 bg-line" />
              或使用账号密码
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        {!ssoReady && (
          <div className="mb-5">
            <div className="text-sm font-semibold">用户登录</div>
            <div className="mt-1 text-xs leading-5 text-ink-3">使用 zmzai 账号登录，同步会话与模型额度。</div>
          </div>
        )}

        <div className="space-y-3">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            autoComplete="email"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          {error && <div className="text-xs leading-5 text-danger">{error}</div>}
          <Button variant="secondary" size="md" className="w-full" disabled={busy} onClick={() => void submit()}>
            {busy ? "登录中…" : "账号密码登录"}
          </Button>
        </div>
      </div>
    </div>
  );
}
