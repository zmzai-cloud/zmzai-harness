import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export type SkillSource = "workspace" | "codex" | "agents";
export type SkillInfo = { id: string; name: string; description?: string; source: SkillSource; digest: string };
export type LoadedSkill = SkillInfo & { markdown: string };
const MAX_SKILL_BYTES = 256 * 1024;
const SOURCES: SkillSource[] = ["workspace", "codex", "agents"];
function rootFor(source: SkillSource, workspace: string) { return source === "workspace" ? join(workspace, ".zmzai", "skills") : join(homedir(), source === "codex" ? ".codex" : ".agents", "skills"); }
function parse(source: SkillSource, dirname: string, markdown: string): LoadedSkill {
  let name = dirname; let description: string | undefined;
  const frontmatter = /^---\r?\n([\s\S]{0,16384}?)\r?\n---/.exec(markdown)?.[1] ?? "";
  for (const line of frontmatter.split(/\r?\n/)) { const m = /^(name|description):\s*(.+?)\s*$/.exec(line); if (!m) continue; if (m[1] === "name") name = m[2].replace(/^["']|["']$/g, ""); else description = m[2].replace(/^["']|["']$/g, ""); }
  return { id: `${source}:${dirname}`, name, description, source, digest: createHash("sha256").update(markdown).digest("hex"), markdown };
}
function readOne(workspace: string, source: SkillSource, dirname: string): LoadedSkill | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(dirname)) return null;
  try { const base = realpathSync(rootFor(source, workspace)); const file = realpathSync(join(base, dirname, "SKILL.md")); const stat = lstatSync(file); if (!stat.isFile() || stat.size > MAX_SKILL_BYTES || relative(base, file).startsWith("..")) return null; return parse(source, dirname, readFileSync(file, "utf8")); } catch { return null; }
}
export function listSkills(workspace: string): SkillInfo[] {
  const out: SkillInfo[] = [];
  for (const source of SOURCES) { const base = rootFor(source, workspace); if (!existsSync(base)) continue; try { for (const entry of readdirSync(base, { withFileTypes: true })) { if (!entry.isDirectory()) continue; const skill = readOne(workspace, source, entry.name); if (skill) { const { markdown: _markdown, ...meta } = skill; out.push(meta); } } } catch { /* continue */ } }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}
export function loadSkill(workspace: string, id: string): LoadedSkill | null { const m = /^(workspace|codex|agents):([a-zA-Z0-9._-]+)$/.exec(id); return m ? readOne(workspace, m[1] as SkillSource, m[2]) : null; }
