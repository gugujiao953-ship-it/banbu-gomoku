import { chromium } from "playwright";
import { readThemeIds, runThemeMatrix, sampleManyScript, weakThemes, minRatioOf } from "./lib/theme-matrix.mjs";

/**
 * 对弈「战绩与等级分」面板门禁（用户 10-02：「关于用户数据的一个版面，放到对弈里面，
 * 这个小按钮放在右上角吧，点开会有各种信息，比如人机对弈的信息，胜负和情况如何，
 * 然后还有等级分」）。
 *
 * 这条要守的不是"页面画没画出来"，而是**账本与页面必须一致**：
 *  ⓪ 一局没打时也是同一套骨架（等级分卡停在起始分 + 六格 + 表体一行说明 + 最近列表一行说明），
     且两个标签（人机对弈 / VCF 挑战）能来回切；VCF 那一页是壳，六格全「—」，不许放假数字；
  ① 打完一局（这里走认输这条最短路径）必须真的往 `banbu-duel-history-v1` 追加一条，
 *     字段齐全（结果 / 难度档 / 引擎 / 手数 / 用时）——这一层以前什么都不落，
 *     `banbu-duel-session-v1` 是单条会被覆盖、终局即清的快照；
 *  ② 刷新一次不能把同一局记成两局（终局→刷新→恢复→再结算 是最容易重复计数的链）；
 *  ③ 面板上的数字必须等于账本算出来的数（场次、胜负和、当前连串、等级分）；
 *  ④ 空账要显示空态，不许显示 0% 这种"看起来像真数"的东西；
 *  ⑤ 入口按钮不许改动对弈界面的几何（棋盘仍吃满、界面自己不产生滚动）——
 *     `ui-duel-screen-check` 的 F1/F3 也守这两条，这里在**有按钮之后**的状态再量一遍；
 *  ⑥ 20 套主题下面板文字对比 ≥4.5:1。
 *
 * 用法：BANBU_URL=http://127.0.0.1:5671/ node scripts/ui-duel-stats-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5577/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const history = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("banbu-duel-history-v1") || "{}").entries || []; } catch { return []; } });
const navTo = (label) => page.evaluate((l) => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes(l))?.click(); }, label);
const panel = () => page.evaluate(() => {
  const sheet = document.querySelector(".duel-stats-sheet");
  if (!sheet) return null;
  return {
    title: document.querySelector(".bottom-sheet")?.getAttribute("aria-label") || "",
    score: sheet.querySelector("[data-duel-stats-score]")?.textContent?.trim() || null,
    empty: sheet.querySelector(".sheet-empty b")?.textContent?.trim() || null,
    tabs: [...sheet.querySelectorAll("[data-duel-stats-tab]")].map((b) => `${b.getAttribute("data-duel-stats-tab")}=${b.getAttribute("aria-selected")}`),
    blanks: sheet.querySelectorAll(".duel-stats-blank").length,
    dashCells: [...sheet.querySelectorAll(".duel-stats-cell b")].filter((b) => b.textContent?.trim() === "—").length,
    cells: [...sheet.querySelectorAll(".duel-stats-cell")].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()),
    tiers: [...sheet.querySelectorAll(".duel-stats-table tbody tr")].map((row) => row.textContent.replace(/\s+/g, " ").trim()),
    recent: sheet.querySelectorAll("[data-duel-stats-row]").length,
    dots: sheet.querySelectorAll(".duel-stats-curve-dot").length,
  };
});
const closePanel = async () => { await page.locator('.bottom-sheet [aria-label="关闭"]').first().click({ force: true }); await page.waitForTimeout(350); };
/** 灌一份确定性的 30 局账本（5 档 × 4 引擎轮转），用来量曲线、分档表与全主题对比度。 */
const seedThirty = () => page.evaluate(() => {
  const strengths = ["初级", "中级", "高级", "大师", "自由"];
  const engines = ["light", "strong", "tuned", "kata"];
  const entries = [];
  let at = Date.now() - 30 * 36e5;
  for (let i = 0; i < 30; i += 1) entries.push({
    id: `seed-${i}`, at: (at += 36e5), outcome: i % 5 === 0 ? "draw" : i % 3 === 0 ? "lost" : "won",
    reason: i % 3 === 0 ? "认输" : "你连成五子", humanPlayer: i % 2 ? "black" : "white",
    strength: strengths[i % strengths.length], engine: engines[i % engines.length],
    timeLimitMs: i % 4 ? 600000 : 0, thinkTimeMs: 600 * (1 + (i % 5)), thinkDepth: 32,
    moves: 20 + (i % 30), humanElapsedMs: 60000 + i * 5000, forbidden: true,
  });
  localStorage.setItem("banbu-duel-history-v1", JSON.stringify({ version: 1, entries }));
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* 清不掉就当它是干净的 */ } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // ── P1/P2 首页入口与空态 ────────────────────────────────────────────────
  await navTo("对弈");
  await page.waitForTimeout(700);
  check("P1 对弈首页右上角有战绩按钮（aria-label 说清是干什么的）",
    await page.locator("[data-duel-stats]").count() === 1 && (await page.locator("[data-duel-stats]").getAttribute("aria-label")) === "战绩与等级分");
  await page.locator("[data-duel-stats]").click();
  await page.waitForTimeout(600);
  const zero = await panel();
  // 用户 10-02 第二轮：「给我一个固定的面板，现在没有对弈就是空白，我不是要这种的」——
  // 一局没打也要是同一套骨架：等级分卡（停在起始分 1000）+ 六格概览 + 分档表 + 最近对局 + 口径说明，
  // 缺的那格写 0 / 「—」并说明为什么，而不是整块塌成一张空态卡。
  check("P2 零局时骨架照旧：分数停在起始 1000、六格都在、表体与列表各一行说明、没有空态卡",
    zero?.score === "1000" && zero.cells.length === 6 && zero.blanks === 2 && zero.empty === null,
    JSON.stringify({ score: zero?.score, cells: zero.cells.length, blanks: zero.blanks, empty: zero.empty }));
  check("P2b 面板有两个标签：人机对弈（选中）/ VCF 挑战", zero?.tabs.join(",") === "ai=true,vcf=false", JSON.stringify(zero?.tabs));
  await page.locator('[data-duel-stats-tab="vcf"]').click();
  await page.waitForTimeout(500);
  const vcfShell = await panel();
  check("P2c VCF 未做题时保留六格：计数为0、比率与用时为「—」、不造战绩",
    vcfShell?.score === "—" && vcfShell.cells.length === 6 && vcfShell.dashCells === 3
      && vcfShell.cells[0].includes("做题数0") && vcfShell.cells[3].includes("当前连对0")
      && vcfShell.cells[5].includes("最近 20 题失误0") && vcfShell.blanks >= 1 && vcfShell.recent === 0,
    JSON.stringify({ score: vcfShell?.score, dashCells: vcfShell.dashCells, blanks: vcfShell.blanks, recent: vcfShell.recent }));
  await page.locator('[data-duel-stats-tab="ai"]').click();
  await page.waitForTimeout(450);
  check("P2d 切回人机页要还能切回来（标签不是装饰）", (await panel())?.cells.length === 6);
  // 零局那套骨架也要过对比度：空数据的说明文字是 `--muted` 压 `--surface`，
  // 而有数据时这些元素根本不在场，后面的 P8 量不到它们。
  {
    const zeroIds = await readThemeIds(page);
    const zeroSelectors = [".duel-stats-tabs button.active", ".duel-stats-blank", ".duel-stats-score"];
    const zeroRows = await runThemeMatrix(page, zeroIds, () => page.evaluate(sampleManyScript(zeroSelectors)));
    for (const selector of zeroSelectors) {
      const weak = weakThemes(zeroRows, selector, 4.5);
      check(`P2e 零局骨架 ${selector} 在全部 ${zeroIds.length} 套主题下 ≥4.5:1`, weak.length === 0,
        weak.length ? weak.join(", ") : `最低 ${minRatioOf(zeroRows, selector)}`);
    }
  }
  await closePanel();

  // ── P3 对弈界面里的同一枚按钮不许动几何 ─────────────────────────────────
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(900);
  if (await page.locator("[data-duel-resume-new]").count()) { await page.locator("[data-duel-resume-new]").click(); await page.waitForTimeout(700); }
  await page.locator(".ai-game-setup").waitFor();
  if (await page.locator(".ai-float-backdrop").count()) { await page.locator(".ai-float-backdrop").first().click({ position: { x: 4, y: 4 }, force: true }); await page.waitForTimeout(300); }
  await page.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
  await page.locator("[data-duel-screen]").waitFor();
  await page.waitForTimeout(1000);
  const geo = await page.evaluate(() => {
    const box = (document.querySelector("[data-duel-board]") || document.querySelector(".renju-board"))?.getBoundingClientRect();
    return { width: Math.round(box?.width || 0), button: document.querySelectorAll("[data-duel-stats]").length, scroll: document.documentElement.scrollHeight, vh: window.innerHeight };
  });
  check("P3 对弈界面里有同一枚按钮，棋盘仍吃满、界面自己不产生滚动",
    geo.button === 1 && geo.width >= 396 && geo.scroll <= geo.vh + 1, JSON.stringify(geo));

  // ── P4/P5 结算落账 + 面板数字对得上账本 ─────────────────────────────────
  await page.locator(".duel-actions button", { hasText: "认输" }).first().click();
  await page.waitForTimeout(400);
  const confirm = page.locator(".duel-confirm-actions button", { hasText: "认输" }).first();
  if (await confirm.count()) await confirm.click();
  await page.waitForTimeout(900);
  const one = await history();
  check("P4 认输结算后追加一条真账（结果 / 难度档 / 引擎 / 用时都在）",
    one.length === 1 && one[0].outcome === "lost" && Boolean(one[0].strength) && Boolean(one[0].engine) && one[0].humanElapsedMs > 0 && Boolean(one[0].id),
    JSON.stringify(one[0]));
  await page.locator("[data-duel-stats]").click();
  await page.waitForTimeout(600);
  const first = await panel();
  check("P5 面板数字等于账本：场次 1、胜负和 0/1/0、当前 1 连负",
    Boolean(first) && first.cells.some((cell) => cell.startsWith("场次") && cell.includes("1")) && first.cells.some((cell) => cell.includes("0 / 1 / 0")) && first.cells.some((cell) => cell.includes("1 连负")),
    JSON.stringify(first?.cells));
  // 原点 = 初级 AI = 1000：新手第一局输给同档（期望胜率 0.5），K=40 → 恰好 −20
  check("P5b 等级分按 Elo 真的动：新手输给同档初级 AI 扣 20 分（1000 → 980）", first?.score === "980", `面板=${first?.score}`);
  await closePanel();

  // ── P6 刷新不能重复计数 ─────────────────────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  check("P6 刷新后还是 1 条（同一局不记两次）", (await history()).length === 1, `${(await history()).length} 条`);

  // ── P7 有账本时的曲线、分档表、最近列表 ─────────────────────────────────
  await seedThirty();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  await navTo("对弈");
  await page.waitForTimeout(700);
  await page.locator("[data-duel-stats]").click();
  await page.waitForTimeout(700);
  const big = await panel();
  check("P7 30 局：分档表按 难度×引擎 分组、最近只列 10 局、曲线每局一个点",
    Boolean(big) && /^\d+$/.test(big.score || "") && big.tiers.length >= 5 && big.recent === 10 && big.dots === 30,
    JSON.stringify({ score: big?.score, tiers: big?.tiers.length, recent: big?.recent, dots: big?.dots }));
  check("P7b 30 局的场次与胜负和等于账本", big?.cells.some((cell) => cell.startsWith("场次") && cell.includes("30")) && big?.cells.some((cell) => cell.includes("16 / 8 / 6")), JSON.stringify(big?.cells));

  // ── P8 全主题对比度（面板开着量） ───────────────────────────────────────
  const themeIds = await readThemeIds(page);
  const selectors = [".duel-stats-cell b", ".duel-stats-cell small", ".duel-stats-table td", ".duel-stats-rating-meta small", ".duel-stats-result.won", ".duel-stats-result.lost", ".duel-stats-result.draw", ".duel-stats-tabs button.active"];
  const rows = await runThemeMatrix(page, themeIds, () => page.evaluate(sampleManyScript(selectors)));
  for (const selector of selectors) {
    const weak = weakThemes(rows, selector, 4.5);
    check(`P8 ${selector} 在全部 ${themeIds.length} 套主题下 ≥4.5:1`, weak.length === 0, weak.length ? weak.join(", ") : `最低 ${minRatioOf(rows, selector)}`);
  }
  check("P9 无页面错误", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

if (failed) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log("\n对弈战绩面板门禁全部通过");
