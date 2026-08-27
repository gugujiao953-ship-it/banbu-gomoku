import type { BoardMark, CompactRenLibIndex, NativeAnnotation, RecordNode } from "./types";

const DATABASE_NAME = "banbu-gomoku-large-library";
const DOCUMENT_STORE = "documents";
const CHUNK_STORE = "index-chunks";
const INDEX_CHUNK_SIZE = 250000;
const MAX_CACHED_PAGES = 96;

export interface LibraryNodeSnapshot {
  index: number;
  id: string;
  parentIndex: number;
  firstChildIndex: number;
  nextSiblingIndex: number;
  childCount: number;
  preferredChildIndex: number;
  moveCode: number;
  anchorCode: number;
  state: number;
  comment: string;
  boardText?: string;
  marks: BoardMark[];
  annotations: NativeAnnotation[];
  renLibFlags: number;
  renLibExtendedFlags: number;
}

export interface LibraryHandle {
  readonly id: string;
  readonly nodeCount: number;
  readonly rootId: string;
  getNode(index: number): Promise<LibraryNodeSnapshot | null>;
  getPath(index: number): Promise<LibraryNodeSnapshot[]>;
  getChildren(index: number, offset?: number, limit?: number): Promise<LibraryNodeSnapshot[]>;
  getAnnotations(index: number): Promise<NativeAnnotation[]>;
  close(): void;
}

type StoredDocument = { id: string; rootId: string; idPrefix?: string; nodeCount?: number; chunkedIndex?: boolean; compactIndex?: CompactRenLibIndex };
type Chunk = { value: unknown };

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("无法打开大型棋谱存储"));
});

const readRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("读取大型棋谱页失败"));
});

const decodeMoveCode = (code: number) => code ? { row: Math.floor((code - 1) / 16), col: (code - 1) % 16 } : undefined;

const cloneAnnotation = (annotation: NativeAnnotation): NativeAnnotation => ({
  ...annotation,
  rawBytes: annotation.rawBytes ? new Uint8Array(annotation.rawBytes) : undefined,
});
const cloneMark = (mark: BoardMark): BoardMark => ({ ...mark });

const typedValue = (value: unknown, Type: any, index: number) => {
  const array = value instanceof ArrayBuffer ? new Type(value) : value instanceof Type ? value : new Type(value as ArrayLike<number>);
  return array[index];
};

const idbKey = (id: string, field: string, offset: number) => `${id}:${field}:${offset}`;

class IndexedDbLibraryHandle implements LibraryHandle {
  private readonly pageCache = new Map<string, unknown>();
  private closed = false;
  constructor(private readonly database: IDBDatabase, private readonly stored: StoredDocument) {}
  get id() { return this.stored.id; }
  get nodeCount() { return this.stored.nodeCount || this.stored.compactIndex?.nodeCount || 0; }
  get rootId() { return this.stored.rootId; }

  private assertOpen() { if (this.closed) throw new Error("大型棋谱句柄已经关闭"); }
  private async page(field: string, offset: number) {
    this.assertOpen();
    const key = idbKey(this.id, field, offset);
    if (this.pageCache.has(key)) {
      const cached = this.pageCache.get(key);
      this.pageCache.delete(key); this.pageCache.set(key, cached);
      return cached;
    }
    if (!this.stored.chunkedIndex) return undefined;
    const transaction = this.database.transaction(CHUNK_STORE, "readonly");
    const chunk = await readRequest(transaction.objectStore(CHUNK_STORE).get(key) as IDBRequest<Chunk | undefined>);
    const value = chunk?.value;
    if (value !== undefined) {
      this.pageCache.set(key, value);
      while (this.pageCache.size > MAX_CACHED_PAGES) {
        const oldest = this.pageCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.pageCache.delete(oldest);
      }
    }
    return value;
  }

  private async scalar(field: keyof CompactRenLibIndex, Type: any, index: number) {
    const inline = this.stored.compactIndex;
    if (inline) return inline[field] && (inline[field] as any)[index] !== undefined ? (inline[field] as any)[index] : 0;
    const offset = Math.floor(index / INDEX_CHUNK_SIZE) * INDEX_CHUNK_SIZE;
    const value = await this.page(String(field), offset);
    return value === undefined ? 0 : typedValue(value, Type, index - offset);
  }

  private async listValue(field: "ids" | "texts" | "marks" | "annotations", index: number) {
    const inline = this.stored.compactIndex?.[field];
    if (inline) return (inline as any)[index];
    const offset = Math.floor(index / INDEX_CHUNK_SIZE) * INDEX_CHUNK_SIZE;
    const value = await this.page(field, offset) as unknown[] | undefined;
    return value?.[index - offset];
  }

  private async pair(field: keyof CompactRenLibIndex, index: number) {
    const first = await this.scalar(field, Int32Array, index * 2);
    const second = await this.scalar(field, Int32Array, index * 2 + 1);
    return [first, second] as const;
  }

