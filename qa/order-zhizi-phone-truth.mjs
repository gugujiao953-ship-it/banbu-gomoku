// 门禁：用户手机上那张智子截屏（2026-10-13 19:01 拍）**逐坐标真值**（2026-10-15 立）。
//
// 为什么单独立这一条：这张图每颗子上都印着手数 1..60，**真值就是 60 颗**，
// 而应用识别成 61 颗（多一颗在 h1：空木纹 + 棋盘下边印的坐标字母「H」）。
// 旧门禁 order-user-report-cases 对智子图只断言「子数落在 190–196」，太松，把这种
// 「稳定多一颗」放过去了。这条按逐坐标断言，专门守它。
//
// 真值来源：图上印的手数（1..60）+ 人工核对（h1 无子，放大图见
// qa/tmp-zhizi-extra-locate.png），坐标按 a..o / 1..15（1 在底）↔ (row=15-号, col=字母)。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/order-zhizi-phone-truth.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const file = "qa/fixtures/materials/user-report/device/zhizi-phone-1013.jpg";

/** 真值：手数 → 坐标串（字母 + 行号，行 1 在底）。**共 60 颗。** */
const TRUTH = {
  1: "k6", 2: "j7", 3: "g7", 4: "j8", 5: "j9", 6: "k8", 7: "i6", 8: "k9", 9: "i8", 10: "k10",
  11: "k7", 12: "i7", 13: "h6", 14: "j6", 15: "l10", 16: "k5", 17: "l4", 18: "j4", 19: "j5", 20: "m7",
  21: "n8", 22: "k11", 23: "k12", 24: "g8", 25: "j11", 26: "j10", 27: "l8", 28: "l12", 29: "i9", 30: "f8",
  31: "h8", 32: "f6", 33: "l11", 34: "l9", 35: "m10", 36: "j13", 37: "n9", 38: "o8", 39: "h5", 40: "h7",
  41: "l13", 42: "i10", 43: "i4", 44: "i3", 45: "l6", 46: "l7", 47: "j3", 48: "g6", 49: "h3", 50: "g2",
  51: "l3", 52: "h2", 53: "g1", 54: "l5", 55: "m4", 56: "k2", 57: "k4", 58: "m2", 59: "j2", 60: "n6",
};
const toCell = (at) => {
  const col = at.charCodeAt(0) - 97;
  const number = Number(at.slice(1));
  return `${14 - (number - 1)},${col}`; // row index（0 在顶）
};

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
await page.route("**/qa-zhizitruth.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-zhizitruth.html", base).toString(), { waitUntil: "domcontentloaded" });
const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve(file)).toString("base64")}`;
const out = await page.evaluate(async ({ dataUrl, name }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
  const blob = await (await fetch(dataUrl)).blob();
  const result = await mod.recognizeBoardImage(new File([blob], name, { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: true, boardScanner: scanner ?? undefined });
  const cells = [];
  const colorAt = {};
  result.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) { cells.push({ row: ri, col: ci, cell }); colorAt[`${ri},${ci}`] = cell; } }));
  return { stones: cells.length, cells, colorAt, note: result.note };
}, { dataUrl, name: file.split("/").pop() });

const truthCells = Object.values(TRUTH).map(toCell);
const got = new Set(out.cells.map((c) => `${c.row},${c.col}`));
const truth = new Set(truthCells);
assert(truth.size === 60, "真值表本身不是 60 颗，检查 TRUTH");
console.log(`[zhizi-phone] 识别 ${out.stones} 子（真值 60）`);
const extra = [...got].filter((cell) => !truth.has(cell));
const missed = [...truth].filter((cell) => !got.has(cell));
assert(out.stones === 60, `子数应为 60，实得 ${out.stones}`);
assert(extra.length === 0, `多出来的格：${extra.join(" ")}`);
assert(missed.length === 0, `漏掉的格：${missed.join(" ")}`);
assert(!got.has("14,7"), "h1 是假子（空木纹+坐标字母 H），不应被识别成子");
// 颜色：黑先手 ⇒ 奇数手必为黑、偶数手必为白。号是图上印的（真值），所以能逐格核颜色，
// 专防用户 2026-10-15 报的「白的被识别成黑的」。
const colorWrong = [];
for (const [number, at] of Object.entries(TRUTH)) {
  const cell = toCell(at);
  const expect = Number(number) % 2 === 1 ? "black" : "white";
  const got = out.colorAt[cell];
  if (got && got !== expect) colorWrong.push(`${at}(号${number} 应${expect === "black" ? "黑" : "白"} 实${got === "black" ? "黑" : "白"})`);
}
console.log(`[zhizi-phone] 颜色核对：60 格中不符 ${colorWrong.length} 格 ${colorWrong.slice(0, 8).join(" ")}`);
assert(colorWrong.length === 0, `颜色识别错误：${colorWrong.join(" ")}`);
assert(pageErrors.length === 0, `页面错误：${pageErrors.join(" | ")}`);
console.log("[zhizi-phone] pass（60/60 逐坐标一致、颜色按号全部正确、h1 空）");
await browser.close();
