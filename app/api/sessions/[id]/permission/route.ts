import { NextResponse, type NextRequest } from "next/server";

import { cloudRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 权限回复：批准（一次/总是）或拒绝，可选反馈。 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    requestId?: string;
    reply?: "once" | "always" | "reject";
    feedback?: string;
  } | null;
  if (!body?.requestId || !body?.reply) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const runtime = cloudRuntime();
  await runtime.runner.replyPermission(id, body.requestId, body.reply, body.feedback);
  return NextResponse.json({ ok: true });
}
