/**
 * Optional full-strength Rapfi engine pack (official mix9svq champion networks,
 * complete rule coverage). The app ships the lightweight engine only; this pack
 * is downloaded in-app and activates immediately for every later AI request —
 * no restart, no manual configuration.
 */

export const ENGINE_PACK_VERSION = 3;
export const ENGINE_PACK_FILENAME = `rapfi-full-v${ENGINE_PACK_VERSION}.data`;
// Exact byte length of the official package; downloads are rejected on mismatch
// so a truncated transfer can never be flagged as installed. v3 restores the
// official layout (.bin.lz4 weights mounted as-is and decompressed by the
// engine itself) — the v1/v2 "repacked to raw .bin" builds silently disabled
// the mix9svq evaluator (proved against the official desktop binary).
export const ENGINE_PACK_SIZE = 40306406;
// Primary remote source: the app's own GitHub Pages origin (same origin for the
// PWA; GitHub Pages sends Access-Control-Allow-Origin: * so the APK WebView can
// fetch it). Fallback: the public repo's release asset.
// 下载源优先级（2026-09-13 实测，40MB 包 / 国内网络）：
//   1. GitHub Pages      347 KB/s，支持 Range，带 Access-Control-Allow-Origin: *
//   2. GitHub Releases   国内直连常 302 后卡死，仅作兜底（同源无 CORS 问题）
// ⚠ 已实测排除的加速方案（浏览器内不可用）：
//   · jsDelivr：@gh-pages 路径正确但返回 403——其硬限制是 20MB，本包 40MB 超限
//   · gh-proxy.com / ghfast.top：速度确实快 3×（1.19MB/s / 563KB/s）且支持 Range，
//     但**不返回 CORS 头**，App 内跨域 fetch 必被拦截（实测 Failed to fetch），
//     仅当由自建服务端中转时才可用。
const ENGINE_PACK_REMOTE_URLS = [
  `https://gugujiao953-ship-it.github.io/banbu-gomoku/engine-packs/${ENGINE_PACK_FILENAME}`,
  `https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/download/engine-pack-v${ENGINE_PACK_VERSION}/${ENGINE_PACK_FILENAME}`,
];
// Dev servers serve the pack from gitignored engine-packs/ so the whole
// download-activate flow is testable locally.
// 生产环境（用户 09-13 起）：引擎包已随 APK 分发——Capacitor 会把 dist/ 整份拷进
// APK 的 assets，因此**同源 /engine-packs/ 路径在 App 内始终可用**，直接本地读取，
// 既不用下载也不受国内网络影响。Web 部署（GitHub Pages）不含该目录（404），
// 此时 fetch 落到候选列表的下一个（远端 Pages/Releases），保持原有兜底行为。
const enginePackUrls = (): string[] => {
  try {
    return [new URL(`engine-packs/${ENGINE_PACK_FILENAME}`, globalThis.location.href).toString(), ...ENGINE_PACK_REMOTE_URLS];
  } catch {
    return ENGINE_PACK_REMOTE_URLS;
  }
};

const STATE_KEY = "banbu-engine-pack-state-v1";
const DATABASE_NAME = "banbu-engine-pack-v1";
const STORE_NAME = "packs";
const PACK_KEY = ENGINE_PACK_FILENAME;

export interface EnginePackState {
  version: number;
  size: number;
  downloadedAt: number;
}

export type EnginePackPhase = "idle" | "checking" | "downloading" | "done" | "error";

export interface EnginePackSnapshot {
  state: EnginePackState | null;
  objectUrl: string | null;
}

type Listener = (snapshot: EnginePackSnapshot) => void;
const listeners = new Set<Listener>();
let cachedSnapshot: EnginePackSnapshot = { state: readStoredState(), objectUrl: null };
let warming: Promise<string | null> | null = null;

function readStoredState(): EnginePackState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EnginePackState;
    if (parsed?.version === ENGINE_PACK_VERSION && typeof parsed.size === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeStoredState(state: EnginePackState | null) {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY);
  } catch { /* state flag is advisory; the pack itself lives in IndexedDB */ }
}

