import { NextResponse, type NextRequest } from "next/server";

import { listPermissionAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 权限审计日志（设置 → 通用 → 权限日志）。可选 permission 过滤。 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const permission = url.searchParams.get("permission") ?? undefined;
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? "200") || 200);
  return NextResponse.json({ rows: listPermissionAudit(limit, permission || undefined) });
}
