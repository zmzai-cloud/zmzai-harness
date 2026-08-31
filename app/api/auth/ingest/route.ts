import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieName } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSO 会话中转：Electron 主进程从 auth.zmzai.cloud 的会话里捕获共享会话
 * cookie 值（父域 .zmzai.cloud 对 localhost 不可见），渲染层经此端点把它
 * 写成 127.0.0.1 的 host-only cookie——与 /api/auth/login 的 sanitize
 * 同一套约定（服务端透传给 relay 时只看 cookie 值本身）。
 * 值只经内存中转、不落盘不落日志。
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { value?: string } | null;
  const value = body?.value?.trim();
  if (!value) {
    return NextResponse.json({ error: "缺少会话凭据" }, { status: 400 });
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.set(sessionCookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return out;
}
