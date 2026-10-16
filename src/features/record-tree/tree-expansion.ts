import { compactIndexOf, compactNodeId, compactNodeIndex } from "../../compact-index";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "../../types";

/** Above this many nodes the height pass is skipped and the main line is followed instead. */
const CHAIN_HEIGHT_NODE_CAP = 400_000;
/** Safety net for the light-weight walk (cycles, corrupted sibling chains). */
const CHAIN_LENGTH_CAP = 20_000;

interface NumericFrame { node: number; child: number; best: number }
interface NodeFrame { id: string; child: number; best: number }

/**
 * The single longest root-to-end line of the record. The branch tree shows this
 * line expanded by default, so a record whose current path is short still reads
 * as a tree instead of a row of dead-end stubs.
 *
 * Large lazy records skip the full height pass and fall back to the RenLib main
 * line (preferredChild chain), which is what the record itself marks as primary.
 */
export const treeLongestChainIds = (document: GameDocument): Set<string> => {
  const index = compactIndexOf(document);
  if (index) return index.nodeCount > 0 && index.nodeCount <= CHAIN_HEIGHT_NODE_CAP
    ? chainFromIndex(document, index)
    : chainFromPreferredChild(document);
  return Object.keys(document.nodes).length > CHAIN_HEIGHT_NODE_CAP
    ? chainFromPreferredChild(document)
    : chainFromNodes(document);
};

const chainFromIndex = (document: GameDocument, index: CompactRenLibIndex): Set<string> => {
  const count = index.nodeCount;
  const rootIndex = compactNodeIndex(document, document.rootId) ?? 0;
  const height = new Int32Array(count);
  const seen = new Uint8Array(count);
  const stack: NumericFrame[] = [];
  if (rootIndex >= 0 && rootIndex < count) {
    seen[rootIndex] = 1;
    stack.push({ node: rootIndex, child: index.firstChild[rootIndex] ?? -1, best: 0 });
  }
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const child = frame.child;
    if (child >= 0 && child < count) {
      frame.child = index.nextSibling[child] ?? -1;
      if (!seen[child]) {
        seen[child] = 1;
        stack.push({ node: child, child: index.firstChild[child] ?? -1, best: 0 });
      }
      continue;
    }
    stack.pop();
    height[frame.node] = frame.best;
    const parent = stack[stack.length - 1];
    if (parent && frame.best + 1 > parent.best) parent.best = frame.best + 1;
  }
  const ids = new Set<string>();
  let current = rootIndex, guard = 0;
  while (current >= 0 && current < count && guard < CHAIN_LENGTH_CAP && !ids.has(compactNodeId(index, current))) {
    ids.add(compactNodeId(index, current));
    guard += 1;
    let best = -1, next = -1;
    for (let child = index.firstChild[current] ?? -1; child >= 0 && child < count; child = index.nextSibling[child] ?? -1) {
      if (height[child] > best) { best = height[child]; next = child; }
    }
    current = next;
  }
  return ids;
};

