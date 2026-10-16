/** 探外观界面：打开 设置 → 外观，dump 可见按钮/条目（aria-label + 文本 + 位置） */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BASE = process.env.APP_URL || "http://127.0.0.1:5195";

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
page.setDefaultTimeout(240_000);
page.setDefaultNavigationTimeout(240_000);

await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded" });
await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 240_000 });
await page.waitForTimeout(600);
for (let i = 0; i < 3; i += 1) {
  const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
  if (!(await close.count())) break;
  await close.click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
}
console.log("READY");

/* 进设置 */
await page.getByRole("button", { name: "设置", exact: true }).last().click({ force: true });
await page.waitForTimeout(700);

/* 打开「外观与音效」折叠块 */
const box = page.locator("details.settings-collapsible").filter({ hasText: "外观" }).first();
await box.waitFor({ timeout: 20_000 });
if ((await box.getAttribute("open")) === null) await box.locator(":scope > summary").click({ force: true });
await page.waitForTimeout(700);

/* dump 这个折叠块里的可见按钮与条目 */
const dump = await page.evaluate(() => {
  const out = [];
  const scopes = [...document.querySelectorAll("details.settings-collapsible")].filter((d) => /外观/.test(d.textContent || ""));
  for (const scope of scopes) {
    for (const el of scope.querySelectorAll("button, [role='button'], [role='option'], li, label")) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30),
        cls: (el.className || "").toString().slice(0, 46),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      });
    }
  }
  return out;
});
console.log("外观块内条目数:", dump.length);
for (const d of dump.slice(0, 60)) console.log(`${d.tag} | ${d.label} | ${d.cls} | (${d.x},${d.y})`);

/* 也 dump 所有 details 的标题，便于定位主题/棋盘/棋子子块 */
const subs = await page.evaluate(() =>
  [...document.querySelectorAll("details > summary")].map((s) => (s.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24))
);
console.log("各折叠块:", subs.join(" / "));

await page.screenshot({ path: path.join(ROOT, "marketing", "v1.1.9", "current-stills", "_appearance-explore.png"), fullPage: false });
console.log("已存 _appearance-explore.png");
await context.close();
await browser.close();
process.exit(0);
