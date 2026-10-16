// 批量体检：用户手机上所有智子 App 截屏（2026-10-15 从手机相册拉回，12 张）。
//
// 这些图**每颗子上都印着手数**（1..N 连号），所以「读出号的最大值 = 真值子数」——
// 可以自动当真值用：识别子数 > 最大号 ⇒ 多了子；< ⇒ 漏了子。再列出重复号/无号格。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-zhizi-corpus.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const dir = process.env.ZHIZI_DIR || "qa/fixtures/materials/user-report/device/zhizi-corpus";
const files = readdirSync(dir).filter((name) => /\.jpe?g$/i.test(name)).sort();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-corpus.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-corpus.html", base).toString(), { waitUntil: "domcontentloaded" });

console.log("文件                        识别   读数  最大号  多/漏   重复号          无号格");
for (const name of files) {
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL });
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
    let sampled = null;
    const spy = async (args) => { sampled = sampled ?? args.image; return scanner ? scanner(args) : null; };
    const blob = await (await fetch(dataUrl)).blob();
    const fast = await mod.recognizeBoardImage(new File([blob], name, { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: false, boardScanner: spy });
    const g = fast.grid;
    const stones = [];
    fast.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) stones.push({ row: ri, col: ci, cell }); }));
    if (!sampled || !stones.length) return { count: stones.length, reads: null };
    const spacing = Math.max(6, Math.round((g.spacingX + g.spacingY) / 2));
    const reads = reader ? await reader({ image: sampled, centers: stones.map((s) => ({ x: g.originX + s.col * g.spacingX, y: g.originY + s.row * g.spacingY })), spacing }) : null;
    const numbers = stones.map((s, index) => reads?.[index]?.[0]?.value ?? null);
    return { count: stones.length, numbers, cells: stones.map((s) => `${String.fromCharCode(97 + s.col)}${15 - s.row}`) };
  }, { dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(dir, name)).toString("base64")}`, name });

  if (!out.numbers && out.count) { console.log(`${name.padEnd(28)} ${String(out.count).padStart(4)}   （未读到号：模型没起来或没抓到采样图）`); continue; }
  const numbers = out.numbers.filter((value) => value !== null);
  const maxNumber = numbers.length ? Math.max(...numbers) : 0;
  const seen = new Map();
  numbers.forEach((value, index) => { const list = seen.get(value) ?? []; list.push(out.cells[index]); seen.set(value, list); });
  const dups = [...seen].filter(([, list]) => list.length > 1).map(([value, list]) => `${value}@${list.join("+")}`);
  const noNumber = out.cells.filter((_, index) => out.numbers[index] === null);
  const missing = [];
  for (let value = 1; value <= maxNumber; value += 1) if (!seen.has(value)) missing.push(value);
  const delta = out.count - maxNumber;
  const flag = delta === 0 && dups.length === 0 && missing.length === 0 ? "  ✓" : "  ←";
  console.log(`${name.padEnd(28)} ${String(out.count).padStart(4)} ${String(numbers.length).padStart(5)} ${String(maxNumber).padStart(6)} ${(delta > 0 ? "+" : "") + delta}/${missing.length}  ${(dups.join(" ") || "-").padEnd(15)} ${noNumber.length ? noNumber.length + " 个" : "0"}${flag}`);
  if (missing.length) console.log(`${" ".repeat(30)}缺号：${missing.slice(0, 14).join(",")}${missing.length > 14 ? "…" : ""}`);
  if (noNumber.length) console.log(`${" ".repeat(30)}无号格：${noNumber.slice(0, 10).join(" ")}`);
}
await browser.close();
