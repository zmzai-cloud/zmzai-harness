import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { resolveWithinWorkspace } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DEPTH = 5;
const MAX_RESULTS = 40;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".workspace"]);

/** GET /api/fs/search?q=main — 递归文件名搜索（⌘P 文件快开，限深限噪）。 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").toLowerCase();
  const root = resolveWithinWorkspace("");
  const out: { path: string; type: "dir" | "file" }[] = [];

  async function walk(dir: string, rel: string, depth: number) {
    if (out.length >= MAX_RESULTS || depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_RESULTS) return;
      if (e.name.startsWith(".") && e.name !== ".zmzai") continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const hit = !q || e.name.toLowerCase().includes(q);
      if (hit) out.push({ path: childRel, type: e.isDirectory() ? "dir" : "file" });
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        await walk(path.join(dir, e.name), childRel, depth + 1);
      }
    }
  }

  await walk(root, "", 1);
  return NextResponse.json({ query: q, results: out.slice(0, MAX_RESULTS) });
}
