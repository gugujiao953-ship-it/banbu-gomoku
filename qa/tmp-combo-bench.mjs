// 候选数字头端到端验收台（2026-10-12）——第②③层尺子。
//
// 为什么要有它：模型层直测（onnxruntime 直接喂裁剪）只回答「模型会不会读」，
// 回答不了「装配/奇偶/唯一号门控有没有把好处吃掉」（§15 实测：模型层 97.9% →
// 端到端只剩 53.8%）。所以换模型必须走**应用真实路径**再量一遍。
//
// 用法：
//   MODELS="iter8=/models/digit-head-iter8.onnx,combo46=/qa/cand-models/digit-head-combo46.onnx" \
//   CORPUS=self-val SAMPLE=60 node qa/tmp-combo-bench.mjs
//   CORPUS=ruler node qa/tmp-combo-bench.mjs          # 三张老标尺图（89/57/15）
//   CORPUS=self-val WIDTH=600 SAMPLE=30 node qa/tmp-combo-bench.mjs
//
// 输出：按号段（<100 / 100-170 / 171+）分档的**逐坐标读号命中**、位置召回、整盘全对。
import { chromium } from "playwright";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5301/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const CORPUS = process.env.CORPUS || "self-val";
const SAMPLE = Number(process.env.SAMPLE || 60);
const WIDTH = process.env.WIDTH || "";
const BAND = process.env.BAND || "";

const DEFAULT_MODELS = [
  { key: "iter8·现役", url: "/models/digit-head-iter8.onnx", disk: "public/models/digit-head-iter8.onnx" },
  { key: "combo45", url: "/qa/fixtures/models/digit-head-combo45-fp16.onnx", disk: "qa/fixtures/models/digit-head-combo45-fp16.onnx" },
];
const models = (process.env.MODELS
  ? process.env.MODELS.split(",").map((s) => {
    const [key, url2] = s.split("=");
    return { key, url: url2, disk: url2.startsWith("/") ? url2.slice(1) : url2 };
  })
  : DEFAULT_MODELS).filter((m) => existsSync(resolve(".", m.disk)));

const MAT = resolve("qa/fixtures/materials");
const REC = resolve("qa/fixtures/recognition");
const items = [];

const pushItem = (imgPath, truthPath, mime) => {
  if (!existsSync(imgPath) || !existsSync(truthPath)) return;
  const truth = JSON.parse(readFileSync(truthPath, "utf8"));
  // 两种真值格式：自家盘是 stones[]/moves[]（带 row/col/number），
  // 老标尺夹具是 coordinates[]+start（"H8" → col=7,row=7，手数=start+序号）。
  let list = truth.stones || truth.moves || [];
  if (!list.length && truth.coordinates?.length) {
    const start = truth.start || 1;
    list = truth.coordinates.map((coord, i) => ({
      row: 15 - parseInt(coord.slice(1), 10),
      col: coord.charCodeAt(0) - 65,
      number: start + i,
    }));
  }
  if (!list.length) return;
  items.push({
    file: imgPath.split(/[\\/]/).slice(-2).join("/"),
    mime, truth, list,
    dataUrl: `data:${mime};base64,${readFileSync(imgPath).toString("base64")}`,
  });
};

if (CORPUS === "ruler") {
  // 老标尺三图：89 手白底 / 57 手 / 15 手截图（§15 的第三层）
  pushItem(resolve(MAT, "remote-image2.png"), resolve(REC, "remote-image2.truth.json"), "image/png");
  pushItem(resolve(REC, "remote-image1.jpeg"), resolve(REC, "remote-image1.truth.json"), "image/jpeg");
  pushItem(resolve(MAT, "user-cno2010-15.jpg"), resolve(REC, "user-cno2010-15.truth.json"), "image/jpeg");
} else if (CORPUS === "self-val") {
  // 留出自家盘（seed 30000+，与训练语料零重叠），按宽度与手数分层取样
  const dirs = readdirSync(MAT).filter((d) => d.startsWith("self-val"));
  const widths = WIDTH ? [WIDTH] : ["1200", "820", "600"];
  const pool = [];
  for (const d of dirs.sort()) {
    for (const w of widths) {
      for (const T of readdirSync(resolve(MAT, d)).filter((f) => f.endsWith(`@${w}.truth.json`)).sort()) {
        const truth = JSON.parse(readFileSync(resolve(MAT, d, T), "utf8"));
        const list = truth.stones || truth.moves || [];
        if (!list.length) continue;
        const maxPly = Math.max(...list.map((s) => s.number));
        pool.push({ dir: d, img: T.replace(".truth.json", ".jpg"), maxPly, w });
      }
    }
  }
  // 分层：高段优先（171+ 是薄弱段），再按宽度轮转，保证三档都有
  let cand = pool;
  if (BAND === "hi") cand = pool.filter((p) => p.maxPly >= 171);
  else if (BAND === "mid") cand = pool.filter((p) => p.maxPly >= 100 && p.maxPly < 171);
  const byWidth = new Map();
  for (const p of cand) { if (!byWidth.has(p.w)) byWidth.set(p.w, []); byWidth.get(p.w).push(p); }
  const perWidth = Math.max(1, Math.ceil(SAMPLE / Math.max(1, byWidth.size)));
  for (const [w, arr] of [...byWidth.entries()].sort()) {
    // 高段优先
    arr.sort((a, b) => b.maxPly - a.maxPly);
    for (const p of arr.slice(0, perWidth)) pushItem(resolve(MAT, p.dir, p.img), resolve(MAT, p.dir, p.img.replace(/\.jpg$/, ".truth.json")), "image/jpeg");
  }
} else {
  throw new Error("未知 CORPUS: " + CORPUS);
}

