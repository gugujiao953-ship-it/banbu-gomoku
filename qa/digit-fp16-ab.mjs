// fp16 vs fp32 的**干净 A/B 对照**（2026-10-09）。
//
// 为什么需要这个：上一轮 bakeoff 显示现役 fp16 总耗时 133s，而 fp32 候选只有 50s
// （慢 2.6 倍），但**精度完全一致**。差异太大，必须先排除三种测量假象才能当真：
//   ① 顺序效应：fp16 总是第一个跑，可能吃到「ORT 首次装载 + wasm 图首次优化」的成本；
//   ② 进程内状态：同一进程里先后跑多个模型，是否有 JIT/缓存/GC 的相互影响；
//   ③ 单张偶然：某一张图触发了额外轮次（多尺度重读、二轮补读）造成倍增。
//
// 做法：**交替 A/B/A/B** 跑同一张图，每轮独立新建 reader（模拟真实用户路径），
// 并在交替前各预热一次。若 fp16 在交替中每一轮都慢，则顺序效应被排除。
// 同时在**独立进程**里跑单模型（用 ONLY 环境变量），做跨进程对照。
//
// 用法：
//   MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/digit-fp16-ab.mjs
//   ONLY=iter8  ... 只跑现役（独立进程基线）
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const ONLY = process.env.ONLY || null;
const ROUNDS = Number(process.env.ROUNDS || 3);

const all = {
  iter8: { key: "iter8·fp16·现役", url: "/models/digit-head-iter8.onnx", disk: "public/models/digit-head-iter8.onnx" },
  iter17: { key: "iter17·fp32", url: "/qa/cand-models/digit-head-iter17.onnx", disk: "qa/cand-models/digit-head-iter17.onnx" },
};
const models = (ONLY ? [all[ONLY]] : [all.iter8, all.iter17]).filter((m) => existsSync(resolve(".", m.disk)));

const fixtureDir = resolve("qa/fixtures/recognition");
const materialDir = resolve("qa/fixtures/materials");
// 用「结果完全一致」的那两张做对标（rp-score-02 两边都 62/62 完整复原），
// 这样比较的是纯耗时、不掺入「走不同分支」的干扰。
const corpus = [
  { path: resolve(materialDir, "renjuportal/rp-score-02.png"), mime: "image/png" },
  { path: resolve(fixtureDir, "remote-image2.png"), mime: "image/png" },
  { path: resolve(fixtureDir, "remote-image1.jpeg"), mime: "image/jpeg" },
].filter((item) => existsSync(item.path));

const payloads = corpus.map((item) => ({
  name: item.path.split(/[\\/]/).slice(-2).join("/"),
  mime: item.mime,
  dataUrl: `data:${item.mime};base64,${readFileSync(item.path).toString("base64")}`,
}));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-ab-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-ab-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items, modelList, rounds }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const boardScanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL,
    digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
  });

  const makeReader = (m) => head.createDigitHeadReader({ modelUrl: m.url, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 });

  // 预热：每个模型先跑一次（把 ORT 首次装载 + wasm 图优化成本排除在计时之外）
  for (const m of modelList) {
    const r = await makeReader(m);
    if (!r) continue;
    const blob = await (await fetch(items[0].dataUrl)).blob();
    await mod.recognizeBoardImage(new File([blob], "warm.png", { type: items[0].mime }), 15,
      { skipMoveOrder: false, parallel: false, digitReader: r, boardScanner: boardScanner ?? undefined });
  }

  const log = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.name.split("/").pop(), { type: item.mime });
    const perModel = new Map(modelList.map((m) => [m.key, []]));
    const resultOf = new Map();
    // **交替**跑：每轮把两个模型各跑一遍，消除"谁先谁后"的系统偏差
    for (let round = 0; round < rounds; round += 1) {
      for (const m of modelList) {
        const reader = await makeReader(m);
        if (!reader) continue;
        const t0 = performance.now();
        const result = await mod.recognizeBoardImage(make(), 15,
          { skipMoveOrder: false, parallel: false, digitReader: reader, boardScanner: boardScanner ?? undefined });
        const ms = performance.now() - t0;
        perModel.get(m.key).push(Math.round(ms));
        resultOf.set(m.key, {
          read: result.readMoveNumbers.length,
          numbered: result.numberedMoves.length,
          stones: result.board.flat().filter(Boolean).length,
          status: result.moveOrderQuality?.status ?? "-",
        });
      }
    }
    log.push({
      name: item.name,
      rows: modelList.map((m) => ({
        key: m.key,
        times: perModel.get(m.key),
        median: (() => { const t = perModel.get(m.key).slice().sort((a, b) => a - b); return t[Math.floor(t.length / 2)]; })(),
        ...resultOf.get(m.key),
      })),
    });
  }
  return log;
}, { items: payloads, modelList: models, rounds: ROUNDS });

console.log(`\n=== fp16 vs fp32 交替对照（每张图各跑 ${ROUNDS} 轮，交替顺序）===`);
for (const row of out) {
  console.log(`\n${row.name}`);
  for (const r of row.rows) {
    console.log(`  ${r.key.padEnd(16)} 各轮 ${r.times.join(" / ")}ms → 中位 ${r.median}ms | 读出 ${r.read}/${r.stones} 完整 ${r.numbered} ${r.status}`);
  }
  if (row.rows.length === 2) {
    const [a, b] = row.rows;
    const d = ((a.median - b.median) / b.median) * 100;
    console.log(`  → ${a.key} ${d >= 0 ? "慢" : "快"} ${Math.abs(d).toFixed(1)}%（相对 ${b.key}）`);
  }
}
await browser.close();
