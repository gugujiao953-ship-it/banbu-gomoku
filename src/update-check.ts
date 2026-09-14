export const GITHUB_RELEASES_URL = "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases";
export const GITHUB_RELEASES_API = "https://api.github.com/repos/gugujiao953-ship-it/banbu-gomoku/releases?per_page=20";
// 多源检查更新（T35）：手机网络（尤其国内）常常连不上 api.github.com，而 GitHub Pages
// 站点是可用的（应用内引擎包就是从同一个 Pages 主机下载成功验证的）。因此把
// 「站点上的静态 version.json」放第一优先，jsDelivr 镜像第二，GitHub API 兜底。
export const PAGES_VERSION_URL = "https://gugujiao953-ship-it.github.io/banbu-gomoku/version.json";
export const JSDELIVR_VERSION_URL = "https://cdn.jsdelivr.net/gh/gugujiao953-ship-it/banbu-gomoku@gh-pages/version.json";

export type VersionRelation = "update-available" | "same" | "current-ahead";
export type UpdateSourceId = "pages" | "jsdelivr" | "github";

export interface LatestRelease {
  version: string;
  tag: string;
  publishedAt?: string;
  url: string;
  relation: VersionRelation;
  /** 本次命中的更新源，便于界面/诊断显示。 */
  source: UpdateSourceId;
}

interface VersionJsonPayload {
  version?: unknown;
  tag?: unknown;
  publishedAt?: unknown;
  url?: unknown;
}

interface GithubReleaseResponse {
  tag_name?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * 解析版本号。除标准三段 semver 外还必须接受四段构建号：项目 package.json 用的是
 * `1.1.8.0` 这种写法，旧实现只认三段、遇到四段直接抛错，导致「检查更新」在所有
 * 正式包里静默失败（用户 09-13 发现「自动检查是否还生效」）。
 */
const parseVersion = (value: string): { parts: number[]; prerelease: string[] } => {
  const normalized = value.trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`无法识别版本号：${value}`);
  return { parts: match[1].split(".").map(Number), prerelease: match[2]?.split(".") || [] };
};

const comparePrerelease = (left: string[], right: string[]) => {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber < rightNumber ? -1 : 1;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
};

export const compareVersions = (left: string, right: string) => {
  const a = parseVersion(left), b = parseVersion(right);
  // 逐段比较，缺段补 0：`1.1.8` 与 `1.1.8.0` 视为同一版本；`1.1.7.9` 高于 `1.1.7`。
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const l = a.parts[index] ?? 0, r = b.parts[index] ?? 0;
    if (l === r) continue;
    return l < r ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
};

export const versionRelation = (currentVersion: string, latestVersion: string): VersionRelation => {
  const comparison = compareVersions(currentVersion, latestVersion);
  if (comparison < 0) return "update-available";
  if (comparison > 0) return "current-ahead";
  return "same";
};

interface RawRelease { version: string; tag: string; publishedAt?: string; url?: string }

const readVersionJson = async (fetchImpl: FetchLike, url: string, signal: AbortSignal): Promise<RawRelease> => {
  const response = await fetchImpl(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`返回 ${response.status}`);
  const payload = await response.json() as VersionJsonPayload;
  if (typeof payload.version !== "string" || !payload.version.trim()) throw new Error("version.json 缺少 version 字段");
  const version = payload.version.trim().replace(/^v/i, "");
  const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : `v${version}`;
  return {
    version,
    tag,
    publishedAt: typeof payload.publishedAt === "string" ? payload.publishedAt : undefined,
    url: typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : undefined,
  };
};

// /releases/latest 按创建时间取最新非预发布版本——公开仓里引擎包（engine-pack-v3）比
// 应用版本更新，会被选中且 tag 不是版本号，导致「检查更新」在所有网络下都报错。
// 因此改为扫描发布列表，取第一个 tag 形如 v1.2.3 的非草稿/非预发布发布。
const readGithubApi = async (fetchImpl: FetchLike, signal: AbortSignal): Promise<RawRelease> => {
  const response = await fetchImpl(GITHUB_RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
  const list = await response.json() as GithubReleaseResponse[];
  if (!Array.isArray(list)) throw new Error("GitHub 返回的发布列表格式异常");
  for (const entry of list) {
    if (!entry || entry.draft === true || entry.prerelease === true) continue;
    const tag = typeof entry.tag_name === "string" ? entry.tag_name.trim() : "";
    if (!/^v?\d+\.\d+\.\d+/.test(tag)) continue;
    return {
      version: tag.replace(/^v/i, ""),
      tag,
      publishedAt: typeof entry.published_at === "string" ? entry.published_at : undefined,
    };
  }
  throw new Error("GitHub 上没有匹配应用版本的发布");
};

const SOURCE_ORDER: UpdateSourceId[] = ["pages", "jsdelivr", "github"];
const SOURCE_TIMEOUT_MS: Record<UpdateSourceId, number> = { pages: 6_000, jsdelivr: 6_000, github: 8_000 };

const loadSource = (id: UpdateSourceId, fetchImpl: FetchLike, signal: AbortSignal): Promise<RawRelease> => {
  if (id === "pages") return readVersionJson(fetchImpl, PAGES_VERSION_URL, signal);
  if (id === "jsdelivr") return readVersionJson(fetchImpl, JSDELIVR_VERSION_URL, signal);
  return readGithubApi(fetchImpl, signal);
};

// 会话内记住上次成功的源：一次探测后后续检查直接命中，避免每次都等前两个超时。
let preferredSource: UpdateSourceId | null = null;

const orderedSources = (): UpdateSourceId[] => preferredSource
  ? [preferredSource, ...SOURCE_ORDER.filter((id) => id !== preferredSource)]
  : [...SOURCE_ORDER];

/**
 * 依次尝试多个更新源，返回第一个成功的版本信息。全部失败才抛错（界面据此提示）。
 * 单源失败不影响其他源；每个源有独立超时，最坏情况总耗时 ≈ 各源超时之和。
 */
export async function checkForLatestRelease(
  currentVersion: string,
  fetchImpl: FetchLike = fetch,
  options: { sources?: UpdateSourceId[] } = {},
): Promise<LatestRelease> {
  const order = options.sources ?? orderedSources();
  const failures: string[] = [];
  for (const id of order) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS[id]);
    try {
      const raw = await loadSource(id, fetchImpl, controller.signal);
      preferredSource = id;
      return {
        version: raw.version,
        tag: raw.tag,
        publishedAt: raw.publishedAt,
        url: raw.url ?? `${GITHUB_RELEASES_URL}/tag/${encodeURIComponent(raw.tag)}`,
        relation: versionRelation(currentVersion, raw.version),
        source: id,
      };
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
  throw new Error(`所有更新源都不可用（${failures.join("；")}）`);
}

/** 仅测试用：重置会话内记住的更新源。 */
export const resetPreferredUpdateSource = () => { preferredSource = null; };