const chainFromNodes = (document: GameDocument): Set<string> => {
  const nodes = document.nodes;
  const root = document.rootId;
  if (!nodes[root]) return new Set();
  const height = new Map<string, number>();
  const seen = new Set<string>([root]);
  const stack: NodeFrame[] = [{ id: root, child: 0, best: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const children = nodes[frame.id]?.children || [];
    if (frame.child < children.length) {
      const childId = children[frame.child];
      frame.child += 1;
      if (childId && !seen.has(childId) && nodes[childId]) {
        seen.add(childId);
        stack.push({ id: childId, child: 0, best: 0 });
      }
      continue;
    }
    stack.pop();
    height.set(frame.id, frame.best);
    const parent = stack[stack.length - 1];
    if (parent && frame.best + 1 > parent.best) parent.best = frame.best + 1;
  }
  return walkHeights(document, root, (id) => height.get(id) ?? -1);
};

const chainFromPreferredChild = (document: GameDocument): Set<string> => {
  const ids = new Set<string>();
  let current = document.rootId;
  let guard = 0;
  while (current && guard < CHAIN_LENGTH_CAP && !ids.has(current)) {
    ids.add(current);
    guard += 1;
    const node = document.nodes[current];
    if (!node) break;
    const preferred = node.preferredChildId && node.children.includes(node.preferredChildId) ? node.preferredChildId : undefined;
    current = preferred || node.children[0];
  }
  return ids;
};

const walkHeights = (document: GameDocument, root: string, heightOf: (id: string) => number): Set<string> => {
  const ids = new Set<string>();
  let current: string | undefined = root;
  let guard = 0;
  while (current && guard < CHAIN_LENGTH_CAP && !ids.has(current)) {
    ids.add(current);
    guard += 1;
    const children = document.nodes[current]?.children || [];
    let best = -1, next: string | undefined;
    for (const childId of children) {
      if (!document.nodes[childId]) continue;
      const value = heightOf(childId);
      if (value > best) { best = value; next = childId; }
    }
    current = next;
  }
  return ids;
};

/**
 * 棋谱自己的主分支（对应智子的 main branch）：每个分叉先看 preferredChildId
 * ——「设为主分支」写的就是它（SGF 第一支、RenLib / DP 的主线导入时也是它）——
 * 没设置才退回「子树最高的那一支」。图谱的默认视野与「当前位于主分支上」
 * 的判断都以这条线为准。
 *
 * 大型懒加载谱与 treeLongestChainIds 同一取舍：跳过整树高度 pass，
 * 直接沿 preferred 链走（children[0] 兜底），保证始终走到一条叶子。
 */
export const recordMainLineIds = (document: GameDocument): Set<string> => {
  const index = compactIndexOf(document);
  if (index) return chainFromPreferredChild(document);
  if (Object.keys(document.nodes).length > CHAIN_HEIGHT_NODE_CAP) return chainFromPreferredChild(document);
  const nodes = document.nodes;
  const root = document.rootId;
  if (!nodes[root]) return new Set();
  const height = new Map<string, number>();
  const seen = new Set<string>([root]);
  const stack: NodeFrame[] = [{ id: root, child: 0, best: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const children = nodes[frame.id]?.children || [];
    if (frame.child < children.length) {
      const childId = children[frame.child];
      frame.child += 1;
      if (childId && !seen.has(childId) && nodes[childId]) {
        seen.add(childId);
        stack.push({ id: childId, child: 0, best: 0 });
      }
      continue;
    }
    stack.pop();
    height.set(frame.id, frame.best);
    const parent = stack[stack.length - 1];
    if (parent && frame.best + 1 > parent.best) parent.best = frame.best + 1;
  }
  const ids = new Set<string>();
  let current: string | undefined = root;
  let guard = 0;
  while (current && guard < CHAIN_LENGTH_CAP && !ids.has(current)) {
    ids.add(current);
    guard += 1;
    const node: RecordNode | undefined = nodes[current];
    if (!node) break;
    const children: string[] = node.children.filter((childId: string) => Boolean(nodes[childId]));
    if (!children.length) break;
    if (node.preferredChildId && children.includes(node.preferredChildId)) { current = node.preferredChildId; continue; }
    let best = -1, next: string | undefined;
    for (const childId of children) {
      const value = height.get(childId) ?? -1;
      if (value > best) { best = value; next = childId; }
    }
    current = next;
  }
  return ids;
};

/**
 * Give each sibling subtree a continuous lane range. First-child continuations
 * stay horizontal; other subtrees begin after the preceding subtree's full span.
 * One layout serves default, per-branch and whole-tree expansion alike.
 */
export const assignTreeRows = <T extends { id: string; parentId: string | null }>(entries: readonly T[]): Map<string, number> => {
  const children = new Map<string, string[]>();
  const ids = new Set(entries.map((entry) => entry.id));
  const roots: string[] = [];
  for (const entry of entries) {
    if (!entry.parentId || !ids.has(entry.parentId)) roots.push(entry.id);
    else {
      const list = children.get(entry.parentId) ?? [];
      list.push(entry.id);
      children.set(entry.parentId, list);
    }
  }
  const order: string[] = [], seen = new Set<string>();
  const stack = [...roots].reverse();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const list = children.get(id) ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) stack.push(list[i]);
  }
  const spans = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const list = children.get(order[i]) ?? [];
    spans.set(order[i], list.length ? list.reduce((sum, id) => sum + (spans.get(id) ?? 1), 0) + (list.length - 1) * 0.35 : 1);
  }
  const rows = new Map<string, number>();
  let rootRow = 0;
  for (const id of roots) { rows.set(id, rootRow); rootRow += spans.get(id) ?? 1; }
  for (const id of order) {
    let row = rows.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      rows.set(child, row);
      row += (spans.get(child) ?? 1) + 0.35;
    }
  }
  return rows;
};

