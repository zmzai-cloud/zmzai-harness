import { NextResponse, type NextRequest } from "next/server";

import { getPermissions, savePermissions } from "@/lib/settings";
import type { PermissionDomain, PermissionSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOMAINS: PermissionDomain[] = ["terminal", "edit", "task", "gitWrite"];

/** GET /api/settings/permissions — 读权限自动执行配置（缺省项 = ask 逐次确认）。 */
export async function GET() {
  return NextResponse.json({ permissions: getPermissions() });
}

/** PUT /api/settings/permissions — 部分更新：只接受已知域与合法档位。 */
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { permissions?: Record<string, unknown> } | null;
  const incoming = body?.permissions ?? {};
  const patch: PermissionSettings = {};
  for (const domain of DOMAINS) {
    const v = incoming[domain];
    if (v === "ask" || v === "auto") patch[domain] = v;
  }
  return NextResponse.json({ permissions: savePermissions(patch) });
}
