import { NextResponse } from "next/server";

import { sessionRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type UsageInfo = {
  used: number;
  contextWindow: number;
  input: number;
  output: number;
  cacheRead: number;
  steps: number;
};

type TokenShape = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };

/** 兼容两种事件形状（tokens 在事件本体或 data 里）。 */
function tokensOf(event: { type?: string; tokens?: TokenShape; data?: unknown }): TokenShape | null {
  if (event.type !== "step-finish") return null;
  if (event.tokens) return event.tokens;
  const data = event.data as { tokens?: TokenShape } | undefined;
  return data?.tokens ?? null;
}

/** 会话上下文用量（composer 的上下文条数据源）。
 *  语义：以最近一次 step-finish 为准——LLM 每次请求的 input 即全量上下文，
 *  input + cacheRead + output ≈ 当前窗口占用。事件日志在内存（重启归零，UI 显示 0%）。 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runtime = sessionRuntime(id);
  const contextWindow = Number(process.env.LECTERN_CONTEXT_WINDOW ?? process.env.HARNESS_CONTEXT_WINDOW ?? 128_000);
  try {
    const events = await runtime.eventLog.read(id, 0, 5000);
    let last: TokenShape | null = null;
    let steps = 0;
    for (const event of events as Array<{ type?: string; tokens?: TokenShape; data?: unknown }>) {
      const tokens = tokensOf(event);
      if (tokens) {
        last = tokens;
        steps += 1;
      }
    }
    if (!last) {
      return NextResponse.json({ used: 0, contextWindow, input: 0, output: 0, cacheRead: 0, steps: 0 } satisfies UsageInfo);
    }
    const input = last.input ?? 0;
    const output = last.output ?? 0;
    const cacheRead = last.cacheRead ?? 0;
    return NextResponse.json({
      used: input + output + cacheRead,
      contextWindow,
      input,
      output,
      cacheRead,
      steps,
    } satisfies UsageInfo);
  } catch {
    return NextResponse.json({ used: 0, contextWindow, input: 0, output: 0, cacheRead: 0, steps: 0 } satisfies UsageInfo);
  }
}
