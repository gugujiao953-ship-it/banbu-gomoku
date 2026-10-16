// 取证：智子图「稳定多一颗」——把识别出的每颗子拿 **cell-cls 模型**复核一遍，找假子（2026-10-15）。
//
// 思路：导入路径里 CV 找子、模型只负责「补位」，所以 CV 的假阳不会被模型否决。
// 这里反着用一次：借 boardScanner 的第一手参数拿到识别器**用的那张采样图**，
// 再对全部 225 格直算 cell-cls 概率；「CV 判成子、模型却判几乎是空的」那些格就是假子候选。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-zhizi-false-stone.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const path = process.env.ZHIZI_ITEM || "qa/fixtures/materials/user-report/zhizi-dense-101.jpg";
const mime = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-zhizi2.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-zhizi2.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ dataUrl, name, mime }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
  const blob = await (await fetch(dataUrl)).blob();
  // 借「第一手参数」抓住识别器内部用的采样图：boardScanner 收到的 image 就是它。
  let sampled = null;
  const spy = async (args) => { sampled = sampled ?? args.image; return scanner ? scanner(args) : null; };
  const fast = await mod.recognizeBoardImage(new File([blob], name, { type: mime }), 15, {
    skipMoveOrder: true, parallel: false, boardScanner: spy,
  });
  const g = fast.grid;
  if (!sampled) return { error: "没抓到采样图（boardScanner 没被调用）" };
  const half = Math.max(6, Math.round((g.spacingX + g.spacingY) / 2));
  const queries = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) queries.push({ x: g.originX + col * g.spacingX, y: g.originY + row * g.spacingY, row, col });
  }
  const local = mod.localAccelerator(sampled);
  const probs = await local.scanCells(queries, half, {});
  const rows = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const cell = fast.board[row][col];
      const p = probs[row * 15 + col];
      if (!cell || !p) continue;
      const modelColor = p.pBlack > p.pWhite ? "black" : "white";
      const modelEmpty = p.pEmpty > p.pBlack && p.pEmpty > p.pWhite;
      rows.push({
        at: `${String.fromCharCode(97 + col)}${15 - row}`, row, col, color: cell,
        pEmpty: +p.pEmpty.toFixed(3), pBlack: +p.pBlack.toFixed(3), pWhite: +p.pWhite.toFixed(3),
        modelSays: modelEmpty ? "空" : (modelColor === "black" ? "黑" : "白"),
        agreeColor: !modelEmpty && modelColor === cell,
        modelEmpty,
      });
    }
  }
  // 对照：识别为**空**的格，模型怎么说（看模型的判空阈值该定在哪）
  const emptyRows = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      if (fast.board[row][col]) continue;
      const p = probs[row * 15 + col];
      if (!p) continue;
      emptyRows.push({ at: `${String.fromCharCode(97 + col)}${15 - row}`, pEmpty: +p.pEmpty.toFixed(3), modelSays: p.pEmpty > p.pBlack && p.pEmpty > p.pWhite ? "空" : "有子" });
    }
  }
  return {
    stones: rows.filter((r) => r.color).length, sampledSize: `${sampled.width}x${sampled.height}`,
    grid: `origin=(${g.originX.toFixed(1)},${g.originY.toFixed(1)}) spacing=${g.spacingX.toFixed(2)}`,
    rows, emptyRows,
    modelSaysNotEmpty: rows.filter((r) => !r.modelEmpty),
    emptyButModelSaysStone: emptyRows.filter((r) => r.modelSays === "有子"),
  };
}, { dataUrl: `data:${mime};base64,${readFileSync(resolve(path)).toString("base64")}`, name: path.split("/").pop(), mime });

if (out.error) { console.log("失败：", out.error); }
else {
  console.log(`${path}`);
  console.log(`  采样图 ${out.sampledSize}，${out.grid}；识别 ${out.stones} 子`);
  const emptyjudged = out.rows.filter((r) => r.modelEmpty);
  console.log(`  ★ 模型判「空」的已识别子：${emptyjudged.length} 颗`);
  for (const r of emptyjudged.sort((a, b) => b.pEmpty - a.pEmpty)) {
    console.log(`     ${r.at}（CV 判${r.color === "black" ? "黑" : "白"}）→ pEmpty=${r.pEmpty} pBlack=${r.pBlack} pWhite=${r.pWhite}`);
  }
  const colorWrong = out.rows.filter((r) => !r.modelEmpty && !r.agreeColor);
  console.log(`  模型判有子但颜色不同：${colorWrong.length} 颗 ${colorWrong.slice(0, 8).map((r) => `${r.at}(${r.color}→${r.modelSays})`).join(" ")}`);
  console.log(`  模型判「有子」而识别为空的格（漏子候选）：${out.emptyButModelSaysStone.length} 个 ${out.emptyButModelSaysStone.slice(0, 10).map((r) => `${r.at}(${r.modelSays})`).join(" ")}`);
  const pEmptySorted = out.rows.slice().sort((a, b) => b.pEmpty - a.pEmpty).slice(0, 10);
  console.log("  已识别子按 pEmpty 降序前 10（越高越像假子）：");
  for (const r of pEmptySorted) console.log(`     ${r.at} pEmpty=${r.pEmpty} ${r.modelSays}`);
}
await browser.close();
