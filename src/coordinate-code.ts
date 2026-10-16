import { addMove, coordinateName, createDocument, isSupportedBoardSize } from "./game";
import type { GameDocument, Player, Position, RecordNode } from "./types";

/**
 * 「坐标代码」：一串坐标 ↔ 棋谱主线。
 *
 * 口径与「五子棋小工具」（renjutool）一致：**字母 + 数字，列自左起 A 起算、行自下起算**
 * （15 路的 `H8` 就是本应用 `coordinateName` 的写法），也就是 POS / TXT 那一套。
 *
 * 与 `formats.ts` 的 POS 导入相比，这里刻意更宽容——用户是从网页、聊天或截图旁白里
 * **复制**过来的，常带手数、颜色标记、全角字符和各种分隔符：
 *
 *   `H8 I9 H10` · `h8i9h10` · `1.H8 2.I9` · `黑 H8 白 I9` · `H8,I9;H10` · `8H 9I`
 *
 * 宽容的边界是**如实报数**：读不懂的片段、越界的坐标、重复的点都跳过并写进 warnings。
 * 静默少一颗子比报一句错难发现得多——棋谱少一子仍然"看起来正常"。
 */

export const COORDINATE_CODE_TITLE = "坐标代码";

/** 全角 → 半角（含全角字母、数字与标点）：中文输入法下复制出来的代码几乎都是全角。 */
const FULL_WIDTH = /[\uFF01-\uFF5E]/g;
const SEPARATORS = /[\s,;、|/\\→>+()（）\[\]【】{}"'`_\-–—]+/;
const LETTER_FIRST = /^([a-z]{1,2})(\d{1,2})$/;
const DIGIT_FIRST = /^(\d{1,2})([a-z]{1,2})$/;
const COMPACT_RUN = /^(?:[a-z]{1,2}\d{1,2})+$/;
const COMPACT_PARTS = /[a-z]{1,2}\d{1,2}/g;
/** 颜色标记：只认单独成词的形式（`B H8`），因为 `B8` 本身就是坐标。 */
const COLOR_WORDS: Readonly<Record<string, Player>> = { 黑: "black", "●": "black", b: "black", 白: "white", "○": "white", w: "white" };
const SAMPLE_LIMIT = 3;

const normalizeCode = (raw: string) => raw
  .replace(/\uFEFF/g, "")
  .replace(FULL_WIDTH, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
  .replace(/[\u3000\u00A0]/g, " ")
  // 手数前缀：带括号的 `(3)` 单独处理（括号本身没有歧义）。
  .replace(/[（(\[]\s*\d{1,3}\s*[)）\]]/g, " ")
  // 裸手数前缀：`1.`、`2、`、`3:`。两处限制缺一不可——
  // ① 数字前面不能紧挨字母数字（否则 `H8、I9` 里的 `8、` 会被当成手数前缀，
  //    把坐标劈成 `h` + `i9`；顿号同时也是分隔符，这个坑实测踩过）；
  // ② 后面必须紧跟坐标字母（`1.` 单写不算前缀）。
  .replace(/(^|[^a-z0-9])\d{1,3}\s*[.、:：]\s*(?=[a-z])/gi, "$1 ")
  .toLowerCase();

export interface CoordinateCodeParse {
  positions: Position[];
  warnings: string[];
  /** 被跳过的片段总数（看不懂 + 越界 + 重复）。 */
  skipped: number;
  /** 代码里出现的颜色标记个数；>0 时已与黑白交替核对过。 */
  colorMarkers: number;
}

export const parseCoordinateCode = (raw: string, boardSize: number): CoordinateCodeParse => {
  if (!isSupportedBoardSize(boardSize)) {
    return { positions: [], warnings: [`棋盘路数 ${boardSize} 不在 5–30 路范围内`], skipped: 0, colorMarkers: 0 };
  }
  const text = normalizeCode(raw);
  const positions: Position[] = [];
  const seen = new Set<number>();
  const unknown: string[] = [], outOfRange: string[] = [], duplicates: string[] = [];
  let unknownCount = 0, rangeCount = 0, duplicateCount = 0, colorMarkers = 0, colorMismatch = 0;
  let pendingColor: Player | null = null;

  const accept = (col: number, row: number, label: string) => {
    const key = row * boardSize + col;
    if (seen.has(key)) {
      duplicateCount += 1;
      if (duplicates.length < SAMPLE_LIMIT) duplicates.push(label);
      return;
    }
    seen.add(key);
    if (pendingColor) {
      // 颜色标记只用于核对：棋谱的手数颜色永远按落子顺序交替，代码说了不算。
      colorMarkers += 1;
      if (pendingColor !== (positions.length % 2 === 0 ? "black" : "white")) colorMismatch += 1;
      pendingColor = null;
    }
    positions.push({ row, col });
  };

  const acceptToken = (token: string): boolean => {
    const letterFirst = LETTER_FIRST.exec(token);
    const digitFirst = letterFirst ? null : DIGIT_FIRST.exec(token);
    if (!letterFirst && !digitFirst) return false;
    const letter = letterFirst ? letterFirst[1] : digitFirst![2];
    const number = Number(letterFirst ? letterFirst[2] : digitFirst![1]);
    const col = [...letter].reduce((n, char) => n * 26 + char.charCodeAt(0) - 96, 0) - 1;
    if (col >= boardSize || number < 1 || number > boardSize) {
      rangeCount += 1;
      if (outOfRange.length < SAMPLE_LIMIT) outOfRange.push(token);
      pendingColor = null;
      return true;
    }
    const row = boardSize - number;
    accept(col, row, coordinateName({ row, col }, boardSize));
    return true;
  };

  for (const token of text.split(SEPARATORS)) {
    if (!token) continue;
    const color = COLOR_WORDS[token];
    if (color) { pendingColor = color; continue; }
    if (acceptToken(token)) continue;
    if (COMPACT_RUN.test(token)) {
      let matched = false;
      for (const part of token.match(COMPACT_PARTS) || []) matched = acceptToken(part) || matched;
      if (matched) continue;
    }
    unknownCount += 1;
    if (unknown.length < SAMPLE_LIMIT) unknown.push(token);
  }

  const warnings: string[] = [];
  const sample = (items: string[]) => `${items.join("、")}${items.length >= SAMPLE_LIMIT ? " 等" : ""}`;
  if (rangeCount) warnings.push(`有 ${rangeCount} 个坐标超出 ${boardSize} 路范围，已跳过（如 ${sample(outOfRange)}）；如果代码本来不是 ${boardSize} 路，请先改上面的路数`);
  if (duplicateCount) warnings.push(`有 ${duplicateCount} 个重复坐标已跳过（如 ${sample(duplicates)}）`);
  if (unknownCount) warnings.push(`有 ${unknownCount} 处内容看不懂，已跳过（如 ${sample(unknown)}）`);
  if (colorMismatch) warnings.push(`代码里的颜色标记与黑白交替有 ${colorMismatch} 处不一致，已按落子顺序交替上色`);

  return { positions, warnings, skipped: unknownCount + rangeCount + duplicateCount, colorMarkers };
};

/** 棋谱主线 → 坐标代码。与 `exportPos` 同口径：只写主线、跳过过手、空格分隔。 */
export const formatCoordinateCode = (document: GameDocument): string => {
  const moves: string[] = [];
  // 刻意不写显式类型：与 `formats.ts` 的 exportPos 一样靠推断，写了 `RecordNode | undefined`
  // 反而让 TS 在 `next` 上绕成自引用（TS7022）。
  let node = document.nodes[document.rootId];
  while (node?.children.length) {
    const next = document.nodes[node.preferredChildId || node.children[0]];
    if (!next) break;
    if (next.move) moves.push(coordinateName(next.move, document.metadata.boardSize));
    node = next;
  }
  return moves.join(" ");
};

/** 一个节点「一共几支可以走」：已加载的孩子 + 懒加载源里还没读回来的分支。
 *
 *  为什么要把 `unloadedChildren` 算进去（2026-10-10 排查）：DP/DB 局面库与 RenLib 网页
 *  核心读的 .lib，文档只是**投影**——没问过的分支只记数量、没有节点。旧实现只看
 *  `children.length`，于是「库里 11 支、已加载 0 支」的局面会报 **0 处分支**，
 *  而棋盘与树上明明写着「还有 11 支未加载」。复制坐标代码的取舍说明也照这个数算，
 *  会少报「丢了哪些」。 */
export const branchCountOf = (node: RecordNode | undefined): number =>
  node ? node.children.length + Math.max(0, node.unloadedChildren || 0) : 0;

/** 主线上的分支点数量：坐标代码只承载主线，复制时要如实告诉用户丢了什么。 */
export const mainLineBranchCount = (document: GameDocument): number => {
  let count = 0;
  let node: RecordNode | undefined = document.nodes[document.rootId];
  while (node && branchCountOf(node) > 0) {
    if (branchCountOf(node) > 1) count += 1;
    // 走到「后面还有没加载的」就停：再往下的主线在库里，本地无从得知
    const next: RecordNode | undefined = document.nodes[node.preferredChildId || node.children[0] || ""];
    if (!next) break;
    node = next;
  }
  return count;
};

/** 主线最后一手的节点 id：粘贴坐标后直接停在这里，用户一眼看到局面而不是空盘。 */
export const mainLineEndId = (document: GameDocument): string => {
  let nodeId = document.rootId;
  let node: RecordNode | undefined = document.nodes[nodeId];
  while (node?.children.length) {
    const next: RecordNode | undefined = document.nodes[node.preferredChildId || node.children[0]];
    if (!next) break;
    nodeId = next.id;
    node = next;
  }
  return nodeId;
};

/** 坐标序列 → 棋谱（按落子顺序交替黑白，从黑开始）。 */
export const buildDocumentFromCoordinateCode = (positions: Position[], boardSize: number, title = COORDINATE_CODE_TITLE): GameDocument => {
  let document = createDocument(title, boardSize);
  let currentId = document.rootId;
  for (const position of positions) {
    // addMove 是不可变式：每次返回新文档，循环必须把它带下去（照搬识谱那条路径的教训）。
    const added = addMove(document, currentId, position);
    if (!added.created) continue;
    document = added.document;
    currentId = added.nodeId;
  }
  return document;
};
