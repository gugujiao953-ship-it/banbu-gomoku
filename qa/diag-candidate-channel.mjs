// 诊断：BENCH_DIGIT_MODEL 这条候选模型通道到底有没有生效（2026-10-08）。
// 做法：在页面里分别用「现役 URL」与「候选 URL」建 reader，喂同一张图问同一个格子，
// 打印各自的 top-3 读数。若两者完全一致，说明候选没换进去（或两份权重真的行为相同）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-candidate-channel.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const imagePath = resolve("qa/fixtures/materials/self-render/self-003@820.jpg");
const truth = JSON.parse(readFileSync(resolve("qa/fixtures/materials/self-render/self-003@820.truth.json"), "utf8"));
const dataUrl = `data:image/jpeg;base64,${readFileSync(imagePath).toString("base64")}`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-diag-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-diag-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ dataUrl, truth, candidateUrl }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const blob = await (await fetch(dataUrl)).blob();
  // 先拿网格（不需要 digit 模型）
  const first = await mod.recognizeBoardImage(new File([blob], "x.jpg", { type: "image/jpeg" }), 15, { skipMoveOrder: true, parallel: false });
  const grid = first.grid;
  const img = await new Promise((res, rej) => { const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = URL.createObjectURL(blob); });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > 1600 ? 1600 / longSide : Math.max(1, 320 / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
  const sampled = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const stone = truth.stones[0];
  const x = grid.originX + stone.col * grid.spacingX;
  const y = grid.originY + stone.row * grid.spacingY;
  const half = Math.round((grid.spacingX + grid.spacingY) / 2);
  const probe = async (url) => {
    const reader = await head.createDigitHeadReader({ modelUrl: url, threads: 1 });
    if (!reader) return "reader=null";
    const reads = await reader({ image: sampled, centers: [{ x, y }], spacing: half });
    return JSON.stringify(reads[0]);
  };
  const viaDefault = await probe(head.DIGIT_HEAD_MODEL_URL);
  const viaCandidate = await probe(candidateUrl);
  return { truth: { number: stone.number, player: stone.player }, defaultUrl: head.DIGIT_HEAD_MODEL_URL, candidateUrl, viaDefault, viaCandidate };
}, { dataUrl, truth, candidateUrl: new URL("qa/cand-models/digit-head-iter18.onnx", base).href });

console.log("真值：", JSON.stringify(out.truth));
console.log("现役：", out.defaultUrl);
console.log("  读出 →", out.viaDefault);
console.log("候选：", out.candidateUrl);
console.log("  读出 →", out.viaCandidate);
console.log(out.viaDefault === out.viaCandidate ? "⚠ 两者完全一致（通道可能没生效，或权重行为相同）" : "✓ 两者不同（通道生效）");
await browser.close();
