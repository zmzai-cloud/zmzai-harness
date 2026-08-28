"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@zmzai/theme";

import { client } from "@/lib/client";
import type { TreeNode } from "@/lib/types";

type Props = {
  /** 选中文件预览回调（Inspector 上层渲染内容） */
  onOpenFile: (path: string) => void;
};

/** 懒加载目录树：展开目录时按需拉一层内容，适合中型工作区。 */
export default function FileTree({ onOpenFile }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, TreeNode[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const load = useCallback(async (path: string) => {
    setLoading((prev) => new Set(prev).add(path));
    try {
      const { nodes } = await client.fsTree(path);
      setChildren((prev) => new Map(prev).set(path, nodes));
    } catch {
      setChildren((prev) => new Map(prev).set(path, []));
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!children.has(path)) void load(path);
      }
      return next;
    });
  };

  const render = (nodes: TreeNode[], base: string, depth: number) => (
    <ul className={cn(depth === 0 && "mt-1")}>
      {nodes.map((n) => {
        const rel = base ? `${base}/${n.name}` : n.name;
        const open = expanded.has(rel);
        return (
          <li key={rel}>
            <button
              type="button"
              onClick={() => (n.type === "dir" ? toggle(rel) : onOpenFile(rel))}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-xs transition-colors hover:bg-surface-2",
                "text-ink-2 hover:text-ink",
              )}
              style={{ paddingLeft: depth * 12 + 8 }}
              title={rel}
            >
              {n.type === "dir" ? (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  className={cn("shrink-0 transition-transform", open && "rotate-90")}
                  fill="currentColor"
                >
                  <path d="M3 1.5 7 5 3 8.5z" />
                </svg>
              ) : (
                <span className="h-2.5 w-2.5 shrink-0" />
              )}
              <span className="truncate">{n.name}</span>
              {n.type === "file" && n.size != null && (
                <span className="ml-auto shrink-0 text-[0.625rem] text-ink-3">
                  {n.size < 1024 ? `${n.size}B` : `${Math.round(n.size / 1024)}K`}
                </span>
              )}
            </button>
            {n.type === "dir" && open && (
              <>
                {loading.has(rel) ? (
                  <div className="py-1 text-[0.625rem] text-ink-3" style={{ paddingLeft: (depth + 1) * 12 + 8 }}>
                    加载中…
                  </div>
                ) : (
                  render(children.get(rel) ?? [], rel, depth + 1)
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      {render(children.get("") ?? [], "", 0)}
    </div>
  );
}
