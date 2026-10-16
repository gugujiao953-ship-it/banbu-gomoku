import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "stills", "_theme-probe");
await mkdir(OUT, { recursive: true });
const BASE = process.env.BANBU_URL || "http://localhost:5195/";

const CASES = [
  ["a-blackgold", "blackgold", "blackgold", "blackgold", "尊贵黑金全套"],
  ["b-porcelain", "porcelain", "porcelain", "porcelain", "青花瓷全套"],
  ["c-cyber", "cyber", "circuit", "terminal", "赛博电路终端"],
  ["d-aurora", "aurora", "aurora", "aurora", "极光全套"],
  ["e-whitejade", "dark", "whitejade", "gold-diamond", "白玉黑钻白金"],
  ["f-classic", "light", "wood", "yun", "经典原木云子"],
];

const browser = await chromium.launch({ headless: true });
for (const [id, pref, board, stone, label] of CASES) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    colorScheme: pref === "light" ? "light" : "dark",
    reducedMotion: "reduce", serviceWorkers: "block", locale: "zh-CN",
  });
  await context.addInitScript(({ pref, board, stone }) => {
    try {
      localStorage.setItem("banbu-first-run-welcome-v1", "true");
      localStorage.setItem("banbu-onboarding-tour-v1", "seen");
      localStorage.setItem("banbu-theme-preference-v1", pref);
      localStorage.setItem("banbu-board-theme-v1", board);
      localStorage.setItem("banbu-stone-theme-v1", stone);
    } catch {}
  }, { pref, board, stone });
  const page = await context.newPage();
  await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 30000 });
  const moves = ["H8","I8","H9","I9","G8","J8","G9","J9","F8","K8","F9"];
  for (const pt of moves) {
    await page.evaluate((p) => {
      const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(p));
      c && c.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }, pt);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${id}.png`) });
  console.log("shot", id, label);
  await context.close();
}
await browser.close();
process.exit(0);
