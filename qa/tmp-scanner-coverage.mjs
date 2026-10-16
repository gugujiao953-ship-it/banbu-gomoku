// 一次性诊断：扫描器在「点名全部真值格」时的读数覆盖与正确率。
// 目的：把「复原失败」拆成三层——① 扫描器没读这格 ② 读了但弱（digitProb<0.5）
// ③ 读错 —— 从而判断瓶颈在覆盖、在置信门、还是在模型本身。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ SAMPLE=2 node qa/tmp-scanner-coverage.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const SAMPLE = Number(process.env.SAMPLE || 2);
const dir = resolve("qa/fixtures/materials/self-hi-ply");
const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
const picked = index.filter((item) => item.width === 1200).slice(0, SAMPLE);
const payloads = picked.map((item) => ({
  file: item.file,
  dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(dir, item.file)).toString("base64")}`,
  truth: JSON.parse(readFileSync(resolve(dir, item.file.replace(/\.jpg$/, ".truth.json")), "utf8")),
}));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-scan-cov-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-scan-cov-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
  });
  const rows = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    // 先跑一次真实识别，拿到「检测出的网格」——这就是生产路径给扫描器的几何。
    const recognized = await mod.recognizeBoardImage(new File([blob], item.file, { type: "image/jpeg" }), 15, {
      skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined,
    });
    const bitmap = await createImageBitmap(await (await fetch(item.dataUrl)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const image = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    // 真值几何（与 gen-self-boards 的 share SVG 同源，1200 宽 scale=1）
    const scale = bitmap.width / 1200;
    const originX = (70 + 64) * scale;
    const gap = (((70 + 1060 - 64) - (70 + 64)) / 14) * scale;
    const originY = (190 + 64) * scale;
    const truthGrid = { originX, originY, spacingX: gap, spacingY: gap, quality: 1 };
    const detected = recognized.grid
      ? { originX: recognized.grid.originX, originY: recognized.grid.originY, spacingX: recognized.grid.spacingX, spacingY: recognized.grid.spacingY, quality: recognized.grid.quality ?? 1 }
      : null;
    const results = [];
    for (const [label, grid] of [["真值几何", truthGrid], ["检测几何", detected]]) {
      if (!grid) { results.push({ label, skipped: true }); continue; }
      const evidence = await scanner({
        image, grid, boardSize: 15, needDigits: true,
        digitCenters: item.truth.stones.map((s) => ({ row: s.row, col: s.col })),
        digitSpacing: Math.round(Math.min(grid.spacingX, grid.spacingY)), digitMaxNumber: item.truth.stones.length,
      });
      const byKey = new Map((evidence ?? []).map((cell) => [`${cell.row},${cell.col}`, cell]));
      const stat = { noCell: 0, noRead: 0, weak: 0, ok: 0, wrong: 0, weakOk: 0 };
      const wrongList = [];
      for (const stone of item.truth.stones) {
        const cell = byKey.get(`${stone.row},${stone.col}`);
        if (!cell) { stat.noCell += 1; continue; }
        if (!cell.digitTop || !cell.digitTop.length || cell.digit <= 0) { stat.noRead += 1; continue; }
        if (cell.digitProb < 0.5) { stat.weak += 1; if (cell.digit === stone.number) stat.weakOk += 1; continue; }
        if (cell.digit === stone.number) stat.ok += 1;
        else { stat.wrong += 1; if (wrongList.length < 8) wrongList.push(`${String.fromCharCode(65 + stone.col)}${15 - stone.row}: 真${stone.number}→读${cell.digit}(${Math.round(cell.digitProb * 100)}%)`); }
      }
      results.push({ label, skipped: false, stat, wrongList });
    }
    rows.push({
      file: item.file, stones: item.truth.stones.length, gap: Math.round(gap * 10) / 10,
      truthOrigin: `(${Math.round(originX)},${Math.round(originY)})`,
      detectedOrigin: detected ? `(${Math.round(detected.originX)},${Math.round(detected.originY)})` : "无",
      detectedSpacing: detected ? `${Math.round(detected.spacingX * 10) / 10}x${Math.round(detected.spacingY * 10) / 10}` : "无",
      results,
    });
  }
  return rows;
}, { items: payloads });

for (const row of out) {
  console.log(`${row.file}（${row.stones} 手，真值格距 ${row.gap}）`);
  console.log(`  真值原点 ${row.truthOrigin} | 检测原点 ${row.detectedOrigin} 检测格距 ${row.detectedSpacing}`);
  for (const result of row.results) {
    if (result.skipped) { console.log(`  [${result.label}] 识别器没给出网格`); continue; }
    const s = result.stat;
    console.log(`  [${result.label}] 强读正确 ${s.ok} | 强读错误 ${s.wrong} | 弱读(<0.5) ${s.weak}（其中对 ${s.weakOk}）| 有格无读数 ${s.noRead} | 无格 ${s.noCell}`);
    if (result.wrongList.length) console.log(`      错误样例：${result.wrongList.join("  ")}`);
  }
  console.log("");
}
await browser.close();
