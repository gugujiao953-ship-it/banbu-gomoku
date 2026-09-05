import { addMove, addMoveAs, coordinateName, createDocument, isSupportedBoardSize, otherPlayer, parseCoordinate, toggleMark } from "./game";
import type { BoardMark, CompactRenLibDraftNode, CompactRenLibIndex, GameDocument, ImportResult, NodeEvaluation, Player, Position, RecordNode } from "./types";
import { RenLibArrayBuilder, createLazyDocument } from "./compact-index";

interface SgfNode { props: Record<string, string[]>; children: SgfNode[] }

const readU32LE = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
const MAX_DP_DECODED_BYTES = Number.MAX_SAFE_INTEGER;
const appendLz4History = (dictionary: number[], block: Uint8Array) => {
  const keepFromDictionary = Math.max(0, 65536 - block.length);
  const history = keepFromDictionary ? dictionary.slice(-keepFromDictionary) : [];
  const blockStart = Math.max(0, block.length - 65536);
  for (let index = blockStart; index < block.length; index += 1) history.push(block[index]);
  return history.slice(-65536);
};

/** Minimal LZ4 block decoder used by the small DP/DB database adapter. */
const decodeLz4Block = (bytes: Uint8Array, dictionary: number[] = [], maximumOutput = MAX_DP_DECODED_BYTES) => {
  const history = dictionary.slice(-65536);
  const output: number[] = [...history];
  const historyLength = output.length;
  let offset = 0;
  while (offset < bytes.length) {
    const token = bytes[offset++];
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      let extra = 255;
      while (extra === 255) {
        if (offset >= bytes.length) throw new Error("DP 数据库的 LZ4 字面量长度不完整");
        extra = bytes[offset++]; literalLength += extra;
      }
    }
    if (offset + literalLength > bytes.length) throw new Error("DP 数据库的 LZ4 字面量不完整");
    if (output.length - historyLength + literalLength > maximumOutput) throw new Error("DP 数据库解压后超过当前设备可用内存");
    for (let index = 0; index < literalLength; index += 1) output.push(bytes[offset++]);
    if (offset >= bytes.length) break;
    if (offset + 1 >= bytes.length) throw new Error("DP 数据库的 LZ4 区块不完整");
    const distance = bytes[offset] | (bytes[offset + 1] << 8); offset += 2;
    if (!distance || distance > output.length) throw new Error("DP 数据库的 LZ4 回溯距离无效");
    let matchLength = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      let extra = 255;
      while (extra === 255) {
        if (offset >= bytes.length) throw new Error("DP 数据库的 LZ4 匹配长度不完整");
        extra = bytes[offset++]; matchLength += extra;
      }
    }
    if (output.length - historyLength + matchLength > maximumOutput) throw new Error("DP 数据库解压后超过当前设备可用内存");
    const start = output.length - distance;
    for (let index = 0; index < matchLength; index += 1) output.push(output[start + index]);
  }
  return { decoded: Uint8Array.from(output.slice(historyLength)), history: output.slice(-65536) };
};

export const decodeDpDatabaseFrame = (bytes: Uint8Array) => {
  if (bytes.length < 7 || readU32LE(bytes, 0) !== 0x184d2204) throw new Error("不是受支持的 Rapfi/DP LZ4 数据库；该文件可能属于其他软件的私有格式");
  const flags = bytes[4];
  if ((flags >>> 6) !== 1) throw new Error("DP 数据库使用了未知的 LZ4 版本");
  const independentBlocks = Boolean(flags & 0x20);
  const blockSizeCode = bytes[5] >>> 4;
  const maximumBlockSize = ({ 4: 64 * 1024, 5: 256 * 1024, 6: 1024 * 1024, 7: 4 * 1024 * 1024 } as Record<number, number>)[blockSizeCode];
  if (!maximumBlockSize) throw new Error("DP 数据库使用了无效的 LZ4 区块尺寸");
  const hasContentSize = Boolean(flags & 0x08), hasBlockChecksum = Boolean(flags & 0x10), hasContentChecksum = Boolean(flags & 0x04);
  let offset = 6;
  if (hasContentSize) offset += 8;
  if (flags & 0x01) offset += 4;
  offset += 1; // header checksum
  if (offset > bytes.length) throw new Error("DP 数据库的 LZ4 文件头不完整");
  const chunks: Uint8Array[] = [];
  let outputLength = 0;
  let dictionary: number[] = [];
  let ended = false;
  while (offset + 4 <= bytes.length) {
    const blockHeader = readU32LE(bytes, offset); offset += 4;
    if (blockHeader === 0) { ended = true; break; }
    const uncompressed = Boolean(blockHeader & 0x80000000);
    const blockLength = blockHeader & 0x7fffffff;
    if (!blockLength || offset + blockLength > bytes.length) throw new Error("DP 数据库的 LZ4 数据块不完整");
    if (blockLength > maximumBlockSize) throw new Error("DP 数据库的 LZ4 数据块超过声明上限");
    const block = bytes.subarray(offset, offset + blockLength); offset += blockLength;
    const blockDictionary = independentBlocks ? [] : dictionary;
    const remaining = MAX_DP_DECODED_BYTES - outputLength;
    if (remaining <= 0 || (uncompressed && block.length > remaining)) throw new Error("DP 数据库解压后超过当前设备可用内存");
    const decoded = uncompressed ? { decoded: block, history: appendLz4History(blockDictionary, block) } : decodeLz4Block(block, blockDictionary, Math.min(remaining, maximumBlockSize));
    chunks.push(decoded.decoded);
    outputLength += decoded.decoded.length;
    dictionary = decoded.history;
    if (hasBlockChecksum) {
      if (offset + 4 > bytes.length) throw new Error("DP 数据库缺少 LZ4 区块校验段");
      offset += 4;
    }
  }
  if (!ended) throw new Error("DP 数据库缺少 LZ4 结束标记");
  if (hasContentChecksum) {
    if (offset + 4 > bytes.length) throw new Error("DP 数据库缺少内容校验段");
    offset += 4;
  }
  const output = new Uint8Array(outputLength);
  let outputOffset = 0;
  for (const chunk of chunks) { output.set(chunk, outputOffset); outputOffset += chunk.length; }
  return output;
};

const dpCoordinate = (value: number) => value >= 49 && value <= 57 ? value - 49 : value >= 65 && value <= 70 ? value - 65 + 9 : -1;
const isDpCoordinate = (value: number) => dpCoordinate(value) >= 0;
// @BTXT@ uses the database reader's 1..9/A..F coordinate alphabet (77 is
// the centre point), while the binary position key stores zero-based bytes.
const dpTextCoordinate = (value: number) => value >= 49 && value <= 57 ? value - 48 : value >= 65 && value <= 70 ? value - 55 : -1;

export interface DpState {
  key: Uint8Array;
  record: Uint8Array;
  position: Uint8Array;
  sideToMove: 0 | 1;
  boardText: Array<{ position: Position; text: string }>;
  comment: string;
}

export interface DpPositionBranch {
  position: Position;
  label: string;
  state: DpState;
}

export interface DpPositionQuery {
  state?: DpState;
  comment: string;
  marks: BoardMark[];
  branches: DpPositionBranch[];
  canonicalTransform: number;
}

