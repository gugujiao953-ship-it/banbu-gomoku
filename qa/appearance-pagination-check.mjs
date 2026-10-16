/** 外观与音效：主题/棋盘/棋子选项分页的门禁（用户 2026-10-06 提出的"翻页"改版）。
 *
 *  依据需求逐条断言：
 *   1. 三组都分页，每页 2 列 × 5 行 = 10 个（第一页正好 10 个，第 11 个在第二页）；
 *   2. 预览块在选项列表**之前**（棋盘/棋子；主题那组本来就没有预览块）；
 *   3. 横向滑动 / 页码圆点 / 左右箭头都能翻页，页码指示跟着变；
 *   4. 子设置（标注高亮）仍在它原来的相对位置（共用预览上方）；
 *   5. 翻页控件是 button 且有 aria-label；prefers-reduced-motion 下仍能翻页。
 *
 *  ⚠ 2026-10-09 三版面改造（用户：「搞成三个版面，切换到棋盘就调试棋盘…放在预览棋盘下面横向排列」）：
 *    棋盘 / 棋子 不再是两个独立子节，而是「棋盘与棋子」子节里共用一块预览 + 三个
 *    `.appearance-pane-tabs` 标签（棋盘 / 棋子 / 特效）切换的 `.appearance-pane-body`。
 *    所以：
 *      · 子节期望值从 5 段变 3 段（主题 / 棋盘与棋子 / 声音与音效）；
 *      · 「预览在选项之前」的检查范围变为 `.appearance-panes` 内部
 *        （预览 → 标签 → 面板），预览仍在分页列表之前；
 *      · 棋盘/棋子的分页要从**各自标签页的 body 里**读，不能一次收全。
 *    另外主题数是 **23**（2026-10-09 加了「黄昏骑行」），不是 22。
 *
 *  用法：QA_BASE_URL=http://localhost:5173/?qa=1 node qa/appearance-pagination-check.mjs
 *  ⚠ 必须 localhost（Vite 只绑了 IPv6）。
 *
 *  ⚠ 三组选项（23 + 28 + 31 个材质 SVG）无论 details 开不开都常驻 DOM，
 *    连续大量 evaluateAll 会让渲染进程偶发重启（表现为 "target closed"）。
 *    所以每组读完后停一下，读数一律用带超时的轮询，不用裸 getAttribute。
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.QA_BASE_URL || "http://localhost:5173/?qa=1";
const artifactDir = process.env.QA_ARTIFACT_DIR || "qa-artifacts";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

/** 轮询直到 locator.evaluate 的读数满足条件；返回最后一次读数。 */
const waitForValue = async (read, done, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!done(value) && Date.now() < deadline) { await page.waitForTimeout(80); value = await read(); }
  return value;
};
const waitForAttr = (locator, name, expected, timeout = 3000) =>
  waitForValue(() => locator.getAttribute(name), (value) => value === expected, timeout);
const waitForScrollLeft = (locator, expected, timeout = 3000) =>
  waitForValue(() => locator.evaluate((el) => el.scrollLeft), (value) => Math.abs(value - expected) <= 3, timeout);

