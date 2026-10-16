import { parseCoordinate } from "../../game";
import type { Player, Position } from "../../types";
import { hasNativeHttp } from "../online/online-http";
import { withRequestTimeout } from "../../request-timeout";

/**
 * 「AI 复原手序」的识图通道（用户 09-28 拍板：方案③，应用内直调大模型）。
 *
 * 背景（docs/_archive/2026-10-09/研究-复原手序方案-2026-09-26.md 第 6 节）：自家识别器对
 * 「密集两位数书谱」（paper10：66 子带号）序号读出 0，豆包 Web 版实测却
 * 66/66 全对——VLM 读整图序号强。这里把那条路搬进应用：用户在设置里填
 * 自己申请的端点/Key/模型（OpenAI 兼容格式，识图大模型均可，如豆包、
 * 通义千问、MiMo、智谱），识谱核对屏一键把图发给模型，换回
 * 「第几手落在哪」的列表。
 *
 * 边界与既有结论对齐：
 *  - 只用于**带手数标记**的书谱/截图（序号→手序是「还原」）；无序号图
 *    手序不在图里，模型给的是「重建」，不承诺是真手序。
 *  - 结果不直接入库：回填到叠图核对屏，用户核对后才导入。
 *  - Key 只存本机 localStorage，不进备份、除发给用户指定端点外不出应用。
 *
 * 09-28 二批：接口格式可选三种（用户在用中转站的现实需求）——
 *  - chat：OpenAI 兼容 Chat Completions（豆包/千问/智谱/Kimi/硅基流动与
 *    绝大多数中转站的原生格式，默认）；
 *  - claude：Anthropic Messages（Claude 官方系，x-api-key + anthropic-version 头）；
 *  - responses：OpenAI Responses（OpenAI 主推的新格式，input/output 结构）。
 * 三种只改「怎么发、怎么收」，提示词与序号校验完全共用。
 */

/** 接口格式。缺省 chat：旧档 localStorage 里没有这个字段，按 OpenAI 兼容处理。 */
export type AiVisionFormat = "chat" | "claude" | "responses";

export interface AiVisionConfig {
  /** API 服务的 Base URL，如 https://ark.cn-beijing.volces.com/api/v3 */
  baseUrl: string;
  apiKey: string;
  /** 模型名，如 glm-4v-flash */
  model: string;
  /** 接口格式，见文件头。可选：省略 = "chat"。 */
  format?: AiVisionFormat;
}

export const AI_VISION_CONFIG_KEY = "banbu-ai-vision-v1";

const EMPTY_CONFIG: AiVisionConfig & { format: AiVisionFormat } = { baseUrl: "", apiKey: "", model: "", format: "chat" };

const VISION_FORMATS: AiVisionFormat[] = ["chat", "claude", "responses"];

/** 归一化：只留首尾去空白后的字符串；不合法的输入一律回落空配置。 */
export function normalizeAiVisionConfig(raw: unknown): AiVisionConfig & { format: AiVisionFormat } {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CONFIG };
  const value = raw as Record<string, unknown>;
  const text = (input: unknown) => (typeof input === "string" ? input.trim() : "");
  const baseUrl = text(value.baseUrl);
  const format = value.format;
  return {
    baseUrl: /^https?:\/\//i.test(baseUrl) ? baseUrl : "",
    apiKey: text(value.apiKey),
    model: text(value.model),
    format: VISION_FORMATS.includes(format as AiVisionFormat) ? (format as AiVisionFormat) : "chat",
  };
}

