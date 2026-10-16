/** 探测新版分析面板的控件结构与文案 */
import { launch, boot, settle, safeClick, waitAnimations, clickPoint } from "./lib.mjs";

const { browser, context, page } = await launch();
const MOVES = ["H8","I8","H9","I9","G8","J8","G9","J9","F8","K8","F9","E9"];

try {
  await boot(page);
  await safeClick(page.locator(".record-command-bar").getByRole("button", { name: "无禁" }));
  await settle(page, 400);
  for (const m of MOVES) { await clickPoint(page, m); await settle(page, 100); }
  await settle(page, 500);

  // 分析按钮所在行有没有开关
  console.log("ACTION ROW =", JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll(".action-bottom-row > *")].map(e => ({
      tag: e.tagName, cls: (e.className || "").toString().slice(0, 40),
      aria: e.getAttribute("aria-label"), txt: (e.innerText || "").trim().slice(0, 14),
      role: e.getAttribute("role"),
    })))));

  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
  await waitAnimations(page, ".ai-analysis-panel");
  await settle(page, 1200);

  console.log("PANEL CONTROLS =", JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll(".ai-analysis-panel *")].filter(e =>
      e.children.length === 0 && (e.tagName === "BUTTON" || e.tagName === "INPUT" || e.tagName === "LABEL" || e.tagName === "SPAN")
    ).map(e => ({
      tag: e.tagName, cls: (e.className || "").toString().slice(0, 34),
      aria: e.getAttribute("aria-label"), role: e.getAttribute("role"),
      txt: (e.innerText || "").trim().slice(0, 12),
      checked: e.checked, pressed: e.getAttribute("aria-pressed"),
    })).slice(0, 30)), null, 1));

  // 点「1 选」打开下拉，看选项文案
  const trigger = page.locator('.ai-analysis-panel [aria-label*="选"]').first();
  console.log("trigger aria =", await trigger.getAttribute("aria-label").catch(() => null));
  await safeClick(trigger);
  await settle(page, 700);
  console.log("OPTIONS =", JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('.panel-select-menu [role="option"]')].map(o => o.innerText.trim()))));
} catch (e) { console.log("ERR", e.message.split("\n")[0]); }
await context.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
