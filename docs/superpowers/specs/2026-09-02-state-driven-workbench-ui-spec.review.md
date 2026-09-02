# Spec 落差核对报告（review 产物）

> 对应 spec：`2026-09-02-state-driven-workbench-ui-spec.md`
> 核对日期：2026-09-02，基于 lectern `66809ec` 的实际代码逐条比对。

## 零、决策状态（2026-09-02 已全部定案并落地）

以下 3 个拍板点 + 2 个设计级问题均已按「推荐方向」处理完毕，spec 已同步更新，**无需再决策**：

| 决策 | 定案 | 落点 |
|---|---|---|
| D1 `Results` 命名 | 统一为 `preview`（沿用代码「成果预览」） | spec 全文 tab 名 + 类型字段 `explicitWorkbenchTab`/`WorkbenchSelection.tab` 已改 |
| D2 `MapPane.tsx` 死代码 | 已删除（`git rm`） | 组件目录已清理 |
| D3 §6 状态优先级 | 改写为显式状态机表，`running` 提到 `failed` 前，明确 `failed`/`delivered` 非互斥 | §6 Precedence 整段重写为纯函数决策表 |
| 设计问题 2 resize 闭环 | 提为 Phase 1 独立硬门禁，明确「committed layout change」的四种触发 | §8.4 + §13 Functional |
| 设计问题 3 滚动一次 key | 定死为「权限请求消息 id」 | §7.3 |

额外补强：§9.3 补 Electron `before-input-event` 快捷键冲突自查条款；§13 1440px 验收明确 Phase 1 = Terminal-only。下方对照表与设计问题章节保留原文，作为决策依据存档。

---

## 一、结论摘要

spec 的骨架与核心决策（尤其是 §9.1「自动选面板不抢用户选择」的 `source` 契约）是正确的，可直接作为落地蓝本。但有 **5 处 spec 断言与现有代码不符**，其中 3 处需要你在动工前定夺，否则 Phase 1 会返工。另有 2 处设计级问题（状态优先级、resize 闭环）需要在实现前用「状态机表」定死。

---

## 二、spec 断言 vs 实际代码（权威对照表）

| # | Spec 断言 | 实际代码 | 结论 | 建议动作 |
|---|---|---|---|---|
| 1 | §8.1 右侧 workbench 含 `Review / Files / Results` 三个面 | `WorkbenchPanel.tsx` 的 `TABS` = `review` / `files` / `preview`（**预览**，不是 `results`） | **基本一致**，仅命名差异 | 统一叫法：spec 的 `Results` 应改叫「预览/成果预览」或反之，二选一 |
| 2 | 记忆里的「审查/文件/画布/地图」四 tab | `MapPane.tsx` 已存在但**未被任何文件引用**；`CanvasPane` 已改名为 tab `preview`（成果预览） | **画布/地图已下线** | `MapPane.tsx` 可删（死代码）；spec 无需再考虑画布/地图 |
| 3 | §8.4 底部 `DebugArea` = Terminal + Problems + Output + Debug Console | 底部就是 `TerminalPane`（`app/page.tsx` 794-799 直接渲染，无 tab rail） | **DebugArea 尚不存在**，Terminal 是裸挂的 | Phase 1 需新建 `DebugArea` 包一层，符合 spec |
| 4 | §11.4 持久化键 `lectern:bottom-panel-height` / `bottom-panel-open` | `app/page.tsx` 205-206 **实际就是这两个键**（默认 260/160-640） | **一致**，我之前记忆里的 `terminal-panel-ratio` 已过时 | spec 无需改；我的记忆要纠偏 |
| 5 | §9.3 `Cmd/Ctrl+J` 切换 Debug Area | `app/page.tsx` 319-323 已实现 `key === "j"` → `toggleBottomPanel()`（且**终端聚焦时不吞**） | **已实现** | 无需新做 |
| 6 | §9.3 `Cmd/Ctrl+B` 折叠侧栏 | `app/page.tsx` 只有 `toggleSidebar` 按钮，**无 ⌘B 快捷键** | **未实现** | 待做（小项） |
| 7 | §9.3 `Cmd/Ctrl+Shift+G` 聚焦 Review 等 | 现有快捷键只有 ⌘K(命令)/⌘P(文件)/⌘⇧F(搜索)/⌘N(新建)/⌘J(终端)，**无 ⌘⇧E/G/R 系列** | **未实现** | 待做，且需处理 macOS 上 `Shift+G`(Git)/`Shift+R` 的潜在冲突（见 §9.3 末尾自查） |
| 8 | §8.2 顶部 `TaskContextStrip`（标题+状态+项目+模型+模式一条带） | 现状：`Navbar`（工作台导航）+ 底部 `footer` 状态栏（statusLabel + model + 终端开关）**分散在两端**，无中间一条带 | **未实现**，是 spec 的核心新增 | Phase 1 主体工作量在此 |
| 9 | §8.3 SessionList 四组（Needs attention / In progress / Recent / Archived） | `SessionList.tsx` 现状：**置顶优先排序 + 归档切视图**（showArchived 布尔），非四组；已有 `activity` 徽标（「新」字，bg-accent） | **部分实现** | §8.3 的 Needs attention 组 = 现有「新」徽标的归宿，**合并成同一套信号，勿并行两套** |
| 10 | §7.3 `needs_input` 权限请求「滚动一次」 | 现有 `PermissionRequest` 类型存在（types.ts 64），ChatView 有权限块渲染，但**无「滚动一次」语义** | 未实现 | 需明确「once」判定 key（建议按权限请求消息 id） |
| 11 | §6 `TaskPresentationState` 六态 + `deriveTaskPresentation` 纯函数 | **完全不存在**；现状状态是 `status`（ChatView 用）+ `lastOutcome`（session 三态）+ `activity`（后台徽标）各自为政 | **核心缺口** | Phase 1 第 1 步，`lib/task-presentation.ts` |
| 12 | §9.1 `WorkbenchSelection`（`source: automatic/user`） | `WorkbenchPanel.tsx` 已有 `userSelectedTab` ref（104 行）+ `editedPaths` effect 只在 `!userSelectedTab.current` 时自动切 preview（179-184 行） | **半实现**：有「user 抢占」概念，但无 per-session 记录、无 `source` 字段、无「Follow task」重置 | 升级成 spec 的契约 |
| 13 | §9.2 双击 splitter 恢复默认尺寸 | 现有 `VerticalSplitter`/`HorizontalSplitter` 支持拖拽 + 键盘（aria-valuenow），**无双击重置** | 未实现 | 待做 |

