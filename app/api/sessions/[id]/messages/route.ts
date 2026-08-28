import { NextResponse, type NextRequest } from "next/server";

import { cloudRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 跨会话恢复：读取某会话已持久化的完整转录（消息+片段）。 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runtime = cloudRuntime();
  const messages = await runtime.store.getMessages(id);
  return NextResponse.json(messages);
}
