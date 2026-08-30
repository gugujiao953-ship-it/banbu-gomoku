import { compactIndexOf, compactNodeCount, createLazyDocument, materializeDocument } from "./compact-index";
import type { BoardMark, CompactRenLibIndex, GameDocument, RecordNode } from "./types";
import { buildDraftOverlay, emptyOverlay, projectedDocument } from "./draft-operations";
import type { DraftOperation, DraftState } from "./draft-operations";

const DATABASE_NAME = "banbu-gomoku-large-library";
const DOCUMENT_STORE = "documents";
const SUMMARY_STORE = "summaries";
const CHUNK_STORE = "index-chunks";
const DRAFT_STORE = "drafts";
const DATABASE_VERSION = 8;
const INDEX_CHUNK_SIZE = 250000;
const TRASH_DOCUMENT_STORE = "trash-documents";
const TRASH_SUMMARY_STORE = "trash-summaries";
const TRASH_CHUNK_STORE = "trash-index-chunks";
const TRASH_DRAFT_STORE = "trash-drafts";

export interface LargeDocumentSummary {
  id: string;
  metadata: GameDocument["metadata"];
  updatedAt: string;
  mainLineLength: number;
  nodeCount: number;
  fingerprint: string;
  storageMode?: "document" | "compact-index";
  /** True only for the early usable prefix emitted while a large import continues. */
  preview?: boolean;
  /** For derived versions: the base document ID this was derived from. */
  baseId?: string;
}

export interface StoredDraft {
  documentId: string;
  operations: DraftOperation[];
  redo: DraftOperation[];
  baseFingerprint: string;
  updatedAt: string;
  metadata?: GameDocument["metadata"];
}

const hashText = (seed: number, value: string) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return hash;
};

/** Stable, allocation-light fingerprint that deliberately excludes generated node IDs. */
export const documentFingerprint = (document: GameDocument) => {
  const compact = compactIndexOf(document);
  if (compact) return `compact-${document.id}-${compact.nodeCount}`;
  let first = 2166136261, second = 2246822519;
  const stack: RecordNode[] = [document.nodes[document.rootId]];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const preferredIndex = node.preferredChildId ? node.children.indexOf(node.preferredChildId) : -1;
    const setup = node.setup ? `${node.setup.black.map((point) => `${point.row},${point.col}`).join(";")}/${node.setup.white.map((point) => `${point.row},${point.col}`).join(";")}/${node.setup.empty.map((point) => `${point.row},${point.col}`).join(";")}/${node.setup.nextPlayer || ""}` : "";
    const value = `${node.move?.player || "-"}:${node.move?.row ?? -1},${node.move?.col ?? -1}|pass:${node.passPlayer || "-"}|setup:${setup}|${node.comment}|${node.boardText || ""}|${node.evaluation || ""}:${node.evaluationLevel || 0}|${node.marks.map((mark) => `${mark.row},${mark.col},${mark.kind},${mark.label || ""}`).join(";")}|${node.children.length}:${preferredIndex}`;
    first = hashText(first, value); second = hashText(second, `${value.length}:${value}`);
    for (let index = node.children.length - 1; index >= 0; index -= 1) { const child = document.nodes[node.children[index]]; if (child) stack.push(child); }
  }
  first = hashText(first, JSON.stringify(document.metadata)); second = hashText(second, document.metadata.title);
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
};