// 用户主动删除引擎包的标记（2026-09-13）：包内自带引擎后，App 每次启动都会
// 自动安装——但用户删包表达的是「我不想用它」，不能被下次启动强行装回。
// 该标记在用户主动下载/导入时清除。
const OPT_OUT_KEY = "banbu-engine-pack-opt-out-v1";

/** 用户是否主动删除了引擎包（自带包不自动重装）。 */
export const isEnginePackOptedOut = (): boolean => {
  try { return localStorage.getItem(OPT_OUT_KEY) === "1"; } catch { return false; }
};

const setEnginePackOptOut = (value: boolean) => {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch { /* advisory only */ }
};

/** 包内自带引擎的候选路径（App 内同源资源；Web 部署返回 null 走远端下载）。 */
export const bundledEnginePackUrl = (): string | null => {
  try {
    return new URL(`engine-packs/${ENGINE_PACK_FILENAME}`, globalThis.location.href).toString();
  } catch {
    return null;
  }
};

function notify() {
  for (const listener of listeners) listener(cachedSnapshot);
}

// 延迟撤销 objectURL：worker 加载 blob 是异步的（40MB 解码要数百毫秒到数十秒），
// 立刻 revoke 会让在途请求报 "Network Error"（实测偶发，见 rapfi-single.js）。
// 宽限必须**长于任何可能的在途加载**：帧内 worker 自己的冷加载超时是 30s，而
// 一次分析轮可能在上一次换代之后才开始加载，所以 30s 太贴边（加载起点 + 30s
// 就可能越过撤销点），取 120s。
const REVOKE_DELAY_MS = 120000;

/** 换代：在同一同步块里「读旧 URL → 写回新快照」，然后把旧 URL 交给延迟撤销。
 *  若各调用点分开写（先登记旧 URL 的撤销、await 建新 URL、再赋值），并发安装
 *  （启动装自带包与用户随后下载）会在 await 窗口里读到同一个旧 URL 而互相覆盖，
 *  先建的 URL 永远不被回收。这里把交班收敛成一次同步替换。 */
const swapPackUrl = (state: EnginePackState | null, nextUrl: string | null) => {
  const previous = cachedSnapshot.objectUrl;
  cachedSnapshot = { state, objectUrl: nextUrl };
  writeStoredState(state);
  if (previous && previous !== nextUrl) {
    try { setTimeout(() => URL.revokeObjectURL(previous), REVOKE_DELAY_MS); } catch { /* 忽略 */ }
  }
  notify();
};

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

const loadPackBlob = async (): Promise<Blob | null> => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(PACK_KEY);
      request.onsuccess = () => { database.close(); resolve((request.result as Blob | undefined) || null); };
      request.onerror = () => { database.close(); resolve(null); };
    } catch {
      database.close();
      resolve(null);
    }
  });
};

const storePackBlob = async (blob: Blob) => {
  const database = await openDatabase();
  if (!database) throw new Error("本机存储不可用，无法保存引擎包");
  await new Promise<void>((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(blob, PACK_KEY);
      // Pack upgrades change the storage key (rapfi-full-vN): drop the old
      // generations so a forced re-download never leaves tens of MB stranded.
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result || []) if (key !== PACK_KEY) store.delete(key);
      };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(new Error("引擎包保存失败，请检查剩余存储空间")); };
      transaction.onabort = () => { database.close(); reject(new Error("引擎包保存失败，请检查剩余存储空间")); };
    } catch (error) {
      database.close();
      reject(error instanceof Error ? error : new Error("引擎包保存失败"));
    }
  });
};

const deletePackBlob = async () => {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(PACK_KEY);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); resolve(); };
    } catch {
      database.close();
      resolve();
    }
  });
};

// Downloads must target a public http(s) host: block localhost, loopback,
// private and reserved ranges before any request leaves the app.
export const assertPublicHttpUrl = (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("引擎包地址无效");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("引擎包地址必须是 http/https");
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    throw new Error("引擎包地址不允许指向本机");
  }
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((value) => value > 255)) throw new Error("引擎包地址无效");
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) {
      throw new Error("引擎包地址不允许指向内网或保留地址");
    }
  }
  return parsed.toString();
};

export const enginePackSnapshot = (): EnginePackSnapshot => cachedSnapshot;

