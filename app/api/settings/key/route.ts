import { NextResponse, type NextRequest } from "next/server";

import { maskedKey, savePersonalKey } from "@/lib/settings";
import { relayBase } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 个人 key 状态（仅掩码回显，全量 key 不出服务端）。 */
export async function GET() {
  const { masked } = maskedKey();
  return NextResponse.json({ configured: Boolean(masked), masked: masked ?? null, relayUrl: relayBase });
}

/** 保存个人 key（zrk_...）与可选 relay 端点。保存即生效（headers 每次请求求值）。 */
export async function PUT(request: NextRequest) {
  const body = (await request.json()) as { key?: string | null; relayUrl?: string | null };
  const key = body.key ?? null;
  if (key && !key.startsWith("zrk_")) {
    return NextResponse.json({ error: "个人 key 应以 zrk_ 开头（relay 控制台签发）" }, { status: 400 });
  }
  savePersonalKey(key, body.relayUrl ?? null);
  const { masked } = maskedKey();
  return NextResponse.json({ configured: Boolean(masked), masked: masked ?? null });
}

/** 清除个人 key（回到登录 cookie 模式）。 */
export async function DELETE() {
  savePersonalKey(null);
  return NextResponse.json({ configured: false, masked: null });
}
