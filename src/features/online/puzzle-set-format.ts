/**
 * 题库文件格式的识别与规整。
 *
 * 本应用吃两种题库 JSON，靠**有没有 `mode` 字段**区分：
 *
 * 1. **本应用自己的格式**（`导入题库 JSON` 与题集导出都产出这种）：`{defaultSettings, puzzles:[{stones|blackStones/whiteStones, side, size, rule, title, comment, level}]}`。
 *    坐标写在 `size` 路坐标系里、没有 `mode` ⇒ **原样透传**，一个字都不改。
 * 2. **「摆棋小工具」（renjutool）那一套生态的格式**：每条带 `mode`（解题模式码）。
 *    实测口径（2026-09-16，61 个题集 7818 条样本）：
 *    - `mode` 决定这题能不能做：32/64/67/96/160/163–165 是「给局面、你走赢」，正是本应用做题模式的
 *      语义；192/193/194–211 是「找出某个点」的选点/选择题，答案是一组点位而不是一条胜线，
 *      本应用判不了对错 ⇒ 跳过并如实报数。
 *    - **坐标一律按 15 路写，与 `size` 无关**：六路题集声明 `size: 6` 却把坐标写到 `B15`，
 *      实测包围盒恰是 15 路棋盘的左下 6×6。直接按 `size` 解析会把整集坐标判成越界丢光。
 *    - `rule` 只有 `2`（有禁＝连珠）与 `0`（无禁）；映射成规则名，连珠禁手才会生效
 *      （`parsePuzzleRule` 刻意不猜数字编码，映射放在这一层做）。
 *
 * 这一段是**格式知识**，与「从哪个站点取」无关——站点可以换、可以自建，格式认得就行。
 */
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE, isSupportedBoardSize } from "../../game";

/** 来源自带的解题模式码（文档在 renjutool 的 `renjueditor/puzzleCoder.js` 里）。 */
export const PUZZLE_MODE_NAMES: Readonly<Record<number, string>> = {
  0: "习题封面",
  32: "VCF",
  64: "VCT",
  67: "三手胜",
  96: "自由对弈",
  160: "限珠",
  163: "三子五连",
  164: "四子五连",
  165: "五子五连",
  192: "选点题",
  193: "选择题",
};

/** 本应用能把「局面 + 行棋方」当题目做的模式；其余（封面 / 选点 / 选择题 / 找点）跳过。 */
export const PLAYABLE_PUZZLE_MODES: ReadonlyMap<number, string> = new Map([
  [32, "VCF"],
  [64, "VCT"],
  [67, "三手胜"],
  [96, "对弈局面"],
  [160, "限珠"],
  [163, "三子五连"],
  [164, "四子五连"],
  [165, "五子五连"],
]);

/** 「摆棋小工具」那套坐标一律写在 15 路坐标系里，与 `size` 无关。 */
const SOURCE_COORDINATE_SIZE = 15;

export interface NormalizedPuzzleSet {
  /** 可直接交给题库导入器的 JSON 文本。 */
  text: string;
  title: string;
  /** 文件里的条目总数。 */
  total: number;
  /** 规整后留下的题目数（透传时为条目总数）。 */
  puzzles: number;
  /** 因解题模式本应用做不了而跳过的数量。 */
  skipped: number;
  warnings: string[];
}

const asNumber = (value: unknown): number | undefined => {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
};
const asText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 一串连续坐标（`G12H12...`）→ 15 路坐标系的点位（行自下往上）。越界的挑出来报数。 */
const parseCoordinateSequence = (text: string, invalid: string[]) => {
  const points: Array<{ row: number; col: number }> = [];
  const pattern = /([A-Za-z])(\d{1,2})/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const col = match[1].toUpperCase().charCodeAt(0) - 65;
    const row = SOURCE_COORDINATE_SIZE - Number(match[2]);
    if (col < 0 || col >= SOURCE_COORDINATE_SIZE || row < 0 || row >= SOURCE_COORDINATE_SIZE) { invalid.push(match[0]); continue; }
    points.push({ row, col });
  }
  return points;
};

/** 把 15 路坐标系的点位换算成目标棋盘自己的写法，导入器按目标尺寸解析时能原样落回。 */
const coordinateAt = (point: { row: number; col: number }, size: number) => `${String.fromCharCode(65 + point.col)}${size - point.row}`;

