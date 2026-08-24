import { describe, expect, it } from "vitest";
import { addMove, addMoveAs, boardAt, createDocument, deleteVariation, depthOf, emptyBoard, insertMove, parseCoordinate, preferredNext, replaceMove, setLabelMark } from "./game";
import { analyzeCandidates } from "./analysis";
import { exportSgf, importRecordFile } from "./formats";
import { findPositionMatches, positionKey } from "./position-search";
import { isWinningMove, searchVcf, verifyVcfProof } from "./vcf";
import { createPuzzleDocument, importKaibaoPuzzleJson } from "./puzzles";

describe("game tree", () => {
  it("imports Kaibao setup JSON and restarts without clearing the puzzle", () => {
    const report = importKaibaoPuzzleJson(JSON.stringify([[], ["★", "H8,1", "H9,2"]]), "test set");
    expect(report.skipped).toBe(1);
    expect(report.collection.puzzles[0].player).toBe("black");
    const session = createPuzzleDocument(report.collection.puzzles[0]);
    expect(boardAt(session.document, session.initialNodeId)[7][7]).toBe("black");
    const attempt = addMoveAs(session.document, session.initialNodeId, { row: 7, col: 8 }, "black");
    expect(boardAt(attempt.document, attempt.nodeId)[7][8]).toBe("black");
    expect(boardAt(attempt.document, session.initialNodeId)[7][8]).toBeNull();
    expect(boardAt(attempt.document, session.initialNodeId)[6][7]).toBe("white");
  });
  it("creates and navigates variations without duplicating occupied moves", () => {
    let document = createDocument("test");
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    const main = addMove(document, first.nodeId, { row: 7, col: 8 });
    document = main.document;
    const variation = addMove(document, first.nodeId, { row: 8, col: 7 });
    document = variation.document;

    expect(document.nodes[first.nodeId].children).toHaveLength(2);
    expect(preferredNext(document, first.nodeId)).toBe(variation.nodeId);
    expect(depthOf(document, main.nodeId)).toBe(2);
    expect(boardAt(document, variation.nodeId)[8][7]).toBe("white");
  });

  it("deletes only the selected variation subtree", () => {
    let document = createDocument();
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    const branch = addMove(document, first.nodeId, { row: 8, col: 8 });
    document = branch.document;
    const result = deleteVariation(document, branch.nodeId);
    expect(result.nextId).toBe(first.nodeId);
    expect(result.document.nodes[branch.nodeId]).toBeUndefined();
  });

  it("replaces a move without dropping its descendants", () => {
    let document = createDocument();
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const child = addMove(document, first.nodeId, { row: 7, col: 8 }); document = child.document;
    const result = replaceMove(document, first.nodeId, { row: 8, col: 7 });
    expect(result.changed).toBe(true);
    expect(result.document.nodes[first.nodeId].move).toMatchObject({ row: 8, col: 7, player: "black" });
    expect(result.document.nodes[first.nodeId].children).toContain(child.nodeId);
    expect(boardAt(result.document, child.nodeId)[8][7]).toBe("black");
  });

  it("inserts a move from a pivot as a new variation and parses coordinates", () => {
    let document = createDocument();
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const main = addMove(document, first.nodeId, { row: 7, col: 8 }); document = main.document;
    const variation = insertMove(document, first.nodeId, parseCoordinate("H7")!);
    expect(variation.created).toBe(true);
    expect(document.nodes[first.nodeId].children).toHaveLength(1);
    expect(variation.document.nodes[first.nodeId].children).toHaveLength(2);
    expect(variation.document.nodes[variation.nodeId].move).toMatchObject({ row: 8, col: 7, player: "white" });
  });

  it("ranks an immediate winning point with an explainable reason", () => {
    const board = emptyBoard();
    for (const col of [3, 4, 5, 6]) board[7][col] = "black";
    const candidates = analyzeCandidates(board, "black", 5);
    expect(candidates.some((candidate) => candidate.reasons.includes("成五"))).toBe(true);
  });
});

