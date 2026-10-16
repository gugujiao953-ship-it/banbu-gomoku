// 定位「多出来的那一颗」：智子截屏每颗子上都印着手数（真值），所以
// **读不出号的那一格就是多出来的子**。逐格用数字头读号 + 与真值 1..60 对照。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ ZHIZI_ITEM=<图> node qa/diag-zhizi-extra-cell.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const path = process.env.ZHIZI_ITEM || "qa/fixtures/materials/user-report/device/source/wechat-1792030331728.jpg";
const mime = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-extra.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-extra.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ dataUrl, name, mime }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL });
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
  let sampled = null;
  const spy = async (args) => { sampled = sampled ?? args.image; return scanner ? scanner(args) : null; };
  const blob = await (await fetch(dataUrl)).blob();
  const fast = await mod.recognizeBoardImage(new File([blob], name, { type: mime }), 15, { skipMoveOrder: true, parallel: false, boardScanner: spy });
  const g = fast.grid;
  const stones = [];
  fast.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) stones.push({ row: ri, col: ci, cell }); }));
  // 字母/数字坐标（a..o 列、1..15 行，行 1 在底）
  const label = (row, col) => `${String.fromCharCode(97 + col)}${15 - row}`;
  const centers = stones.map((s) => ({ x: g.originX + s.col * g.spacingX, y: g.originY + s.row * g.spacingY }));
  const spacing = Math.max(6, Math.round((g.spacingX + g.spacingY) / 2));
  const reads = reader && sampled ? await reader({ image: sampled, centers, spacing }) : null;
  const rows = stones.map((s, index) => {
    const read = reads?.[index] ?? null;
    const number = read?.[0]?.value ?? null;
    // 黑先手 ⇒ 奇数号必为黑、偶数号必为白；号读对了就能判颜色对不对
    const expect = number === null ? null : (number % 2 === 1 ? "black" : "white");
    return { at: label(s.row, s.col), row: s.row, col: s.col, color: s.cell, number, prob: read?.[0]?.score ?? null, expect, colorWrong: expect !== null && expect !== s.cell, top: (read ?? []).slice(0, 2).map((c) => `${c.value}@${c.score.toFixed(2)}`).join(" ") };
  });
  return { stones: rows.length, colorWrong: rows.filter((r) => r.colorWrong).length, checked: rows.filter((r) => r.expect !== null).length, stoneList: rows.map((r) => `${r.at}:${r.color === "black" ? "黑" : "白"}${r.number ?? "-"}`).join(" "), grid: `origin=(${g.originX.toFixed(1)},${g.originY.toFixed(1)}) spacing=${g.spacingX.toFixed(2)}`, rows };
}, { dataUrl: `data:${mime};base64,${readFileSync(resolve(path)).toString("base64")}`, name: path.split("/").pop(), mime });

console.log(`${path}\n  识别 ${out.stones} 子（真值应为 60）；${out.grid}`);
const noNumber = out.rows.filter((r) => r.number === null);
console.log(`\n★ 读不出号的（= 多出来的子 的嫌疑，共 ${noNumber.length} 个）：`);
for (const r of noNumber) console.log(`     ${r.at}（${r.color === "black" ? "黑" : "白"}）top=${r.top || "无"}`);
const byNumber = new Map();
for (const r of out.rows) if (r.number !== null) { const list = byNumber.get(r.number) ?? []; list.push(r.at); byNumber.set(r.number, list); }
const dup = [...byNumber].filter(([, list]) => list.length > 1);
console.log(`\n号重复的（其中一颗是假的）共 ${dup.length} 组：`);
for (const [value, list] of dup) console.log(`     号 ${value} 出现在 ${list.join(" 与 ")}`);
const missing = [];
for (let value = 1; value <= 60; value += 1) if (!byNumber.has(value)) missing.push(value);
console.log(`\n真值 1..60 里没读到的号（${missing.length} 个）：${missing.join(",")}`);
console.log(`\n全部（号@位置，按号排序）：`);
for (const [value, list] of [...byNumber].sort((a, b) => a[0] - b[0])) console.log(`  ${String(value).padStart(3)} → ${list.join(" / ")}`);
await browser.close();
