# zmzai-harness

> **全新形态，以编程智能体为核心引擎，从想法到实现，轻松搞定。**

Electron 桌面端 Agent 工作台：你给一句想法，内置编程智能体（`@zmzai/agent-framework`）在本机完成规划、编码、执行、自检与交付。

## 能力一览

- **多 Agent**：default / readonly / explore / general 内置预设 + 工作区 `.zmzai/agents/*.md` 自定义 Agent
- **权限与审批**：读写/执行/联网/git/终端 分类授权，可「总是允许」沉淀规则，桌面弹窗审批
- **本机工具基线**（16 个，绑定工作区）：
  - 文件 read/glob/grep/write/edit
  - 沙箱 bash + 产物面板联动
  - git_status / git_diff / git_log / git_commit（真实仓库执行）
  - terminal_start / read / write / kill / list（真 PTY，node-pty 不可用自动降级管道）
  - webfetch / websearch（Tavily/Serper/DuckDuckGo 三后端）
  - apply_patch（unified diff 多文件两阶段应用）、todo、task 子代理、qa-check
- **MCP 插件生态**：信任安装 Agent Plugins 1.0 包；stdio / streamable-http / sse 三传输自动连接，工具注入下一轮对话
- **跨会话恢复**：JSONL 转录持久化，重开会话完整还原历史

## 开发

```bash
corepack pnpm install        # 首次或 @zmzai/agent-framework 有更新后必跑（file: 依赖是安装期拷贝）
corepack pnpm dev            # Electron 开发模式
corepack pnpm test           # vitest 单测
node e2e/smoke.mjs           # headless 引擎冒烟（MCP/git/PTY 真实链路）
corepack pnpm build          # electron-vite 构建
pnpm rebuild:native          # 打包前若 node-pty ABI 报错时执行（prebuilds 常态无需）
```

环境变量见 `.env.example`：`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`、可选 `TAVILY_API_KEY`/`SERPER_API_KEY` 提升搜索质量、`ZMZAI_WORKSPACE`/`ZMZAI_DATA_DIR` 自定义路径。

## 相关仓库

`zmzai-agent`（agent-framework 核心）· `docs/harness-gap-analysis.md`（对标 opencode/pi/gemini-cli/codex/deepseek-harness 的差距路线图，P0–P3 推进状态实时更新）。
