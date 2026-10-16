import { afterEach, describe, expect, it, vi } from "vitest";
import { apkAssetUrl, checkForLatestRelease, resetPreferredUpdateSource } from "../../update-check";
import { apkDownloadSources, apkFilename, apkPagesMirrorUrl } from "./apk-sources";
import type { LatestRelease } from "../../update-check";

const versionJson = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

const fetchReturning = (payload: unknown) => vi.fn(async () => versionJson(payload)) as unknown as typeof fetch;

afterEach(() => { resetPreferredUpdateSource(); vi.unstubAllGlobals(); });

const basePayload = {
  version: "1.1.9",
  tag: "v1.1.9",
  publishedAt: "2026-09-15T00:00:00Z",
  url: "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/v1.1.9",
};

describe("update metadata", () => {
  it("builds the release asset url from the fixed CI naming", () => {
    expect(apkFilename("1.1.9")).toBe("banbu-gomoku-1.1.9-android-release.apk");
    expect(apkFilename("v1.1.9")).toBe("banbu-gomoku-1.1.9-android-release.apk");
    expect(apkAssetUrl("1.1.9")).toBe("https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/download/v1.1.9/banbu-gomoku-1.1.9-android-release.apk");
  });

  it("falls back to the derived asset url when version.json omits apk", async () => {
    const release = await checkForLatestRelease("1.1.8", fetchReturning(basePayload), { sources: ["pages"] });
    expect(release.apkUrl).toBe(apkAssetUrl("1.1.9"));
    expect(release.apkSha256).toBeUndefined();
  });

  it("reads apk, sha256 and mirrors when present", async () => {
    const release = await checkForLatestRelease("1.1.8", fetchReturning({
      ...basePayload,
      apk: "https://mirror.example.com/app.apk",
      sha256: "af753c73aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44",
      mirrors: { baidu: "https://pan.baidu.com/s/abc?pwd=v6tn", lanzou: "https://wwbwc.lanzouq.com/iJJgS48ghxji", lanzouCode: "1i8s" },
    }), { sources: ["pages"] });
    expect(release.apkUrl).toBe("https://mirror.example.com/app.apk");
    expect(release.apkSha256).toBe("af753c73aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44");
    expect(release.mirrors).toEqual({ baidu: "https://pan.baidu.com/s/abc?pwd=v6tn", lanzou: "https://wwbwc.lanzouq.com/iJJgS48ghxji", lanzouCode: "1i8s" });
  });

  it("keeps mirror fields absent when the author has not uploaded that copy", async () => {
    const release = await checkForLatestRelease("1.1.8", fetchReturning({
      ...basePayload,
      // 只标了百度云：蓝奏云本期没传，就不该出现入口。
      mirrors: { baidu: "https://pan.baidu.com/s/abc?pwd=v6tn" },
    }), { sources: ["pages"] });
    expect(release.mirrors.baidu).toBe("https://pan.baidu.com/s/abc?pwd=v6tn");
    expect(release.mirrors.lanzou).toBeUndefined();
  });

  it("shows no mirror entries when version.json declares none", async () => {
    const release = await checkForLatestRelease("1.1.8", fetchReturning(basePayload), { sources: ["pages"] });
    expect(release.mirrors).toEqual({});
  });

  it("ignores blank and non-string mirror values instead of rendering empty buttons", async () => {
    const release = await checkForLatestRelease("1.1.8", fetchReturning({
      ...basePayload,
      mirrors: { baidu: "   ", lanzou: 42, lanzouCode: "" },
    }), { sources: ["pages"] });
    expect(release.mirrors).toEqual({});
  });

  it("never advertises mirrors when the version came from the GitHub API fallback", async () => {
    // API 只有版本信息，没有镜像配置；此时不应凭空出现网盘按钮。
    const apiFetch = vi.fn(async () => new Response(JSON.stringify([{ tag_name: "v1.1.9", published_at: "2026-09-15T00:00:00Z" }]), { status: 200 })) as unknown as typeof fetch;
    const release = await checkForLatestRelease("1.1.8", apiFetch, { sources: ["github"] });
    expect(release.mirrors).toEqual({});
    expect(release.apkUrl).toBe(apkAssetUrl("1.1.9"));
  });
});

describe("apk download sources", () => {
  const releaseWith = (apkUrl: string): LatestRelease => ({
    version: "1.1.9",
    tag: "v1.1.9",
    url: "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/v1.1.9",
    relation: "update-available",
    source: "pages",
    apkUrl,
    mirrors: {},
  });

  it("tries the declared url, then the derived release url, then the site mirror", () => {
    const sources = apkDownloadSources(releaseWith("https://mirror.example.com/app.apk"));
    expect(sources[0]).toBe("https://mirror.example.com/app.apk");
    expect(sources).toContain(apkAssetUrl("1.1.9"));
    expect(sources).toContain(apkPagesMirrorUrl("1.1.9"));
  });

  it("de-duplicates when the declared url already is the release url（加速直链另算一条）", () => {
    const sources = apkDownloadSources(releaseWith(apkAssetUrl("1.1.9")));
    expect(sources.filter((url) => url === apkAssetUrl("1.1.9"))).toHaveLength(1);
    expect(sources).toHaveLength(3);
    expect(sources[0]).toBe(`https://gh-proxy.com/${apkAssetUrl("1.1.9")}`);
  });
});
