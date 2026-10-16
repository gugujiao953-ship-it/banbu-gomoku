// 读号失败模式诊断（2026-10-07）：模糊 71 手图上，逐颗子量「不同裁剪尺度下数字头读出什么」，
// 找出「读不出/读错」到底卡在哪一层（置信不足？无号判定？尺度失配？），并给出可用尺度对比。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-digit-scale.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-digitscale-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-digitscale-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ b64, b64cno }) => {
  const lines = [];
  const mod = await import("/src/image-recognition.ts");
  const inf = await import("/src/features/record/model-inference.ts");
  const options = { wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4 };
  const run = async (name, b64) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const file = new File([blob], name, { type: "image/jpeg" });
    const fast = await mod.recognizeBoardImage(file, 15, { skipMoveOrder: true, parallel: false });
    const grid = fast.grid;
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
    const data = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const sampled = { data: data.data, width: cvs.width, height: cvs.height, gray: mod.buildGray(data.data, cvs.width * cvs.height) };
    const spacing = Math.min(grid.spacingX, grid.spacingY);
    const cells = [];
    fast.board.forEach((row, ri) => row.forEach((cell, ci) => { if (cell) cells.push({ x: grid.originX + ci * grid.spacingX, y: grid.originY + ri * grid.spacingY, name: `${String.fromCharCode(65 + ci)}${15 - ri}`, player: cell }); }));
    lines.push(`【${name}】画布 ${cvs.width}x${cvs.height}，间距 ${spacing.toFixed(1)}px，十字子 ${cells.length} 颗；字号(0.2752×间距)=${(spacing * 0.2752).toFixed(1)}px`);
    for (const factor of [1.0, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35]) {
      const reads = await inf.readDigitCandidates(sampled, cells, Math.max(6, Math.round(spacing * factor)), options);
      if (!reads) { lines.push("  读号失败"); break; }
      let hasDigit = 0, strong = 0, unique = new Set(), top1 = [];
      cells.forEach((cell, index) => {
        const r = reads[index];
        if (r.digit > 0) { hasDigit += 1; if (r.digitProb >= 0.5) strong += 1; unique.add(r.digit); }
        top1.push(`${cell.name}:${r.digit === 0 ? "无号" : `${r.digit}(${r.digitProb.toFixed(2)})`}`);
      });
      lines.push(`  裁剪 ${factor}× (half=${Math.max(6, Math.round(spacing * factor))}px)：读出号 ${hasDigit}/${cells.length}（其中 ≥0.5 置信 ${strong}）、唯一号 ${unique.size}`);
      if (factor === 0.6 || factor === 0.5) lines.push(`     ${top1.slice(0, 24).join(" ")}`);
    }
  };
  await run("blur-num71.jpg", b64);
  await run("user-cno2010-15.jpg", b64cno);
  return lines;
}, { b64: readFileSync(resolve("qa/fixtures/materials/blur-num71.jpg")).toString("base64"), b64cno: readFileSync(resolve("qa/fixtures/materials/user-cno2010-15.jpg")).toString("base64") });

console.log(out.join("\n"));
await browser.close();
