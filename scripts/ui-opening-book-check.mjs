import { chromium } from "playwright";
import fs from "node:fs";

// Regression gate for the optional opening book (P1 档①, 索索夫打点簿).
// The book lives at the ENGINE layer (rapfi-worker.js answers analyze
// requests carrying book:true) — this gate drives the real UI through the
// opening line the BOOK actually chose:
//   AI auto-plays 1-3 (black1=天元 H8; white2/black3 = 簿 top-rank 组，T31 起
//   并列随机破平——所以门禁动态读实际手序，不再假定寒星线), human (white)
//   plays the book's 4th move for that line, declares 打点, and the AI's
//   offered candidates must come from the book at millisecond speed.
//   S1/S2 cover the switch itself (default off, persistence, zero footprint).
// 手序识别：开显示手数（renju-note-display-settings-v1.showNumbers），棋盘棋子
// 的 <text class="move-number black|white">N</text> 与棋盘格同为主序渲染，zip 后
// 按 n 排序还原精确落子顺序与颜色。
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-opening-book-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const book = JSON.parse(fs.readFileSync("public/opening-book/sosyov-v1.json", "utf8"));
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("renju-note-display-settings-v1", JSON.stringify({ showNumbers: true })); });
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

const toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join("|").slice(0, 160));
const clickText = (t) => page.evaluate((name) => { const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === name || e.getAttribute("aria-label") === name); if (b) { b.click(); return true; } return false; }, t);
const clickPoint = async (name) => { await page.evaluate((pt) => { const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(pt)); cell?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, name); await page.waitForTimeout(400); };
const occupied = () => page.evaluate(() => [...document.querySelectorAll(".board-hit")].map((h) => h.getAttribute("aria-label") || "").filter((l) => l.includes("已有棋子")).map((l) => (l.match(/[A-O]\d{1,2}/) || [""])[0]));

// S1: 设置页开关存在且默认关
await clickText("设置"); await page.waitForTimeout(800);
const settingsState = await page.evaluate(() => {
  const label = [...document.querySelectorAll("*")].find((e) => (e.textContent || "").trim() === "开局库（打点簿）");
  const row = label?.closest("[class*='setting'], label, div");
  const input = row?.querySelector("input[type=checkbox]");
  return { present: Boolean(label), checked: input ? input.checked : null };
});
check("S1 设置页开局库开关存在且默认关", settingsState.present && settingsState.checked === false, JSON.stringify(settingsState));
const lsOff = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").openingBook);
check("S1 默认值不写入存储（关闭即零痕迹）", lsOff === undefined || lsOff === false, String(lsOff));

// S2: 打开开关 → 持久化
await page.evaluate(() => { const label = [...document.querySelectorAll("*")].find((e) => (e.textContent || "").trim() === "开局库（打点簿）"); label?.closest("[class*='setting'], label, div")?.querySelector("input[type=checkbox]")?.click(); });
await page.waitForTimeout(600);
const lsOn = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "null")?.openingBook);
check("S2 开启后持久化 openingBook=true", lsOn === true, String(lsOn));