export const summarizeLargeDocument = (document: GameDocument): LargeDocumentSummary => {
  let length = 0, cursor = document.nodes[document.rootId];
  while (cursor) {
    const nextId = cursor.preferredChildId && cursor.children.includes(cursor.preferredChildId) ? cursor.preferredChildId : cursor.children[0];
    if (!nextId) break;
    cursor = document.nodes[nextId]; if (cursor?.move || cursor?.passPlayer) length += 1;
  }
  return { id: document.id, metadata: document.metadata, updatedAt: document.updatedAt, mainLineLength: compactNodeCount(document) ? 0 : length, nodeCount: compactNodeCount(document) ?? 0, fingerprint: compactIndexOf(document) ? `compact-${document.id}-${compactNodeCount(document)}` : documentFingerprint(document) };
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(DOCUMENT_STORE)) database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
    if (!database.objectStoreNames.contains(SUMMARY_STORE)) database.createObjectStore(SUMMARY_STORE, { keyPath: "id" });
    if (!database.objectStoreNames.contains(CHUNK_STORE)) database.createObjectStore(CHUNK_STORE, { keyPath: "key" });
    if (!database.objectStoreNames.contains(DRAFT_STORE)) database.createObjectStore(DRAFT_STORE, { keyPath: "documentId" });
    if (!database.objectStoreNames.contains(TRASH_DOCUMENT_STORE)) database.createObjectStore(TRASH_DOCUMENT_STORE, { keyPath: "id" });
    if (!database.objectStoreNames.contains(TRASH_SUMMARY_STORE)) database.createObjectStore(TRASH_SUMMARY_STORE, { keyPath: "id" });
    if (!database.objectStoreNames.contains(TRASH_CHUNK_STORE)) database.createObjectStore(TRASH_CHUNK_STORE, { keyPath: "key" });
    if (!database.objectStoreNames.contains(TRASH_DRAFT_STORE)) database.createObjectStore(TRASH_DRAFT_STORE, { keyPath: "documentId" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("无法打开大型棋谱存储"));
});

const baseFromStored = (stored: any) => ({ id: stored.id, version: stored.version, rootId: stored.rootId, metadata: stored.metadata, createdAt: stored.createdAt, updatedAt: stored.updatedAt });
export const assembleCompactIndex = (stored: any, chunks: Array<{ field: string; offset: number; value: unknown }>): CompactRenLibIndex | null => {
  chunks.sort((a, b) => a.field.localeCompare(b.field) || a.offset - b.offset);
  const typedFields = new Map<string, Array<{ offset: number; value: unknown }>>();
  const textFields = new Map<string, string[]>();
  const objectFields = new Map<string, unknown[]>();
  for (const chunk of chunks) {
    if (chunk.field === "ids" || chunk.field === "texts") { const list = textFields.get(chunk.field) || []; const values = chunk.value as string[]; for (const value of values) list.push(value); textFields.set(chunk.field, list); }
    else if (chunk.field === "marks" || chunk.field === "setups" || chunk.field === "annotations") { const list = objectFields.get(chunk.field) || []; list.push(...(chunk.value as unknown[])); objectFields.set(chunk.field, list); }
    else { const list = typedFields.get(chunk.field) || []; list.push(chunk); typedFields.set(chunk.field, list); }
  }
  const nums = (field: string, Type: any) => {
    const list = typedFields.get(field) || []; const total = list.reduce((sum, chunk) => sum + ((chunk.value as ArrayBuffer).byteLength / Type.BYTES_PER_ELEMENT), 0); const result = new Type(total);
    let offset = 0; for (const chunk of list.sort((a, b) => a.offset - b.offset)) { const part = new Type(chunk.value as ArrayBuffer); result.set(part, offset); offset += part.length; } return result;
  };
  if (!typedFields.has("parent")) return null;
  return { version: 2, nodeCount: stored.nodeCount, rootId: stored.rootId, idPrefix: stored.idPrefix, ids: textFields.get("ids") || [], parent: nums("parent", Int32Array), firstChild: nums("firstChild", Int32Array), nextSibling: nums("nextSibling", Int32Array), childCount: nums("childCount", Int32Array), preferredChild: nums("preferredChild", Int32Array), moveCode: nums("moveCode", Uint16Array), anchorCode: nums("anchorCode", Uint16Array), state: nums("state", Uint8Array), evaluation: nums("evaluation", Int8Array), evaluationLevel: nums("evaluationLevel", Uint8Array), markRefs: nums("markRefs", Int32Array), textRefs: nums("textRefs", Int32Array), setupRefs: nums("setupRefs", Int32Array), setups: (objectFields.get("setups") || []) as NonNullable<CompactRenLibIndex["setups"]>, marks: (objectFields.get("marks") || []) as BoardMark[], texts: textFields.get("texts") || [], annotationRefs: nums("annotationRefs", Int32Array), annotations: (objectFields.get("annotations") || []) as NonNullable<CompactRenLibIndex["annotations"]>, renLibFlags: nums("renLibFlags", Uint8Array), renLibExtendedFlags: nums("renLibExtendedFlags", Uint32Array) };
};

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error("大型棋谱存储失败"));
  transaction.onabort = () => reject(transaction.error || new Error("大型棋谱存储已中止"));
});

