/** tmp recon: enter VCF, dump probes */
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
console.log("title:", await page.title());
console.log("has first-run:", await page.locator(".first-run-backdrop").count());
console.log("nav labels:", await page.evaluate(() => Array.from(document.querySelectorAll('nav[aria-label="主导航"] button')).map(b => (b.textContent||"").trim())));
// go duel
await page.evaluate(() => { const n=document.querySelector('nav[aria-label="主导航"]'); const b=Array.from(n.querySelectorAll("button")).find(x=>(x.textContent||"").trim()==="对弈"); b?.click(); });
await page.waitForTimeout(800);
console.log("duel entries:", await page.evaluate(() => Array.from(document.querySelectorAll("[data-duel-entry]")).map(e => e.getAttribute("data-duel-entry"))));
console.log("vcf start btn:", await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').count());
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 25000 });
await page.waitForTimeout(2500);
console.log("=== vcf top-info:", await page.locator(".vcfch-top-info").textContent());
console.log("rating:", await page.evaluate(() => document.querySelector(".vcfch-rating-inline b")?.textContent));
console.log("message:", await page.locator(".vcfch-message").textContent());
console.log("primary:", await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim()));
console.log("sheet btn count:", await page.locator(".vcfch-top-actions button").count());
console.log("pool live:", await page.evaluate(() => document.querySelector("[data-vcf-pool-live]")?.textContent?.replace(/\s+/g," ").trim()));
// localStorage state
console.log("ls state:", await page.evaluate(() => localStorage.getItem("vcfch-state-v1")));
// dump sheet rows
await page.locator(".vcfch-top-actions button").first().click();
await page.waitForTimeout(600);
console.log("sheet header:", await page.locator(".vcfch-sheet > header b").textContent());
console.log("rows:", await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-sheet-row")).map(r => ({ label: r.querySelector("span")?.textContent, chips: Array.from(r.querySelectorAll("button")).map(b=>b.textContent.trim()) }))));
console.log("checks:", await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-sheet-check")).map(c => ({ text: c.textContent.replace(/\s+/g," ").trim(), checked: c.querySelector("input")?.checked }))));
console.log("notes:", await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-sheet-note")).map(n=>n.textContent.replace(/\s+/g," ").trim())));
console.log("actions:", await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-sheet-actions button")).map(b=>b.textContent.trim())));
console.log("--- errors:", errs.slice(0,10));
await b.close();
