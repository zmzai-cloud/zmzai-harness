#!/usr/bin/env node
/** 构建后断言：standalone 产物里不得混入本机数据。
 *
 * 背景：Next 的 standalone 文件追踪会按 `outputFileTracingRoot`（= 仓库根）把
 * `data/**` 复制进 `.next/standalone/data/`，而仓库根的 data/ 是历史遗留的老
 * 数据目录（已 gitignore），里面是开发者的真实会话库（zmzai.db / *.jsonl）与
 * 本地密钥材料 .secret。一旦混入就会随安装包公开发布 —— v0.2.0 至 v0.4.3 的
 * 双平台产物全部中招，只能全线下架重发。
 *
 * next.config.mjs 的 outputFileTracingExcludes 是主防线，本脚本是兜底：
 * 任何一层失效都会让打包在发布前失败，而不是带着隐私数据发出去。
 *
 * 用法：node scripts/check-standalone-clean.mjs [--dir <standalone 路径>]
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dirIdx = process.argv.indexOf("--dir");
const standalone =
  dirIdx >= 0 ? resolve(process.argv[dirIdx + 1]) : resolve(process.cwd(), ".next", "standalone");

if (!existsSync(standalone)) {
  console.error(`❌ 找不到 standalone 目录：${standalone}`);
  process.exit(1);
}

// 出现任一特征即视为混入了本机数据
const FORBIDDEN_NAMES = new Set([".secret", "settings.json", "projects.json", "zmzai.db"]);
const FORBIDDEN_SUFFIX = [".db", ".db-shm", ".db-wal", ".jsonl"];
const FORBIDDEN_DIRS = new Set(["data", "sessions", "messages", "parts"]);

const hits = [];

function walk(dir, depth, relBase) {
  if (depth > 4) return; // 只查浅层，node_modules 无需遍历
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (depth === 0 && (name === "node_modules" || name === ".next")) continue;
    const full = join(dir, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (depth === 0 && FORBIDDEN_DIRS.has(name)) {
        hits.push(`${rel}/（目录）`);
        continue;
      }
      walk(full, depth + 1, rel);
      continue;
    }
    if (FORBIDDEN_NAMES.has(name)) hits.push(rel);
    else if (FORBIDDEN_SUFFIX.some((s) => name.endsWith(s))) hits.push(rel);
  }
}

walk(standalone, 0, "");

if (hits.length > 0) {
  console.error("❌ standalone 产物中检测到疑似本机数据，禁止打包：\n");
  for (const h of hits.slice(0, 40)) console.error(`   · ${h}`);
  if (hits.length > 40) console.error(`   … 另有 ${hits.length - 40} 项`);
  console.error(
    "\n排查：仓库根 data/ 是否被 Next 文件追踪带进来了？\n" +
      "      next.config.mjs 的 outputFileTracingExcludes 是否生效？\n" +
      "      如确需发布，请先确认这些文件不含任何私有数据。",
  );
  process.exit(1);
}

console.log("✅ standalone 产物干净（无 .secret / 会话库 / 本机数据）");
