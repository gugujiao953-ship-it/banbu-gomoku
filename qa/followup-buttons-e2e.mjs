// 「重新识别 / 补全识别」两颗新按钮的生产路径端到端（2026-10-09）。
//
// 走真实 UI：导入一张**只能读出部分序号**的图 → 核对屏点「复原手序-本地」→ 断言
//   ① 结果不完整时，核对屏确实多出「重新识别」「补全识别」两颗按钮；
//   ② 点「补全识别」后，读出的号**不比之前少**（补全只做加法），且若凑齐 1..N 就复原成功；
//   ③ 全过程无页面错误。
// 用 user-cno2010-15.jpg（整盘重读读出 12/15 → 触发这两颗按钮）。
//
// 用法：QA_BASE_URL=http://localhost:4173/ node qa/followup-buttons-e2e.mjs
import { chromium } from "playwright";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const fixture = resolve("qa/fixtures/materials/user-cno2010-15.jpg");

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
const errors = [];
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(`${error?.name || ""}:${error?.message || String(error)}`.slice(0, 200)));
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });

await page.locator("nav.bottom-nav button").filter({ hasText: "打谱" }).first().click();
await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
check("核对屏出现", true);

const readBefore = await page.evaluate(() => document.querySelectorAll("[data-verify-number]").length);
console.log(`  首次识别读出号（叠图数字个数）：${readBefore}`);

await page.locator("[data-local-restore]").click();
await page.waitForFunction(() => {
  const button = document.querySelector('[data-local-restore]');
  return button && !/读序中/.test(button.textContent || "");
}, { timeout: 240000 });
await page.waitForTimeout(1500);

const afterRestore = await page.evaluate(() => ({
  numbers: document.querySelectorAll("[data-verify-number]").length,
  reRestore: Boolean(document.querySelector('[data-re-restore]')),
  completeRestore: Boolean(document.querySelector('[data-complete-restore]')),
  note: document.querySelector(".image-verify-hint")?.textContent?.slice(0, 160) || "",
}));
console.log(`  复原后：读出 ${afterRestore.numbers} 个号；新按钮 重新识别=${afterRestore.reRestore} 补全识别=${afterRestore.completeRestore}`);
console.log(`  提示：${afterRestore.note}`);

// 只有「不完整」时才该出现这两颗按钮
const complete = await page.evaluate(() => Boolean(document.querySelector('[data-local-restore]')) && /复原第 1 手到第 \d+ 手/.test(document.querySelector(".image-verify-hint")?.textContent || ""));
if (!complete) {
  check("复原不完整时露出两颗续做按钮", afterRestore.reRestore && afterRestore.completeRestore, `re=${afterRestore.reRestore} complete=${afterRestore.completeRestore}`);

  // 先点「重新识别」：整盘重读应能跑完，读出数不应减少（这张图整盘读 12/15，按钮还留着）
  if (afterRestore.reRestore) {
    await page.locator('[data-re-restore]').click();
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-re-restore]');
      return button && !/重新读序号中/.test(button.textContent || "");
    }, { timeout: 300000 });
    await page.waitForTimeout(1500);
    const afterRe = await page.evaluate(() => ({
      numbers: document.querySelectorAll("[data-verify-number]").length,
      note: document.querySelector(".image-verify-hint")?.textContent?.slice(0, 120) || "",
    }));
    check("重新识别跑完且读出数不减少", afterRe.numbers >= afterRestore.numbers, `${afterRestore.numbers} → ${afterRe.numbers}`);
  }

  // 再点「补全识别」：读出数不应减少，且应最终复原成功（这张图真值 15 手）
  if (await page.locator('[data-complete-restore]').count()) {
    await page.locator('[data-complete-restore]').click();
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-complete-restore]');
      return button && !/补读缺号中/.test(button.textContent || "");
    }, { timeout: 300000 });
    await page.waitForTimeout(1500);
    const afterComplete = await page.evaluate(() => ({
      numbers: document.querySelectorAll("[data-verify-number]").length,
      note: document.querySelector(".image-verify-hint")?.textContent?.slice(0, 200) || "",
      followupGone: !document.querySelector('[data-re-restore]'),
    }));
    console.log(`  补全识别后：读出 ${afterComplete.numbers} 个号`);
    console.log(`  提示：${afterComplete.note}`);
    check("补全识别读出数不减少", afterComplete.numbers >= afterRestore.numbers, `${afterRestore.numbers} → ${afterComplete.numbers}`);
    check("补全识别后复原成功（15 手）", /复原第 1 手到第 15 手/.test(afterComplete.note), afterComplete.note.slice(0, 80));
    check("复原成功后续做按钮收起", afterComplete.followupGone === true, `gone=${afterComplete.followupGone}`);
  } else {
    check("补全识别按钮在位（补全前）", false, "补全前按钮已消失");
  }
} else {
  check("本次已完整复原（不需要续做按钮）", true, afterRestore.note.slice(0, 60));
}

check("无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failed ? `\n${failed} 项失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
