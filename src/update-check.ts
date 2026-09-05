export const GITHUB_RELEASES_URL = "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases";
export const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/gugujiao953-ship-it/banbu-gomoku/releases/latest";

export type VersionRelation = "update-available" | "same" | "current-ahead";

export interface LatestRelease {
  version: string;
  tag: string;
  publishedAt?: string;
  url: string;
  relation: VersionRelation;
}

interface GithubReleaseResponse {
  tag_name?: unknown;
  published_at?: unknown;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const parseVersion = (value: string): [number, number, number, string[]] => {
  const normalized = value.trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`无法识别版本号：${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]?.split(".") || []];
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
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion[index] === rightVersion[index]) continue;
    return leftVersion[index] < rightVersion[index] ? -1 : 1;
  }
  return comparePrerelease(leftVersion[3], rightVersion[3]);
};

export const versionRelation = (currentVersion: string, latestVersion: string): VersionRelation => {
  const comparison = compareVersions(currentVersion, latestVersion);
  if (comparison < 0) return "update-available";
  if (comparison > 0) return "current-ahead";
  return "same";
};

export async function checkForLatestRelease(currentVersion: string, fetchImpl: FetchLike = fetch): Promise<LatestRelease> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(GITHUB_LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const payload = await response.json() as GithubReleaseResponse;
    if (typeof payload.tag_name !== "string") throw new Error("GitHub 返回的版本信息不完整");
    const version = payload.tag_name.trim().replace(/^v/i, "");
    const publishedAt = typeof payload.published_at === "string" ? payload.published_at : undefined;
    return {
      version,
      tag: payload.tag_name,
      publishedAt,
      url: `${GITHUB_RELEASES_URL}/tag/${encodeURIComponent(payload.tag_name)}`,
      relation: versionRelation(currentVersion, version),
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