/** 规整「摆棋小工具」格式的那一支。返回 null 表示这份文件不是那种格式（应原样透传）。 */
const normalizeModeFormat = (
  source: { defaultSettings?: unknown; puzzles: unknown[] },
  fallbackTitle: string,
  warnings: string[],
): { title: string; puzzles: Record<string, unknown>[]; total: number; skipped: number } | null => {
  const entries = source.puzzles;
  if (!entries.some((entry) => isObject(entry) && "mode" in entry)) return null;
  const defaults = isObject(source.defaultSettings) ? source.defaultSettings : {};
  const title = asText(defaults.title) || fallbackTitle;
  const puzzles: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const [index, raw] of entries.entries()) {
    if (!isObject(raw)) { skipped += 1; continue; }
    const mode = asNumber(raw.mode ?? defaults.mode);
    const modeName = mode === undefined ? undefined : PLAYABLE_PUZZLE_MODES.get(mode);
    if (modeName === undefined) { skipped += 1; continue; }

    const invalid: string[] = [];
    const sequence = typeof raw.stones === "string" ? raw.stones : "";
    const blackText = typeof raw.blackStones === "string" ? raw.blackStones : "";
    const whiteText = typeof raw.whiteStones === "string" ? raw.whiteStones : "";
    const sequencePoints = sequence ? parseCoordinateSequence(sequence, invalid) : [];
    const blackPoints = blackText ? parseCoordinateSequence(blackText, invalid) : [];
    const whitePoints = whiteText ? parseCoordinateSequence(whiteText, invalid) : [];
    if (invalid.length) warnings.push(`第 ${index + 1} 题跳过越界坐标 ${invalid.slice(0, 4).join("、")}${invalid.length > 4 ? " 等" : ""}`);
    const points = [...sequencePoints, ...blackPoints, ...whitePoints];
    if (!points.length) { skipped += 1; continue; }

    // 目标棋盘：声明的尺寸、坐标实际需要的尺寸、应用下限三者取大。六路题集声明 6 路而坐标写到
    // 15 路，取大后落回 6 路棋盘（坐标换算时一并平移），题目落在它应有的位置上。
    const declared = asNumber(raw.size ?? defaults.size);
    const required = points.reduce((max, point) => Math.max(max, point.row + 1, point.col + 1), MIN_BOARD_SIZE);
    const size = Math.min(MAX_BOARD_SIZE, Math.max(isSupportedBoardSize(declared ?? 0) ? declared! : MIN_BOARD_SIZE, required));
    if (declared !== undefined && size !== declared) warnings.push(`第 ${index + 1} 题来源记为 ${declared} 路，按坐标实际需要改为 ${size} 路`);

    const total = points.length;
    const sideRaw = asNumber(raw.side ?? defaults.side);
    // 黑先开局 ⇒ 偶数子轮到黑。样本里有 1 处 side=204 的脏数据，只有明确 1/2 才采信。
    const side = sideRaw === 1 || sideRaw === 2 ? sideRaw : total % 2 === 0 ? 1 : 2;
    const ruleRaw = asNumber(raw.rule ?? defaults.rule);
    const rule = ruleRaw === 0 ? "freestyle" : ruleRaw === 2 ? "renju" : undefined;
    const ownTitle = asText(raw.title);
    const level = asNumber(raw.level ?? defaults.level);
    puzzles.push({
      // 连续坐标串缺省表示「黑白交替、黑先」，与导入器读法一致，原样保留；分色写法才落成分色。
      ...(sequencePoints.length
        ? { stones: sequencePoints.map((point) => coordinateAt(point, size)).join("") }
        : {
          ...(blackPoints.length ? { blackStones: blackPoints.map((point) => coordinateAt(point, size)).join("") } : {}),
          ...(whitePoints.length ? { whiteStones: whitePoints.map((point) => coordinateAt(point, size)).join("") } : {}),
        }),
      side,
      size,
      mode,
      ...(rule ? { rule } : {}),
      // 题名带上题型：VCF / VCT / 三手胜 决定了「要找什么」，比「第 3 题」有用得多。
      title: ownTitle || `第 ${index + 1} 题（${modeName}）`,
      ...(asText(raw.comment) ? { comment: asText(raw.comment) } : {}),
      ...(level !== undefined ? { level } : {}),
    });
  }
  return { title, puzzles, total: entries.length, skipped };
};

/**
 * 认一份题集文本、必要时规整它。**不认识就原样交回**（本应用自己的格式绝不改动），
 * 真正的解析交给题库导入器一个人做。
 */
export const normalizePuzzleSet = (text: string, fallbackTitle: string): NormalizedPuzzleSet => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("题集不是合法的 JSON");
  }
  if (Array.isArray(raw)) {
    // 开宝「二维 JSON 题集」：顶层就是题目数组（README：「兼容开宝二维 JSON 题库：
    // 星级、空占位、A–O / 1–15 坐标和黑白尾码」）。这一支不是本函数的归整对象，
    // 按函数契约「不认识就原样交回」透传，交由 `importKaibaoPuzzleJson` 一个人解析。
    // 以前这里对数组直接抛「没有 puzzles 数组」，于是**本地导入一份开宝数组文件必失败**：
    // 导入器明明支持数组（puzzles.ts「题库 JSON 顶层需要题目数组」），却被这道前置
    // 校验挡死，本地与在线两条路径的行为也因此不一致。
    return { text, title: fallbackTitle, total: raw.length, puzzles: raw.length, skipped: 0, warnings: [] };
  }
  if (!isObject(raw) || !Array.isArray(raw.puzzles)) throw new Error("题集里没有 puzzles 数组（本应用题库与「摆棋小工具」格式都有这个字段）");
  const warnings: string[] = [];
  const normalized = normalizeModeFormat({ defaultSettings: raw.defaultSettings, puzzles: raw.puzzles as unknown[] }, fallbackTitle, warnings);
  if (!normalized) {
    const title = asText(isObject(raw.defaultSettings) ? raw.defaultSettings.title : "") || fallbackTitle;
    return { text, title, total: raw.puzzles.length, puzzles: raw.puzzles.length, skipped: 0, warnings };
  }
  if (!normalized.puzzles.length) throw new Error("这个题集里没有本应用能做的题目（可能整集都是选点/选择题模式）");
  return {
    text: JSON.stringify({ defaultSettings: { title: normalized.title }, puzzles: normalized.puzzles }),
    title: normalized.title,
    total: normalized.total,
    puzzles: normalized.puzzles.length,
    skipped: normalized.skipped,
    warnings: warnings.slice(0, 6),
  };
};
