import { rm, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

import { dataDirFor, getActiveProject } from "@/lib/projects";
import { sessionRuntime } from "@/lib/runtime";
import { removeWorktree } from "@/lib/worktree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 会话 id 白名单字符（jsonl 文件名即 id，防路径逃逸）。 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** PATCH /api/sessions/[id] — 重命名会话（store.updateSession 落 jsonl）。 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "非法会话 id" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const title = body?.title?.trim();
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });

  const runtime = sessionRuntime(id);
  const existing = await runtime.store.getSession(id);
  if (!existing) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  await runtime.store.updateSession(id, { title: title.slice(0, 80) });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/sessions/[id] — 删除会话及其消息/片段。
 *  存储现在是 SQLite（zmzai.db）：必须走 store.deleteSession 级联删三表；
 *  旧 JSONL 文件仍一并清扫（不删的话，空库重新导入时会把已删会话复活）。 */
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "非法会话 id" }, { status: 400 });

  const runtime = sessionRuntime(id);
  const existing = await runtime.store.getSession(id);
  if (!existing) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  await runtime.store.deleteSession?.(id);

  // 隔离副本会话：worktree 目录与分支一并清理（未合并的提交随分支丢弃）
  await removeWorktree(id).catch(() => undefined);

  // 遗留 JSONL 清扫（store 未实现 deleteSession 的后端也能清到文件层）
  const dir = dataDirFor(getActiveProject());
  await rm(path.join(dir, "sessions", `${id}.json`), { force: true });
  for (const kind of ["messages", "parts"] as const) {
    const kindDir = path.join(dir, kind);
    let entries: string[] = [];
    try {
      entries = await readdir(kindDir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith(".json")) continue;
      const full = path.join(kindDir, file);
      try {
        const raw = JSON.parse(await readFile(full, "utf8")) as { sessionId?: string };
        if (raw.sessionId === id) await rm(full, { force: true });
      } catch {
        /* 损坏文件跳过 */
      }
    }
  }
  return NextResponse.json({ ok: true });
}
