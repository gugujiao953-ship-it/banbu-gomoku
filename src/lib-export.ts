/**
 * RenLib 3.4 (.lib) writer.
 *
 * The format is defined by the official RenLib C++ source (renju.net ReadLib):
 * a 20-byte header (`FF RenLib FF` + major 3 + minor 4 + ten reserved 0xFF
 * bytes) followed by a depth-first pre-order stream of two-byte node records
 * (`[pos][info]`, plus `[info2][info1]` when EXTENSION is set) with optional
 * GBK text payloads. The tree structure is carried by two structural bits:
 * 0x80 means another sibling of this node follows later in the stream, 0x40
 * means this node has no children. Readers rebuild the tree by pushing on 0x80
 * and popping on 0x40, so the writer must pair them exactly (every push has a
 * matching pop on the last node of the subtree).
 *
 * Position encoding is 16 * (row - 1) + col on a 15x15 board (1-based), so
 * this format is only available for fifteen-way records. Setup nodes have no
 * LIB equivalent and are lifted: their subtree is re-attached to the parent
 * level so the record stays readable.
 *
 * **Sibling order is not free.** The official reader inserts every child through
 * `RenLibDoc.addMove`, which keeps the down/right chain sorted by coordinate
 * (`PointToPos`, i.e. 16*row+col). A level written in any other order therefore
 * comes back reordered — verified against the real core, not inferred. This
 * writer emits each level in coordinate order so that "what we write" is exactly
 * "what the core reads back", and reporting when the source order had to change.
 *
 * **Do not re-derive the two structural bits from the official constant names.**
 * The official header names them DOWN=0x80 / RIGHT=0x40, which reads as
 * "0x80 = has a child" / "0x40 = return to parent" — that is NOT how this writer
 * pairs them (here 0x80 = a sibling follows, 0x40 = no children), and swapping
 * them to match the names produces a stream the official reader mis-parses.
 * The pairing below is validated by `qa/lib-reader-parity.mjs`, which round-trips
 * real shapes through the official RenLib core (lib2sgf) and compares the trees.
 */
import type { GameDocument, RecordNode } from "./types";
import { encodeGbkStringWithReport } from "./gbk-encoding";

export interface LibExportResult {
  bytes: Uint8Array<ArrayBuffer>;
  warnings: string[];
}

const FLAG_NO_MOVE = 0x02;
const FLAG_START = 0x04;
const FLAG_COMMENT = 0x08;
const FLAG_MARK = 0x10;
const FLAG_EXTENSION = 0x01;
const FLAG_HAS_NEXT_SIBLING = 0x80;
const FLAG_NO_CHILD = 0x40;

const posByte = (row: number, col: number) => 16 * row + col + 1;

/** 官方核心的 `readBoardText` 只取**前 4 个 GBK 字节**（实测「新标签」读回「新标」，
 *  而「要点」正好 4 字节完整保留）。所以写出时就在 4 字节上限内按**整字**截断：文件内容与
 *  任何读取器看到的完全一致，而且再次导出逐字节幂等（不截断的话，读回时被截断的文本会让
 *  第二遍导出与第一遍不同）。 */
const LIB_BOARD_TEXT_MAX_BYTES = 4;
const truncateBoardText = (text: string): { text: string; truncated: boolean } => {
  let kept = "";
  let used = 0;
  for (const character of text) {
    const size = encodeGbkStringWithReport(character).bytes.length;
    if (used + size > LIB_BOARD_TEXT_MAX_BYTES) return { text: kept, truncated: true };
    kept += character;
    used += size;
  }
  return { text: kept, truncated: false };
};

