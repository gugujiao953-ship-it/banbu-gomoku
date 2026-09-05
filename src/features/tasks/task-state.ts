export type TaskStatus = "idle" | "queued" | "running" | "success" | "error" | "cancelled";

export type TaskKind =
  | "import" | "export" | "ai" | "update-check" | "sync" | "snapshot"
  | "migration" | "load" | "other";

export interface TaskError {
  message: string;
  name?: string;
  cause?: unknown;
}

export interface TaskState<TResult = unknown> {
  taskId: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  stage?: string;
  progress?: number;
  message?: string;
  startedAt?: number;
  updatedAt: number;
  result?: TResult;
  error?: TaskError;
  retryable: boolean;
  cancellable: boolean;
}

export interface TaskStartOptions<TResult = unknown> {
  taskId?: string;
  kind: TaskKind;
  title: string;
  cancellable?: boolean;
  retryable?: boolean;
  timeoutMs?: number;
  run?: (signal: AbortSignal) => Promise<TResult>;
}

export type TaskListener = (task: TaskState | null) => void;

const now = () => Date.now();
const toError = (error: unknown): TaskError => ({
  message: error instanceof Error ? error.message : String(error || "任务失败"),
  name: error instanceof Error ? error.name : undefined,
  cause: error,
});

/** UI-independent task state machine. It guards stale completions by taskId and generation. */
export class TaskManager<TResult = unknown> {
  private current: TaskState<TResult> | null = null;
  private controller: AbortController | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly listeners = new Set<TaskListener>();
  private lastStart: TaskStartOptions<TResult> | null = null;

  get state() { return this.current; }
  subscribe(listener: TaskListener) { this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener); }

  private emit() { for (const listener of this.listeners) listener(this.current); }
  private set(next: TaskState<TResult> | null) { this.current = next; this.emit(); }

  start(options: TaskStartOptions<TResult>): TaskState<TResult> {
    this.cancel();
    const taskId = options.taskId || `${options.kind}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = now();
    const queued: TaskState<TResult> = {
      taskId, kind: options.kind, title: options.title, status: "queued", updatedAt: timestamp,
      retryable: options.retryable !== false, cancellable: options.cancellable !== false,
    };
    this.current = queued;
    this.lastStart = options;
    const generation = ++this.generation;
    this.emit();
    if (!options.run) { this.set({ ...queued, status: "running", startedAt: timestamp, updatedAt: now() }); return this.current!; }
    this.controller = new AbortController();
    if (options.timeoutMs && options.timeoutMs > 0) {
      this.timeout = setTimeout(() => {
        this.controller?.abort(new Error("任务超时"));
        this.cancel("任务超时，已取消");
      }, options.timeoutMs);
    }
    this.set({ ...queued, status: "running", startedAt: timestamp, updatedAt: now() });
    void options.run(this.controller.signal).then((result) => {
      if (generation !== this.generation || this.current?.taskId !== taskId) return;
      this.success(result);
    }).catch((error) => {
      if (generation !== this.generation || this.current?.taskId !== taskId) return;
      if (this.controller?.signal.aborted) this.cancel();
      else this.fail(error);
    });
    return this.current!;
  }

  update(patch: Partial<Pick<TaskState<TResult>, "stage" | "progress" | "message" | "retryable" | "cancellable">>) {
    if (!this.current || !["queued", "running"].includes(this.current.status)) return this.current;
    const progress = patch.progress === undefined ? this.current.progress : Math.min(1, Math.max(0, patch.progress));
    this.set({ ...this.current, ...patch, progress, updatedAt: now() });
    return this.current;
  }

  success(result?: TResult) {
    if (!this.current || !["queued", "running"].includes(this.current.status)) return this.current;
    this.clearTimers();
    this.set({ ...this.current, status: "success", result, progress: 1, updatedAt: now() });
    return this.current;
  }

  fail(error: unknown, retryable = this.current?.retryable ?? true) {
    if (!this.current || !["queued", "running"].includes(this.current.status)) return this.current;
    this.clearTimers();
    this.set({ ...this.current, status: "error", error: toError(error), retryable, updatedAt: now() });
    return this.current;
  }

  cancel(message = "已取消") {
    if (!this.current || !["queued", "running"].includes(this.current.status)) return this.current;
    this.generation += 1;
    this.controller?.abort();
    this.clearTimers();
    this.set({ ...this.current, status: "cancelled", message, updatedAt: now() });
    return this.current;
  }

  retry() {
    if (!this.current || this.current.status !== "error" || !this.lastStart || !this.current.retryable) return this.current;
    return this.start({ ...this.lastStart, taskId: this.current.taskId });
  }

  recoverAfterRestart() {
    if (!this.current || !["queued", "running"].includes(this.current.status)) return this.current;
    this.generation += 1;
    this.clearTimers();
    this.set({ ...this.current, status: "cancelled", message: "应用中断，未继续执行；可重新尝试", updatedAt: now() });
    return this.current;
  }

  private clearTimers() {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    this.controller = null;
  }
}

export const taskStatusLabel = (status: TaskStatus) => ({
  idle: "未开始", queued: "排队中", running: "进行中", success: "已完成", error: "失败", cancelled: "已取消",
}[status]);