try {
  await mkdir(artifactDir, { recursive: true });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 关掉新手引导：「先自己试试」（首启欢迎）/「跳过引导」（功能导览）。
  const firstRun = page.getByRole("button", { name: "先自己试试" });
  if (await firstRun.count()) { await firstRun.click(); await page.waitForTimeout(400); }
  const tourSkip = page.locator('[aria-label="跳过引导"]');
  if (await tourSkip.count()) { await tourSkip.click(); await page.waitForTimeout(400); }

  await page.locator('.bottom-nav button:has-text("设置")').first().click();
  await page.waitForSelector(".settings-page", { timeout: 20_000 });

  // 展开「外观与音效」分区。
  const appearance = page.locator("details.settings-group").filter({ has: page.locator('summary b:text-is("外观与音效")') });
  assert(await appearance.count() === 1, "找不到「外观与音效」分区");
  await appearance.evaluate((el) => { if (!el.open) el.querySelector("summary").click(); });

  const subsection = (title) => page.locator("details.appearance-center-subsection").filter({ has: page.locator(`summary b:text-is("${title}")`) });
  const openSubsection = async (title) => {
    const sub = subsection(title);
    assert(await sub.count() === 1, `找不到「${title}」子分区`);
    await sub.evaluate((el) => { if (!el.open) el.querySelector("summary").click(); });
    return sub;
  };

  /** 取一组的分页结构：每页各几个、以及拉平后的选项文字顺序。 */
  const readPager = async (sub) => {
    const pages = sub.locator(".visual-pager-page");
    const pageCount = await pages.count();
    const perPage = [];
    const labels = [];
    for (let index = 0; index < pageCount; index += 1) {
      const buttons = pages.nth(index).locator("button");
      perPage.push(await buttons.count());
      labels.push(...await buttons.evaluateAll((els) => els.map((el) => (el.querySelector("b")?.textContent || el.textContent || "").trim())));
    }
    return { pageCount, perPage, labels };
  };

  // ---- 主题：23 项 → 3 页（10 / 10 / 3）----
  const themeSub = await openSubsection("主题");
  const themePager = await readPager(themeSub);
  assert(themePager.pageCount === 3, `主题应为 3 页，实测 ${themePager.pageCount}`);
  assert(JSON.stringify(themePager.perPage) === JSON.stringify([10, 10, 3]), `主题每页应为 10/10/3，实测 ${JSON.stringify(themePager.perPage)}`);
  assert(themePager.labels[0] === "跟随系统", `主题第一项应为「跟随系统」，实测「${themePager.labels[0]}」`);
  assert(themePager.labels[10] === "夜雨江南", `主题第 11 项应在第二页首格（夜雨江南），实测「${themePager.labels[10]}」`);
  console.log(`主题：${themePager.pageCount} 页，每页 ${themePager.perPage.join("/")}（第 1 页 ${themePager.perPage[0]} 个，第 11 项「${themePager.labels[10]}」在第 2 页）`);
  await page.waitForTimeout(400);
  await themeSub.locator(".appearance-center-subsection-body").screenshot({ path: `${artifactDir}/外观-分页-主题-1.png` });

  // ---- 棋盘与棋子：共用预览 → 三标签（棋盘/棋子/特效）→ 各自面板 ----
  const panes = await openSubsection("棋盘与棋子");
  const panesBody = panes.locator(".appearance-center-subsection-body");
  /* 「标注高亮」现在挂在**共用预览上方**（用户 2026-10-09：「标注高亮放在棋盘的上方呀不是下面」），
     并且三个版面都能看到它 —— 它套在 `.appearance-above-preview` 容器里，
     是 .appearance-panes 的第一个子块（容器之后再是预览、标签、面板）。 */
  const abovePreview = await panesBody.evaluate((el) => {
    const panesRoot = el.querySelector(".appearance-panes");
    const first = panesRoot?.firstElementChild;
    const holder = first?.classList.contains("appearance-above-preview") ? first : null;
    const preview = panesRoot?.querySelector(".material-live-preview");
    return {
      firstClass: first?.className || "",
      hasHighlight: Boolean((holder || first)?.querySelector(".annotation-highlight-setting")),
      holderBeforePreview: Boolean(holder && preview && (holder.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  });
  assert(abovePreview.hasHighlight, `「标注高亮」应仍在共用预览上方，实测首块=${abovePreview.firstClass}`);
  assert(abovePreview.holderBeforePreview, "标注高亮容器在 DOM 里没有排在共用预览之前");
  const previewBox = await panesBody.locator(".material-live-preview").first().boundingBox();
  const boardPagerBox = await panesBody.locator(".visual-pager").first().boundingBox();
  assert(previewBox && boardPagerBox, "共用预览块或分页控件没渲染");
  assert(previewBox.y + previewBox.height <= boardPagerBox.y + 1, `预览块应在分页选项之前（预览底 ${Math.round(previewBox.y + previewBox.height)}，分页顶 ${Math.round(boardPagerBox.y)}）`);
  const previewBeforeTabsInDom = await panesBody.evaluate((el) => {
    const preview = el.querySelector(".material-live-preview");
    const tabs = el.querySelector(".appearance-pane-tabs");
    return Boolean(preview && tabs && (preview.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert(previewBeforeTabsInDom, "共用预览在 DOM 里没有排在三版面标签之前");
  const tabLabels = await panes.locator(".appearance-pane-tabs > button").evaluateAll((els) => els.map((el) => (el.textContent || "").trim()));
  assert(JSON.stringify(tabLabels) === JSON.stringify(["棋盘", "棋子", "特效"]), `三版面标签应为 棋盘/棋子/特效，实测 ${JSON.stringify(tabLabels)}`);

  const selectPane = async (label) => {
    await panes.locator(`.appearance-pane-tabs > button:text-is("${label}")`).click();
    await page.waitForTimeout(450);
  };

  // 棋盘：28 项 → 3 页（10 / 10 / 8）
  await selectPane("棋盘");
  const boardPager = await readPager(panesBody);
  assert(boardPager.pageCount === 3, `棋盘应为 3 页，实测 ${boardPager.pageCount}`);
  assert(JSON.stringify(boardPager.perPage) === JSON.stringify([10, 10, 8]), `棋盘每页应为 10/10/8，实测 ${JSON.stringify(boardPager.perPage)}`);
  assert(boardPager.labels[10] === "铁线白描 · 朱砂线", `棋盘第 11 项应在第二页首格（铁线白描 · 朱砂线），实测「${boardPager.labels[10]}」`);
  console.log(`棋盘：${boardPager.pageCount} 页，每页 ${boardPager.perPage.join("/")}（共用预览在列表前，标注高亮在预览上方）`);
  await page.waitForTimeout(500);

  // 棋子：31 项 → 4 页（10 / 10 / 10 / 1）
  await selectPane("棋子");
  const stonePager = await readPager(panesBody);
  assert(stonePager.pageCount === 4, `棋子应为 4 页，实测 ${stonePager.pageCount}`);
  assert(JSON.stringify(stonePager.perPage) === JSON.stringify([10, 10, 10, 1]), `棋子每页应为 10/10/10/1，实测 ${JSON.stringify(stonePager.perPage)}`);
  assert(stonePager.labels[10] === "霓虹遗迹 · 暮霞", `棋子第 11 项应在第二页首格，实测「${stonePager.labels[10]}」`);
  assert(stonePager.labels[30] === "敦煌候选 · 联珠莲瓣", `棋子第 31 项应在第 4 页（唯一一格），实测「${stonePager.labels[30]}」`);
  console.log(`棋子：${stonePager.pageCount} 页，每页 ${stonePager.perPage.join("/")}（共用预览在列表前）`);
  await page.waitForTimeout(500);

  // 切回棋盘，后面的翻页交互都用这一组
  await selectPane("棋盘");
  const boardSub = panes;
  const boardBody = panesBody;

  // ---- 翻页交互（用棋盘那组）----
  const track = boardSub.locator(".visual-pager-track");
  const trackWidth = await waitForValue(() => track.evaluate((el) => el.clientWidth), (width) => width > 200);
  assert(trackWidth > 200, `分页容器宽度异常：${trackWidth}`);
  assert((await track.getAttribute("aria-label"))?.includes("共 3 页"), "分页容器缺少页数 aria-label");
  assert(await boardSub.locator(".visual-pager-arrow").first().getAttribute("aria-label") === "棋盘材质上一页", "左箭头缺少 aria-label");
  assert(await boardSub.locator(".visual-pager-arrow").last().getAttribute("aria-label") === "棋盘材质下一页", "右箭头缺少 aria-label");
  assert(await track.getAttribute("tabindex") === "0", "分页容器应可聚焦（键盘可达）");
  assert(await boardSub.locator(".visual-pager-dot").first().evaluate((el) => el.tagName) === "BUTTON", "页码圆点应是 button");

  // 第一页截图（含预览块，证明预览在选项上方）。
  await page.waitForTimeout(300);
  await boardBody.screenshot({ path: `${artifactDir}/外观-分页-1.png` });

  // (a) 触控板横向滑动（wheel deltaX）→ 翻到下一页。
  await track.hover();
  await page.mouse.wheel(400, 0);
  const afterWheel = await waitForValue(() => track.evaluate((el) => el.scrollLeft), (value) => value > trackWidth * 0.5);
  assert(afterWheel >= trackWidth * 0.9, `横向滑动后应翻到后面的页，实测 scrollLeft ${afterWheel}`);
  console.log(`横向滑动（wheel deltaX）：scrollLeft ${Math.round(afterWheel)} / 页宽 ${trackWidth} → 第 ${Math.round(afterWheel / trackWidth) + 1} 页`);

  // (b) 点页码圆点翻到第 2 页，指示器跟着变。
  const dot2 = boardSub.locator(".visual-pager-dot").nth(1);
  await dot2.click();
  let scrollLeft = await waitForScrollLeft(track, trackWidth);
  assert(Math.abs(scrollLeft - trackWidth) <= 3, `点圆点后应滚到第 2 页（期望 ${trackWidth}，实测 ${scrollLeft}）`);
  assert(await waitForAttr(dot2, "aria-current", "true") === "true", "翻到第 2 页后页码指示没更新");
  assert(await waitForAttr(track, "data-page", "2") === "2", "data-page 未更新为 2");
  await page.waitForTimeout(300);
  await boardBody.screenshot({ path: `${artifactDir}/外观-分页-2.png` });

  // (c) 回到第 1 页，再用 scrollIntoView 把第 2 页的选项滚进视野 —— 指示器应跟着变。
  await boardSub.locator(".visual-pager-dot").first().click();
  scrollLeft = await waitForScrollLeft(track, 0);
  assert(Math.abs(scrollLeft) <= 3, `点第 1 个圆点后应回到第 1 页，实测 ${scrollLeft}`);
  assert(await waitForAttr(track, "data-page", "1") === "1", "回到第 1 页后 data-page 未更新");
  await boardSub.locator(".visual-pager-page").nth(1).locator("button").last().scrollIntoViewIfNeeded();
  scrollLeft = await waitForScrollLeft(track, trackWidth);
  assert(Math.abs(scrollLeft - trackWidth) <= 3, `scrollIntoView 后应停在最终页，实测 ${scrollLeft}`);
  assert(await waitForAttr(track, "data-page", "2") === "2", "scrollIntoView 翻页后页码指示没跟上");

  // (d) 右箭头翻到第 3 页，且在末页时禁用。
  await boardSub.locator(".visual-pager-arrow").last().click();
  await waitForScrollLeft(track, trackWidth * 2);
  assert(await waitForAttr(track, "data-page", "3") === "3", "右箭头未能翻到第 3 页");
  assert(await boardSub.locator(".visual-pager-arrow").last().isDisabled(), "末页时右箭头应禁用");
  assert(await waitForAttr(boardSub.locator(".visual-pager-dot").nth(2), "aria-current", "true") === "true", "第 3 页圆点未高亮");

  // (e) prefers-reduced-motion：仍能翻页（不做平滑动画，但不是不能用）。
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boardSub.locator(".visual-pager-dot").first().click();
  scrollLeft = await waitForScrollLeft(track, 0, 600);
  assert(Math.abs(scrollLeft) <= 3, `reduced-motion 下点圆点未能翻页，实测 ${scrollLeft}`);
  await page.emulateMedia({ reducedMotion: null });

  assert(pageErrors.length === 0, `页面报错：${pageErrors.join(" | ")}`);
  console.log("外观分页门禁通过：主题 3 页 / 棋盘 3 页 / 棋子 4 页；预览在前；横向滑动、圆点、箭头、scrollIntoView、reduced-motion 均可翻页");
} finally {
  await browser.close();
}
