import DpDatabaseWorker from "./dp-database.worker?worker";
import { createDocument } from "./game";
import { buildDpProjection, dpKeyToPath, dpPathKey, type DpQuery } from "./dp-projection";
import type { GameDocument, Position } from "./types";

export { isDpDatabaseView } from "./dp-projection";

/**
 * 预取预算（局面数）。DP 库是按局面查的，从根可达的树可以大到十万级
 * （九天指南v5-1 实测 107242 个局面、深度 33），所以树视图永远只能画「已加载的部分」：
 * 主分支链先走完，再用剩余预算从根逐层铺开。快路径约 1.2ms/局面，900 个约 1 秒。
 */
export const DP_PREFETCH_BUDGET = 900;
/** 主分支链最多走多少手。 */
export const DP_MAIN_LINE_LIMIT = 40;
/** 点开一个「未加载」枝条时，为它单独加载的子树预算。 */
export const DP_BRANCH_BUDGET = 240;
/** 每批查询数：太小则消息往返多，太大则首次可见等太久。 */
const DP_QUERY_BATCH = 40;

export class DpViewSession {
  private readonly worker = new DpDatabaseWorker();
  private requestId = 0;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>();
  private path: Position[] = [];
  /**
   * 查询结果按「位置路径」缓存，而不是按深度：DP 库里任何一条枝条都能被单独加载并记住，
   * 这正是分支树能看到真分支（而不是一手叶子）的前提。
   */
  private readonly cache = new Map<string, DpQuery>();
  private base?: GameDocument;
  // A board tap can produce several asynchronous worker requests in quick
  // succession. Serialize state transitions so a late response cannot project
  // a half-applied path over a newer branch selection.
  private operationQueue: Promise<void> = Promise.resolve();
  /** 预取代次：换库或关闭会让在飞的预取结果作废。 */
  private loadToken = 0;
  private prefetchRunning = false;
  private closed = false;
  /** 预取/按需加载有新结果时回调（App 用它把更新后的文档推回界面）。 */
  onUpdate?: (document: GameDocument) => void;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<any>) => {
      const waiter = this.pending.get(event.data.requestId);
      if (!waiter) return;
      this.pending.delete(event.data.requestId);
      event.data.ok ? waiter.resolve(event.data) : waiter.reject(new Error(event.data.error || "DP 数据库查询失败"));
    };
    this.worker.onerror = (event) => {
      const message = typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent && event.message ? event.message : "DP 数据库后台线程异常";
      const error = new Error(message);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      this.worker.terminate();
    };
  }

  private send(message: object) {
    // 关闭后 worker 已 terminate：postMessage 会**静默丢弃**，promise 永远不落地——
    // 实测「close() 之后再用同一会话 open()」会挂死（探针 500 秒超时）。这里直接报错。
    if (this.closed) return Promise.reject(new Error("DP 数据库已关闭，请重新打开"));
    const requestId = ++this.requestId;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage({ ...message, requestId });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private projection() {
    if (!this.base) throw new Error("DP 数据库尚未打开");
    return buildDpProjection({ base: this.base, path: this.path, cache: this.cache });
  }

  /** 取一个局面的查询结果：缓存优先，未缓存则单独查一次。 */
  private async queryPath(path: Position[]): Promise<DpQuery | undefined> {
    const cached = this.cache.get(dpPathKey(path));
    if (cached) return cached;
    const reply = await this.send({ cmd: "query", path });
    const query = reply.query as DpQuery;
    this.cache.set(dpPathKey(path), query);
    return query;
  }

  private async queryMany(paths: Position[][]) {
    const reply = await this.send({ cmd: "queryMany", paths });
    return (reply.queries || []) as DpQuery[];
  }

  private publish() {
    if (!this.base || !this.onUpdate) return;
    this.onUpdate(this.projection().document);
  }

  /**
   * 打开后就把分支树要用的结构铺出来：① 主分支链（每步挑评估值最小的子，DP 库里的
   * 最佳应对线）先走到底；② 再从根逐层铺开，用完预算为止。分批查询并逐批回调，
   * 于是树是「边加载边长出来」的，界面不会等一个整块。
   */
  private async prefetchRoot() {
    if (this.prefetchRunning) return;
    this.prefetchRunning = true;
    const token = this.loadToken;
    try {
      let line: Position[] = [];
      for (let step = 0; step < DP_MAIN_LINE_LIMIT; step += 1) {
        const query = await this.queryPath(line);
        if (!query || token !== this.loadToken) return;
        const best = query.branches.reduce<DpQuery["branches"][number] | undefined>((pick, branch) => (!pick || branch.value < pick.value ? branch : pick), undefined);
        if (!best) break;
        line = [...line, best.position];
      }
      this.publish();
      const queue: Position[][] = [];
      // 队列里遇到「已缓存」的局面不能直接跳过：它的子节点还没进过队列，
      // 跳过就等于广度铺开在第一层就断了（根永远是已缓存的）。
      const expandCached = (path: Position[]) => {
        const query = this.cache.get(dpPathKey(path));
        if (!query) return;
        for (const branch of query.branches) {
          if (pushed >= DP_PREFETCH_BUDGET) return;
          pushed += 1;
          queue.push([...path, branch.position]);
        }
      };
      let remaining = DP_PREFETCH_BUDGET;
      let pushed = 0;
      // 回推节流：每批都推一次会让主线程反复重建整份文档（走一步就卡的那个味道）。
      let lastPublish = Date.now();
      expandCached([]);
      while (queue.length && remaining > 0 && token === this.loadToken) {
        const batch: Position[][] = [];
        while (queue.length && batch.length < DP_QUERY_BATCH && remaining > 0) {
          const next = queue.shift()!;
          if (this.cache.has(dpPathKey(next))) { expandCached(next); continue; }
          batch.push(next); remaining -= 1;
        }
        if (!batch.length) continue;
        const queries = await this.queryMany(batch);
        if (token !== this.loadToken) return;
        batch.forEach((item, index) => {
          const query = queries[index];
          if (!query) return;
          this.cache.set(dpPathKey(item), query);
          expandCached(item);
        });
        if (Date.now() - lastPublish >= 400) { lastPublish = Date.now(); this.publish(); }
      }
      this.publish();
    } catch {
      // 预取失败不影响浏览：已加载的部分照常可用。
    } finally {
      this.prefetchRunning = false;
    }
  }

  /** 点开一个「未加载」枝条：把它下面的一小片子树查回来（预算内），然后回推文档。 */
  async loadBranch(path: Position[], budget = DP_BRANCH_BUDGET) {
    const token = this.loadToken;
    try {
      await this.queryPath(path);
      const queue: Position[][] = [path];
      let remaining = budget;
      while (queue.length && remaining > 0 && token === this.loadToken) {
        const batch: Position[][] = [];
        while (queue.length && batch.length < DP_QUERY_BATCH && remaining > 0) {
          const next = queue.shift()!;
          if (next.length > path.length && this.cache.has(dpPathKey(next))) continue;
          batch.push(next); remaining -= 1;
        }
        if (!batch.length) break;
        const queries = await this.queryMany(batch);
        if (token !== this.loadToken) return;
        batch.forEach((item, index) => {
          const query = queries[index];
          if (!query) return;
          this.cache.set(dpPathKey(item), query);
          for (const branch of query.branches) queue.push([...item, branch.position]);
        });
      }
      this.publish();
    } catch {
      // 同上：读不到就维持现状，用户再点一次即可。
    }
  }

  /** 树上点开一个「未加载」节点：从节点 id 还原位置路径，再加载那一枝。 */
  loadBranchByNodeId(nodeId: string) {
    if (!this.base) return;
    // 根节点：id 就是 base.rootId，**不带 `-dp-` 前缀**（见 dpNodeIdFor）。
    // 漏掉这一条时会静默早退——而 `expandBranch` 那边的计数器照旧 +1
    // （`remainingLayersOf` 见根上有未加载分支会返回 Infinity），
    // 于是又出现「点了没反应、数字在涨」（2026-10-11 排查出的 P7）。
    if (nodeId === this.base.rootId) return this.loadBranch([]);
    const prefix = `${this.base.id}-dp-`;
    if (!nodeId.startsWith(prefix)) return;
    return this.loadBranch(dpKeyToPath(nodeId.slice(prefix.length)));
  }

  /** Jump to the complete source path, including branches outside the current line. */
  async moveToNodeId(nodeId: string, _position?: Position) {
    return this.enqueue(async () => {
      if (!this.base || this.closed) throw new Error("DP 数据库未打开或已关闭");
      const prefix = `${this.base.id}-dp-`;
      const body = nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : null;
      if (nodeId !== this.base.rootId && (!body || !body.split("-").every((part) => /^[0-9a-e]{2}$/i.test(part)))) {
        throw new Error("找不到这个分支节点对应的路径");
      }
      const nextPath = nodeId === this.base.rootId ? [] : dpKeyToPath(body!);
      // Query ancestors too so the projection contains a complete parent chain even on a direct jump.
      for (let depth = 0; depth <= nextPath.length; depth += 1) await this.queryPath(nextPath.slice(0, depth));
      await this.ensureChildrenLoaded(nextPath);
      this.path = nextPath;
      return this.projection();
    });
  }

  async open(file: File) {
    return this.enqueue(async () => {
      const base = createDocument(file.name.replace(/\.[^.]+$/, ""), 15);
      const extension = file.name.split(".").pop()?.toLowerCase();
      base.metadata.sourceFormat = extension === "db" ? "db" : "dp";
      base.metadata.sourceFileName = file.name;
      this.base = base; this.path = []; this.cache.clear();
      this.loadToken += 1;
      const reply = await this.send({ cmd: "open", file });
      this.cache.set("", reply.query);
      // 打开后立刻铺结构：用户点开分支树时通常已经就绪。
      void this.prefetchRoot();
      return { ...this.projection(), recordCount: Number(reply.count || 0) };
    });
  }

  /**
   * 只补「当前局面这一层」的子节点 —— 让棋盘上一定有选点可画。
   *
   * ## 为什么必须有这一步（2026-10-09 用户报的「选点多处残缺」）
   *
   * 用户原话：「九天指南那些选点呀标注呀，竟然有很多地方没有，是残缺的」。
   * 诊断结论：**数据一条没丢**（原始 @BTXT@ 4170 个标注全部进屋、库里有 5823 条记录），
   * 丢的是**渲染出口**——
   *   · `prefetchRoot` 用广度优先铺 900 个局面，预算在第 4–5 层就烧光了
   *     （实测 depth3=184 / depth4=439 / depth5=266，合计 889 个，占 98%）；
   *   · 于是 depth3 的 184 个局面里只有 31 个「有子节点」= 能在棋盘上画出选点，
   *     另外 **153 个画不出任何选点**；depth4 更极端（439 里只有 28 个画得出）。
   *   · 全库统计：905 个已加载局面里 **641 个（71%）在棋盘上空的**，
   *     只有一个「还有 N 支未加载」的徽标 —— 用户看到的"残缺"就是这个。
   *
   * 光靠调大预算治不了（库有 107242 个局面，铺不完）。真正对的是：
   * **导航到哪个局面，就保证那个局面的子节点已加载**——棋盘每次都有选点。
   * 代价只是每条路径一次批量查询（DP 查询约 1.2ms/局面），返回前不落盘、不阻塞。
   *
   * ⚠ 只补**一层**（`depth` 不递归）：再深一层是用户在棋盘上点下去时才会用到的，
   *   那时 `move()` 会带着新路径再走一遍这个函数。递归补会让每次导航都变成一次预取，
   *   手机会明显变卡。
   */
  private async ensureChildrenLoaded(path: Position[]): Promise<void> {
    const key = dpPathKey(path);
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      // 已经查过、且子节点也都查过了才跳过（否则可能只是"查过但子节点没进缓存"）
      if (cached.branches.length === 0) return;
      if (cached.branches.every((branch) => this.cache.has(dpPathKey([...path, branch.position])))) return;
    }
    await this.queryPath(path);
    const query = this.cache.get(key);
    if (!query || !query.branches.length) return;
    const missing = query.branches
      .map((branch) => [...path, branch.position])
      .filter((childPath) => !this.cache.has(dpPathKey(childPath)));
    for (let index = 0; index < missing.length; index += DP_QUERY_BATCH) {
      const batch = missing.slice(index, index + DP_QUERY_BATCH);
      const queries = await this.queryMany(batch);
      batch.forEach((item, at) => {
        const childQuery = queries[at];
        if (childQuery) this.cache.set(dpPathKey(item), childQuery);
      });
    }
  }

  async move(position: Position) {
    return this.enqueue(async () => {
      this.path.push({ ...position });
      await this.queryPath(this.path);
      await this.ensureChildrenLoaded(this.path);
      return this.projection();
    });
  }

  async moveFromDepth(depth: number, position: Position) {
    return this.enqueue(async () => {
      this.path = this.path.slice(0, Math.max(0, depth));
      this.path.push({ ...position });
      await this.queryPath(this.path);
      await this.ensureChildrenLoaded(this.path);
      return this.projection();
    });
  }

  async back() {
    return this.enqueue(async () => {
      if (this.path.length) this.path.pop();
      await this.queryPath(this.path);
      // 退回也要补：用户往回走通常是想看上一个局面的其它选点，
      // 而那个局面很可能正是「预取没覆盖到」的那 71%。
      await this.ensureChildrenLoaded(this.path);
      return this.projection();
    });
  }

  async root() { return this.enqueue(async () => { this.path = []; await this.ensureChildrenLoaded(this.path); return this.projection(); }); }
  async toDepth(depth: number) {
    return this.enqueue(async () => {
      this.path = this.path.slice(0, Math.max(0, depth));
      await this.queryPath(this.path);
      await this.ensureChildrenLoaded(this.path);
      return this.projection();
    });
  }
  close() {
    this.closed = true;
    this.loadToken += 1;
    this.worker.terminate();
    this.pending.forEach(({ reject }) => reject(new Error("DP 数据库已关闭")));
    this.pending.clear();
  }
}
