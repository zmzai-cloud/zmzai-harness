#!/usr/bin/env node
/** 删除 OSS 上某个版本的全部发布对象（下架用，配合 GitHub Release 删除）。
 *
 * 用法：
 *   node scripts/delete-oss-version.mjs v0.4.3          # 删除该版本目录下所有对象
 *   node scripts/delete-oss-version.mjs v0.4.3 --dry    # 只列出将删除的对象
 *
 * 配置来源与 upload-oss.mjs 一致（环境变量 > lectern/.env.release）。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const version = args.find((a) => !a.startsWith("--"));
if (!version) {
  console.error("用法：node scripts/delete-oss-version.mjs <v0.4.3> [--dry]");
  process.exit(1);
}

function loadEnvRelease() {
  const p = resolve(process.cwd(), ".env.release");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const env = { ...loadEnvRelease(), ...process.env };
const required = ["OSS_REGION", "OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`❌ OSS 配置缺失：${missing.join(", ")}`);
  process.exit(1);
}

const prefix = env.OSS_PATH_PREFIX ?? "releases/harness";
const keyBase = `${prefix}/${version}`.replace(/\/+$/, "");

const { default: OSS } = await import("ali-oss");
const client = new OSS({
  region: env.OSS_REGION,
  bucket: env.OSS_BUCKET,
  endpoint: env.OSS_ENDPOINT || undefined,
  accessKeyId: env.OSS_ACCESS_KEY_ID,
  accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
  stsToken: env.OSS_SESSION_TOKEN || undefined,
  secure: true,
  timeout: 600000,
});

// 列举该前缀下所有对象（分页，最多 1000/页）
const keys = [];
let marker = null;
for (;;) {
  const res = await client.list({ prefix: `${keyBase}/`, "max-keys": 1000, marker }, {});
  const objects = res.objects ?? [];
  keys.push(...objects.map((o) => o.name));
  if (!res.isTruncated || objects.length === 0) break;
  marker = res.nextMarker;
}

if (keys.length === 0) {
  console.log(`${keyBase}/ 下没有对象。`);
  process.exit(0);
}

console.log(`${dry ? "[dry] 将删除" : "删除"} ${keyBase}/ 下 ${keys.length} 个对象：`);
for (const k of keys) console.log(`  · ${k}`);
if (dry) {
  console.log("\n(dry-run：未实际删除)");
  process.exit(0);
}

let failed = 0;
for (const k of keys) {
  try {
    await client.delete(k);
    console.log(`✗ ${k} 已删除`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${k} 失败（${err.code ?? err.message}）`);
  }
}
console.log(failed ? `\n❌ ${failed} 个删除失败` : `\n✅ 全部删除完成`);
process.exit(failed ? 1 : 0);
