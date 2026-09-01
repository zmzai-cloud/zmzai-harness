/** 基础常量（独立模块，避免 projects.ts ↔ runtime.ts 循环依赖）。
 *  env 前缀已从 HARNESS_* 更名为 LECTERN_*（品牌更名第二阶段）；
 *  保留旧前缀兜底读取，已部署的 .env / 启动脚本不失效。 */
import { resolve } from "node:path";

export const dataDir = resolve(
  process.env.LECTERN_DATA_DIR ?? process.env.HARNESS_DATA_DIR ?? process.cwd(),
  "data",
);

export const defaultWorkspaceRoot = resolve(
  process.env.LECTERN_WORKSPACE ??
    process.env.HARNESS_WORKSPACE ??
    process.env.ZMZAI_WORKSPACE ??
    resolve(process.cwd(), ".workspace"),
);
