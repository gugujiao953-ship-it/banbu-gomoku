/**
 * 成就与棋魂的端到端探针（2026-10-09）。
 *
 * 验四件事（都是"做完了但没接线"这类的典型漏洞）：
 *  1. 对弈页右上角确实出现两枚小按钮（战绩 / 成就）；
 *  2. 点开成就面板：棋魂余额、成就计数、五个分组都渲染出来；
 *  3. **造一个历史账本**（写 localStorage 再刷新）→ 成就自动兑现 + 解锁弹窗真的弹出来；
 *  4. 弹窗**不拦操作**（没有遮罩；点它下面/旁边的东西仍然生效）。
 *
 * 跑法：先起 preview（4321），再 `node qa/achievements-check.mjs`。
 * 用 playwright 直接驱动，照项目既有 QA 脚本的写法。
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4321/";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

// 抑制首运行欢迎（会挡住点击），照项目既有脚本的做法用 ?qa=1。
await page.goto(`${BASE}?qa=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(900);

/**
 * 去掉可能被别的会话临时插进页面的诊断条（`<pre data-tempdiag>`，z-index 99999、
 * 铺在视口底部、**load 后 3 秒**才出现）。它会拦住点击（实测 "intercepts pointer events"）。
 * 用 MutationObserver 常驻清除；只作用于本探针自己的页面，**不改别人的源文件**。
 */
const installTempDiagGuard = (target) => target.evaluate(() => {
  const strip = () => { for (const node of document.querySelectorAll("[data-tempdiag]")) node.remove(); };
  strip();
  // ⚠ 必须把 observer **存到 window 上**：不保存引用的 MutationObserver 会被 GC 回收、
  // 静默停止观察（实测就是这样——第一版没存，守卫等于没装，点击照旧被拦）。
  const w = window;
  w.__tempDiagObserver?.disconnect();
  w.__tempDiagObserver = new MutationObserver(strip);
  w.__tempDiagObserver.observe(document.body, { childList: true, subtree: true });
});

await installTempDiagGuard(page);

// ── 1. 对弈页两枚小按钮 ──────────────────────────────────────────────
await page.locator(".bottom-nav button", { hasText: "对弈" }).click();
await page.waitForTimeout(500);
const statsBtn = page.locator('[data-duel-stats]');
const achBtn = page.locator('[data-duel-achievements]');
check("对弈页有「战绩与等级分」按钮", await statsBtn.count() > 0);
check("对弈页有「成就」按钮", await achBtn.count() > 0);
check("对弈页有棋魂徽章（已独立成页，见 qa/soul-check.mjs）", await page.locator("[data-soul-badge]").count() > 0);

// ── 2. 打开成就面板 ─────────────────────────────────────────────────
await achBtn.first().click();
await page.waitForTimeout(600);
check("成就面板已打开", await page.locator("[data-achievements-panel]").count() > 0);
// 棋魂已从成就面板移出（用户 10-09 第二轮），这里反向钉住：面板里**不该**再有棋魂块。
const soulInPanel = await page.locator("[data-achievements-panel] [data-soul-balance]").count();
check("成就面板里没有残留的棋魂块（已移到对弈页）", soulInPanel === 0, `实测 ${soulInPanel} 处`);
const doneText = await page.locator("[data-achievements-done]").first().textContent().catch(() => null);
check("面板显示成就计数", /^\d+$/.test((doneText || "").trim()), `读到「${doneText}」`);
const groups = await page.locator(".achievements-group").count();
// 2026-10-10 加了第六组「棋魂」（连点九档 + 第一件收藏）—— 所以这里改成
// **从面板读实际分组标题**并逐一核对，而不是钉死一个数字（钉数字的话，
// 以后每加一组都要回来改门禁，而"加组"本身是正常的产品行为）。
const groupTitles = await page.locator(".achievements-group > header b").allTextContents();
const expected = ["对弈", "做题", "研究", "识谱", "探索", "棋魂"];
check("六个分组都渲染（对弈/做题/研究/识谱/探索/棋魂）",
  expected.every((title) => groupTitles.some((actual) => actual.includes(title))),
  `实测 ${groups} 组：${groupTitles.map((t) => t.trim()).join("/")}`);
