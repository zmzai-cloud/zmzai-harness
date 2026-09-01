import { NextResponse, type NextRequest } from "next/server";

import { terminalManager, activeWorkspaceRoot } from "@/lib/runtime";
import { interactiveShellCommand, resolveShells, type ShellCandidate } from "@/lib/shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/terminal — 终端会话列表 + 后端种类（pty/pipe）+ 系统 shell 探测结果 */
export async function GET() {
  const mgr = terminalManager();
  const { defaultShell, shells } = resolveShells();
  return NextResponse.json({ backendKind: mgr.backendKind, sessions: mgr.list(), defaultShell, shells });
}

/** 交互式 shell 会话：面板里的「N 个终端」走这条，起的是系统默认 shell。 */
async function startInteractiveShell(shellArg?: string) {
  const { defaultShell, shells } = resolveShells();
  const shell: ShellCandidate | null =
    (shellArg && shells.find((s) => s.file === shellArg)) || defaultShell;
  if (!shell) return NextResponse.json({ error: "未探测到可用 shell" }, { status: 500 });
  const mgr = terminalManager();
  const session = await mgr.start({
    name: shell.label,
    command: interactiveShellCommand(shell),
    cwd: activeWorkspaceRoot(),
    cols: 120,
    rows: 30,
  });
  return NextResponse.json(session);
}

/**
 * POST /api/terminal — 启动一条命令（sh -c "<command>"，cwd 固定在工作区）。
 * 两种后端下都是"命令会话"：输出游标读、exit 即结束，行为统一可预测。
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { command?: string; name?: string; interactive?: boolean; shell?: string }
    | null;

  // interactive: 起一条交互式 shell 会话（跟随系统默认 shell，不写死 zsh）
  if (body?.interactive) {
    try {
      return await startInteractiveShell(body.shell?.trim() || undefined);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "启动失败" },
        { status: 500 },
      );
    }
  }

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
