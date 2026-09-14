import { chromium } from "playwright";

// 常驻门禁：提示模式行为（2026-09-10 用户反馈批）
//  H1 纯提示模式：点「分析」只请求一次、只落一子，之后不再滚动思考/落子
//  H2 旧存档残留态（hint+selfPlay+auto 三个都真）：归一为提示优先，行为同 H1
//  H3 提示思考中点「停止」= 先落当前最强点再停（与 T29 人机同语义），不是空停
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-hint-stop-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const newPage = async (seed) => {
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript((s) => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); if (s) localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify(s)); }, seed);
  const page = await context.newPage();
  await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  return { context, page };
};
const stones = (page) => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const lit = (page) => page.evaluate(() => !!document.querySelector(".board-thinking-indicator"));
const toast = (page) => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => (e.textContent || "").trim()).filter(Boolean).slice(-1)[0] || "");
const clickAnalyze = (page) => page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").startsWith("分析")); b?.click(); return !!b; });
const waitStones = async (page, target, timeoutMs) => { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (await stones(page)) { if (await stones(page) >= target) return Date.now() - t0; } await page.waitForTimeout(250); } return -1; };

// ── H1 纯提示模式：一子即止 ──────────────────────────────
{
  const { context, page } = await newPage({ analysisHintMode: true, analysisAuto: false, analysisSelfPlay: false });
  const clicked = await clickAnalyze(page);
  const placedMs = await waitStones(page, 1, 14000);
  await page.waitForTimeout(9000); // 观察期：不该再落子
  const total = await stones(page);
  check("H1 提示模式点分析=落一子", clicked && placedMs >= 0, `placedMs=${placedMs}`);
  check("H1 落子后不再继续思考落子（无滚动轮）", total === 1 && !(await lit(page)), `stones=${total} lit=${await lit(page)}`);
  await context.close();
}

// ── H2 旧存档残留态：提示优先，行为同 H1 ─────────────────
{
  const { context, page } = await newPage({ analysisHintMode: true, analysisAuto: true, analysisSelfPlay: true, analysisSelfPlayTimeMs: 2000 });
  const normalized = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}"));
  check("H2 归一：提示优先，清零自对弈/持续分析开关", normalized.analysisHintMode === true && normalized.analysisSelfPlay === false && normalized.analysisAuto === false, JSON.stringify({ hint: normalized.analysisHintMode, selfPlay: normalized.analysisSelfPlay, auto: normalized.analysisAuto }));
  await clickAnalyze(page);
  await waitStones(page, 1, 14000);
  await page.waitForTimeout(9000);
  const total = await stones(page);
  check("H2 残留态下同样一子即止", total === 1, `stones=${total}`);
  await context.close();
}

// ── H3 提示思考中点停止 = 先落最强点 ─────────────────────
{
  const { context, page } = await newPage({ analysisHintMode: true, analysisAuto: false, analysisSelfPlay: false });
  await clickAnalyze(page);
  // 等思考指示灯亮起 → 停 700ms（让 progress 快照有数据）→ 仍在思考就点停
  let stopped = false;
  for (let i = 0; i < 25; i += 1) {
    if (await lit(page)) {
      await page.waitForTimeout(700);
      if ((await lit(page)) && (await stones(page)) === 0) {
        stopped = await page.evaluate(() => { const el = document.querySelector(".board-thinking-indicator"); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return !!el; });
      }
      break;
    }
    await page.waitForTimeout(200);
  }
  const placedMs = await waitStones(page, 1, 14000);
  const stopToast = await toast(page);
  const total = await stones(page);
  check("H3 停止后本回合落定（落当前最强点）", placedMs >= 0 && total === 1, `stopped=${stopped} placedMs=${placedMs} stones=${total} toast=${stopToast}`);
  if (stopped) check("H3 停止提示=落当前最强点（非空停）", /停止思考/.test(stopToast), `toast=${stopToast}`);
  await page.waitForTimeout(6000);
  check("H3 停止后不再有新回合", (await stones(page)) === 1);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  await context.close();
}

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
