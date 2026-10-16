import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 序号识别的**基线评测**（研究文档 docs/_archive/2026-10-09/研究-复原手序方案-2026-09-26.md 的方案 A1/A2 的前置测量）。
 *
 * 为什么先做这个而不是直接接 PaddleOCR：换识别器之前，必须先有「现在读出多少」的数，
 * 否则换完也不知道是变好还是变坏。这个脚本把仓库里全部 5 张带序号语料跑一遍现有识别器，
 * 逐张对照人工标注的真值，输出三件事：
 *   · 子数对不对（复原手序的前提是局面先认对）
 *   · 序号读出集合 vs 真值集合：漏了哪些、错了哪些、错在哪个位置
 *   · 会不会触发「复原手序」——现有门控要求「数量=子数 且 恰好 1..N」，这里如实复算
 *
 * 语料的真值（人工逐张核对，见每张的 note）：
 *   numbered.png   16 子，序号 1..16 全（一位数、稀疏）        —— 简单
 *   user-98-36     36 子，序号 1..36 全（36 红=最后一手）      —— 中（两位数、较密）
 *   paper10        66 子，序号 1..66 全（66 红）               —— 难（两位数、极密、红标）
 *   paper02        43 子，只标 1..6（书谱终局图，6 红）        —— 部分编号（②类）
 *   user-99-43     43 子，只标 1..6（同上）                    —— 部分编号（②类）
 *
 * 跑法（需要 dev 服务器，识别器是模块级 TS）：
 *   npm run dev -- --port 5301
 *   QA_BASE_URL=http://localhost:5301/ node qa/recognition-number-baseline.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://localhost:5301/";
const fixtureDir = resolve("qa/fixtures/recognition");

const SAMPLES = [
  { file: "numbered.png", mime: "image/png", stones: 16, full: true, upTo: 16, note: "一位数、稀疏" },
  { file: "user-98-36.jpg", mime: "image/jpeg", stones: 36, full: true, upTo: 36, note: "两位数、较密，36 为红标最后一手" },
  { file: "paper10.jpg", mime: "image/jpeg", stones: 66, full: true, upTo: 66, note: "两位数、极密、红标——最难" },
  { file: "paper02.jpg", mime: "image/jpeg", stones: 43, full: false, upTo: 6, note: "书谱终局图，只标最后 6 手" },
  { file: "user-99-43.jpg", mime: "image/jpeg", stones: 43, full: false, upTo: 6, note: "同上（用户实拍版）" },
];

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(180_000);
await page.route("**/qa-number-baseline-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"><title>number baseline</title></head><body></body></html>",
}));

const coord = (row, col) => `${String.fromCharCode(65 + col)}${15 - row}`;

try {
  await page.goto(new URL("qa-number-baseline-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  const report = await page.evaluate(async (items) => {
    const coord = (row, col) => `${String.fromCharCode(65 + col)}${15 - row}`;
    const mod = await import("/src/image-recognition.ts");
    const out = [];
    for (const item of items) {
      const blob = await (await fetch(`data:${item.mime};base64,${item.b64}`)).blob();
      const started = performance.now();
      const result = await mod.recognizeBoardImage(new File([blob], item.file, { type: item.mime }), 15, {});
      const elapsed = Math.round(performance.now() - started);
      const stones = [];
      result.board.forEach((row, r) => row.forEach((p, c) => { if (p) stones.push(coord(r, c)); }));
      // 读出数与重建输出**分开测**（09-28）：以前这里读 numberedMoves——而识别器
      // 对拼不成完整 1..N 的图会把读出的号整段丢弃（09-26 基线的「②类读出 0」
      // 其实是这个输出行为，不是识别没读出来）。readMoveNumbers 是读出全集。
      const numbers = result.readMoveNumbers.map((move) => ({ number: move.number, at: coord(move.row, move.col), player: move.player }));
      out.push({ file: item.file, stones: stones.length, numbers, restored: result.numberedMoves.length, elapsed });
    }
    return out;
  }, SAMPLES.map((sample) => ({ ...sample, b64: readFileSync(resolve(fixtureDir, sample.file)).toString("base64") })));

  const rows = [];
  for (const sample of SAMPLES) {
    const entry = report.find((item) => item.file === sample.file);
    if (!entry) { rows.push({ ...sample, error: "识别器没返回" }); continue; }
    const readSet = new Set(entry.numbers.map((n) => n.number));
    const truthSet = new Set(Array.from({ length: sample.upTo }, (_, index) => index + 1));
    const missing = [...truthSet].filter((n) => !readSet.has(n));
    const extra = [...readSet].filter((n) => !truthSet.has(n));
    // 重复号（两颗子读成同一个号）也是错，门控会因数量对不上而拒绝重建。
    const dupes = entry.numbers.length - readSet.size;
    // 重建判定看识别器**真实输出**（restored = numberedMoves 非空且完整），
    // 不再由本脚本按门槛自行推演——推演与实现走岔就是 09-26 那轮误判的成因。
    const restored = entry.restored > 0;
    rows.push({
      ...sample,
      gotStones: entry.stones,
      stonesOk: entry.stones === sample.stones,
      readCount: entry.numbers.length,
      truthCount: sample.upTo,
      missing, extra, dupes,
      accuracy: sample.upTo ? Math.round(((sample.upTo - missing.length - extra.length) / sample.upTo) * 100) : 0,
      gateWouldRebuild: restored,
      rebuildClaim: sample.full ? (restored ? "会重建" : "不会重建") : (restored ? "⚠ 部分编号却判成完整" : "正确地不重建"),
      elapsed: entry.elapsed,
    });
  }

  console.log("文件            子数      序号读出(全集)      漏/错/重        复原手序判定      耗时");
  for (const row of rows) {
    if (row.error) { console.log(`${row.file.padEnd(16)} ${row.error}`); continue; }
    const detail = `${row.readCount}/${row.truthCount}`;
    const faults = `漏[${row.missing.join(",")}] 多[${row.extra.join(",")}] 重${row.dupes}`;
    console.log(
      `${row.file.padEnd(16)} ${(row.gotStones + (row.stonesOk ? "" : `≠${row.stones}`)).toString().padEnd(8)} ${detail.padEnd(10)} ${faults.padEnd(24)} ${row.rebuildClaim.padEnd(16)} ${row.elapsed}ms  准确率${row.accuracy}%`,
    );
  }
  const fullRows = rows.filter((row) => row.full);
  const perfect = fullRows.filter((row) => row.missing.length === 0 && row.extra.length === 0 && row.stonesOk).length;
  console.log(`\n台账：完整编号图 ${perfect}/${fullRows.length} 张做到「子数与序号全对」；②类（只标最后 k 手）应正确地不重建。`);
  console.log("这份基线就是换识别器（PaddleOCR / VLM）之前的对照，跑完记进研究文档。");
} finally {
  await browser.close();
}
