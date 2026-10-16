// 一次性诊断探针（不进门禁）：把「定位」与「认字」分开——
// 用 self-hi-ply 真值坐标直接裁数字问数字头模型，比较两种裁剪半窗：
//   half = round(格距)      ← 训练口径（build-real-digit-dataset.py: half=max(6,round(P))）
//   half = min(格距, 34)    ← 应用现役口径（DIGIT_CROP_HALF_CAP）
// 若两者准确率差很大，说明「读号率随手数下跌」的主因是裁剪域差，不是模型容量。
// 用法：QA_BASE_URL=http://127.0.0.1:5301/ SAMPLE=3 node qa/tmp-order-crophalf-probe.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5301/";
const SAMPLE = Number(process.env.SAMPLE || 3);
const dir = resolve("qa/fixtures/materials/self-hi-ply");
const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
const picked = index.filter((item) => item.width === 1200).slice(0, SAMPLE);
const payloads = picked.map((item) => ({
  file: item.file,
  dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(dir, item.file)).toString("base64")}`,
  truth: JSON.parse(readFileSync(resolve(dir, item.file.replace(/\.jpg$/, ".truth.json")), "utf8")),
}));
console.log(`裁剪半窗探针：${payloads.length} 张 @1200（${payloads.map((p) => p.truth.stones.length + "手").join(", ")}）\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
await page.route("**/qa-crophalf-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-crophalf-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items }) => {
  const mod = await import("/src/image-recognition.ts");
  const mi = await import("/src/features/record/model-inference.ts");
  const sessions = await mi.ensureModelSessions({
    wasmPaths: "/node_modules/onnxruntime-web/dist/",
    threads: 4,
    digitModelUrl: mi.DIGIT_HEAD_MODEL_URL,
  });
  if (!sessions?.digit) return [{ error: "模型没加载起来" }];

  const rows = [];
  for (const item of items) {
    const bitmap = await createImageBitmap(await (await fetch(item.dataUrl)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const image = mod.createSampledImage(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);

    // share SVG 几何（board-image-export.ts）：boardX=70 boardY=190 boardPixels=1060 margin=64，size=15
    const scale = bitmap.width / 1200;
    const start = (70 + 64) * scale;
    const gap = ((70 + 1060 - 64) - (70 + 64)) / 14 * scale;
    const y0 = (190 + 64) * scale;

    const centers = item.truth.stones.map((s) => ({ x: start + s.col * gap, y: y0 + s.row * gap, number: s.number }));
    const halves = { train: Math.max(6, Math.round(gap)), app: Math.min(Math.round(gap), 34) };
    const bands = [[1, 60], [61, 120], [121, 170], [171, 225]];
    const result = { file: item.file, stones: item.truth.stones.length, gap: Math.round(gap * 10) / 10, byHalf: [] };
    for (const [name, half] of Object.entries(halves)) {
      const reads = await mi.readDigitCandidates(image, centers.map((c) => ({ x: c.x, y: c.y })), half, {
        wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4, digitModelUrl: mi.DIGIT_HEAD_MODEL_URL,
      });
      const bandStat = bands.map(([lo, hi]) => {
        let want = 0, hit = 0;
        centers.forEach((c, i) => {
          if (c.number < lo || c.number > hi) return;
          want += 1;
          const r = reads?.[i];
          if (r && r.digit === c.number) hit += 1;
        });
        return { band: `${lo}-${hi}`, want, hit };
      });
      const total = centers.length;
      const ok = centers.reduce((acc, c, i) => acc + (reads?.[i]?.digit === c.number ? 1 : 0), 0);
      result.byHalf.push({ name, half, window: half * 2, ok, total, acc: Math.round((ok / total) * 1000) / 10, bandStat });
    }
    rows.push(result);
  }
  return rows;
}, { items: payloads });

for (const row of out) {
  if (row.error) { console.log(row.error); continue; }
  console.log(`${row.file}（${row.stones} 手，格距 ${row.gap}px）`);
  for (const half of row.byHalf) {
    const bands = half.bandStat.map((b) => `${b.band}:${b.hit}/${b.want}`).join("  ");
    console.log(`   ${half.name.padEnd(6)} half=${String(half.half).padStart(3)} 窗口${String(half.window).padStart(3)}px  总命中 ${half.ok}/${half.total} = ${half.acc}%   ${bands}`);
  }
  console.log("");
}
await browser.close();
