import { applyDraftToDocument, type DraftOperation } from "../../draft-operations";
import type { GameDocument, RecordNode } from "../../types";
import type { RecordBookmark } from "./bookmarks";
import { copyRecordSubtree, pasteRecordSubtree } from "./subtree-clipboard";
import { samePositionNodes, type TranspositionIndex } from "./transposition";
import { boardAt, nextPlayerAt, pathToNode } from "../../game";
import { positionKey } from "../../position-search";

/**
 * 同型局面**合并**（用户 2026-10-10：「不是合并分支的意思吗」）。
 *
 * ## 和「标记 + 跳转」的区别（这是两件事，别混）
 *
 * - **标记 + 跳转**（`transposition.ts`，RenLib 的做法）：棋谱一个字节不动，只在界面上
 *   指出「这几手其实是同一个局面」并让你跳过去。适合**看**。
 * - **合并**（本文件）：真的把重复的那几处收成一处——**后续搬到保留方，多余的那个删掉**。
 *   适合**整理**（把一份转置满天飞的定式稿理顺）。
 *
 * 两件事都保留，界面上分开：列表里点一条＝跳过去（看），另一枚按钮＝并入（整理）。
 *
 * ## 为什么合并之后仍然是「树」，没有变成 DAG
 *
 * 群友当时担心：「合并局面的父节点不会是唯一的，跟树的设计冲突」——如果做的是
 * 「两个父节点共享同一棵子树」，那确实就是 DAG，`.lib`/SGF 都表达不了。
 *
 * 这里的做法绕开了它：**搬，不共享**。把重复局面的下一手整棵子树**复制到保留方**，
 * 再把那个多余的重复节点**删掉**。于是每个节点仍然只有一个父节点——**结果是严格的树**，
 * 跟既有的一切（SGF 导出、草稿、撤销、路径语义）完全兼容。
 *
 * 代价说清楚：搬过去的是**复制品**（新节点 id），原来那一份被删。这跟「共享同一棵子树」
 * 的观感不同。如果两边的后续不同，保留方会同时拥有两边的后续；若下一手重叠，
 * 则保留来源分支，避免丢失更深处的独有变化。旋转或镜像局面也先保留，等待坐标转换。
 *
 * ## 可撤销
 *
 * 产出的是一串普通草稿操作（`add-subtree` + `delete-subtree`），走既有的
 * `recordDraft` → 撤销/重做 → 保存。**不是**直接改棋谱，所以点错了能整体回退。
 */

const directMoveKey = (node: RecordNode | undefined) =>
  !node ? null : node.move ? `move:${node.move.player}:${node.move.row},${node.move.col}` : node.passPlayer ? `pass:${node.passPlayer}` : null;

const annotationsOf = (node: RecordNode) => JSON.stringify({
  comment: node.comment || "", marks: node.marks || [], boardText: node.boardText || "",
  evaluation: node.evaluation, evaluationLevel: node.evaluationLevel,
  renLibAnnotations: node.renLibAnnotations, renLibFlags: node.renLibFlags,
  renLibExtendedFlags: node.renLibExtendedFlags, renLibMark: node.renLibMark,
});

export interface MergeSamePositionsResult {
  ok: boolean;
  /** 失败原因（ok=false 时给界面直接显示）。 */
  reason?: string;
  /** 产出的草稿操作；交给 App 一次性 recordDraft，可整体撤销。 */
  operations: DraftOperation[];
  /** 合并后的文档（仅供界面预演/计数，真正落盘仍走草稿）。 */
  document: GameDocument;
  /** 实际搬过去的子树棵数。 */
  movedSubtrees: number;
  /** 被合并掉的重复节点数。 */
  removedNodes: number;
  /**
   * 跳过没搬的原因（逐条，给界面如实说）。
   * 下一手重叠、标注不同、对称朝向不同或复制失败时，保留来源分支并说明原因。
   */
  notices: string[];
}

/**
 * 把 `keeperId` 以外的同型局面并入 `keeperId`。
 *
 * @param protectedIds 不许删的节点（通常是**当前路径**上的——删了用户的光标就没了）。
 *                     落在里面的同型节点会保留、只出提示，不静默跳过。
 */
