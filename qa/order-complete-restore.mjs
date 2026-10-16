// 「补全识别」路径必须仍然走通（2026-10-12）。这条路径 = 核对屏点「补全识别」时走的那一条：
// `recognizeBoardImage(..., { knownNumbers })` —— 已读准的号以单候选 score=1 钉住、不重读，
// 只对漏读的子走**加深档**（更多裁剪尺度），再联合装配出完整 1..N。
//
// 为什么要单独立这条门禁：同一天修的 bug 让「复原手序」第一次就常常成功，于是
// `qa/followup-buttons-e2e.mjs` 的那两颗按钮**不再出现**（它的断言允许这种结果），
// 补全那一档就没人自动跑了。而这一档正是用户原话「即便是补全复原也很多没有补全」的现场。
//
// 场景：用真值造一份**部分**已读号（每 4 颗丢 1 颗 = 保留 75%），交给识别器，断言：
//   · 棋子逐格与真值一致
//   · 完整复原 1..N 且逐坐标手数全对（丢掉的号由加深档补读 + 联合约束补回）
// 默认盘取手数第三高那张（215 手）——与 order-hi-ply-restore 同一盘，保证这条是硬骨头。
//
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/order-complete-restore.mjs [盘文件]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const dir = resolve("qa/fixtures/materials/self-hi-ply");
const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
// 与 order-hi-ply-restore 同口径：手数第三高的那张（215 手），可由 ORDER_GATE_BOARD 改。
const ranked = index.filter((item) => item.width === 1200).slice().sort((left, right) => right.stones - left.stones);
const rank = Math.max(1, Number(process.env.ORDER_GATE_BOARD || 3));
const file = process.argv[2] || ranked[Math.min(rank, ranked.length) - 1].file;
const stem = file.replace(/\.jpg$/, "");
const truth = JSON.parse(readFileSync(resolve(dir, `${stem}.truth.json`), "utf8"));
const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve(dir, file)).toString("base64")}`;
// 每 4 颗丢 1 颗（保留 75%），模拟「上一次只读出一部分」。
const known = truth.stones.filter((_, index) => index % 4 !== 0).map((stone) => ({ row: stone.row, col: stone.col, number: stone.number }));
console.log(`${file}：真值 ${truth.stones.length} 手，钉住已知号 ${known.length}（丢 ${truth.stones.length - known.length}）`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(600_000);
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-complete-mode-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-complete-mode-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ dataUrl, file, known }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const [digitReader, boardScanner] = await Promise.all([
    head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 }),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 }),
  ]);
  const blob = await (await fetch(dataUrl)).blob();
  const started = performance.now();
  const result = await mod.recognizeBoardImage(new File([blob], file, { type: "image/jpeg" }), 15, {
    skipMoveOrder: false, parallel: false,
    digitReader: digitReader ?? undefined, boardScanner: boardScanner ?? undefined,
    knownNumbers: known,
  });
  return {
    elapsedMs: Math.round(performance.now() - started),
    numbered: result.numberedMoves.map((move) => ({ row: move.row, col: move.col, number: move.number })),
    stones: result.board.flat().filter(Boolean).length,
    reason: result.moveOrderQuality?.reason ?? "",
    accepted: Boolean(result.moveOrderQuality?.accepted),
  };
}, { dataUrl, file, known });

const got = new Map(out.numbered.map((move) => [`${move.row},${move.col}`, move.number]));
const bad = truth.stones.filter((stone) => got.get(`${stone.row},${stone.col}`) !== stone.number);
console.log(`棋子 ${out.stones}/${truth.stones.length}｜复原 ${out.numbered.length}/${truth.stones.length}｜accepted=${out.accepted}｜耗时 ${out.elapsedMs}ms`);
await browser.close();
if (out.stones !== truth.stones.length || out.numbered.length !== truth.stones.length || bad.length > 0) {
  console.error(`[order-complete-restore] fail：棋子 ${out.stones}/${truth.stones.length}、复原 ${out.numbered.length}/${truth.stones.length}、错 ${bad.length} 颗`
    + (bad[0] ? `（例：(${bad[0].row},${bad[0].col}) 真${bad[0].number}→读${got.get(`${bad[0].row},${bad[0].col}`) ?? "无"}）` : "")
    + `；reason=${out.reason}`);
  process.exit(1);
}
console.log("[order-complete-restore] pass（补全路径：逐坐标手数全对、完整复原）");
