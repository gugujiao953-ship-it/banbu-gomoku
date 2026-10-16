/**
 * 棋魂弹窗的**旧内核适配门禁**（用户 2026-10-10：「看看适配性如何，能不能在旧安卓版本手机显示」）。
 *
 * ## 为什么需要单独一条
 *
 * 这两个弹窗（外观购买 `.soul-buy-*`、商店道具 `.vcfch-itemcard`）住在
 * `src/features/progress/soul-lockable.css` —— 那是**新内核取向**的文件，
 * 用了 `inset: 0`（Chrome 87+）和大量 `color-mix()`（Chrome 111+）。
 * 而本应用的兼容下限是 **Chrome 79**（群友 HLTE203T / Android 10），
 * 另一台实测机是 **WebView 83**（Redmi K20 Pro）。
 *
 * 关键是这两个特性**失效的方式不同**，而且都不会报错：
 *   · `inset: 0` 整个属性不认识 ⇒ 元素没有 left/right/top/bottom
 *     ⇒ 遮罩塌成"只在静态位置"，**盖不住视口**（本该全屏压暗 + 卡片居中）；
 *   · 声明里的 `color-mix()` ⇒ 解析期丢弃该声明（"良性失效"）
 *     ⇒ 卡片没有金色描边、价格胶囊没有底色、按钮按下没有反馈（像"点了没反应"）。
 *
 * 兜底写在 `src/legacy-webview.css`（由 `webview-compat.ts` 按 7 项能力探测加 `.legacy-webview`）。
 * 本门禁做两件事：
 *   ① 伪造一个"不认识这些特性"的 CSS.supports（与 `qa/action-opacity-legacy-check.mjs` 同一套手法），
 *      确认真的加上了 `.legacy-webview`；
 *   ② **把现代声明真的删掉**（模拟 83 的解析结果），再量弹窗 —— 这样看到的才是旧机上的实际画面，
 *      而不是"现代内核 + 加了个类"的假象。
 *
 * 用法：QA_BASE_URL="http://localhost:5199/" node qa/soul-dialog-legacy-check.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://localhost:4174/";
const url = BASE.includes("?") ? BASE : `${BASE}?qa=1`;

let failures = 0;
let checks = 0;
const check = (label, ok, detail = "") => {
  checks += 1;
  if (ok) process.stdout.write(`  ✓ ${label}${detail ? `（${detail}）` : ""}\n`);
  else { failures += 1; process.stdout.write(`  ✗ ${label}${detail ? `（${detail}）` : ""}\n`); }
};
const section = (title) => process.stdout.write(`\n${title}\n`);

const browser = await chromium.launch({ headless: true });

/** 把页面里"83 解析不了"的声明真的删掉 + 加 legacy 类（模拟老机的最终状态）。 */
const emulateChrome83 = () => {
  document.documentElement.classList.add("legacy-webview");
  let dropped = 0;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!rule.style) continue;
      for (const prop of [...rule.style]) {
        if (/color-mix\(|inset|dvh/.test(rule.style.getPropertyValue(prop))) {
          rule.style.removeProperty(prop);
          dropped += 1;
        }
      }
      // 选择器带 :is()/:where()/:has() ⇒ 整条规则被丢弃（CSS 规范，实测如此）
      if (/:is\(|:where\(|:has\(/.test(rule.selectorText || "")) { rule.style.cssText = ""; dropped += 1; }
    }
  }
  return dropped;
};

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-theme-preference-v1", "light");
  /* 只让 CSS.supports 说"我不支持"（触发应用自己加 legacy 类的那条路），
     真正的"声明被丢弃"由下面的 emulateChrome83 手工做 —— 无头 Chromium 本身
     仍然认识 color-mix，不这么做量到的就是假象。 */
  const real = CSS.supports.bind(CSS);
  CSS.supports = (...args) => {
    const first = String(args[0] || "");
    if (first.startsWith("selector(")) return false;
    if (first === "color" && String(args[1] || "").includes("color-mix")) return false;
    if (first === "height" && String(args[1] || "").includes("dvh")) return false;
    if (first === "inset") return false;
    return real(...args);
  };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

section("1. 兼容类真的加上了（应用自己的探测路径）");
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await page.waitForTimeout(1500);
check("老内核探测生效，加了 .legacy-webview",
  await page.evaluate(() => document.documentElement.classList.contains("legacy-webview")));

section("2. 模拟 83：把现代声明删掉，再看弹窗");
const dropped = await page.evaluate(emulateChrome83);
check("确实删掉了现代声明（说明这次模拟有意义）", dropped > 50, `${dropped} 条声明`);

// 打开外观购买弹窗（设置页 → 展开 details → 点锁徽章）
await page.locator(".bottom-nav button", { hasText: "设置" }).first().click();
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
await page.waitForTimeout(500);
const badge = page.locator(".soul-lock-badge.is-buy").first();
check("设置页有可购买的锁徽章", (await badge.count()) > 0);
await badge.click({ force: true });
await page.waitForSelector(".soul-buy-card", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(700);

const appearance = await page.evaluate(() => {
  const back = document.querySelector(".soul-buy-backdrop");
  const card = document.querySelector(".soul-buy-card");
  const price = document.querySelector(".soul-buy-price");
  const em = document.querySelector(".soul-buy-price em");
  const confirm = document.querySelector(".soul-buy-confirm");
  const flame = document.querySelector(".soul-buy-flame svg");
  if (!back || !card) return null;
  const br = back.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  return {
    covers: br.width >= window.innerWidth - 2 && br.height >= window.innerHeight - 2,
    position: getComputedStyle(back).position,
    border: getComputedStyle(card).borderColor,
    borderWidth: getComputedStyle(card).borderTopWidth,
    priceBg: getComputedStyle(price).backgroundColor,
    priceColor: getComputedStyle(em).color,
    priceSize: parseFloat(getComputedStyle(em).fontSize),
    cardW: Math.round(cr.width), cardH: Math.round(cr.height),
    flameW: flame ? Math.round(flame.getBoundingClientRect().width) : 0,
    confirmBg: getComputedStyle(confirm).backgroundColor,
    confirmColor: getComputedStyle(confirm).color,
  };
});
check("外观弹窗在老内核上能打开", appearance !== null);
if (appearance) {
  check("遮罩盖满视口（`inset` 失效时靠四边兜底）", appearance.covers,
    `${appearance.position} 覆盖=${appearance.covers}`);
  check("卡片仍有边框（不是「没样式」）", appearance.borderWidth !== "0px", appearance.border);
  check("卡片边框仍是金色系（兜底纯色，不是黑灰）",
    /^(rgb)?\(?21[0-9]|rgb\(216, 195, 154\)/.test(String(appearance.border)) || appearance.border.includes("216"),
    String(appearance.border));
  check("价格胶囊仍有底色（color-mix 失效时的 rgba 兜底）",
    !/rgba\(0, 0, 0, 0\)/.test(appearance.priceBg), appearance.priceBg);
  check("价格数字仍有颜色（且不是被压成灰）",
    !/185, 178, 167/.test(appearance.priceColor), appearance.priceColor);
  check("价格数字大小正常（字号没丢）", appearance.priceSize >= 19, `${appearance.priceSize}px`);
  check("魂火图案仍是大尺寸（≥44px）", appearance.flameW >= 44, `${appearance.flameW}px`);
  check("卡片宽度正常、没溢出屏幕", appearance.cardW <= 390 && appearance.cardW >= 260,
    `${appearance.cardW}×${appearance.cardH}`);
  check("「解锁」按钮有金底（color-mix 失效时的纯色兜底）",
    !/rgba\(0, 0, 0, 0\)/.test(appearance.confirmBg), appearance.confirmBg);
}

section("3. 商店道具弹窗（另一个棋魂弹窗）同样适配");
await page.keyboard.press("Escape").catch(() => {});
await page.evaluate(() => {
  const close = document.querySelector(".soul-buy-close");
  if (close) close.click();
});
await page.waitForTimeout(400);
await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
await page.waitForTimeout(700);
await page.locator("[data-shop-badge]").first().click();
await page.waitForSelector("[data-shop-panel]", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
await page.locator("[data-shop-item='hint']").click();
await page.waitForSelector("[data-shop-buy='hint']", { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);

const itemDialog = await page.evaluate(() => {
  const back = document.querySelector(".vcfch-itemback");
  const card = document.querySelector("[data-shop-buy='hint']");
  const price = document.querySelector(".vcfch-itemcard-price");
  const em = document.querySelector(".vcfch-itemcard-price em");
  const confirm = document.querySelector(".vcfch-itemcard-actions .soul-buy-confirm");
  if (!back || !card) return null;
  const br = back.getBoundingClientRect();
  return {
    covers: br.width >= window.innerWidth - 2 && br.height >= window.innerHeight - 2,
    border: getComputedStyle(card).borderColor,
    borderWidth: getComputedStyle(card).borderTopWidth,
    priceBg: getComputedStyle(price).backgroundColor,
    priceColor: getComputedStyle(em).color,
    confirmBg: getComputedStyle(confirm).backgroundColor,
    // 视觉上没写"棋魂"两个字（sr-only 不算）
    visiblePrice: (() => {
      const clone = price.cloneNode(true);
      clone.querySelectorAll(".soul-sr-only").forEach((n) => n.remove());
      return (clone.textContent || "").trim();
    })(),
  };
});
check("道具弹窗在老内核上能打开", itemDialog !== null);
if (itemDialog) {
  check("遮罩盖满视口", itemDialog.covers);
  check("卡片仍有边框", itemDialog.borderWidth !== "0px", itemDialog.border);
  check("价格胶囊仍有底色", !/rgba\(0, 0, 0, 0\)/.test(itemDialog.priceBg), itemDialog.priceBg);
  check("价格数字仍有颜色", !/185, 178, 167/.test(itemDialog.priceColor), itemDialog.priceColor);
  check("「买一个」按钮有金底", !/rgba\(0, 0, 0, 0\)/.test(itemDialog.confirmBg), itemDialog.confirmBg);
  check("价格行也没写「棋魂」二字", !itemDialog.visiblePrice.includes("棋魂"),
    `可见文字「${itemDialog.visiblePrice}」`);
}

section("4. 运行期");
check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
process.stdout.write(`\n${failures === 0 ? "全部通过" : "有失败"}：${checks - failures}/${checks} 项检查通过。\n`);
if (failures > 0) process.exit(1);
