import { chromium } from "playwright";

// 门禁：整局复盘三件套 + 分析结果沉淀 + 对局读秒/自动存档（用户 09-17 第一梯队 ①②④）。
//
// 用**假引擎**做端到端：拦截 rapfi-worker.js，返回确定性的落点与 winRate，
// 于是复盘的分档/曲线/讲解完全可断言（真引擎太慢且数字随预算漂移）。
// 假 winRate 按手数查表（黑方视角）：[50,50,60,40,70,30,80,20,90,5]。
// 人执黑连五 H8-I8-J8-K8-L8，AI 走角落散子（首空格扫描），终局 9 手、10 个局面。
// AI 的应手恰好就是假引擎的最佳点 → AI 的 4 手 + 第 1 手（50→50 零损失）= 最佳 5；
// 黑方错着 3 手（损失 20/40/60/85 中的后三个 >20）= 失误 1（20 恰在边界内）+ 败着 3。
// 期望分档：最佳 5、失误 1、败着 3；最差三手 = 第9/7/5 手（黑方，-85/-60/-40）。
//
// 断言：终局面板显式保存入库（结果=黑胜）→「复盘这局」→ 曲线/分档/最差三手/讲解词
// → 点最差手跳手 → 重载后复盘结果与「上次分析」缓存仍在（沉淀）→ 读秒选项存在。
//
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-game-review-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5193/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
// 假引擎通过「页面内覆盖 window.Worker」注入：Playwright 的 route.fulfill 对
// worker 脚本请求不可靠（Chromium 的 worker 脚本加载拿不到 fulfill 响应，只报
// 一个无消息的 error，实测复现），Blob URL 则完全绕开网络层，确定性相同。
const FAKE_WORKER = `
const post = (m) => self.postMessage(m);
const RATE_TABLE = [50, 50, 60, 40, 70, 30, 80, 20, 90, 5, 5, 5];
self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "warmup") { post({ type: "ready", variant: "fallback" }); return; }
  if (msg.type !== "analyze") return;
  const size = msg.size || 15;
  const moves = Array.isArray(msg.moves) ? msg.moves : [];
  const occupied = new Set(moves.map((m) => m.row + "," + m.col));
  let move = null;
  outer: for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!occupied.has(row + "," + col)) { move = { row, col }; break outer; }
    }
  }
  const blackRate = RATE_TABLE[Math.min(moves.length, RATE_TABLE.length - 1)];
  // 引擎协议：winRate 是「行棋方视角」（App 侧按 msg.player 翻回黑方视角）。
  // RATE_TABLE 是黑方视角 → 发给引擎前按行棋方翻面。
  const moverRate = (msg.player === "white" ? 100 - blackRate : blackRate) / 100;
  post({
    type: "result", requestId: msg.requestId, generation: msg.generation, variant: "fallback",
    result: {
      move, score: 20, scoreAvailable: true, depth: 8, selDepth: 9, nodes: 1000, speed: 5000,
      elapsedMs: 4, illegalRejected: 0, reason: "rapfi", source: "rapfi",
      principalVariation: [], winRate: moverRate,
      candidates: [{ move, score: 20, winRate: moverRate, depth: 8, pvIndex: -1, principalVariation: [] }],
    },
  });
};
`;
const INSTALL_FAKE = `
(() => {
  const source = ${JSON.stringify(FAKE_WORKER)};
  const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  const Original = window.Worker;
  function Patched(url_, options) {
    if (String(url_).includes("rapfi/rapfi-worker")) return new Original(url, options);
    return new Original(url_, options);
  }
  Patched.prototype = Original.prototype;
  window.Worker = Patched;
})();
`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.addInitScript(INSTALL_FAKE);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(2400);

let failed = 0;
/**
 * 打开人机对战设置浮层（幂等）。09-28 起点「人机对战」可能先弹「回到上次对局」
 * （上一轮留下的未结束/未收尾的对局），这条路要开新局，所以一律选「放弃这局，开新局」——
 * 那一下本身就会把设置浮层打开，**不要再点一次入口**（会重复触发）。
 */
