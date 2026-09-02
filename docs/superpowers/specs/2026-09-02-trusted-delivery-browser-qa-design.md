# Lectern 本地可信交付、浏览器 QA 与验证终端

## 目标

把 Lectern 从“Agent 完成一段对话”升级为“Agent 交付一份可验证的本地工程结果”。

首期只服务当前电脑上的项目与 session worktree：用户能审查本轮变更、看到确切运行过的验证命令、查看浏览器 QA 截图与错误，并决定接受、退回或丢弃结果。它不尝试实现云端 Agent、跨设备同步、定时任务或完整 VS Code 终端复刻。

## 已定决策

1. 目标范围是**本地可信交付**，不是先做云端/自动化平台。
2. 本轮新增或修改可预览 Web/HTML 产物时，浏览器 QA 默认执行。
3. QA 优先复用**同一 session、同一 effective workspace root** 已注册的服务；没有时以 worktree 为 cwd 启动项目声明的临时服务与独立端口。
4. 第一优先级的终端增强是任务级验证记录，不是 split、查找或拖拽路径等人工终端细节。
5. 自动 QA 首次失败时，Agent 获得结构化失败证据并自动尝试修复一次；第二次失败即停止，交付状态为 `verification_failed`。
6. 审查页是交付决策页：变更、验证证据、截图和接受/退回/丢弃动作在同一任务边界内呈现。

## 非目标

- 远程/云端执行、手机/跨设备控制、团队协作服务端。
- 通用工作流调度、定时 Automation、CI/PR 自动发布。
- 第一阶段内实现完整 VS Code 终端功能集。
- 让 Agent 猜测任意项目的启动命令；未知项目只做静态产物检查。
- 用聊天文本或临时浏览器状态作为验证、服务或交付状态的唯一来源。

## 核心原则

### 任务边界不可串台

所有交付数据都必须绑定：

```ts
type DeliveryOwner = {
  projectId: string;
  sessionId: string;
  effectiveWorkspaceRoot: string;
};
```

`effectiveWorkspaceRoot` 是该 session 的 worktree（若启用隔离），否则是当前项目根目录。读取文件、启动服务、打开浏览器、截图、重跑命令和审查 diff 全部从这个边界解析；不得回退到“当前 UI 所在项目”或另一个 session 的根目录。

### 验证必须是证据，不是文案

任何“通过”均来自持久化的结构化记录。Agent 的自然语言总结只能解释证据，不能替代命令退出码、浏览器结果或截图。

### 默认自动化必须有限制

自动启动服务只允许来源明确的项目声明；自动修复最多一次；已存在的用户服务只可观察和链接，不可停止或改写。

## 交付模型

### 不可变尝试与状态机

`TaskDelivery` 是一个任务在某个 session/worktree 内的交付容器；每次 Agent run、hunk 反馈续接或用户显式“重新验证”都新建一个不可变的 `DeliveryAttempt`。所有命令、QA、截图和审查动作只属于一个 attempt，不能直接属于聊天或 UI 临时状态。

创建 attempt 时，服务端只固定一个不可变的 `ApprovedExecutionPlan` version；Agent 在 `running` 中对工作区的正常编辑不应让 attempt 自我失效。进入 `verifying` 的原子转换时，服务端才在 canonical effective workspace root 捕获**验证快照**：`baseHeadSha`、当前 HEAD、受 Git 跟踪与未跟踪变更共同计算的 `worktreeFingerprint`，以及实际使用的 plan hash。随后以临时 Git index 将该快照物化为只含已验证内容的 immutable delivery commit/tree（不修改用户 worktree）。此后每条验证证据、展示“可合并”、以及真正合并前都必须重新计算并完全比对这个验证快照。

