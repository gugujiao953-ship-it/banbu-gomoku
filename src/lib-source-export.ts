/**
 * LIB 导出：以「完整原谱」为底板，再叠加用户的草稿编辑。
 *
 * 为什么不能直接导出当前视图：打开 .lib 走的是官方核心（RenLibWebViewSession）的
 * **动态投影** —— 它只回答「当前路径上每个深度有哪些候选」，路径之外的每个分支都被
 * 建成 `children: []` 的一手叶子。直接把这个投影写回 LIB，原库里所有其余分支就被压成
 * 一手：用户「打开原 lib → 点一个新分枝 → 存为 lib → 再打开」，看到的就是「老的分枝
 * 只有一步、后面全没了」。
 *
 * 所以导出走：核心 lib2sgf（全库完整转换）→ 我们的 SGF 导入器 → 叠草稿 → exportLib。
 * 叠加按**位置路径**而不是节点 id：投影的 id 随导航漂移（同一节点在路径上叫
 * `…-renlib-<hex>`、作为候选时叫 `…-branch-<hex>`），草稿里记的 id 不可靠；
 * 而「从根走到某节点的落子序列」是两边都稳定且可对齐的。
 */
import { importRecordFile } from "./formats";
import { exportLib, type LibExportResult } from "./lib-export";
import { applyMarksToLibDocument, restoreMarksFromComments } from "./lib-mark-annotations";
import type { DraftOperation, DraftState } from "./draft-operations";
import type { GameDocument, RecordNode } from "./types";
import { stripLibPhantomNodes } from "./lib-mark-annotations";

export interface LibSourceExportInput {
  /** 官方核心会话；只用到 lib2sgf 这一项能力，便于测试注入。 */
  session: { exportOriginalSgf: () => Promise<ArrayBuffer> };
  draft: DraftState;
  /** 草稿所在的那份视图文档（投影 + 草稿 overlay），用来把节点 id 翻译成位置路径。 */
  viewDocument: GameDocument;
  /**
   * 叠加草稿**之前**的投影文档。解析 id 时必须先查它：`buildDraftOverlay` 会把被删除的
   * 节点放进 `overlay.deleted`，`projectedDocument` 的 `nodes[id]` 对这些节点返回
   * undefined，于是「删除某一分支」这条最需要解析的编辑反而解析不到位置（实测 bug：
   * 删除被静默跳过，导出的文件里那条分支还在）。缺省时退回只用 viewDocument。
   */
  sourceDocument?: GameDocument;
  /** 完整转换拿不到时的回落文档（沿用旧行为：导出当前所见）。 */
  fallback: GameDocument;
  /** 源文件里「有坐标但不是着法」的节点键（`RenLibWebViewSession.nonMoveNodeKeys`）。
   *  lib2sgf 会把这类空点标注写成着法，拿到它才能在底板上剔掉幻影节点。 */
  nonMoveKeys?: ReadonlySet<string>;
}

export interface LibSourceExportResult extends LibExportResult {
  /** true＝底板是完整原谱（不是动态投影），导出内容代表整份棋谱。 */
  complete: boolean;
}

const moveIdx = (node: RecordNode | undefined): number | null =>
  node?.move ? node.move.row * 15 + node.move.col : null;

/** 从某节点回溯到根的节点 id 链（含首尾）。`lookup` 先查叠加后的视图、再查叠加前的
 *  投影——被草稿删掉的节点只存在于后者。 */
const chainToRoot = (lookup: (id: string) => RecordNode | undefined, id: string): string[] | null => {
  const chain: string[] = [];
  let cursor: string | null = id;
  let guard = 0;
  while (cursor && guard < 200000) {
    const node: RecordNode | undefined = lookup(cursor);
    if (!node) return null;
    chain.push(cursor);
    cursor = node.parentId ?? null;
    guard += 1;
  }
  return chain.reverse();
};

const cloneDocument = (document: GameDocument): GameDocument => ({
  ...document,
  nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, { ...node, children: [...node.children] }])),
});

/**
 * 把视图里的一个节点对应到完整底板上的节点；沿途缺少的步骤按视图节点补建。
 *
 * 「底板里还没有这一步」是正常情况：核心给出的候选点（并不是原库里的着法）一旦被用户
 * 接着走棋，用户的意思就是这一步要成为真实分支，所以补建成节点而不是丢弃。
 */
const ensureNode = (
  base: GameDocument,
  lookup: (id: string) => RecordNode | undefined,
  viewId: string,
  warnings: string[],
): string | null => {
  const chain = chainToRoot(lookup, viewId);
  if (!chain) return null;
  let baseId = base.rootId;
  for (let index = 1; index < chain.length; index += 1) {
    const viewNode = lookup(chain[index]);
    if (!viewNode) {
      warnings.push("草稿引用的节点已经不在当前视图里，已跳过一部分编辑");
      return null;
    }
    const idx = moveIdx(viewNode);
    if (idx === null) {
      warnings.push("草稿引用了没有落子的节点，已跳过一部分编辑");
      return null;
    }
    const existing = (base.nodes[baseId]?.children || []).find((child) => moveIdx(base.nodes[child]) === idx);
    if (existing) { baseId = existing; continue; }
    const id = `merged-${chain.slice(1, index + 1).join("-")}`;
    base.nodes[id] = { ...viewNode, id, parentId: baseId, children: [] };
    base.nodes[baseId] = { ...base.nodes[baseId], children: [...base.nodes[baseId].children, id] };
    baseId = id;
  }
  return baseId;
};

