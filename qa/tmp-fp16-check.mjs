// fp32 vs fp16 对比（dev 服务器）：同一批输入下 argmax 一致率 + 单格耗时。
import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 160)));
await page.goto(base, { waitUntil: "domcontentloaded" });
const out = await page.evaluate(async () => {
  const mod = await import("./ort/ort.wasm.bundle.min.mjs");
  const ort = mod.default ?? mod;
  ort.env.wasm.wasmPaths = new URL("./ort/", location.href).href;
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
  const load = async (url) => ort.InferenceSession.create(await (await fetch(url)).arrayBuffer(), { executionProviders: ["wasm"] });
  const models = [
    { tag: "fp32", session: await load("/qa/fixtures/models/digit-head-iter8.onnx") },
    { tag: "fp16", session: await load("/qa/fixtures/models/digit-head-iter8-fp16.onnx") },
  ];
  const inputs = [];
  for (let i = 0; i < 40; i += 1) {
    const data = new Float32Array(3 * 64 * 64);
    for (let k = 0; k < data.length; k += 1) data[k] = Math.random() * 2 - 1;
    inputs.push(data);
  }
  const results = {};
  for (const { tag, session } of models) {
    for (let i = 0; i < 3; i += 1) await session.run({ cell: new ort.Tensor("float32", inputs[0], [1, 3, 64, 64]) });
    const t0 = performance.now();
    const argmax = [];
    for (const data of inputs) {
      const r = await session.run({ cell: new ort.Tensor("float32", data, [1, 3, 64, 64]) });
      const logits = r[session.outputNames[0]].data;
      let best = 0;
      for (let k = 1; k < logits.length; k += 1) if (logits[k] > logits[best]) best = k;
      argmax.push(best);
    }
    results[tag] = { msPerCell: Number(((performance.now() - t0) / inputs.length).toFixed(2)), argmax };
  }
  const agree = results.fp32.argmax.filter((v, i) => v === results.fp16.argmax[i]).length;
  return { fp32Ms: results.fp32.msPerCell, fp16Ms: results.fp16.msPerCell, agree: `${agree}/${inputs.length}` };
});
console.log(JSON.stringify(out));
await browser.close();
