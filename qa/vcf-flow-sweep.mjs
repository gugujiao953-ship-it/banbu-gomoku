/**
 * qa/vcf-flow-sweep.mjs — VCF 挑战整条流程黑盒扫查（用户 10-06：「测试整个 vcf 挑战的所有内容」）。
 * 覆盖：进入 → 设置面板（草稿/取消/确定）→ 开始 → 落子合法性提示 → 认输结算 → 下一题 →
 *       查看解答（解答视图：盘上 = 初始局面 + 解答前 k 手，上一手/下一手逐颗进退，隐藏后逐子恢复答题盘面）
 *       → 摆棋（复盘式：空点落子/已有子不动/颜色自动交替/撤销回退颜色/重做/清空/复原/退出）
 *       → 做题记录（翻页/点进去）→ 返回对弈。
 * 只报"该出现的东西没出现"，页面上出现的报错也一并抓。
 * 用法：node qa/vcf-flow-sweep.mjs [base]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5198/";
const clickByText = (page, text) => page.evaluate((t) => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === t);
  if (b) { b.click(); return true; }
  return false;
}, text);
const clickByTextIn = (page, sel, text) => page.evaluate(([s, t]) => {
  const root = document.querySelector(s);
  if (!root) return false;
  const b = Array.from(root.querySelectorAll("button")).find((x) => (x.textContent || "").trim().includes(t));
  if (b) { b.click(); return true; }
  return false;
}, [sel, text]);
const clickNav = (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const b = nav ? Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === l) : null;
  if (b) { b.click(); return true; }
  return false;
}, label);
const primary = (page) => page.evaluate(() => {
  const b = document.querySelector(".vcfch-bottom .vcfch-primary");
  return b ? b.textContent.trim() : null;
});
/** 等主按钮变成指定文案（深档出题要进生成器，「匹配中…」不算开始；固定 sleep 会抢跑）。 */
const waitForPrimary = async (page, want, timeoutMs = 40000) => {
  const t0 = Date.now();
  for (;;) {
    const p = await primary(page);
    if (p === want) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await page.waitForTimeout(250);
  }
};
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, " ").trim() ?? null, sel);
/** 真鼠标点棋盘：从左上往右下试，直到**真的落下一颗子**（盘上子数变多）或试完整盘。
 *  只看「提示变了」不够——「请形成四」也是提示变化但一颗子都没落，
 *  那样后面解答视图断言的"用户盘面"就和初始局面一样，守不住"你落的子不泄进解答视图"。 */
