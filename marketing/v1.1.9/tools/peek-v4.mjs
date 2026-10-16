/** 小样：只渲染指定时刻，用于改版后快速目视确认 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "video", "_peek");
mkdirSync(OUT, { recursive: true });
const times = (process.env.TIMES || "1.4,3.2,3.5,6.6,61.5").split(",").map(Number);

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark", locale: "zh-CN" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto(pathToFileURL(path.join(ROOT, "video", "promo-v4.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__promo && [...document.images].every((i) => i.complete), null, { timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);
for (const t of times) {
  await page.evaluate((tt) => window.__promo.renderFrame(tt), t);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, `t${String(t).replace(".", "_")}.jpg`), type: "jpeg", quality: 80 });
  console.log("shot t=" + t);
}
/* 断言片头文案与字号 */
const info = await page.evaluate(() => {
  window.__promo.renderFrame(3.2);
  const claim = document.getElementById("claimLine").textContent.trim();
  const pill = document.querySelector("#favList .pill");
  const claimSize = getComputedStyle(document.getElementById("claimLine")).fontSize;
  const pillSize = pill ? getComputedStyle(pill).fontSize : "(无)";
  return { claim, claimSize, pillSize, pillCount: document.querySelectorAll("#favList .pill").length, pillRows: new Set([...document.querySelectorAll("#favList .pill")].map((p) => Math.round(p.getBoundingClientRect().top))).size };
});
console.log(JSON.stringify(info, null, 1));
console.log("报错:", errors.length ? errors.join(" || ") : "无");
process.exit(0);
