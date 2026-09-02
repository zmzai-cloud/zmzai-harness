import { NextResponse } from "next/server";

import { terminalManager } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;
const ACTIVE_MS = 250;
const IDLE_MS_MAX = 2_000;

/**
 * SSE 终端流：`GET /api/terminal/stream?cursors={"tty_0001":576,...}`。
 *
 * 替代客户端 HTTP 轮询的治本方案——连接建立后由服务端在**进程内**自适应检查
 * TerminalManager 的环形缓冲增量（无 HTTP、无 dev 日志、无 JSON 开销）：
 * 有新输出/状态变化保持 250ms 节奏，全空闲指数退避到 2s。每帧 data 与
 * /api/terminal/read-all 的响应同形（TerminalReadAllResult），客户端按游标续读。
 *
 * 断线恢复：客户端重连时带最新游标即可无缺口续传；missing 清单用于清理已消失
 * 的会话。每 15s 发注释帧保活（不触发 onmessage）。
 */
export async function GET(request: Request) {
  const mgr = terminalManager();

  let clientCursors: Record<string, number> = {};
  try {
    clientCursors = JSON.parse(new URL(request.url).searchParams.get("cursors") ?? "{}") as Record<string, number>;
  } catch {
    /* 非法参数按空表处理 */
  }

  // 连接期游标状态：客户端最新游标 + 各会话上次已推送的 status（只在变化时发帧）
  const cursors = new Map<string, number>(Object.entries(clientCursors).map(([id, c]) => [id, Number(c) || 0]));
  const lastStatus = new Map<string, string>();

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let delay = ACTIVE_MS;

      const enqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          /* stream 已关闭 */
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* 已关闭则忽略 */
        }
      };
      const onAbort = () => close();
      const onStopHeartbeat = () => clearInterval(heartbeat);
      const heartbeat = setInterval(() => enqueue(": ping\n\n"), HEARTBEAT_MS);
      request.signal.addEventListener("abort", onAbort);
      request.signal.addEventListener("abort", onStopHeartbeat);

      const tick = () => {
        if (closed) return;
        let anyChange = false;

        const deltas: Array<{
          id: string;
          output: string;
          cursor: number;
          status: string;
          exitCode: number | null;
          name?: string;
          backend: string;
          bytesTotal: number;
        }> = [];
        const missing: string[] = [];
        const known = new Set<string>();

        for (const info of mgr.list()) {
          known.add(info.id);
          if (!cursors.has(info.id)) {
            // 客户端未知的新会话：只报状态（cursor=0 空 output），由客户端拉历史
            deltas.push({
              id: info.id,
              output: "",
              cursor: 0,
              status: info.status,
              exitCode: info.exitCode ?? null,
              ...(info.name ? { name: info.name } : {}),
              backend: info.backend,
              bytesTotal: info.bytesTotal,
            });
            cursors.set(info.id, 0);
            lastStatus.set(info.id, info.status);
            anyChange = true;
            continue;
          }
          const chunk = mgr.read(info.id, cursors.get(info.id)!);
          if (!chunk) continue;
          const statusChanged = chunk.session.status !== lastStatus.get(info.id);
          if (chunk.output || statusChanged) {
            deltas.push({
              id: info.id,
              output: chunk.output,
              cursor: chunk.cursor,
              status: chunk.session.status,
              exitCode: chunk.session.exitCode ?? null,
              ...(chunk.session.name ? { name: chunk.session.name } : {}),
              backend: chunk.session.backend,
              bytesTotal: chunk.session.bytesTotal,
            });
            cursors.set(info.id, chunk.cursor);
            lastStatus.set(info.id, chunk.session.status);
            if (chunk.output) anyChange = true;
          }
        }
        for (const id of cursors.keys()) {
          if (!known.has(id)) missing.push(id);
        }

        if (deltas.length || missing.length) {
          enqueue(`data: ${JSON.stringify({ sessions: deltas, missing })}\n\n`);
        }

        delay = anyChange ? ACTIVE_MS : Math.min(delay * 2, IDLE_MS_MAX);
        timer = setTimeout(tick, delay);
      };
      timer = setTimeout(tick, 0); // 连接建立立即推送一轮当前状态
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
