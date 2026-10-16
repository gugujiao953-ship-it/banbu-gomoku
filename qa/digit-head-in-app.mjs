// 数字头集成验证（应用管线内，2026-10-06）：
// 同一批语料各跑两次 recognizeBoardImage——默认（模板匹配）与注入数字头读号器，
// 对比「读出号数 / 完整复原 / 逐坐标正确率（有真值的图）/ 读号耗时」。
// 用法：QA_BASE_URL=http://localhost:5173/ node qa/digit-head-in-app.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");

const corpora = [
  { file: "numbered.png", mime: "image/png", truth: null },
  { file: "user-98-36.jpg", mime: "image/jpeg", truth: null },
  { file: "paper10.jpg", mime: "image/jpeg", truth: null },
  { file: "paper02.jpg", mime: "image/jpeg", truth: null },
  { file: "user-99-43.jpg", mime: "image/jpeg", truth: null },
  { file: "remote-image1.jpeg", mime: "image/jpeg", truth: "remote-image1.truth.json" },
];
const fixtureDir = resolve("qa/fixtures/recognition");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-digit-head-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
}));
await page.goto(new URL("qa-digit-head-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = corpora
  .filter((item) => !process.env.ONLY || item.file === process.env.ONLY)
  .map((item) => ({
    file: item.file,
    mime: item.mime,
    dataUrl: `data:${item.mime};base64,${readFileSync(resolve(fixtureDir, item.file)).toString("base64")}`,
    truth: item.truth ? JSON.parse(readFileSync(resolve(fixtureDir, item.truth), "utf8")) : null,
    detail: Boolean(process.env.ONLY),
  }));

const rows = await page.evaluate(async (items) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const reader = await head.createDigitHeadReader({
    modelUrl: "/qa/fixtures/models/digit-head-iter2.onnx",
    wasmPaths: "/node_modules/onnxruntime-web/dist/",
    threads: 4,
  });
  if (!reader) return [{ file: "reader", error: "数字头加载失败" }];

  const correctness = (moves, truth) => {
    if (!truth || !truth.coordinates?.length) return null;
    const expected = new Map();
    truth.coordinates.forEach((coord, index) => expected.set(coord, (truth.start || 1) + index));
    let correct = 0;
    for (const move of moves) {
      const coord = String.fromCharCode(65 + move.col) + (15 - move.row);
      if (expected.get(coord) === move.number) correct += 1;
    }
    return `${correct}/${expected.size}`;
  };

  const out = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.file, { type: item.mime });

    const t0 = performance.now();
    const baseRun = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: true });
    const baseMs = Math.round(performance.now() - t0);
    const baseDigitMs = mod.moveOrderPerf.digitMs;

    const t1 = performance.now();
    const headRun = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: true, digitReader: reader });
    const headMs = Math.round(performance.now() - t1);
    const headDigitMs = mod.moveOrderPerf.digitHeadMs;

    const out2 = {
      file: item.file,
      base: { numbered: baseRun.numberedMoves.length, read: baseRun.readMoveNumbers.length, status: baseRun.moveOrderQuality?.status ?? (baseRun.numberedMoves.length ? "accepted" : "-"), correct: correctness(baseRun.numberedMoves, item.truth), total: baseMs, digitMs: baseDigitMs },
      head: { numbered: headRun.numberedMoves.length, read: headRun.readMoveNumbers.length, status: headRun.moveOrderQuality?.status ?? (headRun.numberedMoves.length ? "accepted" : "-"), correct: correctness(headRun.numberedMoves, item.truth), total: headMs, digitMs: headDigitMs },
      note: headRun.note.slice(0, 90),
    };
    if (item.detail) {
      const fmt = (moves) => moves.map((move) => `${String.fromCharCode(65 + move.col)}${15 - move.row}:${move.number}`).join(" ");
      out2.baseReads = fmt(baseRun.readMoveNumbers);
      out2.headReads = fmt(headRun.readMoveNumbers);
    }
    out.push(out2);
  }
  return out;
}, payloads);

console.log("图 | 默认:复原/读出/耗时(读号) | 数字头:复原/读出/耗时(读号) | 真值对(默认→数字头)");
for (const row of rows) {
  if (row.error) { console.log(row.file, row.error); continue; }
  console.log([
    row.file,
    `${row.base.numbered}/${row.base.read}/${row.base.total}ms(${row.base.digitMs}ms)`,
    `${row.head.numbered}/${row.head.read}/${row.head.total}ms(${row.head.digitMs}ms)`,
    `${row.base.correct ?? "-"} → ${row.head.correct ?? "-"}`,
  ].join(" | "));
  if (row.baseReads) console.log(`  默认读出：${row.baseReads}`);
  if (row.headReads) console.log(`  数字头读出：${row.headReads}`);
}
await browser.close();