const dpKeyString = (key: Uint8Array) => Array.from(key).join(",");
export const dpPointTransform = (point: Position, trans: number, size = 15): Position => {
  let x = point.col, y = point.row;
  if (trans === 4) { y = size - 1 - y; }
  else if (trans > 4) { y = size - 1 - y; }
  const turns = trans === 4 ? 0 : trans > 4 ? trans - 4 : trans;
  for (let i = 0; i < turns; i += 1) [x, y] = [size - 1 - y, x];
  return { row: y, col: x };
};
const dpInversePointTransform = (point: Position, trans: number, size = 15): Position => {
  // Equivalent to Rapfi's undoTransPoint/normalizeCoord. Brute inversion over
  // the 15x15 board is deliberately avoided because this runs for every
  // visible annotation while navigating a large database.
  if (trans < 4) return dpPointTransform(point, (4 - trans) & 3, size);
  let x = point.col, y = point.row;
  const inverseTurns = (4 - (trans & 3)) & 3;
  for (let turn = 0; turn < inverseTurns; turn += 1) [x, y] = [size - 1 - y, x];
  y = size - 1 - y;
  return { row: y, col: x };
};
// The reference reader compares stone pairs numerically as (x*32 + y) — see
// Rapfi dbTypes.js compareStones. A lexicographic string compare ranks "10"
// before "2", so past column K it silently selects a different canonical
// transform and lookups miss records that exist in the database.
const dpStonesCompare = (left: number[], right: number[]) => {
  const pairs = Math.min(left.length, right.length);
  for (let index = 0; index < pairs; index += 2) {
    const lx = left[index] === 0xff ? -1 : left[index], ly = left[index + 1] === 0xff ? -1 : left[index + 1];
    const rx = right[index] === 0xff ? -1 : right[index], ry = right[index + 1] === 0xff ? -1 : right[index + 1];
    const diff = lx * 32 + ly - (rx * 32 + ry);
    if (diff !== 0) return diff;
  }
  return 0;
};
export const dpCanonicalKey = (position: Uint8Array, sideToMove: 0 | 1) => {
  let best: number[] = [0xffff, 0xffff];
  let bestTrans = 0;
  for (let trans = 0; trans < 8; trans += 1) {
    const transformed = dpTransformPosition(position, trans);
    const stones: number[] = [];
    // This order is part of the Rapfi database key format. The reference
    // reader scans x first, then y, and appends all black stones followed by
    // all white stones. Sorting by a different traversal order creates valid-
    // looking but unrelated parent keys after the opening moves.
    let blackCount = 0, whiteCount = 0;
    for (let x = 0; x < 15; x += 1) for (let y = 0; y < 15; y += 1) {
      const cell = transformed[y * 15 + x];
      if (cell === 1) { stones.push(x, y); blackCount += 1; }
      else if (cell === 2) whiteCount += 1;
    }
    for (let x = 0; x < 15; x += 1) for (let y = 0; y < 15; y += 1) {
      if (transformed[y * 15 + x] === 2) stones.push(x, y);
    }
    // Rapfi getStones pads the trailing side with pass markers (0xFF) when the
    // stone counts do not match the side to move. Harmless for standard
    // records, but part of the exact key the reference site looks up.
    const balance = blackCount - whiteCount;
    if (balance < sideToMove) for (let i = balance; i < sideToMove; i += 1) stones.push(0xff, 0xff);
    else if (balance > sideToMove) for (let i = balance; i > sideToMove; i -= 1) stones.push(0xff, 0xff);
    if (dpStonesCompare(stones, best) <= 0) { best = stones; bestTrans = trans; }
  }
  const key = new Uint8Array([2, 15, 15, ...(best.length === 2 && best[0] === 0xffff ? [] : best)]);
  return { key, trans: bestTrans };
};
const decodeDpLabel = (bytes: Uint8Array) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); }
  catch { return new TextDecoder("gb18030").decode(bytes).trim(); }
};

const parseDpRecordText = (text: Uint8Array) => {
  const marker = new TextEncoder().encode("@BTXT@");
  const markerAt = text.findIndex((value, index) => marker.every((v, i) => text[index + i] === v));
  if (markerAt < 0) return { boardText: [], comment: decodeDpLabel(text) };
  // Rapfi uses the last backspace as the separator.  Using the first one
  // truncates a valid annotation/comment when its payload contains 0x08.
  let end = -1;
  for (let index = markerAt + marker.length; index < text.length; index += 1) {
    if (text[index] === 8) end = index;
  }
  const boardEnd = end < 0 ? text.length : end;
  const boardText: Array<{ position: Position; text: string }> = [];
  let cursor = markerAt + marker.length;
  while (cursor + 1 < boardEnd) {
    if (!isDpCoordinate(text[cursor]) || !isDpCoordinate(text[cursor + 1])) { cursor += 1; continue; }
    const col = dpTextCoordinate(text[cursor++]), row = dpTextCoordinate(text[cursor++]);
    if (col < 0 || col >= 15 || row < 0 || row >= 15) { cursor += 1; continue; }
    const start = cursor;
    while (cursor < boardEnd && text[cursor] !== 0 && text[cursor] !== 10 && text[cursor] !== 13) cursor += 1;
    const value = decodeDpLabel(text.subarray(start, cursor));
    // An empty payload is still a native annotation point. Renjutool renders
    // it as a gray dot; dropping it here makes the first few positions look
    // as if half of the original annotations were missing.
    boardText.push({ position: { row, col }, text: value });
    while (cursor < boardEnd && (text[cursor] === 0 || text[cursor] === 10 || text[cursor] === 13)) cursor += 1;
  }
  const commentStart = end < 0 ? text.length : end + 1;
  return { boardText, comment: decodeDpLabel(text.subarray(commentStart)) };
};

export const parseDpDatabaseStates = (bytes: Uint8Array) => {
  if (bytes.length < 4) throw new Error("DP 数据库内容不完整");
  const count = readU32LE(bytes, 0); let offset = 4;
  const states = new Map<string, DpState>();
  for (let index = 0; index < count && offset + 2 <= bytes.length; index += 1) {
    const keyLength = bytes[offset] | (bytes[offset + 1] << 8); offset += 2;
    if (!keyLength || offset + keyLength + 2 > bytes.length) break;
    const key = bytes.slice(offset, offset + keyLength); offset += keyLength;
    const recordLength = bytes[offset] | (bytes[offset + 1] << 8); offset += 2;
    if (offset + recordLength > bytes.length) break;
    const record = bytes.slice(offset, offset + recordLength); offset += recordLength;
    if (key.length < 3 || key[0] !== 2 || key[1] !== 15 || key[2] !== 15) continue;
    const stones = key.slice(3); const position = new Uint8Array(225);
    const blackBytes = (((stones.length >>> 1) + 1) >>> 1) * 2;
    for (let i = 0; i + 1 < stones.length; i += 2) position[stones[i + 1] * 15 + stones[i]] = i < blackBytes ? 1 : 2;
    const black = position.filter((v) => v === 1).length, white = position.filter((v) => v === 2).length;
    const parsed = parseDpRecordText(record.slice(5));
    // DP position keys are already in the database's canonical coordinate
    // system. Keep the record and its annotation coordinates together; a
    // second canonicalization here can merge distinct records and associate
    // the wrong annotation set with a navigable path.
    states.set(dpKeyString(key), { key, record, position, sideToMove: (black === white ? 0 : 1), ...parsed });
  }
  return states;
};

