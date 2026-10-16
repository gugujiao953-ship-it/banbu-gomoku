/**
 * 兼容性自检（用户 2026-10-03：群友报「计算引擎打不开、db 打不开」，我们摸不到他的机器，
 * 靠猜分不清是「切换没成功」还是「没适配他的手机」）。
 *
 * 这里只收集**已经在用的**探测结果，不新增任何原生调用；产出一段能直接粘进 QQ 的纯文本，
 * 关键字段的含义都写进行里，让对方一眼能看出哪一条是自己的问题。
 */
import { Capacitor } from "@capacitor/core";

import { APP_VERSION, recentActions } from "../../diagnostics";
import { enginePackSnapshot, type EnginePackSnapshot } from "../ai/engine-pack";
import { nativeEngineInfo, nativeKataGoInfo, nativeKataProfile } from "../ai/native-engine";
import { pendingIncomingFileCount } from "../incoming/incoming-files";

export interface CompatibilityReportInput {
  version: string;
  buildMode: string;
  platform: string;
  userAgent: string;
  language: string;
  crossOriginIsolated: boolean;
  cores: number;
  deviceMemoryGb?: number;
  screen: { width: number; height: number; dpr: number };
  viewport: { width: number; height: number };
  fontScale: string;
  engineChoice: string;
  storage?: { usageMb: number; quotaMb: number };
  incomingPending?: number;
  /** 诊断环形日志（最近 60 条操作与引擎异常）。群友的机器我们摸不到，靠这段还原"异常发生在哪一步之后"。 */
  recentActions?: Array<{ time: string; action: string }>;
  nativeEngine?: ReturnType<typeof nativeEngineInfo> | null;
  nativeKataGo?: ReturnType<typeof nativeKataGoInfo> | null;
  kataProfile?: ReturnType<typeof nativeKataProfile> | null;
  pack?: EnginePackSnapshot | null;
}

const yesNo = (value: boolean | undefined) => (value === undefined ? "未知" : value ? "是" : "否");
const mb = (bytes?: number) => (bytes === undefined ? "?" : `${(bytes / 1048576).toFixed(1)}MB`);
/** 输入已经是 MB（`navigator.storage.estimate()` 的字节在收集时换算过一次），这里只排版。
 *  部分内核/无写入授权时配额接近 0，写成「0.0MB」会被读成"这台机器没空间"，所以如实说探不到。 */
const storageText = (storage?: { usageMb: number; quotaMb: number }) =>
  !storage || storage.quotaMb < 1 ? "这台设备的内核不给存储配额（探不到）"
    : `已用 ${storage.usageMb.toFixed(1)}MB / 配额 ${storage.quotaMb.toFixed(0)}MB`;

/** 存储里存的是内部枚举名，发给群友看不懂，这里换成应用里用的叫法。 */
const ENGINE_CHOICE_LABELS: Record<string, string> = {
  strong: "内置备用引擎（Rapfi）",
  tuned: "调优档（Rapfi 多线程）",
  kata: "KataGo 引擎",
  ikatago: "iKataGo（网页版引擎）",
};

