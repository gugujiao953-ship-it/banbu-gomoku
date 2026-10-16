/**
 * qa/duel-subview-nav.mjs — 「对弈」子页面（VCF 挑战 / 人机对战）的版面保持、返回层级、
 * 退出确认与切后台暂停（用户 2026-10-06 四条原话的黑盒门禁）。
 *
 * 覆盖：
 *  ① 进 VCF → 切「棋谱库」→ 切回「对弈」：仍在 VCF（题目/局面还在、计时接着走、不是首页）。
 *  ② 人机对局中途切 tab 再回来：仍是那盘（标题手数与盘上棋子都不变）。
 *  ③ VCF 对局中按返回（左上角按钮 + 系统返回）：先出应用内确认弹窗；
 *     「继续挑战」留在原地、「退出」回到对弈首页；人机对战时系统返回回到对弈首页（而不是打谱）。
 *  ④ 对局中触发 visibilitychange 隐藏 1.2s 再显示：计时没有少（前后剩余秒数对比）、
 *     暂停状态可见、回前台有「从暂停处继续」提示。
 *
 * 用法：node qa/duel-subview-nav.mjs（QA_BASE_URL 可直接覆盖；默认 5173）
 */
import { chromium } from "playwright";

const rawBase = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
// 首运行欢迎页按版本号记「已读」，写死 "true" 已经不管用了；统一用 ?qa=1 抑制
// （qa runner 也会追加，这里兜住直接运行的情况）。
const baseURL = (() => {
  const url = new URL(rawBase);
  if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
  return url.toString();
})();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(20_000);
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

const results = [];
let failed = 0;
const assert = (ok, name, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const clickNav = (label) => page.evaluate((text) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const button = nav ? Array.from(nav.querySelectorAll("button")).find((item) => (item.textContent || "").trim() === text) : null;
  if (button) { button.click(); return true; }
  return false;
}, label);

/** After a back press consumes the root sentinel, the app re-arms it after the exit window. */
const waitReArm = () => page.waitForTimeout(2_400);

/** VCF 的「可见」判定要穿透 App 的隐藏容器：隐藏时祖先 div[hidden] 会是它的 closest。 */
const vcfVisible = () => page.evaluate(() => {
  const root = document.querySelector(".vcfch-page");
  if (!root) return false;
  const hiddenAncestor = root.closest("[hidden]");
  return !hiddenAncestor && getComputedStyle(root).display !== "none";
});
const vcfSeconds = () => page.evaluate(() => {
  const el = document.querySelector(".vcfch-clock b");
  const value = el ? Number((el.textContent || "").trim()) : NaN;
  return Number.isFinite(value) ? value : null;
});
const vcfSnapshot = () => page.evaluate(() => ({
  meta: document.querySelector(".vcfch-meta")?.textContent?.replace(/\s+/g, " ").trim() || null,
  stones: document.querySelectorAll("[data-vcf-stone]").length,
  primary: document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() || null,
  paused: document.querySelector(".vcfch-page")?.getAttribute("data-vcf-paused") || null,
  message: document.querySelector(".vcfch-message")?.textContent?.replace(/\s+/g, " ").trim() || null,
}));
const duelVisible = () => page.evaluate(() => !!document.querySelector(".duel-page") && !document.querySelector(".duel-page")?.closest("[hidden]"));
const duelScreenStones = () => page.evaluate(() => [...document.querySelectorAll("[data-duel-screen] .board-hit")]
  .filter((hit) => (hit.getAttribute("aria-label") || "").includes("已有棋子")).length);
const duelTitle = () => page.evaluate(() => document.querySelector("[data-duel-title]")?.textContent?.replace(/\s+/g, " ").trim() || null);
const recordPageVisible = () => page.evaluate(() => !!document.querySelector(".record-page") && !document.querySelector(".record-page")?.closest("[hidden]"));

/** 切后台/回前台：Chromium 下 document.hidden 可被实例属性遮蔽，再发标准 visibilitychange。 */
const setVisibility = (hidden) => page.evaluate((nextHidden) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => nextHidden });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (nextHidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);

