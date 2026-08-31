import { oklch, P, parse } from "./c.mjs";
const K = (L, C, H) => `oklch(${L} ${C} ${H})`;
const line = console.log;
function fit(L, C, H) {
  let lo = 0, hi = C;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2, o = oklch(L, m, H);
    if (o.rgb.every((v) => v >= 0 && v <= 0.998)) lo = m; else hi = m; }
  return +lo.toFixed(4);
}
// alpha 合成：前景色 a 叠在载体 b 上（sRGB 线性空间近似，够用）
const comp = (fgTok, a, bgTok) => {
  const f = parse(fgTok).rgb.map((v) => v * v ** 0 + v), b = parse(bgTok).rgb;
  const fr = parse(fgTok).rgb, br = b;
  // gamma 空间合成（浏览器默认）
  const out = fr.map((v, i) => v * a + br[i] * (1 - a));
  return out;
};
const crRGB = (a, b) => { const g = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const L = (r) => { const [x, y, z] = r.map(g); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const l1 = L(a), l2 = L(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const hexOf = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

/* ═════════ 最终定案 ═════════ */
const LIGHT = {
  bg: K(1, 0, 0), surface: K(0.985, 0.001, 265), "surface-2": K(0.968, 0.002, 265),
  "surface-3": K(0.940, 0.003, 265), selected: K(0.912, 0.006, 265), "selected-strong": K(0.884, 0.008, 265),
  ink: K(0.21, 0.008, 265), "ink-2": K(0.442, 0.017, 265), "ink-3": K(0.617, 0.014, 265),
  line: K(0.92, 0.004, 265), "line-strong": K(0.87, 0.005, 265), rule: K(0.21, 0.008, 265),
  accent: K(0.21, 0.008, 265), "accent-strong": K(0.09, 0.004, 265), "accent-ink": K(1, 0, 0), "accent-tint": K(0.968, 0.002, 265),
  live: K(0.499, fit(0.499, 0.17, 145), 145), "live-tint": K(0.955, 0.045, 145),
  success: K(0.499, 0.13, 145), "success-tint": K(0.955, 0.035, 145),
  warning: K(0.499, fit(0.499, 0.12, 75), 75), "warning-tint": K(0.955, 0.045, 90),
  danger: K(0.499, 0.18, 25), "danger-tint": K(0.955, fit(0.955, 0.03, 25), 25),
};
const DARK = {
  bg: K(0.145, 0.002, 265), surface: K(0.191, 0.003, 265), "surface-2": K(0.228, 0.006, 265),
  "surface-3": K(0.272, 0.008, 265), selected: K(0.315, 0.010, 265), "selected-strong": K(0.360, 0.012, 265),
  ink: K(0.985, 0.001, 265), "ink-2": K(0.727, 0.010, 265), "ink-3": K(0.636, 0.012, 265),
  line: K(0.271, 0.009, 265), "line-strong": K(0.340, 0.010, 265), rule: K(0.985, 0.001, 265),
  accent: K(0.985, 0.001, 265), "accent-strong": K(1, 0, 0), "accent-ink": K(0.145, 0.002, 265), "accent-tint": K(0.272, 0.008, 265),
  live: K(0.72, fit(0.72, 0.20, 145), 145), "live-tint": K(0.280, 0.045, 145),
  success: K(0.70, fit(0.70, 0.18, 145), 145), "success-tint": K(0.280, 0.035, 145),
  warning: K(0.84, fit(0.84, 0.16, 75), 75), "warning-tint": K(0.300, 0.050, 90),
  danger: K(0.74, fit(0.74, 0.19, 25), 25), "danger-tint": K(0.300, 0.055, 25),
};

for (const [themeName, T] of [["浅色 LIGHT", LIGHT], ["深色 DARK", DARK]]) {
  line(`\n╔══════════════════ ${themeName} ══════════════════╗`);
  line("── 层次阶梯 ──");
  const ladder = ["bg", "surface", "surface-2", "surface-3", "selected", "selected-strong"];
  let pv = null;
  for (const k of ladder) {
    const o = parse(T[k]);
    const d = pv ? `  ΔL=${(o.L - parse(T[pv]).L).toFixed(3).padStart(6)}  与下层 ${P(T[k], T[pv]).toFixed(3)}:1` : "";
    line(`  ${k.padEnd(16)} ${T[k].padEnd(30)} ${o.hex}  ${o.inGamut ? "ok" : "CLIP"}${d}`);
    pv = k;
  }
  line("── 中性文字 ≥4.5（正文/次级）/ ≥3（辅助）──");
  for (const car of ["bg", "surface", "surface-2", "selected"]) {
    const r = ["ink", "ink-2", "ink-3"].map((n) => `${n}=${P(T[n], T[car]).toFixed(2)}`);
    line(`  on ${car.padEnd(16)} ${r.join("  ")}`);
  }
  line("── 语义色：文字 ≥4.5 / 图形 ≥3 ──");
  for (const n of ["live", "success", "warning", "danger"]) {
    const o = parse(T[n]);
    const cells = ["bg", "surface", "surface-2", "surface-3", "selected"].map((c) => {
      const r = P(T[n], T[c]);
      return `${c}:${r.toFixed(2)}${r >= 4.5 ? "✓" : r >= 3 ? "◐" : "✗"}`;
    });
    line(`  ${n.padEnd(9)} ${o.hex}${o.inGamut ? " " : "*"} ${T[n].padEnd(30)} ${cells.join("  ")}`);
  }
  line("  图例：✓ 文字达标(≥4.5)  ◐ 仅图形达标(≥3，禁承载文字)  ✗ 不达标");
  line("── tint 底 + 语义文字（badge 标准配方）──");
  for (const n of ["live", "success", "warning", "danger"]) {
    const r = P(T[n], T[n + "-tint"]);
    line(`  bg-${n}-tint text-${n}  ${r.toFixed(2)}:1  ${r >= 4.5 ? "✓ PASS" : "✗ FAIL"}`);
  }
  line("── 实底 pill：语义实底 + bg/accent-ink 文字 ──");
  for (const n of ["live", "success", "warning", "danger"]) {
    const onBg = crRGB(parse(T.bg).rgb, parse(T[n]).rgb);
    line(`  bg-${n} text-bg          ${onBg.toFixed(2)}:1  ${onBg >= 4.5 ? "✓ PASS" : "✗ FAIL"}`);
  }
  line("── accent 结构色 ──");
  line(`  bg-accent text-accent-ink            ${crRGB(parse(T["accent-ink"]).rgb, parse(T.accent).rgb).toFixed(2)}:1`);
  line(`  bg-accent-tint text-accent-strong    ${P(T["accent-strong"], T["accent-tint"]).toFixed(2)}:1`);
  line("── alpha 叠加（Tailwind bg-x/15 等）合成后文字对比度 ──");
  for (const [fg, alpha, txt, car] of [
    ["accent", 0.15, "accent-strong", "surface"], ["accent", 0.20, "accent-strong", "surface"],
    ["accent", 0.15, "accent-strong", "bg"], ["accent", 0.20, "accent-strong", "bg"],
    ["live", 0.15, "live", "surface"], ["live", 0.15, "live", "bg"],
    ["success", 0.10, "success", "surface"], ["danger", 0.05, "danger", "bg"],
    ["danger", 0.15, "danger", "surface"], ["warning", 0.20, "warning", "surface"],
  ]) {
    const mixed = comp(T[fg], alpha, T[car]);
    const r = crRGB(mixed, parse(T[txt]).rgb);
    line(`  bg-${fg}/${Math.round(alpha * 100)} on ${car.padEnd(8)} → 底 ${hexOf(mixed)}  text-${txt} ${r.toFixed(2)}:1 ${r >= 4.5 ? "✓" : r >= 3 ? "◐" : "✗"}`);
  }
}
