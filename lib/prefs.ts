/**
 * UI 偏好存取（localStorage，`lectern.*` 前缀）。
 * 读取时自动迁移旧 `harness.*` 键（品牌更名前的持久化键），迁移后即删旧键；
 * 迁移失败（隐私模式等）不影响读取结果。
 */
const PREFIX = "lectern.";
const LEGACY_PREFIX = "harness.";

export function readPref(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const hit = window.localStorage.getItem(PREFIX + key);
    if (hit !== null) return hit;
    const legacy = window.localStorage.getItem(LEGACY_PREFIX + key);
    if (legacy !== null) {
      window.localStorage.setItem(PREFIX + key, legacy);
      window.localStorage.removeItem(LEGACY_PREFIX + key);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 忽略：隐私模式 / 配额满等场景偏好不落盘 */
  }
}

export function clearPref(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREFIX + key);
    window.localStorage.removeItem(LEGACY_PREFIX + key);
  } catch {
    /* 忽略 */
  }
}
