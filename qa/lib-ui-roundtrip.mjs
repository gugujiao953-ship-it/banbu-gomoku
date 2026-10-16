import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

/**
 * LIB 用户流程端到端门禁（真实 UI）。
 *
 * 守的是用户 09-16 报告的那条路径：**打开一份原有 LIB → 编辑 → 导出 LIB → 再打开，
 * 原件必须完好**。语料刻意做全：多分支 / 长分支（4 手）/ 短分支（1 手）/ 中分支（2 手）/
 * 深处分枝（挂在主线第 3 手）/ 短注 / 长注 / 多行注 / 盘面文字标签。
 *
 * 为什么库函数级别的门禁（qa/lib-reader-parity.mjs）不够：动态视图（LIB / DP / 分页）
 * 一旦编辑会走 `detachViewForEditing()` → `createEditableViewCopy()`，该副本**刻意清掉
 * `sourceFormat`**（不该声称还能写回源格式），于是 `activeRenLibSession` 与
 * `originalBinaryFile` 双双为 null——只测库函数会漏掉整条链路，实测确实仍丢 3 手。
 *
 *   QA_BASE_URL='http://127.0.0.1:5299/?qa=1' node qa/lib-ui-roundtrip.mjs
 *
 * 首运行欢迎页必须关掉，否则它盖住整块棋盘，后面每一次点格子都会因为
 * 「其它元素拦截了指针事件」超时（实测就是这个报错）。关掉的方式**只有一种**：
 * URL 上的 `?qa=1`。别再靠写 `banbu-first-run-welcome-v1="true"` —— 自 09-14
 * 起那个键改成**按版本号**存，字面量 "true" 只代表「在更早的版本上看过」，
 * 当前版本一律再弹一次（见 src/features/onboarding/onboarding.ts）。
 * run-qa 注入的 QA_BASE_URL 自带 ?qa=1；手动导出 QA_BASE_URL 时多半没有，
 * 所以这里统一补一次（已有查询串就不动，避免覆盖第 18 行的默认值）。
 */
const rawBaseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5299/?qa=1";
const baseUrl = rawBaseUrl.includes("?") ? rawBaseUrl : `${rawBaseUrl}?qa=1`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const errors = [];
try {
  /** 每个场景一个**独立上下文**：上一个场景会留下未保存草稿，再导入文件会被
   *  「有未保存草稿」守卫挡住（实测点击超时），那与 LIB 往返无关。 */
  const openApp = async () => {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true, serviceWorkers: "block" });
    await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 30_000 });
    return { context, page };
  };

  /** 页面内工具：造综合语料 LIB、用官方核心完整读回、比对结构+注释+标签。 */
  const pageHelpers = async (page) => {
    const sourceB64 = await page.evaluate(async () => {
      const { createDocument, addMove } = await import("/src/game.ts");
      const { exportLib } = await import("/src/lib-export.ts");
      let document = createDocument("综合老谱");
      const step = (parentId, row, col) => { const added = addMove(document, parentId, { row, col }); document = added.document; return added.nodeId; };
      const m1 = step(document.rootId, 7, 7);
      const m2 = step(m1, 7, 8);
      const m3 = step(m2, 6, 8);
      const m4 = step(m3, 6, 9);
      const long1 = step(m1, 8, 8); const long2 = step(long1, 8, 9); const long3 = step(long2, 9, 9); step(long3, 9, 8);
      step(m1, 6, 6);                                    // 短分支：一手
      const mid = step(m1, 6, 7); step(mid, 5, 7);       // 中分支：两手
      const deep1 = step(m3, 7, 9); step(deep1, 8, 10);  // 深处分枝
      document.nodes[m2] = { ...document.nodes[m2], comment: "短注" };
      document.nodes[m3] = { ...document.nodes[m3], comment: "长注释".repeat(30) };
      document.nodes[m4] = { ...document.nodes[m4], comment: "第一行\n第二行\n第三行" };
      document.nodes[long2] = { ...document.nodes[long2], comment: "长分支中段" };
      document.nodes[long3] = { ...document.nodes[long3], boardText: "要点" };
      document.nodes[mid] = { ...document.nodes[mid], comment: "中分支注" };
      return btoa(String.fromCharCode(...exportLib(document).bytes));
    });
    const compare = (exportedB64) => page.evaluate(async ({ sourceB64, exportedB64 }) => {
      const { RenLibWebViewSession } = await import("/src/renlib-web/renlib-web-view-session.ts");
      const { importRecordFile } = await import("/src/formats.ts");
      const toBytes = (b64) => Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
      const collect = (document, id, path = [], acc = null) => {
        acc = acc || { moves: [], comments: [], labels: [] };
        const node = document.nodes[id];
        if (!node) return acc;
        const own = path.join("-");
        if (node.move) {
          acc.moves.push(own || `${node.move.row},${node.move.col}`);
          if (node.comment) acc.comments.push(`${own}=${node.comment}`);
          if (node.boardText) acc.labels.push(`${own}=${node.boardText}`);
        }
        const children = [...node.children]
          .map((child) => ({ child, node: document.nodes[child] }))
          .filter((entry) => entry.node?.move)
          .sort((a, b) => (a.node.move.row * 15 + a.node.move.col) - (b.node.move.row * 15 + b.node.move.col));
        for (const entry of children) collect(document, entry.child, [...path, `${entry.node.move.row},${entry.node.move.col}`], acc);
        return acc;
      };
      const readFull = async (bytes, name) => {
        const session = new RenLibWebViewSession();
        try {
          await session.open(new File([bytes], name, { type: "application/octet-stream" }));
          const sgf = await session.exportOriginalSgf();
          const parsed = await importRecordFile(new File([sgf], `${name}.sgf`, { type: "application/x-go-sgf" }));
          const doc = parsed.document;
          // 核心把盘面文字写成父节点上的 LB[子节点位置:文字]，按生产同款约定还原。
          for (const node of Object.values(doc.nodes)) {
            for (const mark of (node.marks || []).filter((entry) => entry.kind === "label" && entry.label)) {
              const childId = node.children.find((id) => {
                const child = doc.nodes[id];
                return child?.move && child.move.row === mark.row && child.move.col === mark.col;
              });
              if (childId && !doc.nodes[childId].boardText) doc.nodes[childId] = { ...doc.nodes[childId], boardText: mark.label };
            }
          }
          return collect(doc, doc.rootId);
        } finally { session.close(); }
      };
      return { original: await readFull(toBytes(sourceB64), "source.lib"), exported: await readFull(toBytes(exportedB64), "exported.lib") };
    }, { sourceB64, exportedB64 });
    return { sourceB64, compare };
  };

  const runFlow = async (label, edit) => {
    const { context, page } = await openApp();
    try {
      const { sourceB64, compare } = await pageHelpers(page);
      await page.locator('input[type="file"]').first().setInputFiles({
        name: `${label}.lib`,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(sourceB64, "base64"),
      });
      await page.waitForSelector(".renju-board .stone", { timeout: 30_000 });
      await page.waitForTimeout(600);
      await edit(page);
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: "打开导出方式" }).click();
      await page.locator(".export-format-grid").waitFor({ state: "visible" });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(".export-format-grid button").filter({ has: page.locator('b:text-is("LIB")') }).click(),
      ]);
      const bytes = await readFile(await download.path());
      return await compare(bytes.toString("base64"));
    } finally {
      await context.close();
    }
  };

  const check = (result, label, expectExtraMoves, expectAddedComment) => {
    const missing = result.original.moves.filter((path) => !result.exported.moves.includes(path));
    assert(missing.length === 0, `[${label}] 导出丢失 ${missing.length} 手：${missing.join(" | ")}`);
    const missingComments = result.original.comments.filter((entry) => !result.exported.comments.includes(entry));
    assert(missingComments.length === 0, `[${label}] 导出丢了注释：${missingComments.join(" | ")}`);
    const missingLabels = result.original.labels.filter((entry) => !result.exported.labels.includes(entry));
    assert(missingLabels.length === 0, `[${label}] 导出丢了盘面文字：${missingLabels.join(" | ")}`);
    const extra = result.exported.moves.filter((path) => !result.original.moves.includes(path));
    assert(extra.length <= expectExtraMoves, `[${label}] 夹带了 ${extra.length} 个原本不存在的分支（最多允许 ${expectExtraMoves} 个新分支）：${extra.join(" | ")}`);
    if (expectAddedComment) assert(result.exported.comments.includes(expectAddedComment), `[${label}] 新写的注释没进文件：${expectAddedComment}`);
    console.log(`[lib-ui] ${label}：原件 ${result.original.moves.length} 手 / ${result.original.comments.length} 注释 / ${result.original.labels.length} 标签 全在，新增分支 ${extra.length} 个${expectAddedComment ? "，新注释已写入" : ""}`);
  };

  // 场景 1：在起始局面加一条新分支
  const flow1 = await runFlow("加分支", async (page) => {
    await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
  });
  check(flow1, "起点加分支", 1, "");

  // 场景 2：沿真实主线点两手下潜（7,8 → 6,8），再在深处加一条新分支
  const flow2 = await runFlow("深处加分支", async (page) => {
    // 沿真实主线逐手下潜。棋盘把「当前局的后续手」渲染成候选变化格
    // （aria-label 形如「切换到变化 I8」），点它即导航；(7,8)=I8、(6,8)=I9。
    await page.locator('[role="gridcell"][aria-label*="I8"]').first().click();
    await page.waitForTimeout(1200);
    await page.locator('[role="gridcell"][aria-label*="I9"]').first().click();
    await page.waitForTimeout(1200);
    await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
  });
  check(flow2, "深处加分支", 1, "");

  // 场景 3：给当前节点写一条新注释
  const flow3 = await runFlow("写注释", async (page) => {
    await page.locator('.dock-tabs button', { hasText: "编辑" }).first().click();
    await page.waitForTimeout(200);
    await page.locator('.dock-panel button', { hasText: "注释" }).first().click();
    await page.waitForTimeout(300);
    const textarea = page.locator(".sheet-body textarea").first();
    await textarea.fill("端到端新注释");
    await page.locator(".sheet-body").getByRole("button", { name: /完成/ }).first().click();
    await page.waitForTimeout(400);
  });
  check(flow3, "写注释", 0, "7,7=端到端新注释");

  // ---- 「不能导出」必须有提示：这三个按钮以前是 disabled，触摸设备上点了毫无反馈 ----
  const formatButton = (page, label) => page.locator(".export-format-grid button").filter({ has: page.locator(`b:text-is("${label}")`) });
  const expectToast = async (page, needle, label) => {
    const message = page.locator(".app-toast .app-toast-message");
    await message.first().waitFor({ state: "visible", timeout: 6_000 });
    const text = (await message.allInnerTexts()).join(" ");
    assert(text.includes(needle), `[${label}] 提示文案里没有「${needle}」，实际是：${text}`);
    console.log(`[lib-ui] ${label}：已提示「${text.slice(0, 60)}${text.length > 60 ? "…" : ""}」`);
  };

  // C1 未编辑的动态 LIB 视图 → 直接导出会丢原库其余分支，必须说明
  {
    const { context, page } = await openApp();
    try {
      const { sourceB64 } = await pageHelpers(page);
      await page.locator('input[type="file"]').first().setInputFiles({ name: "未编辑.lib", mimeType: "application/octet-stream", buffer: Buffer.from(sourceB64, "base64") });
      await page.waitForSelector(".renju-board .stone", { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "打开导出方式" }).click();
      await page.locator(".export-format-grid").waitFor({ state: "visible" });
      await formatButton(page, "LIB").click();
      await expectToast(page, "原库其余分支", "C1 未编辑动态视图点 LIB");
    } finally { await context.close(); }
  }

  // C2 导出范围不是「整份棋谱」→ 说明要先切范围
  {
    const { context, page } = await openApp();
    try {
      const { sourceB64 } = await pageHelpers(page);
      await page.locator('input[type="file"]').first().setInputFiles({ name: "范围.lib", mimeType: "application/octet-stream", buffer: Buffer.from(sourceB64, "base64") });
      await page.waitForSelector(".renju-board .stone", { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "打开导出方式" }).click();
      await page.locator(".export-format-grid").waitFor({ state: "visible" });
      await page.locator(".export-scope-grid button").filter({ hasText: "当前变化" }).click();
      await page.waitForTimeout(200);
      await formatButton(page, "LIB").click();
      await expectToast(page, "整份棋谱", "C2 范围为当前变化点 LIB");
      await formatButton(page, "PSQ").click();
      await expectToast(page, "整份棋谱", "C2 范围为当前变化点 PSQ");
      await page.locator(".export-primary-card.direct").click();
      await expectToast(page, "整份棋谱", "C2 范围为当前变化点原格式直出");
    } finally { await context.close(); }
  }

  // C3 二十路棋谱（Gomocup Standard/Freestyle 就是 20 路）→ LIB 只支持十五路
  {
    const { context, page } = await openApp();
    try {
      const twenty = ["Piskvorky 20x20, 11:11, 0", "10,10,0", "11,11,0", "10,9,5", "12,12,5", "1,Renju", ""].join("\r\n");
      await page.locator('input[type="file"]').first().setInputFiles({ name: "二十路.psq", mimeType: "text/plain", buffer: Buffer.from(twenty, "utf8") });
      // 导入后停在根局面（棋盘上没有棋子），所以等棋盘路数而不是等棋子。
      await page.waitForFunction(() => document.querySelector(".renju-board")?.getAttribute("aria-label")?.includes("20路"), null, { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "打开导出方式" }).click();
      await page.locator(".export-format-grid").waitFor({ state: "visible" });
      await formatButton(page, "LIB").click();
      await expectToast(page, "十五路", "C3 二十路点 LIB");
    } finally { await context.close(); }
  }

  // C4 PSQ 只保留主线 → 导出后必须说明分支没进文件
  {
    const { context, page } = await openApp();
    try {
      const { sourceB64 } = await pageHelpers(page);
      await page.locator('input[type="file"]').first().setInputFiles({ name: "主线.lib", mimeType: "application/octet-stream", buffer: Buffer.from(sourceB64, "base64") });
      await page.waitForSelector(".renju-board .stone", { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.locator('[role="gridcell"][aria-label$="空位"]').first().click(); // 先编辑一次，脱离「动态库视图」限制
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: "打开导出方式" }).click();
      await page.locator(".export-format-grid").waitFor({ state: "visible" });
      const [download] = await Promise.all([page.waitForEvent("download"), formatButton(page, "PSQ").click()]);
      assert(download.suggestedFilename().endsWith(".psq"), "PSQ 导出文件名异常");
      await expectToast(page, "只保存主线", "C4 有分支时导出 PSQ");
    } finally { await context.close(); }
  }

  // C5 图形标注要能跟着 LIB 走出去（写进注释清单 + 位置重合的已有分支贴字形），不能静默丢
  {
    const { context, page } = await openApp();
    try {
      const { sourceB64 } = await pageHelpers(page);
      await page.locator('input[type="file"]').first().setInputFiles({ name: "带标注.lib", mimeType: "application/octet-stream", buffer: Buffer.from(sourceB64, "base64") });
      await page.waitForSelector(".renju-board .stone", { timeout: 30_000 });
      await page.waitForTimeout(600);
      // 用真实 UI 放一个图形标注：标注面板 → 样式「实心圆」→ 内容「无」→ 点棋盘
      await page.getByRole("button", { name: "标注", exact: true }).click();
      await page.locator(".mark-studio").waitFor({ state: "visible", timeout: 10_000 });
      await page.locator(".mark-studio-box").filter({ hasText: "样式" }).click();
      await page.locator(".mark-studio-options.styles").waitFor({ state: "visible" });
      await page.locator(".mark-studio-options.styles button").filter({ hasText: "实心圆" }).click();
      await page.waitForTimeout(300);
      await page.locator(".mark-studio-box").filter({ hasText: "类型" }).click();
      await page.locator(".mark-studio-options.types").waitFor({ state: "visible" });
      await page.locator(".mark-studio-options.types button").filter({ hasText: "无" }).first().click();
      await page.waitForTimeout(300);
      await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
      await page.waitForTimeout(900);
      // 棋盘上确实画出了圆形标注（不是叉），这是「选圆圈变叉」那条 bug 的回归断言
      const drawn = await page.evaluate(() => {
        const layer = document.querySelector(".board-annotation-layer");
        return layer ? [...layer.querySelectorAll("circle,path,rect")].map((el) => el.tagName.toLowerCase()) : [];
      });
      assert(drawn.includes("circle"), `[C5] 选了实心圆，棋盘上却没画出圆形（实际：${drawn.join(",") || "空"}）`);

      await page.getByRole("button", { name: "打开导出方式" }).click();
      await page.locator(".export-format-grid").waitFor({ state: "visible" });
      const [download] = await Promise.all([page.waitForEvent("download"), formatButton(page, "LIB").click()]);
      await expectToast(page, "已随 LIB 带走", "C5 带图形标注导出 LIB");
      // 关键：标注必须真的落进文件字节。09-17 起**空点**上的标注写成"非着法节点"
      // （对局软件在棋盘上画成标记，且不当成一手棋），所以断言的是**字形本身**在文件里，
      // 而不是以前那条注释清单；注释清单只剩"一格已被原作者占用/放不下"两种用途。
      const bytes = await readFile(await download.path());
      const has = (pattern) => bytes.some((_, i) => pattern.every((b, j) => bytes[i + j] === b));
      const marker = [0xa1, 0xbe, 0xb1, 0xea, 0xd7, 0xa2, 0xa1, 0xbf];   // 【标注】
      const solidCircle = [0xa1, 0xf1];                                   // ●
      assert(has(solidCircle), "[C5] 导出的 LIB 字节里没有实心圆字形");
      assert(!has(marker), "[C5] 空点标注不该再退成注释清单（应写成非着法节点）");
      console.log("[lib-ui] C5：空点标注写成非着法节点，文件里带实心圆字形 ●，且没有退成注释");
    } finally { await context.close(); }
  }

  if (errors.length) throw new Error(errors.join("\n"));
  console.log("[lib-ui] pass");
} finally {
  await browser.close();
}
