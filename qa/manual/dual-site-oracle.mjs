/**
 * Manual real-data regression: one browser session for the entire dual-site acceptance run.
 * - Page A: the local renjutool clone (:5199), app frame → open the real DB,
 *   walk every oracle path, compare the reference's own branch records at
 *   every prefix, then click-through one path for a rendered screenshot.
 * - Page B: our app (:5182), same DB, same paths, DOM marker comparison.
 * Everything happens in this single session; the browser closes at the end.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const dbFile = process.env.DB_FILE || String.raw`D:\五子棋\定式谱\九天指南v5-1.db`;
const oracleFile = process.env.ORACLE_FILE || "tmp/oracle/oracle-walk-v51.json";
const refBase = process.env.REF_BASE || "http://localhost:5199/dbread.html";
const oursBase = process.env.QA_BASE_URL || process.env.OUR_BASE || "http://localhost:5182/";
const maxPaths = Number(process.env.MAX_PATHS || 12);

const oracle = JSON.parse(fs.readFileSync(oracleFile, "utf8"));
const walkByPath = new Map(oracle.walk.map((w) => [w.path.join(","), w]));
const paths = oracle.walk.filter((w) => w.depth >= 4).slice(0, maxPaths).map((w) => w.path);
const dbB64 = fs.readFileSync(dbFile).toString("base64");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1100, height: 1600 }, serviceWorkers: "block" });

// =============== Page A: reference clone ===============
const refPage = await context.newPage();
await refPage.goto(refBase, { waitUntil: "domcontentloaded", timeout: 60000 });
let ref = null;
for (let t = 0; t < 20 && !ref; t += 1) {
  await refPage.waitForTimeout(3000);
  for (const frame of refPage.frames()) {
    const has = await frame.evaluate(() => typeof window.DBClient).catch(() => "na");
    if (has === "object") { ref = frame; break; }
  }
}
if (!ref) { console.log("REFERENCE FRAME NOT READY"); await browser.close(); process.exit(2); }
console.log("reference app frame ready");

const refOpen = await ref.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return window.DBClient.openDatabass(new File([bytes], "jiutian.db"), () => {});
}, dbB64);
console.log("reference open ratio:", refOpen);

// The reference's own branch query + full label semantics (main.js glue).
const refQuery = (position, sideToMove) => ref.evaluate(async ({ position, sideToMove }) => {
  const rotate90 = (cx, cy, _x, _y) => { const x = cx - _x, y = cy - _y; return (cx + y) + (cy - x) * 15; };
  const reflectX = (cy, _x, _y) => _x + (cy * 2 - _y) * 15;
  const transformPosition = (position, steps) => {
    let p = position.slice();
    for (let i = 0; i < steps; i++) {
      const n = new Array(225).fill(0);
      for (let k = 0; k < 225; k++) if (p[k]) n[rotate90(7, 7, k % 15, ~~(k / 15))] = p[k];
      p = n;
    }
    return p;
  };
  const reflectPosition = (p) => {
    const n = new Array(225).fill(0);
    for (let k = 0; k < 225; k++) if (p[k]) n[reflectX(7, k % 15, ~~(k / 15))] = p[k];
    return n;
  };
  const stonesOf = (position, stm) => {
    const b = [], w = [];
    for (let x = 0; x < 15; x++) for (let y = 0; y < 15; y++) {
      const v = position[x + y * 15];
      if (v === 1) b.push(x, y); else if (v === 2) w.push(x, y);
    }
    const side = (b.length >>> 1) - (w.length >>> 1);
    if (side < stm) { for (let i = side; i < stm; i++) b.push(0xFF, 0xFF); }
    else if (side > stm) { for (let i = side; i > stm; i--) w.push(0xFF, 0xFF); }
    return b.concat(w);
  };
  const compareStone = (lx, ly, rx, ry) => {
    lx == 0xFF && (lx = -1); ly == 0xFF && (ly = -1);
    rx == 0xFF && (rx = -1); ry == 0xFF && (ry = -1);
    return (lx * 32 + ly) - (rx * 32 + ry);
  };
  const smallStones = (l, r) => {
    let diff = 0;
    const n = Math.min(l.length, r.length);
    for (let i = 0; i < n && !(diff = compareStone(l[i], l[i + 1], r[i], r[i + 1])); i += 2);
    return diff <= 0 ? l : r;
  };
  const undoTransPoint = (idx, trans) => {
    let loop = (4 - (trans & 3)) & 3;
    while (loop--) idx = rotate90(7, 7, idx % 15, ~~(idx / 15));
    if (trans & 4) { idx = reflectX(7, idx % 15, ~~(idx / 15)); idx = rotate90(7, 7, idx % 15, ~~(idx / 15)); }
    return idx;
  };
  const parentTransOf = (position, stm) => {
    let small = [0xFFFF, 0xFFFF], trans = 0, p = position.slice();
    for (let i = 0; i < 8; i++) {
      if (i === 4) p = reflectPosition(p);
      else if (i) p = transformPosition(p, 1);
      const stones = stonesOf(p, stm);
      const prev = small;
      small = smallStones(stones, small);
      if (stones === small) trans = i;
    }
    return trans;
  };
  const decodeText = (bytes) => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("gb18030").decode(bytes); }
  };
  const readBoardTextMap = (comment, position, parentTrans) => {
    const head = [64, 66, 84, 88, 84, 64];
    const map = {};
    if (comment.length <= 6 || !head.every((v, i) => comment[i] === v)) return map;
    let end = -1;
    for (let i = 6; i < comment.length; i++) if (comment[i] === 8) end = i;
    const boardEnd = end < 0 ? comment.length : end;
    const arr = [];
    let cur = 6;
    while (cur < boardEnd) {
      const x = parseInt(String.fromCharCode(comment[cur++]), 25);
      const y = parseInt(String.fromCharCode(comment[cur++]), 25);
      const labelBuffer = [];
      while (cur < boardEnd && comment[cur] !== 0 && comment[cur] !== 10) labelBuffer.push(comment[cur++]);
      while (cur < boardEnd && (comment[cur] === 0 || comment[cur] === 10)) cur++;
      arr.push({ idx: y * 15 + x, label: decodeText(Uint8Array.from(labelBuffer)) });
    }
    const undone = arr.map((o) => ({ idx: undoTransPoint(o.idx, parentTrans), label: o.label }));
    const strPosition = JSON.stringify(Array.from(position));
    let p = Array.from(position);
    for (let trans = 0; trans < 8; trans++) {
      if (trans === 4) p = reflectPosition(p);
      else if (trans) p = transformPosition(p, 1);
      if (JSON.stringify(p) === strPosition) for (const obj of undone) map[undoTransPoint(obj.idx, trans)] = obj.label;
    }
    return map;
  };
  const MATE_IN = 30000 - 500, MATED_IN = -30000 + 500;
  const i16 = (v) => (v & 0x8000 ? v - 0x10000 : v);
  const readLabel = (buffer) => {
    const label = buffer[0], value = i16(buffer[1] | buffer[2] << 8), bound = (buffer[3] | buffer[4] << 8) & 0b11;
    let s = "";
    if (0 < label && label < 0xFF) {
      s += String.fromCharCode(label);
      if (label === 119 || label === 108) {
        const mateValue = -value;
        if ((label === 119 && mateValue > MATE_IN) || (label === 108 && mateValue < MATED_IN)) s += String(30001 - Math.abs(mateValue));
        else s += "*";
      }
      if (s.length < 3) s = "  ".slice(0, 3 - s.length) + s;
    } else if (label === 0xFF && bound === 0b11) {
      const winRate = value >= MATE_IN ? 1 : value <= MATED_IN ? 0 : 1 / (1 + Math.exp(-value * (1 / 200)));
      s = String(Math.trunc(Math.min(99, Math.max(0, winRate * 100)))).padStart(2, " ") + "%";
    } else s = sideToMove === 0 ? "●" : "○";
    return s.toLocaleUpperCase();
  };
  const parentTrans = parentTransOf(position, sideToMove);
  const info = await window.DBClient.getBranchNodes({ rule: 2, boardWidth: 15, boardHeight: 15, sideToMove, position });
  const boardTextMap = readBoardTextMap(Array.from(info.comment || []), position, parentTrans);
  return (info.records || []).map((r) => ({ idx: r.idx, label: boardTextMap[r.idx] || readLabel(r.buffer) }));
}, { position, sideToMove });

const nameToPoint = (name) => ({ col: name.charCodeAt(0) - 65, row: 15 - Number(name.slice(1)) });
let refChecked = 0, refMismatched = 0;
const refSamples = [];
for (const path of paths) {
  const board = new Uint8Array(225);
  for (let depth = 0; depth <= path.length; depth += 1) {
    const oracleNode = walkByPath.get(path.slice(0, depth).join(","));
    if (oracleNode) {
      const refBranches = await refQuery(Array.from(board), depth % 2);
      const refCoords = refBranches.map((r) => `${String.fromCharCode(65 + (r.idx % 15))}${15 - Math.floor(r.idx / 15)}="${r.label}"`).sort();
      const oracleCoords = oracleNode.branches.map((b) => `${b.coord}="${b.label.replace(/⚫|⚪/g, (m) => (m === "⚫" ? "●" : "○"))}"`).sort();
      refChecked += 1;
      const same = refCoords.length === oracleCoords.length && refCoords.every((v, i) => v === oracleCoords[i]);
      if (!same) {
        refMismatched += 1;
        if (refSamples.length < 6) refSamples.push({ path: path.slice(0, depth), refOnly: refCoords.filter((v) => !oracleCoords.includes(v)).slice(0, 5), oracleOnly: oracleCoords.filter((v) => !refCoords.includes(v)).slice(0, 5) });
      }
    }
    if (depth < path.length) {
      const p = nameToPoint(path[depth]);
      board[p.row * 15 + p.col] = (depth % 2) + 1;
    }
  }
}
console.log("REF_VS_ORACLE", JSON.stringify({ checked: refChecked, mismatched: refMismatched, samples: refSamples }));

// rendered screenshot on the reference: click-through H8,G7,F10 via DBClient-driven board taps
await refPage.bringToFront();
await pageClickPath(refPage, ["H8", "G7", "F10"]);
await refPage.waitForTimeout(2500);
await refPage.screenshot({ path: "tmp/dual-ref-labelled.png" });

async function pageClickPath(page, coords) {
  // board geometry from the rendered coordinate captions
  const axis = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("body *"));
    return null; // geometry resolved by pixel probing below
  });
  void axis;
  const spots = { H8: [550, 694], G7: [491, 757], F10: [429, 820], G9: [491, 631] };
  for (const coord of coords) {
    const [x, y] = spots[coord] || [550, 694];
    await page.mouse.click(x, y);
    await page.waitForTimeout(2000);
  }
}

// =============== Page B: our app ===============
const oursPage = await context.newPage();
await oursPage.goto(oursBase, { waitUntil: "domcontentloaded", timeout: 60000 });
await oursPage.locator('input[type="file"]').first().setInputFiles(dbFile);
await oursPage.waitForFunction(() => document.querySelectorAll(".renlib-variation").length > 0, null, { timeout: 300000 });
await oursPage.waitForTimeout(800);

const domMarkers = () => oursPage.locator(".renlib-variation").evaluateAll((nodes) => nodes.map((n) => (n.getAttribute("aria-label") || "").replace("变化点 ", "")).filter(Boolean).sort());
const clickCoord = async (coord) => {
  const marker = oursPage.locator(`.renlib-variation[aria-label="变化点 ${coord}"]`).first();
  if (await marker.count()) { await marker.click({ force: true }); return true; }
  return false;
};

let oursChecked = 0, oursMismatched = 0, replayFailures = 0;
const oursSamples = [];
for (const path of paths.slice(0, 8)) {
  await oursPage.locator('button[aria-label="到第一手"]').click({ force: true });
  await oursPage.waitForTimeout(150);
  let ok = true;
  const snaps = [];
  for (const coord of path) {
    if (!(await clickCoord(coord))) { ok = false; break; }
    await oursPage.waitForTimeout(180);
    snaps.push(await domMarkers());
  }
  if (!ok) { replayFailures += 1; continue; }
  for (let depth = 1; depth <= path.length; depth += 1) {
    const oracleNode = walkByPath.get(path.slice(0, depth).join(","));
    if (!oracleNode) continue;
    const dom = snaps[depth - 1];
    const oracleCoords = oracleNode.branches.map((b) => b.coord).sort();
    oursChecked += 1;
    const same = dom.length === oracleCoords.length && dom.every((v, i) => v === oracleCoords[i]);
    if (!same) {
      oursMismatched += 1;
      if (oursSamples.length < 6) oursSamples.push({ path: path.slice(0, depth), domOnly: dom.filter((v) => !oracleCoords.includes(v)), oracleOnly: oracleCoords.filter((v) => !dom.includes(v)) });
    }
  }
}
// screenshot of the shared position for side-by-side proof
await oursPage.locator('button[aria-label="到第一手"]').click({ force: true });
await oursPage.waitForTimeout(200);
for (const coord of ["H8", "G7", "F10"]) await clickCoord(coord), await oursPage.waitForTimeout(300);
await oursPage.waitForTimeout(600);
await oursPage.screenshot({ path: "tmp/dual-ours-labelled.png" });

console.log("OURS_VS_ORACLE", JSON.stringify({ checked: oursChecked, mismatched: oursMismatched, replayFailures, samples: oursSamples }));
await browser.close();
console.log("SESSION COMPLETE");
if (refMismatched || oursMismatched || replayFailures) process.exitCode = 1;
