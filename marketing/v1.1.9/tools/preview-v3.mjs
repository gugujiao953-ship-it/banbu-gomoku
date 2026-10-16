import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo-v3.html");
const OUT = path.join(ROOT, "video", "_preview-v3");
await mkdir(OUT, { recursive: true });
const times = process.argv.slice(2).filter((value) => !value.startsWith("--")).map(Number);
const list = times.length ? times : [0, 2.4, 5, 8.2, 11, 13.8, 17.8, 21.2, 25.2, 28.2, 32.2, 35.4, 38.6, 41.6, 44.4, 47.6, 50.9];
const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-hinting=none"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light", locale: "zh-CN" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 60_000 });
await page.waitForFunction(() => window.__promo && [...document.images].every((image) => image.complete), null, { timeout: 60_000 });
for (const time of list) {
  await page.evaluate((value) => window.__promo.renderFrame(value), time);
  await page.screenshot({ path: path.join(OUT, `t${String(Math.round(time * 10)).padStart(4, "0")}.jpg`), type: "jpeg", quality: 94 });
}
console.log(JSON.stringify({ output: OUT, frames: list.length, errors }, null, 2));
await context.close();
await browser.close();
if (errors.length) process.exitCode = 1;
