// 批量体检：用户「导入图片识别」素材夹里的全部图（2026-10-15）。
// 每张报：识别子数 / 黑白数（差 ≥2 即不可能，应用会报「黑白数量异常」）/ 读到几个号 /
// 号是否连号（缺号=漏子）/ 颜色与号奇偶是否一致（号是图上印的，可当颜色真值）。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-materials-scan.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const dir = process.env.MATERIALS_DIR || "C:/Users/ZhuanZ(无密码)/Desktop/导入图片识别";
const files = readdirSync(dir).filter((name) => /\.(jpe?g|png)$/i.test(name)).sort();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-mat.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-mat.html", base).toString(), { waitUntil: "domcontentloaded" });

console.log("文件                                  子数  黑/白  差  读数  最大号  缺号  颜色错  提示");
for (const name of files) {
  const mime = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
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
    const black = stones.filter((s) => s.cell === "black").length;
    const white = stones.length - black;
    if (!sampled || !stones.length) return { stones: stones.length, black, white, reads: null, note: fast.note };
    const spacing = Math.max(6, Math.round((g.spacingX + g.spacingY) / 2));
    const reads = reader ? await reader({ image: sampled, centers: stones.map((s) => ({ x: g.originX + s.col * g.spacingX, y: g.originY + s.row * g.spacingY })), spacing }) : null;
    const rows = stones.map((s, index) => ({ cell: s.cell, number: reads?.[index]?.[0]?.value ?? null }));
    const numbers = rows.filter((r) => r.number !== null).map((r) => r.number);
    const seen = new Set(numbers);
    const maxNumber = numbers.length ? Math.max(...numbers) : 0;
    let missing = 0;
    for (let value = 1; value <= maxNumber; value += 1) if (!seen.has(value)) missing += 1;
    const colorWrong = rows.filter((r) => r.number !== null && ((r.number % 2 === 1 ? "black" : "white") !== r.cell)).length;
    return { stones: stones.length, black, white, reads: numbers.length, maxNumber, missing, colorWrong, note: fast.note };
  }, { dataUrl: `data:${mime};base64,${readFileSync(join(dir, name)).toString("base64")}`, name, mime });
  const imbalance = Math.abs(out.black - out.white) >= 2;
  const hint = out.note && out.note.includes("黑白数量异常") ? "黑白异常" : (imbalance ? "黑白差≥2" : "");
  console.log(
    `${name.padEnd(36)} ${String(out.stones).padStart(4)} ${String(out.black).padStart(3)}/${String(out.white).padEnd(3)} ${String(out.black - out.white).padStart(3)} ` +
    `${out.reads === null ? "  -" : String(out.reads).padStart(5)} ${String(out.maxNumber ?? 0).padStart(6)} ${String(out.missing ?? 0).padStart(5)} ${String(out.colorWrong ?? 0).padStart(6)}  ${hint}`,
  );
}
await browser.close();
