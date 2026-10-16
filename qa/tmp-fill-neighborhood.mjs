// 「哪些格子真的需要 cell-cls」的定量探针（2026-10-09）。
//
// 背景：用户手机「识谱十几秒、哪张图都一样」。降频模拟证明瓶颈是**固定 225 格**的
// cell-cls 分类（15 手图 37s、66 子书谱 72s @6× 降频），与图片内容无关。
// 已知按「特征分」预筛无效（每个交叉点都有分）。
//
// 换一个判据：cell-cls 在**导入路径**只服务于一件事——补位（找出 CV 漏掉的子）。
// 而补位门控是「pEmpty<0.05 **且** (特征分≥0.2 或读过号)」。
// 关键问题：**已识别子的邻格**才是漏子可能出现的地方吗？还是任意格都可能？
//
// 本探针统计（带逐坐标真值的图）：
//   ① 真漏子（真值有子但 CV 没识别到）距离最近的已识别子有多远；
//   ② 若只扫「已识别子所在格 ∪ 与其切比雪夫距离 ≤ K 的空格」，能否覆盖全部真漏子。
// 若 ① 全在 1 格内，就能把 225 格压到「子数 × 邻域」，导入直接提速数倍。
//
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/tmp-fill-neighborhood.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { image: "qa/fixtures/materials/remote-image2.png", truth: "qa/fixtures/recognition/remote-image2.truth.json", note: "白底 89 手（44 个真漏子）" },
  { image: "qa/fixtures/materials/user-cno2010-15.jpg", truth: "qa/fixtures/recognition/user-cno2010-15.truth.json", note: "用户 15 手" },
  { image: "qa/fixtures/recognition/paper10.jpg", truth: "qa/fixtures/recognition/paper10.truth.json", note: "书谱 66 子" },
  { image: "qa/fixtures/recognition/paper02.jpg", truth: "qa/fixtures/recognition/paper02.truth.json", note: "旧书手写体" },
  { image: "qa/fixtures/materials/mm-wood-zhizi.jpg", truth: null, note: "木刻棋盘（无真值，看 CV 与补位的距离分布）" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 160)));
await page.route("**/qa-fillnb-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-fillnb-host.html", base).toString(), { waitUntil: "domcontentloaded" });

for (const item of items) {
  const truth = item.truth ? JSON.parse(readFileSync(resolve(item.truth), "utf8")) : null;
  const stones = truth
    ? truth.stones ?? (truth.moves?.length ? truth.moves.map((m) => ({ row: m.row, col: m.col, player: m.player })) : null)
      ?? (truth.coordinates || []).map((coord, i) => ({ row: 15 - parseInt(coord.slice(1), 10), col: coord.charCodeAt(0) - 65 }))
    : null;
  const dataUrl = `data:${/\.jpe?g$/i.test(item.image) ? "image/jpeg" : "image/png"};base64,${readFileSync(resolve(item.image)).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, name }) => {
    const mod = await import("/src/image-recognition.ts");
    const head = await import("/src/features/record/digit-head.ts");
    const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL }).catch(() => null);
    const blob = await (await fetch(dataUrl)).blob();
    const make = () => new File([blob], name, { type: blob.type });
    // 纯 CV（不补位）：拿到「应用自己识别到的子」
    const pure = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false });
    // 带扫描器（补位）：拿到最终盘面
    const filled = await mod.recognizeBoardImage(make(), 15, { skipMoveOrder: true, parallel: false, boardScanner: scanner ?? undefined });
    const pureSet = new Set();
    pure.board.forEach((line, row) => line.forEach((cell, col) => { if (cell) pureSet.add(`${row},${col}`); }));
    const finalSet = new Set();
    filled.board.forEach((line, row) => line.forEach((cell, col) => { if (cell) finalSet.add(`${row},${col}`); }));
    const added = [...finalSet].filter((key) => !pureSet.has(key));
    return { pure: [...pureSet], added };
  }, { dataUrl, name: item.image.split("/").pop() });
  // 距离最近已识别子的切比雪夫距离
  const pure = out.pure.map((key) => key.split(",").map(Number));
  const dist = (row, col) => pure.length ? Math.min(...pure.map(([r, c]) => Math.max(Math.abs(r - row), Math.abs(c - col)))) : Infinity;
  const addedDist = out.added.map((key) => { const [row, col] = key.split(",").map(Number); return dist(row, col); });
  let missDist = [];
  if (stones) {
    const finalSet = new Set([...out.pure, ...out.added]);
    missDist = stones.filter((s) => !finalSet.has(`${s.row},${s.col}`)).map((s) => dist(s.row, s.col));
  }
  const hist = (values) => {
    const buckets = {};
    for (const v of values) buckets[v] = (buckets[v] ?? 0) + 1;
    return Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, n]) => `${k}格内:${n}`).join(" ");
  };
  console.log(`\n${item.note}`);
  console.log(`  CV 识别 ${out.pure.length} 子；补位新增 ${out.added.length} 个 → ${hist(addedDist)}`);
  if (stones) console.log(`  仍未命中的真子 ${missDist.length} 个 → 距最近已识别子：${hist(missDist)}`);
}
await browser.close();
