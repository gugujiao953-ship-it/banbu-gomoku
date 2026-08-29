/** Manual real-LIB acceptance — screenshot annotated positions from a real LIB
 * (瑞星棋谱), feed them back through image import, and score against the DOM
 * ground truth read before the shot. */
import fs from "node:fs";
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || process.env.OUR_BASE || "http://localhost:5182/";
const libFile = process.env.LIB_FILE || String.raw`D:\五子棋\定式谱\瑞星棋谱（适合新手+标注详细）.lib`;
const oracleFile = process.env.ORACLE_FILE || "tmp/oracle/lib-oracle-walk.json";
const oracle = JSON.parse(fs.readFileSync(oracleFile, "utf8"));
const deepPaths = oracle.walk.filter((w) => w.depth >= 5).slice(0, 3).map((w) => w.path);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1700 }, serviceWorkers: "block" });
page.on("dialog", async (d) => { await d.accept("15"); });
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 150)));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(libFile);
await page.waitForFunction(() => document.querySelectorAll(".renlib-variation").length > 0, null, { timeout: 300000 });
await page.waitForTimeout(800);

const readStones = () => page.evaluate(() => {
  const gap = 504 / 14;
  const stones = [];
  for (const circle of document.querySelectorAll("svg circle.stone")) {
    const col = Math.round((Number(circle.getAttribute("cx")) - 34) / gap);
    const row = Math.round((Number(circle.getAttribute("cy")) - 34) / gap);
    const isBlack = (circle.getAttribute("fill") || "").includes("blackStone");
    stones.push(`${row},${col}:${isBlack ? "b" : "w"}`);
  }
  return stones.sort();
});
const clickCoord = async (coord) => {
  const marker = page.locator(`.renlib-variation[aria-label="变化点 ${coord}"]`).first();
  if (await marker.count()) { await marker.click({ force: true }); return true; }
  return false;
};
const feedImage = async (buffer, name) => {
  const seen = [];
  const poll = setInterval(() => { page.locator(".toast").textContent().then((t) => { const s = (t || "").trim(); if (s && !seen.includes(s)) seen.push(s); }).catch(() => {}); }, 150);
  await page.locator('input[accept="image/*"]').setInputFiles({ name, mimeType: "image/png", buffer });
  for (let i = 0; i < 400 && !seen.some((s) => s.includes("图片识谱")); i += 1) await page.waitForTimeout(150);
  clearInterval(poll);
  await page.locator('button[aria-label="到最后一手"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  return seen.find((s) => s.includes("图片识谱")) || "";
};

const results = [];
for (const path of deepPaths) {
  await page.locator('button[aria-label="到第一手"]').click({ force: true });
  await page.waitForTimeout(250);
  let ok = true;
  for (const coord of path) { if (!(await clickCoord(coord))) { ok = false; break; } await page.waitForTimeout(220); }
  if (!ok) { results.push({ path: path.join("-"), error: "replay failed" }); continue; }
  await page.waitForTimeout(600);
  const expected = await readStones();
  const boardEl = page.locator("svg.renju-board").first();
  const shots = [["board", await boardEl.screenshot()], ["fullpage", await page.screenshot()]];
  for (const [variant, shot] of shots) {
    fs.writeFileSync(`tmp/ruixing-${path.join("")}-${variant}.png`, shot);
    const toast = await feedImage(shot, `ruixing-${path.join("")}-${variant}.png`);
    const got = await readStones();
    const expectedSet = new Set(expected);
    const gotSet = new Set(got);
    const hits = expected.filter((s) => gotSet.has(s)).length;
    const falsePositives = got.filter((s) => !expectedSet.has(s)).length;
    results.push({
      path: path.join("-"), variant,
      expected: expected.length, recognized: got.length,
      hits, falsePositives,
      accuracy: Math.round((hits / Math.max(1, expected.length)) * 1000) / 10,
      toast: toast.slice(0, 110),
    });
    // reopen the library record and replay for the next variant
    await page.locator('input[type="file"]').first().setInputFiles(libFile);
    await page.waitForFunction(() => document.querySelectorAll(".renlib-variation").length > 0, null, { timeout: 300000 });
    await page.waitForTimeout(700);
    await page.locator('button[aria-label="到第一手"]').click({ force: true });
    await page.waitForTimeout(250);
    for (const coord of path) { await clickCoord(coord); await page.waitForTimeout(180); }
    await page.waitForTimeout(350);
  }
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
if (results.some((result) => result.error || result.accuracy < 90 || result.falsePositives > 0)) process.exitCode = 1;