const openAiSetup = async () => {
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(900);
  if (await page.locator("[data-duel-resume-new]").count()) {
    await page.locator("[data-duel-resume-new]").click();
    await page.waitForTimeout(800);
  }
  await page.locator(".ai-game-setup").waitFor({ timeout: 8000 });
};

const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join("|").slice(0, 160));
const clickPoint = async (n) => { await page.evaluate((pt) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => { const l = e.getAttribute("aria-label") || ""; return l.startsWith(pt) || l.endsWith(pt); }); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, n); await page.waitForTimeout(450); };
const clickAria = async (n) => { await page.evaluate((pt) => { const c = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "") === pt); c?.click(); }, n); await page.waitForTimeout(600); };
const clickText = async (t, selector = "button") => { await page.evaluate(([x, s]) => { [...document.querySelectorAll(s)].find((b) => (b.textContent || "").includes(x))?.click(); }, [t, selector]); await page.waitForTimeout(600); };
const libraryTitles = () => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]")).map((item) => item?.metadata?.title || ""); } catch { return []; } });
const stoneCount = () => page.evaluate(() => [...document.querySelectorAll(".board-hit")].map((h) => h.getAttribute("aria-label") || "").filter((l) => l.includes("已有棋子")).length);
// 带重试的落子：偶发点击被「AI 思考中」吞掉时，等回到自己回合再点，直到棋子数到位。
const humanMove = async (point, expectStones) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await stoneCount()) >= expectStones) return true;
    await page.evaluate((pt) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => { const l = e.getAttribute("aria-label") || ""; return l.startsWith(pt) || l.endsWith(pt); }); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, point);
    for (let i = 0; i < 12; i += 1) {
      if ((await stoneCount()) >= expectStones) break;
      await page.waitForTimeout(250);
    }
  }
  return (await stoneCount()) >= expectStones;
};

