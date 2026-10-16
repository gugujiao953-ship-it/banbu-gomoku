/**
 * qa/puzzle-mode-not-generator.mjs — 钉住「做题应该是做题，不是跳到题目生成器」（用户 2026-10-06）。
 *
 * 复现路径：在「对弈 → 进入生成器」真生成一道题（生成器每收一道就自动存进题库，带 generated 证明链），
 * 然后点打谱页顶部的「做题」——以前 `openPuzzle` 一碰到 generated 就把人弹回生成器，
 * 现在必须进做题页（有棋盘、模式选中「做题」，且没有生成器顶栏）。
 * 用法：node qa/puzzle-mode-not-generator.mjs [base]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5199/";
const clickByText = (page, text) => page.evaluate((t) => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().includes(t));
  if (b) { b.click(); return true; }
  return false;
}, text);
const clickNav = (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const b = nav ? Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === l) : null;
  if (b) b.click();
}, label);
const state = (page) => page.evaluate(() => {
  const toggle = document.querySelector(".topbar-mode-toggle");
  const selected = toggle ? Array.from(toggle.querySelectorAll("button")).find((b) => b.getAttribute("aria-selected") === "true") : null;
  return {
    mode: selected ? selected.textContent.trim() : null,
    generatorTopbar: !!document.querySelector(".generator-topbar"),
    generatorPrimary: !!document.querySelector(".generator-primary"),
    board: !!document.querySelector(".board-svg, .workspace-board svg, svg.board"),
    puzzleToolbar: !!document.querySelector(".puzzle-mode-selectors, .workspace-status.puzzle-mode"),
  };
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) { await clickByText(page, "先自己试试"); await page.waitForTimeout(400); }

// ① 生成一道题（3 手最快），生成器会自动存进题库
await clickNav(page, "对弈");
await page.waitForTimeout(700);
await clickByText(page, "进入生成器");
await page.waitForTimeout(900);
await page.evaluate(() => {
  const input = document.querySelector('input[aria-label="目标手数"]');
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "5");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await page.waitForTimeout(300);
await clickByText(page, "生成新题");
let produced = false;
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1000);
  produced = await page.evaluate(() => !!document.querySelector('.generator-status')?.textContent?.includes("已保存") || document.querySelectorAll(".generator-puzzle-card, .generator-item, .generator-result").length > 0);
  const status = await page.evaluate(() => document.querySelector(".generator-status")?.textContent ?? "");
  if (produced || /已保存|保存了/.test(status)) { produced = true; break; }
  if (/失败|错误/.test(status)) break;
}
console.log(`生成器出题：${produced ? "已产出并自动入库" : "没等到产出（后面用已入库的题也一样）"}`);
await page.waitForTimeout(800);

// ② 把「上次会话」对准那道生成题，刷新后让它自动打开——这正是用户遇到的场景
//    （下标漂移/按 id 恢复到一道生成题，以前会被弹回生成器）
const target = await page.evaluate(() => {
  const raw = localStorage.getItem("renju-note-puzzle-collections-v1");
  if (!raw) return null;
  const collections = JSON.parse(raw);
  for (const c of collections) for (const p of c.puzzles) if (p.generated) return { collectionId: c.id, puzzleId: p.id, title: c.puzzles.length };
  return null;
});
console.log("题库里的生成题：" + JSON.stringify(target));
if (!target) { console.log("✗ 生成器没有把带证明的题存进题库，无法验证这条路径"); await browser.close(); process.exit(1); }
await page.evaluate((t) => {
  const raw = localStorage.getItem("banbu-last-session-v1");
  const base = raw ? JSON.parse(raw) : { documentId: "x", nodeId: "x" };
  localStorage.setItem("banbu-last-session-v1", JSON.stringify({ ...base, mode: "puzzle", puzzleCollectionId: t.collectionId, puzzleId: t.puzzleId }));
  localStorage.setItem("banbu-restore-last-position-v1", "1");
}, target);
await page.waitForTimeout(300);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) { await clickByText(page, "先自己试试"); await page.waitForTimeout(400); }
const restored = await state(page);
console.log("按 id 恢复到生成题之后：" + JSON.stringify(restored));

// ③ 再点一次顶部的「做题」
await page.evaluate(() => {
  const toggle = document.querySelector(".topbar-mode-toggle");
  const b = toggle ? Array.from(toggle.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "做题") : null;
  if (b) b.click();
});
await page.waitForTimeout(1500);
const after = await state(page);
console.log("点「做题」之后：" + JSON.stringify(after));
const ok = after.mode === "做题" && !after.generatorTopbar && !after.generatorPrimary
  && restored.mode === "做题" && !restored.generatorTopbar;
console.log(ok ? "✓ 生成题也是在做题页打开（不再跳去题目生成器）" : "✗ 又跳到生成器了");
if (errors.length) console.log("页面报错：" + errors.slice(0, 4).join(" | "));
await browser.close();
process.exit(ok ? 0 : 1);
