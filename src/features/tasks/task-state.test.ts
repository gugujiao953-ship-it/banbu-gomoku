import { describe, expect, it, vi } from "vitest";
import { TaskManager } from "./task-state";

describe("TaskManager", () => {
  it("supports queued/running/success and clamps known progress", async () => {
    const manager = new TaskManager<number>();
    const states: string[] = [];
    manager.subscribe((task) => { if (task) states.push(task.status); });
    manager.start({ kind: "import", title: "导入", run: async () => 42 });
    manager.update({ stage: "parsing", progress: 2 });
    await vi.waitFor(() => expect(manager.state?.status).toBe("success"));
    expect(manager.state?.result).toBe(42);
    expect(states).toEqual(["queued", "running", "running", "success"]);
    expect(manager.state?.progress).toBe(1);
  });

  it("ignores stale completion after cancellation and supports retry", async () => {
    let resolve: ((value: string) => void) | undefined;
    const manager = new TaskManager<string>();
    manager.start({ kind: "ai", title: "AI", run: () => new Promise<string>((done) => { resolve = done; }) });
    manager.cancel();
    resolve?.("old");
    await Promise.resolve();
    expect(manager.state?.status).toBe("cancelled");
    const failing = new TaskManager<string>();
    failing.start({ kind: "update-check", title: "更新", run: async () => { throw new Error("网络"); } });
    await vi.waitFor(() => expect(failing.state?.status).toBe("error"));
    expect(failing.retry()?.status).toBe("running");
  });

  it("cancels on timeout and marks interrupted work after restart", async () => {
    const manager = new TaskManager<void>();
    manager.start({ kind: "load", title: "读取", timeoutMs: 10, run: () => new Promise<void>(() => undefined) });
    await vi.waitFor(() => expect(manager.state?.status).toBe("cancelled"));
    expect(manager.state?.message).toContain("任务超时");
    manager.start({ kind: "load", title: "读取" });
    manager.recoverAfterRestart();
    expect(manager.state?.status).toBe("cancelled");
    expect(manager.state?.message).toContain("应用中断");
  });
});
