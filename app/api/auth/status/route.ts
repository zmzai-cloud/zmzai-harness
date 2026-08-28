import { NextResponse, type NextRequest } from "next/server";

import { relayAuthStatus, sessionCookieName } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 登录态探测：把本域 cookie 透传 relay 验证。 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(sessionCookieName)?.value;
  const status = await relayAuthStatus(cookie ? `${sessionCookieName}=${cookie}` : null);
  return NextResponse.json(status);
}
