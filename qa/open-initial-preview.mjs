import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
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
await page.reload({ waitUntil: "networkidle" });
await page.getByText("瑞星定式研究", { exact: true }).waitFor();
await page.bringToFront();
console.log("Initial app preview is open with a clean local state.");
await new Promise(() => {});
