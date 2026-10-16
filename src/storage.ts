import type { GameDocument } from "./types";
import type { DraftState } from "./draft-operations";
const LIBRARY_KEY = "renju-note-library-v1";
const ACTIVE_KEY = "renju-note-active-v1";
const DRAFT_PREFIX = "renju-note-draft-v2:";
export const saveDraftToLocal = (documentId: string, draft: DraftState) => {
  const hasContent = draft.operations.length > 0 || Boolean(draft.metadata && Object.keys(draft.metadata).length);
  if (!hasContent) {
    localStorage.removeItem(`${DRAFT_PREFIX}${documentId}`);
    return;
  }
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
/** 形状上还能读的条目：id / rootId / 根节点三样缺一样是真的打不开了。 */
const isReadableRecord = (item: unknown): item is GameDocument => {
  const record = item as GameDocument | undefined;
  return Boolean(record?.id && record?.rootId && record?.nodes?.[record.rootId]);
};

/** 字段缺了就补，**不是丢掉**。老代码在这里把「没有标题 / 没有 updatedAt」的条目 filter 掉，
 *  而 `saveToLibrary` 又把过滤后的数组整体写回 localStorage —— 等于**读一次就永久删掉**这些棋谱。
 *  用户 10-06 报的「一份全新的谱，保存后关闭软件再进去就没了」必须先排除这条路径。 */
const repairRecord = (item: GameDocument): GameDocument => {
  const title = typeof item.metadata?.title === "string" && item.metadata.title.trim() ? item.metadata.title : "未命名棋谱";
  const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date().toISOString();
  return item.metadata?.title === title && item.updatedAt === updatedAt ? item : { ...item, metadata: { ...item.metadata, title }, updatedAt };
};

export const loadLibrary = (): GameDocument[] => {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
    return Array.isArray(value) ? value.filter(isReadableRecord).map(repairRecord) : [];
  } catch { return []; }
};
export const saveToLibrary = (document: GameDocument) => {
  const stamped = repairRecord(document);
  const next = [stamped, ...loadLibrary().filter((item) => item.id !== stamped.id)].sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0) || a.id.localeCompare(b.id));
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); localStorage.setItem(ACTIVE_KEY, JSON.stringify(stamped)); return next;
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
/**
 * 库内重复检测（audit 2026-09-17）。
 *
 * 导入时的签名比对（saveManyToLibrary）只看得见"新来的"，用户库里早就攒下的重复
 * （多次导入同一批、备份恢复后再导入、改完名又存一份）从来没有任何地方能发现。
 * 这里按内容签名把整库扫一遍，分组返回——**只报告，不自动删**：同名不同谱、同谱
 * 不同注释都是合法存在，删哪个得由用户定。
 */
export interface DuplicateGroup {
  /** 内容签名相同的成员，按最近更新在前排序。 */
  members: GameDocument[];
}

export const findDuplicateRecords = (library?: GameDocument[]): DuplicateGroup[] => {
  const documents = library ?? loadLibrary();
  const bySignature = new Map<string, GameDocument[]>();
  for (const document of documents) {
    let signature: string;
    try {
      signature = documentSignature(document);
    } catch {
      // 结构损坏的记录签不出来，跳过它而不是让整个体检失败。
      continue;
    }
    const bucket = bySignature.get(signature);
    if (bucket) bucket.push(document);
    else bySignature.set(signature, [document]);
  }
  return [...bySignature.values()]
    .filter((members) => members.length > 1)
    .map((members) => ({
      members: [...members].sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0) || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => b.members.length - a.members.length);
};

/** 体检汇总：重复组数、可清理的多余份数。 */
export const duplicateSummary = (groups: DuplicateGroup[]) => ({
  groups: groups.length,
  redundant: groups.reduce((total, group) => total + group.members.length - 1, 0),
});

export const loadActive = (): GameDocument | null => {  try { const value = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); return value?.rootId && value?.nodes?.[value.rootId] && value?.metadata?.title ? value : null; } catch { return null; }
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
