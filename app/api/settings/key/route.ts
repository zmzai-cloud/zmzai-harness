import { NextResponse, type NextRequest } from "next/server";

import { maskedKey, ollamaBase, rotateSecretKey, savePersonalKey } from "@/lib/settings";
import { relayBase } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 个人 key 状态（仅掩码回显，全量 key 不出服务端）+ 本地 Ollama 端点。 */
export async function GET() {
  const { masked } = maskedKey();
  return NextResponse.json({
    configured: Boolean(masked),
    masked: masked ?? null,
    relayUrl: relayBase(),
    ollamaUrl: ollamaBase(),
  });
}

/** 保存个人 key（zrk_...）/ relay 端点 / 本地 Ollama 端点。保存即生效（headers 每次请求求值）。 */
export async function PUT(request: NextRequest) {
  const body = (await request.json()) as { key?: string | null; relayUrl?: string | null; ollamaUrl?: string | null };
  const key = body.key ?? null;
  if (key && !key.startsWith("zrk_")) {
    return NextResponse.json({ error: "个人 key 应以 zrk_ 开头（relay 控制台签发）" }, { status: 400 });
  }
  // undefined = 不动该字段（部分保存互不覆盖）；null = 清除
  savePersonalKey(key, body.relayUrl === undefined ? undefined : (body.relayUrl ?? null), body.ollamaUrl === undefined ? undefined : (body.ollamaUrl ?? null));
  const { masked } = maskedKey();
  return NextResponse.json({ configured: Boolean(masked), masked: masked ?? null, ollamaUrl: ollamaBase() });
}

/** 密钥轮换（P0）：重新生成 .secret 并把已存 key 重加密迁移。 */
export async function POST() {
  const migrated = rotateSecretKey();
  const { masked } = maskedKey();
  return NextResponse.json({ rotated: true, keyMigrated: migrated, configured: Boolean(masked), masked: masked ?? null, ollamaUrl: ollamaBase() });
}

/** 清除个人 key（回到登录 cookie 模式）。 */
export async function DELETE() {
  savePersonalKey(null);
  return NextResponse.json({ configured: false, masked: null, ollamaUrl: ollamaBase() });
}
