#!/usr/bin/env node
/** 会话库合并迁移（会话稳定性 P0-②，一次性 / 可重复执行）。
 *
 * 背景：runtime-constants 旧实现 dataDir = process.cwd()/data，会话库随启动
 * 目录漂移，历史上产生了多套互不相通的库（zmzai-lectern/data、workspace 根
 * data/...）。新实现固定到平台用户目录（与 Electron 打包版 userData/data 一致）。
 *
 * 本脚本把候选源里的所有会话库（默认库 + projects/<id> 分库）与旧 JSONL
 * 按会话/消息/部件合并到目标库：
 * - 只复制，绝不删除/修改源（源目录原样保留，可人工核查后自行处理）；
 * - 幂等：重复执行零变更（sessions 按 updated 取新，messages/parts 按 id 去重）；
 * - projects.json 合并去重（按项目 id），activeId 保留目标侧已有值。
 *
 * 用法（node >= 22，node:sqlite）：
 *   node scripts/migrate-data.mjs                 # 默认源 = <repo>/data 与 <repo>/../data
 *   node scripts/migrate-data.mjs --from /a/data --from /b/data
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- 目标目录：与 lib/runtime-constants.ts 的平台解析保持一致 ----
function platformDataRoot() {
  const override = process.env.LECTERN_DATA_DIR ?? process.env.HARNESS_DATA_DIR;
  if (override) return resolve(override);
  switch (process.platform) {
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Lectern");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Lectern");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "lectern");
  }
}
const targetRoot = resolve(platformDataRoot(), "data");

// ---- 源目录 ----
const fromArgs = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--from") fromArgs.push(resolve(process.argv[++i]));
}
const sources = (fromArgs.length > 0
  ? fromArgs
  : [resolve(repoRoot, "data"), resolve(repoRoot, "..", "data")]
).filter((dir) => existsSync(dir));

const dbs = []; // { dbPath, targetDir }
for (const src of sources) {
  if (existsSync(join(src, "zmzai.db"))) dbs.push({ dbPath: join(src, "zmzai.db"), targetDir: targetRoot });
  const projectsDir = join(src, "projects");
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir)) {
      const dbPath = join(projectsDir, entry, "zmzai.db");
      if (existsSync(dbPath)) dbs.push({ dbPath, targetDir: join(targetRoot, "projects", entry) });
    }
  }
}

console.log(`目标库目录: ${targetRoot}`);
console.log(`候选源: ${sources.join(", ") || "(无)"}`);
if (dbs.length === 0) {
  console.log("没有发现可迁移的 zmzai.db，结束。");
  process.exit(0);
}

mkdirSync(targetRoot, { recursive: true });

const stats = { sessions: 0, messages: 0, parts: 0, jsonl: 0 };

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return db;
}

/** 把源库 src 的三张表合并进目标库 dst。 */
function mergeInto(dst, src) {
  const tables = [
    ["sessions", "(id, user_id, workspace_id, updated, json)", "?, ?, ?, ?, ?", true,
      "user_id = excluded.user_id, workspace_id = excluded.workspace_id, updated = excluded.updated, json = excluded.json",
      (r) => [r.id, r.userId, r.workspaceId, r.time?.updated ?? "", JSON.stringify(r)]],
    ["messages", "(id, session_id, created, json)", "?, ?, ?, ?", false, null,
      (r) => [r.id, r.sessionId, r.time?.created ?? "", JSON.stringify(r)]],
    ["parts", "(id, session_id, message_id, json)", "?, ?, ?, ?", false, null,
      (r) => [r.id, r.sessionId, r.messageId, JSON.stringify(r)]],
  ];
  for (const [table, columns, holders, preferNewer, updateSet, toParams] of tables) {
    const rows = src.prepare(`SELECT json FROM ${table}`).all();
    let copied = 0;
    for (const row of rows) {
      let record;
      try {
        record = JSON.parse(row.json);
      } catch {
        continue;
      }
      const insert =
        preferNewer
          ? `INSERT INTO ${table} ${columns} VALUES (${holders}) ON CONFLICT(id) DO UPDATE SET ${updateSet} WHERE excluded.updated > sessions.updated`
          : `INSERT INTO ${table} ${columns} VALUES (${holders}) ON CONFLICT(id) DO NOTHING`;
      const result = dst.prepare(insert).run(...toParams(record));
      copied += Number(result.changes);
    }
    stats[table] += copied;
  }
}