// ── S1 开对局，人执黑连五（假引擎秒应） ─────────────────────────────
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
await page.waitForTimeout(700);
await openAiSetup();
// 顺手选 60 秒读秒（QA 补覆盖：读秒倒数此前只有逻辑层验证，这里在真实对局里量）。
await page.evaluate(() => { const cell = [...document.querySelectorAll(".ai-game-setup .ai-setup-cell")].find((e) => (e.textContent || "").includes("不限")); cell?.click(); });
await page.waitForTimeout(600);
await page.evaluate(() => [...document.querySelectorAll(".ai-float-list button")].find((b) => (b.textContent || "").includes("60 秒"))?.click());
await page.waitForTimeout(600);
await page.evaluate(() => { const x = [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战")); x?.click(); });
await page.waitForTimeout(1500);
// 读秒倒数：轮到你了，状态条应显示「本手」且两次采样值不同（60000ms 档，2.6s 内必变）。
const readOff1 = await page.locator("[data-duel-my-time]").innerText().catch(() => "");
await page.waitForTimeout(2600);
const readOff2 = await page.locator("[data-duel-my-time]").innerText().catch(() => "");
check("S1b 我方时间格显示本手读秒并在倒数", /^本手 \d+:\d+$/.test(readOff1) && Boolean(readOff2) && readOff1 !== readOff2, `${readOff1} → ${readOff2}`);
await page.waitForTimeout(1200);
for (const [point, expect] of [["H8", 2], ["I8", 4], ["J8", 6], ["K8", 8], ["L8", 9]]) {
  const ok = await humanMove(point, expect);
  if (!ok) check(`S1 落子 ${point}`, false, `stones=${await stoneCount()}`);
}
await page.waitForTimeout(1200);
// 09-28 起对局在自己的界面里结束：结果说在面板上，且**默认不自动入库**（用户要求
// 「不主动保存就不进棋谱库」），所以这一步要显式点「保存本局」再断言库里出现它。
const resultVisible = await page.locator("[data-duel-result]").isVisible().catch(() => false);
check("S1 连五后对弈界面给出终局面板", resultVisible);
const titlesBefore = await libraryTitles();
check("S2a 未点保存时不该进棋谱库（默认不自动存档）", !titlesBefore.some((t) => t.includes("人机对战·黑胜")), JSON.stringify(titlesBefore.slice(0, 4)));
await page.locator("[data-duel-save]").click();
await page.waitForTimeout(600);
const titles = await libraryTitles();
check("S2b 点「保存本局」后入库且结果为黑胜", titles.some((t) => t.includes("人机对战·黑胜")), JSON.stringify(titles.slice(0, 4)));

// ── S3 横幅「复盘本局」→ 自动开跑 → 完成 ────────────────────────────
const reviewButton = await page.locator("[data-duel-review]").isVisible().catch(() => false);
check("S3a 终局面板出现「复盘这局」按钮", reviewButton);
if (reviewButton) {
  await page.locator("[data-duel-review]").click();
  await page.waitForTimeout(900);
  const panelOpen = await page.locator(".ai-review-panel").isVisible().catch(() => false);
  check("S3b 点按钮打开分析面板并出现复盘区", panelOpen);
  let done = false;
  for (let i = 0; i < 40 && !done; i += 1) {
    done = await page.evaluate(() => [...document.querySelectorAll('[data-review-toggle="true"]')].some((b) => (b.textContent || "").includes("重新复盘")));
    if (!done) await page.waitForTimeout(400);
  }
  check("S3c 复盘自动开跑并完成", done);
  const curve = await page.evaluate(() => {
    const polyline = document.querySelector(".ai-review-curve polyline");
    if (!polyline) return 0;
    return (polyline.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).length;
  });
  check("S4a 曲线有 10 个评估点", curve === 10, `points=${curve}`);
  const grades = await page.evaluate(() => [...document.querySelectorAll(".ai-review-grade")].map((e) => e.textContent?.trim() || "").join("|"));
  check("S4b 分档统计=最佳5/失误1/败着3", grades.includes("最佳 5") && grades.includes("失误 1") && grades.includes("败着 3"), grades);
  const worst = await page.evaluate(() => [...document.querySelectorAll(".ai-review-worst button")].map((e) => e.textContent?.trim() || ""));
  check("S4c 最差三手列出且含败着", worst.length >= 3 && worst[0].includes("败着"), JSON.stringify(worst.slice(0, 3)));
  const summary = await page.evaluate(() => document.querySelector(".ai-review-text")?.textContent || "");
  check("S4d 讲解词含手数与分档小结", summary.includes("本局共 9 手") && summary.includes("败着 3") && summary.includes("引擎推荐"), summary.slice(0, 90));
  if (worst.length) {
    await page.locator(".ai-review-worst button").first().click();
    await page.waitForTimeout(700);
    const step = await page.evaluate(() => (document.body.innerText.match(/第 \d+ 手 \/ \d+/) || ["?"])[0]);
    check("S4e 点最差一手跳到第 9 手", step.includes("第 9 手"), step);
  }
}

// ── S5 重载后：复盘结果沉淀 + 「上次分析」缓存仍在 ───────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
await clickAria("分析");
await page.waitForTimeout(900);
// 面板默认停在「计算」页签；复盘内容在「复盘」页签里（09-19 三页签改版）。
const clickPanelTab = async (tab) => { await page.evaluate((t) => document.querySelector(`[data-panel-tab="${t}"]`)?.click(), tab); await page.waitForTimeout(500); };
await clickPanelTab("review");
let storedSummary = await page.evaluate(() => document.querySelector(".ai-review-text")?.textContent || "");
if (!storedSummary) {
  // 自动恢复没落在这份棋谱时，从棋谱库手动打开。
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("棋谱库"))?.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const target = [...document.querySelectorAll("article h3")].find((h) => (h.textContent || "").includes("人机对战·黑胜"));
    target?.closest("article")?.querySelector("button, h3")?.click();
  });
  await page.waitForTimeout(1200);
  await clickAria("分析");
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('[data-panel-tab="review"]')?.click());
  await page.waitForTimeout(500);
  storedSummary = await page.evaluate(() => document.querySelector(".ai-review-text")?.textContent || "");
}
check("S5a 重载后复盘结果直接显示（沉淀）", storedSummary.includes("本局共 9 手"), storedSummary.slice(0, 90));
await clickPanelTab("compute"); // 缓存行在「计算」页签
await clickAria("到第一手");
await page.waitForTimeout(800);
const cachedRow = await page.locator(".ai-analysis-cached").isVisible().catch(() => false);
check("S5b 出现「上次分析」缓存行", cachedRow);
if (cachedRow) {
  await page.locator(".ai-analysis-cached button").click();
  await page.waitForTimeout(700);
  const depth = await page.evaluate(() => document.querySelector(".ai-analysis-stats .stat-depth b")?.textContent || "");
  check("S5c 载入上次结果后深度显示 8-9", depth.includes("8"), depth);
}

