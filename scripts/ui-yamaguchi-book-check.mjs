import { chromium } from "playwright";
import fs from "node:fs";
import zlib from "node:zlib";

// Regression gate for the Yamaguchi opening book (T28, 山口五手两打簿).
// Book lives at the ENGINE layer and is picked by openingRule ∈ 山口家族
// (worker bookKindFor). Data: public/opening-book/yamaguchi-v1.json.gz built
// by scripts/build-yamaguchi-book.mjs (rank: smaller = stronger; 败点层 excluded;
// 开局名组 rank2 = 黑第3手可下点——汉字标注在本谱是真着法，不是元数据).
// Flow (五手两打, human 执白): AI opener 摆 1-3（H8 + 两类白2 + 随机定式名点，
// 顶分并列取随机）；「不交换」；脚本按 d3 打点表落白4 → AI 毫秒级宣布两打
// 必须 = 簿 d4 宣布层 top2（第1/2打）→ 人点其一=第5手 → 按 d5 层落白6 →
// AI 第7手 ∈ 簿 d6 候选（键命中时，否则引擎接管）。手序与颜色一律读
// localStorage 草稿链（DOM 顺序≠行棋顺序，别按棋面反推!）。
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-yamaguchi-book-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const book = JSON.parse(zlib.gunzipSync(fs.readFileSync("public/opening-book/yamaguchi-v1.json.gz")).toString());
const SIZE = 15;
const T = (n) => [
  [(r, c) => [r, c], (r, c) => [r, c]],
  [(r, c) => [r, n - c], (r, c) => [r, n - c]],
  [(r, c) => [n - r, c], (r, c) => [n - r, c]],
  [(r, c) => [n - r, n - c], (r, c) => [n - r, n - c]],
  [(r, c) => [c, r], (r, c) => [c, r]],
  [(r, c) => [n - c, n - r], (r, c) => [n - c, n - r]],
  [(r, c) => [c, n - r], (r, c) => [n - c, r]],
  [(r, c) => [n - c, r], (r, c) => [c, n - r]],
];
function lookupRanked(moves) {
  const n = SIZE - 1;
  for (const [fwd, inv] of T(n)) {
    const key = JSON.stringify(moves.map((m) => { const [r, c] = fwd(m.row, m.col); return r * SIZE + c; }));
    const labels = book.positions[key];
    if (!Array.isArray(labels) || !labels.length) continue;
    const ranked = [];
    for (let i = 0; i + 1 < labels.length; i += 2) {
      const [rr, rc] = inv(Math.floor(labels[i] / SIZE), labels[i] % SIZE);
      if (rr < 0 || rr >= SIZE || rc < 0 || rc >= SIZE) continue;
      ranked.push({ row: rr, col: rc, rank: labels[i + 1] });
    }
    if (ranked.length) { ranked.sort((a, b) => a.rank - b.rank); return ranked; }
  }
  return [];
}
const nameOf = (row, col) => `${String.fromCharCode(65 + col)}${15 - row}`;

const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ openingBook: true })); });
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

const toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join("|").slice(0, 160));
const clickPoint = async (name) => { await page.evaluate((pt) => { const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(pt)); cell?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, name); await page.waitForTimeout(300); };
const clickSwapNo = async () => { for (let i = 0; i < 12; i += 1) { const done = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "不交换"); if (b) { b.click(); return true; } return false; }); if (done) return true; await page.waitForTimeout(400); } return false; };
// 草稿链 = 权威手序（含颜色）。children 取最后一步 = 当前线。
const readGame = () => page.evaluate(() => {
  let doc = null;
  for (const k of ["renju-note-active-v1", "renju-note-default-v1"]) {
    try { doc = JSON.parse(localStorage.getItem(k) || "null"); } catch { doc = null; }
    if (doc && doc.nodes && doc.rootId) break;
  }
  if (!doc || !doc.nodes || !doc.rootId) return { moves: [], openingRule: null };
  const moves = [];
  let id = doc.rootId; let guard = 0;
  while (id && doc.nodes[id] && guard < 400) {
    const node = doc.nodes[id];
    if (node.move) moves.push({ row: node.move.row, col: node.move.col, player: node.move.player });
    const kids = node.children || [];
    id = kids.length ? (node.preferredChildId && kids.includes(node.preferredChildId) ? node.preferredChildId : kids[kids.length - 1]) : null;
    guard += 1;
  }
  return { moves, openingRule: doc.metadata ? doc.metadata.openingRule : null };
});
const waitMoves = async (n, budgetMs) => { const t0 = Date.now(); while (Date.now() - t0 < budgetMs) { const g = await readGame(); if (g.moves.length >= n) return g; await page.waitForTimeout(400); } return readGame(); };

// S1 人机弹窗：五手两打 + 开局库开关
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("AI"))?.click(); });
await page.waitForTimeout(900);
const bookToggle = await page.evaluate(() => { const b = document.querySelector(".ai-setup-book-toggle"); return b ? b.getAttribute("aria-pressed") === "true" : false; });
check("S1a 人机弹窗开局库开关开启", bookToggle);
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("有禁手"))?.click(); });
await page.waitForTimeout(500);
const fiveTwo = await page.evaluate(() => { const b = [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes("五手两打")); if (b) { b.click(); return true; } return false; });
check("S1b 规则浮层含五手两打", fiveTwo);
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("执白"))?.click(); });
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战"))?.click(); });
await page.waitForTimeout(3000);

