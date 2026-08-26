import type { BoardMark, CompactRenLibDraft, CompactRenLibIndex, GameDocument, NodeEvaluation, Player, RecordNode } from "./types";

/** Parser-owned columnar storage. Appending grows plain arrays; no per-node objects,
 * children arrays, or node lookup Map are created. The text pool is intentionally
 * interned with a Map because comments are often repeated. */
export class RenLibArrayBuilder {
  readonly ids: number[] = [];
  readonly parent: number[] = []; readonly firstChild: number[] = [];
  readonly nextSibling: number[] = []; readonly lastChild: number[] = []; readonly childCount: number[] = [];
  readonly preferredChild: number[] = []; readonly moveCode: number[] = [];
  readonly anchorCode: number[] = []; readonly state: number[] = [];
  readonly textRefs: number[] = []; readonly evaluation: number[] = [];
  readonly evaluationLevel: number[] = []; readonly markRefs: number[] = [];
  readonly texts: string[] = []; readonly marks: BoardMark[] = [];
  private readonly textIndex = new Map<string, number>();
  constructor(_rootId: string) { this.addNode(-1, 0, 0); }
  addNode(parent: number, move: number, state: number, anchor = 0) {
    const i = this.ids.length; this.ids.push(i); this.parent.push(parent); this.firstChild.push(-1);
    this.nextSibling.push(-1); this.lastChild.push(-1); this.childCount.push(0); this.preferredChild.push(-1);
    this.moveCode.push(move); this.anchorCode.push(anchor); this.state.push(state);
    this.textRefs.push(-1, -1); this.evaluation.push(0); this.evaluationLevel.push(0); this.markRefs.push(-1, 0); return i;
  }
  intern(value?: string) { if (!value) return -1; const old = this.textIndex.get(value); if (old !== undefined) return old; const i = this.texts.length; this.texts.push(value); this.textIndex.set(value, i); return i; }
  setText(i: number, comment?: string, boardText?: string) { this.textRefs[i * 2] = this.intern(comment); this.textRefs[i * 2 + 1] = this.intern(boardText); }
  setMarks(i: number, marks: BoardMark[]) { if (marks.length) { this.markRefs[i * 2] = this.marks.length; this.markRefs[i * 2 + 1] = marks.length; this.marks.push(...marks); } }
  toIndex(rootId: string, idPrefix = "node"): CompactRenLibIndex { const n = this.ids.length; return { version: 2, nodeCount: n, rootId, ids: this.ids.map((i) => i === 0 ? rootId : `${idPrefix}-${i.toString(36)}`), parent: Int32Array.from(this.parent), firstChild: Int32Array.from(this.firstChild), nextSibling: Int32Array.from(this.nextSibling), childCount: Int32Array.from(this.childCount), preferredChild: Int32Array.from(this.preferredChild), moveCode: Uint16Array.from(this.moveCode), anchorCode: Uint16Array.from(this.anchorCode), state: Uint8Array.from(this.state), evaluation: Int8Array.from(this.evaluation), evaluationLevel: Uint8Array.from(this.evaluationLevel), markRefs: Int32Array.from(this.markRefs), marks: this.marks, textRefs: Int32Array.from(this.textRefs), texts: this.texts }; }
}

