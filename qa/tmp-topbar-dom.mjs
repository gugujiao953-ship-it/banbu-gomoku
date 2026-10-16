import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-font-scale-v1", "xlarge"); });
const page = await context.newPage();
const url = new URL(base); url.searchParams.set("qa", "1");
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
await page.locator("nav.bottom-nav button").filter({ hasText: "设置" }).first().click();
await page.waitForTimeout(700);
const info = await page.evaluate(() => {
  const b = [...document.querySelectorAll("b")].find((el) => el.textContent?.includes("半步五子棋打谱"));
  if (!b) return { found: false };
  const chain = [];
  let el = b;
  while (el && el !== document.body) { chain.push(`${el.tagName.toLowerCase()}.${el.className || "-"}`); el = el.parentElement; }
  const cs = getComputedStyle(b);
  return { found: true, chain: chain.slice(0, 5), font: cs.fontSize, family: cs.fontFamily.slice(0, 30), white: cs.whiteSpace, overflow: cs.overflow, width: b.getBoundingClientRect().width, parentWidth: b.parentElement?.getBoundingClientRect().width, shellClass: document.querySelector(".app-shell")?.className };
});
console.log(JSON.stringify(info));
await browser.close();
