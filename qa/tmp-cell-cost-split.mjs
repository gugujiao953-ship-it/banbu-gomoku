// 每格开销拆分探针（2026-10-08）：导入路径里模型扫描约 1.3 秒，其中 225 格 cell-cls 是大头。
// 问题是「这钱花在 ONNX 推理本身，还是花在 cropCell 的逐格 canvas 裁剪+缩放」——两者的
// 优化方向完全不同（前者要批量推理、后者要改裁格路径），所以先量再改。
//
// 做法：① 用常数张量直接调 session.run 64 次 → 纯推理开销；
//       ② classifyCells 跑 64 格 → 裁剪 + 推理总开销；两者相减即裁剪与张量构造。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-cell-cost-split.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", mime: "image/png" };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-cell-cost-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cell-cost-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;

const out = await page.evaluate(async ({ dataUrl }) => {
  const mod = await import("/src/image-recognition.ts");
  const inference = await import("/src/features/record/model-inference.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const first = await mod.recognizeBoardImage(new File([blob], "x.png", { type: "image/png" }), 15, { skipMoveOrder: true, parallel: false });
  const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const grid = first.grid;
  const half = Math.round((grid.spacingX + grid.spacingY) / 2);
  // 覆盖整盘的 225 个交点（与扫描器同一批格）
  const queries = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      queries.push({ x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY, row, col });
    }
  }
  const sessions = await inference.ensureModelSessions({});
  if (!sessions) return { error: "模型不可用" };
  const inputName = sessions.cell.inputNames[0];
  const outputName = sessions.cell.outputNames[0];
  const fake = new Float32Array(3 * 64 * 64);
  // 预热（首次含算子编译）
  await sessions.cell.run({ [inputName]: new sessions.ort.Tensor("float32", fake, [1, 3, 64, 64]) });
  const tPure = performance.now();
  for (let i = 0; i < queries.length; i += 1) {
    await sessions.cell.run({ [inputName]: new sessions.ort.Tensor("float32", fake, [1, 3, 64, 64]) });
  }
  const pureMs = performance.now() - tPure;
  const tFull = performance.now();
  const classes = await inference.classifyCells(sampled, queries, half, {});
  const fullMs = performance.now() - tFull;
  return { cells: queries.length, half, pureMs: Math.round(pureMs), fullMs: Math.round(fullMs), ok: classes?.length ?? 0 };
}, { dataUrl });

if (out.error) { console.log(out.error); } else {
  const crop = out.fullMs - out.pureMs;
  console.log(`格子数 ${out.cells}（半窗 ${out.half}px）`);
  console.log(`  纯 ONNX 推理：${out.pureMs}ms（${(out.pureMs / out.cells).toFixed(2)}ms/格）`);
  console.log(`  classifyCells 全流程：${out.fullMs}ms（${(out.fullMs / out.cells).toFixed(2)}ms/格）`);
  console.log(`  → 裁剪+张量构造：${crop}ms（${(crop / out.cells).toFixed(2)}ms/格，占 ${Math.round(crop / out.fullMs * 100)}%）`);
}
await browser.close();
