// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ONLINE_PROXY_TEMPLATE_KEY,
  fetchOnlineBytes,
  fetchOnlineResponse,
  fetchOnlineText,
  hasNativeHttp,
  needsOnlineProxySetting,
  onlineTransportPlan,
  resetOnlineTransportState,
  saveOnlineProxyTemplate,
} from "./online-http";

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

const nativeBridge = (responder: (url: string) => { status?: number; body?: string; contentType?: string }) => {
  (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      CapacitorHttp: {
        request: async (options: { url: string }) => {
          const result = responder(options.url);
          return {
            status: result.status ?? 200,
            headers: { "Content-Type": result.contentType ?? "text/html" },
            data: result.body ?? "",
            url: options.url,
          };
        },
      },
    },
  };
};

beforeEach(() => {
  resetOnlineTransportState();
  localStorage.clear();
  delete (globalThis as unknown as { Capacitor?: unknown }).Capacitor;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { Capacitor?: unknown }).Capacitor;
});

/** Outbound requests must never be pointable at the local machine or a LAN
 *  device, whatever the caller passes in. */
describe("outbound URL guard", () => {
  it("refuses loopback, private and reserved targets before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [
      "http://localhost:8080/x",
      "http://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://192.168.1.1/x",
      "https://172.20.3.4/x",
      "https://169.254.1.1/x",
      "https://router.local/x",
      "https://[::1]/x",
      "file:///etc/passwd",
      "ftp://example.com/x",
    ]) {
      await expect(fetchOnlineText(url)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("transport selection", () => {
  it("prefers the native channel on a device and plain fetch on the web", () => {
    expect(onlineTransportPlan()).toEqual(["direct"]);
    nativeBridge(() => ({ body: "<html></html>" }));
    expect(hasNativeHttp()).toBe(true);
    expect(onlineTransportPlan()).toEqual(["native", "direct"]);
  });

  it("代理输入框只在网页版显示：安卓端（native）不显示，网页版显示", () => {
    // 用户 2026-10-05：「这些代理位置直接去掉就是了」+「别把励精弄不能用」——
    // 安卓走系统直连、用不上代理，设置里就不摆这个框；网页版没有它就跨域读不了励精连珠教室。
    expect(needsOnlineProxySetting()).toBe(true);
    nativeBridge(() => ({ body: "<html></html>" }));
    expect(needsOnlineProxySetting()).toBe(false);
  });

  it("inserts the user's proxy ahead of the browser's own fetch", () => {
    saveOnlineProxyTemplate("https://proxy.example/?url={url}");
    expect(onlineTransportPlan()).toEqual(["proxy", "direct"]);
    expect(localStorage.getItem(ONLINE_PROXY_TEMPLATE_KEY)).toBe("https://proxy.example/?url={url}");
  });

  it("refuses a proxy that points at the local network", async () => {
    saveOnlineProxyTemplate("http://127.0.0.1:8081/?url={url}");
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true })));
    await expect(fetchOnlineText("https://www.renju.net/x")).rejects.toThrow("代理");
  });
});

describe("native channel", () => {
  it("times out a native promise that ignores abort and falls back to fetch", async () => {
    vi.useFakeTimers();
    nativeBridge(() => ({ body: "" }));
    const capacitor = (globalThis as unknown as { Capacitor: { Plugins: { CapacitorHttp: { request: () => Promise<unknown> } } } }).Capacitor;
    capacitor.Plugins.CapacitorHttp.request = () => new Promise(() => undefined);
    const fetchMock = vi.fn(async () => new Response("fallback", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchOnlineText("https://www.renju.net/timeout", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(4101);
    expect(await result).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("base64-decodes arraybuffer payloads from the Android bridge", async () => {
    nativeBridge(() => ({ body: btoa("Piskvorky 15x15,0,0,0"), contentType: "text/plain" }));
    const response = await fetchOnlineResponse("https://www.renju.net/records/x.psq");
    expect(response.transport).toBe("native");
    expect(new TextDecoder().decode(response.bytes)).toBe("Piskvorky 15x15,0,0,0");
  });

  it("reads a non-CORS host that the browser could not reach", async () => {
    // renju.net sends no Access-Control-Allow-Origin header at all.
    nativeBridge((url) => ({ body: btoa(`<html data-url="${url}"></html>`) }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const text = await fetchOnlineText("https://www.renju.net/game/search");
    expect(text).toContain("www.renju.net/game/search");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a real HTTP status instead of retrying other channels", async () => {
    nativeBridge(() => ({ status: 404, body: "" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchOnlineText("https://www.renju.net/gone")).rejects.toThrow("HTTP 404");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects that end at a private address", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      url: "http://127.0.0.1/admin",
      arrayBuffer: async () => new TextEncoder().encode("secret").buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchOnlineText("https://www.renju.net/redirect")).rejects.toThrow();
  });
});

describe("web channel", () => {
  it("posts the encoded target through a proxy template", async () => {
    saveOnlineProxyTemplate("https://proxy.example/fetch?target={url}");
    const fetchMock = vi.fn(async (input: string) => {
      expect(input).toBe(`https://proxy.example/fetch?target=${encodeURIComponent("https://www.renju.net/game/1/")}`);
      return new Response("<html>proxied</html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOnlineText("https://www.renju.net/game/1/")).toBe("<html>proxied</html>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a direct request when the proxy is unreachable", async () => {
    saveOnlineProxyTemplate("https://proxy.example/fetch?target={url}");
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith("https://proxy.example")) throw new TypeError("Failed to fetch");
      return new Response("<html>direct</html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOnlineText("https://www.renju.net/game/2/")).toBe("<html>direct</html>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("decodes a GBK page instead of mangling the player names", async () => {
    const gbk = new Uint8Array([0xc1, 0xac, 0xd6, 0xe9]); // 连珠 in GB18030
    vi.stubGlobal("fetch", vi.fn(async () => new Response(gbk, { status: 200, headers: { "content-type": "text/html" } })));
    expect(await fetchOnlineText("https://www.renju.net/gbk")).toBe("连珠");
  });

  it("explains that the web build may need a proxy when every channel fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(fetchOnlineText("https://www.renju.net/x")).rejects.toThrow(/代理地址/);
  });
});

describe("session cache", () => {
  it("allows another host to start while one host is waiting for its slot", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return new Response(url); }));
    await fetchOnlineText("https://one.example/1");
    const queued = fetchOnlineText("https://one.example/2");
    const other = fetchOnlineText("https://two.example/1");
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toContain("https://two.example/1");
    expect(urls).not.toContain("https://one.example/2");
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.all([queued, other]);
  });
  it("serves a repeated lookup from memory so browsing does not re-hit the source", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>once</html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOnlineText("https://www.renju.net/cached")).toBe("<html>once</html>");
    expect(await fetchOnlineText("https://www.renju.net/cached")).toBe("<html>once</html>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the caller asks for a refresh", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>again</html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchOnlineBytes("https://www.renju.net/refresh");
    await fetchOnlineBytes("https://www.renju.net/refresh", { noCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
