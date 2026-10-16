/**
 * 每日一题**专门界面**的端到端探针（2026-10-11）。
 *
 * 验的是用户点名的那几件事：
 *  · 从对弈页点「开始做题」进的是**一个新的独立页**（不是打谱工作区的做题模式）；
 *  · 这一页**没有** VCF 那套"挑战"的东西（等级分 / 棋力档位 / 倒计时 / 道具）；
 *  · 棋盘真的能落子、陪练会应手、走错只提示不判负；
 *  · 悔棋 / 重来能用；赢了弹结算、并真的入账（进度 + 棋魂）；
 *  · 系统返回（安卓返回键）先递请求、由页面自己判要不要拦。
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4321/";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
};

const pad = (value) => String(value).padStart(2, "0");
const dateKey = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const TODAY = dateKey(0);
const YESTERDAY = dateKey(-1);

// 预置一道"白先"的题：白先能顺带验"胜负相对人算"（白棋成五也算赢）。
//
// ⚠ 光有题集还不够：`decideDailyPuzzle` 优先出「错题本里最久没碰的」，
// 其次是「没做过的新题里按日期哈希挑一道」—— 题库里有几百道内置题，
// 光塞一道自定义题**大概率挑不到它**（第一版门禁就是这么失败的：
// 实际出的是「第 30 题 · 三手胜1-入门题」）。
// 所以同时塞一条"做过但没攻克"的进度，让它稳稳成为**第一优先**的候选。
const seeded = {
  collections: [{
    id: "gate-daily", title: "门禁题集", source: "门禁", license: "门禁",
    puzzles: [{
      id: "daily-one", title: "门禁的每日一题", prompt: "白先胜", difficulty: 3, player: "white",
      // 预置两个子（黑天元、白相邻）；白方从第 8 行连五就赢
      stones: [{ row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" }],
    }],
  }],
  progress: {
    "gate-daily/daily-one": { solved: false, attempts: 2, updatedAt: `${YESTERDAY}T10:00:00.000Z` },
  },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const errors = [];
await context.addInitScript(([seed]) => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify(seed.collections));
  localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify(seed.progress));
}, [seeded]);
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(900);

// ── 1. 进入：从对弈页点开始 ────────────────────────────────────────
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);
const dailyName = await page.locator("[data-duel-daily-name]").first().textContent().catch(() => "");
check("对弈页显示了今天的题", /门禁的每日一题/.test(dailyName || ""), (dailyName || "").trim());
await page.locator("[data-duel-daily-start]").click();
await page.waitForSelector(".dailyp-page", { timeout: 20000 });
await page.waitForTimeout(700);

check("进的是**独立页**（不是打谱工作区）", await page.locator(".dailyp-page").count() > 0);
check("对弈首页已被这一页取代（没同时显示入口列表）", await page.locator("[data-duel-entry='daily']").count() === 0);

// ── 2. 没有"挑战"那套东西（用户点名别照搬）────────────────────────
const challengeBits = await page.evaluate(() => {
  const page_ = document.querySelector(".dailyp-page");
  return {
    rating: Boolean(page_?.querySelector(".vcfch-rating-inline, [class*='rating']")),
    level: Boolean(page_?.querySelector(".vcfch-level-chip, [class*='level-chip']")),
    clock: Boolean(page_?.querySelector(".vcfch-clock, [class*='clock']")),
    items: Boolean(page_?.querySelector("[data-vcf-items], .vcfch-item")),
    pace: Boolean(page_?.querySelector(".vcfch-picker-row")),
    text: (page_?.textContent || "").replace(/\s+/g, " ").trim(),
  };
});
check("没有等级分", !challengeBits.rating && !challengeBits.level, challengeBits.rating ? "找到等级分元素" : "干净");
check("没有倒计时", !challengeBits.clock);
check("没有 VCF 道具卡", !challengeBits.items);
check("没有棋力/计时档位选择器", !challengeBits.pace);
check("标题与题集都在", /门禁的每日一题/.test(challengeBits.text) && /门禁题集/.test(challengeBits.text));
check("写明你执哪一方（白先题要显示执白）", /你执白/.test(challengeBits.text), challengeBits.text.slice(0, 90));

// ── 3. 棋盘落子 + 陪练应手 ─────────────────────────────────────────
const boardBox = await page.locator(".dailyp-board").boundingBox();
check("棋盘已渲染", Boolean(boardBox));
const clickCell = async (row, col) => {
  const size = 15;
  // 与页面同一套几何：视野 572、边距 34（默认档）
  const margin = 34, cell = (572 - margin * 2) / (size - 1);
  const x = boardBox.x + ((margin + col * cell) / 572) * boardBox.width;
  const y = boardBox.y + ((margin + row * cell) / 572) * boardBox.height;
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
};
const stonesAt = () => page.evaluate(() => document.querySelectorAll("[data-dailyp-stone]").length);

const before = await stonesAt();
check("开局盘上是题目的预置子（2 颗）", before === 2, `${before} 颗`);
await clickCell(8, 8);
await page.waitForTimeout(300);
const afterMine = await stonesAt();
// ⚠ 期望**不是**"恰好 +1"：这一手落下去之后陪练可能已经应了（本地引擎很快，
// 300ms 足够算完一手浅题），那时盘上会多两颗。要验的是"**我点的那一子在盘上**"。
const mineLanded = await page.evaluate((index) => Boolean(document.querySelector(`[data-dailyp-stone="${index}"]`)), 8 * 15 + 8);
check("点空位能落子（我下的那一子在盘上）", mineLanded && afterMine > before, `${before} → ${afterMine}，我那一子=${mineLanded}`);

// 陪练应手（等它算完；最长 8s 兜底）
await page.waitForTimeout(3200);
const afterReply = await stonesAt();
check("陪练会应一手", afterReply >= 4, `落子后 ${afterMine} → ${afterReply}`);

// ── 4. 走错只提示、不判负 ──────────────────────────────────────────
const occupied = await page.evaluate(() => {
  const first = document.querySelector("[data-dailyp-stone]");
  return first ? Number(first.getAttribute("data-dailyp-stone")) : -1;
});
if (occupied >= 0) {
  const row = Math.floor(occupied / 15), col = occupied % 15;
  await clickCell(row, col);
  await page.waitForTimeout(250);
}
const occupiedState = await page.evaluate(() => ({
  hint: (document.querySelector("[data-dailyp-hint]")?.textContent || "").trim(),
  outcome: document.querySelector(".dailyp-page")?.getAttribute("data-dailyp-outcome"),
  settle: Boolean(document.querySelector("[data-dailyp-settle]")),
}));
check("点已有子**不判负**、只给提示", occupiedState.outcome === "playing" && !occupiedState.settle && occupiedState.hint.length > 0,
  `hint「${occupiedState.hint}」`);

// ── 5. 悔棋 / 重来 ────────────────────────────────────────────────
const beforeUndo = await stonesAt();
await page.locator("[data-dailyp-undo]").click();
await page.waitForTimeout(400);
const afterUndo = await stonesAt();
check("悔棋一次退两手（自己 + 陪练）", afterUndo < beforeUndo, `${beforeUndo} → ${afterUndo}`);
await page.locator("[data-dailyp-restart]").click();
await page.waitForTimeout(400);
check("重来回到开局（只剩预置子）", (await stonesAt()) === 2, `${await stonesAt()} 颗`);

// ── 6. 赢一局：结算 + 落盘 ─────────────────────────────────────────
/**
 * 用一个**新的浏览器上下文**验结算：预置一个"一步就能赢"的局面
 * （白方第 8 行已有第 4–7 列四子，轮到白走；成五的端点是第 3 列或第 8 列，
 * 陪练只有一手、最多堵掉一个端点）。
 *
 * ⚠ 不能"先跑一半再改存储 + reload"：`addInitScript` **每次导航都会重跑**
 * （包括 `page.reload()`），会把改动覆盖回最初的种子 —— 第一版门禁就是这么
 * 一直赢不了的（改了存储、reload、又变回两道子的开局）。
 * 每个场景各自一个上下文，就没有这种互相覆盖。
 */