const rows = await page.locator("[data-achievement-row]").count();
check("成就条目已铺开（≥40 条）", rows >= 40, `实测 ${rows} 行`);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// ── 3. 造历史账本 → 成就自动兑现 + 弹窗 ─────────────────────────────
// 直接写战绩账本（这是"只读已有账本"设计能生效的关键路径：历史数据一次性兑现）。
const now = Date.now();
await page.evaluate(([{ at }]) => {
  const history = [];
  // 一局「大师」档胜利 + 一局 8 手速胜 + 一局禁手判负 —— 覆盖三条不同成就。
  history.push({ id: "t-master", at: at - 30000, outcome: "won", reason: "你连成五子", humanPlayer: "black", strength: "大师", engine: "strong", timeLimitMs: 0, thinkTimeMs: 5000, thinkDepth: 64, moves: 31, humanElapsedMs: 60000, forbidden: true });
  history.push({ id: "t-fast", at: at - 20000, outcome: "won", reason: "你连成五子", humanPlayer: "black", strength: "初级", engine: "strong", timeLimitMs: 0, thinkTimeMs: 600, thinkDepth: 32, moves: 8, humanElapsedMs: 5000, forbidden: false });
  history.push({ id: "t-forb", at: at - 10000, outcome: "lost", reason: "黑方三三禁手判负", humanPlayer: "black", strength: "中级", engine: "strong", timeLimitMs: 0, thinkTimeMs: 2000, thinkDepth: 48, moves: 14, humanElapsedMs: 9000, forbidden: true });
  localStorage.setItem("banbu-duel-history-v1", JSON.stringify(history));
}, [{ at: now }]);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1400);

const unlock = page.locator("[data-achievement-unlock]");
const unlockCount = await unlock.count();
check("历史数据兑现后弹出解锁弹窗", unlockCount > 0, unlockCount ? `弹的是「${await unlock.first().getAttribute("data-achievement-unlock")}」` : "没弹");

if (unlockCount > 0) {
  const box = await unlock.first().boundingBox();
  // 弹窗应该在**顶部**（顶栏下方），不是底部 toast 位，也不是屏幕正中。
  check("弹窗位于顶部区域（< 视口 1/3）", box !== null && box.y < 852 / 3, box ? `y=${Math.round(box.y)}` : "量不到");
  // 不该有遮罩：解锁弹窗的祖先里不能有全屏 backdrop。
  const backdrop = await page.locator(".achievement-unlock .sheet-backdrop, .achievement-unlock + .sheet-backdrop").count();
  check("弹窗没有遮罩层（不阻塞操作）", backdrop === 0);
  // 不拦操作：棋盘/底栏仍可点（用 elementFromPoint 在弹窗之外的区域探测）。
  const reachable = await page.evaluate(() => {
    const el = document.elementFromPoint(196, 700);
    return Boolean(el && !el.closest("[data-achievement-unlock]"));
  });
  check("弹窗之外的区域仍可交互（不拦操作）", reachable);
  // 卡片本身 pointer-events 必须是 auto 才点得到关闭按钮。
  const pointer = await unlock.first().evaluate((node) => getComputedStyle(node).pointerEvents);
  check("弹窗卡片可点（pointer-events:auto）", pointer === "auto", pointer);
  // 有动画（用户点名要动效）。
  const anim = await unlock.first().evaluate((node) => getComputedStyle(node).animationName);
  check("弹窗带入场动画", anim && anim !== "none", anim);

/**
 * 弹窗必须落在**最上面那条带子里、不压棋盘**（用户 2026-10-10 第三轮：
 * 「然后成就的那个还不够靠上，你最好是放到最上面区域，不要挡住棋盘了」）。
 *
 * 判据用实测几何：顶栏 68px、**棋盘从 108px 开始**（390×844 实测）。
 * 原来在 74px —— 正好卡在顶栏与棋盘之间那条缝里，稍高的卡片下沿会压到棋盘。
 */
const cardBand = await page.evaluate(() => {
  const card = document.querySelector("[data-achievement-unlock]");
  if (!card) return null;
  const r = card.getBoundingClientRect();
  const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
  const board = document.querySelector(".board-scroller, .vcfch-board")?.getBoundingClientRect();
  return {
    top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
    insideTopbar: topbar ? (r.top >= topbar.top - 1 && r.bottom <= topbar.bottom + 1) : null,
    overlapsBoard: board ? r.bottom > board.top + 1 : false,
  };
});
check("成就弹窗落在**最上面那条带子里**（在顶栏内、不压棋盘）",
  Boolean(cardBand && cardBand.insideTopbar && !cardBand.overlapsBoard),
  JSON.stringify(cardBand));

/**
 * 奖励徽章里**不写「棋魂」二字**（用户 2026-10-10 第八轮：「你把棋魂这个字去了呀」
 * —— 同一口径也适用于成就弹窗里那枚奖励小徽章）。
 *
 * 判据用**实际渲染的可见文字**（剥掉 `.soul-sr-only`），而不是"某个类没了"：
 * 后者证明不了"别处没有又冒出来一份"。徽章里剩下的应该只有 `+N`。
 */
const soulBadge = await page.evaluate(() => {
  const badge = document.querySelector("[data-achievement-unlock] .achievement-unlock-soul");
  if (!badge) return null;
  const clone = badge.cloneNode(true);
  clone.querySelectorAll(".soul-sr-only").forEach((el) => el.remove());
  return {
    visible: (clone.textContent || "").replace(/\s+/g, " ").trim(),
    hasFlame: Boolean(badge.querySelector("svg")),
  };
});
check("成就弹窗的奖励徽章是「图标 + 数字」（可见文字里没有「棋魂」二字）",
  Boolean(soulBadge && soulBadge.hasFlame && /^\+\d/.test(soulBadge.visible) && !soulBadge.visible.includes("棋魂")),
  soulBadge ? `可见「${soulBadge.visible}」图标=${soulBadge.hasFlame}` : "没找到徽章");
}