// ---- 内部实验转正（T49，2026-09-12）：config 内联调优 --------------------
// 官方 v3 包的 config.toml 段（loader manifest 固定 offset，常量由
// scripts/verify-rapfi-pack.mjs 对照实际 manifest 校验）有两处实测负优化：
// ① aspiration 窗口 true——在这套 NNUE 评估尺度下重搜失败的成本大于收益，
//   关闭后同预算搜索深度 +1~3 层（qipan4 14→17、huayue3 13→16、
//   zhongpan9 24→25，多轮一致）；
// ② advanced_stop_ratio 0.75→0.90——消除小预算下的迭代波动（huayue3
//   14/15/16 → 16/16/16），深度持平或略优。
// 等长字节手术：value 缩短用去空格对冲（两个 needle 均为 24 字节等长），
// loader manifest 的 offset 不移位，权重字节原样。存储的 IndexedDB blob 保持
// 官方字节（verify-rapfi-pack 的身份锚点不变），手术只在会话内存 blob 上做，
// 单针失配跳过（官方 config 变化时降级而非报错），全部失败 fail-open 回原包。
export const ENGINE_CONFIG_SEGMENT_START = 11470;
export const ENGINE_CONFIG_SEGMENT_END = 18183;
export const CONFIG_TUNE_NEEDLES: Array<[string, string]> = [
  ["aspiration_window = true", "aspiration_window= false"],
  ["advanced_stop_ratio = 0.75", "advanced_stop_ratio = 0.90"],
  // 官方 config 的线程针（单线程构建忽略该字段，无害；保留与官方字节分档一致，
  // 多线程构建已随 09-12 移除）。字段在 config 启动时读取，非运行时命令。
  ["default_thread_num = 1", "default_thread_num = 4"],
];

export const tunePackBytes = (bytes: Uint8Array, segmentStart: number, segmentEnd: number): Uint8Array | null => {
  if (segmentStart < 0 || segmentEnd > bytes.length || segmentEnd - segmentStart < 24) return null;
  let tuned: Uint8Array | null = null;
  let applied = 0;
  for (const [findText, replaceText] of CONFIG_TUNE_NEEDLES) {
    const find = new TextEncoder().encode(findText);
    const replace = new TextEncoder().encode(replaceText);
    if (find.length !== replace.length) return null;
    const scope = (tuned ?? bytes).subarray(segmentStart, segmentEnd);
    let idx = -1;
    outer: for (let i = 0; i <= scope.length - find.length; i++) {
      for (let j = 0; j < find.length; j++) if (scope[i + j] !== find[j]) continue outer;
      idx = segmentStart + i;
      break;
    }
    if (idx < 0) continue; // 官方 config 该行已变：跳过此针，其余照做
    if (!tuned) tuned = bytes.slice();
    tuned.set(replace, idx);
    applied += 1;
  }
  return applied > 0 ? tuned : null;
};

const blobFromBytes = (bytes: Uint8Array): Blob =>
  new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/octet-stream" });

const tunePackBlob = async (blob: Blob): Promise<Blob> => {
  try {
    if (blob.size !== ENGINE_PACK_SIZE) return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const tuned = tunePackBytes(bytes, ENGINE_CONFIG_SEGMENT_START, ENGINE_CONFIG_SEGMENT_END);
    return tuned ? blobFromBytes(tuned) : blob;
  } catch {
    return blob;
  }
};

export const subscribeEnginePack = (listener: Listener) => {
  listeners.add(listener);
  listener(cachedSnapshot);
  return () => listeners.delete(listener);
};

/** Resolves to a same-origin object URL for the downloaded pack, or null. */
export const ensureEnginePackUrl = async (): Promise<string | null> => {
  if (cachedSnapshot.objectUrl) return cachedSnapshot.objectUrl;
  if (!cachedSnapshot.state) return null;
  if (!warming) {
    warming = (async () => {
      const blob = await loadPackBlob();
      if (!blob || blob.size !== ENGINE_PACK_SIZE) {
        // Flagged state without a usable pack: clear the stale flag.
        if (blob || cachedSnapshot.state) {
          cachedSnapshot = { state: null, objectUrl: cachedSnapshot.objectUrl };
          writeStoredState(null);
          notify();
        }
        return null;
      }
      const objectUrl = URL.createObjectURL(await tunePackBlob(blob));
      cachedSnapshot = { state: cachedSnapshot.state, objectUrl };
      notify();
      return objectUrl;
    })();
    warming = warming.finally(() => { warming = null; });
  }
  return warming;
};

