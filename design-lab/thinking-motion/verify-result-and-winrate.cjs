/* Verify the two 09-13 requests:
 *  A. the result banner can be dismissed (and no longer blocks the board)
 *  B. AI-vs-human never shows win-rate (no candidate points, no % labels)
 * Usage: node design-lab/thinking-motion/verify-result-and-winrate.cjs */
const { chromium } = require("playwright");

const url = process.env.BANBU_URL || "http://localhost:5193/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2200);

  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
  const clickPoint = async (pt) => page.evaluate((p) => {
    const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(p));
    c?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, pt);
  const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);

  /* ---------- A. result banner dismiss ---------- */
  // build a black five-in-a-row on the empty new record: H8..L8 with white fillers
  for (const pt of ["H8", "A1", "I8", "A2", "J8", "A3", "K8", "A4", "L8"]) {
    await clickPoint(pt);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(700);
  const banner = await page.evaluate(() => {
    const el = document.querySelector(".game-result-banner");
    if (!el) return null;
    const dismiss = el.querySelector(".game-result-dismiss");
    return {
      text: el.textContent.replace(/\s+/g, " ").trim(),
      hasDismiss: !!dismiss,
      dismissLabel: dismiss?.getAttribute("aria-label") || null,
      dismissPointer: dismiss ? getComputedStyle(dismiss).pointerEvents : null,
      bannerPointer: getComputedStyle(el).pointerEvents,
    };
  });
  check("A1 五连后出现结果提示", !!banner, banner ? banner.text : "无横幅");
  check("A2 横幅带关闭按钮", !!banner?.hasDismiss, `label=${banner?.dismissLabel}`);
  check("A3 关闭按钮可点（横幅本体不拦截棋盘）", banner?.dismissPointer === "auto" && banner?.bannerPointer === "none",
    `dismiss=${banner?.dismissPointer} banner=${banner?.bannerPointer}`);

  // the board must still accept clicks while the banner is visible
  const before = await stoneCount();
  await clickPoint("M8");
  await page.waitForTimeout(400);
  const after = await stoneCount();
  check("A4 横幅在场时棋盘仍可落子", after === before + 1, `${before} → ${after}`);

  // dismiss it
  await page.evaluate(() => document.querySelector(".game-result-dismiss")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(400);
  const gone = await page.evaluate(() => !document.querySelector(".game-result-banner"));
  check("A5 点叉后横幅消失", gone, `gone=${gone}`);

  // a NEW outcome must bring it back (fresh five-in-a-row elsewhere)
  for (const pt of ["H12", "B1", "I12", "B2", "J12", "B3", "K12", "B4", "L12"]) {
    await clickPoint(pt);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => document.querySelector(".game-result-banner")?.textContent.trim() || null);
  check("A6 新的胜负结果会重新出现提示", !!back, back || "未重现");

  /* ---------- B. AI game hides win-rate ---------- */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("AI"))?.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll(".ai-game-setup .ai-setup-cell.single")].find((b) => /思考|难度|大师/.test(b.textContent || "") || b.getAttribute("aria-expanded") !== null);
    cell?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes("大师"))?.click(); });
  await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战"))?.click(); });
  await page.waitForTimeout(900);
  await clickPoint("H8");
  let stones = 0;
  for (let i = 0; i < 60; i += 1) { stones = await stoneCount(); if (stones >= 2) break; await page.waitForTimeout(1000); }
  check("B1 人机对战已开始（双方各落一子）", stones >= 2, `棋子=${stones}`);

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
      candidateChips: document.querySelectorAll(".analysis-candidate-chip").length,
      winrateStat: !!document.querySelector(".stat-winrate"),
    };
  });
  check("B2 棋盘上没有候选点（胜率载体）", rate.candidatePoints === 0, `候选点=${rate.candidatePoints}`);
  check("B3 界面上没有任何胜率文本", rate.rateTexts.length === 0, JSON.stringify(rate.rateTexts));
  check("B4 面板胜率格已隐藏（即使打开分析）", !rate.winrateStat, `stat-winrate=${rate.winrateStat}`);

  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  console.log(failed ? `RESULT: ${failed} failed` : "RESULT: all passed");
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