---

## 三、需要你拍板的 3 个决策点

### D1 — `Results` 命名统一（对照 #1）

spec 用 `Results`，代码用 `preview`（「成果预览」）。二选一。**建议**：沿用代码现有「成果预览 / preview」，spec 改词即可，避免无谓重命名。

### D2 — `MapPane.tsx` 死代码是否删除（对照 #2）

`MapPane` 已无引用。**建议**：Phase 1 顺手删掉，保持组件目录干净（符合你一贯「勿留死代码」的克制）。

### D3 — §6 状态优先级是否调整（设计级，见下）

---

## 四、设计级问题（需在实现前定死）

### 1. 状态优先级里 `failed` 排在 `running` 之前，会挡住 `delivered`（§6）

现有顺序：`idle → needs_input → failed → running → delivered → review_ready`。

问题：`failed` 引用了「no newer running event」这个跨状态条件，但一个会话通常不会「失败后又自己跑起来」。实践后果是——**一旦 failed，delivered / review_ready 永远触发不了**，即使产物其实已经生成（agent 最后一步命令 exit 非 0 但 HTML 已产出是常见情况）。§7.6 那句「existing changed files and results remain available」就落空了。

**建议改成**：`idle → needs_input → running → failed → delivered → review_ready`，并明确 `failed` 与 `delivered` 非互斥（failed 态仍需露出「结果其实在，点这里看」的路径）。

**更彻底的做法**：把 §6 的优先级列表改写成一张**显式状态机表**（纯函数输入 → 状态输出），§11.1 说要 unit-test 每个 precedence case，那就必须先把这张表定死，不能靠自然语言枚举。

### 2. resize 闭环是全文最大技术风险（§8.4 / §11 / §13）

spec 要求「resize 请求只在 committed layout change 后发生，output 更新和普通 render 零 resize 请求」。这是最容易拖进度、也最容易在 demo 时被「终端一滚动就闪」暴露的点。原因：xterm `fit()` 依赖容器尺寸，而容器尺寸又受 flex、滚动条出现/消失、字体加载影响。

**建议**：Phase 1 把这条验收（§13 已有「instrument terminal API calls」）提为**独立硬门禁**，别混在 visual quality 里排最后。同时明确「resize 只在 committed layout change」的实现策略（比如：只有 splitter drag 结束 / 折叠展开 / 窗口 resize 时才 fit，SSE 增量输出绝对不触发 fit）。

### 3. `needs_input` 的「滚动一次」判定 key 未定死（§7.3）

「第一次出现时滚动一次，之后不重复」是对的，但「once」按什么 key 判定没写。建议补：「以权限请求的消息 id 为准，同一 id 只滚动一次」。

---

## 五、Phase 1 落地顺序建议（微调 §12）

1. `lib/task-presentation.ts`（纯函数 + 单测）——**最先**，逼你把 §6 状态机表定死，零 UI 依赖、可独立回滚。
2. `TaskContextStrip`（替换顶部信息）——只消费 view model，低风险。
3. `DebugArea` 包装（Terminal-only）——**先别动 PTY 生命周期和 resize 闭环**，只做「包一层 + tab rail + ⌘J」，验收 resize 那条。
4. `WorkbenchPanel` 的 `WorkbenchSelection` 契约（source: automatic/user）。
5. `SessionList` 四组分组（合并现有「新」徽标）。
6. 空状态打磨。

每一步独立验证、独立回滚，避免「一次改五个组件然后发现优先级逻辑错了」。
