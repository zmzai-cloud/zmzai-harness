/**
 * 个人 key 与本地设置（dataDir/settings.json，0600）。
 * 个人 key = relay 签发的 zrk_ key：配置后 harness 以 OpenAI 兼容 Bearer 方式
 * 直连 relay（不再依赖浏览器登录 cookie），用量计入用户 relay 账户。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "./runtime-constants";

const settingsFile = resolve(dataDir, "settings.json");

export type HarnessSettings = { personalKey?: string; relayUrl?: string };

function read(): HarnessSettings {
  try {
    if (!existsSync(settingsFile)) return {};
    return JSON.parse(readFileSync(settingsFile, "utf8")) as HarnessSettings;
  } catch {
    return {};
  }
}

function write(next: HarnessSettings) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function getSettings(): HarnessSettings {
  return read();
}

/** 掩码展示（UI 只回显尾部 4 位）。 */
export function maskedKey(): { configured: boolean; masked?: string } {
  const key = read().personalKey;
  if (!key) return { configured: false };
  return { configured: true, masked: `${key.slice(0, 4)}****${key.slice(-4)}` };
}

export function savePersonalKey(key: string | null, relayUrl?: string | null) {
  const next = read();
  if (key === null) delete next.personalKey;
  else next.personalKey = key.trim();
  if (relayUrl != null) next.relayUrl = relayUrl.trim() || undefined;
  write(next);
}

/** LLM 请求头：个人 key 优先（Bearer），否则透传浏览器登录 cookie。 */
export function authHeaders(cookie: string | null): Record<string, string> {
  const { personalKey } = read();
  if (personalKey) return { authorization: `Bearer ${personalKey}` };
  return cookie ? { cookie } : {};
}
