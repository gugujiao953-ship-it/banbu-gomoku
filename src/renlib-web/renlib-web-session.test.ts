import { afterEach, describe, expect, it, vi } from "vitest";
import { RenLibWebSession } from "./renlib-web-session";

type WorkerMessage = { requestId: number; cmd: string; parameter?: unknown };

class WorkerMock {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

let worker: WorkerMock;

const createSession = () => {
  class WorkerFactory extends WorkerMock {
    constructor() {
      super();
      worker = this;
    }
  }
  vi.stubGlobal("Worker", WorkerFactory);
  return new RenLibWebSession();
};

const resolveRequest = (payload: unknown) => {
  const calls = worker.postMessage.mock.calls;
  const message = calls[calls.length - 1]?.[0] as WorkerMessage;
  worker.onmessage?.({ data: { requestId: message.requestId, ok: true, cmd: "resolve", result: payload } } as MessageEvent);
  return message;
};

afterEach(() => vi.unstubAllGlobals());

describe("RenLibWebSession complete SGF export", () => {
  it("sends lib2sgf and trims the transferred buffer to byteLen", async () => {
    const session = createSession();
    const pending = session.convertToSgf();
    const buffer = new Uint8Array([1, 2, 3, 4, 0, 0]).buffer;
    const message = resolveRequest({ buf: buffer, byteLen: 4 });

    expect(message.cmd).toBe("lib2sgf");
    await expect(pending).resolves.toEqual(new Uint8Array([1, 2, 3, 4]).buffer);
    session.close();
  });

  it("rejects a missing SGF buffer", async () => {
    const session = createSession();
    const pending = session.convertToSgf();
    resolveRequest({ byteLen: 4 });

    await expect(pending).rejects.toThrow("没有返回有效的 SGF 数据");
    session.close();
  });

  it("rejects an invalid SGF byte length", async () => {
    const session = createSession();
    const pending = session.convertToSgf();
    resolveRequest({ buf: new ArrayBuffer(4), byteLen: 5 });

    await expect(pending).rejects.toThrow("SGF 长度无效");
    session.close();
  });
});
