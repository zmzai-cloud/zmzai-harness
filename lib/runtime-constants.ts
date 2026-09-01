/** 基础常量（独立模块，避免 projects.ts ↔ runtime.ts 循环依赖）。
 *  env 前缀已从 HARNESS_* 更名为 LECTERN_*（品牌更名第二阶段）；
 *  保留旧前缀兜底读取，已部署的 .env / 启动脚本不失效。 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * 数据目录解析（会话稳定性 P0-①）：
 *
 * 旧实现 `process.cwd()/data` 会让会话库随启动方式漂移——`next dev`（repo 根）、
 * 项目子目录启动、standalone 启动各得一套互不相通的库，表现为"重启后历史会话丢失"。
 *
 * 新实现固定到平台用户目录（与 Electron 打包版 userData/data 完全一致，打包版
 * 仍以 LECTERN_DATA_DIR 显式注入同一位置）：dev 与打包版、任意启动方式读写同一库。
 * LECTERN_DATA_DIR / HARNESS_DATA_DIR 仍可显式覆盖（迁移脚本、测试用）。
 */
function platformDataRoot(): string {
  const override = process.env.LECTERN_DATA_DIR ?? process.env.HARNESS_DATA_DIR;
  if (override) return resolve(override);
  switch (process.platform) {
    case "win32":
      // Electron userData on Windows = %APPDATA%/<productName>
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Lectern");
    case "darwin":
      // Electron userData on macOS = ~/Library/Application Support/<productName>
      return join(homedir(), "Library", "Application Support", "Lectern");
    default:
      // Linux: XDG 规范（Electron userData = $XDG_CONFIG_HOME/<productName>，
      // 数据放 XDG_DATA 侧更合适，lectern 小写命名）
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "lectern");
  }
}

export const dataDir = resolve(platformDataRoot(), "data");

export const defaultWorkspaceRoot = resolve(
  process.env.LECTERN_WORKSPACE ??
    process.env.HARNESS_WORKSPACE ??
    process.env.ZMZAI_WORKSPACE ??
    resolve(process.cwd(), ".workspace"),
);
