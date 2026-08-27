import { useEffect, useState } from "react";
import type { McpServerStatus } from "../types";

type Preview = {
  manifest?: { name?: string; version?: string; description?: string };
  skills?: unknown[];
  mcpServers?: Record<string, unknown>;
  errors?: string[];
};

export default function PluginPanel() {
  const [root, setRoot] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [trusted, setTrusted] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [mcp, setMcp] = useState<McpServerStatus[]>([]);
  const [mcpBusy, setMcpBusy] = useState(false);

  useEffect(() => {
    window.harness.trustedPlugins().then(setTrusted);
    // 只读缓存状态不主动拉起进程；首次连接交给用户点「初始化 MCP」或安装后自动触发
    window.harness.mcpStatus().then(setMcp);
  }, []);

  const refresh = () => window.harness.trustedPlugins().then(setTrusted);

  const initMcp = async () => {
    setMcpBusy(true);
    try {
      setMcp(await window.harness.initMcp());
    } finally {
      setMcpBusy(false);
    }
  };

  const previewPlugin = async () => {
    setMsg("");
    setPreview(null);
    if (!root.trim()) return;
    try {
      const p = (await window.harness.loadPlugin(root.trim())) as Preview;
      setPreview(p);
    } catch (e) {
      setMsg("解析失败: " + (e as Error).message);
    }
  };

  const install = async () => {
    setMsg("");
    if (!root.trim()) return;
    try {
      const parsed = (await window.harness.installPlugin(root.trim())) as Preview & { manifest: { name: string } };
      await initMcp(); // 安装后立即重扫并启动（含本次新装的）server
      const statuses = await window.harness.mcpStatus();
      setMcp(statuses);
      const prefix = `${parsed.manifest?.name}:`;
      const connected = statuses.filter((s) => s.state === "connected" && s.name.startsWith(prefix));
      setMsg(
        connected.length
          ? `已信任安装: ${root} · MCP ${connected.length} 个 server 已连接（${connected.flatMap((s) => s.tools).length} 个工具注入下一轮对话）`
          : statuses.some((s) => s.name.startsWith(prefix))
            ? `已信任安装: ${root} · MCP server 未连上，见下方状态`
            : `已信任安装: ${root}`,
      );
      setPreview(null);
      setRoot("");
      await refresh();
    } catch (e) {
      setMsg("安装失败: " + (e as Error).message);
    }
  };

  return (
    <div>
      <div className="section-title">插件（Agent Plugins 1.0）</div>
      <input type="text" placeholder="插件目录绝对路径" value={root} onChange={(e) => setRoot(e.target.value)} />
      <div style={{ height: 6 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-sm" onClick={previewPlugin}>
          解析
        </button>
        <button className="btn btn-primary btn-sm" onClick={install}>
          信任安装
        </button>
        <button className="btn btn-sm" disabled={mcpBusy} onClick={initMcp}>
          {mcpBusy ? "连接中…" : "初始化 MCP"}
        </button>
      </div>
      {msg && (
        <div className="muted" style={{ marginTop: 6 }}>
          {msg}
        </div>
      )}
      {preview && (
        <div className="plugin-row" style={{ marginTop: 8 }}>
          <div className="plugin-name">
            {preview.manifest?.name} {preview.manifest?.version ?? ""}
          </div>
          <div className="muted">{preview.manifest?.description}</div>
          <div className="muted">
            skills: {preview.skills?.length ?? 0} · mcp: {Object.keys(preview.mcpServers ?? {}).length}
          </div>
          {preview.errors?.length ? <div className="plugin-errors">{preview.errors.join("\n")}</div> : null}
        </div>
      )}
      {mcp.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>
            MCP Server
          </div>
          {mcp.map((s) => (
            <div key={s.name} className="plugin-row">
              <div className="plugin-name">
                {s.name}{" "}
                <span className={s.state === "connected" ? "tool-state completed" : "tool-state error"}>{s.state}</span>
              </div>
              {s.error ? (
                <div className="plugin-errors">{s.error}</div>
              ) : (
                <div className="muted">{s.tools.length ? s.tools.join("、") : "（无工具）"}</div>
              )}
            </div>
          ))}
        </>
      )}
      <div className="section-title" style={{ marginTop: 12 }}>
        已信任
      </div>
      {trusted.length === 0 && <div className="muted">无</div>}
      {trusted.map((t) => (
        <div key={t} className="plugin-row">
          {t}
        </div>
      ))}
    </div>
  );
}
