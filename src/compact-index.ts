import type { BoardMark, BoardSetup, CompactRenLibDraft, CompactRenLibIndex, GameDocument, NativeAnnotation, NodeEvaluation, Player, RecordNode } from "./types";

type NumericArray = Int8Array | Uint8Array | Uint16Array | Int32Array | Uint32Array;
type NumericArrayConstructor<T extends NumericArray> = { new(length: number): T };
const BUILDER_PAGE_SIZE = 65536;

/** Fixed typed pages avoid the several-times-larger boxed-number arrays that
 * otherwise dominate parser memory before the final compact index is built. */
class PagedNumberColumn<T extends NumericArray> {
  private pages: T[] = [];
  length = 0;
  constructor(private readonly Type: NumericArrayConstructor<T>) {}
  private page(index: number) {
    const pageIndex = Math.floor(index / BUILDER_PAGE_SIZE);
    while (this.pages.length <= pageIndex) this.pages.push(new this.Type(BUILDER_PAGE_SIZE));
    return this.pages[pageIndex];
  }
  get(index: number) { return index < 0 || index >= this.length ? 0 : this.pages[Math.floor(index / BUILDER_PAGE_SIZE)][index % BUILDER_PAGE_SIZE]; }
  set(index: number, value: number) { this.page(index)[index % BUILDER_PAGE_SIZE] = value; if (index >= this.length) this.length = index + 1; }
  push(...values: number[]) { const start = this.length; values.forEach((value) => this.set(this.length, value)); return start; }
  add(index: number, value: number) { const next = this.get(index) + value; this.set(index, next); return next; }
  drain() {
    return this.toTyped(true);
  }
  snapshot() {
    return this.toTyped(false);
  }
  private toTyped(clear: boolean) {
    const result = new this.Type(this.length);
    this.pages.forEach((page, pageIndex) => result.set(page.subarray(0, Math.min(BUILDER_PAGE_SIZE, this.length - pageIndex * BUILDER_PAGE_SIZE)), pageIndex * BUILDER_PAGE_SIZE));
    if (clear) this.pages = [];
    return result;
  }
}

/** Parser-owned columnar storage. Nodes are appended to typed pages and text is
 * interned; no per-node objects, child arrays, or all-node string IDs exist. */
