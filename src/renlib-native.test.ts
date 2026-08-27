import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "./game";
import { buildCompactRenLibIndex, compactNodeId, createLazyDocument, RenLibArrayBuilder } from "./compact-index";
import { openLibraryHandle } from "./library-engine";
import { isPagedLibraryView, LibraryViewSession } from "./library-view-adapter";
import { saveCompactIndex, removeLargeDocument, type LargeDocumentSummary } from "./large-storage";

describe("RenLib native annotations", () => {
  it("grows parser columns across typed pages without allocating per-node IDs", () => {
    const base = createDocument("paged parser columns");
    const builder = new RenLibArrayBuilder(base.rootId);
    let parent = 0;
    for (let index = 1; index <= 65537; index += 1) {
      const child = builder.addNode(parent, (index % 225) + 1, 1 | (index % 2 ? 0 : 2));
      builder.appendChild(parent, child); parent = child;
    }
    const compact = builder.toIndex(base.rootId, "generated");
    expect(compact.nodeCount).toBe(65538);
    expect(compact.ids).toEqual([base.rootId]);
    expect(compact.parent[65537]).toBe(65536);
    expect(compactNodeId(compact, 65537)).toBe(`generated-${(65537).toString(36)}`);
  });

  it("keeps annotation kinds and raw flags through compact lazy loading", () => {
    let document = createDocument("native annotations");
    const created = addMove(document, document.rootId, { row: 7, col: 7 });
    document = created.document;
    const node = document.nodes[created.nodeId];
    node.comment = "普通注释";
    node.boardText = "a";
    node.renLibAnnotations = [
      { kind: "one-line-comment", text: "普通注释", encoding: "RenLib-old" },
      { kind: "board-text", text: "a", encoding: "GB18030" },
      { kind: "unknown", text: "扩展字段", rawBytes: new Uint8Array([0x01, 0x02]) },
    ];
    node.renLibFlags = 0x48;
    node.renLibExtendedFlags = 0x100;

    const index = buildCompactRenLibIndex(document);
    const { nodes: _nodes, ...base } = document;
    const lazy = createLazyDocument(base, index);
    const restored = lazy.nodes[created.nodeId];

    expect(restored.renLibAnnotations?.map((item) => item.kind)).toEqual(["one-line-comment", "board-text", "unknown"]);
    expect(restored.renLibAnnotations?.[2].rawBytes).toEqual(new Uint8Array([0x01, 0x02]));
    expect(restored.renLibFlags).toBe(0x48);
    expect(restored.renLibExtendedFlags).toBe(0x100);
  });

  it("reads an inline compact library through the async handle API", async () => {
    let document = createDocument(`library handle ${Date.now()}`);
    const first = addMove(document, document.rootId, { row: 7, col: 7 });
    document = first.document;
    document.nodes[first.nodeId].comment = "按需读取";
    document.nodes[first.nodeId].marks = [{ row: 6, col: 6, kind: "label", label: "A", style: "text" }];
    document.nodes[first.nodeId].renLibAnnotations = [{ kind: "multi-line-comment", text: "按需读取" }];
    await saveCompactIndex(document, buildCompactRenLibIndex(document));
    const handle = await openLibraryHandle(document.id);
    expect(handle).not.toBeNull();
    const node = await handle!.getNode(1);
    expect(node?.comment).toBe("按需读取");
    expect(node?.marks).toEqual([{ row: 6, col: 6, kind: "label", label: "A", style: "text" }]);
    expect((await handle!.getPath(1)).map((item) => item.index)).toEqual([0, 1]);
    expect((await handle!.getChildren(0)).map((item) => item.index)).toEqual([1]);
    handle!.close();
    await removeLargeDocument(document.id);
  });

  it("projects only the current path and visible variations for the existing UI", async () => {
    let document = createDocument(`paged view ${Date.now()}`);
    const first = addMove(document, document.rootId, { row: 7, col: 7 }); document = first.document;
    const continuation = addMove(document, first.nodeId, { row: 7, col: 8 }); document = continuation.document;
    const variation = addMove(document, document.rootId, { row: 6, col: 7 }); document = variation.document;
    document.nodes[document.rootId].preferredChildId = first.nodeId;
    document.nodes[variation.nodeId].comment = "原谱变化注释";
    document.nodes[variation.nodeId].marks = [{ row: 6, col: 6, kind: "label", label: "候选", style: "text" }];
    document.nodes[variation.nodeId].renLibAnnotations = [{ kind: "one-line-comment", text: "原谱变化注释" }];
    const summary = await saveCompactIndex(document, buildCompactRenLibIndex(document));
    const handle = await openLibraryHandle(document.id);
    expect(handle).not.toBeNull();
    const rootChildren = await handle!.getChildren(0);
    const variationIndex = rootChildren.find((node) => node.id === variation.nodeId)!.index;
    const session = new LibraryViewSession(handle!, summary as LargeDocumentSummary);

    const opened = await session.open(variationIndex);
    expect(isPagedLibraryView(opened.document)).toBe(true);
    expect(opened.document.nodes[opened.document.rootId].children).toHaveLength(2);
    expect(opened.document.nodes[variation.nodeId].parentId).toBe(opened.document.rootId);
    expect(opened.document.nodes[variation.nodeId].renLibAnnotations?.[0].text).toBe("原谱变化注释");
    expect(opened.document.nodes[variation.nodeId].marks).toEqual([{ row: 6, col: 6, kind: "label", label: "候选", style: "text" }]);

    const endIndex = await session.preferredEndIndex(opened.document.rootId);
    expect(endIndex).not.toBeNull();
    const end = await session.open(endIndex!);
    expect(end.currentId).toBe(continuation.nodeId);
    expect(Object.keys(end.document.nodes).length).toBeLessThanOrEqual(4);
    session.close();
    await removeLargeDocument(document.id);
  });

  it("reads node and annotation pairs across a chunk boundary", async () => {
    const id = `chunk-boundary-${Date.now()}`, nodeIndex = 250000, pairOffset = nodeIndex * 2;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("banbu-gomoku-large-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["documents", "index-chunks"], "readwrite");
    transaction.objectStore("documents").put({ id, rootId: "root", nodeCount: nodeIndex + 1, chunkedIndex: true });
    const chunks = transaction.objectStore("index-chunks");
    const put = (field: string, offset: number, value: unknown) => chunks.put({ key: `${id}:${field}:${offset}`, id, field, offset, value });
    put("ids", nodeIndex, ["boundary-node"]);
    put("parent", nodeIndex, Int32Array.from([-1]).buffer);
    put("textRefs", pairOffset, Int32Array.from([0, -1]).buffer);
    put("texts", 0, ["跨页注释"]);
    put("annotationRefs", pairOffset, Int32Array.from([0, 1]).buffer);
    put("annotations", 0, [{ kind: "multi-line-comment", text: "跨页注释" }]);
    put("renLibFlags", nodeIndex, Uint8Array.from([0x48]).buffer);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    const handle = await openLibraryHandle(id);
    const node = await handle!.getNode(nodeIndex);
    expect(node?.id).toBe("boundary-node");
    expect(node?.comment).toBe("跨页注释");
    expect(node?.annotations[0].kind).toBe("multi-line-comment");
    expect(node?.renLibFlags).toBe(0x48);
    handle!.close();
    await removeLargeDocument(id);
  });
});
