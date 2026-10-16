/**
 * 常驻门禁：人机对弈的「自定义开局」模式（用户 2026-10-13）。
 * 用法：QA_BASE_URL=http://127.0.0.1:5199/ node qa/duel-custom-opening-check.mjs
 *
 * ## 规则（照用户原话实现）
 *
 * 「先选择有禁无禁，再摆棋子，这个时候可以随时选择开始（开始后就正式进入对局，无法撤销了），
 *  然后这个模式是没有棋魂奖励的」
 *
 * ## 这一组要钉住的东西
 *
 *  A **入口**：设置浮层里"开局"那一行两格（按规则开局 / 自定义开局），与"规则"那两格正交
 *    ——自定义开局**不是** `AI_RULE_PRESET_GUIDES` 的第 12 条（那条表是开局流程预设，
 *    `rule-guide-data.test.ts` 按精确数组比对比它，加一条就红）。
 *  B **摆子阶段**：棋盘可点、黑白轮流（黑先）、**AI 一步都不许动**——摆到"轮到 AI 的颜色"
 *    再等 4 秒，子数必须没变（这是最容易做漏的一条：颜色一轮到 AI，各处调度都会想点火）；
 *    撤销摆子 / 清空当场生效（不是草稿 overlay 的"保存后生效"）。
 *  C **开始**：横幅消失、标题从「摆子中 · N 子」变成「第 N 手」；**摆下去的那些子不能靠悔棋退掉**
 *    （没有可悔的落子时按钮禁用，文案指向横幅上的「撤销摆子」）。
 *    ⚠ 2026-10-15 起这一局的悔棋**不扣棋魂、没有「前 10 手」锁、终局后还能悔**（R214），
 *      所以这里不再断言「开始对局后 10 手内不能悔棋」；那套锁只约束按规则开局的普通对局
 *      （见 `qa/duel-undo-check.mjs` ①②③ 与它的 ⑥）。
 *  D **不给棋魂、不计战绩**：认输终局之后，账本余额与战绩条数都不许动
 *    （`shouldRecordDuel` 一并跳过棋魂、成就与账本，理由见那个函数注释）。
 *  E **排版**：对弈界面仍然只有一个棋盘、没有打谱那套控件、整页不产生滚动；
 *    自定义局也不许出现道具栏（道具卡只留给 VCF 挑战）。
 *  F **刷新不丢**：退出→回来走「回到上次对局」，仍然是自定义开局、仍然不计棋魂
 *    （新字段必须过 `duel-session.ts` 的白名单重建，否则恢复出来就丢了）。
 */
import { chromium } from "playwright";

const url = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:4173/";
const base = url.includes("?") ? url : `${url}?qa=1`;
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const browser = await chromium.launch({ headless: true });

