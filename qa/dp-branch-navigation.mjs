import { chromium } from "playwright";

const sample = process.argv[2] || "D:/五子棋/其他/九天指南v4-2.db";
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5182/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.stack || String(error)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const depth = async () => Number((await page.locator(".workspace-current small").innerText()).match(/第 ([0-9]+) 手/)?.[1] || -1);
const coordinateFromLabel = (label) => label.match(/([A-Z]+[0-9]+)$/)?.[1] || "";

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(sample);
  await page.waitForFunction(() => document.querySelector(".workspace-current b")?.textContent?.includes("九天指南v4-2"));
  await page.waitForTimeout(400);

  const next = page.getByRole("button", { name: "下一手" });
  await next.click();
  await page.waitForTimeout(300);
  assert(await depth() === 1, "DP 首条分支没有进入第 1 手");

  const firstBranchLabels = await page.locator(".renlib-variation").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") || ""));
  assert(firstBranchLabels.length >= 2, "测试局面没有可供切换的兄弟分支");
  const sibling = coordinateFromLabel(firstBranchLabels[1]);
  assert(sibling, "没有读取到兄弟分支坐标");
  await page.getByRole("gridcell", { name: new RegExp(sibling) }).click();
  await page.waitForTimeout(450);
  assert(await depth() === 2, "点击 DP 兄弟分支后没有进入下一手");
  assert(await next.isEnabled(), "进入 DP 兄弟分支后“下一手”被错误禁用");

  await next.click();
  await page.waitForTimeout(450);
  assert(await depth() === 3, "DP 兄弟分支进入后无法继续下一手");

  const previous = page.getByRole("button", { name: "上一手" });
  await previous.click();
  await page.waitForTimeout(350);
  assert(await depth() === 2, "DP 分支返回上一手失败");
  const secondBranchLabels = await page.locator(".renlib-variation").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") || ""));
  const secondSibling = coordinateFromLabel(secondBranchLabels.find((label) => coordinateFromLabel(label) !== sibling) || "");
  assert(secondSibling, "返回分支点后没有可切换的其他分支");
  await page.getByRole("gridcell", { name: new RegExp(secondSibling) }).click();
  await page.waitForTimeout(450);
  assert(await depth() === 3, "再次切换 DP 兄弟分支后没有形成下一手");
  assert(errors.length === 0, "浏览器出现错误：" + errors.join("\n"));
  console.log(JSON.stringify({ pass: true, file: sample, branchA: sibling, branchB: secondSibling, finalDepth: await depth() }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
