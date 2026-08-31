import { oklch, fromHex, P, parse } from "./c.mjs";

// 取 sRGB 内最大可用彩度（避免 theme 里 live/warning 那种 gamut CLIP）
function fit(L, C, H) {
  let lo = 0, hi = C;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (oklch(L, mid, H).inGamut) lo = mid; else hi = mid;
  }
  return +lo.toFixed(4);
}
const K = (L, C, H) => `oklch(${L} ${C} ${H})`;

const line = console.log;
const row = (name, tok, onTok, min) => {
  const o = parse(tok);
  const r = P(tok, onTok);
  const ok = r >= min ? "PASS" : "FAIL";
  line(`  ${name.padEnd(30)} ${o.hex}  on ${onTok.padEnd(26)} ${r.toFixed(2)}:1  (需≥${min}) ${ok}${o.inGamut ? "" : "  [gamut CLIP!]"}`);
};

line("══ 1. 深色层次阶梯（hue 265 统一，对齐现有 #0a0a0a/#141414/#1c1c1f）══");
const D = {
  bg:              K(0.145, 0.002, 265),
  surface:         K(0.191, 0.003, 265),
  "surface-2":     K(0.228, 0.006, 265),
  "surface-3":     K(0.272, 0.008, 265),
  selected:        K(0.315, 0.010, 265),
  "selected-strong": K(0.360, 0.012, 265),
  ink:             K(0.985, 0.001, 265),
  "ink-2":         K(0.727, 0.010, 265),
  "ink-3":         K(0.636, 0.012, 265),
  line:            K(0.271, 0.009, 265),
  "line-strong":   K(0.340, 0.010, 265),
};
let prev = null, prevV = null;
for (const [k, v] of Object.entries(D)) {
  const o = parse(v);
  const d = prev ? `  ΔL=${(o.L - prev).toFixed(3)}  与下层比 ${P(v, prevV).toFixed(3)}:1` : "";
  line(`  ${k.padEnd(16)} ${v.padEnd(28)} ${o.hex}  gamut:${o.inGamut ? "ok" : "CLIP"}${d}`);
  prev = o.L; prevV = v;
}

line("\n══ 2. 深色文字对比度（正文≥4.5 大/次要≥4.5，辅助≥3）══");
line("  -- 在 panel surface 上 --");
row("ink    正文", D.ink, D.surface, 4.5);
row("ink-2  次级", D["ink-2"], D.surface, 4.5);
row("ink-3  辅助", D["ink-3"], D.surface, 4.5);
line("  -- 在应用底 bg 上 --");
row("ink", D.ink, D.bg, 4.5);
row("ink-2", D["ink-2"], D.bg, 4.5);
row("ink-3", D["ink-3"], D.bg, 4.5);
line("  -- 在 selected 行上（选中态文字仍需可读）--");
row("ink", D.ink, D.selected, 4.5);
row("ink-2", D["ink-2"], D.selected, 4.5);
row("ink-3", D["ink-3"], D.selected, 3.0);
line("  -- 边框/图形（WCAG 1.4.11 需≥3）--");
row("line  常规边框", D.line, D.surface, 1.0);
line(`     ↑ 注：line 与 surface 仅 ${P(D.line, D.surface).toFixed(2)}:1，靠边框分层在深色下不可行，必须用底色分层`);
row("line-strong 强调边框", D["line-strong"], D.surface, 1.0);

line("\n══ 3. 深色语义色（提亮到可读区间 + 深色 tint）══");
const DS = {
  live:            K(0.720, fit(0.720, 0.20, 145), 145),
  "live-tint":     K(0.280, 0.045, 145),
  success:         K(0.700, fit(0.700, 0.18, 145), 145),
  "success-tint":  K(0.280, 0.035, 145),
  warning:         K(0.820, fit(0.820, 0.16, 75), 75),
  "warning-tint":  K(0.300, 0.050, 90),
  danger:          K(0.700, fit(0.700, 0.19, 25), 25),
  "danger-tint":   K(0.300, 0.055, 25),
};
for (const [k, v] of Object.entries(DS)) {
  const o = parse(v);
  line(`  ${k.padEnd(14)} ${v.padEnd(30)} ${o.hex}  gamut:${o.inGamut ? "ok" : "CLIP"}`);
}
line("  -- 语义文字在 panel / 在自身 tint 上 --");
for (const n of ["live", "success", "warning", "danger"]) {
  row(n + " 文字/panel", DS[n], D.surface, 4.5);
  row(n + " 文字/tint", DS[n], DS[n + "-tint"], 4.5);
  row(n + " 文字/selected", DS[n], D.selected, 4.5);
  row(n + " 图形点/panel", DS[n], D.surface, 3.0);
}

