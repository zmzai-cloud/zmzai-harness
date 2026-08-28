import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { resolveWithinWorkspace } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type TreeNode = {
  name: string;
  type: "dir" | "file";
  size?: number;
  mtime: string;
};

/** GET /api/fs/tree?path=src/lib — 列出工作区内某目录一层内容（懒加载目录树） */
export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("path") ?? "";
  try {
    const abs = resolveWithinWorkspace(dir);
    const entries = await readdir(abs, { withFileTypes: true });
    const nodes: TreeNode[] = [];
    for (const e of entries) {
      // 隐藏目录只显示 .zmzai（agent 配置所在），其余跳过减少噪音
      if (e.name.startsWith(".") && e.name !== ".zmzai") continue;
      const node: TreeNode = { name: e.name, type: e.isDirectory() ? "dir" : "file", mtime: "" };
      try {
        const st = await stat(join(abs, e.name));
        node.mtime = st.mtime.toISOString();
        if (e.isFile()) node.size = st.size;
        else if (e.isSymbolicLink()) node.type = "dir";
      } catch {
        // stat 失败（权限等）仍保留条目
      }
      nodes.push(node);
    }
    // 目录在前，各自按名称排序
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return NextResponse.json({ path: dir, nodes });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "读取目录失败" }, { status: 400 });
  }
}
