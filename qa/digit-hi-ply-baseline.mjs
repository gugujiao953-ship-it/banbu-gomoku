// 高段位（180+ 手）语料上测现役模型：证明「读不出高段位」的根因是数据缺失（2026-10-09）。
//
// 背景链条（都是实测得来的）：
//   · 现役 digit-head-iter8 输出 **171 类** → 最多只能读到 170 手；
//   · 训练数据 digit2 的 label 上限 **60**、digit8 上限 **170**、merged 上限 **177**；
//   · 数据生成器 `gen-self-boards.mjs` 原先只造 **6–80 手**的局面；
//   · 全项目真值语料最大手数也才 **89**（remote-image2）。
//   ⇒ 所以「读不出 180 手以上的号」**不是量化、不是模型容量、不是识别算法**，
//     而是**训练/验证数据里根本没有高段位样本**。
//
// 本探针在新造的 185–223 手语料上跑现役模型，看它到底能读出多少、错在哪，
// 作为「扩类别 + 补高段位数据重训」这条路的**基线**。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/digit-hi-ply-baseline.mjs
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const SAMPLE = Number(process.env.SAMPLE || 6);

// 语料目录可覆盖（2026-10-13 加）：high-ply 语料按批次分目录（self-hi-ply2a/b/c …），
// 想在别的批次上量就 `HI_PLY_DIR=qa/fixtures/materials/self-hi-ply2a node ...`。
const dir = resolve(process.env.HI_PLY_DIR || "qa/fixtures/materials/self-hi-ply");
if (!existsSync(resolve(dir, "index.json"))) {
  console.log("缺少高段位语料：先跑 OUT_DIR=qa/fixtures/materials/self-hi-ply PLY_MIN=180 PLY_MAX=225 node qa/gen-self-boards.mjs 12");
  process.exit(1);
}
const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
const picked = index.filter((item) => item.width === 1200).slice(0, SAMPLE);
const payloads = picked.map((item) => ({
  file: item.file, stones: item.stones,
  dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(dir, item.file)).toString("base64")}`,
  truth: JSON.parse(readFileSync(resolve(dir, item.file.replace(/\.jpg$/, ".truth.json")), "utf8")),
}));
console.log(`高段位语料 ${payloads.length} 张（${payloads.map((p) => p.stones).join(", ")} 手）\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-hiply-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-hiply-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const scanner = await head.createBoardScanner({
    modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL,
    wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
  });
  const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 });

  const rows = [];
  for (const item of items) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.file, { type: "image/jpeg" });
    const t0 = performance.now();
    const result = await mod.recognizeBoardImage(make(), 15, {
      skipMoveOrder: false, parallel: false, digitReader: reader ?? undefined, boardScanner: scanner ?? undefined,
    });
    const ms = Math.round(performance.now() - t0);
    const got = new Map(result.readMoveNumbers.map((m) => [`${m.row},${m.col}`, m.number]));
    const want = new Map(item.truth.stones.map((s) => [`${s.row},${s.col}`, s.number]));
    // 分档统计：命中的号落在哪个手数区间（暴露"低段位能读、高段位失能"）
    const bands = [[1, 60], [61, 120], [121, 170], [171, 225]];
    const bandStat = bands.map(([lo, hi]) => {
      let wantN = 0, gotN = 0, hitN = 0;
      for (const [rc, n] of want) {
        if (n < lo || n > hi) continue;
        wantN += 1;
        const g = got.get(rc);
        if (g) { gotN += 1; if (g === n) hitN += 1; }
      }
      return { band: `${lo}-${hi}`, want: wantN, got: gotN, hit: hitN };
    });
    const overLimit = result.readMoveNumbers.filter((m) => m.number > 170).length;
    const maxRead = result.readMoveNumbers.reduce((mx, m) => Math.max(mx, m.number), 0);
    rows.push({
      file: item.file, stones: item.stones, ms,
      read: result.readMoveNumbers.length,
      numbered: result.numberedMoves.length,
      status: result.moveOrderQuality?.status ?? "-",
      maxRead, overLimit, bandStat,
      stonesDetected: result.board.flat().filter(Boolean).length,
    });
  }
  return rows;
}, { items: payloads });

console.log("图 | 子数 | 识别子 | 读出号 | 读出最大号 | >170的号 | 完整复原 | 状态");
for (const r of out) {
  console.log(`${r.file} | ${r.stones} | ${r.stonesDetected} | ${r.read} | ${r.maxRead} | ${r.overLimit} | ${r.numbered} | ${r.status} | ${r.ms}ms`);
}
console.log("\n【按手数分档：真值有多少格 / 读出多少 / 读对多少】");
for (const r of out) {
  console.log(`${r.file}（${r.stones} 手）`);
  for (const b of r.bandStat) {
    if (!b.want) continue;
    const pct = b.want ? Math.round((b.hit / b.want) * 100) : 0;
    console.log(`   ${b.band.padEnd(9)} 真值 ${String(b.want).padStart(3)} 格 | 读出 ${String(b.got).padStart(3)} | 读对 ${String(b.hit).padStart(3)}（${pct}%）`);
  }
}
const tot = out.reduce((acc, r) => {
  for (const b of r.bandStat) { acc[b.band] = acc[b.band] || { want: 0, got: 0, hit: 0 }; acc[b.band].want += b.want; acc[b.band].got += b.got; acc[b.band].hit += b.hit; }
  return acc;
}, {});
console.log("\n【合计】");
for (const [band, s] of Object.entries(tot)) {
  console.log(`  ${band.padEnd(9)} 真值 ${String(s.want).padStart(4)} | 读出 ${String(s.got).padStart(4)} | 读对 ${String(s.hit).padStart(4)}（${s.want ? Math.round((s.hit / s.want) * 100) : 0}%）`);
}
await browser.close();
