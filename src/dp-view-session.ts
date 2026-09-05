import DpDatabaseWorker from "./dp-database.worker?worker";
import { createDocument } from "./game";
import type { BoardMark, GameDocument, Position, RecordNode } from "./types";

const DP_VIEW = Symbol("banbu-dp-database-view");
type Query = { comment: string; marks: BoardMark[]; branches: Array<{ position: Position; label: string }> };
type DpDocument = GameDocument & { [DP_VIEW]?: true };

export class DpViewSession {
  private readonly worker = new DpDatabaseWorker();
  private requestId = 0;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>();
  private path: Position[] = [];
  private readonly queries = new Map<number, Query>();
  private base?: GameDocument;
  // A board tap can produce several asynchronous worker requests in quick
  // succession. Serialize state transitions so a late response cannot project
  // a half-applied path over a newer branch selection.
  private operationQueue: Promise<void> = Promise.resolve();

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

  private nodeId(depth: number) {
    if (!this.base || depth === 0) return this.base?.rootId || "dp-root";
    return `${this.base.id}-dp-${this.path.slice(0, depth).map((point) => `${point.row.toString(16)}${point.col.toString(16)}`).join("-")}`;
  }

  private projection(): { document: GameDocument; currentId: string } {
    if (!this.base) throw new Error("DP 数据库尚未打开");
    const depth = this.path.length;
    const nodes: Record<string, RecordNode> = {};
    for (let index = 0; index <= depth; index += 1) {
      const id = this.nodeId(index), query = this.queries.get(index);
      const nextId = index < depth ? this.nodeId(index + 1) : undefined;
      const selectedBranch = index > 0
        ? this.queries.get(index - 1)?.branches.find((branch) => {
          const move = this.path[index - 1];
          return move && branch.position.row === move.row && branch.position.col === move.col;
        })
        : undefined;
      nodes[id] = {
        id, parentId: index ? this.nodeId(index - 1) : null, children: nextId ? [nextId] : [],
        move: index ? { ...this.path[index - 1], player: index % 2 ? "black" : "white" } : null,
        // DP's current-position annotation map is already joined onto the
        // child records as their native labels below. Keeping query.marks here
        // would render every @BTXT@ label a second time at the same coordinate.
        comment: query?.comment || "", marks: [], preferredChildId: nextId,
        // In DP/DB data the label belongs to the edge in the parent's query,
        // not to the child position returned by the next query. Carry it onto
        // the projected path node so createEditableViewCopy() preserves the
        // original label when the user enters the editable study copy and
        // navigates back over this move.
        boardText: selectedBranch?.label || undefined,
        renLibNativeLabel: Boolean(selectedBranch?.label),
        renLibLabelColor: selectedBranch?.label ? "#1d1c19" : undefined,
      };
    }
    // Keep cached alternatives in the bounded projection so the branch tree
    // and back-navigation can still inspect loaded positions. The board itself
    // renders only the current node's direct children.
    for (let index = 0; index <= depth; index += 1) {
      const parentId = this.nodeId(index), parent = nodes[parentId];
      const selected = index < depth ? this.path[index] : undefined;
      for (const branch of this.queries.get(index)?.branches || []) {
        if (selected && branch.position.row === selected.row && branch.position.col === selected.col) continue;
        const id = `${parentId}-branch-${branch.position.row.toString(16)}${branch.position.col.toString(16)}`;
        nodes[id] = { id, parentId, children: [], move: { ...branch.position, player: index % 2 ? "white" : "black" }, comment: "", marks: [], boardText: branch.label, renLibNativeLabel: true, renLibLabelColor: "#1d1c19" };
        parent.children.push(id);
        if (!parent.preferredChildId) parent.preferredChildId = id;
      }
    }
    const currentId = this.nodeId(depth);
    const document: DpDocument = { ...this.base, nodes, savedCurrentId: currentId };
    Object.defineProperty(document, DP_VIEW, { value: true });
    return { document, currentId };
  }

  async open(file: File) {
    return this.enqueue(async () => {
      const base = createDocument(file.name.replace(/\.[^.]+$/, ""), 15);
      const extension = file.name.split(".").pop()?.toLowerCase();
      base.metadata.sourceFormat = extension === "db" ? "db" : "dp";
      base.metadata.sourceFileName = file.name;
      this.base = base; this.path = []; this.queries.clear();
      const reply = await this.send({ cmd: "open", file });
      this.queries.set(0, reply.query);
      return { ...this.projection(), recordCount: Number(reply.count || 0) };
    });
  }

  async move(position: Position) {
    return this.enqueue(async () => {
      this.path.push({ ...position });
      const reply = await this.send({ cmd: "query", path: this.path });
      this.queries.set(this.path.length, reply.query);
      return this.projection();
    });
  }

  async moveFromDepth(depth: number, position: Position) {
    return this.enqueue(async () => {
      this.path = this.path.slice(0, Math.max(0, depth));
      this.path.push({ ...position });
      const reply = await this.send({ cmd: "query", path: this.path });
      this.queries.set(this.path.length, reply.query);
      return this.projection();
    });
  }

  async back() {
    return this.enqueue(async () => {
      if (this.path.length) this.path.pop();
      if (!this.queries.has(this.path.length)) {
        const reply = await this.send({ cmd: "query", path: this.path }); this.queries.set(this.path.length, reply.query);
      }
      return this.projection();
    });
  }

  async root() { return this.enqueue(async () => { this.path = []; return this.projection(); }); }
  async toDepth(depth: number) { return this.enqueue(async () => { this.path = this.path.slice(0, Math.max(0, depth)); return this.projection(); }); }
  close() { this.worker.terminate(); this.pending.forEach(({ reject }) => reject(new Error("DP 数据库已关闭"))); this.pending.clear(); }
}

export const isDpDatabaseView = (document: GameDocument) => Boolean((document as DpDocument)[DP_VIEW]);
