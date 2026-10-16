/** 抓棋盘材质：设置 → 外观与音效 → 棋盘（展开）→ 逐个应用并回打谱页拍棋盘，名字取自卡片文字 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "seq", "board-v4");
const MAX = Number(process.env.MAX_TILES || 20);
const START = Number(process.env.START_TILE || 0);
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
page.setDefaultTimeout(20_000);
page.setDefaultNavigationTimeout(200_000);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded" });
await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 200_000 });
await wait(600);
for (let i = 0; i < 3; i += 1) {
  const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
  if (!(await close.count())) break;
  await close.click({ force: true }).catch(() => {});
  await wait(200);
}
console.log("READY");

/** 打开 外观与音效 → 棋盘 子块，返回该子块 details */
async function openBoardPanel() {
  await page.getByRole("button", { name: "设置", exact: true }).last().click({ force: true });
  await wait(700);
  const outer = page.locator("details").filter({ hasText: "外观与音效" }).first();
  if ((await outer.getAttribute("open")) === null) { await outer.locator("summary").first().click({ force: true }); await wait(600); }
  /* 棋盘子块：用副标题文字定位它自己的 summary，再点它的父 details 的 summary */
  const sub = page.getByText("棋盘材质、标注高亮", { exact: false }).first();
  await sub.waitFor({ timeout: 10_000 });
  const inner = sub.locator("xpath=ancestor::details[1]");
  if ((await inner.getAttribute("open")) === null) { await inner.locator("summary").first().click({ force: true }); await wait(700); }
  return inner;
}

const panel = await openBoardPanel();
console.log("棋盘面板已打开");
console.log("面板文字:", (await panel.evaluate((el) => (el.innerText || "").replace(/\s+/g, " ").trim())).slice(0, 400));

/* 收集材质卡片：每个 button 连同它所在卡片的文字（名字就在卡片上） */
const tiles = await panel.evaluate((el) =>
  [...el.querySelectorAll("button")].map((b, i) => {
    const r = b.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return null;
    const card = b.closest("li, div");
    const name = (card && card.innerText ? card.innerText : "").replace(/\s+/g, " ").trim().split(" ")[0].slice(0, 16);
    return { i, name };
  }).filter(Boolean)
);
console.log("材质格子:", tiles.length, "→", tiles.map((t) => t.i + ":" + t.name).join(" | "));

const mapping = [];
for (const t of tiles.slice(START, START + MAX)) {
  try {
    const btn = panel.locator("button").nth(t.i);
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ force: true, timeout: 6000 });
    await wait(450);
    await page.getByRole("button", { name: "打谱", exact: true }).last().click({ force: true }).catch(() => {});
    await wait(700);
    const file = `${String(t.i).padStart(2, "0")}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    mapping.push({ i: t.i, name: t.name, file });
    console.log("shot", file, t.name);
    await openBoardPanel();
  } catch (error) {
    console.log("第", t.i, "格失败:", String(error).split("\n")[0].slice(0, 80));
    try { await openBoardPanel(); } catch { /* 继续 */ }
  }
}

await writeFile(path.join(ROOT, "tools", "board-map.json"), JSON.stringify(mapping, null, 1), "utf8");
console.log("完成", mapping.length, "张 →", OUT);
await context.close();
await browser.close();
process.exit(0);
