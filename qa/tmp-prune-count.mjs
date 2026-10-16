// 量「无损剪枝后到底要扫多少格」（2026-10-09）。
//
// 剪枝判据（与 image-recognition.ts 静态补位分支一致）：
//   保留 = 未识别子 且（特征分 null（越界格，门控视为已佐证）或 特征分 ≥0.2 且非彩色标记）
// 本探针直接按这条判据数格，并给出各语料的分布——用来判断剪枝的真实收益。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-prune-count.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { image: "qa/fixtures/materials/renjuportal/rp-score-10.png", note: "网页密盘 76 子" },
  { image: "qa/fixtures/materials/user-cno2010-15.jpg", note: "用户 15 手" },
  { image: "qa/fixtures/recognition/paper10.jpg", note: "书谱 66 子" },
  { image: "qa/fixtures/recognition/paper02.jpg", note: "旧书手写体 43 子" },
  { image: "qa/fixtures/materials/remote-image2.png", note: "白底 89 手（补位主战场）" },
  { image: "qa/fixtures/materials/blur-num71.jpg", note: "模糊 71 手" },
  { image: "qa/fixtures/materials/mm-wood-zhizi.jpg", note: "木刻棋盘" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-prune-count-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-prune-count-host.html", base).toString(), { waitUntil: "domcontentloaded" });

console.log("图 | 识别子数 | 需扫格 | 其中: 特征分≥0.2 / 越界格 | 剪掉");
for (const item of items) {
  const dataUrl = `data:${/\.jpe?g$/i.test(item.image) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(item.image)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(dataUrl)).blob();
    const pure = await mod.recognizeBoardImage(new File([blob], name, { type: "image/png" }), 15, { skipMoveOrder: true, parallel: false });
    const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
    const longSide = Math.max(img.width, img.height);
    const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
    const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    const grid = pure.grid;
    const half = Math.round((grid.spacingX + grid.spacingY) / 2);
    let kept = 0, highScore = 0, outOfBounds = 0, stones = 0;
    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        if (pure.board[row][col]) { stones += 1; continue; }
        const x = grid.originX + col * grid.spacingX;
        const y = grid.originY + row * grid.spacingY;
        // 与识别器同一条越界判据（featureGrid 里越界格为 null）
        if (x < 3 || y < 3 || x > canvas.width - 4 || y > canvas.height - 4) { kept += 1; outOfBounds += 1; continue; }
        const features = mod.analyzeIntersection(sampled, x, y, half);
        if (features.score < 0.2) continue;
        if (mod.isVividGlyphMarker(features.foregroundSaturation, features.coreShare, features.discShare)) continue;
        kept += 1; highScore += 1;
      }
    }
    return { stones, kept, highScore, outOfBounds };
  }, { dataUrl, name: item.image.split("/").pop() });
  console.log(`${item.note} | ${out.stones} | **${out.kept}** | ${out.highScore} / ${out.outOfBounds} | ${225 - out.kept}`);
}
await browser.close();
