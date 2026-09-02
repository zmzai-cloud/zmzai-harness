/**
 * 输出脱敏与容量限额（写入前统一处理）。
 *
 * 对应设计文档「权限、安全与失败降级」：stdout/stderr/console/error/请求 URL
 * 在写入前使用统一脱敏器处理，再受最大容量限制；超额内容截断并保留
 * truncated 元数据，不允许用未脱敏原文重读或重新注入。
 *
 * P0 只做本地可得的最小脱敏：脱敏常见 secret 形态（KEY=value、Bearer token、
 * 常见云密钥前缀、连接串口令）。浏览器 QA / .env 回显留待 P1。
 */
import { createHash } from "node:crypto";

/** 单条命令输出上限（字节，UTF-8）。 */
export const COMMAND_OUTPUT_CAP = 2 * 1024 * 1024; // 2 MiB

/** 单 attempt 文本总量上限（字节，UTF-8）。 */
export const ATTEMPT_TEXT_CAP = 8 * 1024 * 1024; // 8 MiB

/** 脱敏占位符。 */
export const REDACTED = "[redacted]";

/** 一组「形如 secret 的片段」匹配规则：命中即替换为 REDACTED。 */
const SECRET_PATTERNS: RegExp[] = [
  // KEY=VALUE（含空格变体），value 非空即视为潜在 secret
  /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD))(\s*[:=]\s*)([^\s,;"']+)/gi,
  // Bearer / token 前缀
  /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // 云密钥：AKIA / sk- / ghp_ / glpat- / xox[bap]- 等常见前缀
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{16,}\b/g,
  /\bglpat-[A-Za-z0-9\-_]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/g,
  // 连接串口令：mongodb://user:pass@host 或 postgres://user:pass@host
  /\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^:@\s]+:[^@\s]+@/gi,
];

/** 对单段文本做脱敏。纯函数、幂等。 */
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, key?: string, sep?: string, _value?: string) => {
      // KEY=VALUE 形态：保留 key 名便于定位，值脱敏
      if (key && sep !== undefined) return `${key}${sep}${REDACTED}`;
      // 前缀形态：保留可识别的安全前缀，其余脱敏
      return `${match.slice(0, Math.min(4, match.length))}${REDACTED}`;
    });
  }
  return out;
}

export type SanitizeResult = {
  output: string;
  truncated: boolean;
  /** 原始 UTF-8 字节数（截断前）。 */
  outputBytes: number;
};

/** 脱敏 + 容量限额。超限截断并标记 truncated，保留原始字节数。 */
export function sanitizeOutput(raw: string, cap = COMMAND_OUTPUT_CAP): SanitizeResult {
  const redacted = redact(raw);
  const bytes = Buffer.byteLength(redacted, "utf8");
  if (bytes <= cap) {
    return { output: redacted, truncated: false, outputBytes: bytes };
  }
  // 截断到 cap 字节内（按字节切，避免破坏多字节字符——用安全截断）
  const truncated = truncateToBytes(redacted, cap);
  return { output: truncated, truncated: true, outputBytes: bytes };
}

/** 按字节数安全截断（不截断多字节 UTF-8 序列的中间）。 */
export function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  // 后退到合法字符边界：UTF-8 连续字节（10xxxxxx）是某字符的中间/尾字节，
  // 必须继续退到该字符的首字节（0xxxxxxx / 110xxxxx / 1110xxxx / 11110xxx）。
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

/** 计算文本的稳定 sha256 指纹（EvidencePacket 去重用）。 */
export function fingerprintOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
