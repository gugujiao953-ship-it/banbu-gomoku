/**
 * capture-extra.mjs — v2 补拍：书签修复 + 09-12 新 UI + 分析详情素材
 * 源：5195（当前 HEAD）
 * 拍：
 *  41-analysis-modes      分析三模式下拉（持续/自对弈/提示）
 *  42-thinking-time       思考时长选择弹窗
 *  43-analysis-candidates 候选点展开预览 + 胜率（等候选点长全）
 *  seq/analysis-v2        候选点 5 个重拍（等待更久）
 *  23-bookmark            分支树 → 书签（按钮文案探测）
 *  44-engine-download     设置 → 引擎区（冠军网络状态）
 *  45-opening-book        人机对战弹窗 → 开局库开关打开
 *  46-analysis-quickswitch 09-12 新「分析」快捷开关
 *  31-tree-a/b/c          分支树操作序列（加书签→书签页）
 */
import { launch, boot, shot, settle, clickPoint, waitAnimations, safeClick, resolveDraftModal, dismissToast, STILLS, SEQ, BASE } from "./lib.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const log = [];
const { browser, context, page } = await launch();

const step = async (name, fn) => {
  console.log("▶", name);
  try { await fn(); log.push(["OK", name]); console.log("  ✓", name); }
  catch (e) {
    log.push(["FAIL", name, String(e.message).split("\n")[0]]);
    console.log("  ✗", name, "::", String(e.message).split("\n")[0]);
    await shot(page, STILLS, `_fail-${name}.png`).catch(() => {});
  }
  await dismissToast(page);
  await settle(page, 180);
};
const dumpLog = (msg) => { log.push(["INFO", msg]); console.log("  INFO:", msg); };

const navTo = async (n, times = 1) => {
  const moveBtn = (k) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: k });
  for (let i = 0; i < times; i++) { await safeClick(moveBtn(n)); await settle(page, 130); }
};
const gotoMove = async (n) => { await navTo("到第一手"); await navTo("下一手", n); await settle(page, 400); };

const importSgf = async () => {
  await page.locator('input[type="file"][accept*=".sgf"]').first()
    .setInputFiles({ name: "花月开局-黑必胜研究.sgf", mimeType: "application/x-go-sgf",
      buffer: Buffer.from(`(;GM[1]FF[4]CA[UTF-8]AP[Banbu:1.1.8]SZ[15]
GN[花月开局·黑必胜研究]PB[黑方]PW[白方]EV[第九轮研究局]DT[2026-09-10]RU[Renju]
;B[hh]C[黑1：天元起手，直指中心。];W[ih]C[白2：斜指应对。];B[hi]C[黑3：花月形。]
;W[ii]C[白4：挡右侧。];B[ij]C[黑5：黑方展开攻击。]CR[hj][gi]TR[ji]MA[jj]
)`, "utf8") });
  await settle(page, 900);
  await resolveDraftModal(page, "discard");
  await page.getByText("花月开局·黑必胜研究").first().waitFor({ timeout: 20000 }).catch(() => {});
  await settle(page, 900);
};
const openImportSheet = async () => {
  for (let i = 0; i < 3; i++) {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "导入" }));
    await settle(page, 700);
    if (await page.getByRole("dialog", { name: "选择导入方式" }).isVisible().catch(() => false)) return true;
    await resolveDraftModal(page, "discard");
    await settle(page, 400);
  }
  throw new Error("导入方式对话框未出现");
};

