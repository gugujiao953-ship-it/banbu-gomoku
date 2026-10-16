/**
 * 半步五子棋 v1.1.8 宣传素材 · 最终拍摄
 * 源：5195（洁净 worktree，vite dev）
 *
 * 已按真实结构校正：
 *  - 分支树弹窗真实 aria-label = "分支树"（不是"变化分支"）
 *  - 分析需点 .analysis-toggle 开启（否则指标全 "-"、无候选点）
 *  - 「导入/新建」会弹「未保存草稿」确认框，必须显式处理
 *  - 步骤清理只关 toast，不再盲按 Esc（会误关后续要用的弹层）
 */
import { launch, boot, shot, settle, switchMode, clickPoint, waitAnimations, safeClick, resolveDraftModal, dismissToast, STILLS, SEQ, BASE } from "./lib.mjs";
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

const moveBtn = (n) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: n });
const navTo = async (n, times = 1) => { for (let i = 0; i < times; i++) { await safeClick(moveBtn(n)); await settle(page, 130); } };
const playMoves = async (moves, gap = 110) => {
  for (const pt of moves) {
    await page.evaluate((p) => {
      const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(p));
      if (c) c.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }, pt);
    await settle(page, gap);
  }
};

const SGF = `(;GM[1]FF[4]CA[UTF-8]AP[Banbu:1.1.8]SZ[15]
GN[花月开局·黑必胜研究]PB[黑方]PW[白方]EV[第九轮研究局]DT[2026-09-10]RU[Renju]
;B[hh]C[黑1：天元起手，直指中心。]
;W[ih]C[白2：斜指应对，最常见的防守方向。]
;B[hi]C[黑3：形成花月形。黑方由此掌握先手节奏。]
;W[ii]C[白4：挡在右侧，目前胜率最高的应手。]
;B[ij]C[黑5：黑方展开攻击。圆圈与三角给出候选点，叉号是需要提防的反击点。]CR[hj][gi]TR[ji]MA[jj]
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
  await settle(page, 900);
};

const gotoMove = async (n) => { await navTo("到第一手"); await navTo("下一手", n); await settle(page, 400); };

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
  await settle(page, 1100);
};

try {
  await boot(page);

  /* ============ A. 打谱（无禁手，画面干净） ============ */
  await step("01-home", () => shot(page, STILLS, "01-home.png"));

  const MOVES = ["H8", "I8", "H9", "I9", "G8", "J8", "G9", "J9", "F8", "K8", "F9", "E9"];
  await step("seq-play", async () => {
    const dir = path.join(SEQ, "play");
    await mkdir(dir, { recursive: true });
    // 切到无禁手：画面更干净
    await safeClick(page.locator(".record-command-bar").getByRole("button", { name: "无禁" }));
    await settle(page, 500);
    await page.screenshot({ path: path.join(dir, "00.png") });
    for (let i = 0; i < MOVES.length; i++) {
      await playMoves([MOVES[i]]);
      await page.screenshot({ path: path.join(dir, String(i + 1).padStart(2, "0") + ".png") });
    }
  });

  await step("02-board-played", async () => { await settle(page, 400); await shot(page, STILLS, "02-board-played.png"); });

  await step("03-forbidden", async () => {
    await safeClick(page.locator(".record-command-bar").getByRole("button", { name: "有禁" }));
    await settle(page, 900);
    await shot(page, STILLS, "03-forbidden.png");
    await safeClick(page.locator(".record-command-bar").getByRole("button", { name: "无禁" }));
    await settle(page, 500);
  });

  await step("04-annotation", async () => {
    await page.locator(".action-bottom-row").getByRole("button", { name: "标注" }).first().click({ timeout: 6000 });
    await page.locator('.mark-studio[aria-label="当前局面标注工具"]').waitFor({ timeout: 12000 });
    await waitAnimations(page, ".mark-studio");
    await shot(page, STILLS, "04a-annotation-studio.png");
    const pickStyle = async (label) => {
      await page.locator(".mark-studio-box").filter({ hasText: "样式" }).first().click();
      await page.locator(".mark-studio-options.styles button").filter({ hasText: label }).first().click();
      await settle(page, 220);
    };
    const put = async (label, pts) => { await pickStyle(label); for (const p of pts) { await clickPoint(page, p); await settle(page, 130); } };
    await put("圆圈", ["K6", "K7"]);
    await put("三角", ["L6"]);
    await put("叉号", ["L7"]);
    await settle(page, 400);
    await shot(page, STILLS, "04b-annotation.png");
    await safeClick(page.locator(".action-bottom-row").getByRole("button", { name: "标注" }));
    await settle(page, 350);
  });

  /* ============ B. 导入方式 + 格式支持 ============ */
  await step("06-import-sheet", async () => {
    await openImportSheet();
    await waitAnimations(page, ".bottom-sheet");
    await shot(page, STILLS, "06-import-sheet.png");
  });

  await step("07-format-settings", async () => {
    await safeClick(page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "关闭" }));
    await settle(page, 400);
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
    await settle(page, 700);
    const sec = page.locator("details.settings-collapsible").filter({ hasText: "数据与兼容" }).first();
    if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
    await settle(page, 450);
    await sec.evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 120)));
    await settle(page, 400);
    await shot(page, STILLS, "07-format-settings.png");
  });

  /* ============ C. 导入的棋谱：运行 + 标注 ============ */
  await step("08-imported-record", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
    await settle(page, 600);
    await importSgf();
    await gotoMove(3);
    await shot(page, STILLS, "08-imported-record.png");
  });

  await step("09-imported-annotation", async () => {
    await gotoMove(5);
    await settle(page, 500);
    await shot(page, STILLS, "09-imported-annotation.png");
  });

  /* ============ D. 本地分析 ============ */
  await step("10-analysis", async () => {
    await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
    await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
    await waitAnimations(page, ".ai-analysis-panel");
    // 打开分析开关
    await safeClick(page.locator(".analysis-toggle"));
    await settle(page, 700);
    // 选点数量 -> 5 个
    await safeClick(page.locator('.ai-analysis-panel [aria-label="选点数量"]'));
    await settle(page, 500);
    await safeClick(page.getByRole("button", { name: /^5 个$/ }).first());
    await settle(page, 500);
    log.push(["INFO", "分析开关=" + await page.evaluate(() => document.querySelector(".analysis-toggle span")?.textContent)]);
    await page.locator(".analysis-candidate-point").first().waitFor({ timeout: 25000 }).catch(() => {});
    await settle(page, 1500);
    log.push(["INFO", "候选点数=" + await page.evaluate(() => document.querySelectorAll(".analysis-candidate-point").length)]);
    await shot(page, STILLS, "10-analysis.png");
  });

  await step("seq-analysis", async () => {
    const dir = path.join(SEQ, "analysis");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
      await settle(page, 800);
    }
  });

  /* ============ E. 人机对战 ============ */
  await step("12-ai-setup", async () => {
    await page.locator("nav.bottom-nav").getByRole("button", { name: "AI" }).click({ timeout: 9000 });
    await page.getByRole("dialog", { name: "AI 人机对战" }).waitFor({ timeout: 15000 });
    await waitAnimations(page, ".bottom-sheet");
    await settle(page, 400);
    await shot(page, STILLS, "12-ai-setup.png");
  });

  await step("13-ai-playing", async () => {
    await page.getByRole("button", { name: /开始人机对战|按新规则重新开始/ }).first().click({ timeout: 9000 });
    await settle(page, 1200);
    await resolveDraftModal(page, "discard");
    await settle(page, 800);
    for (const pt of ["H8", "I8", "H9"]) { await clickPoint(page, pt); await settle(page, 3500); }
    await settle(page, 1500);
    await shot(page, STILLS, "13-ai-playing.png");
  });

  /* ============ F. 主题 ============ */
  const THEMES = [
    ["14-theme-blackgold", "blackgold", "blackgold", "blackgold"],
    ["15-theme-porcelain", "porcelain", "porcelain", "porcelain"],
    ["16-theme-cyber", "cyber", "circuit", "terminal"],
    ["17-theme-aurora", "aurora", "aurora", "aurora"],
    ["18-theme-whitejade", "dark", "whitejade", "gold-diamond"],
    ["19-theme-classic", "light", "wood", "yun"],
  ];
  for (const [name, pref, board, stone] of THEMES) {
    await step(name, async () => { await setTheme(pref, board, stone); await shot(page, STILLS, `${name}.png`); });
  }

  await step("seq-theme", async () => {
    const dir = path.join(SEQ, "theme");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < THEMES.length; i++) {
      await setTheme(THEMES[i][1], THEMES[i][2], THEMES[i][3]);
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
    }
  });

  await step("20-theme-selector", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "设置" }));
    await settle(page, 700);
    const sec = page.locator("details.settings-collapsible").filter({ hasText: "棋盘与棋子" }).first();
    if (!(await sec.getAttribute("open"))) await sec.locator("summary").first().click();
    await settle(page, 450);
    await sec.evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 110)));
    await settle(page, 400);
    await shot(page, STILLS, "20a-board-theme-list.png");
    await sec.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + 470));
    await settle(page, 400);
    await shot(page, STILLS, "20b-stone-theme-list.png");
  });

  /* ============ G. 图片识谱 ============ */
  await step("21-image-import", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
    await settle(page, 600);
    const png = await page.locator(".renju-board").screenshot({ type: "png" });
    await writeFile(path.join(STILLS, "21-board-source.png"), png);
    await openImportSheet();
    await shot(page, STILLS, "21a-image-import-entry.png");
    await page.locator('input[type="file"][accept*="image"]').first()
      .setInputFiles({ name: "棋盘照片.png", mimeType: "image/png", buffer: png });
    await settle(page, 1100);
    await shot(page, STILLS, "21b-image-recognizing.png");
    await settle(page, 5200);
    await shot(page, STILLS, "21c-image-recognized.png");
  });

  /* ============ H. 分支树 / 书签 / 棋谱树 ============ */
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
    // 切到「书签」tab
    const tab = page.getByRole("dialog", { name: "分支树" }).getByRole("button", { name: /书签/ }).first();
    await safeClick(tab);
    await settle(page, 600);
    await shot(page, STILLS, "23a-bookmark-tab.png");
    const save = page.getByRole("button", { name: /保存当前局面为书签|加书签/ }).first();
    if (await save.isVisible().catch(() => false)) {
      await safeClick(save);
      await settle(page, 600);
      await shot(page, STILLS, "23-bookmark.png");
    } else throw new Error("无书签按钮");
  });

  await step("24-record-tree", async () => {
    const back = page.getByRole("dialog", { name: "分支树" }).getByRole("button", { name: /分支树/ }).first();
    await safeClick(back);
    await settle(page, 700);
    await shot(page, STILLS, "24-record-tree.png");
  });

  await step("24b-tree-zoom", async () => {
    await safeClick(page.getByRole("dialog", { name: "分支树" }).getByRole("button", { name: "2×" }));
    await settle(page, 700);
    await shot(page, STILLS, "24b-tree-zoom.png");
    await safeClick(page.getByRole("dialog", { name: "分支树" }).getByRole("button", { name: "关闭" }));
    await settle(page, 400);
  });

  /* ============ I. 做题 + VCF 生成器 ============ */
  await step("25-puzzle", async () => {
    await switchMode(page, "做题");
    await page.locator(".action-bottom-row").waitFor({ timeout: 15000 });
    await settle(page, 2000);
    await shot(page, STILLS, "25-puzzle.png");
  });

  await step("26-puzzle-hint", async () => {
    const before = await page.locator(".stone-piece").count();
    await page.locator(".action-bottom-row").getByRole("button", { name: /分析/ }).first().click({ timeout: 9000 });
    await settle(page, 3200);
    await shot(page, STILLS, "26-puzzle-hint.png");
    log.push(["INFO", `做题提示落子 ${before} -> ${await page.locator(".stone-piece").count()}`]);
  });

  await step("27-vcf", async () => {
    await page.locator(".action-bottom-row").getByRole("button", { name: /VCF/ }).first().click({ timeout: 9000 });
    await settle(page, 1200);
    await shot(page, STILLS, "27-vcf-generator.png");
    // 试着切到「原创」模式，界面变化更明显
    const orig = page.getByRole("button", { name: "原创" }).first();
    if (await orig.isVisible().catch(() => false)) { await safeClick(orig); await settle(page, 900); await shot(page, STILLS, "27b-vcf-original.png"); }
  });

  /* ============ J. 棋谱库 / 题库 ============ */
  await step("28-library", async () => {
    await switchMode(page, "打谱");
    await settle(page, 500);
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "棋谱库" }));
    await settle(page, 1200);
    await shot(page, STILLS, "28-library.png");
  });

  await step("29-puzzle-library", async () => {
    const tab = page.getByRole("tab", { name: /题库/ }).first();
    if (!(await tab.isVisible().catch(() => false))) throw new Error("无题库 tab");
    await tab.click({ timeout: 6000 });
    await settle(page, 1300);
    await shot(page, STILLS, "29-puzzle-library.png");
  });

  /* ============ K. 快捷中心 ============ */
  await step("30-quick-drawer", async () => {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
    await settle(page, 600);
    await safeClick(page.locator('button[aria-label="打开快捷中心"]'));
    await settle(page, 900);
    await waitAnimations(page, ".quick-drawer, .drawer, .bottom-sheet").catch(() => {});
    await shot(page, STILLS, "30-quick-drawer.png");
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
