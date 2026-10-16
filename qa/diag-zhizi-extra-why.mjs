// 「为什么 h1 会被当成子」——把该格与相邻真格的 CV 特征、模型三分类、数字头读数并排看（2026-10-15）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:5173/ node qa/diag-zhizi-extra-why.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const path = process.env.ZHIZI_ITEM || "qa/fixtures/materials/user-report/device/source/wechat-1792030331728.jpg";
const mime = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
// 关注的格：h1（假子）、g1(53)、h2(52)、g2(50)、i1（右侧空格对照）、f6(32)、g6(48)
const watch = [
  [0, 7, "h15 假子(边框)"], [0, 8, "i15 假子(边框)"], [0, 9, "j15 假子(边框)"],
  [1, 7, "h14 真黑(41)"], [1, 8, "i14 真白(38)"], [1, 9, "j14 真白(36)"],
  [4, 7, "h11 真黑(29)"], [7, 7, "h8 真黑(1)"],
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
await page.route("**/qa-why.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
}));
await page.goto(new URL("qa-why.html", base).toString(), { waitUntil: "domcontentloaded" });

const out = await page.evaluate(async ({ dataUrl, name, mime, watch }) => {
  const mod = await import("/src/image-recognition.ts");
  const head = await import("/src/features/record/digit-head.ts");
  const reader = await head.createDigitHeadReader({ modelUrl: head.DIGIT_HEAD_MODEL_URL });
  const scanner = await head.createBoardScanner({ modelUrl: head.CELL_CLS_MODEL_URL, digitModelUrl: head.DIGIT_HEAD_MODEL_URL });
  let sampled = null;
  const scanInfo = [];
  const spy = async (args) => {
    sampled = sampled ?? args.image;
    scanInfo.push({ needDigits: args.needDigits, targets: args.scanTargets ? args.scanTargets.length : null, hasH1: args.scanTargets ? args.scanTargets.some((t) => t.row === 14 && t.col === 7) : null, hasG1: args.scanTargets ? args.scanTargets.some((t) => t.row === 14 && t.col === 6) : null });
    return scanner ? scanner(args) : null;
  };
  const blob = await (await fetch(dataUrl)).blob();
  const fast = await mod.recognizeBoardImage(new File([blob], name, { type: mime }), 15, { skipMoveOrder: true, parallel: false, boardScanner: spy });
  const g = fast.grid;
  const spacing = Math.max(6, Math.round((g.spacingX + g.spacingY) / 2));
  const local = mod.localAccelerator(sampled);
  const queries = watch.map(([row, col]) => ({ x: g.originX + col * g.spacingX, y: g.originY + row * g.spacingY, row, col }));
  const probs = await local.scanCells(queries, spacing, {});
  const reads = reader ? await reader({ image: sampled, centers: queries.map((q) => ({ x: q.x, y: q.y })), spacing }) : null;
  const rows = watch.map(([row, col, label], index) => {
    const f = mod.analyzeIntersection(sampled, queries[index].x, queries[index].y, spacing);
    const p = probs[index];
    return { label, cell: `${row},${col}`, board: fast.board[row][col] ?? "空", f, p: p ? { e: +p.pEmpty.toFixed(3), b: +p.pBlack.toFixed(3), w: +p.pWhite.toFixed(3) } : null };
  });
  return { rows, scanInfo };
}, { dataUrl: `data:${mime};base64,${readFileSync(resolve(path)).toString("base64")}`, name: path.split("/").pop(), mime, watch });

console.log("scanner 收到的参数：", JSON.stringify(out.scanInfo));
const keys = ["score", "coreShare", "discShare", "darkDiscShare", "interiorLightShare", "outerShare", "ringShare", "middleShare", "diagonalShare", "ringSectorCoverage", "foregroundLight", "backgroundLight", "foregroundSaturation"];
console.log("格位".padEnd(18) + keys.map((k) => k.replace(/(Share|Light|Saturation)/, "").slice(0, 7).padStart(8)).join("") + "   模型(e/b/w)".padStart(0));
for (const r of out.rows) {
  const feats = keys.map((k) => String(typeof r.f[k] === "number" ? Math.round(r.f[k] * 1000) / 1000 : r.f[k]).padStart(8)).join("");
  console.log(`${r.label.padEnd(18)}${feats}   ${r.p ? `${r.p.e}/${r.p.b}/${r.p.w}` : "-"}  → 识别=${r.board}`);
}
await browser.close();
