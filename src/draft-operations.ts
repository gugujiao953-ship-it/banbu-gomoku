import type { GameDocument, GameMetadata, PartialRecordNode, RecordNode } from "./types";
import { compactRegisterAlias } from "./compact-index";
import { coordinateName } from "./game";
import type { RecordBookmark } from "./features/record-tree/bookmarks";

const PROJECTED_NODES_MARKER = "__isProjected";

/** The proxy returned by projectedDocument exposes a non-node marker so UI
 * code can choose the overlay-aware child path without materializing a large
 * compact tree. Keep the marker check here instead of leaking an `any` cast
 * into React rendering code. */
export const isProjectedDocument = (document: GameDocument) =>
  (document.nodes as unknown as Record<string, unknown>)[PROJECTED_NODES_MARKER] === true;

export type DraftOperation =
  | { type: "add-move"; parentId: string; node: RecordNode }
  | { type: "add-subtree"; parentId: string; rootId: string; nodes: Record<string, RecordNode>; bookmarks?: RecordBookmark[] }
  | { type: "delete-subtree"; parentId: string; rootId: string }
  | { type: "update-node"; nodeId: string; patch: PartialRecordNode }
  | { type: "set-mainline"; parentId: string; childId: string };
export interface DraftState { operations: DraftOperation[]; redo: DraftOperation[]; metadata?: Partial<GameMetadata>; }
export const emptyDraft = (): DraftState => ({ operations: [], redo: [] });
export const pushDraft = (state: DraftState, operation: DraftOperation): DraftState => ({ ...state, operations: [...state.operations, operation], redo: [] });
export const undoDraft = (state: DraftState): DraftState => {
  const operation = state.operations[state.operations.length - 1];
  return operation ? { ...state, operations: state.operations.slice(0, -1), redo: [...state.redo, operation] } : state;
};
export const redoDraft = (state: DraftState): DraftState => {
  const operation = state.redo[state.redo.length - 1];
  return operation ? { ...state, operations: [...state.operations, operation], redo: state.redo.slice(0, -1) } : state;
};
export const clearDraft = (): DraftState => emptyDraft();
export const hasDraft = (state: DraftState) => state.operations.length > 0 || Boolean(state.metadata && Object.keys(state.metadata).length);
/** An empty overlay — used when no operations exist but a typed overlay is needed. */
export const emptyOverlay = (): DraftOverlay => ({ added: new Map(), patches: new Map(), deleted: new Set(), preferred: new Map() });

export interface DraftOverlay {
  added: Map<string, RecordNode>;
  patches: Map<string, PartialRecordNode>;
  deleted: Set<string>;
  preferred: Map<string, string>;
}

/** Build the full descendant closure for each delete-subtree operation. */
const computeDeletedClosure = (state: DraftState, document: GameDocument): Set<string> => {
  const result = new Set<string>();
  for (const op of state.operations) {
    if (op.type !== "delete-subtree") continue;
    if (result.has(op.rootId)) continue;
    const visit = (id: string) => {
      if (result.has(id)) return;
      result.add(id);
      const node = document.nodes[id];
      if (!node) return;
      for (const childId of node.children) visit(childId);
    };
    visit(op.rootId);
  }
  return result;
};

export const buildDraftOverlay = (state: DraftState, document?: GameDocument): DraftOverlay => {
  const overlay: DraftOverlay = { added: new Map(), patches: new Map(), deleted: new Set(), preferred: new Map() };
  if (!document) {
    // Without document context, just track root deletion IDs
    for (const operation of state.operations) {
      if (operation.type === "add-move") overlay.added.set(operation.node.id, operation.node);
      else if (operation.type === "add-subtree") Object.values(operation.nodes).forEach((node) => overlay.added.set(node.id, node));
      else if (operation.type === "update-node") overlay.patches.set(operation.nodeId, { ...(overlay.patches.get(operation.nodeId) || {}), ...operation.patch });
      else if (operation.type === "delete-subtree") overlay.deleted.add(operation.rootId);
      else if (operation.type === "set-mainline") overlay.preferred.set(operation.parentId, operation.childId);
    }
    return overlay;
  }
  const deletedClosure = computeDeletedClosure(state, document);
  for (const operation of state.operations) {
    if (operation.type === "add-move") overlay.added.set(operation.node.id, operation.node);
    else if (operation.type === "add-subtree") Object.values(operation.nodes).forEach((node) => overlay.added.set(node.id, node));
    else if (operation.type === "update-node") overlay.patches.set(operation.nodeId, { ...(overlay.patches.get(operation.nodeId) || {}), ...operation.patch });
    else if (operation.type === "delete-subtree") {
      for (const id of deletedClosure) overlay.deleted.add(id);
    }
    else if (operation.type === "set-mainline") overlay.preferred.set(operation.parentId, operation.childId);
  }
  return overlay;
};

/** Resolve a node ID through the overlay, returning the effective node with
 * correct children list (including draft additions, excluding deletions). */
