import { chromium } from "playwright";

/**
 * 落子延迟探针（2026-09-18）：从原始 pointerdown 到「新棋子进 DOM」与「画出来」各要多久。
 *
 * 为什么留着它：用户反馈「落子看起来像是很卡，关了界面动效还是那样」。实测结论——
 *   dev 服务器（vite dev，React 开发模式未压缩）：进 DOM ≈177ms、上屏 ≈190-199ms；
 *   生产构建（vite preview dist）：进 DOM ≈6-8ms、上屏 ≈9-25ms；
 *   两者都与「界面动效」开关无关（动画本来就停了，见 qa/board-motion-check.mjs）。
 * 所以「卡」是 dev 构建的渲染开销，不是发布版的落子延迟；要看真实手感必须跑生产构建。
 *
 * 跑法：
 *   npx vite preview --port 5302 --strictPort            # 生产构建（需先 npm run build）
 *   QA_BASE_URL=http://localhost:5302/ node scripts/probe-board-placement-latency.mjs
 *   npx vite --port 5301 --strictPort                    # 对照 dev
 *   QA_BASE_URL=http://localhost:5301/ node scripts/probe-board-placement-latency.mjs
 */
const baseURL = process.env.QA_BASE_URL || "http://localhost:5302/";
const qaURL = new URL(baseURL); qaURL.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });

const metadata = { title: "落子延迟探针", black: "黑方", white: "白方", event: "探针", date: "2026-09-18", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] };
const active = {
  id: "latency-probe", version: 1, rootId: "root", savedCurrentId: "m1",
  createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", metadata,
  nodes: {
    root: { id: "root", parentId: null, children: ["m1"], preferredChildId: "m1", move: null, comment: "", marks: [] },
    m1: { id: "m1", parentId: "root", children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
  },
};
const seed = ({ document: doc, motion }) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(doc));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([doc]));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
  if (motion === false) localStorage.setItem("banbu-motion-enabled-v2", "false");
};

/** 记录：原始 pointerdown → 新棋子进 DOM → 第一帧画出来。 */
const installTiming = () => {
  window.__marks = [];
  window.__count = () => document.querySelectorAll(".stone-piece").length;
  const record = (label) => window.__marks.push({ label, at: performance.now() });
  window.addEventListener("pointerdown", () => { window.__marks = []; record("pointerdown"); }, true);
  window.addEventListener("click", () => record("click"), true);
  const observer = new MutationObserver(() => {
    if (window.__count() > window.__baseCount) {
      record("stone-in-dom");
      requestAnimationFrame(() => requestAnimationFrame(() => record("painted-2frames")));
      observer.disconnect();
    }
  });
  window.__baseCount = window.__count();
  observer.observe(document.querySelector(".renju-board"), { childList: true, subtree: true });
};

const run = async (label, { motion, mobile }) => {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.addInitScript(seed, { document: active, motion });
  await page.goto(qaURL.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".renju-board", { timeout: 30_000 });
  await page.waitForTimeout(800);
  const results = [];
  for (let index = 0; index < 6; index += 1) {
    await page.evaluate(installTiming);
    const hit = page.locator(".board-hit").nth(40 + index * 3);
    await hit.click({ force: true });
    await page.waitForTimeout(900);
    const marks = await page.evaluate(() => window.__marks);
    const base = marks.find((mark) => mark.label === "pointerdown")?.at;
    const toDom = marks.find((mark) => mark.label === "stone-in-dom")?.at;
    const toPaint = marks.find((mark) => mark.label === "painted-2frames")?.at;
    results.push({ dom: toDom && base ? Math.round(toDom - base) : null, paint: toPaint && base ? Math.round(toPaint - base) : null });
  }
  const doms = results.map((item) => item.dom).filter((value) => value !== null).sort((a, b) => a - b);
  const paints = results.map((item) => item.paint).filter((value) => value !== null).sort((a, b) => a - b);
  console.log(JSON.stringify({ label, samples: results, domMedian: doms[Math.floor(doms.length / 2)], paintMedian: paints[Math.floor(paints.length / 2)] }));
  await context.close();
};

await run("desktop/motion-on", { motion: true, mobile: false });
await run("desktop/motion-off", { motion: false, mobile: false });
await run("mobile/motion-off", { motion: false, mobile: true });
await browser.close();
