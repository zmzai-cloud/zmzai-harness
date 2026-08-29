import { NextResponse } from "next/server";

import { renderRepoMap, resolveFrameworkVendorDirs } from "@zmzai/agent-framework";
import { activeWorkspaceRoot } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** GET /api/repomap?focus=&paths=&tokenBudget=
 *  项目地图（R1）：直接调 framework 的 renderRepoMap，返回地图文本 + 统计。
 *  供 WorkbenchPanel Map tab 使用，与 agent 的 repo_map 工具同源同缓存。 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const focus = url.searchParams.get("focus") ?? undefined;
  const paths = url.searchParams.get("paths")?.split(",").filter(Boolean);
  const tokenBudgetRaw = url.searchParams.get("tokenBudget");
  const tokenBudget = tokenBudgetRaw ? Number(tokenBudgetRaw) : undefined;

  try {
    // Next 会把 framework 打进 server bundle，包内相对定位 wasm 必失败，
    // 必须显式注入真实资源目录（运行时 Node resolve，不经 bundler）
    const result = await renderRepoMap({
      root: activeWorkspaceRoot(),
      focus: focus || undefined,
      paths: paths?.length ? paths : undefined,
      tokenBudget: Number.isFinite(tokenBudget) && tokenBudget! >= 256 ? tokenBudget : undefined,
      vendorDirs: resolveFrameworkVendorDirs(),
    });
    return NextResponse.json({ ok: true, text: result.text, stats: result.stats });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "生成仓库地图失败" },
      { status: 500 },
    );
  }
}