export function loadAiVisionConfig(): AiVisionConfig {
  try {
    return normalizeAiVisionConfig(JSON.parse(localStorage.getItem(AI_VISION_CONFIG_KEY) || "null"));
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export function saveAiVisionConfig(config: AiVisionConfig): void {
  const clean = normalizeAiVisionConfig(config);
  try {
    if (!clean.baseUrl && !clean.apiKey && !clean.model) localStorage.removeItem(AI_VISION_CONFIG_KEY);
    else localStorage.setItem(AI_VISION_CONFIG_KEY, JSON.stringify(clean));
  } catch {
    /* 隐私模式存不下就是存不下，与其余设置项同一行为 */
  }
}

/** 端点与模型齐全才认为「已配置」。Key 允许为空（局域网自建服务常无鉴权）。 */
export function isAiVisionConfigured(config: AiVisionConfig): boolean {
  const clean = normalizeAiVisionConfig(config);
  return Boolean(clean.baseUrl && clean.model);
}

/**
 * Base URL → 对应接口格式的完整端点地址。容忍用户多填斜杠、或把完整接口
 * 地址（含 /chat/completions、/messages、/responses 尾巴）一起粘进来。
 *  - chat：{base}/chat/completions（OpenAI 兼容）
 *  - claude：{base}/v1/messages（Anthropic 官方 base=https://api.anthropic.com；
 *    已带 /vN 的不重复补 /v1）
 *  - responses：{base}/responses
 */
export function visionEndpointUrl(baseUrl: string, format: AiVisionFormat): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("接口地址必须以 http:// 或 https:// 开头");
  if (format === "claude") {
    if (/\/messages$/i.test(trimmed)) return trimmed;
    return /\/v\d+$/i.test(trimmed) ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
  }
  if (format === "responses") {
    if (/\/responses$/i.test(trimmed)) return trimmed;
    return `${trimmed}/responses`;
  }
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** 旧名字保留：等价 visionEndpointUrl(baseUrl, "chat")。 */
export function chatCompletionsUrl(baseUrl: string): string {
  return visionEndpointUrl(baseUrl, "chat");
}

/** data URL → Anthropic 的 image 段要拆成 media_type + 裸 base64。 */
function splitDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  const mediaType = match[1];
  const data = match[2];
  if (!mediaType || !data) return null;
  return { mediaType, data };
}

interface VisionRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** 按格式装配一次视觉问答请求（提示词 + 图片）。导出供单测逐格式核对结构。 */
export function buildVisionRequest(
  config: AiVisionConfig,
  imageDataUrl: string | null,
  prompt: string,
  options: { maxTokens?: number } = {},
): VisionRequest {
  const clean = normalizeAiVisionConfig(config);
  const maxTokens = options.maxTokens ?? 4096;
  // 显式标 Record：不标时三元推出 `{Authorization:string}|{}`，展开会让
  // headers 类型掉出 Record<string,string>（tsc TS2322）。
  const bearer: Record<string, string> = clean.apiKey ? { Authorization: `Bearer ${clean.apiKey}` } : {};
  if (clean.format === "claude") {
    const content: unknown[] = [];
    if (imageDataUrl) {
      const image = splitDataUrl(imageDataUrl);
      if (!image) throw new Error("图片转不成 Claude 认识的格式，请换一张图重试");
      content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
    }
    content.push({ type: "text", text: prompt });
    return {
      url: visionEndpointUrl(clean.baseUrl, "claude"),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": clean.apiKey,
        // Claude 版本头是协议要求；缺了官方服务直接 400。
        "anthropic-version": "2023-06-01",
        // 官方接口默认拒绝浏览器跨源直连，这个头是 Anthropic 给「自带 Key 的
        // 本地应用」留的正门——Key 本来就在用户自己机器上，与 OpenAI 格式同场景。
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: { model: clean.model, max_tokens: maxTokens, messages: [{ role: "user", content }] },
    };
  }
  if (clean.format === "responses") {
    const content: unknown[] = [{ type: "input_text", text: prompt }];
    if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl });
    // 不传 temperature：Responses 这边部分新模型会拒未知采样参数，
    // 序号提取靠提示词的硬约束，不吃这个。
    return {
      url: visionEndpointUrl(clean.baseUrl, "responses"),
      headers: { "Content-Type": "application/json", ...bearer },
      body: { model: clean.model, max_output_tokens: maxTokens, input: [{ role: "user", content }] },
    };
  }
  const content: unknown[] = [{ type: "text", text: prompt }];
  if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl } });
  return {
    url: visionEndpointUrl(clean.baseUrl, "chat"),
    headers: { "Content-Type": "application/json", ...bearer },
    body: { model: clean.model, messages: [{ role: "user", content }], temperature: 0, max_tokens: maxTokens },
  };
}

/**
 * 提示词：从研究文档第 7 节实测简化版扩出「带序号输出」一条。
 * 要求逐子输出 序号/坐标/颜色 的结构化结果；序号读不出来的图如实返回
 * 空数组，不编造（「重建≠还原」红线）。
 */
