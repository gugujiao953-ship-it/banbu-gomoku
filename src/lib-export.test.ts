import { describe, expect, it } from "vitest";
import { addMove, addMoveAs, createDocument } from "./game";
import { importRecordFile, importRenLibLegacy } from "./formats";
import { exportLib, exportPsq } from "./lib-export";
import type { GameDocument } from "./types";

/** Structural signature: move/annotation shape plus sorted children order. */
const treeSignature = (document: GameDocument, id: string): string => {
  const node = document.nodes[id];
  if (!node) return "missing";
  const own = node.move
    ? `${node.move.player}:${node.move.row},${node.move.col}`
    : node.passPlayer ? `pass:${node.passPlayer}`
    : node.anchor ? `anchor:${node.anchor.row},${node.anchor.col}`
    : "root";
  const details = node.comment ? `#${node.comment}` : "";
  const children = (node.children || []).map((child) => treeSignature(document, child)).join("|");
  return `${own}${details}{${children}}`;
};

const roundTrip = async (document: GameDocument) => {
  const result = exportLib(document);
  const imported = await importRenLibLegacy(new File([result.bytes], "roundtrip.lib"), "roundtrip.lib");
  return { bytes: result.bytes, warnings: result.warnings, imported };
};

describe("RenLib LIB export", () => {
  it("round-trips a main line with player alternation", async () => {
    let document = createDocument("mainline");
    const moves = [
      { row: 7, col: 7 }, { row: 7, col: 8 }, { row: 6, col: 8 },
      { row: 6, col: 7 }, { row: 8, col: 7 }, { row: 8, col: 8 },
    ];
    let currentId = document.rootId;
    for (const position of moves) {
      const added = addMove(document, currentId, position);
      document = added.document; currentId = added.nodeId;
    }
    const { imported } = await roundTrip(document);
    expect(imported.warnings).toEqual([]);
    expect(treeSignature(imported.document, imported.document.rootId)).toBe(treeSignature(document, document.rootId));
  });

  it("round-trips a variation tree, canonicalised to coordinate sibling order", async () => {
    let document = createDocument("tree");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const main = addMove(document, first.nodeId, { row: 7, col: 8 }); document = main.document;
    const deep = addMove(document, main.nodeId, { row: 8, col: 7 }); document = deep.document;
    const variation = addMove(document, first.nodeId, { row: 8, col: 8 }); document = variation.document;
    const sub = addMove(document, variation.nodeId, { row: 8, col: 9 }); document = sub.document;
    const secondBranch = addMove(document, first.nodeId, { row: 6, col: 6 }); document = secondBranch.document;

    const { imported, warnings } = await roundTrip(document);
    // 兄弟顺序由坐标决定（官方 RenLibDoc.addMove 按 PointToPos 升序插入），
    // 所以 6,6 排到最前；写入时也按这个顺序落盘，导出→导入才是幂等的。
    expect(treeSignature(imported.document, imported.document.rootId))
      .toBe("root{black:7,7{white:6,6{}|white:7,8{black:8,7{}}|white:8,8{black:8,9{}}}}");
    expect(warnings.some((warning) => warning.includes("坐标重排"))).toBe(true);
    const rootChildren = imported.document.nodes[imported.document.rootId].children;
    expect(rootChildren).toHaveLength(1);
    const branch = imported.document.nodes[rootChildren[0]];
    expect(branch.children).toHaveLength(3);
    expect(branch.children.map((id) => imported.document.nodes[id].move)).toEqual([
      { row: 6, col: 6, player: "white" },
      { row: 7, col: 8, player: "white" },
      { row: 8, col: 8, player: "white" },
    ]);
  });

  it("round-trips GBK comments, board text, marks and start flag", async () => {
    let document = createDocument("annotations");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
    const commented = document.nodes[second.nodeId];
    commented.comment = "中文注释，含标点。win 100%";
    commented.boardText = "绝杀局面";
    commented.marks = [{ row: 7, col: 8, kind: "circle" }];
    commented.startPosition = true;
    document.nodes[second.nodeId] = commented;

    const { imported, warnings } = await roundTrip(document);
    // 「绝杀局面」是 8 个 GBK 字节，超过 LIB 的 4 字节上限，写出时按整字截断成「绝杀」。
    expect(warnings.some((warning) => warning.includes("4 字节"))).toBe(true);
    expect(treeSignature(imported.document, imported.document.rootId)).toBe(treeSignature(document, document.rootId));
    const rediscovered = Object.values(imported.document.nodes).find((node) => node.move?.row === 7 && node.move?.col === 8);
    expect(rediscovered?.comment).toBe("中文注释，含标点。win 100%");
    expect(rediscovered?.boardText).toBe("绝杀");
    expect(rediscovered?.renLibMark).toBe(true);
    expect(rediscovered?.startPosition).toBe(true);
    // Board text is carried by the extension pair [0x00, 0x01].
    expect(rediscovered?.renLibExtendedFlags).toBe(0x100);
    expect(imported.warnings.some((warning) => warning.includes("注释"))).toBe(true);
    expect(imported.warnings.some((warning) => warning.includes("文字"))).toBe(true);
  });

  it("round-trips pass moves at the null point", async () => {
    let document = createDocument("pass");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = { ...document, nodes: { ...document.nodes, [first.nodeId]: { ...document.nodes[first.nodeId] } } };
    const passId = `p-${Date.now()}`;
    document.nodes[passId] = { id: passId, parentId: first.nodeId, children: [], move: null, passPlayer: "white", comment: "", marks: [] };
    document.nodes[first.nodeId].children.push(passId);
    const { imported } = await roundTrip(document);
    const moveNodes = Object.values(imported.document.nodes).filter((node) => node.move);
    expect(moveNodes).toHaveLength(1);
    // 我方 legacy 读取器把过手读成「无着法子节点」，所以这条单测一直是绿的。
    // **但生产环境的 .lib 由官方核心（RenLibWebViewSession）读取，它会直接丢掉这一手**——
    // 实测三种编码（不设 NO_MOVE / 设 NO_MOVE / 干脆不写这个节点）官方核心读回结果完全相同：
    // 节点连同注释一起消失，且核心按交替重新推颜色，过手之后所有着法黑白错位。
    // 见 `.tmp-interop/probe-lib-pass-encoding.mjs`。所以导出现在必须给出警告。
    const pass = Object.values(imported.document.nodes).find((node) => node.parentId !== imported.document.rootId && !node.move);
    expect(pass).toBeDefined();
    expect((pass as { move: null }).move).toBeNull();
  });

  it("过手（pass）必须警告：LIB 里写不下它，读回时之后着法的颜色会错位", () => {
    let document = createDocument("pass-warning");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const passId = "p-warning";
    document = {
      ...document,
      nodes: {
        ...document.nodes,
        [first.nodeId]: { ...document.nodes[first.nodeId], children: [...document.nodes[first.nodeId].children, passId] },
        [passId]: { id: passId, parentId: first.nodeId, children: [], move: null, passPlayer: "white", comment: "", marks: [] },
      },
    };
    const result = exportLib(document);
    expect(result.warnings.some((warning) => warning.includes("过手"))).toBe(true);
  });

  it("根节点带摆局时不再静默丢失：摆局与起始标记都要有警告", () => {
    let document = createDocument("root-setup");
    document = {
      ...document,
      nodes: {
        ...document.nodes,
        [document.rootId]: { ...document.nodes[document.rootId], setup: { black: [{ row: 5, col: 5 }], white: [], empty: [] }, startPosition: true },
      },
    };
    const added = addMove(document, document.rootId, { row: 7, col: 7 }); document = added.document;
    const result = exportLib(document);
    // 根节点的记录根本不写出（被摆局取代），以前只有子层的摆局才计数 → 根上的摆局悄悄没了
    expect(result.warnings.some((warning) => warning.includes("摆局面"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("起始"))).toBe(true);
  });

  it("lifts setup-only nodes and reports a warning", async () => {
    let document = createDocument("setup");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const setupId = `setup-${Date.now()}`;
    document.nodes[setupId] = {
      id: setupId, parentId: first.nodeId, children: [], move: null, comment: "", marks: [],
      setup: { black: [{ row: 3, col: 3 }], white: [], empty: [] },
    };
    document.nodes[first.nodeId].children.push(setupId);
    const childId = `c-${Date.now()}`;
    document.nodes[childId] = {
      id: childId, parentId: setupId, children: [], move: { row: 8, col: 8, player: "white" }, comment: "", marks: [],
    };
    document.nodes[setupId].children.push(childId);

    const { imported, warnings } = await roundTrip(document);
    expect(warnings.some((warning) => warning.includes("摆局面"))).toBe(true);
    const setup = Object.values(imported.document.nodes).find((node) => node.move?.row === 3 && node.move?.col === 3);
    expect(setup).toBeUndefined();
    const firstChildren = imported.document.nodes[imported.document.rootId].children.map((id) => imported.document.nodes[id]);
    expect(firstChildren).toHaveLength(1);
    expect(firstChildren[0].children.map((id) => imported.document.nodes[id].move)).toEqual([{ row: 8, col: 8, player: "white" }]);
  });

  it("rejects non-fifteen boards", () => {
    const document = createDocument("thirteen", 13);
    expect(() => exportLib(document)).toThrow(/十五路/);
  });

  it("warns when a comment holds characters GBK cannot represent", async () => {
    // LIB 是 GBK 容器：emoji 这类字符只能写成 '?'，必须如实提示而不是悄悄改掉用户注释。
    let document = createDocument("emoji");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = { ...document, nodes: { ...document.nodes, [first.nodeId]: { ...document.nodes[first.nodeId], comment: "好棋 👍 绝杀" } } };
    const result = exportLib(document);
    expect(result.warnings.some((warning) => warning.includes("GBK"))).toBe(true);
    // 可选字符（中文）仍然完好，只有无法映射的字符被替换
    const { imported } = await roundTrip(document);
    const node = Object.values(imported.document.nodes).find((entry) => entry.move);
    expect(node?.comment).toContain("好棋");
    expect(node?.comment).toContain("绝杀");
  });

  it("truncates an over-long board text to LIB's 4-byte limit and warns", async () => {
    // 官方核心的 readBoardText 只读前 4 个 GBK 字节（实测「新标签」读回「新标」），
    // 所以写出时就按整字截断：文件内容与任何读取器一致，再次导出也逐字节幂等。
    let document = createDocument("label");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
    document = { ...document, nodes: { ...document.nodes, [second.nodeId]: { ...document.nodes[second.nodeId], boardText: "新标签" } } };

    const result = exportLib(document);
    expect(result.warnings.some((warning) => warning.includes("4 字节"))).toBe(true);
    const { imported } = await roundTrip(document);
    expect(Object.values(imported.document.nodes).find((node) => node.boardText)?.boardText).toBe("新标");

    // 正好 4 字节的标签不受影响
    const short = { ...document, nodes: { ...document.nodes, [second.nodeId]: { ...document.nodes[second.nodeId], boardText: "要点" } } };
    expect(exportLib(short).warnings.some((warning) => warning.includes("4 字节"))).toBe(false);
    const shortRound = await roundTrip(short);
    expect(Object.values(shortRound.imported.document.nodes).find((node) => node.boardText)?.boardText).toBe("要点");
  });
});

describe("Piskvorky PSQ export", () => {
  it("round-trips through the record import route", async () => {
    let document = createDocument("psq-roundtrip");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
    const text = exportPsq(document);
    expect(text.startsWith("Piskvorky 15x15 , 0 - 0\r\n")).toBe(true);
    const imported = await importRecordFile(new File([text], "roundtrip.psq", { type: "text/plain" }));
    const moves = Object.values(imported.document.nodes).filter((node) => node.move);
    expect(moves.map((node) => node.move)).toEqual([
      { row: 7, col: 7, player: "black" },
      { row: 7, col: 8, player: "white" },
    ]);
  });

  it("reads a real Gomocup-archive PSQ: 1-based columns, time column, trailing footer", async () => {
    // 形态照抄 Gomocup 官方成绩存档：头 `Piskvorky 20x20, 11:11, 0`；着法第三列是每手用时
    // 毫秒（开局库着法为 0）；末尾还有页脚（AI 压缩包名 / -1 / 规则号,规则名）。
    const text = [
      "Piskvorky 20x20, 11:11, 0",
      "10,10,0",
      "11,10,0",
      "10,12,32098",
      "1,1,6",
      "YIXIN18.zip",
      "BENJAMIN.zip",
      "-1",
      "1,Renju",
      "",
    ].join("\r\n");
    const imported = await importRecordFile(new File([text], "gomocup.psq", { type: "text/plain" }));
    expect(imported.document.metadata.boardSize).toBe(20);
    // 列 1 起算 + 行从下往上：10,10 → (row 10, col 9)；1,1 → (row 19, col 0)
    expect(Object.values(imported.document.nodes).filter((node) => node.move).map((node) => node.move)).toEqual([
      { row: 10, col: 9, player: "black" },
      { row: 10, col: 10, player: "white" },
      { row: 8, col: 9, player: "black" },
      { row: 19, col: 0, player: "white" },
    ]);
    expect(imported.warnings.some((warning) => warning.includes("用时"))).toBe(true);
    expect(imported.warnings.some((warning) => warning.includes("页脚"))).toBe(true);
    // 页脚的「规则号,规则名」是自描述的，能对上我们的规则集
    expect(imported.document.metadata.rule).toBe("renju");
  });

  it("reads a 弈心-style PSQ whose columns are 0-based", async () => {
    // 2018 祁观 vs 弈心人机大战的官方存档：第三列是颜色 0/1，列号 0 起算（会出现 col 0）。
    const text = ["Piskvorky 15x15, 120:120, 0", "0,14,0", "7,7,1", "0,12,0", ""].join("\r\n");
    const imported = await importRecordFile(new File([text], "match.psq", { type: "text/plain" }));
    expect(Object.values(imported.document.nodes).filter((node) => node.move).map((node) => node.move)).toEqual([
      { row: 1, col: 0, player: "black" },
      { row: 8, col: 7, player: "white" },
      { row: 3, col: 0, player: "black" },
    ]);
    expect(imported.warnings.some((warning) => warning.includes("0 起算"))).toBe(true);
  });
});