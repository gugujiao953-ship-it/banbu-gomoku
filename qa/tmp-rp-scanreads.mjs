// 验证读号改造是否生效：直接用 createBoardScanner（digitCenters = 真值子）看扫描器
// 逐格最终给出的 digit / digitProb / digitTop，与真值对比。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-rp-scanreads.mjs rp-score-10
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 用法：node qa/tmp-rp-scanreads.mjs <图片路径> <真值 json 路径>
const imagePath = process.argv[2] || resolve("qa/fixtures/materials/renjuportal/rp-score-10.png");
const truthPath = process.argv[3] || imagePath.replace(/\.png$/, ".truth.json");
const name = imagePath.split(/[\/]/).pop();
const truth = JSON.parse(readFileSync(resolve(truthPath), "utf8"));
// 真值三种写法都吃：stones[]（网页棋盘）、moves[]（远程图）、coordinates[]+start（书谱）。
const stones = truth.stones
  ?? (truth.moves?.length ? truth.moves.map((move) => ({ row: move.row, col: move.col, number: move.number ?? 0 })) : null)
  ?? (truth.coordinates || []).map((coord, index) => ({ row: 15 - parseInt(coord.slice(1), 10), col: coord.charCodeAt(0) - 65, number: (truth.start || 1) + index }));
const dataUrl = `data:${/\.jpe?g$/i.test(imagePath) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(imagePath)).toString("base64")}`;
const base = process.env.QA_BASE_URL || "http://localhost:5173/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-rp-scan-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-rp-scan-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const report = await page.evaluate(async ({ dataUrl, stones }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], name, { type: blob.type });
  const first = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
  const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const grid = first.grid;
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
  if (!scanner) return { error: "扫描器不可用" };
  const t0 = performance.now();
  const cells = await scanner({
    image: sampled, grid, boardSize: 15, needDigits: true,
    digitCenters: stones.map((stone) => ({ row: stone.row, col: stone.col })),
    digitSpacing: Math.round((grid.spacingX + grid.spacingY) / 2),
    digitMaxNumber: stones.length,
  });
  const ms = Math.round(performance.now() - t0);
  if (!cells) return { error: "扫描返回空" };
  const out = stones.map((stone) => {
    const cell = cells[stone.row * 15 + stone.col];
    return { n: stone.number, at: `${stone.row},${stone.col}`, d: cell?.digit ?? -9, p: Math.round((cell?.digitProb ?? 0) * 100) / 100, top: (cell?.digitTop ?? []).slice(0, 3).map((c) => `${c.value}:${Math.round(c.score * 100)}`) };
  });
  return { out, ms };
}, { dataUrl, stones });

if (report.error) { console.log("错误:", report.error); await browser.close(); process.exit(0); }
let hit = 0;
for (const row of report.out) {
  if (row.d === row.n) hit += 1;
  const flag = row.d === row.n ? "✓" : "✗";
  console.log(`  ${flag} #${String(row.n).padStart(2)} @${row.at.padEnd(6)} 读出 ${String(row.d).padStart(3)}(${row.p}) top ${row.top.join(",")}`);
}
console.log(`扫描器逐格读号：${hit}/${report.out.length}（${Math.round(hit / report.out.length * 100)}%）  扫描耗时 ${report.ms}ms`);
await browser.close();
