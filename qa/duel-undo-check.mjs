/**
 * 常驻门禁：人机对弈的「悔棋」= **10 棋魂一次 + 开局前 10 手不给悔**。
 * 用法：QA_BASE_URL=http://127.0.0.1:5199/ node qa/duel-undo-check.mjs
 *
 * ## 为什么是这条规则（用户 2026-10-13 定案）
 *
 * 「人机对战用上道具卡这个事情，你撤掉吧，道具卡的介绍也重新恢复，然后人机里面的悔棋按钮
 *  可以保留，但是 **10 棋魂一次，直接用棋魂消耗使用**，同样也是 **10 手前不能用**」
 *
 *  ⇒ 对弈页**不再有道具栏**（三张卡回到只有 VCF 挑战用，`items.ts` 的说明与定价也退回
 *    VCF 口径：15 / 40 / 25）；操作条上那枚「悔棋」按钮改成直接扣账本（`spendAmount`，
 *    流水来源「对弈悔棋」），并且恢复前 10 手的锁。
 *
 * ## 这一组要钉住的四件事
 *
 *  ① **锁定期内不给悔，而且一个魂都不扣**（钱比功能更容易出事：拒绝却扣账就是白扣）。
 *  ② 满 10 手之后：扣的**正好是 10**、退的是「AI 的应手 + 你那手」（-2 子）、落回轮到自己。
 *  ③ **余额不足时不退子也不扣钱**（`spendSoul` 返回 insufficient 就必须原样退回）。
 *  ④ 终局后按钮禁用（`canUndo` 要求 `!aiGame.outcome`）。
 *  ⑤ 反向：对弈页**不许**再出现道具栏；而 VCF 页那三颗卡不许被这次撤退顺带删掉
 *    （量 46×52 + 三颗，与 `qa/vcf-items-check.mjs` 同一口径）。
 *  ⑥ **自定义开局例外**（用户 2026-10-15）：那一局悔棋**不扣棋魂**、**没有"前 10 手"锁**、
 *    **终局之后也还能悔**（退掉结果面板、回到可继续下的局面）；下限仍是摆子那道边界。
 *    ①–④ 全部只约束"按规则开局"的普通对局，一条都没放松。
 */
import { chromium } from "playwright";

const url = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:4173/";
const base = url.includes("?") ? url : `${url}?qa=1`;
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const browser = await chromium.launch({ headless: true });

/**
 * 把余额**调到指定值**。
 *
 * ⚠ 不能靠 `addInitScript` 直接写死：首次启动会白送一条成就「棋魂系统」+2026 魂
 *   （`soul-welcome-2026`，见 `SOUL_EARN_RULES` 与 `achievements.test.ts` 里那条"唯一白送"），
 *   写死 500 实测读到 2526。所以先让它启动完，读一次真实余额，再补一条反向的 `manual`
 *   流水把差额抹平 —— 这样门禁不依赖任何具体发放数额。
 */
async function setBalance(page, target) {
  const now = await page.evaluate(() => {
    try { const l = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"); return Array.isArray(l) ? l.reduce((s, e) => s + (e.amount || 0), 0) : 0; } catch { return 0; }
  });
  await page.evaluate(([from, to]) => {
    const l = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]");
    l.push({ id: `gate-set-${Date.now()}`, at: Date.now(), amount: to - from, reason: "manual", detail: "门禁调余额" });
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify(l));
  }, [now, target]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  await page.waitForTimeout(900);
}

