/**
 * relay / muzhi 的 HTTP 客户端（服务端专用，Node 环境）。
 * relay 以登录 cookie（muzhi_session）鉴权——harness 服务端把浏览器
 * 同域 cookie 透传过去，即「登录一次，全链路可用」。
 */

// relay 端点优先 RELAY_URL，其次与 LLM provider 同源的 OPENAI_BASE_URL，兜底本机
const relayBaseRaw = process.env.RELAY_URL ?? process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:3003/api/v1";
export const relayBase = relayBaseRaw.replace(/\/$/, "");
export const muzhiBase = (process.env.MUZHI_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
export const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "muzhi_session";

export type RelayModel = {
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  allowedReasoningEfforts?: string[];
};

export type ModelSelectorData = {
  featured: { id: string; name: string; description?: string; channel: string; maxInputTokens: number; maxOutputTokens: number; allowedReasoningEfforts: string[] }[];
  channels: { id: string; name: string; models: { id: string; name: string; channel?: string; meta?: Record<string, string>; maxInputTokens: number; maxOutputTokens: number; allowedReasoningEfforts: string[] }[] }[];
};

export type ModelsResponse = { models: RelayModel[]; modelSelectorData: ModelSelectorData };

/** 调 relay 的 GET 接口；cookie 为 null 时同样发请求（relay 会 401）。 */
export async function relayGet<T>(path: string, cookie: string | null): Promise<T | null> {
  try {
    const res = await fetch(`${relayBase}${path}`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 登录态探测：relay /models 返回 200 即已登录（cookie 有效）。 */
export async function relayAuthStatus(cookie: string | null): Promise<{ loggedIn: boolean; cookieName: string }> {
  const data = await relayGet<ModelsResponse>("/models", cookie);
  return { loggedIn: data !== null, cookieName: sessionCookieName };
}

/** 模型目录 + 用户配置（featured/channels），未登录返回 null。 */
export function relayModels(cookie: string | null): Promise<ModelsResponse | null> {
  return relayGet<ModelsResponse>("/models", cookie);
}

/** 把 relay 模型目录映射为 UI 的 AgentInfo 列表：优先用户配置的 featured
 *  模型，fallback 全量模型；空目录时兜底 default。 */
export async function resolveAgents(cookie: string | null): Promise<{ name: string; description?: string; model: string }[]> {
  const data = await relayModels(cookie);
  if (data) {
    const featured = data.modelSelectorData?.featured ?? [];
    const agents = featured.length
      ? featured.map((m) => ({ name: m.id, model: m.id, description: m.description }))
      : (data.models ?? []).map((m) => ({ name: m.model, model: m.model }));
    if (agents.length) return agents;
  }
  return [{ name: "default", model: process.env.OPENAI_MODEL ?? "deepseek-chat" }];
}

/** 按 agent 名解析模型引用（服务端用，查不到走 env 默认）。 */
export async function resolveModel(agent: string | undefined, cookie: string | null): Promise<{ providerId: string; modelId: string } | undefined> {
  if (!agent) return undefined;
  const agents = await resolveAgents(cookie);
  const hit = agents.find((a) => a.name === agent);
  return hit ? { providerId: "openai", modelId: hit.model } : undefined;
}

/**
 * 转发 muzhi 登录（POST /api/auth/login）。muzhi 的 CSRF 校验要求
 * Origin 与目标同源——服务端转发时显式带上 Origin 头。
 * 成功时返回响应里的全部 Set-Cookie，由调用方写回浏览器（harness 域）。
 */
export async function muzhiLogin(email: string, password: string): Promise<{
  ok: boolean;
  status: number;
  setCookies: string[];
  body: { error?: string } | null;
}> {
  try {
    const res = await fetch(`${muzhiBase}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: muzhiBase,
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: res.ok,
      status: res.status,
      setCookies: res.headers.getSetCookie?.() ?? [],
      body,
    };
  } catch {
    return { ok: false, status: 502, setCookies: [], body: { error: "无法连接 muzhi，请确认服务已启动" } };
  }
}
