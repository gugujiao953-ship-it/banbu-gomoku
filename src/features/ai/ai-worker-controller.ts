export interface ControlledWorker {
  postMessage(message: unknown): void;
  terminate(): void;
}

export type AiWorkerKind = "game" | "puzzle" | "analysis";
export type AiCancelReason = "user" | "superseded" | "position-change" | "record-switch" | "mode-switch" | "settings-change" | "background" | "unmount";

export interface AiWorkerHandle {
  requestId: string;
  generation: number;
  kind: AiWorkerKind;
  contextKey: string;
}

interface ActiveWorker extends AiWorkerHandle { worker: ControlledWorker; persistent: boolean; unlimited: boolean }

/** Owns one mutually-exclusive AI computation. Cancellation always sends the
 * cooperative stop command. Disposable workers are then terminated because a
 * WASM search can block its worker event loop and never process a queued stop.
 * Persistent workers (the long-lived Rapfi engine) survive normal completion
 * so the transposition table stays warm; cancelling one of their requests
 * only terminates when the search has no time budget to end on its own. */
export class AiWorkerController {
  private generation = 0;
  private sequence = 0;
  private active: ActiveWorker | null = null;
  private lastCancelReason: AiCancelReason | null = null;

  constructor(private readonly onWorkerDiscarded?: (worker: ControlledWorker) => void) {}

  get current() { return this.active; }
  get snapshot() {
    return {
      running: Boolean(this.active),
      requestId: this.active?.requestId ?? null,
      generation: this.generation,
      kind: this.active?.kind ?? null,
      contextKey: this.active?.contextKey ?? null,
      lastCancelReason: this.lastCancelReason,
    };
  }

  start(worker: ControlledWorker, kind: AiWorkerKind, contextKey: string, options: { persistent?: boolean; unlimited?: boolean } = {}): AiWorkerHandle {
    this.cancel("superseded");
    const generation = ++this.generation;
    const requestId = `ai-${Date.now()}-${++this.sequence}-${generation}`;
    this.active = { requestId, generation, kind, contextKey, worker, persistent: options.persistent === true, unlimited: options.unlimited === true };
    this.lastCancelReason = null;
    return { requestId, generation, kind, contextKey };
  }

  replaceWorker(handle: AiWorkerHandle, worker: ControlledWorker): boolean {
    if (!this.isCurrent(handle)) { worker.terminate(); return false; }
    const previous = this.active!.worker;
    if (previous !== worker) {
      previous.terminate();
      this.onWorkerDiscarded?.(previous);
    }
    this.active = { ...this.active!, worker, persistent: false, unlimited: false };
    return true;
  }

  isCurrent(handle: AiWorkerHandle, requestId = handle.requestId, generation = handle.generation): boolean {
    return Boolean(this.active && this.active.generation === handle.generation && this.active.requestId === handle.requestId && requestId === handle.requestId && generation === handle.generation);
  }

  finish(handle: AiWorkerHandle): boolean {
    if (!this.isCurrent(handle)) return false;
    // Persistent workers stay alive after a completed request: the engine keeps
    // its transposition table and skips the reload on the next move.
    if (!this.active!.persistent) this.active!.worker.terminate();
    this.active = null;
    return true;
  }

  /**
   * 用户强制停止但要落子（T29）：向活动请求发送 toResult 停止信号，引擎
   * 以「当前已算最强点」正常收尾。**不**推进 generation/清 active——随后
   * 到达的 result 仍通过 isCurrent() 走正常接受与落子通路。返回是否发出。
   */
  requestResultOnStop(): boolean {
    if (!this.active) return false;
    const current = this.active;
    try {
      current.worker.postMessage({ type: "stop", requestId: current.requestId, generation: current.generation, toResult: true });
      return true;
    } catch {
      return false;
    }
  }

  cancel(reason: AiCancelReason): boolean {
    if (!this.active) return false;
    const current = this.active;
    this.active = null;
    this.generation += 1;
    this.lastCancelReason = reason;
    try { current.worker.postMessage({ type: "stop", requestId: current.requestId, generation: current.generation }); } catch { /* termination remains authoritative */ }
    // An unlimited search has no deadline to end itself at, so termination
    // stays authoritative there even for the persistent engine.
    if (!current.persistent || current.unlimited) {
      current.worker.terminate();
      this.onWorkerDiscarded?.(current.worker);
    }
    return true;
  }
}