export class RenLibArrayBuilder {
  private readonly parent = new PagedNumberColumn(Int32Array); private readonly firstChild = new PagedNumberColumn(Int32Array);
  private readonly nextSibling = new PagedNumberColumn(Int32Array); private readonly lastChild = new PagedNumberColumn(Int32Array);
  private readonly childCount = new PagedNumberColumn(Int32Array); private readonly preferredChild = new PagedNumberColumn(Int32Array);
  private readonly moveCode = new PagedNumberColumn(Uint16Array); private readonly anchorCode = new PagedNumberColumn(Uint16Array);
  private readonly state = new PagedNumberColumn(Uint8Array); private readonly nextTurn = new PagedNumberColumn(Uint8Array);
  private readonly depth = new PagedNumberColumn(Uint16Array); private readonly textRefs = new PagedNumberColumn(Int32Array);
  private readonly evaluation = new PagedNumberColumn(Int8Array); private readonly evaluationLevel = new PagedNumberColumn(Uint8Array);
  private readonly markRefs = new PagedNumberColumn(Int32Array); private readonly annotationRefs = new PagedNumberColumn(Int32Array);
  private readonly renLibFlags = new PagedNumberColumn(Uint8Array); private readonly renLibExtendedFlags = new PagedNumberColumn(Uint32Array);
  readonly annotations: NativeAnnotation[] = [];
  readonly texts: string[] = []; readonly marks: BoardMark[] = [];
  private readonly textIndex = new Map<string, number>();
  constructor(_rootId: string) { this.addNode(-1, 0, 0); }
  get size() { return this.parent.length; }
  addNode(parent: number, move: number, state: number, anchor = 0) {
    const i = this.size; this.parent.push(parent); this.firstChild.push(-1);
    this.nextSibling.push(-1); this.lastChild.push(-1); this.childCount.push(0); this.preferredChild.push(-1);
    this.moveCode.push(move); this.anchorCode.push(anchor); this.state.push(state);
    this.textRefs.push(-1, -1); this.evaluation.push(0); this.evaluationLevel.push(0); this.markRefs.push(-1, 0);
    this.annotationRefs.push(-1, 0); this.renLibFlags.push(0); this.renLibExtendedFlags.push(0);
    const parentTurn = parent >= 0 ? this.nextTurn.get(parent) : 0;
    this.nextTurn.push(state & 1 ? (state & 2 ? 0 : 1) : parentTurn);
    this.depth.push(parent >= 0 ? this.depth.get(parent) + 1 : 0);
    return i;
  }
  intern(value?: string) { if (!value) return -1; const old = this.textIndex.get(value); if (old !== undefined) return old; const i = this.texts.length; this.texts.push(value); this.textIndex.set(value, i); return i; }
  appendChild(parent: number, child: number) { const previous = this.lastChild.get(parent); if (previous < 0) this.firstChild.set(parent, child); else this.nextSibling.set(previous, child); this.lastChild.set(parent, child); const count = this.childCount.add(parent, 1); if (this.preferredChild.get(parent) < 0) this.preferredChild.set(parent, child); return count; }
  nextPlayer(index: number): Player { return this.nextTurn.get(index) ? "white" : "black"; }
  depthAt(index: number) { return this.depth.get(index); }
  parentAt(index: number) { return this.parent.get(index); }
  setText(i: number, comment?: string, boardText?: string) { this.textRefs.set(i * 2, this.intern(comment)); this.textRefs.set(i * 2 + 1, this.intern(boardText)); }
  setBoardText(i: number, boardText?: string) { this.textRefs.set(i * 2 + 1, this.intern(boardText)); }
  addState(i: number, flags: number) { this.state.set(i, this.state.get(i) | flags); }
  addAnnotation(i: number, annotation: NativeAnnotation) { if (this.annotationRefs.get(i * 2) < 0) this.annotationRefs.set(i * 2, this.annotations.length); this.annotations.push(annotation); this.annotationRefs.add(i * 2 + 1, 1); }
  setRenLibFlags(i: number, flags: number, extendedFlags = 0) { this.renLibFlags.set(i, flags); this.renLibExtendedFlags.set(i, extendedFlags); }
  setMarks(i: number, marks: BoardMark[]) { if (marks.length) { this.markRefs.set(i * 2, this.marks.length); this.markRefs.set(i * 2 + 1, marks.length); this.marks.push(...marks); } }
  toIndex(rootId: string, idPrefix = "node", release = true): CompactRenLibIndex { const take = <T extends NumericArray>(column: PagedNumberColumn<T>) => release ? column.drain() : column.snapshot(); const n = this.size; return { version: 2, nodeCount: n, rootId, idPrefix, ids: [rootId], parent: take(this.parent), firstChild: take(this.firstChild), nextSibling: take(this.nextSibling), childCount: take(this.childCount), preferredChild: take(this.preferredChild), moveCode: take(this.moveCode), anchorCode: take(this.anchorCode), state: take(this.state), evaluation: take(this.evaluation), evaluationLevel: take(this.evaluationLevel), markRefs: take(this.markRefs), marks: this.marks, textRefs: take(this.textRefs), texts: this.texts, annotationRefs: take(this.annotationRefs), annotations: this.annotations, renLibFlags: take(this.renLibFlags), renLibExtendedFlags: take(this.renLibExtendedFlags) }; }
}

export const compactNodeId = (index: Pick<CompactRenLibIndex, "ids" | "idPrefix" | "rootId">, nodeIndex: number) =>
  nodeIndex === 0 ? index.rootId : index.ids[nodeIndex] || (index.idPrefix ? `${index.idPrefix}-${nodeIndex.toString(36)}` : "");

const moveCode = (node: RecordNode) => node.move ? (node.move.row * 16 + node.move.col + 1) : 0;
const decodeMoveCode = (code: number) => code ? { row: Math.floor((code - 1) / 16), col: (code - 1) % 16 } : undefined;
const evaluationValues: Record<string, number> = { good: 1, bad: 2, doubtful: 3, interesting: 4, forced: 5, only: 6, study: 7 };
const cloneBoardSetup = (setup: BoardSetup): BoardSetup => ({
  black: setup.black.map((point) => ({ ...point })),
  white: setup.white.map((point) => ({ ...point })),
  empty: setup.empty.map((point) => ({ ...point })),
  ...(setup.nextPlayer ? { nextPlayer: setup.nextPlayer } : {}),
});

