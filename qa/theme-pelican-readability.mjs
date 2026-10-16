/** Sunset theme regression: compare text with the rendered background behind it.
 * Hiding the labels for one screenshot includes scene gradients and translucent
 * cards in the measurement, rather than assuming the root background is solid.
 * node qa/theme-pelican-readability.mjs [http://127.0.0.1:4373/]
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:4373/";
const appUrl = new URL(base); appUrl.searchParams.set("qa", "1");
const output = "artifacts/pelican-readability-20261013";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const failures = [];
const errors = [];

try {
  for (const [width, height] of [[390, 844], [844, 390], [1180, 820]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    await context.addInitScript(() => {
      localStorage.setItem("banbu-theme-preference-v1", "pelican");
      localStorage.setItem("banbu-theme-motion-v1", "off");
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(appUrl.href);
    await page.locator(".app-shell").waitFor();
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important} [data-tempdiag],.achievement-unlock,.soul-gain{visibility:hidden!important}" });

    async function check(state, selector) {
      const targets = page.locator(selector);
      await targets.first().waitFor({ state: "visible" });
      assert(await targets.count() > 0, `${state}: missing ${selector}`);
      await targets.filter({ visible: true }).first().evaluate(el => {
        const r = el.getBoundingClientRect();
        const nav = document.querySelector(".bottom-nav").getBoundingClientRect();
        const bottom = nav.width > nav.height ? nav.top : innerHeight;
        if (r.top < 68 || r.bottom > bottom) el.scrollIntoView({ block: "center", inline: "nearest" });
      });
      const labels = await targets.evaluateAll((elements) => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const labels = [];
        for (const [index, el] of elements.entries()) {
          const range = document.createRange(); range.selectNodeContents(el);
          // Range rectangles include text clipped by ellipsis. Intersect them
          // with every scrolling/overflow ancestor before sampling the image.
          const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
          for (let node = el; node; node = node.parentElement) {
            const cs = getComputedStyle(node), bounds = node.getBoundingClientRect();
            if (cs.overflowX !== "visible") { clip.left = Math.max(clip.left, bounds.left); clip.right = Math.min(clip.right, bounds.right); }
            if (cs.overflowY !== "visible") { clip.top = Math.max(clip.top, bounds.top); clip.bottom = Math.min(clip.bottom, bounds.bottom); }
          }
          const rects = [...range.getClientRects()].map(r => {
            const x = Math.max(clip.left, r.left), y = Math.max(clip.top, r.top);
            return { x, y, width: Math.min(clip.right, r.right) - x, height: Math.min(clip.bottom, r.bottom) - y };
          }).filter(r => r.width > 2 && r.height > 2);
          if (!rects.length || getComputedStyle(el).visibility !== "visible") continue;
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(el).color; ctx.fillRect(0, 0, 1, 1);
          labels.push({ index, text: el.textContent.trim(), foreground: [...ctx.getImageData(0, 0, 1, 1).data], rects });
          el.dataset.qaContrastTarget = index;
          // Preserve the original inline attributes for the subsequent UI checks.
          for (const node of [el, ...el.querySelectorAll("*")]) {
            node.dataset.qaOriginalStyle = node.getAttribute("style") ?? "";
            node.style.setProperty("color", "transparent", "important");
            node.style.setProperty("text-shadow", "none", "important");
          }
        }
        return labels;
      });
      assert(labels.length > 0, `${state}: no visible text for ${selector}`);
      let measured;
      try {
        const background = await page.screenshot();
        measured = await page.evaluate(async ({ labels, png }) => {
          const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
          const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
          const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
          return labels.map(label => {
            let minimum = Infinity;
            const el = document.querySelector(`[data-qa-contrast-target="${label.index}"]`);
            for (const r of label.rects) {
              for (let y = Math.ceil(r.y + 1); y < r.y + r.height - 1; y += 2) {
                for (let x = Math.ceil(r.x + 1); x < r.x + r.width - 1; x += 2) {
                  // Fixed navigation and thumbnail badges can cover part of a
                  // label. Measure the part the user can actually see.
                  const hit = document.elementFromPoint(x, y);
                  if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
                  const offset = (y * img.width + x) * 4;
                  const bg = [...pixels.slice(offset, offset + 3)];
                  const fg = label.foreground.slice(0, 3).map((v, i) => v * label.foreground[3] / 255 + bg[i] * (1 - label.foreground[3] / 255));
                  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
                  minimum = Math.min(minimum, (hi + .05) / (lo + .05));
                }
              }
            }
            return { text: label.text, contrast: +minimum.toFixed(2) };
          });
        }, { labels, png: background.toString("base64") });
      } finally {
        await page.evaluate(() => document.querySelectorAll("[data-qa-original-style]").forEach(el => {
          const value = el.dataset.qaOriginalStyle; if (value) el.setAttribute("style", value); else el.removeAttribute("style");
          delete el.dataset.qaOriginalStyle;
        }));
        await page.evaluate(() => document.querySelectorAll("[data-qa-contrast-target]").forEach(el => delete el.dataset.qaContrastTarget));
      }
      for (const item of measured) {
        if (!Number.isFinite(item.contrast)) continue;
        results.push({ size: `${width}x${height}`, state, ...item });
        if (item.contrast < 4.5) failures.push(`${width}x${height} ${state} ${item.text}: ${item.contrast}:1`);
      }
      assert(measured.some(item => Number.isFinite(item.contrast)), `${state}: all labels are occluded`);
    }

    await page.locator(".bottom-nav").getByRole("button", { name: "棋谱库", exact: true }).click();
    await check("顶栏", ".topbar .brand b");
    await check("最近棋谱标题", ".research-overview-heading b");
    await page.getByRole("button", { name: "展开最近棋谱", exact: true }).click();
    await check("展开的最近棋谱", ".recent-research-list b,.recent-research-list small");
    await check("筛选说明", ".record-filter-note");
    await check("木色缩略图", ".mini-board > span");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/library-${width}x${height}.png` });

    await page.locator(".bottom-nav").getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("搜索设置").fill("本机");
    await check("存储状态", ".storage-summary-heading em");
    await check("存储说明", ".storage-summary p");
    await page.screenshot({ path: `${output}/storage-${width}x${height}.png` });

    await page.locator(".bottom-nav").getByRole("button", { name: "导入", exact: true }).click();
    await page.locator(".bottom-sheet").waitFor();
    await check("导入标题", ".bottom-sheet .sheet-head h2");
    await check("导入选项", ".bottom-sheet .import-choice b,.bottom-sheet .import-choice small");
    await page.locator(".bottom-sheet .sheet-head button").first().click();
    await page.getByRole("button", { name: "打开快捷中心" }).click();
    await page.getByRole("dialog", { name: "快捷中心" }).waitFor();
    await check("快捷中心", ".quick-drawer-head b,.quick-drawer-head small");
    await context.close();
  }
  writeFileSync(`${output}/contrast.json`, JSON.stringify({ results, failures, errors }, null, 2));
  assert.deepEqual(errors, [], "No browser errors");
  assert.deepEqual(failures, [], "Text must retain at least 4.5:1 contrast against the rendered background");
  console.log(`PASS: ${results.length} rendered text checks across phone portrait, phone landscape and tablet landscape.`);
} finally {
  await browser.close();
}
