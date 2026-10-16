import { chromium } from "playwright";

/**
 * 快捷中心「左滑退出」门禁（用户 10-02：「往左滑动以退出那个半屏目前还有 bug，
 * 滑了好几下还是没滑好，你看看咋回事」）。
 *
 * 三条根因（详见 `QuickDrawer.tsx` 的手势注释）：
 *  ① 面板本身是 `overflow:auto` 的滚动容器却没写 `touch-action` → WebView 判成滚动、
 *    第二帧发 `pointercancel`，这次滑动被**静默作废**；
 *  ② 阈值 `max(72, 面板宽/2)` ≈173~189px，而面板左缘贴屏幕左边 → 从 x=60 起滑最多只能
 *    滑 60px，**数学上永远达不到**；
 *  ③ 甩动速度从 pointerdown 起算，按下后停顿就把速度稀释没了。
 *
 * ⚠ 必须用真触摸（CDP `Input.dispatchTouchEvent`）：既有那条快捷中心门禁
 * 是 `browser.newContext({viewport})` **没带 hasTouch**、全程鼠标，所以真机触摸路径
 * 从来没被执行过——这正是它躲过所有回归的原因。
 *
 * 用法：BANBU_URL=http://127.0.0.1:5671/ node scripts/ui-quick-drawer-swipe-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5577/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const openDrawer = async (p) => {
  if (await p.locator("#quick-drawer").count()) { await p.waitForTimeout(300); return; }
  await p.locator(".brand-trigger").first().click();
  await p.waitForSelector("#quick-drawer", { timeout: 8_000 });
  await p.waitForTimeout(500);
};
const closeDrawer = async (p) => {
  if (!(await p.locator("#quick-drawer").count())) return;
  await p.evaluate(() => document.querySelector(".quick-drawer-scrim")?.click());
  await p.waitForTimeout(450);
};
const drawerOpen = (p) => p.locator("#quick-drawer").count();

const session = await browser.newContext({ viewport: { width: 392, height: 852 }, hasTouch: true, serviceWorkers: "block" });
const page = await session.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const cdp = await session.newCDPSession(page);
/** 真触摸滑动：从 (x0,y0) 分 steps 段挪到 (x1,y1)，每段之间等 ms。 */
const swipe = async (x0, y0, x1, y1, steps = 8, ms = 16) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(x0), y: Math.round(y0) }] });
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(x0 + (x1 - x0) * t), y: Math.round(y0 + (y1 - y0) * t) }] });
    await page.waitForTimeout(ms);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600);
};
const panelBox = () => page.locator("#quick-drawer").boundingBox();
const touchAction = () => page.evaluate(() => getComputedStyle(document.querySelector("#quick-drawer")).touchAction);

