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

// 订阅事件流（不 prompt，避免真实 LLM 调用），确认事件机制可用
const ac = new AbortController();
setTimeout(() => ac.abort(), 400);
let seen = 0;
for await (const ev of subscribeEventLog(eventLog, session.id, { signal: ac.signal })) {
  seen += 1;
}
console.log("[smoke] event subscription ok, events seen:", seen);
console.log("[smoke] PASS");
process.exit(0);
