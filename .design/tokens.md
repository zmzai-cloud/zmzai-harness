# harness 设计令牌 · 工具界面层

> 上游：`@zmzai/theme@0.9.3`「墨骨 ink frame」——全品牌唯一来源，不可更换、不 fork。
> 本文件只做**工具界面（IDE 密度）场景下的扩展与补全**，不改动上游语义。
> 全部数值经 oklch→sRGB 换算与 WCAG 对比度实测，非估算。计算脚本见文末 §9。

---

## 1. 路线选择（三方案取舍）

theme 0.9.3 的 `--color-bg` / `--color-surface` 只差 1.5%（实测 **1.044:1**），层次在密集型界面里近乎不可见。三条修复路线：

| | 方案 A · harness 侧扩展（**推荐**） | 方案 B · 推 theme 上游 | 方案 C · 局部兜底 |
|---|---|---|---|
| 做法 | `@theme` 里补 `--color-selected` / `--selected-strong`，并给全部 token 补深色值 | 要求 theme 增发 `--color-elevated-1..3` 与官方 dark 契约 | 不动 token，只在 11 个组件里手写 hover/selected 色 |
| 改动面 | `globals.css` 1 处 + 约 11 组件各 1–2 行 | 0（等上游发版）+ 后续对齐 | 11 组件，每处硬编码 |
| 影响面 | 仅 harness | muzhi / relay / cloud / landing 全线回归 | 仅 harness，但色值散落 |
| 上游污染 | 无 | 高——营销页不需要 6 档灰阶，加进去是负担 | 无 |
| 长期维护 | 中：harness 多一层自有 token 需维护 | 低（一次性），但被上游节奏绑死 | **高**：色值散在 JSX 里，下次换主题要再改一遍 |
| 阻塞风险 | 无，立即可做 | 需上游排期 + 全生态视觉回归，且 dark 契约是 theme 明确声明「不做」的范围 | 无 |

**推荐 A，理由**：theme 0.9.3 注释已写明「层次靠 surface 灰阶与边框」——这是**营销页的层次策略**（大留白、少交互态）。工具界面需要的是**交互态层次**（hover / selected / pressed 三个可辨档位），二者是不同问题，不该混进同一个上游契约。theme 只提供到 `surface-3`（hover），缺 selected 一档——补的正是这一档，语义上不越界。

**配套动作（低成本，建议同时做）**：向 theme 上游提一份 dark 契约 RFC（`--color-dark-*` 目前只有 4 个色、且注释声明「不是全局 dark mode」），harness 的深色实现可直接作为提案蓝本。这不阻塞当前工作。

**方案 C 明确否决**：会重演 `globals.css` 现在「变量定义和组件硬编码并存」的坏味道，且违反「尽量不改类名、靠改 token 定义生效」的约束。

---

## 2. 单源定义机制（消除两处重复声明）

现状 `globals.css` 把同一组深色变量写了两遍（`html[data-theme="dark"]` 与 `@media (prefers-color-scheme: dark) html:not([data-theme=…])`），共 18 个变量 × 2 份 = 36 行重复。新增任一变量都要同步两处，是漂移的温床。

**改用 CSS 原生 `light-dark()`，一次声明覆盖三态**（跟随系统 / 显式浅 / 显式深）：

```css
/* app/globals.css */
@import "tailwindcss";
@import "@zmzai/theme/tokens";
@import "@zmzai/theme/fonts";
@import "@xterm/xterm/css/xterm.css";
@source "../node_modules/@zmzai/theme/src/**/*.{ts,tsx}";

/* 三态开关：只靠 color-scheme，不需要 @media，不需要重复声明 */
html { color-scheme: light dark; }
html[data-theme="light"] { color-scheme: light; }
html[data-theme="dark"]  { color-scheme: dark; }

@theme {
  --color-bg: light-dark(oklch(1 0 0), oklch(0.145 0.002 265));
  /* …每个 token 一行，浅色在前、深色在后… */
}
```

- `light-dark()` 在**使用点**按元素继承的 `color-scheme` 求值，Tailwind 的 `var()` 间接引用完全兼容。
- 兼容性：Chromium 123+ / Safari 17.5+ / Firefox 120+。本项目 Electron `^44`（Chromium 140+），**无兼容问题**。
- `app/layout.tsx` 的首帧 bootstrap 脚本保持不变（仍负责写 `data-theme` 防 FOUC），只是系统态下不再依赖 CSS 兜底。
- 删除 `globals.css` 中现有的两个深色块（24–69 行）与 `:root { color-scheme: light }`（71–73 行）。

