import { chromium } from "playwright";

// 常驻门禁：环形菜单（内环分页 + 外环动作）+ 「点棋子/右键回退一步」（用户 09-26 两轮、10-01 分页）
//   菜单现在是两层：内环三格切页（通用 / 分支 / 编辑），外环六槽摆这一页的动作。
//   通用页六项＝去子 / 加书签 / 复制局面 / 跳到此手 / 打标 / 取消；去子只删按住那一颗且不留状态；
//   复制局面是**能粘回导入**的逐行坐标串。切页只换外环、不关菜单。
//   回退：对话场景里点棋盘上任意已下的子＝退一手，电脑上右键同理；右键**优先做回退**，
//   只有开关关掉或在对弈/做题里才回落到"右键呼出环形菜单"的老行为。
//  A1 长按已有棋子 → 通用页六项齐全（打标在默认页，菜单里没有标注类按钮）
//  A2 「去子」只删按住那一颗，编辑面板没被翻开（不留去子态）
//  A3 删完点空位＝正常落子（真有状态残留，这一下会变成再删一颗子）
//  A4 「复制局面」是纯坐标串，能直接粘回导入
//  A5 点已有棋子＝退一手；右键＝退一手；两者都不弹菜单；起始局面只提示、不弹菜单
//  A6 关掉开关后：点棋子不再回退（回到"点不动"），右键空位重新呼出菜单，
//     且「去子」对空位如实拒绝、不把棋谱拍平（这条守卫在 A5 之后是唯一入口，别删）
//  A7 内环切页：三格齐、默认通用、点与沿环滑动都切页、切页不关菜单、各页外环项正确、
//     「删除这一手及之后」有确认框、打标三档循环并在盘上画出角标
//  A8 编辑页「位移」：方向盘真出得来（四枚方向键、整块在视口内）、点「右移」整盘真的右移一格、
//     Esc 关得掉 —— 这条抓的是"外环只有名字、动作是空的"（用户 10-02 报的那条）
// 用法：BANBU_URL=http://127.0.0.1:5413 node scripts/ui-radial-action-check.mjs
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5311/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const clickCell = async (label) => { await page.evaluate((l) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(l)); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, label); await page.waitForTimeout(450); };
const toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join(" | "));
const stepNumber = async () => {
  const text = await page.evaluate(() => [...document.querySelectorAll(".unified-status-line")].map((e) => e.textContent || "").join(" · "));
  const match = text.match(/第\s*(\d+)\s*手/);
  return match ? Number(match[1]) : -1;
};
// 第 n 个「已有棋子」交叉点：屏幕位置（长按/点/右键用）+ DOM 下标（回来核对是否变空位）。
const occupiedAt = (nth = 0) => page.evaluate((skip) => {
  const cells = [...document.querySelectorAll('[role="gridcell"]')].filter((e) => (e.getAttribute("aria-label") || "").includes("已有棋子"));
  const cell = cells[skip];
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  return { index: [...document.querySelectorAll('[role="gridcell"]')].indexOf(cell), label: cell.getAttribute("aria-label"), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}, nth);
const firstEmpty = () => page.evaluate(() => {
  const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").includes("空位"));
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  const label = cell.getAttribute("aria-label") || "";
  return { label, coordinate: label.replace(/空位.*$/, ""), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
const labelAtIndex = (index) => page.evaluate((i) => document.querySelectorAll('[role="gridcell"]')[i]?.getAttribute("aria-label") || "", index);
// 长按门槛是 520ms，按 750ms 留足余量（与 ui-hand-feel-check 同一口径）。
const longPress = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up(); await page.waitForTimeout(400); };
const menuOpen = () => page.evaluate(() => Boolean(document.querySelector(".radial-menu")));
const menuItems = () => page.evaluate(() => {
  const node = document.querySelector(".radial-menu");
  return node ? [...node.querySelectorAll(".radial-menu-item")].map((b) => b.textContent || "") : null;
});
const pickMenuItem = (text) => page.evaluate((t) => { [...document.querySelectorAll(".radial-menu-item")].find((b) => (b.textContent || "").includes(t))?.click(); }, text);

// ── 前置：打谱落三子 ─────────────────────────────────────
await clickCell("H8空位");
await clickCell("I8空位");
await clickCell("J8空位");
check("前置：棋盘三子", (await stoneCount()) === 3, `stones=${await stoneCount()}`);

// ── A1 长按有子的点出菜单 ───────────────────────────────
const pressed = await occupiedAt(0);
check("A1 前置：棋盘上有可长按的棋子", Boolean(pressed), pressed?.label || "none");
if (pressed) {
  await longPress(pressed.x, pressed.y);
  const items = await menuItems();
  check("A1 长按棋子呼出环形菜单：通用页六项（打标在默认页，没有标注类按钮）", items?.join(",") === "去子,加书签,复制局面,跳到此手,打标,取消", JSON.stringify(items));

  // ── A1b 书签开关（用户 09-26 第二次点名加进菜单的）──────
  await pickMenuItem("加书签");
  await page.waitForTimeout(600);
  check("A1b 菜单「加书签」收进分支书签并如实提示", (await toast()).includes("已添加书签"), await toast());
  await longPress(pressed.x, pressed.y);
  const itemsBookmarked = await menuItems();
  check("A1b 收过的这一手再长按，同一格变成「取消书签」", itemsBookmarked?.includes("取消书签") === true, JSON.stringify(itemsBookmarked));
  await pickMenuItem("取消书签");
  await page.waitForTimeout(600);
  check("A1b 再点一次＝取消书签", (await toast()).includes("已取消书签"), await toast());

  // ── A2 菜单「去子」＝只删按住这一颗 ───────────────────
  // A1b 每次选完一项菜单就关了，这里要重新长按呼出（别直接 pick，那样点不到东西）。
  await longPress(pressed.x, pressed.y);
  await pickMenuItem("去子");
  await page.waitForTimeout(600);
  const pressedLabel = await labelAtIndex(pressed.index);
  check("A2 去子后只剩两颗", (await stoneCount()) === 2, `stones=${await stoneCount()}`);
  check("A2 去掉的正是按住的那一颗（该点已成空位）", pressedLabel.includes("空位") && !pressedLabel.includes("已有棋子"), pressedLabel);
  check("A2 没有翻开编辑面板、没有留下常驻的去子态", (await page.evaluate(() => Boolean(document.querySelector(".erase-stone-button")))) === false);
  check("A2 菜单已关闭", !(await menuOpen()));

  // ── A3 之后点空位仍是正常落子 ────────────────────────
  // ⚠ 不能点刚被长按的那个交叉点：Board 在长按触发时记下 suppressedClickPoint，
  // 那一下 click 会被吞掉（防「长按完顺手落子」），在这儿会被误读成「去子状态没退出」。
  const nextEmpty = await firstEmpty();
  const beforeTap = await stoneCount();
  if (nextEmpty && nextEmpty.coordinate !== (pressed.label || "").replace(/已有棋子.*$/, "")) await clickCell(`${nextEmpty.coordinate}空位`);
  check("A3 删完再点空位＝正常落子（没停在删子状态）", (await stoneCount()) === beforeTap + 1 && !(await toast()).includes("去子模式"), `点到 ${nextEmpty?.coordinate}，stones=${await stoneCount()}`);
}

// ── A4 复制局面＝逐行手序 + 变化 ────────────────────────
// 先退到起始局面，再在别处落一手，造出一条真正的分支（同一岔口的两个变化）。
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(400);
const backAtRoot = await stepNumber();
const forkPoint = await firstEmpty();
check("A4 前置：方向键退回起始局面、找到空位", backAtRoot === 0 && Boolean(forkPoint), `第 ${backAtRoot} 手 ${forkPoint?.coordinate}`);
if (forkPoint) {
  await clickCell(`${forkPoint.coordinate}空位`);
  // 把主线延长到三手：复制出来的只有主线，太短就退化成"一手"这种测不出问题的场景。
  for (let step = 0; step < 2; step += 1) {
    const point = await firstEmpty();
    if (point) await clickCell(`${point.coordinate}空位`);
  }
  const pressed3 = await occupiedAt(0);
  if (pressed3) {
    await longPress(pressed3.x, pressed3.y);
    await pickMenuItem("复制局面");
    await page.waitForTimeout(700);
    // Windows 上剪贴板会把 "\n" 规范成 "\r\n"（除末行外每行末尾多个 \r），断言前先归一。
    const clip = (await page.evaluate(() => navigator.clipboard.readText().catch(() => ""))).replace(/\r\n?/g, "\n");
    const lines = clip.split("\n").filter(Boolean);
    check("A4 剪贴板是纯坐标串（一手一行，可直接粘回导入）", lines.length >= 2 && lines.every((line) => /^[A-O](1[0-5]|[1-9])$/.test(line)), JSON.stringify(lines));
    check("A4 正文里没有夹带中文（夹一个整份就废）", !/[\u4e00-\u9fa5]/.test(clip), clip.slice(0, 40));
    check("A4 菜单已关闭", !(await menuOpen()));
    // 「粘得回来」由单测做真闭环（radial-menu.test.ts：复制 → 导入器 → 再复制逐字相同）。
    // 这里不重复走一遍 UI 导入：导入面板的入口在打谱页里要先开浮层选格式，
    // 而这段门禁盯的是"菜单与剪贴板"，把导入流程搬进来只会让它更脆。
  }
}

// ── A5 点已有棋子 / 右键＝退一手 ────────────────────────
// 「点棋子回退一步」**默认关闭**（用户 09-26 体验后定的口径），所以先显式打开再验行为。
await page.evaluate(() => {
  const key = "banbu-enhancement-settings-v1";
  const current = JSON.parse(localStorage.getItem(key) || "{}");
  localStorage.setItem(key, JSON.stringify({ ...current, tapStonePrev: true }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
if ((await stoneCount()) === 0) { await clickCell("H8空位"); await clickCell("I8空位"); }
// 恢复出来的局面可能停在起始局面：落一子把它推到第 1 手（键盘前进在会话刚恢复时不一定生效）。
if ((await stepNumber()) === 0) { const seed = await firstEmpty(); if (seed) await clickCell(`${seed.coordinate}空位`); }
const stepBeforeA5 = await stepNumber();
// ⚠ 不能用刚在 A4 里被长按过的那颗子（occupiedAt(0)）：长按会记下 suppressedClickPoint，
// 紧接着落在同一个点上的 click 被吞掉——那会被误读成「点棋子没回退」。换一颗子点。
const tapTarget = (await occupiedAt(1)) || (await occupiedAt(0));
check("A5 前置：当前不在起始局面且有子可点", stepBeforeA5 >= 1 && Boolean(tapTarget), `第 ${stepBeforeA5} 手 ${tapTarget?.label}`);
if (tapTarget) {
  await page.mouse.click(tapTarget.x, tapTarget.y);   // 左键点已有棋子
  await page.waitForTimeout(450);
  check("A5 点已有棋子＝退回一手", (await stepNumber()) === stepBeforeA5 - 1, `第 ${stepBeforeA5} 手 → 第 ${await stepNumber()} 手`);
  check("A5 点棋子不会弹出环形菜单", !(await menuOpen()));
  // 前进一手，再用右键退回来（键盘前进在默认开关下可用）。
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const stepBeforeRight = await stepNumber();
  const rightTarget = await occupiedAt(0);
  if (rightTarget) {
    await page.mouse.click(rightTarget.x, rightTarget.y, { button: "right" });
    await page.waitForTimeout(450);
    check("A5 右键＝退回一手", (await stepNumber()) === stepBeforeRight - 1, `第 ${stepBeforeRight} 手 → 第 ${await stepNumber()} 手`);
    check("A5 右键不再呼出环形菜单（改由长按呼出）", !(await menuOpen()));
  }
  // 起始局面：点棋子与右键都只提示，都不弹菜单（同一个右键不能有两个含义）。
  if ((await stepNumber()) === 0) {
    const atRoot = await occupiedAt(0);
    if (atRoot) await page.mouse.click(atRoot.x, atRoot.y);
    await page.waitForTimeout(400);
    const noteAtRoot = await toast();
    if (atRoot) await page.mouse.click(atRoot.x, atRoot.y, { button: "right" });
    await page.waitForTimeout(400);
    check("A5 起始局面点棋子/右键只提示、不弹菜单", (await stepNumber()) === 0 && !(await menuOpen()) && noteAtRoot.includes("起始局面"), `toast=${noteAtRoot}`);
  }
}

// ── A6 关掉开关：回到"点不动"，右键重新呼出菜单 ──────────
await page.evaluate(() => {
  const key = "banbu-enhancement-settings-v1";
  const current = JSON.parse(localStorage.getItem(key) || "{}");
  localStorage.setItem(key, JSON.stringify({ ...current, tapStonePrev: false }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
if ((await stoneCount()) === 0) { await clickCell("H8空位"); await clickCell("I8空位"); }
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
const stepBeforeOff = await stepNumber();
const offTarget = await occupiedAt(0);
if (offTarget) {
  await page.mouse.click(offTarget.x, offTarget.y);
  await page.waitForTimeout(450);
  check("A6 开关关闭后点棋子不再回退（回到点不动）", (await stepNumber()) === stepBeforeOff, `第 ${stepBeforeOff} 手 → 第 ${await stepNumber()} 手`);
}
const offEmpty = await firstEmpty();
if (offEmpty) {
  const stonesBefore = await stoneCount();
  const stepBefore = await stepNumber();
  await page.mouse.click(offEmpty.x, offEmpty.y, { button: "right" });
  await page.waitForTimeout(450);
  const items = await menuItems();
  check("A6 开关关闭后右键空位重新呼出环形菜单（老行为回落）", Boolean(items), JSON.stringify(items));
  await pickMenuItem("去子");
  await page.waitForTimeout(600);
  const note = await toast();
  check("A6 空位去子被拒绝：棋子数不变", (await stoneCount()) === stonesBefore, `stones=${await stoneCount()} toast=${note}`);
  check("A6 空位去子没有把棋谱拍平（手序仍在原处）", (await stepNumber()) === stepBefore, `第 ${stepBefore} 手 → 第 ${await stepNumber()} 手`);
  check("A6 提示如实说明没有棋子", note.includes("没有棋子"), note);
}

// ── A7 内环切页（用户 10-01：菜单加内环；第二轮重排成三页）──────────
// 内环三格是 SVG 扇区：点一格切页、沿环按住拖到另一格也切页；切页**不关菜单**。
const wedgeLabels = () => page.evaluate(() => [...document.querySelectorAll(".radial-menu-pages g[role='tab'] text")].map((t) => t.textContent || ""));
const ringPage = () => page.evaluate(() => document.querySelector(".radial-menu-pages")?.getAttribute("data-ring") || "");
const tapWedge = (index) => page.click(`.radial-menu-pages g[role='tab']:nth-child(${index}) path`);
// ⚠ 菜单开着时 backdrop 是全屏的（z-index 46），在棋盘上长按会先打到它、把菜单关掉。
// 所以每次要重新长按之前，先确认菜单已经关了。
const closeMenu = async () => { if (await menuOpen()) { await page.keyboard.press("Escape"); await page.waitForTimeout(350); } };
// 环上某一格中心的屏幕坐标（角度：相对正上方顺时针，三页时 0/120/240）。
const wedgePoint = async (deg) => {
  const rect = await page.evaluate(() => { const r = document.querySelector(".radial-menu-pages").getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: r.width / 2 }; });
  const rad = deg * Math.PI / 180;
  return { x: rect.cx + Math.sin(rad) * rect.r * .62, y: rect.cy - Math.cos(rad) * rect.r * .62 };
};
const a7Empty = await firstEmpty();
if (a7Empty) {
  await page.mouse.click(a7Empty.x, a7Empty.y, { button: "right" });
  await page.waitForTimeout(450);
  const wedges = await wedgeLabels();
  check("A7 内环三格齐：通用/分支/编辑（标注页已删，标注交回标注栏与空位长按）", wedges.join(",") === "通用,分支,编辑", JSON.stringify(wedges));
  check("A7 呼出菜单默认落在「通用」页", (await ringPage()) === "general", await ringPage());
  await tapWedge(2);
  await page.waitForTimeout(400);
  check("A7 点内环切页后菜单仍然开着（切页不该关掉整圈）", (await menuOpen()) && (await ringPage()) === "branch", `menu=${await menuOpen()} ring=${await ringPage()}`);
  const branchItems = await menuItems();
  // 复制与粘贴成对：只有「复制分支」而没有粘贴入口，复制完就没下文。
  check("A7 分支页外环＝设为主分支/复制分支/粘贴到这里/跳到此手/删除这一手及之后/取消",
    branchItems?.join(",") === "设为主分支,复制分支,粘贴到这里,跳到此手,删除这一手及之后,取消", JSON.stringify(branchItems));
  // 沿环滑动切页：在分支格（右下 120°）按住，拖到编辑格（左下 240°）再抬。
  const from = await wedgePoint(120);
  const to = await wedgePoint(240);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const editItems = await menuItems();
  check("A7 沿环滑动切页：分支 → 编辑", (await ringPage()) === "edit" && editItems?.join(",") === "位移,旋转,镜像,撤销,重做,取消", `ring=${await ringPage()} ${JSON.stringify(editItems)}`);
  // 破坏性那条必须落在确认框后面（复用树里 deleteTreeBranch 的确认，不另造一层）。
  let dialogMessage = "";
  page.once("dialog", async (dialog) => { dialogMessage = dialog.message(); await dialog.dismiss(); });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const stoneForDelete = await occupiedAt(0);
  if (stoneForDelete) {
    await closeMenu();
    await longPress(stoneForDelete.x, stoneForDelete.y);
    await tapWedge(2);   // 三页里的第 2 格＝分支
    await page.waitForTimeout(400);
    const stonesBeforeDelete = await stoneCount();
    await pickMenuItem("删除这一手");
    await page.waitForTimeout(500);
    check("A7 「删除这一手及之后」先问一遍，取消后一颗子都没少", dialogMessage.includes("确定删除") && (await stoneCount()) === stonesBeforeDelete, `dialog=${dialogMessage.slice(0, 30)} stones=${await stoneCount()}`);
  }
}
// 打标三档循环（用户 10-01 并入这一轮）：作用在**按下的那一手**上，标签跟着状态变。
const stoneToTag = await occupiedAt(0);
if (stoneToTag) {
  await closeMenu();
  await longPress(stoneToTag.x, stoneToTag.y);   // 打标在默认页上，不用切页
  await page.waitForTimeout(400);
  check("A7 未标的这一手按钮就叫「打标」", (await menuItems())?.[4] === "打标", JSON.stringify(await menuItems()));
  await pickMenuItem("打标");
  await page.waitForTimeout(700);
  check("A7 打标第一下＝好棋，且盘上真的画出了角标",
    (await toast()).includes("标为好棋") && await page.evaluate(() => Boolean(document.querySelector(".evaluation-mark.good"))), await toast());
  await longPress(stoneToTag.x, stoneToTag.y);   // 打标在默认页上，不用切页
  await page.waitForTimeout(400);
  check("A7 已标好棋的这一手，同一格显示「打标·好棋」", (await menuItems())?.[4] === "打标·好棋", JSON.stringify(await menuItems()));
  await pickMenuItem("打标");
  await page.waitForTimeout(700);
  check("A7 再点一下换成坏棋（三档循环：好棋→坏棋→疑问手→清除）", (await toast()).includes("标为坏棋"), await toast());
}

// ── A8 编辑页「位移」：方向盘真得出来（用户 10-02：「长按菜单里面的移子也用不了，
//     光有名字，不知道往哪边移动」——那份 JSX 以前挂在 dockPanel === "notes" 里面，
//     从环形菜单点进来只有名字、方向盘一个都不出）───────────────────────────────
{
  const occupiedLabels = () => page.evaluate(() => [...document.querySelectorAll('[role="gridcell"]')]
    .map((cell) => cell.getAttribute("aria-label") || "")
    .filter((text) => text.includes("已有棋子"))
    .map((text) => text.replace("已有棋子", "")));
  const shiftTarget = await occupiedAt(0);
  if (shiftTarget) {
    await longPress(shiftTarget.x, shiftTarget.y);
    await tapWedge(3);   // 三页里的第 3 格＝编辑
    await page.waitForTimeout(400);
    const beforeShift = await occupiedLabels();
    await pickMenuItem("位移");
    await page.waitForTimeout(550);
    const pad = await page.evaluate(() => {
      const node = document.querySelector(".board-shift-popover");
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { buttons: node.querySelectorAll(".board-shift-pad button").length, top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right), bottom: Math.round(rect.bottom) };
    });
    const viewport = page.viewportSize() || { width: 392, height: 852 };
    check("A8 环形菜单「编辑页 → 位移」弹出方向盘，四枚方向键齐全（改前实测 0 个）",
      Boolean(pad) && pad?.buttons === 4, JSON.stringify(pad));
    check("A8 方向盘整块在视口内（不被底部导航压住、也不顶出上边）",
      Boolean(pad) && pad.top >= 0 && pad.left >= 0 && pad.right <= viewport.width && pad.bottom <= viewport.height,
      `${JSON.stringify(pad)} / 视口 ${viewport.width}×${viewport.height}`);
    // 取「右移」而不是「上移」：A7 那几步在 15 路顶边（A15/B15/C15）留了子，
    // 往上整体会被"不许把子移出棋盘"这条守卫拒绝（那是 ui-board-shift-check S4b 的题），
    // 这一条要验的是"动作真的执行了"。
    await page.evaluate(() => document.querySelector(".board-shift-right")?.click());
    await page.waitForTimeout(650);
    const afterShift = await occupiedLabels();
    const expectRight = beforeShift.map((name) => `${String.fromCharCode(name.charCodeAt(0) + 1)}${name.slice(1)}`).sort().join(",");
    check("A8 点「右移」整盘真的右移一格（不是只弹个框）",
      afterShift.slice().sort().join(",") === expectRight && /已整体.*移一格/.test(await toast()),
      `${JSON.stringify(beforeShift)} → ${JSON.stringify(afterShift)}，期望 ${expectRight}，toast="${(await toast()).slice(0, 30)}"`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    check("A8 Esc 关得掉方向盘", !(await page.evaluate(() => Boolean(document.querySelector(".board-shift-popover")))));
  } else {
    check("A8 前置：棋盘上还有子可长按", false, "前面几步把子删完了");
  }
}

check("无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}`);
await browser.close();
process.exitCode = failed ? 1 : 0;