export function buildMoveOrderPrompt(boardSize: number): string {
  const last = String.fromCharCode(64 + boardSize);
  return [
    `如图是 ${boardSize}×${boardSize} 五子棋/连珠棋谱盘：列从左到右记 A–${last}，行从下到上记 1–${boardSize}，交叉点坐标写作字母+数字（如 H8）。`,
    "棋盘上的棋子可能印有落子序号（手数）。请逐颗读出所有棋子：",
    "1. 只统计棋盘交叉点上的棋子，忽略坐标字母、水印、分析标记（三角/星号/叉等）。",
    "2. 子上有序号就按序号返回；序号看不清就如实标 null，禁止编造。",
    "3. 全部有序号时，按序号从小到大返回；c 是坐标，p 是颜色（B 黑 W 白）。",
    "4. 严格按此 JSON 数组输出，不要任何解释文字：",
    '[{"n":1,"c":"H8","p":"B"},{"n":2,"c":"H9","p":"W"}]',
    "没有任何棋子时输出 []。",
  ].join("\n");
}

export interface AiMoveOrderEntry {
  /** 书上印的序号（1 起）。 */
  number: number;
  /** 模型给的原始坐标文本。 */
  coord: string;
  /** 模型读到的颜色；与黑白交替矛盾时以交替为准（见 parseMoveOrderReply）。 */
  player: Player | null;
}

/** 坐标文本宽容解析：容忍 H8 / h8 / 8H 与越界（越界返回 null）。 */
function parseCoordToken(raw: string, boardSize: number): Position | null {
  const token = raw.trim().toUpperCase().replace(/\s+/g, "");
  const direct = parseCoordinate(token, boardSize);
  if (direct) return direct;
  const digitFirst = token.match(/^(\d{1,2})([A-Y])$/);
  if (digitFirst) return parseCoordinate(`${digitFirst[2]}${digitFirst[1]}`, boardSize);
  return null;
}

