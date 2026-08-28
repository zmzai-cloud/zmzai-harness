import { execFile } from "node:child_process";

import { NextResponse } from "next/server";

import { workspaceRoot } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type GitChange = { x: string; y: string; path: string; origPath?: string };

function run(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { cwd: workspaceRoot, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolvePromise(stdout);
    });
  });
}

/**
 * GET /api/git/status — 工作区 git 状态（branch + porcelain 变更列表）。
 * 只读白名单命令，等价 agent 侧 git 工具的只读面。
 */
export async function GET() {
  try {
    // 空仓库（无 commit）时 rev-parse HEAD 会失败，降级取分支名
    let branch = "";
    try {
      branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch {
      branch = `${(await run(["branch", "--show-current"])).trim() || "HEAD"}（空仓库）`;
    }
    const aheadOut = await run(["status", "--porcelain=v1", "-b"]);
    // -b 首行含 ahead/behind，如 ## main...origin/main [ahead 2]
    const first = aheadOut.split("\n")[0] ?? "";
    const aheadMatch = first.match(/ahead (\d+)/);
    const behindMatch = first.match(/behind (\d+)/);
    const changes: GitChange[] = aheadOut
      .split("\n")
      .slice(1)
      .filter((l) => l.length >= 3)
      .map((l) => {
        const x = l[0]!;
        const y = l[1]!;
        const rest = l.slice(3);
        // 重命名格式："R  old -> new"
        const arrow = rest.indexOf(" -> ");
        return arrow >= 0
          ? { x, y, path: rest.slice(arrow + 4), origPath: rest.slice(0, arrow) }
          : { x, y, path: rest };
      });
    return NextResponse.json({
      branch,
      ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
      behind: behindMatch ? Number(behindMatch[1]) : 0,
      changes,
    });
  } catch (err) {
    // .workspace 可能不是 git 仓库——正常降级而非报错
    return NextResponse.json({
      branch: null,
      ahead: 0,
      behind: 0,
      changes: [],
      error: err instanceof Error ? err.message : "git 不可用",
    });
  }
}
