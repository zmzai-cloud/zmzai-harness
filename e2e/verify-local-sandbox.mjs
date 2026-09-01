// 端到端验证：本机沙箱环境（workspace 文件 + bash 子进程 + git 工具 + 权限链路）
// 流程：建会话 → SSE 订阅 → prompt（要求 write/bash/read/git_status 四连）→
//       自动回复权限请求 → 断言工具真实执行 + 文件落盘本机工作区。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:3100";
const LECTERN_ROOT = resolve(import.meta.dirname, "..");
const WS = resolve(process.env.LECTERN_WORKSPACE ?? process.env.HARNESS_WORKSPACE ?? LECTERN_ROOT, ".workspace");
const DEMO_FILE = "sandbox-demo.txt";

// ---- 0. 工作区就绪（git init 以便 git 工具可查） ----
await mkdir(WS, { recursive: true });
if (!existsSync(resolve(WS, ".git"))) {
  execSync("git init -q", { cwd: WS });
}

// ---- 1. 登录态（cookie 透传） ----
// 注意：文件内容已含 `muzhi_session=` 前缀，直接作为完整 cookie 头使用
const cookieHeader = await readFile("/tmp/harness-cookie.txt", "utf8").then((s) => s.trim()).catch(() => "");
if (!cookieHeader) {
  console.error("缺少 /tmp/harness-cookie.txt");
  process.exit(1);
}
const H = { cookie: cookieHeader, "content-type": "application/json" };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const get = (p) => fetch(BASE + p, { headers: H });
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: H, body: body ? JSON.stringify(body) : undefined });

const auth = await j(await get("/api/auth/status"));
console.log("[1] auth.loggedIn =", auth.loggedIn);
if (!auth.loggedIn) { console.error("未登录"); process.exit(1); }

// ---- 2. 建会话 ----
const ses = await j(await post("/api/sessions", {}));
console.log("[2] session =", ses.id, "| agent =", ses.agent, "| model =", JSON.stringify(ses.model));
const sid = ses.id;

// ---- 3. SSE 订阅（catch-up + live） ----
const events = [];
const sseController = new AbortController();
const ssePromise = (async () => {
  const res = await fetch(`${BASE}/api/sessions/${sid}/events`, { headers: H, signal: sseController.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const ev = JSON.parse(dataLine.slice(5).trim());
        events.push(ev);
      } catch { /* ignore */ }
    }
  }
})().catch((e) => { console.error("SSE 断开:", e.message); });

// ---- 4. prompt：要求真实使用工具 ----
const PROMPT = `请依次完成以下任务，每步用对应工具执行，并在最后用中文汇报每一步的结果：
1. 用 write 工具在工作区创建文件 ${DEMO_FILE}，内容为 "hello from local sandbox"
2. 用 bash 工具执行命令：node -e "console.log(6*7)"（在沙箱内执行，输出应为 42）
3. 用 read 工具读回 ${DEMO_FILE} 的内容
4. 用 git_status 工具查看当前 git 状态`;
console.log("[4] prompt ->", PROMPT.split("\n")[0], "...");
await post(`/api/sessions/${sid}/prompt`, { text: PROMPT });
console.log("    prompt 已发送");

// ---- 5. 事件收集循环：自动批准权限 + 等 run 结束（工具轨迹改由最终消息断言） ----
const permissionReplies = [];
const deadline = Date.now() + 180_000;
let idle = false;
while (!idle && Date.now() < deadline) {
  const ev = events.shift();
  if (!ev) { await new Promise((r) => setTimeout(r, 300)); continue; }
  const { type, data } = ev;
  switch (type) {
    case "permission.asked": {
      const req = data?.request;
      const rid = req?.id ?? req?.requestId;
      console.log(`    [权限请求] ${req?.permission} :: ${(req?.patterns ?? []).join(" ; ")}`);
      await post(`/api/sessions/${sid}/permission`, { requestId: rid, reply: "always" });
      permissionReplies.push({ permission: req?.permission, patterns: req?.patterns });
      break;
    }
    case "session.status":
      console.log(`    [状态] ${data?.status}`);
      if (data?.status === "idle") idle = true;
      break;
    case "run.idle":
      idle = true;
      break;
    case "file.edited":
      console.log(`    [file.edited] ${data?.path} rev=${data?.revisionId}`);
      break;
    default:
      if (type?.startsWith("message") || type === "assistant" || type === "step") break;
      console.log(`    [${type}]`, data ? JSON.stringify(data).slice(0, 100) : "");
  }
}

// run 结束后主动断开 SSE 长连接（events 路由不会自行关闭）
sseController.abort();
await ssePromise.catch(() => {});

// ---- 6. 断言（基于最终持久化消息 + 本机工作区文件） ----
const checks = [];
const demoPath = resolve(WS, DEMO_FILE);
const demoExists = existsSync(demoPath);
const demoContent = demoExists ? await readFile(demoPath, "utf8") : "";
checks.push({ name: "write 真实落盘本机工作区", pass: demoExists && demoContent.includes("hello from local sandbox"), detail: demoExists ? `内容: ${demoContent}` : "文件不存在" });

const msgs = await j(await get(`/api/sessions/${sid}/messages`));
const toolParts = msgs.flatMap((m) => m.parts).filter((p) => p.type === "tool" && p.state?.status === "completed");
const toolNames = toolParts.map((p) => p.tool);
const toolOutputs = toolParts.map((p) => p.state?.output ?? "");
const allOutput = toolOutputs.join("\n");

checks.push({ name: "工具轨迹含 write/bash/read/git_status 且全部 completed", pass: ["write", "bash", "read", "git_status"].every((n) => toolNames.includes(n)), detail: toolNames.join(", ") });

checks.push({ name: "权限链路工作（asked→reply→继续）", pass: permissionReplies.length > 0, detail: `${permissionReplies.length} 次权限请求已自动批准（bash 工具）` });

const bashPart = toolParts.find((p) => p.tool === "bash");
checks.push({ name: "bash 在本机沙箱执行（node 输出 42）", pass: bashPart?.state?.output?.includes("42") ?? false, detail: bashPart ? `退出码 ${bashPart.state.exitCode}：${bashPart.state.output.split("\n").filter(Boolean).slice(0, 3).join(" | ")}` : "无 bash 调用" });

const gitPart = toolParts.find((p) => p.tool === "git_status");
checks.push({ name: "git 工具绑定本机仓库（识别 untracked）", pass: gitPart?.state?.output?.includes("sandbox-demo.txt") ?? false, detail: gitPart ? gitPart.state.output.split("\n").filter(Boolean).slice(0, 3).join(" | ") : "无 git_status 调用" });

console.log("\n===== 断言结果 =====");
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}  ${c.detail}`);
console.log(`\nSSE 事件数: ${events.length} | 工具调用: ${toolNames.length}（${toolNames.join(", ")}） | 权限请求: ${permissionReplies.length}`);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `\n❌ ${failed} 项未通过` : "\n✅ 全部通过");
process.exit(failed ? 1 : 0);