- 快照变化（Agent、人工终端或其它进程改了工作区；base branch 前进；声明配置变化）立即使已有成功证据失效，attempt 进入 `unverified`（`unverifiedReason: "snapshot_stale"`），仍可查看但不可接受或合并。
- 新 attempt 会 supersede 前一个 active attempt；旧证据永久保留以便审计，但不再具备合并资格。
- 正常“接受并合并”是 compare-and-swap：当前 attempt 必须是未 superseded、`ready_for_review`，且合并瞬间快照仍相等。零 required 检查的 `unverifiedReason: "no_required_checks"` attempt 可由用户经二次确认执行**“接受未验证快照并合并”**；它不是普通通过，也必须有完整验证快照并走同一 CAS。`snapshot_stale` 的 unverified attempt 永不可接受，必须新建 attempt。服务端只从 immutable delivery commit 创建 merge commit，并以 `git update-ref <baseRef> <mergeCommit> <verifiedBaseHeadSha>` 原子更新目标 ref；任何 base 并发推进、源快照变化或 ref precondition 失败均拒绝并提示重新验证。任一前置条件不成立即拒绝，绝不从仍可写的 worktree 直接 merge。

唯一合法路径为 `running -> verifying -> ready_for_review | verification_failed | unverified`；在 `running`、服务 `starting` 或 QA `running` 中停止均可进入 `cancelled`，其下属进程/记录也必须终结为 `cancelled` 或已完成态。任一非终态创建新 run 时创建新 attempt 并 supersede 旧 attempt；只有当前 active attempt 可以进入 `accepted` 或 `discarded`。

```ts
type DeliveryStatus =
  | "running"
  | "verifying"
  | "ready_for_review"
  | "verification_failed"
  | "unverified"
  | "cancelled"
  | "accepted"
  | "discarded";
```

| 状态 | 进入条件 | 可执行动作 | 退出条件 |
| --- | --- | --- | --- |
| `running` | attempt 已创建，Agent run 已开始 | 停止、追加指令 | 编辑结束、开始验证或取消 |
| `verifying` | 有待执行的 required/advisory 验证 | 查看实时证据、停止 | 聚合验证结果或取消 |
| `ready_for_review` | 至少一个 required 检查适用且全部 required 通过，快照仍一致 | 接受、退回、继续修改、丢弃 | 用户决策、快照失效或新 attempt |
| `verification_failed` | QA/测试失败，自动修复一次后仍失败 | 查看证据、继续修改、丢弃 | 用户发起新 run 或丢弃 |
| `unverified` | 没有适用的 required 检查（`no_required_checks`），或原有验证快照已失效（`snapshot_stale`） | 查看、重新验证、继续修改、丢弃 | `no_required_checks` 仅可经显式二次确认“接受未验证快照并合并”，仍走 CAS；`snapshot_stale` 只能新验证或丢弃 |
| `cancelled` | 用户在 Agent、服务启动或浏览器 QA 期间停止 | 查看已完成证据、重新开始、丢弃 | 新 attempt 或丢弃 |
| `accepted` | 用户接受交付 | 合并/保留分支/归档 | 终态 |
| `discarded` | 用户丢弃交付 | 查看历史 | 终态 |

验证检查在进入 `verifying` 时固定分类：声明的浏览器 QA 和用户/项目明确登记为 `required` 的测试命令属于 required；Agent 运行的其它命令为 advisory。任一 required 失败即 `verification_failed`，但首次 required 浏览器 QA 失败会先走一次受限自动修复与新 attempt 的同一 required QA；所有 required 终态通过才可 `ready_for_review`；没有 required 不能被一条 advisory 成功伪装成通过，只能是 `unverified`。`Agent 完成` 不是交付终态。

### 持久化实体

