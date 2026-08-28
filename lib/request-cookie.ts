import { AsyncLocalStorage } from "node:async_hooks";

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

/** 当前请求携带的完整 cookie 头（如 "muzhi_session=abc"），无则 null。 */
export function currentCookieHeader(): string | null {
  return requestStore.getStore()?.cookie ?? null;
}