const moveCode = (node: RecordNode) => node.move ? (node.move.row * 16 + node.move.col + 1) : 0;
const decodeMoveCode = (code: number) => code ? { row: Math.floor((code - 1) / 16), col: (code - 1) % 16 } : undefined;
const evaluationValues: Record<string, number> = { good: 1, bad: 2, doubtful: 3, interesting: 4, forced: 5, only: 6, study: 7 };

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
  parent.fill(-1); firstChild.fill(-1); nextSibling.fill(-1); preferredChild.fill(-1);
  const texts = draft.texts ? [...draft.texts] : [], textIndex = new Map(texts.map((text, i) => [text, i]));
  const intern = (value?: string) => { if (!value) return -1; const found = textIndex.get(value); if (found !== undefined) return found; const i = texts.length; texts.push(value); textIndex.set(value, i); return i; };
  const marks: CompactRenLibIndex["marks"] = [];
  draft.nodes.forEach((node, i) => {
    parent[i] = node.parent; firstChild[i] = node.firstChild; nextSibling[i] = node.nextSibling; childCount[i] = node.childCount; preferredChild[i] = node.preferredChild;
    if (node.move) { moves[i] = node.move.row * 16 + node.move.col + 1; state[i] = 1 | (node.move.player === "white" ? 2 : 0); }
    if (node.anchor) anchors[i] = node.anchor.row * 16 + node.anchor.col + 1;
    if (node.renLibMark) state[i] |= 4; if (node.startPosition) state[i] |= 8;
    evaluation[i] = evaluationValues[node.evaluation || ""] || 0; evaluationLevel[i] = node.evaluationLevel || 0;
    textRefs[i * 2] = intern(node.comment); textRefs[i * 2 + 1] = intern(node.boardText);
    if (node.marks.length) { markRefs[i * 2] = marks.length; markRefs[i * 2 + 1] = node.marks.length; marks.push(...node.marks); }
  });
  return { version: 2, nodeCount: count, rootId: draft.rootId, ids, parent, firstChild, nextSibling, childCount, preferredChild, moveCode: moves, anchorCode: anchors, state, evaluation, evaluationLevel, markRefs, marks, textRefs, texts };
};
interface LazyDocumentInfo { index: CompactRenLibIndex; branchCount: number }
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
  const texts: string[] = [];
  const marks: RecordNode["marks"] = [];
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
    if (node.renLibMark) state[nodeIndex] |= 4;
    if (node.startPosition) state[nodeIndex] |= 8;
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
  return { version: 2, nodeCount: ids.length, rootId: document.rootId, ids, parent, firstChild, nextSibling, childCount, preferredChild, moveCode: moves, anchorCode, state, evaluation, evaluationLevel, markRefs, marks, textRefs, texts };
};

export const compactIndexBytes = (index: CompactRenLibIndex) => index.parent.byteLength + index.firstChild.byteLength + index.nextSibling.byteLength + (index.preferredChild?.byteLength || 0) + index.moveCode.byteLength + index.anchorCode.byteLength + index.state.byteLength + index.evaluation.byteLength + index.evaluationLevel.byteLength + index.markRefs.byteLength + index.textRefs.byteLength;

const textAt = (index: CompactRenLibIndex, nodeIndex: number, offset: 0 | 1) => {
  const textIndex = index.textRefs[nodeIndex * 2 + offset];
  return textIndex >= 0 ? index.texts[textIndex] || "" : "";
};

/** Rehydrate only the nodes that the UI actually touches. Object.keys/values
 * still expose the complete tree for existing algorithms, but direct lookup
 * (the normal navigation path) does not allocate the whole library. */
