import type { GameDocument, GameMetadata, PartialRecordNode, RecordNode } from "./types";
import { compactRegisterAlias } from "./compact-index";
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
  // Compute effective children: base minus deleted plus draft-added
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

/** Apply draft operations to a regular (non-compact) document. For compact
 * documents, use projectedDocument for reads and saveDraftForDocument for
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
