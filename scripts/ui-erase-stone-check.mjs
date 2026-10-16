import { chromium } from "playwright";
import { readThemeIds, runThemeMatrix, sampleContrastScript, weakThemes, minRatioOf } from "./lib/theme-matrix.mjs";

// 常驻门禁：去子功能（2026-09-11 用户需求；09-17 按用户改版重写开关语义）
//  E1 进入去子后**按钮自身**变成开启态（aria-pressed=true + 斜纹图案底 + 对勾），
//     且状态栏不再有「去子中 · 退出」按钮（用户 09-17：不要那个退出按钮）
//  E2 编辑面板保持打开（面板关掉就看不出还在去子）
//  E3 点已有棋子删除（无论哪一手）；带手序/分支的棋谱首次删除拍平为静态局面
//  E4 拍平不可撤销（草稿清空）；拍平后删子走草稿可悔改恢复
//  E5 点空位不删子；**再点一次按钮**结束；离开编辑面板也自动结束（不留隐形状态）
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-erase-stone-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const clickCell = async (label) => { await page.evaluate((l) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(l) || (e.getAttribute("aria-label") || "").endsWith(l)); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, label); await page.waitForTimeout(500); };
const clickText = async (text, selector = "button") => { await page.evaluate(([t, s]) => { [...document.querySelectorAll(s)].find((b) => (b.getAttribute("aria-label") || b.textContent || "").includes(t))?.click(); }, [text, selector]); await page.waitForTimeout(500); };
const toast = async () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join(" | ") || "");
const stepLabel = () => page.evaluate(() => { const lines = [...document.querySelectorAll(".unified-status-lines .unified-status-line")].map((e) => e.textContent || ""); return lines.join(" · "); });
// 去子开关的状态读写：**必须点按钮本身**。原先用「找含『去子』文字的按钮」在
// 多段流程里会点错目标（F 段其实把它关掉了，G 段又关一次＝没变化），断言随之假红。
const erasePressed = () => page.evaluate(() => document.querySelector(".erase-stone-button")?.getAttribute("aria-pressed") ?? "absent");
const setEraseStone = async (on) => {
  if ((await erasePressed() === "true") === on) return;
  await page.locator(".erase-stone-button").click();
  await page.waitForTimeout(500);
};

// ── 打谱落三子 ─────────────────────────────────────────
await clickCell("H8空位");
await clickCell("I8空位");
await clickCell("J8空位");
check("前置：棋盘三子", (await stoneCount()) === 3, `stones=${await stoneCount()}`);
const stepBefore = await stepLabel();
console.log("  手序：", stepBefore);

// ── 编辑 → 去子 ────────────────────────────────────────
await clickText("编辑");
await page.waitForTimeout(400);
await setEraseStone(true);
const eraseState = await page.evaluate(() => {
  const button = document.querySelector(".erase-stone-button");
  if (!button) return null;
  const style = getComputedStyle(button);
  return {
    pressed: button.getAttribute("aria-pressed"),
    flag: button.getAttribute("data-erase-stone"),
    pattern: style.backgroundImage,
    outline: style.boxShadow,
    color: style.color,
    hasCheck: !!button.querySelector("svg"),
    exitButton: [...document.querySelectorAll("button")].some((b) => (b.getAttribute("aria-label") || "") === "退出去子"),
  };
});
check("A1 按钮自身变为开启态（aria-pressed/data 标志）", eraseState?.pressed === "true" && eraseState?.flag === "on", JSON.stringify(eraseState));
check("A2 开启态有图案与描边（不是只有文字变化）", /repeating-linear-gradient/.test(eraseState?.pattern || "") && (eraseState?.outline || "") !== "none", `bg=${eraseState?.pattern?.slice(0, 40)} shadow=${eraseState?.outline}`);
check("A3 状态栏不再出现「去子中 · 退出」按钮", eraseState?.exitButton === false);
const dockOpen = await page.evaluate(() => !!document.querySelector(".dock-panel-notes"));
check("B 进入去子后编辑面板保持打开（按钮就在里面，关掉就看不出状态）", dockOpen);

// ── 点已有棋子删除 ─────────────────────────────────────
await clickCell("I8已有棋子");
const afterErase = await stoneCount();
check("C 点棋子删除（3→2）", afterErase === 2, `stones=${afterErase}`);
check("C2 toast 提示删除", (await toast()).includes("已删除"), await toast());
check("C3 拍平后草稿清空（拍平不可撤销，悔棋禁用）", (await page.evaluate(() => { const u = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "撤销编辑"); return u ? u.disabled : true; })), "undo-disabled");

