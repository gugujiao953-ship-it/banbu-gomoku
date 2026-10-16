import { chromium } from "playwright";

// 手势与点按共处门禁（2026-09-15 修 BUG：开「双指缩放/双指滑动」后整块板落不了子）。
// 根因：applyGestureTouch 在最后一根手指抬起时**无条件**设 180ms 闸门，而 click 紧接
// pointerup 到达 → .board-hit 的 onClick 每次都被 isTouchGestureBlocked() 判掉。
// 这个 bug 鼠标测不出来（pointerType=mouse 走不到手势分支），所以本门禁必须用真触摸：
// hasTouch + touchscreen.tap，多指用 CDP Input.dispatchTouchEvent。
// Usage: BANBU_URL=http://127.0.0.1:5299 node scripts/ui-gesture-tap-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1）。
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5299/";
const url = base.includes("?") ? base : `${base}?qa=1`;
const VIEWPORT = { width: 412, height: 915 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  :: " + detail}`);
};

const boot = async (flags) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await page.evaluate((extra) => {
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, ...extra }));
  }, flags);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((element) => (element.textContent || "").trim() === "打谱")?.click(); });
  await page.waitForTimeout(500);
};

const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
// ⚠ 不能用 `.board-mark`：那个类早已不挂在棋盘 glyph 上（几何都在 MarkShape 里），
// 数出来恒为 0，会让「长按标注」这条断言假红。棋盘标注改用稳定的 data-board-mark 钩子。
const markCount = () => page.evaluate(() => document.querySelectorAll("[data-board-mark]").length);
const cellPoint = (label) => page.evaluate((name) => {
  const cell = [...document.querySelectorAll('[role="gridcell"]')].find((element) => (element.getAttribute("aria-label") || "").startsWith(name));
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}, label);
const tapCell = async (label) => {
  const point = await cellPoint(label);
  // 放大后格子会被滚出视口，此时点下去根本没落在棋盘上——记下来，别把探针假象当 bug。
  if (!point || point.x < 0 || point.y < 0 || point.x > VIEWPORT.width || point.y > VIEWPORT.height) {
    console.log(`    [跳过 ${label}：落点不在视口内 ${JSON.stringify(point)}]`);
    return false;
  }
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForTimeout(420);
  return true;
};
const resetZoom = async () => {
  await page.evaluate(() => document.querySelector('[aria-label="重置棋盘缩放"]')?.click());
  await page.waitForTimeout(380);
};

const configurations = [
  ["手势关（默认）", {}],
  ["仅双指缩放", { gestureZoom: true }],
  ["仅双指滑动切手", { gestureSwipe: true }],
  ["双指缩放 + 双指滑动", { gestureZoom: true, gestureSwipe: true }],
];
for (const [name, flags] of configurations) {
  await boot(flags);
  await tapCell("H8");
  const afterFirst = await stoneCount();
  await tapCell("I9");
  const afterSecond = await stoneCount();
  check(`${name}：连续点两下能落两子`, afterFirst === 1 && afterSecond === 2, `${afterFirst} → ${afterSecond}`);
}

