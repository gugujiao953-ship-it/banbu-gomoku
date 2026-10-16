/**
 * 应用内下载新版 APK 并交给系统安装。
 *
 * 这条链路存在的意义：手机网络（尤其国内）到 GitHub 的网页下载既慢又容易断，
 * 而应用已经有像素级验证过的分片下载 + 断点续传骨架（见 features/ai/engine-pack.ts）。
 * 这里复用同一套思路，但对象是安装包而非引擎包，因此多了两道「绝不能把坏包装上」
 * 的关卡：字节长度 + SHA-256（version.json 提供时）。
 *
 * 安全边界：所有出网地址先过 src/url-safety.ts 的 assertPublicHttpUrl——只允许
 * http/https，且拒绝 localhost、环回、私有与保留地址。候选源来自版本元数据，
 * 不能因为元数据被投毒就让 APK 从内网地址下载。
 */

import { assertPublicHttpUrl } from "../../url-safety";

export interface ApkDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface ApkArtifact {
  bytes: Uint8Array;
  filename: string;
  /** 校验得到的 SHA-256（大写十六进制）。 */
  sha256: string;
}

export interface ApkDownloadOptions {
  /** 候选下载地址，按优先级排列（应用内直连 → Pages 镜像）。 */
  urls: string[];
  /** 期望的文件名，用于落盘与安装器识别。 */
  filename: string;
  /** 期望的字节长度；不匹配一律判失败。 */
  expectedSize?: number;
  /** 期望的 SHA-256（十六进制，大小写不敏感）；提供时校验不通过即判失败。 */
  expectedSha256?: string;
  onProgress?: (progress: ApkDownloadProgress) => void;
  signal?: AbortSignal;
  /** 仅测试用：注入 fetch 实现。生产一律用全局 fetch。 */
  fetchImpl?: typeof fetch;
}

const CHUNK_BYTES = 512 * 1024;
const MAX_CHUNK_ATTEMPTS = 8;

const assertNotCancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error("已取消下载");
};

export const APK_MIME_TYPE = "application/vnd.android.package-archive";

/** 把字节转成十六进制 SHA-256（大写），用于与 version.json 里公布的值比对。 */
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // TextEncoder 保证得到的是纯 ASCII 视图；createHash 在浏览器/worker/Node 均可用。
  const view = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", view as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
};

interface CandidateProbe {
  totalBytes: number;
  rangeSupported: boolean;
}

/**
 * 下载前先探测候选源：拿到真实长度（用来拒绝「SPA 回退页」这类假 200），
 * 并判断是否支持分片。失败返回 null，调用方直接换下一个源，不做无意义重试。
 */
const probeCandidate = async (doFetch: typeof fetch, url: string, expectedSize: number | undefined, signal?: AbortSignal): Promise<CandidateProbe | null> => {
  const lengthOf = (headers: Headers) => {
    const declared = Number(headers.get("content-length"));
    return Number.isFinite(declared) && declared > 0 ? declared : 0;
  };
  const sizeMatches = (size: number) => !expectedSize || size === 0 || size === expectedSize;
  try {
    const response = await doFetch(url, { method: "HEAD", signal, cache: "no-store" });
    if (response.ok) {
      const total = lengthOf(response.headers);
      if (!sizeMatches(total)) return null;
      const acceptRanges = (response.headers.get("accept-ranges") ?? "").toLowerCase();
      if (acceptRanges.includes("bytes")) {
        if (!total) return probeWithRange(doFetch, url, expectedSize, signal);
        return { totalBytes: total, rangeSupported: true };
      }
    } else if (response.status !== 405 && response.status !== 501 && response.status !== 403) {
      return null;
    }
  } catch (error) {
    if (signal?.aborted) throw new Error("已取消下载");
    // HEAD 被网络层挡掉（部分代理会掐 HEAD）：继续用 Range GET 复核。
  }
  return probeWithRange(doFetch, url, expectedSize, signal);
};

const probeWithRange = async (doFetch: typeof fetch, url: string, expectedSize: number | undefined, signal?: AbortSignal): Promise<CandidateProbe | null> => {
  try {
    const response = await doFetch(url, { headers: { Range: "bytes=0-0" }, signal, cache: "no-store" });
    if (!response.ok) return null;
    let total = 0;
    if (response.status === 206) {
      total = Number((response.headers.get("content-range") ?? "").split("/")[1]) || 0;
    } else {
      total = Number(response.headers.get("content-length")) || 0;
    }
    try { await response.body?.cancel(); } catch { /* 预检必须取消响应体，否则等于先下了一遍 */ }
    if (expectedSize && total && total !== expectedSize) return null;
    return { totalBytes: total || expectedSize || 0, rangeSupported: response.status === 206 };
  } catch (error) {
    if (signal?.aborted) throw new Error("已取消下载");
    return null;
  }
};

