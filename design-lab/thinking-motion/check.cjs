/* Verify each thinking-motion variant.
 * Headless Chromium throttles the animation clock, so the timeline is scrubbed
 * explicitly. Displacement variants must actually reach each other's slot;
 * recolour variants (3, 4) must swap their two painted faces instead. */
const { chromium } = require("playwright");

const RECOLOUR = new Set([3, 4]);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 1000 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("EXC:" + String(e).slice(0, 140)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("LOG:" + m.text().slice(0, 140)); });

  await page.goto("file:///D:/Projects/%E4%BA%94%E5%AD%90%E6%A3%8B2/design-lab/thinking-motion/index.html", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(400);

  const results = await page.evaluate(() => {
    const SAMPLES = 21;
    return [...document.querySelectorAll(".card")].map((card) => {
      const tm = card.querySelector(".stage > .tm");
      const name = card.querySelector(".meta b").textContent;
      const no = Number(card.querySelector(".no").textContent);
      const stones = [...tm.querySelectorAll(".g")];
      // animations may live on the element itself or on its pseudo faces
      const allAnims = document.getAnimations().filter((a) => {
        const t = a.effect.target;
        return t === stones[0] || t === stones[1] || (t && stones.includes(t));
      });
      const anims = stones.flatMap((s) => s.getAnimations());
      const pseudoAnims = allAnims.filter((a) => a.effect.pseudoElement);
      const active = anims.length ? anims : pseudoAnims;
      if (!active.length) return { no, name, error: "无动画" };
      const dur = active[0].effect.getTiming().duration;
      active.forEach((a) => a.pause());

      // centre of each stone cancels out scale/rotation offsets
      const centre = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * 10) / 10, y: Math.round((r.y + r.height / 2) * 10) / 10 }; };
      const black = [], white = [];
      const blackX = [], whiteX = [];
      let rotateAtMid = null, faceAtStart = null;
      for (let i = 0; i < SAMPLES; i += 1) {
        const t = (dur * i) / (SAMPLES - 1);
        active.forEach((a) => { a.currentTime = t % a.effect.getTiming().duration; });
        const cb = centre(stones[0]), cw = centre(stones[1]);
        black.push(cb); white.push(cw);
        blackX.push(cb.x); whiteX.push(cw.x);
        if (i === Math.round(SAMPLES * 0.5)) {
          rotateAtMid = getComputedStyle(stones[0]).transform;
        }
        if (i === 0) {
          faceAtStart = {
            before: getComputedStyle(stones[0], "::before").backgroundImage.slice(0, 60),
            after: getComputedStyle(stones[0], "::after").backgroundImage.slice(0, 60),
            afterVisible: getComputedStyle(stones[0], "::after").backfaceVisibility,
          };
        }
      }
      const near = (arr, target) => Math.min(...arr.map((v) => Math.abs(v - target)));
      const blackToWhiteSlot = near(blackX, white[0].x);
      const whiteToBlackSlot = near(whiteX, black[0].x);
      // 2-D displacement per step: an orbiting stone still moves in y even when
      // its x derivative is momentarily zero, so x alone would fake a pause.
      const steps = black.slice(1).map((p, i) => Math.hypot(
        p.x - black[i].x, p.y - black[i].y) + Math.hypot(white[i + 1].x - white[i].x, white[i + 1].y - white[i].y));
      // stalls = steps that are genuinely near-zero (a real pause)
      // pace = max/min step ratio (1 = constant speed, high = strong breathing)
      const stalls = steps.filter((d) => d < 0.2).length;
      const maxStep = Math.max(...steps), minStep = Math.min(...steps.filter((d) => d > 0.05)) || maxStep;
      const travel = Math.round((Math.max(...blackX) - Math.min(...blackX)) * 10) / 10;
      return {
        no, name, dur,
        travel,
        swap: blackToWhiteSlot < 4 && whiteToBlackSlot < 4,
        stray: Math.round(Math.max(blackToWhiteSlot, whiteToBlackSlot) * 10) / 10,
        stalls,
        pace: Math.round((maxStep / minStep) * 10) / 10,
        rotateAtMid,
        facesDiffer: faceAtStart.before !== faceAtStart.after,
        faceFlip: faceAtStart.afterVisible === "hidden",
      };
    });
  });

  console.log("cards:", results.length);
  const bad = [];
  results.forEach((r) => {
    if (r.error) { console.log(`${r.name.padEnd(6)} ✗ ${r.error}`); bad.push(r.name); return; }
    if (RECOLOUR.has(r.no)) {
      // recolour variants: the two painted faces must be different colours and
      // the flipping face must be marked as back-facing
      const isRotating = /matrix3d|rotate/i.test(r.rotateAtMid || "") || r.rotateAtMid !== "none";
      const ok = r.facesDiffer && (r.faceFlip || isRotating);
      if (!ok) bad.push(r.name);
      console.log(`${r.name.padEnd(6)} 换色型 周期${r.dur}ms 双面异色${r.facesDiffer ? "✓" : "✗"} 背面翻转${r.faceFlip ? "✓" : "-"} 相位中点有变换${isRotating ? "✓" : "✗"}`);
    } else {
      const ok = r.swap && r.travel >= 6;
      if (!ok) bad.push(r.name);
      const pacing = r.stalls === 0 ? "无停顿" : "含 " + r.stalls + " 段停顿";
      console.log(`${r.name.padEnd(6)} 位移型 周期${String(r.dur).padStart(4)}ms 行程${String(r.travel).padStart(5)}px 到达对方位置${r.swap ? "✓" : "✗"} 停顿段 ${r.stalls}（${pacing}）节奏起伏 ${r.pace}×`);
    }
  });
  console.log("PROBLEMS:", bad.length ? bad.join(" / ") : "none");
  console.log("ERRORS:", errs.length ? errs.join(" | ") : "none");
  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
