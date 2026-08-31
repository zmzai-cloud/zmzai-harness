import { oklch, P, parse } from "./c.mjs";
const K = (L, C, H) => `oklch(${L} ${C} ${H})`;
const line = console.log;

function fit(L, C, H) {           // sRGB 内最大彩度（留 0.5% 安全边）
  let lo = 0, hi = C;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2, o = oklch(L, mid, H);
    if (o.rgb.every((v) => v >= 0 && v <= 0.998)) lo = mid; else hi = mid;
  }
  return +lo.toFixed(4);
}

line("══ T1. 浅色 selected 取值：在「与 hover 可辨」和「语义文字 ≥4.5」之间求解 ══");
line("  约束：hover=surface-3 L=0.94；success 文字 L=0.499 C=0.13 H=145；live 同理 C=0.1572");
const lightSem = { success: K(0.499, 0.13, 145), live: K(0.499, fit(0.499, 0.17, 145), 145),
  warning: K(0.499, fit(0.499, 0.12, 75), 75), danger: K(0.499, 0.18, 25) };
for (let Lsel = 0.940; Lsel >= 0.880; Lsel -= 0.005) {
  const sel = K(+Lsel.toFixed(3), 0.006, 265);
  const dHover = P(sel, K(0.94, 0.003, 265));
  const cSucc = P(lightSem.success, sel), cLive = P(lightSem.live, sel), cWarn = P(lightSem.warning, sel), cDang = P(lightSem.danger, sel);
  const allPass = cSucc >= 4.5 && cLive >= 4.5 && cWarn >= 4.5 && cDang >= 4.5;
  line(`  selected L=${Lsel.toFixed(3)}  ΔLvsHover=${(0.94 - Lsel).toFixed(3)}  比=${dHover.toFixed(3)}  ` +
       `succ=${cSucc.toFixed(2)} live=${cLive.toFixed(2)} warn=${cWarn.toFixed(2)} dang=${cDang.toFixed(2)}  ${allPass ? "PASS" : "fail"}`);
}

line("\n══ T2. 深色 selected 取值：与 surface-3(0.272) 可辨 + 四语义文字 ≥4.5 ══");
const darkSem0 = { live: 0.72, success: 0.70, warning: 0.82, danger: 0.70 };
for (const bump of [0, 0.02, 0.04]) {
  const sem = {
    live:    K(darkSem0.live,            fit(darkSem0.live, 0.20, 145), 145),
    success: K(darkSem0.success,         fit(darkSem0.success, 0.18, 145), 145),
    warning: K(darkSem0.warning + bump,  fit(darkSem0.warning + bump, 0.16, 75), 75),
    danger:  K(darkSem0.danger + bump,   fit(darkSem0.danger + bump, 0.19, 25), 25),
  };
  for (const Lsel of [0.315, 0.305, 0.295]) {
    const sel = K(Lsel, 0.010, 265);
    const dHover = P(sel, K(0.272, 0.008, 265));
    const cs = Object.fromEntries(Object.entries(sem).map(([k, v]) => [k, P(v, sel)]));
    const allPass = Object.values(cs).every((v) => v >= 4.5);
    line(`  bump=${bump}  selected L=${Lsel}  ΔLvsHover=${(Lsel - 0.272).toFixed(3)} 比=${dHover.toFixed(3)}  ` +
         `live=${cs.live.toFixed(2)} succ=${cs.success.toFixed(2)} warn=${cs.warning.toFixed(2)} dang=${cs.danger.toFixed(2)}  ${allPass ? "PASS" : "fail"}`);
  }
}

line("\n══ T3. 深色语义色最终定案（含 tint 上的文字）══");
const DK = { live: 0.72, success: 0.70, warning: 0.84, danger: 0.74 };
const DS = {
  live:           K(DK.live,    fit(DK.live, 0.20, 145), 145),
  "live-tint":    K(0.280, 0.045, 145),
  success:        K(DK.success, fit(DK.success, 0.18, 145), 145),
  "success-tint": K(0.280, 0.035, 145),
  warning:        K(DK.warning, fit(DK.warning, 0.16, 75), 75),
  "warning-tint": K(0.300, 0.050, 90),
  danger:         K(DK.danger,  fit(DK.danger, 0.19, 25), 25),
  "danger-tint":  K(0.300, 0.055, 25),
};
const Dsel = K(0.305, 0.010, 265), Dsurf = K(0.191, 0.003, 265), Dsurf2 = K(0.228, 0.006, 265), Dbg = K(0.145, 0.002, 265);
for (const [k, v] of Object.entries(DS)) {
  const o = parse(v);
  line(`  ${k.padEnd(14)} ${v.padEnd(32)} ${o.hex}  gamut:${o.inGamut ? "ok  " : "CLIP"}`);
}
line("  对比度矩阵（行=语义文字，列=载体）");
const carriers = { bg: Dbg, surface: Dsurf, "surface-2": Dsurf2, selected: Dsel };
line("           " + Object.keys(carriers).map((c) => c.padStart(10)).join(""));
for (const n of ["live", "success", "warning", "danger"]) {
  line("  " + n.padEnd(10) + Object.values(carriers).map((c) => P(DS[n], c).toFixed(2).padStart(10)).join(""));
}
line("  tint 载体（语义文字打在自己的 tint 底上）");
for (const n of ["live", "success", "warning", "danger"]) {
  const r = P(DS[n], DS[n + "-tint"]);
  line(`  ${n.padEnd(10)} on ${(n + "-tint").padEnd(14)} ${r.toFixed(2)}:1  ${r >= 4.5 ? "PASS" : "FAIL"}`);
}

line("\n══ T4. 浅色语义色最终定案 ══");
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
  line(`  ${k.padEnd(14)} ${v.padEnd(32)} ${o.hex}  gamut:${o.inGamut ? "ok  " : "CLIP"}   (theme 原 ${k === "live" ? "#007a11" : k === "warning" ? "#8a5600" : k === "danger-tint" ? "#ffe9e6" : "同色"})`);
}
const Lsel = K(0.922, 0.006, 265);
line(`  选定 light selected = ${Lsel} → ${parse(Lsel).hex}`);
line(`    selected vs surface(0.985) : ${P(Lsel, K(0.985, 0.001, 265)).toFixed(3)}:1  ΔL=${(0.985 - 0.922).toFixed(3)}`);
line(`    selected vs hover(0.94)    : ${P(Lsel, K(0.94, 0.003, 265)).toFixed(3)}:1  ΔL=${(0.94 - 0.922).toFixed(3)}`);
const Lcarriers = { bg: K(1, 0, 0), surface: K(0.985, 0.001, 265), "surface-2": K(0.968, 0.002, 265), hover: K(0.94, 0.003, 265), selected: Lsel };
line("           " + Object.keys(Lcarriers).map((c) => c.padStart(11)).join(""));
for (const n of ["live", "success", "warning", "danger"]) {
  const cells = Object.values(Lcarriers).map((c) => { const r = P(LS[n], c); return (r.toFixed(2) + (r >= 4.5 ? "" : "!")).padStart(11); });
  line("  " + n.padEnd(10) + cells.join(""));
}
line("  tint 载体");
for (const n of ["live", "success", "warning", "danger"]) {
  const r = P(LS[n], LS[n + "-tint"]);
  line(`  ${n.padEnd(10)} on ${(n + "-tint").padEnd(14)} ${r.toFixed(2)}:1  ${r >= 4.5 ? "PASS" : "FAIL"}`);
}
