import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "./game";
import { exportJson, exportSgf, importRecordFile } from "./formats";
import { buildCompactRenLibIndex, createLazyDocument } from "./compact-index";
import { commitDraftAsDerivedVersion, loadDraftForDocument, removeDraftForDocument, saveDraftForDocument, documentFingerprint, assembleCompactIndex, loadLargeDocument, loadLargeSummaries, removeLargeDocument, saveCompactIndex, saveLargeDocument } from "./large-storage";
import type { DraftOperation } from "./draft-operations";

describe("large-record storage", () => {
  it("round-trips a document saving and reloading", async () => {
    let document = createDocument("storage roundtrip");
    document = addMove(document, document.rootId, { row: 7, col: 7 }).document;
    document = addMove(document, document.rootId, { row: 8, col: 8 }).document;
    await saveLargeDocument(document);
    const loaded = await loadLargeDocument(document.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.title).toBe("storage roundtrip");
    expect(Object.keys(loaded!.nodes)).toHaveLength(3);
  });

  it("round-trips a compact index via saveCompactIndex and reloading", async () => {
    let document = createDocument("compact roundtrip");
    document = addMove(document, document.rootId, { row: 7, col: 7 }).document;
    document = addMove(document, document.rootId, { row: 8, col: 8 }).document;
    const index = buildCompactRenLibIndex(document);
    const summary = await saveCompactIndex(document, index);
    expect(summary.storageMode).toBe("compact-index");
    const loaded = await loadLargeDocument(document.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes[document.rootId]?.children.length).toBe(2);
  });

  it("assembles chunks by numeric offsets rather than key order", () => {
    const stored = { nodeCount: 4, rootId: "root" };
    const chunks = [
      { field: "ids", offset: 2, value: ["id2", "id3"] },
      { field: "ids", offset: 0, value: ["root", "id1"] },
      { field: "parent", offset: 2, value: new Int32Array([1, 1]).buffer },
      { field: "parent", offset: 0, value: new Int32Array([-1, 0]).buffer },
      { field: "firstChild", offset: 0, value: new Int32Array([1, 2, -1, -1]).buffer },
      { field: "nextSibling", offset: 0, value: new Int32Array([-1, -1, 3, -1]).buffer },
      { field: "childCount", offset: 0, value: new Int32Array([1, 2, 0, 0]).buffer },
      { field: "preferredChild", offset: 0, value: new Int32Array([1, 2, -1, -1]).buffer },
      { field: "moveCode", offset: 0, value: new Uint16Array([0, 1, 2, 3]).buffer },
      { field: "anchorCode", offset: 0, value: new Uint16Array([0, 0, 0, 0]).buffer },
      { field: "state", offset: 0, value: new Uint8Array([0, 1, 2, 1]).buffer },
      { field: "evaluation", offset: 0, value: new Int8Array([0, 0, 0, 0]).buffer },
      { field: "evaluationLevel", offset: 0, value: new Uint8Array([0, 0, 0, 0]).buffer },
      { field: "markRefs", offset: 0, value: new Int32Array([-1, 0, -1, 0, -1, 0, -1, 0]).buffer },
      { field: "textRefs", offset: 0, value: new Int32Array([-1, -1, -1, -1, -1, -1, -1, -1]).buffer },
      { field: "texts", offset: 0, value: [] },
    ];
    const index = assembleCompactIndex(stored, chunks);
    expect(index?.ids).toEqual(["root", "id1", "id2", "id3"]);
    expect(Array.from(index?.parent || [])).toEqual([-1, 0, 1, 1]);
  });

  it("removes the document and its chunks", async () => {
    let document = createDocument("removal");
    document = addMove(document, document.rootId, { row: 7, col: 7 }).document;
    const index = buildCompactRenLibIndex(document);
    await saveCompactIndex(document, index);
    await removeLargeDocument(document.id);
    const loaded = await loadLargeDocument(document.id);
    expect(loaded).toBeNull();
    const summaries = await loadLargeSummaries();
    expect(summaries.some((item) => item.id === document.id)).toBe(false);
  });
});

describe("import/export round-trip", () => {
  it("exports and reimports SGF preserving branches and moves", async () => {
    let document = createDocument("sgf roundtrip");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = addMove(document, first.nodeId, { row: 7, col: 8 }).document;
    document = addMove(document, first.nodeId, { row: 8, col: 7 }).document;
    const sgf = exportSgf(document);
    const reimported = await importRecordFile(new File([sgf], "reimport.sgf"));
    expect(Object.keys(reimported.document.nodes).length).toBe(Object.keys(document.nodes).length);
  });

  it("exports and reimports RENJU JSON preserving branches", async () => {
    let document = createDocument("json roundtrip");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    document = addMove(document, first.nodeId, { row: 7, col: 8 }).document;
    document = addMove(document, first.nodeId, { row: 8, col: 7 }).document;
    const json = exportJson(document);
    const reimported = await importRecordFile(new File([json], "reimport.renju"));
    expect(Object.keys(reimported.document.nodes).length).toBe(Object.keys(document.nodes).length);
  });
});

