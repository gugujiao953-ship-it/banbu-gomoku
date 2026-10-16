/** 探针：用设置搜索框直达「主题」，看能否列出格子并读出名字 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block",
});
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-onboarding-tour-v1", "seen");
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(200_000);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded" });
await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 200_000 });
await wait(500);
for (let i = 0; i < 3; i += 1) {
  const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
  if (!(await close.count())) break;
  await close.click({ force: true }).catch(() => {});
  await wait(200);
}

await page.getByRole("button", { name: "设置", exact: true }).last().click({ force: true });
await wait(700);
const search = page.getByPlaceholder(/搜索设置/);
await search.fill("主题");
await wait(900);
console.log("搜索后可见文字:", (await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400))));

/* 搜索命中后，把结果里的 button 全列出来（含尺寸与位置，判断哪些是主题格子） */
const btns = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b, i) => {
    const r = b.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return null;
    return { i, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), t: (b.innerText || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 18) };
  }).filter(Boolean).slice(0, 26)
);
console.log("可见按钮:", JSON.stringify(btns));

await page.screenshot({ path: path.join(ROOT, "current-stills", "_probe-theme-search.png") });
console.log("已存 _probe-theme-search.png");
await context.close();
await browser.close();
process.exit(0);
