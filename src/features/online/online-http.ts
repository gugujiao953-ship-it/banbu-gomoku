/**
 * Outbound transport for the online record library.
 *
 * Three channels, tried in order:
 *   native  — CapacitorHttp runs on the OS HTTP stack, so a site that sends no
 *             CORS header (renju.net and most community sites) is still readable.
 *             Called explicitly; we deliberately never enable the global
 *             `CapacitorHttp.enabled` patch, because that would also rewrite
 *             `fetch` for the engine-pack downloader, which depends on streaming
 *             bodies and Range requests.
 *   proxy   — optional user-supplied prefix for the **browser build only**, where
 *             CORS cannot be bypassed any other way（用户 2026-10-05：「别把励精弄
 *             不能用」——安卓端走 native，不需要它，所以设置项在安卓端不再显示；
 *             网页版保留，否则网页版读不了励精连珠教室）。
 *   direct  — plain `fetch`; works for sources that do send CORS headers.
 *
 * Every URL passes `assertPublicHttpUrl` first, so nothing here can be pointed
 * at localhost or a private address. Requests to one host are spaced out and
 * successful responses are cached for the session, so browsing a database does
 * not hammer the source.
 */
import { decodeText } from "../../formats";
import { assertPublicHttpUrl } from "../../url-safety";
import { withRequestTimeout } from "../../request-timeout";

export type OnlineTransport = "native" | "proxy" | "direct";

export interface OnlineResponse {
  status: number;
  contentType: string;
  bytes: Uint8Array;
  finalUrl: string;
  transport: OnlineTransport;
}

export interface OnlineRequestOptions {
  /** Say what failed, in the caller's words: 「棋谱库」/「棋谱页面」. */
  label?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Bypass the once-only in-memory cache (used by an explicit 刷新). */
  noCache?: boolean;
}

export const ONLINE_PROXY_TEMPLATE_KEY = "banbu-online-proxy-v1";
/** One request per host per interval: polite enough for a community database. */
export const ONLINE_MIN_HOST_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 80;
const DEFAULT_TIMEOUT_MS = 20000;

interface CacheEntry { at: number; response: OnlineResponse }
const responseCache = new Map<string, CacheEntry>();
const hostLastRequest = new Map<string, number>();
const hostRequestChains = new Map<string, Promise<void>>();

export const loadOnlineProxyTemplate = () => {
  try {
    return localStorage.getItem(ONLINE_PROXY_TEMPLATE_KEY) || "";
  } catch {
    return "";
  }
};

export const saveOnlineProxyTemplate = (template: string) => {
  const trimmed = template.trim();
  try {
    if (trimmed) localStorage.setItem(ONLINE_PROXY_TEMPLATE_KEY, trimmed);
    else localStorage.removeItem(ONLINE_PROXY_TEMPLATE_KEY);
  } catch {
    /* private mode: the setting simply does not persist */
  }
};

interface CapacitorHttpBridge {
  isNativePlatform?: () => boolean;
  Plugins?: { CapacitorHttp?: { request?: (options: Record<string, unknown>) => Promise<{ data?: unknown; status?: number; headers?: Record<string, string>; url?: string }> } };
}
const bridge = () => (globalThis as { Capacitor?: CapacitorHttpBridge }).Capacitor ?? null;
export const hasNativeHttp = () => {
  const capacitor = bridge();
  if (!capacitor?.isNativePlatform?.()) return false;
  return typeof capacitor.Plugins?.CapacitorHttp?.request === "function";
};

/** Which channels this runtime will actually try, in order. */
export const onlineTransportPlan = (): OnlineTransport[] => {
  if (hasNativeHttp()) return ["native", "direct"];
  return loadOnlineProxyTemplate() ? ["proxy", "direct"] : ["direct"];
};

/** 设置里要不要显示「在线棋谱代理地址」输入框：**只有网页版需要**。
 *  安卓端走 native（系统网络直连，不受跨域限制），这个输入框在手机上只是噪音——
 *  用户 2026-10-05：「这些代理位置直接去掉就是了」，因此安卓端不再显示；
 *  网页版保留，否则网页版读不了励精连珠教室（用户同一条要求：别把励精弄不能用）。 */
export const needsOnlineProxySetting = () => !hasNativeHttp();

const proxyTarget = (url: string, template: string) => {
  assertPublicHttpUrl(template, "代理");
  return template.includes("{url}") ? template.replace("{url}", encodeURIComponent(url)) : `${template}${encodeURIComponent(url)}`;
};

