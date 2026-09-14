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
 */
import type { GameDocument, RecordNode } from "./types";
import { encodeGbkString } from "./gbk-encoding";

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

export const exportLib = (document: GameDocument): LibExportResult => {
  const size = document.metadata.boardSize;
  if (size !== 15) {
    throw new Error(`LIB 是十五路连珠棋谱格式，当前棋谱为 ${size} 路，无法导出 LIB；请改用 SGF 或 JSON`);
  }
  const warnings: string[] = [];
  const { nodes } = document;
  const root = nodes[document.rootId];
  let structuralCount = 0;

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
    return result;
  };

  const rootLevel = flattenLevel([document.rootId]);
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
    const scanPass = (level: RecordNode[]): boolean => {
      for (const node of level) {
        if (node.passPlayer) return true;
        if (scanPass(flattenLevel(node.children))) return true;
      }
      return false;
    };
    if (scanPass(firstLevel.length ? firstLevel : rootLevel)) legacyFormat = false;
    const first = firstLevel[0];
    if (!first || !first.move || first.move.row !== 7 || first.move.col !== 7) legacyFormat = false;
  }

  const bytes: number[] = [
    0xff, 82, 101, 110, 76, 105, 98, 0xff, // "RenLib" marker
    3, legacyFormat ? 0 : 4, // major 3, minor 0 (legacy) or 4
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ];

  const writeText = (text: string) => {
    const encoded = encodeGbkString(text);
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
    if (info & FLAG_EXTENSION && node.boardText) writeText(node.boardText);
  };

  const nodeFlags = (node: RecordNode) => {
    let info = 0;
    if (!node.move && !node.passPlayer && !node.anchor) info |= FLAG_NO_MOVE;
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
  return { bytes: Uint8Array.from(bytes), warnings };
};

/** Piskvorky (.psq) main-line export: `x,y,player` lines under a header. */
export const exportPsq = (document: GameDocument): string => {
  const size = document.metadata.boardSize;
  const lines: string[] = [`Piskvorky ${size}x${size} , 0 - 0`];
  let node = document.nodes[document.rootId];
  while (node?.children.length) {
    const next = document.nodes[node.preferredChildId || node.children[0]];
    if (!next) break;
    if (next.move) lines.push(`${next.move.col},${size - next.move.row},${next.move.player === "black" ? "0" : "1"}`);
    node = next;
  }
  return `${lines.join("\r\n")}\r\n`;
};