const winStones = [
  { row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" },
  ...[4, 5, 6, 7].map((col) => ({ row: 8, col, player: "white" })),
];
const winContext = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await winContext.addInitScript(([rows, yesterday]) => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify([{
    id: "gate-daily", title: "门禁题集", source: "门禁", license: "门禁",
    puzzles: [{ id: "daily-one", title: "门禁的每日一题", prompt: "白先胜", difficulty: 3, player: "white", stones: rows }],
  }]));
  localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify({
    "gate-daily/daily-one": { solved: false, attempts: 2, updatedAt: `${yesterday}T10:00:00.000Z` },
  }));
}, [winStones, YESTERDAY]);
const winPage = await winContext.newPage();
const winErrors = [];
winPage.on("pageerror", (error) => winErrors.push(String(error)));
await winPage.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
await winPage.waitForSelector(".bottom-nav button", { timeout: 180000 });
await winPage.waitForTimeout(900);
await winPage.locator(".bottom-nav button", { hasText: "对弈" }).click();
await winPage.waitForTimeout(500);
await winPage.locator("[data-duel-daily-start]").click();
await winPage.waitForSelector(".dailyp-page", { timeout: 20000 });
await winPage.waitForTimeout(700);

const winBox = await winPage.locator(".dailyp-board").boundingBox();
const winClick = async (row, col) => {
  const margin = 34, cell = (572 - margin * 2) / 14;
  await winPage.mouse.click(
    winBox.x + ((margin + col * cell) / 572) * winBox.width,
    winBox.y + ((margin + row * cell) / 572) * winBox.height,
  );
  await winPage.waitForTimeout(2600);
};
await winClick(8, 3);
let winSettled = await winPage.locator("[data-dailyp-settle]").count() > 0;
if (!winSettled) { await winClick(8, 8); winSettled = await winPage.locator("[data-dailyp-settle]").count() > 0; }
const won = await winPage.locator("[data-dailyp-settle='won']").count() > 0;
check("能真的赢下一局（白棋成五也算赢 —— 胜负相对人算）", won, won ? "弹出胜局结算" : "没走到胜局");

