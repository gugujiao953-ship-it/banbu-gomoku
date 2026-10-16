/**
 * VCF 道具 与 商店入口 的接线门禁（用户 2026-10-10）。
 *
 * ## 三件事分开验
 *
 *  ① **商店入口**：对弈页与棋魂**同一行**多一枚袋子徽章（用户：「还是在对弈界面去放个商店吧的
 *     图标入口吧，和棋魂按钮在一列」），点开是商店面板（道具 + 外观总览）；
 *  ② **道具栏**：VCF 页三张卡（图标 + 数量 + 「+」），**不占一屏**（用户点名）、
 *     「+」能看到价格与用法、**没货时点图标弹购买框**（用户：「不供购买，除非没有了，
 *     然后点击后出现购买弹窗」）；
 *  ③ **三种效果真的生效**：加时（秒数真的 +30）、提示（棋盘上真的出现建议圈）、
 *     悔棋（真的撤掉一手）—— 并且**失败时不扣道具**。
 *
 * ## 这条门禁抓过的一个真 bug
 *
 * 第一版是"道具栏先扣、再调页面的效果"。实测：**没落子时点悔棋卡**，页面拒绝了
 * （"没有可悔的一手"），但道具已经扣掉了 —— 用户白损失一个。
 * 所以现在 `onUse` 必须返回 `boolean`，"能用才扣"。这条断言（下第 6 组）就是钉它的。
 *
 * 用法：`QA_BASE_URL=... node qa/vcf-items-check.mjs`
 */

import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const url = BASE.includes("?") ? BASE : `${BASE}?qa=1`;

