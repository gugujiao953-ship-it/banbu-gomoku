// Corrected manual screenshot capture: avoids the unsaved-draft guard popup in shots,
// crops to the specific control region, and produces distinct images (no reused dups).
// node scripts/capture-manual-screenshots.mjs   (server at QA_BASE_URL, default 127.0.0.1:5173)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const OUT = "public/manual";
mkdirSync(OUT, { recursive: true });
const KIFU = "D:/Projects/经济学知识/15_半步五子棋/棋谱";
const IMG = `${KIFU}/祁观vs弈心2018人机大战/第1局_17手局面图_贴吧兰志仁帖.jpg`;
const SGF = `${KIFU}/祁观vs弈心2018人机大战/弈心VS祁观2018五番棋_合集.sgf`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark", serviceWorkers: "block", isMobile: true, hasTouch: true, acceptDownloads: true });
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-motion-enabled-v2", "false"); });
const page = await context.newPage();
const misses = [], done = [];

const step = async (label, fn) => { try { await fn(); } catch (e) { misses.push(`STEP ${label}: ${e.message.split("\n")[0]}`); } };
const clip = async (id, sel, pad = 6) => {
  try {
    const el = page.locator(sel).first(); await el.waitFor({ timeout: 5000 });
    let b = await el.boundingBox(); if (!b) throw new Error("no box");
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    b = { x, y, width: Math.min(390 - x, b.width + pad * 2), height: Math.min(844 - y, b.height + pad * 2) };
    await page.screenshot({ path: `${OUT}/${id}.jpg`, clip: b, type: "jpeg", quality: 82 });
    done.push(id);
  } catch (e) { misses.push(`CLIP ${id} <- ${sel}: ${e.message.split("\n")[0]}`); }
};
// click an aria-label button robustly
const aBtn = (label) => page.locator(`button[aria-label="${label}"]`).first();
const mode = async (m) => { await dismiss(); await aBtn(`${m}模式`).click({ timeout: 4000 }); await page.waitForTimeout(450); };
const nav = async (name) => { await dismiss(); await page.locator(`nav.bottom-nav button:has-text("${name}")`).first().click({ timeout: 4000 }); await page.waitForTimeout(650); };
// Close the unsaved-draft GUARD dialog by picking 放弃 (discard). Only matches the dialog's own button.
const dismissDraftGuard = async () => {
  for (let i = 0; i < 3; i++) {
    const b = page.locator('.bottom-sheet:has-text("未保存") button:has-text("放弃"), [role="dialog"]:has-text("未保存") button:has-text("放弃")').first();
    if (await b.count()) { await b.click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(400); } else break;
  }
};
// Generic close: any open sheet / drawer / scrim, leaving the workspace clean
const dismiss = async () => {
  await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(150);
  for (const s of [".mark-studio-backdrop", ".quick-drawer-scrim", ".sheet-backdrop"]) { const e = page.locator(s).first(); if (await e.count()) await e.click({ timeout: 800 }).catch(() => {}); await page.waitForTimeout(120); }
  const x = page.locator('.bottom-sheet button[aria-label="关闭"]').first(); if (await x.count()) { await x.click({ timeout: 1000 }).catch(() => {}); await page.waitForTimeout(250); }
  await page.waitForTimeout(200);
};
const pickFile = async (choiceText, file) => {
  const fcP = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
  await page.getByText(choiceText, { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
  const fc = await fcP;
  if (fc) { await fc.setFiles(file).catch(() => {}); await page.waitForTimeout(5000); return true; }
  return false;
};
const reset = async () => { await page.goto(BASE, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".renju-board", { timeout: 8000 }); await page.waitForTimeout(700); await dismissDraftGuard(); };
// ensure clean editable workspace with real content: import once, then open the latest game fresh each time
let seeded = false;
const ensureContent = async () => {
  if (!seeded) { await reset(); await nav("导入"); await pickFile("导入棋谱文件", SGF); seeded = true; }
  await reset();
};
// open a real record from library (so board has stones for tree/comment shots)
const openLatest = async () => { await reset(); await nav("棋谱库"); await page.waitForTimeout(600); const item = page.locator(".library-page [role='button'], .record-list article, .inline-record-list > button").first(); await item.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(900); await dismissDraftGuard(); };
// play a few moves on a fresh editable board (打谱) and return to start so there ARE variations
const seedEditable = async () => { await ensureContent(); await openLatest(); await mode("打谱"); for (let i = 0; i < 6; i++) { await aBtn("下一手").click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(120); } };

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".renju-board"); await page.waitForTimeout(700);
await step("seed", ensureContent);

// 01 主界面
await step("home", async () => {
  await reset();
  await clip("s1f1", ".workspace-mode-toggle");
  await clip("s1f2", ".renju-board");
  await clip("s1f4", "nav.bottom-nav");
});
// 快捷中心
await step("quick", async () => { await reset(); await page.locator(".brand-trigger").click({ timeout: 4000 }); await page.waitForTimeout(650); await clip("s1f5", ".quick-drawer-panel"); await dismiss(); });
// 02 最近切换
await step("recent", async () => { await reset(); await page.locator(".workspace-current").click({ timeout: 4000 }); await page.waitForTimeout(750); await clip("s2f2", ".bottom-sheet"); await dismiss(); });
// 03 自动草稿（有内容、未保存态的命令栏）
await step("draft", async () => { await seedEditable(); await aBtn("下一手").click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(300); await clip("s3f2", ".record-command-bar"); });
// 04 模式 + 读谱标注
await step("modes", async () => {
  await reset(); await mode("读谱"); await clip("s4f2", ".workspace-mode-toggle");
  await mode("做题"); await clip("s4f4", ".workspace-mode-toggle");
});
// 04f3 读谱本机标注 — ONLY this feature uses s4f3 (棋盘标注 gets a new dedicated shot)
await step("review-marks", async () => { await reset(); await mode("读谱"); const t = page.locator(".dock-tabs").getByText("标注", { exact: false }).first(); if (await t.count()) await t.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(650); await clip("s4f3", ".mark-studio-box, .dock-panel"); await dismiss(); });
// 05 变化树 (查看变化树 与 移动与缩放 都去掉重复图，保留一张给查看变化树)
await step("tree", async () => {
  await seedEditable();
  await aBtn("上一手").click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(250);
  const cell = page.locator('[role="gridcell"][aria-label$="空位"]').nth(40); await cell.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250);
  await aBtn("打开分支树").click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500);
  await clip("s5f1", ".record-tree-panel"); await dismiss();
});
// 07 注释 + 棋谱信息（先确保有内容/已保存态，避免守卫弹窗）
await step("comment", async () => { await reset(); await aBtn("收起注释").click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(400); await clip("s7f1", ".comment-card, [class*=comment]"); });
await step("metadata", async () => { await seedEditable(); await dismiss(); await aBtn("保存棋谱").click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(700); await clip("s7f2", ".bottom-sheet"); await dismiss(); });
// 07 棋盘标注 — dedicated shot of the 标注 studio (NOT reused s4f3), cropped to studio box only
await step("mark-studio", async () => { await reset(); await mode("打谱"); const t = page.locator(".dock-tabs").getByText("标注", { exact: false }).first(); if (await t.count()) await t.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(650); await clip("s7f3", ".mark-studio-box, .mark-studio"); await dismiss(); });
// 08 导入：常见棋谱格式 sheet（先确保无守卫）；图片识谱入口
await step("import", async () => { await reset(); await dismissDraftGuard(); await nav("导入"); await page.waitForTimeout(500); await clip("s8f1", ".bottom-sheet"); await dismiss(); });
// 08 图片识谱：展示导入 sheet 的“图片识谱”入口一项即可
await step("recog-entry", async () => { await reset(); await dismissDraftGuard(); await nav("导入"); await page.waitForTimeout(500); await clip("s8f3", '.import-choice:has-text("图片识谱"), .bottom-sheet'); await dismiss(); });
// 09 导出：一张 sheet 即可（完整棋谱 + 棋盘图片 都用这张，或去重后留这张）
await step("export", async () => { await seedEditable(); await dismiss(); await page.locator("button[aria-label='打开导出方式']").click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); await clip("s9f1", ".bottom-sheet"); await dismiss(); });
// 10 棋谱库：棋谱/题库切换按钮图标
await step("library", async () => { await reset(); await dismissDraftGuard(); await nav("棋谱库"); await page.waitForTimeout(700); await clip("s10f1", ".library-segment, .library-page .library-segment, .library-page"); await dismiss(); });
// 11 题集选择：按钮图标/分段
await step("puzzle", async () => { await reset(); await mode("做题"); await page.waitForTimeout(700); await clip("s11f1", ".workspace-mode-toggle"); await dismiss(); });
// 11 错题本 sheet（先建内容、无守卫）
await step("wrongbook", async () => { await seedEditable(); await mode("做题"); await dismiss(); const t = page.locator(".dock-tabs").getByText("更多", { exact: false }).first(); if (await t.count()) await t.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(450); await page.getByText("错题本", { exact: false }).first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); await clip("s11f7", ".bottom-sheet"); await dismiss(); });
// 13 AI 规则 sheet（无守卫，干净 AI sheet）
await step("ai-sheet", async () => { await reset(); await dismissDraftGuard(); await nav("AI"); await page.waitForTimeout(800); await clip("s13f1", ".bottom-sheet"); await dismiss(); });
// 14 思考：分析当前局面 用思考按钮图标；结果呈现 用思考面板
await step("think-icon", async () => { await reset(); await clip("s14icon", "button.command-think, .record-command-bar .command-think", 4); });
await step("think", async () => { await seedEditable(); await dismiss(); await aBtn("思考当前局面的下一步").click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(900); const body = page.locator(".bottom-sheet").first(); await body.waitFor({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(500); await clip("s14f1", ".bottom-sheet"); await dismiss(); });
// 14 跨谱查找
await step("possearch", async () => { await seedEditable(); await mode("打谱"); await dismiss(); const t = page.locator(".dock-tabs").getByText("更多", { exact: false }).first(); if (await t.count()) await t.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(450); await page.getByText("跨谱查找", { exact: false }).first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(800); await clip("s14f4", ".bottom-sheet"); await dismiss(); });
// 14 棋谱内查找
await step("find", async () => { await seedEditable(); await mode("打谱"); await dismiss(); const t = page.locator(".dock-tabs").getByText("更多", { exact: false }).first(); if (await t.count()) await t.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(450); const f = page.getByRole("button", { name: "查找", exact: true }).first(); if (await f.count()) await f.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); await clip("s14f5", ".bottom-sheet"); await dismiss(); });
// 15 资料安全：回收站图标 vs 备份图标（各自区域）
await step("datasafety-recycle", async () => { await reset(); await nav("设置"); await page.waitForTimeout(450); await page.getByText("数据与兼容", { exact: false }).first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); const r = page.getByText("回收站", { exact: false }).first(); if (await r.count()) await r.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(600); await clip("s15f2", ".bottom-sheet"); await dismiss(); });
await step("datasafety-backup", async () => { await reset(); await nav("设置"); await page.waitForTimeout(450); await page.getByText("数据与兼容", { exact: false }).first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); await clip("s15f3", ".settings-group:has-text('备份'), .settings-link:has-text('备份'), details:has-text('完整备份')"); await dismiss(); });
// 16 外观
await step("settings", async () => {
  await reset(); await nav("设置"); await page.waitForTimeout(500);
  const openSub = async (label) => { const s = page.locator(".appearance-center-subsection, details").filter({ has: page.locator(`summary:has-text("${label}")`) }).first(); if (await s.count()) { const isOpen = await s.evaluate(e => e.open).catch(() => true); if (!isOpen) await s.locator("summary").click({ timeout: 2000 }).catch(() => {}); } await page.waitForTimeout(350); return s; };
  const openGroup = async (txt) => { const d = page.locator(`details.settings-group:has(summary:has-text("${txt}"))`).first(); if (await d.count()) { const isOpen = await d.evaluate(e => e.open).catch(() => true); if (!isOpen) await d.locator("summary").click({ timeout: 2000 }).catch(() => {}); } await page.waitForTimeout(350); return d; };
  await openGroup("外观与音效");
  await openSub("主题"); await clip("s16f1", ".theme-preference, details.appearance-center-subsection:has-text('主题')");
  await openSub("棋盘"); await clip("s16f2", "details.appearance-center-subsection:has-text('棋盘材质'), details.appearance-center-subsection:has-text('棋盘')");
  await openSub("棋子"); await clip("s16f3", "details.appearance-center-subsection:has-text('棋子材质'), details.appearance-center-subsection:has-text('棋子')");
  await openSub("透明"); await clip("s16f4", "details.appearance-center-subsection:has-text('透明')");
  await openGroup("无障碍与字号");
  // 字号：只截字号控制区
  await clip("s17f1", ".font-scale-options, [role=radiogroup]:has-text('字号'), details:has-text('字号')");
  // 设置搜索：截搜索框
  await clip("s17f6", ".settings-search input, input[placeholder*='搜索']");
  await dismiss();
});
// 19 关于（先无守卫，再打开关于）
await step("about", async () => { await reset(); await dismissDraftGuard(); await nav("设置"); await page.waitForTimeout(450); const g = page.locator(`details.settings-group:has(summary:has-text('关于'))`).first(); if (await g.count()) { const isOpen = await g.evaluate(e => e.open).catch(() => true); if (!isOpen) await g.locator("summary").click({ timeout: 2000 }).catch(() => {}); } await page.waitForTimeout(300); await page.getByText("检查更新", { exact: false }).first().click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(2000); await clip("s19f1", "details.settings-group:has(summary:has-text('关于'))"); await dismiss(); });

console.log(`DONE: ${done.length} ok`);
console.log("FILES:", done.join(", "));
if (misses.length) { console.log("MISSES:"); for (const m of misses) console.log("  -", m); }
await browser.close();
