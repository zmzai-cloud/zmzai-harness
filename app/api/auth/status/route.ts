import { NextResponse, type NextRequest } from "next/server";

import { relayCurrentUser, sessionCookieName } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 登录态 + 当前用户 profile（name/email，账户块展示用）。 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(sessionCookieName)?.value;
  const cookieHeader = cookie ? `${sessionCookieName}=${cookie}` : null;
  const user = await relayCurrentUser(cookieHeader);
  return NextResponse.json({
    loggedIn: user !== null,
    cookieName: sessionCookieName,
    user: user ? { name: user.name, email: user.email } : null,
  });
}
