// 「225 格全扫」有多少是白扫的 + 补位格的特征分下限（2026-10-09）。
//
// 背景：用户手机复测「识谱还是十几秒，且哪张图都一样」。import 路径的模型扫描是
// **固定 225 格**（boardSize²）逐格 cell-cls 分类，手机单线程每格几十毫秒 = 十几秒，
// 与图片内容无关——正好对上「哪个都一样」。
//
// 但补位门控是「pEmpty<0.05 **且** (自研特征分 ≥0.2 或读过号)」，也就是说
// **特征分低于阈值的格子结构上不可能被补**。本探针量两件事：
//   ① 各语料上「特征分 ≥ 阈值 且 不是已识别子」的格子有多少（= 真正需要扫描的集合）；
//   ② 实际被补上的格子（fills）特征分最低是多少（= 阈值的安全下限）。
// 若 ① 远小于 225、② 显著高于候选阈值，就可以只扫这些格，行为不变而手机大幅提速。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-scan-restrict-probe.mjs
import { chromium } from "playwright";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const dirs = [
  { dir: "qa/fixtures/materials/renjuportal", limit: 3 },
  { dir: "qa/fixtures/recognition", limit: 99, only: ["remote-image2.png", "paper10.jpg", "paper02.jpg", "user-98-36.jpg", "user-99-43.jpg"] },
  { dir: "qa/fixtures/materials", limit: 99, only: ["user-cno2010-15.jpg", "mm-wood-zhizi.jpg", "blur-num71.jpg", "remote-image2.png"] },
];
const items = [];
for (const entry of dirs) {
  const files = entry.only
    ? entry.only.map((name) => `${entry.dir}/${name}`)
    : globSync("*.truth.json", { cwd: entry.dir }).sort().slice(0, entry.limit).map((f) => `${entry.dir}/${f.replace(/\.truth\.json$/, "")}.png`);
  for (const file of files) {
    try { readFileSync(resolve(file)).length; items.push(file); } catch { /* 跳过不存在的 */ }
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-scan-restrict-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-scan-restrict-host.html", base).toString(), { waitUntil: "domcontentloaded" });

console.log("图 | 已识别子 | 225 格中: ≥0.10 / ≥0.15 / ≥0.20 且非子 | 实补格数 | 补位格最低特征分");
for (const file of items) {
  const dataUrl = `data:${/\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(file)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null);
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: blob.type });
    // A：带扫描器（会补位）；B：不带扫描器（不补位）——两者差集就是「实补格」
    const withScan = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
    const without = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false });
    // 画布与网格（与识别器同一套缩放规则）
    const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
    const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    const grid = withScan.grid;
    if (!grid) return { error: "无网格" };
    const score = (() => {
      const table = [];
      for (let row = 0; row < 15; row += 1) {
        table.push([]);
        for (let col = 0; col < 15; col += 1) {
          const x = grid.originX + col * grid.spacingX;
          const y = grid.originY + row * grid.spacingY;
          table[row].push(mod.analyzeIntersection(sampled, x, y, (grid.spacingX + grid.spacingY) / 2).score);
        }
      }
      return table;
    })();
    // 已识别子（用不补位的那份，避免把补出来的子当「本来就识别到」）
    const detected = new Set();
    let stones = 0;
    without.board.forEach((line, row) => line.forEach((cell, col) => { if (cell) { detected.add(`${row},${col}`); stones += 1; } }));
    const fills = [];
    withScan.board.forEach((line, row) => line.forEach((cell, col) => {
      if (cell && !detected.has(`${row},${col}`)) fills.push({ row, col, score: score[row][col] });
    }));
    const counts = { c10: 0, c15: 0, c20: 0 };
    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        if (detected.has(`${row},${col}`)) continue;
        const s = score[row][col];
        if (s >= 0.10) counts.c10 += 1;
        if (s >= 0.15) counts.c15 += 1;
        if (s >= 0.20) counts.c20 += 1;
      }
    }
    return { stones, counts, fills: fills.length, minFillScore: fills.length ? Math.min(...fills.map((f) => f.score)) : null, maxUnfilledHint: null };
  }, { dataUrl, name: file.split("/").pop() });
  if (out.error) { console.log(`${file.split("/").pop()} | ${out.error}`); continue; }
  const label = file.split("/").slice(-2).join("/");
  console.log(`${label} | ${out.stones} | ${out.counts.c10} / ${out.counts.c15} / ${out.counts.c20} | ${out.fills} | ${out.minFillScore === null ? "-" : out.minFillScore.toFixed(3)}`);
}
await browser.close();
