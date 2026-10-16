// 「模板 vs 数字头该信谁」标定：对带真值的图逐格记录两份读数与真值，打印各种选择
// 规则的准确率，用数据挑规则（两份分数的量纲不同，只能按真值回归）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-move-source.mjs <图> <真值>
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const imagePath = process.argv[2];
const truthPath = process.argv[3] || imagePath.replace(/\.(png|jpe?g)$/i, ".truth.json");
const truth = JSON.parse(readFileSync(resolve(truthPath), "utf8"));
const stones = truth.stones
  ?? (truth.moves?.length ? truth.moves.map((move) => ({ row: move.row, col: move.col, number: move.number ?? 0 })) : null)
  ?? (truth.coordinates || []).map((coord, index) => ({ row: 15 - parseInt(coord.slice(1), 10), col: coord.charCodeAt(0) - 65, number: (truth.start || 1) + index }));
const dataUrl = `data:${/\.jpe?g$/i.test(imagePath) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(imagePath)).toString("base64")}`;
const base = process.env.QA_BASE_URL || "http://localhost:5173/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-move-source-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-move-source-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const rows = await page.evaluate(async ({ dataUrl, name, digitModelUrl }) => {
  globalThis.__BANBU_MOVE_SOURCE_DEBUG__ = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: digitModelUrl || head.DIGIT_HEAD_MODEL_URL }),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: digitModelUrl || head.DIGIT_HEAD_MODEL_URL }),
  ]);
  const blob = await (await fetch(dataUrl)).blob();
  await mod.recognizeBoardImage(new File([blob], name, { type: blob.type }), 15, { skipMoveOrder: false, parallel: false, digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined });
  return globalThis.__BANBU_MOVE_SOURCE_DEBUG__;
}, { dataUrl, name: imagePath.split("/").pop(), digitModelUrl: process.env.DIGIT_MODEL_URL || "" });

const truthByKey = new Map(stones.map((stone) => [`${stone.row},${stone.col}`, stone]));
const truthByNumber = new Map(stones.map((stone) => [stone.number, stone]));
let templateOk = 0, headOk = 0, pickedOk = 0, covered = 0;
const rules = {
  "模板优先(现行)": (row) => row.template?.value,
  "数字头优先": (row) => row.head?.value,
  "奇偶优先(都对取模板)": (row) => {
    const truth = truthByKey.get(`${row.row},${row.col}`);
    if (!truth) return row.template?.value ?? row.head?.value;
    if (row.template && (row.template.value % 2 === 1) === (row.player === "black")) return row.template.value;
    if (row.head && (row.head.value % 2 === 1) === (row.player === "black")) return row.head.value;
    return row.template?.value ?? row.head?.value;
  },
  "数字头≥0.9则用数字头": (row) => (row.head && row.head.prob >= 0.9 ? row.head.value : row.template?.value ?? row.head?.value),
  "数字头≥0.8则用数字头": (row) => (row.head && row.head.prob >= 0.8 ? row.head.value : row.template?.value ?? row.head?.value),
  "模板<0.75且数字头≥0.5用数字头": (row) => {
    if (row.head && row.head.prob >= 0.5 && (!row.template || row.template.score < 0.75)) return row.head.value;
    return row.template?.value ?? row.head?.value;
  },
  "数字头≥0.85或模板<0.6": (row) => {
    if (row.head && row.head.prob >= 0.85) return row.head.value;
    if (!row.template || row.template.score < 0.6) return row.head?.value ?? row.template?.value;
    return row.template.value;
  },
};
const counts = Object.fromEntries(Object.keys(rules).map((key) => [key, 0]));
for (const row of rows) {
  const truth = truthByKey.get(`${row.row},${row.col}`);
  if (!truth) continue;
  covered += 1;
  if (row.template?.value === truth.number) templateOk += 1;
  if (row.head?.value === truth.number) headOk += 1;
  if (row.picked === truth.number) pickedOk += 1;
  for (const [label, rule] of Object.entries(rules)) if (rule(row) === truth.number) counts[label] += 1;
}
console.log(`${imagePath.split("/").pop()}：与真值对上的子 ${covered}（真值 ${stones.length}）`);
console.log(`  模板首选对 ${templateOk} | 数字头首选对 ${headOk} | 现行实际选中对 ${pickedOk}`);
for (const [label, hit] of Object.entries(counts)) console.log(`  规则[${label}] → ${hit}/${covered}`);
const headRows = rows.filter((row) => row.head);
console.log(`  有数字头读数的格 ${headRows.length}；其中数字头对 ${headRows.filter((row) => truthByKey.get(`${row.row},${row.col}`)?.number === row.head.value).length}、模板对 ${headRows.filter((row) => truthByKey.get(`${row.row},${row.col}`)?.number === row.template?.value).length}`);

// 「并入取舍」标定（2026-10-12）：只看**模板自信（≥0.6）且与数字头不一致**的格子——
// 这批正是现行规则「不并入」的对象，也是装配池里只剩错候选的来源。
// 分桶看数字头置信与正确率，判断并入门槛该定在哪。
const conflict = [];
for (const row of rows) {
  const truth = truthByKey.get(`${row.row},${row.col}`);
  if (!truth || !row.head || !row.template) continue;
  if (row.template.score < 0.6 || row.template.value === row.head.value) continue;
  conflict.push({ ...row, truthNumber: truth.number });
}
const buckets = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]];
console.log(`  模板自信且与数字头不一致：${conflict.length} 行（含重复调用）`);
for (const [lo, hi] of buckets) {
  const inBucket = conflict.filter((row) => row.head.prob >= lo && row.head.prob < hi);
  const headRight = inBucket.filter((row) => row.head.value === row.truthNumber).length;
  const tmplRight = inBucket.filter((row) => row.template.value === row.truthNumber).length;
  console.log(`    数字头置信[${lo}-${hi})：${inBucket.length} 行 | 数字头对 ${headRight} | 模板对 ${tmplRight}`);
}
await browser.close();
