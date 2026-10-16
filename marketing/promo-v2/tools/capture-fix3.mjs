/**
 * capture-fix3.mjs — 设置里开启「分析持续」→ 分析重拍
 * 依据：设置页显示"分析持续已关闭"，持续分析默认关导致面板不出候选。
 */
import { launch, boot, shot, settle, safeClick, waitAnimations, resolveDraftModal, dismissToast, STILLS, SEQ } from "./lib.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const log = [];
const { browser, context, page } = await launch();
const dumpLog = (m) => { log.push(["INFO", m]); console.log("  INFO:", m); };

const importSgf = async () => {
  await page.locator('input[type="file"][accept*=".sgf"]').first().setInputFiles({
    name: "花月开局-黑必胜研究.sgf", mimeType: "application/x-go-sgf",
    buffer: Buffer.from(`(;GM[1]FF[4]CA[UTF-8]AP[Banbu:1.1.8]SZ[15]GN[花月开局·黑必胜研究]RU[Renju]
;B[hh]C[黑1：天元起手。];W[ih]C[白2：斜指应对。];B[hi]C[黑3：花月形。];W[ii]C[白4：挡右侧。];B[ij]C[黑5：展开攻击。]CR[hj][gi]TR[ji]MA[jj])`, "utf8") });
  await settle(page, 900);
  await resolveDraftModal(page, "discard");
  await page.getByText("花月开局·黑必胜研究").first().waitFor({ timeout: 20000 }).catch(() => {});
  await settle(page, 900);
};
const navTo = async (n, times = 1) => {
  const moveBtn = (k) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: k });
  for (let i = 0; i < times; i++) { await safeClick(moveBtn(n)); await settle(page, 130); }
};
const gotoMove = async (n) => { await navTo("到第一手"); await navTo("下一手", n); await settle(page, 400); };

try {
  await boot(page);

  /* ① 设置 → 引擎区：打开「分析持续」 */
  await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
  await settle(page, 800);
  const sec = page.locator("details.settings-collapsible").filter({ hasText: /引擎|AI/ }).first();
  if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
  await settle(page, 600);
  // dump 引擎区控件
  const ctrls = await sec.evaluate((el) =>
    [...el.querySelectorAll("button,[role=switch],[data-state],label")].filter(b => b.offsetWidth > 0)
      .map(b => (b.getAttribute("aria-label") || "") + "|" + (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)).slice(0, 20));
  dumpLog("引擎区控件: " + JSON.stringify(ctrls));
  // 找含「持续」的控件并打开
  const cont = sec.locator('label, button, [role="switch"]').filter({ hasText: /分析持续|持续分析/ }).first();
  if (await cont.isVisible().catch(() => false)) {
    dumpLog("命中控件: " + (await cont.textContent()).trim().replace(/\s+/g, " ").slice(0, 50));
    // 如果是 switch：读状态再点
    const hasSwitch = await cont.locator('[role="switch"], [class*=switch]').count();
    dumpLog("switch 数量: " + hasSwitch);
    await safeClick(cont.locator('[role="switch"], [class*=switch]').first());
    await settle(page, 800);
    const after = await sec.evaluate((el) => el.textContent.includes("已关闭") ? "仍关闭" : "已开启");
    dumpLog("分析持续状态: " + after);
  } else dumpLog("未找到分析持续控件");

  /* ② 回打谱 → 开分析 → 等候选 */
  await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
  await settle(page, 600);
  await importSgf();
  await gotoMove(3);
  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
  await waitAnimations(page, ".ai-analysis-panel");
  await settle(page, 800);
  // 选点 → 5
  await safeClick(page.locator('.ai-analysis-panel [aria-label="选点数量"]'));
  await settle(page, 500);
  await safeClick(page.getByRole("button", { name: /^5 选$/ }).first());
  await settle(page, 600);
  // 等候选（最久 40s）
  let n = 0;
  for (let i = 0; i < 20; i++) {
    n = await page.locator(".analysis-candidate-point").count();
    if (n >= 3) break;
    await settle(page, 2000);
  }
  dumpLog("候选点数=" + n);
  await settle(page, 1500);
  await shot(page, STILLS, "10-analysis.png");

  // seq/analysis 重拍（帧间应有变化）
  const dir = path.join(SEQ, "analysis");
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
    await settle(page, 1500);
  }

  // 43 候选展开 + 42 思考时长 + 47 特写
  const cand = page.locator(".analysis-candidate-point").first();
  if (await cand.isVisible().catch(() => false)) {
    await safeClick(cand); await settle(page, 1100);
    await shot(page, STILLS, "43-analysis-candidates.png");
    await page.keyboard.press("Escape").catch(() => {});
    await settle(page, 400);
  }
  const durBtn = page.locator('.ai-analysis-panel button').filter({ hasText: /秒|时长/ }).first();
  if (await durBtn.isVisible().catch(() => false)) {
    await safeClick(durBtn); await settle(page, 500);
    await shot(page, STILLS, "42-thinking-time.png");
    await page.keyboard.press("Escape").catch(() => {});
    await settle(page, 400);
  } else await shot(page, STILLS, "42-thinking-time.png");
  await settle(page, 5000);
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