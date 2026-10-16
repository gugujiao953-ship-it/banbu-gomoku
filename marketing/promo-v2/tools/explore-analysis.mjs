/**
 * explore-analysis.mjs — 查明分析候选点为何不出：dump 面板状态 + 等待观察
 */
import { launch, boot, settle, safeClick, waitAnimations, resolveDraftModal } from "./lib.mjs";

const { browser, context, page } = await launch();
const importSgf = async () => {
  await page.locator('input[type="file"][accept*=".sgf"]').first()
    .setInputFiles({ name: "t.sgf", mimeType: "application/x-go-sgf",
      buffer: Buffer.from(`(;GM[1]FF[4]CA[UTF-8]AP[Banbu:1.1.8]SZ[15]GN[研究局]RU[Renju]
;B[hh];W[ih];B[hi];W[ii];B[ij])`, "utf8") });
  await settle(page, 900);
  await resolveDraftModal(page, "discard");
  await page.getByText("研究局").first().waitFor({ timeout: 20000 }).catch(() => {});
  await settle(page, 900);
};

try {
  await boot(page);
  await importSgf();
  // 走 3 手
  const moveBtn = (k) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: k });
  await safeClick(moveBtn("到第一手")); await settle(page, 200);
  for (let i = 0; i < 3; i++) { await safeClick(moveBtn("下一手")); await settle(page, 200); }

  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
  await waitAnimations(page, ".ai-analysis-panel");
  await settle(page, 800);

  // 面板头部 dump
  const head = await page.locator(".ai-analysis-panel").evaluate((el) => el.textContent.trim().slice(0, 300));
  console.log("PANEL TEXT:", head);

  // 候选容器 dump
  const candBox = await page.locator(".ai-analysis-panel").evaluate((el) => {
    const q = el.querySelector(".analysis-candidates, [class*=candidate]");
    return q ? q.className + " :: " + q.textContent.trim().slice(0, 200) : "(无候选容器)";
  });
  console.log("CAND BOX:", candBox);

  // 面板 aria & 区域标记
  const areas = await page.locator(".ai-analysis-panel").evaluate((el) =>
    [...el.querySelectorAll("[aria-label]")].map(a => a.getAttribute("aria-label")).slice(0, 12).join(" | "));
  console.log("ARIA:", areas);

  // 引擎状态（设置 → 引擎区）
  const eng = await page.locator(".ai-analysis-panel").locator('[class*=engine], [class*=model]').first().evaluate((el) =>
    el.textContent.trim().slice(0, 80)).catch(() => "(无引擎控件)");
  console.log("ENGINE:", eng);

  // 等 15s，每 3s 采一次候选数 + 面板文本变化
  const txts = [];
  for (let i = 0; i < 5; i++) {
    await settle(page, 3000);
    const n = await page.locator(".analysis-candidate-point").count();
    const t = await page.locator(".ai-analysis-panel").evaluate((el) => el.textContent.trim().replace(/\s+/g, " ").slice(0, 160));
    txts.push(`t+${(i + 1) * 3}s 候选=${n} | ${t}`);
  }
  console.log(txts.join("\n"));

  // 看红点/错误提示
  const toasts = await page.evaluate(() => document.body.textContent.match(/下载|失败|错误|引擎|网络|离线/g)?.slice(0, 8) || []);
  console.log("KEYWORDS:", toasts.join(", "));

} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}