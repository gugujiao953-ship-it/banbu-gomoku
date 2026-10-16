/**
 * 门禁：两段式「点击确认落子」（用户 2026-10-13：「五林那些专业软件都是点一下再确认才落子」）。
 * 断言（按状态逐条报，不汇成一个总分）：
 *  ① 设置页搜「落子」能命中这一行，且**行标题就叫**「点击确认落子」
 *     —— SettingChip 的开关是 `<label>` 里的 checkbox、整行没有 button，所以只能按行标题找复选框；
 *     而分区可见性由 `searchable(标题, 摘要, 关键词)` 决定，新芯片不进关键词表就搜不到（第一轮验收红在这）。
 *  ② 点一下 → 独立标量键 `banbu-placement-confirm-v1` 写 true；再点 → 写回 false（不是删键）。
 *     单独一个键是故意的：`banbu-enhancement-settings-v1` 那份整对象在挂载时就整份写回 localStorage，
 *     新字段塞进去会被老存档锁死默认值（见 memory「默认值被整份存档锁死」）。
 *  ③ 打谱盘：第一下出圈且不落子 → 第二下点同格才落子 → 圈清掉 → 点别的空位只挪圈。
 *  ④ 关档后点一下直接落子、不出圈（默认行为一字不变）。
 *  ⑤ 每日一题与 VCF 挑战各自的盘（`[data-dailyp-pending]` / `[data-vcf-pending]`）走同一套两段式。
 *     这两块盘的点击落在整个 `<svg onClick>` 上、按 clientX 算格子，**必须用真实鼠标事件**；
 *     合成 `dispatchEvent` 会绕过命中测试，把"某层盖住棋盘"这类 bug 全部掩盖掉
 *     —— R191 横屏那档的 `.vcfch-rail` 就是这么漏过去的（见 ⑥）。
 *  ⑥ 横屏回归：棋盘中心点 `elementFromPoint` 必须落回棋盘自己，不许是 `.vcfch-rail`。
 *
 * 用法：`node qa/placement-confirm-check.mjs`（默认打 `QA_BASE_URL`，没设就是 5193）
 * ⚠  的 VCF 段要**生产构建 + preview**：按需出题走的是生成器 worker，dev 上它是坏的
 *    （见 memory「VCF 挑战排查十一条坑」）。本条**没有**进 `qa/regression-manifest.mjs`，
 *    就是因为 `npm run qa:browser` 跑的是 dev 服务器；要全自动请先把它拆成 dev 能跑的前四段。
 */
import { chromium } from "playwright";

