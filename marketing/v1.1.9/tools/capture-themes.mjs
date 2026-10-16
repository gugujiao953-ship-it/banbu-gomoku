/** 抓主题（v2）：元素级点击（不用屏幕坐标），逐步日志，快速失败 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "seq", "theme-v4");
const MAX = Number(process.env.MAX_TILES || 26);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block",
});
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-onboarding-tour-v1", "seen");
});
const page = await context.newPage();
page.setDefaultTimeout(12_000);
page.setDefaultNavigationTimeout(200_000);
const wait = (ms) => page.waitForTimeout(ms);

const boot = async () => {
  await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded" });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 200_000 });
  await wait(600);
  for (let i = 0; i < 3; i += 1) {
    const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
    if (!(await close.count())) break;
    await close.click({ force: true }).catch(() => {});
    await wait(250);
  }
};
const goBoard = async () => { await page.getByRole("button", { name: "打谱", exact: true }).last().click({ force: true }).catch(() => {}); await wait(700); };

await boot();
console.log("READY");

/* 进设置 → 打开「外观与音效」→ 打开「主题」 */
const openThemePanel = async () => {
  await page.getByRole("button", { name: "设置", exact: true }).last().click({ force: true });
  await wait(700);
  const outer = page.locator("details").filter({ has: page.locator("summary", { hasText: "外观与音效" }) }).first();
  await outer.scrollIntoViewIfNeeded().catch(() => {});
  if ((await outer.getAttribute("open")) === null) { await outer.locator("summary").first().click({ force: true }); await wait(600); }
  const inner = page.locator("details").filter({ has: page.locator("summary", { hasText: /^主题/ }) }).first();
  await inner.scrollIntoViewIfNeeded().catch(() => {});
  if ((await inner.getAttribute("open")) === null) { await inner.locator("summary").first().click({ force: true }); await wait(700); }
  return inner;
};

let panel;
try {
  panel = await openThemePanel();
  console.log("主题面板已打开");
} catch (error) {
  console.log("打开主题面板失败:", String(error).split("\n")[0]);
  await page.screenshot({ path: path.join(OUT, "_fail.png") });
  await context.close(); await browser.close(); process.exit(1);
}

await wait(400);
console.log("面板文字:", await panel.evaluate((el) => (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700)));

const tiles = panel.locator("button");
const count = await tiles.count();
console.log("格子数:", count);

const mapping = [];
for (let i = 0; i < Math.min(count, MAX); i += 1) {
  try {
    const tile = tiles.nth(i);
    await tile.scrollIntoViewIfNeeded();
    await tile.click({ force: true, timeout: 6000 });
    await wait(450);
    const name = await panel.evaluate((el) => {
      /* 选中后，折叠块首行会把「主题 跟随系统」换成所选名字：抓「主题」后面那段 */
      const txt = (el.innerText || "").replace(/\s+/g, " ").trim();
      const m = txt.match(/主题\s*([^\s]{2,14})/);
      if (m) return m[1];
      const sel = el.querySelector("button[aria-pressed='true'], button.selected, button[aria-checked='true']");
      if (!sel) return "";
      let node = sel;
      for (let up = 0; up < 3 && node; up += 1) {
        const t = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (t && t.length < 30) return t;
        node = node.parentElement;
      }
      return "";
    }).catch(() => "");
    await goBoard();
    const file = `${String(i).padStart(2, "0")}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    mapping.push({ i, file, name });
    console.log("shot", file, "name=" + (name || "(无)"));
    panel = await openThemePanel();
  } catch (error) {
    console.log("第", i, "格失败:", String(error).split("\n")[0].slice(0, 90));
    try { panel = await openThemePanel(); } catch { /* 下一轮再试 */ }
  }
}

await writeFile(path.join(ROOT, "tools", "theme-map.json"), JSON.stringify(mapping, null, 1), "utf8");
console.log("完成", mapping.length, "张");
await context.close();
await browser.close();
process.exit(0);
