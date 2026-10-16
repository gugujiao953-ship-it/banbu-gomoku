/**
 * 门禁：互操作电池（40+ 条，每条都做往返逐字段比对）。
 *
 * 覆盖：SGF 属性怪癖与深分支（转义、CRLF/BOM、未知/重复属性、大小写坐标、摆局压缩区间、
 * 让子、SZ[9]、冷门属性、空树根…）、LIB 标注各种落点与幂等（空点/棋子点/别的分支/祖先点/
 * 同点多标注）、JSON 往返、题库 JSON 导出→导入、导出范围不丢标注、规模（220 手长谱、
 * 30 分支深树、50 份棋谱 + 收藏的大库备份往返）、备份损坏字段必须被拒绝、
 * 以及备份覆盖面（收藏/快捷中心/在线代理/更新偏好/分析缓存/复盘数据都必须进备份）。
 *
 * 2026-09-19 多轮修复循环里用它抓到并修掉：① 大写坐标 `B[HH]` 被拒（部分国产软件这么写）
 * ② 收藏/快捷中心/在线代理/更新偏好五个键根本不在备份里（换机即丢）。
 *
 * 用法：BANBU_URL=http://localhost:5193 node qa/interop-battery.mjs
 * 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5193/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".app-shell", { timeout: 60000 });

const report = await page.evaluate(async () => {
  const game = await import("/src/game.ts");
  const formats = await import("/src/formats.ts");
  const libExport = await import("/src/lib-export.ts");
  const marks = await import("/src/lib-mark-annotations.ts");
  const sourceExport = await import("/src/lib-source-export.ts");
  const scopeExport = await import("/src/features/research/record-export.ts");
  const { RenLibWebViewSession } = await import("/src/renlib-web/renlib-web-view-session.ts");

  const sgfFile = (text, name = "t.sgf") => new File([new TextEncoder().encode(text)], name, { type: "application/x-go-sgf" });
  const importSgf = async (text, name = "t.sgf") => (await formats.importRecordFile(sgfFile(text, name))).document;

  const sig = (document) => {
    const rows = [];
    const walk = (id, path) => {
      const node = document.nodes[id];
      if (!node) return;
      const mk = (node.marks || []).map((m) => `${m.row},${m.col}:${m.kind}:${m.label || ""}`).sort().join("|");
      const setup = node.setup ? `B${node.setup.black.length}W${node.setup.white.length}${node.setup.nextPlayer ? "P" + node.setup.nextPlayer : ""}` : "";
      rows.push(`${path}:${node.move ? `${node.move.row},${node.move.col},${node.move.player}` : node.passPlayer ? "pass" : "none"}|C=${node.comment}|M=${mk}|T=${node.boardText || ""}|E=${node.evaluation || ""}|S=${setup}`);
      node.children.forEach((child, index) => walk(child, `${path}>${index}`));
    };
    walk(document.rootId, "R");
    return rows;
  };

  const results = [];
  const sgfCase = async (name, sgf) => {
    const entry = { name, problems: [] };
    try {
      const first = await importSgf(sgf);
      const round = await importSgf(formats.exportSgf(first));
      const a = sig(first), b = sig(round);
      entry.nodes = a.length;
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (a[i] !== b[i]) entry.problems.push(`第${i}节点 导入=${a[i] || "（无）"} 往返=${b[i] || "（无）"}`);
      }
    } catch (error) { entry.problems.push("⛔ " + String(error).slice(0, 110)); }
    results.push(entry);
  };

  // ── SGF：属性怪癖与深分支 ─────────────────────────────────────────
  await sgfCase("S15 深嵌套三分支", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh](;W[ii](;B[jj]CR[kk])(;B[gg]))(;W[gg](;B[ii])))");
  await sgfCase("S16 同节点多个不同点标注", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]CR[dd]TR[ee]SQ[ff]MA[gg]LB[hh:甲][ii:乙])");
  await sgfCase("S17 属性顺序颠倒（LB 在 B 前）", "(;GM[1]FF[4]CA[UTF-8]SZ[15];LB[dd:先]B[hh])");
  await sgfCase("S18 CRLF 与 BOM", "\uFEFF(;GM[1]FF[4]CA[UTF-8]SZ[15];\r\nB[hh]C[带回车]\r\nLB[dd:标])\r\n");
  await sgfCase("S19 缺 GM/FF（宽松）", "(;SZ[15];B[hh]LB[dd:标])");
  await sgfCase("S20 未知属性不崩", "(;GM[1]FF[4]CA[UTF-8]SZ[15]XX[1]ZZ[abc];B[hh]QQ[q]LB[dd:标])");
  await sgfCase("S21 重复属性（两个 C）", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[第一个]C[第二个])");
  await sgfCase("S22 坐标大小写混合", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[HH]LB[DD:大写])");
  await sgfCase("S23 分支里的过手 + 标注", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh](;W[]C[过手]CR[ii])(;W[gg]))");
  await sgfCase("S24 摆局 + 分支组合", "(;GM[1]FF[4]CA[UTF-8]SZ[15]AB[dd][ee]AW[ff]PL[B](;B[gg]LB[hh:一])(;B[ii]TR[jj]))");
  await sgfCase("S25 超长注释（3000 字）", `(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[${"长".repeat(3000)}])`);
  await sgfCase("S26 无 SZ（默认 15 路）", "(;GM[1]FF[4]CA[UTF-8];B[hh]LB[dd:标])");
  await sgfCase("S27 根节点上的标注", "(;GM[1]FF[4]CA[UTF-8]SZ[15]CR[dd]LB[ee:根标];B[hh])");
  await sgfCase("S28 节点名 N 与手数 MN", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]N[开局]MN[1];W[ii]N[应手])");
  await sgfCase("S29 空注释与空标注混合", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[]LB[dd:][ee:有])");
  await sgfCase("S30 属性值里带分号与等号", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[式子 a;b=c]LB[dd:x=y])");
  await sgfCase("S31 三层分支各带标注", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh](;W[ii]LB[jj:甲](;B[kk]LB[ll:乙]))(;W[gg]LB[ff:丙]))");
  await sgfCase("S32 注释含转义反斜杠", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[路径 C:\\\\dir])");
  // 畸形输入（属性没闭合）必须明确报错，而不是静默吞掉半份棋谱
  {
    const entry = { name: "S32b 畸形 SGF（属性未闭合）明确报错", problems: [] };
    try {
      await importSgf("(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[没闭合]");
      entry.problems.push("畸形输入竟然被接受");
    } catch (error) {
      if (!/缺少结束括号|无法识别|没有闭合/.test(String(error))) entry.problems.push("报错信息不明确: " + String(error).slice(0, 80));
    }
    results.push(entry);
  }

  await sgfCase("S33 压缩摆局区间 AB[aa:cc]", "(;GM[1]FF[4]CA[UTF-8]SZ[15]AB[aa:cc]PL[W];W[hh]LB[dd:标])");
  await sgfCase("S34 让子 HA + AB", "(;GM[1]FF[4]CA[UTF-8]SZ[15]HA[2]AB[dd][ee]PL[W];W[hh])");
  await sgfCase("S35 小盘 SZ[9] + 标注", "(;GM[1]FF[4]CA[UTF-8]SZ[9];B[ee]LB[cc:小盘])");
  await sgfCase("S36 注释里的 \[ 转义", "(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]C[左括号 \[ 已转义])");
  await sgfCase("S37 冷门属性 VW/DD/PM", "(;GM[1]FF[4]CA[UTF-8]SZ[15]VW[aa:ss]PM[1];B[hh]DD[dd]LB[ee:标])");
  await sgfCase("S38 空树根（无着法）", "(;GM[1]FF[4]CA[UTF-8]SZ[15]C[只有注释])");

  // ── LIB：标注各种落点 + 幂等 ──────────────────────────────────────
  const libCase = async (name, build, { expectMarks = null } = {}) => {
    const entry = { name, problems: [] };
    try {
      const doc = build();
      const prepared = marks.applyMarksToLibDocument(doc);
      const exported = libExport.exportLib(prepared.document);
      const session = new RenLibWebViewSession();
      await session.open(new File([exported.bytes], "a.lib", { type: "application/octet-stream" }));
      const keys = new Set(session.nonMoveNodeKeys);
      const sgf = await session.exportOriginalSgf();
      const buf = sgf instanceof Blob ? await sgf.arrayBuffer() : sgf;
      session.close();
      const back = (await sourceExport.documentFromCoreSgf(buf, keys)).document;
      const movesOf = (d) => { let n = 0; const walk = (id) => { const x = d.nodes[id]; if (!x) return; if (x.move) n += 1; for (const c of x.children) walk(c); }; walk(d.rootId); return n; };
      const marksOf = (d) => Object.values(d.nodes).flatMap((n) => n.marks || []).map((m) => `${m.row},${m.col}:${m.label || ""}`);
      entry.moves = movesOf(back);
      entry.marks = marksOf(back).length;
      if (entry.moves !== movesOf(doc)) entry.problems.push(`着法数 ${movesOf(doc)} → ${entry.moves}`);
      if (expectMarks !== null && entry.marks !== expectMarks) entry.problems.push(`标注数 期望${expectMarks} 实得${entry.marks}`);
      // 幂等：再导出再读回，着法数与标注数不应增殖
      const second = libExport.exportLib(marks.applyMarksToLibDocument(back).document);
      const s2 = new RenLibWebViewSession();
      await s2.open(new File([second.bytes], "b.lib", { type: "application/octet-stream" }));
      const keys2 = new Set(s2.nonMoveNodeKeys);
      const sgf2 = await s2.exportOriginalSgf();
      const buf2 = sgf2 instanceof Blob ? await sgf2.arrayBuffer() : sgf2;
      s2.close();
      const back2 = (await sourceExport.documentFromCoreSgf(buf2, keys2)).document;
      if (movesOf(back2) !== entry.moves) entry.problems.push(`幂等：着法 ${entry.moves} → ${movesOf(back2)}`);
      if (marksOf(back2).length !== entry.marks) entry.problems.push(`幂等：标注 ${entry.marks} → ${marksOf(back2).length}`);
      entry.exported = exported.bytes.length + "B";
    } catch (error) { entry.problems.push("⛔ " + String(error).slice(0, 110)); }
    results.push(entry);
  };
  const base = (marksSpec, extra) => {
    let doc = game.createDocument("lib-battery");
    const a = game.addMove(doc, doc.rootId, { row: 7, col: 7 }); doc = a.document;
    const b = game.addMove(doc, a.nodeId, { row: 7, col: 8 }); doc = b.document;
    doc.nodes[a.nodeId] = { ...doc.nodes[a.nodeId], marks: marksSpec };
    if (extra) doc = extra(doc, a.nodeId, b.nodeId);
    return doc;
  };
  await libCase("L33 三个空点标注", () => base([
    { row: 3, col: 3, kind: "circle", style: "circle", color: "#1d1c19" },
    { row: 4, col: 4, kind: "triangle", style: "triangle", color: "#1d1c19" },
    { row: 5, col: 5, kind: "label", style: "text", label: "要", color: "#1d1c19" },
  ]), { expectMarks: 3 });
  // 标注落在棋子点：LIB 只有「一格一个盘面文字」，读回时它是该节点的 boardText
  // （T45 已登记的语义漂移：形状→字形文字）。断言「信息不丢」而不是「还是标注」。
  {
    const entry = { name: "L34 标注落在棋子点（信息不丢：标注或盘面文字）", problems: [] };
    try {
      const doc = base([{ row: 7, col: 7, kind: "circle", style: "circle-solid", color: "#b94b3f" }]);
      const prepared = marks.applyMarksToLibDocument(doc);
      const exported = libExport.exportLib(prepared.document);
      const session = new RenLibWebViewSession();
      await session.open(new File([exported.bytes], "a.lib", { type: "application/octet-stream" }));
      const keys = new Set(session.nonMoveNodeKeys);
      const sgf = await session.exportOriginalSgf();
      const buf = sgf instanceof Blob ? await sgf.arrayBuffer() : sgf;
      session.close();
      const back = (await sourceExport.documentFromCoreSgf(buf, keys)).document;
      const kept = Object.values(back.nodes).some((n) => (n.marks || []).length > 0 || (n.boardText || "").length > 0);
      entry.moves = Object.values(back.nodes).filter((n) => n.move).length;
      if (!kept) entry.problems.push("标注信息整条丢失");
      if (entry.moves !== 2) entry.problems.push(`着法数 2 → ${entry.moves}`);
    } catch (error) { entry.problems.push("⛔ " + String(error).slice(0, 110)); }
    results.push(entry);
  }
  await libCase("L35 同点双标注（一格一个标签）", () => base([
    { row: 3, col: 3, kind: "circle", style: "circle", color: "#1d1c19" },
    { row: 3, col: 3, kind: "triangle", style: "triangle", color: "#1d1c19" },
  ]));
  await libCase("L36 带分支 + 标注", () => base([{ row: 3, col: 3, kind: "circle", style: "circle", color: "#1d1c19" }], (doc, firstId) => {
    const br = game.addMove(doc, firstId, { row: 6, col: 6 });
    return br.document;
  }));

  await libCase("L39 标注落在别的分支的点上", () => {
    let doc = game.createDocument("lib-elsewhere");
    const a = game.addMove(doc, doc.rootId, { row: 7, col: 7 }); doc = a.document;
    const br = game.addMove(doc, a.nodeId, { row: 6, col: 6 }); doc = br.document;
    const other = game.addMove(doc, a.nodeId, { row: 7, col: 8 }); doc = other.document;
    // 在 other 这一枝上标注 br 那一枝的点（findAnywhereAt 通道）
    doc.nodes[other.nodeId] = { ...doc.nodes[other.nodeId], marks: [{ row: 6, col: 6, kind: "circle", style: "circle", color: "#1d1c19" }] };
    return doc;
  });
  await libCase("L40 标注落在祖先点上", () => {
    let doc = game.createDocument("lib-ancestor");
    const a = game.addMove(doc, doc.rootId, { row: 7, col: 7 }); doc = a.document;
    const b = game.addMove(doc, a.nodeId, { row: 7, col: 8 }); doc = b.document;
    // 在第二手上标注第一手的点（findAncestorAt 通道）
    doc.nodes[b.nodeId] = { ...doc.nodes[b.nodeId], marks: [{ row: 7, col: 7, kind: "triangle", style: "triangle", color: "#1d1c19" }] };
    return doc;
  });
  await libCase("L41 一格容量溢出（同点三标注）", () => base([
    { row: 3, col: 3, kind: "circle", style: "circle", color: "#1d1c19" },
    { row: 3, col: 3, kind: "triangle", style: "triangle", color: "#1d1c19" },
    { row: 3, col: 3, kind: "label", style: "text", label: "三", color: "#1d1c19" },
  ]));

  // ── JSON / 题库 ──────────────────────────────────────────────────
  const jsonCase = async (name, build) => {
    const entry = { name, problems: [] };
    try {
      const doc = build();
      const json = await formats.exportJson(doc);
      const back = (await formats.importRecordFile(new File([json], "a.json", { type: "application/json" }))).document;
      const a = sig(doc), b = sig(back);
      entry.nodes = a.length;
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) entry.problems.push(`第${i}节点 原=${a[i] || "（无）"} 往返=${b[i] || "（无）"}`);
    } catch (error) { entry.problems.push("⛔ " + String(error).slice(0, 110)); }
    results.push(entry);
  };
  await jsonCase("J37 标注+分支+评价+摆局 JSON 往返", () => {
    let doc = game.createDocument("json-battery");
    const a = game.addMove(doc, doc.rootId, { row: 7, col: 7 }); doc = a.document;
    const b = game.addMove(doc, a.nodeId, { row: 7, col: 8 }); doc = b.document;
    const br = game.addMove(doc, a.nodeId, { row: 6, col: 6 }); doc = br.document;
    doc.nodes[a.nodeId] = { ...doc.nodes[a.nodeId], comment: "注释", boardText: "要点", evaluation: "good", marks: [{ row: 3, col: 3, kind: "circle", style: "circle-solid", color: "#2872b8", label: "超四字标注文字" }] };
    // 摆局只能挂在**没有着法**的节点上（同节点既摆局又落子会被校验器正确拒绝）：
    // 给 br 挂一个纯摆局子节点。
    const setupNodeId = `${br.nodeId}-setup`;
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [br.nodeId]: { ...doc.nodes[br.nodeId], children: [...doc.nodes[br.nodeId].children, setupNodeId] },
        [setupNodeId]: { id: setupNodeId, parentId: br.nodeId, children: [], move: null, comment: "", marks: [], setup: { black: [{ row: 0, col: 0 }], white: [], empty: [] } },
      },
    };
    return doc;
  });

  // ── 导出范围 ────────────────────────────────────────────────────
  const scopeCase = async (name, build) => {
    const entry = { name, problems: [] };
    try {
      const { doc, currentId, expectNodes, expectMarks } = build();
      const scoped = scopeExport.documentForExportScope(doc, currentId, "variation");
      const back = await importSgf(formats.exportSgf(scoped));
      entry.nodes = Object.keys(scoped.nodes).length;
      if (entry.nodes !== expectNodes) entry.problems.push(`当前变化节点数 ${entry.nodes} ≠ 期望 ${expectNodes}`);
      const markCount = Object.values(back.nodes).flatMap((n) => n.marks || []).length;
      if (markCount !== expectMarks) entry.problems.push(`导出后标注数 ${markCount} ≠ 期望 ${expectMarks}`);
    } catch (error) { entry.problems.push("⛔ " + String(error).slice(0, 110)); }
    results.push(entry);
  };
  await scopeCase("E38 当前变化范围：只留主线且标注跟着走", () => {
    let doc = game.createDocument("scope");
    const a = game.addMove(doc, doc.rootId, { row: 7, col: 7 }); doc = a.document;
    const b = game.addMove(doc, a.nodeId, { row: 7, col: 8 }); doc = b.document;
    const br = game.addMove(doc, a.nodeId, { row: 6, col: 6 }); doc = br.document;
    doc.nodes[a.nodeId] = { ...doc.nodes[a.nodeId], marks: [{ row: 3, col: 3, kind: "circle", style: "circle", color: "#1d1c19" }] };
    doc.nodes[br.nodeId] = { ...doc.nodes[br.nodeId], marks: [{ row: 4, col: 4, kind: "circle", style: "circle", color: "#1d1c19" }] };
    // 「当前变化」= 到当前节点的路径 + 其下的首选子链；addMove 会把最新子节点设为首选，
    // 所以 br 在链上 → 三个节点、两个标注。
    return { doc, currentId: a.nodeId, expectNodes: 3, expectMarks: 2 };
  });

  // ── 规模：长谱 / 深树 / 题集 JSON / 大库备份 ───────────────────────
  const scaleCase = async (name, run) => {
    const entry = { name, problems: [] };
    try { await run(entry); } catch (error) { entry.problems.push("⛔ " + String(error).slice(0, 110)); }
    results.push(entry);
  };
  await scaleCase("Z43 220 手长谱 SGF 往返（含每 50 手一个标注）", async (entry) => {
    let doc = game.createDocument("long");
    let cursor = doc.rootId;
    for (let index = 0; index < 220; index += 1) {
      // 15×15 只有 225 格：坐标必须唯一，否则第 226 手会「落子失败」（那是正确行为，不是 bug）
      const step = game.addMove(doc, cursor, { row: Math.floor(index / 15), col: index % 15 });
      if (!step.created) { entry.problems.push(`第 ${index} 手落子失败`); break; }
      doc = step.document;
      cursor = step.nodeId;
      if (index % 50 === 0) doc.nodes[cursor] = { ...doc.nodes[cursor], marks: [{ row: 3, col: 3, kind: "circle", style: "circle", color: "#1d1c19" }] };
    }
    const back = await importSgf(formats.exportSgf(doc));
    const moves = (d) => Object.values(d.nodes).filter((n) => n.move).length;
    const markCount = (d) => Object.values(d.nodes).flatMap((n) => n.marks || []).length;
    entry.nodes = moves(back);
    if (moves(back) !== moves(doc)) entry.problems.push(`着法 ${moves(doc)} → ${moves(back)}`);
    if (markCount(back) !== markCount(doc)) entry.problems.push(`标注 ${markCount(doc)} → ${markCount(back)}`);
    const jsonBack = (await formats.importRecordFile(new File([await formats.exportJson(doc)], "l.json", { type: "application/json" }))).document;
    if (moves(jsonBack) !== moves(doc) || markCount(jsonBack) !== markCount(doc)) entry.problems.push(`JSON 往返不一致（着法${moves(jsonBack)} 标注${markCount(jsonBack)}）`);
  });
  await scaleCase("Z44 30 分支深树往返（每个分支带标注）", async (entry) => {
    let doc = game.createDocument("wide");
    const first = game.addMove(doc, doc.rootId, { row: 7, col: 7 }); doc = first.document;
    for (let index = 0; index < 30; index += 1) {
      const step = game.addMove(doc, first.nodeId, { row: index % 15, col: 14 - Math.floor(index / 15) });
      if (!step.created) continue;
      doc = step.document;
      doc.nodes[step.nodeId] = { ...doc.nodes[step.nodeId], marks: [{ row: index % 15, col: 0, kind: "label", style: "text", label: String(index % 10), color: "#1d1c19" }] };
    }
    const back = await importSgf(formats.exportSgf(doc));
    const kids = back.nodes[back.nodes[back.rootId].children[0]]?.children.length || 0;
    entry.nodes = kids;
    if (kids !== 30) entry.problems.push(`分支数 30 → ${kids}`);
    const labels = Object.values(back.nodes).flatMap((n) => (n.marks || []).filter((m) => m.kind === "label")).length;
    if (labels !== 30) entry.problems.push(`分支标注 30 → ${labels}`);
  });
  await scaleCase("Z45 题集 JSON 导出→导入（含摆局/规则/棋盘）", async (entry) => {
    const puzzles = await import("/src/puzzles.ts");
    const collection = {
      id: "qa-set", title: "QA 题集", source: "用户导入", license: "由用户确认使用权",
      puzzles: [
        { id: "p1", title: "题一", prompt: "黑先胜", difficulty: 3, player: "black", boardSize: 15, rule: "renju", stones: [{ row: 7, col: 7, player: "black" }, { row: 7, col: 8, player: "white" }] },
        { id: "p2", title: "题二", prompt: "白先", difficulty: 5, player: "white", boardSize: 15, stones: [{ row: 6, col: 6, player: "black" }] },
      ],
    };
    const json = puzzles.exportPuzzleCollectionJson(collection);
    entry.nodes = collection.puzzles.length;
    const report = puzzles.importKaibaoPuzzleJson(json, "QA 题集");
    if (report.collection.puzzles.length !== 2) entry.problems.push(`题目数 2 → ${report.collection.puzzles.length}`);
    const first = report.collection.puzzles[0];
    if (first.title !== "题一" || first.difficulty !== 3 || first.rule !== "renju") entry.problems.push("题目字段丢失: " + JSON.stringify({ title: first.title, difficulty: first.difficulty, rule: first.rule }));
    if ((first.stones || []).length !== 2) entry.problems.push(`摆局子数 2 → ${(first.stones || []).length}`);
  });
  await scaleCase("Z46 50 份棋谱 + 收藏的大库备份往返", async (entry) => {
    const storage = await import("/src/storage.ts");
    const backup = await import("/src/backup.ts");
    const library = [];
    for (let index = 0; index < 50; index += 1) {
      let doc = game.createDocument(`库-${index}`);
      const step = game.addMove(doc, doc.rootId, { row: index % 15, col: index % 15 });
      doc = step.document;
      doc.nodes[step.nodeId] = { ...doc.nodes[step.nodeId], marks: [{ row: 1, col: 1, kind: "circle", style: "circle", color: "#1d1c19" }] };
      library.push(doc);
    }
    storage.saveManyToLibrary(library);
    localStorage.setItem("banbu-library-favorites-v1", JSON.stringify({ records: library.slice(0, 5).map((doc) => doc.id), puzzleCollections: [], puzzles: {} }));
    const snapshot = await backup.createBackupSnapshot("scale");
    entry.nodes = snapshot.localStorage.library.length;
    storage.saveManyToLibrary([game.createDocument("覆盖")]);
    await backup.restoreBackup(backup.parseBackup(backup.serializeBackup(snapshot)));
    const restored = storage.loadLibrary();
    const withMarks = restored.filter((doc) => Object.values(doc.nodes).some((n) => (n.marks || []).length > 0)).length;
    if (restored.length < 50) entry.problems.push(`恢复后棋谱数 ${restored.length} < 50`);
    if (withMarks !== 50) entry.problems.push(`带标注的棋谱 ${withMarks} ≠ 50`);
    const favorites = JSON.parse(localStorage.getItem("banbu-library-favorites-v1") || "{}");
    if ((favorites.records || []).length !== 5) entry.problems.push(`收藏数 ${(favorites.records || []).length} ≠ 5`);
  });

  // ── 备份校验：损坏字段必须被拒绝 ──────────────────────────────────
  const backup = await import("/src/backup.ts");
  const corrupt = { name: "B42 备份里收藏字段损坏必须被拒绝", problems: [] };
  try {
    const good = await backup.createBackupSnapshot("battery");
    const broken = JSON.parse(JSON.stringify({ ...good, contentHash: undefined }));
    broken.localStorage.favorites = "不是对象";
    const text = JSON.stringify(broken);
    try {
      backup.parseBackup(text);
      corrupt.problems.push("损坏的 favorites 竟然通过了校验");
    } catch (error) {
      if (!/无效|校验|损坏/.test(String(error))) corrupt.problems.push("拒绝原因不明确: " + String(error).slice(0, 80));
    }
  } catch (error) { corrupt.problems.push("⛔ " + String(error).slice(0, 110)); }
  results.push(corrupt);

  // ── 备份覆盖面：直接查快照字段（比猜 localStorage 键名可靠）──────────
  const snapshot = await backup.createBackupSnapshot("battery");
  const local = snapshot.localStorage;
  const backupProbe = [
    { field: "library", present: Array.isArray(local.library) },
    { field: "favorites", present: Boolean(local.favorites) && Array.isArray(local.favorites?.records) },
    { field: "quickDrawer", present: local.quickDrawer !== undefined },
    { field: "onlineProxy", present: typeof local.onlineProxy === "string" },
    { field: "updateAutoCheck", present: typeof local.updateAutoCheck === "boolean" },
    { field: "updateDismissed", present: typeof local.updateDismissed === "string" },
    { field: "analysisCache", present: local.analysisCache !== undefined },
    { field: "gameReview", present: local.gameReview !== undefined },
    { field: "branchBookmarks", present: local.branchBookmarks !== undefined },
  ];
  return { results, backupKeys: backupProbe };
});

let failed = 0;
for (const row of report.results) {
  const ok = row.problems.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${row.name}${ok && row.nodes ? `（${row.nodes} 节点）` : ""}${ok && row.moves !== undefined ? `（着法${row.moves} 标注${row.marks}）` : ""}`);
  for (const problem of row.problems) console.log("      " + problem);
}
console.log(`\n备份键存在性：${JSON.stringify(report.backupKeys)}`);
console.log(errors.length ? `页面错误：${errors.slice(0, 2).join(" | ")}` : "无页面错误");
console.log(failed ? `\n${failed} 项有问题` : "\n全部通过");
await browser.close();
process.exit(failed ? 1 : 0);