const dpRecordDisplayLabel = (record: Uint8Array, sideToMove: 0 | 1) => {
  const label = record[0] || 0;
  const unsignedValue = (record[1] || 0) | ((record[2] || 0) << 8);
  const value = unsignedValue & 0x8000 ? unsignedValue - 0x10000 : unsignedValue;
  const bound = ((record[3] || 0) | ((record[4] || 0) << 8)) & 0x03;
  const mateInMaxPly = 30000 - 500;
  const matedInMaxPly = -30000 + 500;
  if (label > 0 && label < 0xff) {
    let text = String.fromCharCode(label);
    if (label === 119 || label === 108) {
      const mateValue = -value;
      if ((label === 119 && mateValue > mateInMaxPly) || (label === 108 && mateValue < matedInMaxPly)) {
        text += String(30000 - (-1) - (mateValue < 0 ? -mateValue : mateValue));
      } else {
        text += "*";
      }
    }
    return text.padStart(3, " ").toUpperCase();
  }
  if (label === 0xff && bound === 0b11) {
    const winRate = value >= mateInMaxPly ? 1 : value <= matedInMaxPly ? 0 : 1 / (1 + Math.exp(-(-value) / 200));
    return `${Math.floor(Math.max(0, Math.min(99, winRate * 100))).toString().padStart(2, " ")}%`;
  }
  return sideToMove === 0 ? "●" : "○";
};

const dpTransformPosition = (position: Uint8Array, trans: number) => {
  const transformed = new Uint8Array(225);
  for (let row = 0; row < 15; row += 1) for (let col = 0; col < 15; col += 1) {
    const point = dpPointTransform({ row, col }, trans);
    transformed[point.row * 15 + point.col] = position[row * 15 + col];
  }
  return transformed;
};

const dpPositionsEqual = (left: Uint8Array, right: Uint8Array) => {
  for (let index = 0; index < 225; index += 1) if (left[index] !== right[index]) return false;
  return true;
};

/** Rapfi-compatible current-position query. Unlike the legacy importer this
 * does not infer or materialize a game tree: every empty point is looked up
 * directly in the canonical database index, exactly as the reference worker's
 * getBranchNodes does. */
export const queryDpPosition = (states: Map<string, DpState>, position: Uint8Array, sideToMove: 0 | 1): DpPositionQuery => {
  const canonical = dpCanonicalKey(position, sideToMove);
  const state = states.get(dpKeyString(canonical.key));
  const nativeEntries = (state?.boardText || []).map((entry) => ({
    ...entry,
    position: dpInversePointTransform(entry.position, canonical.trans),
  }));
  // A DB record is stored in one canonical orientation, while the webpage
  // exposes every symmetry that is identical to the currently displayed
  // position.  Expand the annotation coordinates through exactly those
  // symmetries; otherwise only the canonical copies get text and the rest
  // degrade to the generic dot labels.
  const labelAt = new Map<string, string>();
  for (let trans = 0; trans < 8; trans += 1) {
    if (!dpPositionsEqual(dpTransformPosition(position, trans), position)) continue;
    for (const entry of nativeEntries) {
      const point = dpPointTransform(entry.position, trans);
      labelAt.set(`${point.row},${point.col}`, entry.text);
    }
  }
  const marks: BoardMark[] = nativeEntries
    .filter((entry) => !position[entry.position.row * 15 + entry.position.col] && Boolean(entry.text))
    .map((entry) => ({ ...entry.position, kind: "label", style: "text", label: entry.text, color: "#1d1c19", renLibNativeLabel: true }));
  const branches: DpPositionBranch[] = [];
  for (let index = 0; index < 225; index += 1) {
    if (position[index]) continue;
    const next = position.slice(); next[index] = sideToMove + 1;
    const childKey = dpCanonicalKey(next, (sideToMove ^ 1) as 0 | 1).key;
    const child = states.get(dpKeyString(childKey));
    if (!child) continue;
    const point = { row: Math.floor(index / 15), col: index % 15 };
    branches.push({ position: point, label: labelAt.get(`${point.row},${point.col}`) || dpRecordDisplayLabel(child.record, sideToMove), state: child });
  }
  return { state, comment: state?.comment || "", marks, branches, canonicalTransform: canonical.trans };
};

export const openDpDatabaseIndex = async (source: Blob) => parseDpDatabaseStates(decodeDpDatabaseFrame(new Uint8Array(await source.arrayBuffer())));

const decodeText = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  const sample = bytes.subarray(0, Math.min(bytes.length, 256));
  const evenZeros = sample.filter((byte, index) => index % 2 === 0 && byte === 0).length;
  const oddZeros = sample.filter((byte, index) => index % 2 === 1 && byte === 0).length;
  if (oddZeros > sample.length / 8 && oddZeros > evenZeros * 2) return new TextDecoder("utf-16le").decode(bytes);
  if (evenZeros > sample.length / 8 && evenZeros > oddZeros * 2) return new TextDecoder("utf-16be").decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("gb18030").decode(bytes); }
};

const normalizeLegacySgfMoveSeparators = (text: string) => {
  let normalized = "", inValue = false, escaped = false, nodeHasProperty = false, repaired = 0;
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (inValue) {
      normalized += char; index += 1;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "]") inValue = false;
      continue;
    }
    if (char === "[") { inValue = true; normalized += char; index += 1; continue; }
    if (char === ";" || char === "(") { nodeHasProperty = false; normalized += char; index += 1; continue; }
    if (char === ")") { nodeHasProperty = false; normalized += char; index += 1; continue; }
    if (/[A-Za-z0-9]/.test(char)) {
      let end = index + 1;
      while (/[A-Za-z0-9]/.test(text[end] ?? "")) end += 1;
      const key = text.slice(index, end);
      if ((key.toUpperCase() === "B" || key.toUpperCase() === "W") && nodeHasProperty) {
        normalized += ";"; nodeHasProperty = false; repaired += 1;
      }
      normalized += key; nodeHasProperty = true; index = end; continue;
    }
    normalized += char; index += 1;
  }
  return { text: normalized, repaired };
};

const parseSgfCollection = (text: string): SgfNode[] => {
  let index = 0;
  const skipSpace = () => { while (/\s/.test(text[index] ?? "")) index += 1; };
  const value = () => {
    index += 1; let result = "", closed = false;
    while (index < text.length) {
      const char = text[index++]; if (char === "]") { closed = true; break; }
      if (char === "\\" && index < text.length) { const escaped = text[index++]; if (escaped === "\r" && text[index] === "\n") index += 1; else if (escaped !== "\n") result += escaped; }
      else result += char;
    }
    if (!closed) throw new Error("SGF 属性值缺少结束括号 ]");
    return result;
  };
  const node = (): SgfNode => {
    index += 1; const props: Record<string, string[]> = {}; skipSpace();
    while (/[A-Za-z0-9]/.test(text[index] ?? "")) {
      let key = ""; while (/[A-Za-z0-9]/.test(text[index] ?? "")) key += text[index++].toUpperCase();
      skipSpace();
      if (text[index] !== "[") throw new Error(`SGF 属性 ${key} 缺少值`);
      props[key] = []; while (text[index] === "[") { props[key].push(value()); skipSpace(); }
    }
    return { props, children: [] };
  };
  const tree = (): SgfNode => {
    skipSpace(); if (text[index] !== "(") throw new Error("SGF 缺少游戏树起点"); index += 1; skipSpace();
    let root: SgfNode | null = null, tail: SgfNode | null = null;
    while (text[index] === ";") { const current = node(); if (!root) root = current; if (tail) tail.children.push(current); tail = current; skipSpace(); }
    while (text[index] === "(") { const child = tree(); tail?.children.push(child); skipSpace(); }
    if (text[index] !== ")") throw new Error("SGF 游戏树没有闭合"); index += 1;
    if (!root) throw new Error("SGF 中没有节点"); return root;
  };
  skipSpace();
  const trees: SgfNode[] = [];
  while (index < text.length) {
    if (text[index] !== "(") throw new Error("SGF 顶层包含无法识别的尾部内容");
    trees.push(tree()); skipSpace();
  }
  if (!trees.length) throw new Error("SGF 中没有游戏树");
  return trees;
};