**若坚持不引入 `light-dark()`**，退化方案：把深色值定义成一组 `--zmz-d-*` 中间变量（只定义一次），两个分支各自只做一次 `--color-bg: var(--zmz-d-bg)` 重指向。重复从「值」降级为「指针」，但仍是两份。

---

## 3. 完整令牌表

格式：`oklch(L C H)`。浅色值 = theme 原值（**一个都不改**，除 §3.4 标注的两处 gamut 修正与 §3.5 的可选加固）。

### 3.1 中性层次（surface 阶梯）

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--color-bg` | `oklch(1 0 0)` `#ffffff` | `oklch(0.145 0.002 265)` `#0a0a0b` | 应用底 / 对话流 / 输入框（浅色下输入框为「抬起」的白） |
| `--color-surface` | `oklch(0.985 0.001 265)` `#fafafb` | `oklch(0.191 0.003 265)` `#131415` | 面板 / 侧栏 / 弹层 |
| `--color-surface-2` | `oklch(0.968 0.002 265)` `#f4f4f6` | `oklch(0.228 0.006 265)` `#1b1c1f` | 面板内嵌块 / 表头 / 二级容器 |
| `--color-surface-3` | `oklch(0.940 0.003 265)` `#eaebed` | `oklch(0.272 0.008 265)` `#25272b` | **hover**（theme 原义；深色侧为新增覆盖，现值为 0.94 白 → 深色下闪白） |
| `--color-selected` *(新)* | `oklch(0.912 0.006 265)` `#e0e2e6` | `oklch(0.315 0.010 265)` `#2f3237` | **选中 / 当前项** |
| `--color-selected-strong` *(新)* | `oklch(0.884 0.008 265)` `#d6d9de` | `oklch(0.360 0.012 265)` `#3a3d44` | 焦点行 / 键盘光标所在项 / 按下 |

**层次可辨性实测**（相邻层对比度，均匀 ΔL）：

| 相邻层 | 浅色 | 深色 |
|---|---|---|
| bg → surface | 1.044:1（ΔL 0.015） | 1.074:1（ΔL 0.046） |
| surface → surface-2 | 1.051:1（ΔL 0.017） | 1.086:1（ΔL 0.037） |
| surface-2 → surface-3 | 1.087:1（ΔL 0.028） | 1.134:1（ΔL 0.044） |
| **surface-3 → selected** | **1.089:1（ΔL 0.028）** | **1.159:1（ΔL 0.043）** |
| selected → selected-strong | 1.091:1（ΔL 0.028） | 1.189:1（ΔL 0.045） |

> `bg → surface` / `surface → surface-2` 两步偏弱（1.04–1.05）是 theme 的原有取值，**不改**——这两层是「结构性分层」（画布 vs 面板），由 `border-line` 承担主要区分，不是交互反馈层。
> 交互反馈层（surface-3 / selected / selected-strong）从 surface-3 起统一 ΔL≈0.028（浅）/ 0.044（深），每一档都清晰可辨。
> **现状对照**：CommandPalette / Composer×5 / ProjectSwitcher 的 hover 与 selected 同为 `bg-bg` = **1.000:1**，完全同色。

### 3.2 中性文字与线

| Token | 浅色 | 深色 | 说明 |
|---|---|---|---|
| `--color-ink` | `oklch(0.21 0.008 265)` | `oklch(0.985 0.001 265)` | 正文 / 标题 |
| `--color-ink-2` | `oklch(0.442 0.017 265)` | `oklch(0.727 0.010 265)` | 次级文字 |
| `--color-ink-3` | `oklch(0.617 0.014 265)` → 见 §3.5 | `oklch(0.636 0.012 265)` | 辅助 / 占位 |
| `--color-line` | `oklch(0.92 0.004 265)` | `oklch(0.271 0.009 265)` | 常规边框 |
| `--color-line-strong` | `oklch(0.87 0.005 265)` | `oklch(0.340 0.010 265)` | 强调边框 / 焦点环 |
| `--color-rule` | `= ink` | `= ink` | 硬分隔线（theme 定义 rule ≡ ink；harness 当前消费 0 处） |

**中性文字对比度实测**：

| 载体 | ink | ink-2 | ink-3 |
|---|---|---|---|
| 浅 bg / surface / selected | 17.72 / 16.97 / 13.64 | 7.70 / 7.38 / 5.93 | 3.69 / **3.53** / 2.84 |
| 深 bg / surface / selected | 18.96 / 17.65 / 12.38 | 8.18 / 7.62 / 5.34 | 5.79 / 5.39 / 3.78 |

**深色侧必须修的两处反向错误**（现 `globals.css`）：

