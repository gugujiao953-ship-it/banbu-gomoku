import { boardAt, nextPlayerAt, pathToNode } from "../../game";
import { positionKey } from "../../position-search";
import type { GameDocument } from "../../types";

/**
 * 同型局面（殊途同归 / transposition）索引。
 *
 * ## 这个功能是什么、为什么这样做
 *
 * 定式研究里极常见：**两条不同的落子顺序走到同一个盘面**。用户希望分支树能把这种
 * 「殊途同归」认出来。群友当时提了一个很关键的问题：
 *
 *   「合并分支的话，分支树就不满足『树』的设计要求了……合并局面的父节点不会是唯一的」
 *
 * 这个判断**完全正确**——真合并就是 DAG，而我们的棋谱模型（SGF 的 `GameTree`、
 * RenLib 的 `.lib` 节点都只有「下一个」与「同级下一个」两个指针）是严格树。
 * 但业界所有成熟工具给出的答案是同一个：**不要去改数据模型，把同型关系做成查看器里的
 * 计算视图**。逐家核对过：
 *
 * - **RenLib**（连珠事实标准，读了源码 `MoveNode.h`）：节点只有 `mDown`（下一层）与
 *   `mRight`（同级），仍是严格树；`Find Same Position [Ctrl+P]` / `Auto Find Same Position`
 *   搜出来的结果是**运行时的 `mMatch` 字段，`getPosInfo()` 不序列化它**——`.lib` 文件里
 *   **没有**转置标志位。界面上把跨分支的同型着法画成**另一种颜色的小圆点**，点击就跳到
 *   那条分支（必要时连棋盘朝向一起转，让局面看起来一样）。
 * - **SCID**（国际象棋）：`Merge game` 会用转置知识找最深共同点来决定挂载位置，但**结果
 *   仍是一条新分支**，不是共享子树。
 * - **LiChess Tools**（浏览器扩展）：唯一真做物理合并的——但它把 `Normalize`
 *   （合并）与 `Denormalize`（还原）做成**用户主动触发、可逆**的操作，而且合并只发生在
 *   内存里，不写进 PGN。
 * - **Sabaki**（SGF 编辑器）issue #787：维护者明确说全量比对代价太高，**最多做个手动触发的
 *   搜索**；社区给的解法就是「维护一张 局面 → 节点列表 的哈希表」。
 * - **SGF FF[4] 规范**：EBNF 是纯树，属性表里**没有任何**「指向另一节点/另一局面」的属性。
 *
 * 所以本模块只做**索引与查询**：给「当前这一手」找出**别处的同型局面**，交给界面标出来并
 * 支持跳过去。不新建节点、不改父子指针、不写进棋谱、不落盘。
 *
 * ## 键怎么算
 *
 * 直接复用 `positionKey`（跨谱局面检索用的那一个），因为它已经处理了三件必须对齐的事：
 * ① **走子顺序无关**（按「格号+颜色」排序后拼接）；② **八向对称归一**（旋转 + 镜像，
 * 取字典序最小的那个变体——等价于 RenLib 的 `Position::Match` 八张对称表）；
 * ③ **行棋方参与**（同型局面若轮次不同，在连珠里是**不同的**局面，不能算同型）。
 */
export interface TranspositionIndex {
  /** 局面键 → 该局面的全部节点 id（按先序，先出现的在前）。 */
  byKey: Map<string, string[]>;
  /** 节点 id → 它的局面键（跳转时要拿来查对面）。 */
  keyOf: Map<string, string>;
  /** 节点 id → 手数（第几手；过手也计一手，与树的显示口径一致）。 */
  turnOf: Map<string, number>;
  /** 建索引时是否因为节点太多被截断（超大棋谱按需窗口）。 */
  truncated: boolean;
}

/**
 * 一份棋谱里最多索引多少个节点。
 *
 * 与 `node-search.ts` 的 `MAX_INDEX_NODES`（20000）同一个量级与理由：单次建索引要跑
 * 「逐节点算局面键」，而局面键本身是 O(空格×8 对称) 的字符串活——几百毫秒级。
 * 超过上限就只索引前一部分，并如实把 `truncated` 报出去，由界面写清楚
 * （「超大棋谱只索引了前面一部分」，与搜索框的既有说法一致）。
 *
 * 对大型库（按需窗口，`compactIndexOf` 有值，节点是懒加载的）**不建索引**：
 * 那种棋谱的 `document.nodes` 只有当前可视分支，遍历它既慢又得不到真实结果，
 * 界面会直接说「大型棋谱暂不做同型查找」，而不是给一个看起来像空结果的东西。
 */
export const MAX_TRANSPOSITION_NODES = 20000;

/**
 * 遍历整份棋谱，为每个节点算出局面键。
 *
 * 用显式栈（与 `buildNodeSearchIndex` 同款）而不是递归——长谱几千手递归会顶爆调用栈。
 * 局面用 `boardAt` 取（`game.ts` 里有 WeakMap 缓存，同一节点只算一次），
 * 行棋方用 `nextPlayerAt`（它已经处理了 SGF `PL`、摆局 `setup.nextPlayer` 与过手的优先级）。
 */