```ts
type TaskDelivery = DeliveryOwner & {
  id: string;
  baseRef?: string;
  worktreeBranch?: string;
  activeAttemptId?: string;
  createdAt: string;
  updatedAt: string;
};

type DeliverySnapshot = {
  baseHeadSha?: string;
  worktreeHeadSha?: string;
  worktreeFingerprint: string;
  executionPlanHash?: string;
  deliveryCommitSha?: string;
  deliveryTreeSha?: string;
  capturedAt: string;
};

type ApprovedExecutionPlan = {
  id: string;
  projectId: string;
  effectiveWorkspaceRoot: string;
  sourceManifestHash?: string;
  planHash: string;
  canonicalPreview?: {
    command: string;
    readyUrlTemplate: string;
    routes: string[];
    startupTimeoutMs: number;
  };
  requiredCommands: Array<{
    label: string;
    command: string;
    cwdRelativePath: string;
  }>;
  approvedByUserAt: string;
};

type DeliveryAttempt = DeliveryOwner & {
  id: string;
  deliveryId: string;
  runId: string;
  sequence: number;
  status: DeliveryStatus;
  unverifiedReason?: "no_required_checks" | "snapshot_stale";
  approvedExecutionPlanId?: string;
  verificationSnapshot?: DeliverySnapshot;
  supersedesAttemptId?: string;
  supersededAt?: string;
  changedPaths: string[];
  summary?: string;
  risks: string[];
  createdAt: string;
  updatedAt: string;
};

type CommandRun = {
  id: string;
  deliveryAttemptId: string;
  kind: "agent" | "verification" | "service" | "browser_qa";
  requirement: "required" | "advisory";
  label: string;
  command: string;
  cwd: string;
  status: "running" | "passed" | "failed" | "cancelled";
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
  outputRef: string;
  outputTruncated: boolean;
  verificationSnapshotFingerprint?: string;
};

type BrowserQaRun = {
  id: string;
  deliveryAttemptId: string;
  serviceId?: string;
  targetUrl: string;
  viewport: { width: number; height: number };
  requirement: "required" | "advisory";
  status: "running" | "passed" | "failed" | "not_run" | "cancelled";
  loadError?: string;
  consoleErrors: QaConsoleError[];
  resourceFailures: QaResourceFailure[];
  screenshotArtifactId?: string;
  verificationSnapshotFingerprint: string;
  startedAt: string;
  endedAt?: string;
};

type ScreenshotArtifact = {
  id: string;
  deliveryAttemptId: string;
  storageKey: string;
  mime: "image/png";
  width: number;
  height: number;
  sha256: string;
  verificationSnapshotFingerprint: string;
  createdAt: string;
};
```

客户端只能传递候选 id；服务端从已认证 session 推导 `DeliveryOwner` 与 canonical root，绝不信任 client 传来的 `projectId`、`sessionId`、root 或 artifact path。子表只存 `deliveryAttemptId`，由数据库外键与 owner-aware join 保证它们只能落到同一 attempt/owner；物理 artifact 位置由服务端从 `storageKey` 推导，不能由 API 传入。数据库保存元数据；输出和截图保存在 session 数据目录的受限 artifact 目录，通过 id 读取。任何 API 都必须先验证 owner 与调用 session 一致，禁止浏览器直接请求任意本机路径。

## 项目启动声明与服务生命周期

### 声明文件

项目可选提供 `.zmzai/lectern.json`：

```json
{
  "preview": {
    "command": "pnpm dev -- --port $LECTERN_PORT",
    "readyUrl": "http://127.0.0.1:$LECTERN_PORT/",
    "routes": ["/"],
    "startupTimeoutMs": 30000
  }
}
```

- `$LECTERN_PORT` 仅由服务端替换为端口分配器给出的可用端口。
- `command`、`readyUrl`、`routes` 均须通过严格 schema 校验；`readyUrl` 只能是 `http://127.0.0.1:$LECTERN_PORT` 或已显式批准的 `[::1]` 同端口 origin，route 必须是单个以 `/` 开头的本地 path，拒绝 `//`、scheme-relative、host、查询注入及动态命令片段。
- 首次使用或文件 hash 改变时，用户必须在项目设置中显式批准。服务端把 schema-normalized manifest（含 preview 与 required commands）写入不可变 `ApprovedExecutionPlan` blob/version，记录 `sourceManifestHash`、`planHash`、project 与 canonical root；运行时只解释此 blob，绝不回读可被 Agent 改写的文件来拿命令。
- required command 只能来自该用户批准的 plan，或由用户在 UI 创建并持久化进一个新的 plan version；Agent、聊天参数和 API client 都不能把任意命令升格为 required。重跑也只可使用当前 attempt 绑定 plan 中的原始 command。
- Agent 可以编辑此文件，但不能让本 attempt 或后续 attempt 自动执行新命令，直到用户重新批准。attempt 进入验证前若磁盘 manifest hash 与绑定 plan 的 `sourceManifestHash` 不同，则拒绝启动或复用 QA 服务，提示重新批准；不得“临时读取新文件”。
- 不执行来自聊天、HTML 或 Agent 输出的启动命令；未批准声明只能做静态检查或显示“浏览器 QA 未配置”。
- 未声明时，HTML/HTM 产物走现有 root-constrained preview route；其它项目显示“未配置浏览器 QA”，不能声称已验证。

