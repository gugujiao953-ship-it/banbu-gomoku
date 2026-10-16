// 网格一致性回归骨牌（2026-10-08）：把「每张图选中的网格 + 棋子盘面」钉成基线，
// 供任何**动到网格检测**的改动做逐值比对。
//
// 为什么需要它：网格检测是整条管线里最不能出错的一段（判错 → 整盘行列错位），
// 而它内部是多级候选 + 十几道门控，剪枝/改阈值的效果没法靠几张图的「看着对」判断。
// 这个骨牌把 24 张图（含 10 张网页棋盘）的 origin/spacing（保留 4 位小数）、棋子数、
// 黑白数与盘面指纹全部记下来，改动后逐字段比对，任何一处不相同就报出来。
//
// 用法：
//   MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/grid-identity-check.mjs            # 比对
//   MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/grid-identity-check.mjs --record   # 重记基线
// 基线文件：qa/fixtures/grid-identity.json
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync, globSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const baselinePath = resolve("qa/fixtures/grid-identity.json");
const record = process.argv.includes("--record");

// `--only <子串>` 只跑文件名含该子串的图：迭代网格剪枝时用小子集快跑，
// 定案时再跑全量 27 张比对基线。
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
const items = [
  ...globSync("qa/fixtures/recognition/*.{png,jpg,jpeg}").sort(),
  ...globSync("qa/fixtures/materials/*.{png,jpg}").sort(),
  ...globSync("qa/fixtures/materials/renjuportal/*.png").sort(),
].filter((path) => !only || path.includes(only)).map((path) => ({
  path,
  mime: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png",
}));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-grid-identity-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-grid-identity-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const rows = [];
for (const item of items) {
  const dataUrl = `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name, mime }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
    // 串行跑：并行与串行按设计逐位相同，串行不受 worker 调度抖动影响，适合钉基线。
    // 语料里有本来就识别不了的图（装饰图/非棋盘），那也是一种「结果」，照实记下来比对
    // ——「原本认不出的图忽然认出了」同样要看得见，所以不吞异常。
    let run;
    try {
      run = await mod.recognizeBoardImage(new File([blob], name, { type: mime }), 15, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
    } catch (error) {
      return { error: String(error).slice(0, 120) };
    }
    let black = 0, white = 0, fingerprint = 2166136261;
    run.board.forEach((line, row) => line.forEach((cell, col) => {
      if (cell === "black") black += 1; else if (cell === "white") white += 1;
      const code = cell === "black" ? 1 : cell === "white" ? 2 : 0;
      fingerprint = Math.imul(fingerprint ^ (row * 31 + col * 7 + code), 16777619);
    }));
    return {
      error: null,
      boardSize: run.boardSize,
      gridFallback: Boolean(run.gridFallback),
      grid: run.grid ? {
        originX: Math.round(run.grid.originX * 10000) / 10000,
        originY: Math.round(run.grid.originY * 10000) / 10000,
        spacingX: Math.round(run.grid.spacingX * 10000) / 10000,
        spacingY: Math.round(run.grid.spacingY * 10000) / 10000,
      } : null,
      canvas: run.gridCanvas ? `${run.gridCanvas.width}x${run.gridCanvas.height}` : null,
      black, white,
      fingerprint: fingerprint >>> 0,
    };
  }, { dataUrl, name: item.path.split("/").pop(), mime: item.mime });
  rows.push({ file: item.path, ...out });
  process.stdout.write(".");
}
console.log("");

const next = { recordedAt: new Date().toISOString().slice(0, 19), rows };
if (record || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify(next, null, 1));
  console.log(`已记录基线：${baselinePath}（${rows.length} 张）`);
} else {
  const previous = JSON.parse(readFileSync(baselinePath, "utf8"));
  const byFile = new Map(previous.rows.map((row) => [row.file, row]));
  const diffs = [];
  for (const row of rows) {
    const before = byFile.get(row.file);
    if (!before) { diffs.push(`${row.file}: 基线里没有这张（新图？）`); continue; }
    const fields = ["error", "boardSize", "gridFallback", "canvas", "black", "white", "fingerprint"];
    for (const field of fields) {
      if (JSON.stringify(before[field]) !== JSON.stringify(row[field])) diffs.push(`${row.file}: ${field} ${JSON.stringify(before[field])} → ${JSON.stringify(row[field])}`);
    }
    if (JSON.stringify(before.grid) !== JSON.stringify(row.grid)) diffs.push(`${row.file}: 网格 ${JSON.stringify(before.grid)} → ${JSON.stringify(row.grid)}`);
  }
  // 子集模式下（--only）没跑的图不算差异，只报「跑了的图里少了一张」。
  if (!only) {
    const missing = previous.rows.filter((row) => !rows.some((current) => current.file === row.file)).map((row) => row.file);
    for (const file of missing) diffs.push(`${file}: 基线里有、这次没跑（图还在吗？）`);
  } else {
    for (const row of rows) if (!previous.rows.some((before) => before.file === row.file)) diffs.push(`${row.file}: 基线里没有这张`);
  }
  if (diffs.length) {
    console.log(`网格一致性：**不一致 ${diffs.length} 处**（基线 ${previous.recordedAt}）`);
    for (const diff of diffs.slice(0, 40)) console.log(`  ${diff}`);
    process.exitCode = 1;
  } else {
    console.log(`网格一致性：${rows.length} 张全部逐值相同（基线 ${previous.recordedAt}）`);
  }
}
await browser.close();
