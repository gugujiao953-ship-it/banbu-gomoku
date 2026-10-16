// 识谱「叠图核对」门禁（用户 09-17：识别完把结果叠回原图核对，可改错子，确认才建谱）
// 09-23 改版（用户）：闪烁对比 → 显式编辑模式（编辑中徽标/退出/去子/移子/黑白切换固定档）
//   V1 识别完成**不再直接建谱**，而是停在核对屏（棋盘没变、没有新棋谱）
//   V2 叠图层按识别到的网格画圆：圆圈数 = 识别子数；网格线画出来（外框更亮）
//   V3 四种看法：叠图 / 只看原图（覆盖层隐藏）/ 只看识别（原图隐藏）/ 编辑
//   V3z 不在编辑模式时点棋子**不改子**（旧版是隐式的点一下就改，09-23 明确废掉）
//   V4 编辑模式：右上角「编辑中」徽标 + 退出；工具行 = 黑白切换（固定档）/去子/移子
//      V4a 补子：去子腾出空位 → 放黑 → 切白改色
//      V4b 去子：点棋子移除
//      V4c 移子：点子选中 → 点空位搬过去（总数不变、旧位消失新位出现）
//      V4d 微调：选中后四向按钮各挪一格（先去子腾出目标格，保证确定）
//      V4e 退出编辑：徽标与工具行消失
//   V5 确认导入 → 真的建谱（棋子数一致）且**默认停在编辑面板**（用户要求的落点）
//   V6 取消 → 不建谱，回到原来的棋谱
//   V7 返回对齐 → 回到对齐屏
// 用法：BANBU_URL=http://[::1]:5297/ node scripts/ui-recognition-verify-check.mjs
import { chromium } from "playwright";
import { resolve } from "node:path";
import { readThemeIds, runThemeMatrix, sampleManyScript, weakThemes, minRatioOf } from "./lib/theme-matrix.mjs";

const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://[::1]:5297/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const image = resolve(process.cwd(), "qa/fixtures/recognition/app-played-game.png");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(url.href, { waitUntil: "domcontentloaded" });

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const verifyState = () => page.evaluate(() => {
  const screen = document.querySelector(".image-verify");
  if (!screen) return null;
  const stones = [...document.querySelectorAll("[data-verify-stone]")];
  const photo = document.querySelector(".image-verify-photo");
  return {
    stones: stones.length,
    black: stones.filter((el) => el.classList.contains("black")).length,
    white: stones.filter((el) => el.classList.contains("white")).length,
    keys: stones.map((el) => el.getAttribute("data-verify-stone")),
    lines: document.querySelectorAll(".image-verify-lines line").length,
    frames: document.querySelectorAll('.image-verify-lines line[data-frame="true"]').length,
    photoHidden: photo?.getAttribute("data-hidden"),
    hint: document.querySelector(".image-verify-hint")?.textContent?.trim() || "",
    modes: [...document.querySelectorAll(".image-verify-modes button")].map((b) => (b.textContent || "").trim()),
    editing: document.querySelector(".image-verify-editing") !== null,
    tools: [...document.querySelectorAll(".image-verify-tools button")].map((b) => (b.textContent || "").trim()),
    exit: document.querySelector(".image-verify-exit") !== null,
  };
});
const boardStones = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
// 交叉点的屏幕坐标直接从覆盖层的网格线读：竖线给出每列 x、横线给出每行 y。
// 这样点「已经被去子腾空的交叉点」也不再依赖棋子 DOM（棋子都没了就没得量）。
const gridPoints = () => page.evaluate(() => {
  const lines = [...document.querySelectorAll(".image-verify-lines line")];
  // 屏幕坐标必须走 getBoundingClientRect：线的 x1/y1 属性是 SVG viewBox 内的用户
  // 坐标，与屏幕差着整个 frame 的偏移（实测 x +12、y +177，点了全落空）。
  const xs = [...new Set(lines.filter((l) => Math.abs(Number(l.getAttribute("y1")) - Number(l.getAttribute("y2"))) > 1).map((l) => { const r = l.getBoundingClientRect(); return r.x + r.width / 2; }))].sort((a, b) => a - b);
  const ys = [...new Set(lines.filter((l) => Math.abs(Number(l.getAttribute("x1")) - Number(l.getAttribute("x2"))) > 1).map((l) => { const r = l.getBoundingClientRect(); return r.y + r.height / 2; }))].sort((a, b) => a - b);
  return { xs, ys };
});
const clickPoint = async (row, col) => {
  const { xs, ys } = await gridPoints();
  await page.mouse.click(xs[col], ys[row]);
  await page.waitForTimeout(400);
};
const parseKey = (key) => ({ row: Number(key.split("-")[0]), col: Number(key.split("-")[1]) });
const clickStone = async (key) => {
  const { row, col } = parseKey(key);
  await clickPoint(row, col);
};

