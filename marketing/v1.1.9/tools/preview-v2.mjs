import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo-v2.html");
const OUT = path.join(ROOT, "video", "_preview-v2");
await mkdir(OUT, { recursive: true });
const times = process.argv.slice(2).filter(x => !x.startsWith("--")).map(Number);
const list = times.length ? times : [2, 8, 14, 20, 27, 36, 46, 54, 62, 69, 76];
const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light", locale: "zh-CN" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 60_000 });
await page.waitForFunction(() => window.__promo && [...document.images].every(i => i.complete), null, { timeout: 60_000 });
console.log("meta", await page.evaluate(() => ({ duration: window.__promo.DURATION, fps: window.__promo.FPS })));
for (const t of list) { await page.evaluate(tt => window.__promo.renderFrame(tt), t); await page.screenshot({ path: path.join(OUT, `t${String(Math.round(t)).padStart(3, "0")}.jpg`), type: "jpeg", quality: 94 }); console.log("frame", t); }
console.log("page errors", errors);
await ctx.close(); await browser.close();
