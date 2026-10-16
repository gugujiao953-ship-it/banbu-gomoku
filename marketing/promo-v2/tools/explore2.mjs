import { launch, boot, settle, safeClick, waitAnimations, resolveDraftModal } from "./lib.mjs";
const { browser, context, page } = await launch();
const errs = [];
page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
page.on("pageerror", e => errs.push("PAGEERR: " + String(e).slice(0, 200)));
const importSgf = async () => {
  await page.locator('input[type="file"][accept*=".sgf"]').first().setInputFiles({
    name: "t.sgf", mimeType: "application/x-go-sgf",
    buffer: Buffer.from(`(;GM[1]FF[4]CA[UTF-8]AP[Banbu:1.1.8]SZ[15]GN[研究局]RU[Renju];B[hh];W[ih];B[hi];W[ii];B[ij])`, "utf8") });
  await settle(page, 900);
  await resolveDraftModal(page, "discard");
  await page.getByText("研究局").first().waitFor({ timeout: 20000 }).catch(() => {});
  await settle(page, 900);
};
try {
  await boot(page);
  await importSgf();
  const moveBtn = (k) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: k });
  await safeClick(moveBtn("到第一手")); await settle(page, 200);
  for (let i = 0; i < 3; i++) { await safeClick(moveBtn("下一手")); await settle(page, 200); }
  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
  await waitAnimations(page, ".ai-analysis-panel");
  await settle(page, 500);
  // 尝试点一下面板内任意"开始/继续"，或直接等 55s
  const startBtn = page.locator('.ai-analysis-panel button').filter({ hasText: /开始|继续|分析/ }).first();
  const sbVisible = await startBtn.isVisible().catch(() => false);
  console.log("START_BTN_VISIBLE:", sbVisible, sbVisible ? await startBtn.textContent() : "");
  if (sbVisible) await safeClick(startBtn);
  for (let i = 0; i < 11; i++) {
    await settle(page, 5000);
    const n = await page.locator(".analysis-candidate-point").count();
    const node = await page.locator(".ai-analysis-panel").evaluate((el) => {
      const m = el.textContent.match(/节点\s*([\d.]+[万Kk]?)/);
      return m ? m[1] : (el.textContent.includes("节点-") ? "-" : "?");
    });
    console.log(`t+${(i + 1) * 5}s 候选=${n} 节点=${node}`);
    if (n > 0) break;
  }
  console.log("ERRORS:", errs.length ? errs.join("\n") : "(无)");
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}
