import { chromium } from "playwright";

/**
 * 「对局进行中回到打谱页」门禁（用户 10-02：「还有对弈的时候，回打谱界面，
 * 那个人机对局进行中会把界面打乱」）。
 *
 * 复现出来的真相不是那条提示自己占地方，而是**网格槽位**：`.record-page` 在双栏下是
 * `display:grid`，棋盘 `grid-column:1;grid-row:auto`、右栏钉死 `grid-row:2`。
 * 提示条（`.duel-in-record-notice`）作为新网格项只占第 1 列 → 棋盘被挤到第 3 行，
 * 而第 2 行被 258px 高的右栏撑开：1180×820 实测棋盘 top 168 → **440**、整页多滚 **284px**。
 *
 * 断言全部对着"没有对局时的同一页"量差值，不写绝对像素：
 *  A1 提示条横跨整行（不占单列槽位）
 *  A2 棋盘 top 相对对照只多 ≤70px（改前多 272px）
 *  A3 右栏与棋盘同一行（差 ≤8px；改前 882 vs 224）
 *  A4 棋盘底边仍在视口内（≤ vh+4）
 *  A5 整页滚动相对对照只多 ≤70px（改前多 272px）
 *  A6 无页面错误
 *
 * 用法：BANBU_URL=http://127.0.0.1:5671/ node scripts/ui-duel-in-record-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5577/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const openRecordPage = async (w, h, withDuel) => {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* 清不掉就算了 */ } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  if (withDuel) {
    await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
    await page.waitForTimeout(600);
    await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await page.waitForTimeout(800);
    if (await page.locator("[data-duel-resume-new]").count()) { await page.locator("[data-duel-resume-new]").click(); await page.waitForTimeout(600); }
    await page.locator(".ai-game-setup").waitFor();
    if (await page.locator(".ai-float-backdrop").count()) { await page.locator(".ai-float-backdrop").first().click({ position: { x: 4, y: 4 }, force: true }); await page.waitForTimeout(300); }
    await page.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
    await page.locator("[data-duel-screen]").waitFor();
    await page.waitForTimeout(700);
    for (const label of ["H8", "I9"]) {
      await page.locator(`.board-hit[aria-label^="${label}"]`).first().click({ force: true });
      await page.waitForTimeout(1500);
    }
  }
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click(); });
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
    const page = document.querySelector(".record-page");
    const pageBox = page ? page.getBoundingClientRect() : null;
    return {
      vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight,
      duelScreen: Boolean(document.querySelector("[data-duel-screen]")),
      notice: r("[data-duel-in-record]"), board: r(".record-page .renju-board"), rail: r(".record-page > .record-rail"),
      pageContentRight: pageBox ? pageBox.right - parseFloat(getComputedStyle(page).paddingRight || "0") : 0,
      pageContentLeft: pageBox ? pageBox.left + parseFloat(getComputedStyle(page).paddingLeft || "0") : 0,
    };
  });
  return { context, page, errors, m };
};

try {
  for (const [w, h] of [[1180, 820], [412, 900]]) {
    const base = await openRecordPage(w, h, false);
    check(`N0 ${w}×${h} 对照：此时没有对局提示条`, !base.m.notice && !base.m.duelScreen, JSON.stringify({ notice: Boolean(base.m.notice), duelScreen: base.m.duelScreen }));
    const duel = await openRecordPage(w, h, true);
    check(`N1 ${w}×${h} 提示条在打谱页出现且切走对弈界面后不残留`, Boolean(duel.m.notice) && !duel.m.duelScreen, JSON.stringify({ notice: duel.m.notice, duelScreen: duel.m.duelScreen }));
    if (duel.m.notice) {
      const span = duel.m.notice.right - duel.m.notice.left;
      const content = duel.m.pageContentRight - duel.m.pageContentLeft;
      check(`N2 ${w}×${h} 提示条横跨整行（占满内容宽，不抢单列槽位）`, span >= content * 0.9, `提示条 ${Math.round(span)} / 内容宽 ${Math.round(content)}`);
    }
    const topShift = duel.m.board.top - base.m.board.top;
    check(`N3 ${w}×${h} 棋盘没被挤下去：相对无对局只多 ${Math.round(topShift)}px（改前 1180×820 是 272px）`, topShift <= 70, `对照 top=${Math.round(base.m.board.top)} → 有对局 ${Math.round(duel.m.board.top)}`);
    const scrollDelta = (duel.m.scrollH - duel.m.vh) - (base.m.scrollH - base.m.vh);
    check(`N4 ${w}×${h} 整页滚动没暴增：相对无对局只多 ${Math.round(scrollDelta)}px（改前多 272px）`, scrollDelta <= 70, `对照 ${base.m.scrollH}/${base.m.vh} → 有对局 ${duel.m.scrollH}/${duel.m.vh}`);
    check(`N5 ${w}×${h} 棋盘底边仍在视口内（不用滚就能看全整块盘）`, duel.m.board.bottom <= duel.m.vh + 4, `bottom=${Math.round(duel.m.board.bottom)} vs vh=${duel.m.vh}`);
    if (duel.m.rail) {
      // 「右栏与棋盘同一行」只在**并排（双栏）**时成立；竖屏是单栏，右栏本来就在棋盘下面。
      const sideBySide = duel.m.rail.left >= duel.m.board.right - 4;
      const gap = Math.abs(duel.m.rail.top - duel.m.board.top);
      check(`N6 ${w}×${h} ${sideBySide ? "右栏与棋盘同一行（改前 882 vs 224 差 658px）" : "单栏：右栏排在棋盘下方即可（不要求同行）"}`,
        sideBySide ? gap <= 8 : duel.m.rail.top >= duel.m.board.bottom - 1,
        `右栏 top=${Math.round(duel.m.rail.top)} / 棋盘 top=${Math.round(duel.m.board.top)} bottom=${Math.round(duel.m.board.bottom)} 并排=${sideBySide}`);
    } else {
      check(`N6 ${w}×${h} 右栏与棋盘同一行`, false, "找不到 .record-page > .record-rail");
    }
    check(`N7 ${w}×${h} 无页面错误`, duel.errors.length === 0 && base.errors.length === 0, [...base.errors, ...duel.errors].join(" | "));
    await duel.page.screenshot({ path: `预览/验证图-本轮/R121-打谱对局中-修后-${w}x${h}.png` });
    await duel.context.close();
    await base.context.close();
  }
} finally {
  await browser.close();
}

if (failed) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log("\n对局进行中回打谱门禁全部通过");
