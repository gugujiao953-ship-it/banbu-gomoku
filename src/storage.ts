import type { GameDocument } from "./types";
import type { DraftState } from "./draft-operations";
const LIBRARY_KEY = "renju-note-library-v1";
const ACTIVE_KEY = "renju-note-active-v1";
const DRAFT_PREFIX = "renju-note-draft-v2:";
export const saveDraftToLocal = (documentId: string, draft: DraftState) => {
  localStorage.setItem(`${DRAFT_PREFIX}${documentId}`, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
};
export const loadDraftFromLocal = (documentId: string): DraftState => {
  try {
    const value = JSON.parse(localStorage.getItem(`${DRAFT_PREFIX}${documentId}`) || "null");
    return value && Array.isArray(value.operations) && Array.isArray(value.redo)
      ? { operations: value.operations, redo: value.redo, metadata: value.metadata }
      : { operations: [], redo: [] };
  } catch { return { operations: [], redo: [] }; }
};
export const removeDraftFromLocal = (documentId: string) => localStorage.removeItem(`${DRAFT_PREFIX}${documentId}`);
export const loadLibrary = (): GameDocument[] => {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is GameDocument => Boolean(item?.id && item?.rootId && item?.nodes?.[item.rootId] && item?.metadata?.title && typeof item?.updatedAt === "string")) : [];
  } catch { return []; }
};
export const saveToLibrary = (document: GameDocument) => {
  const next = [document, ...loadLibrary().filter((item) => item.id !== document.id)].sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0) || a.id.localeCompare(b.id));
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); localStorage.setItem(ACTIVE_KEY, JSON.stringify(document)); return next;
};
export const renameInLibrary = (id: string, title: string) => {
  const normalized = title.trim();
  if (!normalized) throw new Error("棋谱名称不能为空");
  const now = new Date().toISOString();
  let renamed: GameDocument | undefined;
  const next = loadLibrary().map((document) => {
    if (document.id !== id) return document;
    renamed = { ...document, metadata: { ...document.metadata, title: normalized }, updatedAt: now };
    return renamed;
  });
  if (!renamed) throw new Error("棋谱不存在");
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  try {
    const active = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null") as GameDocument | null;
    if (active?.id === id) localStorage.setItem(ACTIVE_KEY, JSON.stringify({ ...active, metadata: { ...active.metadata, title: normalized }, updatedAt: now }));
  } catch { /* malformed active snapshots are ignored */ }
  return { library: next, document: renamed };
};
const canonicalNode = (document: GameDocument, nodeId: string, seen = new Set<string>()): unknown => {
  if (seen.has(nodeId)) return { cycle: true };
  seen.add(nodeId);
  const node = document.nodes[nodeId];
  if (!node) return { missing: true };
  const marks = [...(node.marks || [])].sort((a, b) => a.row - b.row || a.col - b.col || a.kind.localeCompare(b.kind) || (a.label || "").localeCompare(b.label || ""));
  return {
    move: node.move, passPlayer: node.passPlayer || null, setup: node.setup || null,
    comment: node.comment || "", boardText: node.boardText || "",
    evaluation: node.evaluation || "", evaluationLevel: node.evaluationLevel || 0, marks,
    preferredChildIndex: node.preferredChildId ? node.children.indexOf(node.preferredChildId) : -1,
    children: node.children.map((childId) => canonicalNode(document, childId, new Set(seen))),
  };
};
export const documentSignature = (document: GameDocument) => JSON.stringify({
  metadata: document.metadata,
  tree: canonicalNode(document, document.rootId),
});
export const saveManyToLibrary = (documents: GameDocument[]) => {
  const existing = loadLibrary();
  const merged = new Map(existing.map((document) => [document.id, document]));
  const bySignature = new Map(existing.map((document) => [documentSignature(document), document]));
  const resolved: GameDocument[] = [];
  let inserted = 0, duplicates = 0, conflicts = 0;
  documents.forEach((document, index) => {
    const signature = documentSignature(document);
    const duplicate = bySignature.get(signature);
    if (duplicate) { duplicates += 1; resolved.push(duplicate); return; }
    let candidate = document;
    if (merged.has(candidate.id)) {
      conflicts += 1;
      candidate = { ...candidate, id: `${candidate.id}-import-${Date.now().toString(36)}-${index}` };
    }
    merged.set(candidate.id, candidate); bySignature.set(signature, candidate); resolved.push(candidate); inserted += 1;
  });
  const next = [...merged.values()].sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0) || a.id.localeCompare(b.id));
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  return { library: next, resolved, inserted, duplicates, conflicts };
};
export const loadActive = (): GameDocument | null => {
  try { const value = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); return value?.rootId && value?.nodes?.[value.rootId] && value?.metadata?.title ? value : null; } catch { return null; }
};
export const removeFromLibrary = (id: string) => {
  const next = loadLibrary().filter((document) => document.id !== id);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  try {
    const active = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null") as GameDocument | null;
    if (active?.id === id) localStorage.removeItem(ACTIVE_KEY);
  } catch { localStorage.removeItem(ACTIVE_KEY); }
  removeDraftFromLocal(id);
  return next;
};
