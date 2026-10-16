// 补位带测量（2026-10-07）：remote-image2 上 0.05≤pEmpty<0.3 的格逐格明细（含真值），
// 与用户图同带假阳对照——用来定「哪些格值得读号」的廉价门。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-band-probe.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const truth2 = JSON.parse(readFileSync(resolve("qa/fixtures/recognition/remote-image2.truth.json"), "utf-8"));
const items = [
  { name: "remote-image2", mime: "image/png", path: "qa/fixtures/materials/remote-image2.png", truth: new Set(truth2.moves.map((m) => `${m.row},${m.col}`)) },
  { name: "user-cno2010-15", mime: "image/jpeg", path: "qa/fixtures/materials/user-cno2010-15.jpg", truth: new Set([[4, 8], [5, 8], [5, 9], [6, 6], [6, 7], [6, 8], [6, 10], [7, 7], [7, 8], [7, 9], [7, 11], [8, 8], [8, 10], [9, 9], [9, 11]].map(([r, c]) => `${r},${c}`)) },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-band-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-band-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const payloads = items.map((item) => ({ name: item.name, mime: item.mime, truth: [...item.truth], dataUrl: `data:${item.mime};base64,${readFileSync(resolve(item.path)).toString("base64")}` }));

const out = await page.evaluate(async (items) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  // 只跑 cell 段（needDigits:false）→ 便宜；读数用单独 reader 补（这里只为测量）。
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const file = new File([blob], item.name, { type: item.mime });
    const run = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: false, parallel: true });
    const grid = run.grid;
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    const imageData = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const gray = mod.buildGray(imageData.data, cvs.width * cvs.height);
    const sampled = { data: imageData.data, width: cvs.width, height: cvs.height, gray };
    const evidence = await scanner({ image: sampled, grid, boardSize: 15, needDigits: false });
    const truth = new Set(item.truth);
    const appSet = new Set();
    run.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) appSet.add(`${ri},${ci}`); }));
    const spacing = Math.min(grid.spacingX, grid.spacingY);
    const band = [];
    for (let row = 0; row < 15; row += 1) for (let col = 0; col < 15; col += 1) {
      const key = `${row},${col}`;
      if (appSet.has(key)) continue;
      const cell = evidence[row * 15 + col];
      if (cell.pEmpty < 0.05 || cell.pEmpty >= 0.3) continue;
      const f = mod.analyzeIntersection(sampled, grid.originX + col * grid.spacingX, grid.originY + row * grid.spacingY, spacing);
      band.push({ name: `${String.fromCharCode(65 + col)}${15 - row}`, key, truth: truth.has(key), score: f.score, pEmpty: cell.pEmpty, fg: f.foregroundLight, bg: f.backgroundLight });
    }
    // 只对「带内」格读号（测量用；正式管线要挑便宜的比这更少）
    if (band.length) {
      const reads = await reader({ image: sampled, centers: band.map((entry) => ({ x: grid.originX + Number(entry.key.split(",")[1]) * grid.spacingX, y: grid.originY + Number(entry.key.split(",")[0]) * grid.spacingY })), spacing });
      band.forEach((entry, index) => { const top = reads[index]?.[0]; entry.digit = top ? `${top.value}(${top.score.toFixed(2)})` : "-"; });
    }
    const trueBand = band.filter((entry) => entry.truth);
    const falseBand = band.filter((entry) => !entry.truth);
    lines.push(`=== ${item.name}：应用 ${appSet.size} 子；带内(0.05≤pEmpty<0.3、非应用子) ${band.length} 格，其中真子 ${trueBand.length}、假阳 ${falseBand.length}`);
    lines.push(`  真子带内明细: ${trueBand.map((entry) => `${entry.name}(pE${entry.pEmpty.toFixed(2)}/s${entry.score.toFixed(2)}/fg${Math.round(entry.fg)}/bg${Math.round(entry.bg)}/${entry.digit})`).join(" ") || "无"}`);
    lines.push(`  假阳带内明细: ${falseBand.slice(0, 14).map((entry) => `${entry.name}(pE${entry.pEmpty.toFixed(2)}/s${entry.score.toFixed(2)}/fg${Math.round(entry.fg)}/bg${Math.round(entry.bg)}/${entry.digit})`).join(" ")}${falseBand.length > 14 ? " …" : ""}`);
    const scoreSweep = [0.08, 0.1, 0.12, 0.15, 0.2];
    scoreSweep.forEach((threshold) => {
      const keepTrue = trueBand.filter((entry) => entry.score >= threshold).length;
      const keepFalse = falseBand.filter((entry) => entry.score >= threshold).length;
      lines.push(`  score>=${threshold}: 真子 ${keepTrue}/${trueBand.length}，假阳留下 ${keepFalse}/${falseBand.length}`);
    });
    const pSweep = [0.08, 0.1, 0.15, 0.2, 0.25];
    pSweep.forEach((threshold) => {
      const keepTrue = trueBand.filter((entry) => entry.pEmpty < threshold).length;
      const keepFalse = falseBand.filter((entry) => entry.pEmpty < threshold).length;
      lines.push(`  pEmpty<${threshold}: 真子 ${keepTrue}/${trueBand.length}，假阳留下 ${keepFalse}/${falseBand.length}`);
    });
    const combos = [[0.1, 0.25], [0.12, 0.25], [0.1, 0.2], [0.12, 0.22]];
    combos.forEach(([score, pEmpty]) => {
      const keepTrue = trueBand.filter((entry) => entry.score >= score && entry.pEmpty < pEmpty).length;
      const keepFalse = falseBand.filter((entry) => entry.score >= score && entry.pEmpty < pEmpty).length;
      lines.push(`  score>=${score} 且 pEmpty<${pEmpty}: 真子 ${keepTrue}/${trueBand.length}，假阳留下 ${keepFalse}/${falseBand.length}`);
    });
  }
  return lines;
}, payloads);

console.log(out.join("\n"));
await browser.close();