if (won) {
  const ledger = await winPage.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]");
    return { entries: raw.length, reasons: raw.map((e) => e.reason), sum: raw.reduce((s, e) => s + e.amount, 0) };
  });
  // 每日一题那笔必须发（本轮修的死源之一），攻克一题那笔也要发（另一个漏发）
  check("结算真的入账（棋魂账本有记录）", ledger.entries > 0, `余额 ${ledger.sum}、${ledger.entries} 条`);
  check("**「完成每日一题」那笔发了**", ledger.reasons.includes("daily"), ledger.reasons.join(","));
  check("**「攻克一道题」那笔也发了**（题库的题也算，说明页这么承诺的）", ledger.reasons.includes("puzzle-solve"), ledger.reasons.join(","));
  const progress = await winPage.evaluate(() => JSON.parse(localStorage.getItem("renju-note-puzzle-progress-v1") || "{}"));
  check("做题进度落盘（solved = true）", progress["gate-daily/daily-one"]?.solved === true, JSON.stringify(progress));
  const daily = await winPage.evaluate(() => JSON.parse(localStorage.getItem("banbu-daily-training-v1") || "{}"));
  check("每日一题存档记下今天完成", daily?.days?.[TODAY]?.solved === true, JSON.stringify(daily?.days || {}));
  // 结算弹窗上那两枚按钮都在（"再来一遍 / 看棋盘"）
  check("结算弹窗有出口（看棋盘 / 再来一遍）",
    await winPage.locator("[data-dailyp-settle-close]").count() === 1);
  check("赢局之后悔棋被禁用（不许反复弹结算）",
    await winPage.locator("[data-dailyp-undo]").isDisabled());
  check("结算场景零未捕获异常", winErrors.length === 0, winErrors.slice(0, 2).join(" | "));
} else {
  check("结算入账（未走到胜局，跳过）", true, "skipped");
}
await winContext.close();

