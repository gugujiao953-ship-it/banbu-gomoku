// 编辑面板「整体位移」门禁（用户 09-17：上/下/左/右各移一格，修图片识谱整体偏一格）
//   S1 编辑面板有「位移」按钮，点开是十字方向盘，四个方向齐全
//   S2 静态局面：上/下/左/右移一格，所有棋子坐标整体跟着变（按坐标逐一核对）
//   S3 静态局面下的位移可「撤销」退回
//   S4 有棋子会被移出棋盘时**拒绝**并说明，局面原样不动（不静默裁剪）
//   S5 带手序的棋谱位移后拍平为静态局面（手序归零 + 明确提示）
//   S6 方向盘是全局弹层：关掉编辑面板后按钮跟着没、方向盘仍在，Esc 关得掉（10-02 改）
//   S7 **全部主题**（清单从应用读）下方向盘按钮可见、文字对比 ≥ 4.5:1
// 用法：BANBU_URL=http://[::1]:5297/ node scripts/ui-board-shift-check.mjs
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

const openWorkspace = async () => {
  await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("打谱"))?.click(); });
  await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
  await page.waitForTimeout(700);
};
/** 棋盘上所有已占格子的坐标（A1..O15），用于逐格核对整体位移。 */
const occupied = () => page.evaluate(() => [...document.querySelectorAll('[role="gridcell"]')]
  .filter((cell) => (cell.getAttribute("aria-label") || "").includes("已有棋子"))
  .map((cell) => (cell.getAttribute("aria-label") || "").replace(/已有棋子.*$/, "").trim())
  .filter(Boolean)
  .sort());
const clickCell = async (label) => { await page.evaluate((l) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(l)); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, label); await page.waitForTimeout(450); };
const clickButton = async (label) => { const ok = await page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || x.textContent || "").includes(t)); if (!b) return false; b.click(); return true; }, label); await page.waitForTimeout(450); return ok; };
const toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join(" | "));
const stepLabel = () => page.evaluate(() => [...document.querySelectorAll(".unified-status-lines .unified-status-line")].map((e) => e.textContent || "").join(" · "));
const openShift = async () => {
  if (!(await page.evaluate(() => !!document.querySelector(".board-shift-pad")))) await page.locator(".board-shift-button").click();
  await page.locator(".board-shift-pad").waitFor({ timeout: 6000 });
  await page.waitForTimeout(350);
};
const closeShift = async () => {
  if (await page.locator(".board-shift-pad").count()) await page.keyboard.press("Escape");
  await page.locator(".board-shift-pad").waitFor({ state: "detached" });
  await page.waitForTimeout(350);
};
const shift = async (dir) => { await page.locator(`.board-shift-pad button[aria-label="整体${dir}移一格"]`).click(); await page.waitForTimeout(450); };

await openWorkspace();

// ── S1 入口与方向盘 ────────────────────────────────────────
await clickButton("编辑");
const hasEntry = await page.evaluate(() => !!document.querySelector(".board-shift-button"));
check("S1a 编辑面板里有「位移」按钮", hasEntry);
await openShift();
const pad = await page.evaluate(() => ({
  labels: [...document.querySelectorAll(".board-shift-pad button")].map((b) => b.getAttribute("aria-label")),
  grid: getComputedStyle(document.querySelector(".board-shift-pad")).display,
}));
check("S1b 点开后是四个方向的按钮（上/下/左/右齐全）", ["整体上移一格", "整体下移一格", "整体左移一格", "整体右移一格"].every((l) => pad.labels.includes(l)) && pad.grid === "grid", JSON.stringify(pad.labels));

// ── S2 四方向各移一格 ─────────────────────────────────────
await closeShift();
await clickCell("H8空位");
await clickCell("I8空位");
const before = await occupied();
check("S2a 前置：棋盘两子 H8/I8", JSON.stringify(before) === JSON.stringify(["H8", "I8"]), JSON.stringify(before));
await openShift();
await shift("上");
const afterUp = await occupied();
check("S2b 上移一格 → H9/I9（行号 +1）", JSON.stringify(afterUp) === JSON.stringify(["H9", "I9"]), JSON.stringify(afterUp));
await shift("左");
const afterLeft = await occupied();
check("S2c 左移一格 → G9/H9（列号 -1）", JSON.stringify(afterLeft) === JSON.stringify(["G9", "H9"]), JSON.stringify(afterLeft));

