/**
 * 交付路径安全守卫（纯函数，无 IO）：
 * required 命令的 cwd 只允许 root-relative 路径，服务端 canonical resolve 后
 * 必须仍在当前 effective workspace root 内；拒绝绝对路径、`..`、symlink escape
 * 和跨 session/worktree。
 *
 * 独立成模块以便脱离 SQLite 依赖单独单测（delivery.ts 会 import node:sqlite，
 * 而 vitest 对 node:sqlite 的转译有兼容性问题，路径守卫不值得为此被牵连）。
 */
import { isAbsolute, resolve, sep } from "node:path";

/**
 * 把 required 命令的 cwdRelativePath 解析为 root 内的绝对路径。
 * @throws 绝对路径、`..` 逃逸、symlink escape、跨 root 时抛错。
 */
export function resolveCwdWithin(root: string, cwdRelativePath: string | null | undefined): string {
  const rel = (cwdRelativePath ?? "").trim();
  if (rel === "" || rel === ".") return resolve(root);
  if (isAbsolute(rel)) throw new Error("cwd 必须是 root 相对路径，不接受绝对路径");
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel);
  // 拒绝越出 root（含 .. 逃逸）
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error("cwd 越出当前工作区 root");
  }
  return abs;
}
