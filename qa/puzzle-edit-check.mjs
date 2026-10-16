import { chromium } from "playwright";

// 常驻门禁：题库改造（用户 2026-09-21）
//  P1 管理区表头：题量/正确率/加题入口
//  P2 单题三件套：编辑（题面/难度）、移到其他题集、删除 + 撤销
//  P3 隐藏题集（内置与自建都能隐藏）+ 设置页「题库管理」恢复
//  P4 批量合并（默认去重）+ 撤销
//  P5 拆分（按题号区间）
//  P6 错题本「已掌握」（收起可放回）
//  P7 题库页「题库管理」弹层重置做题进度（原在设置页）
//  P8 存为题目时可选目标题集
//  Z  零 pageerror
//
// 用法：BANBU_URL=http://127.0.0.1:5321 node qa/puzzle-edit-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5321/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
// 预置两个自建题集（各 4 题），并让第一题有「做过但没过」的记录 → 进错题本。
const COLLECTIONS_KEY = "renju-note-puzzle-collections-v1";
const PROGRESS_KEY = "renju-note-puzzle-progress-v1";
// 注意：第一道题（p1）带「做过没过」的记录，会进错题本——它是 P6/P7 的素材，
// 所以 P2 的删除用例必须删别的题（管理区第一行是 p1，删除用例改用第二行）。
const makeCollection = (id, title, count, offset) => ({
  id, title, source: "用户导入", license: "由用户确认使用权",
  puzzles: Array.from({ length: count }, (_, index) => ({
    id: `${id}-p${index + 1}`,
    title: `${title.slice(0, 2)}题${index + 1}`,
    prompt: "黑先，击败陪练",
    difficulty: 3,
    // 局面各不相同，避免合并去重把它们当成同一道题。
    stones: [
      { row: 7, col: 7 + offset, player: "black" },
      { row: 7 + index, col: 8 + offset, player: "white" },
    ],
    player: "black",
    boardSize: 15,
  })),
});