### 服务注册表

```ts
type PreviewService = DeliveryOwner & {
  id: string;
  commandRunId: string;
  executionPlanHash: string;
  origin: "user" | "lectern_qa";
  url: string;
  pid?: number;
  processStartedAt?: string;
  processGroupId?: number;
  leaseId?: string;
  leaseExpiresAt?: string;
  status: "starting" | "ready" | "failed" | "stopping" | "stopped" | "cancelled";
  startedAt: string;
};
```

复用规则：仅 `sessionId + effectiveWorkspaceRoot + executionPlanHash` 同时匹配、租约未过期、进程身份（PID + 启动时间）一致、ready URL 探测成功的 `ready` 服务可以复用。不同 worktree 即使项目相同也必须另起服务。端口分配先探测候选端口，再 release 后立即 spawn；若子进程报告 `EADDRINUSE`，有限次数重新分配并重试。只有明确支持 FD inheritance 的启动器才允许真正 socket handoff，普通 dev server 不依赖它。

`origin=user` 服务永远不会被 Lectern 停止或重启；失联只记录失败。`origin=lectern_qa` 服务必须在独立进程组运行、周期续租，任务取消、丢弃、session 关闭或应用崩溃恢复时只清理属于该 service id 且进程身份仍匹配的进程组。启动恢复会先使过期记录失效，绝不只凭复用 PID kill 进程。服务启动、复用、失联和清理均在任务命令记录中可见。

## 浏览器 QA

### 触发

在 run 编辑结束后，若 attempt 的已批准 preview 声明定义了 QA target，任何可能影响该 target 的代码、路由、样式、静态资源或 HTML 改动都触发 QA；这包含只有 TS/TSX/JS 路由源文件变化的 Web 项目，不能只靠文件扩展名猜测。静态 HTML 使用服务端生成的受限 static preview target；声明了 `preview` 的项目启动或复用服务。每个 target 在进入 `verifying` 时记录为 required 或 advisory，避免验证期间悄然改变适用范围。

无 manifest 的静态 HTML 由 Lectern 的专用 loopback static-preview server 暴露为 `http://127.0.0.1:<qaPort>/static/<opaqueRunToken>/...`：token 为一次性 capability，服务端绑定 attempt、canonical root、所选 artifact 与到期时间，且 root-constrained resolver 不允许 `..`、symlink 逃逸或跨 session 读取。该 QA run 的请求白名单只包含此 origin 与 `/static/<opaqueRunToken>/` path prefix；token 不作为公开预览 URL、不会写进 Agent repair payload。这样静态文件可加载相对资源，但任何其它 session、root、path 或外网资源都被拒绝。

### 执行器

浏览器运行使用受控自动化上下文（首选 Playwright）；每次 QA 新建干净 context，不继承用户 cookie、登录态、localStorage 或其它 session 的页面状态。第一期固定：

- viewport：`1440 × 900`；
- route：声明的首个 route，默认 `/`；
- 等待：导航完成及关键 readyUrl；
- 采集：`pageerror`、console `error`、失败的主文档/脚本/样式/图片请求；
- 产物：**1440×900 viewport PNG**（`fullPage: false`）、结构化错误列表、加载耗时与已规范化 URL；完整页面截图是未来显式的可选产物，不能与验收截图混称；
- 失败阈值：导航/截图失败、任一 page error、任一未忽略的 console error 或关键资源失败。

