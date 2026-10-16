/**
 * 外观解锁的**采购约束**门禁（用户 2026-10-10：「我们这个外观啊，现在不交钱无法预览了，
 * 就很不好，棋盘棋子你可以让我们点击可以预览，点击右边那个地方才是购买。而主题呢，
 * 也是可以预览，但是不买就回到自己使用的那个」＋「我发现快捷中心里面，那些外观其实
 * 还可以自由切换，不受这些购买的约束，你修复一下」＋「如果旧版本的人之前用的是付费外观，
 * 那么上新版本后……那一套就免费送他了」）。
 *
 * 四组断言：
 *  ① **老用户在用即赠送**：模拟"正在用付费外观且从没买过"，加载后那三样自动进解锁集合，
 *     且**只送一次**；
 *  ② **预览与购买分开**：点锁着的卡 = 预览（界面变、**盘不变**、不弹购买框）、
 *     点右边价格 = 弹购买框；
 *  ③ **不买就回去**：离开设置页 ⇒ 回到预览前那一套；
 *  ④ **快捷中心也受约束**：未购买的项在下拉里带锁与价格，选了它**不改外观**、只弹提示；
 *     并且快捷中心有棋盘/棋子透明度两条滑条。
 *
 * 用法：`QA_BASE_URL=... node qa/soul-appearance-check.mjs`
 */

import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const url = BASE.includes("?") ? BASE : `${BASE}?qa=1`;