const playOneLegal = async (page) => {
  const box = await page.evaluate(() => {
    const svg = document.querySelector(".vcfch-board");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, view: 572, margin: 46, cell: (572 - 92) / 14 };
  });
  if (!box) return "no-board";
  const stonesAtStart = await page.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
  for (let r = 0; r < 15; r += 1) {
    for (let c = 0; c < 15; c += 1) {
      const x = box.left + ((box.margin + c * box.cell) / box.view) * box.width;
      const y = box.top + ((box.margin + r * box.cell) / box.view) * box.height;
      if (y < 80 || y > 820) continue;                 // 视口外的跳过
      await page.mouse.click(x, y);
      await page.waitForTimeout(120);
      const placed = await page.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
      if (placed > stonesAtStart) {
        const now = await text(page, ".vcfch-message");
        return `${r},${c} → ${now}（落子 ${stonesAtStart}→${placed}）`;
      }
    }
  }
  return "点了整盘一颗子都没落下";
};
/** 摆棋用：把某个交叉点（idx = row*15+col）用真鼠标点一下。 */
const tapIdx = async (page, idx) => {
  const box = await page.evaluate(() => {
    const svg = document.querySelector(".vcfch-board");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  if (!box || idx === null || Number.isNaN(idx)) return false;
  const view = 572, margin = 46, cell = (572 - 92) / 14;
  const r = Math.floor(idx / 15), c = idx % 15;
  const x = box.left + ((margin + c * cell) / view) * box.width;
  const y = box.top + ((margin + r * cell) / view) * box.height;
  await page.mouse.click(x, y);
  return true;
};
/** 摆棋用：找第一个在视口内、且盘上没有子的交叉点。 */
const findEmptyVisibleIdx = (page) => page.evaluate(() => {
  const svg = document.querySelector(".vcfch-board");
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  const view = 572, margin = 46, cell = (572 - 92) / 14;
  const used = new Set(Array.from(document.querySelectorAll("[data-vcf-stone]")).map((g) => Number(g.getAttribute("data-vcf-stone"))));
  for (let idx = 0; idx < 225; idx += 1) {
    const row = Math.floor(idx / 15);
    const y = r.top + ((margin + row * cell) / view) * r.height;
    if (y < 100 || y > 790) continue;
    if (!used.has(idx)) return idx;
  }
  return null;
});
/** 摆棋状态行里的「下一手」是黑还是白（读不到返回 null，断言就会红——不空转）。 */
const turnSide = (t) => (t || "").match(/下一手\s*([黑白])方/)?.[1] ?? null;
/** 盘面快照：盘上每颗子记成 "idx:player"（读 data-vcf-stone / data-vcf-player 探针），
 *  排序后拼串——两次快照字符串相等 = 盘面逐子一致（位置和颜色都不差）。 */
const stoneSnapshot = (page) => page.evaluate(() => Array.from(document.querySelectorAll("[data-vcf-stone]"))
  .map((g) => `${g.getAttribute("data-vcf-stone")}:${g.getAttribute("data-vcf-player")}`).sort().join(","));
const countOf = (snap) => (snap ? snap.split(",").filter(Boolean).length : 0);

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

// **门禁自带棋魂本金**（2026-10-12 第二轮：五档起始等级整体涨价到 500–1600 魂，
// 而这条门禁要买最贵的「12 级」档 = 1600 魂）。以前它依赖环境里恰好有多少余额，
// 空档案上会假红（"确认重置"点了不扣钱也不落地）。用 addInitScript 在应用脚本之前写进去，
// 这样商店 hook 挂载时读到的就是这笔本金，不需要中途 reload 打断流程。
await page.addInitScript(() => {
  const KEY = "banbu-soul-ledger-v1";
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { raw = []; }
  if (!Array.isArray(raw)) raw = [];
  const have = raw.reduce((sum, item) => sum + (item && item.amount > 0 ? item.amount : 0), 0);
  if (have < 5000) {
    raw.push({ id: "qa-seed", at: Date.now(), amount: 5000 - have, reason: "achievement", detail: "门禁本金" });
    localStorage.setItem(KEY, JSON.stringify(raw));
  }
});

// 冷启动（vite 首次转译整棵模块图）会让 DOMContentLoaded 等上 30s+，超时给足 120s
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(1200);
// 全新 profile 会先弹「首次使用」欢迎卡（整屏遮挡，盖住棋盘）——真机首启也是这样，先关掉它。
if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) {
  await clickByText(page, "先自己试试");
  await page.waitForTimeout(500);
  check("首次使用欢迎卡可关闭", await page.evaluate(() => !document.querySelector(".first-run-backdrop")));
}
await clickNav(page, "对弈");
await page.waitForTimeout(600);
await clickByText(page, "开始挑战");
await page.waitForSelector(".vcfch-board", { timeout: 20000 });
await page.waitForTimeout(1500);
check("进入 VCF 挑战页", true);

// ── 设置面板：草稿语义 ──
await page.evaluate(() => document.querySelector(".vcfch-top-actions button").click());
await page.waitForTimeout(400);
check("齿轮打开设置面板", await text(page, ".vcfch-sheet > header b") === "VCF 挑战设置");
// 注：头部现在有**两枚**同款小按钮（「?」说明 + 「重置等级分」），所以按 data 属性定位，
// 不再用 .vcfch-sheet-mini 抓第一个（那是「?」）。
check("右上角有「重置等级分」小按钮", await page.evaluate(() => !!document.querySelector("[data-vcf-reset]")));
const bottomBar = await text(page, ".vcfch-sheet-actions");
check("底部是「取消 确定」", !!bottomBar && bottomBar.includes("取消") && bottomBar.includes("确定"), bottomBar);
check("底部没有旧的整行重置按钮（重置只在头部小按钮里）", await page.evaluate(() => {
  const bar = document.querySelector(".vcfch-sheet-actions");
  const inBar = bar ? Array.from(bar.querySelectorAll("button")).map((b) => b.textContent.trim()) : [];
  const mini = document.querySelector("[data-vcf-reset]");
  return !inBar.includes("重置等级分") && !!mini && mini.textContent.trim() === "重置等级分";
}));
// 用户要的「尽量一屏显示」：设置页（重置面板收起时）不该出现滚动条
const fit = await page.evaluate(() => {
  const sheet = document.querySelector(".vcfch-sheet");
  if (!sheet) return null;
  return { scroll: sheet.scrollHeight, client: sheet.clientHeight };
});
check("设置面板一屏放得下（不需要滚动）", !!fit && fit.scroll <= fit.client + 2, fit ? `${fit.scroll} / ${fit.client}` : "?");

// ── 设置面板右上角「?」：全部设置说明（用户 10-06：「专门详细在这个说明里面写好」） ──
check("① 设置面板头部有「?」说明按钮", await page.evaluate(() =>
  document.querySelector(".vcfch-sheet > header [data-vcf-help]")?.textContent.trim() === "?"));
await page.evaluate(() => { const b = document.querySelector("[data-vcf-help]"); if (b) b.click(); });
await page.waitForTimeout(300);
check("② 点「?」打开说明面板", await page.evaluate(() => !!document.querySelector("[data-vcf-help-panel]")));
const helpText = await text(page, "[data-vcf-help-panel]");
/**
 * 关键口径必须在：分节标题 + 三档时限的**上限秒数**。
 * ⚠ 上限从 `rating.ts` 的 `PACE_CAP` 现读（2026-10-14 那张表改成「13 级后每 2 级加一次 +
 *   三档上限 120/210/300」，式子内推已经算不出上限了——不够会在最高级补满、超了夹住），
 *   上一版写死 "60s/90s/150s"，用户 10-12 重定表之后这条就假红：说明是 `paceRow()` 从代码
 *   现算的，写死的期望反而成了漂移源。
 */
const ratingSrc = (await import("node:fs")).readFileSync("src/features/vcf-challenge/rating.ts", "utf8");
const paceField = (constName, key) => Number(
  new RegExp(`${constName}: Record<PaceMode, number> = \\{[^}]*${key}:\\s*(\\d+)`).exec(ratingSrc)?.[1] ?? 0);
const paceCaps = ["default", "ample", "casual"].map((k) => `${paceField("PACE_CAP", k)}s`);
const needHelp = ["计时难度", "等级差", "生成器", "起始档位", "摆棋", "看解答", ...paceCaps];
const missHelp = needHelp.filter((k) => !(helpText || "").includes(k));
check(`② 说明里有全部关键口径（六个分节 + 三档上限 ${paceCaps.join("/")}，从 PACE_CAP 现读）`,
  missHelp.length === 0, missHelp.length ? "缺：" + missHelp.join("、") : `${needHelp.length} 条全在`);
const helpSections = await page.evaluate(() => document.querySelectorAll("[data-vcf-help-panel] h4").length);
check("② 说明按分节写（≥10 节）", helpSections >= 10, `${helpSections} 节`);
// ③ 说明区自己滚到底；底部「取消 / 确定」原地可见可点（不能被说明滚走）
const helpScroll = await page.evaluate(() => {
  const h = document.querySelector(".vcfch-help");
  if (!h) return null;
  h.scrollTop = h.scrollHeight;                        // 滚到底
  const bar = document.querySelector(".vcfch-sheet-actions");
  const r = bar ? bar.getBoundingClientRect() : null;
  const btns = bar ? Array.from(bar.querySelectorAll("button")) : [];
  return {
    scroll: h.scrollHeight, client: h.clientHeight, bottom: h.scrollTop,
    barInView: !!r && r.top >= 0 && r.bottom <= window.innerHeight + 1,
    labels: btns.map((b) => (b.textContent || "").trim()),
    enabled: btns.length === 2 && btns.every((b) => !b.disabled),
  };
});
check("③ 说明面板可滚到底（scrollHeight > clientHeight）",
  !!helpScroll && helpScroll.scroll > helpScroll.client && helpScroll.bottom > 0,
  helpScroll ? `${helpScroll.scroll} / ${helpScroll.client} · 滚到 ${Math.round(helpScroll.bottom)}` : "?");
check("③ 底部「取消/确定」仍可见可用（不被说明滚走）",
  !!helpScroll && helpScroll.barInView && helpScroll.enabled,
  helpScroll ? `可见=${helpScroll.barInView} · ${helpScroll.labels.join(" / ")}` : "?");
// ④ 再点一次「?」= 关闭说明、回到设置面板，chip 仍在
await page.evaluate(() => { const b = document.querySelector("[data-vcf-help]"); if (b) b.click(); });
await page.waitForTimeout(250);
check("④ 再点「?」回到设置面板（说明收起）", await page.evaluate(() =>
  !document.querySelector("[data-vcf-help-panel]") && !!document.querySelector(".vcfch-sheet-tabs")));
const chipsBack = await page.evaluate(() => document.querySelectorAll(".vcfch-sheet .vcfch-picker-row .chip").length);
check("④ 设置面板 chip 仍在", chipsBack >= 10, `${chipsBack} 枚 chip`);
// ⑤ 设置 tab 里那些说明小字已收进「?」（旧口径「×3」「45 秒」不该再出现在面板上）
const sheetNotes = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".vcfch-sheet-note")).map((n) => (n.textContent || "").trim()).join(" ｜ "));
check("⑤ 设置面板里旧的说明小字已清掉（无「×3」「45 秒」）",
  !sheetNotes.includes("×3") && !sheetNotes.includes("45 秒"), sheetNotes || "（无 note）");

