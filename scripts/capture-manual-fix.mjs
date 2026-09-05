import { chromium } from "playwright";
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:5175/";
const OUT = "public/manual";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark", serviceWorkers: "block", isMobile: true, hasTouch: true });
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-motion-enabled-v2", "false"); });
const page = await context.newPage();
const log = (...a) => console.log(...a);
const clip = async (id, sel, pad = 8) => { try { const el = page.locator(sel).first(); await el.waitFor({ timeout: 6000 }); await el.scrollIntoViewIfNeeded().catch(()=>{}); const b = await el.boundingBox(); const x=Math.max(0,b.x-pad), y=Math.max(0,b.y-pad); await page.screenshot({ path: `${OUT}/${id}.jpg`, clip: { x, y, width: Math.min(390-x, b.width+pad*2), height: Math.min(844-y, b.height+pad*2) }, type: "jpeg", quality: 82 }); log("ok", id); } catch(e){ log("MISS", id, e.message.split("\n")[0]); } };
const reset = async () => { await page.goto(BASE, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".renju-board"); await page.waitForTimeout(650); await page.keyboard.press("Escape").catch(()=>{}); };
const openAnnoTab = async () => { await page.locator('.dock-tabs button[aria-label="标注"]').first().click({ timeout: 3000 }); await page.waitForTimeout(600); };

// s4f3 读谱本机标注 — studio panel in 读谱 mode
await reset();
await page.locator('.dock-tabs button[aria-label="读谱"]').first().click().catch(()=>{}); await page.waitForTimeout(500);
// 读谱 mode tabs differ; ensure annotation studio available (读谱 has 标注 too per 092)
await openAnnoTab().catch(()=>{});
await clip("s4f3", ".mark-studio-grid, .mark-studio");

// s7f3 棋盘标注 — 打谱 mode, apply marks on board, clip the BOARD
await reset();
await page.locator('.dock-tabs button[aria-label="打谱"]').first().click().catch(()=>{}); await page.waitForTimeout(500);
// place a couple stones first so board has content
const cell = () => page.locator('[role="gridcell"][aria-label$="空位"]').first();
await cell().click().catch(()=>{}); await page.waitForTimeout(200);
await cell().click().catch(()=>{}); await page.waitForTimeout(200);
await openAnnoTab();
await page.waitForTimeout(400);
// tap a few intersections to apply the current annotation glyph
const spots = page.locator('[role="gridcell"]');
const n = await spots.count();
for (const idx of [Math.floor(n/2), Math.floor(n/2)+16, Math.floor(n/2)-15, Math.floor(n/2)+1, Math.floor(n/2)+31]) {
  if (idx>=0 && idx<n) { await spots.nth(idx).click({ timeout: 1500 }).catch(()=>{}); await page.waitForTimeout(150); }
}
await clip("s7f3", ".renju-board");
await browser.close(); log("done");
