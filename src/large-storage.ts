import type { GameDocument, RecordNode } from "./types";

const DATABASE_NAME = "banbu-gomoku-large-library";
const DOCUMENT_STORE = "documents";
const SUMMARY_STORE = "summaries";
const DATABASE_VERSION = 2;

export interface LargeDocumentSummary {
  id: string;
  metadata: GameDocument["metadata"];
  updatedAt: string;
  mainLineLength: number;
  nodeCount: number;
  fingerprint: string;
}

const hashText = (seed: number, value: string) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return hash;
};

/** Stable, allocation-light fingerprint that deliberately excludes generated node IDs. */
export const documentFingerprint = (document: GameDocument) => {
  let first = 2166136261, second = 2246822519;
  const stack: RecordNode[] = [document.nodes[document.rootId]];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const preferredIndex = node.preferredChildId ? node.children.indexOf(node.preferredChildId) : -1;
    const value = `${node.move?.player || "-"}:${node.move?.row ?? -1},${node.move?.col ?? -1}|${node.comment}|${node.boardText || ""}|${node.evaluation || ""}:${node.evaluationLevel || 0}|${node.marks.map((mark) => `${mark.row},${mark.col},${mark.kind},${mark.label || ""}`).join(";")}|${node.children.length}:${preferredIndex}`;
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
    cursor = document.nodes[nextId]; length += 1;
  }
  return { id: document.id, metadata: document.metadata, updatedAt: document.updatedAt, mainLineLength: length, nodeCount: Object.keys(document.nodes).length, fingerprint: documentFingerprint(document) };
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(DOCUMENT_STORE)) database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
    if (!database.objectStoreNames.contains(SUMMARY_STORE)) database.createObjectStore(SUMMARY_STORE, { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("无法打开大型棋谱存储"));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error("大型棋谱存储失败"));
  transaction.onabort = () => reject(transaction.error || new Error("大型棋谱存储已中止"));
});

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

export const loadLargeDocument = async (id: string): Promise<GameDocument | null> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DOCUMENT_STORE, "readonly");
    const request = transaction.objectStore(DOCUMENT_STORE).get(id);
    const document = await new Promise<GameDocument | null>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as GameDocument | undefined) || null);
      request.onerror = () => reject(request.error || new Error("读取大型棋谱失败"));
    });
    await transactionDone(transaction); return document;
  } finally { database.close(); }
};

export const saveLargeDocument = async (document: GameDocument, prepared?: LargeDocumentSummary): Promise<LargeDocumentSummary> => {
  const summary = prepared ? { ...prepared, id: document.id, metadata: document.metadata, updatedAt: document.updatedAt } : summarizeLargeDocument(document);
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).put(document); transaction.objectStore(SUMMARY_STORE).put(summary);
    await transactionDone(transaction); return summary;
  } finally { database.close(); }
};

export const removeLargeDocument = async (id: string): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SUMMARY_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete(id); transaction.objectStore(SUMMARY_STORE).delete(id);
    await transactionDone(transaction);
  } finally { database.close(); }
};