try {
  await boot(page);
  await importSgf();

  /* ============ 01. 分析三模式 + 候选点（等候选长全） ============ */
  await step("41-analysis-modes", async () => {
    await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
    await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
    await waitAnimations(page, ".ai-analysis-panel");
    // dump 面板顶部的模式控件
    const headText = await page.locator(".ai-analysis-panel").evaluate((el) =>
      (el.querySelector(".analysis-panel-head, .panel-head, [class*=head]")?.textContent || "").slice(0, 120));
    dumpLog("分析面板头部文本: " + headText);
    // 快捷开关（09-12）：panel 外“分析”旁的按钮
    const qt = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => /分析/.test(b.textContent||"") && b.offsetWidth > 0);
      return btns.slice(0, 6).map(b => `${b.textContent.trim()}@${b.className.slice(0, 40)}`).join(" | ");
    });
    dumpLog("含「分析」的按钮: " + qt);
    // 模式控件：连续可点控件（mode selector）探测
    const modeSel = page.locator('.ai-analysis-panel [aria-label*="模式"], .ai-analysis-panel [class*=mode]').first();
    if (await modeSel.isVisible().catch(() => false)) {
      await safeClick(modeSel); await settle(page, 500);
      await shot(page, STILLS, "41-analysis-modes.png");
      await safeClick(modeSel); await settle(page, 400);
    } else {
      // 备选：逐项找「持续/自对弈/提示」文本的容器
      const hasModes = await page.locator('.ai-analysis-panel').getByText(/自对弈|持续分析|提示/).first().isVisible().catch(() => false);
      dumpLog("面板含模式文字: " + hasModes);
      const modesBox = page.locator('.ai-analysis-panel [class*=mode]').first();
      if (await modesBox.isVisible().catch(() => false)) await shot(page, STILLS, "41-analysis-modes.png");
    }
    // 思考时长弹窗
    const durBtn = page.locator('.ai-analysis-panel [aria-label*="思考时长"], .ai-analysis-panel [class*=think], .ai-analysis-panel button').filter({ hasText: /秒|时长/ }).first();
    if (await durBtn.isVisible().catch(() => false)) {
      await safeClick(durBtn); await settle(page, 500);
      await shot(page, STILLS, "42-thinking-time.png");
      await page.keyboard.press("Escape").catch(() => {});
      await settle(page, 400);
    }
    // 选点数量 5
    await safeClick(page.locator('.ai-analysis-panel [aria-label="选点数量"]'));
    await settle(page, 500);
    await safeClick(page.getByRole("button", { name: /^5 个$/ }).first());
    await settle(page, 500);
    // 等候选点长全（最长 12s）
    for (let i = 0; i < 10; i++) {
      const n = await page.locator(".analysis-candidate-point").count();
      if (n >= 4) break;
      await settle(page, 1200);
    }
    dumpLog("候选点数=" + await page.evaluate(() => document.querySelectorAll(".analysis-candidate-point").length));
    await settle(page, 1500);
    await shot(page, STILLS, "10-analysis.png");

    // 候选点展开棋盘预览
    const cand = page.locator(".analysis-candidate-point").first();
    if (await cand.isVisible().catch(() => false)) {
      await safeClick(cand); await settle(page, 900);
      await shot(page, STILLS, "43-analysis-candidates.png");
      await page.keyboard.press("Escape").catch(() => {});
      await settle(page, 500);
    }

    // seq/analysis 重拍（带候选长全）
    const dir = path.join(SEQ, "analysis");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
      await settle(page, 1300);
    }
    dumpLog("seq/analysis 6 帧已拍");
  });

  /* ============ 46. 09-12 分析快捷开关（先回打谱再开分析） ============ */
  await step("46-analysis-quickswitch", async () => {
    await safeClick(page.locator(".ai-analysis-panel [aria-label*='关闭'], .ai-analysis-panel button[aria-label='关闭']").first());
    await settle(page, 500);
    // 找「分析」主按钮旁的快捷开关形态
    await safeClick(page.getByRole("button", { name: "分析", exact: true }).first());
    await settle(page, 800);
    const sw = page.locator('[class*=quick] button, [class*=toggle] button, [aria-label*="分析开关"]').first();
    if (await sw.isVisible().catch(() => false)) {
      const before = await page.evaluate(() => document.querySelectorAll('.analysis-candidate-point').length);
      await safeClick(sw); await settle(page, 800);
      const after = await page.evaluate(() => document.querySelectorAll('.analysis-candidate-point').length);
      dumpLog(`快捷开关: 候选 ${before} -> ${after}`);
      await shot(page, STILLS, "46-analysis-quickswitch.png");
      await safeClick(sw); await settle(page, 500);
    } else {
      dumpLog("未找到独立快捷开关（可能已并入面板）");
      const panelBtn = page.locator(".ai-analysis-panel [class*=toggle]").first();
      if (await panelBtn.isVisible().catch(() => false)) {
        await safeClick(panelBtn); await settle(page, 900);
        await shot(page, STILLS, "46-analysis-quickswitch.png");
        await safeClick(panelBtn); await settle(page, 400);
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await settle(page, 400);
  });

  /* ============ 02. 分支树 + 书签（修复 23） ============ */
  await step("22-branch-tree", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
    await settle(page, 600);
    await importSgf();
    await gotoMove(5);
    await safeClick(page.getByRole("button", { name: "打开分支树" }));
    await page.getByRole("dialog", { name: "分支树" }).waitFor({ timeout: 15000 });
    await waitAnimations(page, ".bottom-sheet");
    await settle(page, 600);
    await shot(page, STILLS, "22-branch-tree.png");
  });

  await step("23-bookmark", async () => {
    const dlg = page.getByRole("dialog", { name: "分支树" });
    // 探测弹窗里所有按钮文案（书签按钮可能换名）
    const btns = await dlg.evaluate((el) =>
      [...el.querySelectorAll("button")].filter(b => b.offsetWidth > 0).map(b => b.textContent.trim()).slice(0, 14));
    dumpLog("分支树弹窗按钮: " + JSON.stringify(btns));
    const bmTab = dlg.getByRole("button", { name: /书签/ }).first();
    await safeClick(bmTab); await settle(page, 600);
    await shot(page, STILLS, "23a-bookmark-tab.png");
    // 保存当前局面
    const save = dlg.getByRole("button", { name: /保存当前局面为书签|加书签|保存书签/ }).first();
    if (await save.isVisible().catch(() => false)) {
      await safeClick(save); await settle(page, 700);
    } else {
      // 探测书签页按钮
      const bmBtns = await dlg.evaluate((el) => [...el.querySelectorAll("button")].filter(b => b.offsetWidth > 0).map(b => b.textContent.trim()).slice(0, 14));
      dumpLog("书签页按钮: " + JSON.stringify(bmBtns));
    }
    await shot(page, STILLS, "23-bookmark.png");
    // 回到分支树 tab
    await safeClick(dlg.getByRole("button", { name: /分支树/ }).first());
    await settle(page, 600);
    await shot(page, STILLS, "31-tree-a.png");
    // 三条操作序列（31-tree-b/c 语义保留：书签列表 + 缩放）
    await safeClick(dlg.getByRole("button", { name: /书签/ }).first());
    await settle(page, 600);
    await shot(page, STILLS, "31-tree-b.png");
    await safeClick(dlg.getByRole("button", { name: /分支树/ }).first());
    await settle(page, 500);
    await safeClick(dlg.getByRole("button", { name: "2×" }));
    await settle(page, 700);
    await shot(page, STILLS, "31-tree-c.png");
    await safeClick(dlg.getByRole("button", { name: "关闭" }));
    await settle(page, 400);
  });

  /* ============ 03. 人机对战 + 开局库开关 ============ */
  await step("45-opening-book", async () => {
    await page.locator("nav.bottom-nav").getByRole("button", { name: "AI" }).click({ timeout: 9000 });
    await page.getByRole("dialog", { name: "AI 人机对战" }).waitFor({ timeout: 15000 });
    await waitAnimations(page, ".bottom-sheet");
    await settle(page, 500);
    // 难度行的开局库开关（开关默认关闭）
    const sw = page.getByRole("dialog", { name: "AI 人机对战" }).locator('[role="switch"], [class*=switch], [class*=toggle]').first();
    if (await sw.isVisible().catch(() => false)) {
      const swtext = await sw.evaluate((el) => el.parentElement?.textContent?.trim().slice(0, 60) || "");
      dumpLog("开局库开关上下文: " + swtext);
      await safeClick(sw); await settle(page, 600);
      await shot(page, STILLS, "45-opening-book.png");
      await safeClick(sw); await settle(page, 400);
    } else {
      dumpLog("AI 弹窗无 switch/toggle，拍弹窗底部");
      await shot(page, STILLS, "45-opening-book.png");
    }
    await page.keyboard.press("Escape").catch(() => {});
    await settle(page, 400);
  });

  /* ============ 04. 设置 → 引擎区（冠军网络状态/下载 UI） ============ */
  await step("44-engine-download", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
    await settle(page, 800);
    const sec = page.locator("details.settings-collapsible").filter({ hasText: /引擎|AI/ }).first();
    if (await sec.isVisible().catch(() => false)) {
      if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
      await settle(page, 500);
      const t = await sec.evaluate((el) => el.textContent.trim().slice(0, 150));
      dumpLog("引擎区文本: " + t);
      await sec.evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 110)));
      await settle(page, 450);
      await shot(page, STILLS, "44-engine-download.png");
    } else {
      // 找不到详情，拍「数据与兼容」下的引擎行
      const anySec = page.locator("details.settings-collapsible").filter({ hasText: /引擎|网络|下载/ }).first();
      if (await anySec.isVisible().catch(() => false)) {
        if (!(await anySec.getAttribute("open"))) await anySec.locator("summary").first().click();
        await settle(page, 500);
        await anySec.evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 110)));
        await shot(page, STILLS, "44-engine-download.png");
      } else throw new Error("设置里找不到引擎区");
    }
  });

} finally {
  const fails = log.filter(([s]) => s === "FAIL");
  console.log("\n===== 汇总 =====");
  console.log(`成功 ${log.filter(([s]) => s === "OK").length} / 失败 ${fails.length}`);
  fails.forEach(([, n, m]) => console.log("  FAIL:", n, "::", m));
  log.filter(([s]) => s === "INFO").forEach(([, m]) => console.log("  INFO:", m));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}