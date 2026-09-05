import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(10_000);
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const stateOf = () => page.evaluate(() => ({ ...(window.history.state || {}) }));
const overlayToken = (state) => typeof state.__banbuOverlayToken === "string";
const sentinel = (state) => state.__banbuRootSentinel === 1;
const onHome = async () => page.getByText("新建棋谱", { exact: true }).isVisible();

// After a back press consumes the root sentinel, the app re-arms it after the
// exit window. Wait past that window so the next back press has an entry to
// consume instead of navigating away from the page.
const waitReArm = () => page.waitForTimeout(2_400);

const results = {};
try {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 20_000 });
  await page.locator(".renju-board").waitFor();
  await page.waitForTimeout(300);

  // 1. The root back-exit sentinel is armed on mount.
  const rootState = await stateOf();
  results.rootState = rootState;
  assert(sentinel(rootState), "挂载后根哨兵未建立（history.state 缺少 __banbuRootSentinel）");

  // 2. Opening an overlay claims its own history entry on top.
  await page.getByRole("button", { name: "打开快捷中心" }).click();
  await page.getByRole("dialog", { name: "快捷中心" }).waitFor();
  const drawerState = await stateOf();
  results.drawerState = drawerState;
  assert(overlayToken(drawerState), "打开快捷中心后未推入弹层 History 条目");

  // 3. A back press closes the overlay and lands on the sentinel, not exit.
  await page.goBack();
  await page.getByRole("dialog", { name: "快捷中心" }).waitFor({ state: "detached" });
  const afterDrawerBack = await stateOf();
  results.afterDrawerBack = afterDrawerBack;
  assert(sentinel(afterDrawerBack) && !overlayToken(afterDrawerBack), "返回键关闭快捷中心后未落回根哨兵");
  assert(await onHome(), "返回键关闭弹层时页面被卸载");

  // 4. The sheet family shares the same history contract.
  await page.locator("nav.bottom-nav .nav-center").click();
  await page.getByText("导入棋谱文件").waitFor();
  const sheetState = await stateOf();
  assert(overlayToken(sheetState), "打开导入方式未推入弹层 History 条目");
  await page.goBack();
  await page.getByText("导入棋谱文件").waitFor({ state: "detached" });
  assert(sentinel(await stateOf()), "返回键关闭导入弹层后未落回根哨兵");

  // 5. Closing an overlay with its own close button releases its entry.
  await page.getByRole("button", { name: "打开快捷中心" }).click();
  await page.getByRole("dialog", { name: "快捷中心" }).waitFor();
  await page.getByRole("dialog", { name: "快捷中心" }).getByLabel("关闭快捷中心").click();
  await page.getByRole("dialog", { name: "快捷中心" }).waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const afterCloseButton = await stateOf();
  results.afterCloseButton = afterCloseButton;
  assert(sentinel(afterCloseButton), "点击关闭按钮后未释放弹层 History 条目（应落回根哨兵）");

  // 6. A root back press shows the double-press hint instead of leaving.
  await page.goBack();
  const toast = await page.getByText("再按一次返回键退出应用").waitFor({ timeout: 3_000 }).then(() => true).catch(() => false);
  results.rootBackShowsToast = toast;
  assert(toast, "根页返回键未显示『再按一次退出』提示");
  assert(page.url().startsWith(baseURL.replace(/\/$/, "")), "根页单次返回键离开了应用页面");
  const afterRootBack = await stateOf();
  results.afterRootBack = afterRootBack;
  assert(!overlayToken(afterRootBack), "根页返回后意外落入弹层条目");
  await waitReArm();

  // 7. Non-home tabs are left before the home tab exits the app.
  await page.locator("nav.bottom-nav button:has-text('设置')").click();
  await page.getByText("偏好中心").waitFor();
  await page.goBack();
  await page.waitForTimeout(300);
  results.backFromSettings = {
    state: await stateOf(),
    settingsVisible: await page.getByText("偏好中心").isVisible().catch(() => false),
    boardVisible: await page.locator(".renju-board").isVisible(),
  };
  assert(!results.backFromSettings.settingsVisible, "返回键未先离开设置页");
  assert(results.backFromSettings.boardVisible, "从设置页返回后主界面棋盘丢失");
  await waitReArm();

  // 8. The exit window re-arms the sentinel, so a later back press warns
  // again rather than quitting immediately.
  results.reArmed = await stateOf();
  await page.goBack();
  const toastAgain = await page.getByText("再按一次返回键退出应用").waitFor({ timeout: 3_000 }).then(() => true).catch(() => false);
  results.reArmedToast = toastAgain;
  assert(toastAgain, "退出窗口结束后返回键未重新提示（哨兵未重新武装）");

  if (errors.length) throw new Error(`页面错误：\n${errors.join("\n")}`);
  console.log(JSON.stringify({ pass: true, results }, null, 2));
} finally {
  await browser.close();
}
