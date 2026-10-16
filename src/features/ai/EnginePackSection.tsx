import { useEffect, useRef, useState } from "react";
import { Bot, Check, Download, Loader2, Trash2 } from "lucide-react";
import { SettingsLink, SettingsSection } from "../settings/SettingsPage";
import { deleteEnginePack, downloadEnginePack, enginePackSnapshot, ENGINE_PACK_SIZE, ENGINE_PACK_VERSION, subscribeEnginePack, type DownloadProgress, type EnginePackSnapshot } from "./engine-pack";

const packSizeLabel = () => `${(ENGINE_PACK_SIZE / 1024 / 1024).toFixed(1)}MB`;

/** Settings section for the optional full-strength engine pack: status, one-tap
 * download with progress, and immediate activation without any configuration.
 *
 * ⚠ 这一节**只在网页环境渲染**：`nativeReady`（安卓原生引擎就绪）时整个分区
 * `return null`（原因见下面那处早退的注释，别只看这条摘要就把分区「恢复」回去）。
 * 因此下面的下载/删除逻辑与状态文案都只服务浏览器与 PWA。 */
export function EnginePackSection({ order, search, nativeReady = false, kataReady = false, kataSelected = false }: { order: number; search: string; nativeReady?: boolean; kataReady?: boolean; kataSelected?: boolean }) {
  const [snapshot, setSnapshot] = useState<EnginePackSnapshot>(() => enginePackSnapshot());
  const [phase, setPhase] = useState<"idle" | "downloading" | "error">("idle");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimer = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeEnginePack((next) => setSnapshot({ ...next }));
    return () => { unsubscribe(); };
  }, []);
  useEffect(() => () => { if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current); }, []);

  const startDownload = async () => {
    setPhase("downloading");
    setError("");
    setProgress({ receivedBytes: 0, totalBytes: ENGINE_PACK_SIZE });
    try {
      await downloadEnginePack((next) => setProgress(next));
      setPhase("idle");
      setProgress(null);
    } catch (caught) {
      setPhase("error");
      setProgress(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const removePack = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    setConfirmingDelete(false);
    setPhase("idle");
    setError("");
    await deleteEnginePack();
  };

  // 原生（安卓）环境不渲染这一节。用户 2026-10-02 第二次报同一件事：
  // 「设置里面那个强力 ai 引擎的介绍怎么又跑出来了，去掉那个外面的这个按钮，之前早就
  // 放关于里面去了」——2026-10-01 那一轮只删了分区里复述的介绍正文、把分区留着当解释位，
  // 用户看到的仍然是「强力 AI 引擎（本机原生引擎）」标题 + 两张引擎卡，在他眼里就是
  // 介绍又冒出来了。**这就是这个 bug 复发的原因：只删文案、留着分区，分区自己就是那份介绍。**
  //
  // 原生下这个分区里没有任何可点的动作，删掉它不丢功能：
  //   · 下载/删除那份 38.4MB 网页包在原生毫无用处（原生引擎自带同一套 Rapfi 冠军权重，
  //     两者不能共存，App.tsx 里原生就绪后还会主动 deleteEnginePack 释放旧包）；
  //   · 引擎切换本来就不在这里——分析面板与快捷中心的 rapfi / katago 开关（旧文案自己也写着）；
  //   · 引擎状态已经在别处写着：分析面板的「本机原生引擎 · 已生效」状态条，
  //     设置 →「分析 → 分析引擎」那行的「本机原生引擎已就绪…」，原生专属的 DotProd /
  //     线程数也在「分析」里；
  //   · 各引擎的介绍早就单独成页：关于 → 引擎与模型介绍（src/features/about/EngineInfoView.tsx）。
  // 网页那一面（下面 return 的分区）必须保留：那是 downloadEnginePack / deleteEnginePack
  // 唯一的 UI。门禁：qa/settings-page-regression.mjs（网页面）+
  // src/features/ai/engine-pack-section.test.tsx（原生面直接喂 nativeReady，桌面浏览器
  // 的探针永远是 false，够不到这一面）。
  if (nativeReady) return null;

  // KataGo 旗舰引擎卡（2026-09-25 实装）：二进制+作者网随 APK 分发（arm64），
  // 引擎常驻 + 启动标定（每手等待恒等于档位设定，机器快慢只体现在搜索量）。
  // 实测依据：对「五子棋分析」App 原班 KataGo 引擎 4:0（同机同时限）。
  // 发热是真实代价（3s 搜索即可触发降频），所以是 opt-in 开关而非默认引擎。
  // 原生环境走不到这里（上面已 return null），所以这张卡在网页面上只会是
  // 「仅安卓原生环境可用」那种未就绪形态；katago 的开关与介绍在分析面板和「关于」里。
  const kataCard = kataReady ? (
    <>
      <div className="engine-pack-active">
        <Bot aria-hidden="true"/>
        <div>
          <b>KataGo 引擎</b>
          <small>作者网 · 神经网络引擎。切换在分析面板/快捷中心的「rapfi / katago」开关，随处可切。<b>{kataSelected ? "当前：katago" : "当前：rapfi"}</b></small>
        </div>
      </div>
    </>
  ) : (
    <div className="engine-pack-active engine-pack-planned">
      <Bot aria-hidden="true"/>
      <div><b>KataGo 引擎</b><small>作者网 · 神经网络引擎；仅安卓原生环境可用。</small></div>
    </div>
  );

  const summary = phase === "downloading" && progress
    ? `下载中 ${Math.min(100, Math.round((progress.receivedBytes / Math.max(1, progress.totalBytes)) * 100))}%`
    : snapshot.state ? `rapfi 已生效 · v${snapshot.state.version}` : "内置引擎（自带轻量网络）· 冠军网络包可下载";

  return (
    <SettingsSection icon={<Bot/>} order={order} search={search} title="AI 引擎" summary={summary}>
      {kataCard}
      {phase === "downloading" && progress ? (
        <div className="engine-pack-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((progress.receivedBytes / Math.max(1, progress.totalBytes)) * 100))}>
          <span style={{ width: `${Math.min(100, (progress.receivedBytes / Math.max(1, progress.totalBytes)) * 100)}%` }}/>
          <small>{(progress.receivedBytes / 1024 / 1024).toFixed(1)} / {packSizeLabel()}</small>
        </div>
      ) : null}
      {phase === "error" && error ? <p className="helper engine-pack-error">{error}</p> : null}
      {snapshot.state ? (
        <>
          <div className="engine-pack-active"><Check aria-hidden="true"/><div><b>rapfi 已生效</b><small>v{snapshot.state.version} · {packSizeLabel()} · 已在后续所有对局、思考与推荐中使用</small></div></div>
          {/* 已装包也保留下载入口（用户 09-14）：引擎包随 APK / 同源分发、启动即自动安装，
              只留「删除」会让下载功能等于看不见。原生引擎探测失败时（不支持的 ABI 等）
              安卓也会落到这一面，这时这个入口就是唯一的自救路径。重新下载按源优先级
              重新拉取官方包并覆盖当前包（本地自带包读坏了也有自救路径）。 */}
          <SettingsLink icon={<Download/>} title={phase === "downloading" ? "正在下载引擎包…" : "重新下载引擎包"} text={`重新拉取官方 ${packSizeLabel()} 包并覆盖当前 v${snapshot.state.version}`} disabled={phase === "downloading"} onClick={() => { void startDownload(); }}/>
          <SettingsLink icon={confirmingDelete ? <Loader2/> : <Trash2/>} title={confirmingDelete ? "再点一次确认删除" : "删除引擎包"} text="删除后立即恢复随包内置的备用引擎，可随时重新下载" onClick={() => { void removePack(); }}/>
        </>
      ) : (
        <SettingsLink icon={<Download/>} title={phase === "downloading" ? "正在下载引擎包…" : "下载冠军网络包（可选）"} text={`提升棋力 · ${packSizeLabel()} · 下载完成后自动生效，不下载也能用内置引擎`} disabled={phase === "downloading"} onClick={() => { void startDownload(); }}/>
      )}
      {/* 这份包要不要下、下了有什么用，是本分区（网页环境）自己的话；
          各引擎的介绍在「关于 → 引擎与模型介绍」那一页，这里不复述（用户 2026-10-01/10-02 两次提）。 */}
      <p className="helper">上面这份冠军网络包是<b>可选加强</b>：不下载也能正常分析与对弈（用随包的轻量网络），装上后棋力明显更强。各引擎是什么、怎么选，见「关于 → 引擎与模型介绍」。</p>
    </SettingsSection>
  );
}