const startRecognition = async () => {
  await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("打谱"))?.click(); });
  await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelector(".bottom-nav .nav-center")?.click(); });
  await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
  await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(image);
  await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
  await page.locator(".board-fs-actions button:has-text('识别')").click();
  await page.locator(".image-verify").waitFor({ timeout: 120000 });
  await page.waitForTimeout(600);
};

await startRecognition();

// ── V1 停在核对屏 ─────────────────────────────────────────
const state = await verifyState();
check("V1a 识别完停在核对屏（没有直接建谱）", Boolean(state), JSON.stringify(state && { stones: state.stones }));
check("V1b 核对屏列出识别到的棋子数（>4 且黑白都有）", state.stones > 4 && state.black > 0 && state.white > 0, `stones=${state.stones} 黑=${state.black} 白=${state.white}`);
check("V1c 棋盘上没有新棋谱（还没导入）", (await boardStones()) === 0, `stones=${await boardStones()}`);

// ── V1d~f 版式与入口（R125，用户 10-02：「下面的内容把棋盘顶上面了，我要棋盘一直可见」
//   +「ai辅助识别按钮这个功能暂时不加」）────────────────────────────
const layout = await page.evaluate(() => {
  const stage = document.querySelector(".image-verify-stage");
  const panel = document.querySelector(".image-verify-panel");
  const footer = document.querySelector(".image-verify-actions");
  const box = (el) => el ? el.getBoundingClientRect() : null;
  const s = box(stage), f = box(footer);
  return {
    stageTop: s ? Math.round(s.top) : null,
    stageBottom: s ? Math.round(s.bottom) : null,
    footerBottom: f ? Math.round(f.bottom) : null,
    innerHeight: Math.round(window.innerHeight),
    panelScrollable: panel ? getComputedStyle(panel).overflowY === "auto" || getComputedStyle(panel).overflowY === "scroll" : false,
    panelOverflows: panel ? panel.scrollHeight > panel.clientHeight : false,
    // 整屏不许再滚：不然用户「往下滚才看到棋盘」，而棋盘是核对要一直看的东西
    pageScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight > 2,
    aiButtons: [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("AI 辅助识别")).map((b) => (b.textContent || "").trim()),
  };
});
check("V1d 叠图舞台完整在视口内（不滚动就一直看得见）", layout.stageTop !== null && layout.stageTop >= 0 && layout.stageBottom <= layout.innerHeight, JSON.stringify(layout));
check("V1e 确认/取消按钮不靠滚动才够得着", layout.footerBottom !== null && layout.footerBottom <= layout.innerHeight && !layout.pageScrolls, `footerBottom=${layout.footerBottom} 视口高=${layout.innerHeight} 整页可滚=${layout.pageScrolls}`);
check("V1f 下半部分内容区自己滚（内容多时不挤掉棋盘）", layout.panelScrollable, `panel 可滚=${layout.panelScrollable} 内容超出=${layout.panelOverflows}`);
check("V1g 没有「AI 辅助识别」入口（该功能没上过线，入口按用户要求撤掉）", layout.aiButtons.length === 0, JSON.stringify(layout.aiButtons));

