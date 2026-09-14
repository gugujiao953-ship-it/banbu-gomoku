/* Verify the update-check feature end to end:
 *  1. a higher version on the update source → brand dot + bottom button dot + label
 *  2. no update → "已是最新版本"
 *  3. failing source → "检查失败"
 * The update source is intercepted, so this proves the pipeline without waiting
 * for a real release.
 * Usage: node design-lab/thinking-motion/verify-update-check.cjs */
const { chromium } = require("playwright");
const url = process.env.BANBU_URL || "http://localhost:5193/";

const HIGHER = JSON.stringify({ version: "99.0.0", tag: "v99.0.0", publishedAt: "2026-09-13T00:00:00Z", url: "https://example.com/releases/tag/v99.0.0" });
const SAME = JSON.stringify({ version: "1.0.0", tag: "v1.0.0", publishedAt: "2026-01-01T00:00:00Z", url: "https://example.com/releases/tag/v1.0.0" });
// route.fulfill() does not add CORS headers by itself; without them the app's
// cross-origin fetch is rejected and it silently falls through to the next source.
const CORS = { "access-control-allow-origin": "*" };

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

async function withScenario(title, handler, fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  if (handler) {
    await page.route("**/version.json", handler);
    await page.route("**/releases?per_page=20", handler);
  }
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3200);
  console.log(`\n--- ${title} ---`);
  await fn(page);
  if (errors.length) check(`${title} 无页面异常`, false, errors.join(" | "));
  await browser.close();
}

(async () => {
  /* 1. update available */
  await withScenario("有新版本", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: HIGHER }), async (page) => {
    const brand = await page.evaluate(() => ({
      dot: !!document.querySelector(".brand-trigger .update-dot"),
      hasUpdateClass: !!document.querySelector(".brand-trigger.has-update"),
      prompt: !!document.querySelector(".update-prompt, [class*='update-prompt']"),
    }));
    check("U1 启动检查后品牌按钮带红点", brand.dot, JSON.stringify(brand));

    await page.evaluate(() => document.querySelector('[aria-label^="打开快捷中心"]')?.click());
    await page.waitForTimeout(700);
    const btn = await page.evaluate(() => {
      const el = document.querySelector(".quick-update-button");
      if (!el) return null;
      return {
        text: el.textContent.replace(/\s+/g, " ").trim(),
        hasDot: !!el.querySelector(".update-dot"),
        hasUpdate: el.classList.contains("has-update"),
        disabled: el.disabled,
        isLast: (() => {
          const row = el.closest(".quick-drawer-update-row");
          const panel = document.querySelector(".quick-drawer-panel");
          if (!row || !panel) return null;
          const kids = [...panel.children];
          return kids[kids.length - 1] === row;
        })(),
      };
    });
    check("U2 快捷中心底部存在检查更新按钮", !!btn, btn ? btn.text : "未找到");
    check("U3 按钮在面板最下面", btn?.isLast === true, `isLast=${btn?.isLast}`);
    check("U4 按钮显示新版本并带红点", /发现新版本 v99\.0\.0/.test(btn?.text || "") && btn?.hasDot === true, `dot=${btn?.hasDot}`);
    check("U5 有新版本时按钮强调态", btn?.hasUpdate === true, `has-update=${btn?.hasUpdate}`);
  });

  /* 2. already latest */
  await withScenario("已是最新", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: SAME }), async (page) => {
    await page.evaluate(() => document.querySelector('[aria-label^="打开快捷中心"]')?.click());
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => {
      const el = document.querySelector(".quick-update-button");
      return { text: el?.textContent.replace(/\s+/g, " ").trim(), hasDot: !!el?.querySelector(".update-dot") };
    });
    check("U6 无更新时无红点", before.hasDot === false, `dot=${before.hasDot}`);
    check("U7 无更新时按钮是「检查更新」", /检查更新/.test(before.text || ""), before.text);
    await page.evaluate(() => document.querySelector(".quick-update-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => document.querySelector(".quick-update-button")?.textContent.replace(/\s+/g, " ").trim() || null);
    check("U8 手动检查后提示已是最新", /已是最新版本/.test(after || ""), after || "无");
  });

  /* 3. source failure */
  await withScenario("检查失败", (route) => route.fulfill({ status: 500, contentType: "text/plain", headers: CORS, body: "boom" }), async (page) => {
    await page.evaluate(() => document.querySelector('[aria-label^="打开快捷中心"]')?.click());
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector(".quick-update-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.querySelector(".quick-update-button")?.textContent.replace(/\s+/g, " ").trim() || null);
    check("U9 检查失败有明确提示", /检查失败/.test(text || ""), text || "无");
  });

  console.log(failed ? `\nRESULT: ${failed} failed` : "\nRESULT: all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
