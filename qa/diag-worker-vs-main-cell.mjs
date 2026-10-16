// 诊断：同一个 cell-cls 模型，「主线程直算」vs「worker 里算」每格各要多久（2026-10-14）。
//
// 起因（diag-worker-plumbing）：5 个 worker 并发跑 40 格，每格 ≈112ms；而主线程微基准
// （diag-cell-infer-cost）只有 ≈26ms/格。若属实，说明「多核加速」在这条链路上被
// 每线程的性能损失吃掉了（4 线程 × 每线程慢 4 倍 = 白忙），这正是导入/复原一直卡在
// 同一个量级的根源。这里把三种形态放在同一台机器、同一次会话里对比：
//   ① 主线程 session.run（基准，无并发）
//   ② 池 = 1 个 worker（看 worker 环境本身快不快）
//   ③ 池 = N 个 worker 并发（看并发争抢的代价）
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-worker-vs-main-cell.mjs
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const CELLS = Number(process.env.CELLS || 40);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const logs = [];
page.on("console", (message) => { if (message.text().includes("banbu-worker-timing")) logs.push(message.text()); });
await page.route("**/qa-cell-ab.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cell-ab.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async (cells) => {
  const mod = await import("/src/image-recognition.ts");
  const accelMod = await import("/src/features/recognition/recognition-accelerator.ts");
  const ortModule = await import("/ort/ort.wasm.bundle.min.mjs");
  const ort = ortModule.default ?? ortModule;
  ort.env.wasm.wasmPaths = new URL("/ort/", location.href).href;
  ort.env.wasm.numThreads = 1;
  const bytes = new Uint8Array(await (await fetch(new URL("/models/cell-cls-real-mix.onnx", location.href).href)).arrayBuffer());
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  const inputName = session.inputNames[0];

  // ① 主线程基准
  const chw = new Float32Array(3 * 64 * 64);
  for (let i = 0; i < chw.length; i += 1) chw[i] = ((i * 37) % 255) / 127.5 - 1;
  const tensor = new ort.Tensor("float32", chw, [1, 3, 64, 64]);
  for (let i = 0; i < 5; i += 1) await session.run({ [inputName]: tensor });
  const t0 = performance.now();
  for (let i = 0; i < cells; i += 1) await session.run({ [inputName]: tensor });
  const mainPerCell = (performance.now() - t0) / cells;

  // 造两张画布：大画布 → 计划 1 线程；小画布 → 计划 N 线程
  const blank = (w, h) => { const data = new Uint8ClampedArray(w * h * 4).fill(255); for (let i = 3; i < data.length; i += 4) data[i] = 255; return { data, width: w, height: h }; };
  const queries = [];
  for (let i = 0; i < cells; i += 1) queries.push({ x: 200 + (i % 10) * 60, y: 200 + Math.floor(i / 10) * 60 });
  const run = async (label, image) => {
    const pool = await accelMod.createParallelAccelerator(image, { modelSessions: true });
    if (!pool) return { label, error: "池没建起来" };
    const spawnedBefore = globalThis.__banbuPoolStats?.spawned ?? 0;
    const t = performance.now();
    await pool.scanCells(queries, 32);
    const ms = performance.now() - t;
    const spawned = (globalThis.__banbuPoolStats?.spawned ?? 0) - spawnedBefore;
    pool.dispose();
    return { label, workers: spawned, totalMs: Math.round(ms), perCell: +(ms / cells).toFixed(1) };
  };
  const one = await run("池 = 1 worker", blank(4200, 4200));   // 每线程 140MB 预算 → 只开 1 个
  await new Promise((done) => setTimeout(done, 1500));
  const many = await run("池 = N workers", blank(640, 640));   // 每线程 28MB → 开满（上限 6）
  // 同一画布上主线程直算同样 40 格（用 localAccelerator）做等价对照
  const plain = blank(640, 640);
  const local = mod.localAccelerator(mod.createSampledImage ? mod.createSampledImage(plain.data, plain.width, plain.height) : plain);
  const tLocal = performance.now();
  await local.scanCells(queries, 32, {});
  const localMs = performance.now() - tLocal;
  return { mainPerCell: +mainPerCell.toFixed(1), one, many, localSameCanvas: { totalMs: Math.round(localMs), perCell: +(localMs / cells).toFixed(1) }, cores: navigator.hardwareConcurrency };
}, CELLS);

console.log(`cores=${out.cores}  主线程纯 session.run：${out.mainPerCell}ms/格`);
console.log(" ", JSON.stringify(out.one));
console.log(" ", JSON.stringify(out.many));
console.log("  主线程 localAccelerator.scanCells（含裁剪）：", JSON.stringify(out.localSameCanvas));
console.log("worker 侧自报：");
for (const line of logs.slice(0, 14)) console.log("  ", line);
await browser.close();
