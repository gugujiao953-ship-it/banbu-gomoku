/**
 * v3 全量重拍：按当前工作区（先生最新改动）重新采集所有宣传素材。
 * 用法：BANBU_URL=http://127.0.0.1:5193/ node capture-v3.mjs
 */
import { launch, boot, shot, settle, safeClick, resolveDraftModal, dismissToast,
         waitAnimations, clickPoint, switchMode, STILLS, SEQ } from "./lib.mjs";
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
    await shot(page, STILLS, `_fail3-${name}.png`).catch(() => {});
  }
  await dismissToast(page);
  await settle(page, 170);
};

const moveBtn = n => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: n });
const navTo = async (n, times = 1) => { for (let i = 0; i < times; i++) { await safeClick(moveBtn(n)); await settle(page, 130); } };
const playMoves = async (moves, gap = 110) => {
  for (const pt of moves) { await clickPoint(page, pt); await settle(page, gap); }
};

const SGF = `(;GM[1]FF[4]CA[UTF-8]AP[Banbu:1.1.8]SZ[15]
GN[花月开局·黑必胜研究]PB[黑方]PW[白方]EV[第九轮研究局]DT[2026-09-10]RU[Renju]
;B[hh]C[黑1：天元起手，直指中心。]
;W[ih]C[白2：斜指应对，最常见的防守方向。]
;B[hi]C[黑3：形成花月形。黑方由此掌握先手节奏。]
;W[ii]C[白4：挡在右侧，目前胜率最高的应手。]
;B[ij]C[黑5：黑方展开攻击。]CR[hj][gi]TR[ji]MA[jj]
(;W[hj]C[变化一：白6 正面反击，局面转入激战。])
(;W[gi]C[变化二：白6 稳健防守，黑方转入持久战。])
(;W[ji]C[变化三：白6 侧翼侵消，考验黑方的判断。])
)`;

const importSgf = async () => {
  await page.locator('input[type="file"][accept*=".sgf"]').first()
    .setInputFiles({ name: "花月开局-黑必胜研究.sgf", mimeType: "application/x-go-sgf", buffer: Buffer.from(SGF, "utf8") });
  await settle(page, 800);
  await resolveDraftModal(page, "discard");
  await page.getByText("花月开局·黑必胜研究").first().waitFor({ timeout: 20000 });
  await settle(page, 850);
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

const setTheme = async (pref, board, stone) => {
  await page.evaluate(({ pref, board, stone }) => {
    localStorage.setItem("banbu-theme-preference-v1", pref);
    localStorage.setItem("banbu-board-theme-v1", board);
    localStorage.setItem("banbu-stone-theme-v1", stone);
  }, { pref, board, stone });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".renju-board").first().waitFor({ timeout: 25000 });
  await settle(page, 1000);
};

const center = async loc => {
  const b = await loc.first().boundingBox();
  return b ? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } : null;
};

const MOVES = ["H8","I8","H9","I9","G8","J8","G9","J9","F8","K8","F9","E9"];
const coords = {};

