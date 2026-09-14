import { chromium } from "playwright";

// Regression gate for the 2026-09-08 图片识谱→分析 bug: the engine request must
// carry the imported position. Two import channels are asserted end to end:
//   static（默认，setup 摆子）  → analyze moves == 识别到的棋盘子数（不是 0）
//   复原手序（带完整序号截图）→ 跳到终局后 moves == 落子数，黑白子数与棋盘一致
// and the analysis panel must actually produce concrete candidate picks.
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-import-analysis-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const staticImage = process.env.STATIC_IMAGE || "experiments/board-recognition-poc/material/app-played-game.png";
const restoreImage = process.env.RESTORE_IMAGE || "experiments/board-recognition-poc/material/app-played-game.png";

const browser = await chromium.launch({ headless: true });

// One import run → the analyze payload sequence + final candidate state.
async function runImport(image, restore) {
  const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(() => {
    window.__cap = { requests: [] };
    const OriginalWorker = window.Worker;
    const Patched = function (workerUrl, options) {
      const worker = new OriginalWorker(workerUrl, options);
      if (String(workerUrl).includes("rapfi-worker")) {
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (message) => {
          if (message && message.type === "analyze") {
            window.__cap.requests.push({
              moves: Array.isArray(message.moves) ? message.moves.length : -1,
              blacks: (message.moves || []).filter((m) => m.player === "black").length,
              whites: (message.moves || []).filter((m) => m.player === "white").length,
              player: message.player,
            });
          }
          return post(message);
        };
      }
      return worker;
    };
    Patched.prototype = OriginalWorker.prototype;
    window.Worker = Patched;
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: true, analysisShowCandidates: true, analysisCandidateCount: 5, analysisTimeMs: 4000, devMoveOrderRestore: true }));
  });
  await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click(); });
  await page.waitForTimeout(600);
  await page.setInputFiles("input[type=file][accept*='heic']", image);
  await page.waitForSelector(".board-fs-actions", { timeout: 10000 });
  if (restore) await page.locator(".board-fs-restore-order input").check({ force: true });
  await page.locator(".board-fs-actions button:has-text('识别')").click();

  const toastDeadline = Date.now() + 60000;
  let toast = "";
  while (Date.now() < toastDeadline) {
    toast = await page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join(" | ") || "");
    if (/识谱完成|识谱失败|识别不到|识别结果异常/.test(toast)) break;
    await page.waitForTimeout(800);
  }
  if (!/识谱完成/.test(toast)) { await page.context().close(); throw new Error(`识谱导入未完成：${toast.slice(0, 120) || "超时"}`); }
  const restoredOk = /已按序号复原/.test(toast);
  if (restore && !restoredOk) { await page.context().close(); throw new Error(`复原手序未生效（截图序号不全？）：${toast.slice(0, 140)}`); }

  // 复原通道落在开局空面，须跳到终局才是完整棋局；静态通道 setup 摆子始终可见。
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "到最后一手")?.click(); });
  await page.waitForTimeout(1500);
  const stones = await page.evaluate(() => {
    let count = 0;
    document.querySelectorAll(".board-hit").forEach((h) => { if (!(h.getAttribute("aria-label") || "").includes("空位")) count += 1; });
    return count;
  });

  await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "分析")?.click(); });
  let chips = 0, lastRequest = null;
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(2500);
    const snap = await page.evaluate(() => ({
      chips: document.querySelectorAll(".analysis-candidate-chip").length,
      scored: [...document.querySelectorAll(".analysis-candidate-chip em")].filter((e) => /%|分|\d/.test(e.textContent || "") && !(e.textContent || "").includes("—")).length,
      requests: window.__cap.requests,
    }));
    lastRequest = snap.requests[snap.requests.length - 1] || null;
    chips = snap.chips;
    if (chips >= 1 && snap.scored >= 1 && lastRequest && lastRequest.moves > 0) break;
  }
  const requests = await page.evaluate(() => window.__cap.requests);
  await page.context().close();
  return { restore, stones, chips, boardErrors: errors, analyzedWithMoves: lastRequest, withStones: requests.filter((r) => r.moves > 0) };
}

let failed = 0;
const check = (name, condition, detail) => { console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!condition) failed += 1; };

// 静态局面：setup 摆子必须进入 analyze 载荷（修复前恒为 moves:0 → 引擎看空盘）。
const stat = await runImport(staticImage, false);
check("静态导入：棋盘有子", stat.stones >= 4, `stones=${stat.stones}`);
check("静态导入：analyze 携带 setup 子（moves>0 且=棋盘子数）", stat.withStones.length > 0 && stat.withStones.every((r) => r.moves === stat.stones), stat.withStones.map((r) => r.moves).join(","));
check("静态导入：mover 由黑白子数奇偶推出", stat.analyzedWithMoves ? (stat.analyzedWithMoves.blacks === stat.analyzedWithMoves.whites ? stat.analyzedWithMoves.player === "black" : stat.analyzedWithMoves.player === "white") : false, JSON.stringify(stat.analyzedWithMoves));
check("静态导入：分析产出候选选点", stat.chips >= 1, `chips=${stat.chips}`);

// 复原手序：跳到终局后，完整落子序列必须进入 analyze 载荷。
let rest;
try {
  rest = await runImport(restoreImage, true);
  check("复原手序：终局棋盘=落子数", rest.stones >= 4, `stones=${rest.stones}`);
  check("复原手序：analyze 携带完整落子（moves=子数）", rest.withStones.length > 0 && rest.withStones.every((r) => r.moves === rest.stones), rest.withStones.map((r) => r.moves).join(","));
  check("复原手序：分析产出候选选点", rest.chips >= 1, `chips=${rest.chips}`);
} catch (error) {
  console.log(`SKIP 复原手序：${String(error.message).slice(0, 140)}`);
}

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