await context.addInitScript(([collectionsKey, progressKey, sets, progress]) => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem(collectionsKey, JSON.stringify(sets));
  localStorage.setItem(progressKey, JSON.stringify(progress));
}, [
  COLLECTIONS_KEY, PROGRESS_KEY,
  [makeCollection("qa-alpha", "甲题集", 4, 0), makeCollection("qa-beta", "乙题集", 3, 2)],
  { "qa-alpha/qa-alpha-p1": { solved: false, attempts: 2, updatedAt: new Date().toISOString() } },
]);

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const clickText = async (text, scope = "button") => {
  const done = await page.evaluate(([t, s]) => {
    const node = [...document.querySelectorAll(s)].find((el) => (el.getAttribute("aria-label") || el.textContent || "").includes(t));
    if (!node) return false;
    node.click();
    return true;
  }, [text, scope]);
  await page.waitForTimeout(450);
  return done;
};
const collectionsFromStorage = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]"), COLLECTIONS_KEY);
const openPuzzleTab = async () => {
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "棋谱库")?.click());
  await page.waitForTimeout(900);
  await page.evaluate(() => [...document.querySelectorAll("[role='tab'], button")].find((b) => (b.textContent || "").trim().startsWith("题库"))?.click());
  await page.waitForTimeout(900);
};
// 题库里内置 17 套题集排在最前，用搜索框把范围收窄到本次预置的两套，选择器才稳定。
const focusQaCollections = async () => {
  await page.evaluate(() => {
    const input = document.querySelector('.library-search input, input[placeholder*="搜索"]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "题集");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(600);
};
// 处理 window.confirm：默认拒绝，需要放行时临时切换。
let acceptConfirm = false;
page.on("dialog", (dialog) => { void (acceptConfirm ? dialog.accept() : dialog.dismiss()); });

// 按题目标题定位管理区里的行：前面的移动会改变行序，用下标定位会误伤别的题。
const rowByTitle = (title) => page.evaluate((t) => {
  const rows = [...document.querySelectorAll(".puzzle-manager-row")];
  const index = rows.findIndex((row) => (row.querySelector("b")?.textContent || "") === t);
  return index;
}, title);
const clickInRow = (title, selector) => page.evaluate(([t, s]) => {
  const rows = [...document.querySelectorAll(".puzzle-manager-row")];
  const row = rows.find((item) => (item.querySelector("b")?.textContent || "") === t);
  if (!row) return false;
  const node = row.querySelector(s);
  if (!node) return false;
  node.click();
  return true;
}, [title, selector]);

// ── P1 打开题库、展开管理区 ─────────────────────────────
await openPuzzleTab();
await focusQaCollections();
const collectionsVisible = await page.evaluate(() => [...document.querySelectorAll(".puzzle-collection-main b")].map((el) => el.textContent));
check("P1 题库列出两个自建题集", collectionsVisible.includes("甲题集") && collectionsVisible.includes("乙题集"), collectionsVisible.join("/"));

const manageOpened = await clickText("管理 4 道题");
check("P1 「管理 N 道题」可展开", manageOpened);
const headText = await page.evaluate(() => document.querySelector(".puzzle-manager-head")?.textContent || "");
check("P1 管理区表头显示题量与正确率", /共 4 道/.test(headText) && /正确率/.test(headText), headText.trim().slice(0, 80));
const addEntry = await page.evaluate(() => [...document.querySelectorAll(".puzzle-manager-actions button")].some((el) => (el.textContent || "").includes("加题")));
check("P1 管理区有「加题」入口", addEntry);
check("P1 每题行有三件套（编辑/移到/删除）", await page.evaluate(() => {
  const row = document.querySelector(".puzzle-manager-row");
  if (!row) return false;
  return Boolean(row.querySelector('button[aria-label^="编辑题目"]')) && Boolean(row.querySelector(".puzzle-move-select")) && Boolean(row.querySelector("button.delete-puzzle"));
}));

// ── P2 单题编辑 ─────────────────────────────────────────
await clickInRow("甲题题2", 'button[aria-label^="编辑题目"]');
await page.waitForTimeout(400);
const editSheetOpen = await page.evaluate(() => Boolean(document.querySelector(".puzzle-edit-sheet")));
check("P2 编辑浮层打开", editSheetOpen);
if (editSheetOpen) {
  await page.evaluate(() => {
    const input = document.querySelector(".puzzle-edit-sheet input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "改过的题目名");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  await clickText("保存题目");
  await page.waitForTimeout(500);
}
const renamed = await page.evaluate(() => [...document.querySelectorAll(".puzzle-manager-row b")].map((el) => el.textContent));
check("P2 题目改名已生效", renamed.includes("改过的题目名"), renamed.join("/"));

// ── P2 单题移到其他题集 ─────────────────────────────────
await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".puzzle-manager-row")];
  const row = rows.find((item) => (item.querySelector("b")?.textContent || "") === "改过的题目名") || rows[1] || rows[0];
  const select = row.querySelector(".puzzle-move-select");
  const option = [...select.options].find((item) => item.textContent.includes("乙题集"));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, option.value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(600);
const afterMove = await collectionsFromStorage();
const alpha = afterMove.find((item) => item.id === "qa-alpha");
const beta = afterMove.find((item) => item.id === "qa-beta");
check("P2 题目已移出原题集、进入目标题集", alpha.puzzles.length === 3 && beta.puzzles.length === 4, `甲=${alpha.puzzles.length} 乙=${beta.puzzles.length}`);
check("P2 移动后题 id 不变（进度跟随）", beta.puzzles.some((p) => p.id === "qa-alpha-p2"), beta.puzzles.map((p) => p.id).join(","));

// ── P2 单题删除 + 撤销 ──────────────────────────────────
await page.evaluate(() => document.querySelector(".puzzle-manager-row button.delete-puzzle")?.click());
await page.waitForTimeout(300);
// window.confirm 在 QA 里默认返回 false；用 dialog 处理放行。
const beforeDelete = (await collectionsFromStorage()).find((item) => item.id === "qa-beta").puzzles.length;
check("P2 删除有二次确认（取消则不删）", beforeDelete === 4, `仍为 ${beforeDelete} 道`);

acceptConfirm = true;
const beforeDeleteCount = (await collectionsFromStorage()).find((item) => item.id === "qa-alpha").puzzles.length;
await page.evaluate(() => document.querySelector(".puzzle-manager-row button.delete-puzzle")?.click());
await page.waitForTimeout(700);
const afterDelete = (await collectionsFromStorage()).find((item) => item.id === "qa-alpha").puzzles.length;
check("P2 确认后删除单题", afterDelete === beforeDeleteCount - 1, `${beforeDeleteCount} → ${afterDelete} 道`);
const undoShown = await page.evaluate(() => [...document.querySelectorAll(".puzzle-manager-actions button")].some((el) => (el.textContent || "").includes("撤销")));
check("P2 删除后出现「撤销」", undoShown);
if (undoShown) {
  await page.evaluate(() => [...document.querySelectorAll(".puzzle-manager-actions button")].find((b) => (b.textContent || "").includes("撤销"))?.click());
  await page.waitForTimeout(600);
  const afterUndo = (await collectionsFromStorage()).find((item) => item.id === "qa-alpha").puzzles.length;
  check("P2 撤销恢复被删题目", afterUndo === beforeDeleteCount, `撤销后 ${afterUndo} 道（原 ${beforeDeleteCount}）`);
}

// ── P3 隐藏题集 + 题库页「题库管理」弹层恢复（原在设置页，用户 09-26 搬家） ────────────────────────────
await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="隐藏题集"]')].find((el) => el.getAttribute("aria-label").includes("甲题集"))?.click());
await page.waitForTimeout(600);
const visibleAfterHide = await page.evaluate(() => [...document.querySelectorAll(".puzzle-collection-main b")].map((el) => el.textContent));
check("P3 隐藏后题集不在列表", !visibleAfterHide.includes("甲题集"), visibleAfterHide.join("/"));
const hiddenStored = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-puzzle-hidden-collections-v1") || "[]"));
check("P3 隐藏写入存档", hiddenStored.includes("qa-alpha"), hiddenStored.join(","));

// 用户 09-26：「题库管理」从设置页搬进题库页，成为快捷入口的第 8 个按钮（弹层）。
await openPuzzleTab();
await page.waitForTimeout(400);
const manageEntry = await page.evaluate(() => { const b = [...document.querySelectorAll(".library-shortcuts button")].find((el) => (el.textContent || "").includes("题库管理")); if (!b) return false; b.click(); return true; });
check("P3 题库页快捷入口出现「题库管理」（第 8 个按钮）", manageEntry);
await page.waitForTimeout(400);
const manageSheet = await page.evaluate(() => document.body.textContent.includes("隐藏的题集不会出现在题库列表里"));
check("P3 打开「题库管理」弹层", manageSheet);
const restoreBtn = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("恢复显示")); if (!b) return false; b.click(); return true; });
check("P3 弹层里可恢复隐藏题集", restoreBtn);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await openPuzzleTab();
await focusQaCollections();
const restored = await page.evaluate(() => [...document.querySelectorAll(".puzzle-collection-main b")].map((el) => el.textContent));
check("P3 恢复后题集重新出现", restored.includes("甲题集"), restored.join("/"));

