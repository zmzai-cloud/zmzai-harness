import { NextResponse, type NextRequest } from "next/server";

import { terminalManager, activeWorkspaceRoot } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/terminal — 终端会话列表 + 后端种类（pty/pipe） */
export async function GET() {
  const mgr = terminalManager();
  return NextResponse.json({ backendKind: mgr.backendKind, sessions: mgr.list() });
}

/**
 * POST /api/terminal — 启动一条命令（sh -c "<command>"，cwd 固定在工作区）。
 * 两种后端下都是"命令会话"：输出游标读、exit 即结束，行为统一可预测。
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { command?: string; name?: string } | null;
  const command = body?.command?.trim();
  if (!command) return NextResponse.json({ error: "缺少 command" }, { status: 400 });
  const mgr = terminalManager();
  try {
    const session = await mgr.start({
      name: body?.name ?? command.slice(0, 60),
      command,
      // 函数取值：随项目切换即时生效（裸 import let 导出经 webpack 编译后 live binding 断裂，恒为启动时项目）
      cwd: activeWorkspaceRoot(),
      cols: 120,
      rows: 30,
    });
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "启动失败" }, { status: 500 });
  }
}
