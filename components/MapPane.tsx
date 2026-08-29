"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@zmzai/theme";

/** 项目地图（R1）：调 GET /api/repomap，展示 PageRank 排序的文件 + 定义符号。
 *  与 agent 的 repo_map 工具同源同缓存——模型看到的地图和这里一致。 */

type MapData = {
  text: string;
  stats: { files: number; symbols: number; tokens: number; cached: number; parsed: number };
};

export default function MapPane() {
  const [focus, setFocus] = useState("");
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback((focusText: string) => {
    const s = ++seq.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (focusText.trim()) params.set("focus", focusText.trim());
    void fetch(`/api/repomap?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: MapData) => {
        if (s === seq.current) setData(d);
      })
      .catch((err: Error) => {
        if (s === seq.current) setError(err.message);
      })
      .finally(() => {
        if (s === seq.current) setLoading(false);
      });
  }, []);

  // 首次进入自动加载
  useEffect(() => {
    load("");
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具条：focus 按任务相关性重排 + 刷新 */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(focus);
          }}
          placeholder="focus：任务描述或符号名，地图按相关性重排"
          className="h-6 min-w-0 flex-1 rounded-pill bg-surface-2 px-2.5 text-[0.6875rem] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        <button
          type="button"
          onClick={() => load(focus)}
          disabled={loading}
          className={cn(
            "shrink-0 rounded-pill px-2 py-0.5 text-[0.625rem] font-medium transition-colors",
            loading ? "bg-surface-2 text-ink-3" : "bg-surface-2 text-ink-2 hover:text-ink",
          )}
        >
          {loading ? "生成中…" : "生成"}
        </button>
      </div>

      {data && (
        <div className="flex h-7 shrink-0 items-center gap-3 border-b border-line px-3 text-[0.625rem] text-ink-3">
          <span>{data.stats.files} 文件</span>
          <span>{data.stats.symbols} 符号</span>
          <span>~{data.stats.tokens} tokens</span>
          {data.stats.cached > 0 && <span>缓存 {data.stats.cached}</span>}
          {data.stats.parsed > 0 && <span>新解析 {data.stats.parsed}</span>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-3 text-xs text-ink-3">地图生成失败：{error}</div>
        ) : !data && loading ? (
          <div className="p-3 text-xs text-ink-3">正在解析仓库结构…</div>
        ) : data ? (
          <pre className="p-3 font-mono text-[0.6875rem] leading-5 text-ink-2">{data.text || "（暂无可索引的代码文件）"}</pre>
        ) : null}
      </div>
    </div>
  );
}
