# Lectern 工作台落地清单（两份 spec 合并后）

> 汇总以下两份 spec 的交叉一致性核对、落地冲突评估与执行顺序：
> - `2026-09-02-state-driven-workbench-ui-spec.md`（功能状态机，简称 **状态机 spec**）
> - `2026-09-02-lectern-visual-system-realignment-spec.md`（视觉实施附录，简称 **视觉 spec**）
>
> 生成日期：2026-09-02。本文是**可执行任务清单**，不是第三份 spec；它把两份 spec
> 的契约对齐、把「谁先谁后」定死，并标注已落地项。

---

## 0. 结论摘要

两份 spec 是**配套关系**，无自相矛盾：视觉 spec §0 明确「依赖且不得推翻」状态机
spec 的 5 条定案。核对后只有一个契约细节需要补齐（§2 的 `source` scope），已在本
轮一并修正代码 + 补进 spec 语义。

**本轮已落地（地基）：**

| 项 | 状态 | 位置 |
| --- | --- | --- |
| `lib/task-presentation.ts` 状态机纯函数 | ✅ 已写 | `lib/task-presentation.ts` |
| `deriveTaskPresentation` 单测（16 用例，覆盖每行谓词） | ✅ 已写 + 全绿 | `lib/task-presentation.test.ts` |
| WorkbenchPanel `source` scope bug 修复 | ✅ 已修 | `components/WorkbenchPanel.tsx` |

---

## 1. 两份 spec 交叉一致性核对

视觉 spec §0 声明的 5 条「不得推翻」定案，逐条核对全部遵守：

| 状态机 spec 定案 | 视觉 spec 是否遵守 | 结果 |
| --- | --- | --- |
| `preview` /「成果预览」命名 | §0、§4.5、§5 全程用 preview；CanvasPane 组件名保留、文案统一「成果预览」 | ✅ 一致 |
| `MapPane.tsx` 已删 | §0、§5 明确「不重引入」、注释/aria/快捷键不留「画布/地图」 | ✅ 一致 |
| `source: automatic \| user` 契约 | §0、§4.5、§5（WorkbenchPanel 落实）、V1-4 | ✅ 一致（见 §2 补充） |
| Terminal resize 仅 committed layout change | §0、V2-4、§7.3（记录 resize 请求次数） | ✅ 一致 |
| 六态 `TaskPresentationState` 状态机表 | §0、§2.2（按六态定主角）、§5 | ✅ 一致 |

---

## 2. `source` 契约的 scope 补充（本轮定案）

### 2.1 问题

状态机 spec §9.1 写「自动选面板不抢**同一任务**中用户明确选定的面板」，但未明确
`user` 态的**生命周期**（是当前任务内，还是整个会话期间）。现有代码把
`userSelectedTab` 实现成「用户点过一次 tab 就永久锁定」——用户上一个任务手动点过
Files，后续同会话里 agent 生成新 HTML 产物时，自动跳 Preview 就永远失效了。

### 2.2 定案语义

`user` 标记的抑制 scope = **单条产物路径**，不是「永久」也不是「整会话」：

- 用户手动离开某条 preview 产物后，**同一条产物**不再自动抢焦点；
- **新一轮 run 产生的新 HTML 产物**（新路径，或投影重置后列表重来）仍可自动推荐；
- 跨会话由 WorkbenchPanel 的 `key={activeId}` 自动卸载重置。

### 2.3 代码修复（已完成）

`components/WorkbenchPanel.tsx`：

- `userSelectedTab: useRef(false)` → `suppressedPreviewPath: useRef<string | null>(null)`
- 自动推荐 effect 改判「新产物路径 ≠ 已被抑制路径」
- `select()` 在用户切走 preview 时记录当前产物路径
- `openFile()`（用户主动点路径/⌘P/工具卡）也记录抑制，避免用户正在看文件时被抢走
- 新增 `canvasPathRef` 同步，避免 `openFile` 依赖 `canvasPath` 导致回调反复重建

tsc 干净、无回归。

---

## 3. 落地冲突评估（视觉 spec §5 组件清单 vs 现有代码）

