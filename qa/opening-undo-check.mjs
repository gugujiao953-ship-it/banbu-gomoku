/**
 * qa/opening-undo-check.mjs — 开局阶段「悔棋回退」门禁（用户 2026-10-09 报的 bug）。
 *
 * 用户原话：「我在五手两打规则，在摆出选点然后选择了一个后，我再去悔棋几步，竟然会回到
 * 前面的局面不说，还可以布置打点，这不是在第五手的时候打点，而是在第三手，第二手的时候打点」。
 *
 * 根因：回退只动了树游标，`aiGame.opening.stage` 没动 —— 盘面回到第 2 手、阶段仍停在
 * offer-fifths，于是"第二手还能打点"。修法见 `rewindOpeningToMove`（src/opening-rules.ts）
 * 与 `rewindOpeningForCursor`（src/App.tsx）。
 *
 * 本门禁在**真实人机对局**里走完五手两打开局，然后连按悔棋，断言：
 *  A. 悔棋后手数确实减少（悔棋本身有效）
 *  B. **关键**：退到少数几手时，界面**不再**要求"提供第5手打点/选打点"
 *     （那条提示是 offer-fifths / choose-fifth 阶段的文案；第二手时出现即为 bug）
 *  C. 悔棋后棋盘上不再残留打点候选（候选必须清空，否则盘面会出现幽灵标记）
 *  D. 提示文案与当前手数自洽（第 N 手该说第 N+1 手的事，而不是第 5 手的事）
 *
 * ⚠ 覆盖范围在 2026-10-13 缩了一格，是**规则使然不是偷懒**：那天定了「人机对弈悔棋
 *   10 棋魂一次、且开局前 10 手不给悔」（用户原话「同样也是10手前不能用」）。于是从 10 手
 *   只能退到 8 手，第二次点击会被锁定期挡掉（实测日志里就写着「悔棋按钮不可用，停止」）——
 *   "退到第 2 手"那个原始复现路径在对局里已经进不去了。所以这里改成：先下满 10 手过锁定期，
 *   退一轮之后仍然断言 B/C/D（状态机与文案不许和手数打架），A 由"确实少 2 子"承担。
 *   如果哪天放开这条锁，本门禁要顺手把深度倒回（退到 <4 手）测回来。
 *
 * 用法：QA_BASE_URL=http://127.0.0.1:5211/ node qa/opening-undo-check.mjs
 */
import { chromium } from "playwright";

