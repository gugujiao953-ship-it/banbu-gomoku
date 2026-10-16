import type { BoardMark, GameDocument, Position, RecordNode } from "./types";

/**
 * DP/DB 局面数据库的「投影」：把按位置缓存的查询结果拼成一份可渲染的 GameDocument。
 *
 * 抽成纯函数是为了能单测——它决定了分支树能看到什么：
 *  · 每个「已加载」的局面都成为一个节点，子节点 = 已加载的那些分支；
 *  · 没查过的分支只记数量（`unloadedChildren`），树上画成一行「还有 N 支未加载」，
 *    而不是给每支都造一个占位节点——造占位节点会让投影从几百膨胀到上万个节点；
 *  · 节点 id 只由位置路径决定，所以换文档（预取回推）不会动到「我在哪」。
 */
export const DP_VIEW = Symbol("banbu-dp-database-view");
export type DpDocument = GameDocument & { [DP_VIEW]?: true };
export type DpBranch = { position: Position; label: string; value: number };
export type DpQuery = { comment: string; marks: BoardMark[]; branches: DpBranch[] };

export const dpPathKey = (path: Position[]) => path.map((point) => `${point.row.toString(16)}${point.col.toString(16)}`).join("-");
export const dpKeyToPath = (key: string): Position[] => key
  ? key.split("-").map((part) => ({ row: Number.parseInt(part[0], 16), col: Number.parseInt(part[1], 16) }))
  : [];
export const dpNodeIdFor = (base: GameDocument, path: Position[]) =>
  !path.length ? base.rootId : `${base.id}-dp-${dpPathKey(path)}`;

export interface DpProjectionInput {
  base: GameDocument;
  path: Position[];
  cache: Map<string, DpQuery>;
}

export const buildDpProjection = ({ base, path: currentPath, cache }: DpProjectionInput): { document: DpDocument; currentId: string } => {
  const nodes: Record<string, RecordNode> = {};
  const labelOf = (path: Position[]) => {
    if (!path.length) return undefined;
    const parent = cache.get(dpPathKey(path.slice(0, -1)));
    const last = path[path.length - 1];
    return parent?.branches.find((branch) => branch.position.row === last.row && branch.position.col === last.col)?.label;
  };
  const nodeFrom = (path: Position[], query: DpQuery | undefined): RecordNode => {
    const label = labelOf(path);
    return {
      id: dpNodeIdFor(base, path),
      parentId: path.length ? dpNodeIdFor(base, path.slice(0, -1)) : null,
      children: [],
      move: path.length ? { ...path[path.length - 1], player: (path.length - 1) % 2 ? "white" : "black" } : null,
      // DP 的当前局面标注已经作为原生标签挂在子记录上（见 queryDpPosition 的注释），
      // 这里不再把 query.marks 放进节点，否则每个 @BTXT@ 标签会在同一坐标画两遍。
      comment: query?.comment || "",
      marks: [],
      // 标签属于「父局面里的那一步」，所以从父查询的分支表里取。
      boardText: label || undefined,
      renLibNativeLabel: Boolean(label),
      renLibLabelColor: label ? "#1d1c19" : undefined,
      // 子树没查过的局面：只记「还有几支没加载」，树上画成一行提示（点一下读取）。
      // 这里刻意不给每支造占位节点：900 个已加载局面 × 平均十几支 = 上万个节点，
      // 投影要 58ms 且每次走子都重建，正是「走一步就卡」的根因。
      unloadedChildren: undefined,
    };
  };

  // ① 已加载的局面逐个建出来
  for (const [key, query] of cache) nodes[dpNodeIdFor(base, dpKeyToPath(key))] = nodeFrom(dpKeyToPath(key), query);
  // ② 连边：每个局面的子节点 = 已加载的那些分支；没加载的只记数量（见 nodeFrom 的注释）
  for (const [key, query] of cache) {
    const path = dpKeyToPath(key);
    const node = nodes[dpNodeIdFor(base, path)];
    if (!node) continue;
    let unloaded = 0;
    for (const branch of query.branches) {
      const childPath = [...path, branch.position];
      const childId = dpNodeIdFor(base, childPath);
      const child = nodes[childId];
      if (child) {
        if (!node.children.includes(childId)) node.children.push(childId);
        continue;
      }
      unloaded += 1;
    }
    if (unloaded) node.unloadedChildren = unloaded;
    // 棋盘与导航都靠 preferredChildId：当前路径上的下一手优先，否则取第一支。
    const onCurrentPath = dpPathKey(currentPath.slice(0, path.length)) === key;
    const pathChild = onCurrentPath && path.length < currentPath.length ? dpNodeIdFor(base, currentPath.slice(0, path.length + 1)) : undefined;
    node.preferredChildId = pathChild && node.children.includes(pathChild) ? pathChild : node.children[0];
  }
  const currentId = dpNodeIdFor(base, currentPath);
  // `partial: true`＝这是投影而非完整棋谱（见 GameDocument.partial 的说明）。
  // 它比 DP_VIEW 那个 Symbol 多活一件事：**能随对象展开传进「编辑副本」**，
  // 于是副本上的「同型局面 / 查找 / 复制分支」也照样知道自己是子集。
  const document: DpDocument = { ...base, nodes, savedCurrentId: currentId, partial: true };
  Object.defineProperty(document, DP_VIEW, { value: true });
  return { document, currentId };
};

export const isDpDatabaseView = (document: GameDocument) => Boolean((document as DpDocument)[DP_VIEW]);
