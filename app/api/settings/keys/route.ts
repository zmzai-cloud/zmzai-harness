import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieFrom } from "@/lib/request-cookie";
import { keyPrefix, maskedKey, savePersonalKey } from "@/lib/settings";
import { relayControlBase } from "@/lib/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 与 relay 账号联动（relay key 只存 hash，已有 key 无法取明文）：
 * - GET  透传登录 cookie 拉取当前用户的 key 列表（prefix 掩码 + 状态 + 用量），
 *        并标注 harness 当前绑定的那条（prefix 匹配）。
 * - POST 登录态在 relay 侧签发名为 "harness" 的新 key（明文一次性返回），
 *        harness 端立即加密落盘——用户无需手动复制粘贴。
 */

export type RelayKeyItem = {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  quotaUsedTokens: number;
  monthlySpendUsedMicros: number;
  monthlySpendLimitMicros: number;
  lastUsedAt: string | null;
};

export async function GET(request: NextRequest) {
  // 直接从请求取登录 cookie（ALS 上下文只覆盖 prompt 流，这里用它会恒 null）
  const cookie = sessionCookieFrom(request);
  try {
    const res = await fetch(`${relayControlBase()}/me/keys`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ loggedIn: false, keys: [], currentPrefix: keyPrefix() });
    const data = (await res.json()) as { keys?: Record<string, unknown>[] };
    const keys: RelayKeyItem[] = (data.keys ?? []).map((k) => ({
      id: String(k._id),
      name: String(k.name ?? ""),
      prefix: String(k.prefix ?? ""),
      status: (k.status === "revoked" ? "revoked" : "active") as RelayKeyItem["status"],
      quotaUsedTokens: Number(k.quotaUsedTokens ?? 0),
      monthlySpendUsedMicros: Number(k.monthlySpendUsedMicros ?? 0),
      monthlySpendLimitMicros: Number(k.monthlySpendLimitMicros ?? 0),
      lastUsedAt: k.lastUsedAt ? String(k.lastUsedAt) : null,
    }));
    return NextResponse.json({ loggedIn: true, keys, currentPrefix: keyPrefix() });
  } catch {
    return NextResponse.json({ loggedIn: false, keys: [], currentPrefix: keyPrefix(), error: "relay 不可达" });
  }
}

export async function POST(request: NextRequest) {
  const cookie = sessionCookieFrom(request);
  if (!cookie) return NextResponse.json({ error: "需要先登录 relay（登录后可一键签发绑定）" }, { status: 401 });
  try {
    const res = await fetch(`${relayControlBase()}/me/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ name: "harness", allowedModels: [], rateLimitPerMinute: 240, monthlySpendLimitMicros: 0 }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { key?: string; error?: string } | null;
    if (!res.ok || !body?.key) {
      return NextResponse.json({ error: body?.error ?? `relay 签发失败（${res.status}）` }, { status: 502 });
    }
    // 明文只在服务端内存中转一次，立即加密落盘（.secret / AES-256-GCM）
    savePersonalKey(body.key);
    const { masked } = maskedKey();
    return NextResponse.json({ configured: true, masked: masked ?? null, prefix: keyPrefix() });
  } catch {
    return NextResponse.json({ error: "无法连接 relay，请确认端点配置" }, { status: 502 });
  }
}
