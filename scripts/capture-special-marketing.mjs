import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const output = path.resolve("marketing/v1.1.4/special/screenshots");
await mkdir(output, { recursive: true });

const sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[15]GN[分支研究示例]PB[黑方]PW[白方]EV[变化树与书签演示]
;B[hh]C[天元起手]
;W[ih]C[形成关键分叉点]
(;B[hi]C[主线：向下发展];W[ii];B[hj]C[主线判断点])
(;B[gh]C[变化一：向左拓展];W[gi];B[fi])
(;B[hg]C[变化二：向上压迫];W[ig];B[jg])
(;B[gg]C[变化三：斜线构形];W[ji];B[fg]))`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: "reduce",
  serviceWorkers: "block",
});
const page = await context.newPage();

const dismissToast = async () => {
  const close = page.locator(".app-toast-close");
  if (await close.isVisible().catch(() => false)) await close.click();
};

const screenshot = async (name) => {
  await dismissToast();
  await page.screenshot({ path: path.join(output, name), fullPage: false });
};

const openMoves = async () => {
  // 走棋导航现已常驻在棋盘下方（.moves-row），无需再展开 dock 面板。
  await page.getByRole("button", { name: "到最后一手" }).waitFor();
};

const openBranches = async () => {
  await page.locator(".dock-tabs").getByRole("button", { name: "打开分支树" }).click();
  await page.getByRole("dialog", { name: "变化分支" }).waitFor();
};

const renameLatestBookmark = async (name) => {
  const row = page.locator(".branch-bookmark-row").last();
  await row.getByRole("button", { name: "重命名" }).click();
  await row.locator("input").fill(name);
  await row.getByRole("button", { name: "确认重命名" }).click();
};

const chooseVisualStyle = async (boardName, stoneName) => {
  await page.getByRole("button", { name: "设置" }).click();
  const section = page.locator("details.settings-collapsible").filter({ hasText: "棋盘与棋子" });
  if (!(await section.getAttribute("open"))) await section.locator("summary").click();
  await section.getByRole("button").filter({ hasText: boardName }).click();
  await section.getByRole("button").filter({ hasText: stoneName }).click();
  await page.getByRole("button", { name: "打谱" }).click();
  await page.locator(".renju-board").waitFor();
};

try {
  await page.goto(`${baseUrl}?special-marketing=${Date.now()}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    localStorage.clear();
    if (!indexedDB.databases) return;
    const databases = await indexedDB.databases();
    await Promise.all(databases.map((database) => database.name ? new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(database.name);
      request.onsuccess = request.onerror = request.onblocked = resolve;
    }) : Promise.resolve()));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 20_000 });

  // 导入一份真实的多分支 SGF，作为后续棋谱树和书签素材。
  await page.locator('input[type="file"][accept="*/*"]').setInputFiles({
    name: "分支研究示例.sgf",
    mimeType: "application/x-go-sgf",
    buffer: Buffer.from(sgf, "utf8"),
  });
  await page.getByText("分支研究示例", { exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(700);

  // 格式兼容入口：明确展示 LIB / DB / JSON。
  await page.getByRole("button", { name: "设置" }).click();
  const dataSection = page.locator("details.settings-collapsible").filter({ hasText: "数据与兼容" });
  await dataSection.locator("summary").click();
  await dataSection.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 145)));
  await screenshot("01-format-support.png");

  // 回到关键分叉点（第 2 手），创建两个分支书签。
  await page.getByRole("button", { name: "打谱" }).click();
  await openMoves();
  await page.locator(".dock-panel").getByRole("button", { name: "到第一手" }).click();
  await page.locator(".dock-panel").getByRole("button", { name: "下一手" }).click();
  await page.locator(".dock-panel").getByRole("button", { name: "下一手" }).click();
  await openBranches();
  await page.getByRole("button", { name: "保存当前局面为书签" }).click();
  await renameLatestBookmark("关键分叉点");
  await page.locator(".branch-list button").first().click();
  await openBranches();
  await page.getByRole("button", { name: "保存当前局面为书签" }).click();
  await renameLatestBookmark("主线判断点");
  await screenshot("02-branch-bookmarks.png");
  await page.getByRole("dialog", { name: "变化分支" }).getByRole("button", { name: "关闭", exact: true }).click();

  // 棋谱树形图：展示当前路径、兄弟分支与缩放控件。
  await openMoves();
  await page.locator(".dock-panel").getByRole("button", { name: "打开棋谱树" }).click();
  await page.getByRole("dialog", { name: "棋谱树" }).waitFor();
  await screenshot("03-record-tree.png");
  await page.getByRole("dialog", { name: "棋谱树" }).getByRole("button", { name: "关闭", exact: true }).click();

  // 三套真实棋盘与棋子组合。
  await chooseVisualStyle("青花瓷棋盘", "青花瓷棋子");
  await screenshot("04-theme-porcelain.png");
  await chooseVisualStyle("电路棋盘", "终端字符棋子");
  await screenshot("05-theme-circuit.png");
  await chooseVisualStyle("白玉棋盘", "黑钻白金棋子");
  await screenshot("06-theme-whitejade.png");

  // 主题选择器本身，展示可选材质范围。
  await page.getByRole("button", { name: "设置" }).click();
  const visualSection = page.locator("details.settings-collapsible").filter({ hasText: "棋盘与棋子" });
  if (!(await visualSection.getAttribute("open"))) await visualSection.locator("summary").click();
  await visualSection.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 145)));
  await screenshot("07-theme-selector.png");

  console.log(JSON.stringify({ ok: true, output, files: 7 }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
