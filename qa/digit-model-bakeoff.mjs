// 数字头候选模型横向评测（2026-10-09）：iter8(现役) vs iter17–21。
//
// 上一轮的发现：在 rp-score-10 密盘上，现役 iter8 读出 50/76，而 iter21 读出 66/76。
// 差距太大，必须在**更大样本**上确认——单张图可能是偶然。
//
// 本探针直接在页面里调用模型的裁格推理（不经过整条识别管线），理由是：
// ① 这样量的是**模型本身**的能力，不被「模板匹配/装配门控」干扰；
// ② 每格一次前向，读数与真值可直接对账。
//
// 语料：识别夹具里所有带序号的真实图（书谱/截图/网页盘/外部 App 截图）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/digit-model-bakeoff.mjs
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");

const models = [
  { key: "iter8·fp16·现役", url: "/models/digit-head-iter8.onnx", disk: "public/models/digit-head-iter8.onnx" },
  { key: "iter17·fp32", url: "/qa/cand-models/digit-head-iter17.onnx", disk: "qa/cand-models/digit-head-iter17.onnx" },
  { key: "iter18·fp32", url: "/qa/cand-models/digit-head-iter18.onnx", disk: "qa/cand-models/digit-head-iter18.onnx" },
  { key: "iter19·fp32", url: "/qa/cand-models/digit-head-iter19.onnx", disk: "qa/cand-models/digit-head-iter19.onnx" },
  { key: "iter20·fp32", url: "/qa/cand-models/digit-head-iter20.onnx", disk: "qa/cand-models/digit-head-iter20.onnx" },
  { key: "iter21·fp32", url: "/qa/cand-models/digit-head-iter21.onnx", disk: "qa/cand-models/digit-head-iter21.onnx" },
].filter((m) => existsSync(resolve(".", m.disk)));

// 语料：越多样越好（书谱 / 截图 / 网页盘 / 外部 App）
const fixtureDir = resolve("qa/fixtures/recognition");
const materialDir = resolve("qa/fixtures/materials");
const corpus = [
  { path: resolve(fixtureDir, "numbered.png"), mime: "image/png", truth: null },
  { path: resolve(fixtureDir, "user-98-36.jpg"), mime: "image/jpeg", truth: null },
  { path: resolve(fixtureDir, "paper10.jpg"), mime: "image/jpeg", truth: resolve(fixtureDir, "paper10.truth.json") },
  { path: resolve(fixtureDir, "paper02.jpg"), mime: "image/jpeg", truth: resolve(fixtureDir, "paper02.truth.json") },
  { path: resolve(fixtureDir, "user-99-43.jpg"), mime: "image/jpeg", truth: null },
  { path: resolve(fixtureDir, "remote-image1.jpeg"), mime: "image/jpeg", truth: resolve(fixtureDir, "remote-image1.truth.json") },
  { path: resolve(materialDir, "remote-image2.png"), mime: "image/png", truth: resolve(fixtureDir, "remote-image2.truth.json") },
  { path: resolve(materialDir, "user-cno2010-15.jpg"), mime: "image/jpeg", truth: resolve(fixtureDir, "user-cno2010-15.truth.json") },
  { path: resolve(materialDir, "blur-num71.jpg"), mime: "image/jpeg", truth: null },
  { path: resolve(materialDir, "renjuportal/rp-score-10.png"), mime: "image/png", truth: null },
  { path: resolve(materialDir, "renjuportal/rp-score-02.png"), mime: "image/png", truth: null },
].filter((item) => existsSync(item.path));

const payloads = corpus.map((item) => ({
  name: item.path.split(/[\\/]/).slice(-2).join("/"),
  mime: item.mime,
  dataUrl: `data:${item.mime};base64,${readFileSync(item.path).toString("base64")}`,
  truth: item.truth && existsSync(item.truth) ? JSON.parse(readFileSync(item.truth, "utf8")) : null,
}));

