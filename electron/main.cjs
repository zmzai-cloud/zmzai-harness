// zmzai agent harness — Electron 壳
// Web / App 同构：App 与浏览器加载同一个 Next.js 页面（默认 127.0.0.1:3100）。
// 生产模式（打包后）：壳内自动拉起内嵌的 Next standalone 服务（node .next/standalone/server.js），
// 数据/工作区落到系统用户数据目录（asar 内只读，不能写相对路径）。
// dev 模式：等待外部 dev server（pnpm dev 的 next dev）就绪。
// 壳内不跑业务逻辑；本地引擎能力（MCP/终端/git，见 legacy/）保留为后续增强。

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const WEB_PORT = Number(process.env.HARNESS_WEB_PORT ?? 3100);
const WEB_URL = (process.env.HARNESS_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`).replace(/\/$/, "");

let webProcess = null;

/** 解析 .env 注入 process.env（已存在的环境变量优先）。standalone server 不保证读 .env，显式注入最稳。 */
function loadEnvFile() {
  try {
    const raw = fs.readFileSync(path.join(app.getAppPath(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    /* 无 .env，忽略 */
  }
}

/** 生产模式：spawn 内嵌 Next.js standalone 服务（.next/standalone/server.js）。dev 跳过（外部 next dev）。 */
function ensureWebServer() {
  if (!app.isPackaged) return;
  const serverEntry = path.join(app.getAppPath(), ".next", "standalone", "server.js");
  if (!fs.existsSync(serverEntry)) {
    console.error(`[harness] 找不到 ${serverEntry}，打包内容不完整`);
    app.exit(1);
    return;
  }
  loadEnvFile();
  const userData = app.getPath("userData");
  // standalone server.js 不解析 -p 参数，端口走 PORT 环境变量
  webProcess = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(WEB_PORT),
      HOSTNAME: "127.0.0.1",
      // 覆盖相对路径：打包后 cwd 是 asar（只读），会话与工作区必须落用户目录
      ZMZAI_DATA_DIR: path.join(userData, "data"),
      ZMZAI_WORKSPACE: path.join(userData, "workspace"),
      HARNESS_WORKSPACE: path.join(userData, "workspace"),
    },
    stdio: "inherit",
  });
  webProcess.on("error", (err) => {
    console.error(`[harness] 内嵌服务启动失败：${err.message}`);
  });
  webProcess.on("exit", (code) => {
    if (code !== 0 && !app.isQuitting) console.error(`[harness] 内嵌服务退出码 ${code}`);
  });
}

/** 等待 Next.js 就绪（dev 下 next dev 编译首屏较慢，最长等 120s）。 */
async function waitForWeb(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return;
    } catch {
      /* 未就绪，继续轮询 */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`[harness] ${url} 在 ${timeoutMs}ms 内未就绪，退出`);
  app.exit(1);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#ffffff",
    title: "zmzai agent harness",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  void win.loadURL(WEB_URL);
}

app.whenReady().then(async () => {
  // 原生文件夹选择对话框（preload 暴露为 window.harnessNative.pickFolder）
  ipcMain.handle("dialog:pickFolder", async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: "选择项目文件夹",
      properties: ["openDirectory"],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  ensureWebServer();
  await waitForWeb(WEB_URL);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  webProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
