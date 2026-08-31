"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import DiffView from "./DiffView";
import type { DiffFile, GitDiff } from "@/lib/types";

type Checkpoint = { hash: string; time: string; subject: string; checkpoint: boolean };

/**
 * 审查 Tab：工作区未提交变更（git diff HEAD）。
 * 文件列表（+/- 统计）→ 点击进入逐文件 diff；非 git 仓库降级提示。
 * 顶部检查点条（P1-9）：列出快照 commit，支持一键回滚（二次确认）。
 */
export default function ReviewPane({ editedPaths = [] }: { editedPaths?: string[] }) {
  const [data, setData] = useState<GitDiff | null>(null);
  const [selected, setSelected] = useState<DiffFile | null>(null);
  const [fileDiff, setFileDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [cpsOpen, setCpsOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const refreshCps = useCallback(async () => {
    try {
      const r = await client.checkpoints();
      setCheckpoints(r.points.filter((p) => p.checkpoint));
    } catch {
      setCheckpoints([]);
    }
  }, []);

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
    void refreshCps();
  }, [refresh, refreshCps]);

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
        <div className="max-w-56 text-xs leading-5 text-ink-3">在工作区初始化 git 后，这里会显示 Agent 产生的未提交变更；检查点/回滚（P1-9）也依赖 git 快照。</div>
        <code className="rounded-sm bg-surface-2 px-2 py-1 font-mono text-[0.6875rem] text-ink-2">git init</code>
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
        {/* 检查点（P1-9）：任务前快照列表 + 回滚 */}
        <button
          type="button"
          onClick={() => setCpsOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[0.6875rem] font-medium transition-colors",
            cpsOpen ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink",
          )}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 5.5V8l1.8 1.8" strokeLinecap="round" />
          </svg>
          检查点{checkpoints.length > 0 ? ` · ${checkpoints.length}` : ""}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[0.6875rem] text-ink-3 transition-colors hover:text-ink"
        >
          刷新
        </button>
      </div>

      {/* 检查点下拉列表 */}
      {cpsOpen && (
        <div className="shrink-0 border-b border-line bg-surface-2/50 p-2">
          {checkpoints.length === 0 && (
            <div className="px-2 py-1.5 text-[0.6875rem] leading-5 text-ink-3">
              还没有检查点。发送任务时会自动打快照（git 仓库且有变更时）。
            </div>
          )}
          {checkpoints.map((cp) => (
            <div key={cp.hash} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-2">
              <span className="shrink-0 font-mono text-[0.625rem] text-accent-strong">{cp.hash.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-ink-2" title={cp.subject}>
                {cp.subject.replace("harness-checkpoint: ", "")}
              </span>
              <span className="shrink-0 text-[0.625rem] text-ink-3">
                {new Date(cp.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
              <button
                type="button"
                disabled={restoring}
                onClick={() => {
                  if (!window.confirm(`硬回滚到 ${cp.hash.slice(0, 7)}？之后的所有提交与未跟踪文件将被丢弃。`)) return;
                  setRestoring(true);
                  void client
                    .checkpointRestore(cp.hash)
                    .then(() => {
                      setCpsOpen(false);
                      return refresh();
                    })
                    .catch((e: Error) => window.alert(`回滚失败：${e.message}`))
                    .finally(() => setRestoring(false));
                }}
                className="shrink-0 rounded-pill border border-danger/40 px-1.5 py-0.5 text-[0.625rem] text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
              >
                回滚
              </button>
            </div>
          ))}
        </div>
      )}

      {selected ? (
        <DiffView diff={fileDiff} path={selected?.path} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {files.length === 0 && (
            <div className="px-3 py-6 text-center text-xs leading-5 text-ink-3">
              Agent 修改文件后，变更会出现在这里供审查。
            </div>
          )}
          {files.map((f) => {
            const touched = editedPaths.includes(f.path); // F4：本轮 Agent 触碰的文件高亮
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => void openFile(f)}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2",
                  touched && "bg-live-tint/60",
                )}
              >
                {touched && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" title="本轮 Agent 触碰" />}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