const timeBefore = await text(page, ".vcfch-top-info");
// 2026-10-06 起计时改三档「计时难度」（默认 ×2 / 充裕 ×1 / 休闲 ×0.5，时限随手数伸缩）——
// 旧的「每局时间 180 秒」四档没了，这里切「休闲 ×0.5」验证草稿/取消语义。
// 注意 clickByTextIn 只在**第一个** .vcfch-sheet-row 里找按钮，这里必须先定位「计时难度」那一行再点。
const paceChipRow = () => page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row"));
  return rows.find((r) => (r.querySelector("span")?.textContent || "").includes("计时难度")) ?? null;
});
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row"));
  const row = rows.find((r) => (r.querySelector("span")?.textContent || "").includes("计时难度"));
  const b = row ? Array.from(row.querySelectorAll("button")).find((x) => (x.textContent || "").includes("休闲")) : null;
  if (b) b.click();
});
await page.waitForTimeout(150);
check("设置面板有「计时难度」三枚 chip 与伸缩说明", await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row"));
  const row = rows.find((r) => (r.querySelector("span")?.textContent || "").includes("计时难度"));
  if (!row) return false;
  const chips = Array.from(row.querySelectorAll("button")).map((b) => b.textContent.trim());
  const note = row.querySelector("small")?.textContent ?? "";
  return chips.length === 3
    && chips.some((c) => c.includes("默认") && c.includes("×2"))
    && chips.some((c) => c.includes("充裕") && c.includes("×1"))
    && chips.some((c) => c.includes("休闲") && c.includes("×0.5"))
    && note.includes("时限随手数伸缩");
}));
const chipSelected = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row"));
  const row = rows.find((r) => (r.querySelector("span")?.textContent || "").includes("计时难度"));
  return row?.querySelector("button.chip.selected")?.textContent?.trim() ?? null;
});
check("点「休闲」chip 草稿选中态跟随", chipSelected === "休闲 ×0.5", chipSelected || "?");
await clickByTextIn(page, ".vcfch-sheet", "取消");
await page.waitForTimeout(300);
const timeAfterCancel = await text(page, ".vcfch-top-info");
check("「取消」不落地草稿（计时难度不变）", timeBefore === timeAfterCancel, `${timeBefore} → ${timeAfterCancel}`);