if (!items.length) { console.log("没有样本（检查 CORPUS/DIR 真值）"); process.exit(1); }
console.log(`语料 ${CORPUS}｜样本 ${items.length} 张（高段 ${items.filter((i) => Math.max(...i.list.map((s) => s.number)) >= 171).length}）｜模型 ${models.map((m) => m.key).join(", ")}\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
await page.route("**/qa-combo-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-combo-host.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ items: payload, modelList }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  // ⚠ 关键（2026-10-12 踩过）：装配层的**大部分读数来自 boardScanner 内部的
  // 数字推理**，`opts.digitReader` 只兜「扫描器没给出读数」的缺格。所以只注入
  // digitReader 会让两个候选模型给出**逐位相同**的结果（第一次量就是这样：
  // iter8 与 combo45 在 171+ 都是 49/321）——那时量到的其实是内置 iter8 的扫描器。
  // 正解：每个候选各建一个 scanner，把 **digitModelUrl 也换成候选**。
  const runners = new Map();
  for (const m of modelList) {
    const scanner = await head.createBoardScanner({
      modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: m.url,
      wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 4,
    });
    const reader = await head.createDigitHeadReader({ modelUrl: m.url, wasmPaths: "/node_modules/onnxruntime-web/dist/", threads: 1 });
    runners.set(m.key, { scanner, reader });
  }
  const rows = [];
  for (const item of payload) {
    const blob = await (await fetch(item.dataUrl)).blob();
    const make = () => new File([blob], item.file.split("/").pop(), { type: item.mime });
    const perModel = [];
    for (const m of modelList) {
      const { scanner, reader } = runners.get(m.key) || {};
      if (!reader) { perModel.push({ key: m.key, error: "reader 加载失败" }); continue; }
      const t0 = performance.now();
      const res = await mod.recognizeBoardImage(make(), 15, {
        skipMoveOrder: false, parallel: false, digitReader: reader, boardScanner: scanner ?? undefined,
      });
      const ms = Math.round(performance.now() - t0);
      const expected = new Map(item.list.map((s) => [`${s.row},${s.col}`, s.number]));
      const found = new Map(res.readMoveNumbers.map((mv) => [`${mv.row},${mv.col}`, mv.number]));
      // 位置召回：真值坐标里识别出的棋子数
      let posHit = 0;
      for (const rc of expected.keys()) if (res.board[Number(rc.split(",")[0])]?.[Number(rc.split(",")[1])]) posHit += 1;
      const rec = { key: m.key, ms, band: {}, read: res.readMoveNumbers.length, stones: res.board.flat().filter(Boolean).length };
      for (const [rc, want] of expected) {
        const lo = want <= 99 ? "a<100" : want <= 170 ? "b100-170" : "c171+";
        rec.band[lo] = rec.band[lo] || [0, 0];
        rec.band[lo][1] += 1;
        if (found.get(rc) === want) rec.band[lo][0] += 1;
      }
      rec.posHit = posHit; rec.posOf = expected.size;
      perModel.push(rec);
    }
    rows.push({ file: item.file, maxPly: Math.max(...item.list.map((s) => s.number)), perModel });
  }
  return rows;
}, { items, modelList: models });

const agg = new Map();
for (const row of out) {
  for (const r of row.perModel) {
    if (r.error) { console.log(`⚠ ${r.key}: ${r.error}`); continue; }
    let t = agg.get(r.key);
    if (!t) { t = { band: {}, posHit: 0, posOf: 0, read: 0, exact: 0, n: 0, ms: 0, bad: [] }; agg.set(r.key, t); }
    for (const [k, [hit, of]] of Object.entries(r.band)) {
      t.band[k] = t.band[k] || [0, 0];
      t.band[k][0] += hit; t.band[k][1] += of;
    }
    t.posHit += r.posHit; t.posOf += r.posOf; t.read += r.read; t.ms += r.ms; t.n += 1;
    const allHit = Object.values(r.band).every(([h, o]) => h === o);
    if (allHit) t.exact += 1; else t.bad.push(`${row.file}(真最大${row.maxPly})`);
  }
}
console.log("模型".padEnd(14) + "位置召回".padEnd(12) + "<100".padEnd(14) + "100-170".padEnd(14) + "171+".padEnd(14) + "整盘全对".padEnd(10) + "均耗时");
for (const [key, t] of agg) {
  const pct = (k) => { const b = t.band[k]; return b && b[1] ? `${b[0]}/${b[1]} ${(100 * b[0] / b[1]).toFixed(1)}%` : "-"; };
  console.log(key.padEnd(14) + `${t.posHit}/${t.posOf}`.padEnd(12) + pct("a<100").padEnd(14) + pct("b100-170").padEnd(14) + pct("c171+").padEnd(14) + `${t.exact}/${t.n}`.padEnd(10) + `${Math.round(t.ms / Math.max(1, t.n))}ms`);
}
console.log("\n未全对的图：");
for (const [key, t] of agg) if (t.bad.length) console.log(`  ${key}: ${t.bad.slice(0, 10).join(" ")}`);
await browser.close();