/** 开一个页面、进对弈、开局（`balance` 给了就把棋魂余额调到这个数；`custom` 走自定义开局）。 */
async function openDuel({ width = 392, height = 852, balance = null, custom = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "9.9.9"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
  page.on("console", (m) => { if (m.type() === "error" && !/engine-packs/.test(`${m.location()?.url || ""} ${m.text()}`)
    /** onnxruntime 在本机 CPU 上会打一条 **warning**（`[W:onnxruntime … Unknown CPU vendor]`），
     *  Chrome 把它归到 console 的 error 类型里 —— 它不是页面报错，别算进"未捕获异常"。 */
    && !/\[W:onnxruntime/.test(m.text())) errors.push(`console: ${m.text().slice(0, 140)}`); });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bottom-nav button", { timeout: 180000 });
  if (balance !== null) await setBalance(page, balance);
  await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
  await page.waitForTimeout(900);
  await page.locator("button", { hasText: "开始对局" }).first().click();
  await page.waitForTimeout(900);
  if (custom) {
    // 自定义开局：设置浮层里「开局」那一行选「自定义开局」，进去先是**摆子阶段**
    await page.evaluate(() => document.querySelector('[data-ai-custom-opening="on"]')?.click());
    await page.waitForTimeout(600);
  }
  await page.locator('[role="dialog"] button', { hasText: /开始人机对战|开始对局/ }).first().click();
  /** 等**真的进了对弈界面**再返回。原来只睡 2.2 秒：那一次浮层没被点着（首屏偶发慢），
   *  后面就量到"没有悔棋按钮"（`disabled=null`）——① 因此偶发红（2026-10-15 实测）。 */
  await page.locator("[data-duel-screen]").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

const state = (page) => page.evaluate(() => {
  const ledger = (() => { try { return JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"); } catch { return []; } })();
  const undo = document.querySelector("[data-duel-undo]");
  const title = (document.querySelector("[data-duel-screen]")?.innerText || "").match(/第 (\d+) 手/);
  return {
    balance: Array.isArray(ledger) ? ledger.reduce((s, e) => s + (e.amount || 0), 0) : -1,
    /** 只看**对弈悔棋**这一种支出。门禁自己"调余额"写的也是负数流水（`manual`），
     *   按"任何负数"筛会把它自己算进去（实测两条断言因此假红）。 */
    undoRows: Array.isArray(ledger) ? ledger.filter((e) => e.reason === "duel-undo").map((e) => e.amount).join(",") : "",
    stones: [...document.querySelectorAll(".board-hit")].filter((h) => (h.getAttribute("aria-label") || "").includes("已有棋子")).length,
    hands: title ? Number(title[1]) : -1,
    undoDisabled: undo ? undo.disabled : null,
    undoTitle: undo?.getAttribute("aria-label") || "",
    itemsBar: document.querySelectorAll("[data-vcf-items]").length,
    itemCards: document.querySelectorAll("[data-vcf-item]").length,
    thinking: !!document.querySelector(".board-thinking-indicator"),
    result: !!document.querySelector("[data-duel-result]"),
    playable: [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true").length,
    toast: (document.querySelector(".toast")?.textContent || "").trim(),
  };
});
const waitMyTurn = (page, ms = 60000) => page.waitForFunction(() => !document.querySelector(".board-thinking-indicator")
  && [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true").length > 200, null, { timeout: ms }).then(() => true).catch(() => false);
/** 随机点一个空位 —— **挑离已有子最远的那几个**（原来纯随机，往中间堆几手就连五，
 *  一局被"下完"之后 ③ 的余额会被这局的结算顶高（实测 6 → 36），②也会因终局而假红。 */
const playRandom = (page) => page.evaluate(() => {
  const hits = [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true" && (h.getAttribute("aria-label") || "").includes("空位"));
  if (!hits.length) return false;
  const taken = [...document.querySelectorAll(".board-hit")]
    .filter((h) => (h.getAttribute("aria-label") || "").includes("已有棋子"))
    .map((h) => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const score = (el) => {
    const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!taken.length) return Math.hypot(x - 640, y - 400);   // 空盘时先落在中间附近
    return Math.min(...taken.map((t) => Math.hypot(x - t.x, y - t.y)));
  };
  const best = hits.reduce((m, el) => Math.max(m, score(el)), 0);
  const far = hits.filter((el) => score(el) >= best - 1);
  far[Math.floor(Math.random() * far.length)].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
});
/** 下满 `target` 手（每手之后等 AI 应完；轮不到自己就等，等到了再点）。
 *  ⚠ 随机落子有概率**把这一局直接下完**（连五/禁手），那时终局态下按钮按规则禁用，
 *    ② 就会偶发红（2026-10-15 实测到一次）。所以一旦发现已终局，点「重开」再来一局——
 *    别把环境噪声当产品坏了。 */
async function playTo(page, target) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (let i = 0; i < target * 4; i += 1) {
      const s = await state(page);
      if (s.stones >= target && !s.result) { await waitMyTurn(page); return await state(page); }
      if (s.result) break;
      if (s.thinking || s.playable <= 200) { await waitMyTurn(page); continue; }
      if (!(await playRandom(page))) { await page.waitForTimeout(800); continue; }
      await page.waitForTimeout(2400);
    }
    if ((await state(page)).result) {
      // 终局面板是模态的、盖住下面那条操作条 ⇒ 用面板里的「再来一局」重开
      await page.locator("[data-duel-newgame]").click();
      await page.waitForTimeout(2500);
      await waitMyTurn(page);
    }
  }
  await waitMyTurn(page);
  return state(page);
}

/* ── ① 锁定期：不给悔、不扣钱；而且对弈页不该再有道具栏 ───────────── */
{
  const { ctx, page, errors } = await openDuel({ balance: 500 });
  await waitMyTurn(page);
  await playRandom(page);
  await page.waitForTimeout(2400);
  await waitMyTurn(page);
  const s = await state(page);
  check("① 对弈页没有道具栏（道具卡只留给 VCF 挑战）", s.itemsBar === 0 && s.itemCards === 0, `栏 ${s.itemsBar} 个、卡 ${s.itemCards} 颗`);
  check("① 开局前 10 手：悔棋按钮是禁用的", s.undoDisabled === true, `disabled=${s.undoDisabled}`);
  check("① 禁用原因写进按钮文案（说清是「开局 10 手」而不是「没棋魂」）", /开局 10 手内不能悔棋/.test(s.undoTitle), s.undoTitle);
  check("① 锁定期没扣任何棋魂", s.balance === 500 && !s.undoRows, `余额 ${s.balance} 悔棋流水="${s.undoRows}"`);

  /* ── ② 满 10 手：扣正好 10、退一轮、回到自己回合 ── */
  const armed = await playTo(page, 10);
  check("② 已下满 10 手（锁定期过了）", armed.stones >= 10, `盘上 ${armed.stones} 颗`);
  check("② 满 10 手后悔棋按钮可用，文案写明 10 棋魂一次", armed.undoDisabled === false && /10 棋魂/.test(armed.undoTitle), armed.undoTitle);
  await page.locator("[data-duel-undo]").click();
  await page.waitForTimeout(1400);
  const undone = await state(page);
  check("② 退掉「AI 的应手 + 你那手」（-2 子）", undone.stones === armed.stones - 2, `${armed.stones} → ${undone.stones} 颗`);
  check("② 扣的正好是 10 棋魂", undone.balance === armed.balance - 10, `${armed.balance} → ${undone.balance}`);
  check("② 流水里有一条「对弈悔棋」−10", undone.undoRows === "-10", `悔棋流水="${undone.undoRows}"`);
  check("② 退完轮到自己（不僵在「轮到 AI 却没人动」）", !undone.thinking && undone.playable > 200, `思考中=${undone.thinking} 可落子=${undone.playable}`);
  check("② 反馈说清花了多少", /悔/.test(undone.toast) && /10/.test(undone.toast), `toast="${undone.toast}"`);

  /* ── ④ 终局后禁用 ── */
  await page.locator("[data-duel-resign]").click();
  await page.waitForTimeout(500);
  await page.locator("[data-duel-confirm-ok]").click();
  await page.waitForTimeout(1200);
  const ended = await state(page);
  check("④ 终局后悔棋按钮禁用（canUndo 要求 !outcome）", ended.undoDisabled === true, `disabled=${ended.undoDisabled}`);
  check("①②④ 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── ③ 余额不足：不退子也不扣钱 ───────────────────────────────── */
{
  const { ctx, page, errors } = await openDuel({ balance: 6 });      // 6 < 10，悔一次付不起
  await waitMyTurn(page);
  const armed = await playTo(page, 10);
  check("③ 锁定期已过但余额只有 6 魂", armed.stones >= 10 && armed.balance === 6, `盘上 ${armed.stones} 颗 · 余额 ${armed.balance}`);
  check("③ 按钮仍可用（钱够不够是点下去才知道的）", armed.undoDisabled === false, `disabled=${armed.undoDisabled}`);
  await page.locator("[data-duel-undo]").click();
  await page.waitForTimeout(1200);
  const refused = await state(page);
  check("③ 付不起就**不退子**", refused.stones === armed.stones, `${armed.stones} → ${refused.stones} 颗`);
  check("③ 付不起也**不扣钱**（不许出现负余额）", refused.balance === 6 && !refused.undoRows, `余额 ${refused.balance} 悔棋流水="${refused.undoRows}"`);
  check("③ 如实说清是棋魂不够", /棋魂|不够|需要/.test(refused.toast) && /没扣/.test(refused.toast), `toast="${refused.toast}"`);
  check("③ 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── ⑤ VCF 页那三颗卡不许被这次撤退顺带删掉 ─────────────────────── */
{
  const { ctx, page, errors } = await openDuel();
  await page.locator("[data-duel-close]").first().click();
  await page.waitForTimeout(1200);
  const opened = await page.evaluate(() => { const b = document.querySelector("[data-duel-vcf-start]"); if (!b) return false; b.click(); return true; });
  await page.waitForTimeout(3000);
  const vcf = await page.evaluate(() => {
    const item = document.querySelector("[data-vcf-item]"), bar = document.querySelector("[data-vcf-items]");
    if (!item || !bar) return null;
    const r = item.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), count: document.querySelectorAll("[data-vcf-item]").length, display: getComputedStyle(bar).display };
  });
  check("⑤ 进得去 VCF 挑战页", opened, `入口=${opened}`);
  check("⑤ VCF 页仍是三颗 46×52 的卡（撤退没撤过头）", !!vcf && vcf.count === 3 && vcf.w === 46 && vcf.h === 52 && vcf.display === "flex", JSON.stringify(vcf));
  check("⑤ 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ── ⑥ 自定义开局：悔棋能用、不扣棋魂、终局之后也还能悔（用户 2026-10-15）──
 * 「人机对战不是有一个自定义模式吗，那里的悔棋好像不能用，你优化一下，这个模式的悔棋可以用
 *  而且不消耗棋魂，并且即便是终局完成了，也还是可以悔棋」
 * 旧规则在这一局里等于"永远按不动"：那 10 手锁数的是**开始对局之后**的手，而用户自己摆的局面
 * 常常三五手就结束；扣 10 魂也没道理（这一局本来就不计战绩、不发棋魂）。 */
{
  const { ctx, page, errors } = await openDuel({ balance: 500, custom: true });
  const tap = (index) => page.evaluate((n) => {
    const hits = [...document.querySelectorAll(".board-hit")]
      .filter((h) => h.getAttribute("aria-disabled") !== "true" && !(h.getAttribute("aria-label") || "").includes("已有棋子"));
    hits[n]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, index);
  // 摆 4 子（黑白轮流）→ 点「开始对局」
  for (const i of [40, 120, 60, 140]) { await tap(i); await page.waitForTimeout(600); }
  await page.locator("[data-duel-setup-start]").click();
  await page.waitForTimeout(2000);
  const started = await state(page);
  check("⑥ 自定义开局：摆 4 子开始，落子前没有可悔的（下限是摆子那道边界）",
    started.stones === 4 && started.undoDisabled === true && /撤销摆子/.test(started.undoTitle),
    `子 ${started.stones}、disabled=${started.undoDisabled}、文案「${started.undoTitle.slice(0, 30)}」`);
  await waitMyTurn(page);
  await playRandom(page);
  // 自己那手落下后 AI 还在算（`canUndo` 含 `!aiThinking`），等回自己回合再读状态
  await page.waitForTimeout(2400);
  await waitMyTurn(page);
  const played = await state(page);
  check("⑥ 刚走一手就能悔（这一局没有「前 10 手」锁）", played.undoDisabled === false, `disabled=${played.undoDisabled}`);
  check("⑥ 按钮文案写明不花棋魂", /不花棋魂/.test(played.undoTitle), played.undoTitle.slice(0, 46));
  await page.locator("[data-duel-undo]").click();
  await page.waitForTimeout(1600);
  const undone = await state(page);
  check("⑥ 悔棋真的退了子", undone.stones < played.stones, `${played.stones} → ${undone.stones}`);
  check("⑥ 一分棋魂都不扣（余额不变、账本里没有「对弈悔棋」流水）",
    undone.balance === played.balance && undone.undoRows === "",
    `余额 ${played.balance}→${undone.balance}、悔棋流水「${undone.undoRows}」`);
  // 再走两手：退到"只剩摆的那几子"时按钮本来就该禁用（那是下限，不是 bug），
  // 终局那一段要有可悔的落子才测得动。
  await waitMyTurn(page);
  await playRandom(page);
  await page.waitForTimeout(2400);
  await waitMyTurn(page);
  // 终局之后仍然可以悔：认输判负 → 结果面板在 → 点面板里的「悔棋继续下」→ 结果清掉、还能继续落子
  await page.locator("[data-duel-resign]").click();
  await page.waitForTimeout(500);
  await page.locator(".duel-confirm-actions button.danger").click();
  await page.waitForTimeout(1400);
  const ended = await state(page);
  check("⑥ 终局（认输）后结果面板在，面板里的「悔棋继续下」可用",
    ended.result === true && ended.undoDisabled === false && await page.locator("[data-duel-undo-after-end]").count() === 1,
    `结果面板=${ended.result}、按钮=${await page.locator("[data-duel-undo-after-end]").count()} 颗、条上那颗 disabled=${ended.undoDisabled}`);
  await page.locator("[data-duel-undo-after-end]").click();
  await page.waitForTimeout(1600);
  const revived = await state(page);
  check("⑥ 终局后悔棋：结果面板消失、子退掉了", revived.result === false && revived.stones < ended.stones,
    `结果面板=${revived.result}、子 ${ended.stones} → ${revived.stones}`);
  check("⑥ 退完还能继续落子（回到可下的局面）", revived.playable > 200, `空位 ${revived.playable}`);
  check("⑥ 终局后悔棋同样不扣棋魂", revived.balance === ended.balance && revived.undoRows === "",
    `余额 ${ended.balance}→${revived.balance}、流水「${revived.undoRows}」`);
  check("⑥ 无未捕获异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n❌ ${failed} 条失败` : "\n✅ 全部通过");
process.exit(failed ? 1 : 0);
