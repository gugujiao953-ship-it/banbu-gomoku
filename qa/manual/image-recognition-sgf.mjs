/**
 * Manual acceptance matrix for board-image recognition.
 * Renders known positions in our app, screenshots them (numbered / plain /
 * full-page), feeds each screenshot back through the real import UI, reads
 * the recognized stones back from the DOM, and scores position/color/number.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || process.env.OUR_BASE || "http://localhost:5182/";

const sgfComplex = `(;GM[4]FF[4]SZ[15]
;B[hh]C[天元开局];W[ii]
;B[ig]N[直指];W[jh]
;B[jg];W[gi]
;B[gh];W[fh]
;B[hi]CR[hi];W[gj]
;B[fj]TR[fj];W[fk]
;B[gk];W[gl]
;B[ek]MA[ek];W[dl]
;B[ei];W[dj]
;B[dk]LB[dk:A]LB[el:1];W[em]
;B[fl];W[gm]
;B[fn];W[fo]
;B[gn];W[hn]
;B[hm];W[in]
;B[im];W[jm]
;B[km];W[lm]
)`;
const sgfEdges = `(;GM[4]FF[4]SZ[15]
;B[aa];W[ab]
;B[ac];W[ad]
;B[ae];W[ba]
;B[ca];W[da]
;B[ea];W[fa]
;B[ga];W[ha]
;B[ia];W[ja]
;B[ka];W[la]
;B[ma];W[na]
;B[oa];W[ob]
;B[oc];W[od]
;B[oe]C[边角星位测试]
;B[oo]
)`;

const parseSgfMoves = (sgf) => {
  const moves = [];
  const regex = /;([BW])\[([a-o]{2})\]/g;
  let match;
  while ((match = regex.exec(sgf))) {
    moves.push({ player: match[1] === "B" ? "black" : "white", col: match[2].charCodeAt(0) - 97, row: match[2].charCodeAt(1) - 97, number: moves.length + 1 });
  }
  return moves;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 900, height: 1700 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));
page.on("dialog", (dialog) => dialog.accept("15"));

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);

const importSgf = async (sgf, title) => {
  await page.locator('input[type="file"]').first().setInputFiles({ name: `${title}.sgf`, mimeType: "text/plain", buffer: Buffer.from(sgf) });
  await page.locator('button[aria-label="到最后一手"]').click({ force: true });
  await page.waitForFunction(() => document.querySelectorAll(".stone").length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(400);
};

const readBoardStones = () => page.evaluate(() => {
  const gap = 504 / 14;
  const stones = [];
  for (const circle of document.querySelectorAll("svg circle.stone")) {
    const col = Math.round((Number(circle.getAttribute("cx")) - 34) / gap);
    const row = Math.round((Number(circle.getAttribute("cy")) - 34) / gap);
    const isBlack = (circle.getAttribute("fill") || "").includes("blackStone");
    stones.push({ row, col, player: isBlack ? "black" : "white" });
  }
  const numbers = [];
  for (const text of document.querySelectorAll("svg text.move-number")) {
    const col = Math.round((Number(text.getAttribute("x")) - 34) / gap);
    const row = Math.round((Number(text.getAttribute("y")) - 4.2 - 34) / gap);
    numbers.push({ row, col, number: Number(text.textContent) });
  }
  return { stones, numbers };
});

const feedImage = async (buffer, name) => {
  const seen = [];
  const poll = setInterval(() => { page.locator(".toast").textContent().then((t) => { const s = (t || "").trim(); if (s && !seen.includes(s)) seen.push(s); }).catch(() => {}); }, 150);
  await page.locator('input[accept="image/*"]').setInputFiles({ name, mimeType: "image/png", buffer });
  for (let i = 0; i < 400 && !seen.some((s) => s.includes("图片识谱")); i += 1) await page.waitForTimeout(150);
  clearInterval(poll);
  await page.locator('button[aria-label="到最后一手"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
  return seen.find((s) => s.includes("图片识谱")) || "";
};

const results = [];
for (const [title, sgf] of [["complex", sgfComplex], ["edges", sgfEdges]]) {
  const moves = parseSgfMoves(sgf);
  const expectedBoard = new Map(moves.map((m) => [`${m.row},${m.col}`, m.player]));
  const expectedNumber = new Map(moves.map((m) => [`${m.row},${m.col}`, m.number]));

  await importSgf(sgf, title);
  const boardEl = page.locator("svg.renju-board").first();
  const numberedShot = await boardEl.screenshot();
  const numberToggle = page.locator('button:has-text("隐藏手数")').first();
  let hasNumbers = false;
  if (await numberToggle.count()) {
    await numberToggle.click({ force: true }).catch(() => {});
    await page.waitForTimeout(250);
    hasNumbers = true;
  }
  const plainShot = hasNumbers ? await boardEl.screenshot() : null;
  const fullShot = await page.screenshot({ fullPage: false });
  if (hasNumbers) {
    await page.locator('button:has-text("显示手数")').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(250);
  }

  for (const [variant, shot] of [["numbered", numberedShot], ["plain", plainShot], ["fullpage", fullShot]]) {
    if (!shot) continue;
    fs.writeFileSync(`tmp/input-${title}-${variant}.png`, shot);
    const toast = await feedImage(shot, `${title}-${variant}.png`);
    const { stones, numbers } = await readBoardStones();
    const recognized = new Map(stones.map((s) => [`${s.row},${s.col}`, s.player]));
    let hits = 0, colorMiss = 0, misses = 0, falsePositives = 0;
    for (const [key, player] of expectedBoard) {
      const got = recognized.get(key);
      if (!got) misses += 1;
      else if (got !== player) colorMiss += 1;
      else hits += 1;
    }
    for (const key of recognized.keys()) if (!expectedBoard.has(key)) falsePositives += 1;
    let numberHits = 0;
    for (const n of numbers) if (expectedNumber.get(`${n.row},${n.col}`) === n.number) numberHits += 1;
    const missList = [];
    for (const [key, player] of expectedBoard) {
      const got = recognized.get(key);
      if (!got) missList.push(key + "(miss)");
      else if (got !== player) missList.push(key + "(color:" + got + ")");
    }
    for (const key of recognized.keys()) if (!expectedBoard.has(key)) missList.push(key + "(extra)");
    results.push({
      title, variant,
      toast: toast.slice(0, 140),
      expected: expectedBoard.size, recognized: stones.length,
      hits, colorMiss, misses, falsePositives,
      accuracy: Math.round((hits / expectedBoard.size) * 1000) / 10,
      numberChain: `${numberHits}/${moves.length}`,
      detail: missList.slice(0, 40),
    });
    const resultShot = await page.locator("svg.renju-board").first().screenshot();
    fs.writeFileSync(`tmp/rec-${title}-${variant}.png`, resultShot);
    if (variant !== "fullpage") await importSgf(sgf, title);
  }
}
fs.writeFileSync("tmp/image-rec-results.json", JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
console.log("pageerrors:", errors.slice(0, 4));
await browser.close();
if (errors.length || results.some((result) => result.accuracy < 90 || result.colorMiss > 0 || result.falsePositives > 0)) process.exitCode = 1;
