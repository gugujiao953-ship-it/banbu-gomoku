/** 探针：从 dist 起服务，进对弈页，把可见按钮/徽章的真实挂点全 dump 出来 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DIST = "D:/Projects/五子棋2/dist";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".wasm": "application/wasm", ".woff2": "font/woff2", ".data": "application/octet-stream", ".wav": "audio/wav" };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.join(DIST, url === "/" ? "index.html" : url);
  if (!existsSync(file) || (await stat(file)).isDirectory()) file = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-onboarding-tour-v1", "seen");
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
await page.goto(`${BASE}/`, { waitUntil: "commit" });
await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 120_000 });
await page.waitForTimeout(800);

/* 底栏结构 */
const navs = await page.evaluate(() =>
  [...document.querySelectorAll("nav button, .bottom-nav button, button")].map((b) => ({
    t: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 14),
    a: (b.getAttribute("aria-label") || "").slice(0, 18),
    d: Object.keys(b.dataset).slice(0, 4).join(","),
  })).filter((x) => x.t || x.a).slice(0, 40)
);
console.log("底栏/按钮（前 40）:");
navs.forEach((n) => console.log(`  「${n.t}」 aria=${n.a} data=${n.d}`));

/* 进对弈 */
const duel = page.getByRole("button", { name: "对弈", exact: true }).last();
console.log("\n对弈按钮存在:", await duel.count());
await duel.click({ force: true });
await page.waitForTimeout(1800);

const dump = await page.evaluate(() => ({
  text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700),
  hooks: [...document.querySelectorAll("[data-duel-page],[data-soul-badge],[data-shop-badge],[data-stats-badge]")].map((e) => e.tagName + ":" + Object.keys(e.dataset).join(",")),
  buttons: [...document.querySelectorAll("button")].map((b) => ({ t: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 16), a: (b.getAttribute("aria-label") || "").slice(0, 20), c: (b.className || "").toString().split(" ").slice(0, 2).join(".") })).filter((x) => x.t || x.a).slice(0, 30),
}));
console.log("\n对弈页文字:", dump.text);
console.log("\n对弈页 data 挂点:", dump.hooks.join(" ") || "(无)");
console.log("\n对弈页按钮:");
dump.buttons.forEach((b) => console.log(`  「${b.t}」 aria=${b.a} cls=${b.c}`));

await browser.close();
server.close();
process.exit(0);