let failures = 0;
let checks = 0;
const check = (label, ok, detail = "") => {
  checks += 1;
  if (ok) process.stdout.write(`  ✓ ${label}${detail ? `（${detail}）` : ""}\n`);
  else { failures += 1; process.stdout.write(`  ✗ ${label}${detail ? `（${detail}）` : ""}\n`); }
};
const section = (title) => process.stdout.write(`\n${title}\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 420, height: 940 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push("console: " + message.text()); });

/** 去掉别的会话可能插进来的诊断条（z-index 99999，会拦点击）。 */
const installDiagGuard = (target) => target.evaluate(() => {
  const strip = () => { for (const node of document.querySelectorAll("[data-tempdiag]")) node.remove(); };
  strip();
  const w = window;
  w.__vcfItemsDiagObserver?.disconnect();
  w.__vcfItemsDiagObserver = new MutationObserver(strip);
  w.__vcfItemsDiagObserver.observe(document.body, { childList: true, subtree: true });
});

const readItems = (target) => target.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("banbu-vcf-items-v1") || "{}"); } catch { return {}; }
});
const readSoul = (target) => target.evaluate(() => {
  try {
    const raw = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]");
    return Array.isArray(raw) ? raw.reduce((sum, item) => sum + (item.amount || 0), 0) : 0;
  } catch { return 0; }
});

/** 进 VCF 挑战页（对弈页 → VCF 入口 → 等道具栏）。 */
const openVcf = async () => {
  await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
  await page.waitForTimeout(500);
  await page.locator("[data-duel-entry='vcf'] button").first().click();
  await page.waitForSelector("[data-vcf-items]", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
};

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
// 给钱 + 三种道具各 3 个（省掉购买步骤，先验效果）
await page.evaluate(() => {
  localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
    { id: "seed", at: Date.now(), amount: 3000, reason: "achievement", detail: "门禁本金" },
  ]));
  localStorage.setItem("banbu-vcf-items-v1", JSON.stringify({ "extra-time": 3, hint: 3, undo: 3 }));
  localStorage.removeItem("banbu-soul-unlocks-v1");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(800);

// ── 1. 商店入口与棋魂同一行 ──────────────────────────────────────
section("1. 对弈页的商店入口");
await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
await page.waitForTimeout(500);
const badgeRow = await page.evaluate(() => {
  const row = document.querySelector(".duel-title-badges");
  if (!row) return null;
  const soul = row.querySelector("[data-soul-badge]");
  const shop = row.querySelector("[data-shop-badge]");
  if (!soul || !shop) return { soul: Boolean(soul), shop: Boolean(shop) };
  const s = soul.getBoundingClientRect();
  const b = shop.getBoundingClientRect();
  return {
    soul: true, shop: true,
    sameRow: Math.abs(s.top - b.top) < 4,
    shopRightOfSoul: b.left >= s.right - 2,
  };
});
check("商店徽章与棋魂徽章**同一行**（用户点名「和棋魂按钮在一列」）",
  Boolean(badgeRow?.soul && badgeRow?.shop && badgeRow?.sameRow), JSON.stringify(badgeRow));
check("商店徽章排在棋魂右边（先看有多少钱，再看能买什么）",
  Boolean(badgeRow?.shopRightOfSoul));
const shopCount = (await page.locator("[data-shop-badge-count]").first().textContent()) || "";
check("商店徽章上有数字（还有几项没解锁）", /\d|全/.test(shopCount.trim()), `显示「${shopCount.trim()}」`);

// ── 2. 商店面板 ─────────────────────────────────────────────────
section("2. 商店面板");
await page.locator("[data-shop-badge]").first().click();
await page.waitForSelector("[data-shop-panel]", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600);
check("点徽章打开商店面板", (await page.locator("[data-shop-panel]").count()) === 1);
check("面板里有余额（买之前先看钱够不够）",
  (((await page.locator("[data-shop-balance]").textContent()) || "").trim().length > 0));
check("列了三种道具", (await page.locator("[data-shop-item]").count()) === 3);
// 用户 2026-10-10 第二轮：「那三个道具就应该在同一行」——实测三张卡的 y 必须一致
const shopRow = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll("[data-shop-item]")).map((n) => {
    const r = n.getBoundingClientRect();
    return { id: n.dataset.shopItem, y: Math.round(r.y), h: Math.round(r.height) };
  });
  return { rows: new Set(cards.map((c) => c.y)).size, cards };
});
check("三个道具**在同一行**（用户点名，实测 y 一致）", shopRow.rows === 1, JSON.stringify(shopRow.cards));
// 卡面**不写用法**（用户：「点击购买时会出现一个弹窗以及这个东西的用法，
// 而不是往下展开这样的」）—— 用法只该在弹窗里
const cardFace = ((await page.locator("[data-shop-item='hint']").textContent()) || "");
/**
 * 道具的**用法文案真值在 `items.ts`**，这里现读，不抄第二份（2026-10-13 修）。
 * 原来这两条把句子写死成「亮出正确答案」，而另一条会话把道具扩展到人机对弈、
 * 文案改成「亮出建议的一手。VCF 挑战：…」⇒ 门禁红在措辞上，不在功能上。
 * 与下面读价格同一套做法：断言"弹窗里有源码写的那句"，而不是"有某句我记住的话"。
 */
const itemsSrc = (await import("node:fs")).readFileSync("src/features/vcf-challenge/items.ts", "utf8");
const hintUsageText = (/text: "([^"]+)/.exec(itemsSrc.split('id: "hint"')[1] || "")?.[1] ?? "").trim();
check("卡面上没有长篇用法（用法进弹窗）", hintUsageText.length > 6 && !cardFace.includes(hintUsageText.slice(0, 10)),
  cardFace.replace(/\s+/g, " ").trim());
check("外观分组给了「未解锁/总数」", (await page.locator("[data-shop-group]").count()) >= 3);
// 买一个道具：钱要扣、库存要加
const soulBeforeBuy = await readSoul(page);
await page.locator("[data-shop-item='hint']").click();
await page.waitForTimeout(500);
check("点卡片 → 弹窗（不直接扣钱）",
  (await page.locator("[data-shop-buy='hint']").count()) === 1);
const buyDialogText = ((await page.locator("[data-shop-buy='hint']").textContent()) || "").replace(/\s+/g, " ");
check("弹窗里写了**用法**（用户点名；句子从 items.ts 现读）",
  hintUsageText.length > 6 && buyDialogText.includes(hintUsageText.slice(0, 10)),
  `源码句「${hintUsageText.slice(0, 14)}…」／弹窗「${buyDialogText.slice(0, 40)}」`);
// 价格从源码读（用户在工坊/源码里会调：40 → 30 就是这么来的），不写死数字
const hintPrice = Number((/cost: (\d+)/.exec(
  (await import("node:fs")).readFileSync("src/features/vcf-challenge/items.ts", "utf8")
    .split('id: "hint"')[1] || ""))?.[1] ?? 0);
check("弹窗里写了**价格**", hintPrice > 0 && buyDialogText.includes(String(hintPrice)),
  `源码价 ${hintPrice}、弹窗「${buyDialogText.slice(0, 46)}」`);
/**
 * ⚠ 弹窗必须**浮起来**（fixed + 全屏遮罩 + 垂直居中），不能在面板里"往下展开"。
 *
 * 这条是 2026-10-10 修掉一个**很隐蔽的 bug** 之后补的：
 * 那份弹窗的 CSS 原来住在 `vcf-challenge.css`，而那是**随 VCF 页懒加载**的
 * （App.tsx 里 VcfChallengePage 是 lazy()）。从**对弈页**打开棋魂商店、再点道具时，
 * 它根本没加载 ⇒ 弹窗丢了 `position: fixed`，看起来就像"在下面展开"。
 * 用户实测报的正是这个；而所有既有断言都没发现 —— 因为 VCF 页里打开它时 CSS 是有的。
 * 所以这条断言必须**在商店这个路径上量**（这正是它曾经坏掉的那条路径）。
 */
const floatCheck = await page.evaluate(() => {
  const back = document.querySelector(".vcfch-itemback");
  const card = document.querySelector("[data-shop-buy]");
  if (!back || !card) return null;
  const rb = back.getBoundingClientRect();
  const rc = card.getBoundingClientRect();
  return {
    position: getComputedStyle(back).position,
    fullScreen: rb.width >= window.innerWidth - 1 && rb.height >= window.innerHeight - 1,
    centered: Math.abs((rc.top + rc.height / 2) - window.innerHeight / 2) < 40,
  };
});
check("购买弹窗**浮起来**（fixed + 全屏遮罩 + 居中），不是在面板里往下展开",
  Boolean(floatCheck && floatCheck.position === "fixed" && floatCheck.fullScreen && floatCheck.centered),
  JSON.stringify(floatCheck));
check("**弹框那一刻没扣钱**", (await readSoul(page)) === soulBeforeBuy, `余额 ${soulBeforeBuy}`);
await page.locator("[data-shop-buy-confirm]").click();
await page.waitForTimeout(800);
const soulAfterBuy = await readSoul(page);
const itemsAfterBuy = await readItems(page);
check("确认后扣了钱", soulAfterBuy === soulBeforeBuy - hintPrice, `${soulBeforeBuy} → ${soulAfterBuy}（提示卡 ${hintPrice}）`);
check("确认后库存 +1", itemsAfterBuy.hint === 4, `提示卡 ${itemsAfterBuy.hint} 个`);

/**
 * **批量购买**（用户 2026-10-11：「棋魂商店里面的道具目前无法批量购买」）。
 *
 * 口径是"同一种买 n 个"（×1 / ×5 / ×10），不是多选几种一起结 ——
 * 三种道具单价各不相同，"多选"没法用一个乘法和用户交代总价。
 */
await page.locator("[data-shop-item='hint']").click();
await page.waitForTimeout(500);
const amountOptions = await page.locator("[data-shop-buy-amount]").allTextContents();
check("弹窗里有份数选择（×1 / ×5 / ×10）",
  amountOptions.length === 3, JSON.stringify(amountOptions.map((t) => t.replace(/\s+/g, ""))));
// 每个档位上都写了**那一档的总价**（用户要判断的是"花得起吗"，不是单价）
const amountTexts = amountOptions.map((t) => t.replace(/\s+/g, ""));
check("每档都标了这一档的总价（单价 × 份数）",
  amountTexts.every((t, index) => t.includes(String(hintPrice * [1, 5, 10][index]))),
  `${amountTexts.join(" / ")}（单价 ${hintPrice}）`);
await page.locator("[data-shop-buy-amount='5']").click();
await page.waitForTimeout(300);
const confirmLabel = ((await page.locator("[data-shop-buy-confirm]").textContent()) || "").trim();
check("确认键写出了要买几个、共多少钱",
  confirmLabel.includes("5") && confirmLabel.includes(String(hintPrice * 5)), confirmLabel);
const soulBeforeBatch = await readSoul(page);
const itemsBeforeBatch = (await readItems(page)).hint ?? 0;
await page.locator("[data-shop-buy-confirm]").click();
await page.waitForTimeout(1000);
const soulAfterBatch = await readSoul(page);
const itemsAfterBatch = (await readItems(page)).hint ?? 0;
check("一次点击买到 5 个（不用点五次）",
  itemsAfterBatch === itemsBeforeBatch + 5, `${itemsBeforeBatch} → ${itemsAfterBatch}`);
check("扣的是 5 个的钱", soulAfterBatch === soulBeforeBatch - hintPrice * 5,
  `${soulBeforeBatch} → ${soulAfterBatch}（应扣 ${hintPrice * 5}）`);
check("批量成交后弹窗关掉", (await page.locator("[data-shop-buy]").count()) === 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// ── 3. 道具栏：三张卡、不占一屏 ──────────────────────────────────
section("3. VCF 页的道具栏");
await openVcf();
check("VCF 页有道具栏（**待开始阶段也在**，不是开题后才出现）",
  (await page.locator("[data-vcf-items]").count()) === 1);
const cards = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-vcf-item]")).map((n) => ({
    id: n.dataset.vcfItem,
    count: n.dataset.vcfItemCount,
    hasIcon: Boolean(n.querySelector(".vcfch-item-icon svg")),
    hasPlus: Boolean(n.querySelector("[data-vcf-item-info]")),
  })));
check("三张卡（加时 / 提示 / 悔棋）", cards.length === 3, cards.map((c) => c.id).join(","));
check("每张都有图标", cards.every((c) => c.hasIcon));
check("每张都有「+」号（用户点名要）", cards.every((c) => c.hasPlus));
check("数量显示在卡上", cards.every((c) => /^\d+$/.test(c.count)));
const layout = await page.evaluate(() => {
  const rect = (sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right) };
  };
  const bar = document.querySelector("[data-vcf-items]");
  const r = bar.getBoundingClientRect();
  const c = document.querySelector(".vcfch-clock").getBoundingClientRect();
  const chip = rect(".vcfch-side-chip");
  const meta = rect(".vcfch-meta");
  return {
    height: Math.round(r.height),
    width: Math.round(r.width),
    // 用户 2026-10-10 第二轮：「放到计时的左边，和计时在同一行」
    leftOfClock: r.right <= c.left + 1,
    sameRow: Math.abs((r.top + r.height / 2) - (c.top + c.height / 2)) < 10,
    clockH: Math.round(c.height),
    chipH: chip?.h ?? 0,
    metaH: meta?.h ?? 0,
    // 是否把页面撑成两屏（用户：「也不能变得不是一屏」）
    scrollH: document.documentElement.scrollHeight,
    vh: window.innerHeight,
  };
});
check("道具栏在**计时左边**（用户点名）", layout.leftOfClock, JSON.stringify(layout));
check("道具栏与计时**同一行**（用户点名）", layout.sameRow, `栏高 ${layout.height} / 计时高 ${layout.clockH}`);
/**
 * 高度上限的用户口径（2026-10-12）：「高度完全可以再高一点……**不超过左边两个加起来的高度**
 * （你执xx，x手=xx分）」—— 左块那两段是 `.vcfch-side-chip` 与 `.vcfch-meta`。
 *
 * ⚠ 这一段（第 3 组）跑在**待开始阶段**，那时还没选题、`.vcfch-meta` 整个不存在，
 * 所以这里只能钉"确实放大了 + 没超过 CSS 里写死的 52px"；
 * **拿两段实高当上限的那条**放到第 5 组（题已开、两段都在）里当场量。
 * 下限 48px 钉的是"确实放大"（第二轮压到 30px 的那版就是被这条判红的）。
 */
check("道具栏放大到拇指面积（≥48px）且没超过 CSS 里的 52px 上限",
  layout.height >= 48 && layout.height <= 52,
  `${layout.height}px（你执块 ${layout.chipH}px${layout.metaH ? ` + 题目信息 ${layout.metaH}px` : "，题目信息行待开题后才有"}）`);
check("加了道具栏之后页面仍是一屏（不出现纵向滚动）",
  layout.scrollH <= layout.vh + 2, `内容 ${layout.scrollH}px / 视口 ${layout.vh}px`);
// 单张卡的尺寸（用户：「要能够点到」+ 本轮「再大一点」）
const cardSize = await page.evaluate(() => {
  const r = document.querySelector(".vcfch-item").getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
check("单张卡放大到拇指面积（高 ≥48、宽 ≥44）",
  cardSize.w >= 44 && cardSize.h >= 48, `${cardSize.w}×${cardSize.h}`);
/**
 * 「+」必须在下半（用户 2026-10-12：「那个+号也可以放下面」）。
 * 量两个按钮的实际位置，不靠类名猜。
 */
const stacked = await page.evaluate(() => {
  const item = document.querySelector(".vcfch-item");
  const use = item.querySelector(".vcfch-item-use").getBoundingClientRect();
  const plus = item.querySelector("[data-vcf-item-info]").getBoundingClientRect();
  return {
    plusBelowUse: plus.top >= use.bottom - 1,
    plusFullWidth: Math.abs(plus.width - item.getBoundingClientRect().width) <= 2,
    plusH: Math.round(plus.height),
    useH: Math.round(use.height),
  };
});
check("「+」在**图标+数量的下面**，并且占满这一颗的宽度",
  stacked.plusBelowUse && stacked.plusFullWidth,
  `上半 ${stacked.useH}px、下半「+」${stacked.plusH}px`);

// ── 4. 「+」→ 价格与用法 ────────────────────────────────────────
section("4. 「+」号：价格与用法");
await page.locator("[data-vcf-item-info='undo']").click();
await page.waitForTimeout(500);
check("点「+」弹说明框", (await page.locator("[data-vcf-item-card='undo']").count()) === 1);
const cardText = ((await page.locator("[data-vcf-item-card='undo']").textContent()) || "").replace(/\s+/g, " ");
check("说明框里有**用法**", cardText.includes("撤销"), cardText.slice(0, 60));
check("说明框里有**价格**", /\d/.test(cardText));
check("说明框里写着当前有几个", cardText.includes("当前有"));
/**
 * **说明与购买是同一张卡**（用户 2026-10-11：「点击道具购买时，会出现一个道具不足，
 * 然后这个时候还是要点一次……一共需要点两次买一个才能买到」）。
 *
 * 上一版这里是两张先后弹出的卡：点「+」→ 说明卡 → 点它的「买一个」只是
 * `setBuying(...)`（换成购买卡，**不买东西**）→ 再点一次才成交。
 * 那条路径下"道具不足"其实是购买卡写死的标题「{道具} 用完了」，与库存无关
 * ——用户看到的就是"明明有道具也说不足"。
 *
 * 现在只有一张卡，两个断言钉住：
 *  ① 卡上不能出现"用完了"这种与实际库存无关的措辞；
 *  ② 卡上的「买一个」按一下就要**真的成交**（余额、库存同时变），且卡自己关掉。
 */
check("说明框不写「用完了」那种与库存无关的措辞（有货时也不该写）",
  !cardText.includes("用完了"), cardText.slice(0, 60));
const beforeBuy = await page.evaluate(() => ({
  items: JSON.parse(localStorage.getItem("banbu-vcf-items-v1") || "{}").undo ?? 0,
  balance: JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]").reduce((s, x) => s + x.amount, 0),
}));
await page.locator("[data-vcf-item-buy]").click();
await page.waitForTimeout(700);
const afterBuy = await page.evaluate(() => ({
  items: JSON.parse(localStorage.getItem("banbu-vcf-items-v1") || "{}").undo ?? 0,
  balance: JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]").reduce((s, x) => s + x.amount, 0),
  dialogs: document.querySelectorAll("[role=dialog]").length,
}));
check("「买一个」**按一次就成交**（不再需要点两次）",
  afterBuy.items === beforeBuy.items + 1 && afterBuy.balance < beforeBuy.balance,
  `库存 ${beforeBuy.items}→${afterBuy.items}、余额 ${beforeBuy.balance}→${afterBuy.balance}`);
check("成交后卡自己关掉（不留一个还需要再点的框）", afterBuy.dialogs === 0,
  `还开着 ${afterBuy.dialogs} 张`);

// ── 5. 三种效果真的生效 ────────────────────────────────────────
section("5. 三种道具的效果");
await page.locator(".vcfch-primary").click();
await page.waitForTimeout(3500);
/**
 * 「不超过左边两个加起来的高度」——**这条要在开题之后量**（第 3 组那会儿 `.vcfch-meta`
 * 还没渲染）。当场读两段实高，不写死像素，这样以后左块字号再变也仍然算得对。
 */
const cap = await page.evaluate(() => {
  const h = (sel) => Math.round(document.querySelector(sel)?.getBoundingClientRect().height || 0);
  return { items: h("[data-vcf-items]"), chip: h(".vcfch-side-chip"), meta: h(".vcfch-meta") };
});
check("道具栏高度**不超过左块两段之和**（用户点名的上限，开题后当场量，容 1px 取整）",
  cap.meta > 0 && cap.items <= cap.chip + cap.meta + 1,
  `道具 ${cap.items}px vs 你执块 ${cap.chip}px + 「N 手 · 同级/高 N 级」${cap.meta}px = ${cap.chip + cap.meta}px`);
const clockBefore = await page.evaluate(() => Number((document.querySelector(".vcfch-clock b")?.textContent || "0")));
await page.locator("[data-vcf-item='extra-time']").click();
await page.waitForTimeout(600);
const clockAfter = await page.evaluate(() => Number((document.querySelector(".vcfch-clock b")?.textContent || "0")));
check("加时卡：剩余秒数真的 +30", clockAfter - clockBefore >= 28, `${clockBefore} → ${clockAfter} 秒`);
const timeMsg = (await page.locator(".vcfch-message").textContent().catch(() => "")) || "";
check("加时卡有一句反馈", timeMsg.includes("加时"), timeMsg.trim().slice(0, 30));
const timeLeft = await readItems(page);
check("加时卡扣了一个", timeLeft["extra-time"] === 2, `剩 ${timeLeft["extra-time"]} 个`);

// 提示卡：棋盘上出现建议圈
await page.locator("[data-vcf-item='hint']").click();
await page.waitForTimeout(700);
const hintRing = await page.evaluate(() => {
  const g = document.querySelector("[data-vcf-hint]");
  if (!g) return null;
  const c = g.querySelector("circle");
  const r = c?.getBoundingClientRect();
  return { idx: Number(g.dataset.vcfHint), visible: Boolean(r && r.width > 4 && r.height > 4) };
});
check("提示卡：棋盘上出现建议圈", Boolean(hintRing?.visible), JSON.stringify(hintRing));
const hintMsg = (await page.locator(".vcfch-message").textContent().catch(() => "")) || "";
check("提示卡报出建议坐标", /下一手走\s*[A-O]\d/.test(hintMsg.replace(/\s+/g, "")), hintMsg.trim().slice(0, 34));
check("提示卡不弹解法全文（只给一手，用户要的是「提示」不是「答案」）",
  !hintMsg.includes("解答第") && hintMsg.length < 60, hintMsg.trim());

// ── 6. 悔棋卡：能用才扣（这条钉住那个真 bug）───────────────────
section("6. 悔棋卡：「不能用就不该扣」");
/**
 * ⚠ 这一组**用一个全新的页面**，不复用上面那个已经被用掉道具/进过对局的页面。
 *
 * 理由是试过之后才明白的：VCF 的阶段机（待开始 → 对局 → 结算 → 下一题）
 * 有"匹配中"这种中间态，从上一组的状态往下推会依赖"点几次主按钮"这种脆弱的假设
 * （我在这儿连续两轮假失败）。新开一个页面、从"开始挑战"走一步进去，就完全没有歧义。
 */
const undoPage = await context.newPage();
await undoPage.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await undoPage.waitForSelector(".bottom-nav button", { timeout: 180000 });
await undoPage.evaluate(() => {
  localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
    { id: "seed", at: Date.now(), amount: 3000, reason: "achievement", detail: "本金" }]));
  // 只给悔棋卡，避免别的道具干扰
  localStorage.setItem("banbu-vcf-items-v1", JSON.stringify({ undo: 3 }));
});
await undoPage.reload({ waitUntil: "domcontentloaded" });
await undoPage.waitForSelector(".bottom-nav button", { timeout: 180000 });
await undoPage.waitForTimeout(700);
await undoPage.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
await undoPage.waitForTimeout(500);
await undoPage.locator("[data-duel-entry='vcf'] button").first().click();
await undoPage.waitForSelector("[data-vcf-items]", { timeout: 20000 });
await undoPage.waitForTimeout(900);
await undoPage.locator(".vcfch-primary").click();
await undoPage.waitForTimeout(3500);

const undoState = await undoPage.evaluate(() => ({
  disabled: Boolean(document.querySelector("[data-vcf-item='undo']")?.disabled),
  stones: document.querySelectorAll("[data-vcf-stone]").length,
}));
check("对局中悔棋卡可点（待开始阶段是禁用的 —— 那是有意的）",
  undoState.disabled === false, JSON.stringify(undoState));

const undoBefore = (await readItems(undoPage)).undo;
await undoPage.locator("[data-vcf-item='undo']").click();
await undoPage.waitForTimeout(700);
const undoAfter = (await readItems(undoPage)).undo;
check("未落子时点悔棋：**道具不扣**（实测过的真 bug：白损失一个）",
  undoAfter === undoBefore, `${undoBefore} → ${undoAfter}`);
const undoMsg = ((await undoPage.locator(".vcfch-message").textContent().catch(() => "")) || "").trim();
check("未落子时点悔棋：如实说没得悔",
  undoMsg.includes("没有落子") || undoMsg.includes("没有可悔"), undoMsg.slice(0, 30));
const stonesUnchanged = await undoPage.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
check("未落子时点悔棋：盘面不动", stonesUnchanged === undoState.stones,
  `${undoState.stones} → ${stonesUnchanged} 颗`);
await undoPage.close();

// ── 7. 没货时点图标 → 购买框 ───────────────────────────────────
section("7. 没货时弹购买框（用户：「不供购买，除非没有了」）");
await page.evaluate(() => localStorage.setItem("banbu-vcf-items-v1", JSON.stringify({ hint: 0 })));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(700);
await openVcf();
await page.locator("[data-vcf-item='hint']").click();
await page.waitForTimeout(600);
check("提示卡数量为 0 时点图标 → 弹购买框",
  (await page.locator("[data-vcf-item-purchase='hint']").count()) === 1);
// 钱不够时：不扣钱、不发货、如实说明
await page.evaluate(() => localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([
  { id: "poor", at: Date.now(), amount: 5, reason: "achievement", detail: "只剩 5" }])));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
await installDiagGuard(page);
await page.waitForTimeout(700);
await openVcf();
await page.locator("[data-vcf-item='hint']").click();
await page.waitForTimeout(500);
await page.locator("[data-vcf-item-confirm]").click();
await page.waitForTimeout(700);
check("钱不够时**不扣钱**", (await readSoul(page)) === 5, `余额 ${await readSoul(page)}`);
check("钱不够时**不发道具**", ((await readItems(page)).hint ?? 0) === 0);
check("钱不够时如实说明（提示里提「攒」）",
  (((await page.locator(".soul-buy-error").textContent()) || "").includes("攒")),
  ((await page.locator(".soul-buy-error").textContent()) || "").trim().slice(0, 34));

// ── 8. 运行期 ──────────────────────────────────────────────────
section("8. 运行期");
check("全程没有未捕获异常", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
process.stdout.write(`\n${failures === 0 ? "全部通过" : "有失败"}：${checks - failures}/${checks} 项检查通过。\n`);
if (failures > 0) process.exit(1);