/**
 * 这一手**下面已加载的子树还有几层**——「展开下一层」最多还能点几次。
 *
 * ## 为什么需要它（群友 2026-10-11：「一个分支点不开，但可以一直点，收回分支那里加到 50」）
 *
 * `RecordTreePanel.expandBranch` 旧实现每点一次**无条件**给 `openLevels` +1；
 * 而按钮的可用判据（`canExpandBranch`）把 `unloadedChildren`（懒加载源里还没读回来的
 * 分支数）也算作「还有得展」。两者一叠加就有个缺口：
 *
 * - 库里说「这个局面后面还有东西」（`unloadedChildren > 0`）⇒ 按钮亮着；
 * - 但那一支读回来可能**就是个叶子**（实测九天指南第 7 手：两个候选里有一个没有后续）
 *   ⇒ 点了不产出任何节点，数字却照涨。群友连点到 50 就是这么来的。
 *
 * 所以「还能点几次」要有上界，而这个上界就是**已加载子树的高度**：
 * 逐层展开一层一数，高度 3 就是最多点 3 次（第 4 次按钮该灰）。
 *
 * 返回 `Number.POSITIVE_INFINITY` ＝「高度未知，允许继续点」：子树里还有没读回来的分支
 * 时就是这种。读回来之后（会话 `publish` 会重算投影）这里会自己变准，不需要额外同步。
 */
export const remainingLayersOf = (document: GameDocument, nodeId: string): number => {
  const index = compactIndexOf(document);
  const rootIndex = index ? compactNodeIndex(document, nodeId) : undefined;
  if (index && rootIndex !== undefined) {
    // Work on numeric links: iterating a lazy children proxy materialises every sibling.
    const seen = new Set<number>([rootIndex]);
    const stack: NumericFrame[] = [{ node: rootIndex, child: index.firstChild[rootIndex] ?? -1, best: 0 }];
    let height = 0;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const child = frame.child;
      if (child >= 0 && child < index.nodeCount) {
        frame.child = index.nextSibling[child] ?? -1;
        frame.best = Math.max(frame.best, 1);
        if (!seen.has(child)) {
          seen.add(child);
          if (seen.size > CHAIN_LENGTH_CAP) return Number.POSITIVE_INFINITY;
          stack.push({ node: child, child: index.firstChild[child] ?? -1, best: 0 });
        } else frame.child = -1;
        continue;
      }
      stack.pop();
      height = frame.best;
      const parent = stack[stack.length - 1];
      if (parent) parent.best = Math.max(parent.best, height + 1);
    }
    return height;
  }
  const seen = new Set<string>();
  const stack = [{ id: nodeId, depth: 0 }];
  let height = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    height = Math.max(height, frame.depth);
    if (seen.has(frame.id)) continue;
    seen.add(frame.id);
    if (seen.size > CHAIN_LENGTH_CAP) return Number.POSITIVE_INFINITY;
    const node = document.nodes[frame.id];
    if (!node) continue;
    if ((node.unloadedChildren || 0) > 0) return Number.POSITIVE_INFINITY;
    for (let child = node.children.length - 1; child >= 0; child -= 1) stack.push({ id: node.children[child], depth: frame.depth + 1 });
  }
  return height;
};
