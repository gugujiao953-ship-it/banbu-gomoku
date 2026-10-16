// 「复原手序-本地」在**高段位密盘**上必须逐坐标完整复原（2026-10-12）。
//
// 为什么单独立这条门禁：这是用户报的「复原手序确实还不行」的现场。2026-10-12 之前，
// 188–212 手的自家渲染棋谱一张都复原不了（读出号只有 15%–88%，按手数分档断崖下跌），
// 根因有两层，都不在模型容量上：
//   ① 主裁剪半窗被 DIGIT_CROP_HALF_CAP=34 砍到「窗口 = 2×34px」，而训练侧三套数据
//      生成器**全部**是「半窗 = 格距」（CTX=2.0，2×2 格上下文）。1200px 图上格距 66，
//      于是喂给模型的窗口比训练时小一半 —— 真值坐标下 half=格距 读出 588/588，
//      half=34 只有 316/588。
//   ② 模板「自信但读错」的子，数字头的读数此前**只记录不进装配池**，于是装配器手里
//      只有那份错候选，凑不出唯一 1..N，整盘如实拒绝。
// 修好之后：本门禁这 3 张（188–205 手、三档宽度）逐坐标全对、完整复原 1..N。
//
// 断言（任一不成立即 exit 1）：
//   · 棋子集合与真值逐格一致（行/列/颜色，不许多子少子也不许错色）
//   · numberedMoves 数量 = 真值子数，且**按图上序号**复原（不是按局面导入）
//   · 每颗子读出的手数与真值逐个一致
// 三档宽度都测：1200 与 820 的格距（66/45）都大于旧的 34 上限——这条正是防止
// DIGIT_CROP_HALF_CAP 被当成「主尺度」重新写回去的钉子。
//
// 默认取**手数第三高**的那张（215 手）而不是最高的：215 手及以下三档宽度实测全过，
// 是「保证」；≥221 手（占用率 98%+，即满盘只剩 2–4 个空点）仍会**逐宽度不稳定**地
// 如实拒绝（实测 self-008@221：1200 过、820 拒；self-011@223：1200 拒、820/600 过）——
// 那三颗子数字头的首选自信读错（178↔128、177↔127 一类十位混淆），装配虽然凑出了唯一
// 1..N，但被「最低匹配分 / 首选损失」两道门正确拦下。按本仓库既有惯例（见
// recognition-input-quality 的注释：「门禁只钉住保证，不去钉住已知的脆弱点」），
// 不把这种边缘样本写进基线；要排查它用 ORDER_GATE_BOARD=1 或 2。
//
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/order-hi-ply-restore.mjs
//   ORDER_GATE_BOARD=1 → 换手数最高的那张（223 手，已知 1200 会如实拒绝，用于排查）
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const dir = resolve("qa/fixtures/materials/self-hi-ply");
const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
// 段位最高的那张（手数最多 = 密盘最难），再取它的三档宽度。
const ranked = index.filter((item) => item.width === 1200).slice().sort((left, right) => right.stones - left.stones);
/** 默认 3 = 手数第三高（215 手，三档宽度实测全过）；1/2 = 221/223 手的满盘边缘（见文件头）。 */
const rank = Math.max(1, Number(process.env.ORDER_GATE_BOARD || 3));
const board = ranked[Math.min(rank, ranked.length) - 1];
const stem = board.file.replace(/@\d+\.jpg$/, "");
const widths = [1200, 820, 600];
const cases = widths.map((width) => {
  const file = `${stem}@${width}.jpg`;
  return {
    file, width,
    dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(dir, file)).toString("base64")}`,
    truth: JSON.parse(readFileSync(resolve(dir, `${stem}@${width}.truth.json`), "utf8")),
    spacingNote: width === 1200 ? "格距≈66（旧上限 34 在这里砍半）" : width === 820 ? "格距≈45（同样超过旧上限）" : "格距≈33（旧上限对它无影响）",
  };
});
console.log(`高段位复原门禁：${stem}（${board.stones} 手）× 宽度 ${widths.join("/")}`);
for (const item of cases) console.log(`  ${item.file}  ${item.spacingNote}`);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(600_000);
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-order-hi-ply-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));

try {
  await page.goto(new URL("qa-order-hi-ply-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const report = await page.evaluate(async (items) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    // 与生产 App 同一条路径：数字头读号器 + 板面扫描器都挂上（App.tsx loadRecognitionEnhancement）。
    const [digitReader, boardScanner] = await Promise.all([
      head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 }),
      head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 }),
    ]);
    const out = [];
    for (const item of items) {
      const blob = await (await fetch(item.dataUrl)).blob();
      const started = performance.now();
      const result = await mod.recognizeBoardImage(new File([blob], item.file, { type: "image/jpeg" }), 15, {
        skipMoveOrder: false, parallel: false,
        digitReader: digitReader ?? undefined,
        boardScanner: boardScanner ?? undefined,
      });
      const stones = [];
      result.board.forEach((line, row) => line.forEach((player, col) => { if (player) stones.push({ row, col, player }); }));
      out.push({
        file: item.file,
        elapsedMs: Math.round(performance.now() - started),
        stones,
        numbered: result.numberedMoves.map((move) => ({ row: move.row, col: move.col, number: move.number, player: move.player })),
        scans: { reader: Boolean(digitReader), scanner: Boolean(boardScanner) },
      });
    }
    return out;
  }, cases.map(({ file, dataUrl }) => ({ file, dataUrl })));

  for (const [slot, item] of cases.entries()) {
    const entry = report[slot];
    const truth = item.truth.stones;
    check(`[${item.file}] 增强链路就位（读号器 + 扫描器）`, entry.scans.reader && entry.scans.scanner,
      `reader=${entry.scans.reader} scanner=${entry.scans.scanner}`);
    const truthByKey = new Map(truth.map((stone) => [`${stone.row},${stone.col}`, stone]));
    const gotByKey = new Map(entry.stones.map((stone) => [`${stone.row},${stone.col}`, stone]));
    const missed = [...truthByKey.keys()].filter((key) => !gotByKey.has(key));
    const extra = [...gotByKey.keys()].filter((key) => !truthByKey.has(key));
    const colorBad = [...gotByKey.entries()].filter(([key, stone]) => truthByKey.get(key) && truthByKey.get(key).player !== stone.player);
    check(`[${item.file}] 棋子逐格一致（${truth.length} 子）`, missed.length === 0 && extra.length === 0 && colorBad.length === 0,
      `漏${missed.length} 多${extra.length} 错色${colorBad.length}`);
    check(`[${item.file}] 完整按序号复原第 1..${truth.length} 手`, entry.numbered.length === truth.length,
      `numberedMoves=${entry.numbered.length}（耗时 ${entry.elapsedMs}ms）`);
    const gotByNumber = new Map(entry.numbered.map((move) => [`${move.row},${move.col}`, move.number]));
    const numberBad = truth.filter((stone) => gotByNumber.get(`${stone.row},${stone.col}`) !== stone.number);
    check(`[${item.file}] 逐坐标手数与真值全对`, numberBad.length === 0,
      numberBad.length ? `错 ${numberBad.length} 颗，例：(${numberBad[0].row},${numberBad[0].col}) 真${numberBad[0].number}→读${gotByNumber.get(`${numberBad[0].row},${numberBad[0].col}`) ?? "无"}` : "全部一致");
  }
} finally {
  await browser.close();
}

if (failed > 0) {
  console.error(`\n[order-hi-ply-restore] fail：${failed} 条断言未通过`);
  process.exit(1);
}
console.log("\n[order-hi-ply-restore] pass");
