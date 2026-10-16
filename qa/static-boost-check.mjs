// 静态识谱补位验证（2026-10-07）：同一批语料各跑两次 recognizeBoardImage——
// 默认（skipMoveOrder:true）与「+cell-cls 补位」（同样 skip:true，只补有子不读号），
// 看补位是否提升召回、有没有引入假阳（棋子数变化 + 与已知真值对比）。
// 用法：QA_BASE_URL=http://localhost:5173/ node qa/static-boost-check.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const items = [
  { file: "recognition/numbered.png", mime: "image/png", expect: 16 },
  { file: "recognition/user-98-36.jpg", mime: "image/jpeg", expect: 36 },
  { file: "recognition/paper10.jpg", mime: "image/jpeg", expect: 66 },
  { file: "recognition/paper02.jpg", mime: "image/jpeg", expect: 43 },
  { file: "recognition/user-99-43.jpg", mime: "image/jpeg", expect: 43 },
  { file: "recognition/remote-image1.jpeg", mime: "image/jpeg", expect: 57 },
  { file: "materials/fy11.png", mime: "image/png", expect: 16 },
  { file: "materials/fy42.png", mime: "image/png", expect: 18 },
  { file: "materials/remote-img-011.png", mime: "image/png", expect: 16 },
  { file: "materials/remote-image2.png", mime: "image/png", expect: 89 },
  { file: "materials/m1000_p40.png", mime: "image/png", expect: null },
  // 用户那张外部 App 截图（Chinese National Open 2010，15 手）：黑子白字、白子黑字、
  // 最后一手是红字。2026-10-07 提速/黑子读号专项的标尺图。
  { file: "materials/user-cno2010-15.jpg", mime: "image/jpeg", expect: 15 },
  // 木刻风棋盘（智子风格截图，2026-10-07 用户报「识别一团糟」的回归图）：
  // 像素法真值 33 子（24 黑 9 白）；应用现在 34——多的一颗是红字「A」标记（E12）
  // 被当成黑子，属已知残留（彩色标记过滤在「标记压着邻子边缘」时不触发）。
  { file: "materials/mm-wood-zhizi.jpg", mime: "image/jpeg", expect: 34 },
  // 模糊小图（282×267 的 71 手题图，2026-10-07 用户报「棋子能认、手序读不出」）：
  // 位置识别正确（71–72），读号是已知短板（实测 31/71）——要小字号/低对比域的训练轮。
  { file: "materials/blur-num71.jpg", mime: "image/jpeg", expect: 71 },
];
const fixtureDir = resolve("qa/fixtures");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-boost-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
}));
await page.goto(new URL("qa-boost-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = items.map((item) => ({
  name: item.file.split("/").pop(),
  mime: item.mime,
  expect: item.expect,
  dataUrl: `data:${item.mime};base64,${readFileSync(resolve(fixtureDir, item.file)).toString("base64")}`,
}));

const rows = await page.evaluate(async (items) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const boardScanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/",
    threads: 4,
  });
  if (!boardScanner) return [{ name: "scanner", error: "模型加载失败" }];
  const out = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.name, { type: item.mime });
    const baseRun = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true });
    const t1 = performance.now();
    const boostRun = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: true, boardScanner });
    const ms = Math.round(performance.now() - t1);
    const count = (run) => run.board.flat().filter(Boolean).length;
    const colors = (run) => {
      let black = 0, white = 0;
      run.board.forEach((row) => row.forEach((cell) => { if (cell === "black") black += 1; else if (cell === "white") white += 1; }));
      return `${black}/${white}`;
    };
    out.push({ name: item.name, expect: item.expect, base: count(baseRun), boost: count(boostRun), baseColors: colors(baseRun), boostColors: colors(boostRun), ms });
  }
  return out;
}, payloads);

console.log("图 | 期望 | 默认 | 补位后 | 默认黑白 | 补位黑白 | 补位耗时");
for (const row of rows) {
  if (row.error) { console.log(row.name, row.error); continue; }
  console.log([row.name, row.expect ?? "-", row.base, row.boost, row.baseColors, row.boostColors, `${row.ms}ms`].join(" | "));
}
await browser.close();