await page.evaluate(() => document.querySelector(".vcfch-top-actions button").click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const b = document.querySelector("[data-vcf-reset]");
  if (b) b.click();
});
await page.waitForTimeout(300);
check("小按钮展开重置档位面板", await page.evaluate(() => !!document.querySelector(".vcfch-sheet-reset")));
// 用户 10-12 改版：重置档位从「手数档」改成**五个等级档**（1 / 3 / 6 / 9 / 12 级）。
check("重置面板有 5 个档位（1/3/6/9/12 级）+ 确认按钮", await page.evaluate(() => {
  const p = document.querySelector(".vcfch-sheet-reset");
  const chips = p ? Array.from(p.querySelectorAll(".vcfch-picker-row button")).map((b) => b.textContent.trim()) : [];
  const ok = p ? Array.from(p.querySelectorAll("button")).some((b) => b.textContent.includes("确认重置")) : false;
  const want = ["等级 1", "等级 3", "等级 6", "等级 9", "等级 12"];
  return chips.length === 5 && want.every((w, i) => chips[i].startsWith(w)) && ok;
}));

/**
 * **重置面板必须收费**（2026-10-11 新增，修的是用户报的"其他通道可以免费"）。
 *
 * 这个面板曾经是**免费**的，而「设置 → 棋魂解锁」里同一件事明码标价
 * （重置到最低档 200 魂、自选起始档 500 魂）—— 于是商店那两件商品形同虚设。
 * 现在它走 `useSoulShop().spend`，所以这里钉三件事：
 *  ① 面板上有价格提示；② 跳档的价格与最低档**不同**（是两件商品）；
 *  ③ 确认之后**余额真的少了**。
 *
 * ⚠ 只断言"面板还在/文案对"挡不住修复前那种情况 —— 那时面板长得一模一样、
 * 文案也一模一样，只是**不扣钱**。所以必须比余额。
 */
