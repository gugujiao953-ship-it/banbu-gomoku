// 功能区「我的布局」槽位门禁（用户 09-17 需求：保存自定义布局，最多 3~5 个，一键切换）
//   L1 编辑器里有「我的布局」区；初始为空时给一句说明
//   L2 保存当前布局 → 出现槽位（名字 + 三个模式的按钮数摘要），并写入本机存储
//   L3 改动布局后点槽位 = 一键切回保存的那一套（验证真的换了，不只是提示）
//   L4 刷新后槽位还在（持久化）
//   L5 存满 5 套后「保存当前布局」禁用；删一套后恢复可用
//   L6 删除槽位 → 列表与存储同步减少
//   L7 坏数据（非数组/半条记录）不会让编辑器崩，整条丢弃
//   L8 **全部主题**（清单从应用读）下槽位按钮可见且有对比度
// 用法：BANBU_URL=http://[::1]:5297/ node scripts/ui-layout-slots-check.mjs
import { chromium } from "playwright";
import { readThemeIds, runThemeMatrix, sampleManyScript, weakThemes, minRatioOf } from "./lib/theme-matrix.mjs";

const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://[::1]:5297/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(url.href, { waitUntil: "domcontentloaded" });

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const openEditor = async () => {
  await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
  await page.waitForTimeout(500);
  const drawerOpen = await page.evaluate(() => !!document.querySelector(".quick-drawer-panel"));
  if (!drawerOpen) {
    await page.getByRole("button", { name: /打开快捷中心/ }).click();
    await page.locator(".quick-drawer-panel").waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
  }
  await page.locator(".quick-layout-entry").click();
  await page.locator(".action-layout-sheet .layout-saved").waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
};
const closeEditor = async () => {
  await page.evaluate(() => { const b = [...document.querySelectorAll(".action-layout-sheet .layout-footer button")].find((x) => (x.textContent || "").includes("取消")); b?.click(); });
  await page.waitForTimeout(400);
  await closeDrawer();
};
const closeDrawer = async () => {
  await page.evaluate(() => { document.querySelector(".quick-drawer-scrim")?.click(); });
  await page.waitForTimeout(500);
};
const applyLayout = async () => {
  await page.evaluate(() => { const b = [...document.querySelectorAll(".action-layout-sheet .layout-footer button")].find((x) => (x.textContent || "").includes("应用")); b?.click(); });
  await page.waitForTimeout(700);
};
const slots = () => page.evaluate(() => [...document.querySelectorAll(".layout-saved-list > li")].map((li) => ({
  name: (li.querySelector("b")?.textContent || "").trim(),
  summary: (li.querySelector("small")?.textContent || "").trim(),
  hasRemove: !!li.querySelector(".layout-saved-remove"),
})));
const storedSlots = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("banbu-action-layout-presets-v1") || "null"); } catch { return "PARSE_ERROR"; } });
const storedLayout = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("banbu-action-layout-v1") || "null"); } catch { return null; } });
/** 隐藏首行第一个按钮：**必须分两次点击并各等一拍**——「隐藏」按钮的 disabled 取决于
 *  上一步的选中态，React 状态还没落地时它仍是禁用的，同一次 evaluate 里连点等于没点。 */
const hideFirstBottomTile = async () => {
  await page.locator('.layout-preview [data-layout-zone="bottom"] .layout-tile-select').first().click();
  await page.waitForTimeout(350);
  const clicked = await page.evaluate(() => {
    const hide = document.querySelector(".layout-selection .layout-visibility");
    if (!hide || hide.disabled) return false;
    hide.click();
    return true;
  });
  await page.waitForTimeout(350);
  return clicked;
};

await openEditor();

// ── L1 初始为空 ────────────────────────────────────────────
const initial = await page.evaluate(() => ({
  hasRegion: !!document.querySelector(".layout-saved"),
  hasSave: !!document.querySelector(".layout-saved-add"),
  emptyNode: !!document.querySelector(".layout-saved-empty"),
  count: document.querySelectorAll(".layout-saved-list > li").length,
}));
check("L1 「我的布局」区存在且有保存入口", initial.hasRegion && initial.hasSave, JSON.stringify(initial));
// 用户 10-09：「保存当前布局下面的说明你去掉吧，给下面腾一点空间」——
//   空态不再占一行文案，所以这里反过来守住"没有多余说明节点"。
check("L1b 空态不占一行说明（无 .layout-saved-empty 节点）", initial.count === 0 ? !initial.emptyNode : true, `count=${initial.count} emptyNode=${initial.emptyNode}`);

// ── L2 保存第一套 ──────────────────────────────────────────
await page.locator(".layout-saved-add").click();
await page.waitForTimeout(500);
const afterSave = await slots();
const stored1 = await storedSlots();
check("L2 保存后出现一个槽位（带名字与摘要）", afterSave.length === 1 && afterSave[0].name === "布局 1" && /打谱/.test(afterSave[0].summary), JSON.stringify(afterSave));
check("L2b 槽位写入本机存储（含三个模式的快照）", Array.isArray(stored1) && stored1.length === 1 && stored1[0].layouts?.modes?.record && stored1[0].layouts?.modes?.review && stored1[0].layouts?.modes?.puzzle, JSON.stringify(stored1?.[0]?.layouts?.modes ? Object.keys(stored1[0].layouts.modes) : stored1));

