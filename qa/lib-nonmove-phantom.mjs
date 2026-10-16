import { chromium } from "playwright";

/**
 * 门禁：LIB 的空点标注经官方核心 lib2sgf 转换时**不能变成着法**（幻影棋子），
 * 同时标注本身必须保住（别的软件里仍是棋盘上的标记，不是一句注释）。
 *
 * 为什么需要（2026-09-19 实测，最小复现）：我们导出 LIB 时会给空点标注造一个
 * 「非着法节点」（move=null + anchor + NO_MOVE）——这是这个生态里在空点放标记的写法，
 * 官方核心自己的读取器认 NO_MOVE（`isMove()=!NO_MOVE`），所以**文件是对的**；
 * 但核心的 `lib2sgf` 把这类节点写成了一手棋：
 *   `;B[hh]LB[dd:○];W[dd]`   ← 凭空多一颗子
 * 而我们的「完整 LIB 转 SGF」和「编辑后另存 LIB」都拿 lib2sgf 当底板，于是幻影会进到
 * 我们导出的文件里。修法：按 TS 读取器的 NO_MOVE 判定（`nonMoveNodeKeys`）把幻影剔掉。
 *
 * 断言：
 *  P1 我方导出：一手真着法 + 一个空点标注 → LIB 字节里该标注是**非着法节点**
 *  P2 官方核心 lib2sgf 读回：标注点仍被写成着法（这是核心的既有行为，用来证明测试有效）
 *  P3 经 `documentFromCoreSgf` 处理后：幻影着法消失、着法数回到 1
 *  P4 标注仍在：父节点上出现该坐标的文字标注（别的软件读到的是标记，不是注释）
 *  P5 真实第三方 LIB（RenLib 官方课件 lektion2/3）导入正常且无幻影
 *
 * 用法：BANBU_URL=http://localhost:5193 node qa/lib-nonmove-phantom.mjs
 * 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5193/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".app-shell", { timeout: 60000 });

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

const result = await page.evaluate(async () => {
  const game = await import("/src/game.ts");
  const formats = await import("/src/formats.ts");
  const libExport = await import("/src/lib-export.ts");
  const marks = await import("/src/lib-mark-annotations.ts");
  const sourceExport = await import("/src/lib-source-export.ts");
  const { RenLibWebViewSession } = await import("/src/renlib-web/renlib-web-view-session.ts");
  const file = (data, name, type) => new File([data], name, { type });

  // 造一份：一手真着法（H8）+ 一个空点标注（D12 圆圈）
  let doc = game.createDocument("phantom-gate");
  const first = game.addMove(doc, doc.rootId, { row: 7, col: 7 });
  doc = first.document;
  doc.nodes[first.nodeId] = { ...doc.nodes[first.nodeId], marks: [{ row: 3, col: 3, kind: "circle", style: "circle", color: "#1d1c19" }] };

  const prepared = marks.applyMarksToLibDocument(doc);
  const created = Object.values(prepared.document.nodes).filter((n) => !n.move && n.anchor);
  const exported = libExport.exportLib(prepared.document);

  const session = new RenLibWebViewSession();
  await session.open(file(exported.bytes, "phantom.lib", { type: "application/octet-stream" }));
  const nonMoveKeys = new Set(session.nonMoveNodeKeys);
  const sgfBytes = await session.exportOriginalSgf();
  const buf = sgfBytes instanceof Blob ? await sgfBytes.arrayBuffer() : sgfBytes;
  session.close();

  const countMoves = (document) => {
    let moves = 0, labels = 0;
    const walk = (id) => {
      const node = document.nodes[id];
      if (!node) return;
      if (node.move) moves += 1;
      labels += (node.marks || []).filter((m) => m.label || m.kind === "label").length;
      for (const child of node.children) walk(child);
    };
    walk(document.rootId);
    return { moves, labels };
  };
  // 核心原始输出（不处理）
  const rawDoc = await sourceExport.documentFromCoreSgf(buf);
  const raw = countMoves(rawDoc.document);
  // 处理后
  const cleaned = await sourceExport.documentFromCoreSgf(buf, nonMoveKeys);
  const fixed = countMoves(cleaned.document);

  return {
    createdNonMoveNodes: created.length,
    nonMoveKeys: [...nonMoveKeys],
    rawMoves: raw.moves,
    rawLabels: raw.labels,
    removed: cleaned.removed,
    fixedMoves: fixed.moves,
    fixedLabels: fixed.labels,
  };
});

check("P1 空点标注被写成非着法节点", result.createdNonMoveNodes === 1, JSON.stringify(result.nonMoveKeys));
check("P2 官方核心 lib2sgf 确实会把它读成着法（2 手）", result.rawMoves === 2, `moves=${result.rawMoves}`);
check("P3 剔除后幻影着法消失（回到 1 手）", result.removed === 1 && result.fixedMoves === 1, `removed=${result.removed} moves=${result.fixedMoves}`);
check("P4 标注仍在（父节点上的文字标注）", result.fixedLabels >= 1, `labels=${result.fixedLabels}`);

// P5 真实第三方 LIB：RenLib 官方课件
const thirdParty = await page.evaluate(async () => {
  const formats = await import("/src/formats.ts");
  const { RenLibWebViewSession } = await import("/src/renlib-web/renlib-web-view-session.ts");
  const out = [];
  for (const path of ["/renlib-fixtures/lektion2.lib", "/renlib-fixtures/lektion3.lib"]) {
    try {
      const response = await fetch(path);
      if (!response.ok) { out.push({ path, error: `HTTP ${response.status}` }); continue; }
      const bytes = await response.arrayBuffer();
      // dev server 对未知路径返回 index.html（200），必须按魔数判断是不是真的 LIB。
      const head = new Uint8Array(bytes.slice(0, 12));
      const isLib = head[0] === 0xff && String.fromCharCode(...head.slice(1, 7)) === "RenLib";
      if (!isLib) { out.push({ path, error: "MISSING" }); continue; }
      const file = new File([bytes], path.split("/").pop(), { type: "application/octet-stream" });
      const read = await formats.importRenLibLegacy(file, file.name);
      let moves = 0, nonMove = 0;
      const walk = (id) => { const n = read.document.nodes[id]; if (!n) return; if (n.move) moves += 1; else if (n.anchor) nonMove += 1; for (const c of n.children) walk(c); };
      walk(read.document.rootId);
      const session = new RenLibWebViewSession();
      await session.open(file);
      const keys = session.nonMoveNodeKeys.size;
      const sgf = await session.exportOriginalSgf();
      session.close();
      out.push({ path, moves, nonMove, nonMoveKeys: keys, sgfBytes: sgf.byteLength || 0 });
    } catch (error) {
      out.push({ path, error: String(error).slice(0, 90) });
    }
  }
  return out;
});
// 第三方课件是 RenLib 的随发行文件，只在本地 fixtures 存在时测（缺失时明确 SKIP，
// 不当作通过——但也绝不静默）。放进 public/renlib-fixtures/ 即自动纳入。
const missing = thirdParty.every((item) => String(item.error || "").includes("MISSING"));
if (missing) {
  console.log("SKIP P5 真实第三方 LIB（未放置 public/renlib-fixtures/lektion2.lib|lektion3.lib）");
} else {
  const thirdPartyOk = thirdParty.every((item) => !item.error && item.moves > 0);
  check("P5 真实第三方 LIB（RenLib 课件）导入正常", thirdPartyOk, JSON.stringify(thirdParty));
}

// P7 跨应用标注文字保真：第三方 SGF 的 LB 可以写整句话，导入**不许截断**
// （4 字上限只属于手工输入与 LIB 盘面文字那一格；09-19 实测旧代码把它截成「这是一个」）。
const longLabel = await page.evaluate(async () => {
  const formats = await import("/src/formats.ts");
  const text = "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]LB[dd:这是一个很长的标注文字])";
  const doc = (await formats.importRecordFile(new File([new TextEncoder().encode(text)], "third.sgf", { type: "application/x-go-sgf" }))).document;
  const root = doc.nodes[doc.rootId];
  const first = doc.nodes[root.children[0]];
  const label = (first?.marks || []).find((m) => m.kind === "label")?.label || "";
  return { label, exported: formats.exportSgf(doc).includes("这是一个很长的标注文字") };
});
check("P7 第三方 SGF 长标注文字导入不截断且能原样导出", longLabel.label === "这是一个很长的标注文字" && longLabel.exported, JSON.stringify(longLabel));

check("P6 无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);
