import { chromium } from "playwright";

// Regression gate for T30: 五手多打（five-n）打点归属修复。
// Bug: chooseFifthCount 把「宣布数量方（白）」的 actor 继承给 offer-fifths，
// 执黑人类会遇到 AI 代放打点+代选，人类全程被跳过。Fix: offer 显式归黑方。
// Flow (人类执黑，AI 白): 人摆 1-3（开局方摆前两手异色+第三黑子）→ AI 不交换 →
// AI 白4 → AI 宣布 3 打 → 【断言：人类收到「请提供 3 个」且点击注册为候选】→
// 人点 3 个远距点 → AI 打点选幸存第5手 → 断言第5手 ∈ 人点的三点之一。
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-opening-five-n-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const banner = () => page.evaluate(() => { const el = document.querySelector(".ai-opening-banner"); return el ? (el.textContent || "").replace(/\s+/g, " ").slice(0, 160) : ""; });
const occ = () => page.evaluate(() => [...document.querySelectorAll(".board-hit")].map((h) => h.getAttribute("aria-label") || "").filter((l) => l.includes("已有棋子")).map((l) => (l.match(/[A-O]\d{1,2}/) || [""])[0]));
const clickPoint = async (n) => { await page.evaluate((pt) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(pt)); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, n); await page.waitForTimeout(600); };

await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("AI"))?.click(); });
await page.waitForTimeout(900);
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("有禁手"))?.click(); });
await page.waitForTimeout(400);
const fiveN = await page.evaluate(() => { const b = [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes("五手多打") || (e.textContent || "").includes("五手 N 打") || (e.textContent || "").includes("五手N打")); if (b) { b.click(); return (b.textContent || "").trim().slice(0, 20); } return ""; });
check("S1 规则浮层含五手多打", Boolean(fiveN), fiveN);
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("执黑"))?.click(); });
await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战"))?.click(); });
await page.waitForTimeout(1200);

// 人（先手方）摆 1-3 手
await clickPoint("H8");
await clickPoint("I9");
await clickPoint("H6");
let setup = await occ();
check("S2 先手方摆满前三子", setup.length === 3, JSON.stringify(setup));
// AI 交换决定（代码固定不交换）+ AI 白4（引擎~2-4s）
for (let i = 0; i < 40; i += 1) { setup = await occ(); if (setup.length >= 4) break; await page.waitForTimeout(500); }
check("S3 交换后 AI 落白4（4子）", setup.length === 4, JSON.stringify(setup));

// 核心断言：放点权必须回到人类——横幅出现「请提供 3 个」
let offerSeen = "";
for (let i = 0; i < 40; i += 1) {
  offerSeen = await banner();
  if (/请提供\s*3|请提供 3/.test(offerSeen)) break;
  const stones = await occ();
  if (stones.length > 4) { offerSeen = "AI越权：" + offerSeen; break; } // 修复前：AI 直接代放
  await page.waitForTimeout(500);
}
check("S4 人类收到放点提示（请提供 3 个）", /请提供 3/.test(offerSeen), `banner=「${offerSeen.slice(0, 80)}」`);

// 人点 3 个远距候选（各自不同形），逐点注册计数递增
await clickPoint("D4");
let mid = await banner();
check("S5 第一点注册成功（1/3）", /1\/3/.test(mid), `banner=「${mid.slice(0, 90)}」`);
await clickPoint("L12");
await clickPoint("B10");
// AI 打点（白 chooser）→ 幸存者=黑第5手；3 候选各一次冷评估，封顶 25s
let final5 = [];
for (let i = 0; i < 50; i += 1) {
  final5 = await occ();
  if (final5.length >= 5) break;
  await page.waitForTimeout(500);
}
check("S6 第5手由人放的候选中产生（AI 只打点）", final5.length >= 5 && ["D4", "L12", "B10"].some((nm) => final5.includes(nm) && nm !== "H8"), `board=${JSON.stringify(final5)}`);
const survivor = final5.find((nm) => ["D4", "L12", "B10"].includes(nm)) || "";
check("S7 幸存者唯一（AI 未把三点全落上）", survivor && final5.filter((nm) => ["D4", "L12", "B10"].includes(nm)).length === 1, `survivor=${survivor} board=${JSON.stringify(final5)}`);
check("S8 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
