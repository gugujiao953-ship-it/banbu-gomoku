// 数字头模型「量化(fp16) vs 原始(fp32)」的判定（2026-10-09）。
//
// 背景：用户原话「这个是我们之前训的，但是考虑到大小，我们就量化了」。
// 仓库里现役的是 digit-head-iter8（1.394M 参数 / 2.79MB，权重 fp16 + 两端 Cast），
// 候选是 iter17–21（1.395M 参数 / 5.58MB，权重 fp32）。两者**参数量几乎相同**，
// 差别就是 fp16 量化。这次要回答的是：为省这 2.8MB，付出了什么。
//
// 关键点：**wasm 上 fp16 未必更快**。ORT-web 的 CPU/wasm 后端对 fp16 的支持是
// 「软件模拟」——常见实现是把 fp16 升到 fp32 算完再降回去（或插入 Cast）。
// 如果实测确认 fp16 在 wasm 上不省时甚至更慢，那这次量化的收益就只剩「体积小一半」，
// 代价却要重新称量。
//
// 本探针用**纯模型推理**（不经识别管线、不做模板比对）逐格计时，
// 把「模型本身的代价」与「识别逻辑的耗时」彻底分开。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/digit-fp16-cost.mjs
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");

const models = [
  { key: "iter8·fp16·现役", url: "/models/digit-head-iter8.onnx", disk: "public/models/digit-head-iter8.onnx" },
  { key: "iter17·fp32", url: "/qa/cand-models/digit-head-iter17.onnx", disk: "qa/cand-models/digit-head-iter17.onnx" },
  { key: "iter21·fp32", url: "/qa/cand-models/digit-head-iter21.onnx", disk: "qa/cand-models/digit-head-iter21.onnx" },
].filter((m) => existsSync(resolve(".", m.disk)));

// 真实图（有格子的），取格心做裁格
const item = { path: "qa/fixtures/materials/renjuportal/rp-score-10.png", mime: "image/png" };
const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-fp16-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-fp16-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ dataUrl, modelList }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");

  const blob = await (await fetch(dataUrl)).blob();
  const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const first = await mod.recognizeBoardImage(new File([blob], "x.png", { type: "image/png" }), 15, { skipMoveOrder: true, parallel: false });
  const grid = first.grid;
  const stones = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      if (!first.board[row][col]) continue;
      stones.push({ x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY });
    }
  }
  const spacing = Math.round((grid.spacingX + grid.spacingY) / 2);

  const results = [];
  for (const model of modelList) {
    const reader = await head.createDigitHeadReader({ modelUrl: model.url, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 });
    if (!reader) { results.push({ key: model.key, error: "reader=null" }); continue; }
    // 预热（首次会装载 + 首次推理）
    await reader({ image: sampled, centers: [stones[0]], spacing });
    // 计时：全部子各读一遍，重复 3 轮取中位
    const rounds = [];
    let reads = null;
    for (let round = 0; round < 3; round += 1) {
      const t0 = performance.now();
      reads = await reader({ image: sampled, centers: stones, spacing });
      rounds.push(performance.now() - t0);
    }
    rounds.sort((a, b) => a - b);
    const median = rounds[1];
    results.push({
      key: model.key,
      stones: stones.length,
      msPerStone: Math.round((median / stones.length) * 100) / 100,
      totalMs: Math.round(median),
      rounds: rounds.map((r) => Math.round(r)),
      readCount: reads.filter(Boolean).length,
      // 逐格读出的号（用于比对两份模型的读数是否一致）
      signature: reads.map((r) => (r && r.length ? r[0].value : 0)).join(","),
    });
  }
  return results;
}, { dataUrl, modelList: models });

console.log(`\n=== 数字头模型：fp16(现役) vs fp32(候选) 纯推理成本 ===`);
console.log(`语料：rp-score-10.png\n`);
for (const r of out) {
  if (r.error) { console.log(`${r.key}: ${r.error}`); continue; }
  console.log(`${r.key}`);
  console.log(`  ${r.stones} 格 × 3 轮：${r.rounds.join(" / ")}ms → 中位 ${r.totalMs}ms（${r.msPerStone}ms/格）`);
  console.log(`  读出号数 ${r.readCount}/${r.stones}`);
}
const quant = out.find((r) => r.key.includes("fp16"));
const raw = out.find((r) => r.key.includes("fp32"));
if (quant && raw && !quant.error && !raw.error) {
  const delta = ((quant.msPerStone - raw.msPerStone) / raw.msPerStone) * 100;
  console.log(`\n【结论】fp16 每格 ${quant.msPerStone}ms vs fp32 ${raw.msPerStone}ms → fp16 ${delta >= 0 ? "慢" : "快"} ${Math.abs(delta).toFixed(1)}%`);
  console.log(`  读数完全一致？${quant.signature === raw.signature ? "是（逐格同号）" : "否（有格子读数不同）"}`);
}
await browser.close();
