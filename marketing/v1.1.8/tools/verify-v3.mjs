/** 渲染前验收：图片是否有 404、各时刻内容是否正确 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HTML = path.join(ROOT, "video", "promo.html");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: "zh-CN" });
const page = await ctx.newPage();

const failed = [];
page.on("requestfailed", r => failed.push("REQFAIL " + r.url().split("/").slice(-2).join("/")));
page.on("response", r => { if (r.status() >= 400) failed.push(r.status() + " " + r.url().split("/").slice(-2).join("/")); });
const errs = [];
page.on("pageerror", e => errs.push(e.message));

await page.goto(pathToFileURL(HTML).href, { waitUntil: "load", timeout: 90000 });
await page.waitForFunction(() => {
  const imgs = [...document.images];
  return imgs.length > 0 && imgs.every(i => i.complete);
}, null, { timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => !!window.__promo, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);

console.log("总时长 =", await page.evaluate(() => window.__promo.DURATION), "s");

// 逐时刻断言
const CHECKS = [2, 5, 9, 15, 21, 29, 36, 43, 47, 51, 56, 62];
for (const t of CHECKS) {
  const r = await page.evaluate((tt) => {
    window.__promo.renderFrame(tt);
    const on = id => document.getElementById(id)?.classList.contains("on");
    const seg = ["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10"].find(on);
    const broken = [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.split("/").slice(-2).join("/"));
    const typeShown = seg === "s1"
      ? [...document.querySelectorAll("#typingLine i")].filter(i => parseFloat(i.style.opacity || 0) > .5).length : -1;
    const brandShown = seg === "s1"
      ? [...document.querySelectorAll("#brandTitle i")].filter(i => parseFloat(i.style.opacity || 0) > .5).length : -1;
    const curVisible = ["c3","c9"].filter(id => parseFloat(document.getElementById(id)?.style.opacity || 0) > .5);
    return { seg, sub: document.getElementById("subText").textContent.slice(0, 26), broken, typeShown, brandShown, curVisible,
             tw: seg === "s7" ? document.getElementById("twNameC").textContent : "" };
  }, t);
  console.log(`t=${String(t).padStart(2)}s [${r.seg}] 字幕="${r.sub}…"` +
    (r.typeShown >= 0 ? ` 打字=${r.typeShown}/26 品牌=${r.brandShown}/7` : "") +
    (r.tw ? ` 中间主题=${r.tw}` : "") +
    (r.curVisible.length ? ` 光标=${r.curVisible.join(",")}` : "") +
    (r.broken.length ? ` ★破损图=${r.broken.join(",")}` : ""));
}

console.log("请求失败/4xx:", failed.length ? [...new Set(failed)].slice(0, 10) : "无");
console.log("页面错误:", errs.length ? errs.slice(0, 5) : "无");

await ctx.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
