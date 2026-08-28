import { app, BrowserWindow, ipcMain, session } from "electron";
import { join } from "node:path";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { EngineRuntime, type Reply } from "./engine.js";

/** 把 .env 合并进 process.env（不覆盖已存在的变量）。
 *  createOpenAiModelProvider / 工作区路径都从 process.env 读取。 */
function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!.replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const dataDir = process.env.ZMZAI_DATA_DIR ?? "./.harness-data";
const workspaceRoot = process.env.ZMZAI_WORKSPACE ?? "./.workspace";

// ---- relay 登录态（zmzai 体系）：Electron session 里的 muzhi_session cookie ----
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "muzhi_session";
const muzhiUrl = (process.env.MUZHI_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

/** 每次 LLM 调用前从 Electron session 读登录 cookie，注入请求头（走账号计费）。 */
const modelHeaders = async (): Promise<Record<string, string>> => {
  try {
    const cookies = await session.defaultSession.cookies.get({ name: SESSION_COOKIE_NAME });
    const c = cookies[0];
    return c ? { cookie: `${c.name}=${c.value}` } : {};
  } catch {
    return {};
  }
};

const runtime = new EngineRuntime({ dataDir, workspaceRoot, modelHeaders });

let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
const subscribers = new Map<string, AbortController>();

/** 打开 muzhi 本地登录页；登录成功后 cookie 写入 Electron session（持久化）。 */
async function openLoginWindow(): Promise<{ opened: boolean; url: string }> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return { opened: false, url: muzhiUrl };
  }
  loginWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: "zmzai 登录（relay 账号）",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const url = `${muzhiUrl}/dev/login`;
  void loginWindow.loadURL(url);
  loginWindow.on("closed", () => {
    loginWindow = null;
    // 通知渲染进程刷新登录态（用户可能已在登录窗口完成登录）
    mainWindow?.webContents.send("harness:auth-changed");
  });
  return { opened: true, url };
}

/** 检查 Electron session 里是否有有效登录 cookie。 */
async function authStatus(): Promise<{ loggedIn: boolean; cookieName: string }> {
  try {
    const cookies = await session.defaultSession.cookies.get({ name: SESSION_COOKIE_NAME });
    return { loggedIn: cookies.length > 0, cookieName: SESSION_COOKIE_NAME };
  } catch {
    return { loggedIn: false, cookieName: SESSION_COOKIE_NAME };
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#ffffff",
    title: "zmzai Agent Harness",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // electron-vite 2.x 注入的 dev server 地址变量名是 ELECTRON_RENDERER_URL
  // （3.x 才叫 MAIN_WINDOW_VITE_DEV_SERVER_URL），读错名字会导致窗口
  // 永远加载 out/renderer 的旧构建，dev server 与 HMR 全部失效。
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(resolve(__dirname, "../renderer/index.html"));
  }

  // 诊断：转发渲染进程 console，确认 preload 注入与 React 挂载
  mainWindow.webContents.on("console-message", (_e, _level, message) => {
    console.log("[renderer]", message);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[main] renderer loaded:", mainWindow?.webContents.getURL());
    void mainWindow?.webContents
      .executeJavaScript("typeof window.harness")
      .then((t) => console.log("[main] window.harness =", t));
    // dev 诊断：加载 4s 后截图到 /tmp/harness-ui.png 供视觉验证
    setTimeout(() => {
      void mainWindow?.webContents.capturePage().then((img) => {
        writeFileSync("/tmp/harness-ui.png", img.toPNG());
        console.log("[main] screenshot saved to /tmp/harness-ui.png");
      });
    }, 4000);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("harness:create-session", (_e, agent?: string, model?: { providerId: string; modelId: string }) =>
    runtime.createSession({ agent, model }),
  );
  ipcMain.handle("harness:prompt", (_e, sessionId: string, text: string, agent?: string, model?: { providerId: string; modelId: string }) =>
    runtime.prompt(sessionId, text, agent, model),
  );
  ipcMain.handle("harness:reply-permission", (_e, sessionId: string, requestId: string, reply: Reply, feedback?: string) =>
    runtime.replyPermission(sessionId, requestId, reply, feedback),
  );
  ipcMain.handle("harness:abort", (_e, sessionId: string) => runtime.abort(sessionId));
  ipcMain.handle("harness:list-agents", () => runtime.listAgents());
  ipcMain.handle("harness:list-sessions", () => runtime.listSessions());
  ipcMain.handle("harness:get-messages", (_e, sessionId: string) => runtime.getMessages(sessionId));
  ipcMain.handle("harness:list-dir", (_e, relPath: string) => runtime.listDir(relPath));
  ipcMain.handle("harness:read-file", (_e, relPath: string) => runtime.readFile(relPath));
  ipcMain.handle("harness:load-plugin", (_e, root: string) => runtime.loadPlugin(root));
  ipcMain.handle("harness:install-plugin", (_e, root: string) => runtime.installPlugin(root));
  ipcMain.handle("harness:trusted-plugins", () => runtime.trustedPlugins());
  // relay 登录（muzhi 会话）：打开登录窗口 / 查询登录态
  ipcMain.handle("harness:login", () => openLoginWindow());
  ipcMain.handle("harness:auth-status", () => authStatus());
  // MCP：启动/重扫插件 server（返回状态），或仅读取上次缓存的状态
  ipcMain.handle("harness:mcp-init", () => runtime.initMcpServers());
  ipcMain.handle("harness:mcp-status", () => runtime.mcpStatuses());

  // 交互式终端（宿主 PTY/管道，UI 用增量 read 轮询拉输出）
  ipcMain.handle("harness:term-start", (_e, input: { name?: string; command: string; cols?: number; rows?: number }) =>
    runtime.startTerminal(input),
  );
  ipcMain.handle("harness:term-read", (_e, id: string, sinceBytes?: number) => runtime.readTerminal(id, sinceBytes));
  ipcMain.handle("harness:term-write", (_e, id: string, text: string) => runtime.writeTerminal(id, text));
  ipcMain.handle("harness:term-resize", (_e, id: string, cols: number, rows: number) =>
    runtime.resizeTerminal(id, cols, rows),
  );
  ipcMain.handle("harness:term-kill", (_e, id: string) => runtime.killTerminal(id));
  ipcMain.handle("harness:term-list", () => runtime.listTerminals());

  // Git 面板/终端面板共用：直接执行已注入的本机工具（git_* / terminal_*）
  ipcMain.handle("harness:run-local-tool", (_e, id: string, args: Record<string, unknown>) =>
    runtime.runLocalTool(id, args),
  );

  // 事件流订阅：每个会话一个 AbortController，主进程把事件推给渲染进程
  ipcMain.on("harness:subscribe", (event, sessionId: string) => {
    const ac = new AbortController();
    subscribers.set(sessionId, ac);
    void (async () => {
      try {
        for await (const ev of runtime.subscribe(sessionId, ac.signal)) {
          if (event.sender.isDestroyed()) break;
          event.sender.send("harness:event", sessionId, ev);
        }
      } catch {
        /* 订阅已中止 */
      }
    })();
  });

  ipcMain.on("harness:unsubscribe", (_e, sessionId: string) => {
    subscribers.get(sessionId)?.abort();
    subscribers.delete(sessionId);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const ac of subscribers.values()) ac.abort();
  subscribers.clear();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  runtime.dispose();
});
