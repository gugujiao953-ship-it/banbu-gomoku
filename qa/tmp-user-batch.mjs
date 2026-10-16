// 用户图批量体检（2026-10-07）：跑桌面「导入图片识别」整个文件夹，
// 逐张报「格子/棋子/读出号/是否复原」以及可疑信号，定位「普通图认不全」的主流失败。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-user-batch.mjs
import { chromium } from "playwright";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const dir = "C:/Users/ZhuanZ(无密码)/Desktop/导入图片识别";
const files = globSync("*.{jpg,jpeg,png,webp}", { cwd: dir }).sort();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-userbatch-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-userbatch-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const mimeOf = (name) => (/\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg");
const payloads = files.map((f) => ({ name: f, mime: mimeOf(f), dataUrl: `data:${mimeOf(f)};base64,${readFileSync(resolve(dir, f)).toString("base64")}` }));

const rows = await page.evaluate(async (items) => {
  const out = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const digitReader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.name, { type: item.mime });
    const row = { name: item.name, error: null, size: "", fast: null, slow: null };
    try {
      const fast = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
      let black = 0, white = 0;
      fast.board.forEach((line) => line.forEach((cell) => { if (cell === "black") black += 1; else if (cell === "white") white += 1; }));
      row.size = `${fast.imageWidth}x${fast.imageHeight}→${fast.gridCanvas?.width}x${fast.gridCanvas?.height}`;
      row.fast = { stones: black + white, black, white, note: fast.note.slice(0, 60) };
      const slow = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: false, parallel: false, boardScanner: scanner ?? undefined, digitReader: digitReader ?? undefined });
      const numbers = slow.readMoveNumbers.map((m) => m.number).sort((a, b) => a - b);
      row.slow = {
        stones: slow.board.flat().filter(Boolean).length,
        restored: slow.numberedMoves.length,
        read: slow.readMoveNumbers.length,
        numbers: numbers.join(","),
        note: slow.note.slice(0, 90),
      };
    } catch (error) {
      row.error = String(error).slice(0, 80);
    }
    out.push(row);
  }
  return out;
}, payloads);

console.log("图 | 尺寸 | 静态:子(黑/白) | 复原:子/复原/读号 | 读出的号 | 备注");
for (const row of rows) {
  if (row.error) { console.log(`${row.name} | 出错: ${row.error}`); continue; }
  console.log(`${row.name} | ${row.size} | ${row.fast.stones}(${row.fast.black}/${row.fast.white}) | ${row.slow.stones}/${row.slow.restored}/${row.slow.read} | ${row.slow.numbers.slice(0, 70)} | ${row.slow.restored ? "完整复原✓" : row.slow.note.slice(0, 54)}`);
}
await browser.close();
