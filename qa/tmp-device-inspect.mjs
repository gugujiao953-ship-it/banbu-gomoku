import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const contexts = browser.contexts();
const pages = contexts.flatMap((c) => c.pages());
const page = pages.find((p) => p.url().startsWith("https://localhost")) || pages[0];
console.log("页面:", page.url());
const info = await page.evaluate(() => ({
  debugBuild: window.__bbDebugBuild === true,
  hasBridge: typeof window.__bb === "object",
  title: document.title,
  mode: (document.querySelector("[data-mode]") || {}).getAttribute?.("data-mode") || null,
  bodyTop: (document.body.innerText || "").slice(0, 240).replace(/\n+/g, " / "),
  stones: document.querySelectorAll(".stone-piece").length,
  actions: Array.from(document.querySelectorAll(".workspace-action")).map((b) => (b.textContent || "").trim()).slice(0, 16),
}));
console.log(JSON.stringify(info, null, 1));
await browser.close();
