// 生产构建下 ORT 线程验证：用应用内三件套创建会话，读实际 numThreads 并计时 60 次推理。
import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:4180/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 160)));
await page.goto(base, { waitUntil: "domcontentloaded" });
const result = await page.evaluate(async () => {
  const mod = await import("./ort/ort.wasm.bundle.min.mjs");
  const ort = mod.default ?? mod;
  ort.env.wasm.wasmPaths = new URL("./ort/", location.href).href;
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
  const response = await fetch("./models/cell-cls-real-mix.onnx");
  const session = await ort.InferenceSession.create(await response.arrayBuffer(), { executionProviders: ["wasm"] });
  const data = new Float32Array(3 * 64 * 64);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  for (let i = 0; i < 3; i += 1) await session.run({ cell: new ort.Tensor("float32", data, [1, 3, 64, 64]) });
  const N = 60;
  const t0 = performance.now();
  for (let i = 0; i < N; i += 1) await session.run({ cell: new ort.Tensor("float32", data, [1, 3, 64, 64]) });
  const perCell = (performance.now() - t0) / N;
  return { crossOriginIsolated: globalThis.crossOriginIsolated === true, numThreads: ort.env.wasm.numThreads, hardwareConcurrency: navigator.hardwareConcurrency, perCellMs: Number(perCell.toFixed(2)), scan225s: Number((perCell * 225 / 1000).toFixed(2)) };
});
console.log(JSON.stringify(result));
await browser.close();
