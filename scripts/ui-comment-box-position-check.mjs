import { chromium } from "playwright";

/**
 * 注释框位置门禁（用户 10-03：「把注释的那个框框改个位置，点开后出现在首行功能区的下面一行，
 * 就是中间功能区的上面。做一下各种情况的适配」）。
 *
 * 改前的实测事实：`{commentPreview}` 排在 `.action-layout-workspace` 的**最后一个**子节点
 * （走棋行、子功能区都在它上面），手机竖屏点开「注释框」时它落在整块最底，
 * 常常要往下滚才看得见——这正是群友说"注释功能框容易看不到"的那个框。
 *
 * 断言的是**顺序不变式**（不只是"存在"）：首行功能区 < 注释框 < 常驻栏 < 走棋行 < 子功能区，
 * 并且注释框挪上去以后没有把棋盘挤没、没有引入横向溢出。
 *
 * 用法：BANBU_URL=http://127.0.0.1:5721/ node scripts/ui-comment-box-position-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5577/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const rects = (page) => page.evaluate(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
  return {
    dock: r(".dock-tabs"), comment: r(".comment-review"), bar: r(".record-command-bar"),
    moves: r(".moves-row"), sub: r(".context-dock"), board: r(".board-scroller"),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
});

/** 顺序不变式：注释框必须夹在首行功能区与常驻栏之间。 */
const orderOk = (m) => Boolean(m.dock && m.comment && m.bar)
  && m.comment.top >= m.dock.bottom - 2
  && m.comment.bottom <= m.bar.top + 2;

const session = await browser.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, serviceWorkers: "block" });
const page = await session.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-font-scale-v1", "xlarge");
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40_000 });
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("打谱"))?.click(); });
await page.waitForSelector(".record-command-bar", { timeout: 20_000 });
await page.waitForTimeout(900);

const openComment = async () => {
  if (!(await page.locator(".comment-review").count())) await page.locator('[data-action-id="comment"]').click();
  await page.locator(".comment-review").waitFor({ timeout: 8_000 });
  await page.waitForTimeout(400);
};
const closeComment = async () => {
  if (await page.locator(".comment-review").count()) await page.locator('[data-action-id="comment"]').click();
  await page.waitForTimeout(400);
};

// ── C1 手机竖屏：注释框落在首行功能区之下、常驻栏之上 ──
let m = await rects(page);
check("C1 改前基线：没开注释框时它不在 DOM 里", (await page.locator(".comment-review").count()) === 0, `棋盘 ${m.board?.h}px 高`);
await openComment();
m = await rects(page);
check("C2 注释框在首行功能区下面一行、常驻栏上面", orderOk(m), `首行底 ${m.dock?.bottom} → 注释 ${m.comment?.top}~${m.comment?.bottom} → 常驻顶 ${m.bar?.top}`);
check("C3 注释框在视口内（点开就看得见，不用往下滚）", m.comment.top >= 0 && m.comment.bottom <= m.viewport.h, `注释 ${m.comment?.top}~${m.comment?.bottom} / 视口高 ${m.viewport.h}`);
check("C4 棋盘没有被挤没", m.board.h >= 300, `棋盘 ${m.board?.h}px`);
check("C5 没有横向溢出", m.overflowX <= 1, `溢出 ${m.overflowX}px`);
await page.screenshot({ path: "预览/验证图-本轮/R126-注释框-手机竖-412x900.png" });

// ── C6 叠加标注面板（子功能区）：顺序仍然是 注释 < 常驻 < 走棋 < 子功能区 ──
await page.locator(".dock-tabs button:has-text('标注')").first().click();
await page.waitForTimeout(700);
m = await rects(page);
check("C6 注释框 + 标注面板同开：注释框仍在常驻栏之上", orderOk(m), `注释 ${m.comment?.top}~${m.comment?.bottom} / 常驻顶 ${m.bar?.top}`);
check("C7 同开时子功能区排在走棋行下面", !m.sub || !m.moves || m.sub.top >= m.moves.bottom - 2, `走棋底 ${m.moves?.bottom} → 子功能区顶 ${m.sub?.top}`);
check("C8 同开时仍无横向溢出", m.overflowX <= 1, `溢出 ${m.overflowX}px`);
await page.screenshot({ path: "预览/验证图-本轮/R126-注释框+标注-手机竖.png" });
await page.locator(".dock-tabs button:has-text('标注')").first().click();
await page.waitForTimeout(500);

// ── C9 展开态（双击/按钮放大到 144px）：位置不变、棋盘仍露出大半 ──
await page.locator(".comment-expand-toggle").click();
await page.waitForTimeout(500);
m = await rects(page);
check("C9 注释框放大后仍夹在首行与常驻栏之间", orderOk(m), `注释高 ${m.comment?.h}px`);
check("C10 放大后棋盘顶边仍在视口内", m.board.top >= 0 && m.board.top < m.viewport.h, `棋盘顶 ${m.board?.top} / 视口高 ${m.viewport.h}`);
await page.locator(".comment-expand-toggle").click();
await page.waitForTimeout(400);

// ── C11 关掉注释框后回到原布局 ──
await closeComment();
check("C11 关掉注释框后它从 DOM 移除、常驻栏回到首行下面", (await page.locator(".comment-review").count()) === 0, `常驻顶 ${await page.evaluate(() => Math.round(document.querySelector(".record-command-bar")?.getBoundingClientRect().top ?? -1))}`);

await session.close();

// ── C12 横屏双栏（1180×820）：右栏里同一顺序不变式 ──
for (const [label, vp] of [["横屏双栏 1180×820", { width: 1180, height: 820 }], ["矮横屏 820×400", { width: 820, height: 400 }]]) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: "block" });
  await ctx.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-font-scale-v1", "xlarge"); });
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  p.on("pageerror", (error) => errors.push(`${label}: ${String(error).slice(0, 160)}`));
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".record-command-bar", { timeout: 40_000 });
  await p.waitForTimeout(1200);
  await p.locator('[data-action-id="comment"]').click();
  await p.locator(".comment-review").waitFor({ timeout: 8_000 });
  await p.waitForTimeout(500);
  const mm = await rects(p);
  check(`C12 ${label}：注释框仍在首行功能区与常驻栏之间`, orderOk(mm), `首行底 ${mm.dock?.bottom} → 注释 ${mm.comment?.top}~${mm.comment?.bottom} → 常驻顶 ${mm.bar?.top}`);
  check(`C13 ${label}：无横向溢出`, mm.overflowX <= 1, `溢出 ${mm.overflowX}px`);
  await p.screenshot({ path: `预览/验证图-本轮/R126-注释框-${label.replace(/[ ×]/g, "")}.png` });
  await ctx.close();
}

// ── C14 做题模式：注释框本来就不该出现（commentPreview 带 mode !== "puzzle"） ──
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-font-scale-v1", "xlarge"); });
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  p.on("pageerror", (error) => errors.push(`做题: ${String(error).slice(0, 160)}`));
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("nav.bottom-nav button", { timeout: 40_000 });
  await p.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("做题"))?.click(); });
  await p.waitForTimeout(1800);
  const firstRow = await p.locator(".dock-tabs").count();
  const hasComment = await p.locator(".comment-review").count();
  check("C14 做题界面不渲染注释框", firstRow === 0 ? true : hasComment === 0, `首行功能区 ${firstRow} 个、注释框 ${hasComment} 个`);
  await ctx.close();
}

check("C15 全程无页面错误", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} 项未过` : "\n注释框位置门禁全部通过");
process.exit(failed ? 1 : 0);
