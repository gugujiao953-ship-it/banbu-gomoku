import { describe, expect, it, vi } from "vitest";
import { checkForLatestRelease, compareVersions, GITHUB_LATEST_RELEASE_API, versionRelation } from "./update-check";

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
});

describe("GitHub 更新检查", () => {
  it("读取最新发布并生成可信的下载地址", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      tag_name: "v1.1.6",
      published_at: "2026-08-30T08:00:00Z",
      html_url: "https://example.invalid/不采用这个地址",
    }), { status: 200 })) as typeof fetch;

    const result = await checkForLatestRelease("1.1.5", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(GITHUB_LATEST_RELEASE_API, expect.objectContaining({ cache: "no-store" }));
    expect(result).toEqual({
      version: "1.1.6",
      tag: "v1.1.6",
      publishedAt: "2026-08-30T08:00:00Z",
      url: "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/v1.1.6",
      relation: "update-available",
    });
  });

  it("把网络错误交给界面处理", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 403 })) as typeof fetch;
    await expect(checkForLatestRelease("1.1.6", fetchImpl)).rejects.toThrow("GitHub 返回 403");
  });
});
