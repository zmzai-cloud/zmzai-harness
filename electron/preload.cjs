// App 增强能力从这里注入 window.lecternNative（Web 端不存在该桥，UI 需能力探测降级）。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lecternNative", {
  /** 系统原生文件夹选择对话框（项目切换器「添加文件夹」用）。返回绝对路径或 null。 */
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),

  /** 任务完成系统通知（主进程 Notification——Electron 下 Web 通知未聚焦时不可靠）。 */
  notifyTaskDone: () => ipcRenderer.send("notify:taskDone"),

  /** SSO 登录：打开 auth.zmzai.cloud 子窗口（GitHub OAuth / 邮箱密码）。
   *  返回已有共享会话 cookie 值或 null；登录完成（cookie 变化）经 onSsoCookie 回调送达。 */
  openAuthWindow: () => ipcRenderer.invoke("auth:openSSO"),

  /** 订阅 SSO 会话 cookie（主进程从 auth 域 session 捕获后推送，值只经内存不落盘）。 */
  onSsoCookie: (callback) => {
    ipcRenderer.on("auth:ssoCookie", (_event, value) => callback(value));
  },

  /** Electron 主进程截获 ⌘W 后转交工作台：由当前焦点区域决定关闭哪个对象。 */
  onCloseFocusedPane: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("workbench:close-focused-pane", handler);
    return () => ipcRenderer.removeListener("workbench:close-focused-pane", handler);
  },
});
