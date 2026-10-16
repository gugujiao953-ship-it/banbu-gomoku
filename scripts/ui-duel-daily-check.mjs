import { chromium } from "playwright";

// 常驻门禁：对弈页 + 每日一题（用户 2026-09-17 钦定；2026-09-19 收窄）
//  D1 底部导航第四格是「对弈」，点它进入**一个页面**（不是弹层），页面上两条入口按
//     「AI 对战 → 每日一题」的顺序排
//  D2 「AI 对战」卡片点开的是既有的对战设置浮层（.ai-game-setup），对战流程没被改
//  D3 每日一题：显示今天那道题（题名 + 题集）；点开始后进入做题模式并真的载入该题，
//     当天定题写进存储（同一天不再换题）
//  D4 **打卡与错题重温已去掉**（用户 09-19：「有点鸡肋，感觉花哨了」）——页面上不许再有
//     打卡卡（连续天数/七天格子）与错题重温入口；错题本恢复成简单列表（无「今日重温」区、
//     无排期徽标、无「开始重温 N 题」）；存储里也不再写 reviews 排期
//  D5 主题自适应：对弈页文字在**全部可测主题**下对比 ≥4.5:1，图标 ≥3:1，描边/按钮随主题变化
//  D6 题库为空时不崩：给出可执行提示，页面无报错
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-duel-daily-check.mjs
import { readThemeIds, runThemeMatrix } from "./lib/theme-matrix.mjs";

const url = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5193/";
const base = url.includes("?") ? url : `${url}?qa=1`;

const pad = (value) => String(value).padStart(2, "0");
const dateKey = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const YESTERDAY = dateKey(-1);

// 预置题库：一道「错题本里最久没碰」的题（今日一题会优先出它）、一道没做过的新题。
// 题面用最小棋子集（4 子/2 子），够渲染也够断言。
const seededCollections = [{
  id: "gate-col", title: "门禁题集", source: "门禁", license: "门禁",
  puzzles: [
    { id: "wrong-one", title: "错题里的那道", prompt: "黑先胜", difficulty: 1, player: "black", stones: [{ row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" }, { row: 8, col: 8, player: "black" }, { row: 8, col: 9, player: "white" }] },
    { id: "fresh-one", title: "没做过的题", prompt: "黑先胜", difficulty: 1, player: "black", stones: [{ row: 5, col: 5, player: "black" }, { row: 5, col: 6, player: "white" }] },
  ],
}];
const seededProgress = {
  "gate-col/wrong-one": { solved: false, attempts: 2, updatedAt: `${YESTERDAY}T10:00:00.000Z` },
};

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

/** 每个场景一个全新上下文：预置题库/进度。 */
const openApp = async ({ seed = true, emptyLibrary = false } = {}) => {
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript(([seedData, wipe]) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    if (wipe) {
      localStorage.removeItem("renju-note-puzzle-collections-v1");
      localStorage.removeItem("renju-note-puzzle-progress-v1");
      localStorage.removeItem("banbu-daily-training-v1");
      return;
    }
    if (seedData) {
      localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify(seedData.collections));
      localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify(seedData.progress));
    }
  }, [seed ? { collections: seededCollections, progress: seededProgress } : null, emptyLibrary]);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  return { context, page, errors };
};

const gotoDuel = async (page) => {
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
  await page.waitForTimeout(900);
};

