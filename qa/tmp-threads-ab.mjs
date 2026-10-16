// 跨源隔离的收益量化（2026-10-09）：同一台机器、同一份模型，numThreads=1 vs N。
//
// 这是回答用户那句「为啥电脑识谱快」的决定性测量：
//   · 电脑（网页版）有 COOP/COEP → crossOriginIsolated=true → ORT numThreads>1；
//   · 手机 WebView 没有隔离头 → numThreads=1。
// 本探针在**同一台机器**上直接改 numThreads 跑同一批 225 格，把「隔离」的收益
// 从 CPU 差异里剥离出来（之前的降频实验混了「CPU 慢」与「线程少」两个变量）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-threads-ab.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const item = "qa/fixtures/materials/user-cno2010-15.jpg";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-threads-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-threads-host.html", base).toString(), { waitUntil: "domcontentloaded" });
const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve(item)).toString("base64")}`;

const out = await page.evaluate(async ({ dataUrl, name, threadOptions }) => {
  const mod = await import("/src/image-recognition.ts");
  const inference = await import("/src/features/record/model-inference.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const first = await mod.recognizeBoardImage(new File([blob], name, { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: false });
  const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const grid = first.grid;
  const half = Math.round((grid.spacingX + grid.spacingY) / 2);
  const queries = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) queries.push({ x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY, row, col });
  }
  const results = [];
  for (const threads of threadOptions) {
    // 每个线程数用**独立的会话**（sessionsCache 按 wasmPaths|threads 分词，所以能共存）。
    const probeScanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, threads });
    if (!probeScanner) { results.push({ threads, error: "扫描器不可用" }); continue; }
    // 预热一次（含该线程数下的算子编译）
    await probeScanner({ image: sampled, grid, boardSize: 15, needDigits: false, scanTargets: [{ row: 0, col: 0 }] });
    // 用 scanTargets=null 强制全盘（这才是手机上的真实工作量）
    const started = performance.now();
    await probeScanner({ image: sampled, grid, boardSize: 15, needDigits: false, scanTargets: null });
    results.push({ threads, ms: Math.round(performance.now() - started) });
  }
  return { isolated: globalThis.crossOriginIsolated === true, cores: navigator.hardwareConcurrency, results, cells: queries.length };
}, { dataUrl, name: item.split("/").pop(), threadOptions: [1, 2, 4, 8] });

console.log(`crossOriginIsolated=${out.isolated} cores=${out.cores}，225 格 cell-cls：`);
for (const row of out.results) {
  if (row.error) { console.log(`  numThreads=${row.threads}: ${row.error}`); continue; }
  console.log(`  numThreads=${String(row.threads).padStart(2)} → ${String(row.ms).padStart(5)}ms（${(row.ms / 225).toFixed(1)}ms/格）`);
}
const single = out.results.find((r) => r.threads === 1);
const best = out.results.filter((r) => r.ms).reduce((a, b) => (a.ms < b.ms ? a : b), { ms: Infinity });
if (single?.ms && best.ms < Infinity) console.log(`→ 最优线程数 ${best.threads} 比单线程快 ${(single.ms / best.ms).toFixed(1)}×`);
await browser.close();