const dropSubtree = (document: GameDocument, id: string) => {
  const removed = new Set<string>([id]);
  const visit = (current: string) => {
    for (const child of document.nodes[current]?.children || []) {
      if (removed.has(child)) continue;
      removed.add(child);
      visit(child);
    }
  };
  visit(id);
  const parentId = document.nodes[id]?.parentId;
  for (const gone of removed) delete document.nodes[gone];
  if (parentId && document.nodes[parentId]) {
    const parent = document.nodes[parentId];
    document.nodes[parentId] = {
      ...parent,
      children: parent.children.filter((child) => !removed.has(child)),
      preferredChildId: parent.preferredChildId && removed.has(parent.preferredChildId) ? undefined : parent.preferredChildId,
    };
  }
};

/** 按顺序把草稿操作叠到完整底板上。 */
const applyDraft = (
  base: GameDocument,
  viewRootId: string,
  lookup: (id: string) => RecordNode | undefined,
  operations: readonly DraftOperation[],
  warnings: string[],
): void => {
  const mapped = new Map<string, string>([[viewRootId, base.rootId]]);
  const resolve = (viewId: string): string | null => {
    const known = mapped.get(viewId);
    if (known !== undefined) return known;
    const found = ensureNode(base, lookup, viewId, warnings);
    if (found) mapped.set(viewId, found);
    return found;
  };
  for (const operation of operations) {
    if (operation.type === "add-move") {
      const parentId = resolve(operation.parentId);
      if (!parentId) { warnings.push("有一手编辑找不到落点，已跳过"); continue; }
      const id = `merged-add-${operation.node.id}`;
      if (!base.nodes[id]) {
        base.nodes[id] = { ...operation.node, id, parentId, children: [] };
        const parent = base.nodes[parentId];
        base.nodes[parentId] = { ...parent, children: [...parent.children, id], preferredChildId: id };
      }
      mapped.set(operation.node.id, id);
      continue;
    }
    if (operation.type === "add-subtree") {
      const parentId = resolve(operation.parentId);
      if (!parentId) { warnings.push("有一段编辑找不到落点，已跳过"); continue; }
      for (const node of Object.values(operation.nodes)) {
        base.nodes[node.id] = { ...node, children: [...node.children] };
        mapped.set(node.id, node.id);
      }
      const parent = base.nodes[parentId];
      if (parent && !parent.children.includes(operation.rootId)) {
        base.nodes[parentId] = { ...parent, children: [...parent.children, operation.rootId], preferredChildId: operation.rootId };
      }
      continue;
    }
    if (operation.type === "delete-subtree") {
      const target = resolve(operation.rootId);
      if (!target || target === base.rootId) { warnings.push("有一处删除找不到位置，已跳过"); continue; }
      dropSubtree(base, target);
      continue;
    }
    if (operation.type === "update-node") {
      const target = resolve(operation.nodeId);
      if (!target) { warnings.push("有一处批注编辑找不到位置，已跳过"); continue; }
      base.nodes[target] = { ...base.nodes[target], ...operation.patch, children: base.nodes[target].children };
      continue;
    }
    if (operation.type === "set-mainline") {
      const parentId = resolve(operation.parentId);
      const childId = resolve(operation.childId);
      if (!parentId || !childId || !base.nodes[parentId].children.includes(childId)) continue;
      base.nodes[parentId] = { ...base.nodes[parentId], preferredChildId: childId };
    }
  }
};

/**
 * 官方核心的 lib2sgf 把 RenLib 的「盘面文字」（节点标签 txt）写成**父节点上的
 * `LB[该节点位置:文字]`**，而不是独立属性（实测：`;B[hh]LB[ih:绝杀]`，ih 正是下一手
 * 自己的位置）。LIB 的标记位只是布尔值，带不带位置都没有别的含义，所以带文字且位置
 * 命中某个直接子节点的 LB 一定是这条编码，按同一约定还原成该子节点的 boardText 并从
 * 父节点上摘掉——否则「编辑后另存 LIB」会把原库的标签洗掉（旧路径导出投影时反而带着
 * 这些标签，那是回归）。
 */
