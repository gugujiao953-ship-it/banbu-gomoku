/** Manual 1GB+ LIB regression: verify 斜月.lib — branch markers + label texts
 * + node comments, all against the reference-core oracle. Single session. */
import fs from "node:fs";
import { chromium } from "playwright";

const libFile = process.env.LIB_FILE || String.raw`D:\五子棋\定式谱\斜月.lib`;
const oracleFile = process.env.ORACLE_FILE || "tmp/oracle/lib-oracle-walk-xieyue.json";
const base = process.env.QA_BASE_URL || process.env.OUR_BASE || "http://localhost:5182/";
const maxPaths = Number(process.env.MAX_PATHS || 25);

const oracle = JSON.parse(fs.readFileSync(oracleFile, "utf8"));
const walkByPath = new Map(oracle.walk.map((w) => [w.path.join(","), w]));
const deepPaths = oracle.walk.filter((w) => w.depth >= 4).slice(0, maxPaths).map((w) => w.path);

const normalize = (text) => String(text || "").replace(/\n{3,}/g, "\n\n").trim();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1600 }, serviceWorkers: "block" });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

const importStarted = Date.now();
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(libFile);
await page.waitForFunction(() => document.querySelectorAll(".renlib-variation").length > 0, null, { timeout: 900000 });
const importSeconds = Math.round((Date.now() - importStarted) / 1000);
await page.waitForTimeout(1500);
console.log("import seconds:", importSeconds);

const readMarkers = async () => page.locator(".renlib-variation").evaluateAll((nodes) => nodes.map((n) => ({
  coord: (n.getAttribute("aria-label") || "").replace("变化点 ", ""),
  text: (n.textContent || "").trim(),
})).sort((a, b) => (a.coord < b.coord ? -1 : 1)));

const clickCoord = async (coord) => {
  const marker = page.locator(`.renlib-variation[aria-label="变化点 ${coord}"]`).first();
  if (await marker.count()) { await marker.click({ force: true }); return true; }
  return false;
};
const goRoot = async () => { await page.locator('button[aria-label="到第一手"]').click({ force: true }); await page.waitForTimeout(150); };

// ---------- 1) branch coordinates + label texts ----------
let checked = 0, coordMismatch = 0, labelMismatch = 0, replayFailures = 0;
const samples = [];
for (const path of deepPaths) {
  await goRoot();
  let ok = true;
  const snaps = [];
  for (const coord of path) {
    if (!(await clickCoord(coord))) { ok = false; break; }
    await page.waitForTimeout(200);
    snaps.push(await readMarkers());
  }
  if (!ok) { replayFailures += 1; continue; }
  for (let depth = 1; depth <= path.length; depth += 1) {
    const oracleNode = walkByPath.get(path.slice(0, depth).join(","));
    if (!oracleNode) continue;
    const dom = snaps[depth - 1];
    const oracleCoords = oracleNode.nodes.map((n) => n.coord).sort();
    const domCoords = dom.map((m) => m.coord).sort();
    checked += 1;
    if (!(domCoords.length === oracleCoords.length && domCoords.every((v, i) => v === oracleCoords[i]))) {
      coordMismatch += 1;
      if (samples.length < 8) samples.push({ kind: "coords", path: path.slice(0, depth), domOnly: domCoords.filter((v) => !oracleCoords.includes(v)), oracleOnly: oracleCoords.filter((v) => !domCoords.includes(v)) });
      continue;
    }
    const domLabels = dom.map((m) => `${m.coord}=${m.text || "○"}`).sort();
    const oracleLabels = oracleNode.nodes.map((n) => `${n.coord}=${n.txt || "○"}`).sort();
    if (!domLabels.every((v, i) => v === oracleLabels[i])) {
      labelMismatch += 1;
      if (samples.length < 8) samples.push({ kind: "labels", path: path.slice(0, depth), domOnly: domLabels.filter((v) => !oracleLabels.includes(v)).slice(0, 6), oracleOnly: oracleLabels.filter((v) => !domLabels.includes(v)).slice(0, 6) });
    }
  }
}
console.log("BRANCH_VERIFY", JSON.stringify({ paths: deepPaths.length, checked, coordMismatch, labelMismatch, replayFailures, samples: samples.slice(0, 4) }));

// ---------- 2) comments (rendered in the inline .comment-review area) ----------
let commentChecked = 0, commentMismatch = 0, commentMissing = 0;
const commentSamples = [];
for (const sample of oracle.commentSamples.slice(0, 24)) {
  await goRoot();
  let ok = true;
  for (const coord of sample.path) {
    if (!(await clickCoord(coord))) { ok = false; break; }
    await page.waitForTimeout(200);
  }
  if (!ok) { commentMissing += 1; continue; }
  const expand = page.locator('button[aria-label="展开注释"]');
  if (!(await expand.count())) {
    commentChecked += 1;
    commentMismatch += 1;
    if (commentSamples.length < 6) commentSamples.push({ path: sample.path, expected: sample.comment.slice(0, 60), got: "(无展开注释按钮)" });
    continue;
  }
  await expand.click({ force: true });
  await page.waitForTimeout(250);
  const raw = await page.locator(".comment-review").textContent().catch(() => "");
  const got = normalize(raw).replace(/^当前注释：/, "");
  commentChecked += 1;
  if (got !== normalize(sample.comment)) {
    commentMismatch += 1;
    if (commentSamples.length < 6) commentSamples.push({ path: sample.path, expected: normalize(sample.comment).slice(0, 80), got: got.slice(0, 80) });
  }
  await page.locator('button[aria-label="收起注释"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(120);
}
console.log("COMMENT_VERIFY", JSON.stringify({ commentChecked, commentMismatch, commentMissing, samples: commentSamples }));

// ---------- 3) screenshots ----------
await goRoot();
await page.waitForTimeout(400);
await page.screenshot({ path: "tmp/xieyue-root.png" });
for (const coord of ["I9", "G7", "I10"]) { if (!(await clickCoord(coord))) break; await page.waitForTimeout(300); }
await page.waitForTimeout(600);
await page.screenshot({ path: "tmp/xieyue-path.png" });
await browser.close();
console.log("DONE", JSON.stringify({ errors: errors.slice(0, 6) }));
if (coordMismatch || labelMismatch || replayFailures || commentMismatch || commentMissing || errors.length) process.exitCode = 1;