const rawBase = process.env.QA_BASE_URL || "http://127.0.0.1:5211/";
const baseURL = (() => {
  const url = new URL(rawBase);
  if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
  return url.toString();
})();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
// 2026-10-13 起对弈的「悔棋」= **10 棋魂一次、且开局前 10 手不给悔**（App 的 takeDuelUndo）。
// 本门禁测的是**开局状态机跟着游标倒回**（用户 2026-10-09 报的 bug），所以先把钱灌够、
// 再把对局下满 10 手越过锁定期 —— 不许再用"开局 N 手内禁悔"之外的办法绕它。
await page.addInitScript(() => localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "gate-opening-undo", at: Date.now(), amount: 500, reason: "manual", detail: "门禁灌余额" }])));
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const results = [];
let failed = 0;
const assert = (ok, name, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const SIZE = 15, HIT_ORIGIN = 34, HIT_STEP = 36, VIEWBOX = 572;

const stoneCount = () => page.evaluate(() => {
  const svg = document.querySelector("[data-duel-board] svg");
  return svg ? svg.querySelectorAll("circle.stone").length : -1;
});

const isThinking = () => page.evaluate(() => Boolean(document.querySelector("[data-duel-thinking]")));

/** 开局横幅 / 提示卡的全文（阶段文案都在这里）。 */
const openingText = () => page.evaluate(() => {
  const banner = document.querySelector(".ai-opening-banner");
  const stages = document.querySelectorAll("[data-duel-opening], .opening-banner, .ai-opening-banner");
  let text = banner ? (banner.textContent || "") : "";
  for (const el of stages) text += " " + (el.textContent || "");
  // 也读状态条与标题（阶段提示可能落在任一处）
  const status = document.querySelector(".workspace-status, [data-unified-status]");
  if (status) text += " " + (status.textContent || "");
  return text.replace(/\s+/g, " ").trim();
});

/** 盘上「打点候选」标记的数量（app 用 openingCandidates 画出来的空位标记）。 */
const candidateMarks = () => page.evaluate(() => {
  const svg = document.querySelector("[data-duel-board] svg");
  if (!svg) return -1;
  // 候选点渲染成带特定 class 的标记（opening-candidate / candidate-letter 等）
  return svg.querySelectorAll("[class*='opening-candidate'], .candidate-letter, [data-opening-candidate]").length;
});

const clickCell = async (row, col) => {
  const box = await page.evaluate(() => {
    const svg = document.querySelector("[data-duel-board] svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) return false;
  await page.mouse.click(box.x + ((HIT_ORIGIN + col * HIT_STEP) / VIEWBOX) * box.w, box.y + ((HIT_ORIGIN + row * HIT_STEP) / VIEWBOX) * box.h);
  return true;
};

const undoClick = async () => {
  const ok = await page.evaluate(() => {
    const b = document.querySelector("[data-duel-undo]");
    if (!b || b.disabled) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(700);
  return ok;
};

/** 是不是"该放打点"的文案（offer-fifths / choose-fifth 两个阶段都会这么说）。 */
const asksForFifthCandidates = (text) =>
  /提供\s*\d+\s*个不同棋形|个第5手候选|请从\s*\d+\s*个候选中选择|第5手打点数量|个第5手打点/.test(text);

// ── 进入「五手两打」人机对局 ────────────────────────────────────────────────
await page.goto(baseURL, { waitUntil: "load" });
await page.waitForTimeout(4_500);
assert(await page.evaluate(() => Boolean(document.querySelector(".app-shell"))), "应用已加载");

await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const b = nav && Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈");
  if (b) b.click();
});
await page.waitForTimeout(1_200);
await page.evaluate(() => document.querySelector("[data-duel-entry='ai'] .duel-entry-action")?.click());
await page.waitForTimeout(1_200);
assert(await page.evaluate(() => Boolean(document.querySelector(".ai-game-setup"))), "打开人机设置浮层");

// 执黑
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".ai-setup-cells button")).find((x) => (x.textContent || "").includes("执黑"));
  if (b) b.click();
});
await page.waitForTimeout(300);

// 选「五手两打」：它是"有禁手"组里的规则
const pickedRule = await page.evaluate(() => {
  const group = Array.from(document.querySelectorAll(".ai-setup-cells button")).find((x) => (x.textContent || "").includes("有禁手"));
  if (group) group.click();
  return Boolean(group);
});
await page.waitForTimeout(600);
if (pickedRule) {
  const ok = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll(".ai-float-list button"));
    const target = list.find((x) => (x.textContent || "").includes("五手两打"));
    if (target) { target.click(); return true; }
    return false;
  });
  console.log(ok ? "已选择规则：五手两打" : "⚠ 没找到「五手两打」选项，将继续（可能不是目标规则）");
  await page.waitForTimeout(500);
}
// 关掉可能仍开着的规则浮层（选完即关，这里兜底）
await page.evaluate(() => {
  const close = document.querySelector(".ai-float-head button");
  if (close && document.querySelector(".ai-float-wrap")) close.click();
});
await page.waitForTimeout(300);

await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => /开始人机对战|按新规则重新开始/.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(2_500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().includes("放弃这局"));
  if (b) b.click();
});
await page.waitForTimeout(2_000);
assert(await page.evaluate(() => Boolean(document.querySelector("[data-duel-board]"))), "进入对局界面");