/** 从模型回复里抠出 JSON 数组；容忍代码围栏与前后废话。 */
function extractJsonArray(text: string): unknown[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const playerToken = (raw: unknown): Player | null => {
  const text = String(raw ?? "").trim();
  if (/^(b|B|黑|black)$/.test(text)) return "black";
  if (/^(w|W|白|white)$/.test(text)) return "white";
  return null;
};

/** JSON 抠不出来时的兜底：直接从自由文本里扫「序号,坐标」成对出现的片段。 */
function salvageEntries(text: string, boardSize: number): AiMoveOrderEntry[] {
  const entries: AiMoveOrderEntry[] = [];
  const pattern = /(\d{1,3})\s*[,，:：]?\s*"?\s*([A-Ya-y]\s?\d{1,2})\s*"?\s*([BWbw黑白色]{0,2})/g;
  for (const match of text.matchAll(pattern)) {
    const coord = (match[2] ?? "").replace(/\s+/g, "");
    if (!parseCoordToken(coord, boardSize)) continue;
    const flag = match[3] ?? "";
    const color: Player | null = /白|^W/i.test(flag) ? "white" : /黑|^B/i.test(flag) ? "black" : null;
    entries.push({ number: Number(match[1]), coord, player: color });
  }
  return entries;
}

export interface AiMoveOrderResult {
  /** 按序号排好、已换算成 row/col 与 player 的落子序列。 */
  moves: Array<Position & { player: Player; number: number }>;
  /** 给人看的过程说明（颜色校正了几处等）。 */
  notes: string[];
}

/** 条目里的序号字段：模型用键名的自由度不小，逐个认。 */
const entryNumber = (value: Record<string, unknown>): number => {
  const raw = value.n ?? value.number ?? value.num ?? value.hand ?? value["序号"];
  return typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
};
const entryCoord = (value: Record<string, unknown>): string => {
  const raw = value.c ?? value.coord ?? value.coordinate ?? value.pos ?? value["坐标"];
  return typeof raw === "string" ? raw : "";
};

/**
 * 解析+校验模型回复。硬约束（违反即整体拒绝，宁可退回静态导入也不导入
 * 一份错手序）：
 *  - 序号是正整数、恰好凑成 1..N 连续；
 *  - 坐标合法且不重复（两个序号指向同一格=读错了）；
 *  - 颜色与「奇黑偶白」矛盾超过 1/4 颗 → 判定模型漏读/错读，拒绝。
 * 颜色小面积矛盾按交替规则纠正（黑先行棋里序号奇偶就是颜色，比逐子读色稳）。
 */
export function parseMoveOrderReply(text: string, boardSize: number): AiMoveOrderResult {
  const notes: string[] = [];
  let entries: AiMoveOrderEntry[] = [];
  const json = extractJsonArray(text);
  if (json) {
    for (const item of json) {
      if (typeof item === "string") {
        // 有的模型偷懒只回坐标数组：按出现顺序补序号。
        const coord = item.trim();
        if (parseCoordToken(coord, boardSize)) entries.push({ number: entries.length + 1, coord, player: null });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      const coord = entryCoord(value);
      if (!coord || !parseCoordToken(coord, boardSize)) continue;
      entries.push({ number: entryNumber(value), coord: coord.trim(), player: playerToken(value.p ?? value.color ?? value["颜色"]) });
    }
  }
  if (entries.length === 0) {
    entries = salvageEntries(text, boardSize);
    if (entries.length > 0) notes.push("回复不是标准 JSON，已按文本兜底解析");
  }
  if (entries.length === 0) throw new Error("AI 没有读出任何有效坐标（可能图上看不到序号，或回复不合格式）");

  entries.sort((a, b) => a.number - b.number);
  const used = new Map<string, number>();
  const moves: Array<Position & { player: Player; number: number }> = [];
  let colorMismatches = 0;
  for (const entry of entries) {
    if (!Number.isInteger(entry.number) || entry.number < 1) {
      throw new Error(`AI 读到的序号里有非法值（${entry.coord} 一子），请换更清晰的图重试`);
    }
    const point = parseCoordToken(entry.coord, boardSize);
    if (!point) throw new Error(`AI 返回了越界坐标 ${entry.coord}`);
    const key = `${point.row},${point.col}`;
    const previous = used.get(key);
    if (previous !== undefined) throw new Error(`AI 把 ${entry.coord} 报了两次（第 ${previous} 手与第 ${entry.number} 手），结果不可信`);
    used.set(key, entry.number);
    const expected: Player = entry.number % 2 === 1 ? "black" : "white";
    if (entry.player && entry.player !== expected) colorMismatches += 1;
    moves.push({ ...point, player: expected, number: entry.number });
  }
  // 连续 1..N 校验（装配条件与自家识别器同一口径）。
  const duplicateOrdinal = moves.some((move, index) => index > 0 && move.number === moves[index - 1].number);
  if (duplicateOrdinal || moves[0].number !== 1 || moves[moves.length - 1].number !== moves.length) {
    const seen = new Set(moves.map((move) => move.number));
    const absent: number[] = [];
    for (let index = 1; index <= moves[moves.length - 1].number; index += 1) if (!seen.has(index)) absent.push(index);
    throw new Error(`AI 读到的序号不连续：${absent.length > 0 && absent.length <= 8 ? `缺第 ${absent.join("、")} 手` : "不是从第 1 手起的完整序列"}，无法可靠复原（缺号补猜＝编造手序）`);
  }
  if (colorMismatches > Math.max(2, Math.ceil(moves.length / 4))) {
    throw new Error(`AI 读出的颜色有 ${colorMismatches} 处与黑白交替矛盾，多半是漏读了子，本次放弃`);
  }
  if (colorMismatches > 0) notes.push(`按「奇黑偶白」纠正了 ${colorMismatches} 处颜色`);
  return { moves, notes };
}

/** 图片 → 模型可读的 data URL；超长边时缩到 maxEdge 再编码（省 Token）。 */
export async function imageToModelDataUrl(source: Blob | string, maxEdge = 1568): Promise<string> {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas context");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const encoded = canvas.toDataURL("image/jpeg", 0.92);
    if (encoded.startsWith("data:image/")) return encoded;
    throw new Error("encode failed");
  } catch {
    // iOS 老 WebView 没有 createImageBitmap 之类的场景：原图直转。
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(blob);
    });
  }
}

interface VisionReplyResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  error?: { message?: string };
  /** Claude Messages：[{type:"text",text:"…"}] */
  content?: Array<{ type?: string; text?: string }>;
  /** OpenAI Responses：output[].content[].output_text；部分服务也直接给顶层 output_text。 */
  output?: Array<{ content?: Array<{ type?: string; text?: string; output_text?: string }> }>;
  output_text?: string;
}