// ── L3 改动布局后一键切回 ─────────────────────────────────
const hiddenOk = await hideFirstBottomTile();
await applyLayout();
const changed = await storedLayout();
const hiddenCount = changed?.modes?.record?.hidden?.length ?? -1;
check("L3a 前置：改动布局并应用后确实变了（隐藏了 1 个按钮）", hiddenOk && hiddenCount === 1, `clicked=${hiddenOk} hidden=${hiddenCount}`);

await closeDrawer();
await openEditor();
await page.locator(".layout-saved-apply").first().click();
await page.waitForTimeout(800);
const restored = await storedLayout();
check("L3b 点槽位一键切回保存的那一套（隐藏项被还原）", (restored?.modes?.record?.hidden?.length ?? -1) === 0, `hidden=${restored?.modes?.record?.hidden?.length}`);

// ── L4 刷新后仍在 ─────────────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await openEditor();
const afterReload = await slots();
check("L4 刷新后槽位仍在（本机持久化）", afterReload.length === 1 && afterReload[0].name === "布局 1", JSON.stringify(afterReload));

// ── L5 存满 5 套 → 保存禁用 ───────────────────────────────
for (let i = 0; i < 5; i += 1) {
  const disabled = await page.evaluate(() => document.querySelector(".layout-saved-add")?.disabled ?? true);
  if (disabled) break;
  await page.locator(".layout-saved-add").click();
  await page.waitForTimeout(350);
}
const full = await page.evaluate(() => ({
  count: document.querySelectorAll(".layout-saved-list > li").length,
  disabled: document.querySelector(".layout-saved-add")?.disabled ?? null,
  title: document.querySelector(".layout-saved-add")?.getAttribute("title") || "",
}));
check("L5 最多 5 套：存满后保存入口禁用并说明原因", full.count === 5 && full.disabled === true && /已存满/.test(full.title), JSON.stringify(full));

// ── L6 删除槽位 ───────────────────────────────────────────
await page.locator(".layout-saved-remove").first().click();
await page.waitForTimeout(500);
const afterRemove = await slots();
const storedAfterRemove = await storedSlots();
check("L6 删除槽位后列表与存储同步减少，保存入口恢复可用", afterRemove.length === 4 && storedAfterRemove.length === 4 && (await page.evaluate(() => document.querySelector(".layout-saved-add")?.disabled)) === false, JSON.stringify({ list: afterRemove.length, store: storedAfterRemove.length }));

// ── L7b 删除中间槽位后再保存，名字不能重复（对抗探针抓到的真 bug） ──────────
// 旧实现用 saved.length + 1 起名：[布局 1, 布局 3] 删掉中间再存会又得到「布局 3」，
// 两个槽位同名分不清。现在取「最小的还没用过的编号」。
{
  const names = await slots();
  if (names.length >= 3) {
    await page.locator(".layout-saved-list > li:nth-child(2) .layout-saved-remove").click();
    await page.waitForTimeout(400);
    await page.locator(".layout-saved-add").click();
    await page.waitForTimeout(400);
    const after = await slots();
    const labels = after.map((slot) => slot.name);
    check("L7b 删除中间槽位后再保存不重名（名字取最小未用编号）", new Set(labels).size === labels.length, `${JSON.stringify(names.map((n) => n.name))} → ${JSON.stringify(labels)}`);
  } else {
    check("L7b 删除中间槽位后再保存不重名（槽位不足 3 个，跳过）", false, `count=${names.length}`);
  }
}

// ── L8 **全部**主题下槽位可见且有对比度（清单从应用读，新增主题自动覆盖） ──
const slotThemeIds = await readThemeIds(page);
const slotRows = await runThemeMatrix(page, slotThemeIds, () => page.evaluate(sampleManyScript([".layout-saved-apply", ".layout-saved-remove", ".layout-saved-add"])));
const slotWeakApply = weakThemes(slotRows, ".layout-saved-apply", 4.5);
const slotWeakButtons = [...weakThemes(slotRows, ".layout-saved-remove", 1.5), ...weakThemes(slotRows, ".layout-saved-add", 1.5)];
check(`L8a 全部 ${slotThemeIds.length} 套主题下槽位文字与底色 ≥4.5:1`, slotWeakApply.length === 0, slotWeakApply.length ? slotWeakApply.join(", ") : `最低 ${minRatioOf(slotRows, ".layout-saved-apply")}`);
check(`L8b 全部 ${slotThemeIds.length} 套主题下删除/保存按钮可见`, slotWeakButtons.length === 0, slotWeakButtons.length ? slotWeakButtons.join(", ") : `${slotThemeIds.length} 套均可见`);

await closeEditor();
await page.evaluate(() => localStorage.setItem("banbu-action-layout-presets-v1", JSON.stringify([{ name: "半条" }, "垃圾", null, { id: "ok-1", name: "  有效   ", savedAt: 1, layouts: { version: 3, modes: {} } }])));
await page.reload({ waitUntil: "domcontentloaded" });
await openEditor();
const salvaged = await slots();
check("L7 坏槽位整条丢弃、只留下能用的那条（编辑器不崩）", salvaged.length === 1 && salvaged[0].name === "有效", JSON.stringify(salvaged));

check("L9 无页面错误", errors.length === 0, errors.join(" | "));
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