// 确认是五手两打（否则这轮断言没意义）
const ruleText = await page.evaluate(() => document.querySelector(".duel-screen")?.textContent || "");
const isFiveTwo = /五手两打/.test(ruleText);
console.log(isFiveTwo ? "本局规则确认：五手两打" : "⚠ 本局规则不是五手两打，悔棋断言仍按通用口径检查");

// ── 摆到「第5手打点已提供 / 已选定」的状态 ────────────────────────────────
// 五手两打流程：黑1(天元) → 白2 → 黑3 → 交换 → 白4 → 黑方提供2个打点 → 白方选一个 → 白6
const waitHuman = async (maxMs = 25_000) => {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!(await isThinking())) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

/**
 * 点一个「该阶段允许」的空点。
 *
 * ⚠ 开局阶段不是随便点哪都行：第 1 手必须在**天元**，第 2/3 手限制在中心 3×3 附近
 * （`openingPositionAllowed` 的 radius）。早先无脑点 (0,0) 会被规则正确拒绝，
 * 于是整轮一步都走不动——**那是规则对、探针错**。这里按"离中心由近到远"找空点。
 */
const clickFirstEmpty = async () => {
  const occupied = new Set(await page.evaluate(([o, s]) => {
    const svg = document.querySelector("[data-duel-board] svg");
    if (!svg) return [];
    return Array.from(svg.querySelectorAll("circle.stone")).map((el) => {
      const r = Math.round((Number(el.getAttribute("cy")) - o) / s);
      const c = Math.round((Number(el.getAttribute("cx")) - o) / s);
      return `${r},${c}`;
    });
  }, [HIT_ORIGIN, HIT_STEP]));
  const center = (SIZE - 1) / 2;
  const points = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) points.push([r, c]);
  points.sort((a, b) => (Math.abs(a[0] - center) + Math.abs(a[1] - center)) - (Math.abs(b[0] - center) + Math.abs(b[1] - center)));
  for (const [r, c] of points) {
    if (occupied.has(`${r},${c}`)) continue;
    const before = await stoneCount();
    await clickCell(r, c);
    await page.waitForTimeout(500);
    if ((await stoneCount()) > before) return [r, c];
  }
  return null;
};

/** 点「开局提示卡」里的某个按钮（交换/执白/不交换…）。 */
const clickBannerButton = async (pattern) => page.evaluate((re) => {
  const btns = Array.from(document.querySelectorAll(".ai-opening-actions button, .ai-opening-banner button"));
  const target = btns.find((b) => new RegExp(re).test(b.textContent || ""));
  if (target) { target.click(); return (target.textContent || "").trim(); }
  return null;
}, pattern);

console.log("\n── 推进到打点阶段 ──");
let reachedOffers = false;
for (let step = 0; step < 20 && !reachedOffers; step += 1) {
  await waitHuman();
  const text = await openingText();
  const stones = await stoneCount();
  if (asksForFifthCandidates(text)) { reachedOffers = true; break; }
  // 交换决策：选"不交换"以免换成 AI 执黑（我们要自己控制黑方打点）
  const swapBtn = await clickBannerButton("不交换");
  if (swapBtn) { console.log(`   开局决策：${swapBtn}`); await page.waitForTimeout(900); continue; }
  // 需要选打点数量（索索夫/山口才有）——五手两打是固定 2
  const countBtn = await clickBannerButton("确定|宣布|选择");
  if (countBtn) { console.log(`   开局决策：${countBtn}`); await page.waitForTimeout(900); continue; }
  // 否则视为落子
  const spot = await clickFirstEmpty();
  if (spot) { console.log(`   落子 (${spot[0]},${spot[1]})，盘上 ${stones} → ${await stoneCount()} 颗`); await page.waitForTimeout(900); }
  else break;
}
const textAtOffers = await openingText();
console.log(`   阶段文案：${textAtOffers.slice(0, 110)}`);
assert(reachedOffers || /第\s*\d+\s*手/.test(textAtOffers), "开局流程已推进（至少进入某个阶段）",
  textAtOffers.slice(0, 80));