| 视觉 spec 要求的文件 | 现状 | 风险 | 说明 |
| --- | --- | --- | --- |
| `lib/task-presentation.ts` | 本轮新建 | 🟢 | 已完成，见 §0 |
| `components/TaskContextStrip.tsx` | 不存在 | 🟢 纯新增 | 消费 task-presentation，见 V1 |
| `components/DebugArea.tsx` | 不存在 | 🟢 纯新增 | V2，包裹 TerminalPane |
| `app/globals.css` 语义 class | 已有 theme token 体系 | 🟡 增量 | 遵守 token 纪律，不硬编码色 |
| `WorkbenchPanel.tsx` tab 改 underline + source 契约 | 已实现 source（scope bug 已修） | 🔴→🟡 | tab 仍用黑胶囊，需改 underline；source 已修 |
| `ChatView.tsx` 清 header 状态 pill | 已有 statusLabel + rounded-pill | 🟡 | 删重复 pill，单独回归 |
| `Composer.tsx` 重做底部任务编辑器 | 已有完整 Composer（@-mention/图片/skill/推理力度/上下文条） | 🔴 高风险 | 单独成步、单独回归，别改坏已有能力 |
| `SessionList.tsx` 四组分组 | 现有置顶/归档 + 「新」徽标（后台动态感知 48ec384） | 🟡 | 四组「需要处理」= 「新」徽标归宿，合并成同一套 attention 信号 |
| `ReviewPane.tsx` 加变更摘要 + 空态 | 已有 ReviewPane | 🟡 | V3 |
| `CanvasPane.tsx` 文案「成果预览」 | 已存在、已叫 preview | 🟢 | 基本符合 |
| `TerminalPane.tsx` 只留 xterm、tab chrome 移 DebugArea | 现有 tab chrome 在 TerminalPane 内（含刚修的关闭按钮常驻占位 66809ec） | 🟡 | V2 拆层，别丢刚修的样式修复 |

---

## 4. 执行顺序（按风险从低到高、先修地基）

1. **✅ 已做**：修 `source` scope bug + 写 `lib/task-presentation.ts` 纯函数 + 单测
2. **V0 视觉基础**：shell/tab/splitter 语义 class + 去黑胶囊 + 收紧高度（不碰业务逻辑，最安全）
3. **V1 状态机视觉映射**：`TaskContextStrip`（消费 task-presentation）+ SessionList 四组分组（合并「新」徽标）
4. **V2 DebugArea 收敛**：TerminalPane 拆层，resize 闭环独立验收（记录 `/api/terminal/:id/resize` 请求次数）
5. **V3 审查与交付细节**：ReviewPane 变更摘要、CanvasPane 来源/刷新动作
6. **最后单独做**：Composer 重做 + ChatView 清 pill（独立回归，避免改坏 @-mention/图片/上下文条）

> 注：视觉 spec 自带 V0→V3 四阶段（§6），上述顺序保留了这四阶段，但把「source
> scope 修复 + 状态机纯函数」前置为第 1 步（两份 spec 的共同地基），并把 Composer
> 从 V0/V1 中独立出来放最后。

---

## 5. 硬门禁（落地时必须满足，否则不得合并）

- 状态机逻辑**只**在 `lib/task-presentation.ts`，不得散落进 CSS class 或组件局部
  `useEffect`（视觉 spec §8）。
- 样式改动**不硬编码主题色**，深浅主题用既有 semantic token（视觉 spec §7.3）。
- **resize 闭环**：一次 committed layout change 最多一次合法 resize；SSE 输出、消息
  增量、普通 render 零 resize 请求（视觉 spec §7.3，V2 完成门槛）。
- 每一条状态机谓词有单测（状态机 spec §13）——`task-presentation.test.ts` 已覆盖。
- 删除任何面板的 import/注释/快捷键/tooltip 前，全仓搜索验证零残留（视觉 spec §8）。
- 切换隔离项目/会话后，不得残留前一任务的状态条/preview/Review/终端标识（视觉 spec §7.3）。

---

## 6. 挂账（非本轮，仅记录）

- WorkbenchPanel 三个一级 tab 仍用 `bg-ink text-paper` 黑胶囊，待 V0 改 underline。
- SessionList 四组分组尚未实现（V1）。
- DebugArea 包装层尚未建（V2）。
- Composer/ChatView 视觉重做尚未启动（最后一步）。
