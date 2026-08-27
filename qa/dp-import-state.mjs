import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5175/";
const file = process.argv[2] || String.raw`D:\五子棋\定式谱\九天指南v5-1.db`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(file);
const samples = [];
for (const delay of [5000, 5000, 10000, 10000]) {
  await page.waitForTimeout(delay);
  samples.push(await page.evaluate(() => ({
    importState: window.__banbuImportState || null,
    worker: window.__banbuWorkerMessage || null,
    diagnostic: window.__banbuImportDiagnostic || null,
    storage: window.__banbuStorageDiagnostic || null,
    title: document.querySelector(".workspace-current b")?.textContent || "",
    stones: document.querySelectorAll(".stone").length,
    labels: document.querySelectorAll(".board-label-text").length,
    toast: document.querySelector(".toast")?.textContent || "",
  })));
}
console.log(JSON.stringify({ samples, errors }, null, 2));
await browser.close();
