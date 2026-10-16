import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const url = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:5173/");
url.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
try {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ coachMarks: false }));
  });
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.locator('input[type="file"][accept*=".sgf"]').first().setInputFiles(fileURLToPath(new URL("../public/records/九天指南v5-1.db", import.meta.url)));
  await page.getByRole("dialog", { name: "选择导入方式" }).waitFor({ state: "hidden", timeout: 60000 });
  await page.getByRole("button", { name: "打开分支树" }).click();
  const dialog = page.getByRole("dialog", { name: "分支树" });
  await dialog.getByRole("tab", { name: "导航", exact: true }).click();
  console.log("根层", await dialog.locator(".tree-navigator-heading").innerText());
  await dialog.locator(".tree-navigator-row").first().click();
  console.log("第一手", await dialog.locator(".tree-navigator-heading").innerText());
  await dialog.locator(".tree-navigator-row").first().click();
  console.log("第二手", await dialog.locator(".tree-navigator-heading").innerText());
  assert((await dialog.locator(".tree-navigator-heading").innerText()).includes("23 个后续"), "真实数据库第二手的23支不完整");
  await dialog.getByRole("button", { name: "下一页", exact: true }).click();
  assert(await dialog.locator(".tree-navigator-paging [role=status]").innerText() === "17–23 / 23 支", "真实数据库最后一页不准确");
  await dialog.locator(".tree-navigator-row").last().click();
  console.log("末页走法", await dialog.locator(".tree-navigator-heading").innerText());
  assert(await dialog.locator(".tree-preview-board .stone").count() === 3, "数据库末页走法预览不符");
  const load = dialog.getByRole("button", { name: "读取后续分支", exact: true });
  if (await load.count()) {
    await load.click();
    await load.waitFor({ state: "hidden", timeout: 30000 });
  }
  await dialog.getByRole("button", { name: "在图谱查看", exact: true }).click();
  assert(await dialog.locator(".tree-node.selected").count() === 1, "真实库末页走法未带回图谱");
  await dialog.getByRole("tab", { name: "导航", exact: true }).click();
  await dialog.getByRole("button", { name: "定位到主棋盘", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert((await page.getByLabel("当前工作状态").first().innerText()).includes("第 3 手"), "真实库分支定位失败");
  assert(!errors.length, errors.join("; "));
  console.log(JSON.stringify({ pass: true, fixture: "九天指南v5-1.db", lastPage: "17–23 / 23 支", previewStones: 3, locatedTurn: 3 }));
} catch (error) {
  console.error("页面快照", (await page.locator("body").innerText()).slice(-5500));
  console.error("运行错误", errors);
  throw error;
} finally {
  await context.close();
  await browser.close();
}
