import { launch, boot, settle, safeClick, waitAnimations, resolveDraftModal } from "./lib.mjs";
const { browser, context, page } = await launch();
console.log("MODE:", process.env.BANBU_HEADED ? "HEADED" : "HEADLESS");
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
  await page.evaluate(() => {
    const cur = JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}");
    cur.analysisAuto = true;
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify(cur));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".renju-board").first().waitFor({ timeout: 25000 }).catch(() => {});
  await settle(page, 1000);
  await importSgf();
  const moveBtn = (k) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: k });
  await safeClick(moveBtn("到第一手"));
  for (let i = 0; i < 3; i++) { await safeClick(moveBtn("下一手")); await settle(page, 150); }
  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 20000 });
  await waitAnimations(page, ".ai-analysis-panel");
  await settle(page, 3000);
  const nodeTxt = async () => await page.locator(".ai-analysis-panel").evaluate((el) => {
    const m = el.textContent.match(/节点\s*([\d.]+[万Kk]?)/);
    return m ? m[1] : (el.textContent.includes("节点-") ? "-" : "?");
  });
  for (let i = 0; i < 6; i++) {
    console.log(`t+${(i + 1) * 3}s 候选=${await page.locator(".analysis-candidate-point").count()} 节点=${await nodeTxt()}`);
    await settle(page, 3000);
  }
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}
