import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForLatestRelease, compareVersions, GITHUB_RELEASES_API, JSDELIVR_VERSION_URL, PAGES_VERSION_URL, resetPreferredUpdateSource, versionRelation } from "./update-check";

describe("版本比较", () => {
  it("按语义版本而不是字符串比较", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("v1.1.6", "1.1.6")).toBe(0);
    expect(compareVersions("1.1.6-beta.2", "1.1.6")).toBe(-1);
  });

  it("区分可更新、已是最新版和开发版领先", () => {
    expect(versionRelation("1.1.5", "1.1.6")).toBe("update-available");
    expect(versionRelation("1.1.6", "v1.1.6")).toBe("same");
    expect(versionRelation("1.1.7", "1.1.6")).toBe("current-ahead");
  });

  // 项目 package.json 用四段构建号；旧解析器只认三段、遇到四段直接抛错，导致检查
  // 更新在所有正式包里静默失败（用户 09-13 问「自动检查还生效吗」）。
  it("接受四段构建号（package.json 用的是 1.1.8.0 这种写法）", () => {
    // versionRelation(本地版本, 线上版本)
    expect(versionRelation("1.1.7", "1.1.8.0")).toBe("update-available");
    expect(versionRelation("1.1.8.0", "1.1.7")).toBe("current-ahead");
    expect(versionRelation("1.1.8.0", "1.1.8")).toBe("same");
    expect(compareVersions("1.1.8", "1.1.8.0")).toBe(0);
    expect(compareVersions("1.1.8.1", "1.1.8.0")).toBe(1);
    expect(compareVersions("1.1.10.2", "1.1.9.9")).toBe(1);
    expect(compareVersions("1.1.8.0-dev", "1.1.8")).toBe(-1);
  });

  it("非法版本号仍然报错，不会静默当成最新版", () => {
    expect(() => compareVersions("abc", "1.0.0")).toThrow("无法识别版本号");
    expect(() => compareVersions("1.1", "x.y")).toThrow("无法识别版本号");
  });
});

describe("多源检查更新", () => {
  beforeEach(() => resetPreferredUpdateSource());

  const versionJson = (version: string) => new Response(JSON.stringify({
    version,
    tag: `v${version}`,
    publishedAt: "2026-09-05T04:12:45Z",
    url: `https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/v${version}`,
  }), { status: 200 });

  it("首选站点版本文件（手机可直达 github.io）", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(PAGES_VERSION_URL);
      return versionJson("1.1.7");
    }) as unknown as typeof fetch;

    const result = await checkForLatestRelease("1.1.6", fetchImpl);
    expect(result).toMatchObject({ version: "1.1.7", tag: "v1.1.7", relation: "update-available", source: "pages" });
    expect(result.url).toContain("/releases/tag/v1.1.7");
  });

  it("站点不可用时退到 jsDelivr 镜像", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (String(input) === PAGES_VERSION_URL) throw new TypeError("Failed to fetch");
      return versionJson("1.1.7");
    }) as unknown as typeof fetch;

    const result = await checkForLatestRelease("1.1.6", fetchImpl);
    expect(result.source).toBe("jsdelivr");
    expect(calls).toEqual([PAGES_VERSION_URL, JSDELIVR_VERSION_URL]);
  });

  it("GitHub 兜底扫描发布列表：跳过引擎包等非版本 tag", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== GITHUB_RELEASES_API) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify([
        { tag_name: "engine-pack-v3", published_at: "2026-09-07T16:47:18Z" },
        { tag_name: "v1.1.7", published_at: "2026-09-05T04:12:45Z" },
        { tag_name: "v1.1.6", published_at: "2026-09-02T10:16:50Z" },
      ]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await checkForLatestRelease("1.1.6", fetchImpl, { sources: ["github"] });
    expect(result).toMatchObject({ version: "1.1.7", source: "github", relation: "update-available" });
    expect(fetchImpl).toHaveBeenCalledWith(GITHUB_RELEASES_API, expect.objectContaining({ cache: "no-store" }));
  });

  it("跳过草稿与预发布，全无匹配则报错", async () => {
    const onlyPacks = vi.fn(async () => new Response(JSON.stringify([
      { tag_name: "v1.2.0", draft: true },
      { tag_name: "v1.2.1-beta.1", prerelease: true },
      { tag_name: "engine-pack-v3" },
    ]), { status: 200 })) as unknown as typeof fetch;
    await expect(checkForLatestRelease("1.1.6", onlyPacks, { sources: ["github"] })).rejects.toThrow(/所有更新源都不可用/);
  });

  it("全部源失败时抛出聚合错误（界面据此提示）", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 403 })) as unknown as typeof fetch;
    await expect(checkForLatestRelease("1.1.6", fetchImpl, { sources: ["pages", "jsdelivr", "github"] })).rejects.toThrow(/所有更新源都不可用/);
  });

  it("记住上次成功的源，下次直接命中（不再等前两个超时）", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (String(input) === PAGES_VERSION_URL) throw new TypeError("Failed to fetch");
      return versionJson("1.1.7");
    }) as unknown as typeof fetch;
    await checkForLatestRelease("1.1.6", fetchImpl);
    expect(calls).toEqual([PAGES_VERSION_URL, JSDELIVR_VERSION_URL]);
    calls.length = 0;
    await checkForLatestRelease("1.1.6", fetchImpl);
    expect(calls[0]).toBe(JSDELIVR_VERSION_URL);
  });

  it("version.json 缺 version 字段视为该源失败", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tag: "v1.1.7" }), { status: 200 })) as unknown as typeof fetch;
    await expect(checkForLatestRelease("1.1.6", fetchImpl, { sources: ["pages"] })).rejects.toThrow(/所有更新源都不可用/);
  });
});