try {
  await boot(page);

  /* ---------- 1. 首页 / 落子序列 / 打谱 ---------- */
  await step("01-home", () => shot(page, STILLS, "01-home.png"));

  await step("seq-play", async () => {
    const dir = path.join(SEQ, "play");
    await mkdir(dir, { recursive: true });
    await safeClick(page.locator(".record-command-bar").getByRole("button", { name: "无禁" }));
    await settle(page, 500);
    await page.screenshot({ path: path.join(dir, "00.png") });
    for (let i = 0; i < MOVES.length; i++) {
      await playMoves([MOVES[i]]);
      await page.screenshot({ path: path.join(dir, String(i + 1).padStart(2, "0") + ".png") });
    }
    await settle(page, 400);
    await shot(page, STILLS, "02-board-played.png");
  });

  /* ---------- 2. 本地分析（干净局面：刚落的 12 子，无任何标注） ---------- */
  await step("10-analysis", async () => {
    const marks = await page.evaluate(() => document.querySelectorAll(".board-mark").length);
    log.push(["INFO", `分析前棋盘标注数 = ${marks}（应为 0）`]);
    await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
    await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
    await waitAnimations(page, ".ai-analysis-panel");
    await safeClick(page.locator(".analysis-toggle"));
    await settle(page, 700);
    await safeClick(page.locator('.ai-analysis-panel [aria-label="选点数量"]'));
    await settle(page, 550);
    const opt = page.getByRole("option", { name: /^5 个$/ });
    if (await opt.count()) await opt.first().click({ timeout: 5000 });
    await settle(page, 700);
    await page.locator(".analysis-candidate-point").first().waitFor({ timeout: 30000 }).catch(() => {});
    await settle(page, 2500);
    log.push(["INFO", "候选点数 = " + await page.evaluate(() => document.querySelectorAll(".analysis-candidate-point").length)]);
    log.push(["INFO", "残留标注 = " + await page.evaluate(() => document.querySelectorAll(".board-mark").length)]);
    await shot(page, STILLS, "10-analysis.png");
  });

  await step("seq-analysis", async () => {
    const dir = path.join(SEQ, "analysis");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
      await settle(page, 700);
    }
  });

  /* ---------- 3. 导入方式 + 格式设置 ---------- */
  await step("06-import-sheet", async () => {
    await openImportSheet();
    await waitAnimations(page, ".bottom-sheet");
    await shot(page, STILLS, "06-import-sheet.png");
  });

  await step("07-format-settings", async () => {
    await safeClick(page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "关闭" }));
    await settle(page, 400);
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
    await settle(page, 750);
    const sec = page.locator("details.settings-collapsible").filter({ hasText: "数据与兼容" }).first();
    if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
    await settle(page, 450);
    await sec.evaluate(el => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 110)));
    await settle(page, 400);
    await shot(page, STILLS, "07-format-settings.png");
  });

  /* ---------- 4. 内置棋谱：九天指南 ---------- */
  await step("40-library", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "棋谱库" }));
    await settle(page, 1700);
    await shot(page, STILLS, "40-library.png");
  });

  await step("41-jiutian", async () => {
    await safeClick(page.getByText("九天指南", { exact: false }).first());
    await settle(page, 5000);
    await shot(page, STILLS, "41-jiutian-cover.png");
    const dir = path.join(SEQ, "jiutian");
    await mkdir(dir, { recursive: true });
    const info = [];
    for (let i = 0; i < 10; i++) {
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
      info.push(`${i}: 棋盘文字=${await page.evaluate(() => document.querySelectorAll(".renju-board text").length)}`);
      await safeClick(moveBtn("下一手")); await settle(page, 520);
    }
    log.push(["INFO", "九天指南序列 " + info.join(" / ")]);
  });

  /* ---------- 5. 人机对战 ---------- */
  await step("12-ai-setup", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
    await settle(page, 700);
    await page.locator("nav.bottom-nav").getByRole("button", { name: "AI" }).click({ timeout: 9000 });
    await page.getByRole("dialog", { name: /AI 人机对战|人机对战/ }).waitFor({ timeout: 15000 });
    await waitAnimations(page, ".bottom-sheet");
    await settle(page, 450);
    await shot(page, STILLS, "12-ai-setup.png");
  });

  await step("13-ai-playing", async () => {
    await page.getByRole("button", { name: /开始人机对战|按新规则重新开始/ }).first().click({ timeout: 9000 });
    await settle(page, 1200);
    await resolveDraftModal(page, "discard");
    await settle(page, 800);
    for (const pt of ["H8", "I8", "H9"]) { await clickPoint(page, pt); await settle(page, 3400); }
    await settle(page, 1400);
    await shot(page, STILLS, "13-ai-playing.png");
  });

  /* ---------- 6. VCF / 做题 ---------- */
  await step("27-vcf", async () => {
    await switchMode(page, "做题");
    await page.locator(".action-bottom-row").waitFor({ timeout: 15000 });
    await settle(page, 2200);
    await shot(page, STILLS, "25-puzzle.png");
    const vcf = page.locator(".action-bottom-row").getByRole("button", { name: /VCF/ }).first();
    if (await vcf.isVisible().catch(() => false)) {
      await vcf.click({ timeout: 8000 });
      await settle(page, 1300);
      await shot(page, STILLS, "27-vcf-generator.png");
    }
  });

  /* ---------- 7. 图片识谱 ---------- */
  await step("21-image", async () => {
    await switchMode(page, "打谱");
    await settle(page, 600);
    await playMoves(MOVES, 90);
    await settle(page, 600);
    const png = await page.locator(".renju-board").screenshot({ type: "png" });
    await writeFile(path.join(STILLS, "21-board-source.png"), png);
    await openImportSheet();
    await shot(page, STILLS, "21a-image-import-entry.png");
    await page.locator('input[type="file"][accept*="image"]').first()
      .setInputFiles({ name: "棋盘照片.png", mimeType: "image/png", buffer: png });
    await settle(page, 1100);
    await shot(page, STILLS, "21b-image-recognizing.png");
    await settle(page, 5500);
    await shot(page, STILLS, "21c-image-recognized.png");
  });

  /* ---------- 8. 分支树 + 书签（真实点击序列，记录坐标） ---------- */
  await step("31-tree", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
    await settle(page, 700);
    await importSgf();
    await navTo("到第一手"); await navTo("下一手", 5);
    await settle(page, 450);
    await safeClick(page.getByRole("button", { name: "打开分支树" }));
    await page.getByRole("dialog", { name: "分支树" }).waitFor({ timeout: 15000 });
    await waitAnimations(page, ".bottom-sheet");
    await settle(page, 700);
    await page.screenshot({ path: path.join(STILLS, "31-tree-a.png") });

    const addBtn = page.getByRole("button", { name: /^加书签$/ }).first();
    coords.addBookmark = await center(addBtn);
    if (!(await addBtn.isVisible().catch(() => false))) throw new Error("无「加书签」");
    await addBtn.click({ timeout: 6000 });
    await settle(page, 1300); await dismissToast(page);
    await page.screenshot({ path: path.join(STILLS, "31-tree-b.png") });

    const dlg = page.getByRole("dialog", { name: "分支树" });
    const tab = dlg.locator('[role="tab"]').filter({ hasText: "书签" }).first();
    coords.bookmarkTabTree = await center(tab);
    await tab.click({ timeout: 6000 });
    await settle(page, 1500); await dismissToast(page);
    coords.bookmarkTabPage = await center(tab);
    await page.screenshot({ path: path.join(STILLS, "31-tree-c.png") });
    await settle(page, 800);
    await page.screenshot({ path: path.join(STILLS, "31-tree-d.png") });
    log.push(["INFO", "坐标 " + JSON.stringify(coords)]);
  });

  /* ---------- 9. 快捷中心 ---------- */
  await step("30-quick-drawer", async () => {
    await safeClick(page.getByRole("dialog", { name: "分支树" }).getByRole("button", { name: "关闭" }));
    await settle(page, 500);
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
    await settle(page, 700);
    await safeClick(page.locator('button[aria-label="打开快捷中心"]'));
    await settle(page, 1100);
    await shot(page, STILLS, "30-quick-drawer.png");
  });

  /* ---------- 10. 主题序列（放最后，因为要 reload） ---------- */
  const THEMES = [
    ["14-theme-blackgold", "blackgold", "blackgold", "blackgold"],
    ["15-theme-porcelain", "porcelain", "porcelain", "porcelain"],
    ["16-theme-cyber", "cyber", "circuit", "terminal"],
    ["17-theme-aurora", "aurora", "aurora", "aurora"],
    ["18-theme-whitejade", "dark", "whitejade", "gold-diamond"],
    ["19-theme-classic", "light", "wood", "yun"],
  ];
  await step("seq-theme", async () => {
    const dir = path.join(SEQ, "theme");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < THEMES.length; i++) {
      const [name, pref, board, stone] = THEMES[i];
      await setTheme(pref, board, stone);
      await playMoves(MOVES, 60);
      await settle(page, 900);
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
      await shot(page, STILLS, `${name}.png`);
    }
  });

  await writeFile(path.join(SEQ, "coords-v3.json"), JSON.stringify(coords, null, 2), "utf8");

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
