/**
 * Next 服务端观测钩子（instrumentation，Next 15 稳定 API）。
 *
 * 为什么需要它：打包版（尤其 Windows）此前**完全没有服务端日志**。API 一旦在
 * 路由之外抛错（模块加载失败、SQLite 打不开、原生模块缺失等），Next 只会返回
 * 一个裸 500（响应体连 error 字段都没有），堆栈只进 stderr —— 而打包后 stderr
 * 无人可见，用户只能看到「请求失败（500）」，无法定位。
 *
 * 本钩子做两件事：
 *   1. register()：启动自检，把 node/platform/数据目录可写性/node:sqlite 可用性
 *      写入日志。绝大多数「安装后全站 API 500」都能在这一段直接看出原因。
 *   2. onRequestError()：捕获**所有**服务端请求错误（含路由外、模块加载期），
 *      落盘为结构化条目。
 *
 * 日志位置刻意与 Electron 主进程侧一致：`<userData>/logs/web.log`
 * （dataDir = <userData>/data，故 logs 在其同级），两处日志合流到同一文件，
 * 用户只需通过「账户菜单 → 打开日志文件夹」取一个文件即可。
 *
 * 所有逻辑都必须静默失败：观测设施本身绝不能影响应用启动。
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { dataDir } from "./lib/runtime-constants";

// 日志目录：优先用 Electron 显式注入的 LECTERN_LOG_DIR（= <userData>/logs），
// 保证与 Electron 主进程侧的进程日志落在同一处，"打开日志文件夹"才能一次拿全。
//
// 不能只靠 dataDir 反推：LECTERN_DATA_DIR 的语义是"数据根目录"，runtime-constants
// 内部还会再拼一级 data（打包版因此落在 <userData>/data/data），从 dataDir 取
// ".." 会偏到 <userData>/data/logs，与 Electron 侧的 <userData>/logs 分裂。
const logDir = process.env.LECTERN_LOG_DIR
  ? resolve(process.env.LECTERN_LOG_DIR)
  : resolve(dataDir, "..", "logs");
const logPath = resolve(logDir, "web.log");
const MAX_BYTES = 5 * 1024 * 1024;

let warnedUnwritable = false;

function rotateIfNeeded() {
  try {
    const size = statSync(logPath).size;
    if (size > MAX_BYTES) {
      writeFileSync(resolve(logDir, "web.old.log"), readLogSync(), "utf8");
      writeFileSync(logPath, "", "utf8");
    }
  } catch {
    // 文件还不存在等情况，忽略
  }
}

function readLogSync(): string {
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

/** 唯一写入口：任何异常都吞掉，观测绝不拖垮宿主。 */
function log(line: string) {
  try {
    mkdirSync(logDir, { recursive: true });
    rotateIfNeeded();
    appendFileSync(logPath, line.endsWith("\n") ? line : `${line}\n`, "utf8");
  } catch {
    if (!warnedUnwritable) {
      warnedUnwritable = true;
      try {
        process.stderr.write(`[lectern] 无法写入日志：${logPath}\n`);
      } catch {
        /* noop */
      }
    }
  }
}

function stackOf(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** 启动自检：node:sqlite 可用性与数据目录可写性——Windows 报障最常见两处。 */
function startupProbe() {
  const lines: string[] = [];
  lines.push(`[startup] app=Lectern node=${process.versions.node} platform=${process.platform} arch=${process.arch} pid=${process.pid}`);
  lines.push(`[startup] dataDir=${dataDir}`);
  lines.push(`[startup] logFile=${logPath}`);
  lines.push(`[startup] cwd=${process.cwd()}`);

  try {
    mkdirSync(dataDir, { recursive: true });
    lines.push(`[probe] dataDir writable: YES`);
  } catch (error) {
    lines.push(`[probe] dataDir writable: NO -> ${stackOf(error)}`);
  }

  try {
    // 框架会话层依赖 node:sqlite；缺失/被裁剪的 Node 运行时会在这里暴露。
    // 用 getBuiltinModule 而非 require：instrumentation 可能被编译为 ESM，
    // 那里没有 require（framework 的 tags.js 也是同样处理）。
    const sqlite = process.getBuiltinModule?.("node:sqlite") as
      | { DatabaseSync?: new (p: string) => { close: () => void } }
      | undefined;
    if (typeof sqlite?.DatabaseSync !== "function") throw new Error("DatabaseSync 不可用");
    lines.push(`[probe] node:sqlite: AVAILABLE`);
    // 真正开一次库：能暴露「目录不可写 / 文件被杀软锁定 / disk I/O error」
    const probePath = resolve(dataDir, "_probe.sqlite");
    const db = new sqlite.DatabaseSync(probePath);
    db.close();
    lines.push(`[probe] sqlite open: OK`);
  } catch (error) {
    const err = error as { code?: string; message?: string };
    lines.push(`[probe] node:sqlite: FAILED code=${err?.code ?? "-"} msg=${err?.message ?? String(error)}`);
  }

  return lines.join("\n");
}

export async function register() {
  try {
    log(`\n${"=".repeat(70)}`);
    log(startupProbe());
  } catch {
    /* noop */
  }

  // 兜底：未捕获异常/未处理的 Promise 拒绝。路由外崩溃（如模块加载期）不会走
  // onRequestError，只能靠这里留下痕迹。
  for (const signal of ["uncaughtException", "unhandledRejection"] as const) {
    process.on(signal, (reason: unknown) => {
      log(`[${signal}] ${stackOf(reason)}`);
    });
  }
}

type ErrorRequestInfo = { path?: string; method?: string; url?: string };
type ErrorContext = { routeType?: string; routePath?: string; revalidateReason?: string };

/**
 * Next 请求错误钩子：路由内外的服务端错误都会经过这里。
 * 注意打包版没有 source map，堆栈指向 .next/server 产物，属正常。
 */
export async function onRequestError(
  error: unknown,
  request: ErrorRequestInfo,
  context: ErrorContext,
) {
  try {
    const err = error as { digest?: string; code?: string; message?: string };
    const head = [
      `[error] ${new Date().toISOString()}`,
      `route=${context?.routeType ?? "?"} ${request?.method ?? "?"} ${request?.path ?? request?.url ?? "?"}`,
      `code=${err?.code ?? "-"} digest=${err?.digest ?? "-"} msg=${err?.message ?? String(error)}`,
    ].join(" | ");
    log(`${head}\n${stackOf(error)}\n`);
  } catch {
    /* noop */
  }
}