// ── 4. 弹窗自动播完消失（不留下需要用户处理的残留） ──────────────────
// 时长按队列长度自适应：≥4 条时每条 2.1s，总时长有 9s 上限。
// 这里按"条数 × 2.4s + 余量"等，超时才算失败（别用固定 6s 误判）。
const queued = await page.evaluate(() => document.querySelectorAll("[data-achievement-unlock-count]").length);
const waitMs = Math.min(6000 + 2600 * 4, 6000 + 2600 * Math.max(1, queued));
await page.waitForTimeout(Math.max(7000, waitMs));
let remaining = await page.locator("[data-achievement-unlock]").count();
if (remaining > 0) {
  // 兜底：再等一轮（队列长 + 动画余量），仍不为 0 就判失败。
  await page.waitForTimeout(6000);
  remaining = await page.locator("[data-achievement-unlock]").count();
}
check("弹窗会自动播完消失", remaining === 0, remaining ? `还剩 ${remaining}` : "");

// ── 5. 成就已写入存档（刷新后仍在，且不重复解锁） ────────────────────
const stored = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("banbu-achievements-v1") || "{}"); } catch { return {}; }
});
const unlockedIds = Object.keys(stored);
check("成就已落盘", unlockedIds.length > 0, `${unlockedIds.length} 条：${unlockedIds.join(",")}`);
check("解锁了「撼动大师」", unlockedIds.includes("duel-beat-master"), unlockedIds.includes("duel-beat-master") ? "" : "没解锁");
check("解锁了「速战速决」", unlockedIds.includes("duel-fast-win"));
check("解锁了「禁手教训」", unlockedIds.includes("duel-forbidden-loss"));

const soulLedger = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"); } catch { return []; }
});
const balance = Array.isArray(soulLedger) ? soulLedger.reduce((sum, item) => sum + (item.amount || 0), 0) : 0;
check("棋魂账本已入账", balance > 0, `余额 ${balance}`);
const tokens = new Set((Array.isArray(soulLedger) ? soulLedger : []).filter((item) => item.token).map((item) => item.token));
check("棋魂流水带幂等 token（防重复发放）", tokens.size > 0, `${tokens.size} 个 token`);

// 再刷一次：不应该重复发棋魂（幂等）。
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const balance2 = await page.evaluate(() => {
  try { const raw = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"); return Array.isArray(raw) ? raw.reduce((sum, item) => sum + (item.amount || 0), 0) : 0; } catch { return 0; }
});
check("刷新后棋魂余额不变（幂等成立）", balance2 === balance, `${balance} → ${balance2}`);

check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log("失败项：");
  for (const item of failed) console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  process.exit(1);
}
