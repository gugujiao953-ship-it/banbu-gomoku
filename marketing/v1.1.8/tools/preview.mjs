import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo.html");
const OUT = path.join(ROOT, "video", "_preview");
await mkdir(OUT, { recursive: true });

const TIMES = process.argv.slice(2).filter(a => !a.startsWith("--")).map(Number);
const LIST = TIMES.length ? TIMES : [3, 14, 28, 46, 66, 86, 106, 124, 138, 151];

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark", locale: "zh-CN" });
const page = await context.newPage();
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => {
  const imgs = [...document.images];
  return imgs.length > 0 && imgs.every(i => i.complete);
}, null, { timeout: 60000 }).catch(() => {});
await page.evaluate(() => document.fonts.ready);

console.log("页脚:", await page.evaluate(() => `${window.__promo.DURATION}s @ ${window.__promo.FPS}fps`));
console.log("字体:", await page.evaluate(() => {
  const c = document.createElement("canvas").getContext("2d");
  const fam = ["Microsoft YaHei", "Source Han Serif SC", "Songti SC", "SimSun", "PingFang SC"];
  return fam.map(f => { c.font = `40px "${f}"`; return f + "=" + (c.measureText("半步五子棋打谱").width > 10); }).join(" ");
}));

for (const t of LIST) {
  await page.evaluate((tt) => window.__promo.renderFrame(tt), t);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, `t${String(Math.round(t)).padStart(3, "0")}.jpg`), type: "jpeg", quality: 95 });
  console.log("frame", t);
}
await context.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
