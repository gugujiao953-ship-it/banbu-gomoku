/** 抓 1.2.0 新玩法素材（走 dist 生产构建 + 同进程静态服务，避开 vite dev 卡顿） */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DIST = path.resolve(ROOT, "..", "..", "dist");
const OUT = path.join(ROOT, "current-stills");
await mkdir(OUT, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".wasm": "application/wasm", ".ttf": "font/ttf", ".woff2": "font/woff2", ".data": "application/octet-stream", ".wav": "audio/wav", ".mp3": "audio/mpeg" };

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!existsSync(file) || (await stat(file)).isDirectory()) file = path.join(DIST, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end("err");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
console.log("静态服务:", BASE, "→", DIST);

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block",
});
await context.addInitScript(() => {
  /* 首运行欢迎页与引导的记录是**按版本号**存的 —— 写 "true" 不生效，必须写当前版本号 */
  localStorage.setItem("banbu-first-run-welcome-v1", "1.1.9.32");
  localStorage.setItem("banbu-onboarding-tour-v1", "1.1.9.32");
  const hide = () => {
    const s = document.createElement("style");
    s.textContent = "[data-tempdiag]{display:none !important}";
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.head) hide(); else document.addEventListener("DOMContentLoaded", hide);
});
const page = await context.newPage();
page.setDefaultTimeout(25_000);
page.setDefaultNavigationTimeout(120_000);
const failures = [];
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 140)));
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n) }); console.log("shot", n); };
const step = async (name, fn) => { try { console.log("step", name); await fn(); } catch (e) { const m = String(e.message || e).split("\n")[0]; failures.push(name + ": " + m.slice(0, 110)); console.log("FAIL", name, m.slice(0, 110)); } };
const dump = async (tag) => console.log("  屏上[" + tag + "]:", await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300)));

const boot = async () => {
  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  await wait(1600);
  /* 兜底：万一欢迎页还是出来了，点「先自己试试」跳过 */
  const skip = page.getByText("先自己试试", { exact: false }).first();
  if (await skip.count()) { await skip.click({ force: true }).catch(() => {}); await wait(1000); }
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 120_000 });
  await wait(800);
  for (let i = 0; i < 3; i += 1) {
    const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
    if (!(await close.count())) break;
    await close.click({ force: true }).catch(() => {});
    await wait(250);
  }
};
const nav = async (name) => { await page.getByRole("button", { name, exact: true }).last().click({ force: true }); await wait(700); };
const closeSheet = async () => {
  const b = page.locator('[role="dialog"] button[aria-label="关闭"]:visible, button[aria-label="先不买"]:visible').last();
  if (await b.count()) await b.click({ force: true }).catch(() => {});
  else await page.keyboard.press("Escape").catch(() => {});
  await wait(500);
};

let booted = false;
await step("boot", async () => { await boot(); booted = true; console.log("  已进入主界面"); });
if (!booted) { await context.close(); await browser.close(); server.close(); process.exit(1); }

await step("duel-home", async () => {
  await nav("对弈");
  await page.locator("[data-duel-page]").waitFor({ timeout: 30_000 });
  await wait(1000);
  await shot("40-duel-home.png");
  await dump("对弈页");
});

await step("soul-shop-items", async () => {
  await page.locator("[data-shop-badge]").first().click({ force: true });
  await wait(1100);
  const tab = page.getByRole("button", { name: /挑战道具|棋局道具/ }).first();
  if (await tab.count()) { await tab.click({ force: true }); await wait(900); }
  await shot("41-soul-shop-items.png");
  await dump("商店道具");
  await closeSheet();
});

await step("soul-shop-skins", async () => {
  await page.locator("[data-shop-badge]").first().click({ force: true });
  await wait(1100);
  const tab = page.getByRole("button", { name: /外观解锁/ }).first();
  if (await tab.count()) { await tab.click({ force: true }); await wait(900); }
  await shot("42-soul-shop-skins.png");
  await closeSheet();
});

await step("achievements", async () => {
  await page.getByRole("button", { name: "成就", exact: true }).first().click({ force: true });
  await wait(1100);
  await shot("43-achievements.png");
  await closeSheet();
});

await step("daily", async () => {
  const d = page.locator(".duel-daily-name, [data-duel-daily]").first();
  if (await d.count()) await d.click({ force: true });
  else await page.getByText("每日一题", { exact: false }).first().click({ force: true });
  await wait(1900);
  await shot("44-daily-puzzle.png");
  await dump("每日一题");
  await page.getByRole("button", { name: "返回对弈" }).first().click({ force: true }).catch(() => {});
  await wait(800);
});

await step("custom-opening", async () => {
  await nav("对弈");
  const ai = page.getByRole("button", { name: "开始对局", exact: true }).first();
  if (await ai.count()) await ai.click({ force: true });
  else await page.getByText("开始对局", { exact: true }).first().click({ force: true });
  await wait(1400);
  await dump("对局设置");
  const custom = page.getByRole("button", { name: /自定义开局|自定义布局|自定义/ }).first();
  if (await custom.count()) await custom.click({ force: true });
  else await page.getByText(/自定义开局|自定义布局/, { exact: false }).first().click({ force: true });
  await wait(1500);
  await shot("45-custom-opening.png");
  await dump("自定义开局");
});

await context.close();
await browser.close();
server.close();
console.log("done", JSON.stringify({ failures }, null, 1));
process.exit(0);