const ENGINE_PACK_SIZE_LABEL = () => `${(ENGINE_PACK_SIZE / 1024 / 1024).toFixed(1)}MB`;

// 分片并发下载（2026-09-13，实测调优）：Pages 支持 Range 且带 CORS；单 TCP 连接
// 分片策略（2026-09-13 实测定案，针对国内无代理网络）：
// GitHub Pages 在无代理时会把**大 Range 连接中途掐断**——实测 8 段各 5MB 只有
// 1 段成功、其余拿到部分数据即 stall（用户现象：进度蹦到 13% 后不动）。改小分片
// 后同样环境 8 段各 1MB 有 7 段成功。故：
//   · 分片固定 512KB（小块成功率最高；40MB ≈ 80 块，由并发池持续供给）
//   · 块级「断点续传」：连接被掐时记录已收字节，下一轮从断点继续，不重头来
//   · 并发池 CONCURRENCY 个块同时进行，某块完成立即补下一块（进度持续前进）
// 任一块返回非 206（老服务器不支持 Range）→ 整体退化为单连接流式下载。
const CHUNK_BYTES = 512 * 1024;
// 并发数（2026-09-13 实测调优）：单连接被源站限速在约 50-130 KB/s（用户手机
// 实测 50 KB/s 与此吻合），但**并发数几乎线性叠加带宽**——同一 40MB 包实测：
//   8 路 19.9s（2.0 MB/s）· 16 路 10.0s（3.9 MB/s）· 24 路 8.2s（4.8 MB/s）。
// 24 是当前最优；再高收益递减且更吃设备资源。失败时退化为单连接流式（最慢路径，
// 约 50 KB/s），并发池是本下载器的核心提速手段。
// 注：GitHub Pages 走 HTTP/2，多路复用不受 HTTP/1.1 每源 6 连接上限约束。
const CONCURRENCY = 24;

/** 按设备内存收敛并发（低内存手机用 8，常规手机 16，桌面满额 24）。 */
const concurrencyForDevice = (): number => {
  const memory = (globalThis.navigator as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory;
  if (typeof memory !== "number") return CONCURRENCY;
  if (memory <= 2) return 8;
  if (memory <= 4) return 16;
  return CONCURRENCY;
};
// 单块最大续传轮次（每轮都是从断点起的独立 Range 请求）。
const CHUNK_MAX_ATTEMPTS = 8;
// 手机网络下 IPv6 常不通（DNS 返回 AAAA 但连接超时），浏览器自动回落后才连上，
// 这个"隐性等待"会让每块起步慢。缩短单次尝试的容忍时间、更快进入下一轮续传，
// 可显著减少空等——单块内部不再设固定超时（由 fetch 与外层 abort 控制），
// 这里只控制两次尝试之间的间隔（原 300ms 起退避，改为更紧凑）。
const CHUNK_RETRY_DELAY_MS = 150;

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

const fetchChunk = async (url: string, start: number, end: number, signal?: AbortSignal): Promise<{ status: number; bytes: Uint8Array }> => {
  const response = await fetch(url, { signal, headers: { Range: `bytes=${start}-${end}` } });
  const status = response.status;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status, bytes };
};