/** 纯函数：给一份数据就固定产出一段文本（所以能用单测钉住字段一个都不漏）。 */
export const formatCompatibilityReport = (input: CompatibilityReportInput): string => {
  const lines: string[] = [];
  const native = input.nativeEngine ?? null;
  const kata = input.kataProfile ?? null;
  lines.push(`半步五子棋打谱 兼容性自检 ${input.version}（${input.buildMode}）`);
  lines.push(`平台 ${input.platform}｜语言 ${input.language}`);
  lines.push(`WebView ${input.userAgent.slice(0, 160)}`);
  lines.push(`屏幕 ${input.screen.width}x${input.screen.height} dpr ${input.screen.dpr}｜可视区 ${input.viewport.width}x${input.viewport.height}｜界面字号 ${input.fontScale}`);
  lines.push(`逻辑核心 ${input.cores}${input.deviceMemoryGb ? `｜系统内存约 ${input.deviceMemoryGb}GB` : ""}`);
  // crossOriginIsolated 是「多线程 WASM」的前提：不是 true 时网页版只能跑单线程引擎，
  // 与手机好坏无关（缺 COOP/COEP 的那条链子曾在网页版实测到过）。
  lines.push(`多线程隔离(crossOriginIsolated) ${yesNo(input.crossOriginIsolated)}${input.crossOriginIsolated ? "" : "—— 网页版只能走单线程引擎，与设备好坏无关"}`);

  lines.push("");
  lines.push("—— 引擎 ——");
  lines.push(`当前选择 ${ENGINE_CHOICE_LABELS[input.engineChoice] || input.engineChoice}`);
  if (native) {
    lines.push(`原生 Rapfi：可用 ${yesNo(native.available)}｜ABI ${native.abi || "无"}｜核 ${native.cores}${native.bigCores !== undefined ? `（大核 ${native.bigCores}）` : ""}`);
    lines.push(`  二进制 ${native.binaryVariant || "未探测"}｜CPU 支持 DotProd ${yesNo(native.dotprodCapable)}｜当前启用 ${yesNo(native.dotprodEnabled)}｜偏好 ${native.dotprodPreference || "auto"}`);
    if (native.dotprodCapable === false) lines.push("  说明：本机 CPU 没有 asimddp（ARMv8.2+ 的点积加速），只会用基线二进制，这是正常的，不是没切换成功");
    lines.push(`  资产已铺开 ${yesNo(native.assetsCopied)}｜路径 ${native.binaryPath || "无"}`);
  } else {
    lines.push("原生 Rapfi：未探测到（不是安卓原生环境，或插件没就绪）");
  }
  // 原生 KataGo 只存在于安卓包里；在网页版打这一行会让人以为"我的引擎坏了"。
  const nativeKata = input.nativeKataGo ?? null;
  if ((kata || nativeKata) && input.platform.startsWith("安卓")) {
    const profile = kata?.profile || nativeKata?.profile || "未知";
    const zzAvailable = kata?.zzAvailable ?? nativeKata?.zzAvailable;
    lines.push(`原生 KataGo：当前档 ${profile}`);
    if (nativeKata) {
      lines.push(`  可用 ${yesNo(nativeKata.available)}｜ABI ${nativeKata.abi || "无"}｜核 ${nativeKata.cores}｜资产已铺开 ${yesNo(nativeKata.payloadReady)}`);
      lines.push(`  当前档 ${profile}｜活动二进制 ${nativeKata.activeBinary || "未启动"}｜CPU 支持 DotProd ${yesNo(nativeKata.dotprodCapable)}｜路径 ${nativeKata.binaryPath || "无"}`);
    }
    lines.push(`  大网(b24c256)本机可用 ${yesNo(zzAvailable)}`);
    if (zzAvailable === false) lines.push("  说明：大网档需要 CPU 支持 DotProd 且模型已铺开；置灰是如实标记，不是切换失败");
  }
  const pack = input.pack;
  lines.push(`可下载引擎包：${pack?.state ? `已装 v${pack.state.version}（${mb(pack.state.size)}，${new Date(pack.state.downloadedAt).toLocaleString()}）` : "未下载（用随包轻量档）"}`);

  lines.push("");
  lines.push("—— 数据 ——");
  lines.push(`本机存储：${storageText(input.storage)}`);
  // 「外部文件收进来却没处理」的那条链子：暂存区里还剩文件就说明上一次没接上，
  // 冷启动取回时会被再取一次（用户报的「过一会重开才报解析失败」就是这个现象）。
  if (input.incomingPending !== undefined) lines.push(`等待处理的外部文件：${input.incomingPending} 份${input.incomingPending > 0 ? "（说明上次投递没接上，本次启动会补处理）" : ""}`);
  lines.push(`棋谱/数据库体积上限见设置；大型 .db/.lib 在手机上受网页内存限制，打不开时先看上面「本机存储」和逻辑核心数。`);

  const actions = (input.recentActions || []).slice(-14);
  lines.push("");
  lines.push("—— 最近操作与异常（时间为本机时区）——");
  if (!actions.length) lines.push("（这次打开应用后还没有记录到操作或引擎异常）");
  for (const entry of actions) {
    const time = new Date(entry.time);
    const stamp = Number.isNaN(time.getTime()) ? "??:??:??" : time.toTimeString().slice(0, 8);
    lines.push(`${stamp} ${entry.action}`);
  }
  return lines.join("\n");
};

const readFontScale = () => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue("--ui-font-scale").trim() || "1";
  } catch {
    return "?";
  }
};

/** 收集 + 格式化；调用方只管把返回的文本塞进剪贴板。 */
export const collectCompatibilityReport = async (): Promise<string> => {
  const storage = await (navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null));
  const incoming = await pendingIncomingFileCount();
  return formatCompatibilityReport({
    version: APP_VERSION,
    buildMode: import.meta.env.MODE,
    platform: Capacitor.isNativePlatform?.() ? `安卓 ${navigator.userAgent.includes("Android") ? navigator.userAgent.match(/Android [\d.]+/)?.[0] || "" : ""}` : "网页",
    userAgent: navigator.userAgent,
    language: navigator.language,
    crossOriginIsolated: (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
    cores: navigator.hardwareConcurrency || 0,
    deviceMemoryGb: (navigator as { deviceMemory?: number }).deviceMemory,
    screen: { width: window.screen?.width || 0, height: window.screen?.height || 0, dpr: window.devicePixelRatio || 1 },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    fontScale: readFontScale(),
    engineChoice: (() => {
      try { return localStorage.getItem("banbu-ai-engine-choice-v1") || "默认"; } catch { return "?"; }
    })(),
    storage: storage ? { usageMb: (storage.usage || 0) / 1048576, quotaMb: (storage.quota || 0) / 1048576 } : undefined,
    incomingPending: incoming,
    recentActions: recentActions(),
    nativeEngine: nativeEngineInfo() ?? undefined,
    nativeKataGo: nativeKataGoInfo() ?? undefined,
    kataProfile: nativeKataProfile(),
    pack: enginePackSnapshot(),
  });
};