/** 单块抓取：从 offset 起取到块尾，连接被掐时把已收字节交回上层续传。 */
const fetchChunk = async (doFetch: typeof fetch, url: string, start: number, end: number, signal?: AbortSignal): Promise<{ status: number; bytes: Uint8Array | null; received: number }> => {
  assertNotCancelled(signal);
  const response = await doFetch(url, { signal, headers: { Range: `bytes=${start}-${end}` } });
  const status = response.status;
  if (status !== 206) {
    try { await response.body?.cancel(); } catch { /* best effort */ }
    return { status, bytes: null, received: 0 };
  }
  const contentRange = response.headers.get("content-range");
  if (contentRange) {
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange);
    if (!range || Number(range[1]) !== start || Number(range[2]) !== end || (range[3] !== "*" && Number(range[3]) <= end)) {
      try { await response.body?.cancel(); } catch { /* best effort */ }
      throw new Error("安装包分块范围不符");
    }
  }
  const expected = end - start + 1;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > expected) throw new Error("安装包分块长度超出范围");
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
        if (received > expected) {
          try { await reader.cancel(); } catch { /* best effort */ }
          throw new Error("安装包分块长度超出范围");
        }
      }
    }
  } catch (error) {
    if (received === 0 || received > expected || signal?.aborted) throw error;
  } finally {
    reader.releaseLock();
  }
  if (received === 0) return { status, bytes: new Uint8Array(0), received: 0 };
  // Keep partial bytes as well: the next request resumes after these bytes,
  // and the caller assembles them before accepting a complete chunk.
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) { merged.set(part, offset); offset += part.byteLength; }
  return { status, bytes: merged, received };
};

const streamDownload = async (doFetch: typeof fetch, url: string, totalBytes: number, onProgress: ((progress: ApkDownloadProgress) => void) | undefined, signal?: AbortSignal): Promise<Uint8Array> => {
  const response = await doFetch(url, { signal });
  if (!response.ok) throw new Error(`下载源返回 ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ receivedBytes: buffer.byteLength, totalBytes: totalBytes || buffer.byteLength });
    return buffer;
  }
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength) {
      parts.push(value);
      received += value.byteLength;
      onProgress?.({ receivedBytes: received, totalBytes: totalBytes || received });
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) { merged.set(part, offset); offset += part.byteLength; }
  return merged;
};

const chunkedDownload = async (doFetch: typeof fetch, url: string, totalBytes: number, onProgress: ((progress: ApkDownloadProgress) => void) | undefined, signal?: AbortSignal): Promise<Uint8Array> => {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < totalBytes; start += CHUNK_BYTES) {
    ranges.push([start, Math.min(start + CHUNK_BYTES - 1, totalBytes - 1)]);
  }
  const slots: Array<Uint8Array | null> = ranges.map(() => null);
  // 进度按「已完成块数」计：并发 + 断点续传下按字节累计会把同一段算两次。
  let completed = 0;
  onProgress?.({ receivedBytes: 0, totalBytes });
  for (let index = 0; index < ranges.length; index += 1) {
    const [start, end] = ranges[index];
    const chunk = new Uint8Array(end - start + 1);
    let cursor = start;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const result = await fetchChunk(doFetch, url, cursor, end, signal);
      if (result.bytes) chunk.set(result.bytes, cursor - start);
      cursor += result.received;
      if (result.bytes && cursor === end + 1) { slots[index] = chunk; break; }
      if (attempt >= MAX_CHUNK_ATTEMPTS || result.status === 200) throw new Error("安装包分块下载失败");
    }
    completed += 1;
    onProgress?.({ receivedBytes: Math.min(completed * CHUNK_BYTES, totalBytes), totalBytes });
  }
  return concatChunks(slots, totalBytes);
};

const concatChunks = (slots: Array<Uint8Array | null>, totalBytes: number): Uint8Array => {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of slots) {
    if (!part) throw new Error("安装包分块缺失");
    merged.set(part, offset);
    offset += part.byteLength;
  }
  if (offset !== totalBytes) throw new Error("安装包长度不符");
  return merged;
};

/**
 * 逐个候选源尝试下载。返回通过校验的完整字节；全部失败则抛出最后一个错误。
 */
export const downloadApk = async (options: ApkDownloadOptions): Promise<ApkArtifact> => {
  const { urls, filename, expectedSize, expectedSha256, onProgress, signal } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const failures: string[] = [];
  assertNotCancelled(signal);
  for (const rawUrl of urls) {
    assertNotCancelled(signal);
    // 出网守卫：非法/内网地址在发请求之前就拒绝。
    let url: string;
    try {
      url = assertPublicHttpUrl(rawUrl, "安装包下载地址");
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    let probe: CandidateProbe | null = null;
    try {
      probe = await probeCandidate(doFetch, url, expectedSize, signal);
    } catch (error) {
      if (signal?.aborted) throw new Error("已取消下载");
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!probe) { failures.push("下载源不可用"); continue; }

    const totalBytes = probe.totalBytes || expectedSize || 0;
    try {
      const bytes = probe.rangeSupported && totalBytes
        ? await chunkedDownload(doFetch, url, totalBytes, onProgress, signal)
        : await streamDownload(doFetch, url, totalBytes, onProgress, signal);
      if (expectedSize && bytes.byteLength !== expectedSize) {
        failures.push(`长度不符（${bytes.byteLength} ≠ ${expectedSize}）`);
        continue;
      }
      const sha256 = await sha256Hex(bytes);
      assertNotCancelled(signal);
      if (expectedSha256 && sha256 !== expectedSha256.trim().toUpperCase()) {
        failures.push("SHA-256 校验未通过");
        continue;
      }
      return { bytes, filename, sha256 };
    } catch (error) {
      if (signal?.aborted) throw new Error("已取消下载");
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`安装包下载失败：${failures.join("；")}`);
};
