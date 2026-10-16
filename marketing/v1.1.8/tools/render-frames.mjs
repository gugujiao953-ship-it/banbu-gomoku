/**
 * 宣传片逐帧渲染：确定性驱动 promo.html 的 __renderFrame(t)
 * 用法： node render-frames.mjs [--shard i --of n]
 * 输出： video/frames/f00001.jpg ...
 */
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo.html");
const FRAMES = path.join(ROOT, "video", "frames");

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const shard = Number(getArg("--shard", "0"));
const of = Number(getArg("--of", "1"));
const QUALITY = Number(getArg("--quality", "93"));

if (shard === 0) { await rm(FRAMES, { recursive: true, force: true }); }
await mkdir(FRAMES, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none", "--high-dpi-support=1"],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "no-preference",
  locale: "zh-CN",
});
const page = await context.newPage();
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 60000 });

// 等所有图片就绪
await page.waitForFunction(() => {
  const imgs = [...document.images];
  return imgs.length > 0 && imgs.every(i => i.complete);
}, null, { timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => !!window.__promo, null, { timeout: 30000 });

const meta = await page.evaluate(() => ({ duration: window.__promo.DURATION, fps: window.__promo.FPS }));
const total = Math.round(meta.duration * meta.fps);

// 预热：把全部会用到的大图解码一遍，避免渲染中途抖动
await page.evaluate(async () => {
  const srcs = new Set();
  document.querySelectorAll('img').forEach(i => srcs.add(i.getAttribute('src')));
  await Promise.all([...srcs].filter(Boolean).map(s => new Promise(res => {
    const im = new Image(); im.onload = im.onerror = () => res(); im.src = s;
  })));
});

console.log(JSON.stringify({ shard, of, total, duration: meta.duration, fps: meta.fps }));

const t0 = Date.now();
let count = 0;
for (let f = shard; f < total; f += of) {
  const t = f / meta.fps;
  await page.evaluate((tt) => window.__promo.renderFrame(tt), t);
  const name = "f" + String(f + 1).padStart(5, "0") + ".jpg";
  await page.screenshot({ path: path.join(FRAMES, name), type: "jpeg", quality: QUALITY, animations: "allow" });
  count++;
  if (count % 100 === 0) {
    const el = (Date.now() - t0) / 1000;
    console.log(`shard${shard}: ${count} frames, ${(count / el).toFixed(1)} fps, eta ${((total/of - count) * el / count / 60).toFixed(1)}min`);
  }
}
console.log(`shard${shard} done: ${count} frames in ${((Date.now()-t0)/1000).toFixed(1)}s`);
await context.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
