// 量测结算弹窗真实布局（配合截图像素分析互证）
import { chromium } from "playwright";
const BASE = process.argv[2] || "http://localhost:5210/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) {
  await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("先自己试试"))?.click());
  await page.waitForTimeout(500);
}
await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  Array.from(nav?.querySelectorAll("button") ?? []).find((x) => (x.textContent || "").trim() === "对弈")?.click();
});
await page.waitForTimeout(700);
await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "开始挑战")?.click());
await page.waitForSelector(".vcfch-board", { timeout: 20000 });
await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-bottom button")).find((b) => (b.textContent || "").trim() === "开始挑战")?.click());
await page.waitForFunction(() => Array.from(document.querySelectorAll(".vcfch-bottom button")).some((b) => (b.textContent || "").includes("认输")), null, { timeout: 45000 });

const dump = () => page.evaluate(() => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1) };
  };
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const cs = (el, props) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, c.getPropertyValue(p)]));
  };
  return {
    viewport: { w: innerWidth, h: innerHeight },
    backdrop: r(q(".vcfch-endbackdrop")),
    end: r(q(".vcfch-end")),
    card: r(q(".vcfch-end-card")),
    stampwrap: r(q(".vcfch-end-stampwrap")),
    stamp: r(q(".vcfch-end-stamp")),
    stroke: r(q(".vcfch-end-stroke")),
    sub: r(q(".vcfch-end-sub")),
    subText: q(".vcfch-end-sub")?.textContent ?? null,
    statsBox: r(q(".vcfch-end-stats")),
    stats: qa(".vcfch-end-stats > div").map((d) => ({ rect: r(d), text: d.textContent.replace(/\s+/g, " ").trim() })),
    statsB: qa(".vcfch-end-stats b").map((b) => ({ rect: r(b), text: b.textContent.trim(), cls: b.className, scrollW: b.scrollWidth, clientW: b.clientWidth, clipped: b.scrollWidth > b.clientWidth })),
    actionsBox: r(q(".vcfch-end-actions")),
    buttons: qa(".vcfch-end-actions button").map((b) => {
      const icon = b.querySelector("svg");
      return { rect: r(b), text: b.textContent.trim(), icon: r(icon), scrollW: b.scrollWidth, clientW: b.clientWidth };
    }),
    hint: r(q(".vcfch-end-hint")),
    hintScrollH: q(".vcfch-end-hint") ? (() => { const h = q(".vcfch-end-hint"); return { scrollH: h.scrollHeight, clientH: h.clientHeight, lines: Math.round(h.scrollHeight / parseFloat(getComputedStyle(h).lineHeight)) }; })() : null,
    variant: q(".vcfch-end")?.className,
    cardCS: cs(q(".vcfch-end-card"), ["width", "background-color", "border-color", "border-radius"]),
    stampCS: cs(q(".vcfch-end-stamp"), ["background-image", "color"]),
    subOverflowX: q(".vcfch-end-sub") ? q(".vcfch-end-sub").scrollWidth - q(".vcfch-end-sub").clientWidth : null,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
  };
});

// ── 负局：认输 ──
await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-bottom button")).find((b) => (b.textContent || "").includes("认输"))?.click());
await page.waitForSelector(".vcfch-endbackdrop", { timeout: 15000 });
await page.waitForTimeout(1600);
console.log("=== LOSE ===");
console.log(JSON.stringify(await dump(), null, 1));
await page.screenshot({ path: "qa/tmp-modal-lose-recheck.png" });

// ── 胜局：点重试后按 tmp-win-modal-check 的乱下法走完 8 手 ──
await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-end-actions button")).find((b) => (b.textContent || "").trim() === "重试")?.click());
await page.waitForTimeout(400);
for (let ply = 0; ply < 8; ply += 1) {
  if (await page.evaluate(() => !!document.querySelector(".vcfch-endbackdrop"))) break;
  const placed = await page.evaluate(() => {
    const board = document.querySelector(".vcfch-board");
    if (!board) return "noboard";
    const r = board.getBoundingClientRect();
    const used = new Set(Array.from(document.querySelectorAll("[data-vcf-stone]")).map((g) => Number(g.getAttribute("data-vcf-stone"))));
    const before = used.size;
    const view = 572, margin = 46, cell = (572 - 92) / 14;
    for (let k = 0; k < 225; k += 1) {
      if (used.has(k)) continue;
      const row = Math.floor(k / 15), col = k % 15;
      const x = r.left + ((margin + col * cell) / view) * r.width;
      const y = r.top + ((margin + row * cell) / view) * r.height;
      if (y < r.top + 5 || y > r.bottom - 5) continue;
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
      const after = document.querySelectorAll("[data-vcf-stone]").length;
      if (after > before || document.querySelector(".vcfch-endbackdrop")) return `placed@${k}`;
    }
    return "none";
  });
  if (!String(placed).startsWith("placed@")) { console.log("ply stop:", ply, placed); break; }
  await page.waitForTimeout(120);
}
await page.waitForTimeout(1600);
const winOpen = await page.evaluate(() => !!document.querySelector(".vcfch-endbackdrop"));
console.log("win modal open:", winOpen);
if (winOpen) {
  console.log("=== WIN ===");
  console.log(JSON.stringify(await dump(), null, 1));
  await page.screenshot({ path: "qa/tmp-modal-win-recheck.png" });
}
await browser.close();
