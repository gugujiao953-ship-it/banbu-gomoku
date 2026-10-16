// 量化损失评估：现役 iter8（量化）vs 候选 iter17–21（未量化原版）到底差多少（2026-10-09）。
//
// 用户交代：「这个是我们之前训的，但是考虑到大小，我们就量化了」——即 iter17 系是**未量化
// 原版**（5.58MB），现役 iter8 是量化后的**上线版**（2.79MB）。本探针就量这件事：
// 把同一批真实语料喂给每个模型，对比
//   ① 逐格读数正确率（有真值的图，逐坐标核）；
//   ② 完整手序复原成功率；
//   ③ 单次推理耗时（量化版理应更快，要看换来多少）；
//   ④ 同一格上的读数分歧（量化把哪些格子读坏了、又把哪些读好了）。
//
// 这是「限制后训练 vs 没限制版哪个更好」的直接证据：限制 = 量化压缩体积。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/digit-model-quant-compare.mjs
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");

// 语料 = 门禁同款识别夹具（含逐坐标真值的优先）
const corpora = [
  { file: "numbered.png", mime: "image/png", truth: null },
  { file: "user-98-36.jpg", mime: "image/jpeg", truth: null },
  { file: "paper10.jpg", mime: "image/jpeg", truth: "paper10.truth.json" },
  { file: "paper02.jpg", mime: "image/jpeg", truth: "paper02.truth.json" },
  { file: "user-99-43.jpg", mime: "image/jpeg", truth: null },
  { file: "remote-image1.jpeg", mime: "image/jpeg", truth: "remote-image1.truth.json" },
  { file: "../materials/remote-image2.png", mime: "image/png", truth: "remote-image2.truth.json" },
  { file: "../materials/user-cno2010-15.jpg", mime: "image/jpeg", truth: "user-cno2010-15.truth.json" },
  { file: "../materials/blur-num71.jpg", mime: "image/jpeg", truth: null },
  { file: "../materials/renjuportal/rp-score-10.png", mime: "image/png", truth: null },
];
const fixtureDir = resolve("qa/fixtures/recognition");

// 模型清单：现役量化版 + 全部候选未量化版
// 注意路径有两套：`url` 是页面里 fetch 用的（BASE_URL 相对，必须以 / 开头），
// `disk` 是本地判存用的（相对仓库根）。早先只有一套、用 url 去 existsSync，
// 结果 `/qa/...` 在文件系统上不存在 → 候选全被过滤掉、只剩现役模型（实测踩过）。
const models = [
  { key: "iter8·量化·现役", url: "/models/digit-head-iter8.onnx", disk: "public/models/digit-head-iter8.onnx" },
  { key: "iter17·原始", url: "/qa/cand-models/digit-head-iter17.onnx", disk: "qa/cand-models/digit-head-iter17.onnx" },
  { key: "iter18·原始", url: "/qa/cand-models/digit-head-iter18.onnx", disk: "qa/cand-models/digit-head-iter18.onnx" },
  { key: "iter19·原始", url: "/qa/cand-models/digit-head-iter19.onnx", disk: "qa/cand-models/digit-head-iter19.onnx" },
  { key: "iter20·原始", url: "/qa/cand-models/digit-head-iter20.onnx", disk: "qa/cand-models/digit-head-iter20.onnx" },
  { key: "iter21·原始", url: "/qa/cand-models/digit-head-iter21.onnx", disk: "qa/cand-models/digit-head-iter21.onnx" },
].filter((m) => existsSync(resolve(".", m.disk)));

const payloads = corpora
  .filter((item) => existsSync(resolve(fixtureDir, item.file)))
  .map((item) => ({
    file: item.file.replace("../materials/", ""),
    mime: item.mime,
    dataUrl: `data:${item.mime};base64,${readFileSync(resolve(fixtureDir, item.file)).toString("base64")}`,
    truth: item.truth && existsSync(resolve(fixtureDir, item.truth)) ? JSON.parse(readFileSync(resolve(fixtureDir, item.truth), "utf8")) : null,
  }));

