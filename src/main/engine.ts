import { resolve, sep } from "node:path";
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
  startMcpServers,
  createGitTools,
  type AgentFramework,
  type AgentInfo,
  type SessionInfo,
  type ModelRef,
  type MessageWithParts,
  type ParsedAgentPlugin,
  type PluginFileSystem,
  type AnyToolDef,
  type McpPoolResult,
  type McpServerStatus,
} from "@zmzai/agent-framework";

export type DirEntry = { name: string; path: string; isDirectory: boolean; size: number };
export type Reply = "once" | "always" | "reject";

const TRUSTED_PLUGINS_FILE = "trusted-plugins.json";

/** resolve 后强制落在 workspaceRoot 内；绝对路径或 ../ 逃逸一律拒绝。
 *  渲染进程是不可信输入面——IPC 露出的文件接口必须有这道防御。 */
function safeJoin(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

/** 展开 Agent Plugins 1.0 保留占位符（宿主职责）：${PLUGIN_ROOT}=插件目录，
 *  ${PLUGIN_DATA}=数据目录下同名子目录。 */
export function expandPlaceholders(value: string, placeholders: Record<string, string>): string {
  let out = value;
  for (const [key, replacement] of Object.entries(placeholders)) {
    out = out.split(key).join(replacement);
  }
  return out;
}

/** 封装 @zmzai/agent-framework 的本地运行时：JSONL 持久化 + 本机 FS 工作区 +
 *  本机子进程沙箱 + OpenAI 兼容 LLM。不依赖 electron，便于 headless 测试。 */
export class EngineRuntime {
  readonly fw: AgentFramework;
  readonly workspaceRoot: string;
  readonly dataDir: string;

  /** 稳定引用的本地工具数组（git + MCP 工具注入点）：runner 每次 run 都会
   *  重读，所以 initMcpServers() 就地重置即可对下一次 prompt 生效。 */
  readonly #localTools: AnyToolDef[];
  /** 基线本地工具（git 工具集，绑定本机 workspaceRoot）；MCP 重扫时保留。 */
  readonly #baseLocalToolDefs: AnyToolDef[];
  #mcpPool: McpPoolResult | null = null;
  #mcpStatuses: McpServerStatus[] = [];

  constructor(opts: { dataDir: string; workspaceRoot: string }) {
    this.dataDir = resolve(opts.dataDir);
    this.workspaceRoot = resolve(opts.workspaceRoot);
    for (const dir of [this.workspaceRoot, this.dataDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // git 工具直接跑在本机真实仓库上（不是沙箱快照副本，否则 commit 会丢）
    this.#baseLocalToolDefs = createGitTools({ cwd: () => this.workspaceRoot });
    this.#localTools = [...this.#baseLocalToolDefs];

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
      localTools: this.#localTools,
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
    const abs = safeJoin(this.workspaceRoot, relPath);
    if (!abs || !existsSync(abs)) return [];
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
    const abs = safeJoin(this.workspaceRoot, relPath);
    if (!abs) return null; // 越界拒绝
    try {
      return await fsp.readFile(abs, "utf8");
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

  /** 扫描工作区 .zmzai/plugins 下各插件目录的 mcp.json，启动全部 stdio
   *  server，并把工具注入 localTools（对下一次 prompt 生效）。重复调用会先
   *  关停上一批 server（基线 git 工具保留）。返回每个 server 的连接状态。 */
  async initMcpServers(): Promise<McpServerStatus[]> {
    this.#mcpPool?.dispose();
    this.#mcpPool = null;
    this.#localTools.length = 0;
    this.#localTools.push(...this.#baseLocalToolDefs);
    this.#mcpStatuses = [];

    const pluginsRoot = resolve(this.workspaceRoot, ".zmzai", "plugins");
    if (!existsSync(pluginsRoot)) return [];
    const parsed: ParsedAgentPlugin[] = [];
    for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        parsed.push(await this.loadPlugin(resolve(pluginsRoot, entry.name)));
      } catch {
        /* plugin.json 不合法的目录直接跳过（安装入口已校验过） */
      }
    }
    const entries = collectMcpEntries({
      pluginsRoot,
      pluginDataRoot: resolve(this.dataDir, "plugins"),
      parsed,
    });
    if (!entries.length) return [];

    const pool = await startMcpServers(entries, { connectTimeoutMs: 8000 });
    this.#mcpPool = pool;
    this.#localTools.push(...pool.defs);
    this.#mcpStatuses = pool.statuses;
    return pool.statuses;
  }

  mcpStatuses(): McpServerStatus[] {
    return this.#mcpStatuses;
  }

  /** 当前注入的本机工具 id（git + MCP），供诊断/测试。 */
  localToolIds(): string[] {
    return this.#localTools.map((def) => def.id);
  }

  /** 诊断直跑：按 runner 的调用形态执行一个已注入的本机工具
   *  （zod 工具走 schema 校验，MCP 工具透传参数）。 */
  async runLocalTool(id: string, args: Record<string, unknown>): Promise<{ title: string; output: string }> {
    const def = this.#localTools.find((d) => d.id === id);
    if (!def) throw new Error(`未注入本机工具：${id}`);
    const ctxBase = {
      sessionId: "ses_diagnostic",
      userId: "local",
      workspaceId: "local",
      agent: "default",
      toolCallId: `diag_${Date.now()}`,
      workspace: createFsWorkspaceFiles({ root: this.workspaceRoot }),
      sandbox: createSubprocessSandbox(),
      emit: async () => undefined,
    };
    if ("parametersJsonSchema" in def) {
      return def.execute(args as Record<string, unknown>, ctxBase as never);
    }
    const parsed = def.parameters.safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数无效：${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    }
    return def.execute(parsed.data as never, ctxBase as never);
  }

  /** 宿主退出时关停全部 MCP 子进程。 */
  dispose(): void {
    this.#mcpPool?.dispose();
    this.#mcpPool = null;
    this.#localTools.length = 0;
    this.#localTools.push(...this.#baseLocalToolDefs);
  }
}

/** 展开 Agent Plugins 1.0 占位符后汇总待启动的 MCP server 配置（纯函数）。 */
export function collectMcpEntries(input: {
  pluginsRoot: string;
  pluginDataRoot: string;
  parsed: { manifest: { name: string }; mcpServers: Record<string, import("@zmzai/agent-framework").PluginMcpServer> }[];
}): { name: string; spec: import("@zmzai/agent-framework").PluginMcpServer }[] {
  const entries: { name: string; spec: import("@zmzai/agent-framework").PluginMcpServer }[] = [];
  for (const item of input.parsed) {
    const pluginRoot = resolve(input.pluginsRoot, item.manifest.name);
    const pluginData = resolve(input.pluginDataRoot, item.manifest.name);
    const expand = (value: string) => expandPlaceholders(value, { "${PLUGIN_ROOT}": pluginRoot, "${PLUGIN_DATA}": pluginData });
    for (const [serverName, spec] of Object.entries(item.mcpServers)) {
      const qualifiedName = `${item.manifest.name}:${serverName}`;
      if (spec.type === "stdio") {
        entries.push({
          name: qualifiedName,
          spec: {
            ...spec,
            command: expand(spec.command),
            args: spec.args?.map(expand),
            cwd: spec.cwd ? expand(spec.cwd) : undefined,
          },
        });
      } else {
        entries.push({ name: qualifiedName, spec });
      }
    }
  }
  return entries;
}
