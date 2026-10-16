/**
 * v4 重拍：
 *  ① 强制关闭分析（localStorage 预置 analysisAuto=false），重拍落子序列与主题序列
 *  ② 图片识谱做成严格配对：先隐藏手数/坐标 → 拍干净的棋盘 → 用同一张图去识别 → 校验子数一致
 *  ③ 每一步都断言「无胜率 / 无候选点 / 无分析面板」
 */
import { launch, boot, shot, settle, safeClick, resolveDraftModal, dismissToast,
         waitAnimations, clickPoint, STILLS, SEQ } from "./lib.mjs";
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
    await shot(page, STILLS, `_fail4-${name}.png`).catch(() => {});
  }
  await dismissToast(page);
  await settle(page, 170);
};

/** 断言界面上没有分析痕迹 */
async function assertNoAnalysis(tag) {
  const r = await page.evaluate(() => {
    const txt = [...document.querySelectorAll(".renju-board text")].map(t => t.textContent.trim());
    return {
      panel: document.querySelectorAll('.ai-analysis-panel').length,
      cand: document.querySelectorAll('.analysis-candidate-point').length,
      chip: document.querySelectorAll('.analysis-candidate-chip').length,
      pct: txt.filter(t => /%$/.test(t)).length,
      toggleOn: !!document.querySelector('.ai-analysis-panel input[aria-label="持续分析"]')?.checked,
    };
  });
  const bad = r.panel + r.cand + r.chip + r.pct;
  console.log(`  [检查 ${tag}] 面板=${r.panel} 候选=${r.cand} 胜率文字=${r.pct} → ${bad ? "★有痕迹" : "干净"}`);
  if (bad) log.push(["INFO", `★ ${tag} 检测到分析痕迹 ${JSON.stringify(r)}`]);
  return bad === 0;
}

const playMoves = async (moves, gap = 110) => {
  for (const pt of moves) { await clickPoint(page, pt); await settle(page, gap); }
};
const MOVES = ["H8","I8","H9","I9","G8","J8","G9","J9","F8","K8","F9","E9"];

/** 预置：分析全关 */
const disableAnalysis = async () => {
  await page.evaluate(() => {
    const k = "banbu-enhancement-settings-v1";
    let v = {};
    try { v = JSON.parse(localStorage.getItem(k) || "{}"); } catch {}
    v.analysisAuto = false;
    v.analysisHintMode = false;
    v.analysisSelfPlay = false;
    localStorage.setItem(k, JSON.stringify(v));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".renju-board").first().waitFor({ timeout: 25000 });
  await settle(page, 900);
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

/** 通过「更多」菜单切换 隐藏手数 / 隐藏坐标 */
const toggleMore = async (label) => {
  await safeClick(page.getByRole("button", { name: "更多" }));
  await settle(page, 600);
  const b = page.getByRole("button", { name: label }).first();
  const ok = await safeClick(b);
  await settle(page, 500);
  return ok;
};

try {
  await boot(page);
  await disableAnalysis();
  console.log("分析已强制关闭");
  await assertNoAnalysis("初始");

  /* ---------- ① 落子序列（无分析） ---------- */
  await step("seq-play", async () => {
    const dir = path.join(SEQ, "play");
    await mkdir(dir, { recursive: true });
    await safeClick(page.locator(".record-command-bar").getByRole("button", { name: "无禁" }));
    await settle(page, 500);
    await page.screenshot({ path: path.join(dir, "00.png") });
    for (let i = 0; i < MOVES.length; i++) {
      await playMoves([MOVES[i]]);
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
    }
    await settle(page, 500);
    await assertNoAnalysis("落子后");
    await shot(page, STILLS, "02-board-played.png");
  });

  /* ---------- ② 图片识谱：严格配对 ---------- */
  await step("21-image", async () => {
    // 先隐藏手数与坐标，拍一张干净的棋盘
    const a1 = await toggleMore("隐藏手数");
    const a2 = await toggleMore("隐藏坐标");
    console.log("  隐藏手数 =", a1, " 隐藏坐标 =", a2);
    await settle(page, 700);

    const before = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
    const png = await page.locator(".renju-board").screenshot({ type: "png" });
    await writeFile(path.join(STILLS, "21-board-source.png"), png);
    console.log("  源图棋子数 =", before);

    // 恢复显示（后续镜头用）
    await toggleMore("显示手数").catch(() => {});
    await toggleMore("显示坐标").catch(() => {});

    // 打开导入方式 → 上传这张源图
    for (let i = 0; i < 3; i++) {
      await safeClick(page.locator("nav.bottom-nav").getByRole("button", { name: "导入" }));
      await settle(page, 700);
      if (await page.getByRole("dialog", { name: "选择导入方式" }).isVisible().catch(() => false)) break;
      await resolveDraftModal(page, "discard");
      await settle(page, 400);
    }
    await shot(page, STILLS, "21a-image-import-entry.png");
    await page.locator('input[type="file"][accept*="image"]').first()
      .setInputFiles({ name: "棋盘照片.png", mimeType: "image/png", buffer: png });
    await settle(page, 1200);
    await shot(page, STILLS, "21b-image-recognizing.png");
    await settle(page, 6000);
    await shot(page, STILLS, "21c-image-recognized.png");

    const after = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
    console.log(`  ★ 识别配对：源图 ${before} 子 → 识别后 ${after} 子  ${before === after ? "一致" : "不一致！"}`);
    log.push(["INFO", `图片识谱配对：${before} → ${after}`]);
  });

  /* ---------- ③ 主题序列（无分析） ---------- */
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
      if (i === 0) await assertNoAnalysis("主题首帧");
      await page.screenshot({ path: path.join(dir, String(i).padStart(2, "0") + ".png") });
      await shot(page, STILLS, `${name}.png`);
    }
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
