import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieName } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSO 会话中转：Electron 主进程从 auth.zmzai.cloud 的会话里捕获共享会话
 * cookie 值（父域 .zmzai.cloud 对 localhost 不可见），渲染层经此端点把它
 * 写成 127.0.0.1 的 host-only cookie——与 /api/auth/login 的 sanitize
 * 同一套约定（服务端透传给 relay 时只看 cookie 值本身）。
 * 值只经内存中转、不落盘不落日志。上游有效期会同步到本地 host-only cookie；
 * 若上游是 session cookie，则按 30 天缓存，实际是否仍可用始终由 relay 校验。
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { value?: string; expiresAt?: number | null } | null;
  const value = body?.value?.trim();
  if (!value) {
    return NextResponse.json({ error: "缺少会话凭据" }, { status: 400 });
  }
  // 上游给了明确有效期且已过期 → 拒绝。注意这与「上游没给有效期」是两回事：
  // 没给有效期（session cookie）走下面的 30 天兜底，给了但已过期则是凭据真的失效了。
  const expiry = body?.expiresAt;
  if (typeof expiry === "number" && Number.isFinite(expiry) && expiry > 0 && expiry <= Date.now() / 1000) {
    return NextResponse.json({ error: "会话凭据已过期" }, { status: 401 });
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.set(sessionCookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: normalizeMaxAge(expiry),
  });
  return out;
}

/** 上游会话最长缓存 30 天（session cookie 无有效期时的兜底，同 /api/auth/login）。 */
const MAX_CACHE_SECONDS = 60 * 60 * 24 * 30;

/**
 * 把上游过期时间换算成本地 cookie 的 maxAge（秒）。
 *
 * 传入的 expiresAt 是**秒级** Unix 时间戳（Electron Cookie.expirationDate 的单位）。
 * 这里做三道防御，任一道不过就退回 30 天兜底——宁可缓存得比实际短（最多表现为
 * 提前掉登录，重新 SSO 即可），也不能缓存得比服务端久（会表现为「已登录但请求
 * 全被拒」，比掉登录更难排查）：
 * - 非正数 / 非有限数：上游没给有效期（session cookie 或脏数据），按兜底走
 * - 量纲异常（误传毫秒 → 剩余秒数比真实值大约 1000 倍）：钳到 30 天，避免 maxAge 变成 30 年
 *
 * 已过期的情况不在这里处理——调用方已先返回 401。
 */
function normalizeMaxAge(expiresAt: number | null | undefined): number {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return MAX_CACHE_SECONDS;
  }
  const nowSeconds = Date.now() / 1000;
  const remaining = Math.floor(expiresAt - nowSeconds);
  if (remaining <= 0) return MAX_CACHE_SECONDS;
  // 误传毫秒时 remaining 会是真实值的 ~1000 倍，用「剩余时长不可能超过 30 年」兜住
  return Math.min(remaining, MAX_CACHE_SECONDS);
}
