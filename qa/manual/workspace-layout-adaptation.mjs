// Workspace action-layout adaptation gate (T19/T20 acceptance):
//  A) editor end-to-end: presets + per-zone hide buttons collapse rows naturally
//     and persist; the 走棋功能区 section exists with its own hide control;
//  B) viewport matrix (portrait/landscape/tablet/split × default/compact/
//     topHidden) × record/puzzle: no horizontal overflow, board visible,
//     hidden zones collapse, wrapped rows stay inside their container, and in
//     landscape the board fully fits once the persistent row is hidden.
// Env: QA_BASE_URL (default http://127.0.0.1:5193/)
import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5193/";
const failures = [];
const notes = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const doc = {
  id: "adapt-1", version: 1, rootId: "root", savedCurrentId: "m5",
  nodes: { root: { id: "root", parentId: null, children: ["m1"], move: null, comment: "", marks: [] } },
  metadata: { title: "适配验收棋谱", black: "黑方", white: "白方", event: "", date: "", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] },
  createdAt: "", updatedAt: "",
};
{
  let parent = "root";
  const moves = [[6, 6, "black"], [6, 7, "white"], [7, 6, "black"], [8, 8, "white"], [5, 5, "black"]];
  moves.forEach(([row, col, player], i) => {
    const id = `m${i + 1}`;
    doc.nodes[id] = { id, parentId: parent, children: [], move: { row, col, player }, comment: "", marks: [] };
    doc.nodes[parent].children.push(id);
    parent = id;
  });
}
const collection = { id: "adapt-col", title: "适配验收题集", source: "测试", license: "测试", puzzles: [
  { id: "q1", title: "黑先四三", prompt: "黑先胜", difficulty: 2, player: "black", stones: [{ row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" }] },
] };

// 做题默认（用户 2026-09-10 二次钦定）：只两行——首行功能区 = 分析/应战/摆棋/VCF/
// 黑白切换/禁手规则/更多；常驻操作区空；常驻走棋区是固定渲染的题目导航（不在布局池）。
const DEFAULT_TOP = { record: ["comment", "save", "new", "delete", "rule", "color"], review: ["comment", "save", "new", "delete", "rule", "color"], puzzle: [] };
const DEFAULT_MOVES = { record: ["navStart", "navPrev", "navNext", "navEnd", "navUndo", "navRedo", "navDiscard"], review: ["navStart", "navPrev", "navNext", "navEnd", "playback"], puzzle: [] };
const DEFAULT_BOTTOM = { record: ["analysis", "annotation", "notes", "tree", "view"], review: ["analysis", "annotation", "notes", "tree", "view"], puzzle: ["analysis", "play", "setup", "vcf", "color", "rule", "view"] };
function presetLayouts(kind) {
  const modes = {};
  for (const mode of ["record", "review", "puzzle"]) {
    const top = DEFAULT_TOP[mode], moves = DEFAULT_MOVES[mode], bottom = DEFAULT_BOTTOM[mode];
    // topHidden 场景：整区隐藏常驻行（走棋区与首行保留），验证横屏棋盘满屏。
    modes[mode] = { top, moves, bottom, hidden: kind === "topHidden" ? [...top] : [], size: "standard", iconsOnly: kind === "compact", movesLabels: true };
  }
  // 必须写当前版本（3）：旧版存档载入时做题会被重置为新默认，种子布局会失效。
  return { version: 3, modes };
}

const browser = await chromium.launch({ headless: true });

async function openApp(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await ctx.addInitScript(([seedDoc, seedCol, layout, tabletSplit]) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "1");
    localStorage.setItem("banbu-restore-last-position-v1", "true");
    localStorage.setItem("renju-note-active-v1", JSON.stringify(seedDoc));
    localStorage.setItem("renju-note-library-v1", JSON.stringify([seedDoc]));
    localStorage.setItem("renju-note-puzzle-collections-v1", JSON.stringify([seedCol]));
    localStorage.setItem("renju-note-display-settings-v1", JSON.stringify({ showNumbers: true }));
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ tabletSplit, gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
    if (layout) localStorage.setItem("banbu-action-layout-v1", JSON.stringify(layout));
  }, [doc, collection, opts.layout || null, !!opts.tabletSplit]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${baseURL}?qa=1`, { waitUntil: "domcontentloaded" });
  // A concurrent editor session can leave a vite-error-overlay from a transient
  // bad save; reload until the app shell is actually interactive.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ready = await page.locator(".brand-trigger").waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    const overlay = await page.evaluate(() => !!document.querySelector("vite-error-overlay")).catch(() => false);
    if (ready && !overlay) break;
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const board = document.querySelector(".renju-board");
    const workspace = document.querySelector(".action-layout-workspace");
    const topRow = document.querySelector(".action-top-row");
    const bottomRow = document.querySelector(".action-bottom-row");
    const boardRect = board?.getBoundingClientRect();
    const rows = (el) => {
      if (!el) return null;
      const buttons = [...el.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0);
      const byTop = new Map();
      for (const b of buttons) { const t = Math.round(b.getBoundingClientRect().top); byTop.set(t, (byTop.get(t) || 0) + 1); }
      const container = el.getBoundingClientRect();
      const spill = buttons.some((b) => { const r = b.getBoundingClientRect(); return r.left < container.left - 1 || r.right > container.right + 1; });
      return { rowCount: byTop.size, counts: [...byTop.values()], spill, width: Math.round(container.width) };
    };
    return {
      overflow: shell ? Math.round(shell.scrollWidth - shell.clientWidth) : 999,
      viewport: { w: innerWidth, h: innerHeight },
      iconsOnly: workspace?.dataset.iconsOnly === "true",
      board: boardRect ? { top: Math.round(boardRect.top), bottom: Math.round(boardRect.bottom), left: Math.round(boardRect.left), width: Math.round(boardRect.width), visible: boardRect.top < innerHeight && boardRect.bottom > 0 } : null,
      topRow: rows(topRow), bottomRow: rows(bottomRow), movesRow: rows(document.querySelector(".moves-row")),
    };
  });
  return { label, ...m };
}

async function closeDrawer(page) {
  if (!(await page.locator(".quick-drawer-layer").count())) return;
  await page.getByRole("button", { name: "关闭快捷中心" }).click().catch(() => page.keyboard.press("Escape"));
  await page.locator(".quick-drawer-layer").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}

async function openLayoutEditor(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.locator(".action-layout-sheet").count()) return;
    if (await page.locator(".quick-drawer-layer").count()) {
      await page.getByRole("button", { name: "关闭快捷中心" }).click().catch(() => page.keyboard.press("Escape"));
      await page.locator(".quick-drawer-layer").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    }
    await page.getByRole("button", { name: /打开快捷中心/ }).click();
    const entry = page.locator(".quick-layout-entry");
    const shown = await entry.waitFor({ timeout: 3500 }).then(() => true).catch(() => false);
    if (!shown) continue;
    await entry.click();
    await page.locator(".action-layout-sheet").waitFor({ timeout: 4000 }).catch(() => {});
    if (await page.locator(".action-layout-sheet").count()) return;
  }
  throw new Error("无法打开功能区布局编辑器");
}

// ---------- A) editor end-to-end (portrait phone) ----------
{
  const { ctx, page, errors } = await openApp({ width: 390, height: 844 });
  await openLayoutEditor(page);
  assert(errors.length === 0, `编辑器打开报错：${errors.join(";")}`);
  assert(await page.locator(".layout-presets button").count() === 2, "预设模板按钮应有 2 个");
  assert(await page.locator(".layout-zone-visibility").count() === 3, `整区隐藏按钮应有 3 个（常驻/首行/走棋），实际 ${await page.locator(".layout-zone-visibility").count()}`);
  assert(await page.locator('.layout-preview section[data-layout-zone="moves"]').count() === 1, "缺少走棋功能区独立段");
  assert(await page.locator('.layout-preview section[data-layout-zone="moves"] [data-layout-id="navStart"]').count() === 1, "走棋功能区缺少独立的起点瓦片");
  assert(await page.locator('.layout-preview section[data-layout-zone="moves"] [data-layout-id]').count() >= 7, "走棋功能区导航按钮未逐个独立成瓦片");
  assert(await page.locator('.layout-preview section[data-layout-zone="top"] [data-layout-id="navStart"]').count() === 0, "起点不应出现在常驻区");
  // compact preset → iconsOnly applied, rows stay, board keeps working
  await page.locator(".layout-presets button", { hasText: "简略模式" }).click();
  await page.getByRole("button", { name: "应用" }).click();
  await closeDrawer(page);
  await page.waitForTimeout(700);
  let m = await measure(page, "editor/compact");
  assert(m.iconsOnly, "简略模板应用后未进入纯图标模式");
  assert(!!m.topRow, "简略模板不应删除常驻行（只去文字）");
  // 走棋功能区：默认布局下导航行常驻，逐个按钮独立（打谱 7 个 + 新建/保存）。
  m = await measure(page, "editor/moves-row");
  assert(!!m.movesRow, "默认走棋功能区导航行未显示");
  const navButtons = await page.locator(".moves-row [data-action-id]").count();
  assert(navButtons >= 7, `走棋功能区按钮不足（应逐个独立）：${navButtons}`);
  // persistence across reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".brand-trigger").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  m = await measure(page, "editor/compact/reload");
  assert(m.iconsOnly, "刷新后简略模板未持久化");
  // restore default via editor
  await openLayoutEditor(page);
  await page.locator(".layout-presets button", { hasText: "默认模式" }).click();
  await page.getByRole("button", { name: "应用" }).click();
  await closeDrawer(page);
  await page.waitForTimeout(600);
  m = await measure(page, "editor/default");
  assert(!m.iconsOnly, "默认模板未恢复文字按钮");
  assert(!!m.movesRow, "默认布局走棋功能区导航行缺失");
  // per-zone hide button (bottom zone) then restore
  await openLayoutEditor(page);
  await page.locator('.layout-preview section[data-layout-zone="bottom"] .layout-zone-visibility').click();
  await page.getByRole("button", { name: "应用" }).click();
  await closeDrawer(page);
  await page.waitForTimeout(600);
  assert(await page.locator(".action-bottom-row").count() === 0, "整区隐藏首行功能区后未自然折叠");
  await openLayoutEditor(page);
  await page.locator('.layout-preview section[data-layout-zone="bottom"] .layout-zone-visibility').click();
  await page.getByRole("button", { name: "应用" }).click();
  await closeDrawer(page);
  await page.waitForTimeout(600);
  assert(await page.locator(".action-bottom-row").count() === 1, "再次点击未恢复首行功能区");
  // moves zone hide → the whole nav row collapses; restore brings it back
  await openLayoutEditor(page);
  await page.locator('.layout-preview section[data-layout-zone="moves"] .layout-zone-visibility').click();
  await page.getByRole("button", { name: "应用" }).click();
  await closeDrawer(page);
  await page.waitForTimeout(600);
  assert(await page.locator(".moves-row").count() === 0, "整区隐藏走棋功能区后导航行未折叠");
  await openLayoutEditor(page);
  await page.locator('.layout-preview section[data-layout-zone="moves"] .layout-zone-visibility').click();
  await page.getByRole("button", { name: "应用" }).click();
  await closeDrawer(page);
  await page.waitForTimeout(600);
  assert(await page.locator(".moves-row").count() === 1, "恢复后走棋功能区导航行未回来");
  assert(errors.length === 0, `编辑器流程报错：${errors.join(";")}`);
  notes.push("A) 编辑器端到端：预设/整区隐藏/走棋区逐个按钮/持久化 全通过");
}

// ---------- B) viewport matrix ----------
const VIEWPORTS = [
  ["portrait-360", { width: 360, height: 844 }, "portrait"],
  ["portrait-390", { width: 390, height: 844 }, "portrait"],
  ["portrait-430", { width: 430, height: 932 }, "portrait"],
  ["landscape-667", { width: 667, height: 375 }, "landscape"],
  ["landscape-844", { width: 844, height: 390 }, "landscape"],
  ["landscape-932", { width: 932, height: 430 }, "landscape"],
  ["tablet-800", { width: 800, height: 1280 }, "tablet"],
  ["tablet-1024", { width: 1024, height: 768 }, "tablet"],
  ["split-1024", { width: 1024, height: 768 }, "split"],
  ["split-1180", { width: 1180, height: 820 }, "split"],
];
for (const [name, viewport, kind] of VIEWPORTS) {
  for (const [layoutName, layout] of [["default", null], ["compact", presetLayouts("compact")], ["topHidden", presetLayouts("topHidden")]]) {
    const { ctx, page, errors } = await openApp(viewport, { layout, tabletSplit: kind === "split" });
    for (const modeTab of ["打谱", "做题"]) {
      await page.getByRole("tab", { name: `${modeTab}模式` }).click().catch(() => {});
      await page.waitForTimeout(500);
      const m = await measure(page, `${name}/${layoutName}/${modeTab}`);
      assert(m.overflow <= 1, `${m.label} 横向溢出 ${m.overflow}px`);
      assert(!!m.board, `${m.label} 找不到棋盘`);
      assert(m.board?.visible, `${m.label} 棋盘不在视口内`);
      assert(!(m.board && m.board.width < 150), `${m.label} 棋盘过小 ${m.board?.width}px`);
      assert(!m.topRow?.spill && !m.bottomRow?.spill && !m.movesRow?.spill, `${m.label} 功能区按钮溢出容器边界`);
      if (layoutName === "compact") {
        assert(m.iconsOnly, `${m.label} 简略模板未启用纯图标`);
        // 做题默认没有常驻操作区（只两行：首行功能区 + 常驻走棋区），其余模式应保留。
        assert(modeTab === "做题" ? !m.topRow : !!m.topRow, `${m.label} 简略模板下常驻行应保留`);
        assert(!!m.bottomRow, `${m.label} 简略模板下首行功能区应保留`);
      }
      if (layoutName === "topHidden") {
        assert(!m.topRow, `${m.label} 整区隐藏后常驻行仍存在`);
        assert(!!m.bottomRow, `${m.label} 整区隐藏不应影响首行功能区`);
        if (kind === "landscape") assert(m.board.bottom <= m.viewport.h + 1, `${m.label} 横屏隐藏常驻行后棋盘底部超出视口 ${m.board.bottom}>${m.viewport.h}`);
      }
      if (kind === "landscape" && layoutName === "default") assert(m.board.top < m.viewport.h, `${m.label} 横屏默认布局棋盘完全不可见`);
      assert(errors.length === 0, `${m.label} 页面报错：${errors.join(";")}`);
      notes.push(`${m.label} board=${m.board?.width}px@top${m.board?.top} rows top:${m.topRow ? m.topRow.counts.join("/") : "—"} moves:${m.movesRow ? m.movesRow.counts.join("/") : "—"} bottom:${m.bottomRow ? m.bottomRow.counts.join("/") : "—"} overflow=${m.overflow}`);
    }
    await ctx.close();
  }
}

await browser.close();
console.log(notes.join("\n"));
if (failures.length) {
  console.error(`\n✗ 适配验收失败 ${failures.length} 项：`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log(`\n✓ 功能区布局适配验收全部通过（编辑器端到端 + ${VIEWPORTS.length * 3 * 2} 项视口测量）`);
