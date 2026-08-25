import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
const runtime = new EngineRuntime({ dataDir, workspaceRoot });

let mainWindow: BrowserWindow | null = null;
const subscribers = new Map<string, AbortController>();

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

  const devServerUrl = process.env["MAIN_WINDOW_VITE_DEV_SERVER_URL"];
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(resolve(__dirname, "../renderer/index.html"));
  }

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
