import { useState } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, Code2, Download, Layers3, MessageCircle, RefreshCw } from "lucide-react";
import { APP_VERSION } from "./diagnostics";
import { checkForLatestRelease, GITHUB_RELEASES_URL, type LatestRelease } from "./update-check";

interface AboutPanelProps {
  onClose: () => void;
}

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "success"; release: LatestRelease }
  | { status: "error" };

const publishedDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
};

export function AboutPanel({ onClose }: AboutPanelProps) {
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle" });

  const checkUpdates = async () => {
    setCheckState({ status: "checking" });
    try {
      setCheckState({ status: "success", release: await checkForLatestRelease(APP_VERSION) });
    } catch {
      setCheckState({ status: "error" });
    }
  };

  const release = checkState.status === "success" ? checkState.release : undefined;
  const dateText = publishedDate(release?.publishedAt);
  const resultTitle = release?.relation === "update-available"
    ? `发现新版本 ${release.tag}`
    : release?.relation === "current-ahead"
      ? "当前版本比公开版更新"
      : release
        ? "已是最新版本"
        : "";
  const resultText = release?.relation === "update-available"
    ? `当前为 v${APP_VERSION}${dateText ? `，新版本发布于 ${dateText}` : ""}`
    : release?.relation === "current-ahead"
      ? `当前为 v${APP_VERSION}，GitHub 公开最新版为 ${release.tag}`
      : release
        ? `当前版本 v${APP_VERSION} 与 GitHub 公开最新版一致`
        : "";

  return <div className="sheet-body about-sheet">
    <section className="about-hero"><span>半</span><div><b>半步五子棋打谱</b><small>版本 {APP_VERSION} 测试版 · 个人 Vibecoding 项目</small></div></section>
    <section className="creator-message"><b>个人项目说明</b><p>这是一个由个人通过 Vibecoding 制作的五子棋工具。开发过程中借鉴了一些公开的五子棋代码、文件格式和算法实现，仅用于学习、研究和个人使用。如有任何内容涉及侵权，请通过 GitHub 联系，我会立即删除或调整相关内容。</p></section>
    <section className="about-card"><h3><MessageCircle size={17}/>用户交流 QQ 群</h3><p>欢迎加入 QQ 群 <strong>1091866163</strong>，可以交流五子棋打谱、做题和软件使用，也可以反馈遇到的问题。分享棋谱或截图前，请先确认其中没有不方便公开的个人信息。</p></section>
    <section className="about-card"><h3><Layers3 size={17}/>后续维护</h3><p>后续有时间会继续更新功能、改善使用体验并修复发现的 Bug。项目的新版网页、安装包和更新说明会优先发布在 GitHub，可从下面的项目主页查看和下载。</p></section>
    <section className="update-check-card" aria-live="polite">
      <div className="update-check-heading"><RefreshCw size={18}/><span><b>检查更新</b><small>联网查询 GitHub 的最新正式版本</small></span></div>
      {checkState.status === "success" && <div className={`update-check-result ${release?.relation === "update-available" ? "has-update" : "is-current"}`}>{release?.relation === "update-available" ? <Download size={18}/> : <CheckCircle2 size={18}/>}<span><b>{resultTitle}</b><small>{resultText}</small></span></div>}
      {checkState.status === "error" && <div className="update-check-result has-error"><CircleAlert size={18}/><span><b>检查失败</b><small>请确认网络可用后重试；这不会影响离线使用。</small></span></div>}
      <div className="update-check-actions"><button type="button" className="secondary-button" disabled={checkState.status === "checking"} onClick={() => { void checkUpdates(); }}>{checkState.status === "checking" ? "正在检查…" : checkState.status === "idle" ? "联网检查更新" : "重新检查"}</button>{release?.relation === "update-available" && <a className="primary-button" href={release.url} target="_blank" rel="noreferrer">前往下载</a>}</div>
    </section>
    <a className="github-link" href={GITHUB_RELEASES_URL.replace(/\/releases$/, "")} target="_blank" rel="noreferrer"><Code2 size={20}/><span><b>GitHub 项目主页与下载</b><small>github.com/gugujiao953-ship-it/banbu-gomoku</small></span><ChevronRight size={18}/></a>
    <button className="primary-button" onClick={onClose}>完成</button>
  </div>;
}