/** Raw, structured-clone-safe records used by the application backup layer.
 * The backup module serializes ArrayBuffers/typed arrays before writing JSON;
 * keeping this boundary here means it does not need to duplicate the schema of
 * the large-library database or its chunk layout.
 */
export interface LargeStorageRecords {
  documents: unknown[];
  summaries: unknown[];
  drafts: unknown[];
  indexChunks: unknown[];
  trashDocuments?: unknown[];
  trashSummaries?: unknown[];
  trashDrafts?: unknown[];
  trashIndexChunks?: unknown[];
}

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("读取大型棋谱备份数据失败"));
});

export const exportLargeStorageRecords = async (): Promise<LargeStorageRecords> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE, DRAFT_STORE, CHUNK_STORE, TRASH_DOCUMENT_STORE, TRASH_SUMMARY_STORE, TRASH_DRAFT_STORE, TRASH_CHUNK_STORE], "readonly");
    const documentRequest = requestResult(transaction.objectStore(DOCUMENT_STORE).getAll());
    const summaryRequest = requestResult(transaction.objectStore(SUMMARY_STORE).getAll());
    const draftRequest = requestResult(transaction.objectStore(DRAFT_STORE).getAll());
    const chunkRequest = requestResult(transaction.objectStore(CHUNK_STORE).getAll());
    const trashDocumentRequest = requestResult(transaction.objectStore(TRASH_DOCUMENT_STORE).getAll());
    const trashSummaryRequest = requestResult(transaction.objectStore(TRASH_SUMMARY_STORE).getAll());
    const trashDraftRequest = requestResult(transaction.objectStore(TRASH_DRAFT_STORE).getAll());
    const trashChunkRequest = requestResult(transaction.objectStore(TRASH_CHUNK_STORE).getAll());
    const [documents, summaries, drafts, indexChunks, trashDocuments, trashSummaries, trashDrafts, trashIndexChunks] = await Promise.all([documentRequest, summaryRequest, draftRequest, chunkRequest, trashDocumentRequest, trashSummaryRequest, trashDraftRequest, trashChunkRequest]);
    await transactionDone(transaction);
    return { documents, summaries, drafts, indexChunks, trashDocuments, trashSummaries, trashDrafts, trashIndexChunks };
  } finally {
    database.close();
  }
};

/** Replace every large-library store in one IndexedDB transaction. If any put
 * fails the browser aborts the transaction, leaving the previous database
 * contents intact. Callers should validate records before reaching this API.
 */
export const replaceLargeStorageRecords = async (records: LargeStorageRecords): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE, DRAFT_STORE, CHUNK_STORE, TRASH_DOCUMENT_STORE, TRASH_SUMMARY_STORE, TRASH_DRAFT_STORE, TRASH_CHUNK_STORE], "readwrite");
    const stores = {
      documents: transaction.objectStore(DOCUMENT_STORE),
      summaries: transaction.objectStore(SUMMARY_STORE),
      drafts: transaction.objectStore(DRAFT_STORE),
      indexChunks: transaction.objectStore(CHUNK_STORE),
      trashDocuments: transaction.objectStore(TRASH_DOCUMENT_STORE),
      trashSummaries: transaction.objectStore(TRASH_SUMMARY_STORE),
      trashDrafts: transaction.objectStore(TRASH_DRAFT_STORE),
      trashIndexChunks: transaction.objectStore(TRASH_CHUNK_STORE),
    };
    for (const store of Object.values(stores)) store.clear();
    for (const record of records.documents) stores.documents.put(record);
    for (const record of records.summaries) stores.summaries.put(record);
    for (const record of records.drafts) stores.drafts.put(record);
    for (const record of records.indexChunks) stores.indexChunks.put(record);
    for (const record of records.trashDocuments || []) stores.trashDocuments.put(record);
    for (const record of records.trashSummaries || []) stores.trashSummaries.put(record);
    for (const record of records.trashDrafts || []) stores.trashDrafts.put(record);
    for (const record of records.trashIndexChunks || []) stores.trashIndexChunks.put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};