const soulBalanceOf = () => page.evaluate(() => {
  try {
    const raw = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]");
    return Array.isArray(raw) ? raw.reduce((sum, item) => sum + (item.amount || 0), 0) : 0;
  } catch { return 0; }
});
const priceNoteLow = await text(page, "[data-vcf-reset-price]");
check("重置面板写明这次要花多少棋魂", /花 \d+ 棋魂/.test(priceNoteLow || ""), priceNoteLow || "?");
// 摆到最高档「12 级」= 3300 分 = 12 手档：匹配到的题足够深（解答 ≥ 5 手），
// 下面的解答视图断言才真的能往回退三步（最低档常匹配到 1 手题，退无可退，只能断言按钮禁用）。
await page.evaluate(() => {
  const chip = Array.from(document.querySelectorAll(".vcfch-sheet-reset .vcfch-picker-row button"))
    .find((x) => (x.textContent || "").includes("等级 12"));
  if (chip) chip.click();
});
await page.waitForTimeout(200);
const priceNote13 = await text(page, "[data-vcf-reset-price]");
check("跳档与重置到最低档**标价不同**（越高档越贵）",
  Boolean(priceNote13) && priceNote13 !== priceNoteLow,
  `最低档「${(priceNoteLow || "").trim()}」 vs 12 级档「${(priceNote13 || "").trim()}」`);
const balanceBeforeReset = await soulBalanceOf();
await clickByTextIn(page, ".vcfch-sheet", "确认重置等级分");
await page.waitForTimeout(400);
check("重置到 12 级档（解答视图断言要用深题）", ((await text(page, ".vcfch-message")) || "").includes("等级分已重置"), await text(page, ".vcfch-message"));
const balanceAfterReset = await soulBalanceOf();
check("重置**真的扣了棋魂**（不是免费旁路）",
  balanceAfterReset < balanceBeforeReset,
  `${balanceBeforeReset} → ${balanceAfterReset}`);
await clickByTextIn(page, ".vcfch-sheet", "取消");
await page.waitForTimeout(300);

// ── 开始 → 落子 → 认输 ──
await clickByTextIn(page, ".vcfch-bottom", "开始挑战");
check("开始挑战进入对局", await waitForPrimary(page, "认输（判负）"), await primary(page) || "?");
// 解答视图断言的基准：刚开局时盘上就是题目初始局面（存快照，后面计数与逐子比对都用它）
const initialStoneMap = await stoneSnapshot(page);
const initialCount = countOf(initialStoneMap);
check("开局盘面可数（初始局面有子）", initialCount > 0, `初始 ${initialCount} 颗`);
const meta = await text(page, ".vcfch-meta");
// R193 起状态行不再写「≈X 分」（那条题分曲线与等级分不同尺度，已整条删除），
// 改成写「这题相对你是同级 / 越几级」——与结算用的同一条 gap 式子。
check("状态行显示手数与「这题相对你是同级还是越几级」", /手 · (同级|高 \d+ 级|低 \d+ 级)/.test(meta || ""), meta || "?");

const msgBefore = await text(page, ".vcfch-message");
const clickResult = await playOneLegal(page);
const msgAfterMove = await text(page, ".vcfch-message");
const playStonesPlaced = (await stoneSnapshot(page)) !== initialStoneMap;
check("点棋盘真的落了子（冲四进账，不是只弹提示）", playStonesPlaced, `${clickResult}｜提示：${msgAfterMove}`);
check("点棋盘有反应（提示跟随局面变化）", msgAfterMove !== msgBefore || /四|禁手|子/.test(msgAfterMove || ""), `提示：${msgAfterMove}`);

