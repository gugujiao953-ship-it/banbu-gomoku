// 「复原手序-本地」增强链路验收（2026-10-07，管线层）：
// 同一批语料各跑两遍 recognizeBoardImage——默认（纯 CV+模板）与
// 注入 digitReader（数字头 iter6）+ boardScanner（cell-cls 补位），
// 对比「棋子数 / 完整复原 / 有真值图的逐坐标正确率」。
// 验收核心：remote-image2（应用现状 45/89 子、无法复原）→ 增强 after 应 89 子全对、
// 完整复原第 1..89 手且逐坐标与真值一致。
// 用法：QA_BASE_URL=http://localhost:5173/ node qa/enhanced-restore-check.mjs
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
  { file: "paper02.jpg", mime: "image/jpeg", truth: "paper02.truth.json" },
  { file: "user-99-43.jpg", mime: "image/jpeg", truth: null },
  { file: "remote-image1.jpeg", mime: "image/jpeg", truth: "remote-image1.truth.json" },
  { file: "../materials/remote-image2.png", mime: "image/png", truth: "remote-image2.truth.json" },
  // 用户那张外部 App 截图（Chinese National Open 2010，15 手）：黑子白字 + 红字最后一手。
  // 2026-10-07 验收目标 = 完整复原第 1..15 手（见 qa/tmp-user-cno-app.mjs 的逐手明细）。
  { file: "../materials/user-cno2010-15.jpg", mime: "image/jpeg", truth: "user-cno2010-15.truth.json" },
  // 木刻风棋盘（智子风格截图，用户报「识别一团糟」的网格相位回归图）：修好后应用出
  // 34 子（像素法真值 33 + 红字 A 标记误判 1）；没有手序号 → 复原目标 = 不重建、按局面导入。
  { file: "../materials/mm-wood-zhizi.jpg", mime: "image/jpeg", truth: null },
  // 模糊小图（71 手题图）：位置识别正确，读号是短板（31/71，凑不成 1..71 → 如实拒绝复原）。
  { file: "../materials/blur-num71.jpg", mime: "image/jpeg", truth: null },
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

const payloads = corpora.map((item) => ({
  file: item.file,
  mime: item.mime,
  dataUrl: `data:${item.mime};base64,${readFileSync(resolve(fixtureDir, item.file)).toString("base64")}`,
  truth: item.truth ? JSON.parse(readFileSync(resolve(fixtureDir, item.truth), "utf8")) : null,
}));

const digitModel = process.env.DIGIT_MODEL || null;
const rows = await page.evaluate(async ({ items, digitModel }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  // 模型地址跟应用走（public/models，由 prepare-ai-assets 拷好）：此前写死的
  // /qa/fixtures/models/*.onnx 在仓库里已只剩 -fp16 源件，脚本会直接「模型加载失败」。
  const digitReader = await head.createDigitHeadReader({
    modelUrl: digitModel || head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/",
    threads: 4,
  });
  const boardScanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL,
    digitModelUrl: digitModel || head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/",
    threads: 4,
  });
  if (!digitReader || !boardScanner) return [{ file: "reader", error: `模型加载失败 digit=${!!digitReader} scan=${!!boardScanner}` }];

  const correctness = (moves, truth) => {
    if (!truth) return null;
    const list = truth.moves?.length ? truth.moves : (truth.coordinates || []).map((coord, index) => ({ row: 15 - parseInt(coord.slice(1), 10), col: coord.charCodeAt(0) - 65, number: (truth.start || 1) + index }));
    if (!list.length) return null;
    const expected = new Map(list.map((m) => [`${m.row},${m.col}`, m.number]));
    let correct = 0;
    const wrong = [];
    for (const move of moves) {
      const want = expected.get(`${move.row},${move.col}`);
      if (want === move.number) correct += 1;
      else wrong.push(`${String.fromCharCode(65 + move.col)}${15 - move.row}:${move.number}(真${want ?? "-"})`);
    }
    return `${correct}/${expected.size}${wrong.length ? ` 错:${wrong.slice(0, 4).join(" ")}` : ""}`;
  };

  const out = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.file.replace("../materials/", ""), { type: item.mime });

    const baseRun = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: true });

    const t1 = performance.now();
    const enhRun = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: true, digitReader, boardScanner });
    const enhMs = Math.round(performance.now() - t1);

    const stonesOf = (run) => run.board.flat().filter(Boolean).length;
    out.push({
      file: item.file.replace("../materials/", ""),
      base: { stones: stonesOf(baseRun), numbered: baseRun.numberedMoves.length, read: baseRun.readMoveNumbers.length, correct: correctness(baseRun.numberedMoves, item.truth) },
      enh: { stones: stonesOf(enhRun), numbered: enhRun.numberedMoves.length, read: enhRun.readMoveNumbers.length, correct: correctness(enhRun.numberedMoves, item.truth), ms: enhMs },
      status: enhRun.moveOrderQuality?.status ?? "-",
      quality: enhRun.moveOrderQuality ? { accepted: enhRun.moveOrderQuality.accepted, assignedMean: enhRun.moveOrderQuality.assignedMean, assignedMin: enhRun.moveOrderQuality.assignedMin, ambiguous: enhRun.moveOrderQuality.ambiguous, maxRegret: enhRun.moveOrderQuality.maxRegret } : null,
      note: enhRun.note.slice(0, 80),
    });
  }
  return out;
}, { items: payloads, digitModel });

console.log("图 | 默认:子/复原/读出/真值对 | 增强:子/复原/读出/真值对/耗时");
let fails = 0;
for (const row of rows) {
  if (row.error) { console.log(row.file, row.error); fails += 1; continue; }
  console.log([
    row.file,
    `${row.base.stones}/${row.base.numbered}/${row.base.read}/${row.base.correct ?? "-"}`,
    `${row.enh.stones}/${row.enh.numbered}/${row.enh.read}/${row.enh.correct ?? "-"} · ${row.enh.ms}ms`,
  ].join(" | "));
}
// 验收硬断言
const r2 = rows.find((row) => row.file === "remote-image2.png");
if (!r2 || r2.error) { console.log("FAIL remote-image2 缺失"); fails += 1; }
else {
  console.log("remote-image2 诊断:", JSON.stringify({ quality: r2.quality, note: r2.note }));
  const ok = r2.enh.stones === 89 && r2.enh.numbered === 89 && (r2.enh.correct || "").startsWith("89/89");
  console.log(ok ? "PASS remote-image2：89 子全对、完整复原 1..89、逐坐标 89/89" : `FAIL remote-image2 增强=${JSON.stringify(r2.enh)}`);
  if (!ok) fails += 1;
}
const r1 = rows.find((row) => row.file === "remote-image1.jpeg");
if (r1 && !r1.error && !(r1.enh.correct || "").startsWith("57/57")) { console.log(`FAIL remote-image1 退步：${r1.enh.correct}`); fails += 1; }
console.log(fails ? `\n${fails} 项失败` : "\n验收全过");
await browser.close();
process.exit(fails ? 1 : 0);
