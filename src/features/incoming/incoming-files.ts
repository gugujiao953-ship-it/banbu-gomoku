/**
 * 接收系统交给本应用的棋谱文件（用户 2026-09-23）。
 *
 * 场景：在文件管理器 / 微信 / QQ 里点一个 .sgf，或长按文件选「分享」再选半步。
 * 原生侧（IncomingFilePlugin + MainActivity）负责把文件接住并暂存，这里负责取回并
 * 还原成 File，交给 App 既有的导入管线——**不做任何新的解析或类型判定**。
 *
 * 两条路，缺一不可：
 *   · 冷启动（应用没开）：原生把文件暂存好，这里启动后主动 takeFiles() 拉。
 *     不能靠事件——那时 bridge 与 WebView 都还没就绪，事件会静默丢掉。
 *   · 热启动（应用在后台）：原生发 incomingFiles 事件，这里收到就去拉。
 *
 * 网页端（含手机浏览器）拿不到这种能力，全部函数在非原生环境直接返回空/不订阅，
 * 所以对网页版是零副作用——与 photo-picker.ts 的降级策略一致。
 */

import { applySniff, sniffIncomingFile } from "./sniff";

interface IncomingFilePayload {
  name?: string;
  size?: number;
  mimeType?: string;
  dataUrl?: string;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, {
    takeFiles?: () => Promise<{ files?: IncomingFilePayload[] }>;
    hasFiles?: () => Promise<{ count?: number }>;
  }>;
}

const bridge = (): CapacitorBridge | null =>
  (globalThis as { Capacitor?: CapacitorBridge }).Capacitor ?? null;

/**
 * 原生插件就绪前 bridge 可能还没挂好，要重试。
 *
 * 这里比 pip-native.ts 的 6×250ms 宽得多（40×500ms ≈ 20s），因为两者面对的时机完全不同：
 * PiP 是用户在页面里点了按钮之后才要插件，本函数是**冷启动第一眼**就要——从微信点一个棋谱
 * 进来时 WebView 刚建好、主线程还在装载引擎与字体，1.5 秒内 `Capacitor.Plugins` 还没挂上
 * 是真会发生的事。探到就走，正常情况下这一次都不等；探不到才会把文件留在暂存区，
 * 于是用户看到的是「应用打开了但什么都没发生，过一会儿重开才冒出一条解析失败」。
 */
const PROBE_ATTEMPTS = 40;
const PROBE_RETRY_MS = 500;
const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const plugin = () => bridge()?.Plugins?.IncomingFile;

const waitForPlugin = async (): Promise<NonNullable<ReturnType<typeof plugin>> | null> => {
  if (!bridge()?.isNativePlatform?.()) return null;
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    const candidate = plugin();
    if (typeof candidate?.takeFiles === "function") return candidate;
    await delay(PROBE_RETRY_MS);
  }
  return null;
};

/** 把 dataURL 还原成 File（与 photo-picker.ts 同一写法，下游接口不变）。 */
const dataUrlToFile = (dataUrl: string, name: string, mimeType: string): File | null => {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], name, { type: mimeType });
  } catch {
    return null;
  }
};

/**
 * 取走原生暂存的外部文件（原生侧读完即删，所以同一份不会被取两次）。
 *
 * 非原生环境、插件不可用、或没有待处理文件时都返回空数组——调用方只需判空，
 * 不必区分这几种情况。
 */
export const takeIncomingFiles = async (): Promise<File[]> => {
  const api = await waitForPlugin();
  if (!api?.takeFiles) return [];
  try {
    const result = await api.takeFiles();
    const payloads = Array.isArray(result?.files) ? result.files : [];
    const files: File[] = [];
    for (const payload of payloads) {
      if (!payload?.dataUrl) continue;
      const mimeType = payload.mimeType || "application/octet-stream";
      const file = dataUrlToFile(payload.dataUrl, payload.name || "棋谱文件", mimeType);
      if (!file) continue;
      // 按内容纠正类型与后缀（用户 2026-10-03：是棋谱就导入、是图片就进识谱）。
      // 原生给来的 mimeType 常是 octet-stream、名字常被分享方改掉，只认这两样就会
      // 「棋盘截图被当成棋谱报解析失败」和「没后缀的 SGF 被白名单挡掉」两类漏。
      files.push(applySniff(file, await sniffIncomingFile(file)));
    }
    return files;
  } catch {
    // 读取失败不抛给调用方：外部文件是「顺带的好事」，不该影响应用启动。
    return [];
  }
};

/**
 * 暂存区里还有几份没被取走的外部文件（诊断用；冷启动没接上时会留下，见 takeFiles 的读完即删）。
 *
 * 非原生环境或插件没就绪时返回 undefined —— 调用方据此**不显示这一行**，而不是报「0 份」，
 * 免得把"探不到"讲成"没有"。
 */
export const pendingIncomingFileCount = async (): Promise<number | undefined> => {
  const api = plugin();
  if (typeof api?.hasFiles !== "function") return undefined;
  try {
    const result = await api.hasFiles();
    return typeof result?.count === "number" ? result.count : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 订阅热启动的「又收到文件」提醒。返回取消订阅函数。
 *
 * 事件 detail 既可能是对象、也可能是 JSON 字符串（原生用 JSObject.toString() 发送），
 * 两种都认——这套兼容逻辑与 App 里既有的 pictureInPicture 事件处理一致。
 */
export const onIncomingFiles = (handler: () => void): (() => void) => {
  if (!bridge()?.isNativePlatform?.()) return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<string | { count?: number }>).detail;
    let count = 0;
    if (typeof detail === "object" && detail) count = Number(detail.count) || 0;
    else {
      try { count = Number((JSON.parse(String(detail)) as { count?: number }).count) || 0; }
      catch { count = 0; }
    }
    if (count > 0) handler();
  };
  globalThis.addEventListener("incomingFiles", listener);
  return () => globalThis.removeEventListener("incomingFiles", listener);
};
