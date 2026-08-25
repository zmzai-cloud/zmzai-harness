import { useEffect, useState } from "react";

type Preview = {
  manifest?: { name?: string; version?: string; description?: string };
  skills?: unknown[];
  mcpServers?: Record<string, unknown>;
  errors?: string[];
};

export default function PluginPanel({ onInstalled }: { onInstalled: () => void }) {
  const [root, setRoot] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [trusted, setTrusted] = useState<string[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    window.harness.trustedPlugins().then(setTrusted);
  }, []);

  const refresh = () => window.harness.trustedPlugins().then(setTrusted);

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
      await window.harness.installPlugin(root.trim());
      setMsg("已信任安装: " + root);
      setPreview(null);
      setRoot("");
      await refresh();
      onInstalled();
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
