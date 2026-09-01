import { existsSync } from "node:fs";
import { basename } from "node:path";
import { userInfo } from "node:os";

/** 宿主机可用 shell 探测——对齐 VSCode：面板里起的是「用户的系统 shell」，
 *  而不是面板自己钦定的 zsh。开发者装了 zsh 就是 zsh，只有 bash 就是 bash，
 *  Windows 上退到 pwsh / PowerShell / cmd。
 *
 *  注意这与 agent 执行工具链是两回事：agent 跑命令仍走 /bin/sh -c（框架
 *  terminal-backend 的刻意选择，保证语法方言可预测），只有面板的交互会话
 *  才用这里的解析结果。 */

export type ShellCandidate = {
  /** 可执行文件路径（Windows 上可能是不带路径的可执行名，交给 spawn 按 PATH 解析）。 */
  file: string;
  /** 展示名：bash / zsh / fish / pwsh / cmd。 */
  label: string;
};

export type ShellInfo = {
  /** 系统默认 shell（已验证存在；极端环境可能为 null）。 */
  defaultShell: ShellCandidate | null;
  /** 本机探测到的全部候选，供面板下拉切换。 */
  shells: ShellCandidate[];
};

/** 只接受安全字符的绝对路径，避免拼接 shell 命令时被注入。 */
const SAFE_PATH = /^\/[A-Za-z0-9._\-/]+$/;

function toCandidate(file: string): ShellCandidate {
  const raw = basename(file);
  return { file, label: raw.replace(/\.exe$/i, "") };
}

function exists(file: string): boolean {
  if (!SAFE_PATH.test(file)) return false;
  try {
    return existsSync(file);
  } catch {
    return false;
  }
}

/** POSIX 侧：优先 $SHELL（登录 shell），其次 /etc/passwd（os.userInfo），最后按常见路径兜底。 */
function resolvePosix(): ShellInfo {
  const candidates: ShellCandidate[] = [];
  const push = (file: string) => {
    if (file && exists(file) && !candidates.some((c) => c.file === file)) {
      candidates.push(toCandidate(file));
    }
  };

  // Electron 从 Finder 启动时环境很干净，$SHELL 未必有；userInfo().shell 读
  // /etc/passwd 的登录 shell，macOS/Linux 都能拿到，是更稳的第一顺位。
  const fromEnv = process.env.SHELL;
  if (fromEnv) push(fromEnv);
  try {
    const fromPasswd = userInfo().shell;
    if (fromPasswd) push(fromPasswd);
  } catch {
    /* 少数容器环境取不到 */
  }
  for (const fallback of ["/bin/zsh", "/bin/bash", "/usr/bin/zsh", "/usr/bin/bash", "/bin/sh"]) {
    push(fallback);
  }

  return { defaultShell: candidates[0] ?? null, shells: candidates };
}

/** Windows 侧：pwsh → powershell → cmd（与 VSCode 的优先级一致）。 */
function resolveWindows(): ShellInfo {
  const candidates: ShellCandidate[] = [];
  const known = new Set<string>();
  const push = (file: string) => {
    const label = toCandidate(file).label;
    if (!known.has(label)) {
      known.add(label);
      candidates.push({ file, label });
    }
  };
  // pwsh / powershell 走 PATH 解析（安装位置不固定），cmd 用 ComSpec 兜底
  push("pwsh.exe");
  push("powershell.exe");
  push(process.env.ComSpec && process.env.ComSpec.trim() ? process.env.ComSpec.trim() : "cmd.exe");
  return { defaultShell: candidates[0] ?? null, shells: candidates };
}

let cached: ShellInfo | null = null;

/** 解析结果进程内缓存一次：/etc/passwd 与 PATH 在运行期不会变。 */
export function resolveShells(): ShellInfo {
  if (!cached) cached = process.platform === "win32" ? resolveWindows() : resolvePosix();
  return cached;
}

/**
 * 把 shell 拼成一条「可交给 sh -c 执行」的交互式命令。
 * 用 exec 让 sh 直接让位给目标 shell：进程树里不残留中间 sh，
 * kill 会话时打到的就是 shell 本身（否则会留孤儿 zsh）。
 *
 * - POSIX：`exec '/bin/zsh' -il`，macOS 额外 -l（登录 shell）——Electron 从
 *   Finder 启动时 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，必须靠登录 shell
 *   去 /etc/zprofile + ~/.zshrc 把 Homebrew 那套 PATH 补回来。
 * - Windows：后端已经用 cmd /d /s /c 包了一层，这里直接给目标 exe。
 */
export function interactiveShellCommand(shell: ShellCandidate): string {
  if (process.platform === "win32") {
    if (/powershell|pwsh/i.test(shell.label)) return `${shell.file} -NoLogo -NoExit`;
    return shell.file;
  }
  const login = process.platform === "darwin" ? "l" : "";
  return `exec '${shell.file}' -i${login}`;
}