const yieldToBrowser = () => new Promise<void>((resolve) => {
  const taskScheduler = (globalThis as typeof globalThis & { scheduler?: { postTask?: (callback: () => void, options?: { priority?: string }) => Promise<void> } }).scheduler;
  if (taskScheduler?.postTask) { void taskScheduler.postTask(resolve, { priority: "background" }); return; }
  setTimeout(resolve, 0);
});

const deleteDocumentChunks = async (database: IDBDatabase, id: string) => {
  const transaction = database.transaction(CHUNK_STORE, "readwrite");
  const request = transaction.objectStore(CHUNK_STORE).openCursor(IDBKeyRange.bound(`${id}:`, `${id}:~`));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete(); cursor.continue();
  };
  await transactionDone(transaction);
};

const writeChunk = async (database: IDBDatabase, value: unknown) => {
  const transaction = database.transaction(CHUNK_STORE, "readwrite");
  transaction.objectStore(CHUNK_STORE).put(value);
  await transactionDone(transaction);
  await yieldToBrowser();
};

export const loadLargeSummaries = async (): Promise<LargeDocumentSummary[]> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUMMARY_STORE, "readonly");
    const request = transaction.objectStore(SUMMARY_STORE).getAll();
    const summaries = await new Promise<LargeDocumentSummary[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as LargeDocumentSummary[]);
      request.onerror = () => reject(request.error || new Error("读取大型棋谱索引失败"));
    });
    await transactionDone(transaction); return summaries;
  } finally { database.close(); }
};

export const loadLargeTrashSummaries = async (): Promise<LargeDocumentSummary[]> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(TRASH_SUMMARY_STORE, "readonly");
    const request = transaction.objectStore(TRASH_SUMMARY_STORE).getAll();
    const summaries = await new Promise<LargeDocumentSummary[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as LargeDocumentSummary[]);
      request.onerror = () => reject(request.error || new Error("读取回收站棋谱索引失败"));
    });
    await transactionDone(transaction);
    return summaries;
  } finally { database.close(); }
};

