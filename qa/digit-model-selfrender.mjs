// 数字头模型大样本评测（2026-10-09）：iter8(现役 fp16) vs iter17/21(候选 fp32)。
//
// 为什么要大样本：先前用 10 张识别夹具比出「两者精度完全一致」，但那个样本里
// 有真值的只有 5 张、且都是"容易"的图。用户问的是「限制后训练 vs 没限制版哪个更好」，
// 需要更硬的统计。仓库里有 **180 张自渲染图**（每张带逐坐标真值，覆盖 3 种分辨率、
// 多种手数），正好是这个用途。
//
// 本探针只比较**读号能力**（把两个模型的读号器分别注入同一条识别管线，其余全同），
// 输出：逐坐标命中率 / 完整复原数 / 平均耗时。为控制运行时间，用 SAMPLE 环境变量取样张数。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/digit-model-selfrender.mjs
//   SAMPLE=60  → 只跑前 60 张（默认全部 180）
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const SAMPLE = Number(process.env.SAMPLE || 0);

const models = [
  { key: "iter8·fp16·现役", url: "/models/digit-head-iter8.onnx", disk: "public/models/digit-head-iter8.onnx" },
  { key: "iter21·fp32", url: "/qa/cand-models/digit-head-iter21.onnx", disk: "qa/cand-models/digit-head-iter21.onnx" },
].filter((m) => existsSync(resolve(".", m.disk)));

const dir = resolve("qa/fixtures/materials/self-render");
const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
const picked = (SAMPLE > 0 ? index.slice(0, SAMPLE) : index).filter((item) => existsSync(resolve(dir, item.file)));
const payloads = picked.map((item) => {
  const truthPath = resolve(dir, item.file.replace(/\.jpg$/, ".truth.json"));
  return {
    file: item.file,
    mime: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(dir, item.file)).toString("base64")}`,
    truth: existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, "utf8")) : null,
  };
});

console.log(`样本 ${payloads.length} 张（有真值 ${payloads.filter((p) => p.truth).length} 张），模型 ${models.length} 个\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-self-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-self-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items, modelList }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const boardScanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
  });
  const readers = new Map();
  for (const m of modelList) {
    readers.set(m.key, await head.createDigitHeadReader({ modelUrl: m.url, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 }));
  }

  // 真值：self-render 的 truth.json 里是 stones[{row,col,number,player}]
  const score = (moves, truth) => {
    const list = truth?.stones?.length ? truth.stones
      : (truth?.moves?.length ? truth.moves
        : (truth?.coordinates || []).map((coord, index) => ({ row: 15 - parseInt(coord.slice(1), 10), col: coord.charCodeAt(0) - 65, number: (truth.start || 1) + index })));
    if (!list.length) return null;
    const expected = new Map(list.map((m) => [`${m.row},${m.col}`, m.number]));
    let hit = 0, called = 0, missing = 0;
    const wrong = [];
    for (const [rc] of expected) {
      const got = moves.find((m) => `${m.row},${m.col}` === rc);
      if (!got) { missing += 1; continue; }
      called += 1;
      if (got.number === expected.get(rc)) hit += 1; else wrong.push(`${rc}:${got.number}(真${expected.get(rc)})`);
    }
    return { hit, called, of: expected.size, missing, wrong: wrong.slice(0, 3) };
  };

  const rows = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.file, { type: item.mime });
    const perModel = [];
    for (const m of modelList) {
      const reader = readers.get(m.key);
      if (!reader) { perModel.push({ key: m.key, error: "null" }); continue; }
      const t0 = performance.now();
      const result = await mod.recognizeBoardImage(make(), 15, {
        skipMoveOrder: false, parallel: false, digitReader: reader, boardScanner: boardScanner ?? undefined,
      });
      const ms = performance.now() - t0;
      perModel.push({
        key: m.key, ms: Math.round(ms),
        read: result.readMoveNumbers.length,
        stones: result.board.flat().filter(Boolean).length,
        numbered: result.numberedMoves.length,
        status: result.moveOrderQuality?.status ?? "-",
        sc: score(result.readMoveNumbers, item.truth),
      });
    }
    rows.push({ file: item.file, perModel });
  }
  return rows;
}, { items: payloads, modelList: models });

// ── 汇总 ─────────────────────────────────────────────────────────
const keys = models.map((m) => m.key);
const totals = new Map(keys.map((k) => [k, { read: 0, hit: 0, called: 0, of: 0, numbered: 0, ms: 0, exact: 0, n: 0 }]));
for (const row of out) {
  for (const r of row.perModel) {
    if (r.error) continue;
    const t = totals.get(r.key);
    t.read += r.read; t.numbered += r.numbered > 0 ? 1 : 0; t.ms += r.ms; t.n += 1;
    if (r.sc) { t.hit += r.sc.hit; t.called += r.sc.called; t.of += r.sc.of; if (r.sc.hit === r.sc.of) t.exact += 1; }
  }
}
console.log("模型".padEnd(18) + "读出合计".padEnd(10) + "逐坐标命中".padEnd(14) + "整盘全对".padEnd(10) + "完整复原".padEnd(10) + "总耗时");
for (const k of keys) {
  const t = totals.get(k);
  console.log(k.padEnd(18) + String(t.read).padEnd(12) + `${t.hit}/${t.of}`.padEnd(16) + `${t.exact}/${t.n}`.padEnd(12) + String(t.numbered).padEnd(12) + `${Math.round(t.ms)}ms`);
}
// 逐图差异：只在两张模型结果不同的图上打印细节
const differing = out.filter((row) => {
  const [a, b] = row.perModel;
  if (!a || !b || a.error || b.error) return false;
  return a.read !== b.read || a.numbered !== b.numbered || (a.sc?.hit ?? -1) !== (b.sc?.hit ?? -1);
});
console.log(`\n两张模型结果不同的图：${differing.length}/${out.length}`);
for (const row of differing.slice(0, 12)) {
  const [a, b] = row.perModel;
  console.log(`  ${row.file}: ${a.key} 读${a.read}/对${a.sc?.hit ?? "-"} 完${a.numbered} | ${b.key} 读${b.read}/对${b.sc?.hit ?? "-"} 完${b.numbered}`);
}
await browser.close();
