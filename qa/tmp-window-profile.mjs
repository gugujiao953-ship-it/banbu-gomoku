// scoreGridWindow 内部分段（2026-10-09）：线剖面段 vs 后续段（mesh/边框/星位/颜色）。
//
// 目标：用户要「10 秒内、最好 5 秒」，而导入的网格检测 7.5 秒是大头。
// 已知 1824 窗里有 1296 来自全局配对。本探针直接量：
//   ① 全部 1824 窗的线剖面段总耗时（早退的部分只算这一段）
//   ② 通过早退门、继续算 mesh/边框/星位的窗口数与它们那一段的耗时
// 若 ② 的窗口很少，说明瓶颈就是**线剖面**本身，要提速就得让线剖面更省。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-window-profile.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = "qa/fixtures/materials/renjuportal/rp-score-10.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 150)));
await page.route("**/qa-wp-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-wp-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const dataUrl = `data:image/png;base64,${readFileSync(resolve(item)).toString("base64")}`;

const out = await page.evaluate(async ({ dataUrl }) => {
  const mod = await import("/src/image-recognition.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], "x.png", { type: "image/png" });
  const first = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
  const grid = first.grid;
  // 直接对**选中网格附近**的窗口做微基准：单窗耗时 = 线剖面 + 后续
  const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  // 真值窗（会走完全部判定）与错位窗（多半早退）各跑 200 次，量单窗耗时
  const good = { originX: grid.originX, originY: grid.originY, spacingX: grid.spacingX, spacingY: grid.spacingY, boardSize: 15 };
  const off = { ...good, originX: grid.originX + 40, originY: grid.originY + 40 };
  const bench = (q, rounds) => {
    const t0 = performance.now();
    for (let i = 0; i < rounds; i += 1) mod.scoreGridWindow(sampled, q.originX, q.originY, q.spacingX, q.spacingY, q.boardSize);
    return (performance.now() - t0) / rounds;
  };
  bench(good, 5); // 预热
  const goodMs = bench(good, 200);
  const offMs = bench(off, 200);
  const perf = mod.moveOrderPerf;
  return {
    goodMs: Math.round(goodMs * 100) / 100,
    offMs: Math.round(offMs * 100) / 100,
    totalWindows: perf.gridWindows,
    early: perf.wEarly,
    gridMs: Math.round(perf.gridMs),
    batchWindows: perf.gridBatchWindows,
  };
}, { dataUrl });

console.log(`真值窗单窗：${out.goodMs}ms（走完全部判定）`);
console.log(`错位窗单窗：${out.offMs}ms（多半早退）`);
console.log(`本次识别：${out.totalWindows} 窗（早退 ${out.early}）、网格 ${out.gridMs}ms`);
console.log(`推算：若全部走完 ≈ ${Math.round(out.totalWindows * out.goodMs)}ms；若全部早退 ≈ ${Math.round(out.totalWindows * out.offMs)}ms`);
await browser.close();