// ── 7. 全部可测主题下的文字对比度（本项目对**每一页**都做这件事）────────
//
// 这一页是新加的，配色又用了挑战页那套变量（--surface/--muted/--gold…）——
// 而这类问题正是"在浅色主题上看不清"的高发区（弹窗那批字实测踩过 25 条失败）。
// 所以和其它页面一样逐主题量一遍：文字 ≥4.5:1、图标 ≥3:1。
{
  const themeContext = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await themeContext.addInitScript(([seed, yesterday]) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify(seed));
    localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify({
      "gate-daily/daily-one": { solved: false, attempts: 2, updatedAt: `${yesterday}T10:00:00.000Z` },
    }));
  }, [seeded.collections, YESTERDAY]);
  const themePage = await themeContext.newPage();
  await themePage.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await themePage.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await themePage.waitForTimeout(800);
  const { readThemeIds, runThemeMatrix } = await import("../scripts/lib/theme-matrix.mjs");
  const themes = await readThemeIds(themePage);
  await themePage.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await themePage.waitForTimeout(500);
  await themePage.locator("[data-duel-daily-start]").click();
  await themePage.waitForSelector(".dailyp-page", { timeout: 20000 });
  await themePage.waitForTimeout(500);
  const probe = async () => themePage.evaluate(() => {
    const parse = (css) => {
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(String(css || ""));
      if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, 1];
      const rgb = /rgba?\(([^)]+)\)/.exec(String(css || ""));
      if (!rgb) return null;
      const parts = rgb[1].split(/[,\s/]+/).map(Number);
      return parts.length < 3 ? null : [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const bgOf = (el) => { let n = el; let base = [255, 255, 255, 1]; const layers = []; while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } n = n.parentElement; } for (let i = layers.length - 1; i >= 0; i -= 1) { const l = layers[i]; base = [l[0] * l[3] + base[0] * (1 - l[3]), l[1] * l[3] + base[1] * (1 - l[3]), l[2] * l[3] + base[2] * (1 - l[3]), 1]; } return base; };
    const lum = (c) => 0.2126 * ((c[0] / 255) <= 0.03928 ? (c[0] / 255) / 12.92 : (((c[0] / 255) + 0.055) / 1.055) ** 2.4) + 0.7152 * ((c[1] / 255) <= 0.03928 ? (c[1] / 255) / 12.92 : (((c[1] / 255) + 0.055) / 1.055) ** 2.4) + 0.0722 * ((c[2] / 255) <= 0.03928 ? (c[2] / 255) / 12.92 : (((c[2] / 255) + 0.055) / 1.055) ** 2.4);
    const one = (selector) => { const el = document.querySelector(selector); if (!el) return null; const fg = parse(getComputedStyle(el).color); if (!fg) return null; const bg = bgOf(el); const a = lum(fg), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
    /**
     * ⚠ 悔棋按钮要**在取样这一刻**去掉 `disabled`（不能在外面去一次）：
     * `runThemeMatrix` 每套主题都会切 `data-theme` → React 重渲染 → 按钮按真实状态
     * **又变回禁用**，于是量的还是禁用态（第一版就栽在这上面，一直报 3.89）。
     * 见下面断言处的长注释：禁用态被 WCAG 豁免、且由项目全局令牌统一决定。
     */
    const undoBtn = document.querySelector("[data-dailyp-undo]");
    if (undoBtn) undoBtn.disabled = false;
    const undo = one("[data-dailyp-undo] span");
    if (undoBtn) undoBtn.disabled = true;
    return {
      title: one(".dailyp-title b"),
      collection: one(".dailyp-title small"),
      side: one(".dailyp-side-chip"),
      state: one(".dailyp-state b"),
      hand: one(".dailyp-state small"),
      hint: one(".dailyp-hint"),
      undo,
      difficulty: one(".dailyp-difficulty em"),
      icon: one("[data-dailyp-back] svg"),
    };
  });
  const rows = await runThemeMatrix(themePage, themes, probe);
  const valueOf = (row, key) => (typeof row.sample?.[key] === "number" ? row.sample[key] : -1);
  const worst = (key) => Math.min(...rows.map((row) => valueOf(row, key)));
  /** 只报"最低 1.41"没法修：把**是哪一套主题**一起报出来（逐主题清单漂移是这类红的唯一成因）。 */
  const worstThemes = (key, limit = 4) => rows
    .map((row) => ({ theme: row.theme, v: valueOf(row, key) }))
    .sort((a, b) => a.v - b.v).slice(0, limit)
    .map((item) => `${item.theme} ${item.v}`).join(", ");
  const missing = (key) => rows.filter((row) => typeof row.sample?.[key] !== "number").map((row) => row.theme);
  const assertAll = (label, key, min) => check(`每日一题页 ${label}（全部 ${rows.length} 套主题，最低 ${worst(key)}）`,
    missing(key).length === 0 && worst(key) >= min,
    missing(key).length ? `量不到：${missing(key).join(",")}` : `最低 ${worst(key)} · 最差的几套：${worstThemes(key)}`);
  check("每日一题页在全部主题下都真的量到了", rows.length === themes.length && rows.length >= 18, `清单 ${themes.length} / 量到 ${rows.length}`);
  assertAll("标题 ≥4.5:1", "title", 4.5);
  assertAll("题集名 ≥4.5:1", "collection", 4.5);
  assertAll("执子徽章 ≥4.5:1", "side", 4.5);
  assertAll("状态文字 ≥4.5:1", "state", 4.5);
  assertAll("手数 ≥4.5:1", "hand", 4.5);
  assertAll("提示行 ≥4.5:1", "hint", 4.5);
  /**
   * ⚠ 悔棋按钮量的是**启用态**（去掉 `disabled` 再取样，见 probe 里的注释）。
   *
   * 开局时它必然禁用（还没有可悔的棋），而项目的全局令牌
   * `.app-shell button:disabled:not(.primary-button):not(.danger-button) { color: var(--button-disabled-text) !important }`
   * （`design-tokens.css`）会盖掉本页的 `color` —— 实测 eye 主题 3.89:1。
   *
   * 那**不是本页的问题**，也不该由本页去 `!important` 对拼：
   *  · 那个令牌是项目**有意**的统一禁用观感（注释写着"preserve a visible disabled
   *    surface instead of fading text to near-invisibility"），全应用都吃它；
   *  · 而且 WCAG 1.4.3 **明确豁免**禁用控件（用户此刻无法与之交互）。
   *
   * 但"**启用之后**读不读得清"必须守 —— 那时它才真的需要读（本页实测 9.04:1）。
   */
  assertAll("悔棋按钮文字（启用态）≥4.5:1", "undo", 4.5);
  assertAll("难度星 ≥4.5:1", "difficulty", 4.5);
  assertAll("返回图标 ≥3:1（非文字门槛）", "icon", 3);
  await themeContext.close();
}

check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("失败项：");
  for (const item of failed) console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  process.exit(1);
}
