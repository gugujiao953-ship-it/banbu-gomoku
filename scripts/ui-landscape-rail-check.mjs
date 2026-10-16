import { chromium } from "playwright";

/**
 * 横屏版式门禁（用户 10-01：「横屏界面、横屏双栏界面现在似乎没适配目前版本，里面的按钮缺失，
 * 功能栏打开后里面的按钮不知道在哪，走棋区更是找不到」+「把最下面那行金刚页放到最右边，
 * 呈竖条状态从上往下，节省高度让棋盘大一点；现在横屏里棋盘只有一半大小」）。
 *
 * 钉住四件事（都是改前的实测反例）：
 *  A 底部「金刚页」在横屏改成**右边缘竖条**（宽 56 < 高，且贴视口右缘）。
 *  B 功能区与走棋区**在视口里**（改前 1180×820 单栏：首行 top=931、走棋区 top=1048，
 *    要往下滚 396px 才摸得到 —— 用户说的「按钮不知道在哪」就是这个）。
 *  C 棋盘尺寸：双栏在 1180×820 ≥560（改前 520）、1024×768 ≥500（改前 468）、
 *    手机矮横屏 ≥200（改前 150）。
 *  D 平板横屏整页不滚动（改前单栏要滚 396px）。
 *
 * 横屏**一律**双栏（R109 删了「平板横屏双栏」开关，`.split-layout-enabled` 恒挂），
 * 所以这里刻意**不写 localStorage 的设置项**，让默认版式本身被验证一次。
 *
 * 用法：BANBU_URL=http://127.0.0.1:5605/ node scripts/ui-landscape-rail-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5605/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const openDuelFreeBoard = async (width, height, touch = true) => {
  // touch 参数保留但**不再决定版式**：R109 起横屏一律双栏 + 右缘竖条，浏览器也一样
  // （用户 10-01：「无论是浏览器还是手机，只要横屏都是这样」）。R105 那版曾用
  // `pointer:coarse` 把桌面挡在外面，已随开关一起撤掉。
  // 电脑浏览器永远是 landscape，不加这个条件就会把桌面也变成平板摆法（用户 10-01 第二轮就是报这个）。
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, serviceWorkers: "block" });
  await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "1"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
  page.setDefaultTimeout(12_000);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  for (const point of ["H8", "I8", "H9"]) await page.getByRole("gridcell", { name: new RegExp(`^${point}空位`) }).click().catch(() => {});
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), inView: b.top >= -1 && b.bottom <= innerHeight + 1 }; };
    const record = document.querySelector(".record-page");
    const grid = record ? getComputedStyle(record) : null;
    return {
      vw: innerWidth, vh: innerHeight, scroll: document.documentElement.scrollHeight, shellW: Math.round(document.querySelector(".app-shell")?.getBoundingClientRect().width || 0),
      split: document.querySelector(".app-shell")?.classList.contains("split-layout-enabled") || false,
      nav: rect(".bottom-nav"), board: rect(".renju-board"),
      bottomRow: rect(".dock-tabs.action-bottom-row"), movesRow: rect(".moves-row"),
      record: rect(".record-page"), rail: rect(".record-rail"),
      grid: grid ? { columns: grid.gridTemplateColumns.split(/\s+/).map(parseFloat), gap: parseFloat(grid.columnGap), paddingLeft: parseFloat(grid.paddingLeft), paddingRight: parseFloat(grid.paddingRight) } : null,
    };
  });
  return { page, errors, m };
};

try {
  // ── A 竖条导航（任一横屏视口都成立）──────────────────────────────────────
  const tablet = await openDuelFreeBoard(1180, 820);
  check("A1 横屏一律双栏（没有开关，R109 起恒挂 .split-layout-enabled）", tablet.m.split === true);
  check("A2 底部导航变成右边缘竖条（宽 56 < 高、贴右缘、从顶到底）",
    tablet.m.nav.w < tablet.m.nav.h && Math.abs(tablet.m.nav.right - tablet.m.vw) <= 1 && tablet.m.nav.top <= 1,
    `导航 ${tablet.m.nav.w}×${tablet.m.nav.h} @top=${tablet.m.nav.top} right=${tablet.m.nav.right} / 视口宽 ${tablet.m.vw}`);
  check("B1 首行功能区在视口内（改前 top=931 在视口外）", tablet.m.bottomRow?.inView === true, JSON.stringify(tablet.m.bottomRow));
  check("B2 走棋区在视口内（改前 top=1048，要滚 396px 才看到）", tablet.m.movesRow?.inView === true, JSON.stringify(tablet.m.movesRow));
  check("C1 1180×820 棋盘 ≥620px（改前 520；三轮做到 590 → 644）", tablet.m.board.w >= 620, `${tablet.m.board.w}px`);
  // 棋盘顶到物理上限的代价：状态栏被推到视口上方，要往上滑才看得到（用户明确接受）。
  // 所以这里不再要求「整页不滚」，改成「滚动量小 + 功能区与走棋区仍在初始视口内」（B 组）。
  check("D1 平板横屏整页滚动 ≤60px（棋盘整块不被切，最多滑一下手数滑杆）", tablet.m.scroll - tablet.m.vh <= 60, `多 ${tablet.m.scroll - tablet.m.vh}px`);
  check("E1 1180×820 无页面错误", tablet.errors.length === 0, tablet.errors.join(" | "));
  await tablet.page.context().close();

  const small = await openDuelFreeBoard(1024, 768);
  // 用户 10-07 已把右栏从 360 放宽到 420，明确接受左栏收窄。
  // 1024 − 导航56 − 左右padding(4+18) − gap18 − 右栏420 = 左列508。
  // 保留本文件头部原定 ≥500，并另验吃满左列与无裁切，防止放宽后隐藏尺寸回退。
  check("C2 1024×768 棋盘 ≥500px（右栏按现行要求放宽到 420）", small.m.board.w >= 500, `${small.m.board.w}px`);
  check("C2a 1024×768 棋盘吃满左列，完整留在列内且不碰右栏/导航",
    small.m.grid?.columns.length === 2
      && Math.abs(small.m.board.w - small.m.grid.columns[0]) <= 1
      && small.m.board.left >= small.m.record.left + small.m.grid.paddingLeft - 1
      && small.m.board.right <= small.m.rail.left - small.m.grid.gap + 1
      && small.m.board.inView && small.m.rail.right <= small.m.nav.left,
    `棋盘 ${JSON.stringify(small.m.board)} / 网格 ${JSON.stringify(small.m.grid)} / 右栏 ${JSON.stringify(small.m.rail)}`);
  check("D2 1024×768 整页滚动 ≤60px", small.m.scroll - small.m.vh <= 60, `多 ${small.m.scroll - small.m.vh}px`);
  check("E2 1024×768 无页面错误", small.errors.length === 0, small.errors.join(" | "));
  await small.page.context().close();

  // 手机矮横屏：390 高放不下「顶栏 + 状态栏 + 棋盘 + 三行功能区」，允许整页滚一点，
  // 但棋盘必须比改前（150px）明显大，且功能区/走棋区不能跑到视口外找不着。
  const phone = await openDuelFreeBoard(844, 390);
  check("C3 手机矮横屏棋盘 ≥200px（改前 150）", phone.m.board.w >= 200, `${phone.m.board.w}px`);
  check("B3 矮横屏首行功能区在视口内", phone.m.bottomRow?.inView === true, JSON.stringify(phone.m.bottomRow));
  check("D3 矮横屏整页滚动 ≤100px（改前 220px 且按钮在视口外）", phone.m.scroll - phone.m.vh <= 100, `多 ${phone.m.scroll - phone.m.vh}px`);
  check("E3 844×390 无页面错误", phone.errors.length === 0, phone.errors.join(" | "));
  await phone.page.context().close();

  // ── F 桌面浏览器（有鼠标、无触摸）横屏时**也走同一套**（R109 定的口径）────────────
  // 口径改过两次：R105 曾要求桌面保持改版前的「居中卡片 + 底部横条」（当时用户说网页版
  // 「回不到之前的模式」）；R109 他看完最终定了 ——「横屏的时候，就默认启动这个模式，
  // 无论是浏览器还是手机，只要横屏都是这样」。所以这一组现在断言的是「桌面也一样吃横屏版式」，
  // 与 A/B/C/D 各组同形。touch 参数留着：万一以后要区分指针类型，改一处即可。
  const desk = await openDuelFreeBoard(1440, 900, false);
  check("F1 桌面横屏导航同样是右缘竖条（宽 < 高、贴右缘、从顶到底）",
    desk.m.nav.w < desk.m.nav.h && Math.abs(desk.m.nav.right - desk.m.vw) <= 1 && desk.m.nav.top <= 1,
    `导航 ${desk.m.nav.w}×${desk.m.nav.h} right=${desk.m.nav.right} / 视口 ${desk.m.vw}×${desk.m.vh}`);
  check("F2 桌面横屏外壳同样铺满（不再是 1120 居中卡片）", desk.m.shellW >= desk.m.vw - 60, `外壳 ${desk.m.shellW}px / 视口 ${desk.m.vw}px`);
  check("F3 桌面横屏棋盘同样按「整块不被切」取上限（≥680）", desk.m.board.w >= 680, `${desk.m.board.w}px`);
  check("F4 桌面横屏功能区与走棋区都在视口内", desk.m.bottomRow?.inView === true && desk.m.movesRow?.inView === true,
    `首行 ${JSON.stringify(desk.m.bottomRow)} 走棋 ${JSON.stringify(desk.m.movesRow)}`);
  check("E4 桌面窗口无页面错误", desk.errors.length === 0, desk.errors.join(" | "));
  await desk.page.context().close();
} finally {
  await browser.close();
}
console.log(failed === 0 ? "\n横屏版式门禁全部通过" : `\n${failed} 项断言失败`);
process.exit(failed === 0 ? 0 : 1);
