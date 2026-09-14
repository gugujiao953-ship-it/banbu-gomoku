/* In-app verification for the new 「思考中」indicator animation.
 * Drives the real AI-vs-human flow so the indicator appears naturally, then
 * checks structure, motion trajectory and that clicking still stops thinking.
 * Usage: node design-lab/thinking-motion/verify-in-app.cjs */
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
  const lit = () => page.evaluate(() => Boolean(document.querySelector(".board-thinking-indicator")));
  const clickPoint = async (pt) => page.evaluate((p) => {
    const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(p));
    c?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, pt);

  // enter AI game at master strength (long enough thinking window)
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("AI"))?.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll(".ai-game-setup .ai-setup-cell.single")].find((b) => /思考|难度|大师/.test(b.textContent || "") || b.getAttribute("aria-expanded") !== null);
    cell?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes("大师"))?.click(); });
  await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战"))?.click(); });
  await page.waitForTimeout(800);

  await clickPoint("H8");
  let seen = false;
  for (let i = 0; i < 60; i += 1) { if (await lit()) { seen = true; break; } await page.waitForTimeout(500); }
  check("S1 思考中指示器出现", seen, `lit=${seen}`);
  if (!seen) { await browser.close(); process.exit(1); }

  const shape = await page.evaluate(() => {
    const el = document.querySelector(".board-thinking-indicator");
    const swap = el.querySelector(".thinking-swap");
    const stones = swap ? [...swap.querySelectorAll("i")] : [];
    const cs = swap ? getComputedStyle(swap) : null;
    return {
      hasSwap: !!swap,
      stoneCount: stones.length,
      classes: stones.map((s) => s.className),
      oldIcon: !!el.querySelector("svg"),
      oldDots: [...el.querySelectorAll(":scope > i")].length,
      label: el.textContent.trim(),
      size: cs ? Math.round(swap.getBoundingClientRect().width) : 0,
      stoneSize: stones.length ? Math.round(stones[0].getBoundingClientRect().width) : 0,
      anim: stones.length ? getComputedStyle(stones[0]).animationName : "none",
      dur: stones.length ? getComputedStyle(stones[0]).animationDuration : "0s",
    };
  });
  check("S2 结构=双棋子容器", shape.hasSwap && shape.stoneCount === 2, JSON.stringify({ has: shape.hasSwap, n: shape.stoneCount }));
  check("S3 黑白两子类名正确", shape.classes.includes("s-black") && shape.classes.includes("s-white"), shape.classes.join("/"));
  check("S4 旧 Bot 图标与三点已移除", !shape.oldIcon && shape.oldDots === 0, `svg=${shape.oldIcon} dots=${shape.oldDots}`);
  check("S5 文案仍为「思考中」", shape.label === "思考中", shape.label);
  check("S6 动效挂载=ai-thinking-swap", shape.anim === "ai-thinking-swap", `${shape.anim} / ${shape.dur}`);
  check("S7 尺寸合理（棋子 8-12px、容器 ~20px）", shape.stoneSize >= 8 && shape.stoneSize <= 12 && shape.size >= 18 && shape.size <= 24, `容器${shape.size}px 子${shape.stoneSize}px`);

  // trajectory: scrub the timeline and confirm the two stones trade places
  const traj = await page.evaluate(() => {
    const swap = document.querySelector(".board-thinking-indicator .thinking-swap");
    const stones = [...swap.querySelectorAll("i")];
    const anims = stones.flatMap((s) => s.getAnimations());
    anims.forEach((a) => a.pause());
    const dur = anims[0].effect.getTiming().duration;
    const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const b = [], w = [];
    const N = 21;
    for (let i = 0; i < N; i += 1) {
      anims.forEach((a) => { a.currentTime = (dur * i) / (N - 1); });
      b.push(centre(stones[0])); w.push(centre(stones[1]));
    }
    // note: b/w hold points, but the arrays passed here are already numeric
    const near = (values, t) => Math.min(...values.map((v) => Math.abs(v - t)));
    const steps = b.slice(1).map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) + Math.hypot(w[i + 1].x - w[i].x, w[i + 1].y - w[i].y));
    anims.forEach((a) => a.play());
    const bxs = b.map((p) => Math.round(p.x * 10) / 10);
    const wxs = w.map((p) => Math.round(p.x * 10) / 10);
    return {
      travel: Math.round((Math.max(...bxs) - Math.min(...bxs)) * 10) / 10,
      swapOk: near(bxs, wxs[0]) < 3 && near(wxs, bxs[0]) < 3,
      bStart: bxs[0], bMax: Math.max(...bxs), bEnd: bxs[bxs.length - 1],
      wStart: wxs[0], wMin: Math.min(...wxs), wEnd: wxs[wxs.length - 1],
      gap: Math.round((wxs[0] - bxs[0]) * 10) / 10,
      stalls: steps.filter((d) => d < 0.15).length,
      pace: Math.round((Math.max(...steps) / Math.max(0.05, Math.min(...steps))) * 10) / 10,
      orbitY: Math.round((Math.max(...b.map((p) => p.y)) - Math.min(...b.map((p) => p.y))) * 10) / 10,
    };
  });
  check("S8 两子确实互换到对方位置", traj.swapOk,
    `黑 ${traj.bStart}→${traj.bMax} 白 ${traj.wStart}→${traj.wMin} 初始间距${traj.gap}px 行程${traj.travel}px`);
  check("S9 全程无停顿（用户反馈点）", traj.stalls === 0, `停顿步=${traj.stalls} 节奏起伏=${traj.pace}×`);
  check("S10 走的是圆弧（有明显纵向位移）", traj.orbitY >= 3, `纵向行程 ${traj.orbitY}px`);

  // clicking the indicator must still stop thinking (existing behavior)
  await page.evaluate(() => document.querySelector(".board-thinking-indicator")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  let stopped = false;
  for (let i = 0; i < 20; i += 1) { if (!(await lit())) { stopped = true; break; } await page.waitForTimeout(400); }
  check("S11 点击仍可停止思考", stopped, `stopped=${stopped}`);

  await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/thinking-indicator-inapp.png" });
  console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  console.log(failed ? `RESULT: ${failed} failed` : "RESULT: all passed");
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
