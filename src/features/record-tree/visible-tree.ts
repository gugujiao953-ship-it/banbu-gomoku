import { compactChildCount, compactChildWindow, compactIndexOf, compactNodeId, compactNodeIndex } from "../../compact-index";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "../../types";
import { treeAncestorPath } from "./tree-navigation";

export interface TreeEntry {
  id: string;
  parentId: string | null;
  depth: number;
  turnDepth: number;
  node: RecordNode;
  childCount: number;
  folded: boolean;
  onPath: boolean;
  isCurrent: boolean;
  revealed: boolean;
  /** Layout metadata must not rehydrate every node in a compact library. */
  hasText: boolean;
  unloadedChildren: number;
}

/** The next decision layer under this node; unrelated branches must not enable expansion. */
export function treeBranchFrontier(entries: readonly TreeEntry[], id: string, levels: number): TreeEntry[] {
  const selected = entries.find((entry) => entry.id === id);
  if (!selected) return [];
  const depth = selected.depth + levels;
  const descendants = new Set([id]);
  const frontier: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.parentId && descendants.has(entry.parentId)) descendants.add(entry.id);
    if (descendants.has(entry.id) && (entry.depth === depth || (entry.depth < depth && entry.unloadedChildren > 0))) frontier.push(entry);
  }
  return frontier;
}

interface VisibleTreeOptions {
  document: GameDocument;
  currentId: string;
  selectedId: string;
  path: RecordNode[];
  mainLineIds: ReadonlySet<string>;
  openLevels: ReadonlyMap<string, number>;
  collapsedIds: ReadonlySet<string>;
  treeMode: "default" | "expanded" | "collapsed";
  focusId: string | null;
  compactIndex?: CompactRenLibIndex;
}

/** Expansion selects data, never a drawing quota. The canvas separately queries its viewport. */
export function buildVisibleTree(options: VisibleTreeOptions) {
  const { document, currentId, selectedId, path, mainLineIds, openLevels, collapsedIds, treeMode } = options;
  const compactIndex = options.compactIndex ?? compactIndexOf(document);
  const summary = (id: string) => {
    const at = compactIndex ? compactNodeIndex(document, id) : undefined;
    if (compactIndex && at !== undefined) {
      const parent = compactIndex.parent[at];
      const text = compactIndex.textRefs[at * 2 + 1];
      return { parentId: parent >= 0 ? compactNodeId(compactIndex, parent) : null,
        childCount: compactChildCount(compactIndex, at), unloaded: 0,
        hasTurn: Boolean(compactIndex.state[at] & (1 | 16 | 32)),
        hasText: Boolean(text >= 0 && compactIndex.texts[text]?.trim()), at };
    }
    const node = document.nodes[id];
    return node ? { parentId: node.parentId, childCount: node.children.length,
      unloaded: Math.max(0, node.unloadedChildren ?? 0), hasTurn: Boolean(node.move || node.passPlayer),
      hasText: Boolean(node.boardText?.trim()), at: undefined } : undefined;
  };
  const focusId = options.focusId && document.nodes[options.focusId] ? options.focusId : null;
  const pathIds = new Set(path.map((node) => node.id));
  const selectedPath = treeAncestorPath(document, selectedId);
  const focusAncestors = focusId ? treeAncestorPath(document, focusId) : [];
  const focusPath = new Set(focusAncestors.map((node) => node.id));
  const rootId = document.rootId;
  if (!summary(rootId)) return { entries: [], limited: false, unloadedCount: 0, contextRootId: rootId };
  const required = new Set<string>();
  const revealIds = new Set<string>();
  const addAnchor = (id: string, reveal: boolean) => {
    const chain = treeAncestorPath(document, id);
    if (focusId && !focusPath.has(id) && !chain.some((node) => node.id === focusId)) return;
    for (const node of chain) {
      required.add(node.id);
      if (reveal) revealIds.add(node.id);
    }
  };
  addAnchor(selectedId, true);
  if (focusId) addAnchor(focusId, true);
  addAnchor(currentId, false);
  for (const [id, levels] of openLevels) if (levels > 0) addAnchor(id, true);
  required.add(rootId);
  const essentialChildren = new Map<string, string[]>();
  for (const id of new Set([...required, ...mainLineIds])) {
    const parent = summary(id)?.parentId;
    if (parent) {
      const children = essentialChildren.get(parent) ?? [];
      children.push(id);
      essentialChildren.set(parent, children);
    }
  }
  type Frame = { id: string; depth: number; turn: number; budget: number; revealed: boolean; insideFocus: boolean };
  const queue: Frame[] = [{ id: rootId, depth: 0, turn: 0, budget: 0, revealed: false, insideFocus: false }];
  const scheduled = new Set<string>([rootId]);
  const entriesById = new Map<string, TreeEntry>();
  const drawnChildren = new Map<string, string[]>();
  let unloadedCount = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const frame = queue[cursor];
    const info = summary(frame.id);
    if (!info) continue;
    const mine = openLevels.get(frame.id) ?? 0;
    const collapsed = collapsedIds.has(frame.id) || (treeMode === "collapsed" && pathIds.has(frame.id));
    const insideFocus = frame.insideFocus || frame.id === focusId;
    const showAll = treeMode === "expanded" || (!collapsed && (frame.budget > 0 || mine > 0)) || insideFocus;
    // Closed branches need only anchors; expanding reads all loaded siblings without a 12/240 cutoff.
    const loadedIds = !showAll ? [] : compactIndex && info.at !== undefined
      ? compactChildWindow(compactIndex, info.at, 0, info.childCount)
      : document.nodes[frame.id].children;
    const ids = new Set([...loadedIds, ...(essentialChildren.get(frame.id) ?? [])]);
    const children: string[] = [];
    for (const id of ids) {
      const child = summary(id);
      if (!child || child.parentId !== frame.id || scheduled.has(id)) continue;
      if (focusId && !insideFocus && !focusPath.has(id)) continue;
      const onPath = pathIds.has(id);
      const auto = treeMode !== "collapsed" && mainLineIds.has(id);
      const revealed = revealIds.has(id) || (openLevels.get(id) ?? 0) > 0;
      if (collapsed && !(onPath || revealed)) continue;
      if (!(showAll || onPath || auto || revealed)) continue;
      scheduled.add(id);
      children.push(id);
      queue.push({ id, depth: frame.depth + 1, turn: frame.turn + Number(child.hasTurn), budget: Math.max(0, frame.budget - 1, mine - 1), revealed: frame.revealed || (mine > 0 && !onPath && !auto), insideFocus });
    }
    unloadedCount += info.unloaded;
    drawnChildren.set(frame.id, children);
    entriesById.set(frame.id, { id: frame.id, parentId: info.parentId, depth: frame.depth, turnDepth: frame.turn,
      get node() { return document.nodes[frame.id]; },
      childCount: info.childCount + info.unloaded, folded: children.length < info.childCount + info.unloaded,
      onPath: pathIds.has(frame.id), isCurrent: frame.id === currentId, revealed: frame.revealed,
      hasText: info.hasText, unloadedChildren: info.unloaded });
  }
  const entries: TreeEntry[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const entry = entriesById.get(id);
    if (!entry) continue;
    entries.push(entry);
    const children = drawnChildren.get(id) ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return { entries, limited: false, unloadedCount, contextRootId: rootId };
}
