/** 基础常量（独立模块，避免 projects.ts ↔ runtime.ts 循环依赖）。 */
import { resolve } from "node:path";

export const dataDir = resolve(process.env.HARNESS_DATA_DIR ?? process.cwd(), "data");

export const defaultWorkspaceRoot = resolve(
  process.env.HARNESS_WORKSPACE ?? process.env.ZMZAI_WORKSPACE ?? resolve(process.cwd(), ".workspace"),
);
