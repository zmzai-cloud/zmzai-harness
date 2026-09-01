import { NextResponse, type NextRequest } from "next/server";

import { sessionRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 中止当前运行。 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runtime = sessionRuntime(id);
  await runtime.runner.abort(id);
  return NextResponse.json({ ok: true });
}