// 手势本身不能坏：捏合要能**真正放大**（2026-09-16 修的回归：clampScale 钉在 2.35，
// 一次捏合就顶死，用户的感受就是「棋盘被限制大小了、之前能放大五倍多」），捏合过程
// 不能顺手落子，放大后要能在容器里平移，页面自身不能被一起放大。
await boot({ gestureZoom: true });
const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
const scrollerState = () => page.evaluate(() => {
  const sc = document.querySelector(".renju-board").parentElement;
  return {
    scale: Number((document.querySelector(".renju-board").style.width || "100%").replace("%", "")) / 100,
    label: document.querySelector(".board-zoom-reset span")?.textContent || null,
    scrollLeft: Math.round(sc.scrollLeft), scrollTop: Math.round(sc.scrollTop),
    contentW: sc.scrollWidth, contentH: sc.scrollHeight, boxW: sc.clientWidth, boxH: sc.clientHeight,
    maxHeight: getComputedStyle(sc).maxHeight,
    pageH: document.documentElement.scrollHeight,
    pageZoom: Number(window.visualViewport?.scale || 1),
  };
});
// 围绕**当前可见区中心**捏合：放大后棋盘中心会跑出视口，所以锚点取滚动容器而不是棋盘。
const pinch = async (fromGap, toGap) => {
  const center = await page.evaluate(() => {
    const rect = document.querySelector(".renju-board").parentElement.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + Math.min(rect.height, window.innerHeight) / 2) };
  });
  const points = (gap) => [{ x: center.x - gap, y: center.y, id: 1 }, { x: center.x + gap, y: center.y, id: 2 }];
  await touch("touchStart", points(fromGap));
  for (let step = 1; step <= 12; step += 1) {
    await touch("touchMove", points(fromGap + (toGap - fromGap) * (step / 12)));
    await page.waitForTimeout(16);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(450);
  return scrollerState();
};
const unzoomed = await scrollerState();
const firstPinch = await pinch(40, 175); // ≈4.4 倍
check("捏合能放到 4 倍以上（旧实现被 2.35 顶死）", firstPinch.scale > 3.8, `${firstPinch.label} (${firstPinch.scale}×)`);
const secondPinch = await pinch(40, 260);
check("继续捏合能顶到 6 倍上限、且不越界", secondPinch.scale > 5.6 && secondPinch.scale <= 6.0001, `${secondPinch.label} (${secondPinch.scale}×)`);
// 开手势后 touch-action 让开了浏览器的 pinch-zoom：捏合只应放大棋盘，不该连页面一起放大
// （改造前实测页面被放到 144%，两个缩放叠在一起）。
check("捏合不再带动浏览器页面缩放（棋盘专属缩放）", firstPinch.pageZoom < 1.05 && secondPinch.pageZoom < 1.05, `页面缩放 ${firstPinch.pageZoom}/${secondPinch.pageZoom}`);
check("连续捏合到上限后棋盘上仍没有落子", (await stoneCount()) === 0, `${await stoneCount()} 子`);
// 放大后必须装进定高滚动区：否则 SVG 会把容器一起撑高、容器永不出现纵向溢出，
// 而 touch-action:none 又挡住页面滚动 → 放大的下半张棋盘根本够不到（实测旧版单指
// 拖 150px 什么都不动），同时页面高度被撑爆。
check("放大后内容在两个轴向上都超出滚动区（可以平移）", secondPinch.contentW > secondPinch.boxW && secondPinch.contentH > secondPinch.boxH, `${secondPinch.boxW}×${secondPinch.boxH} 内容 ${secondPinch.contentW}×${secondPinch.contentH}`);
check("放大不会把页面撑高（定高滚动区生效）", secondPinch.maxHeight !== "none" && secondPinch.pageH - unzoomed.pageH < 150, `max-height=${secondPinch.maxHeight} 页面 ${unzoomed.pageH}→${secondPinch.pageH}`);
const panDrag = async (stepsX, stepsY) => {
  const start = await page.evaluate(() => {
    const rect = document.querySelector(".renju-board").parentElement.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + Math.min(rect.height, window.innerHeight) / 2) };
  });
  await touch("touchStart", [{ x: start.x, y: start.y, id: 1 }]);
  for (let step = 1; step <= 10; step += 1) {
    await touch("touchMove", [{ x: start.x + stepsX * step, y: start.y + stepsY * step, id: 1 }]);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd", []);
  await page.waitForTimeout(400);
  return scrollerState();
};
const panned = await panDrag(-12, -20);
check("放大后单指拖动能在两个轴向平移棋盘", panned.scrollLeft > 40 && panned.scrollTop > 40, `滚动 ${secondPinch.scrollLeft},${secondPinch.scrollTop} → ${panned.scrollLeft},${panned.scrollTop}`);
await resetZoom();
const reset = await scrollerState();
check("重置缩放后回到 1 倍且定高解除", reset.scale === 1 && reset.maxHeight === "none" && reset.contentH <= reset.boxH + 1, `${reset.label} max-height=${reset.maxHeight}`);
// 桌面端的「双指缩放」其实是 Ctrl/⌘+滚轮（触摸板捏合在 Chromium 里就是带 ctrlKey 的
// wheel）。旧实现只听 touch 指针事件，所以在电脑上装了手势却一点反应都没有。
await page.mouse.move(206, 300);
const wheelScales = [];
for (let i = 0; i < 8; i += 1) {
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(60);
  wheelScales.push((await scrollerState()).scale);
}
const afterWheel = await scrollerState();
check("桌面端 Ctrl+滚轮能缩放棋盘（触摸板捏合就是这条路径）", afterWheel.scale > 1.8, `${afterWheel.label} 逐格 ${wheelScales.map((s) => s.toFixed(2)).join(" → ")}`);
check("Ctrl+滚轮缩放时页面自身不被放大", afterWheel.pageZoom < 1.05, `页面缩放 ${afterWheel.pageZoom}`);
const beforePlainWheel = await scrollerState();
await page.mouse.wheel(0, -120);
await page.waitForTimeout(300);
check("普通滚轮不缩放棋盘（留给容器/页面滚动）", (await scrollerState()).scale === beforePlainWheel.scale, `${beforePlainWheel.scale} → ${(await scrollerState()).scale}`);
await resetZoom();