// S2 前三手 ∈ 簿候选（读草稿链，顺序与颜色权威）
let g = await waitMoves(3, 15000);
check("S2a 元数据 openingRule=five-two（路由前提）", g.openingRule === "five-two", String(g.openingRule));
check("S2b 开局自动摆满3手（黑1天元）", g.moves.length === 3 && g.moves[0].player === "black" && g.moves[0].row === 7 && g.moves[0].col === 7, JSON.stringify(g.moves.map((m) => nameOf(m.row, m.col))));
const d1 = lookupRanked(g.moves.slice(0, 1)).map((c) => `${c.row},${c.col}`);
check("S2c 白2 ∈ 簿两类白2（数字标 rank1）", d1.includes(`${g.moves[1].row},${g.moves[1].col}`), `${nameOf(g.moves[1].row, g.moves[1].col)} ∈ ${JSON.stringify(d1.map((k) => nameOf(Number(k.split(",")[0]), Number(k.split(",")[1]))))}`);
const d2 = lookupRanked(g.moves.slice(0, 2));
const d2keys = d2.map((c) => `${c.row},${c.col}`);
check("S2d 黑3 ∈ 簿开局名候选组（汉字开局=可下点!）", d2.length >= 6 && d2keys.includes(`${g.moves[2].row},${g.moves[2].col}`), `${nameOf(g.moves[2].row, g.moves[2].col)} ∈ ${d2.length}个定式`);

// S3 交换决策
const swapped = await clickSwapNo();
console.log("S3 交换决策「不交换」:", swapped);
await page.waitForTimeout(1200);

// S4 人白4 = d3 打点表最强点
const d3 = lookupRanked(g.moves.slice(0, 3));
const w4 = d3.length ? d3[0] : { row: 8, col: 8 };
await clickPoint(nameOf(w4.row, w4.col));

// S5 AI 宣布两打 = 簿 d4 宣布层 top2，毫秒级（宣布在白4落子后自动触发）
const g4 = await waitMoves(4, 5000);
const d4 = lookupRanked(g4.moves.slice(0, 4));
const expectKeys = d4.slice(0, 2).map((c) => `${c.row},${c.col}`);
const declareAt = Date.now();
let offeredKeys = [];
for (let i = 0; i < 40; i += 1) {
  offeredKeys = await page.evaluate(() => {
    const marks = [...document.querySelectorAll(".opening-candidate")].map((g2) => g2.getBoundingClientRect());
    const cells = [...document.querySelectorAll(".board-hit")]
      .map((c) => { const m = (c.getAttribute("aria-label") || "").match(/^[A-O]\d{1,2}/); return m ? { name: m[0], r: c.getBoundingClientRect() } : null; })
      .filter(Boolean);
    return marks.map((mk) => {
      const cx = mk.x + mk.width / 2; const cy = mk.y + mk.height / 2;
      let best = null; let bd = Infinity;
      for (const cell of cells) {
        const dx = cell.r.x + cell.r.width / 2 - cx; const dy = cell.r.y + cell.r.height / 2 - cy;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = cell.name; }
      }
      if (!best) return null;
      return `${15 - Number(best.slice(1))},${best.charCodeAt(0) - 65}`;
    }).filter(Boolean);
  });
  if (offeredKeys.length >= 2) break;
  await page.waitForTimeout(400);
}
const offerMs = offeredKeys.length >= 2 ? Date.now() - declareAt : -1;
// 注：计时起点在白4点击之后（宣布可能已在 waitMoves 轮询期间完成）——
// 引擎路径的确定性断言交给 S5a 的「等于簿 top2」（引擎不会精确给出同两点）。
if (d4.length) {
  check("S5a 宣布候选=簿 d4 宣布层 top2（第1/2打）", offeredKeys.length === 2 && expectKeys.every((k) => offeredKeys.includes(k)), `offered=${JSON.stringify(offeredKeys.map((k) => nameOf(Number(k.split(",")[0]), Number(k.split(",")[1]))))} book=${JSON.stringify(expectKeys.map((k) => nameOf(Number(k.split(",")[0]), Number(k.split(",")[1]))))}`);
} else {
  check("S5a 该定式无 d4 簿层→引擎两候选", offeredKeys.length === 2, `offered=${JSON.stringify(offeredKeys)}`);
  console.log("NOTE d4 miss（定式无宣布层，引擎接管属正常）");
}

// S6 人点选第5手 = 簿首打点
const pickKey = expectKeys[0] || offeredKeys[0];
if (!pickKey) {
  check("S6 无法继续（无候选）", false, "abort");
} else {
  const pick = nameOf(Number(pickKey.split(",")[0]), Number(pickKey.split(",")[1]));
  await clickPoint(pick);
  await page.waitForTimeout(1000);
  await clickSwapNo();
  const g5 = await waitMoves(5, 8000);
  const m5 = g5.moves[4];
  check("S6 第5手落位=簿第1打", Boolean(m5) && `${m5.row},${m5.col}` === pickKey && m5.player === "black", JSON.stringify(g5.moves.map((m) => nameOf(m.row, m.col))));

  // S7 白6 按 d5 层；AI 第7手 ∈ d6（命中时）
  const d5 = lookupRanked(g5.moves.slice(0, 5));
  const w6 = d5.length ? d5[0] : { row: 11, col: 7 };
  await clickPoint(nameOf(w6.row, w6.col));
  const g7 = await waitMoves(7, 15000);
  const m7 = g7.moves[6];
  const d6 = lookupRanked(g7.moves.slice(0, 6));
  if (d6.length && m7) {
    check("S7 AI 第7手 ∈ 簿 d6 候选", d6.some((c) => `${c.row},${c.col}` === `${m7.row},${m7.col}`), `${nameOf(m7.row, m7.col)} ∈ ${JSON.stringify(d6.slice(0, 6).map((c) => nameOf(c.row, c.col)))}`);
  } else {
    check("S7 对局推进（d6 未命中时引擎接管）", g7.moves.length >= 7, JSON.stringify(g7.moves.map((m) => nameOf(m.row, m.col))));
  }
}
check("S8 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