await clickByTextIn(page, ".vcfch-bottom", "认输");
await page.waitForTimeout(800);
check("认输后进入结算（下一题）", await primary(page) === "下一题", await primary(page) || "?");
const delta = await text(page, ".vcfch-delta");
check("结算显示等级分变化", !!delta && delta.includes("等级分"), delta || "?");

// ── 解答步进（「查看解答」默认停在最后一手，可以往回走） ──
// 用户 10-06 报的 bug：解答以前是**叠加**在"你这一局"的盘面上画的——「上一手」只撤覆盖层，
// 你自己落的子还留在盘上（看起来"一个个往前覆盖、不回退"）。改成解答视图后，
// 盘上永远只有「题目初始局面 + 解答前 k 手」，上一手/下一手就是真的少一颗/多一颗。
const playStoneMap = await stoneSnapshot(page);
await clickByTextIn(page, ".vcfch-actions", "查看解答");
await page.waitForTimeout(600);
const solBar = await text(page, ".vcfch-solution-bar");
check("查看解答有步进条", !!solBar && solBar.includes("解答第"), solBar || "?");
const lastStep = Number((solBar || "").match(/解答第 (\d+)/)?.[1] ?? 0);
const totalStep = Number((solBar || "").match(/\/ (\d+) 手/)?.[1] ?? 0);
check("默认停在最后一手（解答一次看全）", lastStep === totalStep && totalStep > 0, `${lastStep}/${totalStep}`);
check("最后一手时「下一手」禁用", await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".vcfch-actions button")).find((x) => x.textContent.includes("下一手"));
  return b ? b.disabled : null;
}) === true);
// ① 打开解答：盘上子数 = 初始局面 + 解答全部手数（你答题落的子不再出现在盘上）
const openSnap = await stoneSnapshot(page);
check("① 打开解答：盘上子数 = 初始局面 + 解答全部手数",
  countOf(openSnap) === initialCount + totalStep,
  `盘上 ${countOf(openSnap)} = 初始 ${initialCount} + 解答 ${totalStep}`);
