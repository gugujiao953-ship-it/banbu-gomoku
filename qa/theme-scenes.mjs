/** Shared theme scenes: responsive composition, loading, motion and app integration.
 * node qa/theme-scenes.mjs [http://127.0.0.1:4370/]
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:4370/";
const previewBase = new URL("theme-preview.html", base).href;
const out = "artifacts/theme-refresh-20261013";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const sizes = [[390, 844], [844, 390], [820, 1180], [1180, 820], [1440, 900], [320, 568], [568, 320]];
const metrics = [];

async function loadBackgrounds(page) {
  const failures = await page.evaluate(async () => {
    const urls = new Set();
    document.querySelectorAll(".theme-scene *").forEach((el) => {
      [undefined, "::before", "::after"].forEach((pseudo) => {
        for (const match of getComputedStyle(el, pseudo).backgroundImage.matchAll(/url\(["']?([^"')]+)/g)) urls.add(match[1]);
      });
    });
    return (await Promise.all([...urls].map(async (src) => {
      const img = new Image(); img.src = src;
      try { await img.decode(); return null; } catch { return src; }
    }))).filter(Boolean);
  });
  assert.deepEqual(failures, [], "All scene assets must decode");
}

try {
  const context = await browser.newContext({ serviceWorkers:"block" });
  await context.addInitScript(() => {
    localStorage.setItem("banbu-theme-preference-v1", "porcelain");
    localStorage.setItem("banbu-theme-motion-v1", "off");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.url().includes("theme-assets/") && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  for (const theme of ["pelican", "dunhuang", "soul"]) {
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.goto(`${previewBase}?theme-preview=${theme}&bare`);
      await page.locator(".theme-scene").waitFor();
      await loadBackgrounds(page);
      const bounds = await page.locator(".theme-scene").boundingBox();
      assert.deepEqual(bounds, { x:0, y:0, width, height });
      assert.equal(await page.locator(".app-shell,.bottom-nav,.dock-tabs").count(), 0);
      const item = await page.locator(theme === "pelican" ? ".ts-ride" : theme === "soul" ? ".ts-mid" : ".ts-sway b:first-child").boundingBox();
      assert(item.width > 120 && item.height > 60);
      if (theme === "pelican") {
        assert(item.x >= -1 && item.x + item.width <= width + 1, "The rider stays within the frame");
        assert.equal(await page.locator(".tr-body > svg").count(), 1, "Pelican body renders with the rig");
        assert(Math.abs(item.width / item.height - 430 / 264) < .005, "The rig is never stretched");
        const ground = await page.locator(".ts-ride").evaluate((el) => {
          const style = getComputedStyle(el, "::before");
          const rect = el.getBoundingClientRect();
          return { left: rect.x + parseFloat(style.left) + parseFloat(style.marginLeft), width:parseFloat(style.width) };
        });
        assert(Math.abs(ground.left) < 1 && Math.abs(ground.width - width) < 1, "The road spans the viewport");
      }
      const selector = theme === "pelican" ? ".tr-body" : theme === "soul" ? ".ts-mid" : ".ts-sway b:first-child";
      const before = await page.locator(selector).evaluate((el) => getComputedStyle(el).transform);
      await page.waitForTimeout(150);
      const after = await page.locator(selector).evaluate((el) => getComputedStyle(el).transform);
      assert.notEqual(before, after, "Decorative animation runs");
      await page.evaluate(() => { document.documentElement.dataset.themeMotion = "off"; });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator(selector).evaluate((el) => getComputedStyle(el).animationPlayState), "paused");
      const frozen = await page.locator(selector).evaluate((el) => getComputedStyle(el).transform);
      await page.waitForTimeout(150);
      const frozenAfter = await page.locator(selector).evaluate((el) => getComputedStyle(el).transform);
      const matrix = (value) => (value.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/g) ?? []).map(Number);
      assert(matrix(frozen).every((value, i) => Math.abs(value - matrix(frozenAfter)[i]) < .001), `Theme motion off pauses ${theme} ${width}x${height}: ${frozen} / ${frozenAfter}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
      metrics.push({ theme, width, height, subject:item });
      await page.screenshot({ path:`${out}/${theme}-${width}x${height}-after.png` });
    }
  }
  await page.setViewportSize({ width:1280, height:920 });
  await page.goto(`${previewBase}?theme-preview=pelican`);
  await page.locator('iframe[data-ready="true"]').waitFor();
  await page.getByRole("button", { name:"飞天敦煌", exact:true }).click();
  await page.locator('iframe[data-ready="true"][src*="dunhuang"]').waitFor();
  await page.getByRole("combobox", { name:"画幅尺寸" }).selectOption("landscape");
  await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow?.innerWidth === 844);
  await page.getByRole("button", { name:"动效开", exact:true }).click();
  await page.locator('iframe[data-ready="true"][src*="motion=off"]').waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem("banbu-theme-preference-v1"), localStorage.getItem("banbu-theme-motion-v1")]), ["porcelain", "off"], "Preview must preserve saved settings");
  await page.screenshot({ path:`${out}/studio-after.png` });
  await page.getByRole("button", { name:"棋魂", exact:true }).click();
  await page.locator('iframe[data-ready="true"][src*="soul"]').waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  // The whole ribbon, including both tapered ends, fits inside its source image.
  for (const asset of ["dunhuang-silk.svg", "dunhuang-silk-fine.svg"]) {
    const painted = await page.evaluate(async (name) => {
      const text = await (await fetch(`/theme-assets/${name}`)).text();
      const svg = new DOMParser().parseFromString(text,"image/svg+xml").documentElement;
      document.body.append(svg);
      const view = svg.viewBox.baseVal;
      const okay = [...svg.querySelectorAll("path")].filter((el) => !el.closest("defs")).every((el) => {
        const r = el.getBBox();
        return r.x > 1 && r.y > 1 && r.x + r.width < view.width - 1 && r.y + r.height < view.height - 1;
      });
      svg.remove();
      return okay;
    }, asset);
    assert(painted, `${asset} must not truncate a ribbon`);
  }
  await context.close();

  // Existing application: the stored theme, real board, navigation and controls coexist.
  for (const theme of ["pelican", "dunhuang", "soul"]) {
    const appContext = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:"block" });
    await appContext.addInitScript((id) => {
      localStorage.setItem("banbu-theme-preference-v1", id);
      localStorage.setItem("banbu-first-run-welcome-v1", "true");
      localStorage.setItem("banbu-board-theme-v1", id === "dunhuang" ? "dh-feitian" : id === "soul" ? "soul-inkflame" : "wood");
    }, theme);
    const app = await appContext.newPage();
    app.on("pageerror", (e) => errors.push(e.message));
    await app.goto(`${base}?qa=1`);
    await app.locator(".app-shell").waitFor();
    await app.waitForFunction((id) => document.documentElement.dataset.theme === id, theme);
    await loadBackgrounds(app);
    assert.equal(await app.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
    if (theme === "pelican") assert.equal(await app.locator(".tr-body > svg").count(), 1);
    await app.screenshot({ path:`${out}/${theme}-app-portrait-after.png` });
    await app.setViewportSize({ width:844, height:390 });
    if (theme === "pelican") {
      // The compact workspace must leave the pelican's head below its move buttons.
      for (const legacy of [false, true]) {
        await app.evaluate((flag) => document.documentElement.classList.toggle("legacy-webview", flag), legacy);
        for (const [width, height] of [[390,844], [844,390]]) {
          await app.setViewportSize({ width, height });
          await app.evaluate(() => { document.documentElement.dataset.themeMotion = "off"; });
          await app.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const clear = await app.evaluate(() => {
            const head = document.querySelector('.tr-body svg > path[d^="M274 87"]').getBoundingClientRect();
            const controls = [...document.querySelectorAll(".moves-row")].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
            return controls.every((r) => head.top >= r.bottom);
          });
          assert(clear, `Pelican head must stay below move buttons at ${width}x${height}, legacy CSS ${legacy}`);
        }
      }
      await app.evaluate(() => document.documentElement.classList.remove("legacy-webview"));
      await app.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await app.screenshot({ path:`${out}/${theme}-app-landscape-after.png` });
    await app.reload();
    await app.waitForFunction((id) => document.documentElement.dataset.theme === id, theme);
    await appContext.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/responsive-results.json`, JSON.stringify(metrics, null, 2));
  console.log(`PASS: ${metrics.length} theme / viewport combinations, animation on/off, preview controls, saved settings and application reload.`);
} finally {
  await browser.close();
}