const restoreBoardTextFromLabels = (document: GameDocument) => {
  // **每次都要从 document.nodes 取当前节点**：`Object.values` 是一次性快照，而下面
  // 会写 `document.nodes[childId]`。若继续用快照里的旧对象当底写回，就会把「上一步
  // 刚写进这个节点的盘面文字」覆盖掉——实测连续多个节点各带一个标记时（正是小工具 /
  // 九天指南那类棋谱的形态），只有最后一个的文字能活下来、前面的全被自己这轮抹掉。
  for (const id of Object.keys(document.nodes)) {
    const node = document.nodes[id];
    if (!node) continue;
    const labels = (node.marks || []).filter((mark) => mark.kind === "label" && mark.label);
    if (!labels.length) continue;
    const consumed = new Set<(typeof labels)[number]>();
    for (const mark of labels) {
      const childId = node.children.find((child) => {
        const candidate = document.nodes[child];
        return candidate?.move && candidate.move.row === mark.row && candidate.move.col === mark.col;
      });
      if (!childId) continue;
      const child = document.nodes[childId];
      if (!child) continue;
      if (!child.boardText) document.nodes[childId] = { ...child, boardText: mark.label };
      consumed.add(mark);
    }
    if (consumed.size) {
      const latest = document.nodes[id] ?? node;
      document.nodes[id] = { ...latest, marks: (latest.marks || []).filter((mark) => !consumed.has(mark)) };
    }
  }
};

/** 官方核心 lib2sgf 的 SGF → 文档，并按 NO_MOVE 语义剔掉空点标注造成的**幻影着法**。
 *  「完整 LIB 转 SGF」与「编辑后另存 LIB」两条路径共用这一份解析（含盘面文字/标注还原）。 */
export const documentFromCoreSgf = async (bytes: ArrayBuffer, nonMoveKeys?: ReadonlySet<string>): Promise<{ document: GameDocument; removed: number }> => {
  const raw = await parseSgfRaw(bytes);
  // ⚠ 顺序不能反：`restoreBoardTextFromLabels` 会把「父节点上的 LB[坐标:文字]」搬进
  // **那个坐标的子节点**（核心的编码约定）。空点标注的 LB 正好指向幻影着法节点，
  // 先还原就会把标注一起搬进去、再删节点时把标注也删掉（09-19 门禁 P4 实测）。
  // 所以先剔幻影，再还原文字与标注。
  const stripped = nonMoveKeys?.size ? stripLibPhantomNodes(raw, nonMoveKeys) : { document: raw, removed: 0 };
  // `restoreBoardTextFromLabels` 原地改 document.nodes、无返回值。
  restoreBoardTextFromLabels(stripped.document);
  return { document: restoreMarksFromComments(stripped.document), removed: stripped.removed };
};

/** 只做导入，不做 LIB 专属还原（还原见 `applyLibRestores`）。 */
const parseSgfRaw = async (bytes: ArrayBuffer): Promise<GameDocument> => {
  // 必须把**原始字节**交给导入器：核心的 SGF 声明 CA[gb2312]，若在这里先按 UTF-8 解
  // 就会把中文注释写成乱码（GBK 字节常常恰好是合法 UTF-8，不会报错）。
  const parsed = await importRecordFile(new File([bytes], "complete-lib.sgf", { type: "application/x-go-sgf" }));
  return parsed.document;
};

const parseSgfBytes = async (bytes: ArrayBuffer): Promise<GameDocument> => {
  const parsed = await parseSgfRaw(bytes);
  restoreBoardTextFromLabels(parsed);
  return restoreMarksFromComments(parsed);
};

/**
 * 导出 LIB。能拿到完整原谱时，导出的是「整份棋谱 + 用户编辑」，而不是当前视图。
 * 拿不到（无会话、源文件超过转换上限、核心转换失败）时回落到旧行为，并由调用方提示。
 */
export const libExportFromSource = async (input: LibSourceExportInput): Promise<LibSourceExportResult> => {
  const warnings: string[] = [];
  let base: GameDocument | null = null;
  try {
    const sgf = await input.session.exportOriginalSgf();
    if (sgf instanceof ArrayBuffer && sgf.byteLength > 0) {
      base = (await documentFromCoreSgf(sgf, input.nonMoveKeys)).document;
    }
  } catch {
    base = null;
  }
  if (!base) {
    const fallbackResult = exportLib(applyMarksToLibDocument(input.fallback).document);
    return { ...fallbackResult, complete: false };
  }
  const working = cloneDocument(base);
  const source = input.sourceDocument;
  // 先查叠加后的视图（草稿新增的节点只在这里），再查叠加前的投影（被草稿删掉的节点只在那里）。
  const lookup = (id: string): RecordNode | undefined =>
    input.viewDocument.nodes[id] || (source ? source.nodes[id] : undefined);
  applyDraft(working, input.viewDocument.rootId, lookup, input.draft.operations, warnings);
  // 标注走「注释清单 + 已有分支贴字形」两条不改结构的通道（见 lib-mark-annotations 的说明）。
  const marked = applyMarksToLibDocument(working);
  const result = exportLib(marked.document);
  return { bytes: result.bytes, warnings: [...result.warnings, ...warnings], complete: true };
};
