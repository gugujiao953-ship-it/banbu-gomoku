// 诊断：cell-cls 逐格推理 24ms/格 里，有多少是「算」、多少是「每次调用的固定开销」（2026-10-14）。
//
// 背景（diag-restore-profile）：智子密盘导入 11.2s，其中 boardScan 5.4s / 225 格 = 24ms 一格。
// 模型只有 999KB（fp32，输入固定 [1,3,64,64]）——若大头是「每次 run 新建 Tensor + 分配 + 拷贝」，
// 就有无损的省法（复用同一个 Tensor、只改数据）；若大头是真算力，就只能靠多核条数。
// 本探针直接拿 app 自带的 ORT 运行时跑同一份模型，比较三种调用形态。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-cell-infer-cost.mjs
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const ROUNDS = Number(process.env.ROUNDS || 300);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-cell-cost.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cell-cost.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async (rounds) => {
  const ortModule = await import("/ort/ort.wasm.bundle.min.mjs");
  const ort = ortModule.default ?? ortModule;
  ort.env.wasm.wasmPaths = new URL("/ort/", location.href).href;
  ort.env.wasm.numThreads = 1;
  const bytes = new Uint8Array(await (await fetch(new URL("/models/cell-cls-real-mix.onnx", location.href).href)).arrayBuffer());
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const chw = new Float32Array(3 * 64 * 64);
  for (let i = 0; i < chw.length; i += 1) chw[i] = ((i * 37) % 255) / 127.5 - 1;
  const timed = async (label, run) => {
    // 预热 5 次（让 ORT 完成首次 kernel 绑定），再计时
    for (let i = 0; i < 5; i += 1) await run();
    const t0 = performance.now();
    for (let i = 0; i < rounds; i += 1) await run();
    const ms = performance.now() - t0;
    return { label, perCall: ms / rounds, total: Math.round(ms) };
  };
  const shared = new ort.Tensor("float32", chw, [1, 3, 64, 64]);
  const rows = [];
  rows.push(await timed("① 每次新建 Tensor（现状写法）", () => session.run({ [inputName]: new ort.Tensor("float32", Float32Array.from(chw), [1, 3, 64, 64]) })));
  rows.push(await timed("② 复用同一个 Tensor（只改 data）", () => session.run({ [inputName]: shared })));
  const spot = await session.run({ [inputName]: shared });
  return { cores: navigator.hardwareConcurrency, output: outputName, sample: Array.from((spot[outputName].data).slice(0, 3)).map((v) => Number(v.toFixed(4))), rows };
}, ROUNDS);

console.log(`cell-cls 单格推理成本（cores=${out.cores}，输出 ${out.output} 样例 ${out.sample.join(", ")}）`);
for (const row of out.rows) console.log(`  ${row.label}: ${row.perCall.toFixed(2)}ms/次（${row.total}ms / ${ROUNDS} 次）`);
await browser.close();
