// 采集 renjuportal 棋谱/习题棋盘截图 + 手序真值。
// 真值来源：页面内嵌 __NUXT__ 里与**本页**同一 score 对象的 moves（含 x/y/color/number）。
// 2026-10-08 两个坑（都已修）：
//   ① row 约定：页面 y 是「自上而下 0 基」，与应用 row 0 = 顶部一致 → row = y
//     （旧写法 14-y 把整盘翻转，基准里棋子命中率被误报成 23%）。
//   ② 载荷里嵌着相邻棋谱（previous/next）的 moves，取「最长数组」会拿到别的棋局
//     （rp-score-04 图上是 35 子、真值却是 71 手）。现在只认与 game.endNumber 自洽的那一组。
// 用法：MSYS_NO_PATHCONV=1 node qa/tmp-grab-renjuportal.mjs [每种页数]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const out = "qa/fixtures/materials/renjuportal";
mkdirSync(out, { recursive: true });
const limit = Number(process.argv[2] || 8);
const CLIP = { x: 440, y: 380, width: 606, height: 636 };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
const page = await context.newPage();
const index = [];

const collect = async (listUrl, pattern) => {
  await gotoWithRetry(listUrl);
  await page.waitForTimeout(3000);
  return page.$$eval("a", (nodes, pat) => [...new Set(nodes.map((n) => n.href).filter((h) => new RegExp(pat).test(h)))], pattern);
};

/** 站点偶尔慢/断连（实测 puzzle/list 超时一次就把整轮抓取带崩），这里退避重试。 */
const gotoWithRetry = async (url, attempts = 3) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return true;
    } catch (error) {
      console.log(`  （第 ${attempt + 1} 次打开 ${url} 失败：${String(error).slice(0, 60)}）`);
      await page.waitForTimeout(1500 * (attempt + 1));
    }
  }
  return false;
};

/** 屏幕上真正画出来的手数集合（SVG 里每个子一个 <text>，另有 15 个行号标签 1..15）。
 *  这是**本页**棋局的唯一可靠锚点：载荷里嵌着相邻棋谱的 moves（实测某页画面上 35 子、
 *  载荷里却有一份 71 手的自洽数据），只按 endNumber 自洽去选会选错棋局。 */
const readRenderedNumbers = () => page.evaluate(() => {
  const texts = [...document.querySelectorAll("svg text, svg tspan")].map((node) => {
    const rect = node.getBoundingClientRect();
    return { value: Number((node.textContent || "").trim()), x: rect.x, y: rect.y };
  }).filter((item) => Number.isInteger(item.value) && item.value >= 1 && item.value <= 400 && item.x > 0);
  if (texts.length < 15) return null;
  // 行号标签独占最左一条窄带，先按 x 找出它，剩下的才是棋子上的号。
  const minX = Math.min(...texts.map((item) => item.x));
  const labels = texts.filter((item) => item.x < minX + 25).map((item) => item.value);
  const stones = texts.filter((item) => item.x >= minX + 25).map((item) => item.value);
  if (!stones.length) return null;
  const sorted = [...stones].sort((left, right) => left - right);
  const contiguous = sorted.every((value, index) => value === index + 1);
  return { count: stones.length, max: sorted[sorted.length - 1], contiguous, labelCount: labels.length };
});

/** 取与**屏幕画面**自洽的那组 moves（排除载荷里相邻棋谱）。 */
const extractMoves = (expected) => page.evaluate((wanted) => {
  const candidates = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 9) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    if (typeof node.endNumber === "string" && Array.isArray(node.moves)) candidates.push({ endNumber: node.endNumber, moves: node.moves });
    if (Array.isArray(node.moves) && node.moves.length && node.game) candidates.push({ endNumber: node.game.endNumber, moves: node.moves });
    for (const value of Object.values(node)) walk(value, depth + 1);
  };
  walk(window.__NUXT__?.data ?? {}, 0);
  const plays = (moves) => moves.filter((m) => typeof m.x === "number" && typeof m.y === "number" && m.number > 0);
  let best = null;
  for (const candidate of candidates) {
    const moves = plays(candidate.moves);
    const expectedEnd = Number(String(candidate.endNumber || "").split("-").pop());
    const matchesEnd = Number.isFinite(expectedEnd) && moves.length === expectedEnd;
    // 首选「手数 == 屏幕上的手数」；其次 endNumber 自洽；再次最长。
    const score = (wanted && moves.length === wanted ? 100000 : 0) + (matchesEnd ? 1000 : 0) + moves.length;
    if (!best || score > best.score) best = { score, moves, endNumber: candidate.endNumber ?? null, matchesEnd };
  }
  return best ? { ...best, moves: best.moves.map((m) => ({ x: m.x, y: m.y, number: m.number, color: m.color })) } : null;
}, expected);

try {
  // 两种列表各自独立容错：棋谱列表拿到就先抓棋谱，习题列表失败不影响已抓到的素材。
  const scores = await collect("https://renjuportal.com/score/list", "/score/[A-Za-z0-9]+$").catch(() => []);
  const targets = scores.slice(0, limit).map((url) => ({ url, kind: "score" }));
  for (const [number, target] of targets.entries()) {
    try {
      if (!(await gotoWithRetry(target.url))) { console.log(`跳过 ${target.url}: 打不开`); continue; }
      await page.waitForTimeout(2800);
      const rendered = await readRenderedNumbers();
      const extracted = await extractMoves(rendered?.count ?? null);
      if (!extracted || !extracted.moves.length) { console.log(`跳过 ${target.url}: 未取到手序数据`); continue; }
      const filename = `rp-${target.kind}-${String(number + 1).padStart(2, "0")}.png`;
      await page.screenshot({ path: `${out}/${filename}`, clip: CLIP });
      const stones = extracted.moves.map((m) => ({ row: m.y, col: m.x, player: m.color === "black" ? "black" : "white", number: m.number }));
      const anchored = Boolean(rendered) && rendered.count === stones.length && rendered.contiguous;
      writeFileSync(`${out}/${filename.replace(/\.png$/, ".truth.json")}`, JSON.stringify({ boardSize: 15, endNumber: extracted.endNumber, anchored, rendered, source: target.url, stones }, null, 1));
      index.push({ kind: target.kind, url: target.url, file: filename, stones: stones.length, endNumber: extracted.endNumber, anchored });
      console.log(`${filename} ← ${target.url} 真值 ${stones.length} 手 (屏幕 ${rendered ? `${rendered.count} 子/${rendered.max} 号` : "无 SVG 读数"}${anchored ? " ✓锚定" : " ⚠未锚定"})`);
    } catch (error) {
      console.log(`跳过 ${target.url}: ${String(error).slice(0, 120)}`);
    }
  }
  writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1));
} catch (error) {
  console.log("FAILED:", String(error).slice(0, 300));
}
await browser.close();
