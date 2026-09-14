/* Palette sanity check for board themes: contrast between board base and
 * stones/lines so no theme ends up visually mushy.
 * Usage: node palette-check.cjs */
const fs = require("fs");
const path = require("path");

const hexToRgb = (hex) => {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length < 6) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
// alpha-composite a colour over a base
const over = (fg, alpha, bg) => mix(bg, fg, alpha);
const parse = (value) => {
  if (!value) return null;
  const hex = hexToRgb(value.slice(0, 7));
  if (!hex) return null;
  const tail = value.slice(7);
  let alpha = 1;
  if (tail.length === 2) alpha = parseInt(tail, 16) / 255;
  else if (tail.length === 4) alpha = parseInt(tail.slice(0, 2), 16) / 255;
  return { rgb: hex, alpha };
};

const files = ["themes-core.js", "themes-batch-a.js", "themes-batch-b.js", "themes-batch-c.js", "themes-batch-d.js"];
const themes = [];
for (const f of files) {
  const full = path.join(__dirname, f);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, "utf8");
  const sandbox = { window: {} };
  try { new Function("window", src)(sandbox.window); } catch (e) { console.log("PARSE-FAIL", f, e.message); continue; }
  const key = Object.keys(sandbox.window)[0];
  (sandbox.window[key] || []).forEach((t) => themes.push(Object.assign({ __file: f }, t)));
}

console.log("themes:", themes.length);
const blockers = [];
const rimmed = [];
const rows = [];
themes.forEach((t) => {
  const v = t.vars || {};
  const b1 = parse(v["bd-1"]), b2 = parse(v["bd-2"]);
  if (!b1 || !b2) { blockers.push(`${t.name}: bd-1/bd-2 缺失或非 hex`); return; }
  const base = mix(b1.rgb, b2.rgb, 0.5);
  const black = parse(v["s-black"]), white = parse(v["s-white"]), line = parse(v.ln), glow = parse(v.glow);
  if (!black) blockers.push(`${t.name}: s-black 缺失`);
  if (!white) blockers.push(`${t.name}: s-white 缺失`);
  if (!line) issues.push(`${t.name}: ln 缺失`);
  const baseL = lum(base);
  const cB = black ? ratio(black.rgb, base) : 0;
  const cW = white ? ratio(white.rgb, base) : 0;
  const lineC = line ? ratio(over(line.rgb, line.alpha, base), base) : 0;
  // glow powers the adaptive rim that rescues low-contrast black stones
  const glowC = glow ? ratio(glow.rgb, base) : 0;
  rows.push({ name: t.name, base: Math.round(baseL * 100) / 100, black: Math.round(cB * 100) / 100, white: Math.round(cW * 100) / 100, line: Math.round(lineC * 100) / 100, glow: Math.round(glowC * 100) / 100 });
  if (!t.board) blockers.push(`${t.name}: 缺 board 材质类`);
  if (!t.stone) blockers.push(`${t.name}: 缺 stone 质感类`);
  if (!line) blockers.push(`${t.name}: ln 缺失`);
  if (lineC < 1.12) blockers.push(`${t.name}: 网格线几乎不可见 ${lineC.toFixed(2)}`);
  // A dark board with a dark stone is fine ONLY if the rim can read: the rim
  // uses --glow, so glow vs base contrast is the real guard.
  if (cB < 2.6) {
    if (glowC < 2.0) blockers.push(`${t.name}: 黑子对比仅 ${cB.toFixed(2)}，且 glow 与底对比也仅 ${glowC.toFixed(2)}——自适应描边看不清（底 ${v["bd-1"]} 子 ${v["s-black"]} 光 ${v.glow}）`);
    else rimmed.push(`${t.name}(黑)`);
  }
  if (cW < 1.45) {
    // white stones get a dark rim, which reads on any light base
    if (baseL < 0.42) blockers.push(`${t.name}: 深底上白子对比仅 ${cW.toFixed(2)}，暗描边救不回`);
    else rimmed.push(`${t.name}(白)`);
  }
});

rows.forEach((r) => console.log(`${r.name.padEnd(14)} 底亮${String(r.base).padEnd(6)} 黑子${String(r.black).padEnd(6)} 白子${String(r.white).padEnd(6)} 线${String(r.line).padEnd(6)} 光${r.glow}`));
console.log("\n依赖自适应描边（正常）：", rimmed.length ? rimmed.join(" ") : "无");
console.log("BLOCKER:", blockers.length);
blockers.forEach((i) => console.log("  ✗ " + i));
