/** 抓 10-09/10-10 新增内容：棋魂、成就、棋魂商店、每日一题、横屏顶部折叠四档 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "current-stills");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block",
});
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-onboarding-tour-v1", "seen");
  /* dev 构建会自动挂调试桥，屏幕底部有一条绿色 DIAG 条（<pre data-tempdiag>）。
     抓图时只把它隐藏，产品 UI 一点不动。 */
  const hide = () => {
    const s = document.createElement("style");
    s.textContent = "[data-tempdiag]{display:none !important}";
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.head) hide();
  else document.addEventListener("DOMContentLoaded", hide);
});
const page = await context.newPage();
page.setDefaultTimeout(240_000);
page.setDefaultNavigationTimeout(240_000);
const failures = [];
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") console.log("console-error", m.text().slice(0, 200)); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name), fullPage: false }); console.log("shot", name); };
const step = async (name, fn) => { try { console.log("step", name); await fn(); } catch (e) { const m = String(e.message || e).split("\n")[0]; failures.push(name + ": " + m); console.log("FAIL", name, m.slice(0, 120)); } };

const boot = async () => {
  await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded" });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 240_000 });
  await wait(700);
  for (let i = 0; i < 3; i += 1) {
    const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
    if (!(await close.count())) break;
    await close.click({ force: true }).catch(() => {});
    await wait(250);
  }
};
const nav = async (name) => { await page.getByRole("button", { name, exact: true }).last().click({ force: true }); await wait(600); };
const closeSheet = async () => {
  const btn = page.locator('[role="dialog"] button[aria-label="关闭"]:visible, .sheet-close:visible').last();
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); }
  else { await page.keyboard.press("Escape").catch(() => {}); }
  await wait(500);
};

/* ① 对弈页（三个徽章：棋魂 / 成就 / 商店；还有每日一题入口） */
await step("duel-home", async () => {
  await boot();
  await nav("对弈");
  await page.locator("[data-duel-page]").waitFor({ timeout: 30_000 });
  await wait(800);
  await shot("01-duel-home.png");
  const badges = await page.evaluate(() => [...document.querySelectorAll("[data-soul-badge],[data-shop-badge],button")].map((b) => (b.getAttribute("aria-label") || "").slice(0, 20)).filter(Boolean).slice(0, 12));
  console.log("  可见按钮:", badges.join(" | "));
});

/* ② 棋魂说明页 */
await step("soul-panel", async () => {
  await page.locator("[data-soul-badge]").first().click({ force: true });
  await wait(900);
  await shot("30-soul-panel.png");
  await closeSheet();
});

/* ③ 成就 */
await step("achievements", async () => {
  await page.getByRole("button", { name: "成就", exact: true }).first().click({ force: true });
  await wait(900);
  await shot("31-achievements.png");
  await closeSheet();
});

/* ④ 棋魂商店 */
await step("soul-shop", async () => {
  const shop = page.locator("[data-shop-badge]").first();
  if (await shop.count()) { await shop.click({ force: true }); }
  else { await page.getByRole("button", { name: /商店/ }).first().click({ force: true }); }
  await wait(900);
  await shot("32-soul-shop.png");
  await closeSheet();
});

/* ⑤ 每日一题 */
await step("daily-puzzle", async () => {
  const daily = page.locator(".duel-daily-name, [data-duel-daily]").first();
  if (await daily.count()) { await daily.click({ force: true }); }
  else { await page.getByText("每日一题", { exact: false }).first().click({ force: true }); }
  await wait(1600);
  await shot("33-daily-puzzle.png");
});

/* ⑥ 顶部折叠四档（打谱页） */
await step("chrome-collapse", async () => {
  await boot();
  await nav("打谱");
  await wait(900);
  const toggle = page.locator(".chrome-collapse-toggle").first();
  await toggle.waitFor({ timeout: 15_000 });
  await shot("34-chrome-level0.png");
  for (const level of [1, 2, 3]) {
    await toggle.click({ force: true });
    await wait(800);
    await shot(`34-chrome-level${level}.png`);
    const state = await toggle.getAttribute("data-chrome-level");
    console.log("  折叠档位:", state, "标签:", (await toggle.getAttribute("aria-label")) || "");
  }
  await toggle.click({ force: true });
  await wait(500);
});

await context.close();
await browser.close();
console.log("done", JSON.stringify({ failures }, null, 1));
process.exit(0);
