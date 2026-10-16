/**
 * KataGo 旗舰引擎的专属设置控件（与 rapfi 那套分开显示）。
 *
 * 四个地方共用同一份状态与同一套控件：设置页「分析」分区、分析面板、快捷中心、
 * 人机对战面板——切换引擎只是换掉这一块（rapfi 显示内存/多线程/线程数/DotProd，
 * 旗舰显示档位/线程/缓存/恢复默认），其余界面完全一致。
 *
 * 值经 kata-settings.applyKataSettings 写进引擎 cfg 并触发重启；
 * 重启编排（先取消在算请求再停进程）由 App 通过 setKataRestartHandler 注册。
 *
 * 「档位」是 2026-09-30 照搬「智子本地版」双引擎适配后新增的一格：它不进 cfg，
 * 而是让原生侧换一组「可执行文件 + 模型」（自带 ORT 蒸馏网 / 智子 Eigen 小网 /
 * 智子 ORT b24c256），写的是 engine.choice，同样靠重启进程生效。
 */
import { useEffect, useState } from "react";
import {
  KATA_CACHE_CHOICES,
  KATA_THREAD_CHOICES,
  applyKataSettings,
  loadKataSettings,
  resetKataSettings,
  restartKataEngine,
  subscribeKataSettings,
  type KataSettings,
} from "./kata-settings";
import { nativeKataProfile, setNativeKataProfile } from "./native-engine";

/** 引擎档位文案：值必须与 NativeKataGoPlugin 的 PROFILE_* 常量一致。
 *
 * 名字如实标出**网络身份**。格式经历三轮用户要求：10-01 先要「规格 + 小网/大网 +
 * 快/慢」，同日嫌太长（把面板里的内存格挤出屏幕）改成现在的极简版——规格 + 小网/大网，
 * 快慢/默认/最强这些修饰词全部去掉（默认档本来就预选着，快慢差 19 倍写在注释里即可）：
 *   b10c128 = 随引擎发布的蒸馏小网 gom_distill-b10c128nbt（10 块 × 128 通道，3.4MB）
 *             真机平衡局面实测 **106.9 访问/秒**（快）
 *   b24c256 = 大网（24 块 × 256 通道）—— 2026-10-01 换成 int8 量化那份：
 *             文件从 fp16 的 42MB 降到 **21.9MB**，同机实测从 5.6 提到 **10.9 访问/秒**
 *             （比小网仍慢约 10 倍），棋力更强但要等，只在带 NPU 的新机上划算
 * 原来的「智子迷你网（6b64，Eigen）」已按用户要求移除：棋力最弱（等时对抗 0:5 输给自带小网），
 * 留着只会让人选错，还白占包体。 */
const KATA_PROFILE_CHOICES: ReadonlyArray<readonly [string, string]> = [
  ["own", "b10c128 小网"],
  ["zz", "b24c256 大网"],
];

/** rows 变体的标题行：一眼看到当前跑的是哪个网、多大。 */
const KATA_PROFILE_NET: Record<string, string> = {
  own: "蒸馏小网 b10c128 · 3.4MB",
  zz: "大网 b24c256 · 21.9MB",
};

export function KataTuning({ variant = "rows", onNotice }: { variant?: "panel" | "rows"; onNotice?: (message: string) => void }) {
  const [settings, setSettings] = useState<KataSettings>(loadKataSettings);
  // 只把「当前档位」放进 state；**可用性每次渲染现取**——它来自原生 check()，而 check() 跑在
  // prepare() 之前，装机后首启会误报「本机不可用」（真机实测到过），铺完才准，所以不能钉死。
  const [profile, setProfile] = useState(() => nativeKataProfile().profile);
  const availability = nativeKataProfile();
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeKataSettings(() => setSettings(loadKataSettings())), []);

  const change = async (next: KataSettings) => {
    if (busy) return;
    setBusy(true);
    const ok = await applyKataSettings(next);
    setBusy(false);
    onNotice?.(ok
      ? `KataGo 已重启：${next.threads} 线程 · 缓存 2^${next.cachePower}`
      : "KataGo 设置只在本机原生引擎就绪后生效");
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await resetKataSettings();
    setBusy(false);
    onNotice?.(ok ? "KataGo 设置已恢复默认" : "KataGo 设置只在本机原生引擎就绪后生效");
  };

  /** 切换档位：先写 engine.choice，再走与线程/缓存相同的重启链路。
   *  档位二进制在本机不可用时，原生侧会**整对**回落自带档（引擎+模型一起换回去），
   *  所以这里按探测结果给出如实提示，而不是让用户以为切成功了。 */
  const switchProfile = async (next: string) => {
    if (busy || next === profile) return;
    setBusy(true);
    const ok = await setNativeKataProfile(next);
    setBusy(false);
    if (!ok) {
      onNotice?.("引擎档位只在本机原生引擎就绪后才能切换");
      return;
    }
    const available = next === "own" || availability.zzAvailable;
    setProfile(nativeKataProfile().profile);
    restartKataEngine();
    const label = KATA_PROFILE_CHOICES.find(([value]) => value === next)?.[1] || next;
    onNotice?.(available ? `已切到「${label}」，引擎重启中` : `本机用不了「${label}」，已回落自带引擎`);
  };

  const profileSelect = (
    <select
      aria-label="引擎档位"
      value={profile}
      disabled={busy}
      onChange={(event) => { void switchProfile(event.target.value); }}
    >
      {KATA_PROFILE_CHOICES.map(([value, label]) => {
        const unavailable = value === "zz" && !availability.zzAvailable;
        return <option key={value} value={value}>{unavailable ? `${label}·本机不可用` : label}</option>;
      })}
    </select>
  );
  const threadSelect = (
    <select
      aria-label="KataGo 线程数"
      value={String(settings.threads)}
      disabled={busy}
      onChange={(event) => { void change({ ...settings, threads: Number(event.target.value) }); }}
    >
      {KATA_THREAD_CHOICES.map((count) => <option key={count} value={count}>{String(count)}</option>)}
    </select>
  );
  const cacheSelect = (
    <select
      aria-label="KataGo 缓存"
      value={String(settings.cachePower)}
      disabled={busy}
      onChange={(event) => { void change({ ...settings, cachePower: Number(event.target.value) }); }}
    >
      {KATA_CACHE_CHOICES.map((option) => <option key={option.power} value={option.power}>{option.label}</option>)}
    </select>
  );

  if (variant === "panel") {
    return (
      <div className="kata-tuning">
        <label className="kata-tuning-cell"><span>档位</span>{profileSelect}</label>
        <label className="kata-tuning-cell"><span>线程</span>{threadSelect}</label>
        <label className="kata-tuning-cell"><span>缓存</span>{cacheSelect}</label>
        <button type="button" className="kata-tuning-reset" disabled={busy} onClick={() => { void reset(); }}>恢复默认</button>
      </div>
    );
  }

  return (
    <div className="tuned-engine-block kata-tuning-rows">
      <div className="tuned-engine-head">
        <span className="tuned-engine-label">KataGo</span>
        <output className="tuned-engine-value">{KATA_PROFILE_NET[profile] || "未知档位"}</output>
        <button type="button" className="tuned-mini-toggle" disabled={busy} onClick={() => { void reset(); }}>恢复默认</button>
      </div>
      <label className="tuned-engine-threads"><span>档位</span>{profileSelect}</label>
      <label className="tuned-engine-threads"><span>线程</span>{threadSelect}</label>
      <label className="tuned-engine-threads"><span>缓存</span>{cacheSelect}</label>
    </div>
  );
}
