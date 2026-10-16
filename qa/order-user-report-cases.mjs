// 用户两张报障图的常驻门禁（2026-10-13）。两张同属「纸面上不可能靠调阈值变好」的硬骨头，
// 各自钉住一个具体的回归：
//
//  A. zhizi-dense-101.jpg（智子 App 截屏，864×1920，近满盘）
//     用户原话「识谱偏差」——根因不是识别，而是**网格相位**：检测阶段本来找对了正确相位
//     （画布 y=323.1，评分 359.7），却被「±2 格平移微调」以 360.0 反超 **0.08%** 换成了
//     y=413.6，整盘手序错位 2 行。修法是给平移采纳加 1% 余量（GRID_CORRECTION_MARGIN）。
//     断言用图上可核对的三个锚点钉住相位：1 在 O1(14,14)、2 在 (14,10)、101 在 (10,7)。
//     并断言**不得复原**：这张图只有一部分子印了号（放 5 倍能看到 (0,0)(0,1)(0,2)(0,3)
//     等是光面），完整 1..N 在结构上不存在——若哪天它「复原成功」了，那是把部分编号
//     当成了完整手序，属于必须拦住的红线（错手序看起来和对手序一模一样）。
//
//  B. book-blur-71.jpg（模糊书谱，282×267、71 手）
//     用户原话「复原不全」——两层原因，都已修：
//     ① 显示仲裁：14 颗子的模板读数是错的（10/18/40/14/1/8/64…）且模板在近分候选间摇摆
//        （边际 0.001–0.026），而数字头读出的是真值且置信 ≥0.997——旧规则一律丢掉这颗子，
//        清单只报 57/71。现改为「模板边际极薄 + 数字头强读（≥0.9）→ 信数字头」。
//     ② 多认一颗子：识别出 72 子而号的取值范围只到 71，装配在数学上无解。现补一条
//        「同一号被两处高置信声称 → 排除较弱那个声明所在子后重装配」的补救。
//     断言：完整复原 1..71、被排除的那颗若是 (5,0) 则如实在结果里标出、
//     以及那 14 个曾被丢掉的号必须在读数里（逐个钉住，防止显示仲裁再退回旧行为）。
//
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ node qa/order-user-report-cases.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const CASES = [
  { id: "zhizi-dense-101", file: "qa/fixtures/materials/user-report/zhizi-dense-101.jpg" },
  { id: "book-blur-71", file: "qa/fixtures/materials/user-report/book-blur-71.jpg" },
];

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
await page.route("**/qa-user-report-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));

try {
  await page.goto(new URL("qa-user-report-host.html", base).toString(), { waitUntil: "domcontentloaded" });
  const report = await page.evaluate(async (items) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const scanner = await head.createBoardScanner({
      modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
      wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
    });
    const out = [];
    for (const item of items) {
      const blob = await (await fetch(item.dataUrl)).blob();
      const result = await mod.recognizeBoardImage(new File([blob], item.id + ".jpg", { type: "image/jpeg" }), 15, {
        skipMoveOrder: false, parallel: false, boardScanner: scanner ?? undefined,
      });
      const stones = [];
      result.board.forEach((line, row) => line.forEach((p, col) => { if (p) stones.push({ row, col, player: p }); }));
      out.push({
        id: item.id,
        stones: stones.length,
        grid: result.grid ? { x: Math.round(result.grid.originX * 10) / 10, y: Math.round(result.grid.originY * 10) / 10, sp: Math.round(result.grid.spacingX * 10) / 10 } : null,
        readAt: result.readMoveNumbers.map((m) => ({ key: `${m.row},${m.col}`, number: m.number })),
        numbered: result.numberedMoves.map((m) => ({ key: `${m.row},${m.col}`, number: m.number })),
        skipped: result.numberedSkippedStone,
        note: result.note,
      });
    }
    return out;
  }, CASES.map((item) => ({ id: item.id, dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(item.file)).toString("base64")}` })));

  // ---- A. 智子截屏：相位 + 不得复原 ----
  const zhizi = report.find((row) => row.id === "zhizi-dense-101");
  const zhiziRead = new Map(zhizi.readAt.map((m) => [m.number, m.key]));
  check("A 网格相位：号 1 落在 O1(14,14)", zhiziRead.get(1) === "14,14", `实得 ${zhiziRead.get(1) ?? "未读出"}（网格原点 ${zhizi.grid?.x},${zhizi.grid?.y} 格距 ${zhizi.grid?.sp}）`);
  check("A 网格相位：号 2 落在 (14,10)", zhiziRead.get(2) === "14,10", `实得 ${zhiziRead.get(2) ?? "未读出"}`);
  check("A 网格相位：号 101 落在 (10,7)", zhiziRead.get(101) === "10,7", `实得 ${zhiziRead.get(101) ?? "未读出"}`);
  check("A 棋子数接近真值（190–196）", zhizi.stones >= 190 && zhizi.stones <= 196, `识别 ${zhizi.stones} 子`);
  check("A 部分编号的图**不得**被判成完整手序", zhizi.numbered.length === 0,
    zhizi.numbered.length ? `竟复原了 ${zhizi.numbered.length} 手（部分编号被当成完整手序＝错手序）` : `如实拒绝，note：${zhizi.note.slice(0, 60)}…`);

  // ---- B. 模糊书谱：完整复原 1..71 ----
  const book = report.find((row) => row.id === "book-blur-71");
  const bookNumbers = book.numbered.map((m) => m.number).sort((a, b) => a - b);
  check("B 完整复原第 1..71 手", bookNumbers.length === 71 && bookNumbers.every((n, i) => n === i + 1),
    `复原 ${bookNumbers.length} 手${bookNumbers.length ? `，最大 ${bookNumbers[bookNumbers.length - 1]}` : ""}`);
  check("B 被排除编号的子如实标出（若存在应为 5,0）", book.skipped === null || (book.skipped.row === 5 && book.skipped.col === 0),
    `skipped=${JSON.stringify(book.skipped)}（棋子 ${book.stones}）`);
  // 那 14 个曾被显示仲裁丢掉的号（值 → 格），逐个钉住
  const LOST = [[70, "1,8"], [15, "3,5"], [46, "3,12"], [14, "4,5"], [40, "4,10"], [42, "5,1"], [13, "5,4"], [28, "6,2"], [19, "6,4"], [44, "6,8"], [3, "6,9"], [51, "6,11"], [5, "8,5"], [6, "8,6"], [54, "8,11"]];
  const bookAt = new Map(book.readAt.map((m) => [m.number, m.key]));
  const lostBad = LOST.filter(([value, key]) => bookAt.get(value) !== key);
  check("B 曾被丢弃的 15 个号全部读出且位置正确", lostBad.length === 0,
    lostBad.length ? `错 ${lostBad.length} 个：${lostBad.map(([v, k]) => `号${v} 应在 ${k} 实得 ${bookAt.get(v) ?? "无"}`).join("；")}` : "全部一致");
} finally {
  await browser.close();
}

if (failed > 0) {
  console.error(`\n[order-user-report-cases] fail：${failed} 条断言未通过`);
  process.exit(1);
}
console.log("\n[order-user-report-cases] pass");