async function postVisionRequest(request: VisionRequest, timeoutMs: number): Promise<VisionReplyResponse> {
  try {
    return await withRequestTimeout(async (signal) => {
    const capacitor = (globalThis as { Capacitor?: { Plugins?: { CapacitorHttp?: { request?: (options: Record<string, unknown>) => Promise<{ status?: number; data?: unknown }> } } } }).Capacitor;
    const plugin = capacitor?.Plugins?.CapacitorHttp;
    if (hasNativeHttp() && plugin?.request) {
      // 安卓 WebView 里网页请求受 CSP/跨域限制，原生桥直通（与在线棋谱同一先例）。
      const response = await plugin.request({ url: request.url, method: "POST", headers: { "Content-Type": "application/json", ...request.headers }, data: request.body, connectTimeout: timeoutMs, readTimeout: timeoutMs });
      const status = response?.status ?? 0;
      const parsed = (typeof response?.data === "string" ? JSON.parse(response.data) : response?.data) as VisionReplyResponse | null;
      if (status >= 400) throw new Error(`服务返回 HTTP ${status}${parsed?.error?.message ? `：${parsed.error.message}` : ""}`);
      return parsed ?? {};
    }
    const response = await fetch(request.url, { method: "POST", signal, headers: request.headers, body: JSON.stringify(request.body) });
    const text = await response.text();
    let parsed: VisionReplyResponse | null = null;
    try { parsed = JSON.parse(text) as VisionReplyResponse; } catch { /* 非 JSON 的错误页，下面按状态码报错 */ }
    if (!response.ok) {
      const detail = parsed?.error?.message || (text ? `：${text.slice(0, 120)}` : "");
      throw new Error(`服务返回 HTTP ${response.status}${detail}`);
    }
    return parsed ?? {};
    }, timeoutMs, `AI 服务请求超时（${Math.round(timeoutMs / 1000)} 秒），可稍后重试`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(message)) {
      throw new Error("无法连接到 AI 服务：请检查接口地址与网络；网页版还可能是服务方不允许浏览器直连（CORS），这种情况用 APP 版或换支持浏览器直连的服务");
    }
    throw error;
  }
}

/** 按格式从响应里抠出模型回复文本。导出供单测逐格式核对。 */
export function extractVisionReply(format: AiVisionFormat, answer: VisionReplyResponse): string {
  if (format === "claude") {
    const text = (answer.content ?? []).map((part) => (part?.type === "text" ? part.text ?? "" : "")).join(" ").trim();
    if (text) return text;
    throw new Error("AI 服务返回了空回复");
  }
  if (format === "responses") {
    const parts: string[] = [];
    for (const item of answer.output ?? []) {
      for (const block of item?.content ?? []) {
        if (typeof block?.output_text === "string" && block.output_text) parts.push(block.output_text);
        else if (typeof block?.text === "string" && block.text) parts.push(block.text);
      }
    }
    const joined = parts.join(" ").trim();
    if (joined) return joined;
    if (typeof answer.output_text === "string" && answer.output_text.trim()) return answer.output_text.trim();
    throw new Error("AI 服务返回了空回复");
  }
  const content = answer.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const parts = content.map((part) => part?.text ?? "").join(" ");
    if (parts.trim()) return parts;
  }
  throw new Error("AI 服务返回了空回复");
}

/** 一次视觉问答：图片 + 提示词 → 回复文本。imageDataUrl 传 null 即纯文本请求。 */
export async function askVisionModel(
  config: AiVisionConfig,
  imageDataUrl: string | null,
  prompt: string,
  options: { timeoutMs?: number; maxTokens?: number } = {},
): Promise<string> {
  const clean = normalizeAiVisionConfig(config);
  if (!isAiVisionConfigured(clean)) throw new Error("请先在 设置→数据与兼容→AI 识图服务 填好接口地址与模型名");
  const request = buildVisionRequest(clean, imageDataUrl, prompt, { maxTokens: options.maxTokens });
  const answer = await postVisionRequest(request, options.timeoutMs ?? 90000);
  return extractVisionReply(clean.format, answer);
}

/** 识谱复原主调用：图 → 序号坐标 → 校验后的落子序列。 */
export async function recognizeMoveOrderViaAi(
  config: AiVisionConfig,
  imageSource: Blob | string,
  boardSize: number,
): Promise<AiMoveOrderResult> {
  const dataUrl = await imageToModelDataUrl(imageSource);
  const reply = await askVisionModel(config, dataUrl, buildMoveOrderPrompt(boardSize));
  return parseMoveOrderReply(reply, boardSize);
}

