import { NextResponse, type NextRequest } from "next/server";

import { isSessionActive } from "@zmzai/agent-framework";

import { resolveModel, sessionCookieName } from "@/lib/relay";
import { cloudRuntime, activeWorkspaceRoot } from "@/lib/runtime";
import { createWorktree } from "@/lib/worktree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const runtime = cloudRuntime();
  const sessions = await runtime.store.listSessions({ userId: "local", workspaceId: "local" });
  // 附带运行态（P2-15 多会话并行状态点）：runner 的 activeRuns 内存表
  const withStatus = sessions.map((s) => ({ ...s, running: isSessionActive(s.id) }));
  return NextResponse.json(withStatus);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    { agent?: string; model?: { providerId: string; modelId: string }; isolate?: boolean } | null;
  const cookie = request.cookies.get(sessionCookieName)?.value;
  const cookieHeader = cookie ? `${sessionCookieName}=${cookie}` : null;

  const runtime = cloudRuntime();
  const model = body?.model ?? (await resolveModel(body?.agent, cookieHeader));
  const session = await runtime.createSession({
    userId: "local",
    workspaceId: "local",
    agent: body?.agent,
    model: model ?? { providerId: "openai", modelId: process.env.OPENAI_MODEL ?? "gpt-4o" },
  });

  // 会话级 worktree 隔离（robustness-plan §9）：仅显式勾选「隔离副本」的会话创建 worktree；
  // 非 git 项目 / git 失败时降级为普通会话并回传原因（渐进采用，不做一刀切）。
  let isolation: { enabled: boolean; reason?: string; path?: string; branch?: string } = { enabled: false };
  if (body?.isolate) {
    const result = await createWorktree(session.id, activeWorkspaceRoot());
    if (result.ok) {
      isolation = { enabled: true, path: result.record.path, branch: result.record.branch };
    } else {
      isolation = { enabled: false, reason: result.reason };
    }
  }
  return NextResponse.json({ ...session, isolation });
}
