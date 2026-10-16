import { chromium } from "playwright";

/**
 * LIB 读写门禁：以**官方 RenLib 核心**为裁判。
 *
 * 为什么需要这个门禁：生产环境打开 .lib 走 RenLibWebViewSession（官方核心），
 * 而写 .lib 用我们自研的 src/lib-export.ts。这两者之间过去**从未被验证过**——
 * 既有的 lib-export.test.ts 用 importRenLibLegacy 对拍，那是我方 legacy 解析器，
 * 与 writer 共享同一套位约定，互相印证得很好却与官方读取器无关。
 *
 * 本门禁守四件事：
 *   A. **结构保真**：我方写出的 LIB，官方核心（lib2sgf 完整转换）能还原出同一棵树
 *      （含多层分枝、老分支带续手、深链）。
 *   B. **顺序幂等**：官方读取器把同层子节点按坐标升序插入，所以写入顺序必须就是坐标序，
 *      否则「保存→打开→再保存」会反复重排。
 *   C. **不丢原库**：LIB 源在 App 里是**动态投影**（非当前路径的分支只有一手）。
 *      按投影导出会丢原库其余分支的续手，这正是用户 09-16 反馈的现象；
 *      门禁断言 libExportFromSource 走完整原谱后**一手不丢**且用户编辑在。
 *   D. **注释保真**：节点注释与盘面文字经 LIB 往返后仍在（GBK 载荷的偶数补位）。
 *
 * 跑法：需要 dev 服务器
 *   npm run dev -- --port 5299
 *   QA_BASE_URL=http://127.0.0.1:5299/ node qa/lib-reader-parity.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5299/";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.route("**/qa-lib-host.html", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
  }));
  await page.goto(new URL("qa-lib-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { createDocument, addMove } = await import("/src/game.ts");
    const { exportLib } = await import("/src/lib-export.ts");
    const { importRecordFile } = await import("/src/formats.ts");
    const { RenLibWebViewSession } = await import("/src/renlib-web/renlib-web-view-session.ts");
    const { pushDraft, emptyDraft, buildDraftOverlay, projectedDocument } = await import("/src/draft-operations.ts");
    const { libExportFromSource } = await import("/src/lib-source-export.ts");

    /** 完整手序列出：位置路径集合，外加每个节点的注释/文字。
     *  子节点按坐标升序展开——官方读取器给的就是这个顺序，两边必须同口径比较。 */
    const collect = (document, id, path = [], acc = { moves: [], comments: [] }) => {
      const node = document.nodes[id];
      if (!node) return acc;
      const own = path.join("-");
      if (node.move) {
        acc.moves.push(own || `${node.move.row},${node.move.col}`);
        if (node.comment) acc.comments.push(`${own}=${node.comment}`);
      }
      const children = [...node.children]
        .map((child) => ({ child, node: document.nodes[child] }))
        .filter((entry) => entry.node?.move)
        .sort((a, b) => (a.node.move.row * 15 + a.node.move.col) - (b.node.move.row * 15 + b.node.move.col));
      for (const entry of children) {
        collect(document, entry.child, [...path, `${entry.node.move.row},${entry.node.move.col}`], acc);
      }
      return acc;
    };
    const readFull = async (bytes, name) => {
      const session = new RenLibWebViewSession();
      try {
        await session.open(new File([bytes], name, { type: "application/octet-stream" }));
        const sgf = await session.exportOriginalSgf();
        // 原始字节交给导入器：核心的 SGF 声明 CA[gb2312]，在这里自己按 UTF-8 解会乱码。
        const parsed = await importRecordFile(new File([sgf], `${name}.sgf`, { type: "application/x-go-sgf" }));
        return { ...collect(parsed.document, parsed.document.rootId), document: parsed.document };
      } finally {
        session.close();
      }
    };
    const build = (spec, title = "gate") => {
      let document = createDocument(title);
      const step = (parentId, row, col) => {
        const added = addMove(document, parentId, { row, col });
        document = added.document;
        return added.nodeId;
      };
      const walk = (parentId, node) => {
        const id = step(parentId, node.row, node.col);
        if (node.comment) { document.nodes[id] = { ...document.nodes[id], comment: node.comment }; }
        if (node.boardText) { document.nodes[id] = { ...document.nodes[id], boardText: node.boardText }; }
        for (const child of node.children || []) walk(id, child);
        return id;
      };
      for (const child of [spec]) walk(document.rootId, child);
      return document;
    };
    const shapes = [
      { name: "主线", spec: { row: 7, col: 7, children: [{ row: 7, col: 8, children: [{ row: 6, col: 8 }] }] } },
      { name: "一层分枝", spec: { row: 7, col: 7, children: [{ row: 7, col: 8, children: [{ row: 8, col: 7 }] }, { row: 8, col: 8 }] } },
      {
        name: "老分支带续手 + 新分支",
        spec: {
          row: 7, col: 7,
          children: [
            { row: 7, col: 8, children: [{ row: 6, col: 8, children: [{ row: 6, col: 7 }] }] },
            { row: 8, col: 8, children: [{ row: 8, col: 9 }, { row: 9, col: 9 }] },
          ],
        },
      },
      {
        name: "三层分枝",
        spec: {
          row: 7, col: 7,
          children: [
            { row: 7, col: 8, children: [{ row: 8, col: 8, children: [{ row: 9, col: 8 }, { row: 9, col: 9 }] }] },
            { row: 6, col: 6, children: [{ row: 5, col: 6 }] },
            { row: 8, col: 5 },
          ],
        },
      },
      {
        name: "注释",
        spec: { row: 7, col: 7, comment: "中文注释，含标点。win 100%", children: [{ row: 7, col: 8, comment: "第二手" }] },
      },
    ];

    // ---- A + B + D：形状回环（写出的顺序就是坐标序，读回必须一模一样） ----
    const shapeRows = [];
    for (const shape of shapes) {
      const document = build(shape.spec);
      const { bytes } = exportLib(document);
      const expected = collect(document, document.rootId);
      const actual = await readFull(bytes, `${shape.name}.lib`);
      // 字节幂等：读回来的树再写一次必须逐字节相同（否则「保存→打开→再保存」会漂移）。
      const again = exportLib(actual.document).bytes;
      const idempotent = again.length === bytes.length && again.every((byte, index) => byte === bytes[index]);
      shapeRows.push({
        name: shape.name,
        expectedMoves: expected.moves.length,
        actualMoves: actual.moves.length,
        missing: expected.moves.filter((path) => !actual.moves.includes(path)),
        orderStable: expected.moves.join("|") === actual.moves.join("|"),
        missingComments: expected.comments.filter((entry) => !actual.comments.includes(entry)),
        idempotent,
        firstDiff: idempotent ? -1 : [...bytes].findIndex((byte, index) => byte !== again[index]),
      });
    }

    // ---- C：App 场景——打开 LIB → 加一手 → 导出 → 再打开，一手不丢 ----
    const source = build({
      row: 7, col: 7,
      children: [
        { row: 7, col: 8, children: [{ row: 6, col: 8, children: [{ row: 6, col: 7 }] }] },
        { row: 8, col: 8, children: [{ row: 8, col: 9 }, { row: 9, col: 9 }] },
      ],
    }, "app-scenario");
    const originalBytes = exportLib(source).bytes;
    const originalFull = await readFull(originalBytes, "scenario-source.lib");

    const session = new RenLibWebViewSession();
    const opened = await session.open(new File([originalBytes], "scenario.lib", { type: "application/octet-stream" }));
    const projected = opened.document;
    const occupied = new Set();
    for (const node of Object.values(projected.nodes)) if (node.move) occupied.add(node.move.row * 15 + node.move.col);
    let target = null;
    for (let row = 0; row < 15 && !target; row += 1) for (let col = 0; col < 15 && !target; col += 1) if (!occupied.has(row * 15 + col)) target = { row, col };
    const parentNode = projected.nodes[opened.currentId];
    const player = parentNode.move ? (parentNode.move.player === "black" ? "white" : "black") : "black";
    const draft = pushDraft(emptyDraft(), {
      type: "add-move",
      parentId: opened.currentId,
      node: { id: `${opened.currentId}-gate-new`, parentId: opened.currentId, children: [], move: { ...target, player }, comment: "", marks: [] },
    });
    const viewDocument = projectedDocument(projected, buildDraftOverlay(draft, projected));
    // 旧通道：直接导出动态投影（用户遇到的就是它）
    const legacyFull = await readFull(exportLib(viewDocument).bytes, "scenario-legacy.lib");
    // 新通道：完整原谱底板 + 草稿
    const fixed = await libExportFromSource({ session, draft, viewDocument, sourceDocument: projected, fallback: viewDocument });
    const fixedFull = await readFull(fixed.bytes, "scenario-fixed.lib");
    session.close();

    const addedPath = (() => {
      const path = [];
      let id = opened.currentId;
      while (id && projected.nodes[id]?.move) {
        path.unshift(`${projected.nodes[id].move.row},${projected.nodes[id].move.col}`);
        id = projected.nodes[id].parentId;
      }
      return [...path, `${target.row},${target.col}`].join("-");
    })();

    // ---- 顺序探针：故意逆序写入，读回应为坐标序 ----
    const orderSource = build({ row: 7, col: 7, children: [{ row: 8, col: 8 }, { row: 7, col: 8 }, { row: 6, col: 6 }] }, "order");
    const orderRead = await readFull(exportLib(orderSource).bytes, "order.lib");

    // ---- 删除分支：草稿的 delete-subtree 曾被静默跳过——buildDraftOverlay 把被删节点放进
    //      overlay.deleted，projectedDocument 的 nodes[id] 对它返回 undefined，于是按位置路径
    //      解析时找不到该节点（「有一处删除找不到位置，已跳过」），导出文件里那条分支还在。
    //      修法是解析 id 时先查**叠加草稿之前**的投影（sourceDocument）。这里锁住它。
    const deleteScenario = await (async () => {
      let document = build({
        row: 7, col: 7,
        children: [
          { row: 7, col: 8, children: [{ row: 6, col: 8, children: [{ row: 6, col: 7 }] }] },
          { row: 8, col: 8, children: [{ row: 8, col: 9 }, { row: 9, col: 9 }] },
        ],
      }, "delete-scenario");
      const sourceBytes = exportLib(document).bytes;
      const sourceFull = await readFull(sourceBytes, "delete-source.lib");
      const deleteSession = new RenLibWebViewSession();
      const openedDelete = await deleteSession.open(new File([sourceBytes], "delete.lib", { type: "application/octet-stream" }));
      const projectionDelete = openedDelete.document;
      const victim = Object.values(projectionDelete.nodes).find((node) => node.move?.row === 8 && node.move?.col === 8);
      const victimPath = (() => {
        const path = [];
        let cursor = victim?.id;
        while (cursor && projectionDelete.nodes[cursor]?.move) {
          path.unshift(`${projectionDelete.nodes[cursor].move.row},${projectionDelete.nodes[cursor].move.col}`);
          cursor = projectionDelete.nodes[cursor].parentId;
        }
        return path.join("-");
      })();
      const deleteDraft = victim ? pushDraft(emptyDraft(), { type: "delete-subtree", parentId: victim.parentId, rootId: victim.id }) : emptyDraft();
      const deleteView = projectedDocument(projectionDelete, buildDraftOverlay(deleteDraft, projectionDelete));
      const deleteExport = await libExportFromSource({ session: deleteSession, draft: deleteDraft, viewDocument: deleteView, sourceDocument: projectionDelete, fallback: deleteView });
      deleteSession.close();
      const afterDelete = await readFull(deleteExport.bytes, "delete-out.lib");
      const surviving = sourceFull.moves.filter((path) => path !== victimPath && !path.startsWith(`${victimPath}-`));
      return {
        victimPath,
        warnings: deleteExport.warnings,
        deletedStillThere: afterDelete.moves.filter((path) => path === victimPath || path.startsWith(`${victimPath}-`)),
        lostOthers: surviving.filter((path) => !afterDelete.moves.includes(path)),
      };
    })();

    // ---- D2：盘面文字。核心的 lib2sgf 把它编码成**父节点上的 LB[该节点位置:文字]**，
    //      不带独立属性，所以「读回 document 的 boardText」永远是空的——判据必须是
    //      **官方核心自己是否还能报出这个标签**。生产通道（libExportFromSource）按同一
    //      约定还原后再写回 LIB，否则「编辑后另存 LIB」会把原库标签洗掉。
    const labelSource = build({ row: 7, col: 7, children: [{ row: 7, col: 8, boardText: "绝杀" }] }, "label");
    const labelBytes1 = exportLib(labelSource).bytes;
    const labelSession = new RenLibWebViewSession();
    const labelOpened = await labelSession.open(new File([labelBytes1], "label.lib", { type: "application/octet-stream" }));
    const labelExport = await libExportFromSource({
      session: labelSession,
      draft: emptyDraft(),
      viewDocument: labelOpened.document,
      fallback: labelOpened.document,
    });
    labelSession.close();

    // 核心报出的标签：SGF 文本是 GBK，按 gb18030 解才能看到中文。
    const labelReport = async (bytes, name) => {
      const session = new RenLibWebViewSession();
      try {
        await session.open(new File([bytes], name, { type: "application/octet-stream" }));
        const sgf = new TextDecoder("gb18030").decode(new Uint8Array(await session.exportOriginalSgf()));
        return { sgf, hasLabel: sgf.includes("LB[") && sgf.includes("绝杀") };
      } finally {
        session.close();
      }
    };
    const labelAfterSource = await labelReport(labelBytes1, "label-src.lib");
    const labelAfterExport = await labelReport(labelExport.bytes, "label-out.lib");

    // 生产通道的字节幂等：还原后的文件再走一遍必须逐字节相同（保存→打开→再保存不漂移）。
    const labelSession2 = new RenLibWebViewSession();
    const labelOpened2 = await labelSession2.open(new File([labelExport.bytes], "label-2.lib", { type: "application/octet-stream" }));
    const labelExport2 = await libExportFromSource({
      session: labelSession2,
      draft: emptyDraft(),
      viewDocument: labelOpened2.document,
      fallback: labelOpened2.document,
    });
    labelSession2.close();
    const labelIdempotent = labelExport2.bytes.length === labelExport.bytes.length
      && labelExport2.bytes.every((byte, index) => byte === labelExport.bytes[index]);

    return {
      shapeRows,
      deleteScenario,
      labelAfterSource,
      labelAfterExport,
      labelIdempotent,
      scenario: {
        originalMoves: originalFull.moves,
        legacyMissing: originalFull.moves.filter((path) => !legacyFull.moves.includes(path)),
        fixedMissing: originalFull.moves.filter((path) => !fixedFull.moves.includes(path)),
        fixedHasAdded: fixedFull.moves.includes(addedPath),
        addedPath,
        complete: fixed.complete,
      },
      orderStable: orderRead.moves.join("|"),
    };
  });

  for (const row of result.shapeRows) {
    assert(row.missing.length === 0, `形状「${row.name}」经官方核心读回少了 ${row.missing.length} 手：${row.missing.join(" | ")}`);
    assert(row.orderStable, `形状「${row.name}」读回后手序与写入不一致（LIB 应已按坐标序落盘）`);
    assert(row.missingComments.length === 0, `形状「${row.name}」经官方核心读回丢了注释/文字：${row.missingComments.join(" | ")}`);
    assert(row.idempotent, `形状「${row.name}」再导出不是逐字节相同（首个差异在 offset ${row.firstDiff}），保存→打开→再保存会漂移`);
  }
  console.log(`[lib-reader-parity] 结构/顺序/注释保真 ${result.shapeRows.length}/${result.shapeRows.length} 个形状（官方核心 lib2sgf 复核）`);

  assert(result.labelAfterSource.hasLabel, `构造失效：核心没能从源文件报出盘面文字（SGF：${result.labelAfterSource.sgf}）`);
  assert(result.labelAfterExport.hasLabel, `盘面文字经完整原谱通道后丢失（核心 SGF：${result.labelAfterExport.sgf}）`);
  assert(result.labelIdempotent, "带盘面文字的文件经完整原谱通道再导出不是逐字节相同（保存→打开→再保存会漂移）");
  console.log("[lib-reader-parity] 注释经官方核心保真；盘面文字按 LB 约定还原且通道字节幂等");

  const scenario = result.scenario;
  assert(scenario.complete, "完整原谱通道没有生效（libExportFromSource 回落到投影）");
  assert(scenario.legacyMissing.length > 0, "旧通道本应丢分支却完整返回——场景构造失效，门禁失去意义");
  assert(scenario.fixedMissing.length === 0, `修复后仍丢 ${scenario.fixedMissing.length} 手：${scenario.fixedMissing.join(" | ")}`);
  assert(scenario.fixedHasAdded, `用户新增的那一手（${scenario.addedPath}）没有出现在导出结果里`);
  assert(result.orderStable === "7,7|7,7-6,6|7,7-7,8|7,7-8,8", `逆序写入后读回顺序异常：${result.orderStable}`);
  assert(result.deleteScenario.victimPath, "删除分支场景构造失效（投影里没找到 8,8 那条分支）");
  assert(result.deleteScenario.deletedStillThere.length === 0, `删除没生效：导出文件里仍存在 ${result.deleteScenario.deletedStillThere.join(" | ")}（警告：${result.deleteScenario.warnings.join(" / ")}）`);
  assert(result.deleteScenario.lostOthers.length === 0, `删除时误伤了其它分支：${result.deleteScenario.lostOthers.join(" | ")}`);
  console.log(`[lib-reader-parity] 删除分支：${result.deleteScenario.victimPath} 及其续手已移除，其余分支一手不丢`);
  console.log(`[lib-reader-parity] 用户场景：旧通道丢 ${scenario.legacyMissing.length} 手、新通道丢 0 手且编辑保留（原库 ${scenario.originalMoves.length} 手）`);

  if (errors.length) throw new Error(errors.join("\n"));
  console.log("[lib-reader-parity] pass");
} finally {
  await browser.close();
}