// ── S3 可撤销 ─────────────────────────────────────────────
await closeShift();
await clickButton("撤销编辑");
const afterUndo = await occupied();
check("S3 静态局面下的位移可用「撤销」退回上一步", JSON.stringify(afterUndo) === JSON.stringify(["H9", "I9"]), JSON.stringify(afterUndo));

// ── S4 边缘拒绝 ───────────────────────────────────────────
await openShift();
await shift("右");
const afterRight = await occupied();
check("S4a 右移一格 → I9/J9", JSON.stringify(afterRight) === JSON.stringify(["I9", "J9"]), JSON.stringify(afterRight));
let refused = false;
let refusedOccupied = null;
for (let i = 0; i < 12 && !refused; i += 1) {
  await shift("上");
  const text = await toast();
  if (/移出棋盘/.test(text)) { refused = true; refusedOccupied = await occupied(); break; }
}
check("S4b 顶到上边线后再上移被拒绝并说明原因", refused, `toast="${await toast()}"`);
const stillThere = await occupied();
check("S4c 被拒绝时局面原样不动（不静默裁剪）", JSON.stringify(stillThere) === JSON.stringify(refusedOccupied) && stillThere.length === 2, JSON.stringify(stillThere));
await closeShift();

// ── S5 带手序的棋谱位移会拍平 ─────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await openWorkspace();
await clickCell("H8空位");
await clickCell("I8空位");
await clickCell("J8空位");
const lineStep = await stepLabel();
check("S5a 前置：三手带手序（第 3 手）", lineStep.includes("第 3 手"), lineStep);
// ⚠ reload 会「恢复上次局面」（设置默认开），所以棋盘上还留着上一段的棋子——
// 不能假设是干净的空盘，只能核对**位移前后整体平移一格**这个不变量。
const lineBefore = await occupied();
await clickButton("编辑");
await openShift();
await shift("下");
const flatStep = await stepLabel();
const flatToast = await toast();
check("S5b 位移后拍平为静态局面（手序归零）", !flatStep.includes("第 3 手") && flatStep.includes("第 0 手"), flatStep);
check("S5c 提示里明说已转为静态局面", /静态局面/.test(flatToast), flatToast);
const flatOccupied = await occupied();
const shiftedDown = lineBefore.map((coord) => `${coord[0]}${Number(coord.slice(1)) - 1}`).sort();
check("S5d 拍平后每颗子都整体下移一格（含恢复出来的旧子）", JSON.stringify(flatOccupied) === JSON.stringify(shiftedDown) && flatOccupied.length === lineBefore.length, `before=${JSON.stringify(lineBefore)} after=${JSON.stringify(flatOccupied)}`);

// ── S6 方向盘改成全局弹层（用户 10-02：环形菜单里的「位移」只有名字）──────────
// 以前"跟着编辑面板一起收起"是因为那份 JSX 就挂在面板里；现在它自带遮罩、自己管开关，
// 所以关面板时**按钮**跟着没（按钮本来就在面板里），**方向盘**必须还在，并且 Esc 关得掉。
await clickButton("编辑");
await page.waitForTimeout(600);
const closed = await page.evaluate(() => ({ pad: !!document.querySelector(".board-shift-pad"), button: !!document.querySelector(".board-shift-button") }));
check("S6 关掉编辑面板：「位移」按钮跟着面板没，方向盘不跟着消失（它有自己的遮罩）", closed.pad === true && closed.button === false, JSON.stringify(closed));
await page.keyboard.press("Escape");
await page.waitForTimeout(350);
check("S6b Esc 关得掉方向盘（不留看不见却仍然生效的状态）", await page.evaluate(() => !document.querySelector(".board-shift-pad")));

// ── S7 **全部**主题对比度（清单从应用读，新增主题自动覆盖） ───────────────
await clickButton("编辑");
await openShift();
const shiftThemeIds = await readThemeIds(page);
const shiftRows = await runThemeMatrix(page, shiftThemeIds, () => page.evaluate(sampleManyScript(['.board-shift-pad button[aria-label="整体上移一格"]', ".board-shift-popover"])));
const shiftWeak = weakThemes(shiftRows, '.board-shift-pad button[aria-label="整体上移一格"]', 4.5);
check(`S7 全部 ${shiftThemeIds.length} 套主题下方向盘按钮可见且文字 ≥4.5:1`, shiftWeak.length === 0, shiftWeak.length ? shiftWeak.join(", ") : `最低 ${minRatioOf(shiftRows, '.board-shift-pad button[aria-label="整体上移一格"]')}`);

console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