浏览器执行器在导航前与每次请求/重定向后都使用已解析的 URL 比对：只放行被批准的 loopback origin、相同端口及其显式 route；`localhost` 不作为 DNS 豁免，`127.0.0.1` 与 `[::1]` 分别按声明精确匹配。Playwright 路由拦截所有 `http(s)`、WebSocket、iframe、script、image、stylesheet 与 fetch 请求；`data:`/`blob:` 仅在页面自身创建时放行。任何公网、不同端口、DNS host、scheme-relative URL 或重定向越界都立即阻断并作为 QA 失败证据，绝不产生网络 egress。

第二阶段增加窄桌面截图和由项目声明的关键选择器/断言；移动端不作为第一期通行门槛。

### 自动修复

首次 QA 失败后，Agent 可读取本次经脱敏与限额处理的 `BrowserQaRun` 结构化错误和关联 `CommandRun` 摘要；截图默认只在本地 Review 展示，不自动注入模型上下文。系统明确注入：这是唯一一次自动修复机会。随后创建新 attempt 并重跑相同 QA：

- 通过：进入 `ready_for_review`，两轮 QA 都保留；
- 失败：进入 `verification_failed`，停止自动修改；
- 用户中断：保留已完成证据，正在运行的 QA/服务记录为 `cancelled`，attempt 为 `cancelled`，不伪装为通过或失败。

## 终端与验证记录

### 两类终端

1. **人工终端**：保留当前 xterm/PTy tab，供用户自由操作。
2. **任务命令记录**：由 Agent、验证器、服务启动器执行的结构化 `CommandRun`。它们有稳定 label、cwd、退出码、耗时、完整输出与重跑动作。

任务命令记录在 Debug Area 显示实时输出；Review 中只显示摘要。不能依赖 ANSI 文本或 DOM buffer 判断命令状态。

### 重跑

用户可以从任一 `CommandRun` 请求“一键重跑”。重跑继承原命令与服务端推导的 owner；required command 的 `cwdRelativePath` 只允许 `.` 或 canonical root 内的相对目录，拒绝绝对路径、`..` 和 symlink escape，服务端 resolve 后才形成 CommandRun 的实际 `cwd`。仍按当前权限策略执行，并在新 attempt 中创建新的 CommandRun，不覆盖原证据。服务类命令只能在所属 attempt 未 discarded 且其批准 execution plan 仍有效时启动。

### 首期不做

终端 split、终端内查找、链接识别、拖拽文件路径、任务模板与固定列宽均不进入本期实现；它们放入 P2，以免影响验证证据闭环。

## 审查页交互

Review 成为 task delivery 的主入口：

- 左列：当前 attempt 的变更文件、diff 统计、base ref/worktree branch 与验证快照；若快照已失效，明确显示“工作区已变化，证据不能用于合并”。
- 中列：现有 DiffView；在 hunk/行上可添加反馈并执行“让 Agent 修这一段”。该动作创建新 run，并关联 delivery 与评论范围。
- 右列：验证摘要。显示命令状态、耗时、退出码、浏览器 QA 截图缩略图、console/resource 错误数与风险。
- 右列的“查看完整输出”“查看截图”在需要时打开 Debug Area/Preview，不复制整段日志进审查页。
- 页尾或固定操作区：`接受并合并`、`请求修改`、`丢弃 worktree`。`接受并合并`仅在当前 active attempt 为 `ready_for_review` 且实时快照相等时可用；只有 `unverifiedReason=no_required_checks` 才显示“接受未验证快照并合并”二次确认，且使用相同 immutable commit/CAS 并写入 Audit Log。`snapshot_stale` 不显示接受动作。不可用动作要说明原因（无 Git、非隔离会话、验证仍在运行、快照已变化、没有 required 检查等）。

