import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const remoteRapfiRequests = [];
const pageErrors = [];
page.on("request", (request) => { if (request.url().includes("gomocalc.com")) remoteRapfiRequests.push(request.url()); });
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: /导出棋谱/ }).click();
  await page.getByText("没有原始文件格式").waitFor();
  const choose = page.getByRole("button", { name: /选择格式导出/ });
  const direct = page.getByRole("button", { name: /^直接导出 / });
  assert.equal(await choose.isEnabled(), true, "新棋谱应允许选择导出格式");
  assert.equal(await direct.isEnabled(), true, "新棋谱应允许按默认 SGF 直接导出");
  await choose.click();
  await page.getByRole("button", { name: /SGF 标准棋谱/ }).waitFor();
  await page.getByRole("button", { name: /JSON（半步完整棋谱）/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /RenLib LIB/ }).isDisabled(), true, "LIB 转换器未实现时必须明确禁用");
  assert.equal(await page.getByRole("button", { name: /DP \/ DB 局面数据库/ }).isDisabled(), true, "DP/DB 转换器未实现时必须明确禁用");
  await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-export-hub.png", fullPage: true });

  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "打谱" }).click();
  await page.getByRole("button", { name: "标注", exact: true }).click();
  await page.getByText(/长按，依次切换圆圈、三角、叉号和清除/).waitFor();
  const deleteMarks = page.getByRole("button", { name: /删除现有标注/ });
  assert.equal(await deleteMarks.isDisabled(), true, "没有标注时删除按钮应保留但禁用");
  await page.waitForTimeout(350);
  await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-annotation-delete.png", fullPage: true });
  await page.locator(".mark-preset-grid.letters button").filter({ hasText: /^A$/ }).click();
  await page.getByRole("gridcell", { name: /^H8空位/ }).click();
  await page.getByRole("button", { name: "标注", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /删除现有标注（1）/ }).isEnabled(), true, "已有标注时删除按钮应可用");
  await page.getByRole("button", { name: /删除现有标注（1）/ }).click();
  assert.equal(await page.locator(".board-label-text").count(), 0, "删除按钮应清空当前局面标注");

  await page.getByRole("button", { name: "思考当前局面的下一步" }).click();
  await page.locator(".think-result").waitFor({ timeout: 25000 });
  assert.deepEqual(remoteRapfiRequests, [], "本地 AI 不应访问 gomocalc.com");
  assert.equal(pageErrors.some((message) => message.includes("gomocalc.com")), false, "页面不应再出现远程 Rapfi 网络错误");

  const sourcePage = await context.newPage();
  await sourcePage.goto(baseURL);
  await sourcePage.evaluate(() => localStorage.clear());
  await sourcePage.reload();
  await sourcePage.locator('input[type="file"]').first().setInputFiles({
    name: "来源棋谱.sgf",
    mimeType: "application/x-go-sgf",
    buffer: Buffer.from("(;GM[4]FF[4]SZ[15]GN[来源识别];B[hh];W[ii])"),
  });
  await sourcePage.getByText(/已导入 SGF/).waitFor();
  await sourcePage.getByRole("button", { name: "设置" }).click();
  await sourcePage.getByRole("button", { name: /导出棋谱/ }).click();
  await sourcePage.getByText("识别为 SGF").waitFor();
  assert.equal(await sourcePage.getByRole("button", { name: /选择格式导出/ }).isDisabled(), true, "已有原始格式时格式转换入口应变灰");
  assert.equal(await sourcePage.getByRole("button", { name: /^直接导出 / }).isEnabled(), true, "已有 SGF 时直接导出应可用");
  await sourcePage.close();

  const copyPage = await context.newPage();
  await copyPage.goto(baseURL);
  await copyPage.getByRole("button", { name: "棋谱库" }).click();
  await copyPage.getByRole("tab", { name: /题库/ }).click();
  await copyPage.getByText("支持二维题目数组：坐标,颜色编号").waitFor();
  assert.equal(await copyPage.getByText(/支持开宝题集数组格式/).count(), 0, "题库导入说明不应再只写某个软件名称");
  await copyPage.getByRole("button", { name: "设置" }).click();
  await copyPage.getByRole("button", { name: /关于半步五子棋/ }).click();
  await copyPage.getByText("个人项目说明", { exact: true }).waitFor();
  await copyPage.getByText(/后续有时间会继续更新功能、改善使用体验并修复发现的 Bug/).waitFor();
  const projectLink = copyPage.getByRole("link", { name: /GitHub 项目主页与下载/ });
  assert.equal(await projectLink.getAttribute("href"), "https://github.com/gugujiao953-ship-it/banbu-gomoku");
  await copyPage.close();
  console.log("Export/annotation/offline AI browser verification passed.");
} finally {
  await context.close();
  await browser.close();
}