// ── 点空位不删 ────────────────────────────────────────
const emptyBefore = await stoneCount();
await clickCell("K8空位");
check("D 点空位不删子", (await stoneCount()) === emptyBefore, `stones=${await stoneCount()}`);

// ── 静态删子后撤销恢复（拍平后的删子走草稿，悔棋一次即恢复） ──
await clickCell("J8已有棋子"); // 静态局面删一颗（2→1）
const afterStaticErase = await stoneCount();
check("E0 静态局面删子（2→1）", afterStaticErase === 1, `stones=${afterStaticErase}`);
await clickText("撤销编辑");
const undoStones = await stoneCount();
check("E 悔棋撤销恢复被删之子", undoStones === 2, `stones=${undoStones}`);

// ── 再次进入去子删子后，棋谱变静态：再落子应为第1手 ──────
await setEraseStone(true);
await clickCell("I8已有棋子");
const stepAfter = await stepLabel();
console.log("  拍平后手序：", stepAfter);
check("F 拍平后手序归零（第 0/1 手，不再是第 3 手）", !stepAfter.includes("第 3 手") && !stepAfter.includes("第 4 手"), stepAfter);

// ── 再点一次按钮结束模式 ───────────────────────────────
await setEraseStone(false);
const closed = await page.evaluate(() => {
  const button = document.querySelector(".erase-stone-button");
  return { pressed: button?.getAttribute("aria-pressed"), flag: button?.getAttribute("data-erase-stone"), pattern: getComputedStyle(button).backgroundImage };
});
check("G 再点一次按钮结束去子（标志复位、图案消失）", closed.pressed === "false" && closed.flag === "off" && !/repeating-linear-gradient/.test(closed.pattern || ""), JSON.stringify(closed));
// 点空位此时应恢复为正常落子（说明去子真的失效了，不是只剩样式）
const stonesBeforePlay = await stoneCount();
await clickCell("K8空位");
check("G2 结束去子后点空位恢复正常落子", (await stoneCount()) === stonesBeforePlay + 1, `stones ${stonesBeforePlay}→${await stoneCount()}`);

// ── 离开编辑面板自动结束（不留看不见的去子状态） ─────────
await setEraseStone(true);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "") === "编辑"); b?.click(); });
await page.waitForTimeout(600);
const leftPanel = await page.evaluate(() => ({ dock: !!document.querySelector(".dock-panel-notes"), pressed: document.querySelector(".erase-stone-button")?.getAttribute("aria-pressed") ?? "absent" }));
check("G3 关掉编辑面板后自动结束去子（面板不在时按钮也没了）", leftPanel.dock === false, JSON.stringify(leftPanel));
const stonesBeforeAfterLeave = await stoneCount();
await clickCell("L8空位");
check("G4 自动结束后点空位恢复正常落子（没有隐形去子）", (await stoneCount()) === stonesBeforeAfterLeave + 1, `stones ${stonesBeforeAfterLeave}→${await stoneCount()}`);

// ── 去子模式与读谱互斥 ─────────────────────────────────
// ── 全部主题下开启态可辨（用户长期要求：新样式必须适配**全部**主题） ─────
// ⚠ 上一段（G3）刻意关掉了编辑面板验证自动结束，这里要先把它开回来，否则按钮不存在。
await clickText("编辑");
await page.waitForTimeout(500);
await setEraseStone(true);
const eraseThemeIds = await readThemeIds(page);
const eraseRows = await runThemeMatrix(page, eraseThemeIds, () => page.evaluate(sampleContrastScript(".erase-stone-button")));
const eraseWeak = weakThemes(eraseRows, ".erase-stone-button", 4.5);
const eraseNoPattern = eraseRows.filter((row) => !/repeating-linear-gradient/.test(row.sample?.backgroundImage || "")).map((row) => row.theme);
check(`I1 全部 ${eraseThemeIds.length} 套主题下去子开启态都有斜纹图案`, eraseNoPattern.length === 0, eraseNoPattern.length ? eraseNoPattern.join(", ") : `${eraseThemeIds.length} 套均有图案`);
check(`I2 全部 ${eraseThemeIds.length} 套主题下图标文字与底色 ≥4.5:1`, eraseWeak.length === 0, eraseWeak.length ? eraseWeak.join(", ") : `最低 ${minRatioOf(eraseRows, ".erase-stone-button")}`);
await setEraseStone(false);


check("H 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
