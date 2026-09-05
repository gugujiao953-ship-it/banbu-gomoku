import { describe, expect, it } from "vitest";
import { AiWorkerController, type ControlledWorker } from "./ai-worker-controller";

class FakeWorker implements ControlledWorker {
  messages: unknown[] = [];
  terminated = 0;
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated += 1; }
}

describe("AiWorkerController", () => {
  it("actively stops and rejects stale messages", () => {
    const controller = new AiWorkerController();
    const worker = new FakeWorker();
    const handle = controller.start(worker, "game", "record-a/node-1");
    expect(controller.cancel("user")).toBe(true);
    expect(worker.messages).toContainEqual(expect.objectContaining({ type: "stop", requestId: handle.requestId }));
    expect(worker.terminated).toBe(1);
    expect(controller.isCurrent(handle)).toBe(false);
    expect(controller.cancel("user")).toBe(false);
    expect(worker.terminated).toBe(1);
  });

  it("terminates a previous request before starting a replacement", () => {
    const controller = new AiWorkerController();
    const first = new FakeWorker();
    const oldHandle = controller.start(first, "analysis", "a");
    const second = new FakeWorker();
    const newHandle = controller.start(second, "analysis", "b");
    expect(first.terminated).toBe(1);
    expect(controller.isCurrent(oldHandle)).toBe(false);
    expect(controller.isCurrent(newHandle)).toBe(true);
  });

  it("force-terminates a broken worker and allows a clean rebuild", () => {
    const controller = new AiWorkerController();
    const broken = new FakeWorker();
    const handle = controller.start(broken, "game", "position");
    const fallback = new FakeWorker();
    expect(controller.replaceWorker(handle, fallback)).toBe(true);
    expect(broken.terminated).toBe(1);
    expect(controller.finish(handle)).toBe(true);
    expect(fallback.terminated).toBe(1);
    const rebuilt = new FakeWorker();
    expect(controller.isCurrent(controller.start(rebuilt, "game", "next"))).toBe(true);
  });

  it("rejects a response with a stale request or generation before it can finish", () => {
    const controller = new AiWorkerController();
    const worker = new FakeWorker();
    const handle = controller.start(worker, "game", "position");
    expect(controller.isCurrent(handle, "old-request", handle.generation)).toBe(false);
    expect(controller.isCurrent(handle, handle.requestId, handle.generation - 1)).toBe(false);
    expect(controller.finish({ ...handle, generation: handle.generation - 1 })).toBe(false);
    expect(worker.terminated).toBe(0);
    expect(controller.finish(handle)).toBe(true);
  });
});