// 实际手序还原：board-hit 与 move-number 同为 row-major 渲染，zip 后按手数排序。
// 自检锚点：n1 必为黑 H8（强制天元）、n2 白 n3 黑——zip 错位会当场 FAIL 而非静默误判。
const nameToPair = (n) => [15 - Number(n.slice(1)), n.charCodeAt(0) - 65];
const stoneSequence = async () => {
  // 2026-09-10 根修：不 zip 两个独立 DOM 列表（row-major 顺序在异容器下可能
  // 不一致，实测把 H9/I8 读成 H7/H6）——按 SVG 坐标把 move-number 直接匹配到
  // 对应 board-hit（move-number 的 y 带 stoneRadius*.28 偏移，故 x 精确匹配 +
  // y 取最近），得到 (coord, n, player) 三元组。
  const data = await page.evaluate(() => {

    const cells = [...document.querySelectorAll(".board-hit")].filter((h) => (h.getAttribute("aria-label") || "").includes("已有棋子")).map((h) => ({ cx: parseFloat(h.getAttribute("cx")), cy: parseFloat(h.getAttribute("cy")), coord: ((h.getAttribute("aria-label") || "").match(/[A-O]\d{1,2}/) || [""])[0] }));
    const coordAt = (x, y) => {
      let best = "", bestD = Infinity;
      for (const c of cells) {
        if (Math.abs(c.cx - x) > 0.5) continue;
        const d = Math.abs(c.cy - y);
        if (d < bestD) { bestD = d; best = c.coord; }
      }
      return best;
    };
    return [...document.querySelectorAll("text.move-number")].map((t) => {
      const coord = coordAt(parseFloat(t.getAttribute("x")), parseFloat(t.getAttribute("y")));
      return coord ? { coord, n: Number(t.textContent), player: t.classList.contains("white") ? "white" : "black" } : null;
    }).filter(Boolean);
  });
  if (!data.length) return null;
  return data.sort((a, b) => a.n - b.n);
};

// S3: 索索夫-8 端到端（开局引擎自动前 3 手：n1=H8，n2/n3=簿组内随机——动态跟线）
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("AI"))?.click(); });
await page.waitForTimeout(900);
// 弹窗难度行右侧的开局库开关（与设置页同一状态源，S2 已开启 → pressed=true）
const bookToggle = await page.evaluate(() => {
  const b = document.querySelector(".ai-setup-book-toggle");
  return b ? { present: true, pressed: b.getAttribute("aria-pressed") === "true", text: (b.textContent || "").trim() } : { present: false };
});
check("S3a0 人机弹窗难度行含开局库开关且与设置页联动", bookToggle.present && bookToggle.pressed, JSON.stringify(bookToggle));
await page.evaluate(() => { const x = [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("有禁手")); x?.click(); });
await page.waitForTimeout(500);
const rulePicked = await page.evaluate(() => { const sos = [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes("索索夫-8")); if (sos) { sos.click(); return true; } return false; });
check("S3a 规则浮层含索索夫-8", rulePicked);
await page.waitForTimeout(300);
await page.evaluate(() => { const w = [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("执白")); w?.click(); });
await page.evaluate(() => { const b = [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战")); b?.click(); });
await page.waitForTimeout(7000);
const seq = await stoneSequence();
const okSeq = !!seq && seq.length === 3 && seq[0].coord === "H8" && seq[0].player === "black" && seq[1].player === "white" && seq[2].player === "black";
check("S3b 开局自动前3手（n1=黑H8 + 手数颜色完整）", okSeq, JSON.stringify(seq));
if (!okSeq) { console.log("无法还原实际开局手序，后续断言无意义"); await browser.close(); process.exit(1); }
const lineName = seq.map((s) => s.coord).join("/");

// 第3手后白方有交换决策：选择不交换（保持簿线），否则棋盘锁定
let swapped = false;
for (let i = 0; i < 12 && !swapped; i += 1) {
  swapped = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "不交换"); if (b) { b.click(); return true; } return false; });
  if (!swapped) await page.waitForTimeout(500);
}
console.log("交换决策「不交换」:", swapped);
await page.waitForTimeout(1500);

// 索索夫-8：白方落第4手时宣布打点数。T31 起为 1–8 选择按钮组——必须精确点「3个打点」
// （宣布几，AI 摆几；点错组内其它钮会让 S3d 的簿 rank 层数断言连锁失真）。
const declareCount = () => page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => /^3个打点/.test((e.textContent || "").trim())); if (b) { b.click(); return true; } return false; });
console.log("宣布3打(第4手前):", await declareCount());
await page.waitForTimeout(800);

