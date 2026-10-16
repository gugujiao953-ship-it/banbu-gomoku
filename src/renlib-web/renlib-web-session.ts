import { createRenLibWebWorker, type RenLibWebWorkerAssets } from "./renlib-web-worker";

export type RenLibWebBranch = {
  idx: number;
  txt?: string;
  color?: string;
  joint?: boolean;
};

export type RenLibWebBranchResult = {
  nodes: RenLibWebBranch[];
  innerHTML?: string;
  position?: unknown;
};

// 资源地址必须按构建 base 解析（2026-09-18 网页版可用性普查）：写死站点根的
// "/renlib/…" 在根路径部署（APK 与本地 dev）下没问题，但网页版挂在子路径
// （…/banbu-gomoku/app/）时会请求到站点根 → 404，LIB 棋谱直接打不开。
// 解析成绝对 URL 同时也满足 createRenLibWebWorker 的部署边界（它只接受绝对
// http(s) 或站点根路径，相对路径会抛错）。非浏览器环境（单测）保持原写法。
const renlibAssetUrl = (path: string): string => {
  const relative = `${import.meta.env.BASE_URL}${path}`;
  const base = globalThis.document?.baseURI;
  return base ? new URL(relative, base).href : `/${path}`;
};

const defaultAssets: RenLibWebWorkerAssets = {
  workerUrl: renlibAssetUrl("renlib/RenjuLib_worker.js"),
  wasmUrl: renlibAssetUrl("renlib/RenLib.wasm"),
};

export class RenLibWebSession {
  private readonly worker: Worker;
  private request = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void; events: Map<string, unknown> }>();

  constructor(assets: RenLibWebWorkerAssets = defaultAssets) {
    this.worker = createRenLibWebWorker(assets);
    this.worker.onmessage = (event) => {
      const id = event.data?.requestId;
      if (typeof id !== "number") return;
      const waiter = this.pending.get(id);
      if (!waiter) return;
      if (event.data.ok === false || event.data.cmd === "onerror") {
        this.pending.delete(id);
        waiter.reject(new Error(event.data.error || event.data.parameter || "RenLib 网页核心失败"));
        return;
      }
      if (event.data.cmd !== "resolve") {
        if (typeof event.data.cmd === "string") waiter.events.set(event.data.cmd, event.data.parameter);
        return;
      }
      this.pending.delete(id);
      waiter.resolve({ ...event.data, events: Object.fromEntries(waiter.events) });
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "RenLib 网页核心 worker 异常");
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };
  }

  private send(cmd: string, parameter?: unknown, transfer?: Transferable[]) {
    // 同 DpViewSession：关闭后 worker 已终止，postMessage 会被静默丢弃、promise 永不落地。
    if (this.closed) return Promise.reject(new Error("RenLib 网页核心会话已关闭，请重新打开"));
    const requestId = ++this.request;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, events: new Map() });
      this.worker.postMessage({ requestId, cmd, parameter }, transfer || []);
    });
  }

  async open(file: File) {
    await this.send("setBufferScale", 3);
    return this.send("openLib", file);
  }

  async branches(path: number[], position?: unknown): Promise<RenLibWebBranchResult> {
    const reply = await this.send("showBranchs", { path, position });
    return reply.result || reply.parameter || reply;
  }

  async autoMove(): Promise<number[]> {
    const reply = await this.send("getAutoMove");
    return reply.parameter || reply.events?.autoMove || [];
  }

  async convertToSgf(): Promise<ArrayBuffer> {
    const reply = await this.send("lib2sgf");
    const payload = reply.result || reply.parameter;
    const buffer = payload?.buf;
    const byteLen = Number(payload?.byteLen);
    if (!(buffer instanceof ArrayBuffer)) throw new Error("RenLib 核心没有返回有效的 SGF 数据");
    if (!Number.isInteger(byteLen) || byteLen <= 0 || byteLen > buffer.byteLength) {
      throw new Error("RenLib 核心返回的 SGF 长度无效");
    }
    return byteLen === buffer.byteLength ? buffer : buffer.slice(0, byteLen);
  }

  close() {
    this.closed = true;
    for (const waiter of this.pending.values()) waiter.reject(new Error("RenLib 网页核心会话已关闭"));
    this.pending.clear();
    this.worker.terminate();
  }
}