export const exportLib = (document: GameDocument): LibExportResult => {
  const size = document.metadata.boardSize;
  if (size !== 15) {
    throw new Error(`LIB 是十五路连珠棋谱格式，当前棋谱为 ${size} 路，无法导出 LIB；请改用 SGF 或 JSON`);
  }
  const warnings: string[] = [];
  const { nodes } = document;
  const root = nodes[document.rootId];
  let structuralCount = 0;
  let resortedLevels = 0;
  let replacedCharacters = 0;
  let truncatedLabels = 0;

  /** 官方读取器把同层子节点按坐标升序插入（RenLibDoc.addMove），所以 LIB 里的兄弟顺序
   *  永远是坐标序——写入顺序不影响读回顺序。这里就按坐标序输出，让「写出的文件」与
   *  「核心读回的文件」一致（导出→导入幂等），并在顺序被改动时如实计数。
   *  官方 addMove 对相同坐标是追加，等价于稳定排序，所以这里也用稳定排序。 */
  const orderKey = (node: RecordNode) => node.move
    ? posByte(node.move.row, node.move.col)
    : node.anchor ? posByte(node.anchor.row, node.anchor.col) : 0;

  /** Lift setup-only nodes: their subtree takes their place in the level. */
  const flattenLevel = (nodeIds: string[], countLifted = false): RecordNode[] => {
    const result: RecordNode[] = [];
    for (const id of nodeIds) {
      const node = nodes[id];
      if (!node) continue;
      const structural = Boolean(node.setup) && !node.anchor;
      if (structural) { if (countLifted) structuralCount += 1; result.push(...flattenLevel(node.children, countLifted)); }
      else result.push(node);
    }
    if (result.length < 2) return result;
    const sorted = [...result].sort((a, b) => orderKey(a) - orderKey(b));
    if (sorted.some((node, index) => node !== result[index])) resortedLevels += 1;
    return sorted;
  };

  /** 过手（pass）数。**这一族格式没有过手的写法，且这不是靠换位写法能绕开的**：
   *  实测（`.tmp-interop/probe-lib-pass-encoding.mjs`，拿官方核心当裁判）三种编码——
   *  空点且不设 NO_MOVE、空点且设 NO_MOVE、以及流里根本没有这个节点——读回结果**完全一样**：
   *  过手节点连同它上面的注释一起消失，而核心按交替重新推颜色，于是过手之后**所有**着法的
   *  黑白都会错位。所以只能如实告知，不能假装保住了。 */
  const countPasses = (ids: readonly string[]): number => ids.reduce((total, id) => {
    const node = nodes[id];
    return node ? total + (node.passPlayer ? 1 : 0) + countPasses(node.children) : total;
  }, 0);
  const passMoves = countPasses([document.rootId]);

  // 根节点也要计入 `countLifted`：根节点带摆局时它同样被"提升"掉（记录根本不写出），
  // 以前只对子层计数，于是根上的摆局**悄悄没了、连警告都不给**。
  const rootLifted = Boolean(root.setup) && !root.anchor;
  const rootLevel = flattenLevel([document.rootId], true);
  if (!rootLevel.length) throw new Error("棋谱为空，没有可导出的着法");
  const hasMoves = (level: RecordNode[]): boolean => level.some((node) => node.move || node.passPlayer || (node.children.length > 0 && hasMoves(flattenLevel(node.children))));
  if (!hasMoves(rootLevel)) {
    throw new Error("当前棋谱没有任何着法（可能是棋谱源文件没有打开成功），无法导出 LIB；请先确认棋盘上有棋子");
  }

  // Legacy 3.0 (the layout 爱五子棋/older RenLib writes) drops the root node
  // and starts the stream at a center first move; it also cannot carry pass
  // moves. The official writer picks it only when nothing is lost.
  let legacyFormat = !root.comment && !root.boardText && root.marks.length === 0 && !root.renLibMark && !root.startPosition && !root.anchor;
  const firstLevel = flattenLevel(root.children);
  if (legacyFormat) {
    // 过手只能存在于 3.4 布局（见上面 countPasses 的说明）。
    if (passMoves > 0) legacyFormat = false;
    const first = firstLevel[0];
    if (!first || !first.move || first.move.row !== 7 || first.move.col !== 7) legacyFormat = false;
  }

  const bytes: number[] = [
    0xff, 82, 101, 110, 76, 105, 98, 0xff, // "RenLib" marker
    3, legacyFormat ? 0 : 4, // major 3, minor 0 (legacy) or 4
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ];

  const writeText = (text: string) => {
    const { bytes: encoded, replaced } = encodeGbkStringWithReport(text);
    replacedCharacters += replaced;
    for (const byte of encoded) bytes.push(byte);
    bytes.push(0x00);
    // The official writer pads the payload (terminator included) to an even
    // byte length, independently of the stream position.
    if ((encoded.length + 1) % 2) bytes.push(0x00);
  };

  const writeNodeRecord = (node: RecordNode, info: number) => {
    if (node.move) bytes.push(posByte(node.move.row, node.move.col));
    else if (node.anchor) bytes.push(posByte(node.anchor.row, node.anchor.col));
    else bytes.push(0); // pass: null point with no NO_MOVE bit
    bytes.push(info);
    // The extension pair immediately follows the node header; official
    // WriteNode then writes the comment and finally the board text.
    if (info & FLAG_EXTENSION) {
      // info2/info1 order: BOARD_TEXT is 0x100, i.e. the second byte's bit 0.
      bytes.push(0x00, 0x01);
    }
    if (node.comment) writeText(node.comment);
    if (info & FLAG_EXTENSION && node.boardText) {
      const label = truncateBoardText(node.boardText);
      if (label.truncated) truncatedLabels += 1;
      if (label.text) writeText(label.text);
    }
  };

  const nodeFlags = (node: RecordNode) => {
    let info = 0;
    // **没有着法的节点就是"非着法节点"**（官方模型 `isMove() = !NO_MOVE`）。
    // 以前这里多一个 `&& !node.anchor`，于是带坐标的非着法节点（anchor：对局软件里
    // "在某个点上放标记"的表示法）被写成了一手棋——读回来就在棋盘上多一颗子。
    // 过手（passPlayer）例外：它是坐标 (0,0) 的**着法**（官方 `isPassMove()`），不能设 NO_MOVE。
    if (!node.move && !node.passPlayer) info |= FLAG_NO_MOVE;
    if (node.startPosition) info |= FLAG_START;
    if (node.comment) info |= FLAG_COMMENT;
    if (node.marks.length > 0 || node.renLibMark) info |= FLAG_MARK;
    if (node.boardText) info |= FLAG_EXTENSION;
    return info;
  };

  const emitLevel = (level: RecordNode[]) => {
    for (let index = 0; index < level.length; index += 1) {
      const node = level[index];
      const childLevel = flattenLevel(node.children, true);
      let info = nodeFlags(node);
      if (childLevel.length === 0) info |= FLAG_NO_CHILD;
      if (index + 1 < level.length) info |= FLAG_HAS_NEXT_SIBLING;
      writeNodeRecord(node, info);
      if (childLevel.length > 0) emitLevel(childLevel);
    }
  };

  // Legacy files start the stream at the center first move; the root record
  // and its structural bits appear only in the modern 3.4 layout.
  if (legacyFormat) emitLevel(firstLevel);
  else emitLevel(rootLevel);

  if (structuralCount > 0) {
    warnings.push(`${structuralCount} 个摆局面节点无法在 LIB 中表达，已把其子分支提升到上层（变化树保留，棋子布局丢失）`);
  }
  // 根节点被提升时，它自己带的「起始」标记也一起没了（起始标记只有根记录那一个位置可放）。
  if (rootLifted && root.startPosition) {
    warnings.push("棋谱根节点的「起始」标记随根节点一起未写出，需要保留请改用 SGF 或 JSON");
  }
  if (passMoves > 0) {
    warnings.push(`${passMoves} 处过手在 LIB 中无法表达：官方 RenLib 读取器会直接丢掉这一手，并且它之后所有着法的黑白会错位（过手本身占了一轮）。需要完整保留过手请改用 SGF 或 JSON`);
  }
  if (truncatedLabels > 0) {
    warnings.push(`${truncatedLabels} 处盘面文字超过 LIB 的 4 字节上限，已按整字截断（官方 RenLib 读取器也只读 4 字节）；需要完整文字请改用 SGF 或 JSON`);
  }
  if (replacedCharacters > 0) {
    warnings.push(`${replacedCharacters} 个字符无法用 GBK 表示（例如 emoji），已写成 ?；LIB 是 GBK 容器，这些字符需要改用 SGF 或 JSON 才能原样保留`);
  }
  if (resortedLevels > 0) {
    warnings.push(`${resortedLevels} 处分支按坐标重排（LIB 格式的兄弟顺序由坐标决定，官方 RenLib 读回时也是如此），主线请用「设为主线」另行标注`);
  }
  return { bytes: Uint8Array.from(bytes), warnings };
};