/** Build the typed-array index from parser-owned compact records, without creating
 * RecordNode objects, children arrays, or a node Map. Draft links are numeric. */
export const buildCompactRenLibIndexFromDraft = (draft: CompactRenLibDraft): CompactRenLibIndex => {
  const count = draft.nodes.length;
  const ids = draft.nodes.map((node) => node.id);
  const parent = new Int32Array(count), firstChild = new Int32Array(count), nextSibling = new Int32Array(count);
  const childCount = new Int32Array(count), preferredChild = new Int32Array(count);
  const moves = new Uint16Array(count), anchors = new Uint16Array(count), state = new Uint8Array(count);
  const evaluation = new Int8Array(count), evaluationLevel = new Uint8Array(count);
  const textRefs = new Int32Array(count * 2).fill(-1), markRefs = new Int32Array(count * 2).fill(-1);
  const annotationRefs = new Int32Array(count * 2), renLibFlags = new Uint8Array(count), renLibExtendedFlags = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) annotationRefs[i * 2] = -1;
  const setupRefs = new Int32Array(count).fill(-1); const setups: NonNullable<CompactRenLibIndex["setups"]> = [];
  parent.fill(-1); firstChild.fill(-1); nextSibling.fill(-1); preferredChild.fill(-1);
  const texts = draft.texts ? [...draft.texts] : [], textIndex = new Map(texts.map((text, i) => [text, i]));
  const intern = (value?: string) => { if (!value) return -1; const found = textIndex.get(value); if (found !== undefined) return found; const i = texts.length; texts.push(value); textIndex.set(value, i); return i; };
  const marks: CompactRenLibIndex["marks"] = [];
  const annotations: NativeAnnotation[] = [];
  draft.nodes.forEach((node, i) => {
    parent[i] = node.parent; firstChild[i] = node.firstChild; nextSibling[i] = node.nextSibling; childCount[i] = node.childCount; preferredChild[i] = node.preferredChild;
    if (node.move) { moves[i] = node.move.row * 16 + node.move.col + 1; state[i] = 1 | (node.move.player === "white" ? 2 : 0); }
    if (node.passPlayer) state[i] |= node.passPlayer === "black" ? 16 : 32;
    if (node.setup) { setupRefs[i] = setups.length; setups.push(node.setup); }
    if (node.anchor) anchors[i] = node.anchor.row * 16 + node.anchor.col + 1;
    if (node.renLibMark) state[i] |= 4; if (node.startPosition) state[i] |= 8;
    renLibFlags[i] = (node.renLibFlags || 0) & 0xff; renLibExtendedFlags[i] = node.renLibExtendedFlags || 0;
    evaluation[i] = evaluationValues[node.evaluation || ""] || 0; evaluationLevel[i] = node.evaluationLevel || 0;
    textRefs[i * 2] = intern(node.comment); textRefs[i * 2 + 1] = intern(node.boardText);
    if (node.renLibAnnotations?.length) { annotationRefs[i * 2] = annotations.length; annotationRefs[i * 2 + 1] = node.renLibAnnotations.length; annotations.push(...node.renLibAnnotations); }
    if (node.marks.length) { markRefs[i * 2] = marks.length; markRefs[i * 2 + 1] = node.marks.length; marks.push(...node.marks); }
  });
  return { version: 2, nodeCount: count, rootId: draft.rootId, ids, parent, firstChild, nextSibling, childCount, preferredChild, moveCode: moves, anchorCode: anchors, state, evaluation, evaluationLevel, markRefs, marks, textRefs, texts, setupRefs, setups, annotationRefs, annotations, renLibFlags, renLibExtendedFlags };
};
interface LazyDocumentInfo { index: CompactRenLibIndex; branchCount: number; indexOfId: (id: string) => number | undefined }
const lazyDocumentInfo = new WeakMap<object, LazyDocumentInfo>();

/** Convert the object tree once, then let the large-library store persist a
 * compact typed-array representation. This removes per-node JS object and
 * string overhead from subsequent launches. */
