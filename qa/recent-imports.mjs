import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * ⚠ baseURL 一定要带 `?qa=1`：本脚本在页内 `localStorage.clear()`（为了造干净起点）把
 * 「首次欢迎已读」标记一起清掉了，`page.reload()` 之后首运行欢迎遮罩会重新盖住界面，
 * 后续所有点击都被它拦下（实测报 `<div class="first-run-backdrop"> intercepts pointer events`）。
 * `?qa=1` 是应用自带的抑制开关，比再写一次 localStorage 更稳。
 */
const baseURL = (() => {
  const url = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:5173/");
  if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
  return url.toString();
})();
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(baseURL);
  await page.evaluate(() => {
    localStorage.clear();
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("banbu-gomoku-recent-imports");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  await page.reload();

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByText("可选增强功能", { exact: true }).click();
  /**
   * 「最近导入」这一行 2026-10-04 改过名（原「最近导入列表」）并**改成默认开启**
   * （字段 recentImports → importShelf）——本条门禁当时没跟着改，于是长期假红。
   * 现在按真实标题找到那枚芯片，并且**只在关着的时候才点开**：
   * 无脑 click 会把默认已开的那一项关掉，反而毁掉前置条件。
   */
  const shelfToggle = page.locator('.setting-chip:has-text("最近导入") input[type="checkbox"]').first();
  await shelfToggle.waitFor({ state: "attached", timeout: 10_000 });
  if (!(await shelfToggle.isChecked())) await shelfToggle.check();
  await page.getByRole("button", { name: "打谱" }).click();

  const input = page.locator('input[type="file"][accept*=".sgf"]');
  await input.setInputFiles({
    name: "最近导入测试.sgf",
    mimeType: "application/x-go-sgf",
    buffer: Buffer.from("(;GM[1]FF[4]SZ[15]GN[最近导入测试];B[hh];W[ii])"),
  });
  await page.getByText(/已导入 SGF/).waitFor({ timeout: 10000 });

  // T40 后顶栏导入按钮移除（底部导航有导入入口）
  await page.getByRole("button", { name: "导入", exact: false }).last().click();
  const recent = page.locator(".recent-imports");
  await recent.waitFor();
  assert.equal(await recent.locator(".recent-import-item").count(), 1, "成功导入后应出现最近导入记录");
  assert.match(await recent.innerText(), /最近导入测试\.sgf/);
  assert.match(await recent.innerText(), /可一键重开/);
  await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "关闭", exact: true }).click();

  const reopenedPage = await context.newPage();
  await reopenedPage.goto(baseURL);
  await reopenedPage.getByRole("button", { name: "导入", exact: false }).last().click();
  const reopenedRecent = reopenedPage.locator(".recent-imports");
  await reopenedRecent.waitFor();
  await reopenedRecent.getByRole("button", { name: "重新打开 最近导入测试.sgf" }).click();
  await reopenedPage.waitForTimeout(1500);
  const reopenedText = await reopenedPage.locator("body").innerText();
  assert.match(reopenedText, /最近导入测试/, `最近导入重开后页面未恢复棋谱：${reopenedText.slice(-800)}`);
  assert.equal(await reopenedPage.locator(".import-options").count(), 0, "一键重开后导入面板应关闭");
  assert.match(reopenedText, /最近导入测试/);
  // 手机视口下 .unified-status-facts 被 CSS 隐藏（≤699px absolute clip），
  // getByText 命中不到——改读状态栏全文（compat 文本含 stepLabel）。
  assert.match(await reopenedPage.locator(".unified-status").innerText(), /第 0 手 \/ 2/, "最近导入重开后应恢复完整主线长度");
  await reopenedPage.getByRole("button", { name: "到最后一手", exact: true }).click();
  const reopenedStones = await reopenedPage.locator(".stone").count();
  assert.equal(reopenedStones, 2, `跳到终点后应恢复棋谱内容，当前棋子数=${reopenedStones}；页面状态：${(await reopenedPage.locator("body").innerText()).slice(-1000)}`);

  await context.close();
  console.log("Recent imports browser verification passed: persistence, one-click reopen, and record content restore.");
} finally {
  await browser.close();
}
