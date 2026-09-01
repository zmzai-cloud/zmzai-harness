import { NextResponse, type NextRequest } from "next/server";

import { sessionRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 跨会话恢复：读取某会话已持久化的转录（消息+片段）。
 *
 * 尾部分页（framework store 无分页接口，在本 route 切片——SQLite 本机读取
 * 微秒级，省的是传输量与前端投影态）：`?tail=50` 取最近 50 条；触顶加载更早
 * 时 `?tail=50&skip=<已取条数>` 再往前翻一页。响应带 total/hasMore。
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runtime = sessionRuntime(id);
  const messages = await runtime.store.getMessages(id);

  const url = new URL(request.url);
  const tailRaw = Number(url.searchParams.get("tail") ?? "0");
  if (!Number.isFinite(tailRaw) || tailRaw <= 0) {
    // 兼容：无参数 = 全量（旧语义）
    return NextResponse.json(messages);
  }
  const limit = Math.min(200, Math.floor(tailRaw));
  const skipRaw = Number(url.searchParams.get("skip") ?? "0");
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;

  const end = Math.max(0, messages.length - skip);
  const start = Math.max(0, end - limit);
  const page = messages.slice(start, end);
  return NextResponse.json({
    messages: page,
    total: messages.length,
    hasMore: start > 0,
  });
}
