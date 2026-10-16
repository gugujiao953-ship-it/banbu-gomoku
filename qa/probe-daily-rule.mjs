/**
 * 探针（2026-10-12）：每日一题的规则默认值。
 *
 * 用户要求（原话）：「不用切换有无禁，默认就有禁吧，但是不是全局生效，就这个生效。」
 *
 * 所以这里验两件事：
 *  ① 不设任何偏好时，每日一题里**三三禁手点必须被拒绝**（默认有禁手）；
 *  ② 就算把「打谱 → 做题」的全局偏好设成**无禁手**，每日一题**仍然**按有禁手判
 *     —— 证明它只作用于自己；同时验证每日一题**没有去写**那个偏好键。
 *
 * 题目：黑先（玩家执黑），黑在 (7,5)(7,6) 与 (5,7)(6,7)，落 (7,7) 会同时形成两条活三。
 *
 * 用法：QA_BASE_URL=http://localhost:5196/?qa=1 node qa/probe-daily-rule.mjs
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5196/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const pad = (v) => String(v).padStart(2, "0");
const dateKey = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const PREF_KEY = "banbu-puzzle-rule-preference-v1";

const seeded = {
  collections: [{
    id: "probe-daily", title: "探针题集", source: "探针", license: "探针",
    puzzles: [{
      id: "probe-black-33", title: "黑先·三三禁手点", prompt: "黑先胜", difficulty: 3, player: "black",
      stones: [
        { row: 7, col: 5, player: "black" }, { row: 7, col: 6, player: "black" },
        { row: 5, col: 7, player: "black" }, { row: 6, col: 7, player: "black" },
      ],
    }],
  }],
  progress: { "probe-daily/probe-black-33": { solved: false, attempts: 1, updatedAt: `${dateKey(-1)}T10:00:00.000Z` } },
};

const run = async (browser, preference) => {
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript(([seed, pref]) => {
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify(seed.collections));
    localStorage.setItem("renju-note-puzzle-progress-v1", JSON.stringify(seed.progress));
    if (pref) localStorage.setItem("banbu-puzzle-rule-preference-v1", pref);
  }, [seeded, preference]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.waitForTimeout(800);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
  await page.waitForTimeout(400);
  await page.locator("[data-duel-daily-start]").click();
  await page.waitForSelector(".dailyp-page", { timeout: 20000 });
  await page.waitForTimeout(700);

  const side = (await page.locator(".dailyp-side-chip").textContent().catch(() => "")) || "";
  const boardBox = await page.locator(".dailyp-board").boundingBox();
  const clickCell = async (row, col) => {
    const size = 15, margin = 34, cell = (572 - margin * 2) / (size - 1);
    await page.mouse.click(
      boardBox.x + ((margin + col * cell) / 572) * boardBox.width,
      boardBox.y + ((margin + row * cell) / 572) * boardBox.height,
    );
    await page.waitForTimeout(250);
  };
  const stones = () => page.evaluate(() => document.querySelectorAll("[data-dailyp-stone]").length);
  const hint = () => page.locator("[data-dailyp-hint]").textContent().catch(() => "");
  const prefAfter = await page.evaluate((key) => localStorage.getItem(key), PREF_KEY);

  const before = await stones();
  await clickCell(7, 7);
  await page.waitForTimeout(400);
  const after = await stones();
  const text = (await hint()) || "";
  await context.close();
  return {
    preference: preference || "(未设置)",
    side: side.trim(),
    rejected: after === before,
    after,
    hint: text.trim(),
    prefAfter,
  };
};

const browser = await chromium.launch({ headless: true });
const a = await run(browser, null);
const b = await run(browser, "unrestricted");
await browser.close();

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`); if (!ok) failed += 1; };

for (const r of [a, b]) {
  console.log(`偏好=${r.preference} · ${r.side}`);
  console.log(`  点 (7,7)（三三禁手点）→ 盘上 ${r.after} 子 · 提示「${r.hint}」`);
}
check("默认（未设偏好）时三三禁手被拒", a.rejected && /三三禁手/.test(a.hint), a.hint);
check("全局偏好设成无禁手时，每日一题**仍**按有禁手判", b.rejected && /三三禁手/.test(b.hint), b.hint);
/**
 * 「不是全局生效」的判据：每日一题的选择**不许漏进那个偏好键**。
 *
 * ⚠ 注意那个键**本来就会被写**：App 挂载时有一条 `savePuzzleRulePreference(...)` 的持久化
 * effect，会把「打谱 → 做题」那套偏好写回去（新装用户写的就是默认的 unrestricted）——
 * 那是既有行为，与每日一题无关。所以这里判的是**值不等于 forbidden**：
 * 每日一题的"有禁手"没有变成全局偏好。
 */
const leaked = [a, b].filter((r) => r.prefAfter === "forbidden");
check("每日一题的有禁手**没有**漏进全局偏好键", leaked.length === 0,
  `每日一题后偏好键=${a.prefAfter === null ? "(未写入)" : a.prefAfter}`);
console.log(failed ? `${failed} 项未通过` : "全部通过");
