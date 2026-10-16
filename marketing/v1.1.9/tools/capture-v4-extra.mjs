/** v4 补拍：① VCF 挑战等题目匹配完成后截图（不用加载中状态）② 量导入弹窗按钮真实坐标，给视频光标用 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "current-stills");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block",
});
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-onboarding-tour-v1", "seen");
});
const page = await context.newPage();
page.setDefaultTimeout(180_000);
page.setDefaultNavigationTimeout(180_000);
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));

const wait = (ms) => page.waitForTimeout(ms);
const boot = async () => {
  await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded" });
  await page.getByText("新建棋谱", { exact: true }).waitFor();
  await wait(600);
  for (let i = 0; i < 3; i += 1) {
    const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
    if (!(await close.count())) break;
    await close.click({ force: true }).catch(() => {});
    await wait(250);
  }
};
const nav = async (name) => { await page.getByRole("button", { name, exact: true }).last().click({ force: true }); await wait(500); };

/* ---------- ① VCF 挑战：等匹配结束、棋盘出现棋子再拍 ---------- */
await boot();
await nav("对弈");
await page.getByRole("button", { name: "开始 VCF 挑战", exact: true }).click({ force: true });
await page.locator(".vcfch-page").waitFor({ timeout: 30_000 });
await wait(700);
await page.screenshot({ path: path.join(OUT, "04-vcf-setup.png") });
console.log("shot 04-vcf-setup.png");
await page.getByRole("button", { name: "开始挑战", exact: true }).click({ force: true });
// 出题后 45 秒就会判负，所以「匹配中」一消失就立刻拍，轮询间隔 250ms、上限 25 秒
let ready = false;
for (let i = 0; i < 100; i += 1) {
  await wait(250);
  const matching = await page.getByText(/匹配中/).count();
  const stones = await page.locator('[role="gridcell"][aria-label*="子"]').count();
  if (!matching && stones > 0) { ready = true; break; }
}
await wait(350);
await page.screenshot({ path: path.join(OUT, "05-vcf-challenge.png") });
const info = await page.evaluate(() => ({
  stones: document.querySelectorAll('[role="gridcell"][aria-label*="子"]').length,
  text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 240),
}));
console.log("shot 05-vcf-challenge.png ready=" + ready, "stones=" + info.stones);
console.log("屏上文字:", info.text);
const bad = /时间到|判负|失败|匹配中/.test(info.text);
console.log(bad ? "★ 画面不健康（含 时间到/判负/失败/匹配中）" : "★ 画面健康");

/* ---------- ② 量导入弹窗按钮坐标（390×844 视口 CSS 像素） ---------- */
await boot();
await nav("打谱");
await page.locator(".bottom-nav .nav-center").click({ force: true });
await page.getByRole("dialog", { name: "选择导入方式" }).waitFor({ timeout: 20_000 });
await wait(600);
const boxes = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll("button.import-choice").forEach((el) => {
    const r = el.getBoundingClientRect();
    out.push({
      label: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 18),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    });
  });
  return out;
});
console.log("导入按钮坐标:", JSON.stringify(boxes));
await writeFile(path.join(ROOT, "tools", "import-coords.json"), JSON.stringify(boxes, null, 2), "utf8");

await context.close();
await browser.close();
console.log("done");
process.exit(0);
