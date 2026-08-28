import { NextResponse } from "next/server";

import { terminalManager } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/terminal/:id — 结束并回收一条命令会话（整树回收） */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mgr = terminalManager();
  if (!mgr.getSession(id)) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  const ok = mgr.kill(id);
  return NextResponse.json({ ok });
}
