import { NextResponse } from "next/server";

import { gracefulShutdown } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 优雅收尾（会话稳定性 P2）：Electron 主进程 before-quit 时经 HTTP 调用，
 *  中止所有 running 会话（正常收尾链）+ checkpoint 已打开 SQLite 库，
 *  再杀内嵌 server 子进程。dev 模式（外部 next dev）同样走本端点。 */
export async function POST() {
  const { aborted, checkpointed } = await gracefulShutdown();
  return NextResponse.json({ ok: true, aborted, checkpointed });
}
