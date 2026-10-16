/** Render deterministic frames for promo-v2.html. */
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo-v2.html");
const FRAMES = path.join(ROOT, "video", "frames-v2");
const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const shard = Number(getArg("--shard", "0"));
const of = Number(getArg("--of", "1"));
const quality = Number(getArg("--quality", "93"));
if (shard === 0 && of === 1) await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none", "--high-dpi-support=1"],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  colorScheme: "light", reducedMotion: "no-preference", locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 90000 });
await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 90000 });
await page.waitForFunction(() => !!window.__promo, null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
const meta = await page.evaluate(() => ({ duration: window.__promo.DURATION, fps: window.__promo.FPS }));
const total = Math.round(meta.duration * meta.fps);
console.log(JSON.stringify({ shard, of, total, duration: meta.duration, fps: meta.fps }));
const start = Date.now(); let count = 0;
for (let f = shard; f < total; f += of) {
  await page.evaluate(t => window.__promo.renderFrame(t), f / meta.fps);
  await page.screenshot({ path: path.join(FRAMES, `f${String(f + 1).padStart(5, "0")}.jpg`), type: "jpeg", quality, animations: "allow" });
  count++;
  if (count % 100 === 0) {
    const elapsed = (Date.now() - start) / 1000;
    console.log(`shard${shard}: ${count}/${Math.ceil(total / of)} frames, ${(count / elapsed).toFixed(1)} fps`);
  }
}
console.log(`shard${shard} done: ${count} frames in ${((Date.now() - start) / 1000).toFixed(1)}s; page errors=${errors.length}`);
await context.close(); await browser.close();
