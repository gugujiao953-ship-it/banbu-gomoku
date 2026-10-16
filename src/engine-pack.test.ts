import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { return this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { return void this.values.delete(key); }
  setItem(key: string, value: string) { return void this.values.set(key, String(value)); }
}
vi.stubGlobal("localStorage", new MemoryStorage());

// Pack size comes from the module itself so the fake payload always matches.
const PACK_SIZE_REF = { size: 0 };

const loadModule = async () => {
  vi.resetModules();
  const pack = await import("./features/ai/engine-pack");
  PACK_SIZE_REF.size = pack.ENGINE_PACK_SIZE;
  return pack;
};

const fakePackResponse = (size = PACK_SIZE_REF.size, init?: { headers?: { get?: (name: string) => string | null } }) => {
  const payload = new Uint8Array(size);
  let status = 200;
  let bodyBytes = payload;
  // 支持 Range 分片（分片并发下载会发 bytes=start-end 请求）：带 Range 头时
  // 返回 206 对应段；否则 200 整文件（流式回退路径）。
  const headerGet = init && init.headers && typeof init.headers.get === "function" ? init.headers.get : undefined;
  const range = headerGet ? headerGet("range") : undefined;
  if (range && range.startsWith("bytes=")) {
    const dash = range.indexOf("-", 6);
    if (dash > 0) {
      const startNum = Number(range.slice(6, dash));
      const endNum = Number(range.slice(dash + 1));
      const start = Number.isFinite(startNum) ? Math.min(Math.max(startNum, 0), size - 1) : 0;
      const end = Number.isFinite(endNum) ? Math.min(endNum, size - 1) : size - 1;
      bodyBytes = payload.subarray(start, end + 1);
      status = 206;
    }
  }
  return {
    ok: status < 400,
    status,
    headers: new Map([["content-length", String(bodyBytes.length)]]),
    body: { getReader: () => {
      let done = false;
      return { read: async () => {
        if (done) return { done: true, value: undefined };
        done = true;
        return { done: false, value: bodyBytes };
      } };
    } },
  } as unknown as Response;
};

describe("engine pack host validation", () => {
  it("accepts public https hosts", async () => {
    const pack = await loadModule();
    expect(pack.assertPublicHttpUrl("https://gugujiao953-ship-it.github.io/banbu-gomoku/engine-packs/rapfi-full-v1.data")).toBeTruthy();
    expect(pack.assertPublicHttpUrl("https://github.com/a/b/releases/download/v1/x.data")).toBeTruthy();
  });
  it("rejects loopback, private and reserved targets", async () => {
    const pack = await loadModule();
    for (const url of [
      "http://localhost/x.data",
      "http://127.0.0.1:5193/engine-packs/x.data",
      "http://[::1]/x.data",
      "http://10.0.0.3/x.data",
      "http://172.16.1.1/x.data",
      "http://172.31.9.9/x.data",
      "http://192.168.1.2/x.data",
      "http://169.254.1.1/x.data",
      "http://100.64.0.1/x.data",
      "http://0.1.2.3/x.data",
      "file:///etc/x.data",
      "ftp://example.com/x.data",
    ]) {
      expect(() => pack.assertPublicHttpUrl(url)).toThrow();
    }
  });
  it("rejects malformed hosts instead of throwing raw errors", async () => {
    const pack = await loadModule();
    expect(() => pack.assertPublicHttpUrl("not a url")).toThrow();
    expect(() => pack.assertPublicHttpUrl("https://999.1.1.1/x.data")).toThrow();
  });
});

