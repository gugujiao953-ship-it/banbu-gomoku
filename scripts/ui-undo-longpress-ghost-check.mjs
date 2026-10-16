import { chromium } from "playwright";

/**
 * 功能栏「撤销编辑」长按门禁（用户 10-02：「我发现长按功能栏有一个 bug，就是长按的时候
 * 提示会触发回退功能，我们的功能框出来了，棋也回退了一步」）。
 *
 * 复现出来的机制：撤销按钮长按 520ms 会弹出「撤销历史」面板，而**面板正好盖在手指底下**。
 * 松手时浏览器补发一串合成事件，手机竖屏那发 `click` 命中面板第一行（`undoToStep`）——
 * 实测草稿 4 步掉到 2、第 4 手变第 0 手；平板横屏则是 `mousedown` 打在遮罩上，面板刚弹出来
 * 就被自己关掉（按住期间面板=1、松手=0）。桌面鼠标不会命中（click 落在按钮自己身上，
 * 由 `suppressUndoClick` 吃掉），所以这条**只有触摸端会犯**，必须用真触摸事件量。
 *
 * 断言三件事：① 长按只出面板，草稿一步都不许多退；② 面板留在屏幕上（不被松手那一下关掉）；
 * ③ 吞点击不能把正常交互一起吞了——长按之后真点撤销仍要撤一步、面板里的行仍要能回退。
 *
 * 用法：BANBU_URL=http://127.0.0.1:5651/ node scripts/ui-undo-longpress-ghost-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5577/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const open = async (width, height, touch) => {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".board-hit", { timeout: 20_000 });
  await page.waitForTimeout(500);
  for (const label of ["H8", "I9", "H9", "G7"]) {
    await page.locator(`.board-hit[aria-label^="${label}"]`).first().click({ force: true });
    await page.waitForTimeout(220);
  }
  const undoButton = page.locator('[aria-label="撤销编辑"]').first();
  const state = async () => ({
    ops: Number(((await undoButton.getAttribute("title")) || "").match(/共 (\d+) 步/)?.[1] ?? -1),
    hand: Number((await page.locator("body").innerText()).match(/第\s*(\d+)\s*手/)?.[1] ?? -1),
    sheet: await page.locator(".version-history-sheet").count(),
  });
  /** 真长按：触摸走 CDP 的 touchStart/touchEnd（合成事件那一段才是 bug 的来源），鼠标走 down/up。 */
  const longPress = async () => {
    const box = await undoButton.boundingBox();
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    if (touch) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await page.waitForTimeout(720);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(720);
      await page.mouse.up();
    }
    await page.waitForTimeout(480);
  };
  return { context, page, undoButton, state, longPress, errors };
};

try {
  // ── A 手机竖屏触摸：面板出来 + 草稿不许动 ────────────────────────────────
  const phone = await open(412, 900, true);
  const before = await phone.state();
  await phone.longPress();
  const after = await phone.state();
  check("A1 手机触摸长按撤销：只出面板，草稿一步没退",
    after.sheet === 1 && after.ops === before.ops && after.hand === before.hand, `前 ${JSON.stringify(before)} → 后 ${JSON.stringify(after)}`);
  check("A2 手机无页面错误", phone.errors.length === 0, phone.errors.join(" | "));

  // ── B 吞点击不能把正常交互一起吞 ─────────────────────────────────────────
  await phone.page.locator('.bottom-sheet [aria-label="关闭"]').first().click({ force: true });
  await phone.page.waitForTimeout(400);
  const beforeTap = await phone.state();
  await phone.undoButton.click({ force: true });
  await phone.page.waitForTimeout(450);
  const afterTap = await phone.state();
  check("B1 长按之后真点撤销：仍然正常撤一步（那把锁没卡住）", afterTap.ops === beforeTap.ops - 1, `前 ${JSON.stringify(beforeTap)} → 后 ${JSON.stringify(afterTap)}`);

  const held = await open(412, 900, true);
  await held.longPress();
  const rows = await held.page.locator(".version-history-sheet button.settings-link").count();
  const beforeRow = await held.state();
  await held.page.locator(".version-history-sheet button.settings-link").first().click({ force: true });
  await held.page.waitForTimeout(450);
  const afterRow = await held.state();
  check("B2 面板里的行仍然可点：点第一行回退到那一步之前", rows > 0 && afterRow.ops < beforeRow.ops, `行数 ${rows}，前 ${JSON.stringify(beforeRow)} → 后 ${JSON.stringify(afterRow)}`);
  await phone.context.close();
  await held.context.close();

  // ── C 平板横屏触摸：面板不能被松手那一下关掉 ─────────────────────────────
  const pad = await open(1180, 820, true);
  const padBefore = await pad.state();
  await pad.longPress();
  const padAfter = await pad.state();
  check("C1 平板横屏触摸长按：面板留着、草稿没退（合成 mousedown 不再关掉自己）",
    padAfter.sheet === 1 && padAfter.ops === padBefore.ops, `前 ${JSON.stringify(padBefore)} → 后 ${JSON.stringify(padAfter)}`);
  await pad.context.close();

  // ── D 桌面鼠标：老口径不变（面板出来、不撤销）────────────────────────────
  const desk = await open(1440, 900, false);
  const deskBefore = await desk.state();
  await desk.longPress();
  const deskAfter = await desk.state();
  check("D1 桌面鼠标长按：面板出来、草稿没退", deskAfter.sheet === 1 && deskAfter.ops === deskBefore.ops, `前 ${JSON.stringify(deskBefore)} → 后 ${JSON.stringify(deskAfter)}`);
  await desk.context.close();
} finally {
  await browser.close();
}

if (failed) { console.log(`\n${failed} 条 FAIL`); process.exit(1); }
console.log("\n长按撤销幽灵点击门禁全部通过");
