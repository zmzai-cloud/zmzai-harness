// App 增强能力从这里注入 window.harnessNative（Web 端不存在该桥，UI 需能力探测降级）。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harnessNative", {
  /** 系统原生文件夹选择对话框（项目切换器「添加文件夹」用）。返回绝对路径或 null。 */
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),

  /** 任务完成系统通知（主进程 Notification——Electron 下 Web 通知未聚焦时不可靠）。 */
  notifyTaskDone: () => ipcRenderer.send("notify:taskDone"),
});
