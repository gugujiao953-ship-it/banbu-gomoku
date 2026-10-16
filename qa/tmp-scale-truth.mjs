// 逐尺度读号准确率·全真值版（2026-10-07）：直接按真值的 89 颗子（含应用漏掉的 44 颗）
// 逐尺度读号，看「漏子」与「应用已找到的子」在不同尺度下的准确率差异。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-scale-truth.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const truth2 = JSON.parse(readFileSync(resolve("qa/fixtures/recognition/remote-image2.truth.json"), "utf-8"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-scalet-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-scalet-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ truth, b64 }) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 });
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const file = new File([blob], "remote-image2.png", { type: "image/png" });
  const fast = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: true });
  const grid = fast.grid;
  const appSet = new Set();
  fast.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) appSet.add(`${ri},${ci}`); }));
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
  const spacing = Math.min(grid.spacingX, grid.spacingY);
  const stones = truth.map((move) => ({
    name: move.coord, key: `${move.row},${move.col}`, number: move.number, player: move.player,
    isAtom: appSet.has(`${move.row},${move.col}`),
    x: grid.originX + move.col * grid.spacingX, y: grid.originY + move.row * grid.spacingY,
  }));
  lines.push(`网格 spacing=${spacing.toFixed(2)}；真值 ${stones.length}（应用已找到 ${stones.filter((s) => s.isAtom).length}、漏子 ${stones.filter((s) => !s.isAtom).length}）`);
  for (const factor of [1.0, 0.9, 0.8, 0.7, 0.6]) {
    const reads = await reader({ image: sampled, centers: stones.map((s) => ({ x: s.x, y: s.y })), spacing: spacing * factor });
    const stat = (subset) => {
      let correct = 0, wrong = 0, none = 0, weakCorrect = 0;
      subset.forEach((stone) => {
        const top = reads[stones.indexOf(stone)]?.[0];
        if (!top) { none += 1; return; }
        if (top.value === stone.number) { correct += 1; if (top.score < 0.7) weakCorrect += 1; } else wrong += 1;
      });
      return `对 ${correct}(其中<0.7分 ${weakCorrect}) / 错 ${wrong} / 没读出 ${none}`;
    };
    lines.push(`  ${factor}× : 全部 → ${stat(stones)}`);
    lines.push(`      已找到子 → ${stat(stones.filter((s) => s.isAtom))}`);
    lines.push(`      漏子（补位目标） → ${stat(stones.filter((s) => !s.isAtom))}`);
    // 漏子的错例明细（前 8 个）
    const wrongDetail = stones.filter((s) => !s.isAtom).map((stone) => {
      const top = reads[stones.indexOf(stone)]?.[0];
      return top && top.value !== stone.number ? `${stone.name}:${top.value}(真${stone.number})@${top.score.toFixed(2)}` : null;
    }).filter(Boolean).slice(0, 8);
    if (wrongDetail.length) lines.push(`      漏子错例: ${wrongDetail.join(" ")}`);
  }
  return lines;
}, { truth: truth2.moves, b64: readFileSync(resolve("qa/fixtures/materials/remote-image2.png")).toString("base64") });

console.log(out.join("\n"));
await browser.close();
