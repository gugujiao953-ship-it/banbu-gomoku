import { useEffect, useRef, useState } from "react";
import { Bot, Check, Download, Loader2, Trash2 } from "lucide-react";
import { SettingsLink, SettingsSection } from "../settings/SettingsPage";
import { deleteEnginePack, downloadEnginePack, enginePackSnapshot, ENGINE_PACK_SIZE, ENGINE_PACK_VERSION, subscribeEnginePack, type DownloadProgress, type EnginePackSnapshot } from "./engine-pack";

const packSizeLabel = () => `${(ENGINE_PACK_SIZE / 1024 / 1024).toFixed(1)}MB`;

/** Settings section for the optional full-strength engine pack: status, one-tap
 * download with progress, and immediate activation without any configuration. */
export function EnginePackSection({ order, search }: { order: number; search: string }) {
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

  const summary = phase === "downloading" && progress
    ? `下载中 ${Math.min(100, Math.round((progress.receivedBytes / Math.max(1, progress.totalBytes)) * 100))}%`
    : snapshot.state ? `强力引擎已生效 · v${snapshot.state.version}` : "轻量引擎 · 完整引擎包可下载";

  return (
    <SettingsSection icon={<Bot/>} order={order} search={search} title="强力 AI 引擎" summary={summary}>
      <p className="helper">下载官方冠军级评估网络包（覆盖连珠、无禁手、自由全部规则，{packSizeLabel()}）。下载在本应用内完成，完成后自动生效，无需任何配置；也可以随时删除恢复轻量引擎。建议在 Wi-Fi 下下载。</p>
      {phase === "downloading" && progress ? (
        <div className="engine-pack-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((progress.receivedBytes / Math.max(1, progress.totalBytes)) * 100))}>
          <span style={{ width: `${Math.min(100, (progress.receivedBytes / Math.max(1, progress.totalBytes)) * 100)}%` }}/>
          <small>{(progress.receivedBytes / 1024 / 1024).toFixed(1)} / {packSizeLabel()}</small>
        </div>
      ) : null}
      {phase === "error" && error ? <p className="helper engine-pack-error">{error}</p> : null}
      {snapshot.state ? (
        <>
          <div className="engine-pack-active"><Check aria-hidden="true"/><div><b>强力引擎已生效</b><small>v{snapshot.state.version} · {packSizeLabel()} · 已在后续所有对局、思考与推荐中使用</small></div></div>
          {/* 已装包也保留下载入口（用户 09-14）：引擎包随 APK 分发、启动即自动安装，
              只留「删除」会让下载功能在真机上等于看不见。重新下载按源优先级重新拉取
              官方包并覆盖当前包（本地自带包读坏了也有自救路径）。 */}
          <SettingsLink icon={<Download/>} title={phase === "downloading" ? "正在下载引擎包…" : "重新下载引擎包"} text={`重新拉取官方 ${packSizeLabel()} 包并覆盖当前 v${snapshot.state.version}`} disabled={phase === "downloading"} onClick={() => { void startDownload(); }}/>
          <SettingsLink icon={confirmingDelete ? <Loader2/> : <Trash2/>} title={confirmingDelete ? "再点一次确认删除" : "删除引擎包"} text="删除后立即恢复随包轻量引擎，可随时重新下载" onClick={() => { void removePack(); }}/>
        </>
      ) : (
        <SettingsLink icon={<Download/>} title={phase === "downloading" ? "正在下载引擎包…" : "下载强力引擎包"} text={`完整冠军网络 · ${packSizeLabel()} · 下载完成后自动生效`} disabled={phase === "downloading"} onClick={() => { void startDownload(); }}/>
      )}
    </SettingsSection>
  );
}
