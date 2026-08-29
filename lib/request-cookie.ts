import { AsyncLocalStorage } from "node:async_hooks";

import type { NextRequest } from "next/server";

/**
 * 请求级 cookie 上下文：harness 服务端是 relay 的代理面，浏览器把登录
 * cookie（muzhi_session）交给本域，每次请求时暂存到 AsyncLocalStorage，
 * 供 agent-framework 的 model provider 动态求值注入 relay 请求头。
 */
declare global {
  // eslint-disable-next-line no-var
  var __requestStore: AsyncLocalStorage<{ cookie: string | null }> | undefined;
}

/** 单例挂 globalThis：与 cloudRuntime 同理，避免 Next.js dev 热重载后
 *  路由模块与运行时闭包引用分裂成两个 AsyncLocalStorage（上下文丢失）。 */
export const requestStore: AsyncLocalStorage<{ cookie: string | null }> =
  (globalThis.__requestStore ??= new AsyncLocalStorage());

export function withRequestCookie<T>(cookie: string | null, fn: () => T): T {
  return requestStore.run({ cookie }, fn);
}

/** 当前请求携带的完整 cookie 头（如 "muzhi_session=abc"），无则 null。
 *  ⚠ 仅在 withRequestCookie 包裹的上下文（prompt 流）内有值；
 *  普通代理路由请用 sessionCookieFrom(request)。 */
export function currentCookieHeader(): string | null {
  return requestStore.getStore()?.cookie ?? null;
}

export const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "muzhi_session";

/** 从 NextRequest 直接取登录会话 cookie 头（如 "muzhi_session=abc"），无则 null。
 *  /api/models、/api/settings/keys 等一次性代理路由用这个——它们不在 ALS 上下文里，
 *  误用 currentCookieHeader 会恒 null（cookie 永不透传 → relay 恒 401「未接入 relay」）。 */
export function sessionCookieFrom(request: NextRequest): string | null {
  const v = request.cookies.get(sessionCookieName)?.value;
  return v ? `${sessionCookieName}=${v}` : null;
}