// ── V2 叠图层几何 ─────────────────────────────────────────
check("V2a 画出了识别网格线（含 4 条更亮的外框）", state.lines === 15 * 2 && state.frames === 4, `lines=${state.lines} frames=${state.frames}`);
check("V2b 覆盖层圆圈数 = 识别子数", state.stones === state.black + state.white, `${state.stones} = ${state.black}+${state.white}`);

// ── V3 四种看法 ───────────────────────────────────────────
check("V3a 有四种方式按钮（叠图/只看原图/只看识别/编辑）", ["叠图", "只看原图", "只看识别", "编辑"].every((label) => state.modes.includes(label)), JSON.stringify(state.modes));
await page.locator(".image-verify-modes button:has-text('只看原图')").click();
await page.waitForTimeout(350);
const photoOnly = await verifyState();
check("V3b 只看原图：原图可见、覆盖层隐藏", photoOnly.photoHidden === "false" && (await page.evaluate(() => !document.querySelector(".image-verify-overlay"))), JSON.stringify({ photoHidden: photoOnly.photoHidden }));
await page.locator(".image-verify-modes button:has-text('只看识别')").click();
await page.waitForTimeout(350);
const resultOnly = await verifyState();
check("V3c 只看识别：原图隐藏、覆盖层在", resultOnly.photoHidden === "true" && resultOnly.stones > 4, JSON.stringify({ photoHidden: resultOnly.photoHidden, stones: resultOnly.stones }));
await page.locator(".image-verify-modes button:has-text('叠图')").click();
await page.waitForTimeout(350);

// ── V3z 不在编辑模式时点棋子不改子（旧版点一下就改，09-23 明确废掉） ──
const outside = await verifyState();
await clickStone(outside.keys[0]);
const afterOutsideTap = await verifyState();
check("V3z 未进编辑时点棋子不改子（提示进入编辑）", afterOutsideTap.stones === outside.stones && afterOutsideTap.hint.includes("编辑"), `stones ${outside.stones}→${afterOutsideTap.stones} hint=${afterOutsideTap.hint.slice(0, 30)}`);

// ── V4 编辑模式 ───────────────────────────────────────────
await page.locator(".image-verify-modes button:has-text('编辑')").click();
await page.waitForTimeout(400);
const editState = await verifyState();
check("V4a 进入编辑：右上角「编辑中」徽标 + 退出按钮", editState.editing && editState.exit, `editing=${editState.editing} exit=${editState.exit}`);
check("V4b 工具行：黑白切换（黑/白）+ 放子 + 去子，且不再有移子", ["黑", "白", "放子", "去子"].every((label) => editState.tools.includes(label)) && !editState.tools.includes("移子"), JSON.stringify(editState.tools));
const shiftButtons = await page.evaluate(() => [...document.querySelectorAll(".image-verify-shift button")].map((b) => b.getAttribute("aria-label")));
check("V4b-2 整盘位移四向按钮**常驻**（无需先点棋子）", shiftButtons.length === 4 && ["整体上移一格", "整体下移一格", "整体左移一格", "整体右移一格"].every((label) => shiftButtons.includes(label)), JSON.stringify(shiftButtons));

// V4c 补子（固定档颜色，不再一手一手循环）：
// 先用去子腾出一个确定为空的点，再放黑、再切白改色——全程不依赖初始颜色。
const spotA = editState.keys[0];
const eraseTool = () => page.locator(".image-verify-tools button:has-text('去子')").click();
const placeTool = () => page.locator(".image-verify-tools button:has-text('放子')").click();
await eraseTool();
await clickStone(spotA);
const afterEraseA = await verifyState();
check("V4c-1 去子：点棋子移除（总数 -1）", afterEraseA.stones === editState.stones - 1 && !afterEraseA.keys.includes(spotA), `${editState.stones} → ${afterEraseA.stones}`);
await placeTool();
await page.waitForTimeout(300);
await clickStone(spotA);
const afterPlaceBlack = await verifyState();
check("V4c-2 放黑子：空位补黑（恢复总数，黑 +1）", afterPlaceBlack.stones === editState.stones && afterPlaceBlack.keys.includes(spotA) && afterPlaceBlack.black === afterEraseA.black + 1, `黑 ${afterEraseA.black}→${afterPlaceBlack.black}`);
await page.locator(".image-verify-player button:has-text('白')").click();
await page.waitForTimeout(300);
await clickStone(spotA);
const afterFlipWhite = await verifyState();
check("V4c-3 黑白切换是固定档：改放白 = 点子改色（黑-1 白+1，总数不变）", afterFlipWhite.stones === editState.stones && afterFlipWhite.black === afterPlaceBlack.black - 1 && afterFlipWhite.white === afterPlaceBlack.white + 1, `黑${afterPlaceBlack.black}→${afterFlipWhite.black} 白${afterPlaceBlack.white}→${afterFlipWhite.white}`);