const STATE = () => {
  const ledger = (() => { try { return JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"); } catch { return []; } })();
  const history = (() => { try { return JSON.parse(localStorage.getItem("banbu-duel-history-v1") || "[]"); } catch { return []; } })();
  const undo = document.querySelector("[data-duel-undo]");
  const title = (document.querySelector("[data-duel-screen]")?.innerText || "").match(/第 (\d+) 手/);
  return {
    screen: !!document.querySelector("[data-duel-screen]"),
    setupBar: !!document.querySelector("[data-duel-setup-bar]"),
    setupText: (document.querySelector("[data-duel-setup-bar]")?.textContent || "").replace(/\s+/g, " "),
    title: (document.querySelector("[data-duel-title]")?.textContent || "").replace(/\s+/g, " ").trim(),
    stones: [...document.querySelectorAll(".board-hit")].filter((h) => (h.getAttribute("aria-label") || "").includes("已有棋子")).length,
    playable: [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true").length,
    thinking: !!document.querySelector(".board-thinking-indicator"),
    undoDisabled: undo ? undo.disabled : null,
    undoTitle: undo ? undo.getAttribute("aria-label") || "" : "",
    setupUndoDisabled: document.querySelector("[data-duel-setup-undo]")?.disabled ?? null,
    setupCursor: (document.querySelector("[data-duel-setup-cursor]")?.textContent || "").replace(/\s+/g, " ").trim(),
    variationPoints: document.querySelectorAll('[aria-label^="切换到变化"]').length,
    /** 摆子那三颗在**底部槽位**（用户 2026-10-14：按钮要放棋盘下面），所以这里单独认一个容器。 */
    setupActions: !!document.querySelector("[data-duel-setup-dock]"),
    playActionButtons: document.querySelectorAll("[data-duel-undo],[data-duel-resign],[data-duel-restart],[data-duel-prev]").length,
    balance: ledger.reduce((s, e) => s + (e.amount || 0), 0),
    duelRows: ledger.filter((e) => e.reason === "duel-win").length,
    history: history.length,
    itemBars: document.querySelectorAll("[data-vcf-items]").length,
    boards: document.querySelectorAll(".renju-board").length,
    workspace: document.querySelectorAll(".action-layout-workspace, .board-move-rail, .topbar-mode-toggle, .record-tree-panel").length,
    overflow: document.documentElement.scrollHeight - innerHeight,
    toast: (document.querySelector(".toast")?.textContent || "").trim(),
  };
};

/** `viewport` 只有 H 段会传：三档手机都要真的换掉尺寸，否则"排版过了"只证明了一档。 */
async function open(viewport = { width: 392, height: 852 }) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  /** 导航默认 30 秒——这台机器上另一条会话在跑构建时 CPU 会顶到 99%，一次 `goto` 就能超
   *  （实测 20 条之后整条门禁 TimeoutError 中断，不是被测代码的问题）。放到 90 秒。 */
  ctx.setDefaultNavigationTimeout(90000);
  await ctx.addInitScript(() => {
    localStorage.setItem("banbu-first-run-welcome-v1", "9.9.9");
    // 余额给够：这一组要验的是"自定义局**不扣不发**"，不能是"因为没钱所以没动"。
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "gate-custom", at: Date.now(), amount: 500, reason: "manual", detail: "门禁灌余额" }]));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  page.on("console", (m) => { if (m.type() === "error" && !/engine-packs/.test(`${m.location()?.url || ""} ${m.text()}`)) errors.push(`console: ${m.text().slice(0, 140)}`); });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  return { ctx, page, errors };
}
const state = (page) => page.evaluate(STATE);
/** 点第 k 个空位（按棋盘顺序取，跨轮次稳定；不取正中以避开第 1 手天元那种规则约束）。 */
const tapEmpty = (page, k) => page.evaluate((i) => {
  const hits = [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true" && (h.getAttribute("aria-label") || "").includes("空位"));
  hits[Math.min(hits.length - 1, i * 11 + 3)]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}, k);
/** 按坐标点（aria-label 精确等于「H8空位」这种）；点不到就返回 false，让断言 loudly 失败。 */
const tapCoord = (page, coord) => page.evaluate((c) => {
  const hit = [...document.querySelectorAll(".board-hit")].find((h) => (h.getAttribute("aria-label") || "") === `${c}空位`);
  if (!hit) return false;
  hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
}, coord);
const waitMyTurn = (page, ms = 60000) => page.waitForFunction(() => !document.querySelector(".board-thinking-indicator")
  && [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true").length > 200, null, { timeout: ms }).then(() => true).catch(() => false);

/** 进设置浮层 → 选「自定义开局」（可带禁手）→ 开局。 */
async function startCustom(page, forbidden) {
  await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
  await page.waitForTimeout(900);
  await page.locator("button", { hasText: "开始对局" }).first().click();
  await page.waitForTimeout(900);
  const picked = await page.evaluate(([on, forb]) => {
    const tile = [...document.querySelectorAll("[data-ai-custom-opening]")].find((e) => e.getAttribute("data-ai-custom-opening") === on);
    if (!tile) return "找不到「开局方式」那一格";
    tile.click();
    if (!forb) return true;
    const cells = [...document.querySelectorAll(".ai-setup-cells.two > button")];
    const f = cells.find((b) => (b.querySelector("span")?.textContent || "").trim() === "有禁手");
    if (!f) return "找不到「有禁手」那一格";
    f.dataset.gateOpenForbidden = "1";
    return true;
  }, ["on", forbidden]);
  if (picked !== true) throw new Error(`入口异常：${picked}`);
  /**
   * 选"有禁手"要**两步**（与真实用户一样）：那格点开的是有禁规则浮层，必须再从列表里挑一项。
   * ⚠ 不能只点那格就走 —— 浮层不关，`.ai-float-backdrop` 会把「开始人机对战」挡住，
   *    下一次 `locator.click()` 直接 30 秒超时（踩过）。挑完列表项，`applyAiRuleChoice`
   *    自己会 `setAiFloatPanel(null)` 关掉。
   */
  if (forbidden) {
    await page.locator("[data-gate-open-forbidden='1']").click();
    await page.waitForTimeout(500);
    await page.locator(".ai-float-list button").first().click();
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(500);
  }
  await page.locator('[role="dialog"] button', { hasText: /开始人机对战/ }).first().click();
  await page.waitForTimeout(2000);
}

/* ── A/B/C/E 主流程 ─────────────────────────────────────────── */
{
  const { ctx, page, errors } = await open();
  await startCustom(page, false);
  const a = await state(page);
  check("A 选完就是摆子阶段：横幅在、棋盘可点、还没有子", a.screen && a.setupBar && a.stones === 0 && a.playable > 200, JSON.stringify({ screen: a.screen, setupBar: a.setupBar, stones: a.stones, playable: a.playable }));
  check("A 标题写明「自定义开局 · 无禁手 · 摆子中」", /自定义开局/.test(a.title) && /无禁手/.test(a.title) && /摆子中/.test(a.title), a.title);
  check("E 排版：一个棋盘、无打谱控件、整页不滚、也没有道具栏", a.boards === 1 && a.workspace === 0 && a.overflow <= 0 && a.itemBars === 0, JSON.stringify({ boards: a.boards, workspace: a.workspace, overflow: a.overflow, itemBars: a.itemBars }));
  // 摆子阶段**整条操作条都不渲染**（悔棋/认输/重开/回看这时都没有意义，留着还会把棋盘挤小）；
  // 「悔棋按钮禁用」这条因此改成「按钮不存在」。C 段会验它在「开始对局」之后回来。
  // 摆子阶段的底部槽位换成**摆子那三颗**（撤销摆子 / 清空 / 开始对局），整局的回看·悔棋·认输·重开全不在。
  check("B 摆子阶段底部只有摆子按钮（悔棋/认输/重开/回看这时都没意义）", await page.evaluate(() => {
    const slot = document.querySelector("[data-duel-setup-dock]");
    return Boolean(slot)
      && slot.querySelectorAll("[data-duel-setup-undo]").length === 1 && slot.querySelectorAll("[data-duel-setup-start]").length === 1
      && !document.querySelector("[data-duel-undo]") && !document.querySelector("[data-duel-resign]")
      && !document.querySelector("[data-duel-restart]") && !document.querySelector("[data-duel-prev]");
  }), `摆子按钮行=${a.setupBar ? "在" : "无"}`);
  check("B 摆子阶段「撤销摆子 / 清空」在空盘上禁用", a.setupUndoDisabled === true, `撤销 disabled=${a.setupUndoDisabled}`);

  await tapEmpty(page, 0); await page.waitForTimeout(600);
  await tapEmpty(page, 1); await page.waitForTimeout(600);
  await tapEmpty(page, 2); await page.waitForTimeout(600);
  const b3 = await state(page);
  check("B 摆子按黑白轮流（3 子 = 黑 2 白 1，进度行写明下一手白）", b3.stones === 3 && /已摆 3 子（黑 2 · 白 1）/.test(b3.setupText) && /下一手 白/.test(b3.setupText), b3.setupText.slice(0, 70));
  // 用户 2026-10-14：「每摆一颗子，都会弹出一个提示然后在棋盘上面浮现，遮挡棋盘」→ 落子不再弹层，
  // 进度由棋盘上面那一行报（带 aria-live）。这条守住"别又把它加回成每子一弹"。
  check("B 落子不弹提示层（进度行报数，不盖棋盘）", b3.toast === "", `toast=「${b3.toast.slice(0, 40)}」`);
  // ★ 最容易做漏的一条：此时按颜色"轮到白方"，而白方是 AI —— AI 一步都不许动。
  await page.waitForTimeout(4000);
  const bWait = await state(page);
  check("B 摆到「轮到 AI 的颜色」再等 4 秒：AI 一步都不许动", bWait.stones === 3 && !bWait.thinking && bWait.setupBar, `子数 ${bWait.stones}，思考中=${bWait.thinking}，横幅在=${bWait.setupBar}`);

  await page.evaluate(() => document.querySelector("[data-duel-setup-undo]")?.click());
  await page.waitForTimeout(700);
  check("B 撤销摆子当场少一子（不是「保存后生效」那种）", (await state(page)).stones === 2, `子数 ${(await state(page)).stones}`);
  await page.evaluate(() => document.querySelector("[data-duel-setup-clear]")?.click());
  await page.waitForTimeout(700);
  check("B 清空回到空盘", (await state(page)).stones === 0, `子数 ${(await state(page)).stones}`);

  /**
   * ★ 摆不出「已经分出胜负」的局面。胜负只在**落子那一刻**判（`winnerAt(nextBoard, …)`），
   *   摆下去的子不过那一刻 ⇒ 连五若留在盘上，开始之后谁也不会判它结束，AI 会照常在一个
   *   早就结束的局面上下下去。黑四连 H8-I8-J8-K8，补 L8 那一下必须被当场拒。
   *   白子拿去 A1–A4 当垫（四连不构成五，不会自己触发守卫）。
   */
  for (const c of ["H8", "A1", "I8", "A2", "J8", "A3", "K8", "A4"]) {
    if (!await tapCoord(page, c)) throw new Error(`点不到「${c} 空位」，这条测不了`);
    await page.waitForTimeout(420);
  }
  const four = await state(page);
  check("B 垫到黑四连（H8-I8-J8-K8）时盘上是 8 子", four.stones === 8, `子数 ${four.stones}｜${four.setupText.slice(0, 46)}`);
  const reached = await tapCoord(page, "L8");
  await page.waitForTimeout(800);
  const five = await state(page);
  check("B 摆不出连五：黑补 L8 被当场拒（不新增节点、如实说明）", reached && five.stones === 8 && /连成五子/.test(five.toast), `子数 ${five.stones}｜toast「${five.toast.slice(0, 44)}」`);
  const afterRefuse = await tapCoord(page, "E4");
  await page.waitForTimeout(700);
  check("B 拒过之后换一个点照样能摆（守卫没把落子整条堵死）", afterRefuse && (await state(page)).stones === 9, `子数 ${(await state(page)).stones}`);
  await page.evaluate(() => document.querySelector("[data-duel-setup-clear]")?.click());
  await page.waitForTimeout(700);

  for (const k of [0, 1, 2, 3]) { await tapEmpty(page, k); await page.waitForTimeout(600); }
  const before = await state(page);
  check("C 摆四子后「开始对局」可点", before.stones === 4 && before.setupBar && before.playable > 200, JSON.stringify({ stones: before.stones, setupBar: before.setupBar }));
  await page.evaluate(() => document.querySelector("[data-duel-setup-start]")?.click());
  await page.waitForTimeout(1200);
  const after = await state(page);
  check("C 开始之后横幅消失、标题改成「第 4 手」", !after.setupBar && /第 4 手/.test(after.title), after.title);
  check("C 开始之后摆的那 4 子不能靠悔棋退掉（没有可悔的落子，文案指向「撤销摆子」）",
    after.undoDisabled === true && /撤销摆子/.test(after.undoTitle), after.undoTitle);
  check("C 开始之后摆好的子不能再撤（横幅与它的撤销/清空都不在了）", await page.evaluate(() => !document.querySelector("[data-duel-setup-undo]") && !document.querySelector("[data-duel-setup-clear]")), "");

  /* D：认输终局 → 棋魂与战绩都不许动 */
  await page.locator("[data-duel-resign]").click();
  await page.waitForTimeout(500);
  await page.locator("[data-duel-confirm-ok]").click();
  await page.waitForTimeout(1600);
  const ended = await state(page);
  check("D 终局后余额一分没变（这一局不发棋魂）", ended.balance === before.balance && ended.duelRows === 0, `余额 ${before.balance} → ${ended.balance}，duel-win 流水 ${ended.duelRows} 条`);
  check("D 终局后战绩账本没有新增（自定义局不记账，等级分不被灌水）", ended.history === before.history && ended.history === 0, `战绩 ${before.history} → ${ended.history} 条`);
  check("A~D 全程无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── F：退出再回来（会话存档）── 新字段必须过白名单重建 ─────── */
{
  const { ctx, page, errors } = await open();
  await startCustom(page, true);
  for (const k of [0, 1]) { await tapEmpty(page, k); await page.waitForTimeout(600); }
  await page.evaluate(() => document.querySelector("[data-duel-setup-start]")?.click());
  await page.waitForTimeout(1000);
  await page.locator("[data-duel-close]").click();
  await page.waitForTimeout(900);
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(900);
  const asked = await page.locator("[data-duel-resume-yes]").count();
  await page.locator("[data-duel-resume-yes]").click();
  await page.locator("[data-duel-screen]").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const back = await state(page);
  // 恢复后仍要认得这是自定义开局：悔棋文案必须是**这一局那两套**（没有可悔的落子 → 指向「撤销摆子」；
  // 有得悔 → 「不花棋魂」），关键是**不许**再出现普通对局的「10 棋魂」文案（R214）。
  check("F 回来仍然是自定义开局（标题认得、悔棋文案还是这一局那一套，不是「10 棋魂」）",
    /自定义开局/.test(back.title) && /不花棋魂|撤销摆子/.test(back.undoTitle) && !/10 棋魂/.test(back.undoTitle),
    `${back.title}｜${back.undoTitle}`);
  check("F 有禁手的选择也跟着这一局回来", /有禁手/.test(back.title), back.title);
  check("F 恢复后没有把摆的子当成可悔（横幅不再出现）", !back.setupBar && back.stones >= 2, `横幅=${back.setupBar} 子数=${back.stones}`);
  check("F 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── G：有禁手下摆黑棋禁手点要被拒绝（"先选有禁无禁"的那个"禁"要真生效）── */
{
  const { ctx, page, errors } = await open();
  await startCustom(page, true);
  // 连摆成"黑下在 44 点"：黑 B4 D4 C4 …——用固定序号点，保证可复现。
  const seq = [0, 1, 2, 3, 4, 5, 6];
  for (const k of seq) { await tapEmpty(page, k); await page.waitForTimeout(500); }
  const g = await state(page);
  check("G 有禁手的自定义局能正常连摆（每一步都收下）", g.stones === seq.length && g.setupBar, `子数 ${g.stones}（期望 ${seq.length}）`);
  check("G 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── I：局面库（保存 → 清空 → 载入 → 改名 → 删除）────────────────────────
   用户 2026-10-14：「很多时候会专门挑战一些固定开局，保存下来下次直接拿来用」。
   存的是**当前这一条路线**，所以清空之后还能原样载入回来。 */
{
  const { ctx, page, errors } = await open();
  const stored = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("banbu-duel-setups-v1") || "[]"); } catch { return []; } });
  await startCustom(page, false);
  for (const k of [0, 1, 2, 3]) { await tapEmpty(page, k); await page.waitForTimeout(500); }
  await page.locator("[data-duel-setup-save]").click();
  await page.waitForTimeout(800);
  let list = await stored();
  check("I 保存局面写进本机库（4 子、默认名带手数）", list.length === 1 && list[0].stones === 4 && /4 手/.test(list[0].name), JSON.stringify(list.map((e) => ({ name: e.name, stones: e.stones }))));
  check("I 保存不弹层盖棋盘（只报一句 toast 就收）", (await state(page)).setupBar, "还在摆子阶段");
  await page.locator("[data-duel-setup-clear]").click();
  await page.waitForTimeout(800);
  const cleared = await state(page);
  check("I 清空把盘面归零，库那条不受影响", cleared.stones === 0 && (await stored()).length === 1, `子数 ${cleared.stones}`);
  await page.locator("[data-duel-setup-library]").click();
  await page.waitForTimeout(700);
  check("I 「局面」浮层列出那一条并带载入按钮", await page.locator("[data-duel-setup-row]").count() === 1 && await page.locator("[data-duel-setup-load]").count() === 1, `行数 ${await page.locator("[data-duel-setup-row]").count()}`);
  await page.locator("[data-duel-setup-load]").first().click();
  await page.waitForTimeout(1000);
  const back = await state(page);
  check("I 载入把 4 子原样铺回棋盘并关掉浮层", back.stones === 4 && back.setupBar && await page.locator("[data-duel-setup-row]").count() === 0, `子数 ${back.stones}｜游标「${back.setupCursor}」`);
  await page.locator("[data-duel-setup-library]").click();
  await page.waitForTimeout(600);
  await page.locator(".duel-setups-actions button", { hasText: "改名" }).first().click();
  await page.waitForTimeout(400);
  await page.locator(".duel-setup-name-input").first().fill("塔拉山口黑5");
  await page.locator(".duel-setups-actions button", { hasText: "存名" }).first().click();
  await page.waitForTimeout(700);
  check("I 改名就地生效并落盘（不弹第二层浮层）", /塔拉山口黑5/.test(JSON.stringify(await stored())), JSON.stringify((await stored()).map((e) => e.name)));
  await page.locator("[data-duel-setup-remove]").first().click();
  await page.waitForTimeout(700);
  check("I 删除后库空、列表回到空态说明", (await stored()).length === 0 && await page.locator(".duel-setups-list").count() === 0, `库里 ${(await stored()).length} 条`);
  check("I 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── J：从棋谱库「载入」→ 分支可看可走 → 开始对战只留当前路线 ─────────────
   用户 2026-10-14：「导入的按钮改为『载入』，不是打开文件管理器去找棋谱，而是打开自己的
   棋谱库，在这些文件夹里面找棋谱、习题什么的」。所以这条测的是**库内浏览**那条路：
   先往 `renju-note-library-v1` 塞一份带两条分支的谱 + 一份 `partial` 的残缺谱，
   重开页面让 App 读到，再走「载入 → 棋谱库 → 点那份谱」。
   那棵树：根先分叉（m1 与 alt1），主线 4 手后白第 4 手再分两条各 2 手。 */
const branchedRecord = () => {
  const node = (id, parentId, children, move) => ({ id, parentId, children, move, comment: "", marks: [] });
  const mv = (row, col, player) => ({ row, col, player });
  const nodes = {
    r: node("r", null, ["m1", "alt1"], null),
    m1: node("m1", "r", ["m2"], mv(7, 7, "black")),
    m2: node("m2", "m1", ["m3"], mv(7, 8, "white")),
    m3: node("m3", "m2", ["m4"], mv(8, 7, "black")),
    m4: node("m4", "m3", ["b1a", "b2a"], mv(8, 8, "white")),
    b1a: node("b1a", "m4", ["b1b"], mv(9, 8, "black")),
    b1b: node("b1b", "b1a", [], mv(10, 8, "white")),
    b2a: node("b2a", "m4", ["b2b"], mv(8, 9, "black")),
    b2b: node("b2b", "b2a", [], mv(9, 9, "white")),
    alt1: node("alt1", "r", [], mv(2, 2, "black")),
  };
  const meta = (title) => ({ title, black: "我", white: "AI", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] });
  const now = new Date().toISOString();
  const good = { id: "gate-branch-doc", version: 1, rootId: "r", nodes, metadata: meta("门禁分支谱"), createdAt: now, updatedAt: now };
  const broken = { ...good, id: "gate-partial-doc", metadata: meta("门禁残缺谱"), partial: true };
  return [good, broken];
};
{
  const { ctx, page, errors } = await open();
  await page.evaluate((records) => {
    const lib = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
    localStorage.setItem("renju-note-library-v1", JSON.stringify([...records, ...lib]));
  }, branchedRecord());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await startCustom(page, false);
  await page.locator("[data-duel-setup-load-file]").click();
  await page.waitForTimeout(700);
  check("J 「载入」开的是**一个弹窗**：顶上两栏（棋谱库 / 题库），不是文件管理器", await page.locator(".duel-load-tabs button").count() === 2 && await page.locator("[data-duel-setup-file]").count() === 0, `栏 ${await page.locator(".duel-load-tabs button").count()} 个`);
  check("J 弹窗一开就直接落在棋谱库那栏（不再先选来源、不往下钻一层）", await page.locator(".record-selector-sheet").count() === 1 && await page.locator('[data-duel-load-records][aria-selected="true"]').count() === 1, `棋谱面板 ${await page.locator(".record-selector-sheet").count()}`);
  await page.locator("[data-duel-load-puzzles]").click();
  await page.waitForTimeout(800);
  check("J 切到题库栏：同一个弹窗里换成题目选择器（棋谱栏收掉）", await page.locator(".puzzle-selector-sheet").count() === 1 && await page.locator(".record-selector-sheet").count() === 0, `题库面板 ${await page.locator(".puzzle-selector-sheet").count()}`);
  /** 两栏必须**不用滚动就在眼前**：内嵌时藏掉「定位到当前棋谱 / 做题进度」那两行（合计 ~100px），
   *  否则弹窗 696px 高会把栏推出可视区（截图实测过），切栏就得先滚一下——那又变成往下钻。 */
  const tabVisible = await page.evaluate(() => {
    const t = document.querySelector(".duel-load-tabs")?.getBoundingClientRect();
    const list = document.querySelector(".puzzle-selector-list")?.getBoundingClientRect();
    return { tabsIn: Boolean(t) && t.top >= 0 && t.bottom <= innerHeight, listBelowTabs: Boolean(t && list) && list.top >= t.bottom - 1 };
  });
  check("J 两栏不用滚动就看得见（内嵌时藏掉定位行与做题进度）", tabVisible.tabsIn && tabVisible.listBelowTabs, JSON.stringify(tabVisible));
  await page.locator("[data-duel-load-records]").click();
  await page.waitForTimeout(800);
  check("J 切回棋谱库栏还能按文件夹找", await page.locator(".record-selector-sheet").count() === 1 && await page.locator(".record-selector-folder").count() >= 1, `文件夹 ${await page.locator(".record-selector-folder").count()} 个`);
  await page.locator(".record-selector-list button", { hasText: "门禁分支谱" }).first().click();
  await page.waitForTimeout(1600);
  const loaded = await state(page);
  check("J 从库里载入：首选那条线铺到盘上（6 子）并关掉浮层", loaded.stones === 6 && loaded.setupBar && await page.locator(".record-selector-sheet").count() === 0, `子数 ${loaded.stones}｜${loaded.setupText.slice(0, 44)}`);
  check("J 载入的是**副本**（换 id，不许覆盖库里那份）", await page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
    const doc = JSON.parse(localStorage.getItem("banbu-duel-session-v1") || "{}").document;
    return Boolean(doc) && doc.id !== "gate-branch-doc" && lib.some((item) => item.id === "gate-branch-doc");
  }), "对弈文档 id 与库里那份不同、库里那份还在");
  // 再开一次弹窗，点那份 `partial: true` 的残缺谱：必须被拒、盘上一点不变。
  await page.locator("[data-duel-setup-load-file]").click();
  await page.waitForTimeout(800);
  await page.locator(".record-selector-list button", { hasText: "门禁残缺谱" }).first().click();
  await page.waitForTimeout(1000);
  const refused = await state(page);
  check("J 按需读取的残缺谱（partial）拒绝载入并说清原因", /只能读回一部分|按需读取/.test(refused.toast), `toast「${refused.toast.slice(0, 46)}」`);
  /**
   * 被拒时**浮层要留着**：这份选择器只在"成功载入"时才关（`duelSetupFromDocument` 里那句
   * `setDuelLoad("off")`），拒绝走的是早退。所以用户点错一份大型谱之后，可以直接在同一
   * 个浮层里换一份，不用重开、不用重新找文件夹。
   */
  check("J 被拒后弹窗还开着、还在棋谱库这一栏（换一个不用重开）", refused.stones === 6 && await page.locator(".record-selector-sheet").count() === 1, `子数 ${refused.stones}｜面板 ${await page.locator(".record-selector-sheet").count()}`);
  await page.locator(".record-selector-list button", { hasText: "门禁分支谱" }).first().click();
  await page.waitForTimeout(1400);
  check("J 同一个浮层里再点一份照样载入（拒绝不是一次性的）", (await state(page)).stones === 6 && await page.locator(".record-selector-sheet").count() === 0, `子数 ${(await state(page)).stones}`);
  for (let i = 0; i < 2; i += 1) { await page.locator("[data-duel-setup-prev]").click(); await page.waitForTimeout(600); }
  const fork = await state(page);
  check("J 回看到分叉点（第 4 手、盘上 4 子）", fork.stones === 4 && /第 4 手/.test(fork.setupCursor), `子数 ${fork.stones}｜游标「${fork.setupCursor}」`);
  check("J 分叉点上另一条分支正常显示（棋盘标出可切换的变化点）", fork.variationPoints >= 1, `变化点 ${fork.variationPoints} 个`);
  const jumped = await page.evaluate(() => {
    const hit = document.querySelector('[aria-label^="切换到变化"]');
    if (!hit) return false;
    hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(900);
  const other = await state(page);
  check("J 点变化点走到另一条分支（子数与游标跟着换）", jumped && other.stones === 5 && /第 5 手/.test(other.setupCursor), `跳到 ${jumped}｜子数 ${other.stones}｜游标「${other.setupCursor}」`);
  await page.locator("[data-duel-setup-prev]").click();
  await page.waitForTimeout(700);
  const stonesNow = (await state(page)).stones;
  await page.locator("[data-duel-setup-start]").click();
  await page.waitForTimeout(1600);
  const snap = await page.evaluate(() => {
    try {
      const s = JSON.parse(localStorage.getItem("banbu-duel-session-v1") || "{}");
      const nodes = (s.document && s.document.nodes) || {};
      const ids = Object.keys(nodes);
      return { count: ids.length, maxChildren: Math.max(0, ...ids.map((id) => (nodes[id].children || []).length)), custom: Boolean(s.game && s.game.customOpening), started: Boolean(s.game && s.game.customStarted), setupCount: s.game && s.game.customSetupCount };
    } catch { return { count: -1, maxChildren: -1 }; }
  });
  check("J 开始对战只留当前路线（两条分支都被剪掉：5 节点、每节点最多 1 个孩子）", stonesNow === 4 && snap.count === 5 && snap.maxChildren === 1, `开局前 ${stonesNow} 子｜快照 ${JSON.stringify(snap)}`);
  check("J 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── H：排版（用户点名「排版好一点」，2026-10-14 又给了明确版式：棋盘居中、进度在上面、按钮在下面）──
   三档手机视口下：① 整页不滚；② 进度行在棋盘**上面**；③ 三颗按钮在棋盘**下面**、贴住底栏上方，
   ④ 按钮与底栏之间不留一大坨空白（下面那堆空白就是这轮被投诉的点）。 */
for (const [w, h] of [[360, 640], [392, 852], [412, 732], [320, 568]]) {
  const { ctx, page, errors } = await open({ width: w, height: h });
  await startCustom(page, false);
  for (const k of [0, 1, 2]) { await tapEmpty(page, k); await page.waitForTimeout(500); }
  const m = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() || null;
    const bar = box("[data-duel-setup-bar]"), actions = box("[data-duel-setup-dock]"), nav = box(".bottom-nav");
    const board = box("[data-duel-board] .renju-board");
    const round = (r) => (r ? { t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null);
    const rb = round(board), ri = round(bar), ra = round(actions), rn = round(nav);
    return {
      overflow: document.documentElement.scrollHeight - innerHeight,
      bar: ri, actions: ra, board: rb, nav: rn,
      infoAboveBoard: !ri || !rb ? false : ri.b <= rb.t + 1,
      actionsBelowBoard: !ra || !rb ? false : ra.t >= rb.b - 1,
      actionsAboveNav: !ra || !rn ? false : ra.b <= rn.t + 1,
      bottomGap: ra && rn ? rn.t - ra.b : 9999,
      boardCentered: !rb ? false : Math.abs((rb.t - (ri ? ri.b : 0)) - ((ra ? ra.t : innerHeight) - rb.b)) <= 60,
    };
  });
  check(`H ${w}×${h}：摆子界面仍是一屏（棋盘 ${m.board?.w}px、进度行 h=${m.bar?.h}、按钮行 h=${m.actions?.h}）`, m.overflow <= 0, `溢出 ${m.overflow}px`);
  check(`H ${w}×${h}：进度行在棋盘上面、三颗按钮在棋盘下面`, m.infoAboveBoard && m.actionsBelowBoard, JSON.stringify({ 进度行: m.bar, 棋盘: m.board, 按钮行: m.actions }));
  check(`H ${w}×${h}：按钮贴住底栏上方（间隙 ${m.bottomGap}px ≤ 40）且不被压住`, m.actionsAboveNav && m.bottomGap <= 40, `按钮底 ${m.actions?.b} vs 底栏顶 ${m.nav?.t}`);
  check(`H ${w}×${h}：无未捕获异常`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/** 收尾：`browser.close()` 偶发挂住（Chromium 与 dev server 的长连接），不能让它把整条门禁拖死。 */
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]);
console.log(failed ? `\n❌ ${failed} 条失败` : "\n✅ 全部通过");
process.exit(failed ? 1 : 0);
