/**
 * capture-analysis-fix.mjs — 分析面板候选点重拍
 * 原因：extra 未点分析开关，候选点 0。
 * 本次：进分析 → 点 .analysis-toggle 打开 → 等候选 ≥4（最久 30s）→
 *       重拍 10-analysis / seq/analysis / 42 / 43 / 46
 */
import { launch, boot, shot, settle, waitAnimations, safeClick, resolveDraftModal, dismissToast, STILLS, SEQ } from "./lib.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const log = [];
const { browser, context, page } = await launch();
const dumpLog = (m) => { log.push(["INFO", m]); console.log("  INFO:", m); };

const importSgf = async () => {
  await page.locator('input[type="file"][accept*=".sgf"]').first()
    .setInputFiles({ name: "花月开局-黑必胜研究.sgf", mimeType: "application/x-go-sgf",
      buffer: Buffer.from(`(;GM[1]FF[4]CA[UTF-8]AP[Banbu:1.1.8]SZ[15]
GN[花月开局·黑必胜研究]PB[黑方]PW[白方]EV[第九轮研究局]DT[2026-09-10]RU[Renju]
;B[hh]C[黑1：天元起手。];W[ih]C[白2：斜指应对。];B[hi]C[黑3：花月形。];W[ii]C[白4：挡右侧。];B[ij]C[黑5：展开攻击。]CR[hj][gi]TR[ji]MA[jj])`, "utf8") });
  await settle(page, 900);
  await resolveDraftModal(page, "discard");
  await page.getByText("花月开局·黑必胜研究").first().waitFor({ timeout: 20000 }).catch(() => {});
  await settle(page, 900);
};

try {
  await boot(page);
  await importSgf();

  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
  await waitAnimations(page, ".ai-analysis-panel");

  // ① 分析开关：逐形态尝试打开（旧 .analysis-toggle / 新面板 head 开关）
  const tg = page.locator(".analysis-toggle").first();
  const tg2 = page.locator('.ai-analysis-panel [class*=toggle]').first();
  const swText = await page.evaluate(() => {
    const el = document.querySelector(".analysis-toggle") || document.querySelector('.ai-analysis-panel [class*=toggle]');
    return el ? (el.textContent || "").trim().slice(0, 30) : "(无 toggle)";
  });
  dumpLog("分析开关文本: " + swText);
  if (await tg.isVisible().catch(() => false)) await safeClick(tg);
  else if (await tg2.isVisible().catch(() => false)) await safeClick(tg2);
  await settle(page, 900);

  // ② 选点数量 5
  await safeClick(page.locator('.ai-analysis-panel [aria-label="选点数量"]'));
  await settle(page, 500);
  await safeClick(page.getByRole("button", { name: /^5 个$/ }).first());
  await settle(page, 500);

  // ③ 等候选点长全（最久 35s）
  let n = 0;
  for (let i = 0; i < 30; i++) {
    n = await page.locator(".analysis-candidate-point").count();
    if (n >= 4) break;
    await settle(page, 1200);
  }
  dumpLog("候选点数=" + n);
  await settle(page, 2000);

  // ④ 重拍
  await shot(page, STILLS, "10-analysis.png");
  dumpLog("10-analysis 重拍");

  const dir = path.join(SEQ, "analysis");
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
    await settle(page, 1500);
  }
  dumpLog("seq/analysis 重拍 6 帧");

  // ⑤ 候选点展开棋盘预览
  const cand = page.locator(".analysis-candidate-point").first();
  if (await cand.isVisible().catch(() => false)) {
    await safeClick(cand); await settle(page, 1100);
    await shot(page, STILLS, "43-analysis-candidates.png");
    await page.keyboard.press("Escape").catch(() => {});
    await settle(page, 500);
  }

  // ⑥ 思考时长弹窗（42）
  const durBtn = page.locator('.ai-analysis-panel [aria-label*="思考时长"], .ai-analysis-panel [class*=think], .ai-analysis-panel button').filter({ hasText: /秒|时长/ }).first();
  if (await durBtn.isVisible().catch(() => false)) {
    await safeClick(durBtn); await settle(page, 500);
    await shot(page, STILLS, "42-thinking-time.png");
    await page.keyboard.press("Escape").catch(() => {});
    await settle(page, 400);
  } else {
    // 面板头部「持续▾」旁可能有时长；改为拍头部整体
    await shot(page, STILLS, "42-thinking-time.png");
  }

  // ⑦ 深度数值特写：等候选加深后拍一张局部放大（节点数/深度）
  await settle(page, 6000);
  await shot(page, STILLS, "47-depth-closeup.png");

} finally {
  const fails = log.filter(([s]) => s === "FAIL");
  console.log("===== 汇总 =====");
  console.log(`成功 ${log.filter(([s]) => s === "OK").length} / 失败 ${fails.length}`);
  log.filter(([s]) => s === "INFO").forEach(([, m]) => console.log("  INFO:", m));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}