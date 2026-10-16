import { afterEach, describe, expect, it, vi } from "vitest";
import { APK_MIME_TYPE, downloadApk, sha256Hex } from "./apk-download";

// Node 18+ 自带 webcrypto；这里只需保证测试环境有 subtle。
const realCrypto = globalThis.crypto;

const bytesOf = (length: number, seed = 7) => {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * seed + 13) % 251;
  return bytes;
};

const respond = (body: Uint8Array | null, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(body ? new Blob([body.slice().buffer as ArrayBuffer]) : null, { status: init.status ?? 200, headers: init.headers ?? {} });

/** 记录每次请求（URL + Range 头），便于断言分片与预检都走了预期路径。 */
const recordingFetch = (handler: (url: string, init: RequestInit | undefined) => Response) => {
  const calls: Array<{ url: string; method: string; range?: string }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: String(init?.method || "GET").toUpperCase(), range: headers.get("range") ?? undefined });
    return handler(url, init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
};

afterEach(() => vi.unstubAllGlobals());

describe("apk download", () => {
  it("hashes bytes as uppercase hex", async () => {
    expect(await sha256Hex(new Uint8Array([]))).toBe("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855");
  });

  it("downloads through chunks when the source supports ranges", async () => {
    const payload = bytesOf(1024 * 1024 + 512); // 跨越两个分片
    const { impl, calls } = recordingFetch((_url, init) => {
      if (String(init?.method).toUpperCase() === "HEAD") {
        return respond(null, { headers: { "content-length": String(payload.byteLength), "accept-ranges": "bytes" } });
      }
      const range = new Headers(init?.headers).get("range");
      const [start, end] = String(range).replace("bytes=", "").split("-").map(Number);
      return respond(payload.subarray(start, end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${payload.byteLength}` } });
    });
    const progress: number[] = [];
    const artifact = await downloadApk({
      urls: ["https://example.com/app.apk"],
      filename: "app.apk",
      expectedSize: payload.byteLength,
      fetchImpl: impl,
      onProgress: ({ receivedBytes }: { receivedBytes: number }) => progress.push(receivedBytes),
    } as never);
    expect(artifact.bytes.byteLength).toBe(payload.byteLength);
    expect([...artifact.bytes]).toEqual([...payload]);
    expect(calls.some((call) => call.range)).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("falls back to a single stream when the source ignores Range", async () => {
    const payload = bytesOf(4096);
    const { impl, calls } = recordingFetch((_url, init) => {
      if (String(init?.method).toUpperCase() === "HEAD") return respond(null, { headers: { "content-length": String(payload.byteLength) } });
      // 忽略 Range，回整文件 200。
      return respond(payload, { headers: { "content-type": APK_MIME_TYPE } });
    });
    const artifact = await downloadApk({ urls: ["https://example.com/app.apk"], filename: "app.apk", expectedSize: payload.byteLength, fetchImpl: impl } as never);
    expect(artifact.bytes.byteLength).toBe(payload.byteLength);
    expect(calls.filter((call) => call.range).length).toBeGreaterThan(0); // 预检试过 Range
  });

  it("rejects a payload whose length differs from the declared size", async () => {
    const payload = bytesOf(2048);
    const { impl } = recordingFetch((_url, init) => {
      if (String(init?.method).toUpperCase() === "HEAD") return respond(null, { headers: { "content-length": String(payload.byteLength), "accept-ranges": "bytes" } });
      return respond(payload, { status: 206, headers: { "content-range": `bytes 0-2047/2048` } });
    });
    await expect(downloadApk({ urls: ["https://example.com/app.apk"], filename: "app.apk", expectedSize: 9999, fetchImpl: impl } as never))
      .rejects.toThrow(/下载失败/);
  });

  it("rejects a payload whose SHA-256 does not match", async () => {
    const payload = bytesOf(1024);
    const { impl } = recordingFetch((_url, init) => {
      if (String(init?.method).toUpperCase() === "HEAD") return respond(null, { headers: { "content-length": String(payload.byteLength), "accept-ranges": "bytes" } });
      return respond(payload, { status: 206, headers: { "content-range": `bytes 0-1023/1024` } });
    });
    await expect(downloadApk({
      urls: ["https://example.com/app.apk"],
      filename: "app.apk",
      expectedSize: payload.byteLength,
      expectedSha256: "0".repeat(64),
      fetchImpl: impl,
    } as never)).rejects.toThrow(/SHA-256/);
  });

  it("accepts the payload when SHA-256 matches (case-insensitive)", async () => {
    const payload = bytesOf(2048);
    const digest = await sha256Hex(payload);
    const { impl } = recordingFetch((_url, init) => {
      if (String(init?.method).toUpperCase() === "HEAD") return respond(null, { headers: { "content-length": String(payload.byteLength), "accept-ranges": "bytes" } });
      return respond(payload, { status: 206, headers: { "content-range": `bytes 0-${payload.byteLength - 1}/${payload.byteLength}` } });
    });
    const artifact = await downloadApk({
      urls: ["https://example.com/app.apk"],
      filename: "app.apk",
      expectedSize: payload.byteLength,
      expectedSha256: digest.toLowerCase(),
      fetchImpl: impl,
    } as never);
    expect(artifact.sha256).toBe(digest);
  });

  it("refuses loopback, private and non-http sources before any request", async () => {
    const { impl, calls } = recordingFetch(() => respond(bytesOf(16)));
    await expect(downloadApk({
      urls: ["http://127.0.0.1/app.apk", "http://192.168.1.9/app.apk", "http://localhost/app.apk", "file:///app.apk"],
      filename: "app.apk",
      fetchImpl: impl,
    } as never)).rejects.toThrow(/下载失败/);
    expect(calls).toHaveLength(0); // 一个请求都不该发出去
  });

  it("moves to the next source when the first one fails", async () => {
    const payload = bytesOf(512);
    const { impl, calls } = recordingFetch((url, init) => {
      if (url.includes("broken")) return respond(null, { status: 404 });
      if (String(init?.method).toUpperCase() === "HEAD") return respond(null, { headers: { "content-length": String(payload.byteLength), "accept-ranges": "bytes" } });
      return respond(payload, { status: 206, headers: { "content-range": `bytes 0-511/512` } });
    });
    const artifact = await downloadApk({
      urls: ["https://example.com/broken.apk", "https://example.com/good.apk"],
      filename: "app.apk",
      expectedSize: payload.byteLength,
      fetchImpl: impl,
    } as never);
    expect(artifact.bytes.byteLength).toBe(payload.byteLength);
    expect(calls.some((call) => call.url.includes("broken"))).toBe(true);
    expect(calls.some((call) => call.url.includes("good"))).toBe(true);
  });

  it("honours an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    // 真实 fetch 会在 signal 已中止时立刻抛 AbortError，mock 必须照做，
    // 否则测的是 mock 而不是产品代码里的取消语义。
    const impl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      return respond(bytesOf(64));
    }) as unknown as typeof fetch;
    await expect(downloadApk({
      urls: ["https://example.com/app.apk"],
      filename: "app.apk",
      fetchImpl: impl,
      signal: controller.signal,
    } as never)).rejects.toThrow(/取消/);
  });

  it("preserves partial chunk bytes when a connection breaks and resumes", async () => {
    const payload = bytesOf(1024);
    let interrupted = false;
    const { impl, calls } = recordingFetch((_url, init) => {
      if (init?.method === "HEAD") return respond(null, { headers: { "content-length": "1024", "accept-ranges": "bytes" } });
      const [start, end] = new Headers(init?.headers).get("range")!.replace("bytes=", "").split("-").map(Number);
      if (!interrupted) {
        interrupted = true;
        let sent = false;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) { sent = true; controller.enqueue(payload.subarray(start, start + 300)); }
            else controller.error(new Error("connection reset"));
          },
        }), { status: 206, headers: { "content-range": `bytes ${start}-${end}/1024` } });
      }
      return respond(payload.subarray(start, end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/1024` } });
    });
    const artifact = await downloadApk({ urls: ["https://example.com/app.apk"], filename: "app.apk", expectedSize: payload.length, fetchImpl: impl });
    expect(artifact.bytes).toEqual(payload);
    expect(calls.some((call) => call.range === "bytes=300-1023")).toBe(true);
  });

  it("rejects a server returning bytes from the wrong range", async () => {
    const payload = bytesOf(512 * 1024 + 16);
    const { impl } = recordingFetch((_url, init) => {
      if (init?.method === "HEAD") return respond(null, { headers: { "content-length": String(payload.length), "accept-ranges": "bytes" } });
      const [start, end] = new Headers(init?.headers).get("range")!.replace("bytes=", "").split("-").map(Number);
      const length = end - start + 1;
      return respond(payload.subarray(0, length), { status: 206, headers: { "content-range": `bytes 0-${length - 1}/${payload.length}` } });
    });
    await expect(downloadApk({ urls: ["https://example.com/app.apk"], filename: "app.apk", expectedSize: payload.length, fetchImpl: impl })).rejects.toThrow(/下载失败/);
  });

  it("does not return an artifact after cancellation during digest verification", async () => {
    const payload = bytesOf(64);
    const controller = new AbortController();
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args) => {
      const result = await originalDigest(...args);
      controller.abort();
      return result;
    });
    const { impl } = recordingFetch((_url, init) => init?.method === "HEAD"
      ? respond(null, { headers: { "content-length": "64", "accept-ranges": "bytes" } })
      : respond(payload, { status: 206, headers: { "content-range": "bytes 0-63/64" } }));
    try {
      await expect(downloadApk({ urls: ["https://example.com/app.apk"], filename: "app.apk", fetchImpl: impl, signal: controller.signal })).rejects.toThrow(/取消/);
    } finally { digest.mockRestore(); }
  });
});

// 保留引用：某些环境里 crypto 是通过 globalThis 注入的。
void realCrypto;
