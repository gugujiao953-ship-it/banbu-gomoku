import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "./game";
import { importRenLibLegacy } from "./formats";
import { exportLib } from "./lib-export";
import { buildCompactRenLibIndex, createLazyDocument } from "./compact-index";
import type { GameDocument } from "./types";

const signature = (document: GameDocument, id: string): string => {
  const node = document.nodes[id];
  if (!node) return "missing";
  const own = node.move ? `${node.move.player}:${node.move.row},${node.move.col}` : node.passPlayer ? "pass" : "root";
  const children = (node.children || []).map((child) => signature(document, child)).join("|");
  return `${own}{${children}}`;
};

describe("lazy document LIB export", () => {
  it("exports a lazy (compact-index) document identically to the eager one", async () => {
    let document = createDocument("lazy-test");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
    const branch = addMove(document, first.nodeId, { row: 8, col: 8 }); document = branch.document;
    const deep = addMove(document, branch.nodeId, { row: 8, col: 9 }); document = deep.document;
    document.nodes[second.nodeId].comment = "评论";

    const index = buildCompactRenLibIndex(document);
    const { nodes: _nodes, ...base } = document;
    const lazy = createLazyDocument(base, index);

    const eagerResult = exportLib(document);
    const lazyResult = exportLib(lazy);
    expect(lazyResult.warnings).toEqual(eagerResult.warnings);
    expect(Array.from(lazyResult.bytes)).toEqual(Array.from(eagerResult.bytes));

    const roundTrip = await importRenLibLegacy(new Blob([lazyResult.bytes]), "lazy.lib");
    expect(signature(roundTrip.document, roundTrip.document.rootId)).toBe(signature(document, document.rootId));
  });
});