成果预览 tab 继续是探索产物的地方；审查页中的截图是不可变验证附件，二者不能互相覆盖。

## 权限、安全与失败降级

- QA 启动服务与验证命令复用现有 terminal 权限域；自动策略开启时应在 Audit Log 记录来源为 `verification`，记录批准 execution plan hash、attempt snapshot、服务 lease 与用户决策。
- URL 仅允许严格规范化后的已批准 loopback origin/route；第一期不访问公网 URL，也不信任 DNS `localhost` 解析。
- 浏览器 context 禁用用户 profile 复用、下载与权限继承。截图从不自动发送给 Agent/模型；本地 artifact 有 session 级访问控制。
- stdout、stderr、console、page error、请求 URL、API 返回和 Agent 修复上下文均在**写入前**使用统一脱敏器处理，再受最大容量限制：单个 stdout/stderr 2 MiB、单 attempt 文本 8 MiB、截图 10 MiB。超额内容被截断并保留 `truncated`/原始长度元数据；不允许用未脱敏原文重读或重新注入。
- 截图必须为 PNG、固定 viewport 尺寸并在 artifact store 校验 MIME、大小与 hash；不对栅格图像做虚假的“已脱敏”承诺。若页面可能含敏感视觉信息，截图仍只留在本机受控 Review，不进入自动修复上下文。
- 没有脱敏基础时，P0 不将 `.env`/命令环境回显到交付页。
- 服务启动失败：记录 stdout/stderr、exit code、cwd，且不启动浏览器。
- 浏览器无法启动：记录 `not_run`，状态不能称为通过。
- 用户服务失联：记录本次 QA 失败但不尝试 kill/restart 用户服务。

## API 与模块边界

| 模块 | 职责 |
| --- | --- |
| `lib/delivery.ts` | attempt/snapshot 状态转换、服务端 owner 推导、合并 CAS、数据库读写与交付摘要纯函数 |
| `lib/command-runs.ts` | 结构化命令执行、脱敏限额输出、退出事件与新 attempt 重跑 |
| `lib/preview-services.ts` | 已批准声明解析、端口 reservation、租约、进程身份校验、owner-safe 复用/停止与崩溃恢复 |
| `lib/browser-qa.ts` | 严格 loopback 请求拦截、受控浏览器、错误归类、1440×900 截图写入 artifact store |
| `lib/artifacts.ts` | 受限 artifact 读写、写前脱敏/MIME/配额/哈希与 session owner 授权 |
| `app/api/deliveries/*` | delivery、命令、QA、截图与任务动作 API |
| `components/DeliveryReview.tsx` | Review 页的证据摘要与任务动作 |
| `components/DebugArea.tsx` | 命令记录 tab 与完整输出，保留 xterm 的人工终端职责 |

现有 `ReviewPane`、`TerminalPane`、`CanvasPane` 应通过清晰 props 读取 active attempt 数据，不能各自扫描 Git/终端/文件系统再猜测状态。所有 API 以当前认证 session 解析 owner；嵌套资源只能通过 `deliveryId -> attemptId -> resourceId` server-side join 获取，拒绝客户端拼接父子 id 或物理路径。

## 验收与测试

### 纯函数与 API

