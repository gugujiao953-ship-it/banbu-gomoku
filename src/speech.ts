import { coordinateName } from "./game";
import type { GameDocument, Player, Position, RecordNode } from "./types";

/**
 * 语音报手（用户 09-23）：读谱自动播放时念出「黑 7 · H8」，让听谱成立。
 *
 * 实现用 Web Speech 的 `speechSynthesis`：桌面浏览器与安卓 Chrome 原生支持，
 * **不新增依赖、不增加包体**。安卓应用内的 WebView 没有这个 API（平台限制），
 * 此时 `speechSupported()` 返回 false，开关不会出现，调用也直接静默返回——
 * 绝不因为念不出来而中断播放或抛错。将来要覆盖应用内，走原生 TTS 插件即可，
 * 本模块的接口不用改（只需让 speechSupported 认那条路）。
 *
 * 播报**不排队**：读谱播放可能每 300ms 就前进一步，排队会把语音拖到几十秒后，
 * 与画面完全脱节。所以每步都是「掐掉上一句、念当前这句」。
 */

/** 开关与语速的存储键，与其它本机偏好同一命名风格。 */
export const SPEECH_ENABLED_KEY = "banbu-speech-enabled-v1";
export const SPEECH_RATE_KEY = "banbu-speech-rate-v1";

export const SPEECH_RATE_VALUES = [0.8, 1, 1.2] as const;
export type SpeechRate = (typeof SPEECH_RATE_VALUES)[number];

export const DEFAULT_SPEECH_RATE: SpeechRate = 1;

export const speechSupported = (): boolean =>
  typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function" && typeof window.SpeechSynthesisUtterance === "function";

/** 中文优先选一个中文音色；系统没有中文音色时返回 null，交给引擎用默认嗓音。 */
const pickChineseVoice = (): SpeechSynthesisVoice | null => {
  try {
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    return voices.find((voice) => /^zh/i.test(voice.lang)) ?? null;
  } catch {
    return null;
  }
};

export const loadSpeechEnabled = (): boolean => {
  try { return window.localStorage.getItem(SPEECH_ENABLED_KEY) === "true"; } catch { return false; }
};
export const saveSpeechEnabled = (enabled: boolean) => {
  try { window.localStorage.setItem(SPEECH_ENABLED_KEY, enabled ? "true" : "false"); } catch { /* 偏好可选 */ }
};

export const loadSpeechRate = (): SpeechRate => {
  try {
    const raw = Number(window.localStorage.getItem(SPEECH_RATE_KEY));
    return (SPEECH_RATE_VALUES as readonly number[]).includes(raw) ? (raw as SpeechRate) : DEFAULT_SPEECH_RATE;
  } catch { return DEFAULT_SPEECH_RATE; }
};
export const saveSpeechRate = (rate: SpeechRate) => {
  try { window.localStorage.setItem(SPEECH_RATE_KEY, String(rate)); } catch { /* 偏好可选 */ }
};

/**
 * 把一手组织成播报文案。
 *
 * 读作「黑 7 · H8」而不是「黑七 H8」：手数与坐标都用系统读音更稳，且"7"与"H8"
 * 在语音里天然断开，听者不会把两个数字连起来听。起始局面单独一句话——它是
 * 导航到根节点时的常见落点，念成「第 0 手」会让人以为少了一步。
 */
export const describeMove = (document: GameDocument, move: (Position & { player: Player }) | null, moveNumber: number): string => {
  if (!move) return "起始局面";
  const size = document.metadata.boardSize || 15;
  return `${move.player === "black" ? "黑" : "白"} ${moveNumber} · ${coordinateName({ row: move.row, col: move.col }, size)}`;
};

/** 从一份棋谱 + 当前节点，算出该念的那句话。 */
export const describeCurrentStep = (document: GameDocument, currentId: string | null, depth: number): string => {
  if (!currentId || depth <= 0) return "起始局面";
  // 非落子节点（过手、摆局面、纯锚点）自己没得念，向上找最近的落子——否则读谱
  // 播放经过这类节点时会突然静音一句。
  let node: RecordNode | undefined = document.nodes[currentId];
  while (node && !node.move) node = node.parentId ? document.nodes[node.parentId] : undefined;
  return node?.move ? describeMove(document, node.move, depth) : "起始局面";
};

let lastUtterance: SpeechSynthesisUtterance | null = null;

/**
 * 念一句。关闭 / 平台不支持 / 被系统拒绝时都安静返回 false，绝不抛错。
 * 每次都先 cancel：连续导航时上一句必须让位，否则语音会越积越久。
 */
export const speakStep = (text: string, enabled: boolean, rate: SpeechRate = DEFAULT_SPEECH_RATE): boolean => {
  if (!enabled || !text || !speechSupported()) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickChineseVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.lang = voice?.lang ?? "zh-CN";
    lastUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
};

/** 停止当前播报（关闭开关、离开读谱、停止播放时调用）。 */
export const stopSpeaking = (): void => {
  lastUtterance = null;
  if (!speechSupported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* 忽略 */ }
};
