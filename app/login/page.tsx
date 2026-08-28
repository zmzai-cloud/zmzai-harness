"use client";

import { useState } from "react";
import { Button, Input, Logo, Wordmark } from "@zmzai/theme";

import { client } from "@/lib/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <div className="mb-5">
          <div className="text-sm font-semibold">登录 zmzai</div>
          <div className="mt-1 text-xs leading-5 text-ink-3">
            使用 zmzai 账号登录，会话与模型额度走 relay（云端）。
          </div>
        </div>

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
          <Button variant="primary" size="md" className="w-full" disabled={busy} onClick={() => void submit()}>
            {busy ? "登录中…" : "登录"}
          </Button>
        </div>
      </div>
    </div>
  );
}
