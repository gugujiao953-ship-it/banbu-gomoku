import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => { localStorage.clear(); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await page.locator('.dock-tabs button', { hasText: '编辑' }).click();
await page.waitForTimeout(300);
const panel = await page.locator('.dock-panel button').allTextContents().catch(() => []);
console.log('edit panel:', JSON.stringify(panel));
// 落两手后再看一次
await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
await page.waitForTimeout(200);
await browser.close();