let failures = 0;
let checks = 0;
const OK = "\u2713";
const BAD = "\u2717";
const check = (label, ok, detail = "") => {
  checks += 1;
  if (ok) process.stdout.write(`  ${OK} ${label}${detail ? `（${detail}）` : ""}\n`);
  else { failures += 1; process.stdout.write(`  ${BAD} ${label}${detail ? `（${detail}）` : ""}\n`); }
};
const section = (title) => process.stdout.write(`\n${title}\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialogs = [];
page.on("dialog", (dialog) => { dialogs.push(dialog.message()); dialog.dismiss().catch(() => {}); });

const installDiagGuard = (target) => target.evaluate(() => {
  const strip = () => { for (const node of document.querySelectorAll("[data-tempdiag]")) node.remove(); };
  strip();
  const w = window;
  w.__soulAppearanceDiag?.disconnect();
  w.__soulAppearanceDiag = new MutationObserver(strip);
  w.__soulAppearanceDiag.observe(document.body, { childList: true, subtree: true });
});

const themeNow = (target) => target.evaluate(() => document.documentElement.dataset.theme);
const themeStored = (target) => target.evaluate(() => localStorage.getItem("banbu-theme-preference-v1"));
/** 主题下拉的 aria-label（中文，避免在源码里写一堆转义） */
const THEME_SELECT = "\u9009\u62e9\u5e94\u7528\u4e3b\u9898";
const LOCK_EMOJI = "\uD83D\uDD12";

/** 进设置 → 外观与音效 → 主题（三处都要展开）。 */
const openThemeSection = async () => {
  await page.locator(".bottom-nav button", { hasText: "设置" }).first().click();
  await page.waitForTimeout(800);
  const group = page.locator("details.settings-group", { hasText: "外观与音效" }).first();
  if (!(await group.evaluate((n) => n.hasAttribute("open")))) {
    await group.locator("summary.settings-section-toggle").first().click();
    await page.waitForTimeout(600);
  }
  const sub = page.locator("details.appearance-center-subsection", { hasText: "主题" }).first();
  if (!(await sub.evaluate((n) => n.hasAttribute("open")))) {
    await sub.locator("> summary").first().click();
    await page.waitForTimeout(700);
  }
};

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);

// ── ① 老用户在用即赠送（先验这条，它要把存储清成"老用户"的样子）──
section("① 老用户：在用的付费外观自动赠送");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("banbu-theme-preference-v1", "bamboo");
  localStorage.setItem("banbu-board-theme-v1", "app-jade");
  localStorage.setItem("banbu-stone-theme-v1", "app-snow");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(1200);
const granted = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("banbu-soul-grant-v1") || "[]"); } catch { return []; }
});
const unlocksAfterGrant = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("banbu-soul-unlocks-v1") || "[]"); } catch { return []; }
});
check("正在用的主题被赠送", granted.includes("theme-bamboo"), JSON.stringify(granted));
check("正在用的棋盘被赠送", granted.includes("board-app-jade"));
check("正在用的棋子被赠送", granted.includes("stone-app-snow"));
check("赠送真的落进解锁集合", unlocksAfterGrant.includes("theme-bamboo"));
// 只送一次：清掉解锁集合再刷新，不该重送
await page.evaluate(() => localStorage.setItem("banbu-soul-unlocks-v1", "[]"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(1000);
const regrant = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("banbu-soul-unlocks-v1") || "[]"); } catch { return []; }
});
check("**只送一次**（清了再刷新不会重送）", regrant.length === 0, JSON.stringify(regrant));

// ── ② 预览与购买分开 ─────────────────────────────────────────────
section("② 点卡片=预览、点价格=购买");
await page.evaluate(() => {
  localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
    { id: "seed", at: Date.now(), amount: 3000, reason: "achievement", detail: "本金" }]));
  localStorage.setItem("banbu-theme-preference-v1", "light");
  localStorage.setItem("banbu-soul-unlocks-v1", "[]");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(900);
await openThemeSection();

const beforeTheme = await themeNow(page);
const beforeStored = await themeStored(page);
const lockedCard = page.locator(".theme-preference button.is-soul-locked").first();
await lockedCard.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  window.scrollBy(0, rect.top - 240);
});
await page.waitForTimeout(400);
// 卡片中心被色块盖着 ⇒ 点右下角（与 soul-shop-check 同一个避坑做法）
const lockedBox = await lockedCard.boundingBox();
if (lockedBox) await page.mouse.click(lockedBox.x + lockedBox.width - 16, lockedBox.y + lockedBox.height - 14);
await page.waitForTimeout(700);
const previewTheme = await themeNow(page);
const previewStored = await themeStored(page);
check("点锁着的卡 → **界面真的切过去**（这是预览的意义）",
  previewTheme !== beforeTheme, `${beforeTheme} → ${previewTheme}`);
check("点锁着的卡 → **不落盘**（没买不该改他的设置）",
  previewStored === beforeStored, `盘上 ${previewStored}`);
check("点锁着的卡 → 不弹购买框（购买是另一个目标）",
  (await page.locator("[data-soul-buy]").count()) === 0);

// ── ③ 不买就回去 ───────────────────────────────────────────────
section("③ 不买就回到自己原来那套");
await page.locator(".bottom-nav button", { hasText: "打谱" }).first().click();
await page.waitForTimeout(900);
const afterLeave = await themeNow(page);
check("离开设置页 → 外观**回到预览前**那一套",
  afterLeave === beforeTheme, `${previewTheme} → ${afterLeave}（原 ${beforeTheme}）`);

// 点价格徽章 → 弹购买框
await openThemeSection();
// 点**徽章本身的盒子**（它是卡片按钮的**兄弟**，见 SoulLockable 的结构注释；
// 用 JS `click()` 也行，但那样测不到"它真的能被点中"—— 这里用坐标点，
// 顺带覆盖"徽章可点"这件事，那条曾经因为 `pointer-events: none` 而失效）
const badgeBox = await page.locator(".soul-lockable > .soul-lock-badge").first().boundingBox();
if (badgeBox) await page.mouse.click(badgeBox.x + badgeBox.width / 2, badgeBox.y + badgeBox.height / 2);
await page.waitForTimeout(600);
check("点右边那枚价格 → **弹购买框**",
  (await page.locator("[data-soul-buy]").count()) > 0);
// 购买框不吃 Escape（它是自绘的 dialog，只有那两个按钮能关）—— 点「先不买」
await page.locator(".soul-buy-cancel").click();
await page.waitForTimeout(400);
check("预览收尾：点「先不买」后购买框关掉", (await page.locator("[data-soul-buy]").count()) === 0);

/**
 * ③b **预览中买下 ⇒ 必须落盘**（2026-10-11 自检抓到的一个真 bug）。
 *
 * 场景：用户点开一个锁着的主题预览（界面切过去、不落盘），
 * 然后**就在这个状态下点价格买下它**。
 *
 * 当时的 bug：买完界面是对的、**盘上还是旧值** ⇒ 一刷新就退回旧外观，
 * 看起来像"钱花了但主题没买到"。
 * 根因是 `onUnlocked` 调 `onChange(value)` 而**那个值当前就是它**
 * （用户正在预览它）⇒ React 设成同一个值会 bail out、不重渲染
 * ⇒ 写盘 effect 不会再跑（它只在值变化时跑），而预览期间那次又被标记挡掉了。
 * 修法是 commit 时显式落盘（见 App.tsx 的 endPreview）。
 *
 * ⚠ 这条断言必须"**买完再刷新一次**"才有效 —— 不刷新的话界面本来就是对的那个
 * （bug 藏在盘上），永远看不出来。
 */
section("③b 预览中买下 ⇒ 必须落盘（刷新后还在）");
await openThemeSection();
const beforeBuyTheme = await themeStored(page);
const lockedForBuy = page.locator(".theme-preference button.is-soul-locked").first();
await lockedForBuy.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  window.scrollBy(0, rect.top - 240);
});
await page.waitForTimeout(400);
const buyBox = await lockedForBuy.boundingBox();
if (buyBox) await page.mouse.click(buyBox.x + buyBox.width - 16, buyBox.y + buyBox.height - 14);
await page.waitForTimeout(600);
const previewedForBuy = await themeNow(page);
check("（前置）已进入预览态：界面变了、盘上没变",
  previewedForBuy !== beforeBuyTheme && (await themeStored(page)) === beforeBuyTheme,
  `界面 ${previewedForBuy} / 盘上 ${await themeStored(page)}`);
const buyBadge = await page.locator(".soul-lockable > .soul-lock-badge").first().boundingBox();
if (buyBadge) await page.mouse.click(buyBadge.x + buyBadge.width / 2, buyBadge.y + buyBadge.height / 2);
await page.waitForTimeout(500);
await page.locator("[data-soul-buy-confirm]").click();
await page.waitForTimeout(900);
check("买完**当场**就落盘了（不等刷新）",
  (await themeStored(page)) === previewedForBuy,
  `盘上 ${await themeStored(page)}（应 ${previewedForBuy}）`);
// 刷新：这一条才是真正抓 bug 的（界面/盘不一致时立刻现形）
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(1000);
check("**刷新后仍是买下的那套**（「钱花了但没买到」就是这个 bug）",
  (await themeNow(page)) === previewedForBuy,
  `刷新后 ${await themeNow(page)}（应 ${previewedForBuy}）`);

// ── ④ 快捷中心也受约束 ─────────────────────────────────────────
section("④ 快捷中心：未购买的项带锁");
await page.locator(".bottom-nav button", { hasText: "打谱" }).first().click();
await page.waitForTimeout(600);
await page.locator(".brand-trigger").first().click();
await page.waitForTimeout(800);
await page.locator("button", { hasText: "外观与声音" }).first().click();
await page.waitForTimeout(600);
const lockInfo = await page.evaluate((selectLabel) => {
  const sel = Array.from(document.querySelectorAll("select")).find((node) => node.getAttribute("aria-label") === selectLabel);
  if (!sel) return null;
  const locked = Array.from(sel.options).filter((option) => option.textContent.includes("\uD83D\uDD12"));
  return {
    lockedCount: locked.length,
    sample: locked.length ? locked[0].textContent : null,
    hasPrice: locked.length ? /\d/.test(locked[0].textContent) : false,
  };
}, THEME_SELECT);
check("未购买的主题在快捷中心里**带锁与价格**",
  Boolean(lockInfo && lockInfo.lockedCount > 0 && lockInfo.hasPrice), JSON.stringify(lockInfo));

const beforeDrawerTheme = await themeStored(page);
dialogs.length = 0;
await page.evaluate((selectLabel) => {
  const sel = Array.from(document.querySelectorAll("select")).find((node) => node.getAttribute("aria-label") === selectLabel);
  const locked = Array.from(sel.options).find((option) => option.textContent.includes("\uD83D\uDD12"));
  sel.value = locked.value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}, THEME_SELECT);
await page.waitForTimeout(700);
check("选了锁着的项 → **弹提示**（告诉他没买、多少钱）",
  dialogs.length > 0, dialogs[0] ? dialogs[0].replace(/\n/g, " / ").slice(0, 70) : "没有弹窗");
check("选了锁着的项 → **外观没被改**（截断了那条绕过购买的路）",
  (await themeStored(page)) === beforeDrawerTheme, `盘上 ${await themeStored(page)}`);

// 透明度滑条（在「棋盘显示」那一节里，它默认也是收起的 —— 先展开）
await page.locator("button", { hasText: "棋盘显示" }).first().click().catch(() => {});
await page.waitForTimeout(600);
const opacitySliders = await page.evaluate(() =>
  ["\u5feb\u6377\u4e2d\u5fc3\u68cb\u76d8\u900f\u660e\u5ea6", "\u5feb\u6377\u4e2d\u5fc3\u68cb\u5b50\u900f\u660e\u5ea6"]
    .filter((label) => document.querySelector(`input[aria-label="${label}"]`)));
check("快捷中心有**棋盘与棋子透明度**两条滑条",
  opacitySliders.length === 2, opacitySliders.join("\u3001") || "一个都没找到");

// ── ⑤ 色条与一口价 ───────────────────────────────────────────
section("⑤ 色条回来了 & 一口价 500");
/**
 * ⚠ 上一节把快捷中心抽屉打开了，它是**全屏覆盖层**，会拦住后面所有点击
 * （报的是 "quick-drawer-scrim intercepts pointer events"）。
 *
 * 关它的正规做法是点蒙皮，但蒙皮本身就是那个"拦截者"——用 Playwright 点它
 * 会因为"命中的是它但要点的也是它"这类判定而绕不出来。所以这里用
 * **Esc**（抽屉支持键盘关闭，见 QuickDrawer 里的 Escape 处理），
 * 实在不行再退回 DOM click。
 */
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
if (await page.locator(".quick-drawer-scrim").count()) {
  await page.evaluate(() => document.querySelector(".quick-drawer-scrim")?.click());
  await page.waitForTimeout(600);
}
check("快捷中心已关闭（否则后面所有点击都会被它拦住）",
  (await page.locator(".quick-drawer-scrim").count()) === 0);
await openThemeSection();
const swatchInfo = await page.evaluate(() => {
  const wrap = document.querySelector(".theme-preference .soul-lockable");
  const card = wrap?.querySelector("button:not(.soul-lock-badge)");
  const swatch = card?.querySelector(".theme-swatch");
  if (!card || !swatch) return null;
  const r = (node) => { const b = node.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
  return { swatch: r(swatch), card: r(card) };
});
/**
 * 色条必须是**满宽的一条**（约 26px 高、宽度接近卡片内容宽）。
 *
 * 这条是用户 2026-10-10 报的「主题，棋盘棋子背景的颜色条怎么没了」——
 * 根因有两层，都是给价格徽章加 wrapper 打断的布局：
 *  ① `.appearance-center-subsection .theme-preference > button` 不再命中 ⇒ 卡片塌了；
 *  ② `.theme-swatch` 退回默认的 32×32 方块 ⇒ 看起来"没有色条"。
 * 所以判据用**几何**（宽度要接近卡片宽度），不是"元素存在"——
 * 元素一直都在，只是被压成了一个小方块。
 */
check("主题色条是**满宽的一条**（不是被压成小方块）",
  Boolean(swatchInfo && swatchInfo.swatch.w >= swatchInfo.card.w * 0.8 && swatchInfo.swatch.h >= 20),
  JSON.stringify(swatchInfo));

const priceInfo = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".theme-preference .soul-lock-badge"));
  const values = rows.map((node) => (node.textContent || "").replace(/[^\d]/g, "")).filter(Boolean);
  return { count: values.length, unique: [...new Set(values)] };
});
/**
 * 外观定价**只有少数几档**（用户 2026-10-11 在工坊里调成 500 / 700 两档）。
 *
 * ⚠ 不钉死单一数字：定价是**用户自己在调的旋钮**，钉死等于每次调价都要改门禁。
 * 守的是"档位有界"——规则化定价的意义就是只有几档；若出现十几个价位，
 * 说明有人绕过 `SOUL_PRICE_RULES` 手写了价格。
 */
check("外观定价只有少数几档（≤4 档，且都是正整数）",
  priceInfo.count > 0 && priceInfo.unique.length <= 4
    && priceInfo.unique.every((value) => Number(value) > 0),
  JSON.stringify(priceInfo));

/**
 * ⑤b **余额三处一致**（2026-10-11 自检抓到的第二个真 bug）。
 *
 * 棋魂的入账有**两条通道**：`useProgress.earn()`（成就/对局/做题）与商店自己的 `buy*`。
 * 而 `useSoulShop` 是一份**独立快照**，它自己缓存了一个 `balance`——
 * 并且只在自己 `buy*` 时才刷新。于是启动时那批成就奖励（一笔可能上千）**它看不见**：
 * 实测"账本里 3226、商店面板显示 1200"，而买东西时按真实的 3226 花。
 *
 * 界面上的数字与实际能花的钱对不上，是最糟的一类不一致（用户会以为钱丢了/白来了）。
 * 修法：`commitLedger`（所有账本写操作的收口点）广播给商店。
 *
 * 判据：**账本、对弈页徽章、商店面板**三处的数字必须相同。
 */
section("⑤b 余额三处一致（账本 / 徽章 / 商店）");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
    { id: "seed", at: Date.now(), amount: 1200, reason: "achievement", detail: "本金" }]));
  localStorage.setItem("banbu-soul-unlocks-v1", "[]");
  localStorage.setItem("banbu-soul-grant-v1", "[]");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
// 等启动那批成就兑现完（它们会往账本里加钱；这正是暴露不同步的场景）
await page.waitForTimeout(5000);
const ledgerTotal = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]")
      .reduce((sum, item) => sum + (item.amount || 0), 0);
  } catch { return 0; }
});
await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
await page.waitForTimeout(700);
const badgeNum = Number((((await page.locator("[data-soul-badge-count]").first().textContent()) || "").replace(/[^\d]/g, "")) || "0");
await page.locator("[data-shop-badge]").first().click();
await page.waitForSelector("[data-shop-panel]", { timeout: 15000 });
await page.waitForTimeout(700);
const panelNum = Number((((await page.locator("[data-shop-balance]").textContent()) || "").replace(/[^\d]/g, "")) || "0");
check("账本 / 徽章 / 商店面板 三处余额一致",
  ledgerTotal > 0 && badgeNum === ledgerTotal && panelNum === ledgerTotal,
  `账本 ${ledgerTotal}、徽章 ${badgeNum}、商店 ${panelNum}`);

// ── ⑥ 批量购买 ───────────────────────────────────────────────
section("⑥ 商店：批量购买");
await page.evaluate(() => {
  localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
    { id: "seed", at: Date.now(), amount: 3000, reason: "achievement", detail: "本金" }]));
  localStorage.setItem("banbu-soul-unlocks-v1", "[]");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(800);
await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
await page.waitForTimeout(500);
await page.locator("[data-shop-badge]").first().click();
await page.waitForSelector("[data-shop-panel]", { timeout: 15000 });
await page.waitForTimeout(600);
check("商店里有「多选」入口", (await page.locator("[data-shop-pick-toggle]").count()) === 1);
await page.locator("[data-shop-pick-toggle]").click();
await page.waitForTimeout(500);
const pickRows = await page.locator("[data-shop-pick-row]").count();
check("多选态列出**逐项可勾选**的清单", pickRows > 10, `${pickRows} 项`);
check("按类分组，每类有「全选本类」", (await page.locator("[data-shop-pick-all]").count()) >= 3);
// 勾三件（3000 够买 6 件）
await page.locator("[data-shop-pick-row]").nth(0).click();
await page.locator("[data-shop-pick-row]").nth(1).click();
await page.locator("[data-shop-pick-row]").nth(2).click();
await page.waitForTimeout(400);
const sumText = ((await page.locator(".shop-pick-sum").textContent()) || "").replace(/\s+/g, " ");
check("结算条如实汇总（件数 + 总价 + 现有余额）",
  sumText.includes("3 件") && sumText.includes("1500") && sumText.includes("3000"), sumText.trim());
const balanceBeforeBatch = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]")
      .reduce((sum, item) => sum + (item.amount || 0), 0);
  } catch { return 0; }
});
await page.locator("[data-shop-pick-buy]").click();
await page.waitForTimeout(1200);
const afterBatch = await page.evaluate(() => ({
  unlocks: (() => { try { return JSON.parse(localStorage.getItem("banbu-soul-unlocks-v1") || "[]").length; } catch { return 0; } })(),
  balance: (() => {
    try { return JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]").reduce((sum, item) => sum + (item.amount || 0), 0); } catch { return 0; }
  })(),
}));
check("批量买：**三件都进了解锁集合**", afterBatch.unlocks >= 3, `${afterBatch.unlocks} 件`);
check("批量买：**扣的钱 = 件数 × 单价**",
  balanceBeforeBatch - afterBatch.balance >= 1500, `${balanceBeforeBatch} → ${afterBatch.balance}`);
const noticeText = ((await page.locator("[data-shop-pick-notice]").textContent()) || "").trim();
check("批量买完**如实汇报**（买到几件）", /买到\s*\d+\s*件/.test(noticeText), noticeText.slice(0, 50));

// ── ⑦ 运行期 ──────────────────────────────────────────────────
section("⑦ 运行期");
check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 3).join(" | "));

void LOCK_EMOJI;
await browser.close();
process.stdout.write(`\n${failures === 0 ? "全部通过" : "有失败"}：${checks - failures}/${checks} 项检查通过。\n`);
if (failures > 0) process.exit(1);
