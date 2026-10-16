// 生产路径·导入识谱核对（2026-10-07）：走真实 UI 导入 remote-image2，
// 把核对屏上的棋子坐标/颜色与真值逐坐标对账（验证「导入就够了」不是假阳堆出来的）。
// 用法：QA_BASE_URL=http://localhost:4173/ node qa/tmp-import-truth-e2e.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const truth = JSON.parse(readFileSync(resolve("qa/fixtures/recognition/remote-image2.truth.json"), "utf-8"));
const fixture = resolve("qa/fixtures/materials/remote-image2.png");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
await page.locator("nav.bottom-nav button").filter({ hasText: "打谱" }).first().click();
await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
const t0 = Date.now();
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 180000 });
const importMs = Date.now() - t0;
await page.waitForTimeout(400);
const stones = await page.evaluate(() => [...document.querySelectorAll("[data-verify-stone]")].map((node) => {
  const [row, col] = node.getAttribute("data-verify-stone").split("-").map(Number);
  const cls = node.getAttribute("class") || "";
  return { row, col, player: cls.includes("black") ? "black" : cls.includes("white") ? "white" : "?" };
}));
const expected = new Map(truth.moves.map((m) => [`${m.row},${m.col}`, m.player]));
const extra = stones.filter((s) => !expected.has(`${s.row},${s.col}`));
const missing = [...expected.keys()].filter((key) => !stones.some((s) => `${s.row},${s.col}` === key));
const wrongColor = stones.filter((s) => expected.has(`${s.row},${s.col}`) && expected.get(`${s.row},${s.col}`) !== s.player);
console.log(`导入识别：${stones.length} 子，耗时 ${importMs}ms`);
console.log(`逐坐标：命中 ${stones.length - extra.length - wrongColor.length}/${truth.moves.length}；多报 ${extra.length}（${extra.slice(0, 5).map((s) => `${String.fromCharCode(65 + s.col)}${15 - s.row}`).join(" ")}）；漏报 ${missing.length}；颜色错 ${wrongColor.length}`);
console.log(`页面错误 ${errors.length}${errors.length ? ": " + errors[0] : ""}`);
await browser.close();
process.exit(extra.length || missing.length || wrongColor.length ? 1 : 0);
