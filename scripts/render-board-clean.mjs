import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, extname } from "node:path";

/**
 * 把任意一张棋谱图（手机实拍、糊图、反光、斜拍都行）**干净重绘**成一张带坐标标注的
 * 标准盘 PNG：用识别器认出的「网格几何 + 每颗子的位置与颜色」重画一张清晰图，
 * 再把 A–O / 1–15 标在四边。豆包收到的是这张印好的图，而不是糊照片——
 * 直接消掉「图片太模糊导致读错位置」这一类失败。
 *
 * 用法：
 *   npm run dev -- --port 5301
 *   QA_BASE_URL=http://localhost:5301/ node scripts/render-board-clean.mjs <图片路径> [输出png路径]
 * 不给输出路径时，写到同目录 <原名>-clean.png。
 *
 * 边界（如实）：重绘只保证「位置/颜色准、坐标清楚」；**无序号的图，手序仍不在图里**，
 * 豆包在这张干净图上做的是「重建一种合法顺序」，不是还原真相。有序号的图，序号会一并画出来。
 */
const baseUrl = process.env.QA_BASE_URL || "http://localhost:5301/";
const input = process.argv[2];
if (!input) { console.error("用法: node scripts/render-board-clean.mjs <图片路径> [输出png]"); process.exit(2); }
const inputPath = resolve(input);
const outputPath = process.argv[3] ? resolve(process.argv[3]) : resolve(inputPath.replace(/\.([^.]+)$/, "") + "-clean.png");
const bytes = readFileSync(inputPath);
const mime = extname(inputPath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1180, height: 1180 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.setDefaultTimeout(180_000);
await page.route("**/qa-render-host.html", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><meta charset=utf-8><body></body>" }));

try {
  await page.goto(new URL("qa-render-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ b64, mime }) => {
    const mod = await import("/src/image-recognition.ts");
    const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob();
    const r = await mod.recognizeBoardImage(new File([blob], "in", { type: mime }), 15, {});
    const stones = [];
    r.board.forEach((row, rr) => row.forEach((p, c) => { if (p) stones.push({ row: rr, col: c, player: p }); }));
    const numberAt = {};
    // 印号取**读出全集**（readMoveNumbers，09-28 起）：重绘是给 VLM 看的，不要求
    // 拼成完整手序；旧的 numberedMoves 只在全图完整编号时才有货，paper10 那种
    // 「读出 36 个号但不完整」的图会被误画成无号图。?? 回落到旧字段以容忍旧 dev 服务器。
    for (const move of (r.readMoveNumbers ?? r.numberedMoves)) numberAt[`${move.row},${move.col}`] = move.number;
    return { boardSize: r.boardSize, stones, numberAt, note: r.note, confidence: r.confidence };
  }, { b64: bytes.toString("base64"), mime });

  const N = result.boardSize;
  const S = 58, M = 64, W = M * 2 + S * (N - 1);
  const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const px = (c) => M + c * S;
  const py = (r) => M + (N - 1 - r) * S; // r=0 是顶行=N
  let grid = "";
  for (let i = 0; i < N; i += 1) {
    grid += `<line x1="${px(0)}" y1="${py(i)}" x2="${px(N - 1)}" y2="${py(i)}" stroke="#6b4e22" stroke-width="1"/>`;
    grid += `<line x1="${px(i)}" y1="${py(0)}" x2="${px(i)}" y2="${py(N - 1)}" stroke="#6b4e22" stroke-width="1"/>`;
  }
  let edge = "";
  for (let c = 0; c < N; c += 1) { edge += `<text x="${px(c)}" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#111" font-family="sans-serif">${COLS[c]}</text>`; edge += `<text x="${px(c)}" y="${W - 20}" font-size="20" font-weight="700" text-anchor="middle" fill="#111" font-family="sans-serif">${COLS[c]}</text>`; }
  for (let r = 0; r < N; r += 1) { const label = N - r; edge += `<text x="30" y="${py(r) + 7}" font-size="20" font-weight="700" text-anchor="middle" fill="#111" font-family="sans-serif">${label}</text>`; edge += `<text x="${W - 24}" y="${py(r) + 7}" font-size="20" font-weight="700" text-anchor="middle" fill="#111" font-family="sans-serif">${label}</text>`; }
  let stones = "";
  for (const stone of result.stones) {
    const coord = `${COLS[stone.col]}${N - stone.row}`;
    const num = result.numberAt[`${stone.row},${stone.col}`];
    const fill = stone.player === "black" ? "#1a1a1a" : "#fafafa";
    const stroke = stone.player === "black" ? "#000" : "#888";
    const textFill = stone.player === "black" ? "#fff" : "#111";
    stones += `<circle cx="${px(stone.col)}" cy="${py(stone.row)}" r="24" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    if (num) stones += `<text x="${px(stone.col)}" y="${py(stone.row) + 6}" font-size="18" font-weight="700" text-anchor="middle" fill="${textFill}" font-family="sans-serif">${num}</text>`;
    else stones += `<text x="${px(stone.col)}" y="${py(stone.row) + 5}" font-size="11" text-anchor="middle" fill="${textFill}" opacity="0.75" font-family="monospace">${coord}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="#e9c47a"/>${grid}${stones}${edge}</svg>`;
  await page.evaluate((inner) => { document.body.innerHTML = inner; document.body.style.margin = "0"; }, svg);
  await page.setViewportSize({ width: Math.round(W * 1.5), height: Math.round(W * 1.5) });
  await page.waitForTimeout(200);
  const png = await page.screenshot();
  writeFileSync(outputPath, png);
  const numberedCount = Object.keys(result.numberAt).length;
  const suffix = numberedCount ? "，其中 " + numberedCount + " 子带序号" : "（无序号）";
  console.log("识别到 " + result.stones.length + " 子" + suffix + "，置信度 " + Math.round(result.confidence * 100) + "%");
  console.log(`干净重绘已写出：${outputPath}`);
  console.log("把这张图发给豆包即可；它收到的是印好的标准盘，不再是糊照片。");
} finally {
  await browser.close();
}