describe("record formats", () => {
  it("round-trips SGF moves, comments and branches", async () => {
    let document = createDocument("瑞星研究");
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    const second = addMove(document, first.nodeId, { row: 6, col: 7 });
    document = second.document;
    document.nodes[second.nodeId].comment = "白棋防守";
    const branch = addMove(document, first.nodeId, { row: 7, col: 8 });
    document = branch.document;

    const sgf = exportSgf(document);
    const imported = await importRecordFile(new File([sgf], "test.sgf", { type: "application/x-go-sgf" }));
    expect(imported.document.metadata.title).toBe("瑞星研究");
    expect(Object.values(imported.document.nodes).filter((node) => node.move)).toHaveLength(3);
    expect(imported.document.nodes[imported.document.rootId].children).toHaveLength(1);
    const importedFirst = imported.document.nodes[imported.document.rootId].children[0];
    expect(imported.document.nodes[importedFirst].children).toHaveLength(2);
  });

  it("imports compact POS notation", async () => {
    const imported = await importRecordFile(new File(["h8i8h9"], "opening.pos"));
    expect(Object.values(imported.document.nodes).filter((node) => node.move)).toHaveLength(3);
  });

  it("round-trips labelled candidate points through SGF LB", async () => {
    let document = createDocument("候选点");
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    document.nodes[first.nodeId].marks = setLabelMark([], { row: 6, col: 8 }, "A");
    const sgf = exportSgf(document);
    expect(sgf).toContain("LB[ig:A]");
    const imported = await importRecordFile(new File([sgf], "candidate.sgf"));
    const importedFirst = Object.values(imported.document.nodes).find((node) => node.move?.row === 7 && node.move?.col === 7);
    expect(importedFirst?.marks[0]).toMatchObject({ kind: "label", label: "A", row: 6, col: 8 });
  });

  it("round-trips board text and structured evaluations through SGF", async () => {
    let document = createDocument("局面评价");
    document.nodes[document.rootId].boardText = "开局研究入口";
    document.nodes[document.rootId].evaluation = "study";
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    document.nodes[first.nodeId].boardText = "黑方唯一强手";
    document.nodes[first.nodeId].evaluation = "good";

    const sgf = exportSgf(document);
    expect(sgf).toContain("N[黑方唯一强手]");
    expect(sgf).toContain("TE[1]");
    expect(sgf).not.toContain("XEV[good]");
    expect(sgf).not.toContain("XEV[study]");
    const imported = await importRecordFile(new File([sgf], "evaluation.sgf"));
    expect(imported.document.nodes[imported.document.rootId]).toMatchObject({ boardText: "开局研究入口" });
    expect(imported.document.nodes[imported.document.rootId].evaluation).toBeUndefined();
    const importedFirst = Object.values(imported.document.nodes).find((node) => node.move?.row === 7 && node.move?.col === 7);
    expect(importedFirst).toMatchObject({ boardText: "黑方唯一强手", evaluation: "good" });
  });

  it.each([
    ["TE[2]", "good", 2],
    ["BM[2]", "bad", 2],
    ["DO[]", "doubtful", undefined],
    ["IT[]", "interesting", undefined],
    ["XEV[only]", "only", undefined],
  ] as const)("imports and preserves SGF evaluation %s", async (property, evaluation, level) => {
    const imported = await importRecordFile(new File([`(;GM[4]SZ[15];B[hh]${property})`], "property.sgf"));
    const node = Object.values(imported.document.nodes).find((item) => item.move);
    expect(node?.evaluation).toBe(evaluation);
    expect(node?.evaluationLevel).toBe(level);
    expect(exportSgf(imported.document)).toContain(property);
  });

  it("keeps move evaluation across independent no-move nodes and reports conflicts", async () => {
    const source = "(;GM[4]SZ[15];B[hh]TE[1]XEV[bad];N[关键 局面];W[ii])";
    const imported = await importRecordFile(new File([source], "conflict.sgf"));
    const first = Object.values(imported.document.nodes).find((node) => node.move?.row === 7 && node.move?.col === 7);
    expect(first).toMatchObject({ evaluation: "good", boardText: "关键 局面" });
    expect(imported.warnings.some((warning) => warning.includes("冲突"))).toBe(true);
  });

  it("imports the RenLib binary header and traversal flags", async () => {
    const header = new Uint8Array([255, 82, 101, 110, 76, 105, 98, 255, 3, 4, ...Array(10).fill(255)]);
    const body = new Uint8Array([
      0, 0,
      120, 0x80, // h8 has a sibling branch and descends into the next record
      121, 0x48, // i8, leaf + new comment
      65, 66, 0, 0, // comment "AB" + terminator (pair aligned)
      136, 0x00, // h9 sibling of h8
    ]);
    const bytes = new Uint8Array(header.length + body.length);
    bytes.set(header); bytes.set(body, header.length);
    const imported = await importRecordFile(new File([bytes], "opening.lib"));
    const moves = Object.values(imported.document.nodes).filter((node) => node.move);
    expect(moves).toHaveLength(3);
    const rootChildren = imported.document.nodes[imported.document.rootId].children;
    expect(rootChildren).toHaveLength(2);
    expect(imported.warnings.some((warning) => warning.includes("注释"))).toBe(true);
    const commented = Object.values(imported.document.nodes).find((node) => node.comment);
    expect(commented?.comment).toBe("AB");
  });
});

