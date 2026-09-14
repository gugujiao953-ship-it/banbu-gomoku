/* Focused re-check of part B: prove the AI game is actually active (the AI
 * answers our move) before trusting the "no win-rate" assertions. */
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto("http://localhost:5193/?qa=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2200);

  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
  const clickPoint = async (pt) => page.evaluate((p) => {
    const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(p));
    c?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return !!c;
  }, pt);
  const stones = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);

  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("AI"))?.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll(".ai-game-setup .ai-setup-cell.single")].find((b) => /思考|难度|大师/.test(b.textContent || "") || b.getAttribute("aria-expanded") !== null);
    cell?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes("大师"))?.click(); });
  const started = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战"));
    b?.click();
    return !!b;
  });
  check("B0 点到了「开始人机对战」", started);
  await page.waitForTimeout(1500);

  const before = await stones();
  await clickPoint("H8");
  let after = before;
  for (let i = 0; i < 60; i += 1) { after = await stones(); if (after >= before + 2) break; await page.waitForTimeout(1000); }
  check("B1b AI 确实应答了（我落一子后它回一子）", after >= before + 2, `棋子 ${before} → ${after}`);

  const rate = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const hits = [];
    document.querySelectorAll("*").forEach((el) => {
      if (el.children.length) return;
      const t = (el.textContent || "").trim();
      if (!t || t.length > 20) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || !vis(el)) return;
      if (/胜率/.test(t) || /%$/.test(t)) hits.push(t);
    });
    return {
      rateTexts: hits,
      candidatePoints: document.querySelectorAll(".analysis-candidate-point").length,
      winrateStat: !!document.querySelector(".stat-winrate"),
      inAiGame: !!document.querySelector(".ai-game-setup, .ai-game-panel, [class*='ai-game']"),
    };
  });
  check("B2 棋盘上没有候选点", rate.candidatePoints === 0, `候选点=${rate.candidatePoints}`);
  check("B3 界面上没有胜率文本", rate.rateTexts.length === 0, JSON.stringify(rate.rateTexts));
  check("B4 面板胜率格隐藏", !rate.winrateStat, `stat-winrate=${rate.winrateStat}`);
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  console.log(failed ? `RESULT: ${failed} failed` : "RESULT: all passed");
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