export const loadLargeDocument = async (id: string): Promise<GameDocument | null> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, CHUNK_STORE, DRAFT_STORE], "readonly");
    const request = transaction.objectStore(DOCUMENT_STORE).get(id);
    const document = await new Promise<GameDocument | null>((resolve, reject) => {
      request.onsuccess = () => {
        const stored = (request.result as (GameDocument & { compactIndex?: CompactRenLibIndex; chunkedIndex?: boolean; nodeCount?: number; baseId?: string; rootBaseId?: string; operations?: DraftOperation[]; currentId?: string }) | undefined) || null;
        if (!stored) { resolve(null); return; }
        // Derived version: load base + project draft overlay
        if (stored.baseId) {
          // Resolve rootBaseId to the original compact baseline
          const rootBaseId = stored.rootBaseId || stored.baseId;
          const baseRequest = transaction.objectStore(DOCUMENT_STORE).get(rootBaseId);
          baseRequest.onsuccess = () => {
            const baseStored = (baseRequest.result as (GameDocument & { compactIndex?: CompactRenLibIndex; chunkedIndex?: boolean; nodeCount?: number }) | undefined) || null;
            if (!baseStored) { resolve(null); return; }
            const loadBase = (baseDoc: GameDocument | null) => {
              if (!baseDoc) { resolve(null); return; }
              const ops = (stored as any).operations as DraftOperation[] | undefined;
              const overlay = ops ? buildDraftOverlay({ operations: ops, redo: [] }, baseDoc) : emptyOverlay();
              const projected = projectedDocument(baseDoc, overlay);
              // Fix the projected document's id to match the derived version's id
              Object.defineProperty(projected, "id", { value: stored.id, writable: false, configurable: false });
              Object.defineProperty(projected, "metadata", { value: stored.metadata, writable: true, configurable: true });
              Object.defineProperty(projected, "updatedAt", { value: stored.updatedAt, writable: true, configurable: true });
              // Attach committed context so a second save re-commits against the
              // root compact base with the accumulated operations (no chain).
              Object.defineProperty(projected, "rootBaseId", { value: rootBaseId, writable: false, configurable: false });
              Object.defineProperty(projected, "committedOperations", { value: ops || [], writable: false, configurable: false });
              Object.defineProperty(projected, "savedCurrentId", { value: stored.currentId, writable: false, configurable: false });
              resolve(projected);
            };
            if (baseStored.chunkedIndex) {
              const keyRange = IDBKeyRange.bound(`${rootBaseId}:`, `${rootBaseId}:~`);
              const chunkRequest = transaction.objectStore(CHUNK_STORE).getAll(keyRange);
              chunkRequest.onsuccess = () => {
                const chunks = (chunkRequest.result as Array<{ id: string; field: string; offset: number; value: unknown[] }>).filter((chunk) => chunk.id === rootBaseId);
                const compactIndex = assembleCompactIndex(baseStored, chunks);
                loadBase(compactIndex ? createLazyDocument(baseFromStored(baseStored), compactIndex) : null);
              };
              chunkRequest.onerror = () => reject(chunkRequest.error || new Error("读取派生版本基线失败"));
            } else if (baseStored.compactIndex) {
              loadBase(createLazyDocument(baseFromStored(baseStored), baseStored.compactIndex));
            } else { resolve(null); }
          };
          baseRequest.onerror = () => reject(baseRequest.error || new Error("读取派生版本基线失败"));
          return;
        }
        if (stored.compactIndex) {
          const { compactIndex, nodes: _nodes, ...base } = stored;
          resolve(createLazyDocument(base, compactIndex));
          return;
        }
        if (stored.chunkedIndex) {
          const keyRange = IDBKeyRange.bound(`${id}:`, `${id}:~`);
          const chunkRequest = transaction.objectStore(CHUNK_STORE).getAll(keyRange);
          chunkRequest.onsuccess = () => {
            const chunks = (chunkRequest.result as Array<{ id: string; field: string; offset: number; value: unknown[] }>).filter((chunk) => chunk.id === id);
            const compactIndex = assembleCompactIndex(stored, chunks);
            resolve(compactIndex ? createLazyDocument(baseFromStored(stored), compactIndex) : null);
          };
          chunkRequest.onerror = () => reject(chunkRequest.error || new Error("读取大型棋谱分块失败"));
          return;
        }
        resolve(stored);
      };
      request.onerror = () => reject(request.error || new Error("读取大型棋谱失败"));
    });
    await transactionDone(transaction); return document;
  } finally { database.close(); }
};

export const saveLargeDocument = async (document: GameDocument, prepared?: LargeDocumentSummary): Promise<LargeDocumentSummary> => {
  const retainedIndex = compactIndexOf(document);
  if (retainedIndex) return saveCompactIndex(document, retainedIndex, prepared);
  const summary = { ...(prepared || summarizeLargeDocument(document)), id: document.id, metadata: document.metadata, updatedAt: document.updatedAt, storageMode: "document" as const };
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).put(materializeDocument(document));
    transaction.objectStore(SUMMARY_STORE).put(summary);
    await transactionDone(transaction); return summary;
  } finally { database.close(); }
};

/** Rename a large record without rewriting its potentially multi-million-node
 * compact index or derived-operation payload. */
export const renameLargeDocument = async (id: string, title: string): Promise<LargeDocumentSummary> => {
  const normalized = title.trim();
  if (!normalized) throw new Error("棋谱名称不能为空");
  const database = await openDatabase();
  const updatedAt = new Date().toISOString();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE], "readwrite");
    const documentStore = transaction.objectStore(DOCUMENT_STORE);
    const summaryStore = transaction.objectStore(SUMMARY_STORE);
    const documentRequest = documentStore.get(id);
    const summaryRequest = summaryStore.get(id);
    const renamed = await new Promise<LargeDocumentSummary>((resolve, reject) => {
      let storedDocument: any, storedSummary: LargeDocumentSummary | undefined;
      const apply = () => {
        if (documentRequest.readyState !== "done" || summaryRequest.readyState !== "done") return;
        storedDocument = documentRequest.result;
        storedSummary = summaryRequest.result as LargeDocumentSummary | undefined;
        if (!storedDocument || !storedSummary) { reject(new Error("大型棋谱不存在")); return; }
        const metadata = { ...storedSummary.metadata, title: normalized };
        const nextSummary = { ...storedSummary, metadata, updatedAt };
        documentStore.put({ ...storedDocument, metadata: { ...storedDocument.metadata, title: normalized }, updatedAt });
        summaryStore.put(nextSummary);
        resolve(nextSummary);
      };
      documentRequest.onsuccess = apply; summaryRequest.onsuccess = apply;
      documentRequest.onerror = () => reject(documentRequest.error || new Error("大型棋谱读取失败"));
      summaryRequest.onerror = () => reject(summaryRequest.error || new Error("大型棋谱索引读取失败"));
    });
    await transactionDone(transaction);
    return renamed;
  } finally { database.close(); }
};

