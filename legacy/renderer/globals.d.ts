export {};

declare global {
  interface Window {
    harness: {
      createSession: (agent?: string, model?: { providerId: string; modelId: string }) => Promise<import("./types").SessionInfo>;
      prompt: (sessionId: string, text: string, agent?: string, model?: { providerId: string; modelId: string }) => Promise<{ queued: boolean }>;
      replyPermission: (sessionId: string, requestId: string, reply: "once" | "always" | "reject", feedback?: string) => Promise<boolean>;
      abort: (sessionId: string) => Promise<void>;
      listAgents: () => Promise<import("./types").AgentInfo[]>;
      listSessions: () => Promise<import("./types").SessionInfo[]>;
      getMessages: (sessionId: string) => Promise<import("./types").TranscriptMessage[]>;
      listDir: (relPath: string) => Promise<{ name: string; path: string; isDirectory: boolean; size: number }[]>;
      readFile: (relPath: string) => Promise<string | null>;
      loadPlugin: (root: string) => Promise<unknown>;
      installPlugin: (root: string) => Promise<unknown>;
      trustedPlugins: () => Promise<string[]>;
      initMcp: () => Promise<import("./types").McpServerStatus[]>;
      mcpStatus: () => Promise<import("./types").McpServerStatus[]>;
      termStart: (input: { name?: string; command: string; cols?: number; rows?: number }) => Promise<import("./types").TerminalSessionInfo>;
      termRead: (id: string, sinceBytes?: number) => Promise<import("./types").TerminalReadResult | null>;
      termWrite: (id: string, text: string) => Promise<boolean>;
      termResize: (id: string, cols: number, rows: number) => Promise<boolean>;
      termKill: (id: string) => Promise<boolean>;
      termList: () => Promise<import("./types").TerminalSessionInfo[]>;
      runLocalTool: (id: string, args: Record<string, unknown>) => Promise<import("./types").RunToolResult>;
      login: () => Promise<{ opened: boolean; url: string }>;
      authStatus: () => Promise<import("./types").AuthStatus>;
      onAuthChanged: (cb: () => void) => () => void;
      subscribe: (sessionId: string, cb: (ev: import("./types").HarnessEvent) => void) => () => void;
    };
  }
}