export const buildTranspositionIndex = (document: GameDocument): TranspositionIndex => {
  const byKey = new Map<string, string[]>();
  const keyOf = new Map<string, string>();
  const turnOf = new Map<string, number>();
  let truncated = false;
  const stack: Array<{ id: string; turn: number }> = [{ id: document.rootId, turn: 0 }];
  const seen = new Set<string>();
  while (stack.length) {
    const frame = stack.pop() as { id: string; turn: number };
    if (seen.has(frame.id)) continue;
    const node = document.nodes[frame.id];
    if (!node) continue;
    seen.add(frame.id);
    if (turnOf.size >= MAX_TRANSPOSITION_NODES) { truncated = true; continue; }
    const turn = frame.turn + (node.move || node.passPlayer ? 1 : 0);
    // 起始局面（第 0 手）不参与：每份棋谱都只有它一个，标出来只是噪音。
    if (turn > 0) {
      const key = positionKey(boardAt(document, frame.id), nextPlayerAt(document, frame.id));
      keyOf.set(frame.id, key);
      turnOf.set(frame.id, turn);
      const list = byKey.get(key);
      if (list) list.push(frame.id);
      else byKey.set(key, [frame.id]);
    }
    // 反向压栈：出栈顺序才是 children 的书写顺序（先序）。
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ id: node.children[index], turn });
    }
  }
  return { byKey, keyOf, turnOf, truncated };
};

/**
 * 某一手是不是「有同型」——即这一手的局面在**别处**还出现过。
 *
 * 注意「别处」的判定要用**同一路径**来排除：同一条主线上的两个节点不可能同型（连珠每手
 * 必落一子，局面只会变多），所以理论上不必判；但摆局（`setup` 去子）与过手能让同一条路径
 * 上真的重复出现同一局面，这时标出来是**对的**（RenLib 也提供 `excludeSameLine` 开关来关掉
 * 它，LiChess Tools 同样有这个设置）。这里默认保留：重复局面本身就是值得知道的事。
 */
export const isTransposition = (index: TranspositionIndex | null, nodeId: string): boolean => {
  if (!index) return false;
  const key = index.keyOf.get(nodeId);
  return Boolean(key && (index.byKey.get(key)?.length ?? 0) > 1);
};

/**
 * 找「这一手的同型局面在别处的那些节点」——界面用来列出来并支持跳转。
 *
 * @param excludeIds 要排除的节点（通常是当前路径上的节点、以及调用方已经展示过的）。
 */
export const samePositionNodes = (
  index: TranspositionIndex | null,
  document: GameDocument,
  nodeId: string,
  excludeIds?: ReadonlySet<string>,
): string[] => {
  if (!index) return [];
  const key = index.keyOf.get(nodeId);
  if (!key) return [];
  const all = index.byKey.get(key);
  if (!all || all.length < 2) return [];
  return all.filter((id) => id !== nodeId && !excludeIds?.has(id));
};

/**
 * 把一批同型节点按「离当前这一手的远近」排序，并标出各自在第几手。
 *
 * 排序规则与搜索一致（近的在前，同距离按手数小的在前）：用户点开一个同型提示，
 * 最想先看的是「和我现在这手差不多深、但在另一条枝上」的那一个。
 */
export interface SamePositionEntry {
  id: string;
  turn: number;
  /** 这一手离当前路径最近的共同祖先在第几手（-1 表示不共享任何祖先）。 */
  sharedTurn: number;
  /** 出现在当前路径上的哪一手之下（用于列表里写「在另一条枝·第 N 手之后」）。 */
  marker: string;
}

export const rankSamePositions = (
  index: TranspositionIndex | null,
  document: GameDocument,
  nodeId: string,
  currentPath: ReadonlySet<string>,
): SamePositionEntry[] => {
  const others = samePositionNodes(index, document, nodeId);
  if (!others.length) return [];
  const pathIds = new Set(pathToNode(document, nodeId).map((node) => node.id));
  const entries: SamePositionEntry[] = others.map((id) => {
    // 逐级上溯，找到与当前这一手最近的共同祖先：用来回答「它在哪条枝上」。
    const ancestors = new Set(pathToNode(document, id).map((node) => node.id));
    let shared = -1;
    pathToNode(document, nodeId).forEach((node, depth) => { if (ancestors.has(node.id)) shared = depth; });
    const onPath = currentPath.has(id);
    return {
      id,
      turn: index?.turnOf.get(id) ?? 0,
      sharedTurn: shared,
      marker: onPath ? "在当前路径上" : shared >= 0 ? `在第 ${shared} 手之后分出` : "另起一枝",
    };
  });
  // 近的在前：先按「共享祖先更深」（说明分叉点晚、离得近），再按手数小。
  return entries.sort((a, b) => (b.sharedTurn - a.sharedTurn) || (a.turn - b.turn));
};
