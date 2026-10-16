import { launch, boot, settle, safeClick, waitAnimations, resolveDraftModal } from "./lib.mjs";
const { browser, context, page } = await launch();
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
  // 打开分析
  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
  await waitAnimations(page, ".ai-analysis-panel");
  await settle(page, 600);
  // 完整结构 dump：所有可交互元素（button/role）+ 面板 class 树
  const tree = await page.locator(".ai-analysis-panel").evaluate((el) => {
    const out = [];
    const walk = (node, depth) => {
      if (depth > 4) return;
      for (const c of node.children) {
        const tag = c.tagName.toLowerCase();
        const clickable = c.matches("button,[role=button],[role=option],[role=combobox],summary,[class*=toggle],[class*=switch]");
        if (clickable && c.offsetWidth > 0) {
          out.push("  ".repeat(depth) + tag + " | " + (c.getAttribute("aria-label") || "") + " | " + (c.textContent || "").trim().slice(0, 30));
        }
        walk(c, depth + 1);
      }
    };
    walk(el, 0);
    return out.join("\n");
  });
  console.log("=== 面板可交互元素 ===");
  console.log(tree);
  // 点「持续▾」看菜单
  const modeBtn = page.locator('.ai-analysis-panel button').filter({ hasText: /▾/ }).first();
  await safeClick(modeBtn);
  await settle(page, 600);
  const menu = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menu"] *, [role="listbox"] *, [class*=menu] *, [class*=dropdown] *')]
      .filter(el => el.offsetWidth > 0 && el.textContent.trim() && el.children.length === 0)
      .map(el => el.textContent.trim().slice(0, 30)).slice(0, 24));
  console.log("=== 模式菜单 ===");
  console.log(menu.join("\n"));
  await page.keyboard.press("Escape").catch(() => {});
  await settle(page, 400);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}
