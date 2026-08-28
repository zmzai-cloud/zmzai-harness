import { NextResponse, type NextRequest } from "next/server";

import { muzhiLogin } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 登录代理：浏览器在本页填 zmzai 账号密码，harness 服务端转发到
 * muzhi /api/auth/login，成功后的会话 cookie 写回浏览器（harness 域）。
 * 之后所有 relay 请求由服务端透传该 cookie，即「一次登录，全链路可用」。
 */
/**
 * 本地调试关键点：muzhi 正式站签发的会话 cookie 带 Secure（production 恒真）、
 * 可能带 Domain=.zmzai.cloud——浏览器在 http://127.0.0.1 上会拒绝保存，
 * 导致「登录成功但 harness 域始终无 cookie」。这里重写为 host-only cookie
 * （只保留 name=value + Path + HttpOnly）。服务端透传给 relay 时只看
 * cookie 值本身，剥离属性不影响全链路鉴权。
 */
function sanitizeCookie(raw: string): string {
  const [pair, ...attrs] = raw.split(";");
  const keep = attrs.filter((a) => {
    const key = a.trim().split("=")[0].toLowerCase();
    return key === "path" || key === "httponly";
  });
  return [pair, ...keep].join("; ");
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "邮箱和密码不能为空" }, { status: 400 });
  }

  const result = await muzhiLogin(body.email, body.password);
  const out = NextResponse.json(result.body ?? { ok: result.ok }, { status: result.ok ? 200 : result.status });

  // 透传 muzhi 下发的会话 cookie（重写属性以适配本地 http 域，见上）
  for (const c of result.setCookies) {
    out.headers.append("set-cookie", sanitizeCookie(c));
  }
  return out;
}