- delivery 状态机覆盖所有合法/非法转换、Agent/服务/浏览器执行期取消，`verification_failed` 不会被 Agent 文案改回完成。
- 验证快照用临时 index 生成 immutable delivery commit/tree，覆盖 dirty worktree 与未跟踪文件；验证后源 worktree 被修改不改变 delivery commit，但会使 attempt 失效。base branch 改变、Agent/人工终端并发编辑与 merge CAS 竞争都不能把未验证内容合并进目标 ref。
- 一个 required 通过、另一个 required 失败必须聚合为 `verification_failed`；零 required 只能是 `unverified`，advisory 结果不得改变这两个结论。
- 零 required 的二次确认只允许 `unverifiedReason=no_required_checks`，仍从 immutable delivery commit 走与普通接受相同的 ref CAS；`snapshot_stale` 的确认/合并请求必须拒绝。
- 两个 session、两个 worktree、同路径产物：服务、命令、截图、diff 和 API 均无法串读；伪造 owner、child id 与 parent id 不匹配、client root/artifact path 均被拒绝。
- 声明 schema、端口替换、未知/未批准/尝试期间被 Agent 改写的启动配置、超时、用户服务复用、任务服务停止均有测试；config 改写后只能执行已批准 blob 或拒绝启动，绝不读取新命令。
- required command registry 的测试覆盖 Agent 改写测试声明、伪造 API `requirement` 字段及重跑旧 command；只有 plan blob 内经用户批准的 command 能成为 required，首次运行及重跑的 `cwdRelativePath` 都不能越出当前 session/worktree root（绝对路径、`..`、symlink escape 与跨 session root 均拒绝）。
- 服务测试覆盖过期租约、stale registry、PID 重用、并发端口分配、release-then-spawn 的 `EADDRINUSE` 有限重试、启动中取消、丢弃/关闭 session 清理与崩溃恢复。
- artifact API 拒绝路径遍历、foreign session id、错误 MIME、缺失文件和未授权截图；secret 出现在 stdout/stderr/console/error 时均在存储、读取和 Agent repair payload 前脱敏，超量输出保留截断元数据。
- 自动修复仅重试一次；二次失败持久化为 `verification_failed`。

### 浏览器集成

- 静态 HTML：生成 1440×900 viewport 截图且资源/console 均通过。
- 无声明静态 HTML：一次性 static-preview target 能加载同 root 相对资源；越 root、symlink/跨 session 路径、过期 token 与外网资源均被拒绝。
- 声明式 Web 服务：从 worktree 启动、等待就绪、生成 1440×900 截图；仅变更 Next/TSX 路由源也会触发对应 manifest target。
- console error、page error、关键资源 404、导航超时、截图异常各产生可见失败证据。
- 外网重定向、不同端口、scheme-relative URL、外部 iframe/script/image/WebSocket、IPv6/IPv4 非声明 origin 及 DNS host 都被拦截且没有 egress。
- 切换 session 或项目后，Preview/Review/Debug Area 不显示前一个 delivery 的截图、日志或状态。

### 视觉与人工验收

- 1440×900 与窄桌面宽度下，审查页三列不重叠，长命令/路径可截断并有完整 tooltip。
- 用户可在三次操作内完成：查看 diff → 查看失败截图 → 重跑命令。
- 已通过、验证失败、验证中、未验证、已取消、无 QA 配置、用户服务复用七种状态均有区别明确的 UI。
- 一条不含 Web 产物的任务不展示虚假的浏览器成功卡；有 HTML 但无启动声明时显示静态 QA 路径。

## 分期

### P0：任务交付与命令证据

实现 `TaskDelivery`/不可变 `DeliveryAttempt`、验证快照与合并 CAS、状态机、结构化 CommandRun、脱敏限额输出、Debug Area、Review 骨架及接受/退回/丢弃动作。浏览器 QA 尚未上线时，只有被明确登记为 required 的命令/测试全部通过才可进入 `ready_for_review`；无 required 检查一律为 `unverified`。

### P1：浏览器 QA 与截图产物

实现项目启动声明、服务注册、受控浏览器执行器、截图 artifact、一次自动修复及 Review 右列证据。

### P2：审查协作与人工终端体验

实现 hunk 评论回流和 Agent 修复续接；加入终端查找、链接识别、split、任务模板等人工工作流能力。

### P3：任务总览与自动化

实现待审查队列、后台任务、计划运行、通知及后续跨设备/远程执行的扩展点。

## 成功指标

- 从任务停止到首次看到可审查 diff/产物的中位时间。
- 进入审查后，用户确认“跑过什么验证”的平均点击数。
- 自动 QA 首次失败、一次修复后通过、二次失败的比例。
- worktree/session 交叉污染事件必须为零。
- `ready_for_review` 交付中带至少一条结构化验证证据的比例。