  async getAnnotations(index: number): Promise<NativeAnnotation[]> {
    const [start, count] = await this.pair("annotationRefs", index);
    if (start < 0 || count <= 0) return [];
    const result: NativeAnnotation[] = [];
    for (let i = 0; i < count; i += 1) {
      const annotation = await this.listValue("annotations", start + i);
      if (annotation) result.push(cloneAnnotation(annotation as NativeAnnotation));
    }
    return result;
  }

  async getMarks(index: number): Promise<BoardMark[]> {
    const [start, count] = await this.pair("markRefs", index);
    if (start < 0 || count <= 0) return [];
    const result: BoardMark[] = [];
    for (let i = 0; i < count; i += 1) {
      const mark = await this.listValue("marks", start + i);
      if (mark) result.push(cloneMark(mark as BoardMark));
    }
    return result;
  }

  async getNode(index: number): Promise<LibraryNodeSnapshot | null> {
    if (index < 0 || index >= this.nodeCount) return null;
    const [id, parentIndex, firstChildIndex, nextSiblingIndex, childCount, preferredChildIndex, moveCode, anchorCode, state, renLibFlags, renLibExtendedFlags] = await Promise.all([
      this.listValue("ids", index),
      this.scalar("parent", Int32Array, index),
      this.scalar("firstChild", Int32Array, index),
      this.scalar("nextSibling", Int32Array, index),
      this.scalar("childCount", Int32Array, index),
      this.scalar("preferredChild", Int32Array, index),
      this.scalar("moveCode", Uint16Array, index),
      this.scalar("anchorCode", Uint16Array, index),
      this.scalar("state", Uint8Array, index),
      this.scalar("renLibFlags", Uint8Array, index),
      this.scalar("renLibExtendedFlags", Uint32Array, index),
    ]);
    const textRefs = await this.pair("textRefs", index);
    const [comment, boardText, marks, annotations] = await Promise.all([
      textRefs[0] >= 0 ? this.listValue("texts", textRefs[0]) : "",
      textRefs[1] >= 0 ? this.listValue("texts", textRefs[1]) : undefined,
      this.getMarks(index),
      this.getAnnotations(index),
    ]);
    return {
      index, id: String(id || (index === 0 ? this.rootId : `${this.stored.idPrefix || this.stored.compactIndex?.idPrefix || this.id}-${index.toString(36)}`)),
      parentIndex, firstChildIndex, nextSiblingIndex, childCount, preferredChildIndex,
      moveCode, anchorCode, state, comment: String(comment || ""), boardText: boardText ? String(boardText) : undefined,
      marks, annotations, renLibFlags, renLibExtendedFlags,
    };
  }

  async getPath(index: number): Promise<LibraryNodeSnapshot[]> {
    const path: LibraryNodeSnapshot[] = [];
    const seen = new Set<number>();
    let cursor = index;
    while (cursor >= 0 && cursor < this.nodeCount && !seen.has(cursor)) {
      const node = await this.getNode(cursor);
      if (!node) break;
      path.push(node); seen.add(cursor); cursor = node.parentIndex;
    }
    return path.reverse();
  }

  async getChildren(index: number, offset = 0, limit = 128): Promise<LibraryNodeSnapshot[]> {
    const parent = await this.getNode(index);
    if (!parent || limit <= 0 || offset < 0) return [];
    const result: LibraryNodeSnapshot[] = [];
    let childIndex = parent.firstChildIndex;
    let position = 0;
    const seen = new Set<number>();
    while (childIndex >= 0 && childIndex < this.nodeCount && !seen.has(childIndex) && result.length < limit) {
      const child = await this.getNode(childIndex);
      if (!child) break;
      if (position >= offset) {
        result.push(child);
      }
      seen.add(childIndex); position += 1;
      childIndex = child.nextSiblingIndex;
    }
    return result;
  }

  close() { if (!this.closed) { this.closed = true; this.pageCache.clear(); this.database.close(); } }
}

export const openLibraryHandle = async (id: string): Promise<LibraryHandle | null> => {
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENT_STORE, "readonly");
  const stored = await readRequest(transaction.objectStore(DOCUMENT_STORE).get(id) as IDBRequest<StoredDocument | undefined>);
  if (!stored) { database.close(); return null; }
  return new IndexedDbLibraryHandle(database, stored);
};

/** Adapt a native node snapshot to the fields used by the existing UI. */
export const libraryNodeToRecordNode = (node: LibraryNodeSnapshot): RecordNode => {
  const move = decodeMoveCode(node.moveCode);
  const anchor = decodeMoveCode(node.anchorCode);
  const state = node.state || 0;
  return {
    id: node.id,
    parentId: node.parentIndex >= 0 ? `node-${node.parentIndex.toString(36)}` : null,
    children: [],
    move: move && state & 1 ? { ...move, player: state & 2 ? "white" : "black" } : null,
    anchor,
    comment: node.comment,
    boardText: node.boardText,
    marks: node.marks,
    renLibAnnotations: node.annotations,
    renLibFlags: node.renLibFlags,
    renLibExtendedFlags: node.renLibExtendedFlags,
    renLibMark: Boolean(state & 4),
    startPosition: Boolean(state & 8),
  };
};
