import { NextResponse, type NextRequest } from "next/server";

import { addProject, getActiveProject, listProjects, setActiveProject } from "@/lib/projects";
import { switchProjectWorkspace } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 项目列表 + 当前项目。 */
export async function GET() {
  return NextResponse.json({ projects: listProjects(), active: getActiveProject() });
}

/** 添加项目（本地文件夹路径），并激活。 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { path?: string };
    if (!body.path?.trim()) return NextResponse.json({ error: "缺少 path" }, { status: 400 });
    const project = addProject(body.path.trim());
    switchProjectWorkspace(project.path);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "添加失败" }, { status: 400 });
  }
}

/** 切换 active 项目（切换后全站跟随：会话/文件树/Git/终端/工作区）。 */
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string };
    if (!body.id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
    const project = setActiveProject(body.id);
    switchProjectWorkspace(project.path);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "切换失败" }, { status: 400 });
  }
}
