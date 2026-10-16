// cell-cls 批量在**浏览器**里到底能不能摊薄开销（2026-10-08）。
//
// 背景：导入路径里 cell-cls 逐格 225 次，浏览器实测 13ms/格（共 2.9s），而同样这份模型在
// Python 原生 ORT 里只要 1.1ms/格（共 246ms）——差 12 倍，说明浏览器侧的成本主要是
// **每次 session.run 的 JS↔wasm 边界开销**，不是算力。批量能不能摊薄它，Python 量不出来
// （它那边每次调用本来就便宜），必须在 ORT-Web 里量。
//
// 做法：把「输入/输出批维改成符号维的同一份权重」当 data URL 喂给 ORT-Web，逐格跑 225 次
// 与批 8/16/32 跑同一批数据对比耗时，并逐位比对输出（argmax 必须全一致）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-cell-batch-browser.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const originalB64 = readFileSync(resolve("public/models/cell-cls-real-mix.onnx")).toString("base64");
const dynamicB64 = readFileSync(resolve("qa/recover/cell-cls-batchable.onnx")).toString("base64");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-cell-batch-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cell-batch-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ originalB64, dynamicB64 }) => {
  const inference = await import("/src/features/record/model-inference.ts");
  const sessions = await inference.ensureModelSessions({});
  if (!sessions) return { error: "模型不可用" };
  const { ort } = sessions;
  const toBytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const N = 225;
  const rng = (() => { let seed = 123456789; return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const data = new Float32Array(N * 3 * 64 * 64);
  for (let i = 0; i < data.length; i += 1) data[i] = rng() * 2 - 1;

  const single = await ort.InferenceSession.create(toBytes(originalB64).buffer, { executionProviders: ["wasm"] });
  const dynamic = await ort.InferenceSession.create(toBytes(dynamicB64).buffer, { executionProviders: ["wasm"] });
  const singleIn = single.inputNames[0], singleOut = single.outputNames[0];
  const dynIn = dynamic.inputNames[0], dynOut = dynamic.outputNames[0];

  const slice = (start, count) => data.subarray(start * 3 * 64 * 64, (start + count) * 3 * 64 * 64);
  // 预热
  await single.run({ [singleIn]: new ort.Tensor("float32", slice(0, 1), [1, 3, 64, 64]) });
  await dynamic.run({ [dynIn]: new ort.Tensor("float32", slice(0, 16), [16, 3, 64, 64]) });

  const t0 = performance.now();
  const singleOuts = [];
  for (let i = 0; i < N; i += 1) {
    const res = await single.run({ [singleIn]: new ort.Tensor("float32", slice(i, 1), [1, 3, 64, 64]) });
    singleOuts.push(res[singleOut].data);
  }
  const singleMs = performance.now() - t0;

  const results = [];
  for (const batch of [8, 16, 32]) {
    const t1 = performance.now();
    const batchedOuts = [];
    for (let start = 0; start < N; start += batch) {
      const count = Math.min(batch, N - start);
      const res = await dynamic.run({ [dynIn]: new ort.Tensor("float32", slice(start, count), [count, 3, 64, 64]) });
      const flat = res[dynOut].data;
      for (let c = 0; c < count; c += 1) batchedOuts.push(flat.slice(c * 3, c * 3 + 3));
    }
    const ms = performance.now() - t1;
    // argmax 与逐格逐位比对
    let agree = 0;
    for (let i = 0; i < N; i += 1) {
      const a = singleOuts[i], b = batchedOuts[i];
      let ai = 0, bi = 0;
      for (let k = 1; k < 3; k += 1) { if (a[k] > a[ai]) ai = k; if (b[k] > b[bi]) bi = k; }
      if (ai === bi) agree += 1;
    }
    results.push({ batch, ms: Math.round(ms), agree: Math.round(agree / N * 1000) / 10 });
  }
  return { N, singleMs: Math.round(singleMs), results };
}, { originalB64, dynamicB64 });

if (out.error) { console.log(out.error); } else {
  console.log(`${out.N} 格：逐格 ${out.singleMs}ms（${(out.singleMs / out.N).toFixed(2)}ms/格）`);
  for (const row of out.results) {
    console.log(`  批 ${String(row.batch).padStart(2)}：${row.ms}ms（${(row.ms / out.N).toFixed(2)}ms/格）→ ${(out.singleMs / row.ms).toFixed(1)}× 快，argmax 一致 ${row.agree}%`);
  }
}
await browser.close();