/** 旧 JSONL 目录合并（sessions/ messages/ parts/*.json）。 */
function mergeJsonl(dst, dataDir) {
  for (const [dir, table, columns, toParams] of [
    ["sessions", "sessions", "(id, user_id, workspace_id, updated, json)", (r) => [r.id, r.userId, r.workspaceId, r.time?.updated ?? "", JSON.stringify(r)]],
    ["messages", "messages", "(id, session_id, created, json)", (r) => [r.id, r.sessionId, r.time?.created ?? "", JSON.stringify(r)]],
    ["parts", "parts", "(id, session_id, message_id, json)", (r) => [r.id, r.sessionId, r.messageId, JSON.stringify(r)]],
  ]) {
    const abs = join(dataDir, dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs)) {
      if (!file.endsWith(".json")) continue;
      try {
        const record = JSON.parse(readFileSync(join(abs, file), "utf8"));
        const insert =
          table === "sessions"
            ? `INSERT INTO ${table} ${columns} VALUES (?, ?, ?, ?, ?) ` +
              `ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, workspace_id = excluded.workspace_id, updated = excluded.updated, json = excluded.json WHERE excluded.updated > sessions.updated`
            : `INSERT INTO ${table} ${columns} VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`;
        const result = dst.prepare(insert).run(...toParams(record));
        stats[table] += Number(result.changes);
        stats.jsonl += Number(result.changes);
      } catch {
        // skip corrupt files
      }
    }
  }
}

/** projects.json 合并（按项目 id 去重，activeId 保留目标已有值）。 */
function mergeProjectsJson() {
  const targetFile = join(targetRoot, "projects.json");
  const read = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };
  let target = read(targetFile) ?? { activeId: "default", projects: [] };
  let added = 0;
  for (const src of sources) {
    const raw = read(join(src, "projects.json"));
    if (!raw) continue;
    for (const project of raw.projects ?? []) {
      if (!project?.id || !project?.path) continue;
      if (target.projects.some((p) => p.id === project.id)) continue;
      target.projects.push(project);
      added++;
    }
    const targetHasActive =
      target.activeId === "default" || target.projects.some((p) => p.id === target.activeId);
    if (!targetHasActive && raw.activeId) target.activeId = raw.activeId;
  }
  if (added > 0) {
    mkdirSync(targetRoot, { recursive: true });
    writeFileSync(targetFile, JSON.stringify(target, null, 2), { mode: 0o600 });
  }
  console.log(`projects.json: 合并新增 ${added} 个项目条目`);
}

const targetDbs = new Map(); // targetDir -> DatabaseSync
for (const { dbPath, targetDir } of dbs) {
  let dst = targetDbs.get(targetDir);
  if (!dst) {
    mkdirSync(targetDir, { recursive: true });
    dst = openDb(join(targetDir, "zmzai.db"));
    dst.exec(`
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, updated TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS parts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, created);
      CREATE INDEX IF NOT EXISTS idx_parts_message ON parts (message_id);
    `);
    targetDbs.set(targetDir, dst);
  }
  const src = openDb(dbPath);
  const before = JSON.stringify(stats);
  mergeInto(dst, src);
  // 同源的旧 JSONL 一并合并（升级路径兜底）
  const srcDataDir = dirname(dbPath);
  mergeJsonl(dst, srcDataDir);
  console.log(`${dbPath} -> ${join(targetDir, "zmzai.db")}${JSON.stringify(stats) !== before ? "" : "（无新增）"}`);
  src.close();
}

mergeProjectsJson();
for (const db of targetDbs.values()) db.close();

console.log("\n完成。只复制未删除，源目录原样保留。");
console.log(`新增: sessions=${stats.sessions} messages=${stats.messages} parts=${stats.parts}`);