// V4c2 位移一次成功：挑一个「全部棋子都挪得动」的方向，点一下，键整体平移一格。
// 无需选子——09-23 二改明确位移按钮常驻；语义对齐编辑面板的「位移」。
const keyOf = (r, c) => `${r}-${c}`;
const board = 15;
const dirs = [
  { dr: 0, dc: 1, label: "整体右移一格" },
  { dr: 0, dc: -1, label: "整体左移一格" },
  { dr: 1, dc: 0, label: "整体下移一格" },
  { dr: -1, dc: 0, label: "整体上移一格" },
];
const shiftedKey = (k, d) => keyOf(parseKey(k).row + d.dr, parseKey(k).col + d.dc);
const fitsAll = (keys, d) => keys.every((k) => {
  const p = parseKey(k);
  return p.row + d.dr >= 0 && p.row + d.dr < board && p.col + d.dc >= 0 && p.col + d.dc < board;
});
const shiftButton = (label) => page.locator(`.image-verify-shift button[aria-label="${label}"]`);
const shiftDir = dirs.find((d) => fitsAll(afterFlipWhite.keys, d));
if (!shiftDir) { check("V4d 位移一次成功", false, "四个方向都顶边（不应发生）"); }
else {
  const expected = afterFlipWhite.keys.map((k) => shiftedKey(k, shiftDir)).sort();
  await shiftButton(shiftDir.label).click();
  await page.waitForTimeout(400);
  const afterShift = await verifyState();
  check("V4d 位移一次成功：全部棋子整体平移一格（无需选子）", afterShift.stones === afterFlipWhite.stones && JSON.stringify(afterShift.keys.slice().sort()) === JSON.stringify(expected), `${shiftDir.label}：${afterFlipWhite.keys.slice().sort().join(" ")} → ${afterShift.keys.slice().sort().join(" ")}`);

  // V4e 顶边拒绝：朝同一方向一路挪到出盘，被拒的那一下键必须原样不动、有明确提示
  // （不静默裁剪——裁过的局面看起来像「识别又错了几颗」，比原样不动更难排查）。
  let rejected = null;
  let current = afterShift;
  for (let attempt = 0; attempt < board && !rejected; attempt += 1) {
    await shiftButton(shiftDir.label).click();
    await page.waitForTimeout(400);
    const after = await verifyState();
    if (after.hint.includes("取消")) {
      rejected = JSON.stringify(after.keys.slice().sort()) === JSON.stringify(current.keys.slice().sort()) ? after : null;
      break;
    }
    current = after;
  }
  check("V4e 顶边拒绝：出盘时明确取消、不静默裁剪（键不变）", rejected !== null, rejected ? `提示：${rejected.hint}` : "挪完也没被拒（不应发生）");
}
const afterMove = await verifyState();

// V4f 退出编辑
await page.locator(".image-verify-exit").click();
await page.waitForTimeout(400);
const exited = await verifyState();
check("V4f 退出编辑：徽标与工具行消失、选中清空", !exited.editing && !exited.exit && exited.tools.length === 0 && exited.stones === afterMove.stones, `editing=${exited.editing} tools=${exited.tools.length} stones=${exited.stones}`);

