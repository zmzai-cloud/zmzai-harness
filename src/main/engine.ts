import { resolve } from "node:path";
import { promises as fsp, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import {
  createServer,
  createJsonlSessionStore,
  createMemoryEventLog,
  createFsWorkspaceFiles,
  createOpenAiModelProvider,
  createSubprocessSandbox,
  subscribeEventLog,
  loadCustomAgents,
  parseAgentPlugin,
  type AgentFramework,
  type AgentInfo,
  type SessionInfo,
  type ModelRef,
  type MessageWithParts,
  type ParsedAgentPlugin,
  type PluginFileSystem,
} from "@zmzai/agent-framework";

export type DirEntry = { name: string; path: string; isDirectory: boolean; size: number };
export type Reply = "once" | "always" | "reject";

const TRUSTED_PLUGINS_FILE = "trusted-plugins.json";

/** 封装 @zmzai/agent-framework 的本地运行时：JSONL 持久化 + 本机 FS 工作区 +
 *  本机子进程沙箱 + OpenAI 兼容 LLM。不依赖 electron，便于 headless 测试。 */
export class EngineRuntime {
  readonly fw: AgentFramework;
  readonly workspaceRoot: string;
  readonly dataDir: string;

  constructor(opts: { dataDir: string; workspaceRoot: string }) {
    this.dataDir = resolve(opts.dataDir);
    this.workspaceRoot = resolve(opts.workspaceRoot);
    for (const dir of [this.workspaceRoot, this.dataDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    const store = createJsonlSessionStore({ dataDir: this.dataDir });
    const eventLog = createMemoryEventLog();
    const modelProvider = createOpenAiModelProvider();
    const workspaceFor = () => createFsWorkspaceFiles({ root: this.workspaceRoot });

    this.fw = createServer({
      store,
      eventLog,
      modelProvider,
      workspaceFor,
      sandbox: createSubprocessSandbox(),
      subagentDepth: 2,
      // 加载工作区 .zmzai/agents/*.md 作为自定义 Agent（多 Agent 支持）
      loadWorkspaceAgents: async () => {
        const ws = createFsWorkspaceFiles({ root: this.workspaceRoot });
        const { agents } = await loadCustomAgents(ws);
        return agents;
      },
    });
  }

  async createSession(input: { agent?: string; model?: ModelRef }): Promise<SessionInfo> {
    return this.fw.createSession({
      userId: "local",
      workspaceId: "local",
      agent: input.agent,
      model: input.model ?? { providerId: "openai", modelId: process.env.OPENAI_MODEL ?? "gpt-4o" },
    });
  }

  prompt(sessionId: string, text: string, agent?: string, model?: ModelRef) {
    return this.fw.runner.prompt(sessionId, { text, agent, model });
  }

  replyPermission(sessionId: string, requestId: string, reply: Reply, feedback?: string) {
    return this.fw.runner.replyPermission(sessionId, requestId, reply, feedback);
  }

  abort(sessionId: string) {
    return this.fw.runner.abort(sessionId);
  }

  listAgents(): AgentInfo[] {
    return this.fw.registry.list({ includeHidden: false });
  }

  async listSessions(): Promise<SessionInfo[]> {
    return this.fw.store.listSessions({ userId: "local", workspaceId: "local" });
  }

  /** 读取某会话已持久化的完整转录（消息+片段），用于跨会话恢复历史。 */
  async getMessages(sessionId: string): Promise<MessageWithParts[]> {
    return this.fw.store.getMessages(sessionId);
  }

  /** 订阅某会话的事件流（token 增量、工具调用、权限请求等） */
  subscribe(sessionId: string, signal?: AbortSignal) {
    return subscribeEventLog(this.fw.eventLog, sessionId, signal ? { signal } : undefined);
  }

  /** 分层文件树（基于本机 fs，独立于 agent 工作区的虚拟 list） */
  async listDir(relPath = ""): Promise<DirEntry[]> {
    const abs = resolve(this.workspaceRoot, relPath);
    if (!existsSync(abs)) return [];
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    const result: DirEntry[] = [];
    for (const e of entries) {
      const full = resolve(abs, e.name);
      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        /* ignore */
      }
      result.push({
        name: e.name,
        path: relPath ? `${relPath}/${e.name}` : e.name,
        isDirectory: e.isDirectory(),
        size,
      });
    }
    result.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
    return result;
  }

  async readFile(relPath: string): Promise<string | null> {
    try {
      return await fsp.readFile(resolve(this.workspaceRoot, relPath), "utf8");
    } catch {
      return null;
    }
  }

  /** 解析 Agent Plugin 包（plugin.json + skills + mcp.json），返回结构化结果 */
  async loadPlugin(pluginRoot: string): Promise<ParsedAgentPlugin> {
    const root = resolve(pluginRoot);
    const files: PluginFileSystem = {
      read: async (p) => {
        try {
          return await fsp.readFile(p, "utf8");
        } catch {
          return null;
        }
      },
      list: async (p) => {
        try {
          const ents = await fsp.readdir(p, { withFileTypes: true });
          return ents.map((e) => ({ path: e.name, isDirectory: e.isDirectory() }));
        } catch {
          return [];
        }
      },
    };
    return parseAgentPlugin({ root, files });
  }

  private trustedPluginsPath() {
    return resolve(this.dataDir, TRUSTED_PLUGINS_FILE);
  }

  async trustedPlugins(): Promise<string[]> {
    try {
      const raw = await fsp.readFile(this.trustedPluginsPath(), "utf8");
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  /** 信任安装插件：复制到工作区 .zmzai/plugins/<name>/，并把其 agents/*.md
   *  注册进工作区 .zmzai/agents/（下次会话自动加载），信任记录持久化。 */
  async installPlugin(pluginRoot: string): Promise<ParsedAgentPlugin> {
    const parsed = await this.loadPlugin(pluginRoot);
    if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
    const name = parsed.manifest.name;
    const dest = resolve(this.workspaceRoot, ".zmzai", "plugins", name);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.cp(resolve(pluginRoot), dest, { recursive: true });

    const pluginAgentsDir = resolve(pluginRoot, "agents");
    if (existsSync(pluginAgentsDir)) {
      const agentsDir = resolve(this.workspaceRoot, ".zmzai", "agents");
      await fsp.mkdir(agentsDir, { recursive: true });
      for (const e of readdirSync(pluginAgentsDir)) {
        if (e.endsWith(".md")) {
          await fsp.copyFile(resolve(pluginAgentsDir, e), resolve(agentsDir, `${name}__${e}`));
        }
      }
    }

    const trusted = await this.trustedPlugins();
    if (!trusted.includes(name)) {
      trusted.push(name);
      await fsp.writeFile(this.trustedPluginsPath(), JSON.stringify(trusted, null, 2));
    }
    return parsed;
  }
}
