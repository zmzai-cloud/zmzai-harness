import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { resolveWithinWorkspace } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type SkillInfo = { id: string; name: string; description?: string; markdown: string };

/** 提取 SKILL.md 的 YAML frontmatter 中的 name/description（无 frontmatter 用目录名）。 */
function parseSkill(dirName: string, markdown: string): SkillInfo {
  let name = dirName;
  let description: string | undefined;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const m = /^(name|description):\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      if (m[1] === "name") name = m[2].replace(/^["']|["']$/g, "");
      else description = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { id: dirName, name, description, markdown };
}

/** 工作区技能列表（.zmzai/skills/<name>/SKILL.md）。
 *  选中后由前端把 markdown 注入本次 prompt（framework PluginSkill 同源约定）。 */
export async function GET() {
  let root: string;
  try {
    root = resolveWithinWorkspace(null);
  } catch {
    return NextResponse.json({ skills: [] });
  }
  const skillsDir = join(root, ".zmzai", "skills");
  const skills: SkillInfo[] = [];
  try {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const markdown = readFileSync(join(skillsDir, entry.name, "SKILL.md"), "utf8");
        skills.push(parseSkill(entry.name, markdown));
      } catch {
        // 缺 SKILL.md 的目录跳过（与 framework parseAgentPlugin 的容错一致）
      }
    }
  } catch {
    // 无 skills 目录 → 空列表
  }
  return NextResponse.json({ skills });
}
