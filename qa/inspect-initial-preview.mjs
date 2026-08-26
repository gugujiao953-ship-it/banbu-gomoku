import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto(process.env.QA_BASE_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.getByText("瑞星定式研究", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/initial-app-412x915.png", fullPage: false });
  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    visibleButtons: await page.getByRole("button").allTextContents(),
  }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