// 单块抓取（断点续传）：从 offset 起取到块尾，边收边上报；连接被掐/超时则
// 记录已收字节，下一轮从新 offset 继续同一条 Range 请求——这是应对「大连接被
// 中途掐断」的关键：不重头来，已下载的部分永不浪费。
// fatal=true 表示「这块不用再试了」：服务器明确只回了这么长（声明的
// content-length 与实收相同、却短于请求区间）＝它把区间截短了，不是连接被掐。
// 此时再按断点续传续请求会拿到错位的字节（后续请求可能又返回前段数据），拼出来
// 的包等于被替换过的坏包——宁可整包退回流式下载失败，也不能把坏包入库。
const fetchChunkResumable = async (url: string, start: number, end: number, signal?: AbortSignal): Promise<{ status: number; bytes: Uint8Array | null; received: number; fatal?: boolean }> => {
  const response = await fetch(url, { signal, headers: { Range: `bytes=${start}-${end}` } });
  const status = response.status;
  if (status !== 200 && status !== 206) return { status, bytes: null, received: 0 };
  const expected = end - start + 1;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status, bytes, received: bytes.byteLength };
  }
  const parts: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        parts.push(value);
        received += value.byteLength;
      }
    }
  } catch (error) {
    // 传输中被打断：把已收到的部分交回上层（本轮算「部分成功」），下轮从断点续。
    if (received === 0) throw error;
  }
  if (received === 0) return { status, bytes: new Uint8Array(0), received: 0 };
  if (received === expected) {
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) { merged.set(part, offset); offset += part.byteLength; }
    return { status, bytes: merged, received };
  }
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > 0 && received >= declared) return { status, bytes: null, received, fatal: true };
  return { status, bytes: null, received };
};

// 把一块（chunkStart..chunkEnd）完整拉下来：循环「续传 → 断点推进」，直到取满
// 或耗尽重试。返回完整块字节；任一轮拿到 200（服务器忽略 Range 回整文件）时，
// 交由上层判定是否直接采用整文件结果。
const fetchWholeChunk = async (url: string, chunkStart: number, chunkEnd: number, signal: AbortSignal | undefined): Promise<{ full?: Uint8Array; wholeFile?: Uint8Array } | null> => {
  const buffer = new Uint8Array(chunkEnd - chunkStart + 1);
  let cursor = chunkStart;
  for (let attempt = 0; attempt < CHUNK_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error("已取消下载");
    let result: { status: number; bytes: Uint8Array | null; received: number; fatal?: boolean };
    try {
      result = await fetchChunkResumable(url, cursor, chunkEnd, signal);
    } catch (error) {
      if (attempt === CHUNK_MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, CHUNK_RETRY_DELAY_MS * (attempt + 1)));
      continue;
    }
    if (result.status === 200 && result.bytes) return { wholeFile: result.bytes }; // 服务器不支持 Range
    if (result.bytes) {
      buffer.set(result.bytes, cursor - chunkStart);
      return { full: buffer };
    }
    // 服务器把区间截短：这一块不可能靠续传补齐（见 fetchChunkResumable 注释）。
    if (result.fatal) return null;
    if (result.received > 0) {
      // 部分收到：把这一段先落到缓冲区，再从未完成处继续（进度由上层按块计数）。
      cursor += result.received;
      if (cursor > chunkEnd) return { full: buffer.slice(0, cursor - chunkStart) };
      continue;
    }
    if (attempt === CHUNK_MAX_ATTEMPTS - 1) return null;
    await new Promise((resolve) => setTimeout(resolve, CHUNK_RETRY_DELAY_MS * (attempt + 1)));
  }
  return null;
};

const streamDownload = async (url: string, totalBytes: number, onProgress?: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<Uint8Array> => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`下载源返回 ${response.status}`);
  const reader = response.body?.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        received += value.byteLength;
        onProgress?.({ receivedBytes: received, totalBytes });
      }
    }
    return new Uint8Array(await new Blob(parts.map((part) => blobFromBytes(part))).arrayBuffer());
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  received = buffer.byteLength;
  onProgress?.({ receivedBytes: received, totalBytes });
  return buffer;
};