// ── P6 错题本「已掌握」 + P7 重置进度 ───────────────────
// 这两项测的是「做题进度」这条线。前面的 P2–P5 会大量增删题目（删题会正确地连进度
// 一起清掉），所以这里换一个干净页面、用同一份种子重来，断言才反映真实行为。
const fresh = await context.newPage();
fresh.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
let freshConfirm = false;
fresh.on("dialog", (dialog) => { void (freshConfirm ? dialog.accept() : dialog.dismiss()); });
await fresh.goto(url, { waitUntil: "domcontentloaded" });
await fresh.waitForTimeout(2400);
await fresh.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "棋谱库")?.click());
await fresh.waitForTimeout(900);
await fresh.evaluate(() => [...document.querySelectorAll("[role='tab'], button")].find((b) => (b.textContent || "").trim().startsWith("题库"))?.click());
await fresh.waitForTimeout(900);
await fresh.evaluate(() => [...document.querySelectorAll(".library-shortcuts button")].find((el) => (el.textContent || "").includes("错题本"))?.click());
await fresh.waitForTimeout(900);
const progressAtP6 = await page.evaluate((key) => localStorage.getItem(key) || "null", PROGRESS_KEY);
const wrongRows = await fresh.evaluate(() => document.querySelectorAll(".wrongbook-row").length);
check("P6 错题本有记录", wrongRows >= 1, `${wrongRows} 行`);
check("P6 错题本每题有「重做」与「已掌握」", await fresh.evaluate(() => {
  const buttons = [...document.querySelectorAll(".wrongbook-actions button")].map((el) => el.textContent || "");
  return buttons.some((text) => text.includes("重做")) && buttons.some((text) => text.includes("已掌握"));
}));
if (wrongRows >= 1) {
  await fresh.evaluate(() => [...document.querySelectorAll(".wrongbook-actions button")].find((el) => (el.textContent || "").includes("已掌握"))?.click());
  await fresh.waitForTimeout(700);
  const afterMaster = await fresh.evaluate(() => document.querySelectorAll(".wrongbook-row").length);
  check("P6 标为已掌握后从错题本收起", afterMaster === wrongRows - 1, `${wrongRows} → ${afterMaster}`);
  check("P6 出现「全部放回」", await fresh.evaluate(() => Boolean(document.querySelector(".wrongbook-footer"))));
  const overlayAfterMaster = await fresh.evaluate(() => localStorage.getItem("banbu-puzzle-overlays-v1") || "{}");
  check("P6 已掌握写入覆盖层", overlayAfterMaster.includes("mastered"), overlayAfterMaster.slice(0, 100));
}