export const mergeSamePositions = (
  document: GameDocument,
  index: TranspositionIndex | null,
  keeperId: string,
  options: { bookmarks?: RecordBookmark[]; protectedIds?: ReadonlySet<string> } = {},
): MergeSamePositionsResult => {
  const bookmarks = options.bookmarks ?? [];
  const protectedIds = options.protectedIds ?? new Set<string>();
  const empty = { operations: [] as DraftOperation[], movedSubtrees: 0, removedNodes: 0, notices: [] as string[] };
  if (!index) return { ok: false, reason: "这份棋谱还不能做同型查找", document, ...empty };
  const keeper = document.nodes[keeperId];
  if (!keeper) return { ok: false, reason: "找不到要保留的那一手", document, ...empty };
  const donors = samePositionNodes(index, document, keeperId);
  if (!donors.length) return { ok: false, reason: "这个局面没有其它同型的节点", document, ...empty };
  const keeperPosition = positionKey(boardAt(document, keeperId), nextPlayerAt(document, keeperId), false);

  let working = document;
  const operations: DraftOperation[] = [];
  const notices: string[] = [];
  let movedSubtrees = 0;
  let removedNodes = 0;

  for (const donorId of donors) {
    const donor = working.nodes[donorId];
    if (!donor) continue;
    if (protectedIds.has(donorId)) {
      notices.push("有一处同型在当前路径上，已保留没动它");
      continue;
    }
    if (!donor.parentId || pathToNode(working, keeperId).some((node) => node.id === donorId)
      || [...protectedIds].some((id) => pathToNode(working, id).some((node) => node.id === donorId))) {
      notices.push("有一处同型包含需要保留的路径，已保留没动它");
      continue;
    }
    // The search index groups rotations/mirrors, but clipboard coordinates remain absolute.
    // Until subtree coordinates and annotations can be transformed, preserve that branch.
    if (positionKey(boardAt(working, donorId), nextPlayerAt(working, donorId), false) !== keeperPosition) {
      notices.push("有一处对称局面需要转换后续坐标，已保留来源分支");
      continue;
    }
    if (annotationsOf(donor) !== annotationsOf(working.nodes[keeperId])) {
      notices.push("有一处同型含不同的注释或标注，已保留以免丢失");
      continue;
    }
    let allChildrenCopied = true;
    // 先搬后代：把 donor 的每个孩子整棵子树复制到 keeper 下。
    // 用既有的 copy/paste（它自带合法性、轮次、禁手、重复着法的校验），不自己造轮子。
    for (const childId of [...donor.children]) {
      const child = working.nodes[childId];
      if (!child) { allChildrenCopied = false; continue; }
      const childKey = directMoveKey(child);
      // 每次都从 working 现读保留方的孩子：前面几轮搬过去的要在这一轮也算数，
      // 否则同一批里两处重复的后代会互相撞在同一个着法上。
      const keeperChildren = working.nodes[keeperId]?.children ?? [];
      const keeperHasSame = childKey !== null && keeperChildren.some((id) => directMoveKey(working.nodes[id]) === childKey);
      if (keeperHasSame) {
        // A matching next move does not prove both subtrees are identical.
        // Keep the donor until its unique descendants/annotations can be merged.
        allChildrenCopied = false;
        notices.push("有一处后续着法相同，已保留来源分支以免丢失深层变化");
        continue;
      }
      const clipboard = copyRecordSubtree(working, childId, bookmarks);
      if (!clipboard) { allChildrenCopied = false; notices.push("有一处后续读不出来，已保留来源分支"); continue; }
      const pasted = pasteRecordSubtree(working, keeperId, clipboard);
      if (!pasted.ok) { allChildrenCopied = false; notices.push(`有一处后续没搬过去，已保留来源分支：${pasted.reason}`); continue; }
      const operation: DraftOperation = { type: "add-subtree", parentId: keeperId, rootId: pasted.rootId, nodes: pasted.nodes, bookmarks: pasted.bookmarks };
      operations.push(operation);
      working = applyDraftToDocument(working, [operation]);
      movedSubtrees += 1;
    }
    // 后代搬完再删那个多余的重复节点。
    if (!allChildrenCopied) continue;
    const removal: DraftOperation = { type: "delete-subtree", parentId: donor.parentId, rootId: donorId };
    operations.push(removal);
    working = applyDraftToDocument(working, [removal]);
    removedNodes += 1;
  }

  if (!operations.length) {
    return { ok: false, reason: notices[0] || "没有可合并的内容", document, operations: [], movedSubtrees: 0, removedNodes: 0, notices };
  }
  return { ok: true, operations, document: working, movedSubtrees, removedNodes, notices };
};

/**
 * 全谱有多少组可以合并（工具条用它决定「整理」入口要不要亮）。
 *
 * 条件写成「**没被保护的成员 ≥ 2**」是有讲究的：合并要留一个当保留方、至少要有一个
 * 别的才能当来源；而被保护的那些（当前路径上的）既不能删、当来源也会被跳过。
 * 所以只剩一个没被保护时这一组其实合不动（保留方就是它自己，没有来源）。
 */
export const countMergeableGroups = (index: TranspositionIndex | null, currentPath: ReadonlySet<string> = new Set()): number => {
  if (!index) return 0;
  let count = 0;
  for (const ids of index.byKey.values()) {
    if (ids.length < 2) continue;
    if (ids.filter((id) => !currentPath.has(id)).length >= 2) count += 1;
  }
  return count;
};
