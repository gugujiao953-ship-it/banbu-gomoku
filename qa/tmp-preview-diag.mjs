import { chromium } from "playwright";
import { resolve } from "node:path";
const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const url = new URL(base); url.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await context.newPage();
page.on("console", (m) => console.log(`[console:${m.type()}]`, m.text().slice(0, 200)));
page.on("worker", (w) => {
  console.log("[worker-created]", w.url().split("/").slice(-1)[0]);
  w.on("console", (m) => console.log(`[wconsole:${m.type()}]`, m.text().slice(0, 200)));
});
page.on("pageerror", (e) => console.log("[pageerror]", e?.name, e?.message, String(e?.stack || "").slice(0, 300)));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(0, 120), r.failure()?.errorText));
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
await page.locator("nav.bottom-nav button").filter({ hasText: "打谱" }).first().click();
await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(resolve("qa/fixtures/materials/remote-image2.png"));
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
console.log("=== 点本地复原 ===");
await page.locator("[data-local-restore]").click();
await page.waitForTimeout(30000);
const state = await page.evaluate(() => ({
    hint: document.querySelector(".image-verify-hint")?.textContent?.trim() || "",
    toast: document.querySelector(".toast")?.textContent?.trim() || "",
    coi: globalThis.crossOriginIsolated === true,
    sab: typeof SharedArrayBuffer !== "undefined",
  }));
  console.log("state:", JSON.stringify(state));

await browser.close();
