import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:4367/");
base.searchParams.set("qa", "1");
const browser = await chromium.launch();
const results = [];
const check = (name, ok) => { assert.ok(ok, name); results.push(name); console.log(`PASS ${name}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    if (sessionStorage.getItem("workspace-audit-seeded")) return;
    sessionStorage.setItem("workspace-audit-seeded", "1");
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ keyboardShortcuts: false, analysisQuickToggle: true }));
    localStorage.setItem("banbu-action-layout-v1", JSON.stringify({ version: 3, modes: { record: { top: ["analysisToggle"] } } }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.locator(".board-hit").first().waitFor({ state: "visible", timeout: 30000 });
  const countStones = () => page.locator(".stone-piece").count();
  const pressArrow = async (key) => {
    // Dispatch at body without browser focus being left on the checkbox/card.
    await page.locator("body").press(key);
  };
  await page.goto(base.href, { waitUntil: "domcontentloaded" });
  await ready();
  await page.locator('.board-hit[aria-label="H8空位"]').click();
  await page.locator('.board-hit[aria-label="I8空位"]').click();
  check("两次真实落子生效", await countStones() === 2);
  await pressArrow("ArrowLeft");
  check("关闭总开关时方向键不回退", await countStones() === 2);
  check("分析快捷按钮保留在自定义常驻区", await page.locator(".action-top-row .analysis-toggle").count() === 1);
  check("快捷按钮没有在首行重复出现", await page.locator(".action-bottom-row .analysis-toggle").count() === 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-action-layout-v1")));
  check("快捷按钮自定义位置确实落盘", saved.modes.record.top.includes("analysisToggle"));
  await page.evaluate(() => {
    const key = "banbu-enhancement-settings-v1";
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), keyboardShortcuts: true }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready();
  check("刷新保留盘面", await countStones() === 2);
  check("刷新保留快捷按钮位置", await page.locator(".action-top-row .analysis-toggle").count() === 1);
  await pressArrow("ArrowLeft");
  await page.waitForFunction(() => document.querySelectorAll(".stone-piece").length === 1);
  check("开启总开关后方向键回退一手", await countStones() === 1);
  await pressArrow("ArrowRight");
  await page.waitForFunction(() => document.querySelectorAll(".stone-piece").length === 2);
  check("方向键前进恢复下一手", await countStones() === 2);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "audit-text-input"; document.body.append(input); input.focus();
  });
  await page.locator("#audit-text-input").press("ArrowLeft");
  check("输入框里的方向键不动棋谱", await countStones() === 2);
  await page.evaluate(() => document.getElementById("audit-text-input").remove());
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".board-shift-button").click();
  await page.locator(".board-shift-pad").waitFor();
  await pressArrow("ArrowLeft");
  check("位移弹层里的方向键不改后台盘面", await countStones() === 2);
  await page.keyboard.press("Escape");
  await page.locator(".board-shift-pad").waitFor({ state: "detached" });
  check("Esc 关闭位移弹层后保留编辑面板", await page.locator(".board-shift-button").count() === 1);
  await page.locator('.bottom-nav button', { hasText: "设置" }).click();
  await pressArrow("ArrowLeft");
  await page.locator('.bottom-nav button', { hasText: "打谱" }).click();
  check("设置页里的方向键不改后台盘面", await countStones() === 2);
  check("无未捕获页面异常", errors.length === 0);
  console.log(`${results.length}/${results.length} checks passed`);
} finally {
  await browser.close();
}