export const overlayNode = (document: GameDocument, overlay: DraftOverlay, id: string): RecordNode | undefined => {
  if (overlay.deleted.has(id)) return undefined;
  const node = overlay.added.get(id) || document.nodes[id];
  if (!node) return undefined;
  const patch = overlay.patches.get(id);
  // Compute effective children: base minus deleted plus draft-added, in the
  // order the user created them. `overlay.added` is a Map keyed by node id, so
  // iteration order is insertion order — the newest draft child is last.
  const baseChildren = [...node.children].filter((childId) => !overlay.deleted.has(childId));
  const addedChildren = [...overlay.added.values()]
    .filter((child) => child.parentId === id && !overlay.deleted.has(child.id))
    .map((child) => child.id);
  const effectiveChildren = [...new Set([...baseChildren, ...addedChildren])];
  // Children, marks and preferredChildId are computed from the overlay below;
  // don't let a partial patch override those derived values.
  const { marks: patchedMarks, preferredChildId: _patchedPreferredChildId, ...basePatch } = patch || {};
  const result = { ...node, ...basePatch, children: effectiveChildren, marks: patchedMarks || node.marks };
  // Apply set-mainline override from overlay
  const preferredOverride = overlay.preferred.get(id);
  if (preferredOverride !== undefined && effectiveChildren.includes(preferredOverride)) {
    result.preferredChildId = preferredOverride;
  } else if (addedChildren.length) {
    // A freshly played move must become the main line, matching addMove in
    // game.ts (which sets preferredChildId on the parent). Without this, the
    // draft projection kept pointing at the old first child, so 下一手 skipped
    // the move the user had just played and saving the record demoted it to a
    // side variation. Only draft-added children do this; the stored document's
    // own preferredChildId still wins when it is the current main line.
    const storedPreferred = node.preferredChildId && effectiveChildren.includes(node.preferredChildId)
      ? node.preferredChildId
      : undefined;
    const lastAdded = addedChildren[addedChildren.length - 1];
    result.preferredChildId = storedPreferred && !addedChildren.includes(storedPreferred) ? storedPreferred : lastAdded;
  }
  return result;
};

/** Get the effective children list for a node, including draft additions and
 * excluding deletions. */
export const overlayChildren = (document: GameDocument, overlay: DraftOverlay, id: string): string[] => {
  const node = overlayNode(document, overlay, id);
  if (!node) return [];
  return node.children;
};

/** Get the effective preferred child, respecting draft set-mainline. */
export const overlayPreferredChild = (document: GameDocument, overlay: DraftOverlay, id: string): string | undefined => {
  // Draft set-mainline takes priority
  const preferred = overlay.preferred.get(id);
  if (preferred) {
    const children = overlayChildren(document, overlay, id);
    if (children.includes(preferred) && !overlay.deleted.has(preferred)) return preferred;
  }
  // Fall back to node's own preferredChildId
  const node = overlayNode(document, overlay, id);
  if (!node) return undefined;
  const children = node.children;
  if (!children.length) return undefined;
  if (node.preferredChildId && children.includes(node.preferredChildId)) return node.preferredChildId;
  return children[0];
};

/**
 * Create a virtual GameDocument that merges the draft overlay with the base
 * document. This allows boardAt, pathToNode, nextPlayerAt, preferredNext, etc.
 * to work correctly for draft-created nodes without materializing the full
 * compact tree. The returned document's `nodes` is a Proxy that resolves every
 * ID through overlayNode.
 */
export const projectedDocument = (document: GameDocument, overlay: DraftOverlay): GameDocument => {
  const nodes: Record<string, RecordNode> = new Proxy({} as Record<string, RecordNode>, {
    get: (_target, property: string | symbol) => {
      if (typeof property !== "string") return undefined;
      if (property === PROJECTED_NODES_MARKER) return true;
      return overlayNode(document, overlay, property);
    },
    has: (_target, property: string | symbol) => {
      if (typeof property !== "string") return false;
      if (overlay.deleted.has(property)) return false;
      if (overlay.added.has(property)) return true;
      return property in document.nodes;
    },
    ownKeys: () => {
      const keys = new Set([...Object.keys(document.nodes), ...overlay.added.keys()]);
      for (const deleted of overlay.deleted) keys.delete(deleted);
      return [...keys];
    },
    getOwnPropertyDescriptor: (_target, property: string | symbol): PropertyDescriptor | undefined => {
      if (typeof property !== "string") return undefined;
      const node = overlayNode(document, overlay, property);
      if (!node) return undefined;
      return { enumerable: true, configurable: true, value: node };
    },
  });
  compactRegisterAlias(document, nodes);
  return { ...document, nodes };
};

/**
 * 批量替换注释/局面文字 → 一串草稿操作（audit 2026-09-17）。
 *
 * 批量替换以前直接 `saveToLibrary` 落库，绕过草稿系统，替换错了无法回退
 * （「撤销」只认同一份棋谱自己的草稿）。改成产出 `update-node` 操作后，
 * 用户可以在那份棋谱里正常撤销/放弃。文本替换本身与落库方式无关，所以放在这里好测。
 */
