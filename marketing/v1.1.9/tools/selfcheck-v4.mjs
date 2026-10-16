/** promo-v4.html 程序化自检：把 renderFrame 渲染到指定时刻，读 DOM 状态比对 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "video", "promo-v4.html");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
await page.goto(pathToFileURL(HTML).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__promo && [...document.images].every((i) => i.complete || i.src === ""), null, { timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);

const meta = await page.evaluate(() => ({ duration: window.__promo.DURATION, fps: window.__promo.FPS, segments: window.__promo.SEGS.length }));
console.log("时长/帧率/段数:", JSON.stringify(meta), "→ 总帧数", Math.round(meta.duration * meta.fps));

const checks = [0.8, 2.5, 6.6, 12.0, 21.0, 29.0, 36.5, 42.0, 48.0, 54.0, 61.0];
for (const t of checks) {
  const s = await page.evaluate((tt) => {
    window.__promo.renderFrame(tt);
    const active = window.__promo.SEGS.find((x) => tt >= x.t0 && tt < x.t1) || window.__promo.SEGS.at(-1);
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const st = getComputedStyle(el);
      return { op: Number(st.opacity).toFixed(2), txt: (el.textContent || "").trim().slice(0, 40) };
    };
    const imgs = {};
    document.querySelectorAll(".seg.on .phone-screen img").forEach((im, i) => {
      const st = getComputedStyle(im);
      if (Number(st.opacity) > 0.02) imgs["img" + i] = im.getAttribute("src").split("/").pop();
    });
    return {
      seg: active.id,
      sub: (document.getElementById("subText").textContent || "").trim().slice(0, 46),
      claim: vis("#claimLine"),
      brand: vis("#brandTitle"),
      ver: vis("#brandVer"),
      endVer: vis("#endVer"),
      cap: (document.querySelector(".seg.on .captag") || {}).textContent || "",
      cursor: vis("#c5"),
      imgs,
      chapter: document.getElementById("chapter").textContent,
      bar: document.getElementById("progBar").style.width,
    };
  }, t);
  console.log(
    `t=${String(t).padStart(5)} | ${s.seg.padEnd(3)} | 帧内字幕「${s.sub}」| 章「${s.chapter}」| ${s.bar}` +
    (Object.keys(s.imgs).length ? " | 屏:" + JSON.stringify(s.imgs) : "") +
    (s.claim && Number(s.claim.op) > 0.05 ? " | 宣言op=" + s.claim.op : "") +
    (s.brand && Number(s.brand.op) > 0.05 ? " | 品牌op=" + s.brand.op : "") +
    (s.ver && Number(s.ver.op) > 0.05 ? " | 版本「" + s.ver.txt + "」op=" + s.ver.op : "") +
    (s.endVer && Number(s.endVer.op) > 0.05 ? " | 收尾版本「" + s.endVer.txt + "」" : "") +
    (s.cap ? " | tag「" + s.cap + "」" : "") +
    (s.cursor && Number(s.cursor.op) > 0.02 ? " | 光标op=" + s.cursor.op : "")
  );
}

/* 资源完整性 */
const broken = await page.evaluate(() => [...document.images].filter((i) => i.src && !i.naturalWidth).map((i) => i.getAttribute("src")));
console.log("未加载成功的图:", broken.length ? broken : "无");
console.log("报错:", errors.length ? errors.join(" || ") : "无");
await browser.close();
process.exit(errors.length || broken.length ? 1 : 0);