1. `--color-line-strong: #fafafa` → 与 `--color-ink` 同值。实测影响 3 处：
   - `Composer.tsx:494` `focus-within:border-line-strong` — **输入框焦点环变成纯白框**
   - `ChatView.tsx:294` `border-line-strong` — 未完成步骤圆点变白圈
   - `globals.css:99` `scrollbar-color: var(--color-line-strong)` — **滚动条滑块纯白**
   - `app/page.tsx:351` `text-line-strong` — 分隔符 `·` 变纯白点
   修正为 `oklch(0.34 0.010 265)`（与 surface 1.57:1，软线回位）。
2. `--color-rule: #fafafa` → 按 theme 语义 rule ≡ ink，深色下映射成 `oklch(0.985…)` 其实是**忠实**的，不算错。但 harness 消费 0 处，属死代码；建议保留映射、明确不消费。

> **深色下不可靠边框分层**：`--color-line` 与 `--color-surface` 仅 **1.23:1**。深色界面里边框无法承担层次，层次必须由底色（surface 阶梯）承担。这是深色侧层次方案与浅色侧的根本差异。

### 3.3 结构色 accent（契约镜像）

theme 0.9.3 契约：**accent = 中性结构色，只干结构的活，不承担语义**。浅色下是墨黑；深色下必须镜像为「近白」，而不是任何彩色。

| Token | 浅色 | 深色 |
|---|---|---|
| `--color-accent` | `oklch(0.21 0.008 265)`（= ink） | `oklch(0.985 0.001 265)`（= ink） |
| `--color-accent-strong` | `oklch(0.09 0.004 265)` | `oklch(1 0 0)` |
| `--color-accent-ink` | `oklch(1 0 0)` | `oklch(0.145 0.002 265)` |
| `--color-accent-tint` | `oklch(0.968 0.002 265)` | `oklch(0.272 0.008 265)`（= surface-3） |
| `--color-brand` / `--color-brand-tint` | 同 accent / accent-tint | 同 accent / accent-tint |

> **最深的一处病根（原诊断未覆盖）**：现 `globals.css:37` 把深色 accent 写成 `#51d845`，`accent-strong` 为 `#66e95a` —— 这正是 theme 沿革里明确退役的 **v0.6 荧光绿**（theme 注释：白底仅 1.8:1、观感 demo）。后果是同一套 class 在两种主题下语义完全相反：
> - 浅色 `text-accent-strong` = 墨黑强调（结构）→ 正确
> - 深色 `text-accent-strong` = 荧光绿（装饰/语义）→ 违反契约
>
> 直接受害者：`PermissionCard`（theme 组件，`permission-card.css:2` 用 `1px solid var(--color-accent)` + `color-mix(accent 4%, surface)`）——深色下变成**荧光绿描边 + 荧光绿调底**，是「demo 浮夸风」最刺眼的现场。改为近白后与浅色的墨黑完美镜像。
>
> `bg-accent text-accent-ink`：浅 17.72:1 / 深 18.96:1。`bg-accent-tint text-accent-strong`：浅 18.87:1 / 深 14.98:1。全部达标。

### 3.4 语义色

每色三件套：`{c}`（文字/图形）· `{c}-tint`（浅底）· 实底（+= `text-bg` 或 `text-accent-ink`）。

| Token | 浅色 | 深色 |
|---|---|---|
| `--color-live` | `oklch(0.499 0.1569 145)` `#00781e` | `oklch(0.72 0.20 145)` `#39c34b` |
| `--color-live-tint` | `oklch(0.955 0.045 145)` | `oklch(0.280 0.045 145)` |
| `--color-success` | `oklch(0.499 0.13 145)` `#27752f` | `oklch(0.70 0.18 145)` `#45ba50` |
| `--color-success-tint` | `oklch(0.955 0.035 145)` | `oklch(0.280 0.035 145)` |
| `--color-warning` | `oklch(0.499 0.1053 75)` `#855900` | `oklch(0.84 0.1372 75)` `#febd5a` |
| `--color-warning-tint` | `oklch(0.955 0.045 90)` | `oklch(0.300 0.050 90)` |
| `--color-danger` | `oklch(0.499 0.18 25)` `#b32228` | `oklch(0.74 0.1571 25)` `#fe7f77` |
| `--color-danger-tint` | `oklch(0.955 0.0215 25)` | `oklch(0.300 0.055 25)` |

**gamut 修正**（3 处，外观变化不可见）：theme 的 `live` `oklch(0.499 0.17 145)`、`warning` `oklch(0.499 0.12 75)`、`danger-tint` `oklch(0.955 0.03 25)` **超出 sRGB 色域**，浏览器会裁剪（实测渲染为 `#007a11` / `#8a5600` / `#ffe9e6`）。此处改写为同 L 同 H 下的最大可用彩度，消除裁剪，肉眼无差。

