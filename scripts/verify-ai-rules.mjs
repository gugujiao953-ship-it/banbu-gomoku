import { chromium } from "playwright";
import assert from "node:assert/strict";

/**
 * 首运行欢迎页必须关掉，否则它的 .first-run-backdrop（position:fixed; inset:0;
 * z-index:120）会拦住后面每一次点击，报「其它元素拦截了指针事件」而超时。
 *
 * 关掉的方式**只有一种**：URL 上的 `?qa=1`。别再靠写
 * `banbu-first-run-welcome-v1="true"` —— 自 09-14 起那个键改成**按版本号**存
 * （见 src/features/onboarding/onboarding.ts 与提交 d5f5c5c），字面量 "true"
 * 只代表「在更早的版本上看过」，当前版本一律再弹一次。run-qa 注入的 QA_BASE_URL
 * 自带 ?qa=1；手动导出 QA_BASE_URL（如单跑本脚本）时多半没有，所以这里统一补一次
 * （已有查询串就不动）。与 qa/lib-ui-roundtrip.mjs 的写法保持一致。
 */
const rawBaseURL = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const baseURL = rawBaseURL.includes("?") ? rawBaseURL : `${rawBaseURL}?qa=1`;
const browser = await chromium.launch({ headless: true });

async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(baseURL);
  // localStorage.clear() 是为了丢掉上一场景留下的草稿/棋谱库；清空之后 welcome 键
  // 也就没了，但 `?qa=1` 已经让欢迎页不再出现，所以不需要（也**不能**）再写 "true"。
  // localStorage.clear() 是为了丢掉上一场景留下的草稿/棋谱库，同时也会丢掉棋魂账本 ——
  // 下面「回退到人机历史节点后另开分支」那一段点的是 `[data-duel-undo]`，而对弈的「悔棋」
  // 自 2026-10-13 起是 **10 棋魂一次**（余额不足会如实拒绝），所以清完要把钱补回去再 reload。
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "gate-rules", at: Date.now(), amount: 500, reason: "manual", detail: "门禁灌余额" }]));
  });
  await page.reload();
  return { context, page };
}

async function clickPoint(page, coordinate) {
  await page.getByRole("gridcell", { name: new RegExp(`^${coordinate}(?:空位|已有棋子|禁手)`) }).click();
}

