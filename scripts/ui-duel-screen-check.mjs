import { chromium } from "playwright";

/**
 * 「专门的对弈界面」门禁（用户 09-28）。
 *
 * 三件事：
 *  A. **对局在自己的界面里**：开局后停在 `[data-duel-screen]`，不在打谱页；界面里
 *     **没有打谱 / 读谱 / 做题的那套东西**（功能区三行、手数滑轨、标注、棋谱树、做题入口）。
 *  B. 界面该有的都在：双方信息格（我方时间、对手思考状态）、开局决策条、操作条
 *     （悔棋 / 认输 / 重开，且**没有提和**）、最近几手、独立终局面板。
 *  B6/B7 **界面不许上下跳（用户 10-01：「那些状态会一直变，界面一会上蹿一会下跳的，晃眼睛」）**：
 *     AI 思考到应手全程采样棋盘几何，top / 高度必须一动不动；引擎过程读数必须待在
 *     meta 的「引擎」格里（单行、省略号截断），不再有一条"只在思考时存在、还会换行"的条。
 *     旧版病根：那条读数每 ~100ms 换文字、1 行↔2 行来回翻，而棋盘靠 margin-block:auto
 *     吃剩余空间 → 392×852 实测每翻一次整块棋盘平移 12px。
 *  C. **退出后能接着下（用户点名的风险）**：退出 → 再点「人机对战」→ 弹窗问是否回去 →
 *     回去之后，如果退出时正轮到 AI，AI **必须自己把这一手补上**（不是僵在棋盘上等人动）。
 *  D. 终局面板与「默认不自动入库」。
 *  E. 全程零 pageerror。
 *  F. **空间口径（用户 10-01：「棋盘似乎有点小了」，随后又拿桌面截图问「这是适配设计吗」）**：
 *     手机竖屏棋盘吃满可用宽度、操作条贴住底栏、对弈界面自己不产生滚动；
 *     平板竖/横屏棋盘分别 ≥700 / ≥520px
 *     （旧版 412×900 只有 380、820×1180 只有 454 且下面空 620px）。
 *
 * 为什么 C 要真跑一次引擎：AI 的应手不是由「轮到 AI 就下」的监视驱动的，而是人做完动作后
 * 顺手调度一次（`scheduleAiOpening`）。进程一退出那次调度就没了，恢复方必须自己补。
 * 这条断言是「恢复后不会僵死」的唯一证据，不能只测「界面回来了」。
 *
 * 用法：BANBU_URL=http://localhost:5321 node scripts/ui-duel-screen-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5321/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
page.setDefaultTimeout(20_000);
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const libraryTitlesRaw = () => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]")).map((item) => item?.metadata?.title || ""); } catch { return []; } });
const stones = () => page.evaluate(() => [...document.querySelectorAll(".board-hit")].map((hit) => hit.getAttribute("aria-label") || "").filter((label) => label.includes("已有棋子")).length);
const openSetup = async () => {
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(800);
  if (await page.locator("[data-duel-resume-new]").count()) {
    await page.locator("[data-duel-resume-new]").click();
    await page.waitForTimeout(700);
  }
  await page.locator(".ai-game-setup").waitFor({ timeout: 10_000 });
};
const startGame = async () => {
  if (await page.locator(".ai-float-backdrop").count()) {
    await page.locator(".ai-float-backdrop").first().click({ position: { x: 4, y: 4 }, force: true });
    await page.waitForTimeout(300);
  }
  await page.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
  await page.locator("[data-duel-screen]").waitFor({ timeout: 10_000 });
};

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* 无所谓 */ } });
  await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // ── A 开局后就在对弈界面，且界面里没有打谱件 ──────────────────────────────
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
  await page.waitForTimeout(600);
  await openSetup();
  await startGame();
  check("A1 开局后停在专门的对弈界面", await page.locator("[data-duel-screen]").count() === 1);
  const recordParts = await page.evaluate(() => ({
    workspace: document.querySelectorAll(".action-layout-workspace").length,
    rail: document.querySelectorAll(".board-move-rail").length,
    modeTabs: document.querySelectorAll(".topbar-mode-toggle").length,
    tree: document.querySelectorAll(".record-tree-panel").length,
    board: document.querySelectorAll(".renju-board").length,
  }));
  check("A2 对弈界面里没有打谱/读谱/做题那套（无功能区、无手数滑轨、无模式切换）",
    recordParts.workspace === 0 && recordParts.rail === 0 && recordParts.modeTabs === 0 && recordParts.tree === 0 && recordParts.board === 1,
    JSON.stringify(recordParts));

  // ── B 界面该有的都在 ─────────────────────────────────────────────────────
  const sides = await page.evaluate(() => ({
    me: document.querySelector("[data-duel-side='me']")?.innerText.replace(/\s+/g, " ").trim() || "",
    ai: document.querySelector("[data-duel-side='ai']")?.innerText.replace(/\s+/g, " ").trim() || "",
    myTime: document.querySelector("[data-duel-my-time]")?.textContent || "",
  }));
  check("B1 双方信息格：我方带时间、对手带难度", /我/.test(sides.me) && /用时|剩余/.test(sides.myTime) && /半步 AI/.test(sides.ai) && /初级|中级|高级|大师|自由/.test(sides.ai), JSON.stringify(sides));
  const actions = await page.evaluate(() => [...document.querySelectorAll(".duel-actions button")].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()));
  check("B2 操作条有悔棋/认输/重开，且没有提和", actions.some((t) => t.includes("悔棋")) && actions.some((t) => t.includes("认输")) && actions.some((t) => t.includes("重开")) && !actions.some((t) => t.includes("提和")), JSON.stringify(actions));
  check("B3 对局中不给「回看」按钮（‹ › 的语义是悔棋，只在终局后当回看用）",
    await page.locator("[data-duel-prev]").isDisabled() && await page.locator("[data-duel-next]").isDisabled());

  // 落一手：AI 要应手，且思考状态在对手那一格里
  await page.getByRole("gridcell", { name: /^H8空位/ }).click();
  // ── B6 思考期间棋盘**不许平移**（用户 2026-10-01：「那些状态会一直变，界面一会上蹿
  //    一会下跳的，晃眼睛」）。旧版病根：引擎过程读数是一条「只在思考时存在、文字还会
  //    在 1 行 ↔ 2 行之间翻」的条，而棋盘靠 margin-block:auto 吃剩余空间 —— 读数每
  //    ~100ms 改一次，每翻一次行整块棋盘就重定位一次（392×852 实测位移 12px）。
  //    现在读数并进 meta 的「引擎」格（固定高度 + 省略号），所以这里要求 top/height 全程不动。
  const boardTops = [];
  const boardHeights = [];
  const engineCellTexts = [];
  let sawThinking = false;
  for (let sample = 0; sample < 16; sample += 1) {
    const geo = await page.evaluate(() => {
      const r = document.querySelector("[data-duel-board]")?.getBoundingClientRect();
      return {
        top: r ? Math.round(r.top) : -1,
        height: r ? Math.round(r.height) : -1,
        engineCell: document.querySelector('[data-duel-meta-value="引擎"]')?.textContent || "",
        thinking: Boolean(document.querySelector("[data-duel-thinking]")),
      };
    });
    if (geo.top >= 0) { boardTops.push(geo.top); boardHeights.push(geo.height); engineCellTexts.push(geo.engineCell); if (geo.thinking) sawThinking = true; }
    await page.waitForTimeout(120);
  }
  const topSpread = boardTops.length ? Math.max(...boardTops) - Math.min(...boardTops) : -1;
  const heightSpread = boardHeights.length ? Math.max(...boardHeights) - Math.min(...boardHeights) : -1;
  check("B6 AI 思考到应手全程：棋盘位置与尺寸一动不动（旧版会平移 12px）",
    topSpread <= 1 && heightSpread <= 1 && boardTops.length >= 10,
    `采样 ${boardTops.length} 帧，top 变化 ${topSpread}px、高度变化 ${heightSpread}px`);
  await page.locator("[data-duel-thinking]").waitFor({ timeout: 5000 }).catch(() => {});
  const thinkingVisible = await page.locator("[data-duel-thinking]").count() === 1;
  await page.waitForFunction(() => [...document.querySelectorAll(".board-hit")].filter((h) => (h.getAttribute("aria-label") || "").includes("已有棋子")).length >= 2, null, { timeout: 40_000 });
  check("B4 AI 思考时对手那格显示「思考中」", sawThinking || thinkingVisible,
    `采样期间看到=${sawThinking}，等待后看到=${thinkingVisible}（初级档只思考 ~0.6s，等到这里常已结束）`);
  check("B5 我落一手后 AI 应手（棋盘 2 子）", await stones() === 2);
  // B7 引擎读数确实搬进了「引擎」那一格，并且那一格全程单行（长文本靠省略号截断）
  const engineCell = await page.evaluate(() => {
    const dd = document.querySelector('[data-duel-meta-value="引擎"]');
    const r = dd?.getBoundingClientRect();
    return {
      text: dd?.textContent || "",
      lines: r && dd ? Math.round(r.height / (parseFloat(getComputedStyle(dd).fontSize) * 1.2)) : 0,
      standaloneStrip: Boolean(document.querySelector(".duel-engine")),
    };
  });
  const sawReading = engineCellTexts.some((text) => text.includes("层"));
  // 那一格任何时刻都不许空着（刚点上思考、层数还没出来时要退回写引擎名，
  // 空格子看起来像引擎掉了）。
  const neverEmpty = engineCellTexts.length > 0 && engineCellTexts.every((text) => text.trim().length > 0);
  check("B7 引擎读数并进「引擎」格（思考时看得到层数/节点），该格不撑高、也不空档",
    sawReading && neverEmpty && engineCell.lines <= 1 && !engineCell.standaloneStrip,
    `采样到过读数=${sawReading}，全程非空=${neverEmpty}，事后该格="${engineCell.text}" 行数≈${engineCell.lines}，独立条还在=${engineCell.standaloneStrip}`);

  // ── C 退出 → 回来 → AI 必须把轮它那一手补上 ───────────────────────────────
  await page.locator("[data-duel-close]").click();
  await page.waitForTimeout(700);
  const leftScreen = await page.locator("[data-duel-screen]").count() === 0;
  const onDuelPage = await page.locator("[data-duel-entry='ai']").count() === 1;
  check("C1 「完成」回到对弈入口页", leftScreen && onDuelPage);
  // 退出后不该丢：再点人机对战会问是否回到上次对局
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(800);
  const askVisible = await page.locator("[data-duel-resume-yes]").count() === 1;
  check("C2 再点人机对战弹「回到上次对局」", askVisible);
  const summary = await page.locator("[data-duel-resume-summary]").innerText().catch(() => "");
  check("C3 弹窗写清第几手与这局是什么规则", /第 2 手/.test(summary) && /禁手|自由|开局|山口|索索夫|塔拉/.test(summary), summary);
  await page.locator("[data-duel-resume-yes]").click();
  await page.locator("[data-duel-screen]").waitFor({ timeout: 10_000 });
  const stonesAfterResume = await stones();
  check("C4 回到上次对局：局面还是那 2 子", stonesAfterResume === 2, `stones=${stonesAfterResume}`);

  // 关键：退出时正轮到 AI（我落完它还没走完就被退出）。
  // ⚠ 2026-10-13：这里原来是「点悔棋退回自己回合 → 再落一手」，但那天定了**人机对弈悔棋
  //   10 棋魂一次、且开局前 10 手不许悔**（`takeDuelUndo`），2 子时那按钮是禁用的。
  //   而恢复到这一步本来就轮到自己（2 子 = 我一手 + AI 一手），所以改成等"轮到我"的信号，
  //   语义不变、也不再依赖悔棋（悔棋自己的三条由 `qa/duel-undo-check.mjs` 钉）。
  const backOnMyTurn = await page.waitForFunction(() => !document.querySelector(".board-thinking-indicator")
    && [...document.querySelectorAll(".board-hit")].some((h) => h.getAttribute("aria-disabled") !== "true"), null, { timeout: 30_000 })
    .then(() => true).catch(() => false);
  check("C5 回到自己回合（构造局面不再靠悔棋：前 10 手那按钮是禁用的）", backOnMyTurn);
  await page.getByRole("gridcell", { name: /^I9空位/ }).click();
  // ⚠ 基准必须在**离开界面前**取：离开后棋盘就卸载了，stones() 恒为 0，
  //   「> 0 就算过」会变成空断言（第一版就是这么假过的）。
  // ⚠ 而且必须**在浏览器里当场取值并返回**：旧写法是「等 ≥1 → 再 evaluate 读一遍 → 等 120ms → 退出」，
  //   初级引擎常在两次调用之间就把应手落完了，于是基准读成 2、退出时其实已经轮到自己，
  //   C7 就变成「AI 没活可补」的空断言（2026-10-13 实测 2 → 2 红）。
  const stonesAtExit = await page.waitForFunction(() => {
    const n = [...document.querySelectorAll(".board-hit")].filter((h) => (h.getAttribute("aria-label") || "").includes("已有棋子")).length;
    return n >= 1 ? n : false;
  }, null, { timeout: 5000 });
  // 不等 AI 走完就退出：这一手正好落在「AI 该动」的时刻
  await page.locator("[data-duel-close]").click();
  await page.waitForTimeout(400);
  const storedAwaiting = await page.evaluate(() => {
    try { const raw = JSON.parse(localStorage.getItem("banbu-duel-session-v1") || "null"); return raw ? { nodes: Object.keys(raw.document.nodes).length, outcome: raw.game.outcome } : null; } catch { return null; }
  });
  check("C6 退出时把会话存了下来（含棋谱本体，未保存的局也不丢）", Boolean(storedAwaiting) && storedAwaiting.outcome === null, JSON.stringify(storedAwaiting));
  await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await page.waitForTimeout(800);
  await page.locator("[data-duel-resume-yes]").click();
  await page.locator("[data-duel-screen]").waitFor({ timeout: 10_000 });
  const stonesOnResume = await stones();
  // ⚠ 不要断言「恰好相等」：回来时 AI 可能已经在补那一手了（那正是我们要它做的事）。
  //   这里要证的是「退出前落的子还在」，补子留给下面 C7。
  check("C6b 回来时退出前落的子还在（局面没丢）", stonesOnResume >= stonesAtExit, `${stonesAtExit} → ${stonesOnResume}`);
  // 给 AI 时间把这手算完（内置引擎秒级；真引擎给到 40s 上限）
  await page.waitForFunction((before) => [...document.querySelectorAll(".board-hit")].filter((h) => (h.getAttribute("aria-label") || "").includes("已有棋子")).length > before, stonesAtExit, { timeout: 40_000 }).catch(() => {});
  const stonesAfterAiResume = await stones();
  check("C7 恢复后 AI 自己把轮它的那一手补上了（不会僵在等人动）", stonesAfterAiResume > stonesAtExit, `${stonesAtExit} → ${stonesAfterAiResume}`);
  // 高亮要等一次重渲染：以「我方信息格带上 active」为条件轮询，而不是立刻断言（等的是界面刷新，不是功能缺失）。
  const meActive = await page.waitForFunction(() => document.querySelector("[data-duel-side='me']")?.classList.contains("active"), null, { timeout: 5000 }).then(() => true).catch(() => false);
  check("C8 补完之后轮到我（我方信息格高亮）", meActive, await page.evaluate(() => document.querySelector("[data-duel-side='me']")?.className || ""));

  // ── 终局面板（认输这条最短路径） ─────────────────────────────────────────
  await page.locator("[data-duel-resign]").click();
  await page.locator("[data-duel-confirm-ok]").click();
  await page.locator("[data-duel-result]").waitFor({ timeout: 10_000 });
  const result = await page.evaluate(() => ({
    // 终局标题从 10-02 起是**随机的题诗**（GameScreen.tsx 的 END_COPY，每态 8 句），
    // 平实那句「你赢了 / 你输了 / 和棋」挪到了 .duel-end-sub，胜负和印章在 .duel-end-stamp。
    // 所以旧断言「标题里必须写你输了」必红——红的还是随机红（8 句里只有 0 句含「你输了」）。
    title: document.querySelector("[data-duel-result-title]")?.textContent || "",
    sub: document.querySelector(".duel-end-sub")?.textContent || "",
    stamp: document.querySelector(".duel-end-stamp")?.textContent?.trim() || "",
    body: document.querySelector("[data-duel-result]")?.innerText.replace(/\s+/g, " ") || "",
    saveLabel: document.querySelector("[data-duel-save]")?.textContent || "",
  }));
  // 抄自 src/features/duel/GameScreen.tsx 的 END_COPY.lost：判负时不许抽出「胜」或「和」那一池的句子。
  const LOST_POEMS = ["胜负兵家常有事", "一着之差天地远", "棋差半子未为输", "五连成处悔已迟",
    "算漏一着满盘输", "势去难回莫强争", "此局欠君一招棋", "输赢未足挂心怀"];
  check("D1 认输后出终局面板：印章「负」+ 平实一句「你输了」+ 原因写认输",
    result.stamp === "负" && /你输了/.test(result.sub) && /认输/.test(result.body),
    `印章="${result.stamp}"，副标题="${result.sub}"，正文="${result.body.slice(0, 70)}"`);
  check("D1b 随机题诗确实出了池子里的一句（判负不许抽到胜/和的词，也不许空白）",
    LOST_POEMS.includes(result.title), `实际标题="${result.title}"`);
  // ⚠ 只断言「库里有『人机对战』」是假断言：开局就会把这份文档放进当前工作副本列表，
  //   库里的「第 N 局」又是 QA 夹具。要断言的是「点保存**之前**没入库、点完才入库且带结果」。
  check("D2 未点保存时按钮写「保存本局」（默认不自动入库）", /保存本局/.test(result.saveLabel), result.saveLabel);
  check("D3 终局面板没有提和", !/提和/.test(result.body));
  const titlesBeforeSave = await libraryTitlesRaw();
  check("D3b 未点保存时库里没有带结果的对局记录", !titlesBeforeSave.some((title) => /人机对战[·]/.test(title)), JSON.stringify(titlesBeforeSave.slice(0, 3)));
  await page.locator("[data-duel-save]").click();
  await page.waitForTimeout(700);
  const titlesAfterSave = await libraryTitlesRaw();
  check("D4 点保存后库里出现带结果的这条记录（人机对战·…）", titlesAfterSave.some((title) => /人机对战[·]/.test(title)), JSON.stringify(titlesAfterSave.slice(0, 3)));
  check("D5 保存后按钮改为「已存入棋谱库」", /已存入/.test(await page.locator("[data-duel-save]").innerText()));

  // ── F 空间口径（用户 10-01：「人机对战的那个界面，里面的棋盘似乎有点小了，
  //     你要么把下面的按钮放到更下面去，要么就优化棋盘上面那些的空间」）──────
  // 这三条断言的是**几何事实**，因为那正是本轮的改动目标：棋盘要顶到可用宽度、
  // 操作条要贴着底栏、整屏不能留一大块空白。以后谁调布局把哪条打回原形，这里就红。
  const duelGeometry = async (width, height) => {
    const geoContext = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", isMobile: width < 500, hasTouch: width < 500 });
    const geoPage = await geoContext.newPage();
    geoPage.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
    await geoPage.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
    await geoPage.goto(url, { waitUntil: "domcontentloaded" });
    await geoPage.waitForTimeout(1500);
    await geoPage.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
    await geoPage.waitForTimeout(700);
    await geoPage.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await geoPage.waitForTimeout(800);
    if (await geoPage.locator("[data-duel-resume-new]").count()) { await geoPage.locator("[data-duel-resume-new]").click(); await geoPage.waitForTimeout(600); }
    await geoPage.locator(".ai-game-setup").waitFor({ timeout: 10_000 });
    if (await geoPage.locator(".ai-float-backdrop").count()) { await geoPage.locator(".ai-float-backdrop").first().click({ position: { x: 4, y: 4 }, force: true }); await geoPage.waitForTimeout(300); }
    await geoPage.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
    await geoPage.locator("[data-duel-screen]").waitFor({ timeout: 10_000 });
    await geoPage.waitForTimeout(900);
    const geometry = await geoPage.evaluate(() => {
      const rect = (selector) => { const el = document.querySelector(selector); if (!el) return null; const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, w: box.width, h: box.height }; };
      const screen = document.querySelector("[data-duel-screen]");
      const screenStyle = screen ? getComputedStyle(screen) : null;
      return { vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight, board: rect("[data-duel-screen] .renju-board"), actions: rect(".duel-actions"), head: rect(".duel-screen-head"), nav: rect(".bottom-nav"), shell: rect(".app-shell"), screen: rect("[data-duel-screen]"), screenDisplay: screenStyle?.display, screenDirection: screenStyle?.flexDirection };
    });
    await geoContext.close();
    return geometry;
  };
  const phone = await duelGeometry(412, 900);
  check(`F1 手机竖屏棋盘吃满可用宽度（旧版 380/412=92%，本轮 404）`, phone.board.w >= phone.vw * 0.96, `${Math.round(phone.board.w)}px / ${phone.vw}px`);
  check("F2 操作条贴着底栏上方，不留一大块空白（旧版留 114px）", phone.nav.top - phone.actions.bottom <= 24, `间隙 ${Math.round(phone.nav.top - phone.actions.bottom)}px`);
  check("F3 手机竖屏一屏放得下（对弈界面自己不产生滚动）", phone.scrollH <= phone.vh + 1, `scrollHeight=${phone.scrollH} vs ${phone.vh}`);
  const padPortrait = await duelGeometry(820, 1180);
  check("F4 平板竖屏棋盘 ≥700px（旧版被 760 外壳 + 260 左栏夹成 454，下面空 620px）", padPortrait.board.w >= 700, `${Math.round(padPortrait.board.w)}px`);
  // 允许 20px：≥700 那一档 body{min-height:100vh} 与 .app-shell 的 18px 上外边距发生
  // margin-collapse，整页天生多 18px 可滚（打谱页同样如此，不是对弈界面的问题，本轮不动它）。
  check("F5 平板竖屏除那 18px 全局 margin-collapse 外不再多滚", padPortrait.scrollH <= padPortrait.vh + 20, `scrollHeight=${padPortrait.scrollH} vs ${padPortrait.vh}`);
  const padLandscape = await duelGeometry(1180, 820);
  // 门槛 520 → 620：10-02 用户指出「横屏默认双栏了，对弈界面没适配」，量出来棋盘按
  // `100dvh − 260` 取只有 560（同视口打谱页是 644）。改成扣 180 后实测 640，钉在这里防回退。
  check("F6 平板横屏棋盘 ≥620px（R104 时代 560；改口径前 10-02 实测 560 而打谱页 644）", padLandscape.board.w >= 620, `${Math.round(padLandscape.board.w)}px`);
  // 用户 10-01 拿桌面截图来问「这是适配设计吗」：外壳放到 1180 而棋盘被高度卡住，
  // 右边整片空白、操作条被拉成 1148px 宽。320 = 左栏 230 + 间距 14 + 内边距 32 再留点余量。
  const desktop = await duelGeometry(1280, 720);
  // 口径改过一次：R120 之前是"外壳收到棋盘那么宽"，所以断言 `外壳 − 棋盘 ≤ 376`；
  // R121 起横屏外壳**铺满视口**（收宽 + `margin:0` 会把剩余全推到右侧，用户 10-02：
  // 「右侧还是一片空空」），剩余横向由左栏吸收（上限 460），整块 grid 居中。
  // 所以真正要钉的是两件事：① 左栏真的吸收了（≥230 且不超 470）；② 操作条不许横跨到空白里。
  check("F7 宽屏横屏：左栏吸收剩余宽度（230~470px），空白不留在外壳右侧",
    desktop.head.w >= 230 && desktop.head.w <= 470, `左栏 ${Math.round(desktop.head.w)}px / 棋盘 ${Math.round(desktop.board.w)}px / 外壳 ${Math.round(desktop.shell.w)}px`);
  check("F7b 操作条不许横跨到没内容的地方（宽度 ≤ 左栏 + 间距 + 棋盘 + 20）",
    desktop.actions.w <= desktop.head.w + desktop.board.w + 34, `操作条 ${Math.round(desktop.actions.w)}px vs 栏+盘 ${Math.round(desktop.head.w + desktop.board.w + 14)}px`);
  check("F8 桌面 1280×720 棋盘仍 ≥420px（收外壳不能把棋盘一起收掉）", desktop.board.w >= 420, `${Math.round(desktop.board.w)}px`);

  // ── 矮横屏（手机横过来）：这一档以前把棋盘压成 min(46dvh,320px) = 179px，
  //    而两栏还留着，棋盘右侧空 238px 没人用（用户 10-02「有些地方没有适配横屏」）。
  const phoneLandscape = await duelGeometry(844, 390);
  check("F9 矮横屏 844×390 棋盘 ≥200px（改前实测 179，同视口打谱页是 214）", phoneLandscape.board.w >= 200, `${Math.round(phoneLandscape.board.w)}px`);
  // 10-07 用户要求手机横屏单栏大棋盘；棋盘由可用高度定边长、在右侧导航
  // 之前的区域居中。旧“两栏贴右缘≤90px”断言会把正确的居中布局误判成空白。
  const landscapeBoardCenter = (phoneLandscape.board.left + phoneLandscape.board.right) / 2;
  const landscapeContentCenter = (phoneLandscape.screen.left + Math.min(phoneLandscape.screen.right, phoneLandscape.nav.left)) / 2;
  check("F9b 手机矮横屏为单栏：棋盘在可用区域居中且不越过右侧导航",
    phoneLandscape.screenDisplay === "flex" && phoneLandscape.screenDirection === "column"
      && Math.abs(landscapeBoardCenter - landscapeContentCenter) <= 8
      && phoneLandscape.board.left >= phoneLandscape.screen.left
      && phoneLandscape.board.right <= phoneLandscape.nav.left,
    `布局 ${phoneLandscape.screenDisplay}/${phoneLandscape.screenDirection} · 棋盘中心 ${Math.round(landscapeBoardCenter)} / 可用中心 ${Math.round(landscapeContentCenter)} · 右缘 ${Math.round(phoneLandscape.board.right)} / 导航 ${Math.round(phoneLandscape.nav.left)}`);
  check("F9c 矮横屏操作条仍在视口内（这一档允许整页滚 11px，但按钮不能跑到视口外）",
    phoneLandscape.actions.bottom <= phoneLandscape.vh + 1, `操作条 bottom=${Math.round(phoneLandscape.actions.bottom)} vs ${phoneLandscape.vh}`);

  // ── F10 横屏不许留单边空白（用户 10-02：「怎么现在人机界面没变化，右侧还是一片空空的」）──
  // R120 那版把外壳收到「棋盘 + 左栏」宽，而横屏全局是 `margin:0` → 剩余全落在右侧：
  // 1180×820 实测外壳右缘距视口 208px、1280×800 是 328px。现在外壳铺满、剩余由左栏吸收。
  const band = await duelGeometry(1180, 820);
  check("F10 平板横屏不留单边空白：外壳右缘≈视口右缘（≤60px，改前 208px）",
    band.vw - band.shell.right <= 60, `视口 ${band.vw} − 外壳右缘 ${Math.round(band.shell.right)}`);
  check("F10b 棋盘与右缘竖条之间不留空带（≤40px；改前棋盘右边先空 208px 才到竖条）",
    band.nav.left - band.board.right <= 40, `竖条 left ${Math.round(band.nav.left)} − 棋盘右缘 ${Math.round(band.board.right)}`);

  check("E1 无页面错误", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}
console.log(failed === 0 ? "\n对弈界面门禁全部通过" : `\n${failed} 项断言失败`);
process.exit(failed === 0 ? 0 : 1);
