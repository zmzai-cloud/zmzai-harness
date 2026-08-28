"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { DiffFile, GitDiff } from "@/lib/types";

/** unified diff 逐行着色渲染（+ 增 / - 删 / @@ 定位 / 其余上下文）。 */
function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[0.6875rem] leading-[1.45]">
      {lines.map((line, i) => {
        let cls = "text-ink-2";
        if (line.startsWith("+")) cls = "text-success bg-success/10";
        else if (line.startsWith("-")) cls = "text-danger bg-danger/10";
        else if (line.startsWith("@@")) cls = "text-accent-strong";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-ink-3";
        return (
          <div key={i} className={cn("whitespace-pre-wrap break-all px-1", cls)}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/**
 * 审查 Tab：工作区未提交变更（git diff HEAD）。
 * 文件列表（+/- 统计）→ 点击进入逐文件 diff；非 git 仓库降级提示。
 */
export default function ReviewPane() {
  const [data, setData] = useState<GitDiff | null>(null);
  const [selected, setSelected] = useState<DiffFile | null>(null);
  const [fileDiff, setFileDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    try {
      setData(await client.gitDiff());
    } catch {
      setData({ available: false, files: [], diff: "" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openFile = useCallback(async (f: DiffFile) => {
    setSelected(f);
    setFileDiff("");
    try {
      const d = await client.gitDiff(f.path);
      setFileDiff(d.diff || "（该文件无未暂存 diff，可能是新文件或已暂存）");
    } catch (err) {
      setFileDiff(`读取失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  }, []);

  if (loading && !data) {
    return <div className="p-4 text-xs text-ink-3">读取变更中…</div>;
  }
  if (data && !data.available) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm font-semibold text-ink-2">当前项目不是 git 仓库</div>
        <div className="max-w-56 text-xs leading-5 text-ink-3">在工作区初始化 git 后，这里会显示 Agent 产生的未提交变更。</div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()}>
          重新检测
        </Button>
      </div>
    );
  }

  const files = data?.files ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        {selected ? (
          <>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-[0.6875rem] text-ink-3 transition-colors hover:text-ink"
            >
              ← 返回
            </button>
            <span className="truncate font-mono text-[0.6875rem] text-ink-2" title={selected.path}>
              {selected.path}
            </span>
          </>
        ) : (
          <>
            <span className="text-[0.6875rem] text-ink-3">
              {files.length > 0 ? `${files.length} 个文件变更` : "没有未提交变更"}
            </span>
            {data?.truncated && <span className="text-[0.625rem] text-warning">diff 已截断</span>}
          </>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[0.6875rem] text-ink-3 transition-colors hover:text-ink"
        >
          刷新
        </button>
      </div>

      {selected ? (
        <DiffView diff={fileDiff} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {files.length === 0 && (
            <div className="px-3 py-6 text-center text-xs leading-5 text-ink-3">
              Agent 修改文件后，变更会出现在这里供审查。
            </div>
          )}
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => void openFile(f)}
              className="mb-0.5 flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ink-2" title={f.path}>
                {f.path}
              </span>
              {f.binary ? (
                <span className="shrink-0 text-[0.625rem] text-ink-3">binary</span>
              ) : (
                <span className="shrink-0 font-mono text-[0.625rem]">
                  <span className="text-success">+{f.additions}</span> <span className="text-danger">-{f.deletions}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
