/**
 * capture-fix2.mjs — ① 分析选点数量改 5 并重拍 seq/analysis（确保帧间有变化）
 *                  ② 实测光标坐标（s2 识谱 / s4 分支树书签 / s9 开局库）→ coords.json
 */
import { launch, boot, shot, settle, waitAnimations, safeClick, resolveDraftModal, dismissToast, STILLS, SEQ } from "./lib.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const log = [];
const { browser, context, page } = await launch();
const dumpLog = (m) => { log.push(["INFO", m]); console.log("  INFO:", m); };
const coords = {};

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
const center = async (loc) => {
  const b = await loc.first().boundingBox().catch(() => null);
  return b ? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } : null;
};
const navTo = async (n, times = 1) => {
  const moveBtn = (k) => page.locator(".moves-row, .puzzle-nav-row").getByRole("button", { name: k });
  for (let i = 0; i < times; i++) { await safeClick(moveBtn(n)); await settle(page, 130); }
};
const gotoMove = async (n) => { await navTo("到第一手"); await navTo("下一手", n); await settle(page, 400); };

try {
  await boot(page);
  await importSgf();

  /* ===== ① 分析：选点数量 → 5 ===== */
  await page.getByRole("button", { name: "分析", exact: true }).first().click({ timeout: 9000 });
  await page.locator('.ai-analysis-panel[aria-label="AI 分析"]').waitFor({ timeout: 15000 });
  await waitAnimations(page, ".ai-analysis-panel");

  // 面板头控件 dump（真实文本）
  const head = await page.locator(".ai-analysis-panel").evaluate((el) => {
    const btns = [...el.querySelectorAll("button")].filter(b => b.offsetWidth > 0).map(b => b.textContent.trim()).slice(0, 20);
    const out = [];
    el.querySelectorAll("button, [role=button], [role=combobox], [role=listbox]").forEach(b => {
      if (b.offsetWidth > 0 && b.textContent.trim()) out.push(b.textContent.trim().slice(0, 24));
    });
    return JSON.stringify([...new Set(out)].slice(0, 26));
  });
  dumpLog("面板全部控件: " + head);

  // 找选点控件：aria-label 含"选点"或文本含"选"的控件（排除下拉里层）
  const selBtn = page.locator('.ai-analysis-panel [aria-label*="选点"]').first();
  const selBtn2 = page.locator('.ai-analysis-panel button').filter({ hasText: /选▾|选\s*▾|选点/ }).first();
  let selTarget = null;
  if (await selBtn.isVisible().catch(() => false)) selTarget = selBtn;
  else if (await selBtn2.isVisible().catch(() => false)) selTarget = selBtn2;
  if (selTarget) {
    const c = await center(selTarget);
    dumpLog("选点控件坐标: " + JSON.stringify(c));
    await safeClick(selTarget); await settle(page, 600);
    // dump 弹出的选项
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"], [class*=option], [role="menuitem"]')]
        .filter(el => el.offsetWidth > 0).map(el => el.textContent.trim()).slice(0, 16));
    dumpLog("选点选项: " + JSON.stringify(opts));
    const opt5 = page.getByRole("option", { name: /5/ }).first();
    const opt5b = page.locator('[role="option"], [class*=option]').filter({ hasText: /^5/ }).first();
    if (await opt5.isVisible().catch(() => false)) await safeClick(opt5);
    else await safeClick(opt5b);
    await settle(page, 500);
  } else dumpLog("未找到选点控件（用面板头全 dump 适配）");

  const n0 = await page.locator(".analysis-candidate-point").count();
  dumpLog("改后候选点数=" + n0);

  // 等候选 ≥3（最久 25s）
  for (let i = 0; i < 20; i++) {
    if (await page.locator(".analysis-candidate-point").count() >= 3) break;
    await settle(page, 1200);
  }
  const n1 = await page.locator(".analysis-candidate-point").count();
  dumpLog("等待后候选点数=" + n1);
  await shot(page, STILLS, "10-analysis.png");

  // seq/analysis 重拍（间隔 1.5s，帧间应有节点数变化）
  const dir = path.join(SEQ, "analysis");
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
    await settle(page, 1500);
  }
  const sizes = [];
  for (let i = 0; i < 6; i++) {
    const st = (await page.evaluate(() => new Promise(r => r(0)))) || 0;
    sizes.push(i);
  }
  dumpLog("seq/analysis 重拍完成");
  await shot(page, STILLS, "43-analysis-candidates.png").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await settle(page, 500);

  /* ===== ② 光标坐标 ===== */
  // s2 识谱：导入弹窗 →「图片」入口
  await safeClick(page.locator(".ai-analysis-panel button").filter({ hasText: /关闭|×/ }).first());
  await page.keyboard.press("Escape").catch(() => {});
  await settle(page, 500);
  for (let i = 0; i < 3; i++) {
    await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "导入" }));
    await settle(page, 700);
    if (await page.getByRole("dialog", { name: "选择导入方式" }).isVisible().catch(() => false)) break;
    await resolveDraftModal(page, "discard");
  }
  const imgBtn = page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button").filter({ hasText: /图片|拍照|照片/ }).first();
  coords.s2_imgImport = await center(imgBtn);
  dumpLog("s2 图片识别入口坐标: " + JSON.stringify(coords.s2_imgImport));
  await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "关闭" }).click().catch(() => {});
  await settle(page, 400);

  // s4 分支树 / 书签
  await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "打谱" }));
  await settle(page, 600);
  await importSgf();
  await gotoMove(5);
  await safeClick(page.getByRole("button", { name: "打开分支树" }));
  await page.getByRole("dialog", { name: "分支树" }).waitFor({ timeout: 15000 });
  await waitAnimations(page, ".bottom-sheet");
  await settle(page, 600);
  const dlg = page.getByRole("dialog", { name: "分支树" });
  coords.s4_bookmarkTab = await center(dlg.getByRole("button", { name: /书签/ }).first());
  coords.s4_treeTab = await center(dlg.getByRole("button", { name: /分支树/ }).first());
  coords.s4_zoom2x = await center(dlg.getByRole("button", { name: "2×" }));
  dumpLog("s4 书签tab: " + JSON.stringify(coords.s4_bookmarkTab));
  dumpLog("s4 分支树tab: " + JSON.stringify(coords.s4_treeTab));
  dumpLog("s4 2×: " + JSON.stringify(coords.s4_zoom2x));
  await safeClick(dlg.getByRole("button", { name: /书签/ }).first());
  await settle(page, 600);
  coords.s4_saveBookmark = await center(dlg.getByRole("button", { name: /书签 1|保存|加书签/ }).first());
  dumpLog("s4 书签按钮: " + JSON.stringify(coords.s4_saveBookmark));
  await safeClick(dlg.getByRole("button", { name: "关闭" }));
  await settle(page, 400);

  // s9 AI 人机对战 → 开局库 switch + 开始按钮
  await page.locator("nav.bottom-nav").getByRole("button", { name: "AI" }).click({ timeout: 9000 });
  await page.getByRole("dialog", { name: "AI 人机对战" }).waitFor({ timeout: 15000 });
  await waitAnimations(page, ".bottom-sheet");
  await settle(page, 500);
  const adlg = page.getByRole("dialog", { name: "AI 人机对战" });
  const sw = adlg.locator('[role="switch"], [class*=switch], [class*=toggle]').first();
  coords.s9_bookSwitch = await center(sw);
  dumpLog("s9 开局库开关: " + JSON.stringify(coords.s9_bookSwitch));
  coords.s9_start = await center(adlg.getByRole("button", { name: /开始人机对战|按新规则重新开始/ }).first());
  dumpLog("s9 开始按钮: " + JSON.stringify(coords.s9_start));

  await writeFile(path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), "tools", "coords.json"),
    JSON.stringify(coords, null, 2));
  dumpLog("coords.json 已写出");

} finally {
  console.log("===== 汇总 =====");
  console.log("coords:", JSON.stringify(coords, null, 1));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(0);
}