try {
  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByText("可选增强功能", { exact: true }).click();
    await page.getByLabel("AI 棋盘提示点").check();
    await page.getByRole("button", { name: "打谱" }).click();
    await page.getByRole("button", { name: "对弈" }).click();
    await page.waitForTimeout(700);
    await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await page.locator('[data-ai-rule="forbidden"]').click();
    await page.waitForTimeout(400);
    await page.locator(".ai-float-list button").filter({ hasText: "五手两打" }).click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    await page.getByText("第 1 手").waitFor();
    await clickPoint(page, "H8");
    await clickPoint(page, "I8");
    await clickPoint(page, "H7");
    // 点完第 3 手之后要先等 AI 把**第 4 手**算完落子：offer-fifths 阶段是在白4 落子
    // 之后才由 completeOpeningPlacement 切出来的。AI 还在思考时 banner 写的是
    // 「AI 正在落第 4 手…」，此时读 5s 常常读不到那句提示（实测 3 次里有 1 次失败——
    // 不是产品问题，是这里没等 AI 出手）。给足超时即可。
    await page.getByText(/请提供 2 个不同棋形/).waitFor({ timeout: 30_000 });
    await clickPoint(page, "G8");
    assert.equal(await page.locator(".opening-candidate").count(), 1, "未选定的黑5候选应以编号临时显示");
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-five-two-candidate.png", fullPage: true });
    await clickPoint(page, "J9");
    assert.equal(await page.locator(".opening-candidate").count(), 2, "两个打点都应以编号显示");
    // 选择权在白方（rule-guide-data.ts: 五手两打「白4后黑方给出两个…第5手候选，**白方选择**
    // 其中一个继续」；steps 也写明「黑方给 A1/A2 → 白方选一个」）。本局人类执黑（默认），
    // 所以**白方就是 AI**：人类摆完两个打点后由 AI 选点，人类不该也不能点。
    // 这一步原来写成「人类再点一下选 G8」是**错的**（也不符合规则）——而且会和 AI 的
    // choose-fifth 分支抢同一手：实测人类那一下把第5手记到了第 7 手、AI 自己先占了第 5 手，
    // 开局收尾变成 8 子。现在按规则只断言「AI 接管选择」这件事。
    await page.locator(".ai-opening-banner").waitFor({ state: "detached", timeout: 30_000 });
    // AI 选完第5手 → completeFifthChoice 切到 place(6)（白方的第 6 手），开局到此结束：
    // 盘面 6 颗子（黑 3、白 3），轮到黑方（人类）走第 7 手之前停下。
    assert.equal(await page.locator(".stone").count(), 6, "五手两打开局应只写入选中的黑5并完成第6手");
    assert.equal(await page.locator(".opening-candidate").count(), 0, "开局结束后不应再留下打点编号");
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-five-two.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "对弈" }).click();
    await page.waitForTimeout(700);
    await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await page.locator('[data-ai-rule="forbidden"]').click();
    await page.waitForTimeout(400);
    await page.locator(".ai-float-list button").filter({ hasText: "塔十" }).click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    await clickPoint(page, "H8");
    await page.getByRole("button", { name: "不交换" }).waitFor({ timeout: 5000 });
    assert.match(await page.locator(".ai-opening-banner").innerText(), /第 2 手后可选择是否交换黑白方/);
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-taraguchi-swap.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("radio", { name: "黑棋" }).click();
    for (const coordinate of ["F8", "G8", "H8", "I8", "J8"]) await clickPoint(page, coordinate);
    assert.ok(await page.locator(".winning-line").count(), "连五后应显示红色胜利连线");
    assert.equal(await page.locator(".winning-stone-ring").count(), 5, "获胜五子应逐颗高亮");
    assert.equal(await page.locator(".forbidden-point").count(), 0, "对局结束后不应继续显示可落子禁手提示");
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-winning-line.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByText("可选增强功能", { exact: true }).click();
    await page.getByLabel("AI 棋盘提示点").check();
    await page.getByText("棋盘显示", { exact: true }).click();
    await page.getByLabel("界面动效").check();
    await page.getByRole("button", { name: "打谱" }).click();
    // 「思考当前局面的下一步」这颗独立按钮已经不存在了：提交 b221409
    // （feat(workspace): unify analysis status）把它和 .command-think / .think-result /
    // .thinking-point 整套一起删掉，并成到统一的「分析」动作 + .ai-analysis-panel。
    // 那套面板的行为（逐步加深、候选点、提示回显）由 scripts/ui-analysis-check.mjs 与
    // qa/analysis-depth-range.mjs 用真实引擎包覆盖——本门禁不再重复，也不再断言已删除的
    // DOM（旧断言只会永远超时）。
    const analysisAction = page.getByRole("button", { name: "分析", exact: true });
    assert.equal(await analysisAction.count(), 1, "打谱工具栏缺少统一的分析动作");
    assert.equal(await analysisAction.getAttribute("aria-pressed"), "false", "分析面板默认应未展开");
    await analysisAction.click();
    await page.locator(".ai-analysis-panel").waitFor({ timeout: 5000 });
    assert.equal(await analysisAction.getAttribute("aria-pressed"), "true", "点分析后应按压态展开面板");
    // 面板打开即给出「持续分析」开关与分析分页，不依赖引擎是否已下载。
    assert.equal(await page.getByLabel("持续分析").count(), 1, "分析面板缺少持续分析开关");
    assert.ok(await page.locator(".ai-analysis-stats").count(), "分析面板缺少统计行");
    await page.screenshot({ path: "C:/Users/ZhuanZ(无密码)/AppData/Local/Temp/banbu-think-panel.png", fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "对弈" }).click();
    await page.waitForTimeout(700);
    await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    await clickPoint(page, "H8");
    await page.locator(".stone").nth(1).waitFor({ timeout: 30000 });
    assert.ok(await page.locator(".stone").count() >= 2, "人机对战没有完成一次 AI 回应");
    // 对局进行中，顶栏那枚 ‹（aria-label「回看上一手」）是**禁用**的：
    // App.tsx:9610 `canPrev={Boolean(aiGame.outcome && current.parentId)}`——09-13 定案，
    // 对局中的回退语义是悔棋，不能画成浏览按钮（App.tsx:6266 起 goPrev 上方的注释）。
    // 旧脚本点的是 getByRole("button", { name: "上一手" })，命中的正是这枚禁用按钮，
    // 于是一直「element is not enabled」到超时。
    const prevButton = page.locator("[data-duel-prev]");
    assert.equal(await prevButton.isDisabled(), true, "对局进行中「回看上一手」应保持禁用（‹ › 只在终局后当回看用）");
    const emptyPointState = () => page.evaluate(() => {
      const cell = [...document.querySelectorAll('[role="gridcell"]')].find((node) => (node.getAttribute("aria-label") || "").endsWith("空位"));
      return cell ? { label: cell.getAttribute("aria-label"), disabled: cell.getAttribute("aria-disabled") } : null;
    });
    const livePoint = await emptyPointState();
    assert.ok(livePoint, "找不到一个空位命中点（棋盘命中点结构变了，下面两条会空转）");
    assert.equal(livePoint.disabled, "false", `对局进行中空位「${livePoint.label}」应可落子（aria-disabled=${livePoint.disabled}）`);
    // 「回退到人机历史节点后另开分支」真正需要的前提是**对局还在进行**，现行控件是同一支
    // goPrev 的「悔棋」[data-duel-undo]。
    // ⚠ 2026-10-13 起这枚按钮是 **10 棋魂一次、且开局前 10 手不给悔**（App 的 `takeDuelUndo`），
    //   所以先把这局下满 10 手（钱在 `freshPage` 里灌好了），再退一轮开分支 ——
    //   旧写法在这里退到 0 子，那是"退掉唯一那两手"，如今锁定期内会被拒绝。
    const stones = () => page.evaluate(() => document.querySelectorAll(".stone").length);
    for (let i = 0; i < 16 && (await stones()) < 10; i += 1) {
      await page.evaluate(() => {
        const hits = [...document.querySelectorAll(".board-hit")].filter((h) => h.getAttribute("aria-disabled") !== "true" && (h.getAttribute("aria-label") || "").includes("空位"));
        hits[Math.floor(Math.random() * hits.length)]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await page.waitForTimeout(3000);
    }
    const beforeUndo = await stones();
    assert.ok(beforeUndo >= 10, `没能下满 10 手（${beforeUndo} 子），悔棋锁定期过不去，分支这段没法测`);
    await page.locator("[data-duel-undo]").click();
    // 「悔棋」是异步导航：退掉「AI 的应手 + 自己那手」= 少 2 子，紧接着落点会被吞掉，等它落地。
    await page.waitForFunction((n) => document.querySelectorAll(".stone").length === n - 2, beforeUndo, { timeout: 10_000 });
    const afterUndo = await stones();
    const branchLabel = await page.evaluate(() => ([...document.querySelectorAll('[role="gridcell"]')]
      .find((node) => (node.getAttribute("aria-label") || "").endsWith("空位") && node.getAttribute("aria-disabled") === "false")?.getAttribute("aria-label") || ""));
    assert.ok(Boolean(branchLabel), "回退后找不到可落的空位（分支测试没法继续）");
    await clickPoint(page, branchLabel.replace(/空位.*$/, "").trim());
    // 人类走一手 + AI 应手，才是 +2；AI 稍慢会读到中间态，所以等第 2 颗落下来再断言。
    await page.waitForFunction((n) => document.querySelectorAll(".stone").length >= n + 2, afterUndo, { timeout: 30_000 }).catch(() => {});
    assert.ok((await stones()) >= afterUndo + 2, "回退到人机历史节点后无法创建替代分支");

    // canPrev 的真实前提在这里补上：**认输把这一局结束**，‹ › 才变成回看。
    // （旧脚本在这里点「删除当前一步及后续变化」+「撤销」再另开分支——那两个按钮属于
    // 打谱工作区的命令栏，人机对局界面（GameScreen）从不渲染，实测本段全程
    // [aria-label="删除当前一步及后续变化"] 数量为 0；「删除后撤销再另开分支」由下面
    // 第 7 段的打谱场景覆盖，这里不再重复，也不留一条永远等不到的断言。）
    await page.locator("[data-duel-resign]").click();
    await page.locator("[data-duel-confirm]").waitFor();
    assert.match(await page.locator("[data-duel-confirm]").innerText(), /确认认输/, "认输没有先要二次确认（这一步会毁掉本局）");
    await page.locator("[data-duel-confirm-ok]").click();
    await page.locator("[data-duel-result]").waitFor();
    assert.equal(await prevButton.isDisabled(), false, "终局后「回看上一手」应可用（canPrev 的前提 aiGame.outcome 已满足）");
    assert.equal(await page.locator("[data-duel-undo]").isDisabled(), true, "终局后不许再悔棋（canUndo 要求 !aiGame.outcome）");
    const stonesAtEnd = await stones();
    await prevButton.click();
    // 回看一步 = 盘上少一颗子、标题跟着光标走。**基准必须现取**：这一段前面已经把对局下满
    // 10 手又退了一轮再开分支（旧写法钉的是"剩 1 颗 / 第 1 手"，那是整局只有 2 子时代的数）。
    await page.waitForFunction((n) => document.querySelectorAll(".stone").length === n - 1, stonesAtEnd, { timeout: 8000 });
    assert.match(await page.locator("[data-duel-title]").innerText(), new RegExp(`第 ${stonesAtEnd - 1} 手`), "回看后标题没有跟着光标走");
    // 回看是**只读浏览**：光标退一手，棋谱一步没删，而且终局的棋盘不许再落子
    // （App.tsx:2943 aiBoardDisabled 含 aiGame.outcome；落点自己 onPointerDown 里 return）。
    const lockedPoint = await emptyPointState();
    assert.ok(lockedPoint, "回看时找不到空位（棋盘命中点结构变了，这条会空转）");
    assert.equal(lockedPoint.disabled, "true", `终局回看时空位「${lockedPoint.label}」仍标记为可落子（aria-disabled=${lockedPoint.disabled}）`);
    const wroteStone = await page.evaluate((label) => {
      const cell = [...document.querySelectorAll('[role="gridcell"]')].find((node) => node.getAttribute("aria-label") === label);
      if (!cell) return "cell-gone";
      for (const type of ["pointerdown", "pointerup", "click"]) {
        cell.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1 }));
      }
      return document.querySelectorAll(".stone").length;
    }, lockedPoint.label);
    await page.waitForTimeout(600);
    assert.notEqual(wroteStone, "cell-gone", `回看时空位「${lockedPoint.label}」在派发事件前消失了`);
    // 基准同样是现取的 `stonesAtEnd`（旧写法钉 1 / 2 颗，那是"整局只有 2 子"时代的数）。
    assert.equal(wroteStone, stonesAtEnd - 1, `终局回看时点空位把子写进了棋谱（${stonesAtEnd - 1} → ${wroteStone}）`);
    await page.locator("[data-duel-back-live]").click();
    await page.waitForFunction((n) => document.querySelectorAll(".stone").length === n, stonesAtEnd, { timeout: 5000 });
    assert.equal(await page.locator(".stone").count(), stonesAtEnd, `回看不该删棋谱：回到本手应仍是 ${stonesAtEnd} 子`);
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    for (const coordinate of ["H8", "I8", "H9"]) await clickPoint(page, coordinate);
    await page.getByRole("button", { name: "上一手" }).click();
    // 等回退重绘完成（3 子→2 子）再点 H8，否则这一下会被吞掉。
    await page.waitForFunction(() => document.querySelectorAll(".stone").length === 2, null, { timeout: 5000 });
    await clickPoint(page, "H8");
    assert.equal(await page.locator(".stone").count(), 2, "点击已有棋子不应把棋谱光标跳到该手");
    await clickPoint(page, "J9");
    assert.equal(await page.locator(".stone").count(), 3, "回退到旧节点后无法创建普通打谱分支");
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await page.getByRole("button", { name: "对弈" }).click();
    await page.waitForTimeout(700);
    await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await page.getByRole("button", { name: /开始人机对战/ }).click();
    // 「退出对弈」那颗文字按钮随对弈界面改版不在了：现在的出口是界面右上角的 ×
    // （src/features/duel/GameScreen.tsx `data-duel-close`，aria-label「完成，离开对局界面」，
    // 走 App.tsx closeDuelScreen → exitAiGame + 回到「对弈」页）。旧选择器只能永远超时。
    const closeDuel = page.getByRole("button", { name: "完成，离开对局界面" });
    assert.equal(await closeDuel.count(), 1, "对局界面缺少离开入口（data-duel-close）");
    await closeDuel.click();
    await page.locator("[data-duel-screen]").waitFor({ state: "detached" });
    assert.equal(await page.locator("[data-duel-screen]").count(), 0, "点了离开对局之后对局界面还在");
    // 离开对局要落回「对弈」首页（两张开局卡还在），不是白屏、也不是停在打谱页。
    await page.locator('[data-duel-entry="ai"]').waitFor();
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    for (const coordinate of ["H8", "I8", "H9"]) await clickPoint(page, coordinate);
    await page.getByRole("button", { name: "删除当前一步及后续变化" }).click();
    await page.getByRole("button", { name: "撤销" }).click();
    // 删除是草稿操作；撤销后光标停在第 2 手（2 子），再点 J9 就是补第 3 手。等 2 子
    // 局面稳定再点（撤销后的重绘会吞掉紧跟着的落点）。断言仍在 J9 之后读 3 子。
    await page.waitForFunction(() => document.querySelectorAll(".stone").length === 2, null, { timeout: 5000 });
    await clickPoint(page, "J9");
    assert.equal(await page.locator(".stone").count(), 3, "删除后撤销无法继续编辑当前棋谱");
    await context.close();
  }

  {
    const { context, page } = await freshPage();
    await clickPoint(page, "H8");
    // 打谱页顶栏的「打开导入方式」已经下架（提交 116d7d3：紧凑顶栏把导入挪到主导航），
    // 现在导入入口是底部主导航中间的「导入」按钮（.bottom-nav .nav-center）。旧选择器
    // 在打谱页永远找不到元素（该按钮只在非 record 页渲染）。
    await page.locator(".bottom-nav .nav-center").click();
    const draftDialog = page.getByRole("dialog", { name: "未保存草稿" });
    await draftDialog.waitFor();
    assert.equal(await page.locator(".import-options").count(), 0, "导入面板不应盖住未保存草稿确认层");
    assert.equal(await draftDialog.evaluate((element) => getComputedStyle(element.parentElement).zIndex), "100", "未保存草稿确认层应位于普通面板之上");
    await draftDialog.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "对弈" }).click();
    await page.waitForTimeout(700);
    await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await page.getByRole("dialog", { name: "未保存草稿" }).waitFor();
    assert.equal(await page.locator(".ai-game-setup").count(), 0, "AI 设置面板不应盖住未保存草稿确认层");
    await context.close();
  }

  console.log("AI rule browser verification passed: five-two (black offers / white-AI picks), Taraguchi swap, winning line, analysis panel, AI reply, in-play 悔棋 branch, ended-game 回看 (canPrev gated on outcome, read-only browse, board locked), branch navigation, delete undo, draft guard priority.");
} finally {
  await browser.close();
}
