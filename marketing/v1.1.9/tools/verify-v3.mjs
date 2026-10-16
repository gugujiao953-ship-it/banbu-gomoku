/** Preflight and visual state checks for promo-v3.html. */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo-v3.html");
const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-hinting=none"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light", locale: "zh-CN" });
const page = await ctx.newPage();
const errors = [];
const failed = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) => failed.push(request.url()));
page.on("response", (response) => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 90_000 });
await page.waitForFunction(() => window.__promo && [...document.images].every((image) => image.complete), null, { timeout: 90_000 });
await page.evaluate(() => document.fonts.ready);
const meta = await page.evaluate(() => ({ duration: window.__promo.DURATION, fps: window.__promo.FPS, scenes: window.__promo.SCENES.map(({ id, a, b, kind }) => ({ id, a, b, kind })) }));
if (meta.duration !== 51 || meta.fps !== 30) throw new Error(`v3 时长/帧率异常: ${JSON.stringify(meta)}`);
const broken = await page.evaluate(() => [...document.images].filter((image) => image.getAttribute("src") && image.complete && image.naturalWidth === 0).map((image) => image.src));
if (broken.length) throw new Error(`素材加载失败: ${broken.join(", ")}`);
const checks = [0, 2.39, 2.4, 4.9, 5, 8.19, 8.2, 10.99, 11, 13.8, 17.8, 21.2, 25.2, 28.2, 32.2, 35.4, 38.6, 41.6, 44.4, 47.6, 50.9, 51];
for (const time of checks) {
  const result = await page.evaluate((t) => {
    window.__promo.renderFrame(t);
    const scene = window.__promo.SCENES.find((item) => t >= item.a && t < item.b) || window.__promo.SCENES.at(-1);
    const visible = [...document.querySelectorAll("#screenA, #screenB")].filter((element) => parseFloat(getComputedStyle(element).opacity || "0") > 0.2).length;
    return { time: t, scene: scene.id, visible, headline: document.querySelector("#headline")?.textContent?.replace(/\s+/g, " ").trim() };
  }, time);
  if (result.visible > 2) throw new Error(`t=${time}: 截图窗口数量异常 ${result.visible}`);
  console.log(`${result.time.toFixed(2)}s ${result.scene} ${result.headline}`);
}
console.log(JSON.stringify({ duration: meta.duration, fps: meta.fps, scenes: meta.scenes.length, failed: [...new Set(failed)].slice(0, 10), errors }, null, 2));
await ctx.close();
await browser.close();
if (failed.length || errors.length) process.exitCode = 1;