**语义文字对比度实测**（✓=≥4.5 可承载文字，◐=3.0–4.5 仅可用于图形/边框）：

| | 浅 bg | 浅 surface | 浅 surface-2 | 浅 surface-3 | 浅 selected | 深 bg | 深 surface | 深 surface-2 | 深 surface-3 | 深 selected |
|---|---|---|---|---|---|---|---|---|---|---|
| live | 5.64✓ | 5.40✓ | 5.14✓ | 4.73✓ | 4.34◐ | 8.59✓ | 7.99✓ | 7.36✓ | 6.50✓ | 5.61✓ |
| success | 5.70✓ | 5.46✓ | 5.19✓ | 4.78✓ | 4.39◐ | 7.93✓ | 7.38✓ | 6.80✓ | 6.00✓ | 5.18✓ |
| warning | 6.14✓ | 5.88✓ | 5.60✓ | 5.15✓ | 4.73✓ | 11.91✓ | 11.09✓ | 10.22✓ | 9.01✓ | 7.78✓ |
| danger | 6.62✓ | 6.34✓ | 6.03✓ | 5.55✓ | 5.10✓ | 8.03✓ | 7.48✓ | 6.89✓ | 6.07✓ | 5.24✓ |

**tint 底 / 实底 pill 对比度**：

| 配方 | 浅色 | 深色 |
|---|---|---|
| `bg-live-tint text-live` | 5.02✓ | 6.23✓ |
| `bg-success-tint text-success` | 5.05✓ | 5.77✓ |
| `bg-warning-tint text-warning` | 5.39✓ | 8.21✓ |
| `bg-danger-tint text-danger` | 5.77✓ | 5.65✓ |
| `bg-live text-bg` | 5.64✓ | 8.59✓ |
| `bg-success text-bg` | 5.70✓ | 7.93✓ |
| `bg-warning text-bg` | 6.14✓ | 11.91✓ |
| `bg-danger text-bg` | 6.62✓ | 8.03✓ |

**硬性规则：用 `-tint`，不用 `/15`**。实测 `bg-live/15 text-live` 落在 surface 上为 **4.35:1（不达标）**，`bg-live-tint text-live` 为 **5.02:1（达标）**——因为 `/15` 是 alpha 叠加，合成底比 tint 深一档，吃掉了文字预算。同类问题见 `bg-warning/20`（4.41 ✗）。accent 的 `/15` `/20` 不受影响（12.99–15.15:1），可保留。

> **深色 `--color-live` 现未被 override**：theme 组件 `ToolCard` / `Reasoning` / `todo-checklist` / `subtask` 直接消费 `var(--color-live)`（ChatView 用了 `ToolCard` 与 `Reasoning`），而 `--color-success` 被 override 成 `#66e95a` —— 深色下 live 与 success 变成**两个不同的绿**。同理四个 `-tint` 全部未 override → 深色下亮色 tint 闪白。上表已全部补全。

### 3.5 可选加固：浅色 `--color-ink-3`

theme 的 ink-3 在白底仅 3.69:1、surface 上 3.53:1，**低于 AA 4.5**。harness 密集使用 `text-ink-3` 承载真实信息（时间戳、model id、路径、hint），建议 harness 侧覆盖：

```css
--color-ink-3: light-dark(oklch(0.555 0.016 265), oklch(0.636 0.012 265));  /* #6e737d / #878b92 */
```
→ surface 上 4.55:1（✓），白底 4.75:1（✓），与 ink-2（0.442）ΔL 0.113，三档层级不塌。surface-2 上 4.33（◐）、selected 上 3.66（◐）——这两处仍建议升到 `text-ink-2`。

**or** 不改 token，只做使用面规整：凡是**承载信息**的 `text-ink-3` 升为 `text-ink-2`，`text-ink-3` 仅留给真正的占位符。改动面更大但零视觉风险。

### 3.6 Elevation / 阴影

深色下 ink 基色阴影实测失效：`oklch(0.21…)` 与 `#0a0a0a` 亮度比仅 **1.12:1**（浅色下为 17.72:1），阴影不可见。深色改用纯黑 + 提高 alpha：