export const buildCompactRenLibIndex = (document: GameDocument): CompactRenLibIndex => {
  const ids: string[] = [];
  const indexById = new Map<string, number>();
  const visit = (id: string) => {
    if (indexById.has(id)) return;
    indexById.set(id, ids.length); ids.push(id);
    document.nodes[id]?.children.forEach(visit);
  };
  visit(document.rootId);
  const parent = new Int32Array(ids.length).fill(-1);
  const firstChild = new Int32Array(ids.length).fill(-1);
  const nextSibling = new Int32Array(ids.length).fill(-1);
  const childCount = new Int32Array(ids.length);
  const preferredChild = new Int32Array(ids.length).fill(-1);
  const moves = new Uint16Array(ids.length);
  const anchorCode = new Uint16Array(ids.length);
  const state = new Uint8Array(ids.length);
  const evaluation = new Int8Array(ids.length);
  const evaluationLevel = new Uint8Array(ids.length);
  const textRefs = new Int32Array(ids.length * 2).fill(-1);
  const markRefs = new Int32Array(ids.length * 2).fill(-1);
  const annotationRefs = new Int32Array(ids.length * 2);
  for (let i = 0; i < ids.length; i += 1) annotationRefs[i * 2] = -1;
  const renLibFlags = new Uint8Array(ids.length);
  const renLibExtendedFlags = new Uint32Array(ids.length);
  const setupRefs = new Int32Array(ids.length).fill(-1);
  const setups: NonNullable<CompactRenLibIndex["setups"]> = [];
  const texts: string[] = [];
  const marks: RecordNode["marks"] = [];
  const annotations: NativeAnnotation[] = [];
  const textIndex = new Map<string, number>();
  const intern = (value: string | undefined) => {
    if (!value) return -1;
    const existing = textIndex.get(value);
    if (existing !== undefined) return existing;
    const index = texts.length; texts.push(value); textIndex.set(value, index); return index;
  };
  ids.forEach((id, nodeIndex) => {
    const node = document.nodes[id];
    if (!node) return;
    moves[nodeIndex] = moveCode(node);
    if (node.anchor) anchorCode[nodeIndex] = node.anchor.row * 16 + node.anchor.col + 1;
    if (node.move) state[nodeIndex] |= 1 | (node.move.player === "white" ? 2 : 0);
    if (node.passPlayer) state[nodeIndex] |= node.passPlayer === "black" ? 16 : 32;
    if (node.setup) { setupRefs[nodeIndex] = setups.length; setups.push(cloneBoardSetup(node.setup)); }
    if (node.renLibMark) state[nodeIndex] |= 4;
    if (node.startPosition) state[nodeIndex] |= 8;
    renLibFlags[nodeIndex] = (node.renLibFlags || 0) & 0xff;
    renLibExtendedFlags[nodeIndex] = node.renLibExtendedFlags || 0;
    const evaluationValues: Record<string, number> = { good: 1, bad: 2, doubtful: 3, interesting: 4, forced: 5, only: 6, study: 7 };
    evaluation[nodeIndex] = evaluationValues[node.evaluation || ""] || 0;
    evaluationLevel[nodeIndex] = node.evaluationLevel || 0;
    if (node.marks.length) {
      markRefs[nodeIndex * 2] = marks.length;
      markRefs[nodeIndex * 2 + 1] = node.marks.length;
      marks.push(...node.marks.map((mark) => ({ ...mark })));
    }
    textRefs[nodeIndex * 2] = intern(node.comment);
    textRefs[nodeIndex * 2 + 1] = intern(node.boardText);
    if (node.renLibAnnotations?.length) { annotationRefs[nodeIndex * 2] = annotations.length; annotationRefs[nodeIndex * 2 + 1] = node.renLibAnnotations.length; annotations.push(...node.renLibAnnotations); }
    const children = node.children.map((childId) => indexById.get(childId)).filter((value): value is number => value !== undefined);
    if (children.length) {
      childCount[nodeIndex] = children.length;
      firstChild[nodeIndex] = children[0];
      const preferred = node.preferredChildId ? indexById.get(node.preferredChildId) : undefined;
      preferredChild[nodeIndex] = preferred === undefined ? children[0] : preferred;
      children.forEach((child, childIndex) => {
        parent[child] = nodeIndex;
        if (childIndex) nextSibling[children[childIndex - 1]] = child;
      });
    }
  });
  return { version: 2, nodeCount: ids.length, rootId: document.rootId, ids, parent, firstChild, nextSibling, childCount, preferredChild, moveCode: moves, anchorCode, state, evaluation, evaluationLevel, markRefs, marks, textRefs, texts, setupRefs, setups, annotationRefs, annotations, renLibFlags, renLibExtendedFlags };
};