export async function saveCompactIndex(document: GameDocument, index: CompactRenLibIndex, prepared?: LargeDocumentSummary): Promise<LargeDocumentSummary> {
  const summary = { ...(prepared || summarizeLargeDocument(document)), id: document.id, metadata: document.metadata, updatedAt: document.updatedAt, nodeCount: index.nodeCount, storageMode: "compact-index" as const };
  const database = await openDatabase();
  try {
    if (index.nodeCount > 1000000) {
      await deleteDocumentChunks(database, document.id);
      const fields: Record<string, any> = { parent: index.parent, firstChild: index.firstChild, nextSibling: index.nextSibling, childCount: index.childCount, preferredChild: index.preferredChild, moveCode: index.moveCode, anchorCode: index.anchorCode, state: index.state, evaluation: index.evaluation, evaluationLevel: index.evaluationLevel, markRefs: index.markRefs, textRefs: index.textRefs, setupRefs: index.setupRefs, annotationRefs: index.annotationRefs, renLibFlags: index.renLibFlags, renLibExtendedFlags: index.renLibExtendedFlags, ids: index.ids, texts: index.texts, marks: index.marks, setups: index.setups, annotations: index.annotations };
      for (const [field, value] of Object.entries(fields)) {
        if (!value) continue;
        for (let offset = 0; offset < value.length; offset += INDEX_CHUNK_SIZE) {
          const part = Array.isArray(value) ? value.slice(offset, offset + INDEX_CHUNK_SIZE) : value.slice(offset, offset + INDEX_CHUNK_SIZE).buffer;
          await writeChunk(database, { key: `${document.id}:${field}:${offset}`, id: document.id, field, offset, value: part });
        }
      }
      const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE], "readwrite");
      transaction.objectStore(DOCUMENT_STORE).put({ id: document.id, version: document.version, rootId: document.rootId, metadata: document.metadata, createdAt: document.createdAt, updatedAt: document.updatedAt, chunkedIndex: true, nodeCount: index.nodeCount, idPrefix: index.idPrefix });
      transaction.objectStore(SUMMARY_STORE).put(summary);
      await transactionDone(transaction);
    } else {
      const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE], "readwrite");
      transaction.objectStore(DOCUMENT_STORE).put({ id: document.id, version: document.version, rootId: document.rootId, metadata: document.metadata, createdAt: document.createdAt, updatedAt: document.updatedAt, compactIndex: index });
      transaction.objectStore(SUMMARY_STORE).put(summary);
      await transactionDone(transaction);
    }
    return summary;
  } finally { database.close(); }
}

export const removeLargeDocument = async (id: string): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE, CHUNK_STORE, DRAFT_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete(id);
    transaction.objectStore(SUMMARY_STORE).delete(id);
    transaction.objectStore(DRAFT_STORE).delete(id);
    const chunkRequest = transaction.objectStore(CHUNK_STORE).openCursor();
    chunkRequest.onsuccess = () => {
      const cursor = chunkRequest.result;
      if (cursor) { if (cursor.value.id === id) cursor.delete(); cursor.continue(); }
    };
    await transactionDone(transaction);
  } finally { database.close(); }
};

