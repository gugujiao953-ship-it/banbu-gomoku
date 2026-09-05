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

interface ActiveWorker extends AiWorkerHandle { worker: ControlledWorker }

/** Owns one mutually-exclusive AI computation. Cancellation always sends the
 * cooperative stop command and then terminates the worker, because a WASM
 * search can block its worker event loop and never process a queued stop. */
export class AiWorkerController {
  private generation = 0;
  private sequence = 0;
  private active: ActiveWorker | null = null;
  private lastCancelReason: AiCancelReason | null = null;

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

  start(worker: ControlledWorker, kind: AiWorkerKind, contextKey: string): AiWorkerHandle {
    this.cancel("superseded");
    const generation = ++this.generation;
    const requestId = `ai-${Date.now()}-${++this.sequence}-${generation}`;
    this.active = { requestId, generation, kind, contextKey, worker };
    this.lastCancelReason = null;
    return { requestId, generation, kind, contextKey };
  }

  replaceWorker(handle: AiWorkerHandle, worker: ControlledWorker): boolean {
    if (!this.isCurrent(handle)) { worker.terminate(); return false; }
    const previous = this.active!.worker;
    if (previous !== worker) previous.terminate();
    this.active = { ...this.active!, worker };
    return true;
  }

  isCurrent(handle: AiWorkerHandle, requestId = handle.requestId, generation = handle.generation): boolean {
    return Boolean(this.active && this.active.generation === handle.generation && this.active.requestId === handle.requestId && requestId === handle.requestId && generation === handle.generation);
  }

  finish(handle: AiWorkerHandle): boolean {
    if (!this.isCurrent(handle)) return false;
    this.active!.worker.terminate();
    this.active = null;
    return true;
  }

  cancel(reason: AiCancelReason): boolean {
    if (!this.active) return false;
    const current = this.active;
    this.active = null;
    this.generation += 1;
    this.lastCancelReason = reason;
    try { current.worker.postMessage({ type: "stop", requestId: current.requestId, generation: current.generation }); } catch { /* termination remains authoritative */ }
    current.worker.terminate();
    return true;
  }
}
