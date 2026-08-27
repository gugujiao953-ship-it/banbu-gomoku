import type { LargeDocumentSummary } from "./large-storage";
import type { LibraryHandle, LibraryNodeSnapshot } from "./library-engine";
import type { GameDocument, RecordNode } from "./types";

const PAGED_VIEW = Symbol("banbu-paged-library-view");
const CHILD_WINDOW = 512;
const PREVIEW_DEPTH = 3;

type PagedDocument = GameDocument & { [PAGED_VIEW]?: true };

const decodePosition = (code: number) => code
  ? { row: Math.floor((code - 1) / 16), col: (code - 1) % 16 }
  : undefined;

/**
 * Keeps only the path around the cursor and its visible variations in React.
 * The complete tree remains in paged IndexedDB storage behind LibraryHandle.
 */
export class LibraryViewSession {
  private readonly snapshots = new Map<number, LibraryNodeSnapshot>();
  private readonly indicesById = new Map<string, number>();
  private readonly childrenByIndex = new Map<number, number[]>();
  private readonly completeChildren = new Set<number>();
  private openQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly handle: LibraryHandle, private readonly summary: LargeDocumentSummary) {}

  private remember(node: LibraryNodeSnapshot) {
    this.snapshots.set(node.index, node);
    this.indicesById.set(node.id, node.index);
    return node;
  }

  private async node(index: number) {
    const cached = this.snapshots.get(index);
    if (cached) return cached;
    const loaded = await this.handle.getNode(index);
    return loaded ? this.remember(loaded) : null;
  }

  private async path(index: number) {
    const nodes = await this.handle.getPath(index);
    nodes.forEach((node) => this.remember(node));
    for (let cursor = 0; cursor < nodes.length - 1; cursor += 1) {
      const parent = nodes[cursor], child = nodes[cursor + 1];
      const known = this.childrenByIndex.get(parent.index) || [];
      if (!known.includes(child.index)) this.childrenByIndex.set(parent.index, [...known, child.index]);
    }
    return nodes;
  }

  private async children(index: number) {
    const cached = this.childrenByIndex.get(index);
    if (cached && this.completeChildren.has(index)) return cached;
    const parent = await this.node(index);
    if (!parent) return [];
    // A legal Gomoku position has at most boardSize² children. The generous
    // ceiling also prevents a malformed sibling loop from becoming an
    // unbounded UI allocation.
    const limit = Math.min(Math.max(CHILD_WINDOW, parent.childCount), 4096);
    const nodes = await this.handle.getChildren(index, 0, limit);
    nodes.forEach((node) => this.remember(node));
    const children = nodes.map((node) => node.index);
    this.childrenByIndex.set(index, children);
    this.completeChildren.add(index);
    return children;
  }

  private async warmPreferred(index: number, depth: number) {
    if (depth <= 0) return;
    const node = await this.node(index);
    if (!node || node.preferredChildIndex < 0) return;
    const preferred = await this.node(node.preferredChildIndex);
    if (!preferred) return;
    const known = this.childrenByIndex.get(index) || [];
    if (!known.includes(preferred.index)) this.childrenByIndex.set(index, [...known, preferred.index]);
    await this.warmPreferred(preferred.index, depth - 1);
  }

  private toRecordNode(snapshot: LibraryNodeSnapshot): RecordNode {
    const move = decodePosition(snapshot.moveCode);
    const anchor = decodePosition(snapshot.anchorCode);
    const childIndices = this.childrenByIndex.get(snapshot.index) || [];
    const parent = snapshot.parentIndex >= 0 ? this.snapshots.get(snapshot.parentIndex) : undefined;
    const preferred = snapshot.preferredChildIndex >= 0 ? this.snapshots.get(snapshot.preferredChildIndex) : undefined;
    return {
      id: snapshot.id,
      parentId: parent?.id || null,
      children: childIndices.flatMap((index) => {
        const child = this.snapshots.get(index);
        return child ? [child.id] : [];
      }),
      preferredChildId: preferred?.id,
      move: move && (snapshot.state & 1) ? { ...move, player: snapshot.state & 2 ? "white" : "black" } : null,
      passPlayer: snapshot.state & 16 ? "black" : snapshot.state & 32 ? "white" : undefined,
      anchor,
      comment: snapshot.comment,
      boardText: snapshot.boardText,
      marks: snapshot.marks,
      renLibAnnotations: snapshot.annotations,
      renLibFlags: snapshot.renLibFlags,
      renLibExtendedFlags: snapshot.renLibExtendedFlags,
      renLibMark: Boolean(snapshot.state & 4),
      startPosition: Boolean(snapshot.state & 8),
    };
  }

  private async openNow(index: number) {
    // Rebuild a bounded projection for every cursor change. This is what keeps
    // hours of navigation from gradually materializing a multi-million-node
    // tree in the React heap.
    this.snapshots.clear(); this.indicesById.clear(); this.childrenByIndex.clear(); this.completeChildren.clear();
    const path = await this.path(index);
    if (!path.length) throw new Error("大型棋谱节点不存在");
    const current = path[path.length - 1];
    const visibleChildren = await this.children(current.index);
    if (!visibleChildren.length && current.parentIndex >= 0) await this.children(current.parentIndex);
    const previewRoots = visibleChildren.length
      ? visibleChildren
      : current.parentIndex >= 0 ? this.childrenByIndex.get(current.parentIndex) || [] : [];
    await Promise.all(previewRoots.map((childIndex) => this.warmPreferred(childIndex, PREVIEW_DEPTH)));

    const nodes: Record<string, RecordNode> = {};
    this.snapshots.forEach((snapshot) => { nodes[snapshot.id] = this.toRecordNode(snapshot); });
    const timestamp = this.summary.updatedAt || new Date().toISOString();
    const document: PagedDocument = {
      id: this.summary.id,
      version: 1,
      rootId: this.handle.rootId,
      nodes,
      metadata: this.summary.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      savedCurrentId: current.id,
    };
    Object.defineProperty(document, PAGED_VIEW, { value: true });
    return { document, currentId: current.id, currentIndex: current.index };
  }

  open(index: number) {
    const task = this.openQueue.then(() => this.openNow(index));
    this.openQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  indexForId(id: string) { return this.indicesById.get(id); }

  async parentIndex(id: string) {
    const index = this.indexForId(id);
    const node = index === undefined ? null : await this.node(index);
    return node && node.parentIndex >= 0 ? node.parentIndex : null;
  }

  async preferredIndex(id: string) {
    const index = this.indexForId(id);
    const node = index === undefined ? null : await this.node(index);
    return node && node.preferredChildIndex >= 0 ? node.preferredChildIndex : null;
  }

  async preferredEndIndex(id: string) {
    let index = this.indexForId(id);
    if (index === undefined) return null;
    const seen = new Set<number>();
    while (!seen.has(index)) {
      seen.add(index);
      const node = await this.node(index);
      if (!node || node.preferredChildIndex < 0) return index;
      index = node.preferredChildIndex;
    }
    return index;
  }

  close() { this.handle.close(); }
}

export const isPagedLibraryView = (document: GameDocument) => Boolean((document as PagedDocument)[PAGED_VIEW]);
