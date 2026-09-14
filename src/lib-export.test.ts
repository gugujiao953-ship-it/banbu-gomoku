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

  it("round-trips a variation tree keeping sibling order", async () => {
    let document = createDocument("tree");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const main = addMove(document, first.nodeId, { row: 7, col: 8 }); document = main.document;
    const deep = addMove(document, main.nodeId, { row: 8, col: 7 }); document = deep.document;
    const variation = addMove(document, first.nodeId, { row: 8, col: 8 }); document = variation.document;
    const sub = addMove(document, variation.nodeId, { row: 8, col: 9 }); document = sub.document;
    const secondBranch = addMove(document, first.nodeId, { row: 6, col: 6 }); document = secondBranch.document;

    const { imported } = await roundTrip(document);
    expect(treeSignature(imported.document, imported.document.rootId)).toBe(treeSignature(document, document.rootId));
    const rootChildren = imported.document.nodes[imported.document.rootId].children;
    expect(rootChildren).toHaveLength(1);
    const branch = imported.document.nodes[rootChildren[0]];
    expect(branch.children).toHaveLength(3);
    expect(branch.children.map((id) => imported.document.nodes[id].move)).toEqual([
      { row: 7, col: 8, player: "white" },
      { row: 8, col: 8, player: "white" },
      { row: 6, col: 6, player: "white" },
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
    expect(warnings).toEqual([]);
    expect(treeSignature(imported.document, imported.document.rootId)).toBe(treeSignature(document, document.rootId));
    const rediscovered = Object.values(imported.document.nodes).find((node) => node.move?.row === 7 && node.move?.col === 8);
    expect(rediscovered?.comment).toBe("中文注释，含标点。win 100%");
    expect(rediscovered?.boardText).toBe("绝杀局面");
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
    // The legacy preamble reader exposes a pass as a move-less child node;
    // production import goes through the web-core session which restores pass.
    const pass = Object.values(imported.document.nodes).find((node) => node.parentId !== imported.document.rootId && !node.move);
    expect(pass).toBeDefined();
    expect((pass as { move: null }).move).toBeNull();
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

  it("exports alternate stones explicitly", async () => {
    let document = createDocument("psq-colors");
    const first = addMoveAs(document, document.rootId, { row: 6, col: 6 }, "black"); document = first.document;
    const second = addMoveAs(document, first.nodeId, { row: 7, col: 7 }, "white"); document = second.document;
    const third = addMoveAs(document, second.nodeId, { row: 8, col: 8 }, "black"); document = third.document;
    const text = exportPsq(document);
    expect(text).toContain("6,9,0\r\n7,8,1\r\n8,7,0");
  });
});