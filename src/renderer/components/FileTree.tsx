import { useEffect, useState } from "react";

type Entry = { name: string; path: string; isDirectory: boolean; size: number };

function FolderNode({ relPath, name, depth }: { relPath: string; name: string; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  useEffect(() => {
    if (open) window.harness.listDir(relPath).then(setEntries).catch(() => setEntries([]));
  }, [open, relPath]);
  return (
    <div>
      <div className="tree-item dir" onClick={() => setOpen((o) => !o)} style={{ paddingLeft: depth * 8 }}>
        {open ? "▾" : "▸"} {name}
      </div>
      {open && entries && (
        <div className="tree-children">
          {entries.map((e) =>
            e.isDirectory ? (
              <FolderNode key={e.path} relPath={e.path} name={e.name} depth={depth + 1} />
            ) : (
              <FileNode key={e.path} relPath={e.path} name={e.name} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function FileNode({ relPath, name }: { relPath: string; name: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = async () => {
    if (!open) {
      const c = await window.harness.readFile(relPath);
      setContent(c);
    }
    setOpen((o) => !o);
  };
  return (
    <div>
      <div className="tree-item" onClick={toggle}>
        {name}
      </div>
      {open && content != null && (
        <pre className="tool-body" style={{ margin: "4px 0 4px 12px" }}>
          {content}
        </pre>
      )}
      {open && content == null && (
        <div className="muted" style={{ marginLeft: 12 }}>
          无法读取（可能是二进制或权限受限）
        </div>
      )}
    </div>
  );
}

export default function FileTree() {
  const [root, setRoot] = useState<Entry[] | null>(null);
  useEffect(() => {
    window.harness.listDir("").then(setRoot).catch(() => setRoot([]));
  }, []);
  return (
    <div>
      <div className="section-title">工作区文件</div>
      {root == null && <div className="muted">加载中…</div>}
      {root && root.length === 0 && <div className="muted">空工作区</div>}
      {root?.map((e) =>
        e.isDirectory ? (
          <FolderNode key={e.path} relPath={e.path} name={e.name} depth={0} />
        ) : (
          <FileNode key={e.path} relPath={e.path} name={e.name} />
        ),
      )}
    </div>
  );
}