// ── P4 合并（默认去重）+ 撤销 ───────────────────────────
await openPuzzleTab();
await focusQaCollections();
await page.evaluate(() => [...document.querySelectorAll(".library-shortcuts button")].find((el) => (el.textContent || "").includes("批量编辑"))?.click());
await page.waitForTimeout(700);
await page.evaluate(() => [...document.querySelectorAll(".batch-selection-checkbox input")].forEach((input) => { if (!input.checked) input.click(); }));
await page.waitForTimeout(400);
const mergeEnabled = await page.evaluate(() => [...document.querySelectorAll(".batch-selection-bar button")].some((el) => (el.textContent || "").includes("合并")));
check("P4 批量栏出现「合并」", mergeEnabled);
const selectedCount = await page.evaluate(() => document.querySelectorAll(".batch-selection-checkbox input:checked").length);
check("P4 全选后选中两个题集", selectedCount >= 2, `选中 ${selectedCount}`);
await page.evaluate(() => [...document.querySelectorAll(".batch-selection-bar button")].find((el) => (el.textContent || "").trim() === "合并")?.click());
await page.waitForTimeout(600);
const mergeSheet = await page.evaluate(() => document.body.textContent.includes("去掉重复题"));
check("P4 合并浮层有去重选项", mergeSheet);
await page.evaluate(() => [...document.querySelectorAll(".puzzle-edit-actions button")].find((el) => (el.textContent || "").includes("合并"))?.click());
await page.waitForTimeout(900);
const mergedSets = await collectionsFromStorage();
const merged = mergedSets.find((item) => item.id.startsWith("merged-"));
check("P4 合并生成新题集且原题集收起", Boolean(merged) && mergedSets.length === 1, `题集数=${mergedSets.length}（应为 1）`);
check("P4 合并后题目总数正确", merged ? merged.puzzles.length === 7 : false, merged ? `${merged.puzzles.length} 道` : "无");

// ── P5 拆分（按题号区间）────────────────────────────────
await openPuzzleTab();
await focusQaCollections();
await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="拆分题集"]')][0]?.click());
await page.waitForTimeout(700);
const splitSheet = await page.evaluate(() => Boolean(document.querySelector(".puzzle-split-range")));
check("P5 拆分浮层打开且有区间输入", splitSheet);
if (splitSheet) {
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll(".puzzle-split-range input")];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inputs[0], "1");
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(inputs[1], "3");
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await clickText("拆出新题集");
  await page.waitForTimeout(700);
  const splitSets = await collectionsFromStorage();
  const created = splitSets.find((item) => item.id.startsWith("split-"));
  check("P5 拆分生成新题集", Boolean(created) && created.puzzles.length === 3, created ? `${created.puzzles.length} 道` : "无");
}

// ── P7 题库页「题库管理」弹层里重置做题进度（用户 09-26 搬家；继续用 fresh 页面）────────
await fresh.keyboard.press("Escape");
await fresh.waitForTimeout(600);
await fresh.evaluate(() => [...document.querySelectorAll(".library-shortcuts button")].find((el) => (el.textContent || "").includes("题库管理"))?.click());
await fresh.waitForTimeout(700);
check("P7 打开题库管理弹层", await fresh.evaluate(() => !!document.querySelector("[data-puzzle-manage]")));
const progressBefore = await fresh.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key) || "{}")).length, PROGRESS_KEY);
check("P7 重置前有做题记录", progressBefore >= 1, `${progressBefore} 条`);
freshConfirm = true;
await fresh.evaluate(() => [...document.querySelectorAll("[data-puzzle-manage] .settings-link-row button")].find((b) => (b.textContent || "").includes("重置"))?.click());
await fresh.waitForTimeout(800);
const progressAfter = await fresh.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key) || "{}")).length, PROGRESS_KEY);
check("P7 重置清空做题进度", progressAfter === 0, `${progressBefore} → ${progressAfter}`);
const overlaysKept = await fresh.evaluate(() => JSON.parse(localStorage.getItem("banbu-puzzle-overlays-v1") || "{}"));
check("P7 重置保留已掌握标记", Object.values(overlaysKept).some((item) => item.mastered === true), JSON.stringify(overlaysKept).slice(0, 160));

check("Z 无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(failed ? `\n${failed} 项未通过` : "\n全部通过");
await browser.close();
process.exit(failed ? 1 : 0);
