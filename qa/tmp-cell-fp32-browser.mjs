// fp16 vs fp32 的 cell-cls 在 ORT-Web 里的耗时对比（2026-10-08）。
// 结论依据：fp16 在 Python 原生 ORT 是 1.1ms/格、在 ORT-Web wasm 是 13.0ms/格（差 12 倍），
// 而批量在 ORT-Web 里零收益——怀疑 wasm 后端对 fp16 只能软件模拟。这里直接比两份模型
// （权重数值相同、只差精度）在同一批 225 格上的耗时与 argmax 一致性。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-cell-fp32-browser.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const fp16B64 = readFileSync(resolve("public/models/cell-cls-real-mix.onnx")).toString("base64");
const fp32B64 = readFileSync(resolve("public/models/cell-cls-real-mix-fp32.onnx")).toString("base64");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-cell-fp32-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-cell-fp32-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ fp16B64, fp32B64 }) => {
  const inference = await import("/src/features/record/model-inference.ts");
  const sessions = await inference.ensureModelSessions({});
  if (!sessions) return { error: "模型不可用" };
  const { ort } = sessions;
  const toBytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const N = 225;
  let seed = 123456789;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const data = new Float32Array(N * 3 * 64 * 64);
  for (let i = 0; i < data.length; i += 1) data[i] = rng() * 2 - 1;
  const cell = (i) => data.subarray(i * 3 * 64 * 64, (i + 1) * 3 * 64 * 64);

  const measure = async (b64) => {
    const session = await ort.InferenceSession.create(toBytes(b64).buffer, { executionProviders: ["wasm"] });
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    await session.run({ [inputName]: new ort.Tensor("float32", cell(0), [1, 3, 64, 64]) }); // 预热
    const started = performance.now();
    const outs = [];
    for (let i = 0; i < N; i += 1) {
      const res = await session.run({ [inputName]: new ort.Tensor("float32", cell(i), [1, 3, 64, 64]) });
      outs.push(Array.from(res[outputName].data));
    }
    return { ms: performance.now() - started, outs };
  };

  const a = await measure(fp16B64);
  const b = await measure(fp32B64);
  let agree = 0;
  for (let i = 0; i < N; i += 1) {
    const pick = (v) => (v[0] >= v[1] && v[0] >= v[2] ? 0 : v[1] >= v[2] ? 1 : 2);
    if (pick(a.outs[i]) === pick(b.outs[i])) agree += 1;
  }
  return { N, fp16Ms: Math.round(a.ms), fp32Ms: Math.round(b.ms), agree: Math.round(agree / N * 1000) / 10 };
}, { fp16B64, fp32B64 });

if (out.error) { console.log(out.error); } else {
  console.log(`${out.N} 格（ORT-Web wasm，逐格）：`);
  console.log(`  fp16 现役模型：${out.fp16Ms}ms（${(out.fp16Ms / out.N).toFixed(2)}ms/格）`);
  console.log(`  fp32 候选模型：${out.fp32Ms}ms（${(out.fp32Ms / out.N).toFixed(2)}ms/格）`);
  console.log(`  → ${(out.fp16Ms / out.fp32Ms).toFixed(1)}× 快，类别 argmax 一致 ${out.agree}%`);
}
await browser.close();
