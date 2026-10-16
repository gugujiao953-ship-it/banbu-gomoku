// 宽度档推理成本台（2026-10-07）：同一套格级扫描几何（225 格、真图裁格）下，
// 量数字头在不同宽度档的 ms/格——回答「换成更大的完整版」在手机端要付多少时间。
// 权重是随机的（scnet/export-width-probe.py 导出），推理时间与权重无关。
// 注意：model-inference 的会话缓存按线程只装一次，所以**每个模型开独立页面**测。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-width-speed.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const models = [
  { name: "1.0×（现役宽度）", url: "/qa/fixtures/models/digit-head-w1.0.onnx" },
  { name: "1.5×", url: "/qa/fixtures/models/digit-head-w1.5.onnx" },
  { name: "2.0×", url: "/qa/fixtures/models/digit-head-w2.0.onnx" },
  { name: "现役 iter8（fp16，对照）", url: "/qa/fixtures/models/digit-head-iter8-fp16.onnx" },
];
const b64 = readFileSync(resolve("qa/fixtures/materials/remote-image2.png")).toString("base64");
const browser = await chromium.launch({ headless: true });

const measure = async (model) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
  await page.route("**/qa-widthspeed2-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  }));
  await page.goto(new URL("qa-widthspeed2-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ b64, url }) => {
    const mod = await import("/src/image-recognition.ts");
    const inf = await import("/src/features/record/model-inference.ts");
    const options = { digitModelUrl: new URL(url, location.href).href, threads: 1, wasmPaths: "/node_modules/onnxruntime-web/dist/" };
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const right = await mod.recognizeBoardImage(new File([blob], "r.png", { type: "image/png" }), 15, { skipMoveOrder: true, parallel: false });
    const grid = right.grid;
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    const data = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const sampled = { data: data.data, width: cvs.width, height: cvs.height, gray: mod.buildGray(data.data, cvs.width * cvs.height) };
    const half = Math.max(6, Math.round((grid.spacingX + grid.spacingY) / 2));
    const queries = [];
    for (let row = 0; row < 15; row += 1) for (let col = 0; col < 15; col += 1) {
      queries.push({ x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY });
    }
    // 预热（含模型加载）→ 单格 48 次 → 整盘 225 格（批 16）
    const warm = await inf.readDigitCandidates(sampled, queries.slice(0, 8), half, options);
    if (!warm) return { error: "加载失败" };
    const t0 = performance.now();
    await inf.readDigitCandidates(sampled, queries.slice(0, 48), half, options);
    const singleMs = performance.now() - t0;
    const t1 = performance.now();
    await inf.readDigitCandidates(sampled, queries, half, options);
    const allMs = performance.now() - t1;
    const size = (await (await fetch(options.digitModelUrl)).arrayBuffer()).byteLength / 1024 / 1024;
    return { size, perCell: singleMs / 48, all: allMs };
  }, { b64, url: model.url });
  await context.close();
  return result;
};

for (const model of models) {
  const result = await measure(model);
  if (result.error) { console.log(`${model.name}：${result.error}`); continue; }
  console.log(`${model.name}：${result.size.toFixed(2)}MB ｜ 单格 ${result.perCell.toFixed(1)}ms ｜ 225 格 ${Math.round(result.all)}ms（批 16、单线程 wasm）`);
}
await browser.close();
