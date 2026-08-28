# legacy/ — 旧版 Electron 引擎（保留为 App 增强）

Web / App 同构改造后，harness 主体为 Next.js 应用（`app/` + `lib/`），
Web 与 Electron 加载同一套页面，能力全部走 relay 云端（会话 + 聊天 + 模型）。

旧版 Electron 主进程的本地引擎能力按用户要求**保留不删**，作为未来
App 端增强（桌面专属：本地文件、git、MCP、交互式终端），后续接入方式：

- `engine/engine.ts` — EngineRuntime（agent-framework 本地运行时，git + 终端 + MCP 注入）
- `engine/index.ts` — 旧 Electron 主进程（IPC 注册、relay 登录窗口）
- `engine/engine.test.ts` — 引擎单测（`npx vitest run legacy/engine/engine.test.ts`）
- `preload/` — contextBridge 注入面（window.harness），增强时替换 `electron/preload.cjs`
- `renderer/` — 旧 renderer（已被 `app/` + `components/` 取代，仅存档参考）
- `vite/electron.vite.config.ts` — 旧 electron-vite 构建配置（增强时恢复）

接入增强时：`electron/main.cjs` 引入 `legacy/engine/engine.ts`（需 tsx/esbuild
编译或迁移为 .cjs），preload 暴露本地能力，页面通过 `window.harnessNative`
检测宿主能力做渐进增强（App 多入口、Web 隐藏）。
