import { createDocument } from "../game";
import { importRenLibLegacy } from "../formats";
import type { GameDocument, Position, RecordNode } from "../types";
import { RenLibWebSession, type RenLibWebBranch, type RenLibWebBranchResult } from "./renlib-web-session";

/** 超过这个体积就不做"非着法节点"对照读取：超大库（开局库/DP 库）要保住惰性投影的轻快。 */
const NON_MOVE_SCAN_MAX_BYTES = 12 * 1024 * 1024;

const RENLIB_WEB_VIEW = Symbol("banbu-renlib-web-view");
type RenLibWebDocument = GameDocument & { [RENLIB_WEB_VIEW]?: true };

const idxToPosition = (idx: number): Position => ({ row: Math.floor(idx / 15), col: idx % 15 });
const positionToIdx = (position: Position) => position.row * 15 + position.col;

const commentText = (html?: string) => {
  if (!html) return "";
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  return (root.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
};

export class RenLibWebViewSession {
  private readonly core = new RenLibWebSession();
  private path: number[] = [];
  private readonly queries = new Map<number, RenLibWebBranchResult>();
  // The branch label belongs to the edge that was selected. Keep that small
  // piece of metadata when the edge becomes part of the current stone path;
  // otherwise the label is visible before the click and disappears exactly
  // when the user reaches the marked point.
  private readonly pathBranches = new Map<number, RenLibWebBranch>();
  /**
   * 记录里"有坐标但不是着法"的节点（官方模型 `isMove() = !NO_MOVE`），键是
   * `父路径坐标|本节点坐标`。对局软件用这种节点在**空点**上放标记；核心给前端的候选载荷
   * 里只有 `{idx, txt, level, color}`，**看不出**是不是着法，所以这里另外读一遍原文件来判定
   * （我方的 TS 读取器认 NO_MOVE 位：`isMove = (info & 0x02) === 0`）。
   * 不判定的话，这类标注到了我们这儿会变成"可以直接下的一手棋"——凭空多一颗子。
   */
  private readonly nonMoveKeys = new Set<string>();
  /**
   * **路径之外**那些分支的查询结果，键 = idx 路径串（`"112-127-142"`）。
   *
   * 为什么需要（群友 2026-10-10 报「花月黑必胜地毯.lib，打谱看得见、分支树里没有」）：
   * 旧实现只查**当前路径**上每一层的候选（`queries` 的键是「深度」），于是路径之外的分支
   * 在投影里永远是 `children: []` 的死端——它们的后续**在树里根本不存在**，
   * 虽然原始 LIB 里那一支后面还有整棵子树。这里补上「对任意路径按需查询」的能力。
   */
  private readonly branchQueries = new Map<string, RenLibWebBranchResult>();
  /** 已经问过核心的路径（含当前路径的每一层），决定哪些分支还该显示「未加载」。 */
  private readonly queriedPaths = new Set<string>();
  /**
   * 投影更新回调（与 DP 会话同名同义）。分支树按需展开一支之后，
   * 用 `this.onUpdate(projection().document)` 把长出来的子树回推给界面。
   * 由 App 的 attachDynamicSessionUpdates 注册（此前只给 DP 注册过）。
   */
  onUpdate?: (document: GameDocument) => void;
  private base?: GameDocument;

  private nodeId(depth: number) {
    if (!this.base || depth === 0) return this.base?.rootId || "renlib-web-root";
    return `${this.base.id}-renlib-${this.path.slice(0, depth).map((idx) => idx.toString(16)).join("-")}`;
  }

  private projection(): { document: GameDocument; currentId: string } {
    if (!this.base) throw new Error("RenLib 网页核心尚未打开");
    const depth = this.path.length;
    const nodes: Record<string, RecordNode> = {};
    for (let index = 0; index <= depth; index += 1) {
      const id = this.nodeId(index);
      const nextId = index < depth ? this.nodeId(index + 1) : undefined;
      const query = this.queries.get(index);
      nodes[id] = {
        id,
        parentId: index ? this.nodeId(index - 1) : null,
        children: nextId ? [nextId] : [],
        move: index ? { ...idxToPosition(this.path[index - 1]), player: index % 2 ? "black" : "white" } : null,
        comment: commentText(query?.innerHTML),
        marks: [],
        boardText: this.pathBranches.get(index)?.txt || undefined,
        renLibNativeLabel: Boolean(this.pathBranches.get(index)?.txt),
        renLibLabelColor: this.pathBranches.get(index)?.color,
        preferredChildId: nextId,
      };
    }

    // Preserve cached alternatives on every loaded position for the branch
    // tree and back-navigation. The board renders only the current node's
    // direct children, matching the source tool's current-path query model.
    for (let index = 0; index <= depth; index += 1) {
      const parentId = this.nodeId(index), parent = nodes[parentId];
      const selected = index < depth ? this.path[index] : undefined;
      // 该层父节点的"只算真着法"路径，用来查 nonMoveKeys（与 scanNonMoveNodes 的算法一致）
      const parentPath = this.path.slice(0, index)
        .map((idx) => `${idxToPosition(idx).row},${idxToPosition(idx).col}`).join("-");
      for (const branch of this.queries.get(index)?.nodes || []) {
        if (branch.idx === selected) continue;
        const id = `${parentId}-branch-${branch.idx.toString(16)}`;
        const point = idxToPosition(branch.idx);
        // 「有坐标但不是着法」的节点（对局软件就是这么在空点上放标记的）不能当成可下的一手：
        // 否则棋盘上凭空多一颗子、局面被改。按官方模型的原意挂成"非着法节点"，渲染成棋盘上的标记。
        const isNonMove = this.nonMoveKeys.has(`${parentPath}|${point.row},${point.col}`);
        /**
         * 这一支**自己的后续**：查过就把整棵子树铺出来，没查过就挂一个「还有后续」的标记。
         *
         * 旧实现这里恒为 `children: []` —— 于是分支树把它们显示成「分支末端」，
         * 用户以为下面没东西（群友 2026-10-10 报的「打谱看得见、树里没有」）。
         * 真实原因是 LIB 里那一支后面还有整棵子树，只是没问过核心。
         * 现在：问过的路径递归铺开（含它自己的其它分支），没问过的记 `unloadedChildren`，
         * 树面板据此给出展开入口（复用既有的「展开下一层」）。
         */
        const branchIdxPath = [...this.path.slice(0, index), branch.idx];
        const loaded = this.branchQueries.get(branchIdxPath.join("-"));
        nodes[id] = {
          id,
          parentId,
          children: [],
          move: isNonMove ? null : { ...point, player: index % 2 ? "white" : "black" },
          anchor: isNonMove ? { ...point } : undefined,
          comment: commentText(loaded?.innerHTML),
          marks: [],
          boardText: branch.txt || "",
          renLibNativeLabel: true,
          renLibLabelColor: branch.color,
          // 标注（非着法）节点没有后续；真着法分支在问过之前都算「后面还有」
          unloadedChildren: isNonMove || this.queriedPaths.has(branchIdxPath.join("-")) ? undefined : 1,
        };
        parent.children.push(id);
        if (!parent.preferredChildId && !isNonMove) parent.preferredChildId = id;
        // 查过的分支：把它的候选也铺进去（一层），让树能一路看下去
        if (loaded && !isNonMove) this.projectBranchChildren(nodes, id, branchIdxPath, loaded);
      }
    }

    const currentId = this.nodeId(depth);

    // `partial: true` 同 DP 侧：投影不是完整棋谱，且这个布尔字段能随对象展开
    // 传进「编辑副本」（Symbol 标记不会跨过去，见 GameDocument.partial 的说明）。
    const projected: RenLibWebDocument = { ...this.base, nodes, savedCurrentId: currentId, partial: true };
    Object.defineProperty(projected, RENLIB_WEB_VIEW, { value: true });
    return { document: projected, currentId };
  }

  private async query(depth = this.path.length) {
    const result = await this.core.branches(this.path.slice(0, depth));
    this.queries.set(depth, result);
    this.queriedPaths.add(this.path.slice(0, depth).join("-"));
  }

  /**
   * 把一个**已查过**的分支的候选铺进投影（只铺一层，递归由调用方按需继续）。
   *
   * 与主投影里那段循环的差别只有一处：这里的父节点是「路径之外的分支」，
   * 它的候选同样要按 `nonMoveKeys` 判真着法/空点标注、同样要标「未加载」。
   */
  private projectBranchChildren(
    nodes: Record<string, RecordNode>,
    parentId: string,
    parentIdxPath: number[],
    query: RenLibWebBranchResult,
  ): void {
    const parent = nodes[parentId];
    if (!parent) return;
    const depth = parentIdxPath.length;
    const parentPathText = parentIdxPath
      .map((idx) => `${idxToPosition(idx).row},${idxToPosition(idx).col}`).join("-");
    for (const branch of query.nodes || []) {
      const id = `${parentId}-branch-${branch.idx.toString(16)}`;
      // 同一支可能已经在别处铺过（同一路径只会出现一次，但保险起见不覆盖）
      if (nodes[id]) continue;
      const point = idxToPosition(branch.idx);
      const isNonMove = this.nonMoveKeys.has(`${parentPathText}|${point.row},${point.col}`);
      const childIdxPath = [...parentIdxPath, branch.idx];
      const childQuery = this.branchQueries.get(childIdxPath.join("-"));
      nodes[id] = {
        id,
        parentId,
        children: [],
        move: isNonMove ? null : { ...point, player: depth % 2 ? "white" : "black" },
        anchor: isNonMove ? { ...point } : undefined,
        comment: commentText(childQuery?.innerHTML),
        marks: [],
        boardText: branch.txt || "",
        renLibNativeLabel: true,
        renLibLabelColor: branch.color,
        unloadedChildren: isNonMove || this.queriedPaths.has(childIdxPath.join("-")) ? undefined : 1,
      };
      parent.children.push(id);
      if (!parent.preferredChildId && !isNonMove) parent.preferredChildId = id;
      if (childQuery && !isNonMove) this.projectBranchChildren(nodes, id, childIdxPath, childQuery);
    }
  }

  /**
   * 按需查询一个分支的后续（分支树点「展开」时调用）。
   *
   * `nodeId` 是投影里那个分支节点的 id；本方法从它反解出 idx 路径再问核心。
   * 查完回推一次投影（`onUpdate`），树随之长出这一支。
   *
   * 为什么只查**一层**：与 DP 侧 `ensureChildrenLoaded` 同一个理由——递归铺会让每次
   * 点开变成一次整枝预取，手机会明显变卡；用户再点一次就再铺一层。
   */
  async loadBranch(nodeId: string): Promise<boolean> {
    if (!this.base) return false;
    const idxPath = this.idxPathOf(nodeId);
    if (!idxPath) return false;
    const key = idxPath.join("-");
    if (!this.queriedPaths.has(key)) {
      try {
        const result = await this.core.branches(idxPath);
        this.branchQueries.set(key, result);
      } catch {
        return false;   // 读不到就维持现状，用户再点一次即可
      }
      // 它每一层的祖先都算「查过」，否则祖先会一直显示成「后面还有」
      for (let at = 1; at <= idxPath.length; at += 1) this.queriedPaths.add(idxPath.slice(0, at).join("-"));
    }
    this.onUpdate?.(this.projection().document);
    return true;
  }

  /**
   * 从节点 id 反解 idx 路径（`loadBranch` 与 `moveToNodeId` 共用）。
   *
   * 节点 id **本身就是完整 idx 路径的十六进制编码**（见 `nodeId` 与 `projection`）：
   * ```text
   *   <base.id>-renlib-<hex>[-<hex>…]                 主链节点
   *   <base.rootId>-branch-<hex>                      根那一层的分支
   *   …-branch-<hex>[-branch-<hex>…]                  更深的分支（可再套）
   * ```
   * 所以**不能**用「剥掉 branch 段再拿 `nodeId(depth)` 比对」的办法（踩过两个坑）：
   *   · `base.id` / `rootId` 自己带连字符（`record-xxxx-yyyy`），整体 split 会把它们当 hex → NaN；
   *   · 比对 `nodeId(depth)` 依赖**会话当前路径**，而分支可能在路径之外（`loadBranch` 展开的
   *     那些就是），于是永远对不上（实测报「找不到这个分支节点对应的路径」）。
   *
   * 正确做法：先切掉 `<base.id>` 或 `<base.rootId>` 前缀（二者是已知字符串，直接 startsWith 比），
   * 再把剩下的每个 `-`/`-branch-` 分隔的 hex 段按顺序读出来——它们就是 idx 路径。
   */
  private idxPathOf(nodeId: string): number[] | null {
    if (!this.base) return null;
    const basePrefix = `${this.base.id}-renlib-`;
    const rootPrefix = `${this.base.rootId}-branch-`;
    let body: string;
    if (nodeId.startsWith(basePrefix)) body = nodeId.slice(basePrefix.length);
    else if (nodeId === this.base.rootId) return [];              // 根本身 = 空路径
    else if (nodeId.startsWith(rootPrefix)) body = nodeId.slice(rootPrefix.length);
    else return null;
    const idxPath: number[] = [];
    for (const piece of body.split("-")) {
      if (!piece || piece === "branch") continue;                 // `branch` 是标记词，跳过
      const value = Number.parseInt(piece, 16);
      if (!Number.isInteger(value) || value < 0 || value > 224) return null;
      idxPath.push(value);
    }
    return idxPath;
  }

  /** 用我方 TS 读取器（认 NO_MOVE 位）把"有坐标但不是着法"的节点登记到 nonMoveKeys。
   *  键 = `父路径（只算真着法）|本节点坐标`，与 projection() 里算键的方式必须一致。 */
  private async scanNonMoveNodes(file: File) {
    if (file.size > NON_MOVE_SCAN_MAX_BYTES) return;   // 超大库保住惰性投影，不做对照读取
    try {
      const read = await importRenLibLegacy(file, file.name);
      const walk = (id: string, parentPath: string) => {
        const node = read.document.nodes[id];
        if (!node) return;
        if (!node.move && node.anchor) {
          this.nonMoveKeys.add(`${parentPath}|${node.anchor.row},${node.anchor.col}`);
        }
        // 只有真着法才并进路径：非着法节点在投影里不进 path（它不是一个"步"）。
        const nextPath = node.move
          ? (parentPath ? `${parentPath}-${node.move.row},${node.move.col}` : `${node.move.row},${node.move.col}`)
          : parentPath;
        for (const child of node.children) walk(child, nextPath);
      };
      walk(read.document.rootId, "");
    } catch {
      // 读不动就退回旧行为（把候选当着法），不影响打开文件本身
    }
  }

  async open(file: File) {
    this.base = createDocument(file.name.replace(/\.[^.]+$/, ""), 15);
    this.base.metadata.sourceFormat = "lib";
    this.base.metadata.sourceFileName = file.name;
    this.path = [];
    this.queries.clear();
    this.pathBranches.clear();
    this.nonMoveKeys.clear();
    const opened = await this.core.open(file);
    await this.scanNonMoveNodes(file);
    const autoMove = Array.isArray(opened?.parameter?.autoMove)
      ? opened.parameter.autoMove
      : Array.isArray(opened?.result?.autoMove) ? opened.result.autoMove : [];
    this.path = autoMove.filter((idx: unknown): idx is number => Number.isInteger(idx) && Number(idx) >= 0 && Number(idx) < 225);
    for (let depth = 0; depth <= this.path.length; depth += 1) {
      await this.query(depth);
      if (depth < this.path.length) {
        const selected = this.queries.get(depth)?.nodes.find((branch) => branch.idx === this.path[depth]);
        if (selected) this.pathBranches.set(depth + 1, selected);
      }
    }
    return this.projection();
  }

  async move(position: Position) {
    const idx = positionToIdx(position);
    const current = this.queries.get(this.path.length);
    const selected = current?.nodes.find((branch) => branch.idx === idx);
    if (!selected) throw new Error("这个位置不在当前 RenLib 分支中");
    this.path.push(idx);
    this.pathBranches.set(this.path.length, selected);
    [...this.pathBranches.keys()].filter((depth) => depth > this.path.length).forEach((depth) => this.pathBranches.delete(depth));
    await this.query();
    return this.projection();
  }

  async moveFromDepth(depth: number, position: Position) {
    this.path = this.path.slice(0, Math.max(0, depth));
    return this.move(position);
  }

  /**
   * 按**节点 id** 导航（2026-10-11 P2）：这条路径是「投影深度」与「idx 路径」唯一能对齐的入口。
   *
   * ## 为什么要它（实测 5 个旁支 4 个失败）
   *
   * App 的 `selectTreeNode` 会算 `pivotDepth = depthOf(viewDocument, pivot.id)`——那是**投影里的层数**
   * （父节点链的长度）。主线上两者一致，但**旁支的投影深度 ≠ idx 路径长度**：
   * 一条旁支在投影里是「主链某点 → 旁支格 → 旁支的格子…」，而核心那边只认 idx 序列。
   * 于是 `moveFromDepth(pivotDepth, …)` 会把 idx 路径截错位，`move()` 在
   * `queries.get(this.path.length)` 里找不到候选 → 抛「这个位置不在当前 RenLib 分支中」，
   * 用户点了树上那个分支节点却得到一句失败提示。
   *
   * 节点 id 本身就是完整 idx 路径（见 `loadBranch` 的注释与 `projection()` 的 id 构造），
   * 所以从 id 反解出路径、直接把它当成新的 `this.path`，就绕开了深度口径的换算。
   */
  async moveToNodeId(nodeId: string, position: Position): Promise<{ document: GameDocument; currentId: string }> {
    const idxPath = this.idxPathOf(nodeId);
    if (!idxPath) throw new Error("找不到这个分支节点对应的路径");
    /**
     * 把这条路的**每一层**都问过核心，并且**按当前路径前缀写进 `queries`**
     * （而不是只丢进 `branchQueries` 就完事——`move()` 读的是 `queries.get(path.length)`，
     *  只认主链深度；旁支的候选在 `branchQueries` 里，所以旧写法必然抛
     *  「这个位置不在当前 RenLib 分支中」，实测 lektion2/3 的旁支导航 6 个失败 4 个）。
     *
     * 做法：先把路径整体落定，再逐层 `query(depth)`——`query(depth)` 内部就是
     * `core.branches(path.slice(0, depth))`，问的正是**这条新路径**的前缀，
     * 于是 `queries` 里每一层都是对的候选表，`move()` 自然能找到最后一手。
     */
    this.path = idxPath.slice(0, -1);
    this.pathBranches.clear();
    for (let depth = 0; depth <= this.path.length; depth += 1) await this.query(depth);
    return this.move(position);
  }

  async back() {
    if (this.path.length) this.path.pop();
    [...this.pathBranches.keys()].filter((depth) => depth > this.path.length).forEach((depth) => this.pathBranches.delete(depth));
    if (!this.queries.has(this.path.length)) await this.query();
    return this.projection();
  }

  async root() {
    this.path = [];
    this.pathBranches.clear();
    if (!this.queries.has(0)) await this.query(0);
    return this.projection();
  }

  async toDepth(depth: number) {
    this.path = this.path.slice(0, Math.max(0, depth));
    [...this.pathBranches.keys()].filter((pathDepth) => pathDepth > this.path.length).forEach((pathDepth) => this.pathBranches.delete(pathDepth));
    if (!this.queries.has(this.path.length)) await this.query();
    return this.projection();
  }

  /** 只读：本文件里「有坐标但不是着法」的节点键（父着法序列|坐标）。
   *  lib2sgf 会把这类空点标注写成着法，导出/转换前要用它剔除幻影节点。 */
  get nonMoveNodeKeys(): ReadonlySet<string> { return this.nonMoveKeys; }

  async exportOriginalSgf() {
    return this.core.convertToSgf();
  }

  close() { this.core.close(); }
}

export const isRenLibWebView = (document: GameDocument) => Boolean((document as RenLibWebDocument)[RENLIB_WEB_VIEW]);