line("\n══ 4. 深色 accent（结构色镜像 = 近白，取代 v0.6 荧光绿）══");
const DA = { accent: K(0.985, 0.001, 265), "accent-strong": K(1, 0, 0), "accent-ink": K(0.145, 0.002, 265), "accent-tint": K(0.272, 0.008, 265) };
for (const [k, v] of Object.entries(DA)) { const o = parse(v); line(`  ${k.padEnd(14)} ${v.padEnd(28)} ${o.hex}  gamut:${o.inGamut ? "ok" : "CLIP"}`); }
row("accent-strong 文字/panel", DA["accent-strong"], D.surface, 4.5);
row("accent-strong 文字/accent-tint", DA["accent-strong"], DA["accent-tint"], 4.5);
row("accent-ink 文字/accent 实底", DA["accent-ink"], DA.accent, 4.5);
line(`  对照：现深色 accent #51d845 → 与 ink #fafafa 同屏时为荧光绿结构线（theme 明确禁止）`);
line(`  PermissionCard 现为 border:1px solid #51d845 + 4% 荧光绿底 → 改后为近白描边 + 4% 近白底（与浅色墨黑镜像）`);

line("\n══ 5. 浅色层次阶梯（theme 原值不动，仅新增 2 档）══");
const L = {
  bg:               K(1, 0, 0),
  surface:          K(0.985, 0.001, 265),
  "surface-2":      K(0.968, 0.002, 265),
  "surface-3":      K(0.940, 0.003, 265),
  selected:         K(0.905, 0.006, 265),
  "selected-strong": K(0.875, 0.008, 265),
  ink:              K(0.21, 0.008, 265),
  "ink-2":          K(0.442, 0.017, 265),
  "ink-3":          K(0.617, 0.014, 265),
  line:             K(0.92, 0.004, 265),
  "line-strong":    K(0.87, 0.005, 265),
};
prev = null;
for (const [k, v] of Object.entries(L)) {
  const o = parse(v);
  const d = prev ? `  ΔL=${(o.L - prev).toFixed(3)}  与下层比 ${P(v, prevV).toFixed(3)}:1` : "";
  line(`  ${k.padEnd(16)} ${v.padEnd(28)} ${o.hex}  gamut:${o.inGamut ? "ok" : "CLIP"}${d}`);
  prev = o.L; prevV = v;
}
line("  -- 交互态可辨性（关键指标：selected 与 hover 必须不同，且都明显于 panel）--");
line(`  hover=surface-3   vs panel=surface : ${P(L["surface-3"], L.surface).toFixed(3)}:1   ΔL=${(0.940 - 0.985).toFixed(3)}`);
line(`  selected          vs panel=surface : ${P(L.selected, L.surface).toFixed(3)}:1   ΔL=${(0.905 - 0.985).toFixed(3)}`);
line(`  selected          vs hover         : ${P(L.selected, L["surface-3"]).toFixed(3)}:1   ΔL=${(0.905 - 0.940).toFixed(3)}`);
line(`  现状(selected=bg) vs panel=surface : ${P(L.bg, L.surface).toFixed(3)}:1   ΔL=${(1 - 0.985).toFixed(3)}   ← 崩塌`);
line(`  现状(hover=bg)    vs selected=bg   : 1.000:1   ← 完全同色`);
line("  -- 浅色文字在 selected 行上 --");
row("ink", L.ink, L.selected, 4.5);
row("ink-2", L["ink-2"], L.selected, 4.5);
row("ink-3", L["ink-3"], L.selected, 3.0);

line("\n══ 6. 浅色语义色（修正 theme 的 gamut CLIP，保持外观不变）══");
const LS = {
  live:           K(0.499, fit(0.499, 0.17, 145), 145),
  "live-tint":    K(0.955, 0.045, 145),
  success:        K(0.499, 0.13, 145),
  "success-tint": K(0.955, 0.035, 145),
  warning:        K(0.499, fit(0.499, 0.12, 75), 75),
  "warning-tint": K(0.955, 0.045, 90),
  danger:         K(0.499, 0.18, 25),
  "danger-tint":  K(0.955, fit(0.955, 0.03, 25), 25),
};
for (const [k, v] of Object.entries(LS)) {
  const o = parse(v);
  line(`  ${k.padEnd(14)} ${v.padEnd(30)} ${o.hex}  gamut:${o.inGamut ? "ok" : "CLIP"}  (theme 原值 ${k === "live" ? "#007a11 CLIP" : k === "warning" ? "#8a5600 CLIP" : k === "danger-tint" ? "#ffe9e6 CLIP" : "ok"})`);
}
line("  -- 语义文字在白底 / 在自身 tint 上 / 在 selected 行上 --");
for (const n of ["live", "success", "warning", "danger"]) {
  row(n + "/白底", LS[n], L.bg, 4.5);
  row(n + "/tint", LS[n], LS[n + "-tint"], 4.5);
  row(n + "/selected", LS[n], L.selected, 4.5);
  row(n + " 图形点/白底", LS[n], L.bg, 3.0);
}

line("\n══ 7. 深色阴影（基色改纯黑 + 提高 alpha；浅色仍用 ink 基色）══");
line(`  浅色：ink 基色 vs 白底 亮度比 ${P(K(0.21, 0.008, 265), K(1, 0, 0)).toFixed(2)}:1 → 阴影可见`);
line(`  深色：ink 基色 vs #0a0a0a 亮度比 ${P(K(0.21, 0.008, 265), K(0.145, 0.002, 265)).toFixed(2)}:1 → 现方案几乎不可见，改用 oklch(0 0 0 / α)`);
line(`  深色纯黑 vs bg #0a0a0a：${P(K(0, 0, 0), K(0.145, 0.002, 265)).toFixed(2)}:1（配合 α0.5~0.75 才有分离感）`);
