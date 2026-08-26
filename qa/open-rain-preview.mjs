import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const rainFile = String.raw`D:\五子棋\定式谱\雨.lib`;

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await context.newPage();

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  localStorage.clear();
  if (indexedDB.databases) {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases.map(({ name }) =>
        name
          ? new Promise((resolve) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = request.onerror = request.onblocked = () => resolve();
            })
          : undefined,
      ),
    );
  }
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(rainFile);
await page.waitForFunction(() => !document.querySelector(".import-progress"), null, { timeout: 600000 });
await page.waitForFunction(() => window.__banbuImportDiagnostic?.hasCompact === true, null, { timeout: 600000 });
await page.waitForFunction(
  () => typeof window.__banbuFindBranch === "function" && window.__banbuFindBranch().hasCompact,
  null,
  { timeout: 30000 },
);
await page.evaluate(() => window.__banbuFindBranch?.());
await page.locator(".renlib-variation-label").first().waitFor({ timeout: 30000 });
console.log("Rain preview is open at the first real variation.");
await new Promise(() => {});
