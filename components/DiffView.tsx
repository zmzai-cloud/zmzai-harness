"use client";

import { cn } from "@zmzai/theme";

/** unified diff 逐行着色渲染（+ 增 / - 删 / @@ 定位 / 其余上下文）。
 *  审查 Tab 与消息流内的编辑 diff 卡片共用。 */
export default function DiffView({ diff, className }: { diff: string; className?: string }) {
  const lines = diff.split("\n");
  return (
    <pre className={cn("min-h-0 flex-1 overflow-auto p-3 font-mono text-[0.6875rem] leading-[1.45]", className)}>
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

/** 从 unified diff 文本统计 +/- 行数（头部 @@/diff/index 行不计）。 */
export function diffStat(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}