console.log(`语料 ${payloads.length} 张（其中有真值 ${payloads.filter((p) => p.truth).length} 张），模型 ${models.length} 个\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-quant-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-quant-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const rows = await page.evaluate(async ({ items, modelList }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const boardScanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL,
    digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/",
    threads: 4,
  });

  // 逐坐标对真值：只统计「模型读出的号」里有几个对
  const correctness = (moves, truth) => {
    if (!truth) return null;
    const list = truth.moves?.length
      ? truth.moves
      : (truth.coordinates || []).map((coord, index) => ({
        row: 15 - parseInt(coord.slice(1), 10), col: coord.charCodeAt(0) - 65,
        number: (truth.start || 1) + index,
      }));
    if (!list.length) return null;
    const expected = new Map(list.map((m) => [`${m.row},${m.col}`, m.number]));
    let correct = 0;
    const wrong = [];
    for (const move of moves) {
      const want = expected.get(`${move.row},${move.col}`);
      if (want === move.number) correct += 1;
      else wrong.push(`${String.fromCharCode(65 + move.col)}${15 - move.row}:${move.number}(真${want ?? "-"})`);
    }
    return { total: expected.size, correct, wrong };
  };

  const out = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.file, { type: item.mime });
    // 网格只算一次，所有模型复用同一条识别几何
    const imported = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false, boardScanner: boardScanner ?? undefined });
    const grid = imported.grid ? { originX: imported.grid.originX, originY: imported.grid.originY, spacingX: imported.grid.spacingX, spacingY: imported.grid.spacingY } : undefined;

    const perModel = [];
    for (const model of modelList) {
      const digits = await head.createDigitHeadReader({
        modelUrl: model.url,
        wasmPaths: "/node_modules/onnxruntime-web/dist/",
        threads: 1,
      });
      if (!digits) { perModel.push({ key: model.key, error: "reader=null" }); continue; }
      const t0 = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, {
        skipMoveOrder: false, parallel: false,
        digitReader: digits, boardScanner: boardScanner ?? undefined,
        knownGrid: grid,
      });
      const ms = Math.round(performance.now() - t0);
      perModel.push({
        key: model.key,
        ms,
        stones: result.board.flat().filter(Boolean).length,
        read: result.readMoveNumbers.length,
        numbered: result.numberedMoves.length,
        status: result.moveOrderQuality?.status ?? "-",
        correct: correctness(result.readMoveNumbers, item.truth),
        // 逐格读数（键 row,col → value），用于跨模型分歧分析
        reads: result.readMoveNumbers.map((m) => `${m.row},${m.col}=${m.number}`),
      });
    }
    out.push({ file: item.file, stones: imported.board.flat().filter(Boolean).length, perModel });
  }
  return out;
}, { items: payloads, modelList: models });

// ── 汇总 ───────────────────────────────────────────────────────────
const keys = models.map((m) => m.key);
console.log("【逐图明细】读出号数 / 完整手序 / 逐坐标正确 / 耗时");
for (const row of rows) {
  console.log(`\n${row.file}（${row.stones} 子）`);
  for (const r of row.perModel) {
    if (r.error) { console.log(`  ${r.key.padEnd(16)} ${r.error}`); continue; }
    const acc = r.correct ? `${r.correct.correct}/${r.correct.total}` : "-";
    console.log(`  ${r.key.padEnd(16)} 读出 ${String(r.read).padStart(3)} | 完整 ${String(r.numbered).padStart(3)} | 正确 ${acc.padEnd(7)} | ${String(r.ms).padStart(6)}ms | ${r.status}`);
  }
}

console.log("\n【总计】");
console.log("模型".padEnd(18) + "读出总数".padEnd(10) + "完整复原图数".padEnd(13) + "逐坐标正确".padEnd(12) + "总耗时");
const totals = keys.map((key) => {
  let read = 0, numbered = 0, correct = 0, total = 0, ms = 0;
  for (const row of rows) {
    const r = row.perModel.find((x) => x.key === key);
    if (!r || r.error) continue;
    read += r.read; numbered += r.numbered > 0 ? 1 : 0; ms += r.ms;
    if (r.correct) { correct += r.correct.correct; total += r.correct.total; }
  }
  return { key, read, numbered, correct, total, ms };
});
for (const t of totals) {
  console.log(t.key.padEnd(18) + String(t.read).padEnd(12) + String(t.numbered).padEnd(15) + `${t.correct}/${t.total}`.padEnd(14) + `${t.ms}ms`);
}

// 量化版 vs 最好的原始版：逐格分歧
const quant = totals.find((t) => t.key.includes("量化"));
const bestRaw = totals.filter((t) => t.key.includes("原始")).sort((a, b) => (b.correct - a.correct) || (b.read - a.read))[0];
if (quant && bestRaw) {
  console.log(`\n【量化代价】现役（量化）vs 最佳原始版（${bestRaw.key}）`);
  console.log(`  逐坐标正确：${quant.correct}/${quant.total} vs ${bestRaw.correct}/${bestRaw.total}（差 ${bestRaw.correct - quant.correct}）`);
  console.log(`  读出总数：  ${quant.read} vs ${bestRaw.read}（差 ${bestRaw.read - quant.read}）`);
  console.log(`  完整复原：  ${quant.numbered} 张 vs ${bestRaw.numbered} 张`);
  console.log(`  总耗时：    ${quant.ms}ms vs ${bestRaw.ms}ms（量化省 ${Math.round((1 - quant.ms / bestRaw.ms) * 100)}%）`);
}
await browser.close();
