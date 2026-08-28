import { NextResponse, type NextRequest } from "next/server";

import { resolveAgents, sessionCookieName } from "@/lib/relay";
import type { AgentInfo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 模型目录（relay 用户配置）→ AgentInfo 列表，UI 侧栏「代理」即模型选择。 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(sessionCookieName)?.value;
  const agents = await resolveAgents(cookie ? `${sessionCookieName}=${cookie}` : null);
  const list: AgentInfo[] = agents.map((a) => ({
    name: a.name,
    description: a.description,
    mode: "primary",
    model: { providerId: "openai", modelId: a.model },
    permission: [],
  }));
  return NextResponse.json(list);
}