// ── S5d 胜率页签：常态图由缓存/复盘样本合成，每个点可点跳手 ────────────
await clickPanelTab("winrate");
await page.waitForTimeout(700);
const winratePoints = await page.evaluate(() => {
  const polyline = document.querySelector(".ai-winrate-panel .ai-review-curve polyline");
  if (!polyline) return 0;
  return (polyline.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).length;
});
check("S5d-1 胜率页曲线有 10 个局面点", winratePoints === 10, `points=${winratePoints}`);
const coverage = await page.evaluate(() => document.querySelector(".ai-winrate-panel .ai-review-note")?.textContent || "");
check("S5d-2 覆盖文案显示 10/10 且无需补全", coverage.includes("10 / 10"), coverage.slice(0, 70));
const hitDots = await page.evaluate(() => document.querySelectorAll(".ai-winrate-panel .ai-review-dot-hit").length);
check("S5d-3 每个评估点都有可点热区", hitDots === 10, `dots=${hitDots}`);
// 游标双向同步（智子 VictoryCursorContainer 同款，09-19）：点/拖图表=棋盘走子，
// 棋盘导航=游标跟随。用坐标点击（贴近真实交互，也避开游标圆点对热区的遮挡）。
const cursorX1 = () => page.evaluate(() => { const line = document.querySelector('.ai-winrate-panel [data-chart-cursor="true"] line'); return line ? Number(line.getAttribute("x1")) : null; });
const chartBox = await page.locator(".ai-winrate-panel .ai-review-curve svg").boundingBox();
check("S5d-4 游标竖线存在", (await cursorX1()) !== null, `x1=${await cursorX1()}`);
if (chartBox) {
  // ① 棋盘→图：当前在根局面，游标贴最左。
  let x1 = await cursorX1();
  check("S5d-5 棋盘在根局面时游标贴左（x≈0）", x1 !== null && x1 < 5, `x1=${x1}`);
  // ② 图→棋盘：点曲线最右端，棋盘走到第 9 手，游标贴最右。
  await page.mouse.click(chartBox.x + chartBox.width - 3, chartBox.y + 30);
  await page.waitForTimeout(800);
  const step2 = await page.evaluate(() => (document.body.innerText.match(/第 \d+ 手 \/ \d+/) || ["?"])[0]);
  check("S5d-6 点曲线右端棋盘走到第 9 手", step2.includes("第 9 手"), step2);
  x1 = await cursorX1();
  check("S5d-7 游标跟随到最右（x≈100）", x1 !== null && x1 > 90, `x1=${x1}`);
  // ③ 拖动 scrub：从最右拖回最左，棋盘同步回到根局面。
  await page.mouse.move(chartBox.x + chartBox.width - 3, chartBox.y + 30);
  await page.mouse.down();
  await page.mouse.move(chartBox.x + 3, chartBox.y + 30, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const step3 = await page.evaluate(() => (document.body.innerText.match(/第 \d+ 手 \/ \d+/) || ["?"])[0]);
  check("S5d-8 拖动游标到最左棋盘回到第 0 手", step3.includes("第 0 手"), step3);
  // 09-19 起图下文字拆成两行（图例 / 游标读数，用户要求最多两行），游标读数在第二个 small，
  // 并且曲线上还浮了一个「黑 X%」读数——两处都算数，只要有一处如实显示当前手与胜率即可。
  const cursorInfo = await page.evaluate(() => {
    const curve = document.querySelector(".ai-winrate-panel .ai-review-curve");
    const lines = [...(curve?.querySelectorAll(":scope > small") || [])].map((el) => el.textContent || "");
    const readout = curve?.querySelector(".ai-curve-readout")?.textContent || "";
    return `${lines.join(" | ")} | 浮层:${readout}`;
  });
  check("S5d-9 游标读数显示当前手与胜率", cursorInfo.includes("当前 第 0 手") && /黑方 \d+%|黑 \d+%/.test(cursorInfo), cursorInfo.slice(0, 120));
  const readoutOnChart = await page.evaluate(() => {
    const el = document.querySelector(".ai-winrate-panel .ai-curve-readout");
    return el ? { text: (el.textContent || "").trim(), visible: el.getBoundingClientRect().width > 0 } : null;
  });
  check("S5d-10 游标处浮出胜率读数（贴在曲线上，不只是图下一行字）", Boolean(readoutOnChart?.visible) && /黑 \d+%/.test(readoutOnChart?.text || ""), JSON.stringify(readoutOnChart));
  const axis = await page.evaluate(() => [...document.querySelectorAll(".ai-winrate-panel .ai-curve-axis span")].map((el) => el.textContent));
  const chartHeight = await page.evaluate(() => Math.round(document.querySelector(".ai-winrate-panel .ai-review-curve svg")?.getBoundingClientRect().height || 0));
  check("S5d-11 左侧有 100/75/50/25/0 刻度轴，且图已加高（≥120px）", axis.join(",") === "100,75,50,25,0" && chartHeight >= 120, `轴=${axis.join(",")} 高度=${chartHeight}px`);
}
await clickPanelTab("compute");
await page.waitForTimeout(400);

// ── S6 每手读秒选项（对局设置浮层） ──────────────────────────────────
// 09-28 起：这盘棋还「开着」（终局面板留在对弈界面里），所以回「对弈」看到的是对局界面
// 而不是入口页——先点「完成」收掉这局，才回到入口页去开新局设置。
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
await page.waitForTimeout(700);
await openAiSetup();
await page.evaluate(() => { const cell = [...document.querySelectorAll(".ai-game-setup .ai-setup-cell")].find((e) => (e.textContent || "").includes("分钟") || (e.textContent || "").includes("不限")); cell?.click(); });
await page.waitForTimeout(600);
const readOffHead = await page.evaluate(() => [...document.querySelectorAll(".ai-float-subhead")].some((e) => (e.textContent || "").includes("每手读秒")));
check("S6a 时长浮层出现「每手读秒」分组", readOffHead);
const readOffOptions = await page.evaluate(() => [...document.querySelectorAll(".ai-float-list button")].map((e) => e.textContent || "").filter((t) => t.includes("秒")));
check("S6b 读秒选项含 30 秒与 60 秒", readOffOptions.some((t) => t.includes("30 秒")) && readOffOptions.some((t) => t.includes("60 秒")), JSON.stringify(readOffOptions));
await clickText("60 秒");
await page.waitForTimeout(600);
const cellText = await page.evaluate(() => [...document.querySelectorAll(".ai-game-setup .ai-setup-cell")].map((e) => e.textContent || "").find((t) => t.includes("读秒")) || "");
check("S6c 选择后时间行显示 60 秒读秒", cellText.includes("60 秒读秒"), cellText.slice(0, 60));

check("页面无未捕获异常", errors.length === 0, errors.join(" | ").slice(0, 160));
await browser.close();
console.log(failed === 0 ? "ALL PASS" : `FAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);
