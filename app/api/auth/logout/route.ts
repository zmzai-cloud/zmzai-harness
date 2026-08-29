import { NextResponse, type NextRequest } from "next/server";

import { relayLogout, sessionCookieName } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 退出登录：转发 relay /api/logout 删除共享会话；本域 cookie 一并过期。 */
export async function POST(request: NextRequest) {
  const cookie = request.cookies.get(sessionCookieName)?.value;
  const ok = await relayLogout(cookie ? `${sessionCookieName}=${cookie}` : null);

  const res = NextResponse.json({ ok });
  // 本域（harness 域）cookie 过期；父域共享 cookie 由 relay 的 Set-Cookie 处理
  res.cookies.set(sessionCookieName, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