export const downloadEnginePack = async (onProgress?: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<EnginePackState> => {
  let lastError: Error | null = null;
  for (const candidate of enginePackUrls()) {
    // Dev's same-origin candidate is the app's own origin by construction;
    // remote candidates must pass the public-host validation.
    const url = candidate.startsWith(globalThis.location?.origin ?? "\u0000") ? candidate : assertPublicHttpUrl(candidate);
    try {
      let bytes: Uint8Array;
      // 小块 + 断点续传 + 并发池：512KB 一块（小块在国内网络成功率远高于大段），
      // 固定 CONCURRENCY 个块同时在拉，某块完成立即补下一块。每块内部自带断点
      // 续传（连接被掐时从已收字节继续），进度随每块完成持续前进。
      try {
        const totalEnd = ENGINE_PACK_SIZE - 1;
        const ranges: Array<[number, number]> = [];
        for (let start = 0; start < ENGINE_PACK_SIZE; start += CHUNK_BYTES) {
          ranges.push([start, Math.min(start + CHUNK_BYTES - 1, totalEnd)]);
        }
        const slots: Array<Uint8Array | null> = ranges.map(() => null);
        let received = 0;
        // 用对象容器承接闭包内赋值（TS 对闭包写回的 let 会做 never 收窄）。
        const wholeFileBox: { value: Uint8Array | null } = { value: null };
        let completed = 0;
        onProgress?.({ receivedBytes: 0, totalBytes: ENGINE_PACK_SIZE });
        let nextIndex = 0;
        const worker = async () => {
          for (;;) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= ranges.length || wholeFileBox.value) return;
            const [s, e] = ranges[index];
            // 进度以「已完成块数」为唯一口径：字节级回调在并发 + 断点续传下会重复
            // 累计（同一段字节可能被算两次，实测进度 1.6s 就假报 100%），块计数则
            // 天然幂等。77 块（512KB）逐块推进，进度条全程可见。
            const result = await fetchWholeChunk(url, s, e, signal);
            if (!result) throw new Error("引擎包分块下载失败");
            if (result.wholeFile) { wholeFileBox.value = result.wholeFile; return; }
            slots[index] = result.full ?? null;
            completed += 1;
            received = Math.min(completed * CHUNK_BYTES, ENGINE_PACK_SIZE);
            onProgress?.({ receivedBytes: received, totalBytes: ENGINE_PACK_SIZE });
          }
        };
        // 低内存手机下调并发：24 路并发在 2GB 及以下设备容易被系统掐连接或引发
        // 内存抖动（每块要持有一份 512KB 缓冲）。deviceMemory 是 Chromium 的粗略
        // 分档值，取不到时按桌面处理（保持满并发）。
        await Promise.all(Array.from({ length: Math.min(concurrencyForDevice(), ranges.length) }, () => worker()));
        const wholeFileBytes = wholeFileBox.value;
        if (received >= ENGINE_PACK_SIZE) onProgress?.({ receivedBytes: ENGINE_PACK_SIZE, totalBytes: ENGINE_PACK_SIZE });
        if (wholeFileBytes && wholeFileBytes.length === ENGINE_PACK_SIZE) {
          bytes = wholeFileBytes;
        } else if (completed === ranges.length && slots.every((part) => part)) {
          // 每块必须严格等于自己请求的区间长度：预分配缓冲会把「短一截的块」零
          // 填充补齐——40.3MB 包少 1 字节时下载照样"成功"，入库的是被补零的坏包
          // （与 v1/v2 repack 同类教训：宁可下载失败，也不能存坏包）。长度不符即
          // 判分片失败，退回整文件流式，由下游大小校验兜住。
          const exact = ranges.every(([s, e], index) => slots[index]?.length === e - s + 1);
          if (exact) {
            bytes = new Uint8Array(ENGINE_PACK_SIZE);
            let offset = 0;
            for (const part of slots) { bytes.set(part as Uint8Array, offset); offset += (part as Uint8Array).length; }
          } else {
            bytes = await streamDownload(url, ENGINE_PACK_SIZE, onProgress, signal);
          }
        } else {
          bytes = await streamDownload(url, ENGINE_PACK_SIZE, onProgress, signal);
        }
      } catch (chunkError) {
        // 并发失败（断流/超时）——整体流式重试一次，仍失败抛给换源循环
        bytes = await streamDownload(url, ENGINE_PACK_SIZE, onProgress, signal);
        lastError = chunkError instanceof Error ? chunkError : new Error(String(chunkError));
      }
      if (bytes.length !== ENGINE_PACK_SIZE) throw new Error(`引擎包大小不符（收到 ${bytes.length} 字节，应为 ${ENGINE_PACK_SIZE_LABEL()}）`);
      const blob = new Blob([blobFromBytes(bytes)], { type: "application/octet-stream" });
      await storePackBlob(blob);
      const state: EnginePackState = { version: ENGINE_PACK_VERSION, size: ENGINE_PACK_SIZE, downloadedAt: Date.now() };
      setEnginePackOptOut(false); // 用户主动下载：重新视为「想要引擎」
      swapPackUrl(state, URL.createObjectURL(await tunePackBlob(blob)));
      return state;
    } catch (error) {
      if (signal?.aborted) throw new Error("已取消下载");
      // A failed fetch surfaces as a bare TypeError ("failed to fetch"), which
      // reads like an app bug; translate it into something actionable.
      lastError = error instanceof TypeError
        ? new Error("网络不可用或下载源暂时无法访问，请检查网络后重试")
        : error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError || new Error("引擎包下载失败");
};

const ENGINE_PACK_PACK_SIZE_LABEL = () => `${(ENGINE_PACK_SIZE / 1024 / 1024).toFixed(1)}MB`;

export const deleteEnginePack = async () => {
  // 记下「用户主动不要引擎包」——自带包在下次启动时不再自动装回。
  setEnginePackOptOut(true);
  swapPackUrl(null, null);
  await deletePackBlob();
};

/** 启动时自动安装包内自带的引擎（用户 09-13：引擎随 APK 分发，装完即用）。
 *  仅在「尚未安装 + 用户没主动删过」时执行；读取走同源资源，App 内是本地文件
 *  读取（无网络），Web 部署下该路径 404 会被静默跳过并回落远端下载流程。 */
export const installBundledEnginePack = async (): Promise<boolean> => {
  if (cachedSnapshot.state) return false;
  if (isEnginePackOptedOut()) return false;
  const url = bundledEnginePackUrl();
  if (!url) return false;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== ENGINE_PACK_SIZE) return false;
    const blob = new Blob([blobFromBytes(bytes)], { type: "application/octet-stream" });
    await storePackBlob(blob);
    const state: EnginePackState = { version: ENGINE_PACK_VERSION, size: ENGINE_PACK_SIZE, downloadedAt: Date.now() };
    swapPackUrl(state, URL.createObjectURL(await tunePackBlob(blob)));
    return true;
  } catch {
    return false; // 无自带包（Web 部署）或读取失败：保持原状，用户可手动下载
  }
};

