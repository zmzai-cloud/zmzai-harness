// Lectern — Electron 壳（原 zmzai agent harness）
// Web / App 同构：App 与浏览器加载同一个 Next.js 页面（默认 127.0.0.1:3100）。
// 生产模式（打包后）：壳内自动拉起内嵌的 Next standalone 服务（node .next/standalone/server.js），
// 数据/工作区落到系统用户数据目录（asar 内只读，不能写相对路径）。
// dev 模式：等待外部 dev server（pnpm dev 的 next dev）就绪。
// 壳内不跑业务逻辑；本地引擎能力（MCP/终端/git，见 legacy/）保留为后续增强。

const { app, BrowserWindow, dialog, ipcMain, session, utilityProcess, Tray, globalShortcut, Notification, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const WEB_PORT = Number(process.env.HARNESS_WEB_PORT ?? 3100);
const WEB_URL = (process.env.HARNESS_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`).replace(/\/$/, "");
// SSO 登录页（与 muzhi /login 同一跳转目标）：GitHub OAuth / 邮箱密码都在这里完成
const AUTH_SSO_URL = (process.env.AUTH_SSO_URL ?? "https://auth.zmzai.cloud").replace(/\/$/, "");
// 共享会话 cookie 名（zmzai-auth SESSION_COOKIE_NAME 默认值，种在 .zmzai.cloud 父域）
const AUTH_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "muzhi_session";

let webProcess = null;
let tray = null;
let pollTimer = null;
let authWin = null;

/** 创建菜单栏托盘（macOS）：图标 + 状态文字点（绿●运行中 / 黄◐等待授权），
 *  点击唤起/聚焦主窗。仅打包时创建（dev 下反复重建托盘体验差，
 *  HARNESS_TRAY=1 可强制开启调试）。 */
function createTray() {
  if (process.platform !== "darwin") return;
  if (!app.isPackaged && process.env.HARNESS_TRAY !== "1") return;
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Lectern");
  tray.on("click", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return createWindow();
    if (win.isVisible()) win.focus();
    else win.show();
  });
}

/** 托盘状态：轻量轮询 /api/sessions（5s），running→绿点、等待授权→黄点。
 *  macOS 菜单栏 title 是标准的状态指示方式（iTerm/Typescript playground 同款）。 */
function startTrayPolling() {
  if (!tray) return;
  clearInterval(pollTimer);
  const update = async () => {
    try {
      const res = await fetch(`${WEB_URL}/api/sessions`, { signal: AbortSignal.timeout(3000) });
      const sessions = res.ok ? await res.json() : [];
      const waiting = sessions.some((s) => s.status === "waiting_permission");
      const running = sessions.some((s) => s.running || s.status === "running");
      tray.setTitle(waiting ? "◐" : running ? "●" : "");
      tray.setToolTip(waiting ? "zmzai harness — 等待授权" : running ? "zmzai harness — 任务运行中" : "zmzai harness");
    } catch {
      tray.setTitle("");
    }
  };
  void update();
  pollTimer = setInterval(update, 5000);
}

/** 全局快捷键 ⌘⇧H：唤起/隐藏主窗（桌面端区别于网页的存在感所在）。 */
function registerGlobalShortcut() {
  if (process.platform !== "darwin") return;
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return createWindow();
    if (win.isVisible() && win.isFocused()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });
}

/** 主进程任务完成通知（Electron 下 Web Notification 未聚焦时不可靠，走主进程）。
 *  渲染进程通过 harnessNative.notifyTaskDone() 桥接触发。 */
function notifyTaskDone() {
  if (!Notification.isSupported()) return;
  new Notification({ title: "zmzai harness", body: "任务已完成，回来看看结果" }).show();
}

/** SSO 登录子窗口：加载 auth.zmzai.cloud/login（GitHub OAuth / 邮箱密码）。
 *  登录成功后 auth 在默认 session 的 .zmzai.cloud 父域种下共享会话 cookie，
 *  cookieWatch 把值回传主窗口渲染层，经 /api/auth/ingest 落成 127.0.0.1 的
 *  host-only cookie（父域 cookie 对 localhost 不可见，必须中转一次）。 */
function openAuthWindow(mainWin) {
  if (authWin && !authWin.isDestroyed()) {
    authWin.focus();
    return;
  }
  authWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: "zmzai 用户登录",
    backgroundColor: "#ffffff",
    parent: mainWin ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  authWin.setMenuBarVisibility(false);
  void authWin.loadURL(`${AUTH_SSO_URL}/login?next=${encodeURIComponent("https://muzhi.zmzai.cloud")}`);
  authWin.on("closed", () => {
    authWin = null;
  });
}

/** 默认 session 里找已有的 .zmzai.cloud 共享会话 cookie（此前登录过的兜底）。 */
async function findSsoCookie() {
  try {
    const list = await session.defaultSession.cookies.get({ name: AUTH_COOKIE_NAME });
    return list.find((c) => c.domain && c.domain.includes("zmzai.cloud"))?.value ?? null;
  } catch {
    return null;
  }
}

/** 监听 cookie 变化：auth 窗完成登录（含 GitHub OAuth 回调）→ 立即回传并收窗。 */
function startCookieWatch() {
  session.defaultSession.cookies.on("changed", (_event, cookie, _cause, removed) => {
    if (removed) return;
    if (cookie.name !== AUTH_COOKIE_NAME) return;
    if (!cookie.domain || !cookie.domain.includes("zmzai.cloud")) return;
    // 本地 /api/auth/login 也会种同名 cookie，但域是 127.0.0.1，已被上面的域过滤排除
    if (authWin && !authWin.isDestroyed()) authWin.close();
    // 动态取主窗：窗口可能被关闭重建，固定引用会失效
    const mainWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith(WEB_URL));
    mainWin?.webContents.send("auth:ssoCookie", cookie.value);
  });
}

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

/** 生产模式：用 utilityProcess 拉起内嵌 Next.js standalone 服务（.next/standalone/server.js）。
 *  不用 spawn + ELECTRON_RUN_AS_NODE：Electron 35+ 起 run-as-node 子进程也会向
 *  LaunchServices 注册 Foreground app → Dock 每次多弹一个无图标的「exec」图标；
 *  utilityProcess 是 Utility 类型（BackgroundOnly），天然无 Dock/GUI。
 *  dev 跳过（外部 next dev）。 */
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
  webProcess = utilityProcess.fork(serverEntry, [], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(WEB_PORT),
      HOSTNAME: "127.0.0.1",
      // 覆盖相对路径：打包后 cwd 是 asar（只读），会话与工作区必须落用户目录。
      // HARNESS_DATA_DIR / HARNESS_WORKSPACE 是 lib/runtime-constants 实际读取的变量；
      // ZMZAI_* 为兼容别名保留（勿只写 ZMZAI_*：旧版曾因此把数据写进 app 包内）
      ZMZAI_DATA_DIR: path.join(userData, "data"),
      HARNESS_DATA_DIR: path.join(userData, "data"),
      ZMZAI_WORKSPACE: path.join(userData, "workspace"),
      HARNESS_WORKSPACE: path.join(userData, "workspace"),
    },
    // inherit：stdout/stderr 转发到主进程（调试可见）
    stdio: "inherit",
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
    // 集成标题栏（Qoder/VSCode 同款）：隐藏系统标题栏，保留红绿灯（macOS），
    // 页面顶栏变拖拽区（见 globals.css html.electron 规则）。非 macOS 自动忽略。
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 17 } }
      : {}),
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
  // 任务完成通知桥（preload 暴露为 window.harnessNative.notifyTaskDone）
  ipcMain.on("notify:taskDone", () => notifyTaskDone());

  // SSO 登录桥：打开 auth 子窗口；若默认 session 已有共享会话 cookie 直接返回（免再登）
  ipcMain.handle("auth:openSSO", async (event) => {
    const mainWin = BrowserWindow.fromWebContents(event.sender);
    openAuthWindow(mainWin);
    return findSsoCookie();
  });

  // 品牌改名迁移（一次性）：productName 从 "zmzai Harness" 改为 "Lectern" 后，
  // userData 目录随之变化；若旧目录存在且新目录还没有会话库，整体搬过来。
  {
    const userData = app.getPath("userData");
    const legacy = path.join(path.dirname(userData), "zmzai Harness");
    if (path.resolve(legacy) !== path.resolve(userData) && fs.existsSync(legacy)
        && !fs.existsSync(path.join(userData, "zmzai.db"))) {
      try { fs.cpSync(legacy, userData, { recursive: true }); } catch {}
    }
  }

  ensureWebServer();
  await waitForWeb(WEB_URL);
  createWindow();
  createTray();
  startTrayPolling();
  registerGlobalShortcut();
  startCookieWatch();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  clearInterval(pollTimer);
  globalShortcut.unregisterAll();
  webProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
