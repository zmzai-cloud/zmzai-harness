import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type HarnessEvent = { type: string; data: unknown };

/** 渲染进程通过 window.harness 调主进程引擎。事件流用 onEvent 订阅。 */
const harness = {
  createSession: (agent?: string, model?: { providerId: string; modelId: string }) =>
    ipcRenderer.invoke("harness:create-session", agent, model),
  prompt: (sessionId: string, text: string, agent?: string, model?: { providerId: string; modelId: string }) =>
    ipcRenderer.invoke("harness:prompt", sessionId, text, agent, model),
  replyPermission: (sessionId: string, requestId: string, reply: "once" | "always" | "reject", feedback?: string) =>
    ipcRenderer.invoke("harness:reply-permission", sessionId, requestId, reply, feedback),
  abort: (sessionId: string) => ipcRenderer.invoke("harness:abort", sessionId),
  listAgents: () => ipcRenderer.invoke("harness:list-agents"),
  listSessions: () => ipcRenderer.invoke("harness:list-sessions"),
  getMessages: (sessionId: string) => ipcRenderer.invoke("harness:get-messages", sessionId),
  listDir: (relPath: string) => ipcRenderer.invoke("harness:list-dir", relPath),
  readFile: (relPath: string) => ipcRenderer.invoke("harness:read-file", relPath),
  loadPlugin: (root: string) => ipcRenderer.invoke("harness:load-plugin", root),
  installPlugin: (root: string) => ipcRenderer.invoke("harness:install-plugin", root),
  trustedPlugins: () => ipcRenderer.invoke("harness:trusted-plugins"),

  /** 订阅某会话事件流。返回取消函数。 */
  subscribe: (sessionId: string, cb: (ev: HarnessEvent) => void) => {
    const listener = (_e: IpcRendererEvent, sid: string, ev: HarnessEvent) => {
      if (sid === sessionId) cb(ev);
    };
    ipcRenderer.on("harness:event", listener);
    ipcRenderer.send("harness:subscribe", sessionId);
    return () => {
      ipcRenderer.removeListener("harness:event", listener);
      ipcRenderer.send("harness:unsubscribe", sessionId);
    };
  },
};

contextBridge.exposeInMainWorld("harness", harness);

export type HarnessApi = typeof harness;
