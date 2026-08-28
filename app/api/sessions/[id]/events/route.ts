import { type NextRequest } from "next/server";

import { subscribeEventLog } from "@zmzai/agent-framework";

import { cloudRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE 事件流：UI 的 window.harness.subscribe 同构替代（EventSource）。 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runtime = cloudRuntime();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of subscribeEventLog(runtime.eventLog, id, { signal: request.signal })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }
      } catch {
        /* 客户端断开等异常：直接结束流 */
      }
      try {
        controller.close();
      } catch {
        /* 已关闭则忽略 */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