try {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 25_000 });
  await page.locator(".renju-board").waitFor();
  await page.waitForTimeout(300);

  // ── 进入 VCF 并真的开一局（默认档位的 1-2 手题在题池里，不必等生成器） ──────────
  await clickNav("对弈");
  await page.locator(".duel-page").waitFor();
  await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
  await page.locator(".vcfch-board").waitFor({ timeout: 25_000 });

  // 待开始（还没点「开始挑战」）：返回不该拦，直接回对弈首页、也不出现退出确认。
  await page.goBack();
  await page.waitForTimeout(400);
  assert(!(await page.locator('[role="dialog"][aria-label="退出 VCF 挑战？"]').count()) && await duelVisible(),
    "③f 待开始状态下返回不弹确认，直接回对弈首页", JSON.stringify({ duel: await duelVisible() }));
  await waitReArm();
  await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
  await page.locator(".vcfch-board").waitFor({ timeout: 25_000 });
  await page.locator(".vcfch-bottom .vcfch-primary").click();
  await page.waitForFunction(() => (document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent || "").includes("认输"), null, { timeout: 25_000 });
  await page.waitForTimeout(300);

  const opened = await vcfSnapshot();
  assert(opened.primary === "认输（判负）", "VCF 开局后进入计时中（主按钮变成认输）", JSON.stringify(opened));
  const startedSeconds = await vcfSeconds();
  assert(startedSeconds !== null && startedSeconds > 0, "开局后倒计时在走", String(startedSeconds));

  // 等几秒，让「计时继续 / 计时重建」能区分开（重建会回到满额 45）。
  await page.waitForTimeout(3_000);
  const beforeSwitch = await vcfSnapshot();
  const beforeSwitchSeconds = await vcfSeconds();

  // ── ① 切「棋谱库」再切回「对弈」：仍在 VCF，题目/局面/计时都在 ──────────────
  await clickNav("棋谱库");
  await page.locator(".library-page").waitFor();
  await page.waitForTimeout(1_200);
  assert(!(await vcfVisible()), "①a 切到棋谱库后 VCF 整块隐藏（但保持挂载）");
  await clickNav("对弈");
  await page.waitForTimeout(500);
  const afterReturn = await vcfSnapshot();
  const afterReturnSeconds = await vcfSeconds();
  assert(await vcfVisible(), "①b 切回对弈仍在 VCF 页面（没有退回对弈首页）", JSON.stringify({ visible: await vcfVisible(), duel: await duelVisible() }));
  assert(!(await duelVisible()), "①c 对弈首页没有盖在 VCF 上面");
  assert(afterReturn.meta === beforeSwitch.meta && afterReturn.stones === beforeSwitch.stones, "①d 题目与盘上局面原样还在",
    JSON.stringify({ before: beforeSwitch.meta, after: afterReturn.meta, stones: `${beforeSwitch.stones}→${afterReturn.stones}` }));
  assert(afterReturn.primary === "认输（判负）", "①e 还是同一局（计时中），没有变成待开始");
  assert(afterReturnSeconds !== null && afterReturnSeconds < startedSeconds && afterReturnSeconds <= beforeSwitchSeconds,
    "①f 计时接着走（没有重建回满额、也没有偷偷多给）",
    JSON.stringify({ startedSeconds, beforeSwitchSeconds, afterReturnSeconds }));

  // ── ④ 切后台 1.2s：计时暂停、不判负、回前台有提示 ──────────────────────────
  const beforeHide = await vcfSeconds();
  const wallStart = Date.now();
  await setVisibility(true);
  await page.waitForTimeout(350);
  // 冻结状态取两次读数：暂停住的话这两次必须**完全相等**（不暂停时 1.2s 至少掉 1 格，
  // 这是比"前后各取一次"更确定的判据——不受秒边界抖动影响）。
  const hiddenA = await vcfSeconds();
  const hiddenState = await vcfSnapshot();
  assert(hiddenState.paused === "1", "④a 隐藏期间进入「计时暂停」状态", JSON.stringify({ paused: hiddenState.paused, message: hiddenState.message }));
  await page.waitForTimeout(1_200);
  const hiddenB = await vcfSeconds();
  assert(hiddenA !== null && hiddenB === hiddenA,
    "④b 后台这 1.2 秒剩余秒数一格没动", JSON.stringify({ hiddenA, hiddenB, message: hiddenState.message }));
  await setVisibility(false);
  await page.waitForTimeout(450);
  const resumed = await vcfSnapshot();
  assert((resumed.message || "").includes("计时从暂停处继续"), "④c 回前台提示「计时从暂停处继续」", String(resumed.message));
  const afterShow = await vcfSeconds();
  const wallMs = Date.now() - wallStart;
  assert(afterShow !== null && beforeHide !== null && beforeHide - afterShow <= 1,
    "④d 隐藏+恢复一圈后剩余秒数没有少（≠ 直接扣掉后台时间）",
    JSON.stringify({ beforeHide, afterShow, wallMs }));
  assert(afterShow !== null && afterShow < startedSeconds, "④e 暂停没有把整局时间重置", JSON.stringify({ startedSeconds, afterShow }));

  // ── ③ 返回适配：左上角返回 → 确认弹窗 → 继续挑战留在原地 → 退出回对弈首页 ────
  await page.locator("[data-vcf-back]").click();
  const exitDialog = page.getByRole("dialog", { name: "退出 VCF 挑战？" });
  await exitDialog.waitFor({ timeout: 5_000 });
  const dialogCopy = await page.locator("[data-vcf-exit-copy]").textContent();
  assert(/作废|不计分/.test(dialogCopy || ""), "③a 左上角返回弹出应用内确认，说明本局会作废", String(dialogCopy));
  await page.locator("[data-vcf-exit-keep]").click();
  await exitDialog.waitFor({ state: "detached" });
  await page.waitForTimeout(250);
  const kept = await vcfSnapshot();
  assert(await vcfVisible() && kept.meta === beforeSwitch.meta && kept.primary === "认输（判负）",
    "③b 点「继续挑战」留在原地、还是那一局", JSON.stringify(kept));

  await page.goBack();
  await exitDialog.waitFor({ timeout: 5_000 });
  assert(await vcfVisible(), "③c 系统返回也先弹确认，而不是直接退到打谱或离开挑战");
  await page.locator("[data-vcf-exit-leave]").click();
  await exitDialog.waitFor({ state: "detached" });
  await page.waitForTimeout(400);
  assert(!(await vcfVisible()) && await duelVisible(), "③d 点「退出」回到对弈首页", JSON.stringify({ vcf: await vcfVisible(), duel: await duelVisible() }));
  assert(!(await recordPageVisible()), "③e 退出挑战没有直接跳去打谱页");

  // ── ② 人机对战：中途切 tab 再回来仍是那盘；返回回到对弈首页 ─────────────────
  await waitReArm();
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.locator(".ai-game-setup").waitFor({ timeout: 10_000 });
  await page.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
  await page.locator("[data-duel-screen]").waitFor({ timeout: 15_000 });
  await page.getByRole("gridcell", { name: /^H8空位/ }).click();
  await page.waitForTimeout(600);
  const beforeTabSwitch = { title: await duelTitle(), stones: await duelScreenStones() };
  assert((beforeTabSwitch.stones || 0) >= 1, "②a 人机对局落下一手", JSON.stringify(beforeTabSwitch));

  await clickNav("棋谱库");
  await page.locator(".library-page").waitFor();
  await page.waitForTimeout(900);
  await clickNav("对弈");
  await page.locator("[data-duel-screen]").waitFor();
  await page.waitForTimeout(400);
  const afterTabSwitch = { title: await duelTitle(), stones: await duelScreenStones() };
  assert(afterTabSwitch.title === beforeTabSwitch.title && afterTabSwitch.stones === beforeTabSwitch.stones,
    "②b 切 tab 再回来仍是那一盘（标题手数与盘上棋子都不变）", JSON.stringify({ before: beforeTabSwitch, after: afterTabSwitch }));

  await waitReArm();
  await page.goBack();
  await page.waitForTimeout(500);
  assert(await duelVisible() && !(await page.locator("[data-duel-screen]").count()),
    "②c 人机对战中按系统返回 → 回到对弈首页（没有跳到打谱）", JSON.stringify({ duel: await duelVisible(), record: await recordPageVisible() }));
  assert(!(await recordPageVisible()), "②d 返回人机对战后不在打谱页");

  if (errors.length) throw new Error(`页面错误：\n${errors.join("\n")}`);
  console.log(JSON.stringify({ pass: true, results }, null, 2));
} catch (error) {
  console.error(`FAIL 脚本中断：${error instanceof Error ? error.message : String(error)}`);
  if (errors.length) console.error(errors.join("\n"));
  failed = failed || 1;
} finally {
  // 这台机器上 Playwright 关浏览器偶发挂住（qa/vcf-flow-sweep.mjs 也踩过），加个上限。
  await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 4_000))]);
}
process.exit(failed ? 1 : 0);