describe("engine pack download lifecycle", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    localStorage.clear();
    // fake-indexeddb 是进程级共享的：用例之间不清库，上一个用例存的 40MB 包会被
    // 下一个用例的「自愈」逻辑读到（2026-09-18 加自愈后立刻踩到）。
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("banbu-engine-pack-v1");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => fakePackResponse(PACK_SIZE_REF.size, init as { headers?: { get?: (name: string) => string | null } })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads, flags the state, and exposes an object URL", async () => {
    const pack = await loadModule();
    const progress: number[] = [];
    const state = await pack.downloadEnginePack((next) => progress.push(next.receivedBytes));
    expect(state.version).toBe(pack.ENGINE_PACK_VERSION);
    expect(state.size).toBe(pack.ENGINE_PACK_SIZE);
    expect(pack.enginePackSnapshot().state).not.toBeNull();
    const url = await pack.ensureEnginePackUrl();
    expect(url).toBeTruthy();
    expect(url).toMatch(/^blob:/);
  });

  it("restores the object URL from IndexedDB after a fresh module load", async () => {
    const first = await loadModule();
    await first.downloadEnginePack();
    const second = await loadModule();
    expect(second.enginePackSnapshot().state?.size).toBe(first.ENGINE_PACK_SIZE);
    expect(second.enginePackSnapshot().objectUrl).toBeNull();
    const url = await second.ensureEnginePackUrl();
    expect(url).toMatch(/^blob:/);
  });

  it("rejects a truncated download and leaves the state unflagged", async () => {
    const pack = await loadModule();
    vi.stubGlobal("fetch", vi.fn(async () => fakePackResponse(pack.ENGINE_PACK_SIZE - 1)));
    await expect(pack.downloadEnginePack()).rejects.toThrow();
    expect(pack.enginePackSnapshot().state).toBeNull();
    expect(await pack.ensureEnginePackUrl()).toBeNull();
  });

  it("falls through to the next source when a download fails", async () => {
    const pack = await loadModule();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockImplementation(async (_url: string, init?: RequestInit) => fakePackResponse(PACK_SIZE_REF.size, init as { headers?: { get?: (name: string) => string | null } }));
    vi.stubGlobal("fetch", fetchMock);
    const state = await pack.downloadEnginePack();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(state.size).toBe(pack.ENGINE_PACK_SIZE);
  });

  it("delete clears the flag and the stored blob", async () => {
    const pack = await loadModule();
    await pack.downloadEnginePack();
    await pack.deleteEnginePack();
    expect(pack.enginePackSnapshot().state).toBeNull();
    expect(await pack.ensureEnginePackUrl()).toBeNull();
  });

  it("retains received bytes when resuming an interrupted range", async () => {
    const pack = await loadModule();
    let interrupted = false;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return { ok: true, headers: new Headers({ "content-length": String(pack.ENGINE_PACK_SIZE), "accept-ranges": "bytes" }) };
      const range = new Headers(init?.headers).get("range");
      if (!range) throw new Error("must resume, not restart the whole transfer");
      const [start, end] = range.replace("bytes=", "").split("-").map(Number);
      const bytes = new Uint8Array(end - start + 1).fill(7);
      if (!interrupted && start === 0) {
        interrupted = true;
        let sent = false;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) { sent = true; controller.enqueue(bytes.subarray(0, 300)); }
            else controller.error(new Error("connection reset"));
          },
        }), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${pack.ENGINE_PACK_SIZE}` } });
      }
      return new Response(bytes, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${pack.ENGINE_PACK_SIZE}` } });
    }));
    await pack.downloadEnginePack();
    const url = await pack.ensureEnginePackUrl();
    const database = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("banbu-engine-pack-v1", 1); request.onsuccess = () => resolve(request.result); });
    try {
      const blob = await new Promise<Blob>((resolve) => { const request = database.transaction("packs", "readonly").objectStore("packs").get(pack.ENGINE_PACK_FILENAME); request.onsuccess = () => resolve(request.result as Blob); });
      expect(url).toMatch(/^blob:/);
      const prefix = new Uint8Array(await blob.slice(0, 300).arrayBuffer());
      expect(prefix.every((byte) => byte === 7)).toBe(true);
    } finally { database.close(); }
  });

  // 2026-09-18 用户报「本来就有模型，界面却让我下载引擎」：localStorage 里那行标记
  // 丢一次（被清、写坏、或版本号对不上——readStoredState 只要 version 不等于当前版本
  // 就返回 null），旧实现就再也不看 IndexedDB，界面与所有判定都当成「没装引擎包」并
  // 引导去下载 38.4MB，而 40MB 的包本体其实还躺在库里。
  it("标记丢了但库里还有包：自愈回「已生效」，不把界面判成没装引擎", async () => {
    const first = await loadModule();
    await first.downloadEnginePack();
    localStorage.removeItem("banbu-engine-pack-state-v1");

    const second = await loadModule();
    expect(second.enginePackSnapshot().state).toBeNull(); // 标记确实丢了
    const url = await second.ensureEnginePackUrl();
    expect(url).toMatch(/^blob:/); // 仍然能读出来用
    expect(second.enginePackSnapshot().state).not.toBeNull(); // 状态被补回来
    expect(JSON.parse(localStorage.getItem("banbu-engine-pack-state-v1") ?? "{}").size).toBe(second.ENGINE_PACK_SIZE);
  });

  it("库里没有包时（真没装）依然返回 null，不会凭空造出状态", async () => {
    const pack = await loadModule();
    expect(pack.enginePackSnapshot().state).toBeNull();
    expect(await pack.ensureEnginePackUrl()).toBeNull();
    expect(pack.enginePackSnapshot().state).toBeNull();
  });
});

describe("engine pack config tune (T49 noasp)", () => {
  it("flips aspiration inside the segment, keeps length, touches nothing else", async () => {
    const pack = await loadModule();
    const seg = new Uint8Array(300);
    seg.set(new TextEncoder().encode("xxaspiration_window = true\r\nadvanced_stop_ratio = 0.75\r\nyy"), 40);
    const tuned = pack.tunePackBytes(seg, 0, 300);
    expect(tuned).not.toBeNull();
    expect(tuned!.length).toBe(300);
    const text = new TextDecoder().decode(tuned!);
    expect(text).toContain("aspiration_window= false");
    expect(text).toContain("advanced_stop_ratio = 0.90");
    expect(text).not.toContain("aspiration_window = true");
    expect(Array.from(seg.slice(0, 42))).toEqual(Array.from(tuned!.slice(0, 42)));
    expect(Array.from(seg.slice(95))).toEqual(Array.from(tuned!.slice(95)));
  });

  it("applies the needles it finds and skips the ones it does not", async () => {
    const pack = await loadModule();
    const seg = new Uint8Array(300);
    seg.set(new TextEncoder().encode("aspiration_window = true\r\n"), 40);
    const tuned = pack.tunePackBytes(seg, 0, 300);
    expect(tuned).not.toBeNull();
    const text = new TextDecoder().decode(tuned!);
    expect(text).toContain("aspiration_window= false");
  });

  it("returns null when the needle is absent from the segment", async () => {
    const pack = await loadModule();
    const tuned = pack.tunePackBytes(new Uint8Array(200), 0, 100);
    expect(tuned).toBeNull();
  });

  it("rejects segment ranges outside the buffer", async () => {
    const pack = await loadModule();
    const seg = new Uint8Array(50);
    seg.set(new TextEncoder().encode("aspiration_window = true"));
    expect(pack.tunePackBytes(seg, 0, 500)).toBeNull();
  });
});
