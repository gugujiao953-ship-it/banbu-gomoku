// 真实素材批量体检（2026-10-07，用户报「普通图也一很多不能识别」）：
// 对服务器语料抽样的真实图（比赛棋谱文档/题书扫描等）逐张跑静态识别，
// 报「是否找到网格 / 子数 / 黑白 / note 里的异常标记」，并统计失败分布。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-real-batch.mjs [数量]
import { chromium } from "playwright";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const limit = Number(process.argv[2] || 60);
const root = resolve("../经济学知识/15_半步五子棋/_realpid-sample");
const files = globSync("**/*.{jpg,jpeg,png}", { cwd: root }).sort().slice(0, limit);
const mimeOf = (name) => (/\.png$/i.test(name) ? "image/png" : "image/jpeg");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-realbatch-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-realbatch-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = files.map((f) => ({ name: f.split("/").pop().slice(0, 26), dir: f.split("/").slice(-2)[0].slice(0, 18), mime: mimeOf(f), dataUrl: `data:${mimeOf(f)};base64,${readFileSync(resolve(root, f)).toString("base64")}` }));
const rows = await page.evaluate(async (items) => {
  const out = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.name, { type: item.mime });
    const row = { name: item.name, dir: item.dir, error: null };
    try {
      const r = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
      let black = 0, white = 0;
      r.board.forEach((line) => line.forEach((cell) => { if (cell === "black") black += 1; else if (cell === "white") white += 1; }));
      row.size = `${r.imageWidth}x${r.imageHeight}`;
      row.stones = black + white;
      row.bw = `${black}/${white}`;
      row.note = r.note;
      row.conf = Math.round(r.confidence * 100) / 100;
      row.grid = r.grid ? Math.round(Math.min(r.grid.spacingX, r.grid.spacingY)) : 0;
    } catch (error) {
      row.error = String(error).slice(0, 60);
    }
    out.push(row);
  }
  return out;
}, payloads);

const bad = [];
let noGrid = 0, tiny = 0, imbalance = 0, errs = 0, phase = 0;
console.log("【逐图】图 | 尺寸 | 子(黑/白) | 间距 | 把握 | note");
for (const row of rows) {
  if (row.error) { errs += 1; bad.push(row); console.log(`${row.dir}/${row.name} | 出错 ${row.error}`); continue; }
  const note = row.note.replace(/；+/g, "；").slice(0, 46);
  console.log(`${row.dir}/${row.name} | ${row.size} | ${row.stones}(${row.bw}) | ${row.grid} | ${row.conf} | ${note}`);
  const flat = row.note;
  if (/未检测到网格线/.test(flat)) noGrid += 1;
  if (row.stones < 12) tiny += 1;
  if (/黑白数量异常/.test(flat)) imbalance += 1;
  if (/相位/.test(flat)) phase += 1;
}
console.log(`\n【汇总】${rows.length} 张：出错 ${errs}、无网格 ${noGrid}、子数<12 ${tiny}、黑白异常 ${imbalance}、触发相位校正 ${phase}`);
await browser.close();
