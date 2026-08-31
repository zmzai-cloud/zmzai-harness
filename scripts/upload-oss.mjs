// harness 发布产物上传 OSS（阿里云，与 muzhi 同款 ali-oss / authorizationV4）。
//
// 用法（构建完成后）：
//   node scripts/upload-oss.mjs                     # 上传 dist/ 全部产物
//   node scripts/upload-oss.mjs --dry               # 只列出将上传的文件与目标 key
//   node scripts/upload-oss.mjs --prefix custom/    # 覆盖路径前缀
//
// 配置来源（优先级）：环境变量 > harness/.env.release。
// 必填：OSS_REGION（如 oss-cn-hangzhou）、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET
// 可选：OSS_ENDPOINT、OSS_PATH_PREFIX（默认 releases/harness）、OSS_PUBLIC_ACL（默认 true → 对象公共读）
//
// 对象级 ACL：bucket 可保持私有，上传时对单个对象设置 public-read，
// landing 的常驻直链才不会过期（muzhi 的材料下载是私有+签名 URL，两者用途不同）。
// 上传完成生成：dist/SHA256SUMS.txt（本地+远端各一份）与 dist/release-links.md（直链清单）。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const prefixIdx = args.indexOf("--prefix");
const prefixOverride = prefixIdx >= 0 ? args[prefixIdx + 1] : undefined;

// ── 配置加载 ──
function loadEnvRelease() {
  const path = resolve(process.cwd(), ".env.release");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const env = { ...loadEnvRelease(), ...process.env };
const required = ["OSS_REGION", "OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"];
const missing = required.filter((k) => !env[k] || /填你的|placeholder/i.test(env[k]));
if (missing.length) {
  console.error(`❌ OSS 配置缺失或仍是占位值：${missing.join(", ")}`);
  console.error("   请在 harness/.env.release（已 gitignore）或环境变量中填写真实值。");
  console.error("   模板见 scripts/.env.release.example。");
  process.exit(1);
}

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const prefix = (prefixOverride ?? env.OSS_PATH_PREFIX ?? "releases/harness").replace(/^\/|\/$/g, "");
const keyBase = `${prefix}/v${version}`;
const usePublicAcl = (env.OSS_PUBLIC_ACL ?? "true") !== "false";
const distDir = resolve(process.cwd(), "dist");

// ── 产物清单 ──
const patterns = [/\.dmg$/, /\.zip$/, /\.exe$/, /^SHA256SUMS\.txt$/];
const files = readdirSync(distDir).filter((f) => {
  const st = statSync(join(distDir, f));
  return st.isFile() && patterns.some((re) => re.test(f));
});
if (!files.length) {
  console.error(`❌ dist/ 下没有可发布的产物（.dmg/.zip/.exe）。先跑 pnpm build:mac / build:win。`);
  process.exit(1);
}

// ── SHA256 清单 ──
const sums = files
  .filter((f) => f !== "SHA256SUMS.txt")
  .sort()
  .map((f) => {
    const buf = readFileSync(join(distDir, f));
    return `${createHash("sha256").update(buf).digest("hex")}  ${f}`;
  })
  .join("\n");
writeFileSync(join(distDir, "SHA256SUMS.txt"), sums + "\n");
if (!files.includes("SHA256SUMS.txt")) files.push("SHA256SUMS.txt");

const host = `${env.OSS_BUCKET}.${env.OSS_REGION}.aliyuncs.com`;
const links = files
  .slice()
  .sort()
  .map((f) => `- ${encodeURI(`https://${host}/${keyBase}/${f}`)}`);

console.log(`版本 v${version} · 目标 ${env.OSS_BUCKET}.${env.OSS_REGION}.aliyuncs.com/${keyBase}/`);
console.log(files.map((f) => `  · ${f}`).join("\n"));
if (dry) {
  console.log("\n(dry-run：未实际上传)");
  process.exit(0);
}

// ── 上传 ──
const { default: OSS } = await import("ali-oss");
const client = new OSS({
  region: env.OSS_REGION,
  bucket: env.OSS_BUCKET,
  endpoint: env.OSS_ENDPOINT || undefined,
  accessKeyId: env.OSS_ACCESS_KEY_ID,
  accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
  stsToken: env.OSS_SESSION_TOKEN || undefined,
  secure: true,
  // authorizationV4: true, // 用默认 V3（V4 未真实验证）
});

const headers = { "Content-Type": "application/octet-stream" };
if (usePublicAcl) headers["x-oss-object-acl"] = "public-read";

let failed = 0;
for (const f of files) {
  const key = `${keyBase}/${f}`;
  try {
    process.stdout.write(`↑ ${f} … `);
    await client.put(key, join(distDir, f), { headers });
    console.log("OK");
  } catch (err) {
    failed += 1;
    console.log(`失败（${err.code ?? err.message}）`);
  }
}
if (failed) {
  console.error(`\n❌ ${failed} 个文件上传失败，修正后重跑（已成功的会覆盖，幂等）。`);
  process.exit(1);
}

// ── 直链清单 ──
writeFileSync(
  join(distDir, "release-links.md"),
  `# zmzai Harness v${version} 下载直链\n\n${links.join("\n")}\n`,
);
console.log(`\n✅ 全部上传完成。直链清单已写入 dist/release-links.md：\n`);
console.log(links.join("\n"));
console.log(`\n下一步：把上述链接更新进 landing page 的下载区（zmzai-harness-landing.html），并发布 GitHub Release 归档。`);
