import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
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
  await page.getByLabel("最近导入列表").check();
  await page.getByRole("button", { name: "打谱" }).click();

  const input = page.locator('input[accept="*/*"]');
  await input.setInputFiles({
    name: "最近导入测试.sgf",
    mimeType: "application/x-go-sgf",
    buffer: Buffer.from("(;GM[1]FF[4]SZ[15]GN[最近导入测试];B[hh];W[ii])"),
  });
  await page.getByText(/已导入 SGF/).waitFor({ timeout: 10000 });

  await page.getByRole("button", { name: "打开导入方式" }).click();
  const recent = page.locator(".recent-imports");
  await recent.waitFor();
  assert.equal(await recent.locator(".recent-import-item").count(), 1, "成功导入后应出现最近导入记录");
  assert.match(await recent.innerText(), /最近导入测试\.sgf/);
  assert.match(await recent.innerText(), /可一键重开/);
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  const reopenedPage = await context.newPage();
  await reopenedPage.goto(baseURL);
  await reopenedPage.getByRole("button", { name: "打开导入方式" }).click();
  const reopenedRecent = reopenedPage.locator(".recent-imports");
  await reopenedRecent.waitFor();
  await reopenedRecent.getByRole("button", { name: "重新打开 最近导入测试.sgf" }).click();
  await reopenedPage.waitForTimeout(1500);
  const reopenedText = await reopenedPage.locator("body").innerText();
  assert.match(reopenedText, /最近导入测试/, `最近导入重开后页面未恢复棋谱：${reopenedText.slice(-800)}`);
  assert.equal(await reopenedPage.locator(".import-options").count(), 0, "一键重开后导入面板应关闭");
  assert.match(reopenedText, /最近导入测试/);
  assert.match(reopenedText, /0 \/ 2 手/, "最近导入重开后应恢复完整主线长度");
  await reopenedPage.getByRole("button", { name: "到最后一手", exact: true }).click();
  const reopenedStones = await reopenedPage.locator(".stone").count();
  assert.equal(reopenedStones, 2, `跳到终点后应恢复棋谱内容，当前棋子数=${reopenedStones}；页面状态：${(await reopenedPage.locator("body").innerText()).slice(-1000)}`);

  await context.close();
  console.log("Recent imports browser verification passed: persistence, one-click reopen, and record content restore.");
} finally {
  await browser.close();
}