console.log(`语料 ${payloads.length} 张，模型 ${models.length} 个\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-bakeoff-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-bakeoff-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items, modelList }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");

  // 用「整条识别管线」拿到网格与子位（这部分对所有模型相同），随后**只换读号器**
  const boardScanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL,
    digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
  });

  const accuracy = (pairs, truth) => {
    if (!truth) return null;
    const list = truth.moves?.length
      ? truth.moves
      : (truth.coordinates || []).map((coord, index) => ({
        row: 15 - parseInt(coord.slice(1), 10), col: coord.charCodeAt(0) - 65,
        number: (truth.start || 1) + index,
      }));
    if (!list.length) return null;
    const expected = new Map(list.map((m) => [`${m.row},${m.col}`, m.number]));
    let hit = 0, called = 0;
    for (const [rc, value] of pairs) {
      if (value <= 0) continue;
      called += 1;
      if (expected.get(rc) === value) hit += 1;
    }
    return { hit, called, of: expected.size };
  };

  const results = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.name.split("/").pop(), { type: item.mime });
    const perModel = [];
    for (const model of modelList) {
      const reader = await head.createDigitHeadReader({ modelUrl: model.url, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 });
      if (!reader) { perModel.push({ key: model.key, error: "null" }); continue; }
      const t0 = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: false, digitReader: reader, boardScanner: boardScanner ?? undefined });
      const ms = Math.round(performance.now() - t0);
      const pairs = result.readMoveNumbers.map((m) => [`${m.row},${m.col}`, m.number]);
      perModel.push({
        key: model.key, ms,
        read: result.readMoveNumbers.length,
        stones: result.board.flat().filter(Boolean).length,
        numbered: result.numberedMoves.length,
        status: result.moveOrderQuality?.status ?? "-",
        acc: accuracy(pairs, item.truth),
        pairs,
      });
    }
    results.push({ name: item.name, perModel });
  }
  return results;
}, { items: payloads, modelList: models });

// ── 输出 ─────────────────────────────────────────────────────────
const keys = models.map((m) => m.key);
for (const row of out) {
  console.log(`\n${row.name}`);
  for (const r of row.perModel) {
    if (r.error) { console.log(`  ${r.key.padEnd(16)} ${r.error}`); continue; }
    const acc = r.acc ? `命中 ${r.acc.hit}/${r.acc.called}（真值共 ${r.acc.of}）` : "无真值";
    console.log(`  ${r.key.padEnd(16)} 读出 ${String(r.read).padStart(3)}/${String(r.stones).padEnd(3)} 完整 ${String(r.numbered).padStart(3)} ${acc.padEnd(30)} ${String(r.ms).padStart(6)}ms ${r.status}`);
  }
}

console.log("\n【总表】");
console.log("模型".padEnd(18) + "读出合计".padEnd(10) + "有真值命中".padEnd(14) + "完整复原".padEnd(10) + "总耗时");
const summary = keys.map((key) => {
  let read = 0, hit = 0, called = 0, of = 0, numbered = 0, ms = 0;
  for (const row of out) {
    const r = row.perModel.find((x) => x.key === key);
    if (!r || r.error) continue;
    read += r.read; numbered += r.numbered > 0 ? 1 : 0; ms += r.ms;
    if (r.acc) { hit += r.acc.hit; called += r.acc.called; of += r.acc.of; }
  }
  return { key, read, hit, called, of, numbered, ms };
});
for (const s of summary) {
  console.log(s.key.padEnd(18) + String(s.read).padEnd(12) + `${s.hit}/${s.of}`.padEnd(16) + String(s.numbered).padEnd(12) + `${s.ms}ms`);
}

const cur = summary.find((s) => s.key.includes("现役"));
console.log("\n【现役 vs 候选】");
for (const s of summary.filter((x) => !x.key.includes("现役"))) {
  const dRead = s.read - cur.read;
  const dHit = s.hit - cur.hit;
  console.log(`  ${s.key.padEnd(16)} 读出 ${dRead >= 0 ? "+" : ""}${dRead} | 命中 ${dHit >= 0 ? "+" : ""}${dHit} | 完整 ${s.numbered - cur.numbered >= 0 ? "+" : ""}${s.numbered - cur.numbered} | 耗时 ${s.ms - cur.ms >= 0 ? "+" : ""}${s.ms - cur.ms}ms`);
}
await browser.close();
