import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { NextResponse, type NextRequest } from "next/server";

import { workspaceRootForSession } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const run = promisify(execFile);

async function git(args: string[], sessionId?: string | null): Promise<string> {
  const { stdout } = await run("git", args, { cwd: workspaceRootForSession(sessionId), maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

const MARKER = "harness-checkpoint:";

/** GET /api/git/checkpoint — 列出检查点（时间倒序，含当前 HEAD 以判断可回滚范围）。 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    const log = await git(["log", "--format=%H%x00%ct%x00%s", `-n`, `30`], sessionId).catch(() => "");
    const points = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, ts, subject] = line.split("\0");
        return { hash, time: new Date(Number(ts) * 1000).toISOString(), subject, checkpoint: subject.includes(MARKER) };
      });
    return NextResponse.json({ points });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "读取检查点失败" }, { status: 400 });
  }
}

/** POST /api/git/checkpoint — 打快照：工作区当前状态 commit 为检查点（无变更则跳过）。 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { label?: string; sessionId?: string } | null;
  const label = body?.label?.trim() || "任务前快照";
  try {
    // 非 git 仓库时给明确错误（UI 引导 git init，不擅自初始化）
    await git(["rev-parse", "--git-dir"], body?.sessionId);
    await git(["add", "-A"], body?.sessionId);
    const dirty = (await git(["status", "--porcelain"], body?.sessionId)).length > 0;
    if (!dirty) return NextResponse.json({ ok: true, skipped: true, reason: "工作区无变更，无需快照" });
    const out = await git(["commit", "-m", `${MARKER} ${label}`, "--allow-empty-message", "--no-verify"], body?.sessionId);
    const hash = await git(["rev-parse", "--short", "HEAD"], body?.sessionId);
    return NextResponse.json({ ok: true, hash, detail: out.split("\n")[0] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "创建快照失败" }, { status: 400 });
  }
}

/** PUT /api/git/checkpoint — 回滚到指定检查点（硬回滚，UI 侧需二次确认）。 */
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { hash?: string; sessionId?: string } | null;
  const hash = body?.hash?.trim();
  if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
    return NextResponse.json({ error: "缺少合法的 hash" }, { status: 400 });
  }
  try {
    await git(["reset", "--hard", hash], body?.sessionId);
    // 未跟踪文件一并清掉，保证真正回到快照时刻的工作区
    await git(["clean", "-fd"], body?.sessionId).catch(() => undefined);
    return NextResponse.json({ ok: true, hash });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "回滚失败" }, { status: 400 });
  }
}
