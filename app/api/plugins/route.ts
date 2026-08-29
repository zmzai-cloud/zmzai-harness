import { NextResponse, type NextRequest } from "next/server";

import { installPluginFromPath, listPlugins, uninstallPlugin } from "@/lib/plugins";
import { activeWorkspaceRoot, mcpRescan } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 已安装插件清单（全局 + 项目级，P1）。 */
export async function GET() {
  return NextResponse.json({ plugins: listPlugins(activeWorkspaceRoot()) });
}

/** 安装插件：body { sourcePath }（本地插件目录，须含合法 plugin.json）。
 *  安装后自动重扫 MCP（插件的 mcpServers 即刻生效）。 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { sourcePath?: string; action?: string; name?: string };
  const workspaceRoot = activeWorkspaceRoot();

  if (body.action === "uninstall" && body.name) {
    const removed = uninstallPlugin(body.name, workspaceRoot);
    if (removed) await mcpRescan(workspaceRoot).catch(() => undefined);
    return NextResponse.json({ ok: removed, ...(removed ? {} : { error: "项目级插件不存在" }) });
  }

  if (!body.sourcePath) {
    return NextResponse.json({ error: "缺少 sourcePath（本地插件目录）" }, { status: 400 });
  }
  const result = installPluginFromPath(body.sourcePath, workspaceRoot);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await mcpRescan(workspaceRoot).catch(() => undefined);
  return NextResponse.json({ ok: true, plugin: result.plugin });
}