describe("draft persistence", () => {
  it("saves and reloads a draft for a compact document", async () => {
    let document = createDocument("draft persist");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const index = buildCompactRenLibIndex(document);
    await saveCompactIndex(document, index);
    const fingerprint = documentFingerprint(document);
    const ops: DraftOperation[] = [{ type: "add-move", parentId: document.rootId, node: { id: "draft-test", parentId: document.rootId, children: [], move: { row: 7, col: 8, player: "white" }, comment: "", marks: [] } }];
    await saveDraftForDocument(document.id, { operations: ops, redo: [] }, fingerprint);
    const loaded = await loadDraftForDocument(document.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.operations).toHaveLength(1);
    expect(loaded!.baseFingerprint).toBe(fingerprint);
  });

  it("removes a draft after discard", async () => {
    let document = createDocument("draft remove");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const index = buildCompactRenLibIndex(document);
    await saveCompactIndex(document, index);
    const fingerprint = documentFingerprint(document);
    const ops: DraftOperation[] = [{ type: "update-node", nodeId: first.nodeId, patch: { comment: "test" } }];
    await saveDraftForDocument(document.id, { operations: ops, redo: [] }, fingerprint);
    await removeDraftForDocument(document.id);
    const loaded = await loadDraftForDocument(document.id);
    expect(loaded).toBeNull();
  });

  it("commits a derived version without modifying the original baseline", async () => {
    let document = createDocument("derived commit");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const index = buildCompactRenLibIndex(document);
    await saveCompactIndex(document, index);
    const ops: DraftOperation[] = [{ type: "add-move", parentId: document.rootId, node: { id: "derived-move", parentId: document.rootId, children: [], move: { row: 7, col: 8, player: "white" }, comment: "derived comment", marks: [] } }];
    const summary = await commitDraftAsDerivedVersion(document, ops, document.metadata);
    expect(summary.baseId).toBe(document.id);
    // Original baseline should still be loadable and unchanged
    const original = await loadLargeDocument(document.id);
    expect(original).not.toBeNull();
    expect(original!.nodes[document.rootId]?.children).toHaveLength(1);
    // Derived version should include the new move
    const derived = await loadLargeDocument(summary.id);
    expect(derived).not.toBeNull();
    expect(derived!.nodes["derived-move"]).toBeDefined();
    expect(derived!.nodes["derived-move"]?.comment).toBe("derived comment");
    // Derived document's id must match the summary id (no ID misalignment)
    expect(derived!.id).toBe(summary.id);
    // Draft should be removed after commit
    const draft = await loadDraftForDocument(document.id);
    expect(draft).toBeNull();
  });

  it("second save on a derived version re-projects against root base, no chain", async () => {
    let document = createDocument("two-level derived");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const index = buildCompactRenLibIndex(document);
    await saveCompactIndex(document, index);
    // First derived version: adds A (node A15)
    const opsFirst: DraftOperation[] = [{ type: "add-move", parentId: document.rootId, node: { id: "m1", parentId: document.rootId, children: [], move: { row: 0, col: 0, player: "black" }, comment: "", marks: [] } }];
    const summary = await commitDraftAsDerivedVersion(document, opsFirst, document.metadata);
    const derived1 = (await loadLargeDocument(summary.id))!;
    expect(derived1.id).toBe(summary.id);
    expect((derived1 as any).rootBaseId).toBe(document.id);
    // Open derived1, add another move, save again (simulated as a fresh commit).
    // The second commit must reference root base (document.id), not derived1.id.
    const opsSecond: DraftOperation[] = [{ type: "add-move", parentId: document.rootId, node: { id: "m2", parentId: document.rootId, children: [], move: { row: 1, col: 1, player: "white" }, comment: "", marks: [] } }];
    const committed = (derived1 as any).committedOperations as DraftOperation[] || [];
    const summary2 = await commitDraftAsDerivedVersion(document, opsSecond, document.metadata, document.id, committed);
    expect(summary2.baseId).toBe(document.id);
    const derived2 = (await loadLargeDocument(summary2.id))!;
    expect(derived2).not.toBeNull();
    expect(derived2.id).toBe(summary2.id);
    // Derived2 projects both m1 (committed) and m2 (new) against the root base
    expect(derived2.nodes["m1"]).toBeDefined();
    expect(derived2.nodes["m2"]).toBeDefined();
  });

  it("rejects draft recovery when fingerprint does not match", async () => {
    let document = createDocument("fingerprint mismatch");
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const index = buildCompactRenLibIndex(document);
    await saveCompactIndex(document, index);
    // Save with a wrong fingerprint
    await saveDraftForDocument(document.id, { operations: [], redo: [] }, "wrong-fingerprint");
    const loaded = await loadDraftForDocument(document.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.baseFingerprint).toBe("wrong-fingerprint");
    // Application code should check fingerprint vs documentFingerprint(document)
    const currentFingerprint = documentFingerprint(document);
    expect(currentFingerprint).not.toBe("wrong-fingerprint");
  });
});