import { NextResponse, type NextRequest } from "next/server";

import { resolveModel, sessionCookieName } from "@/lib/relay";
import { cloudRuntime } from "@/lib/runtime";
import { withRequestCookie } from "@/lib/request-cookie";
import { generateSessionTitle } from "@/lib/session-title";

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

  // 自动标题（两段式）：①先落占位标题（首条消息摘要，立即生效不叫「新会话」）；
  // ②prompt 发出后异步调 LLM 生成 AI 摘要标题覆盖（见 lib/session-title.ts）。
  // 生成失败保留占位；用户已手动改名则不覆盖。
  let autoTitleSeed: string | null = null;
  try {
    const ses = await runtime.store.getSession(id);
    if (ses && (!ses.title || ses.title === "新会话")) {
      const seed = text || (images.length ? "[图片消息]" : "");
      if (seed) {
        autoTitleSeed = seed.replace(/\s+/g, " ").slice(0, 30);
        await runtime.store.updateSession(id, { title: autoTitleSeed });
      }
    }
  } catch {
    /* 占位标题失败不阻塞发送 */
  }

  try {
    await withRequestCookie(cookieHeader, () =>
      runtime.runner.prompt(id, { text, agent: body?.agent, model, images, ...(effort ? { effort } : {}) }),
    );
    // AI 摘要标题：后台生成不阻塞响应；仅当标题仍是占位时覆盖
    if (autoTitleSeed && text) {
      void generateSessionTitle(runtime, id, text)
        .then((title) => {
          if (!title) return undefined;
          return runtime.store.getSession(id).then((ses) => {
            if (ses && ses.title === autoTitleSeed) return runtime.store.updateSession(id, { title });
            return undefined;
          });
        })
        .catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "发送失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
