/** 抓 1.2.0 新玩法：道具卡（棋魂商店·挑战道具）、人机自定义开局、每日一题、对弈屏、成就 */
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
  /* dev 构建会自动挂调试桥（屏幕底部绿色 DIAG 条），抓图时只隐藏它 */
  const hide = () => {
    const s = document.createElement("style");
    s.textContent = "[data-tempdiag]{display:none !important}";
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.head) hide();
  else document.addEventListener("DOMContentLoaded", hide);
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
page.setDefaultNavigationTimeout(240_000);
const failures = [];
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 160)));
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n) }); console.log("shot", n); };
const step = async (name, fn) => { try { console.log("step", name); await fn(); } catch (e) { const m = String(e.message || e).split("\n")[0]; failures.push(name + ": " + m.slice(0, 110)); console.log("FAIL", name, m.slice(0, 110)); } };

const boot = async () => {
  await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded" });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 240_000 });
  await wait(700);
  for (let i = 0; i < 3; i += 1) {
    const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
    if (!(await close.count())) break;
    await close.click({ force: true }).catch(() => {});
    await wait(220);
  }
};
const nav = async (name) => { await page.getByRole("button", { name, exact: true }).last().click({ force: true }); await wait(650); };
const closeSheet = async () => {
  const b = page.locator('[role="dialog"] button[aria-label="关闭"]:visible, button[aria-label="先不买"]:visible').last();
  if (await b.count()) await b.click({ force: true }).catch(() => {});
  else await page.keyboard.press("Escape").catch(() => {});
  await wait(450);
};
const dump = async (tag) => {
  const t = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 330));
  console.log("  屏上[" + tag + "]:", t);
};

/* ① 对弈页 */
await step("duel-home", async () => {
  await boot();
  await nav("对弈");
  await page.locator("[data-duel-page]").waitFor({ timeout: 30_000 });
  await wait(900);
  await shot("40-duel-home.png");
  await dump("对弈页");
});

/* ② 棋魂商店 · 挑战道具（道具卡） */
await step("soul-shop-items", async () => {
  await page.locator("[data-shop-badge]").first().click({ force: true });
  await wait(1000);
  const itemsTab = page.getByRole("button", { name: /挑战道具|棋局道具/ }).first();
  if (await itemsTab.count()) { await itemsTab.click({ force: true }); await wait(800); }
  await shot("41-soul-shop-items.png");
  await dump("商店道具页");
  await closeSheet();
});

/* ③ 棋魂商店 · 外观解锁 */
await step("soul-shop-skins", async () => {
  await page.locator("[data-shop-badge]").first().click({ force: true });
  await wait(1000);
  const skinTab = page.getByRole("button", { name: /外观解锁/ }).first();
  if (await skinTab.count()) { await skinTab.click({ force: true }); await wait(800); }
  await shot("42-soul-shop-skins.png");
  await closeSheet();
});

/* ④ 成就 */
await step("achievements", async () => {
  await page.getByRole("button", { name: "成就", exact: true }).first().click({ force: true });
  await wait(1000);
  await shot("43-achievements.png");
  await closeSheet();
});

/* ⑤ 每日一题 */
await step("daily", async () => {
  const d = page.locator(".duel-daily-name, [data-duel-daily]").first();
  if (await d.count()) await d.click({ force: true });
  else await page.getByText("每日一题", { exact: false }).first().click({ force: true });
  await wait(1800);
  await shot("44-daily-puzzle.png");
  await dump("每日一题");
  await page.getByRole("button", { name: "返回对弈" }).first().click({ force: true }).catch(() => {});
  await wait(700);
});

/* ⑥ 人机对弈 · 自定义开局（摆子） */
await step("custom-opening", async () => {
  await nav("对弈");
  const ai = page.getByRole("button", { name: /人机|开始对弈|AI 对弈|人机对局/ }).first();
  if (await ai.count()) await ai.click({ force: true });
  else await page.getByText(/人机/, { exact: false }).first().click({ force: true });
  await wait(1200);
  await dump("人机开局面板");
  const custom = page.getByRole("button", { name: /自定义开局|自定义/ }).first();
  if (await custom.count()) await custom.click({ force: true });
  else await page.getByText(/自定义开局/, { exact: false }).first().click({ force: true });
  await wait(1200);
  await shot("45-custom-opening.png");
  await dump("自定义开局");
});

await context.close();
await browser.close();
console.log("done", JSON.stringify({ failures }, null, 1));
process.exit(0);
