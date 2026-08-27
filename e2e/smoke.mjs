// Headless 引擎冒烟：在真实 Node 运行时验证 @zmzai/agent-framework 能初始化、
// 建会话、订阅事件流（不调用 LLM，避免依赖 API key / 网络）。
// 用法：node e2e/smoke.mjs
import {
  createServer,
  createJsonlSessionStore,
  createMemoryEventLog,
  createFsWorkspaceFiles,
  createSubprocessSandbox,
  subscribeEventLog,
} from "@zmzai/agent-framework";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "harness-smoke-"));
const ws = mkdtempSync(join(tmpdir(), "harness-ws-"));

const store = createJsonlSessionStore({ dataDir });
const eventLog = createMemoryEventLog();
// 不传 key 也应能构造 provider（只在真正 streamFor 时才联网）
const { createOpenAiModelProvider } = await import("@zmzai/agent-framework");
const modelProvider = createOpenAiModelProvider();
const workspaceFor = () => createFsWorkspaceFiles({ root: ws });

const fw = createServer({
  store,
  eventLog,
  modelProvider,
  workspaceFor,
  sandbox: createSubprocessSandbox(),
  subagentDepth: 2,
});

const agentNames = fw.registry.list().map((a) => a.name);
console.log("[smoke] agents:", agentNames.join(", "));
if (!agentNames.includes("default")) throw new Error("缺少内置 default agent");

const session = await fw.createSession({
  userId: "local",
  workspaceId: "local",
  model: { providerId: "openai", modelId: "gpt-4o" },
});
console.log("[smoke] session created:", session.id, "title:", session.title);

// 验证转录持久化 + 跨会话恢复（history replay 的数据基础）：
// 直接写消息/片段到 store（模拟一次真实 run 的持久化），再用「新 store 实例」重新载入。
const now = () => new Date().toISOString();
await fw.store.appendMessage({
  id: "msg_user1", sessionId: session.id, role: "user", agent: "default",
  model: { providerId: "openai", modelId: "gpt-4o" }, time: { created: now() },
});
await fw.store.appendPart({ id: "part_u1", sessionId: session.id, messageId: "msg_user1", type: "text", text: "帮我看下 README" });
await fw.store.appendMessage({
  id: "msg_asst1", sessionId: session.id, role: "assistant", parentId: "msg_user1", agent: "default",
  model: { providerId: "openai", modelId: "gpt-4o" }, time: { created: now(), completed: now() },
});
await fw.store.appendPart({ id: "part_a1", sessionId: session.id, messageId: "msg_asst1", type: "text", text: "好的，我来读 README。" });
await fw.store.appendPart({
  id: "part_a2", sessionId: session.id, messageId: "msg_asst1", type: "tool", callId: "call_1", tool: "read",
  state: { status: "completed", input: { path: "README.md" }, output: "hello", title: "read README.md", time: { start: now(), end: now() } },
});

const store2 = createJsonlSessionStore({ dataDir }); // 模拟进程重启后重新打开
const reloaded = await store2.getMessages(session.id);
console.log("[smoke] reloaded messages:", reloaded.length);
if (reloaded.length !== 2) throw new Error("转录恢复失败：消息数应为 2，实际 " + reloaded.length);
const toolPart = reloaded.find((m) => m.info.role === "assistant").parts.find((p) => p.type === "tool");
if (!toolPart || toolPart.state.status !== "completed") throw new Error("工具片段未正确恢复");
console.log("[smoke] transcript reload ok");

// 订阅事件流（不 prompt，避免真实 LLM 调用），确认事件机制可用
const ac = new AbortController();
setTimeout(() => ac.abort(), 400);
let seen = 0;
for await (const ev of subscribeEventLog(eventLog, session.id, { signal: ac.signal })) {
  seen += 1;
}
console.log("[smoke] event subscription ok, events seen:", seen);

// MCP（P0）：dist 级导出在纯 node 消费路径（= harness 实际加载方式）上
// 能启动 stdio server、注入命名空间化工具并干净回收。
const { startMcpServers } = await import("@zmzai/agent-framework");
const { fileURLToPath } = await import("node:url");
const fixturePath = fileURLToPath(new URL("./fixtures/echo-mcp-server.mjs", import.meta.url));
const pool = await startMcpServers([
  { name: "demo", spec: { type: "stdio", command: process.execPath, args: [fixturePath] } },
], { connectTimeoutMs: 8000 });
if (pool.statuses[0]?.state !== "connected") {
  throw new Error(`MCP 冒烟失败：${JSON.stringify(pool.statuses[0])}`);
}
if (!pool.defs.some((d) => d.id === "mcp__demo__echo")) throw new Error("MCP 工具未注入");
pool.dispose();
console.log("[smoke] mcp ok:", pool.statuses[0].name, pool.statuses[0].tools.join(","));

// Git 工具集（P0-2）：dist 导出可实例化且 id 齐全（执行已在框架单测覆盖）
const { createGitTools } = await import("@zmzai/agent-framework");
const gitDefs = createGitTools({ cwd: () => process.cwd() });
if (gitDefs.map((d) => d.id).join() !== "git_status,git_diff,git_log,git_commit") {
  throw new Error("git 工具导出不完整：" + gitDefs.map((d) => d.id).join(","));
}
console.log("[smoke] git tools ok:", gitDefs.length);

console.log("[smoke] PASS");
process.exit(0);
