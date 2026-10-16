// 网页棋盘域基准（用户 10-07 指定：renjuportal.com 这类网站里的棋子）。
// 素材由 qa/tmp-grab-renjuportal.mjs 采集，附带页面内嵌真值（每手 x/y/color/number）。
// 分开量两件事：① 棋子（有没有、黑白对不对）② 序号（读出来的号对不对）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/renjuportal-bench.mjs [--parallel]
import { chromium } from "playwright";
import { existsSync, globSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
// 基准目录可用 BENCH_DIR 覆盖（默认网页棋盘；自家渲染语料用 self-render）。
const dir = resolve(process.env.BENCH_DIR || "qa/fixtures/materials/renjuportal");
const parallel = process.argv.includes("--parallel");
const limit = Number(process.env.BENCH_LIMIT || 0);
const truthFiles = globSync("*.truth.json", { cwd: dir }).sort().slice(0, limit || undefined);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-rp-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-rp-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = truthFiles.map((truthFile) => {
  // 图可能是 png 或 jpg（自家渲染语料存 JPEG，贴近真实截图），两种都认。
  const stem = truthFile.replace(/\.truth\.json$/, "");
  const imageFile = existsSync(resolve(dir, `${stem}.png`)) ? `${stem}.png` : `${stem}.jpg`;
  return { truthFile, imageFile, truth: JSON.parse(readFileSync(resolve(dir, truthFile), "utf8")), dataUrl: `data:${/\.jpe?g$/i.test(imageFile) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(dir, imageFile)).toString("base64")}` };
});

const rows = await page.evaluate(async ({ items, candidateModelUrl }) => {
  const mod = await import("/src/image-recognition.ts");
  const out = [];
  // 与生产 App 同一条路径（App.tsx loadRecognitionEnhancement）：digit-head 模型
  // 扫描器 + 数字阅读器都挂上，否则量到的是「模板匹配」这条旧路，不代表线上表现。
  const head = await import("/src/features/record/digit-head.ts");
  const [digitReader, boardScanner] = await Promise.all([
    // 候选模型由 Node 侧经 evaluate 参数传进来（页面里没有 process.env）。
    head.createDigitHeadReader({ modelUrl: candidateModelUrl || head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
    head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: candidateModelUrl || head.DIGIT_HEAD_MODEL_URL }).catch(() => null),
  ]);
  // 诊断（2026-10-08）：把候选模型通道是否生效直接打出来——此前踩过「会话缓存静默复用」
  // 与「reader 建失败静默回落模板」两种坑，导致四个候选量出完全相同的数字。
  console.error(`[bench] 候选=${candidateModelUrl || "(现役)"} reader=${Boolean(digitReader)} scanner=${Boolean(boardScanner)}`);
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const started = performance.now();
    const result = await mod.recognizeBoardImage(new File([blob], item.imageFile, { type: "image/png" }), 15, {
      skipMoveOrder: false,
      parallel: item.parallel,
      digitReader: digitReader ?? undefined,
      boardScanner: boardScanner ?? undefined,
    });
    const elapsedMs = Math.round(performance.now() - started);
    const detected = new Map();
    result.board.forEach((line, row) => line.forEach((cell, col) => { if (cell) detected.set(`${row},${col}`, cell); }));
    const numbers = new Map();
    for (const move of result.readMoveNumbers) numbers.set(`${move.row},${move.col}`, move.number);
    out.push({
      name: item.imageFile, elapsedMs,
      boardSize: result.boardSize,
      confidence: Math.round(result.confidence * 100) / 100,
      grid: result.grid ? { sx: Math.round(result.grid.spacingX), sy: Math.round(result.grid.spacingY) } : null,
      gridFallback: Boolean(result.gridFallback),
      note: result.note,
      detected: [...detected.entries()],
      numbers: [...numbers.entries()],
      moveOrderAccepted: Boolean(result.moveOrderQuality?.accepted),
      numberedMoves: result.numberedMoves.length,
    });
  }
  return out;
}, { items: payloads.map(({ truthFile, imageFile, dataUrl }) => ({ truthFile, imageFile, dataUrl, parallel })), candidateModelUrl: process.env.BENCH_DIGIT_MODEL ? new URL(process.env.BENCH_DIGIT_MODEL, base).href : "" });

let stoneTotal = 0, stoneHit = 0, playerBad = 0, falsePos = 0;
let numberTotal = 0, numberHit = 0, numberWrong = 0, numberMissing = 0;
console.log("图 | 尺寸 | 网格 | 时间 | 棋子 真/检/漏/多/错色 | 序号 真/对/错/漏 | 复原");
for (const [index, row] of rows.entries()) {
  const truth = payloads[index].truth;
  const truthMap = new Map(truth.stones.map((stone) => [`${stone.row},${stone.col}`, stone]));
  const detected = new Map(row.detected);
  let hit = 0, badPlayer = 0, extra = 0;
  for (const [key, cell] of detected) {
    const stone = truthMap.get(key);
    if (!stone) { extra += 1; continue; }
    if (stone.player === cell) hit += 1; else badPlayer += 1;
  }
  const missed = truthMap.size - hit - badPlayer;
  const numberMap = new Map(row.numbers);
  let numberOk = 0, numberBad = 0;
  for (const [key, stone] of truthMap) {
    const read = numberMap.get(key);
    if (read === undefined) continue;
    if (read === stone.number) numberOk += 1; else numberBad += 1;
  }
  stoneTotal += truthMap.size; stoneHit += hit; playerBad += badPlayer; falsePos += extra;
  numberTotal += truthMap.size; numberHit += numberOk; numberWrong += numberBad;
  numberMissing += truthMap.size - numberOk - numberBad;
  console.log(`${row.name} | ${row.boardSize}路 ${row.grid ? `${row.grid.sx}x${row.grid.sy}` : "无网格"}${row.gridFallback ? "(退)" : ""} | ${row.elapsedMs}ms | ${truthMap.size}/${hit}/${missed}/${extra}/${badPlayer} | ${truthMap.size}/${numberOk}/${numberBad}/${truthMap.size - numberOk - numberBad} | ${row.moveOrderAccepted ? `✓${row.numberedMoves}` : "✗"}`);
  const note = row.note.replace(/\s+/g, " ").slice(0, 90);
  if (missed + extra + badPlayer + numberBad > 0 || row.gridFallback) console.log(`    note: ${note}`);
}
console.log(`\n合计：棋子 真值 ${stoneTotal} 命中 ${stoneHit}（${Math.round(stoneHit / stoneTotal * 1000) / 10}%）漏 ${stoneTotal - stoneHit - playerBad} 多 ${falsePos} 错色 ${playerBad}`);
console.log(`      序号 真值 ${numberTotal} 对 ${numberHit}（${Math.round(numberHit / numberTotal * 1000) / 10}%）错 ${numberWrong} 漏 ${numberMissing}`);
await browser.close();