/**
 * 「AI 辅助识别」（用户 2026-10-02 定调：本地为主、云端为辅）：
 * 本地 CV 识别读错时，在核对屏一键让大模型重读整盘——局面 + 手序一次返回，
 * 任意图片风格通用（这正是识图大模型的长项，也是本地小模型做不到的）。
 * 与「复原手序-云端」的分工：那条只读序号、要求凑成完整 1..N 才收；
 * 这条把「局面本身」也读出来，序号只是附带信息，读不全不影响局面导入。
 */

/** 提示词：通用局面读取（无序号图也能用；有号图顺带带出序号）。 */
export function buildPositionPrompt(boardSize: number): string {
  const last = String.fromCharCode(64 + boardSize);
  return [
    `如图是 ${boardSize}×${boardSize} 五子棋/连珠棋盘：列从左到右记 A–${last}，行从下到上记 1–${boardSize}，交叉点坐标写作字母+数字（如 H8）。`,
    "请逐颗读出棋盘上的所有棋子：",
    "1. 只统计棋盘交叉点上的棋子，忽略坐标字母、水印、分析标记（三角/星号/叉等）。",
    "2. c 是坐标，p 是颜色（B 黑 W 白）；实心与空心（描边）都算棋子，颜色看仔细。",
    "3. 子上印有落子序号就填 n（数字），没有或看不清就填 null，禁止编造。",
    "4. 严格按此 JSON 数组输出，不要任何解释文字：",
    '[{"n":1,"c":"H8","p":"B"},{"n":null,"c":"I9","p":"W"}]',
    "没有棋子时输出 []。",
  ].join("\n");
}

export interface AiStoneEntry {
  row: number;
  col: number;
  player: Player;
  /** 图上印的序号；没印/没读出为 null。 */
  number: number | null;
}

export interface AiPositionResult {
  stones: AiStoneEntry[];
  /** 序号恰好凑成完整 1..N 且覆盖全部棋子时的重建落子序列；否则 null。 */
  completeMoves: Array<Position & { player: Player; number: number }> | null;
  notes: string[];
}

interface RawPositionEntry { number: number | null; point: Position; player: Player | null }

/** 局面版文本兜底：从自由文本里扫「坐标(+颜色)」与「序号,坐标」两类片段。 */
function salvagePositionEntries(text: string, boardSize: number): RawPositionEntry[] {
  const entries: RawPositionEntry[] = [];
  for (const entry of salvageEntries(text, boardSize)) {
    const point = parseCoordToken(entry.coord, boardSize);
    if (point) entries.push({ number: entry.number, point, player: entry.player });
  }
  const seen = new Set(entries.map((entry) => `${entry.point.row},${entry.point.col}`));
  const bare = /([A-Ya-y]\s?\d{1,2})\s*[:：,，]?\s*(黑|白|[BWbw])?/g;
  for (const match of text.matchAll(bare)) {
    const coord = (match[1] ?? "").replace(/\s+/g, "");
    const point = parseCoordToken(coord, boardSize);
    if (!point) continue;
    const key = `${point.row},${point.col}`;
    if (seen.has(key)) continue;
    const flag = match[2] ?? "";
    const player: Player | null = flag === "白" || /^W$/i.test(flag) ? "white" : flag === "黑" || /^B$/i.test(flag) ? "black" : null;
    seen.add(key);
    entries.push({ number: null, point, player });
  }
  return entries;
}

/**
 * 解析「AI 辅助识别」的回复。与 parseMoveOrderReply 的差别：序号是可选信息，
 * 读不全/没序号也照样返回局面（这才是通用识谱）；只有序号凑成完整 1..N 且
 * 覆盖全部棋子时才升级成手序序列。颜色缺失按序号奇偶补；两者都缺的子超过
 * 1/4 判定整次不可信——错局面与对局面在叠图上都"像"渲染结果，只能这里把关。
 */
