import { chromium } from "playwright";

// 常驻门禁：手感增强六项（用户 09-17 第二批）
//  H1 双指旋转：合成双指事件拧 90°，棋盘朝向变化（棋子落点改变），且不误落子
//  H2 手数滑轨：两侧各一条，拖动跳手、状态条「第 N 手」同步
//  H3 长按环形菜单：长按已有棋子出菜单、默认落在内环「通用」页那五项、点空白关闭
//  H4 状态条可点化：点「第 N 手」开跳手浮层；点轮次换落子颜色
//  H5 键盘流：数字键跳手、Delete 删当前手（打谱）、读谱空格播放
//  H6 画中画：整功能已在 09-26 删除，只留一条"棋盘与设置里都不再留痕"的反向断言
//  H7 开关关闭后 DOM 逐字复原（滑轨/菜单/小窗按钮都不出现）
// 用法：BANBU_URL=http://localhost:5311 node scripts/ui-hand-feel-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5311/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
// 每次运行都从"出厂默认"开始：H7 会把六项开关写成 false 并 reload，若不清理，
// 下一次运行开局就是全关（H1/H3 会假失败）。
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  // 只在本 context 的第一次导航时清设置：H7 自己会写"全关"再 reload，
  // 若每次导航都清，就把 H7 的写入也抹了（那一段会全红）。
  if (!sessionStorage.getItem("hand-feel-gate-fresh")) {
    localStorage.removeItem("banbu-enhancement-settings-v1");
    sessionStorage.setItem("hand-feel-gate-fresh", "1");
  }
});
await page.goto(rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const stepLabel = () => page.evaluate(() => {
  const lines = [...document.querySelectorAll(".unified-status-lines .unified-status-line")].map((e) => e.textContent || "");
  return lines.join(" · ");
});
const stepNumber = async () => {
  const label = await stepLabel();
  const match = label.match(/第\s*(\d+)\s*手/);
  return match ? Number(match[1]) : -1;
};
const clickCell = async (label) => {
  await page.evaluate((l) => {
    const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(l));
    c?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await page.waitForTimeout(420);
};
const boardBox = async () => page.evaluate(() => {
  const svg = document.querySelector("svg.renju-board");
  const rect = svg.getBoundingClientRect();
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
});
// 棋盘某点（H8 等）在屏幕上的位置：按 SVG 坐标换算，避免依赖内部实现。
const cellCenter = async (row, col, size = 15) => page.evaluate(([r, c, s]) => {
  const svg = document.querySelector("svg.renju-board");
  const rect = svg.getBoundingClientRect();
  const margin = 34;
  const span = 572 - margin * 2;
  const gap = span / (s - 1);
  return { x: rect.x + (rect.width * (margin + c * gap)) / 572, y: rect.y + (rect.height * (margin + r * gap)) / 572 };
}, [row, col, size]);

// ── 前置：摆三子（H8/I8/J8 对应 row 7, col 7/8/9）──────────
await clickCell("H8空位");
await clickCell("I8空位");
await clickCell("J8空位");
const stonesBefore = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
check("前置：棋盘三子", stonesBefore === 3, `stones=${stonesBefore}`);
check("前置：手数=3", (await stepNumber()) === 3, `第 ${await stepNumber()} 手`);

// ── H2 手数滑轨（09-23 改版：横向条，位于棋盘下方、首行功能区之上）────
const railCount = await page.evaluate(() => document.querySelectorAll(".board-move-rail").length);
check("H2 横向滑轨出现（主线非空）", railCount === 1, `rails=${railCount}`);
const railGeom = await page.evaluate(() => {
  const rail = document.querySelector(".board-move-rail").getBoundingClientRect();
  const svg = document.querySelector("svg.renju-board").getBoundingClientRect();
  const bottomRow = document.querySelector(".action-bottom-row")?.getBoundingClientRect();
  return {
    rail: { top: Math.round(rail.top), bottom: Math.round(rail.bottom), left: Math.round(rail.left), right: Math.round(rail.right) },
    boardBottom: Math.round(svg.bottom),
    bottomRowTop: bottomRow ? Math.round(bottomRow.top) : null,
  };
});
check("H2 滑轨在棋盘下方", railGeom.rail.top >= railGeom.boardBottom - 2, `railTop=${railGeom.rail.top} boardBottom=${railGeom.boardBottom}`);
check("H2 滑轨在首行功能区之上", railGeom.bottomRowTop === null || railGeom.rail.bottom <= railGeom.bottomRowTop + 2, `railBottom=${railGeom.rail.bottom} bottomRowTop=${railGeom.bottomRowTop}`);
check("H2 滑轨铺满内容宽度（不是窄条）", railGeom.rail.right - railGeom.rail.left > 100, `w=${railGeom.rail.right - railGeom.rail.left}`);
// 轨道内嵌手数读数（用户 09-23）：拖动时不用再去看状态条。
const readout = await page.evaluate(() => {
  const node = document.querySelector(".board-move-rail-readout");
  if (!node) return null;
  const track = document.querySelector(".board-move-rail-track").getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return {
    text: (node.textContent || "").trim(),
    insideTrack: rect.left >= track.left - 1 && rect.right <= track.right + 1,
    color: style.color, background: style.backgroundColor,
  };
});
check("H2 轨道里显示「当前/总」手数", Boolean(readout) && readout.text.replace(/\s/g, "") === "3/3", JSON.stringify(readout?.text));
check("H2 读数被夹在轨道内（靠两端不溢出）", Boolean(readout?.insideTrack), `inside=${readout?.insideTrack}`);
const noSideRail = await page.evaluate(() => document.querySelectorAll('.board-move-rail[data-side]').length);
check("H2 棋盘两侧不再有竖条", noSideRail === 0, `sideRails=${noSideRail}`);
// 拖动到最左端 → 回到起始局面
const railBox = await page.evaluate(() => {
  const track = document.querySelector(".board-move-rail-track");
  const rect = track.getBoundingClientRect();
  return { left: rect.left, right: rect.right, y: rect.y + rect.height / 2 };
});
await page.mouse.move(railBox.right - 6, railBox.y);
await page.mouse.down();
await page.mouse.move(railBox.left + 3, railBox.y, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
const afterDrag = await stepNumber();
check("H2 拖到最左=回到起始局面", afterDrag === 0, `第 ${afterDrag} 手`);
// 点击轨道右段 → 朝右走一手
await page.mouse.click(railBox.right - 6, railBox.y);
await page.waitForTimeout(500);
const afterTap = await stepNumber();
check("H2 点轨道右段=下一手", afterTap === 1, `第 ${afterTap} 手`);

// ── H4 状态条：三段都回到纯文本（用户 09-23：那行字太小、不好点，
//        三件事都有平替——跳手用滑轨、锁颜色用首行黑白切换、保存用首行保存按钮）──
const tappable = await page.evaluate(() => document.querySelectorAll(".unified-status-line .status-tap").length);
check("H4 状态条没有任何可点分段", tappable === 0, `taps=${tappable}`);
const statusLines = await page.evaluate(() => [...document.querySelectorAll(".unified-status-line")].map((e) => e.textContent || ""));
check("H4 状态条仍是两行纯文本（含手数与轮次）", statusLines.length === 2 && /第\s*\d+\s*手/.test(statusLines[1]) && /方落子/.test(statusLines[1]), JSON.stringify(statusLines));
const statusTitleIsButton = await page.evaluate(() => document.querySelector(".unified-status-title")?.tagName === "BUTTON");
check("H4 点整块标题仍能切换棋谱（唯一保留的点击）", statusTitleIsButton);
// 点标题应打开棋谱选择浮层，且不弹任何跳手浮层
await page.evaluate(() => { document.querySelector(".unified-status-title")?.click(); });
await page.waitForTimeout(600);
const selectorOpen = await page.evaluate(() => Boolean(document.querySelector(".workspace-selector, .sheet-body, [class*='selector']")));
const noJumpSheet = await page.evaluate(() => !document.querySelector(".move-jump-sheet"));
check("H4 点标题打开棋谱选择、且不弹跳手浮层", selectorOpen && noJumpSheet, `selector=${selectorOpen} noJumpSheet=${noJumpSheet}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// ── H5 键盘流 ───────────────────────────────────────────
await page.evaluate(() => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith("H8")); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await page.waitForTimeout(300);
await page.keyboard.press("Digit1");
await page.waitForTimeout(400);
check("H5 数字键跳手（按 1 到第 1 手）", (await stepNumber()) === 1, `第 ${await stepNumber()} 手`);
// 组合窗 800ms：两次按键必须紧凑，中间不能夹断言（断言本身要走一次 evaluate 往返）。
await page.keyboard.press("Digit1");
await page.waitForTimeout(150);
await page.keyboard.press("Digit2");
await page.waitForTimeout(400);
check("H5 连按两位=第 12 手（超出主线时落到末手）", (await stepNumber()) === 3, `第 ${await stepNumber()} 手`);
// Delete 删当前手（当前在末手，删它应回到第 2 手且少一子）
const stonesPreDelete = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
await page.keyboard.press("Delete");
await page.waitForTimeout(600);
const stonesPostDelete = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
check("H5 Delete 删当前手", stonesPostDelete === stonesPreDelete - 1 && (await stepNumber()) === 2, `stones ${stonesPreDelete}→${stonesPostDelete}, 第 ${await stepNumber()} 手`);

// ── H1 双指旋转 ─────────────────────────────────────────
const boardRotation = () => page.evaluate(() => document.querySelector(".board-scroller")?.getAttribute("data-rotation") || "none");
const stoneLayout = () => page.evaluate(() => [...document.querySelectorAll(".stone-piece")]
  .map((stone) => { const rect = stone.getBoundingClientRect(); return `${Math.round(rect.x)},${Math.round(rect.y)}`; })
  .sort().join("|"));
const rotationBefore = await boardRotation();
const stonePosBefore = await stoneLayout();
const center = await cellCenter(7, 7);
// 合成双指：两指水平相对，绕中心拧约 90°（旋转手势要求双指距离基本不变、横向位移 < 72）。
// 用 CDP 真触摸事件（项目既有手势门禁 ui-gesture-tap-check 的成熟做法）——自造
// PointerEvent 过不了 WebView/Chromium 的指针管线，实测不触发手势。
const r = 60;
const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : points.map((pt, index) => ({ x: Math.round(pt.x), y: Math.round(pt.y), id: 900 + index })) });
await touch("touchStart", [{ x: center.x - r, y: center.y }, { x: center.x + r, y: center.y }]);
// 分步拧：从 0° 到 100°，同时保持两指距离恒定（正好 r 半径的圆上）
for (let deg = 10; deg <= 100; deg += 10) {
  // 一次手势只转一格（实测锁：不锁会连转 4 次回到原点）
  const rad = (deg * Math.PI) / 180;
  await touch("touchMove", [
    { x: center.x - Math.cos(rad) * r, y: center.y - Math.sin(rad) * r },
    { x: center.x + Math.cos(rad) * r, y: center.y + Math.sin(rad) * r },
  ]);
  await page.waitForTimeout(30);
}
await touch("touchEnd", []);
await page.waitForTimeout(500);
const stonePosAfter = await stoneLayout();
const stonesAfterRotate = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const rotationAfter = await boardRotation();
check("H1 双指旋转：拧一次只转 90°", rotationBefore === "0" && rotationAfter === "90", `${rotationBefore}° → ${rotationAfter}°`);
check("H1 双指旋转改变了棋子落点", stonePosBefore !== stonePosAfter, `${stonePosBefore} → ${stonePosAfter}`);
check("H1 旋转不误落子", stonesAfterRotate === stonesPostDelete, `stones=${stonesAfterRotate}`);

// ── H3 长按环形菜单 ─────────────────────────────────────
// 长按已有棋子（末手 J8 → 旋转后位置变了，改用棋盘上任意有子的点：按 aria-label 找「已有棋子」）
const occupied = await page.evaluate(() => {
  const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").includes("已有棋子"));
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, label: cell.getAttribute("aria-label") };
});
check("H3 前置：棋盘上有棋子可长按", Boolean(occupied), occupied?.label || "none");
if (occupied) {
  await page.mouse.move(occupied.x, occupied.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => {
    const node = document.querySelector(".radial-menu");
    if (!node) return null;
    return { items: [...node.querySelectorAll(".radial-menu-item")].map((b) => b.textContent || ""), disabled: [...node.querySelectorAll(".radial-menu-item")].filter((b) => b.disabled).length };
  });
  check("H3 长按棋子呼出环形菜单", Boolean(menu), JSON.stringify(menu));
  if (menu) {
    check("H3 通用页六项齐全（10-01 第二轮：标注页删掉，打标并进默认页）", menu.items.join(",") === "去子,加书签,复制局面,跳到此手,打标,取消", menu.items.join(","));
    // 点空白关闭
    await page.mouse.click(4, 4);
    await page.waitForTimeout(350);
    check("H3 点空白关闭菜单", !(await page.evaluate(() => Boolean(document.querySelector(".radial-menu")))));
    // 再开一次，验证「复制局面」真的写进剪贴板
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.mouse.move(occupied.x, occupied.y);
    await page.mouse.down();
    await page.waitForTimeout(750);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.evaluate(() => { [...document.querySelectorAll(".radial-menu-item")].find((b) => (b.textContent || "").includes("复制局面"))?.click(); });
    await page.waitForTimeout(600);
    // Windows 剪贴板会把 "\n" 规范成 "\r\n"（除末行外每行末尾多一个 \r），断言前归一。
    const clip = (await page.evaluate(() => navigator.clipboard.readText().catch(() => ""))).replace(/\r\n?/g, "\n");
    // 09-26 第三次定稿：复制出来的是**能直接粘回导入**的纯坐标串（一手一行）。
    const clipLines = clip.split("\n").filter(Boolean);
    check("H3 复制局面写入剪贴板：纯坐标串、一手一行", clipLines.length >= 2 && clipLines.every((line) => /^[A-O](1[0-5]|[1-9])$/.test(line)), clipLines.slice(0, 4).join(" "));
    check("H3 选中后菜单关闭", !(await page.evaluate(() => Boolean(document.querySelector(".radial-menu")))));
  }
}

// ── H6 画中画：整功能已在 09-26 按用户要求删除（入口看得见、点了没反应——接线早断了），
//       这一段随之删掉；只留一条反向断言，防止它哪天又被接回来。
const pipGone = await page.evaluate(() => ({
  button: document.querySelectorAll(".board-pip-button").length,
  pool: [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("画中画")),
}));
check("H6 画中画已整功能移除（棋盘与设置里都不再留痕）", pipGone.button === 0 && !pipGone.pool, JSON.stringify(pipGone));
// 关闭全部六项开关，验证 DOM 复原
await page.evaluate(() => {
  const key = "banbu-enhancement-settings-v1";
  const current = JSON.parse(localStorage.getItem(key) || "{}");
  localStorage.setItem(key, JSON.stringify({ ...current, moveRail: false, radialMenu: false, keyboardShortcuts: false, boardRotateGesture: false }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
const offState = await page.evaluate(() => ({
  rails: document.querySelectorAll(".board-move-rail").length,
  taps: document.querySelectorAll(".status-tap").length,
  lines: [...document.querySelectorAll(".unified-status-line")].map((e) => e.textContent || "").join("|"),
}));
check("H7 关闭后滑轨不渲染（棋盘上下的位置都不留痕）", offState.rails === 0, `rails=${offState.rails}`);
check("H7 关闭全部开关后状态条仍是纯文本", offState.taps === 0 && offState.lines.includes("方落子"), JSON.stringify(offState.lines));
// 关闭后数字键不再跳手
await clickCell("H8空位");
await clickCell("I8空位");
await page.keyboard.press("Digit1");
await page.waitForTimeout(400);
check("H7 关闭后数字键不跳手", (await stepNumber()) === 2, `第 ${await stepNumber()} 手`);
// 关闭后长按棋子不再出菜单（回到老行为）
const occupiedOff = await page.evaluate(() => {
  const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").includes("已有棋子"));
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
if (occupiedOff) {
  await page.mouse.move(occupiedOff.x, occupiedOff.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("H7 关闭后长按不出菜单", !(await page.evaluate(() => Boolean(document.querySelector(".radial-menu")))));
}

// ── H9 棋盘路数口径统一（用户 09-23：新建只到 21 路、导入支持 25 路）────
// 前面几段留了未保存草稿，新建棋谱会被草稿守卫拦下弹「保存/放弃」；先明确放弃，
// 否则这里量到的还是旧棋谱（实测 select 停在 15、交叉点 225）。
await page.evaluate(() => {
  const guardian = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "放弃");
  guardian?.click();
});
await page.waitForTimeout(700);
await page.evaluate(() => { document.querySelector('[aria-label="更多"]')?.click(); });
await page.waitForTimeout(600);
const sizeOptions = await page.evaluate(() => {
  const select = document.querySelector(".board-size-select");
  if (!select) return null;
  return { values: [...select.options].map((o) => Number(o.value)).filter((n) => Number.isFinite(n)), total: select.options.length };
});
const maxChoice = sizeOptions ? Math.max(...sizeOptions.values) : 0;
const minChoice = sizeOptions ? Math.min(...sizeOptions.values) : 0;
check("H9 新建棋谱路数可选到 25 路（与导入/校验口径一致）", maxChoice >= 25, `max=${maxChoice} 选项数=${sizeOptions?.total}`);
check("H9 路数下限仍是 5 路", minChoice <= 5, `min=${minChoice}`);
// 真选一次 23 路，确认能建出棋谱（原先 22–25 路根本选不到）
const created23 = await page.evaluate(() => {
  const select = document.querySelector(".board-size-select");
  if (!select) return null;
  if (![...select.options].some((o) => o.value === "23")) return null;
  // React 的受控 select 只认原生 setter 触发的变更：直接改 .value 再派发 change
  // 会被 React 的值追踪吞掉（实测 select 仍停在 15）。
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, "23");
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
await page.waitForTimeout(1400);
// 换棋谱会重建工作区（「更多」面板随之收起），所以不看 select 的值——
// 直接看棋盘本身：23 路应渲染 23×23=529 个交叉点，标题也应写明路数。
const boardState = await page.evaluate(() => ({
  cells: document.querySelectorAll('[role="gridcell"]').length,
  title: document.querySelector(".unified-status-name")?.textContent || "",
  aria: document.querySelector("svg.renju-board")?.getAttribute("aria-label") || "",
}));
check("H9 能实际建出 23 路棋谱（棋盘渲染 23×23=529 个交叉点）", created23 === true && boardState.cells === 529, `cells=${boardState.cells} aria=${boardState.aria}`);
check("H9 新棋谱标题/无障碍标签写明 23 路", boardState.title.includes("23") || boardState.aria.includes("23"), `title=${boardState.title} aria=${boardState.aria}`);

check("H8 无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}`);
await browser.close();
process.exitCode = failed ? 1 : 0;