// ① 「上一手」逐手回退（最多退三步）：每退一手正好少一颗、步进条跟着走
const backTimes = Math.min(3, totalStep - 1);
for (let i = 1; i <= backTimes; i += 1) {
  await clickByTextIn(page, ".vcfch-actions", "上一手");
  await page.waitForTimeout(250);
  const snap = await stoneSnapshot(page);
  const expected = initialCount + totalStep - i;
  const bar = await text(page, ".vcfch-solution-bar");
  check(`① 上一手 ×${i}：正好少一颗（盘上 = 初始 ${initialCount} + 解答前 ${totalStep - i} 手）`,
    countOf(snap) === expected && !!bar && bar.includes(`解答第 ${totalStep - i} /`),
    `盘上 ${countOf(snap)} / 期望 ${expected} · 步进条「${bar}」`);
}
// ② 一进一退：下一手正好多一颗、上一手正好少一颗（不多不少）
if (totalStep >= 2) {
  const beforeNext = countOf(await stoneSnapshot(page));
  await clickByTextIn(page, ".vcfch-actions", "下一手");
  await page.waitForTimeout(250);
  const afterNext = countOf(await stoneSnapshot(page));
  check("② 「下一手」正好多一颗", afterNext === beforeNext + 1, `${beforeNext} → ${afterNext}`);
  await clickByTextIn(page, ".vcfch-actions", "上一手");
  await page.waitForTimeout(250);
  const afterPrev = countOf(await stoneSnapshot(page));
  check("② 「上一手」正好少一颗", afterPrev === afterNext - 1, `${afterNext} → ${afterPrev}`);
} else {
  // 1 手题（新题库里的入门题）只有一步，没有进退可言 —— 断言两个方向都禁用
  check("② 1 手题：上一手/下一手都禁用", await page.evaluate(() =>
    ["上一手", "下一手"].every((t) => Array.from(document.querySelectorAll(".vcfch-actions button"))
      .find((x) => x.textContent.includes(t))?.disabled === true)));
}
// ③ 隐藏解答：恢复你答题时的盘面（逐子一致：位置与颜色一颗不差）
await clickByTextIn(page, ".vcfch-actions", "隐藏解答");
await page.waitForTimeout(300);
check("隐藏解答后回到原操作条", await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-actions button")).some((b) => b.textContent.includes("查看解答"))));
const backToPlay = await stoneSnapshot(page);
check("③ 隐藏解答后盘面与答题时逐子一致", backToPlay === playStoneMap,
  backToPlay === playStoneMap ? `共 ${countOf(backToPlay)} 颗` : `现在 [${backToPlay}] / 之前 [${playStoneMap}]`);

// ── 摆棋（复盘式：只在空点按手序落子、颜色自动交替、撤销回退颜色） ──
await clickByTextIn(page, ".vcfch-actions", "摆棋");
await page.waitForTimeout(500);
check("进入摆棋（退出摆棋按钮）", await primary(page) === "退出摆棋", await primary(page) || "?");
const setupTools = await text(page, ".vcfch-setup-bar");
// 用户 10-07：「复原」与「清空」功能撞了，删掉「复原」、清 log/lastMove 并进「清空」
check("摆棋工具条含 上一步/下一步/清空（无「复原」）", !!setupTools && setupTools.includes("清空") && setupTools.includes("上一步") && setupTools.includes("下一步") && !setupTools.includes("复原"), setupTools || "?");
await clickByTextIn(page, ".vcfch-setup-bar", "清空");
await page.waitForTimeout(300);

// 颜色必须可见：状态行写明「摆棋中 · 下一手 X方」，用户看得见、脚本断言得到
const turnStartText = await text(page, "[data-vcf-setup-turn]");
const turnStart = turnSide(turnStartText);
const attackerSide = ((await text(page, ".vcfch-side-chip b")) || "").trim();
check("摆棋状态行写明「摆棋中 · 下一手 X方」", !!turnStartText && turnStartText.includes("摆棋中") && turnStartText.includes("下一手") && turnStart !== null, turnStartText || "?");
check("摆棋起点轮本题攻方先手（清空后）", turnStart !== null && turnStart === attackerSide, `下一手 ${turnStart} / 你执 ${attackerSide}`);

// ① 复盘式摆棋：点已有子什么都不做——该子仍在、局面一个字节都不变
const occupiedIdx = await page.evaluate(() => {
  const g = document.querySelector("[data-vcf-stone]");
  return g ? Number(g.getAttribute("data-vcf-stone")) : null;
});
const stonesBefore = await page.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
const boardHtmlBefore = await page.evaluate(() => document.querySelector(".vcfch-board")?.innerHTML ?? "");
await tapIdx(page, occupiedIdx);
await page.waitForTimeout(250);
const occupiedKept = await page.evaluate((i) => !!document.querySelector(`[data-vcf-stone="${i}"]`), occupiedIdx);
const stonesAfterOccupied = await page.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
const boardHtmlAfter = await page.evaluate(() => document.querySelector(".vcfch-board")?.innerHTML ?? "");
check("① 摆棋点已有子：该子仍在、局面不变", occupiedIdx !== null && occupiedKept && stonesAfterOccupied === stonesBefore && boardHtmlAfter === boardHtmlBefore, `点 idx=${occupiedIdx} · 子 ${stonesBefore}→${stonesAfterOccupied}`);

// ② 空点落一手：落的正是显示的那一色，下一手自动变成对方
const emptyIdx = await findEmptyVisibleIdx(page);
const turnBeforePlace = turnSide(await text(page, "[data-vcf-setup-turn]"));
await tapIdx(page, emptyIdx);
await page.waitForTimeout(250);
const placedPlayer = await page.evaluate((i) => document.querySelector(`[data-vcf-stone="${i}"]`)?.getAttribute("data-vcf-player") ?? null, emptyIdx);
const placedSide = placedPlayer === "1" ? "黑" : placedPlayer === "2" ? "白" : null;
const turnAfterPlace = turnSide(await text(page, "[data-vcf-setup-turn]"));
check("② 空点落一手：下一手变成对方颜色", emptyIdx !== null && placedSide !== null && placedSide === turnBeforePlace && turnAfterPlace !== null && turnAfterPlace !== turnBeforePlace, `${turnBeforePlace} → 落${placedSide} → ${turnAfterPlace}`);

// ③ 上一步：撤掉这一手，下一手正好回到被撤销那一手的颜色（用户报的 bug）
await clickByTextIn(page, ".vcfch-setup-bar", "上一步");
await page.waitForTimeout(250);
const turnAfterUndo = turnSide(await text(page, "[data-vcf-setup-turn]"));
const undoneGone = !(await page.evaluate((i) => !!document.querySelector(`[data-vcf-stone="${i}"]`), emptyIdx));
check("③ 上一步撤销：子撤掉、下一手回到被撤销那一手颜色", undoneGone && turnAfterUndo !== null && turnAfterUndo === turnBeforePlace && turnAfterUndo !== turnAfterPlace, `撤销前 ${turnAfterPlace} → 撤销后 ${turnAfterUndo}（被撤销的是${placedSide}）`);

// 「下一步」重做：颜色跟着推进回去
await clickByTextIn(page, ".vcfch-setup-bar", "下一步");
await page.waitForTimeout(250);
const turnAfterRedo = turnSide(await text(page, "[data-vcf-setup-turn]"));
check("摆棋「下一步」重做：颜色跟着推进回去", turnAfterRedo === turnAfterPlace, `重做后 ${turnAfterRedo} / 期望 ${turnAfterPlace}`);

// ④ 清空：回到本题初始局面，下一手重置为攻方先手（原「复原」的职责已并进「清空」）
const emptyIdx2 = await findEmptyVisibleIdx(page);
await tapIdx(page, emptyIdx2);
await page.waitForTimeout(250);
await clickByTextIn(page, ".vcfch-setup-bar", "清空");
await page.waitForTimeout(300);
const turnAfterReset = turnSide(await text(page, "[data-vcf-setup-turn]"));
const resetStoneGone = !(await page.evaluate((i) => !!document.querySelector(`[data-vcf-stone="${i}"]`), emptyIdx2));
check("④ 摆棋「清空」：回初始局面、下一手重置为攻方", resetStoneGone && turnAfterReset !== null && turnAfterReset === attackerSide, `下一手 ${turnAfterReset} / 攻方 ${attackerSide}`);

// ⑤ 清空留在摆棋模式（和「退出摆棋」区分开）：清完还该在摆棋里，不能顺手退出
check("⑤ 清空后仍留在摆棋模式（退出摆棋按钮还在）", await primary(page) === "退出摆棋", await primary(page) || "?");

await clickByTextIn(page, ".vcfch-bottom", "退出摆棋");
await page.waitForTimeout(500);
check("退出摆棋回到结算态（不重开）", await primary(page) === "下一题", await primary(page) || "?");

// ── 下一题 ──
await clickByTextIn(page, ".vcfch-bottom", "下一题");
check("下一题进入新对局", await waitForPrimary(page, "认输（判负）"), await primary(page) || "?");

// ── 做题记录 ──
await page.evaluate(() => document.querySelector(".vcfch-top-actions button").click());
await page.waitForTimeout(400);
await clickByTextIn(page, ".vcfch-sheet-tabs", "做题记录");
await page.waitForTimeout(400);
const recHead = await text(page, ".vcfch-records-head");
check("做题记录分页头", !!recHead && recHead.includes("页"), recHead || "?");
const recRows = await page.evaluate(() => document.querySelectorAll(".vcfch-records-row, .vcfch-record-row, .vcfch-records li").length);
check("记录里有条目", recRows > 0, `行数 ${recRows}`);
await clickByTextIn(page, ".vcfch-sheet", "取消");
await page.waitForTimeout(300);

// ── 返回对弈 ──
// R128 起：一局未结算时，返回先弹「退出 VCF 挑战？」确认（这题刚开、还没结算）——这里走「退出」。
await page.evaluate(() => {
  const b = document.querySelector(".vcfch-top-row button");
  if (b) b.click();
});
await page.waitForTimeout(600);
check("未结算返回先弹退出确认", await page.evaluate(() => !!document.querySelector("[data-vcf-exit-leave]")));
await page.evaluate(() => { const b = document.querySelector("[data-vcf-exit-leave]"); if (b) b.click(); });
await page.waitForTimeout(600);
check("返回对弈", await page.evaluate(() => !document.querySelector(".vcfch-page")));

console.log("");
const bad = results.filter((r) => !r.ok);
console.log(`结果：${results.length - bad.length}/${results.length} 通过`);
if (errors.length) { console.log("页面报错："); for (const e of errors.slice(0, 8)) console.log("   " + e); }
if (bad.length) { console.log("未通过："); for (const b of bad) console.log("   ✗ " + b.name + " — " + b.detail); }
/* 这台机器上 Playwright 的 browser.close() 偶尔挂住（headless-shell 不退），
   给它 4 秒上限就退出——正常环境里 close 先返回，行为不变。 */
await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 4000))]);
process.exit(bad.length || errors.length ? 1 : 0);