export const compactIndexBytes = (index: CompactRenLibIndex) => index.parent.byteLength + index.firstChild.byteLength + index.nextSibling.byteLength + (index.preferredChild?.byteLength || 0) + index.moveCode.byteLength + index.anchorCode.byteLength + index.state.byteLength + index.evaluation.byteLength + index.evaluationLevel.byteLength + index.markRefs.byteLength + index.textRefs.byteLength + (index.setupRefs?.byteLength || 0) + (index.annotationRefs?.byteLength || 0) + (index.renLibFlags?.byteLength || 0) + (index.renLibExtendedFlags?.byteLength || 0);

const textAt = (index: CompactRenLibIndex, nodeIndex: number, offset: 0 | 1) => {
  const textIndex = index.textRefs[nodeIndex * 2 + offset];
  return textIndex >= 0 ? index.texts[textIndex] || "" : "";
};

/** Rehydrate only the nodes that the UI actually touches. Object.keys/values
 * still expose the complete tree for existing algorithms, but direct lookup
 * (the normal navigation path) does not allocate the whole library. */
export const createLazyDocument = (base: Omit<GameDocument, "nodes">, index: CompactRenLibIndex): GameDocument => {
  const numericPrefix = index.idPrefix || (index.ids.length > 100000 ? (index.ids[1] || "").replace(/-[^-]+$/, "") : "");
  const directIndex = new Map<string, number>();
  index.ids.forEach((id, nodeIndex) => { if (id) directIndex.set(id, nodeIndex); });
  const indexOfId = (id: string) => {
    if (id === index.rootId) return 0;
    if (numericPrefix && id.startsWith(`${numericPrefix}-`)) {
      const value = Number.parseInt(id.slice(numericPrefix.length + 1), 36);
      return Number.isInteger(value) && value >= 0 && value < index.nodeCount ? value : undefined;
    }
    return directIndex.get(id);
  };
  const cache = new Map<string, RecordNode>();
  const childCountCache = new Map<number, number>();
  const childAt = (nodeIndex: number, wanted: number) => {
    let childIndex = index.firstChild[nodeIndex] ?? -1;
    let current = 0;
    const seen = new Set<number>();
    while (childIndex >= 0 && childIndex < index.nodeCount && !seen.has(childIndex)) {
      if (current === wanted) return compactNodeId(index, childIndex);
      seen.add(childIndex); current += 1;
      childIndex = index.nextSibling[childIndex] ?? -1;
    }
    return undefined;
  };
  const childCountAt = (nodeIndex: number) => {
    const stored = index.childCount?.[nodeIndex];
    if (stored !== undefined && stored > 0) return stored;
    const cached = childCountCache.get(nodeIndex);
    if (cached !== undefined) return cached;
    let childIndex = index.firstChild[nodeIndex] ?? -1, count = 0;
    const seen = new Set<number>();
    while (childIndex >= 0 && childIndex < index.nodeCount && !seen.has(childIndex)) {
      seen.add(childIndex); count += 1; childIndex = index.nextSibling[childIndex] ?? -1;
    }
    childCountCache.set(nodeIndex, count); return count;
  };
  const childrenAt = (nodeIndex: number): string[] => {
    const target: string[] = new Array(childCountAt(nodeIndex));
    let materializedCount = 0;
    const materialize = (limit = Number.POSITIVE_INFINITY) => {
      const end = Math.min(childCountAt(nodeIndex), limit);
      for (let child = materializedCount; child < end; child += 1) {
        const id = childAt(nodeIndex, child); if (id === undefined) break; target[child] = id;
      }
      materializedCount = Math.max(materializedCount, end);
      return target;
    };
    return new Proxy(target, {
      get: (list, property, receiver) => {
        if (property === "length") return target.length;
        if (property === "slice") return (start = 0, end?: number) => materialize(end === undefined ? Number.POSITIVE_INFINITY : end).slice(start, end);
        if (property === "includes") return (value: string) => { for (let i = 0; i < childCountAt(nodeIndex); i += 1) if (childAt(nodeIndex, i) === value) return true; return false; };
        if (property === "indexOf") return (value: string) => { for (let i = 0; i < childCountAt(nodeIndex); i += 1) if (childAt(nodeIndex, i) === value) return i; return -1; };
        if (property === Symbol.iterator) return function* () { yield* materialize(); };
        if (typeof property === "string" && /^\d+$/.test(property)) {
          const child = Number(property);
          if (child >= materializedCount) materialize(child + 1);
          return target[child];
        }
        if (property === "map" || property === "find" || property === "forEach" || property === "filter" || property === "some" || property === "reduce") {
          return (...args: any[]) => (materialize() as any)[property](...args);
        }
        return Reflect.get(list, property, receiver);
      },
      ownKeys: () => { materialize(); return Reflect.ownKeys(target); },
    }) as string[];
  };
  const materialize = (nodeIndex: number): RecordNode => {
    const id = compactNodeId(index, nodeIndex);
    const existing = cache.get(id);
    if (existing) return existing;
    const code = index.moveCode[nodeIndex] || 0;
    const point = decodeMoveCode(code || index.anchorCode[nodeIndex] || 0);
    const state = index.state[nodeIndex] || 0;
    const hasMove = Boolean(state & 1);
    const parentIndex = index.parent[nodeIndex] ?? -1;
    const preferredIndex = index.preferredChild?.[nodeIndex] ?? index.firstChild[nodeIndex] ?? -1;
    const node: RecordNode = {
      id,
      parentId: parentIndex >= 0 ? compactNodeId(index, parentIndex) : null,
      children: childrenAt(nodeIndex),
      move: hasMove && point ? { ...point, player: state & 2 ? "white" : "black" } : null,
      passPlayer: state & 16 ? "black" : state & 32 ? "white" : undefined,
      setup: index.setupRefs && index.setups && index.setupRefs[nodeIndex] >= 0 ? cloneBoardSetup(index.setups[index.setupRefs[nodeIndex]]) : undefined,
      anchor: index.anchorCode?.[nodeIndex] ? decodeMoveCode(index.anchorCode[nodeIndex]) : undefined,
      comment: textAt(index, nodeIndex, 0),
      boardText: textAt(index, nodeIndex, 1) || undefined,
      marks: index.markRefs && index.marks ? index.marks.slice(index.markRefs[nodeIndex * 2] < 0 ? 0 : index.markRefs[nodeIndex * 2], (index.markRefs[nodeIndex * 2] < 0 ? 0 : index.markRefs[nodeIndex * 2]) + (index.markRefs[nodeIndex * 2 + 1] || 0)).map((mark) => ({ ...mark })) : [],
      renLibAnnotations: index.annotationRefs && index.annotations && index.annotationRefs[nodeIndex * 2] >= 0 ? index.annotations.slice(index.annotationRefs[nodeIndex * 2], index.annotationRefs[nodeIndex * 2] + (index.annotationRefs[nodeIndex * 2 + 1] || 0)).map((annotation) => ({ ...annotation, rawBytes: annotation.rawBytes ? new Uint8Array(annotation.rawBytes) : undefined })) : undefined,
      renLibFlags: index.renLibFlags?.[nodeIndex] || undefined,
      renLibExtendedFlags: index.renLibExtendedFlags?.[nodeIndex] || undefined,
      preferredChildId: preferredIndex >= 0 ? compactNodeId(index, preferredIndex) : undefined,
      evaluation: (["", "good", "bad", "doubtful", "interesting", "forced", "only", "study"] as const)[index.evaluation?.[nodeIndex] || 0] || undefined,
      evaluationLevel: index.evaluationLevel?.[nodeIndex] as 1 | 2 | undefined,
      renLibMark: Boolean(state & 4),
      startPosition: Boolean(state & 8),
    };
    cache.set(id, node);
    return node;
  };
  const nodes: Record<string, RecordNode> = new Proxy({} as Record<string, RecordNode>, {
    get: (_target, property: string | symbol) => {
      if (typeof property !== "string") return undefined;
      const nodeIndex = indexOfId(property);
      return nodeIndex === undefined ? undefined : materialize(nodeIndex);
    },
    has: (_target, property: string | symbol) => typeof property === "string" && indexOfId(property) !== undefined,
    ownKeys: () => index.nodeCount > 100000 ? [] : Array.from({ length: index.nodeCount }, (_, nodeIndex) => compactNodeId(index, nodeIndex)),
    getOwnPropertyDescriptor: (_target, property: string | symbol): PropertyDescriptor | undefined => {
      if (typeof property !== "string") return undefined;
      const nodeIndex = indexOfId(property);
      if (nodeIndex === undefined) return undefined;
      return { enumerable: index.nodeCount <= 10000, configurable: true, value: materialize(nodeIndex) };
    },
  });
  let branchCount = 0;
  for (let nodeIndex = 0; nodeIndex < index.nodeCount; nodeIndex += 1) {
    let childIndex = index.firstChild[nodeIndex] ?? -1;
    let childCount = 0;
    while (childIndex >= 0 && childIndex < index.nodeCount && childCount < 2) {
      childCount += 1;
      childIndex = index.nextSibling[childIndex] ?? -1;
    }
    if (childCount > 1) branchCount += 1;
  }
  const document = { ...base, nodes };
  lazyDocumentInfo.set(nodes, { index, branchCount, indexOfId });
  return document;
};

