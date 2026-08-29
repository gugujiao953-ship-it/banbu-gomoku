/** Manual real-LIB regression: verify 白启疏星.lib against the oracle walk. */
import fs from "node:fs";
import { chromium } from "playwright";

const libFile = process.env.LIB_FILE || String.raw`D:\五子棋\定式谱\白启疏星.lib`;
const oracleFile = process.env.ORACLE_FILE || "tmp/oracle/lib-oracle-walk-baiqi.json";
const base = process.env.QA_BASE_URL || process.env.OUR_BASE || "http://localhost:5182/";
const maxPaths = Number(process.env.MAX_PATHS || 25);

const oracle = JSON.parse(fs.readFileSync(oracleFile, "utf8"));
const walkByPath = new Map(oracle.walk.map((w) => [w.path.join(","), w]));
const deepPaths = oracle.walk.filter((w) => w.depth >= 4).slice(0, maxPaths).map((w) => w.path);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1600 }, serviceWorkers: "block" });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(libFile);
await page.waitForFunction(() => document.querySelectorAll(".renlib-variation").length > 0, null, { timeout: 600000 });
await page.waitForTimeout(1200);

const domMarkers = async () => page.locator(".renlib-variation").evaluateAll((nodes) => nodes.map((n) => (n.getAttribute("aria-label") || "").replace("变化点 ", "")).filter(Boolean).sort());
const clickCoord = async (coord) => {
  const marker = page.locator(`.renlib-variation[aria-label="变化点 ${coord}"]`).first();
  if (await marker.count()) { await marker.click({ force: true }); return true; }
  return false;
};

let checked = 0, mismatched = 0, replayFailures = 0;
const samples = [];
for (const path of deepPaths) {
  await page.locator('button[aria-label="到第一手"]').click({ force: true });
  await page.waitForTimeout(150);
  let ok = true;
  const snaps = [];
  for (const coord of path) {
    if (!(await clickCoord(coord))) { ok = false; break; }
    await page.waitForTimeout(200);
    snaps.push(await domMarkers());
  }
  if (!ok) { replayFailures += 1; continue; }
  for (let depth = 1; depth <= path.length; depth += 1) {
    const oracleNode = walkByPath.get(path.slice(0, depth).join(","));
    if (!oracleNode) continue;
    const dom = snaps[depth - 1];
    const oracleCoords = oracleNode.nodes.map((n) => n.coord).sort();
    checked += 1;
    const same = dom.length === oracleCoords.length && dom.every((v, i) => v === oracleCoords[i]);
    if (!same) {
      mismatched += 1;
      if (samples.length < 8) samples.push({ path: path.slice(0, depth), domOnly: dom.filter((v) => !oracleCoords.includes(v)), oracleOnly: oracleCoords.filter((v) => !dom.includes(v)) });
    }
  }
}
await page.locator('button[aria-label="到第一手"]').click({ force: true });
await page.waitForTimeout(300);
await page.screenshot({ path: "tmp/baiqi-root.png" });
await browser.close();
console.log("BAIQI_VERIFY", JSON.stringify({ paths: deepPaths.length, checked, mismatched, replayFailures, samples, consoleErrors: errors.slice(0, 6) }, null, 1));
if (mismatched || replayFailures || errors.length) process.exitCode = 1;