// ── V9 全主题下核对屏可读（用户长期要求：新界面必须适配**全部**主题） ─────
// 主题清单从应用读（.app-shell[data-theme-options]），以后加主题自动覆盖。
const verifyThemeIds = await readThemeIds(page);
const verifyRows = await runThemeMatrix(page, verifyThemeIds, () => page.evaluate(sampleManyScript([".image-verify-modes button", ".image-verify-confirm", ".image-verify-note"])));
const verifyWeakMode = weakThemes(verifyRows, ".image-verify-modes button", 4.5);
const verifyWeakNote = weakThemes(verifyRows, ".image-verify-note", 3);
const verifyWeakConfirm = weakThemes(verifyRows, ".image-verify-confirm", 3);
check(`V9a 全部 ${verifyThemeIds.length} 套主题下模式按钮可见且文字 ≥4.5:1`, verifyWeakMode.length === 0, verifyWeakMode.length ? verifyWeakMode.join(", ") : `最低 ${minRatioOf(verifyRows, ".image-verify-modes button")}`);
check(`V9b 全部 ${verifyThemeIds.length} 套主题下说明文字 ≥3:1`, verifyWeakNote.length === 0, verifyWeakNote.length ? verifyWeakNote.join(", ") : `最低 ${minRatioOf(verifyRows, ".image-verify-note")}`);
check(`V9c 全部 ${verifyThemeIds.length} 套主题下「确认导入」按钮可见且文字 ≥3:1`, verifyWeakConfirm.length === 0, verifyWeakConfirm.length ? verifyWeakConfirm.join(", ") : `最低 ${minRatioOf(verifyRows, ".image-verify-confirm")}`);

// ── V7 返回对齐 ───────────────────────────────────────────
await page.locator(".image-verify-back").click();
await page.waitForTimeout(700);
const backToAlign = await page.evaluate(() => ({ verify: !!document.querySelector(".image-verify"), align: !!document.querySelector(".board-fs-actions") }));
check("V7 「返回对齐」回到对齐屏（核对屏收起）", backToAlign.verify === false && backToAlign.align === true, JSON.stringify(backToAlign));

// ── V6 取消不建谱 ─────────────────────────────────────────
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
const expectedStones = (await verifyState()).stones;
await page.locator(".image-verify-cancel").click();
await page.waitForTimeout(700);
const afterCancel = await page.evaluate(() => ({ verify: !!document.querySelector(".image-verify"), stones: document.querySelectorAll(".stone-piece").length }));
check("V6 取消后不建谱（核对屏收起、棋盘仍为空）", afterCancel.verify === false && afterCancel.stones === 0, JSON.stringify(afterCancel));

// ── V5 确认导入 → 建谱 + 默认进编辑面板 ───────────────────
await page.evaluate(() => { document.querySelector(".bottom-nav .nav-center")?.click(); });
await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(image);
await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
await page.locator(".board-fs-actions button:has-text('识别')").click();
await page.locator(".image-verify").waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
const confirmedStones = (await verifyState()).stones;
await page.locator(".image-verify-confirm").click();
await page.waitForTimeout(1200);
const imported = await page.evaluate(() => ({
  verify: !!document.querySelector(".image-verify"),
  stones: document.querySelectorAll(".stone-piece").length,
  dockNotes: !!document.querySelector(".dock-panel-notes"),
  eraseButton: !!document.querySelector(".erase-stone-button"),
  shiftButton: !!document.querySelector(".board-shift-button"),
  title: document.querySelector(".unified-status-name")?.textContent?.trim() || "",
}));
check("V5a 确认导入真的建了谱（棋子数与核对屏一致）", imported.verify === false && imported.stones === confirmedStones, `核对屏 ${confirmedStones} → 棋盘 ${imported.stones}`);
check("V5b 导入后默认停在编辑面板（用户要求的落点）", imported.dockNotes && imported.eraseButton && imported.shiftButton, JSON.stringify(imported));

check("V8 无页面错误", errors.length === 0, errors.join(" | "));
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