const sgfPosition = (value?: string, size = 15): Position | null => {
  if (!value || value.length < 2) return null;
  const col = value.charCodeAt(0) - 97, row = value.charCodeAt(1) - 97;
  return row >= 0 && row < size && col >= 0 && col < size ? { row, col } : null;
};

const sgfPoints = (value: string, size = 15): Position[] => {
  const separator = value.indexOf(":");
  if (separator < 0) { const point = sgfPosition(value, size); return point ? [point] : []; }
  const start = sgfPosition(value.slice(0, separator), size), end = sgfPosition(value.slice(separator + 1), size);
  if (!start || !end) return [];
  const points: Position[] = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) points.push({ row, col });
  }
  return points;
};

const setupFromSgf = (props: Record<string, string[]>, size = 15) => {
  const readPoints = (key: "AB" | "AW" | "AE") => (props[key] || []).flatMap((value) => {
    const points = sgfPoints(value, size);
    if (!points.length) throw new Error(`SGF ${key} 含有无法识别的设置坐标：${value || "（空）"}`);
    return points;
  });
  if (props.PL?.[0] !== undefined && props.PL[0] !== "B" && props.PL[0] !== "W") throw new Error(`SGF PL 含有无效行棋方：${props.PL[0]}`);
  const setup = {
    black: readPoints("AB"),
    white: readPoints("AW"),
    empty: readPoints("AE"),
    nextPlayer: props.PL?.[0] === "W" ? "white" as const : props.PL?.[0] === "B" ? "black" as const : undefined,
  };
  const occupied = new Map<string, string>();
  for (const [kind, points] of [["AB", setup.black], ["AW", setup.white], ["AE", setup.empty]] as const) {
    for (const point of points) {
      const key = `${point.row},${point.col}`, previous = occupied.get(key);
      if (previous && previous !== kind) throw new Error(`SGF 设置局面在 ${key} 同时包含 ${previous}/${kind}`);
      occupied.set(key, kind);
    }
  }
  return setup.black.length || setup.white.length || setup.empty.length || setup.nextPlayer ? setup : undefined;
};

const hasProp = (props: Record<string, string[]>, key: string) => Object.prototype.hasOwnProperty.call(props, key);
const applySgfAnnotations = (node: RecordNode, props: Record<string, string[]>, warnings: string[], hasMove: boolean, size = 15) => {
  if (props.C?.[0] !== undefined) node.comment = props.C[0];
  if (props.N?.[0] !== undefined) node.boardText = props.N[0];
  const standard = (["TE", "BM", "DO", "IT"] as const).filter((key) => hasProp(props, key));
  const hasEvaluation = standard.length > 0 || hasProp(props, "XEV");
  if (hasEvaluation && !hasMove) warnings.push("忽略了无落子节点上的着法评价");
  if (hasEvaluation && hasMove) {
    if (standard.length > 1) warnings.push(`同一着法含有互斥评价 ${standard.join("/")}，已采用 ${standard[0]}`);
    const standardValue: NodeEvaluation | undefined = standard[0] === "TE" ? "good" : standard[0] === "BM" ? "bad" : standard[0] === "DO" ? "doubtful" : standard[0] === "IT" ? "interesting" : undefined;
    const custom = props.XEV?.[0] as NodeEvaluation | undefined;
    const validCustom = custom && ["good", "bad", "doubtful", "interesting", "forced", "only", "study"].includes(custom) ? custom : undefined;
    if (custom && !validCustom) warnings.push(`忽略了未知的 XEV 着法评价：${custom}`);
    if (standardValue && validCustom && standardValue !== validCustom) warnings.push(`标准评价与 XEV[${validCustom}] 冲突，已采用标准评价`);
    node.evaluation = standardValue || validCustom;
    if (standard[0] === "TE" || standard[0] === "BM") {
      const rawLevel = props[standard[0]]?.[0];
      node.evaluationLevel = rawLevel === "2" ? 2 : 1;
      if (rawLevel !== "1" && rawLevel !== "2") warnings.push(`${standard[0]}[${rawLevel || ""}] 已按一级评价读取`);
    } else node.evaluationLevel = undefined;
  }
  const markKeys = ["CR", "TR", "MA", "LB"];
  if (markKeys.some((key) => hasProp(props, key))) {
    const shapeMarks = [["CR", "circle"], ["TR", "triangle"], ["MA", "cross"]] as const;
    node.marks = shapeMarks.flatMap(([key, kind]) => (props[key] || [])
      .map((point) => sgfPosition(point, size))
      .filter((point): point is Position => Boolean(point))
      .map((point) => ({ ...point, kind })));
    node.marks = [...node.marks, ...(props.LB || []).flatMap((value) => {
      const separator = value.indexOf(":");
      const point = sgfPosition(separator >= 0 ? value.slice(0, separator) : value, size);
      return point ? [{ ...point, kind: "label" as const, label: separator >= 0 ? Array.from(value.slice(separator + 1)).slice(0, 4).join("") : "?" }] : [];
    })];
  }
};

