# zmzai-harness 能力差距分析

> 信息源：`.research/harness-src/` 五个参考实现（opencode / pi-mono / deepseek-harness / gemini-cli / codex）的真实包结构与 README 能力清单，逐一对照 `@zmzai/agent-framework + zmzai-harness` 现状。
> 基准日期：2026-08-27。状态标注：✅ 已具备 · ⚠️ 部分 · ❌ 缺失。

## 一、核心运行能力（Harness 本体）

| 能力 | 参考实现 | 现状 | 状态 |
|---|---|---|---|
| Agent 循环 + 事件流 | 全部 | SessionRunner + compaction + lease-recovery | ✅ |
| 权限/审批 | opencode permission/policy、gemini confirmation-bus | PermissionEngine + ruleset + 桌面弹窗（pi 甚至没有权限系统） | ✅ |
| 工具集 | opencode 16+、codex tools/ | read/glob/grep/write/edit/bash/todo/task/webfetch/qa-check 共 9 个，**+ git_status/git_diff/git_log/git_commit（2026-08-27，git_read 默认放行 / git_write 走审批）**；缺 websearch、apply-patch、pty 终端 | ⚠️ |
| 上下文压缩 | opencode、codex context-fragments | compaction.ts | ✅ |
| 文件监视 | codex file-watcher、opencode filesystem | 无 | ❌ |
| Hooks 生命周期 | codex hooks/、gemini hooks/、opencode event.ts | 无（只有被动事件流） | ❌ |
| Git 集成 | opencode git.ts、codex git-utils | ✅ 2026-08-27 结构化 status/diff/log/commit 落框架 builtins，commit 真实写仓库（非沙箱快照副本）；变更可视化（diff 渲染视图）待 UI 增强 | ✅(基础) |

## 二、模型层（差距最大的一档）

| 能力 | 参考实现 | 现状 |
|---|---|---|
| 多提供商 | pi ai/ 统一 API、opencode llm/+credential/+oauth | ❌ 仅 OpenAI 兼容一个 provider |
| 模型目录 | opencode models-dev.ts、pi 构建期生成、codex models-manager | ❌ 模型 ID 硬编码 |
| 路由/降级 | gemini routing/+fallback/+availability | ❌ 单 provider 挂了就挂 |
| 本地模型 | codex ollama/+lmstudio/ | ❌ |
| 凭据管理 | codex keyring-store+secrets、opencode credential.ts | ⚠️ 仅读 .env，无加密存储 |

## 三、插件与生态

| 能力 | 参考实现 | 现状 |
|---|---|---|
| 插件架构 | deepseek「一切皆插件」（Cordis）、opencode plugin/ | ⚠️ 有 parseAgentPlugin（plugin.json+skills+mcp.json）+ 信任安装，**无运行时热加载** |
| MCP 客户端 | gemini mcp/、opencode integration/、codex mcp-server | ⚠️ → **2026-08-27 起 stdio 已可用**（见下文进度）；SSE / streamable-http 未实现 |
| 插件市场/目录 | opencode catalog.ts+installation/ | ❌ |
| Skill 体系 | opencode skill/、gemini skills/ | ⚠️ 有插件级 skills 解析，无独立发现/安装 |

## 四、前端形态

| 形态 | 参考实现 | 现状 |
|---|---|---|
| 桌面 | opencode desktop/（BETA）、本仓 Electron | ✅ 已有（opencode 是 Web 壳 + 本地 server 思路，可借鉴其多端复用） |
| TUI | opencode tui/、pi tui/、codex tui/ | ❌ |
| Web | deepseek apps/web、opencode web/ | ❌（框架可 serve 但无 UI） |
| IDE 集成 | gemini vscode-ide-companion/、codex app-server | ❌ |
| 语音 | gemini voice/ | ❌（可不做） |

## 五、平台化（对齐 opencode 的核心差距）

| 能力 | 参考实现 | 现状 |
|---|---|---|
| 开放协议 + SDK | opencode protocol/+sdk/+client/+server、pi protocol/+client/+rpc-entry、codex app-server | ❌ Electron IPC 仅本机 GUI 用 |
| 会话快照/分享 | opencode snapshot.ts+share/、pi 会话发布 HF | ❌ |
| 遥测 | pi telemetry/（vendor-neutral）、codex otel/+analytics/ | ❌ |
| Agent 评估 | pi evals/、gemini evals/、codex rollout-trace | ❌ 仅 vitest + smoke，无真实任务评估集 |
| 会话存储后端 | pi session-backends/、opencode SQLite（drizzle） | ⚠️ 仅 JSONL，500+ 会话后查询变慢 |
| 远程协作 | codex collaboration-mode-templates、opencode slack/ | ❌ |

## 优先级路线图

**P0 — Harness 立身之本**
1. ~~MCP client~~ → **2026-08-27 stdio 已落地**（框架 `core/mcp/`：NDJSON JSON-RPC 客户端 + initialize/tools 翻页/callTool + 外部工具适配 ExternalToolDef；harness 扫描已装插件 mcp.json 自动启动并注入下一轮对话，插件面板有连接状态）。**待补：SSE 与 streamable-http 传输。**
2. git 工具集（status/diff/log 结构化）+ pty 交互终端 → **git 四件 2026-08-27 已落地**（框架 `core/tools/git.ts`，真实仓库执行 + 权限分类 git_read/git_write）；**剩 pty 终端**
3. hooks 生命周期扩展点（工具调用前/后等），插件生态地基
4. websearch / apply_patch 工具补齐

**P1 — 模型层扩展**
5. 多 provider 抽象（pi-ai 式统一层）+ 路由/降级
6. 本地模型（Ollama）接入，内测期零成本跑通

**P2 — 平台化**
7. 把 Electron IPC 抽象成独立协议层（opencode protocol 思路），桌面/CLI/Web 共用 + headless 可编程
8. telemetry 契约 + evals 最小集

**P3 — 生态**
9. 插件市场（本地 catalog 起步）、会话快照/分享、SQLite 存储升级

## 2026-08-27 附带修复

- 安全：harness IPC 文件接口（listDir/readFile）增加 workspaceRoot 越界防护——渲染进程传 `../` 或绝对路径一律拒绝（引擎单测覆盖）
- 竞态：会话切换时历史转录载入与实时事件流的覆盖竞态改为缓冲合并（订阅先建立、转录就绪后按序并入）
- UX：消息区自动跟随滚动；prompt 后刷新会话元数据
- 基建：framework 三个测试文件里历史遗留的 `@/packages/...` 别名导入修正为相对路径（此前 typecheck 常红）

## 维护约定

- 框架改动必须：`corepack pnpm typecheck && test && build` 全绿后在 harness 里重跑 `pnpm install`（file: 依赖是安装期拷贝）→ harness typecheck/test/smoke。
- 本文档随路线图推进更新状态列，不另开 issue 清单。