try {
  // 面板只有打开时才在 DOM 里（非 portal、条件渲染），所以先开再量。
  await openDrawer(page);
  const ta = await touchAction();
  check("W1 面板声明了 touch-action（纵向可滚、横向归手势；空/auto 都会被 WebView 判成滚动）",
    ta === "pan-y" || ta === "manipulation" || ta === "none", `touch-action=${ta}`);
  await closeDrawer(page);

  // ── W2 从面板左半部起滑（旧阈值下数学上不可能关闭的那一处） ──
  await openDrawer(page);
  let box = await panelBox();
  await swipe(box.x + 55, box.y + 300, box.x + 55 - 50, box.y + 300);
  check("W2 靠左起滑（x≈55）往左推 50px 就该退出（旧算法要 173px，永远达不到）", await drawerOpen(page) === 0, `滑后面板数=${await drawerOpen(page)}`);

  // ── W3 从面板右半部起滑：正常长滑必须关闭 ──
  await openDrawer(page);
  box = await panelBox();
  await swipe(box.x + box.width - 30, box.y + 320, box.x + box.width - 30 - 120, box.y + 320, 10, 14);
  check("W3 靠右起滑往左推 120px 退出", await drawerOpen(page) === 0, `滑后面板数=${await drawerOpen(page)}`);

  // ── W4 快速甩动（位移不大）也要关：按下后停顿 400ms 再甩 ──
  await openDrawer(page);
  box = await panelBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(box.x + 200), y: Math.round(box.y + 300) }] });
  await page.waitForTimeout(400); // 旧速度算法把这段停顿算进去 → 稀释成 0
  for (let i = 1; i <= 5; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(box.x + 200 - i * 18), y: Math.round(box.y + 300) }] });
    await page.waitForTimeout(10);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(700);
  check("W4 按下停 0.4 秒再甩 90px 也要退出（旧算法从按下起算速度，被稀释）", await drawerOpen(page) === 0, `滑后面板数=${await drawerOpen(page)}`);

  // ── W5 轻轻一划不许误关 ──
  await openDrawer(page);
  box = await panelBox();
  await swipe(box.x + 200, box.y + 300, box.x + 200 - 20, box.y + 300, 4, 20);
  check("W5 只推 20px 不许误关", await drawerOpen(page) === 1, `面板数=${await drawerOpen(page)}`);

  // ── W6 纵向滑动仍然是滚列表，不是关闭（用矮视口，让面板**真的可滚**，
  //     否则 392×852 下内容放得下、这条断言是空的）──
  await closeDrawer(page);
  const tall = await browser.newContext({ viewport: { width: 392, height: 520 }, hasTouch: true, serviceWorkers: "block" });
  const tallPage = await tall.newPage();
  tallPage.setDefaultTimeout(15_000);
  const tallErrors = [];
  tallPage.on("pageerror", (error) => tallErrors.push(String(error).slice(0, 200)));
  await tallPage.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await tallPage.goto(url, { waitUntil: "domcontentloaded" });
  await tallPage.waitForTimeout(1400);
  await tallPage.locator(".brand-trigger").first().click();
  await tallPage.waitForSelector("#quick-drawer");
  await tallPage.waitForTimeout(600);
  const tallBox = await tallPage.locator("#quick-drawer").boundingBox();
  const scrollable = await tallPage.evaluate(() => {
    const el = document.querySelector("#quick-drawer");
    return { scrollable: el.scrollHeight > el.clientHeight + 20, before: el.scrollTop };
  });
  const tallCdp = await tall.newCDPSession(tallPage);
  await tallCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(tallBox.x + 150), y: Math.round(tallBox.y + 420) }] });
  for (let i = 1; i <= 8; i += 1) {
    await tallCdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(tallBox.x + 150), y: Math.round(tallBox.y + 420 - i * 22) }] });
    await tallPage.waitForTimeout(12);
  }
  await tallCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await tallPage.waitForTimeout(500);
  const afterVertical = await tallPage.evaluate(() => document.querySelector("#quick-drawer").scrollTop);
  check("W6 面板可滚时：纵向滑动只滚列表、不关面板（touch-action:pan-y 的另一半作用）",
    scrollable.scrollable && await tallPage.locator("#quick-drawer").count() === 1 && afterVertical > scrollable.before,
    `可滚=${scrollable.scrollable} scrollTop ${scrollable.before} → ${afterVertical} 面板=${await tallPage.locator("#quick-drawer").count()}`);
  check("W6b 矮视口无页面错误", tallErrors.length === 0, tallErrors.join(" | "));
  await tall.close();

  // ── W7 拖动要跟手：中途采样一次位移 ──
  await closeDrawer(page);
  await openDrawer(page);
  box = await panelBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(box.x + 250), y: Math.round(box.y + 300) }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(box.x + 250 - 46), y: Math.round(box.y + 300) }] });
  await page.waitForTimeout(40);
  const follow = await page.evaluate(() => {
    const el = document.querySelector("#quick-drawer");
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.round(m.m41);
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
  check("W7 拖动跟手：手指走 46px 时面板也≈46px（旧版每帧套 160ms 缓动会明显滞后）",
    follow <= -38 && follow >= -56, `面板 translateX=${follow}px`);

  check("W8 无页面错误", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

if (failed) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log("\n快捷中心左滑退出门禁全部通过");