export const buildBatchReplaceOperations = (nodes: Record<string, RecordNode>, from: string, to: string): DraftOperation[] => {
  if (!from) return [];
  const operations: DraftOperation[] = [];
  for (const [nodeId, node] of Object.entries(nodes)) {
    const comment = node.comment?.includes(from) ? node.comment.split(from).join(to) : node.comment;
    const boardText = node.boardText?.includes(from) ? node.boardText.split(from).join(to) : node.boardText;
    if (comment === node.comment && boardText === node.boardText) continue;
    operations.push({ type: "update-node", nodeId, patch: { comment, boardText } });
  }
  return operations;
};

/**
 * 给每步草稿操作起一个人话名字（audit 2026-09-17）。
 *
 * 「撤销」原来只有两个按钮、没有历史面板，用户连自己刚才改了什么都要靠记忆。
 * 有了名字才能列出「改注释 / 落子 H8 / 删除分支」这样的可读历史，进而跳着回退。
 */
export const draftOperationLabel = (operation: DraftOperation, boardSize = 15): string => {
  switch (operation.type) {
    case "add-move": {
      const move = operation.node.move;
      return move ? `落子 ${coordinateName(move, boardSize)}` : "落子";
    }
    case "add-subtree":
      return `粘贴分支（${Object.keys(operation.nodes).length} 个局面）`;
    case "delete-subtree":
      return "删除分支";
    case "update-node": {
      const { comment, boardText, marks, evaluation, evaluationLevel } = operation.patch;
      if (comment !== undefined) return comment ? "改注释" : "清空注释";
      if (boardText !== undefined) return "改局面文字";
      if (marks !== undefined) return "改棋盘标注";
      if (evaluation !== undefined || evaluationLevel !== undefined) return "改评价";
      return "修改局面";
    }
    case "set-mainline":
      return "切换主分支";
    default:
      return "编辑";
  }
};

/** Apply draft operations to a regular (non-compact) document. For compact * documents, use projectedDocument for reads and saveDraftForDocument for
 * persistence. Handles all four operation types. */
export const applyDraftToDocument = (document: GameDocument, operations: DraftOperation[]): GameDocument => {
  let next = document;
  for (const operation of operations) {
    if (operation.type === "add-move") {
      const parent = next.nodes[operation.parentId];
      if (!parent) continue;
      next = {
        ...next,
        nodes: {
          ...next.nodes,
          [operation.parentId]: {
            ...parent,
            children: [...parent.children, operation.node.id],
            // Mirror addMove (game.ts): the move just played is the main line,
            // unless the user had already pinned a different child as main line.
            preferredChildId: parent.preferredChildId && parent.preferredChildId !== operation.node.id
              && parent.children.includes(parent.preferredChildId)
              ? parent.preferredChildId
              : operation.node.id,
          },
          [operation.node.id]: operation.node,
        },
      };
    } else if (operation.type === "add-subtree") {
      const parent = next.nodes[operation.parentId];
      const root = operation.nodes[operation.rootId];
      if (!parent || !root) continue;
      next = {
        ...next,
        nodes: {
          ...next.nodes,
          ...operation.nodes,
          [operation.parentId]: {
            ...parent,
            children: parent.children.includes(operation.rootId) ? parent.children : [...parent.children, operation.rootId],
            preferredChildId: operation.rootId,
          },
        },
      };
    } else if (operation.type === "update-node") {
      const node = next.nodes[operation.nodeId];
      if (!node) continue;
      next = {
        ...next,
        nodes: { ...next.nodes, [operation.nodeId]: { ...node, ...operation.patch } },
      };
    } else if (operation.type === "delete-subtree") {
      const removed = new Set<string>([operation.rootId]);
      const visit = (id: string) => {
        const node = next.nodes[id];
        if (!node) return;
        for (const childId of node.children) {
          if (!removed.has(childId)) { removed.add(childId); visit(childId); }
        }
      };
      visit(operation.rootId);
      const nodes = Object.fromEntries(Object.entries(next.nodes).filter(([id]) => !removed.has(id)));
      if (operation.parentId && nodes[operation.parentId]) {
        const parent = nodes[operation.parentId];
        nodes[operation.parentId] = {
          ...parent,
          children: parent.children.filter((id) => id !== operation.rootId),
          preferredChildId: parent.preferredChildId === operation.rootId ? undefined : parent.preferredChildId,
        };
      }
      next = { ...next, nodes };
    } else if (operation.type === "set-mainline") {
      const parent = next.nodes[operation.parentId];
      if (!parent || !parent.children.includes(operation.childId)) continue;
      next = {
        ...next,
        nodes: { ...next.nodes, [operation.parentId]: { ...parent, preferredChildId: operation.childId } },
      };
    }
  }
  return next;
};
