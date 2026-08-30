import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const artifactDir = resolve("artifacts/visual-regression");
await mkdir(artifactDir, { recursive: true });

const cases = [
  { name: "mobile-390", width: 390, height: 844, isMobile: true },
  { name: "mobile-360", width: 360, height: 800, isMobile: true },
  { name: "landscape-844", width: 844, height: 390, isMobile: true },
  { name: "tablet-768", width: 768, height: 1024, isMobile: false },
  { name: "dark-390", width: 390, height: 844, isMobile: true, dark: true },
  { name: "reduced-motion-390", width: 390, height: 844, isMobile: true, reducedMotion: true },
];

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const item of cases) {
    const context = await browser.newContext({
      viewport: { width: item.width, height: item.height },
      deviceScaleFactor: 1,
      isMobile: item.isMobile,
      hasTouch: item.isMobile,
      colorScheme: item.dark ? "dark" : "light",
      reducedMotion: item.reducedMotion ? "reduce" : "no-preference",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    const longTasks = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 15_000 });
    await page.locator(".renju-board").waitFor();
    await page.screenshot({ path: resolve(artifactDir, `${item.name}.png`), fullPage: false });

    const metrics = await page.evaluate(() => {
      const animations = document.getAnimations().map((animation) => ({
        duration: animation.effect?.getComputedTiming?.().duration ?? null,
        iterations: animation.effect?.getComputedTiming?.().iterations ?? null,
      }));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
        board: document.querySelector(".renju-board")?.getBoundingClientRect().toJSON() || null,
        bottomNav: document.querySelector(".bottom-nav")?.getBoundingClientRect().toJSON() || null,
        toast: document.querySelector(".app-toast")?.getBoundingClientRect().toJSON() || null,
        sheet: document.querySelector(".bottom-sheet")?.getBoundingClientRect().toJSON() || null,
        animations,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    });
    await page.evaluate(() => {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__banbuLongTasks = [...(window.__banbuLongTasks || []), entry.duration];
      });
      try { observer.observe({ type: "longtask", buffered: true }); } catch { /* unsupported browser */ }
    });
    await page.getByRole("button", { name: "更多" }).click();
    await page.getByRole("button", { name: "查找", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "查找" });
    await sheet.waitFor();
    const focusInside = await page.evaluate(() => Boolean(document.activeElement?.closest(".bottom-sheet")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(40);
    const sheetClosed = !(await page.locator(".bottom-sheet").count());
    const postInteraction = await page.evaluate(() => ({ longTasks: window.__banbuLongTasks || [] }));
    longTasks.push(...postInteraction.longTasks);
    const visibleBottomNav = metrics.bottomNav ? metrics.bottomNav.bottom <= item.height + 1 && metrics.bottomNav.top >= 0 : false;
    const noOverflow = metrics.scrollWidth <= item.width + 1;
    const finiteAnimations = metrics.animations.every((animation) => animation.iterations !== Infinity && (animation.duration === null || animation.duration <= 5000));
    const reducedMotionSafe = !item.reducedMotion || (metrics.animations.length === 0 || metrics.reducedMotion);
    const passed = !errors.length && noOverflow && visibleBottomNav && finiteAnimations && reducedMotionSafe && focusInside && sheetClosed && longTasks.every((duration) => duration < 250);
    results.push({ ...item, passed, errors, metrics, checks: { noOverflow, visibleBottomNav, finiteAnimations, reducedMotionSafe, focusInside, sheetClosed, longTasks: longTasks.map((duration) => Math.round(duration)) } });
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(resolve(artifactDir, "report.json"), JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