const transferLargeRecord = async (id: string, restore: boolean): Promise<LargeDocumentSummary | null> => {
  const database = await openDatabase();
  const fromDocuments = restore ? TRASH_DOCUMENT_STORE : DOCUMENT_STORE;
  const toDocuments = restore ? DOCUMENT_STORE : TRASH_DOCUMENT_STORE;
  const fromSummaries = restore ? TRASH_SUMMARY_STORE : SUMMARY_STORE;
  const toSummaries = restore ? SUMMARY_STORE : TRASH_SUMMARY_STORE;
  const fromChunks = restore ? TRASH_CHUNK_STORE : CHUNK_STORE;
  const toChunks = restore ? CHUNK_STORE : TRASH_CHUNK_STORE;
  const fromDrafts = restore ? TRASH_DRAFT_STORE : DRAFT_STORE;
  const toDrafts = restore ? DRAFT_STORE : TRASH_DRAFT_STORE;
  try {
    const transaction = database.transaction([fromDocuments, toDocuments, fromSummaries, toSummaries, fromChunks, toChunks, fromDrafts, toDrafts], "readwrite");
    const documentStore = transaction.objectStore(fromDocuments);
    const summaryStore = transaction.objectStore(fromSummaries);
    const draftStore = transaction.objectStore(fromDrafts);
    const storedDocumentRequest = documentStore.get(id);
    const storedSummaryRequest = summaryStore.get(id);
    const storedDraftRequest = draftStore.get(id);
    const result = await new Promise<LargeDocumentSummary | null>((resolve, reject) => {
      let storedDocument: any = null;
      let storedSummary: LargeDocumentSummary | null = null;
      let storedDraft: any = null;
      let documentsReady = false;
      let summaryReady = false;
      let draftReady = false;
      let chunksReady = false;
      let settled = false;
      const fail = (error: unknown) => { if (!settled) { settled = true; reject(error instanceof Error ? error : new Error("回收站棋谱操作失败")); } };
      const commit = () => {
        if (settled || !documentsReady || !summaryReady || !draftReady || !chunksReady) return;
        settled = true;
        if (!storedDocument || !storedSummary) { resolve(null); return; }
        transaction.objectStore(toDocuments).put(storedDocument);
        transaction.objectStore(toSummaries).put(storedSummary);
        if (storedDraft) transaction.objectStore(toDrafts).put(storedDraft);
        documentStore.delete(id);
        summaryStore.delete(id);
        draftStore.delete(id);
        resolve(storedSummary);
      };
      storedDocumentRequest.onsuccess = () => { storedDocument = storedDocumentRequest.result || null; documentsReady = true; commit(); };
      storedSummaryRequest.onsuccess = () => { storedSummary = (storedSummaryRequest.result as LargeDocumentSummary | undefined) || null; summaryReady = true; commit(); };
      storedDraftRequest.onsuccess = () => { storedDraft = storedDraftRequest.result || null; draftReady = true; commit(); };
      storedDocumentRequest.onerror = () => fail(storedDocumentRequest.error);
      storedSummaryRequest.onerror = () => fail(storedSummaryRequest.error);
      storedDraftRequest.onerror = () => fail(storedDraftRequest.error);
      const cursorRequest = transaction.objectStore(fromChunks).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) { chunksReady = true; commit(); return; }
        if (cursor.value.id === id) {
          transaction.objectStore(toChunks).put(cursor.value);
          cursor.delete();
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => fail(cursorRequest.error);
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error || new Error("回收站棋谱操作已中止"));
    });
    await transactionDone(transaction);
    return result;
  } finally { database.close(); }
};

/** Move a large record into IndexedDB's recycle-bin stores without materializing its tree. */
export const moveLargeDocumentToTrash = (id: string) => transferLargeRecord(id, false);

/** Restore a large record from IndexedDB's recycle-bin stores. */
export const restoreLargeDocumentFromTrash = (id: string) => transferLargeRecord(id, true);

export const removeLargeTrashDocument = async (id: string): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([TRASH_DOCUMENT_STORE, TRASH_SUMMARY_STORE, TRASH_CHUNK_STORE, TRASH_DRAFT_STORE], "readwrite");
    transaction.objectStore(TRASH_DOCUMENT_STORE).delete(id);
    transaction.objectStore(TRASH_SUMMARY_STORE).delete(id);
    transaction.objectStore(TRASH_DRAFT_STORE).delete(id);
    const cursorRequest = transaction.objectStore(TRASH_CHUNK_STORE).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) { if (cursor.value.id === id) cursor.delete(); cursor.continue(); }
    };
    await transactionDone(transaction);
  } finally { database.close(); }
};