export function parsePositionReply(text: string, boardSize: number): AiPositionResult {
  const notes: string[] = [];
  const raw: RawPositionEntry[] = [];
  const json = extractJsonArray(text);
  if (json) {
    for (const item of json) {
      if (typeof item === "string") {
        const point = parseCoordToken(item, boardSize);
        if (point) raw.push({ number: null, point, player: null });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      const coord = entryCoord(value);
      const point = coord ? parseCoordToken(coord, boardSize) : null;
      if (!point) continue;
      const numberRaw = entryNumber(value);
      const number = Number.isInteger(numberRaw) && numberRaw > 0 ? numberRaw : null;
      raw.push({ number, point, player: playerToken(value.p ?? value.color ?? value["颜色"]) });
    }
  }
  if (raw.length === 0) {
    const salvaged = salvagePositionEntries(text, boardSize);
    if (salvaged.length > 0) notes.push("回复不是标准 JSON，已按文本兜底解析");
    raw.push(...salvaged);
  }
  if (raw.length === 0) throw new Error("AI 没有读出任何棋子（确认图里确实有棋盘，或换更清晰的图重试）");

  // 同格去重：模型把一子报两次时，保留带序号的那条。
  const byCell = new Map<string, RawPositionEntry>();
  let droppedDup = 0;
  for (const entry of raw) {
    const key = `${entry.point.row},${entry.point.col}`;
    const previous = byCell.get(key);
    if (previous) {
      droppedDup += 1;
      if (previous.number === null && entry.number !== null) byCell.set(key, entry);
      continue;
    }
    byCell.set(key, entry);
  }
  if (droppedDup > 0) notes.push(`合并了 ${droppedDup} 处重复坐标`);

  // 颜色：模型没给的按序号奇偶补（黑先行棋里奇数手=黑）；仍缺色超 1/4 判不可信。
  let colorless = 0;
  let parityFixed = 0;
  const stones: AiStoneEntry[] = [...byCell.values()].map((entry) => {
    let player = entry.player;
    if (!player && entry.number !== null) {
      player = entry.number % 2 === 1 ? "black" : "white";
      parityFixed += 1;
    }
    if (!player) colorless += 1;
    return { row: entry.point.row, col: entry.point.col, player: player ?? "black", number: entry.number };
  });
  if (colorless > 0 && colorless > Math.ceil(stones.length / 4)) {
    throw new Error(`AI 读出的棋子有 ${colorless} 颗颜色不明（黑白读不清），结果不可信，请换更清晰的图重试`);
  }
  if (colorless > 0) notes.push(`${colorless} 颗颜色不明已暂记为黑，请在叠图里核对`);
  else if (parityFixed > 0) notes.push(`${parityFixed} 颗颜色按序号奇偶补出`);

  // 序号恰好完整且覆盖全部棋子 → 升级成手序序列（颜色与「奇黑偶白」同口径校正）。
  let completeMoves: Array<Position & { player: Player; number: number }> | null = null;
  const numbered = stones.filter((stone) => stone.number !== null).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  if (stones.length > 0 && numbered.length === stones.length) {
    const sequence = numbered.map((stone) => ({ row: stone.row, col: stone.col, player: stone.player, number: stone.number as number }));
    const contiguous = sequence.every((move, index) => move.number === index + 1);
    const unique = new Set(sequence.map((move) => `${move.row},${move.col}`)).size === sequence.length;
    if (contiguous && unique) {
      completeMoves = sequence.map((move, index) => ({ row: move.row, col: move.col, number: move.number, player: index % 2 === 0 ? "black" : "white" }));
      notes.push("序号完整，已按图上序号重建手序");
    } else {
      notes.push("图上序号不连续，按静态局面处理（读到的序号标在叠图上供参考）");
    }
  }
  return { stones, completeMoves, notes };
}

/** AI 辅助识别主调用：图 → 局面（序号可选，完整则附手序序列）。 */
export async function recognizePositionViaAi(
  config: AiVisionConfig,
  imageSource: Blob | string,
  boardSize: number,
): Promise<AiPositionResult> {
  const dataUrl = await imageToModelDataUrl(imageSource);
  const reply = await askVisionModel(config, dataUrl, buildPositionPrompt(boardSize));
  return parsePositionReply(reply, boardSize);
}

/** 设置页「测试连接」：无图小请求，验证端点/Key/模型名三件是否对得上。 */
export async function testAiVisionConnection(config: AiVisionConfig): Promise<string> {
  const reply = await askVisionModel(config, null, "回复 OK 两个字母即可", { timeoutMs: 20000, maxTokens: 8 });
  return reply.trim().slice(0, 40);
}