| Token | 浅色（沿用 theme，不动） | 深色 |
|---|---|---|
| `--shadow-xs` | `0 1px 2px oklch(0.21 0.008 265 / 0.05)` | `0 1px 2px oklch(0 0 0 / 0.40)` |
| `--shadow-sm` | `0 1px 3px …/0.06, 0 1px 2px …/0.04` | `0 1px 3px oklch(0 0 0 / 0.50), 0 1px 2px oklch(0 0 0 / 0.35)` |
| `--shadow-md` | `0 4px 12px -2px …/0.08, 0 2px 4px -2px …/0.05` | `0 4px 12px -2px oklch(0 0 0 / 0.55), 0 2px 4px -2px oklch(0 0 0 / 0.40)` |
| `--shadow-lg` | `0 12px 32px -8px …/0.12, 0 4px 8px -4px …/0.06` | `0 12px 32px -8px oklch(0 0 0 / 0.65), 0 4px 8px -4px oklch(0 0 0 / 0.45)` |
| `--shadow-xl` | `0 24px 56px -12px …/0.16` | `0 24px 56px -12px oklch(0 0 0 / 0.75)` |

深色下阴影只提供「悬浮感」，**分离感必须由边框提供**：所有 `shadow-lg` 的 popover 一律补 `ring-1 ring-line`（深色 line #24272b 与 surface 1.23:1，配阴影足够）。涉及 7 处：`AccountBlock:72`、`CommandPalette:74`、`ProjectSwitcher:115`、`Composer:295/327/438/467`。

### 3.7 深色补充覆盖清单（现 `globals.css` 缺失的）

现有深色块只覆盖了 18 个变量。以下**必须**一并补入，否则深色下闪白：

`--color-surface-3`（0.94 白 → hover 闪白）· `--color-accent-tint`（0.968 白）· `--color-brand` · `--color-brand-tint` · `--color-live` · `--color-live-tint` · `--color-success-tint` · `--color-warning-tint` · `--color-danger-tint` · `--shadow-xs..xl` · `--color-selected` · `--color-selected-strong`

另有 `--color-surface-strong`：theme 定义为 `var(--color-surface-2)` 的别名，harness 深色却覆盖成独立值 `#232326` → **浅色同义、深色异义的语义漂移**。修正：删除该覆盖，跟随别名。harness 当前消费 0 处，无风险。

---

## 4. 语义色使用规范

### 4.1 判据：先问「这是结构，还是状态」

- **结构**（选中、强调、聚焦、当前生效项、可点击）→ `accent` 家族。主题无关的中性最高对比色。
- **状态**（运行中、成功、失败、警告、用量告警）→ `live` / `success` / `warning` / `danger`。
- **判定口诀**：如果这个颜色换成灰/白，信息就丢了 → 语义色；如果只是「让我注意到它」→ 结构色。

### 4.2 四态定义

| 状态 | Token | 含义 |
|---|---|---|
| **运行中 / 活跃** | `live` | 正在进行、尚未结束。有「未完成」的不确定性 |
| **已完成 / 成功** | `success` | 已终结且结果正确 |
| **告警** | `warning` | 需要用户注意，但仍在继续 / 可恢复（等待授权、diff 截断、用量偏高） |
| **失败 / 危险** | `danger` | 已终结且结果错误；或破坏性操作（删除、丢弃） |

关键区分：**`live` ≠ `success`**。只要事情还没结束就用 `live`，结束了才用 `success`。theme 自己的 `ToolCard` 就是这么写的（`.running`→live / `.completed`→success / `.failed`→danger），harness 必须与之一致。

### 4.3 场景 → 配方对照

| 场景 | 配方 | 浅色 | 深色 | 达标 |
|---|---|---|---|---|
| **状态徽标**（默认） | `bg-{c}-tint text-{c}` | 5.02–5.77 | 5.65–8.21 | ✓ |
| 状态徽标（强） | `bg-{c} text-bg` | 5.64–6.62 | 7.93–11.91 | ✓ |
| 状态徽标（描边） | `border border-{c}/40 text-{c}` | ✓ | ✓ | ✓（图形） |
| **状态点** | `bg-{c}` + 可选 `animate-pulse`（仅 live） | ≥3 | ≥3 | ◐ 图形 |
| **行内标记**（小字） | `text-{c}` 落在 bg/surface/surface-2 | 5.14–6.34 | 6.80–11.09 | ✓ |
| 行内标记落在 selected 行 | **禁止裸文字** → 改用 `bg-{c}-tint text-{c}` pill | — | — | 见 §4.4 |
| **进度条填充** | `bg-{c}`（底槽 `bg-surface-2` + `h-1`） | — | — | ◐ 图形 |
| **通知横幅** | `border border-{c}/40 bg-{c}-tint text-{c}` | ✓ | ✓ | ✓ |
| **自治档位**（自动 / 确认） | 自动：`bg-accent text-accent-ink`；确认：`bg-surface-2 text-ink-2` | 17.72 | 18.96 | ✓ |
| **Git 变更** A / M / D / R / ?? | `bg-success-tint text-success` / `bg-warning-tint text-warning` / `bg-danger-tint text-danger` / `bg-surface-2 text-ink-2` / `bg-surface-2 text-ink-2` | ✓ | ✓ | ✓ |
| **上下文用量条** | <60% `bg-success`；60–85% `bg-warning`；≥85% `bg-danger` | ✓ | ✓ | ◐ 图形 |
| **diff** 增 / 删 / hunk 头 | `text-success` / `text-danger` / `text-accent-strong`（结构标识，非状态） | 5.70 / 6.62 / 17.72 | 7.38 / 7.48 / 17.65 | ✓ |

