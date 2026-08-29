import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieFrom } from "@/lib/request-cookie";
import { authHeaders, ollamaBase } from "@/lib/settings";
import { failoverLog } from "@/lib/runtime";
import { relayBase } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** relay 模型目录（composer 模型选择器数据源）+ 本地 Ollama 模型合并。
 *  鉴权：个人 key（Bearer）优先，否则透传登录 cookie；两者皆无时 relay 401 → 空列表。
 *  Ollama 在线时其模型以 providerId=ollama 的 ModelRef 追加（runtime 侧分流到本地端点）。 */
export async function GET(request: NextRequest) {
  // 直接从请求取登录 cookie（ALS 上下文只覆盖 prompt 流，这里用它会恒 null）
  const headers = authHeaders(sessionCookieFrom(request));
  let relay: object = { models: [], modelSelectorData: null, authenticated: false };
  try {
    const res = await fetch(`${relayBase()}/models`, { headers, cache: "no-store" });
    // relay 成功响应不含 authenticated 字段，需显式补上（否则 composer 误判未接入）
    if (res.ok) relay = { ...(await res.json() as object), authenticated: true };
  } catch {
    // relay 不可达：保留空目录，Ollama 模型仍可用
  }

  // 本地 Ollama（N2b）：/api/tags 枚举已装模型，2s 超时不拖累目录加载
  const base = ollamaBase();
  let ollama: { baseUrl: string; models: { id: string; name: string }[] } | null = null;
  if (base) {
    try {
      const tagsBase = base.replace(/\/v1$/, "");
      const res = await fetch(`${tagsBase}/api/tags`, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        const data = (await res.json()) as { models?: { name: string }[] };
        const models = (data.models ?? []).map((m) => ({ id: m.name, name: m.name }));
        if (models.length > 0) ollama = { baseUrl: base, models };
      }
    } catch {
      // Ollama 未启动：静默跳过
    }
  }

  return NextResponse.json({ ...relay, ollama, failover: failoverLog() });
}
