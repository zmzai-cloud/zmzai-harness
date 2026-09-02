import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { resolveWithinWorkspace } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type SkillSource = "workspace" | "codex" | "agents";

export type SkillInfo = {
  /** Stable public identifier. It deliberately never exposes an arbitrary filesystem path. */
  id: string;
  name: string;
  description?: string;
  source: SkillSource;
  markdown: string;
};

const SKILL_SOURCES: { source: SkillSource; label: string }[] = [
  { source: "workspace", label: "工作区" },
  { source: "codex", label: "Codex" },
  { source: "agents", label: "本机 Agent" },
];

/** 提取 SKILL.md 的 YAML frontmatter 中的 name/description（无 frontmatter 用目录名）。 */
function parseSkill(source: SkillSource, dirName: string, markdown: string): SkillInfo {
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
  return { id: `${source}:${dirName}`, name, description, source, markdown };
}

function sourceDirectory(source: SkillSource, workspace: string): string {
  if (source === "workspace") return join(workspace, ".zmzai", "skills");
  if (source === "codex") return join(homedir(), ".codex", "skills");
  return join(homedir(), ".agents", "skills");
}

/**
 * 只读发现工作区和宿主机已安装的 Skills。列表响应不返回 markdown：
 * 本机技能常有数十个，只有用户选中一个时才取正文并随该条消息注入。
 */
function discoverSkills(workspace: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  for (const { source } of SKILL_SOURCES) {
    try {
      const skillsDir = sourceDirectory(source, workspace);
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          const markdown = readFileSync(join(skillsDir, entry.name, "SKILL.md"), "utf8");
          skills.push(parseSkill(source, entry.name, markdown));
        } catch {
          // 缺 SKILL.md 的目录跳过（与 framework parseAgentPlugin 的容错一致）。
        }
      }
    } catch {
      // 某一技能根目录不存在或不可读不影响其余来源。
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/**
 * GET /api/skills         → 可发现的元数据（不传整份正文）
 * GET /api/skills?id=...  → 单个 Skill 正文，供本次 prompt 注入
 */
export async function GET(request: Request) {
  let root: string;
  try {
    root = resolveWithinWorkspace(null);
  } catch {
    return NextResponse.json({ skills: [] });
  }
  const skills = discoverSkills(root);
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const skill = skills.find((item) => item.id === id);
    if (!skill) return NextResponse.json({ error: "Skill 不存在或不可读取" }, { status: 404 });
    return NextResponse.json({ skill });
  }
  return NextResponse.json({
    skills: skills.map(({ markdown: _markdown, ...meta }) => meta),
    sources: SKILL_SOURCES,
  });
}
