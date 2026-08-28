import { NextResponse, type NextRequest } from "next/server";

import { muzhiLogin } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 登录代理：浏览器在本页填 zmzai 账号密码，harness 服务端转发到
 * muzhi /api/auth/login，成功后的会话 cookie 写回浏览器（harness 域）。
 * 之后所有 relay 请求由服务端透传该 cookie，即「一次登录，全链路可用」。
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "邮箱和密码不能为空" }, { status: 400 });
  }

  const result = await muzhiLogin(body.email, body.password);
  const out = NextResponse.json(result.body ?? { ok: result.ok }, { status: result.ok ? 200 : result.status });

  // 透传 muzhi 下发的会话 cookie（可能多个：session + 校验和等）
  for (const c of result.setCookies) {
    out.headers.append("set-cookie", c);
  }
  return out;
}