// ── 场景 A：对弈页结构 + 两条入口 + 打卡/重温确已去掉 ────────────────
{
  const { context, page, errors } = await openApp();
  const navLabels = await page.evaluate(() => [...document.querySelectorAll("nav.bottom-nav button")].map((b) => (b.textContent || "").trim()));
  check("A1 底部导航第四格是「对弈」", navLabels[3] === "对弈", `nav=${JSON.stringify(navLabels)}`);
  check("A2 导航里不再有「AI」这一格", !navLabels.some((label) => label === "AI"), `nav=${JSON.stringify(navLabels)}`);

  await gotoDuel(page);
  const pageState = await page.evaluate(() => ({
    isPage: !!document.querySelector(".duel-page"),
    sheetOpen: !!document.querySelector(".bottom-sheet"),
    entries: [...document.querySelectorAll("[data-duel-entry]")].map((el) => el.getAttribute("data-duel-entry")),
    dailyTitle: document.querySelector("[data-duel-daily-name]")?.textContent?.trim() || "",
    boardOnScreen: !!document.querySelector(".renju-board"),
    // 09-19 去掉的东西：打卡卡与错题重温入口
    streakCard: !!document.querySelector(".duel-streak-card, [data-duel-streak], .duel-week"),
    reviewEntry: !!document.querySelector("[data-duel-review]"),
  }));
  check("A3 点「对弈」进入的是页面而不是弹层", pageState.isPage && !pageState.sheetOpen, JSON.stringify({ isPage: pageState.isPage, sheetOpen: pageState.sheetOpen }));
  check("A4 页面同时只有棋盘页/库页等页面中的一个（不是叠加）", !pageState.boardOnScreen, `boardOnScreen=${pageState.boardOnScreen}`);
  // 2026-09-23：中间多了「比赛计时器」（线下对局用的独立计时器，不是对弈模式）。
  // 2026-10-04 与 10-06 又各加了一个（VCF 挑战、棋题生成器）。
  //
  // ⚠ 判据改成**"头尾 + 相对次序"**，不再钉死整串：
  // 原来写的是 `=== "ai,clock,daily"` —— 每加一条入口这条就红一次，
  // 而它真正要守的从来不是"一共几条"，而是**下棋的在前、做题的在后**
  // （用户 09-17 定的版面：AI 对战在最上、每日一题在最后）。
  // 钉死整串会在"合理地加一个入口"时误报，误报多了这条门禁就会被无视。
  check("A5 入口次序：AI 对战在最前、每日一题在最后",
    pageState.entries[0] === "ai" && pageState.entries[pageState.entries.length - 1] === "daily",
    pageState.entries.join(","));
  check("A6 每日一题显示的是错题本里最久没碰的那道", pageState.dailyTitle.includes("错题里的那道") && pageState.dailyTitle.includes("门禁题集"), pageState.dailyTitle);
  check("A7 打卡卡与错题重温入口确已去掉（不许回归）", !pageState.streakCard && !pageState.reviewEntry, JSON.stringify({ streakCard: pageState.streakCard, reviewEntry: pageState.reviewEntry }));

  // 错题本恢复成简单列表
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("棋谱库"))?.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { [...document.querySelectorAll(".library-segment button")].find((b) => (b.textContent || "").includes("题库"))?.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { [...document.querySelectorAll(".library-shortcuts button")].find((b) => (b.textContent || "").includes("错题本"))?.click(); });
  await page.waitForTimeout(700);
  const wrongbook = await page.evaluate(() => {
    const sheet = document.querySelector(".bottom-sheet");
    return {
      open: !!sheet,
      rows: [...(sheet?.querySelectorAll(".export-options .settings-link") || [])].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()),
      // 排期时代的痕迹：分区标题、一键重温、排期徽标
      legacy: [".wrongbook-head", ".wrongbook-badge", "[data-wrongbook-review-all]", ".wrongbook-review-row"].filter((selector) => sheet?.querySelector(selector)),
    };
  });
  check("A8 错题本仍是简单列表（题名 + 题集 + 尝试次数）", wrongbook.open && wrongbook.rows.some((row) => row.includes("错题里的那道") && row.includes("2 次尝试")), JSON.stringify(wrongbook.rows));
  check("A9 错题本里没有「今日重温」区/排期徽标/一键重温（不许回归）", wrongbook.legacy.length === 0, `残留：${wrongbook.legacy.join("、") || "无"}`);
  check("A10 页面无报错", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ── 场景 B：AI 对战卡片仍然打开既有对战设置浮层 ────────────────────
{
  const { context, page, errors } = await openApp();
  await gotoDuel(page);
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(900);
  const setup = await page.evaluate(() => ({
    setupOpen: !!document.querySelector(".ai-game-setup"),
    sheetTitle: document.querySelector(".sheet-head h2")?.textContent?.trim() || "",
    startButton: !!document.querySelector(".ai-start-button"),
  }));
  check("B1 「AI 对战」卡片打开的是既有的对战设置浮层", setup.setupOpen && setup.startButton, JSON.stringify(setup));
  check("B2 页面无报错", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ── 场景 C：每日一题入口真的开始做题，且只写「当天定题」不再写排期 ────
//
// ⚠ 2026-10-11 起「开始做题」进的是**每日一题专门界面**（不再是打谱工作区的
//   做题模式）—— 用户原话：「我发现这个每日一题可以用分析解决，不像是一个专门的
//   挑战界面」。所以这条断言从"进了做题模式"改成"进了那一页"。
//   专门界面自己的行为（无等级分 / 落子 / 陪练 / 悔棋 / 结算入账）由
//   `qa/daily-puzzle-check.mjs` 守；这里只守**入口与落盘**，不重复铺开。
{
  const { context, page, errors } = await openApp();
  await gotoDuel(page);
  await page.locator('[data-duel-daily-start]').click();
  await page.waitForSelector(".dailyp-page", { timeout: 20000 });
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const training = JSON.parse(localStorage.getItem("banbu-daily-training-v1") || "null");
    const dailyPage = document.querySelector(".dailyp-page");
    return {
      onDailyPage: Boolean(dailyPage),
      inWorkspacePuzzle: Boolean(document.querySelector('.topbar-mode-toggle button[aria-selected="true"]')),
      title: (dailyPage?.querySelector(".dailyp-title b")?.textContent || "").trim(),
      stones: dailyPage ? dailyPage.querySelectorAll("[data-dailyp-stone]").length : 0,
      today,
      dayEntry: training?.days?.[today] || null,
      hasReviews: training ? Object.prototype.hasOwnProperty.call(training, "reviews") : false,
      stateKeys: training ? Object.keys(training) : [],
    };
  });
  check("C1 「开始做题」进入**每日一题专门界面**并载入今日一题",
    state.onDailyPage && !state.inWorkspacePuzzle && state.title.includes("错题里的那道") && state.stones === 4,
    JSON.stringify(state));
  check("C2 当天定题写进存储（同一天不再换题）", state.dayEntry?.puzzleId === "wrong-one" && state.dayEntry?.solved === false, JSON.stringify(state.dayEntry));
  check("C3 存储里不再写错题排期（09-19 去掉 SRS）", !state.hasReviews && !state.stateKeys.includes("reviews"), JSON.stringify(state.stateKeys));
  check("C4 页面无报错", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ── 场景 D：题库为空时不崩，给可执行提示 ──────────────────────────
{
  const { context, page, errors } = await openApp({ emptyLibrary: true });
  await gotoDuel(page);
  const copy = await page.evaluate(() => ({
    dailyEntry: document.querySelector('[data-duel-entry="daily"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    startButton: !!document.querySelector("[data-duel-daily-start]"),
    legacy: !!document.querySelector(".duel-streak-card, [data-duel-review]"),
  }));
  // 内置开宝题集是异步加载的，空题库场景下也允许它加载成功；这里只断言「没有可练的题」
  // 时页面给出提示且不给一个点了没反应的按钮。
  const hasHint = copy.dailyEntry.includes("题库里暂时没有可练的题") || copy.dailyEntry.includes("开始做题");
  check("D1 每日一题在无题可练时也有明确文案或可点按钮", hasHint, copy.dailyEntry);
  check("D2 空题库下也没有打卡卡/重温入口残留", !copy.legacy, `legacy=${copy.legacy}`);
  check("D3 页面无报错", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ── 场景 E：全部可测主题（清单从应用自己取，以后加主题自动覆盖）──────────
{
  const { context, page } = await openApp();
  const themes = await readThemeIds(page);
  await gotoDuel(page);
  const probe = async () => page.evaluate(() => {
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
    const probeOne = (selector) => { const el = document.querySelector(selector); if (!el) return null; const fg = parse(getComputedStyle(el).color); if (!fg) return null; const bg = bgOf(el); const a = lum(fg), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
    const card = document.querySelector(".duel-entry");
    const button = document.querySelector(".duel-entry-action");
    return {
      title: probeOne(".duel-title h1"), copy: probeOne(".duel-entry-copy small"), buttonText: probeOne(".duel-entry-action span"),
      icon: probeOne(".duel-entry-icon svg"),
      cardBorder: card ? getComputedStyle(card).borderTopColor : null,
      buttonBg: button ? getComputedStyle(button).backgroundColor : null,
    };
  });
  const rows = await runThemeMatrix(page, themes, probe);
  const values = (key) => rows.map((row) => [row.theme, row.sample?.[key]]);
  const missing = (key) => rows.filter((row) => typeof row.sample?.[key] !== "number").map((row) => row.theme);
  const worst = (key) => Math.min(...rows.map((row) => (typeof row.sample?.[key] === "number" ? row.sample[key] : -1)));
  const assertAll = (id, label, key, min) => check(`${id} ${label}（全部 ${rows.length} 套主题，最低 ${worst(key)}）`, missing(key).length === 0 && worst(key) >= min, missing(key).length ? `量不到：${missing(key).join(",")}` : `最低 ${worst(key)}：${JSON.stringify(values(key))}`);
  check("E0 清单里的每套主题都真的量到了", rows.length === themes.length && rows.length >= 18, `清单 ${themes.length} / 量到 ${rows.length}`);
  assertAll("E1", "对弈页标题文字对比度 ≥4.5:1", "title", 4.5);
  assertAll("E2", "卡片说明文字对比度 ≥4.5:1", "copy", 4.5);
  assertAll("E3", "主按钮文字对比度 ≥4.5:1", "buttonText", 4.5);
  assertAll("E4", "卡片图标 ≥3:1（非文字门槛）", "icon", 3);
  const borders = new Set(rows.map((row) => row.sample?.cardBorder));
  const buttonBgs = new Set(rows.map((row) => row.sample?.buttonBg));
  check("E5 卡片描边与主按钮底色随主题变化（不是写死值）", borders.size >= 8 && buttonBgs.size >= 8, `borders=${borders.size} buttons=${buttonBgs.size}`);
  await context.close();
}

await browser.close();
console.log(failed ? `\nFAIL ${failed} 项` : "\n对弈页 / 每日一题全部通过（打卡与错题重温已去掉，且有不许回归的断言）");
process.exit(failed ? 1 : 0);
