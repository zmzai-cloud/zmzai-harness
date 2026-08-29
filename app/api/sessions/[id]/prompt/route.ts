import { NextResponse, type NextRequest } from "next/server";

import { resolveModel, sessionCookieName } from "@/lib/relay";
import { cloudRuntime } from "@/lib/runtime";
import { withRequestCookie } from "@/lib/request-cookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 推理力度档位（N3）：与 framework ThinkingEffort 对齐；off = 不发字段。 */
const EFFORTS = ["off", "minimal", "low", "medium", "high"] as const;
type Effort = (typeof EFFORTS)[number];

/** 发送提示词：进入 agent-framework runner，推理经 relay（cookie 透传）。 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    text?: string;
    agent?: string;
    model?: { providerId: string; modelId: string };
    images?: { url: string; mediaType: string }[];
    effort?: string;
  } | null;
  const text = body?.text?.trim() ?? "";
  const effort = (EFFORTS as readonly string[]).includes(body?.effort ?? "") ? (body?.effort as Effort) : undefined;
  const images = (body?.images ?? []).filter(
    (im) => typeof im?.url === "string" && im.url.length > 0 && im.url.length < 8_000_000 && /^image\//.test(im.mediaType ?? ""),
  );
  if (!text && images.length === 0) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }

  const cookie = request.cookies.get(sessionCookieName)?.value;
  const cookieHeader = cookie ? `${sessionCookieName}=${cookie}` : null;

  const model = body?.model ?? (await resolveModel(body?.agent, cookieHeader));
  const runtime = cloudRuntime();

  try {
    await withRequestCookie(cookieHeader, () =>
      runtime.runner.prompt(id, { text, agent: body?.agent, model, images, ...(effort ? { effort } : {}) }),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "发送失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
