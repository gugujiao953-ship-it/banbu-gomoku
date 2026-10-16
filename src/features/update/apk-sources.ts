/**
 * 安装包下载地址的组装规则。
 *
 * 为什么不用「同源 /app/ 目录」放 APK：GitHub Pages 对单文件有体积压力，且 APK
 * 放进站点会让每次发版都要推 46MB 静态文件；release asset 是更自然的家。所以
 * 主源是 release 直连，站点镜像只在作者显式配置时参与（见 publish-version-json）。
 */

import { apkAssetUrl } from "../../update-check";
import type { LatestRelease } from "../../update-check";

/** CI 固定产出的安装包文件名（.github/workflows/android-release.yml）。 */
export const apkFilename = (version: string) => `banbu-gomoku-${version.replace(/^v/i, "")}-android-release.apk`;

/** GitHub 加速反代前缀：在 release 直链前面串上它，点一下就下载，不用再进发布页点第二次。
 *  这是**第三方服务**，域名随时可能换，所以 ① version.json 的 `mirrors.accel` 能整条覆盖它
 *  （换代理只要发一次站点元数据，不必等应用更新）；② 它只是候选源之一，且装之前还要过
 *  字节长度 + SHA-256 两道校验（见 apk-download.ts），代理换不了包。 */
export const ACCEL_PROXY_PREFIX = "https://gh-proxy.com/";

/** 加速地址：显式配置优先，否则按前缀拼 release 直链；拼不出（非 github.com 地址）就不给。 */
export const acceleratedApkUrl = (apkUrl: string, override?: string): string | undefined => {
  const explicit = override?.trim();
  if (explicit) return explicit;
  return apkUrl.startsWith("https://github.com/") ? `${ACCEL_PROXY_PREFIX}${apkUrl}` : undefined;
};

/**
 * 候选下载源，按尝试顺序：
 *   1. 加速直链（国内到 GitHub 的下载最常卡在这条上，所以放第一位）
 *   2. version.json 里的 apk 字段（作者可指向任意镜像）
 *   3. 按版本号拼出的 release 直连（标准命名，通常与第 2 条同一个地址，去重后只剩一个）
 *   4. 站点同源镜像（作者把 APK 也推到 Pages 时才有；不存在会被预检快速跳过，
 *      不会像引擎包早期那样白等分片重试）
 */
export const apkDownloadSources = (release: LatestRelease): string[] => {
  const direct = release.apkUrl || apkAssetUrl(release.version);
  const candidates = [
    acceleratedApkUrl(direct, release.mirrors?.accel),
    release.apkUrl,
    apkAssetUrl(release.version),
    apkPagesMirrorUrl(release.version),
  ];
  return [...new Set(candidates.filter((url): url is string => Boolean(url)))];
};

/** 站点镜像地址（发版时可选推送到 gh-pages 根目录）。 */
export const apkPagesMirrorUrl = (version: string) =>
  `https://gugujiao953-ship-it.github.io/banbu-gomoku/${apkFilename(version)}`;