describe("proof search and position index", () => {
  it("proves an immediate five and a double-four VCF", () => {
    const immediate = emptyBoard();
    for (const col of [4, 5, 6, 7]) immediate[7][col] = "black";
    expect(isWinningMove(immediate, { row: 7, col: 8 }, "black", "renju")).toBe(true);
    const direct = searchVcf(immediate, "black", { maxAttackMoves: 2, timeBudgetMs: 500, nodeBudget: 20000 });
    expect(direct.status).toBe("win");
    expect(direct.principalVariation).toHaveLength(1);
    expect(verifyVcfProof(immediate, direct.proof, "black", "renju")).toEqual({ valid: true });

    const doubleFour = emptyBoard();
    for (const col of [4, 5, 6]) doubleFour[7][col] = "black";
    for (const row of [4, 5, 6]) doubleFour[row][7] = "black";
    const proof = searchVcf(doubleFour, "black", { rule: "freestyle", maxAttackMoves: 3, timeBudgetMs: 800, nodeBudget: 50000 });
    expect(proof.status).toBe("win");
    expect(proof.principalVariation[0]).toMatchObject({ row: 7, col: 7, player: "black" });
  });

  it("proves and independently verifies a forced two-attack VCF tree", () => {
    const board = emptyBoard();
    for (const [row, col] of [[7, 4], [7, 5], [7, 6], [5, 5], [6, 6]]) board[row][col] = "black";
    board[7][3] = "white";
    const result = searchVcf(board, "black", { rule: "renju", maxAttackMoves: 3, timeBudgetMs: 4000, nodeBudget: 200000 });
    expect(result.status).toBe("win");
    expect(result.principalVariation.slice(0, 3)).toEqual([
      expect.objectContaining({ row: 7, col: 7, player: "black" }),
      expect.objectContaining({ row: 7, col: 8, player: "white" }),
      expect.objectContaining({ row: 8, col: 8, player: "black" }),
    ]);
    expect(verifyVcfProof(board, result.proof, "black", "renju")).toEqual({ valid: true });
    const tampered = structuredClone(result.proof)!;
    tampered.children = [];
    expect(verifyVcfProof(board, tampered, "black", "renju").valid).toBe(false);
  });

  it("reports budget exhaustion without claiming a proof", () => {
    const board = emptyBoard(); board[7][7] = "black";
    const result = searchVcf(board, "white", { maxAttackMoves: 5, timeBudgetMs: 1000, nodeBudget: 100 });
    expect(result.status).toBe("budget");
    expect(result.proof).toBeUndefined();
  });

  it("finds equivalent library positions under rotation and mirror", () => {
    let document = createDocument("旋转匹配");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
    const rotated = emptyBoard(); rotated[7][7] = "black"; rotated[8][7] = "white";
    expect(positionKey(boardAt(document, second.nodeId), "black", true)).toBe(positionKey(rotated, "black", true));
    expect(findPositionMatches([document], rotated, "black", false)).toHaveLength(0);
    expect(findPositionMatches([document], rotated, "black", true)).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: document.id, nodeId: second.nodeId, depth: 2 })]));
  });
});