// 人(白) 第4手 = 实际线簿 rank 层最强点（簿键按实际前 3 手动态构建）
const prefixPairs = [[7, 7], nameToPair(seq[1].coord), nameToPair(seq[2].coord)];
const rankKey = JSON.stringify(prefixPairs);
const rankEntries = (book.positions[rankKey] || []).filter((e) => /^\d+\*?$/.test(e.l));
check(`S3c 实际线 ${lineName} 在簿中 rank 层存在`, rankEntries.length > 0, `entries=${rankEntries.length}`);
if (!rankEntries.length) { console.log("实际线不在簿内（摆子链与簿脱节），后续断言无意义"); await browser.close(); process.exit(1); }
const fourth = rankEntries[0]; // [row,col]
const fourthName = `${String.fromCharCode(65 + fourth.p[1])}${15 - fourth.p[0]}`;
await clickPoint(fourthName);
console.log(`人第4手 ${fourthName} 后棋盘:`, JSON.stringify(await occupied()));
const declareAt = Date.now();
console.log("宣布3打(第4手后):", await declareCount());
// 宣布后黑方（AI）仍有一次交换权：若弹出决策，点「不交换」
await page.waitForTimeout(1200);
await page.evaluate(() => { const x = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "不交换"); x?.click(); });
// AI 提供打点（簿命中应为毫秒级；引擎路径 ≥2.2s）
let offerToast = "";
let offerMs = -1;
for (let i = 0; i < 30; i += 1) {
  offerToast = await toast();
  if (/AI 已提供/.test(offerToast)) { offerMs = Date.now() - declareAt; break; }
  await page.waitForTimeout(500);
}
const candidates = await page.evaluate(() => [...document.querySelectorAll(".opening-candidate")].map((e) => e.getAttribute("aria-label") || ""));
const expectedBookCount = (book.positions[JSON.stringify([...prefixPairs, fourth.p])] || []).filter((e) => /^\d+\*?$/.test(e.l)).length;
check("S3d AI 按簿提供打点（候选数=簿 rank 层数）", candidates.length > 0 && candidates.length === expectedBookCount, `candidates=${JSON.stringify(candidates)} toast=「${offerToast.slice(0, 60)}」 expected=${expectedBookCount}`);
check("S3d+ 簿命中为毫秒级（引擎路径 ≥4s）", offerMs >= 0 && offerMs < 2500, `offerMs=${offerMs}`);

// 人选一候选完成第5手：点簿内第一个 rank 点对应的棋盘格（choose-fifth 点选）
const fifthKey = JSON.stringify([...prefixPairs, fourth.p]);
const fifthCandidates = (book.positions[fifthKey] || []).filter((e) => /^\d+\*?$/.test(e.l));
if (fifthCandidates.length) {
  const pick = fifthCandidates[0];
  await clickPoint(`${String.fromCharCode(65 + pick.p[1])}${15 - pick.p[0]}`);
}
await page.waitForTimeout(1500);
// 第5手定形后白方仍可能有交换权：不交换
await page.evaluate(() => { const x = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "不交换"); x?.click(); });
await page.waitForTimeout(1500);
const afterFifth = await occupied();
const fifthName = fifthCandidates.length ? `${String.fromCharCode(65 + fifthCandidates[0].p[1])}${15 - fifthCandidates[0].p[0]}` : "";
check("S3e 第5手按簿候选落位（5子且含簿 rank 首点）", afterFifth.length === 5 && Boolean(fifthName) && afterFifth.includes(fifthName), JSON.stringify(afterFifth));
// 人(白) 第6手：取当前任意空位（动态线不能假定 H4 未被占）；簿 6子 key 若缺数据
// AI 第7手走引擎——都属正常，只要求对局推进。
const sixth = await page.evaluate(() => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => /^[A-O]\d{1,2}空位$/.test(e.getAttribute("aria-label") || "")); const m = (c?.getAttribute("aria-label") || "").match(/[A-O]\d{1,2}/); return m ? m[0] : "H4"; });
await clickPoint(sixth);
await page.waitForTimeout(10000); // AI 第7手
const afterSeventh = await occupied();
check("S3f 对局继续推进（≥7子）", afterSeventh.length >= 7, JSON.stringify(afterSeventh));
check("S4 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