/**
 * Piskvorky (.psq) main-line export: `<x>,<y>,<player>` lines under a header.
 *
 * **列号 1 起算，行号也是（从下往上数，最下一行为 1）。** 这是 Piskvork 自己的写法——
 * Gomocup 的官方裁判就是 Piskvork：它八年的成绩存档里 15 路文件的列落在 1..13、20 路落在
 * 1..20，从不出现 0；把同一局棋的 .psq 与 .sgf 配对（首手天元）也能证实列 1 起算、行从下往上。
 * 此前本 writer 写 0 起算的列，Piskvork 读出来会整盘横移一列。
 * （弈心等工具的导出列是 0 起算，导入侧按边界自动判别，见 formats.ts 的 importPsq。）
 */
export const exportPsq = (document: GameDocument): string => {
  const size = document.metadata.boardSize;
  const lines: string[] = [`Piskvorky ${size}x${size} , 0 - 0`];
  let node = document.nodes[document.rootId];
  while (node?.children.length) {
    const next = document.nodes[node.preferredChildId || node.children[0]];
    if (!next) break;
    if (next.move) lines.push(`${next.move.col + 1},${size - next.move.row},${next.move.player === "black" ? "0" : "1"}`);
    node = next;
  }
  return `${lines.join("\r\n")}\r\n`;
};