const importSgfTree = (tree: SgfNode, fallbackTitle: string): { document: GameDocument; warnings: string[] } => {
  const rawSize = tree.props.SZ?.[0];
  const sizeParts = rawSize?.split(":") || [];
  const size = rawSize ? Number(sizeParts[0]) : 15;
  if (!isSupportedBoardSize(size) || (sizeParts[1] && Number(sizeParts[1]) !== size)) throw new Error(`不支持的 SGF 棋盘尺寸：SZ[${rawSize || "?"}]（支持 5-25 路方形棋盘）`);
  const warnings: string[] = [];
  if (!rawSize) warnings.push("SGF 未声明 SZ，已按十五路读取");
  const document = createDocument(tree.props.GN?.[0] || fallbackTitle, size);
  document.metadata.black = tree.props.PB?.[0] || "黑方"; document.metadata.white = tree.props.PW?.[0] || "白方";
  document.metadata.event = tree.props.EV?.[0] || ""; document.metadata.date = tree.props.DT?.[0] || document.metadata.date;
  document.metadata.result = tree.props.RE?.[0] || "";
  const rule = (tree.props.RU?.[0] || "").toLowerCase(); document.metadata.rule = rule.includes("free") ? "freestyle" : rule.includes("standard") ? "standard" : "renju";
  const appendNode = (parentId: string, source: SgfNode) => {
    const hasBlack = hasProp(source.props, "B"), hasWhite = hasProp(source.props, "W");
    if (hasBlack && hasWhite) throw new Error("SGF 同一节点不能同时包含黑白着法");
    const setup = setupFromSgf(source.props, size);
    if ((hasBlack || hasWhite) && setup) throw new Error("SGF 同一节点不能同时包含着法和设置局面属性");
    const player: Player | undefined = hasBlack ? "black" : hasWhite ? "white" : undefined;
    const moveValue = player ? (hasBlack ? source.props.B[0] : source.props.W[0]) : undefined;
    const position = moveValue ? sgfPosition(moveValue, size) : null;
    if (moveValue && !position) throw new Error(`SGF 含有无法识别的落子坐标：${moveValue}`);
    const id = `sgf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const node: RecordNode = {
      id, parentId, children: [], move: player && position ? { ...position, player } : null,
      passPlayer: player && moveValue === "" ? player : undefined, setup, comment: "", marks: [],
    };
    applySgfAnnotations(node, source.props, warnings, Boolean(player), size);
    document.nodes[id] = node;
    const parent = document.nodes[parentId]; parent.children.push(id); if (!parent.preferredChildId) parent.preferredChildId = id;
    source.children.forEach((child) => appendNode(id, child));
  };
  if (hasProp(tree.props, "B") || hasProp(tree.props, "W")) appendNode(document.rootId, tree);
  else {
    const root = document.nodes[document.rootId]; root.setup = setupFromSgf(tree.props, size);
    applySgfAnnotations(root, tree.props, warnings, false, size);
    tree.children.forEach((child) => appendNode(document.rootId, child));
  }
  document.updatedAt = new Date().toISOString();
  return { document, warnings };
};

const importSgf = (text: string): ImportResult => {
  const normalized = normalizeLegacySgfMoveSeparators(text);
  const trees = parseSgfCollection(normalized.text);
  const imported = trees.map((tree, index) => importSgfTree(tree, trees.length > 1 ? `导入棋谱（${index + 1}）` : "导入棋谱"));
  return {
    document: imported[0].document,
    additionalDocuments: imported.slice(1).map((item) => item.document),
    warnings: [
      ...(normalized.repaired ? [`SGF 有 ${normalized.repaired} 处连续落子缺少节点分号，已按 B/W 着法顺序兼容读取`] : []),
      ...imported.flatMap((item, index) => item.warnings.map((warning) => trees.length > 1 ? `第 ${index + 1} 盘：${warning}` : warning)),
    ],
    format: trees.length > 1 ? `SGF Collection (${trees.length})` : "SGF",
  };
};

const parsePosMoves = (text: string): Position[] => {
  const compact = text.replace(/[\uFEFF,;\s-]+/g, "");
  if (!compact || !/^(?:[a-oA-O](?:1[0-5]|[1-9]))+$/.test(compact)) return [];
  return [...compact.matchAll(/([a-oA-O])(1[0-5]|[1-9])/g)].map((match) => ({ col: match[1].toLowerCase().charCodeAt(0) - 97, row: 15 - Number(match[2]) }));
};
const importPos = (text: string, title: string): ImportResult => {
  let document = createDocument(title.replace(/\.[^.]+$/, "")), currentId = document.rootId; const warnings: string[] = [];
  for (const position of parsePosMoves(text)) {
    const added = addMove(document, currentId, position);
    if (!added.created) { warnings.push(`重复坐标已跳过：${String.fromCharCode(65 + position.col)}${15 - position.row}`); continue; }
    document = added.document; currentId = added.nodeId;
  }
  if (currentId === document.rootId) throw new Error("没有识别到 A1–O15 形式的落子序列");
  return { document, warnings, format: "POS/TXT" };
};

const importPsq = (text: string, filename: string): ImportResult => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = lines.shift()?.trim() || "";
  const match = /^Piskvorky\s+(\d+)x(\d+)\s*,/i.exec(header);
  if (!match) throw new Error("PSQ 文件头无效；应以 Piskvorky 宽x高 开头");
  const width = Number(match[1]), height = Number(match[2]);
  if (width !== height || !isSupportedBoardSize(width)) throw new Error(`不支持的 PSQ 棋盘尺寸：${width}x${height}（支持 5-25 路方形棋盘）`);
  const moveLines = lines.map((line, index) => ({ line: line.trim(), number: index + 2 })).filter((entry) => entry.line);
  if (!moveLines.length) throw new Error("PSQ 落子列表为空");
  let document = createDocument(filename.replace(/\.[^.]+$/, ""), width), currentId = document.rootId;
  for (let index = 0; index < moveLines.length; index += 1) {
    const entry = moveLines[index];
    const fields = /^(\d+)\s*,\s*(\d+)\s*,\s*([01])$/.exec(entry.line);
    if (!fields) throw new Error(`PSQ 第 ${entry.number} 行无法识别：${entry.line}`);
    const col = Number(fields[1]), rowFromBottom = Number(fields[2]);
    if (col < 0 || col >= width || rowFromBottom < 1 || rowFromBottom > height) throw new Error(`PSQ 第 ${index + 1} 手坐标越界：${col},${rowFromBottom}`);
    const position = { row: height - rowFromBottom, col };
    const player: Player = fields[3] === "0" ? "black" : "white";
    const added = addMoveAs(document, currentId, position, player);
    if (!added.created) throw new Error(`PSQ 第 ${index + 1} 手与已有棋子冲突：${col},${rowFromBottom}`);
    document = added.document; currentId = added.nodeId;
  }
  return { document, warnings: [], format: "PSQ (Piskvorky)" };
};

/** A byte reader that keeps the LIB import off the main thread without ever
 * materialising the whole file. RenLib records are always two-byte aligned,
 * but text payloads can be split across arbitrary Blob stream chunks. */
class RenLibByteReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunk: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private offset = 0;
  private eof = false;
  constructor(source: Blob) { this.reader = source.stream().getReader(); }
  setPrefix(prefix: Uint8Array<ArrayBufferLike>) { this.chunk = prefix; this.offset = 0; }
  private available() { return this.chunk.length - this.offset; }
  private async refill(minimum: number) {
    while (this.available() < minimum && !this.eof) {
      const next = await this.reader.read();
      if (next.done) { this.eof = true; break; }
      const remaining = this.chunk.subarray(this.offset);
      const merged = new Uint8Array(remaining.length + next.value.length);
      merged.set(remaining); merged.set(next.value, remaining.length);
      this.chunk = merged; this.offset = 0;
    }
  }
  readPair(): readonly [number, number] | null | Promise<readonly [number, number] | null> {
    if (this.available() >= 2) {
      const pair: readonly [number, number] = [this.chunk[this.offset], this.chunk[this.offset + 1]];
      this.offset += 2;
      return pair;
    }
    if (this.eof && this.available() < 2) return null;
    return this.refill(2).then(() => this.readPair() as readonly [number, number] | null);
  }
  async readUpTo(count: number) {
    const result: number[] = [];
    while (result.length < count) {
      if (this.available() === 0) await this.refill(1);
      if (this.available() === 0) break;
      const amount = Math.min(count - result.length, this.available());
      result.push(...this.chunk.subarray(this.offset, this.offset + amount));
      this.offset += amount;
    }
    return Uint8Array.from(result);
  }
}

const decodeRenLibText = (bytes: number[]) => {
  if (!bytes.length) return "";
  try { return new TextDecoder("gb18030").decode(Uint8Array.from(bytes)); }
  catch { return String.fromCharCode(...bytes); }
};

const decodeOldRenLibText = (bytes: number[]) => {
  const replacements: Record<number, string> = { 0x7d: "å", 0x7b: "ä", 0x7c: "ö", 0x5d: "Å", 0x5b: "Ä", 0x5c: "Ö" };
  return bytes.map((byte) => replacements[byte] || String.fromCharCode(byte)).join("");
};

const readRenLibNullText = async (reader: RenLibByteReader, oldFormat: boolean) => {
  const bytes: number[] = [];
  while (true) {
    const pending = reader.readPair();
    const pair = pending instanceof Promise ? await pending : pending;
    if (!pair) break;
    const [first, second] = pair;
    if (oldFormat) {
      bytes.push(first & 0x7f);
      if (first & 0x80) break;
      bytes.push(second & 0x7f);
      if (second & 0x80) break;
    } else {
      if (first === 0) break;
      bytes.push(first);
      if (second === 0) break;
      bytes.push(second);
    }
  }
  return oldFormat ? decodeOldRenLibText(bytes) : decodeRenLibText(bytes);
};

/**
 * RenLib is a compact depth-first stream, not a flat move list. The official
 * reader uses `DOWN` to push the current node and `RIGHT` to pop to its parent;
 * comments are old-format-first, and extension flags are stored one byte
 * higher than the two-byte extension pair appears on disk.
 */
export interface RenLibPreview { document: GameDocument; compactIndex: CompactRenLibIndex; stats: ImportResult["stats"] }
/**
 * Legacy eager parser retained only for comparison and migration tests.
 * Production .lib files are opened by RenLibWebViewSession instead.
 */
export const importRenLibLegacy = async (source: Blob, title: string, onPreview?: (preview: RenLibPreview) => Promise<void> | void): Promise<ImportResult> => {
  const reader = new RenLibByteReader(source);
  const header = await reader.readUpTo(20);
  const modernHeader = [0xff, 82, 101, 110, 76, 105, 98, 0xff];
  const isModern = header.length >= 20 && modernHeader.every((value, index) => header[index] === value);
  const warnings: string[] = [];
  if (isModern) {
    const major = header[8], minor = header[9];
    if (major * 100 + minor > 304) throw new Error(`暂不支持 RenLib ${major}.${minor}（当前最高支持 3.4）`);
  } else {
    if (header[0] !== 0x78) throw new Error("文件没有有效的 RenLib 头（FF RenLib FF）");
    warnings.push("这是旧版无头 RenLib 文件，已按兼容模式读取");
    reader.setPrefix(header);
  }

  const baseDocument = createDocument(title.replace(/\.[^.]+$/, ""));
  const arrays = new RenLibArrayBuilder(baseDocument.rootId);
  let parentId = 0;

  const branchStack: number[] = [];
  let firstRecord = true;
  let previewSent = false;
  let recordCount = 0;
  let moveCount = 0;
  let commentCount = 0;
  let boardTextCount = 0;
  let markedNodeCount = 0;
  let edgeCount = 0, branchCount = 0, maxChildren = 0, maxDepth = 0;
  while (true) {
    const pending = reader.readPair();
    const pair = pending instanceof Promise ? await pending : pending;
    if (!pair) break;
    const [positionByte, info] = pair;
    let extendedFlags = 0;
    if (info & 0x01) {
      const extension = await reader.readPair();
      if (!extension) break;
      // MoveNode::setExtendedInfo(info2, info1) stores the pair at bits 8..23.
      extendedFlags = (extension[0] << 16) | (extension[1] << 8);
    }

    const position = positionByte === 0 ? null : {
      col: (positionByte % 16) - 1,
      row: Math.floor(positionByte / 16),
    };
    const validPosition = position && position.col >= 0 && position.col < 15 && position.row >= 0 && position.row < 15;
    const isMove = (info & 0x02) === 0;
    let nodeId = parentId;
    if (!(firstRecord && !validPosition)) {
      if (!validPosition && position) {
        warnings.push(`跳过无效 RenLib 坐标字节：${positionByte}`);
      } else {
        const parentIndex = parentId;
        const player = arrays.nextPlayer(parentIndex);
        const move = isMove && validPosition; const code = validPosition ? position!.row * 16 + position!.col + 1 : 0;
        const state = move ? 1 | (player === "white" ? 2 : 0) : 0;
        const newIndex = arrays.addNode(parentIndex, move ? code : 0, state, validPosition ? code : 0);
        nodeId = newIndex;
        const children = arrays.appendChild(parentIndex, newIndex);
        edgeCount += 1; if (children === 2) branchCount += 1; maxChildren = Math.max(maxChildren, children);
        maxDepth = Math.max(maxDepth, arrays.depthAt(newIndex));
        if (move) moveCount += 1; recordCount += 1;
      }
    }
    firstRecord = false;
    if (nodeId < 0 || nodeId >= arrays.size) break;

    // RenLib 2.x/3.0 files may carry both bits; the official reader gives old
    // comments precedence, otherwise the payload gets consumed at the wrong
    // byte boundary and every following node becomes garbage.
    if (info & 0x20) {
      const text = await readRenLibNullText(reader, true); arrays.setText(nodeId, text); if (text) { arrays.addAnnotation(nodeId, { kind: "one-line-comment", text, encoding: "RenLib-old" }); commentCount += 1; }
    } else if (info & 0x08) {
      const text = await readRenLibNullText(reader, false); arrays.setText(nodeId, text); if (text) { arrays.addAnnotation(nodeId, { kind: "multi-line-comment", text, encoding: "GB18030" }); commentCount += 1; }
    }
    if (extendedFlags & 0x100) {
      const text = await readRenLibNullText(reader, false); arrays.setBoardText(nodeId, text); if (text) { arrays.addAnnotation(nodeId, { kind: "board-text", text, encoding: "GB18030" }); boardTextCount += 1; }
    }
    if (info & 0x10) { arrays.addState(nodeId, 4); arrays.addAnnotation(nodeId, { kind: "mark" }); markedNodeCount += 1; }
    if (info & 0x04) arrays.addState(nodeId, 8);
    arrays.setRenLibFlags(nodeId, info, extendedFlags);

    // The first usable prefix is enough for the existing UI to show the root,
    // initial line and early branches while the worker continues parsing.
    // Keep the preview small enough to structured-clone while the worker still
    // owns and grows the full parser columns. Cloning 250k nodes here doubled
    // peak memory and could crash the page when the final index was committed.
    if (!previewSent && recordCount >= 5000 && onPreview) {
      previewSent = true;
      const previewIndex = arrays.toIndex(baseDocument.rootId, `renlib-${baseDocument.id}`, false);
      const previewBase = { id: baseDocument.id, version: baseDocument.version, rootId: baseDocument.rootId, metadata: baseDocument.metadata, createdAt: baseDocument.createdAt, updatedAt: baseDocument.updatedAt };
      await onPreview({ document: createLazyDocument(previewBase, previewIndex), compactIndex: previewIndex, stats: { nodeCount: recordCount + 1, edgeCount, branchCount, maxChildren, maxDepth } });
    }

    // These two transitions intentionally are independent: a node may have a
    // sibling and also be the end of a branch (DOWN + RIGHT).
    if (info & 0x80) branchStack.push(nodeId);
    if (info & 0x40) {
      const branchNodeId = branchStack.pop();
      parentId = branchNodeId !== undefined ? arrays.parentAt(branchNodeId) : 0;
    } else {
      parentId = nodeId;
    }
  }

  if (!moveCount) throw new Error("RenLib 文件中没有可识别的落子");
  baseDocument.updatedAt = new Date().toISOString();
  if (commentCount) warnings.push(`已读取 ${commentCount} 个节点注释`);
  if (boardTextCount) warnings.push(`已读取 ${boardTextCount} 个节点文字`);
  if (markedNodeCount) warnings.push(`已读取 ${markedNodeCount} 个节点标记`);
  // Produce the compact representation at the parser boundary so workers do not
  // need to traverse/materialize the tree a second time.
  const compactIndex = arrays.toIndex(baseDocument.rootId, `renlib-${baseDocument.id}`);
  const stats = { nodeCount: recordCount + 1, edgeCount, branchCount, maxChildren, maxDepth };
  // V8 errors on > ~686k enumerable properties. Strip the object-tree nodes
  // when the caller already has a compact index, so the return value does not
  // trigger "Too many properties to enumerate" during construction.
  const base = { id: baseDocument.id, version: baseDocument.version, rootId: baseDocument.rootId, metadata: baseDocument.metadata, createdAt: baseDocument.createdAt, updatedAt: baseDocument.updatedAt };
  const lazyDocument = createLazyDocument(base, compactIndex);
  return { document: lazyDocument, compactIndex, warnings, format: "RenLib LIB", stats };
};

const validateJsonDocument = (value: unknown): GameDocument => {
  if (!value || typeof value !== "object") throw new Error("RENJU 文件不是有效对象");
  const document = value as GameDocument;
  if (document.version !== 1 || typeof document.id !== "string" || typeof document.rootId !== "string" || !document.nodes || typeof document.nodes !== "object") throw new Error("RENJU 文件缺少有效的版本、ID 或节点表");
  if (!document.metadata || typeof document.metadata.title !== "string" || typeof document.metadata.black !== "string" || typeof document.metadata.white !== "string" || !["renju", "standard", "freestyle"].includes(document.metadata.rule) || !isSupportedBoardSize(document.metadata.boardSize)) throw new Error("RENJU 文件的棋谱信息不完整或规则无效");
  if (typeof document.createdAt !== "string" || typeof document.updatedAt !== "string" || !Number.isFinite(Date.parse(document.createdAt)) || !Number.isFinite(Date.parse(document.updatedAt))) throw new Error("RENJU 文件的时间信息无效");
  const root = document.nodes[document.rootId];
  if (!root || root.parentId !== null || root.move !== null || root.passPlayer) throw new Error("RENJU 文件的根节点无效");
  const evaluationKinds: NodeEvaluation[] = ["good", "bad", "doubtful", "interesting", "forced", "only", "study"];
  Object.entries(document.nodes).forEach(([id, node]) => {
    if (!node || node.id !== id || !Array.isArray(node.children) || typeof node.comment !== "string" || !Array.isArray(node.marks)) throw new Error(`RENJU 节点 ${id} 结构无效`);
    if (node.parentId !== null && typeof node.parentId !== "string") throw new Error(`RENJU 节点 ${id} 的父节点无效`);
    const size = document.metadata.boardSize;
    if (node.move && (!Number.isInteger(node.move.row) || !Number.isInteger(node.move.col) || node.move.row < 0 || node.move.row >= size || node.move.col < 0 || node.move.col >= size || !["black", "white"].includes(node.move.player))) throw new Error(`RENJU 节点 ${id} 的落子无效`);
    if (node.passPlayer && !["black", "white"].includes(node.passPlayer)) throw new Error(`RENJU 节点 ${id} 的过手方无效`);
    if (node.move && node.passPlayer) throw new Error(`RENJU 节点 ${id} 不能同时包含落子和过手`);
    if (node.setup) {
      if (!Array.isArray(node.setup.black) || !Array.isArray(node.setup.white) || !Array.isArray(node.setup.empty)) throw new Error(`RENJU 节点 ${id} 的设置局面结构无效`);
      if (node.move || node.passPlayer) throw new Error(`RENJU 节点 ${id} 不能同时包含设置局面与着法`);
      const occupied = new Map<string, string>();
      for (const [kind, points] of [["black", node.setup.black], ["white", node.setup.white], ["empty", node.setup.empty]] as const) {
        for (const point of points) {
          const key = `${point.row},${point.col}`, previous = occupied.get(key);
          if (previous && previous !== kind) throw new Error(`RENJU 节点 ${id} 的设置局面在 ${key} 发生冲突`);
          occupied.set(key, kind);
        }
      }
      for (const point of [...node.setup.black, ...node.setup.white, ...node.setup.empty]) {
        if (!Number.isInteger(point.row) || !Number.isInteger(point.col) || point.row < 0 || point.row >= size || point.col < 0 || point.col >= size) throw new Error(`RENJU 节点 ${id} 的设置局面坐标无效`);
      }
      if (node.setup.nextPlayer && !["black", "white"].includes(node.setup.nextPlayer)) throw new Error(`RENJU 节点 ${id} 的设置行棋方无效`);
    }
    if (node.evaluation && !evaluationKinds.includes(node.evaluation)) throw new Error(`RENJU 节点 ${id} 的评价无效`);
    if (node.evaluationLevel && node.evaluationLevel !== 1 && node.evaluationLevel !== 2) throw new Error(`RENJU 节点 ${id} 的评价级别无效`);
    node.marks.forEach((mark) => {
      if (!Number.isInteger(mark.row) || !Number.isInteger(mark.col) || mark.row < 0 || mark.row >= size || mark.col < 0 || mark.col >= size || !["circle", "triangle", "cross", "label"].includes(mark.kind)) throw new Error(`RENJU 节点 ${id} 含有无效棋盘标记`);
    });
  });
  const visited = new Set<string>(), active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error("RENJU 节点树存在循环");
    if (visited.has(id)) throw new Error(`RENJU 节点 ${id} 被多个分支重复引用`);
    const node = document.nodes[id];
    if (!node) throw new Error(`RENJU 缺少节点 ${id}`);
    active.add(id); visited.add(id);
    node.children.forEach((childId) => {
      const child = document.nodes[childId];
      if (!child || child.parentId !== id) throw new Error(`RENJU 节点 ${childId} 的父子关系不一致`);
      visit(childId);
    });
    active.delete(id);
  };
  visit(document.rootId);
  if (visited.size !== Object.keys(document.nodes).length) throw new Error("RENJU 文件含有未连接到根节点的孤立节点");
  return document;
};

const importJsonMoveList = (value: unknown): ImportResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as { title?: unknown; boardSize?: unknown; coordinateBase?: unknown; moves?: unknown };
  if (!Array.isArray(source.moves)) return null;
  const size = source.boardSize === undefined ? 15 : Number(source.boardSize);
  if (!isSupportedBoardSize(size)) throw new Error(`不支持的棋盘尺寸：boardSize=${source.boardSize}`);
  let document = createDocument(typeof source.title === "string" ? source.title : "JSON 落子列表", size), currentId = document.rootId;
  const warnings: string[] = [];
  source.moves.forEach((raw, index) => {
    let position: Position | null = null, player: Player | undefined;
    if (typeof raw === "string") position = parseCoordinate(raw, size);
    else if (raw && typeof raw === "object") {
      const move = raw as Record<string, unknown>;
      if (typeof move.coordinate === "string") position = parseCoordinate(move.coordinate, size);
      else {
        if (source.coordinateBase !== 0 && source.coordinateBase !== 1) throw new Error("数字坐标 JSON 必须声明 coordinateBase 为 0 或 1");
        const row = typeof move.row === "number" ? move.row : move.y, col = typeof move.col === "number" ? move.col : move.x;
        if (typeof row === "number" && typeof col === "number") position = { row: row - Number(source.coordinateBase), col: col - Number(source.coordinateBase) };
      }
      const rawPlayer = move.player ?? move.color;
      if (["black", "b", "B", 1].includes(rawPlayer as never)) player = "black";
      if (["white", "w", "W", 2].includes(rawPlayer as never)) player = "white";
    }
    if (!position || !Number.isInteger(position.row) || !Number.isInteger(position.col) || position.row < 0 || position.row >= size || position.col < 0 || position.col >= size) throw new Error(`JSON 第 ${index + 1} 手坐标无效`);
    const added = player ? addMoveAs(document, currentId, position, player) : addMove(document, currentId, position);
    if (!added.created) throw new Error(`JSON 第 ${index + 1} 手与已有棋子冲突`);
    document = added.document; currentId = added.nodeId;
    if (!player && raw && typeof raw === "object" && ("player" in raw || "color" in raw)) warnings.push(`第 ${index + 1} 手颜色无法识别，已按轮次处理`);
  });
  if (!source.moves.length) throw new Error("JSON 落子列表为空");
  return { document, warnings, format: "JSON Move List" };
};

const hasBytes = (buffer: ArrayBuffer, values: number[]) => {
  const bytes = new Uint8Array(buffer, 0, Math.min(values.length, buffer.byteLength));
  return values.every((value, index) => bytes[index] === value);
};

export const importRecordFile = async (file: File, _options?: { onPreview?: (preview: RenLibPreview) => Promise<void> | void }): Promise<ImportResult> => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (extension === "db" || extension === "dp") {
    throw new Error("真实 .db/.dp 数据库必须通过动态局面查询会话打开");
  }
  if (extension === "lib") {
    const prefix = await file.slice(0, 8).arrayBuffer();
    if (hasBytes(prefix, [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a])) throw new Error("该 .lib 文件是 ar 静态库，不是 RenLib 棋谱");
    if (!hasBytes(prefix, [0xff, 0x52, 0x65, 0x6e, 0x4c, 0x69, 0x62, 0xff]) && new Uint8Array(prefix)[0] !== 0x78) throw new Error("该 .lib 文件不是可识别的 RenLib 棋谱（未找到 FF RenLib FF 头）");
    throw new Error("真实 .lib 棋谱必须通过网页 RenLib 动态查询会话打开");
  }
  const buffer = await file.arrayBuffer();
  const text = decodeText(buffer);
  const trimmed = text.trimStart();
  if (extension === "renju" || extension === "json") {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error(`${extension.toUpperCase()} 文件内容不是有效 JSON`); }
    if (extension === "renju") return { document: validateJsonDocument(parsed), warnings: [], format: "RENJU JSON" };
    try { return { document: validateJsonDocument(parsed), warnings: [], format: "RENJU JSON" }; }
    catch (nativeError) {
      const adapted = importJsonMoveList(parsed); if (adapted) return adapted;
      if (Array.isArray(parsed)) throw new Error("JSON 数组不是可确认的棋谱格式；题集请在题库页面导入");
      throw nativeError;
    }
  }
  if (["sgf", "fgf", "ren", "renjs", "wzq"].includes(extension) || trimmed.startsWith("(")) return importSgf(text);
  if (extension === "psq" || /^Piskvorky\s+\d+x\d+\s*,/i.test(trimmed)) return importPsq(text, file.name);
  if (!["pos", "txt", ""].includes(extension)) throw new Error(`不支持 .${extension} 格式；请使用 SGF、PSQ、LIB、RENJU JSON、POS 或 TXT`);
  return importPos(text, file.name);
};

const escapeSgf = (value: string) => value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
const escapeSgfSimpleText = (value: string) => escapeSgf(value.replace(/[\t\r\n ]+/g, " ").trim());
const toSgfCoord = ({ row, col }: Position) => `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`;
const evaluationSgf = (node: RecordNode) => {
  if (!(node.move || node.passPlayer) || !node.evaluation) return "";
  const level = node.evaluationLevel === 2 ? 2 : 1;
  if (node.evaluation === "good") return `TE[${level}]`;
  if (node.evaluation === "bad") return `BM[${level}]`;
  if (node.evaluation === "doubtful") return "DO[]";
  if (node.evaluation === "interesting") return "IT[]";
  return `XEV[${node.evaluation}]`;
};
const setupSgf = (node: RecordNode) => {
  if (!node.setup) return "";
  const points = (key: "AB" | "AW" | "AE", values: Position[]) => values.length ? `${key}${values.map((point) => `[${toSgfCoord(point)}]`).join("")}` : "";
  const player = node.setup.nextPlayer ? `PL[${node.setup.nextPlayer === "black" ? "B" : "W"}]` : "";
  return `${points("AB", node.setup.black)}${points("AW", node.setup.white)}${points("AE", node.setup.empty)}${player}`;
};
const annotationSgf = (node: RecordNode) => {
  const comment = node.comment ? `C[${escapeSgf(node.comment)}]` : "";
  const boardText = node.boardText ? `N[${escapeSgfSimpleText(node.boardText)}]` : "";
  const marks = node.marks.map((mark) => mark.kind === "label" ? `LB[${toSgfCoord(mark)}:${escapeSgf(mark.label || "?")}]` : `${mark.kind === "circle" ? "CR" : mark.kind === "triangle" ? "TR" : "MA"}[${toSgfCoord(mark)}]`).join("");
  return `${boardText}${comment}${evaluationSgf(node)}${marks}`;
};
export const exportSgf = (document: GameDocument) => {
  const nodeText = (node: RecordNode): string => {
    const move = node.move
      ? `${node.move.player === "black" ? "B" : "W"}[${toSgfCoord(node.move)}]`
      : node.passPlayer ? `${node.passPlayer === "black" ? "B" : "W"}[]` : "";
    const children = node.children.map((id) => document.nodes[id]).filter(Boolean);
    const own = `;${move}${setupSgf(node)}${annotationSgf(node)}`;
    return children.length <= 1 ? `${own}${children[0] ? nodeText(children[0]) : ""}` : `${own}${children.map((child) => `(${nodeText(child)})`).join("")}`;
  };
  const meta = document.metadata, root = document.nodes[document.rootId];
  const props = `(;GM[4]FF[4]CA[UTF-8]AP[RenjuNote:1.0]SZ[${meta.boardSize}]GN[${escapeSgf(meta.title)}]PB[${escapeSgf(meta.black)}]PW[${escapeSgf(meta.white)}]DT[${escapeSgf(meta.date)}]EV[${escapeSgf(meta.event)}]RE[${escapeSgf(meta.result)}]RU[${meta.rule}]${setupSgf(root)}${annotationSgf(root)}`;
  const children = root.children.map((id) => document.nodes[id]).filter(Boolean);
  return `${props}${children.length <= 1 ? (children[0] ? nodeText(children[0]) : "") : children.map((child) => `(${nodeText(child)})`).join("")})`;
};
export const exportJson = (document: GameDocument) => JSON.stringify(document, null, 2);
/** Deliberately simple interchange format: the preferred main line only.
 * It must never pretend to preserve branches or annotations. */
export const exportPos = (document: GameDocument) => {
  const result: string[] = [];
  let node = document.nodes[document.rootId];
  while (node?.children.length) {
    const next = document.nodes[node.preferredChildId || node.children[0]];
    if (!next) break;
    if (next.move) result.push(coordinateName(next.move, document.metadata.boardSize));
    else if (next.passPlayer) result.push("pass");
    node = next;
  }
  return result.length ? `${result.join(" ")}\n` : "";
};
export const downloadFile = (content: BlobPart, filename: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const downloadText = downloadFile;
export const mainLineLength = (document: GameDocument) => {
  let count = 0, node = document.nodes[document.rootId];
  while (node?.children.length) { node = document.nodes[node.preferredChildId || node.children[0]]; if (node?.move || node?.passPlayer) count += 1; }
  return count;
};