export const compactBranchCount = (document: GameDocument) => lazyDocumentInfo.get(document.nodes)?.branchCount;
export const compactNodeCount = (document: GameDocument) => lazyDocumentInfo.get(document.nodes)?.index.nodeCount;
export const compactChildAt = (index: CompactRenLibIndex, nodeIndex: number, offset: number) => {
  if (offset < 0 || nodeIndex < 0 || nodeIndex >= index.nodeCount) return undefined;
  let child = index.firstChild[nodeIndex] ?? -1;
  const seen = new Set<number>();
  for (let current = 0; child >= 0 && child < index.nodeCount && !seen.has(child); current += 1) {
    if (current === offset) return compactNodeId(index, child);
    seen.add(child);
    child = index.nextSibling[child] ?? -1;
  }
  return undefined;
};
export const compactIndexOf = (document: GameDocument) => lazyDocumentInfo.get(document.nodes)?.index;
export const compactNodeIndex = (document: GameDocument, id: string) => {
  const index = lazyDocumentInfo.get(document.nodes)?.index;
  if (!index) return undefined;
  const nodeIndex = lazyDocumentInfo.get(document.nodes)?.indexOfId(id);
  return nodeIndex;
};

/** Register a fresh `nodes` proxy (e.g. a draft-overlay projection) with the
 * same compact-index metadata as an existing document's nodes, so compact
 * helpers (compactIndexOf, compactChildWindow, compactSearch, ...) keep working
 * through the proxy without materializing the base tree. */