// ---- 本地导入引擎包（网盘中转方案，2026-09-13）-------------------------
// GitHub 下载在国内慢/不稳：用户在蓝奏云等网盘自行中转官方 v3 包（或从任意
// 渠道拿到 40.3M 官方字节），App 从本地文件导入——大小 + SHA-256 双重校验
// 通过才入库，杜绝损坏/篡改包（v1/v2 repack 教训）。
export const OFFICIAL_PACK_SHA256 = "2fa58b1c9e005a7b39bbddb798097a8f1ff9ceaba4c9339d87ba7d324b9d846d";
const sha256HexOf = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
};

export const importEnginePackFile = async (file: Blob): Promise<EnginePackState> => {
  if (file.size !== ENGINE_PACK_SIZE) throw new Error(`文件大小不符（收到 ${file.size} 字节，应为 ${ENGINE_PACK_SIZE_LABEL()}）`);
  let hashOk = false;
  try {
    hashOk = (await sha256HexOf(await file.arrayBuffer())) === OFFICIAL_PACK_SHA256;
  } catch {
    hashOk = false;
  }
  if (!hashOk) throw new Error("校验失败：文件不是官方引擎包（SHA-256 不匹配），请从官方渠道重新下载");
  await storePackBlob(file);
  const state: EnginePackState = { version: ENGINE_PACK_VERSION, size: ENGINE_PACK_SIZE, downloadedAt: Date.now() };
  setEnginePackOptOut(false); // 用户主动导入：重新视为「想要引擎」
  swapPackUrl(state, URL.createObjectURL(file));
  return state;
};

// 多线程引擎资产管线已移除（2026-09-12）：App 内 blob MIME + WebView 无
// COI/SAB 双重阻塞，multi 从未在真机生效；旧版存储的 multi blobs 不再读取。
// 若需跨域隔离环境（桌面 dev server）验证线程构建，直接以 /engine-packs/ 下
// 原始文件加载即可。