/** Persist a draft for a compact document. Does not modify the base document. */
export const saveDraftForDocument = async (documentId: string, draft: DraftState, baseFingerprint: string, metadata?: GameDocument["metadata"]): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).put({
      documentId,
      operations: draft.operations,
      redo: draft.redo,
      baseFingerprint,
      metadata,
      updatedAt: new Date().toISOString(),
    } as StoredDraft);
    await transactionDone(transaction);
  } finally { database.close(); }
};

/** Load a persisted draft for a compact document. Returns null if none exists. */
export const loadDraftForDocument = async (documentId: string): Promise<StoredDraft | null> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, "readonly");
    const request = transaction.objectStore(DRAFT_STORE).get(documentId);
    const stored = await new Promise<StoredDraft | null>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as StoredDraft) || null);
      request.onerror = () => reject(request.error || new Error("读取草稿失败"));
    });
    await transactionDone(transaction);
    return stored;
  } finally { database.close(); }
};

/** Remove a persisted draft for a document. */
export const removeDraftForDocument = async (documentId: string): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).delete(documentId);
    await transactionDone(transaction);
  } finally { database.close(); }
};

/**
 * Commit a draft as a derived version of a compact document. Creates a new
 * document record with a fresh ID that references the original compact base.
 * The original compact document is never modified.
 * Always references the rootBaseId (the original compact baseline), never
 * chains to another derived version.
 */
export const commitDraftAsDerivedVersion = async (
  baseDocument: GameDocument,
  operations: DraftOperation[],
  metadata: GameDocument["metadata"],
  rootBaseId?: string,
  committedOperations: DraftOperation[] = [],
  currentId?: string,
): Promise<LargeDocumentSummary> => {
  const effectiveRootBaseId = rootBaseId || baseDocument.id;
  const derivedId = `${effectiveRootBaseId}-edited-${Date.now().toString(36)}`;
  // Merge previously committed operations with the new batch so the stored
  // record always projects against the root compact base, never a chain.
  const fullOperations = [...committedOperations, ...operations];
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE, DRAFT_STORE], "readwrite");
    // Store the derived version record: rootBaseId + full operations + metadata
    transaction.objectStore(DOCUMENT_STORE).put({
      id: derivedId,
      version: baseDocument.version,
      rootId: baseDocument.rootId,
      baseId: effectiveRootBaseId,
      rootBaseId: effectiveRootBaseId,
      baseIdDirect: baseDocument.id,
      metadata,
      operations: fullOperations,
      createdAt: baseDocument.createdAt,
      updatedAt: new Date().toISOString(),
      currentId,
    });
    const addedCount = fullOperations.filter((op) => op.type === "add-move").length;
    const summary: LargeDocumentSummary = {
      id: derivedId,
      metadata,
      updatedAt: new Date().toISOString(),
      mainLineLength: 0,
      nodeCount: (compactNodeCount(baseDocument) ?? 0) + addedCount,
      fingerprint: `derived-${effectiveRootBaseId}-${Date.now().toString(36)}`,
      storageMode: "compact-index",
      baseId: effectiveRootBaseId,
    };
    transaction.objectStore(SUMMARY_STORE).put(summary);
    // Remove the draft since it's now committed
    transaction.objectStore(DRAFT_STORE).delete(baseDocument.id);
    await transactionDone(transaction);
    return summary;
  } finally { database.close(); }
};

/** Check if a document record has a draft in IndexedDB. */
export const documentHasDraft = async (id: string): Promise<boolean> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, "readonly");
    const request = transaction.objectStore(DRAFT_STORE).get(id);
    const stored = await new Promise<StoredDraft | null>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as StoredDraft) || null);
      request.onerror = () => reject(request.error || new Error("读取草稿失败"));
    });
    await transactionDone(transaction);
    return stored !== null;
  } finally { database.close(); }
};
