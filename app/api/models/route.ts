import { NextResponse } from "next/server";

import { currentCookieHeader } from "@/lib/request-cookie";
import { authHeaders } from "@/lib/settings";
import { relayBase } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** relay 模型目录（composer 模型选择器数据源）。
 *  鉴权：个人 key（Bearer）优先，否则透传登录 cookie；两者皆无时 relay 401 → 空列表。 */
export async function GET() {
  const headers = authHeaders(currentCookieHeader());
  try {
    const res = await fetch(`${relayBase}/models`, { headers, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ models: [], modelSelectorData: null, authenticated: false });
    const data = (await res.json()) as unknown;
    return NextResponse.json({ ...(data as object), authenticated: true });
  } catch {
    return NextResponse.json({ models: [], modelSelectorData: null, authenticated: false });
  }
}