### 4.4 三条硬约束

1. **语义色裸文字不得落在 `selected` / `selected-strong` 底色上**。实测浅色 selected 上 live 4.34、success 4.39（<4.5）。选中行内要表达状态，用 `bg-{c}-tint text-{c}` pill（自带底色，与行底色无关）或降级为 `bg-{c}` 状态点（≥3 达标）。
2. **徽标一律用 `-tint`，不用 `/15` `/20`**（§3.4 实测）。
3. **同一语义不跨族**：`live` 与 `success` 都是绿，但不得互换；`warning`/`danger` 不得用于「进行中」。

### 4.5 交互态三通道规则（层次方案的关键）

单靠底色在浅色下最多给出 1.09:1 的档位差，必须叠加通道。**任何可选中项至少占 2 条通道**：

| 通道 | hover | selected | selected-strong |
|---|---|---|---|
| 底色 | `bg-surface-3` | `bg-selected` | `bg-selected-strong` |
| 文字 | 不变 | `text-ink`（升权） | `text-ink` + `font-medium` |
| 边框/指示 | — | `ring-1 ring-line-strong` 或左侧 2px `bg-accent` 竖条 | 同左 + `ring-1` |

禁止：`hover:bg-bg` 与 `bg-bg`（选中）并存——二者 1.000:1，等于没有 hover 反馈。

---

## 5. 整改映射表

### 5.1 层次 / 交互态（hover 与 selected 同色，必须改 class）

| # | 文件:行 | 现状 | 改为 |
|---|---|---|---|
| 1 | `CommandPalette.tsx:108` | `i === index ? "bg-bg" : "hover:bg-bg"` | `i === index ? "bg-selected text-ink" : "hover:bg-surface-3"` |
| 2 | `Composer.tsx:305` | `i === atIndex ? "bg-bg" : "hover:bg-bg"` | `i === atIndex ? "bg-selected" : "hover:bg-surface-3"` |
| 3 | `Composer.tsx:350` | `!selectedModel ? "bg-bg" : "hover:bg-bg"` | `!selectedModel ? "bg-selected" : "hover:bg-surface-3"` |
| 4 | `Composer.tsx:370` | `active ? "bg-bg" : "hover:bg-bg"` | `active ? "bg-selected" : "hover:bg-surface-3"` |
| 5 | `Composer.tsx:424` | `active ? "bg-bg" : "hover:bg-bg"` | `active ? "bg-selected" : "hover:bg-surface-3"` |
| 6 | `Composer.tsx:456` | `effort === opt.value ? "bg-bg" : "hover:bg-bg"` | `effort === opt.value ? "bg-selected" : "hover:bg-surface-3"` |
| 7 | `Composer.tsx:479` | `hover:bg-bg` | `hover:bg-surface-3` |
| 8 | `ProjectSwitcher.tsx:125` | `p.id === active?.id ? "bg-bg" : "hover:bg-bg"` | `p.id === active?.id ? "bg-selected" : "hover:bg-surface-3"` |
| 9 | `ProjectSwitcher.tsx:137` | `hover:bg-bg hover:text-ink` | `hover:bg-surface-3 hover:text-ink` |
| 10 | `SessionList.tsx:125` | `activeId === s.id ? "bg-bg shadow-sm ring-1 ring-line"` | `activeId === s.id ? "bg-selected shadow-sm ring-1 ring-line-strong"` |

> #1–#9 的弹层容器均为 `bg-surface`（`CommandPalette:74` / `Composer:295,327,438,467` / `ProjectSwitcher:115`），改后：hover 与 panel 差 1.087:1、selected 与 hover 差 1.089:1。

### 5.2 语义色归位（accent-strong 当语义用）

