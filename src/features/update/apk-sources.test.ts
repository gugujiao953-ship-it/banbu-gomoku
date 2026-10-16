import { describe, expect, it } from "vitest";

import type { LatestRelease } from "../../update-check";
import { acceleratedApkUrl, apkDownloadSources, ACCEL_PROXY_PREFIX } from "./apk-sources";

const release = (over: Partial<LatestRelease> = {}): LatestRelease => ({
  version: "1.1.9.2",
  tag: "v1.1.9.2",
  url: "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/tag/v1.1.9.2",
  relation: "update-available",
  source: "pages",
  apkUrl: "https://github.com/gugujiao953-ship-it/banbu-gomoku/releases/download/v1.1.9.2/banbu-gomoku-1.1.9.2-android-release.apk",
  mirrors: {},
  ...over,
});

describe("安装包候选源（加速直链放最前，代理可被 version.json 换掉）", () => {
  it("默认候选：加速 → release 直连 → 站点同源，且加速就是前缀串直链", () => {
    const sources = apkDownloadSources(release());
    expect(sources[0]).toBe(`${ACCEL_PROXY_PREFIX}${release().apkUrl}`);
    expect(sources[1]).toBe(release().apkUrl);
    expect(sources[2]).toContain("gugujiao953-ship-it.github.io");
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("mirrors.accel 整条覆盖（换代理站不必等应用更新）", () => {
    const sources = apkDownloadSources(release({ mirrors: { accel: "https://mirror.example.com/custom.apk" } }));
    expect(sources[0]).toBe("https://mirror.example.com/custom.apk");
    expect(sources).not.toContain(ACCEL_PROXY_PREFIX + release().apkUrl);
  });

  it("version.json 没写 apk 时按标准文件名拼，加速地址也跟着拼出来", () => {
    const sources = apkDownloadSources(release({ apkUrl: "" }));
    expect(sources[0]).toMatch(/^https:\/\/gh-proxy\.com\/https:\/\/github\.com\/.*v1\.1\.9\.2\/banbu-gomoku-1\.1\.9\.2-android-release\.apk$/);
    expect(sources[1]).toMatch(/^https:\/\/github\.com\/.*banbu-gomoku-1\.1\.9\.2-android-release\.apk$/);
  });

  it("非 github.com 的 apk 地址（作者指向网盘等）不套代理前缀", () => {
    const custom = "https://files.example.com/app.apk";
    expect(acceleratedApkUrl(custom)).toBeUndefined();
    const sources = apkDownloadSources(release({ apkUrl: custom }));
    expect(sources[0]).toBe(custom);
  });
});
