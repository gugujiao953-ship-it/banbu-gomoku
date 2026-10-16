import { Download, FolderOpen, HardDriveDownload } from "lucide-react";
import type { LatestRelease } from "../../update-check";
import { acceleratedApkUrl } from "./apk-sources";

/**
 * 新版本的几类下载入口：
 *   1. 应用内直接下载安装（主路径，走 install-update.ts）
 *   2. 百度云 / 蓝奏云（备用；**只有 version.json 里写了才出现**——作者没把当期
 *      安装包传上去时就不写，界面自然不显示，避免指向上一版的旧包）
 *   3. 浏览器直接下载：release 直链串上加速反代，点一下就下（用户 2026-10-04 要求，
 *      代理不可用时这条自然退回 release 直链）
 *   4. GitHub 发布页（看更新说明与 .sha256 的地方，始终存在）
 */
export interface UpdateDownloadLinksProps {
  release: LatestRelease;
  /** 点击应用内下载；不传则该入口不渲染。 */
  onDownload?: () => void;
  /** 应用内下载进行中：按钮禁用并显示进度文案。 */
  progressText?: string | null;
  disabled?: boolean;
  /** 当前平台能不能直接唤起安装器（决定主按钮的副标题措辞）。 */
  canInstallDirectly?: boolean;
  onExternal?: (kind: "baidu" | "lanzou" | "github") => void;
}

const hostOf = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};

export function UpdateDownloadLinks({ release, onDownload, progressText, disabled, canInstallDirectly, onExternal }: UpdateDownloadLinksProps) {
  const { mirrors } = release;
  const hasMirrors = Boolean(mirrors.baidu || mirrors.lanzou);
  const accelUrl = acceleratedApkUrl(release.apkUrl, mirrors.accel);

  return <div className="update-download-links">
    {onDownload && <button type="button" className="primary-button" disabled={disabled} onClick={onDownload}>
      {progressText ? <HardDriveDownload size={16}/> : <Download size={16}/>}
      {progressText || `下载并安装 v${release.version}`}
    </button>}
    {onDownload && <p className="update-download-hint">
      {canInstallDirectly
        ? "下载完成后会交给系统安装器，按提示确认即可覆盖安装。棋谱、题库与设置不受影响。"
        : "下载完成后会交给系统处理，在文件管理器中点一下即可安装。棋谱、题库与设置不受影响。"}
    </p>}

    {hasMirrors && <div className="update-mirror-links">
      <small>网盘下载（应用内直连不畅时可用）</small>
      {mirrors.baidu && <a className="secondary-button" href={mirrors.baidu} target="_blank" rel="noreferrer" onClick={() => onExternal?.("baidu")}>
        <FolderOpen size={16}/>百度网盘
      </a>}
      {mirrors.lanzou && <a className="secondary-button" href={mirrors.lanzou} target="_blank" rel="noreferrer" onClick={() => onExternal?.("lanzou")}>
        <FolderOpen size={16}/>蓝奏云{mirrors.lanzouCode ? `（密码 ${mirrors.lanzouCode}）` : ""}
      </a>}
    </div>}

    <a className="update-github-link" href={accelUrl || release.url} target="_blank" rel="noreferrer" onClick={() => onExternal?.("github")}>
      <Download size={14}/>{accelUrl ? `浏览器直接下载（${hostOf(accelUrl)}）` : `GitHub 下载页（${hostOf(release.url)}）`}
    </a>
    {accelUrl && <a className="update-github-link" href={release.url} target="_blank" rel="noreferrer" onClick={() => onExternal?.("github")}>
      <Download size={14}/>GitHub 发布页（更新说明与校验文件）
    </a>}
  </div>;
}