| # | 文件:行 | 现状 | 语义判定 | 改为 |
|---|---|---|---|---|
| 11 | `ChatView.tsx:172` | `running ? "bg-accent/15 text-accent-strong"` | 子任务执行中 | `running ? "bg-live-tint text-live"` |
| 12 | `ChatView.tsx:363` | `running ? "bg-accent/20 text-accent-strong"` | 会话运行中徽标 | `running ? "bg-live-tint text-live"` |
| 13 | `ChatView.tsx:369` | `running ? "animate-pulse bg-accent-strong"` | 运行中状态点 | `running ? "animate-pulse bg-live"` |
| 14 | `ChatView.tsx:289` | `bg-accent-strong text-bg`（✓ 图标） | 步骤已完成 | `bg-success text-bg` |
| 15 | `ChatView.tsx:291` | `border-2 border-accent-strong` | 步骤进行中 | `border-2 border-live`（+ `animate-pulse`） |
| 16 | `ChatView.tsx:303` | `bg-accent-strong`（进度条填充） | 执行中进度 | `bg-live` |
| 17 | `ChatView.tsx:505` | `text-accent-strong`（「正在工作…」） | 运行中 | `text-live` |
| 18 | `ChatView.tsx:506` | `animate-pulse bg-accent-strong` | 运行中点 | `animate-pulse bg-live` |
| 19 | `ChatView.tsx:380` | `autoMode ? "bg-accent/20 text-accent-strong"` | 开关态（结构） | `autoMode ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2 hover:text-ink"` |
| 20 | `app/page.tsx:349` | `status === "running" ? "animate-pulse bg-accent-strong"` | 运行中点 | `animate-pulse bg-live` |
| 21 | `SessionList.tsx:161` | `s.running ? "animate-pulse bg-accent-strong"` | 运行中点 | `s.running ? "animate-pulse bg-live"` |
| 22 | `Composer.tsx:289` | `pct >= 85 ? "bg-danger" : pct >= 60 ? "bg-warning" : "bg-accent-strong"` | 用量条正常档 | 第三档改 `bg-success`（三档同族，梯度连贯） |
| 23 | `GitPanel.tsx:14` | `A: "bg-accent/20 text-accent-strong"` | Git 新增（状态） | `A: "bg-success-tint text-success"` |
| 24 | `GitPanel.tsx:13` | `M: "bg-warning/15 text-warning"` | Git 修改 | `M: "bg-warning-tint text-warning"`（/15 → tint） |
| 25 | `GitPanel.tsx:15` | `D: "bg-danger/15 text-danger"` | Git 删除 | `D: "bg-danger-tint text-danger"`（/15 → tint） |
| 26 | `WorkbenchPanel.tsx:165` | `bg-accent/15 text-accent-strong`（**「画布打开」导航按钮**） | 动作入口，非状态 | `bg-surface-2 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink` |
| 27 | `WorkbenchPanel.tsx:156` | `editing ? "bg-accent/15 text-accent-strong hover:bg-accent/25"` | 结构选中态 | `editing ? "bg-selected text-ink hover:bg-selected-strong"` |
| 28 | `ProjectSwitcher.tsx:94` | `text-accent-strong`（装饰图标） | 装饰，非结构非状态 | `text-ink-3` |
| 31 | `ChatView.tsx:234` | `text-accent-strong`（「输出已截流…查看全文」） | 告警：需注意但可恢复（全文已落盘） | `text-warning` |
| 32 | `ChatView.tsx:172` | failed 分支 `bg-danger/15 text-danger` | 状态徽标，与 live-tint 同槽位 | `bg-danger-tint text-danger` |
| 33 | `ChatView.tsx:172` | 完成分支 `bg-surface-2 text-ink-3` | 静息态（信息由 live/danger 承载） | `bg-surface-2 text-ink-2`（ink-3 在 surface-2 仅 3.36:1） |

> **#26 更正说明**：初版误标为「编辑中徽标」，实为 HTML 预览时切换右栏到画布的**导航按钮**（label「画布打开」）。它不是状态，不该用 live 绿；也不该用 accent 抢过同排的编辑/预览开关（那才是真正的状态控件），故退为与其非激活态同族的中性 chip。原实现还带一个 `hover:bg-live-tint`（base 同为 `bg-live-tint`）→ hover 无反馈，一并修正。
> **#31 补充说明**：该行在初版 grep 中已命中但未入表，属遗漏。它与 `GitPanel:50`（刷新链接）不同——截断提示携带信息，「换成灰就丢信息」，故归 warning 而非结构色。

**审后判定为「合法使用 accent，保留」**（避免误伤）：

