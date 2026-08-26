import { describe, expect, it } from "vitest";
import { addMove, addMoveAs, boardAt, createDocument, deleteVariation, depthOf, emptyBoard, insertMove, nextPlayerAt, parseCoordinate, preferredNext, replaceMove, setLabelMark } from "./game";
import { analyzeCandidates } from "./analysis";
import { exportSgf, importRecordFile } from "./formats";
import { findPositionMatches, positionKey } from "./position-search";
import { isWinningMove, searchVcf, verifyVcfProof } from "./vcf";
import { createPuzzleDocument, importKaibaoPuzzleJson } from "./puzzles";
import { assembleCompactIndex, documentFingerprint } from "./large-storage";
import { buildCompactRenLibIndex, compactBranchCount, compactChildWindow, compactDiagnostics, compactFirstBranchNodeId, compactIndexBytes, compactIndexOf, compactNodeCount, compactSearch, createLazyDocument } from "./compact-index";
import { renLibDisplayMark } from "./renlib-display";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, hasDraft, overlayNode, overlayPreferredChild, projectedDocument, pushDraft, redoDraft, undoDraft } from "./draft-operations";
import { documentSignature } from "./storage";

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

  it("rejects disguised libraries, arbitrary arrays, prose, and unknown binaries", async () => {
    await expect(importRecordFile(new File([new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a])], "jvm.lib"))).rejects.toThrow("ar 静态库");
    await expect(importRecordFile(new File([JSON.stringify([["H8"]])], "puzzles.json"))).rejects.toThrow("题库页面");
    await expect(importRecordFile(new File(["theme=H8; this is configuration text"], "theme.txt"))).rejects.toThrow("没有识别到");
    await expect(importRecordFile(new File([new Uint8Array([0, 1, 2, 3])], "book.dat"))).rejects.toThrow("不支持 .dat 格式");
  });

  it("accepts coordinate TXT separators and numeric-leading SGF extensions", async () => {
    const text = await importRecordFile(new File(["H8, I8; H9"], "moves.txt"));
    expect(Object.values(text.document.nodes).filter((node) => node.move)).toHaveLength(3);
    const legacy = await importRecordFile(new File(["(;5A[]PW[白];B[hh];W[ii])"], "legacy.SGF"));
    expect(Object.values(legacy.document.nodes).filter((node) => node.move)).toHaveLength(2);
  });

  it("imports a move stored directly on the SGF root node", async () => {
    const imported = await importRecordFile(new File(["(;GM[4]SZ[15]GN[根节点着法]B[hh]C[首手])"], "root-move.sgf"));
    const moves = Object.values(imported.document.nodes).filter((node) => node.move);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ move: { row: 7, col: 7, player: "black" }, comment: "首手" });
  });

  it("imports every top-level game and rejects malformed SGF boundaries", async () => {
    const imported = await importRecordFile(new File(["(;SZ[15]GN[一];B[hh])(;SZ[15]GN[二];W[ii])"], "collection.sgf"));
    expect(imported.format).toBe("SGF Collection (2)");
    expect(imported.document.metadata.title).toBe("一");
    expect(imported.additionalDocuments?.map((document) => document.metadata.title)).toEqual(["二"]);
    await expect(importRecordFile(new File(["(;B[hh;W[ii)"], "broken.sgf"))).rejects.toThrow("结束括号");
    await expect(importRecordFile(new File(["(;B;W[ii])"], "broken-property.sgf"))).rejects.toThrow("缺少值");
  });

  it("preserves setup positions and passes through SGF round-trips", async () => {
    const source = "(;GM[4]FF[4]SZ[15]GN[设置]AB[hh][ii]AW[jj]PL[W];W[]C[白过手];AE[ii]PL[B]N[清除一子];B[kk])";
    const imported = await importRecordFile(new File([source], "setup-pass.sgf"));
    const final = Object.values(imported.document.nodes).find((node) => node.move?.row === 10 && node.move.col === 10)!;
    const board = boardAt(imported.document, final.id);
    expect(board[7][7]).toBe("black"); expect(board[8][8]).toBeNull();
    expect(board[9][9]).toBe("white"); expect(board[10][10]).toBe("black");
    expect(depthOf(imported.document, final.id)).toBe(2);
    expect(nextPlayerAt(imported.document, final.id)).toBe("white");
    const exported = exportSgf(imported.document);
    expect(exported).toContain("AB[hh][ii]AW[jj]PL[W]");
    expect(exported).toContain("W[]"); expect(exported).toContain("AE[ii]PL[B]");
    const roundTrip = await importRecordFile(new File([exported], "roundtrip.sgf"));
    expect(Object.values(roundTrip.document.nodes).some((node) => node.passPlayer === "white")).toBe(true);
    const matches = findPositionMatches([imported.document], board, nextPlayerAt(imported.document, final.id), false);
    expect(matches.find((match) => match.nodeId === final.id)?.depth).toBe(2);
  });

  it("rejects invalid setup points instead of silently changing the position", async () => {
    await expect(importRecordFile(new File(["(;SZ[15]AB[pp];B[hh])"], "invalid-setup.sgf"))).rejects.toThrow("设置坐标");
    await expect(importRecordFile(new File(["(;SZ[15]PL[X];B[hh])"], "invalid-player.sgf"))).rejects.toThrow("无效行棋方");
  });

  it("decodes UTF-16 SGF and rejects unsupported board sizes", async () => {
    const source = "(;GM[4]FF[4]CA[UTF-16LE]SZ[15]GN[中文棋谱];B[hh])";
    const bytes = new Uint8Array(2 + source.length * 2); bytes.set([0xff, 0xfe]);
    Array.from(source).forEach((character, index) => { const code = character.charCodeAt(0); bytes[2 + index * 2] = code & 0xff; bytes[3 + index * 2] = code >> 8; });
    const imported = await importRecordFile(new File([bytes], "utf16.sgf"));
    expect(imported.document.metadata.title).toBe("中文棋谱");
    await expect(importRecordFile(new File(["(;SZ[19];B[hh])"], "nineteen.sgf"))).rejects.toThrow("仅支持十五路");
  });

  it("adapts only explicit JSON move-list schemas", async () => {
    const strings = await importRecordFile(new File([JSON.stringify({ title: "列表", moves: ["H8", { coordinate: "I8", player: "white" }] })], "moves.json"));
    expect(strings.format).toBe("JSON Move List");
    expect(Object.values(strings.document.nodes).filter((node) => node.move)).toHaveLength(2);
    const numeric = await importRecordFile(new File([JSON.stringify({ coordinateBase: 1, moves: [{ row: 8, col: 8, color: 1 }] })], "numeric.json"));
    expect(Object.values(numeric.document.nodes).find((node) => node.move)?.move).toMatchObject({ row: 7, col: 7, player: "black" });
    await expect(importRecordFile(new File([JSON.stringify({ moves: [{ row: 8, col: 8 }] })], "ambiguous.json"))).rejects.toThrow("coordinateBase");
    await expect(importRecordFile(new File([JSON.stringify({ coordinateBase: 0, moves: [{ row: 7.5, col: 8 }] })], "fractional.json"))).rejects.toThrow("坐标无效");
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

  it("keeps multi-character result labels used by mobile marking tools", async () => {
    let document = createDocument("结论标注");
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    document.nodes[first.nodeId].marks = setLabelMark([], { row: 7, col: 7 }, "平衡");
    const sgf = exportSgf(document);
    expect(sgf).toContain("LB[hh:平衡]");
    const imported = await importRecordFile(new File([sgf], "result-label.sgf"));
    const importedFirst = Object.values(imported.document.nodes).find((node) => node.move?.row === 7 && node.move?.col === 7);
    expect(importedFirst?.marks[0]).toMatchObject({ kind: "label", label: "平衡", row: 7, col: 7 });
  });

  it("distinguishes preferred branches and evaluation levels in large-record fingerprints", () => {
    let document = createDocument("指纹");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, document.rootId, { row: 7, col: 8 }); document = second.document;
    const original = documentFingerprint(document);
    const preferredChanged = { ...document, nodes: { ...document.nodes, [document.rootId]: { ...document.nodes[document.rootId], preferredChildId: first.nodeId } } };
    expect(documentFingerprint(preferredChanged)).not.toBe(original);
    const evaluated = { ...document, nodes: { ...document.nodes, [first.nodeId]: { ...document.nodes[first.nodeId], evaluation: "good" as const, evaluationLevel: 2 as const } } };
    expect(documentFingerprint(evaluated)).not.toBe(original);
  });

  it("distinguishes setup and pass semantics in fingerprints and duplicate signatures", () => {
    const base = createDocument("语义指纹");
    const setup = structuredClone(base);
    setup.nodes[setup.rootId].setup = { black: [{ row: 7, col: 7 }], white: [], empty: [], nextPlayer: "white" };
    const pass = structuredClone(base);
    pass.nodes[pass.rootId].passPlayer = "black";
    expect(documentFingerprint(setup)).not.toBe(documentFingerprint(base));
    expect(documentFingerprint(pass)).not.toBe(documentFingerprint(base));
    expect(documentSignature(setup)).not.toBe(documentSignature(base));
    expect(documentSignature(pass)).not.toBe(documentSignature(base));
  });

  it("reassembles setup tables from chunked large-record storage", () => {
    const setup = { black: [{ row: 7, col: 7 }], white: [], empty: [], nextPlayer: "white" as const };
    const stored = { nodeCount: 1, rootId: "root" };
    const chunks = [
      { field: "parent", offset: 0, value: Int32Array.from([-1]).buffer },
      { field: "setupRefs", offset: 0, value: Int32Array.from([0]).buffer },
      { field: "ids", offset: 0, value: ["root"] },
      { field: "setups", offset: 0, value: [setup] },
    ];
    const restored = assembleCompactIndex(stored, chunks);
    expect(restored?.setupRefs?.[0]).toBe(0);
    expect(restored?.setups?.[0]).toEqual(setup);
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

  it("keeps move evaluation and preserves independent no-move nodes", async () => {
    const source = "(;GM[4]SZ[15];B[hh]TE[1]XEV[bad];N[关键 局面];W[ii])";
    const imported = await importRecordFile(new File([source], "conflict.sgf"));
    const first = Object.values(imported.document.nodes).find((node) => node.move?.row === 7 && node.move?.col === 7);
    expect(first).toMatchObject({ evaluation: "good" });
    const note = Object.values(imported.document.nodes).find((node) => node.boardText === "关键 局面");
    expect(note?.move).toBeNull();
    expect(note?.parentId).toBe(first?.id);
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

  it("keeps RenLib extension text and node flags instead of flattening them", async () => {
    const bytes = new Uint8Array([
      255, 82, 101, 110, 76, 105, 98, 255, 3, 0, ...Array(10).fill(255),
      0, 0,
      120, 0x15, 0x00, 0x01, // H8 + extension + mark + start + board-text
      84, 0, 0, 0, // board text "T"
    ]);
    const imported = await importRecordFile(new File([bytes], "flags.lib"));
    const move = Object.values(imported.document.nodes).find((node) => node.move);
    expect(move?.move).toMatchObject({ row: 7, col: 7, player: "black" });
    expect(move?.boardText).toBe("T");
    expect(move?.renLibMark).toBe(true);
    expect(move?.startPosition).toBe(true);
  });

  it("builds a compact parent/child/sibling index for large-library storage", () => {
    let document = createDocument("index");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const main = addMove(document, first.nodeId, { row: 7, col: 8 }); document = main.document;
    const variation = addMove(document, first.nodeId, { row: 8, col: 7 }); document = variation.document;
    const index = buildCompactRenLibIndex(document);
    expect(index.nodeCount).toBe(4);
    expect(index.parent[1]).toBe(0);
    expect(index.firstChild[1]).toBe(2);
    expect(index.nextSibling[2]).toBe(3);
    expect(index.preferredChild?.[1]).toBe(3);
    expect(compactIndexBytes(index)).toBeGreaterThan(0);

    const { nodes: _nodes, ...base } = document;
    const lazy = createLazyDocument(base, index);
    expect(lazy.nodes[lazy.rootId].children).toEqual([first.nodeId]);
    expect(lazy.nodes[main.nodeId].parentId).toBe(first.nodeId);
    expect(lazy.nodes[first.nodeId].children).toEqual([main.nodeId, variation.nodeId]);
    expect(compactBranchCount(lazy)).toBe(1);
    expect(compactFirstBranchNodeId(lazy)).toBe(first.nodeId);
    expect(compactNodeCount({ ...lazy, metadata: { ...lazy.metadata, title: "renamed" } })).toBe(4);
    expect(compactIndexOf({ ...lazy, updatedAt: new Date().toISOString() })).toBe(index);
    expect(Object.keys(lazy.nodes)).toHaveLength(4);
  });

  it("round-trips compact marks, anchors, and evaluations", () => {
    let document = createDocument("metadata index");
    const created = addMove(document, document.rootId, { row: 7, col: 7 });
    document = created.document;
    const node = document.nodes[created.nodeId];
    node.marks = [{ row: 6, col: 6, kind: "circle" }, { row: 5, col: 5, kind: "label", label: "A" }];
    node.anchor = { row: 4, col: 4 };
    node.evaluation = "interesting";
    node.evaluationLevel = 2;
    const index = buildCompactRenLibIndex(document);
    const { nodes: _nodes, ...base } = document;
    const lazy = createLazyDocument(base, index);
    expect(lazy.nodes[created.nodeId]).toMatchObject({
      anchor: { row: 4, col: 4 },
      marks: node.marks,
      evaluation: "interesting",
      evaluationLevel: 2,
    });
  });

  it("guards documentFingerprint on compact documents", () => {
    let document = createDocument("compact fingerprint");
    document = addMove(document, document.rootId, { row: 7, col: 7 }).document;
    document = addMove(document, document.rootId, { row: 8, col: 8 }).document;
    const index = buildCompactRenLibIndex(document);
    const { nodes: _nodes, ...base } = document;
    const lazy = createLazyDocument(base, index);
    expect(documentFingerprint(lazy)).toMatch(/^compact-/);
  });

  it("computes compact diagnostics on a branched tree", () => {
    let document = createDocument("branch diagnostics");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = addMove(document, first.nodeId, { row: 7, col: 8 }).document;
    document = addMove(document, first.nodeId, { row: 8, col: 7 }).document;
    const index = buildCompactRenLibIndex(document);
    const { nodes: _nodes, ...base } = document;
    const lazy = createLazyDocument(base, index);
    const diag = compactDiagnostics(lazy);
    expect(diag.hasCompact).toBe(true);
    expect(diag.nodeCount).toBe(4);
    expect(diag.branchCount).toBe(1);
    expect(diag.firstBranchId).toBe(first.nodeId);
  });

  it("maps RenLib display semantics while preserving raw values", () => {
    expect(renLibDisplayMark("a")).toMatchObject({ semantic: "good", displayKind: "text", displayText: "a", rawText: "a" });
    expect(renLibDisplayMark("c")).toMatchObject({ semantic: "bad", displayText: "c" });
    expect(renLibDisplayMark("ccc")).toMatchObject({ semantic: "bad", displayText: "c", rawText: "ccc" });
    expect(renLibDisplayMark("黑").displayKind).toBe("black-dot");
    expect(renLibDisplayMark("白").displayKind).toBe("white-dot");
    expect(renLibDisplayMark("蓝").displayKind).toBe("blue-dot");
    expect(renLibDisplayMark("未知")).toMatchObject({ semantic: "unknown", displayKind: "text", rawText: "未知" });
    expect(renLibDisplayMark().displayKind).toBe("neutral-dot");
  });

  it("supports draft operation undo and redo without changing the committed document", () => {
    const initial = emptyDraft();
    const committedBase = createDocument("commit");
    const node = { id: "draft-node", parentId: committedBase.rootId, children: [], move: { row: 7, col: 7, player: "black" as const }, comment: "", marks: [] };
    const added = pushDraft(initial, { type: "add-move", parentId: committedBase.rootId, node });
    expect(hasDraft(added)).toBe(true);
    const undone = undoDraft(added);
    expect(undone.operations).toHaveLength(0);
    const redone = redoDraft(undone);
    expect(redone.operations).toHaveLength(1);
    const committed = applyDraftToDocument(committedBase, redone.operations);
    expect(committed.nodes[node.id]?.move).toMatchObject({ row: 7, col: 7 });
  });

  it("applies delete-subtree via applyDraftToDocument", () => {
    let document = createDocument("delete");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = addMove(document, first.nodeId, { row: 7, col: 8 }).document;
    document = addMove(document, first.nodeId, { row: 8, col: 7 }).document;
    const result = applyDraftToDocument(document, [
      { type: "delete-subtree", parentId: document.rootId, rootId: first.nodeId },
    ]);
    expect(result.nodes[first.nodeId]).toBeUndefined();
    expect(result.nodes[document.rootId]?.children).toHaveLength(0);
  });

  it("applies set-mainline via applyDraftToDocument", () => {
    let document = createDocument("mainline");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
    document = addMove(document, first.nodeId, { row: 8, col: 7 }).document;
    const result = applyDraftToDocument(document, [
      { type: "set-mainline", parentId: first.nodeId, childId: second.nodeId },
    ]);
    expect(result.nodes[first.nodeId]?.preferredChildId).toBe(second.nodeId);
  });

  it("overlayNode removes deleted subtree descendants", () => {
    let document = createDocument("overlay-delete");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = addMove(document, first.nodeId, { row: 7, col: 8 }).document;
    const overlay = buildDraftOverlay({ operations: [{ type: "delete-subtree", parentId: first.nodeId, rootId: document.nodes[first.nodeId].children[0] }], redo: [] }, document);
    expect(overlayNode(document, overlay, document.nodes[first.nodeId].children[0])).toBeUndefined();
    expect(overlay.deleted.has(document.nodes[first.nodeId].children[0])).toBe(true);
  });

  it("projectedDocument includes draft-added nodes", () => {
    let document = createDocument("projected");
    const draftId = "draft-add-1";
    const overlay = buildDraftOverlay({
      operations: [{ type: "add-move", parentId: document.rootId, node: { id: draftId, parentId: document.rootId, children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] } }],
      redo: [],
    }, document);
    const projected = projectedDocument(document, overlay);
    expect(projected.nodes[draftId]).toBeDefined();
    expect(projected.nodes[draftId]?.move?.row).toBe(7);
    expect(projected.nodes[document.rootId]?.children).toContain(draftId);
  });

  it("projectedDocument respects overlayPreferredChild", () => {
    let document = createDocument("preferred-overlay");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const second = addMove(document, first.nodeId, { row: 7, col: 8 }); document = second.document;
    document = addMove(document, first.nodeId, { row: 8, col: 7 }).document;
    const overlay = buildDraftOverlay({
      operations: [{ type: "set-mainline", parentId: first.nodeId, childId: second.nodeId }],
      redo: [],
    }, document);
    expect(overlayPreferredChild(document, overlay, first.nodeId)).toBe(second.nodeId);
  });

  it("overlayNode excludes deleted children and includes draft-added children", () => {
    let document = createDocument("overlay-children");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const child = document.nodes[first.nodeId].children[0];
    const draftId = "draft-child-1";
    const overlay = buildDraftOverlay({
      operations: [
        { type: "delete-subtree", parentId: child, rootId: child },
        { type: "add-move", parentId: first.nodeId, node: { id: draftId, parentId: first.nodeId, children: [], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] } },
      ],
      redo: [],
    }, document);
    const resolved = overlayNode(document, overlay, first.nodeId);
    expect(resolved?.children).not.toContain(child);
    expect(resolved?.children).toContain(draftId);
  });

  it("buildDraftOverlay without document context still collects root IDs", () => {
    const overlay = buildDraftOverlay({
      operations: [{ type: "delete-subtree", parentId: "root", rootId: "child-1" }],
      redo: [],
    });
    expect(overlay.deleted.has("child-1")).toBe(true);
  });

  it("reads a child window within compact index", () => {
    let document = createDocument("child window");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = addMove(document, first.nodeId, { row: 7, col: 8 }).document;
    document = addMove(document, first.nodeId, { row: 8, col: 7 }).document;
    document = addMove(document, first.nodeId, { row: 9, col: 9 }).document;
    const index = buildCompactRenLibIndex(document);
    const { nodes: _nodes, ...base } = document;
    const lazy = createLazyDocument(base, index);
    // nodeIndex 1 is first.nodeId; its children are ids[2], ids[3], ids[4].
    expect(compactChildWindow(index, 1, 0, 2)).toEqual([index.ids[2], index.ids[3]]);
    expect(compactChildWindow(index, 1, 0, 3)).toHaveLength(3);
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
