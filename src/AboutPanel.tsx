import { useState } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, Code2, Cpu, Download, Info, Layers3, MessageCircle, RefreshCw, Stethoscope } from "lucide-react";
import { APP_VERSION } from "./diagnostics";
import { downloadText } from "./formats";
import { collectCompatibilityReport } from "./features/diagnostics/compatibility-report";
import { checkForLatestRelease, GITHUB_RELEASES_URL, type LatestRelease } from "./update-check";
import { UpdateDownloadLinks } from "./features/update/UpdateDownloadLinks";
import { apkDownloadSources, apkFilename } from "./features/update/apk-sources";
import { downloadAndInstallUpdate, supportsNativeApkInstall } from "./features/update/install-update";
import { EngineInfoView } from "./features/about/EngineInfoView";
import { ReleaseNotesView } from "./features/about/ReleaseNotesView";
import { releaseNotesFor } from "./release-notes";

interface AboutPanelProps {
  onClose: () => void;
  /**
   * 直接落到某个子视图（用户 2026-10-01：首运行/换版本弹窗右上角那枚「本版本更新了什么」
   * 点了要跳到更新内容，而不是先落在关于列表再让人找一次）。默认 "main"。
   */
  initialView?: AboutView;
}

/** 关于面板的三个视图：主列表 / 引擎介绍 / 本版本更新内容。 */
export type AboutView = "main" | "engine" | "notes";

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