const BASE = (process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5193/") + (process.env.QA_BASE_URL?.includes("?") ? "" : "?qa=1");
const KEY = "banbu-placement-confirm-v1";
const steps = [], fail = [];
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${n}${x ? ` :: ${x}` : ""}`); steps.push(n); if (!c) fail.push(n); };

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, serviceWorkers: "block" });
await ctx.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));

const nav = (label) => page.evaluate((l) => {
  const n = document.querySelector('nav[aria-label="主导航"]');
  const b = n ? [...n.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === l) : null;
  if (!b) return false; b.click(); return true;
}, label);
const tapText = (t) => page.evaluate((label) => {
  const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes(label));
  if (!b) return null; b.click(); return (b.textContent || "").trim().slice(0, 20);
}, t);
/** 只在某个作用域里找**可见**按钮：对弈 hub 的卡片与 VCF 页里的按钮文字一模一样（都叫「开始挑战」）。 */
const tapTextIn = (scope, t) => page.evaluate(({ scope, t }) => {
  const root = document.querySelector(scope);
  if (!root) return null;
  const b = [...root.querySelectorAll("button")].find((e) => (e.textContent || "").includes(t) && e.getBoundingClientRect().width > 0);
  if (!b) return null; b.click(); return (b.textContent || "").trim().slice(0, 20);
}, { scope, t });
const typeSearch = (value) => page.evaluate((v) => {
  const el = document.querySelector('input[type="search"]');
  if (!el) return "无搜索框";
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (set) set.call(el, v); else el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "ok";
}, value);
const chipRows = (title) => page.evaluate((t) => [...document.querySelectorAll(".setting-chip")]
  .filter((r) => (r.querySelector(".setting-chip-title")?.textContent || "").trim() === t).length, title);
const toggleChip = (title) => page.evaluate((t) => {
  const row = [...document.querySelectorAll(".setting-chip")].find((r) => (r.querySelector(".setting-chip-title")?.textContent || "").trim() === t);
  const box = row ? row.querySelector('input[type="checkbox"]') : null;
  if (!box) return null;
  box.click();
  return box.checked;
}, title);
/* 打谱那张 `Board`：每个格子是一个 `circle.board-hit`，aria-label 以坐标开头。
   坐标必须**精确匹配**："H1" 是 "H10"~"H15" 的前缀，startsWith 会点到别的格子上。 */
const cellLabel = (x, y) => page.evaluate(({ x, y }) => {
  const c = [...document.querySelectorAll("circle.board-hit")].find((e) => new RegExp(`^${x}${y}(?![0-9])`).test(e.getAttribute("aria-label") || ""));
  return c ? (c.getAttribute("aria-label") || "") : null;
}, { x, y });
const tapXY = (x, y) => page.evaluate(({ x, y }) => {
  const c = [...document.querySelectorAll("circle.board-hit")].find((e) => new RegExp(`^${x}${y}(?![0-9])`).test(e.getAttribute("aria-label") || ""));
  if (!c) return false;
  c.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
}, { x, y });
const pickFar = () => page.evaluate(() => {
  const occ = [], emp = [];
  for (const c of document.querySelectorAll("circle.board-hit")) {
    const m = /^([A-O])(\d+)/.exec(c.getAttribute("aria-label") || "");
    if (!m) continue;
    (/已有棋子/.test(c.getAttribute("aria-label")) ? occ : emp).push({ x: m[1].charCodeAt(0) - 65, y: Number(m[2]), n: m[1] + m[2] });
  }
  if (!emp.length) return null;
  let best = emp[0], bd = -1;
  for (const e of emp) { const d = occ.length ? Math.min(...occ.map((o) => Math.abs(o.x - e.x) + Math.abs(o.y - e.y))) : 1e9; if (d > bd) { bd = d; best = e; } }
  return best.n;
});

/** 自带棋盘（VCF / 每日一题）：交点从网格线 `<line x1=px(i)>` 反推，再用真实鼠标点。 */
const cellPoint = (sel, r, c) => page.evaluate(({ sel, r, c }) => {
  const svg = document.querySelector(sel);
  if (!svg) return { err: "没有棋盘" };
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox?.baseVal?.width || 0;
  const xs = [...new Set([...svg.querySelectorAll("line")].map((l) => Number(l.getAttribute("x1"))).filter(Number.isFinite))].sort((a, b) => a - b);
  if (xs.length < 15) return { err: `网格线只取到 ${xs.length} 条` };
  return { x: rect.left + xs[c] * rect.width / vb, y: rect.top + xs[r] * rect.height / vb };
}, { sel, r, c });
const stoneCount = (sel) => page.evaluate((s) => {
  const svg = document.querySelector(s);
  if (!svg) return -1;
  return svg.querySelectorAll("g.material-stone, circle[fill='#16161a'], circle[fill='#fdfdf8']").length;
}, sel);
const order = [7, 6, 8, 5, 9, 4, 10, 3, 11, 2, 12, 1, 13, 0, 14];
async function twoTapReal(label, sel, ringSel) {
  const ringCount = () => page.evaluate((s) => document.querySelectorAll(s).length, ringSel);
  const base = await stoneCount(sel);
  let hit = null;
  for (const r of order) {
    for (const c of order) {
      const p = await cellPoint(sel, r, c);
      if (p.err) { ok(`${label}：能算出交点坐标`, false, p.err); return; }
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(320);
      if (await ringCount() > 0) { hit = { r, c, p }; break; }
    }
    if (hit) break;
  }
  if (!hit) { ok(`${label}：第一下在空位出圈`, false, "225 个交点都没出圈（多半没进对局阶段）"); return; }
  ok(`${label}：第一下（${String.fromCharCode(65 + hit.c)}${15 - hit.r}）出圈、子数没变`, (await ringCount()) > 0 && (await stoneCount(sel)) === base, `子 ${base} 组`);
  await page.mouse.click(hit.p.x, hit.p.y);
  await page.waitForTimeout(1100);
  const after = await stoneCount(sel);
  const msg = await page.evaluate(() => (document.querySelector(".vcfch-message")?.textContent || "").trim().slice(0, 40));
  /* VCF 只收"形成四"的落点：第二下被它自己的规则拒绝并说明，同样证明这一手已经交出去了。 */
  ok(`${label}：第二下同格才把这一手交给对局逻辑`, after > base || Boolean(msg), `子 ${base} → ${after}${msg ? ` · 页面说「${msg}」` : ""}`);
  ok(`${label}：落子后圈清掉`, (await ringCount()) === 0);
}

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2600);

// ── ② 设置：搜得到、点得动、写独立标量键 ────────────────────────
ok("导航进设置", await nav("设置"));
await page.waitForTimeout(1500);
await typeSearch("落子");
await page.waitForTimeout(1200);
ok("① 搜索「落子」命中「点击确认落子」这一行", (await chipRows("点击确认落子")) > 0);
const key0 = await page.evaluate((k) => localStorage.getItem(k), KEY);
const on = await toggleChip("点击确认落子");
await page.waitForTimeout(1000);
const key1 = await page.evaluate((k) => localStorage.getItem(k), KEY);
ok("② 打开 → banbu-placement-confirm-v1 = true", key1 === "true" && on === true, `键 ${String(key0)} → ${String(key1)}`);

// ── ③ 打谱两段式 ─────────────────────────────────────────────
await nav("打谱");
await page.waitForTimeout(1800);
ok("③ 打谱盘命中格存在", (await page.evaluate(() => document.querySelectorAll("circle.board-hit").length)) > 200);
const pend = () => page.evaluate(() => document.querySelectorAll("[data-board-pending]").length);
const c1 = await pickFar();
await tapXY(c1[0], c1.slice(1));
await page.waitForTimeout(500);
ok(`③ 第一下（${c1}）画出待确认圈`, (await pend()) > 0, `圈 ${await pend()} 个`);
ok("③ 第一下没有落子", /空位/.test(String(await cellLabel(c1[0], c1.slice(1)))), String(await cellLabel(c1[0], c1.slice(1))));
await tapXY(c1[0], c1.slice(1));
await page.waitForTimeout(900);
ok(`③ 第二下点同格（${c1}）才落子`, /已有棋子/.test(String(await cellLabel(c1[0], c1.slice(1)))), String(await cellLabel(c1[0], c1.slice(1))));
ok("③ 落子后圈清掉", (await pend()) === 0);
const c2 = await pickFar();
await tapXY(c2[0], c2.slice(1));
await page.waitForTimeout(600);
ok(`③ 点别的空位（${c2}）只挪圈、不落子`, (await pend()) > 0 && /空位/.test(String(await cellLabel(c2[0], c2.slice(1)))), `圈 ${await pend()} 个`);

// ── ④ 关档 → 回到点击直接落子 ────────────────────────────────
await nav("设置");
await page.waitForTimeout(1400);
await typeSearch("落子");
await page.waitForTimeout(900);
const off = await toggleChip("点击确认落子");
await page.waitForTimeout(900);
const key2 = await page.evaluate((k) => localStorage.getItem(k), KEY);
ok("④ 再点一次 → 写回 false（不是删键、不是 true）", key2 === "false" && off === false, `键 ${String(key2)}`);
await nav("打谱");
await page.waitForTimeout(1500);
const c3 = await pickFar();
await tapXY(c3[0], c3.slice(1));
await page.waitForTimeout(700);
ok(`④ 关档后点一下（${c3}）直接落子、不出圈`, /已有棋子/.test(String(await cellLabel(c3[0], c3.slice(1)))) && (await pend()) === 0);

// ──  每日一题（先做它：VCF 那局退出要过确认框）────────────────
/* ④ 已经把开关**关掉**了（那是它要证的回落），所以这里再打开一次 —— 顺带第二次走 on 路径，
   证明这个键不是"只写一次就锁住"。 */
await nav("设置");
await page.waitForTimeout(1400);
await typeSearch("落子");
await page.waitForTimeout(900);
await toggleChip("点击确认落子");
await page.waitForTimeout(900);
ok("⑤ 进两块自带棋盘前重新打开开关", (await page.evaluate((k) => localStorage.getItem(k), KEY)) === "true");
await nav("对弈");
await page.waitForTimeout(1600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "放弃草稿并切换");
  if (b) b.click();
});
await page.waitForTimeout(1000);
await tapTextIn("body", "开始做题");
await page.waitForTimeout(2800);
if (await page.evaluate(() => !!document.querySelector("svg.dailyp-board"))) {
  await twoTapReal("⑤ 每日一题", "svg.dailyp-board", "[data-dailyp-pending]");
} else ok("⑤ 每日一题界面打开", false);

// ── ⑤⑥ VCF 挑战（需要生产构建 + preview：dev 上按需出题是坏的）──
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
await nav("对弈");
await page.waitForTimeout(1500);
await tapText("开始挑战");
await page.waitForTimeout(2400);
await tapTextIn(".vcfch-page", "开始挑战");
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await page.waitForTimeout(1500);
  ready = await page.evaluate(() => !!document.querySelector("svg.vcfch-board") && !!document.querySelector(".vcfch-meta"));
}
ok("⑤ VCF 出题成功、进入对局", ready, ready ? "" : "等 60s 没等到 .vcfch-meta（dev 服务器上这段必挂）");
if (ready) {
  const hit = await page.evaluate(() => {
    const svg = document.querySelector("svg.vcfch-board");
    const rect = svg.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { inside: svg.contains(top) || top === svg, tag: top ? `${top.tagName.toLowerCase()}.${(top.getAttribute("class") || "").slice(0, 24)}` : null };
  });
  ok("⑥ 横屏棋盘中心的命中测试落在棋盘自己（不被 .vcfch-rail 盖住）", hit.inside, `最上层 = ${hit.tag}`);
  await twoTapReal("⑤ VCF 挑战", "svg.vcfch-board", "[data-vcf-pending]");
}

ok("全程无 pageerror", errs.length === 0, errs.slice(0, 3).join(" ; "));
console.log(`\n${fail.length === 0 ? "全部通过" : `失败 ${fail.length} 条`}: ${steps.length} 项`);
await browser.close();
process.exit(fail.length === 0 ? 0 : 1);