/** Base64 -> bytes. Android returns `arraybuffer` responses as base64 text. */
const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const toBytes = async (data: unknown): Promise<Uint8Array> => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return base64ToBytes(data.trim());
  if (data && typeof data === "object") return new Uint8Array(await new Response(data as Blob).arrayBuffer());
  return new Uint8Array();
};

const withTimeout = async <T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  return withRequestTimeout(run, timeoutMs, `${label}请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
};

/** Serialise per host so concurrent batch downloads never burst the source. */
const waitForHostSlot = (host: string) => {
  const previous = hostRequestChains.get(host) ?? Promise.resolve();
  const scheduled = previous.then(async () => {
    const last = hostLastRequest.get(host) ?? 0;
    const wait = last + ONLINE_MIN_HOST_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    hostLastRequest.set(host, Date.now());
  });
  hostRequestChains.set(host, scheduled);
  void scheduled.finally(() => {
    if (hostRequestChains.get(host) === scheduled) hostRequestChains.delete(host);
  });
  return scheduled;
};

const requestNative = async (url: string, options: OnlineRequestOptions, label: string, timeoutMs: number): Promise<OnlineResponse> => {
  const plugin = bridge()?.Plugins?.CapacitorHttp;
  if (!plugin?.request) throw new Error("当前安装包不支持原生网络请求");
  const response = await withTimeout(
    () => plugin.request!({
      url,
      method: "GET",
      responseType: "arraybuffer",
      headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...options.headers },
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    }),
    timeoutMs + 4000,
    label,
  );
  return {
    status: response?.status ?? 0,
    contentType: response?.headers?.["Content-Type"] || response?.headers?.["content-type"] || "",
    bytes: await toBytes(response?.data),
    finalUrl: response?.url || url,
    transport: "native",
  };
};

const requestFetch = async (target: string, options: OnlineRequestOptions, label: string, timeoutMs: number): Promise<OnlineResponse> => {
  return withTimeout(async (signal) => {
    const response = await fetch(target, { signal, redirect: "follow", cache: "no-store", headers: options.headers });
    const buffer = await response.arrayBuffer();
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bytes: new Uint8Array(buffer),
      finalUrl: response.url || target,
      transport: "direct" as const,
    };
  }, timeoutMs, label);
};

export const fetchOnlineResponse = async (rawUrl: string, options: OnlineRequestOptions = {}): Promise<OnlineResponse> => {
  const label = options.label || "在线棋谱";
  const url = assertPublicHttpUrl(rawUrl, label);
  const cached = options.noCache ? undefined : responseCache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.response;

  const host = new URL(url).host;
  const failures: string[] = [];
  for (const transport of onlineTransportPlan()) {
    const target = transport === "proxy" ? proxyTarget(url, loadOnlineProxyTemplate()) : url;
    try {
      await waitForHostSlot(host);
      const response = transport === "native"
        ? await requestNative(url, options, label, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        : await requestFetch(target, options, label, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      // Validate redirect destinations before accepting or caching content.
      if (response.finalUrl && response.finalUrl !== url) {
        assertPublicHttpUrl(response.finalUrl, label);
      }
      if (response.status >= 400) {
        failures.push(`${transport}：HTTP ${response.status}`);
        // A real HTTP answer means the channel works; another channel would get
        // the same status, so report it instead of silently trying harder.
        if (response.status === 404 || response.status === 410 || response.status === 403) {
          throw new Error(`${label}返回 HTTP ${response.status}，该来源可能已下架或限制了访问`);
        }
        continue;
      }
      if (responseCache.size >= CACHE_MAX_ENTRIES) responseCache.delete(responseCache.keys().next().value as string);
      responseCache.set(url, { at: Date.now(), response });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP (404|410|403)/.test(message)) throw error;
      failures.push(`${transport}：${message}`);
    }
  }
  const hint = onlineTransportPlan().includes("native") || loadOnlineProxyTemplate()
    ? ""
    : "；网页版若该站点不开放跨域，可在「设置 · 数据与兼容 → 在线棋谱库代理」里填写代理地址";
  throw new Error(`${label}取回失败（${failures.join("；") || "无可用通道"}）${hint}`);
};

export const fetchOnlineBytes = async (url: string, options: OnlineRequestOptions = {}) => (await fetchOnlineResponse(url, options)).bytes;

export const fetchOnlineText = async (url: string, options: OnlineRequestOptions = {}) => decodeText((await fetchOnlineResponse(url, options)).bytes);

/** Test seam: forget throttling and cached bodies between cases. */
export const resetOnlineTransportState = () => {
  responseCache.clear();
  hostLastRequest.clear();
  hostRequestChains.clear();
};
