import { chromium } from "playwright";

// 常驻门禁：做题功能区布局 + 做题分析（用户 2026-09-10 两次钦定 + 当日反馈）
//  P1 做题只两行：首行功能区 + 常驻走棋区；常驻操作区为空
//  P2 首行功能区 = 分析/摆棋·应战/VCF/禁手规则/更多（应战·摆棋互斥显示，5 格一行）
//     ——做题不需要标注/编辑/分支树，不得出现；黑白切换已上移状态条，不在首行
//  P3 常驻走棋区顺序：上一题 → 选题 → 下一题 → 悔棋 → 重启
//  P4 状态文字 + 黑白切换渲染在首行功能区之上（切换在状态条右侧）
//  P5 黑白切换：应战可换边（状态文字同步、重启/换题回题目默认）；摆棋可切摆放色
//  P6 做题「分析」= 永远提示模式：不展开面板、直接落一子（预算 5s，杀棋即落）
//  P7 读谱默认与打谱默认一致（首行+常驻；走棋区不比较）
//  P9 重启清场：回到初始局面且不留之前落子/变化点痕迹
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-puzzle-layout-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const switchMode = async (label) => { await page.evaluate((name) => { const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === name); b?.click(); }, label); await page.waitForTimeout(1400); };
const rowLabels = (selector) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()), selector);
const rowActionIds = (selector) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-action-id]`)].map((el) => el.getAttribute("data-action-id")), selector);
const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const clickPuzzleAction = async (label) => { await page.evaluate((name) => { [...document.querySelectorAll(".action-bottom-row button")].find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim() === name)?.click(); }, label); await page.waitForTimeout(900); };
// 状态条黑白切换的当前状态：选中的色（黑棋/白棋）与各按钮 disabled。
const switchState = () => page.evaluate(() => {
  const slot = document.querySelector(".puzzle-color-switch-slot .stone-color-switch");
  if (!slot) return null;
  const checked = slot.querySelector('[role="radio"][aria-checked="true"]');
  return { side: checked?.getAttribute("aria-label") || "", buttons: [...slot.querySelectorAll("button")].map((b) => b.disabled) };
});
const restartPuzzle = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll(".puzzle-nav-row button")].find((x) => x.getAttribute("aria-label") === "重启"); b?.click(); }); await page.waitForTimeout(600); };

// ── P1/P2 做题两行结构 ───────────────────────────────────
await switchMode("做题");
const puzzleBottom = await rowLabels(".action-bottom-row");
const puzzleNav = await rowLabels(".puzzle-nav-row");
const topRows = await page.evaluate(() => document.querySelectorAll(".action-top-row").length);
const movesRows = await page.evaluate(() => document.querySelectorAll(".moves-row").length);
check("P1 做题只两行（首行功能区 + 常驻走棋区，无常驻操作区）", topRows === 0 && movesRows === 1 && puzzleBottom.length > 0, `topRows=${topRows} movesRows=${movesRows}`);
// 黑白切换已上移状态条：首行 5 格 = 分析/摆棋(应战中)/VCF/禁手规则/更多。
const bottomOk = puzzleBottom.length === 5 && puzzleBottom[0].startsWith("分析") && puzzleBottom[1] === "摆棋" && puzzleBottom[2] === "VCF 生成器"
  && /禁手/.test(puzzleBottom[3]) && puzzleBottom[4] === "更多";
check("P2 首行功能区 = 分析/摆棋(应战中)/VCF/禁手规则/更多（5 格一行，黑白切换已上移）", bottomOk, JSON.stringify(puzzleBottom));
const stripped = puzzleBottom.filter((l) => l === "标注" || l === "编辑" || l.startsWith("打开分支树"));
check("P2b 做题不含标注/编辑/分支树", stripped.length === 0, JSON.stringify(stripped));

// ── P3 常驻走棋区顺序 ───────────────────────────────────
check("P3 常驻走棋区顺序 = 上一题/选题/下一题/悔棋/重启", JSON.stringify(puzzleNav) === JSON.stringify(["上一题", "选题", "下一题", "悔棋", "重启"]), JSON.stringify(puzzleNav));

// ── P4 状态文字与黑白切换在首行功能区之上（切换靠右） ────
check("P2d VCF 生成器在首行功能区", puzzleBottom.includes("VCF 生成器"), JSON.stringify(puzzleBottom));

const geometry = await page.evaluate(() => {
  const status = document.querySelector(".workspace-status.puzzle-mode");
  const bottom = document.querySelector(".action-bottom-row");
  const nav = document.querySelector(".puzzle-nav-row");
  const slot = document.querySelector(".puzzle-color-switch-slot");
  if (!status || !bottom || !nav || !slot) return null;
  const s = status.getBoundingClientRect(), b = bottom.getBoundingClientRect(), n = nav.getBoundingClientRect(), t = slot.getBoundingClientRect();
  return { statusTop: Math.round(s.top), bottomTop: Math.round(b.top), navTop: Math.round(n.top), slotTop: Math.round(t.top), slotRightGap: Math.round(s.right - t.right), slotLeft: Math.round(t.left), copyRight: Math.round((document.querySelector(".puzzle-status-copy")?.getBoundingClientRect().right || 0)) };
});
check("P4 状态文字在首行功能区之上（且首行在走棋区之上）", !!geometry && geometry.statusTop < geometry.bottomTop && geometry.bottomTop < geometry.navTop, JSON.stringify(geometry));
check("P4b 黑白切换在状态条内、首行之上、右侧", !!geometry && geometry.slotTop < geometry.bottomTop && geometry.slotRightGap >= 0 && geometry.slotRightGap <= 12 && geometry.slotLeft >= geometry.copyRight - 1, JSON.stringify(geometry));

// ── P5 黑白切换：应战可换边（重启回默认），摆棋可切摆放色 ──
const defaultSide = (await switchState())?.side;
check("P5a 应战状态条黑白切换存在且默认色有效", defaultSide === "黑棋" || defaultSide === "白棋", `side=${defaultSide}`);
const otherSide = defaultSide === "黑棋" ? "白棋" : "黑棋";
const otherLabel = otherSide === "黑棋" ? "黑" : "白";
await page.evaluate((label) => { [...document.querySelectorAll('.puzzle-color-switch-slot button[role="radio"]')].find((x) => x.getAttribute("aria-label") === label)?.click(); }, otherSide);
await page.waitForTimeout(350);
const afterSwitch = await switchState();
const statusText = await page.evaluate(() => document.querySelector(".puzzle-status-copy>span")?.textContent || "");
check("P5b 应战换边立即生效（选中与状态文字同步）", afterSwitch?.side === otherSide && statusText.startsWith(otherLabel), `side=${afterSwitch?.side} status=${statusText}`);
await restartPuzzle();
const afterRestart = await switchState();
check("P5c 重启后换边复位（回到题目默认色）", afterRestart?.side === defaultSide, `side=${afterRestart?.side} want=${defaultSide}`);
await clickPuzzleAction("摆棋");
const setupNav = await rowLabels(".puzzle-nav-row");
const setupPanelNav = await rowLabels(".dock-panel");
const setupColor = await switchState();
const setupColorEnabled = Array.isArray(setupColor?.buttons) && setupColor.buttons.every((d) => !d);
const FIVE = ["上一题", "选题", "下一题", "悔棋", "重启"];
check("P5d 摆棋时走棋行仍是题目五键（用户 09-10 复选）", JSON.stringify(setupNav) === JSON.stringify(FIVE), `nav=${JSON.stringify(setupNav)}`);
check("P5e 摆棋的局面导航在弹层里 + 切换可点", ["摆棋起点", "摆棋上一手", "摆棋下一手", "摆棋终点"].every((l) => setupPanelNav.includes(l)) && setupColorEnabled === true, `panel=${JSON.stringify(setupPanelNav)} colorEnabled=${setupColorEnabled}`);
check("P5f 摆棋时首行显示应战（摆棋/应战互斥显示）", (await rowLabels(".action-bottom-row")).includes("应战"), JSON.stringify(await rowLabels(".action-bottom-row")));
await clickPuzzleAction("应战");

// ── P6 做题分析 = 提示模式（≤5s 预算，杀棋即落） ─────────
const before = await stoneCount();
const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").startsWith("分析（提示模式")); b?.click(); return !!b; });
let placed = 0;
for (let i = 0; i < 60; i += 1) { await page.waitForTimeout(400); placed = (await stoneCount()) - before; if (placed > 0) break; }
const panelOpen = await page.evaluate(() => !!document.querySelector(".ai-analysis-panel"));
check("P6 做题分析=提示模式：点一下直接落子且不展开面板", clicked && placed > 0 && !panelOpen, `clicked=${clicked} placed=${placed} panelOpen=${panelOpen}`);
await page.waitForTimeout(2200);

// ── P9 重启清场：回到初始局面、不留之前落子/变化点痕迹 ──
await restartPuzzle();
const after = await page.evaluate(() => ({ stones: document.querySelectorAll(".stone-piece").length, variations: document.querySelectorAll(".renlib-variation").length, thinking: !!document.querySelector(".board-thinking-indicator") }));
check("P9 重启回到初始局面：石子数复原、无变化点痕迹、无思考指示", after.stones === before && after.variations === 0 && !after.thinking, JSON.stringify(after));

// ── P7 读谱/打谱默认一致 ────────────────────────────────
await switchMode("读谱");
const reviewBottom = await rowActionIds(".action-bottom-row");
const reviewTop = await rowActionIds(".action-top-row");
await switchMode("打谱");
const recordBottom = await rowActionIds(".action-bottom-row");
const recordTop = await rowActionIds(".action-top-row");
check("P7 读谱默认与打谱默认一致（首行+常驻）", JSON.stringify(reviewBottom) === JSON.stringify(recordBottom) && JSON.stringify(reviewTop) === JSON.stringify(recordTop), `review=${JSON.stringify([reviewBottom, reviewTop])} record=${JSON.stringify([recordBottom, recordTop])}`);
check("P8 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