export const createLazyDocument = (base: Omit<GameDocument, "nodes">, index: CompactRenLibIndex): GameDocument => {
  const numericPrefix = index.ids.length > 100000 ? (index.ids[1] || "").replace(/-[^-]+$/, "") : "";
  const indexOfId = (id: string) => {
    if (numericPrefix && id.startsWith(`${numericPrefix}-`)) {
      const value = Number.parseInt(id.slice(numericPrefix.length + 1), 36);
      return Number.isInteger(value) && value >= 0 && value < index.nodeCount ? value : undefined;
    }
    return index.ids.indexOf(id) >= 0 ? index.ids.indexOf(id) : undefined;
  };
  const cache = new Map<string, RecordNode>();
  const childCountCache = new Map<number, number>();
  const childAt = (nodeIndex: number, wanted: number) => {
    let childIndex = index.firstChild[nodeIndex] ?? -1;
    let current = 0;
    const seen = new Set<number>();
    while (childIndex >= 0 && childIndex < index.nodeCount && !seen.has(childIndex)) {
      if (current === wanted) return index.ids[childIndex];
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
    const id = index.ids[nodeIndex];
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
      parentId: parentIndex >= 0 ? index.ids[parentIndex] : null,
      children: childrenAt(nodeIndex),
      move: hasMove && point ? { ...point, player: state & 2 ? "white" : "black" } : null,
      anchor: index.anchorCode?.[nodeIndex] ? decodeMoveCode(index.anchorCode[nodeIndex]) : undefined,
      comment: textAt(index, nodeIndex, 0),
      boardText: textAt(index, nodeIndex, 1) || undefined,
      marks: index.markRefs && index.marks ? index.marks.slice(index.markRefs[nodeIndex * 2] < 0 ? 0 : index.markRefs[nodeIndex * 2], (index.markRefs[nodeIndex * 2] < 0 ? 0 : index.markRefs[nodeIndex * 2]) + (index.markRefs[nodeIndex * 2 + 1] || 0)).map((mark) => ({ ...mark })) : [],
      preferredChildId: preferredIndex >= 0 ? index.ids[preferredIndex] : undefined,
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
    ownKeys: () => index.nodeCount > 100000 ? [] : [...index.ids],
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
  lazyDocumentInfo.set(nodes, { index, branchCount });
  return document;
};

export const compactBranchCount = (document: GameDocument) => lazyDocumentInfo.get(document.nodes)?.branchCount;
export const compactNodeCount = (document: GameDocument) => lazyDocumentInfo.get(document.nodes)?.index.nodeCount;
export const compactChildAt = (index: CompactRenLibIndex, nodeIndex: number, offset: number) => {
  if (offset < 0 || nodeIndex < 0 || nodeIndex >= index.nodeCount) return undefined;
  let child = index.firstChild[nodeIndex] ?? -1;
  const seen = new Set<number>();
  for (let current = 0; child >= 0 && child < index.nodeCount && !seen.has(child); current += 1) {
    if (current === offset) return index.ids[child];
    seen.add(child);
    child = index.nextSibling[child] ?? -1;
  }
  return undefined;
};
export const compactIndexOf = (document: GameDocument) => lazyDocumentInfo.get(document.nodes)?.index;
export const compactNodeIndex = (document: GameDocument, id: string) => {
  const index = lazyDocumentInfo.get(document.nodes)?.index;
  if (!index) return undefined;
  const nodeIndex = index.ids.indexOf(id);
  return nodeIndex >= 0 ? nodeIndex : undefined;
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
    if (count > 1) return index.ids[nodeIndex];
  }
  return undefined;
};
export const compactDiagnostics = (document: GameDocument) => {
  const info = lazyDocumentInfo.get(document.nodes);
  if (!info) return { hasCompact: false, nodeCount: null, branchCount: null, firstBranchId: null, firstBranchChildCount: null, rootFirstChild: null, rootChildCount: null };
  const { index, branchCount } = info;
  const rootIndex = index.ids.indexOf(index.rootId);
  let rootFirstChild = rootIndex >= 0 ? index.firstChild[rootIndex] : -1;
  const rootChildIds: string[] = [];
  const seen = new Set<number>();
  while (rootFirstChild >= 0 && rootFirstChild < index.nodeCount && !seen.has(rootFirstChild) && rootChildIds.length < 2) {
    rootChildIds.push(index.ids[rootFirstChild]);
    seen.add(rootFirstChild);
    rootFirstChild = index.nextSibling[rootFirstChild] ?? -1;
  }
  const firstBranchId = compactFirstBranchNodeId(document) ?? null;
  const firstBranchIndex = firstBranchId ? index.ids.indexOf(firstBranchId) : -1;
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
    if ([coordinate, comment, boardText, evaluation, String(nodeIndex)].some((value) => value.toLowerCase().includes(needle))) results.push(index.ids[nodeIndex]);
  }
  return results;
};
export const compactChildWindow = (index: CompactRenLibIndex, nodeIndex: number, start: number, end: number) => {
  const result: string[] = [];
  if (start < 0 || end <= start) return result;
  let child = index.firstChild[nodeIndex] ?? -1;
  const seen = new Set<number>();
  for (let offset = 0; child >= 0 && child < index.nodeCount && !seen.has(child) && offset < end; offset += 1) {
    if (offset >= start) result.push(index.ids[child]);
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