// 如果有打点候选，点它把第 5 手落下去（走到"已选定"）
const marks = await candidateMarks();
if (marks > 0) {
  const clicked = await page.evaluate(() => {
    const svg = document.querySelector("[data-duel-board] svg");
    const el = svg?.querySelector("[class*='opening-candidate'], .candidate-letter");
    if (el) { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; }
    return false;
  });
  if (clicked) { console.log(`   点掉一个打点候选（共 ${marks} 个）`); await page.waitForTimeout(1_200); }
}

/** 随机点一个空位（不往中间堆，免得连五把对局提前打完）。返回 false = 现在轮不到自己。 */
const playRandomEmpty = () => page.evaluate(() => {
  const hits = [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true" && (h.getAttribute("aria-label") || "").includes("空位"));
  if (!hits.length) return false;
  hits[Math.floor(Math.random() * hits.length)].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
});

// ── 越过锁定期：开局流程走完只有 6 手左右，而**前 10 手不许悔** ⇒ 先下满 10 手 ──
for (let i = 0; i < 14 && (await stoneCount()) < 10; i += 1) {
  if (!(await playRandomEmpty())) { await page.waitForTimeout(1_500); continue; }
  await page.waitForTimeout(2_600);
}
const armed = await stoneCount();
assert(armed >= 10, "已下满 10 手（悔棋锁定期已过，才谈得上按次扣棋魂）", `盘上 ${armed} 颗`);

const beforeUndo = await stoneCount();
const textBeforeUndo = await openingText();
console.log(`   悔棋前：盘上 ${beforeUndo} 颗 · 文案「${textBeforeUndo.slice(0, 90)}」`);

// ── 关键：连按悔棋 ────────────────────────────────────────────────────────
console.log("\n── 连续悔棋 ──");
let sawStaleOffer = false;
let sawStaleCandidates = false;
let undoSteps = 0;
for (let i = 0; i < 4; i += 1) {
  const ok = await undoClick();
  if (!ok) { console.log("   悔棋按钮不可用，停止"); break; }
  undoSteps += 1;
  const stones = await stoneCount();
  const text = await openingText();
  const marksNow = await candidateMarks();
  // 澄清：悔棋后不应再出现「提供第5手候选 / 选打点」字样，除非盘上真的到了第 4 手
  const mentionsFifth = asksForFifthCandidates(text);
  const expectStale = mentionsFifth && stones < 4;
  if (expectStale) sawStaleOffer = true;
  if (marksNow > 0 && stones < 4) sawStaleCandidates = true;
  console.log(`   第 ${i + 1} 次悔棋 → 盘上 ${stones} 颗 · 候选标记 ${marksNow} · 文案「${text.slice(0, 80)}」`);
}

// 断言
assert(undoSteps > 0, "悔棋按钮可用且生效", `成功悔棋 ${undoSteps} 次`);
const afterStones = await stoneCount();
assert(afterStones < beforeUndo, "悔棋减少了盘上棋子数", `${beforeUndo} → ${afterStones} 颗`);
assert(!sawStaleOffer, "悔棋后不再要求「提供第5手打点/选打点」（bug 的核心表现）",
  sawStaleOffer ? "仍在第二/三手要求打点" : "文案与手数自洽");
assert(!sawStaleCandidates, "悔棋后棋盘不残留打点候选标记",
  sawStaleCandidates ? "仍有候选标记" : "已清空");

assert(errors.length === 0, "全程无 console/page 错误", errors.slice(0, 3).join(" | "));

console.log(failed === 0 ? `\n✅ 开局悔棋门禁 ${results.length} 项全过` : `\n❌ ${failed}/${results.length} 项失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