export function AboutPanel({ onClose, initialView }: AboutPanelProps) {
  const [view, setView] = useState<AboutView>(initialView ?? "main");
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle" });
  const [download, setDownload] = useState<{ percent: number; text: string } | null>(null);
  // 兼容性自检（用户 2026-10-03：群友报「引擎打不开 / db 打不开」，我们摸不到他的机器）。
  const [compat, setCompat] = useState<{ text: string; delivered: "copied" | "saved" | "none" } | null>(null);
  const [compatBusy, setCompatBusy] = useState(false);
  const runCompatibilityCheck = async () => {
    setCompatBusy(true);
    try {
      const text = await collectCompatibilityReport();
      const clipboard = navigator.clipboard;
      let delivered: "copied" | "saved" | "none" = "none";
      if (clipboard?.writeText) {
        try { await clipboard.writeText(text); delivered = "copied"; } catch { delivered = "none"; }
      }
      setCompat({ text, delivered });
    } finally {
      setCompatBusy(false);
    }
  };
  const [downloadError, setDownloadError] = useState("");

  // 子视图整块替换主列表：关于面板是从「设置」和「首运行弹窗」两个地方进来的，
  // 叠一层浮层会把返回路径搞乱，不如就地换内容 + 每页第一行都是「返回关于」。
  if (view === "engine") {
    return <div className="sheet-body about-sheet"><EngineInfoView onBack={() => setView("main")}/></div>;
  }
  if (view === "notes") {
    return <div className="sheet-body about-sheet"><ReleaseNotesView onBack={() => setView("main")}/></div>;
  }

  const checkUpdates = async () => {
    setCheckState({ status: "checking" });
    setDownloadError("");
    try {
      setCheckState({ status: "success", release: await checkForLatestRelease(APP_VERSION) });
    } catch {
      setCheckState({ status: "error" });
    }
  };

  const startDownload = async (release: LatestRelease) => {
    if (download) return;
    setDownloadError("");
    setDownload({ percent: 0, text: "正在准备下载…" });
    try {
      const result = await downloadAndInstallUpdate({
        urls: apkDownloadSources(release),
        filename: apkFilename(release.version),
        expectedSha256: release.apkSha256,
        onProgress: ({ receivedBytes, totalBytes }) => {
          const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;
          setDownload({ percent, text: `正在下载安装包 ${percent}%` });
        },
      });
      setDownload(null);
      setDownloadError(result.outcome.status === "installing"
        ? "安装包已下载完成，请在系统提示里确认安装。"
        : result.outcome.status === "handed-off"
          ? "安装包已下载完成，请在文件管理器里点开安装。"
          : "已交给浏览器下载，下载完成后点开即可安装。");
    } catch (error) {
      setDownload(null);
      setDownloadError(`${error instanceof Error ? error.message : String(error)}。可改用下方网盘入口下载。`);
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
    <section className="about-hero"><span><img src="./icon.svg" width={46} height={46} alt="" aria-hidden="true"/></span><div><b>半步五子棋打谱</b><small>版本 {APP_VERSION} · 个人 Vibecoding 项目</small></div></section>
    <section className="creator-message"><b>个人项目说明</b><p>这是一个由个人通过 Vibecoding 制作的五子棋工具。开发过程中借鉴了一些公开的五子棋代码、文件格式和算法实现，这些借鉴内容仅用于学习、研究和个人使用。如有任何内容涉及侵权，请通过 GitHub 联系，我会立即删除或调整相关内容。</p></section>
    <section className="about-card"><h3><Code2 size={17}/>开源免费</h3><p>本应用是开源免费软件：全部源代码以 MIT 许可证公开在 GitHub，任何人都可以免费下载、使用、修改和分发。应用内没有付费功能、会员和内购，也不含广告。</p></section>
    {/* 两枚入口（用户 2026-10-01：引擎介绍单独列一个按钮；本版本更新内容也单独一个按钮，
        以后更新了在这里看）。做成行式入口而不是又两张长卡片，是为了让主列表一眼能扫完。 */}
    <button type="button" className="about-row" data-about-entry="engine" onClick={() => setView("engine")}>
      <Cpu size={18}/><span><b>引擎与模型介绍</b><small>这台设备上有哪些 AI 引擎、要不要额外下载、各自强在哪</small></span><ChevronRight size={18}/>
    </button>
    <button type="button" className="about-row" data-about-entry="notes" onClick={() => setView("notes")}>
      <Info size={18}/><span><b>本版本更新内容</b><small>v{APP_VERSION} · {releaseNotesFor(APP_VERSION)?.items.length ?? 0} 条改动（只列当前这一版）</small></span><ChevronRight size={18}/>
    </button>
    {/* 兼容性自检（用户 2026-10-03：群友报「计算引擎打不开、db 打不开」，靠描述分不清是
        「没切换成功」还是「机器不支持」）。结果直接摊在这段文字里：能复制就复制，
        剪贴板被拦就存成 txt，实在不行截图也一样能用。 */}
    <button type="button" className="about-row" data-about-entry="compat" disabled={compatBusy} onClick={() => { void runCompatibilityCheck(); }}>
      <Stethoscope size={18}/><span><b>{compatBusy ? "正在自检…" : "兼容性自检"}</b><small>这台设备能不能跑原生引擎、大网档为什么置灰、外部文件有没有接上</small></span>{compat ? <ChevronRight size={18}/> : null}
    </button>
    {compat && <div className="about-compat" aria-live="polite">
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, Consolas, monospace", fontSize: "12px", lineHeight: 1.6 }}>{compat.text}</pre>
      <div className="about-compat-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" className="secondary-button" onClick={() => { void runCompatibilityCheck(); }}>重新自检</button>
        <button type="button" className="secondary-button" onClick={() => { downloadText(compat.text, `半步五子棋打谱-兼容性自检-${new Date().toISOString().slice(0, 10)}.txt`, "text/plain;charset=utf-8"); setCompat({ ...compat, delivered: "saved" }); }}><Download size={15}/>存成文件</button>
        <small>{compat.delivered === "copied" ? "已复制到剪贴板，粘到群里即可" : compat.delivered === "saved" ? "已保存为 txt 文件" : "这台设备不让程序写剪贴板：可存成文件，或直接截图上面这段"}</small>
      </div>
    </div>}
    <section className="about-card"><h3><Code2 size={17}/>第三方引擎与模型许可</h3><p>本机 AI 引擎基于 <strong>KataGo</strong>（作者 lightvector，MIT 许可）及其社区分支 <strong>KataGomo / Barbakan_Zero</strong>（同为 MIT 许可，许可全文随安装包一并保留）；rapfi 引擎为 <strong>GPL-3.0</strong>。各引擎跑哪套权重、要不要额外下载，见上面「引擎与模型介绍」，这里不重复。智子大网的权重由社区分享、未标注授权条款，本应用仅作本机分析使用；如需商用或再分发，请先与原作者/权重作者确认。</p></section>
    <section className="about-card"><h3><MessageCircle size={17}/>用户交流 QQ 群</h3><p>欢迎加入 QQ 群 <strong>1091866163</strong>，可以交流五子棋打谱、做题和软件使用，也可以反馈遇到的问题。分享棋谱或截图前，请先确认其中没有不方便公开的个人信息。</p></section>
    <section className="about-card"><h3><Layers3 size={17}/>后续维护</h3><p>后续有时间会继续更新功能、改善使用体验并修复发现的 Bug。新版可直接在本应用内下载安装；不方便时可改用网盘入口，或从下方项目主页查看。</p></section>
    <section className="update-check-card" aria-live="polite">
      <div className="update-check-heading"><RefreshCw size={18}/><span><b>检查更新</b><small>联网查询官方站点的最新正式版本（多源自动切换）</small></span></div>
      {checkState.status === "success" && <div className={`update-check-result ${release?.relation === "update-available" ? "has-update" : "is-current"}`}>{release?.relation === "update-available" ? <RefreshCw size={18}/> : <CheckCircle2 size={18}/>}<span><b>{resultTitle}</b><small>{resultText}</small></span></div>}
      {checkState.status === "error" && <div className="update-check-result has-error"><CircleAlert size={18}/><span><b>检查失败</b><small>更新源暂时都不可用：多为当前网络到境外站点受限（GitHub 及其加速镜像）。可稍后重试，或直接到下方项目主页查看新版本；不影响离线使用。</small></span></div>}
      <div className="update-check-actions"><button type="button" className="secondary-button" disabled={checkState.status === "checking"} onClick={() => { void checkUpdates(); }}>{checkState.status === "checking" ? "正在检查…" : checkState.status === "idle" ? "联网检查更新" : "重新检查"}</button></div>
      {downloadError && <p className="section-note update-download-hint">{downloadError}</p>}
      {release?.relation === "update-available" && <UpdateDownloadLinks
        release={release}
        onDownload={() => { void startDownload(release); }}
        progressText={download?.text}
        disabled={Boolean(download)}
        canInstallDirectly={supportsNativeApkInstall()}
      />}
    </section>
    <a className="github-link" href={GITHUB_RELEASES_URL.replace(/\/releases$/, "")} target="_blank" rel="noreferrer"><Code2 size={20}/><span><b>GitHub 项目主页与下载</b><small>github.com/gugujiao953-ship-it/banbu-gomoku</small></span><ChevronRight size={18}/></a>
    <button className="primary-button" onClick={onClose}>完成</button>
  </div>;
}
