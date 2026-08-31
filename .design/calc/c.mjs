// oklch <-> sRGB + WCAG contrast (no deps)
const f = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const g = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    f(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    f(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const clamp = (x) => Math.max(0, Math.min(1, x));
const hex = (rgb) => "#" + rgb.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("");
const lum = (rgb) => { const [r, gg, b] = rgb.map(g); return 0.2126 * r + 0.7152 * gg + 0.0722 * b; };
const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
function oklch(L, C, H) {
  const rgb = oklchToRgb(L, C, H);
  return { L, C, H, rgb, hex: hex(rgb), inGamut: rgb.every((v) => v >= -0.002 && v <= 1.002) };
}
function fromHex(h) {
  const n = parseInt(h.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, gg = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const R = g(r), G = g(gg), B = g(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B2);
  let H = (Math.atan2(B2, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: +L.toFixed(4), C: +C.toFixed(4), H: +H.toFixed(1) };
}
const parse = (s) => {
  const m = s.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  return oklch(+m[1], +m[2], +m[3]);
};
const P = (a, b) => cr(parse(a).rgb, parse(b).rgb);
export { oklch, fromHex, P, cr, hex, parse };
