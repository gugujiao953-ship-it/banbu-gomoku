/**
 * capture-fix4.mjs — 最终：强制打开「分析持续」(analysisAuto) 后重拍分析素材
 * 原因链：enhancement-settings.ts 里 analysisAuto 默认 false →
 *         点「分析」只展开面板不自动分析 → 候选点 0。
 * 手段：先 UI 点「分析持续已关闭」，失败则直接写 localStorage 后 reload。
 */
import { launch, boot, shot, settle, waitAnimations, safeClick, resolveDraftModal, dismissToast, STILLS, SEQ } from "./lib.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const KEY = "banbu-enhancement-settings-v1";
const { browser, context, page } = await launch();
const log = [];
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
const gotoMove = async (n) => {
  const moveBtn = (k) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: k });
  await safeClick(moveBtn("到第一手"));
  for (let i = 0; i < n; i++) { await safeClick(moveBtn("下一手")); await settle(page, 130); }
  await settle(page, 400);
};

try {
  await boot(page);

  /* ① 开「分析持续」 */
  await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
  await settle(page, 800);
  const sec = page.locator("details.settings-collapsible").filter({ hasText: /引擎|AI/ }).first();
  if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
  await settle(page, 600);
  const row = sec.locator('summary, label, [class*=row]').filter({ hasText: /分析持续/ }).first();
  if (await row.isVisible().catch(() => false)) {
    dumpLog("命中行: " + (await row.textContent()).trim().replace(/\s+/g, " ").slice(0, 40));
    await safeClick(row);
    await settle(page, 900);
    dumpLog("点击后: " + (await sec.textContent()).includes("分析持续已关闭") ? "仍关闭" : "已开启?");
  } else dumpLog("未命中 UI 行 → 走 localStorage");

  // 强制写 localStorage（双保险）
  await page.evaluate((k) => {
    try {
      const cur = JSON.parse(localStorage.getItem(k) || "{}");
      cur.analysisAuto = true;
      cur.analysisHintMode = false;
      cur.analysisSelfPlay = false;
      localStorage.setItem(k, JSON.stringify(cur));
    } catch {}
  }, KEY);
  dumpLog("localStorage analysisAuto=true 已写入");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".renju-board").first().waitFor({ timeout: 25000 }).catch(() => {});
  await settle(page, 1200);
  // 确认持久设置
  const chk = await page.evaluate((k) => {
    try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; }
  }, KEY);
  dumpLog("设置确认: " + JSON.stringify({ auto: chk.analysisAuto, hint: chk.analysisHintMode }));

  /* ② 打谱 → 分析 */
  await importSgf();
  await gotoMove(3);
  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 20000 });
  await waitAnimations(page, ".ai-analysis-panel");
  await settle(page, 1000);
  await safeClick(page.locator('.ai-analysis-panel [aria-label="选点数量"]'));
  await settle(page, 500);
  await safeClick(page.getByRole("button", { name: /^5 选$/ }).first());
  await settle(page, 600);

  let n = 0;
  for (let i = 0; i < 20; i++) {
    n = await page.locator(".analysis-candidate-point").count();
    const nodeTxt = await page.locator(".ai-analysis-panel").evaluate((el) => {
      const m = el.textContent.match(/节点\s*([\d.]+[万Kk]?)/);
      return m ? m[1] : (el.textContent.includes("节点-") ? "-" : "?");
    });
    if (i % 2 === 0) dumpLog(`候选=${n} 节点=${nodeTxt}`);
    if (n >= 3) break;
    await settle(page, 2500);
  }
  dumpLog("最终候选点数=" + n);
  await settle(page, 1600);
  await shot(page, STILLS, "10-analysis.png");

  const dir = path.join(SEQ, "analysis");
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
    await settle(page, 1600);
  }
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
  console.log("===== 汇总 =====");
  log.forEach(([, m]) => console.log("  INFO:", m));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}