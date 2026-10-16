/** Render deterministic 30fps frames for promo-v3.html. */
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo-v3.html");
const FRAMES = path.join(ROOT, "video", "frames-v3");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const shard = Number(arg("--shard", "0"));
const of = Number(arg("--of", "1"));
const quality = Number(arg("--quality", "94"));
if (!Number.isInteger(shard) || !Number.isInteger(of) || shard < 0 || of < 1 || shard >= of) throw new Error("shard/of 参数无效");
if (shard === 0 && of === 1) await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-hinting=none", "--high-dpi-support=1"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "no-preference", locale: "zh-CN" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 90_000 });
await page.waitForFunction(() => window.__promo && [...document.images].every((image) => image.complete), null, { timeout: 90_000 });
await page.evaluate(() => document.fonts.ready);
const meta = await page.evaluate(() => ({ duration: window.__promo.DURATION, fps: window.__promo.FPS }));
const total = Math.round(meta.duration * meta.fps);
console.log(JSON.stringify({ shard, of, total, duration: meta.duration, fps: meta.fps }));
const started = Date.now();
let count = 0;
for (let frame = shard; frame < total; frame += of) {
  await page.evaluate((time) => window.__promo.renderFrame(time), frame / meta.fps);
  await page.screenshot({ path: path.join(FRAMES, `f${String(frame + 1).padStart(5, "0")}.jpg`), type: "jpeg", quality, animations: "allow" });
  count += 1;
  if (count % 100 === 0) console.log(`shard${shard}: ${count}/${Math.ceil(total / of)} frames`);
}
console.log(`shard${shard} done: ${count} frames in ${((Date.now() - started) / 1000).toFixed(1)}s; page errors=${errors.length}`);
await context.close();
await browser.close();
if (errors.length) process.exitCode = 1;