// 分析面板开着时**不许连带缩小棋盘**（用户 2026-10-06：一点开分析、功能区往下展开，
// 棋盘就小一圈）。2026-09-16 那条「收窄 32px 放候选点」的 !important 规则连同为它打的
// `:not(.is-zoomed)` 补丁已经一起删掉，这里反向钉住「面板开着 = 棋盘宽度不变」。
await boot({ gestureZoom: true });
await page.evaluate(() => { [...document.querySelectorAll("button")].find((element) => (element.textContent || "").trim() === "分析")?.click(); });
await page.waitForTimeout(2500);
const analysisLayout = () => page.evaluate(() => {
  const svg = document.querySelector(".renju-board");
  return { docked: !!document.querySelector(".dock-panel-analysis"), inline: svg.style.width, rendered: Math.round(svg.getBoundingClientRect().width), box: svg.parentElement.clientWidth };
});
const dockedIdle = await analysisLayout();
check("分析面板开着时棋盘不再被收窄（宽度=容器宽）", dockedIdle.docked && dockedIdle.rendered >= dockedIdle.box - 4, JSON.stringify(dockedIdle));
await page.mouse.move(206, 300);
for (let i = 0; i < 6; i += 1) {
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(60);
}
await page.waitForTimeout(400);
const dockedZoomed = await analysisLayout();
check("分析面板开着时缩放不会被 !important 规则吃掉", dockedZoomed.docked && dockedZoomed.rendered > dockedZoomed.box * 1.3, JSON.stringify(dockedZoomed));
await resetZoom();
await boot({ gestureZoom: true });

// 触摸让位后的取舍：touch-action 从 manipulation 改成 "pan-x pan-y"（未放大）只应
// 去掉浏览器 pinch-zoom，单指平移能力按规范完全相同，页面滚动/滚动链不受影响。
// 但 headless 里 CDP 合成触摸不会真的触发浏览器滚动（开与关都测到 0px），所以这里
// 只做诊断打印、不断言；真正要看的「页面不再被捏合放大」在上面已断言（页面缩放=1）。
const scrollDragDelta = async (flags) => {
  await page.setViewportSize({ width: 412, height: 560 });
  await boot(flags);
  const start = await page.evaluate(() => {
    const rect = document.querySelector(".renju-board").getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.min(440, Math.max(120, Math.round(rect.y + rect.height / 2))) };
  });
  const cdpTouch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: start.x, y, id: 1 }] });
  const before = await page.evaluate(() => Math.round(window.scrollY));
  await cdpTouch("touchStart", start.y);
  for (let step = 1; step <= 6; step += 1) { await cdpTouch("touchMove", start.y - step * 30); await page.waitForTimeout(35); }
  await cdpTouch("touchEnd");
  await page.waitForTimeout(600);
  return (await page.evaluate(() => Math.round(window.scrollY))) - before;
};
const scrollWithGestures = await scrollDragDelta({ gestureZoom: true });
const scrollWithoutGestures = await scrollDragDelta({});
console.log(`    [诊断] 矮视口单指拖动滚动量：手势开=${scrollWithGestures}px 手势关=${scrollWithoutGestures}px`);
await page.setViewportSize(VIEWPORT);
await boot({ gestureZoom: true });
check("捏合过程中不会误落子", (await stoneCount()) === 0, `${await stoneCount()} 子`);
await resetZoom();
await tapCell("H8");
check("捏合复位后仍能落子", (await stoneCount()) === 1, `${await stoneCount()} 子`);

// 手指漂到棋盘外再抬起：SVG 的 pointerupCapture 可能收不到，不能因此把交互永久锁死。
await boot({ gestureZoom: true });
const boardCenter2 = await page.evaluate(() => {
  const rect = document.querySelector(".renju-board").getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
await touch("touchStart", [{ x: boardCenter2.x - 30, y: boardCenter2.y, id: 1 }, { x: boardCenter2.x + 30, y: boardCenter2.y, id: 2 }]);
await touch("touchMove", [{ x: boardCenter2.x - 30, y: boardCenter2.y - 300, id: 1 }, { x: boardCenter2.x + 30, y: boardCenter2.y - 300, id: 2 }]);
await page.waitForTimeout(150);
await touch("touchEnd", []);
await page.waitForTimeout(450);
await resetZoom();
await tapCell("H8");
await tapCell("I9");
check("板外抬起后不会被永久锁死（仍能落子）", (await stoneCount()) === 2, `${await stoneCount()} 子`);

// 触摸的另一半路径：长按标注。手势开启时它也不能被守卫吞掉。
await boot({ gestureZoom: true });
const markPoint = await cellPoint("H8");
await touch("touchStart", [{ x: markPoint.x, y: markPoint.y, id: 1 }]);
await page.waitForTimeout(750);
await touch("touchEnd", []);
await page.waitForTimeout(400);
check("手势开启时长按仍能标注（不落子）", (await markCount()) > 0 && (await stoneCount()) === 0, `mark=${await markCount()} stone=${await stoneCount()}`);

check("无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