export const compactRegisterAlias = (document: GameDocument, aliasNodes: object): void => {
  const info = lazyDocumentInfo.get(document.nodes);
  if (info) lazyDocumentInfo.set(aliasNodes as Record<string, unknown>, info);
};
export const compactChildCount = (index: CompactRenLibIndex, nodeIndex: number) => index.childCount?.[nodeIndex] ?? 0;
export const compactFirstBranchNodeId = (document: GameDocument) => {
  const index = lazyDocumentInfo.get(document.nodes)?.index;
  if (!index) return undefined;
  for (let nodeIndex = 0; nodeIndex < index.nodeCount; nodeIndex += 1) {
    let child = index.firstChild[nodeIndex] ?? -1;
    let count = 0;
    const seen = new Set<number>();
    while (child >= 0 && child < index.nodeCount && !seen.has(child) && count < 2) {
      count += 1;
      seen.add(child);
      child = index.nextSibling[child] ?? -1;
    }
    if (count > 1) return compactNodeId(index, nodeIndex);
  }
  return undefined;
};
export const compactDiagnostics = (document: GameDocument) => {
  const info = lazyDocumentInfo.get(document.nodes);
  if (!info) return { hasCompact: false, nodeCount: null, branchCount: null, firstBranchId: null, firstBranchChildCount: null, rootFirstChild: null, rootChildCount: null };
  const { index, branchCount } = info;
  const rootIndex = index.ids.length === index.nodeCount ? index.ids.indexOf(index.rootId) : 0;
  let rootFirstChild = rootIndex >= 0 ? index.firstChild[rootIndex] : -1;
  const rootChildIds: string[] = [];
  const seen = new Set<number>();
  while (rootFirstChild >= 0 && rootFirstChild < index.nodeCount && !seen.has(rootFirstChild) && rootChildIds.length < 2) {
    rootChildIds.push(compactNodeId(index, rootFirstChild));
    seen.add(rootFirstChild);
    rootFirstChild = index.nextSibling[rootFirstChild] ?? -1;
  }
  const firstBranchId = compactFirstBranchNodeId(document) ?? null;
  const firstBranchIndex = firstBranchId ? compactNodeIndex(document, firstBranchId) ?? -1 : -1;
  return { hasCompact: true, nodeCount: index.nodeCount, branchCount, firstBranchId, firstBranchChildCount: firstBranchIndex === undefined ? null : index.childCount?.[firstBranchIndex] ?? null, rootFirstChild: rootChildIds[0] || null, rootChildCount: index.childCount?.[rootIndex] ?? rootChildIds.length };
};
export const compactSearch = (document: GameDocument, query: string, limit = 20) => {
  const info = lazyDocumentInfo.get(document.nodes);
  if (!info) return undefined;
  const { index } = info;
  const needle = query.toLowerCase();
  const results: string[] = [];
  for (let nodeIndex = 0; nodeIndex < index.nodeCount && results.length < limit; nodeIndex += 1) {
    const code = index.moveCode[nodeIndex] || index.anchorCode[nodeIndex] || 0;
    const coordinate = code ? `${String.fromCharCode(65 + ((code - 1) % 16))}${Math.floor((code - 1) / 16) + 1}` : "起始局面";
    const comment = index.textRefs[nodeIndex * 2] >= 0 ? index.texts[index.textRefs[nodeIndex * 2]] || "" : "";
    const boardText = index.textRefs[nodeIndex * 2 + 1] >= 0 ? index.texts[index.textRefs[nodeIndex * 2 + 1]] || "" : "";
    const evaluation = (["", "good", "bad", "doubtful", "interesting", "forced", "only", "study"] as const)[index.evaluation?.[nodeIndex] || 0] || "";
    const markStart = index.markRefs?.[nodeIndex * 2] ?? -1;
    const markCount = index.markRefs?.[nodeIndex * 2 + 1] ?? 0;
    const marks = markStart >= 0 && markCount > 0 ? index.marks.slice(markStart, markStart + markCount) : [];
    const boardSize = document.metadata.boardSize || 15;
    const markText = marks.flatMap((mark) => [
      `${String.fromCharCode(65 + mark.col)}${boardSize - mark.row}`,
      mark.label || "",
      mark.kind === "label" ? "文字标注" : mark.kind === "circle" ? "圆圈" : mark.kind === "triangle" ? "三角" : "叉号",
    ]).join(" ");
    if ([coordinate, comment, boardText, evaluation, markText, String(nodeIndex)].some((value) => value.toLowerCase().includes(needle))) results.push(compactNodeId(index, nodeIndex));
  }
  return results;
};
export const compactChildWindow = (index: CompactRenLibIndex, nodeIndex: number, start: number, end: number) => {
  const result: string[] = [];
  if (start < 0 || end <= start) return result;
  let child = index.firstChild[nodeIndex] ?? -1;
  const seen = new Set<number>();
  for (let offset = 0; child >= 0 && child < index.nodeCount && !seen.has(child) && offset < end; offset += 1) {
    if (offset >= start) result.push(compactNodeId(index, child));
    seen.add(child);
    child = index.nextSibling[child] ?? -1;
  }
  return result;
};

/** IndexedDB cannot clone a Proxy. Edits to a lazy document use the existing
 * immutable game helpers and may leave the original proxy on `nodes`, so
 * materialise explicitly at the storage boundary. */
export const materializeDocument = (document: GameDocument): GameDocument => ({
  ...document,
  nodes: Object.fromEntries(Object.keys(document.nodes).map((id) => {
    const node = document.nodes[id];
    return [id, { ...node, children: [...node.children], marks: [...node.marks] }];
  })),
});
