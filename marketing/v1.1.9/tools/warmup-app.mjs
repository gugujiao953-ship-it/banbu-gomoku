import { chromium } from "playwright";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const t0 = Date.now();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-onboarding-tour-v1", "seen");
});
const page = await context.newPage();
page.setDefaultTimeout(240_000);
page.setDefaultNavigationTimeout(240_000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
try {
  await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  console.log("domcontentloaded", ((Date.now() - t0) / 1000).toFixed(1) + "s");
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 240_000 });
  console.log("APP READY in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
} catch (error) {
  console.log("WARMUP FAIL", String(error).split("\n")[0]);
}
console.log("errors:", errors.length ? errors.slice(0, 6).join(" || ") : "无");
process.exit(0);
