// 网页棋盘域「读号」诊断：对真值里每一个带号的子，按识别器同一套裁剪（model-inference）
// 在不同裁剪尺度上问 digit-head，看原始 top-4 候选。用来分辨：
//   ① 模型本身读不出（能力/域问题）② 裁剪尺度不匹配（缩放问题）③ 合并/阈值逻辑吃掉了正确读
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-rp-digits.mjs rp-score-03
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const name = process.argv[2] || "rp-score-03";
const dir = resolve("qa/fixtures/materials/renjuportal");
const truth = JSON.parse(readFileSync(resolve(dir, `${name}.truth.json`), "utf8"));
const dataUrl = `data:image/png;base64,${readFileSync(resolve(dir, `${name}.png`)).toString("base64")}`;

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-rp-digit-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-rp-digit-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const report = await page.evaluate(async ({ dataUrl, stones }) => {
  const mod = await import("/src/image-recognition.ts");
  const inference = await import("/src/features/record/model-inference.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], "x.png", { type: "image/png" });
  const first = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
  if (!first.grid) return { error: "没有网格" };
  // 复刻识别器的画布缩放，得到与它同一坐标系下的采样图
  const img = await new Promise((resolveImage, rejectImage) => {
    const element = new Image();
    element.onload = () => resolveImage(element);
    element.onerror = rejectImage;
    element.src = URL.createObjectURL(blob);
  });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(data, canvas.width, canvas.height);
  const grid = first.grid;
  const baseHalf = Math.round((grid.spacingX + grid.spacingY) / 2);
  const scales = [1, 0.85, 0.75, 0.65, 0.55, 0.45, 0.38, 0.3];
  const out = [];
  for (const stone of stones) {
    const x = grid.originX + stone.col * grid.spacingX;
    const y = grid.originY + stone.row * grid.spacingY;
    const row = { n: stone.number, at: `${stone.row},${stone.col}`, reads: [] };
    for (const s of scales) {
      const half = Math.max(6, Math.round(baseHalf * s));
      const reads = await inference.readDigitCandidates(sampled, [{ x, y }], half, {});
      const read = reads?.[0];
      row.reads.push(read ? { s, d: read.digit, p: Math.round(read.digitProb * 100) / 100, top: read.digitTop.slice(0, 4).map((c) => `${c.value}:${Math.round(c.score * 100)}`) } : { s, d: 0, p: 0, top: [] });
    }
    out.push(row);
  }
  return { grid, baseHalf, canvas: [canvas.width, canvas.height], out };
}, { dataUrl, stones: truth.stones });

if (report.error) { console.log(report.error); await browser.close(); process.exit(0); }
console.log(`${name} 画布 ${report.canvas.join("x")} 网格 ${report.grid.originX.toFixed(1)},${report.grid.originY.toFixed(1)} @ ${report.grid.spacingX.toFixed(1)}x${report.grid.spacingY.toFixed(1)}  基准 half=${report.baseHalf}`);
const scaleList = [1, 0.85, 0.75, 0.65, 0.55, 0.45, 0.38, 0.3];
console.log(`  尺度: ${scaleList.join(" / ")}`);
let anyHit = 0, exactHit = 0;
for (const row of report.out) {
  const cells = row.reads.map((read) => (read.d === row.n ? `✓${read.d}(${read.p})` : `${read.d === 0 ? "空" : read.d}(${read.p})`));
  const hit = row.reads.some((read) => read.d === row.n);
  const exact = row.reads[0].d === row.n;
  if (hit) anyHit += 1;
  if (exact) exactHit += 1;
  console.log(`  #${String(row.n).padStart(2)} @${row.at.padEnd(6)} ${cells.join(" | ")}${hit ? "" : `   ← top: ${row.reads.map((r) => r.top.join(",")).join(" / ")}`}`);
}
console.log(`\n合计 ${report.out.length} 子：基准尺度对 ${exactHit}（${Math.round(exactHit / report.out.length * 100)}% ），任一尺度对 ${anyHit}（${Math.round(anyHit / report.out.length * 100)}% ）`);
// 级联策略模拟：先读基准尺度，逐格不确定才补读其余尺度（与应用现在的结构一致），
// 报告「准确率 / 需要补读的格占比」随门槛 T 的变化——用真实读数算，不是估计。
const indexOfScale = (s) => scaleList.indexOf(s);
const total = report.out.length;
const pct = (value) => `${value}（${Math.round(value / total * 100)}% ）`;
const vote = (reads) => {
  const mass = new Map();
  const votes = new Map();
  for (const read of reads) {
    mass.set(read.d, (mass.get(read.d) ?? 0) + (read.p > 0 ? read.p : 0.05));
    votes.set(read.d, (votes.get(read.d) ?? 0) + 1);
  }
  return [...votes.entries()].sort((left, right) => right[1] - left[1] || mass.get(right[0]) - mass.get(left[0]))[0][0];
};
console.log("  级联模拟（基准 1×，不确定才补读）");
for (const [label, extra] of [["补 {0.75,0.55}", [0.75, 0.55]], ["补 {0.65,0.45}", [0.65, 0.45]], ["补 {0.65,0.45,0.3}", [0.65, 0.45, 0.3]], ["补 {0.75,0.55,0.38}", [0.75, 0.55, 0.38]]]) {
  const line = [];
  for (const threshold of [0.5, 0.72, 0.9, 1.01]) {
    let hit = 0, escalated = 0;
    for (const row of report.out) {
      const first = row.reads[indexOfScale(1)];
      if (first.p >= threshold && first.d !== 0) { if (first.d === row.n) hit += 1; continue; }
      escalated += 1;
      const picks = [first, ...extra.map((s) => row.reads[indexOfScale(s)])].filter(Boolean);
      if (vote(picks) === row.n) hit += 1;
    }
    line.push(`T=${threshold === 1.01 ? "总是" : threshold} → ${pct(hit)} 补读 ${Math.round(escalated / total * 100)}%`);
  }
  console.log(`    ${label.padEnd(20)} ${line.join(" | ")}`);
}
// 全量合并（不级联）：几个尺度集合的概率和/多数票
for (const set of [[1, 0.65], [1, 0.65, 0.45], [1, 0.75, 0.55], [1, 0.65, 0.45, 0.3]]) {
  let voteHit = 0;
  for (const row of report.out) if (vote(set.map((s) => row.reads[indexOfScale(s)]).filter(Boolean)) === row.n) voteHit += 1;
  console.log(`    全量 ${set.join("/").padEnd(18)} 多数票 ${pct(voteHit)}`);
}
await browser.close();