| 文件:行 | 现状 | 判定 |
|---|---|---|
| `Composer.tsx:516` | skill 徽标 `bg-accent/15 text-accent-strong` | 结构强调（已挂载项），保留 |
| `Composer.tsx:693` | `CheckIcon` `text-accent-strong` | 选中勾选，结构，保留 |
| `ReviewPane.tsx:139` | checkpoint hash `text-accent-strong` | 技术标识强调，结构，保留 |
| `DiffView.tsx:15` | `@@` hunk 头 `text-accent-strong` | 代码结构标识，非状态，保留 |
| `GitPanel.tsx:50` | 刷新链接 `text-accent-strong` | 可点击强调，结构，保留 |
| `Composer.tsx:375` | `m.routable ? text-ink-3 : text-danger` | 已正确，不动 |
| `ChatView.tsx:189/365/500` | danger / warning / danger | 已正确，不动 |

### 5.3 主题入口

| # | 文件 | 动作 |
|---|---|---|
| 29 | `ThemeToggle.tsx`（84 行，零引用） | 接入 `app/page.tsx` 的 `Navbar actions`（与 `SessionList` 侧栏开关并列）。组件本身逻辑完好，且 `applyPref` 删 `data-theme` 的写法与 §2 的三态 `color-scheme` 方案兼容——system 态删属性 → `html` 回落 `color-scheme: light dark` → 自动跟随系统 |
| 30 | `app/globals.css:24–73` | 删除两个深色块与 `:root { color-scheme: light }`，改为 §2 的 `light-dark()` 单源 |

---

## 6. 实施顺序

1. **`globals.css` 重写**（§2 + §3 全表）——单源化 + 补齐深色覆盖 + 阴影 + selected。此时不改任何组件，先验证双主题 token 自洽。
2. **语义色归位**（§5.2，#11–28）——纯 class 替换，逐文件可独立验收。
3. **层次 / 交互态**（§5.1，#1–10）——class 替换 + popover 补 `ring-1 ring-line`。
4. **主题入口**（§5.3，#29–30）。
5. **可选**：§3.5 ink-3 加固。

验收口径：浅/深两主题下各截 3 张（工作台 / 弹层展开 / 深色设置页），逐项核对 §4.3 表格的对比度实测值；`grep -rn "accent-strong" components app` 结果应只剩 §5.2 末尾「合法保留」的 5 处。

---

## 7. 硬约束遵守情况

- 未触碰 Electron 壳集成：`globals.css:124–137` 的 `-webkit-app-region` 与红绿灯让位规则**原样保留**。
- 未触碰终端配色：`TerminalPane.tsx` 的 `VSC_THEME` 与 xterm CSS 未改；`--color-dark-*` 四个色仍按 theme 原义只服务代码块 / preview，与 harness 全局深色互不干扰。
- 未触碰登录与认证、⌘K / ⌘P 语义。
- 未新增自写组件替代 theme 组件：`Button` / `Input` / `Navbar` / `Logo` / `Badge` / `Textarea` / `Markdown` / `PermissionCard` / `Reasoning` / `ToolCard` 引用关系全部不变，仅通过 token 生效。
- 「靠改 token 定义生效」：§3 全表为 token 级修复，覆盖 §3.7 全部塌陷点；§5 的 class 改动仅 30 处，集中在 hover/selected 归位与语义色归位，未改任何布局或信息架构。

---

## 8. 附：`globals.css` 目标结构

```
@import tailwindcss / theme tokens / theme fonts / xterm css
@source ../node_modules/@zmzai/theme/src/**/*.{ts,tsx}

html { color-scheme: light dark }
html[data-theme=light] { color-scheme: light }
html[data-theme=dark]  { color-scheme: dark }

@theme {
  --font-sans / --radius-input / --ease-spring          ← 现有 harness 覆写，保留
  --color-* × 22（全部 light-dark(浅, 深) 单源）        ← §3.1–3.4
  --color-selected / --color-selected-strong            ← 新增
  --shadow-xs..xl（light-dark 双套）                    ← §3.6
}

@layer base { 布局重置 / 滚动条 / ::selection }         ← 保留，滚动条自动吃到修好的 line-strong
html.electron { … }                                     ← 原样保留
```

---

## 9. 计算脚本

本文所有 oklch↔sRGB 换算、gamut 判定、WCAG 对比度、alpha 合成结果，均由脚本实测产出，非目测估算。脚本逻辑：

- oklch → OKLab → LMS → 线性 sRGB → gamma sRGB（Björn Ottosson 矩阵）
- `inGamut`：三通道均落在 `[0, 0.998]`
- `fit(L, C, H)`：二分求同 L 同 H 下的最大可用彩度（消除 theme 三处 gamut 裁剪）
- 对比度：WCAG 2.1 相对亮度公式
- alpha 合成：gamma 空间线性插值（与浏览器 `color-mix` / alpha 合成一致）

复算入口：`.design/calc/`，`node final.mjs` 输出 §3.1–3.4 全部矩阵。
