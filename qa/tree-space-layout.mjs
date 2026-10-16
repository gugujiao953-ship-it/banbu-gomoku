import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { chooseTreeZoom } from "./tree-controls.mjs";

const url = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:4371/");
url.searchParams.set("qa", "1");
const phase = process.env.QA_LAYOUT_PHASE || "after";
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const settle = (page) => page.locator(".tree-viewport").evaluate((element) => new Promise((resolve, reject) => {
  let last = -1, stable = 0, frames = 0;
  const tick = () => {
    const next = element.clientHeight;
    stable = next === last ? stable + 1 : 0;
    last = next;
    if (stable >= 8) resolve();
    else if (++frames >= 180) reject(new Error(`画布高度持续变化：${element.getAttribute("style")}`));
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
const record = {
  id: "tree-space-layout", version: 1, rootId: "root", savedCurrentId: "m20",
  metadata: { title: "图谱空间回归", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", nodes: {},
};
record.nodes.root = { id: "root", parentId: null, children: ["m1"], preferredChildId: "m1", move: null, comment: "", marks: [] };
for (let turn = 1; turn <= 40; turn += 1) {
  const id = `m${turn}`;
  record.nodes[id] = { id, parentId: turn === 1 ? "root" : `m${turn - 1}`, children: turn < 40 ? [`m${turn + 1}`] : [], move: { row: Math.floor((turn - 1) / 15), col: (turn - 1) % 15, player: turn % 2 ? "black" : "white" }, comment: turn === 20 ? "用于检查选择、预览与节点操作。" : "", marks: [] };
}
for (let branch = 1; branch <= 6; branch += 1) {
  const head = `b${branch}-1`;
  record.nodes.m4.children.push(head);
  for (let turn = 1; turn <= 16; turn += 1) {
    const id = `b${branch}-${turn}`;
    record.nodes[id] = { id, parentId: turn === 1 ? "m4" : `b${branch}-${turn - 1}`, children: turn < 16 ? [`b${branch}-${turn + 1}`] : [], move: { row: 5 + branch + Math.floor((turn - 1) / 15), col: (turn - 1) % 15, player: turn % 2 ? "black" : "white" }, comment: "", marks: [] };
  }
}
const seed = (doc) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(doc));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([doc]));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ coachMarks: false, recentImports: false, gestureZoom: false, gestureSwipe: false }));
};
const measure = (page) => page.evaluate(() => {
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height), maxWidth: style.maxWidth, padding: style.padding, display: style.display, overflowY: style.overflowY, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, inline: element.getAttribute("style") };
  };
  const board = document.querySelector(".record-page .renju-board");
  return { viewport: { width: innerWidth, height: innerHeight }, board: box(board), ancestors: board ? [board.parentElement, board.parentElement.parentElement, board.parentElement.parentElement.parentElement].map(box) : [],
    sheet: box(document.querySelector(".tree-sheet-backdrop .bottom-sheet")),
    blocks: Object.fromEntries(["record-tree-panel", "record-tree-tabs", "tree-toolbar", "tree-viewport", "tree-mapbar", "tree-preview", "tree-legend", "tree-node-actions"].map((name) => [name, box(document.querySelector(`.${name}`))])) };
});
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  await mkdir("qa/screenshots/tree-space-layout", { recursive: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 412, height: 915 }, { width: 900, height: 900 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 900, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(seed, record);
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await page.locator(".record-page .renju-board").waitFor();
    const board = await measure(page);
    await page.screenshot({ path: `qa/screenshots/tree-space-layout/${phase}-board-${viewport.width}.png` });
    await page.getByRole("button", { name: "打开分支树" }).click();
    await page.locator(".tree-canvas").waitFor();
    await settle(page);
    const graph = await measure(page);
    await page.screenshot({ path: `qa/screenshots/tree-space-layout/${phase}-tree-${viewport.width}.png` });
    if (phase !== "before") {
      const dialog = page.getByRole("dialog", { name: "分支树" });
      const noOverflow = async () => {
        await settle(page);
        const state = await measure(page);
        assert(state.sheet.scrollHeight <= state.sheet.clientHeight + 4, `弹层溢出：${JSON.stringify({ viewport, sheet: state.sheet })}`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "页面横向溢出");
      };
      if (viewport.height >= viewport.width) assert(board.board.w >= viewport.width - 4, `竖屏棋盘未撑满：${board.board.w}/${viewport.width}`);
      assert(graph.blocks["tree-viewport"].h >= (viewport.height < 600 ? 140 : viewport.height * 0.55), `画布仍被挤压：${JSON.stringify({ viewport, canvas: graph.blocks["tree-viewport"] })}`);
      await noOverflow();
      await dialog.getByRole("button", { name: "关闭", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      assert(await page.evaluate(() => document.activeElement.getClientRects().length > 0 && !!document.activeElement.closest(".bottom-sheet")), "焦点进入了隐藏的操作区或离开弹层");
      await page.keyboard.press("Tab");
      assert(await dialog.getByRole("button", { name: "关闭", exact: true }).evaluate((element) => element === document.activeElement), "弹层焦点没有循环回关闭按钮");
      const inspector = dialog.locator(".tree-inspector");
      const toggle = dialog.getByRole("button", { name: "节点操作", exact: true });
      const preview = dialog.getByRole("button", { name: "棋盘预览", exact: true });
      const options = await Promise.all([preview.boundingBox(), toggle.boundingBox()]);
      assert(Math.abs(options[0].y - options[1].y) < 1, "棋盘预览和节点操作未在同一行");
      assert(await dialog.locator(".tree-inspector-content").isHidden(), "节点详情未默认收起");
      if (viewport.width >= 900) {
        /**
         * 宽屏不许给"空的详情侧栏"保留空间：画布要几乎占满弹层。
         * 容差 64px 是**量出来的**（1280×800：弹层 1200、画布 1162；900×900：868 / 830 ⇒ 两侧
         * 各 19px 内边距 = 38px）。原来写死 28px 比实测内边距还小，弹层内边距一改它就假红；
         * 真被预留出一列侧栏会是 200px 量级，这条照样抓得住。
         */
        assert(graph.blocks["tree-viewport"].w >= graph.sheet.w - 64, "宽屏仍为空侧栏保留空间");
      }
      const closedCanvas = await dialog.locator(".tree-viewport").boundingBox();
      await toggle.click();
      assert(await dialog.locator(".tree-node-actions").isVisible(), "节点操作选项未展开");
      assert(await dialog.locator(".tree-preview-board").count() === 0, "节点操作选项不应同时打开棋盘预览");
      await noOverflow();
      if (viewport.width >= 900) {
        const canvas = await dialog.locator(".tree-viewport").boundingBox();
        const popup = await dialog.locator(".tree-inspector-content").boundingBox();
        const sheet = await dialog.boundingBox();
        assert(Math.abs(canvas.width - closedCanvas.width) < 2 && Math.abs(canvas.height - closedCanvas.height) < 2, "宽屏详情展开挤压了画布");
        assert(popup.y >= sheet.y && popup.y + popup.height <= sheet.y + sheet.height, "宽屏详情面板超出弹层");
      }
      await preview.click();
      assert(await dialog.locator(".tree-node-actions").isHidden(), "切换棋盘预览后节点操作没有收起");
      assert(await dialog.locator(".tree-preview-board .stone").count() === 20, "预览棋盘与所选第20手不一致");
      await noOverflow();
      await page.screenshot({ path: `qa/screenshots/tree-space-layout/${phase}-inspector-${viewport.width}.png` });
      await preview.click();
      assert(await dialog.locator(".tree-inspector-content").isHidden(), "再次点预览没有收起");
      /**
       * 右下角**小地图（缩略图）**的折叠（用户 2026-10-14：「我们要做的折叠是，把右下角缩略图折叠，
       * 就是那个相当于小地图一样的预览，而不是棋盘预览折叠」）。钉四件事：
       * ① 缩略图在 `.tree-viewport` 里面（09-22 的口径：要和主画布同一块，不做独立窗口）；
       * ② 它自己带一把折叠，折完原地只剩一颗小按钮、**就在画布最右下**；③ 点按钮缩略图回来；
       * ④ R196 那把"详情面板折叠 + 画布恢复按钮"确实撤干净了。
       */
      assert(await dialog.locator(".tree-viewport .tree-minimap").isVisible(), "画布右下角没有缩略图（它必须在主画布内）");
      assert(await dialog.locator(".tree-inspector-reopen").count() === 0
        && await dialog.getByLabel("折叠节点详情", { exact: true }).count() === 0, "R196 的详情面板折叠没撤干净");
      const minimapReopen = dialog.locator(".tree-minimap-reopen");
      assert(await minimapReopen.count() === 0, "还没折叠就出现了缩略图的恢复按钮");
      await dialog.getByLabel("折叠小地图", { exact: true }).click();
      assert(await dialog.locator(".tree-minimap").count() === 0, "缩略图折不起来");
      assert(await minimapReopen.isVisible(), "折叠后原地没有那颗恢复按钮");
      const chipBox = await minimapReopen.boundingBox();
      const canvasBox = await dialog.locator(".tree-viewport").boundingBox();
      assert(Math.abs(chipBox.x + chipBox.width - (canvasBox.x + canvasBox.width)) < 14
        && Math.abs(chipBox.y + chipBox.height - (canvasBox.y + canvasBox.height)) < 14,
        `折叠后的按钮没钉在画布最右下：${JSON.stringify({ chipBox, canvasBox, viewport })}`);
      await noOverflow();
      await minimapReopen.click();
      assert(await dialog.locator(".tree-viewport .tree-minimap").isVisible(), "点恢复按钮没把缩略图放回来");
      assert(await minimapReopen.count() === 0, "缩略图放回后恢复按钮还留着");
      await noOverflow();
      await dialog.getByLabel("展开与收起分支", { exact: true }).click();
      await dialog.locator(".tree-branch-choices").getByRole("button", { name: "展开全部", exact: true }).click();
      assert(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes") === "137", "常驻展开入口未展开全部分支");
      /**
       * 三档显示（用户 2026-10-14 把切换点从 50% / 20% 挪到 **20% / 5%**）：
       *   ≥50% 完整标签（含分支三重标记）· **≤20%** 单行「坐标 · 手数」紧凑胶囊 · **≤5%** 只剩结构圆点。
       * 紧凑档的画布字号是 6/比例 ⇒ 屏幕上恒定 ~6px，所以 20% 与 10% 都还得读得出。
       */
      const TIER = { "100%": ["detail", "full"], "50%": ["detail", "full"], "20%": ["detail", "compact"], "10%": ["detail", "compact"], "5%": ["structure", null] };
      for (const preset of ["50%", "20%", "10%", "5%", "100%"]) {
        await chooseTreeZoom(dialog, preset);
        const [wantDisplay, wantDetail] = TIER[preset];
        const display = await dialog.locator(".tree-viewport").getAttribute("data-display");
        const detail = await dialog.locator(".tree-viewport").getAttribute("data-detail");
        assert(display === wantDisplay && (wantDetail === null || detail === wantDetail),
          `${preset} 的档位不对：display=${display} detail=${detail}（期望 ${wantDisplay}${wantDetail ? `/${wantDetail}` : ""}）`);
        if (display === "detail") assert(await dialog.locator(".tree-node-label, .tree-chain-label, .tree-compact-label").count() > 0, `${preset} 丢失节点文字`);
        else assert(await dialog.locator(".tree-structure-node").count() > 0, `${preset} 结构档没画出圆点`);
        if (preset === "20%" || preset === "10%") {
          const pixels = await dialog.locator(".tree-compact-label").evaluateAll((labels) => labels.map((label) => { const matrix = label.getScreenCTM(); return Number.parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b); }));
          assert(pixels.length > 0 && Math.min(...pixels) >= 5.9, `${preset} 字号仍过小：${Math.min(...pixels)}px`);
          /**
           * 重叠量的是**胶囊本体**（`.tree-compact-face`），不是 `.tree-node` 组框：
           * 紧凑档的文字被 `overflow="hidden"` 裁在胶囊里（10% 实测胶囊 15px、文字框 16px），
           * 量组框会把那 1px 取整当成"相互重叠"报假红。
           */
          const overlap = await dialog.locator(".tree-compact-face").evaluateAll((faces) => {
            const boxes = faces.map((face) => face.getBoundingClientRect());
            return boxes.some((a, index) => boxes.slice(index + 1).some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
          });
          assert(!overlap, `${preset} 的紧凑胶囊相互重叠`);
          await page.screenshot({ path: `qa/screenshots/tree-space-layout/${phase}-detail${preset.replace("%", "")}-${viewport.width}.png` });
        }
        assert(await dialog.locator(".tree-zoom-menu").getAttribute("open") === null, "选择比例后缩放菜单未关闭");
      }
      await dialog.locator(".tree-zoom-range").evaluate((element) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, Math.log(0.19 / 0.01) / Math.log(100 / 0.01));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
      assert(await dialog.locator(".tree-viewport").getAttribute("data-display") === "detail"
        && await dialog.locator(".tree-viewport").getAttribute("data-detail") === "compact", "19% 应是紧凑档（单行坐标 · 手数）");
      await dialog.locator(".tree-zoom-range").evaluate((element) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, Math.log(0.04 / 0.01) / Math.log(100 / 0.01));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
      assert(await dialog.locator(".tree-viewport").getAttribute("data-display") === "structure", "4% 尚未切换结构点");
      await chooseTreeZoom(dialog, "100%");
      await dialog.getByLabel("选择缩放比例", { exact: true }).click();
      await dialog.getByLabel("选择缩放比例", { exact: true }).press("Escape");
      assert(await dialog.isVisible() && await dialog.locator(".tree-zoom-menu").getAttribute("open") === null, "退出缩放菜单错误关闭了分支树");
      await dialog.getByLabel("选择缩放比例", { exact: true }).click();
      await dialog.locator(".tree-toolbar-title").click();
      assert(await dialog.locator(".tree-zoom-menu").getAttribute("open") === null, "点按菜单外未收起缩放菜单");
      await dialog.locator(".tree-mapbar").getByRole("button", { name: "只看这支", exact: true }).click();
      assert(Number(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes")) < 137, "聚焦未缩小范围");
      await noOverflow();
      await dialog.locator(".tree-mapbar").getByRole("button", { name: "返回全谱", exact: true }).click();
      assert(await dialog.locator(".tree-viewport").getAttribute("data-layout-nodes") === "137", "返回全谱丢失展开状态");
      await dialog.getByRole("button", { name: "总览全部已展开分支", exact: true }).click();
      await settle(page);
      await page.screenshot({ path: `qa/screenshots/tree-space-layout/${phase}-expanded-${viewport.width}.png` });
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await noOverflow();
      await page.setViewportSize(viewport);
      await noOverflow();
      await chooseTreeZoom(dialog, "20%");
      await dialog.getByRole("button", { name: "看清所选节点", exact: true }).click();
      assert(await dialog.getByLabel("选择缩放比例", { exact: true }).innerText() === "100%", "看清所选节点未恢复可读比例");
      const centered = await dialog.locator(".tree-node.selected").evaluate((node) => {
        const rect = node.getBoundingClientRect(), canvas = node.closest(".tree-viewport").getBoundingClientRect();
        return Math.abs(rect.x + rect.width / 2 - canvas.x - canvas.width / 2) < 3 && Math.abs(rect.y + rect.height / 2 - canvas.y - canvas.height / 2) < 3;
      });
      assert(centered, "看清所选节点没有将节点居中");
      await dialog.locator('.tree-node[aria-label^="D14"]').click();
      assert((await dialog.locator(".tree-mapbar-selected small").innerText()).includes("第 19 手"), "底部没有显示所选节点手数");
      assert(await dialog.locator(".tree-inspector-content").isHidden(), "浏览节点时意外打开详情");
      await dialog.getByRole("button", { name: "将所选节点定位到棋盘", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert((await page.getByLabel("当前工作状态").first().innerText()).includes("第 19 手"), "快捷定位没有更新主棋盘");
      assert(errors.length === 0, `浏览器错误：${errors.join("; ")}`);
    }
    results.push({ viewport, board, graph });
    await context.close();
  }
  await writeFile(`qa/screenshots/tree-space-layout/${phase}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ viewport, board, graph }) => ({ viewport, board: board.board && { x: board.board.x, w: board.board.w }, canvas: graph.blocks["tree-viewport"], sheet: graph.sheet && { h: graph.sheet.h, client: graph.sheet.clientHeight, scroll: graph.sheet.scrollHeight } })), null, 2));
} finally {
  await browser.close();
}
