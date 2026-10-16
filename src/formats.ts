import { addMove, addMoveAs, coordinateName, createDocument, isSupportedBoardSize, otherPlayer, parseCoordinate, toggleMark } from "./game";
import type { BoardMark, BoardMarkKind, BoardMarkStyle, CompactRenLibDraftNode, CompactRenLibIndex, GameDocument, ImportResult, NodeEvaluation, Player, Position, RecordNode, RuleSet } from "./types";
import { MARK_SGF_PROPERTY, markKindForStyle } from "./annotation-presets";
import { RenLibArrayBuilder, createLazyDocument } from "./compact-index";

interface SgfNode { props: Record<string, string[]>; children: SgfNode[] }

const readU32LE = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
/**
 * 解压后允许占多少字节。以前这里是 `Number.MAX_SAFE_INTEGER`（等于不设限），于是 33MB 的库
 * 解出 309MB、加上索引常驻 3.6GB，手机网页内核被系统直接杀掉——用户看到的是「db 打不开」，
 * 一句解释都没有。现在按设备给个预算：`deviceMemory` 只有安卓 Chrome 提供（粗粒度 GB），
 * 拿不到就按桌面处理（1.5GB）。预算 = GB × 128MB，下限 192MB。
 */
const dpDecodedBudgetBytes = () => {
  const memory = (globalThis as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory;
  if (typeof memory !== "number" || memory <= 0) return 1536 * 1048576;
  return Math.max(192, Math.round(memory * 128)) * 1048576;
};
const MAX_DP_DECODED_BYTES = dpDecodedBudgetBytes();
const dpMegabytes = (bytes: number) => `${(bytes / 1048576).toFixed(0)}MB`;
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
    if (remaining <= 0 || (uncompressed && block.length > remaining)) throw new Error(`这份数据库解压后超过本机内存预算（约 ${dpMegabytes(MAX_DP_DECODED_BYTES)}，本机内存越小这个预算越小）：请在电脑上打开这一份`);
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
/**
 * 子节点查找的快路径。
 *
 * 朴素实现为每个候选空点重算一次 dpCanonicalKey，而 dpCanonicalKey 会对 8 个朝向
 * 各扫一遍整盘（225 格）——一个局面 225 个候选 = 约 80 万次格子访问，实测中位
 * 13ms/局面。父局面已经算过规范形，于是子局面只是在「规范朝向下的棋子表」里多插
 * 一颗子：对 8 个朝向变换这张短表并重排，就得到与整盘扫描完全相同的 stones 序列。
 *
 * 逐位等价由 qa 之外的 dp-canonical-parity 单测用真实库背书（同局面比对两条路径）。
 */
const dpInsertStone = (stones: number[], x: number, y: number) => {
  const out = stones.slice();
  let insertAt = out.length;
  for (let index = 0; index < out.length; index += 2) {
    if (out[index] > x || (out[index] === x && out[index + 1] > y)) { insertAt = index; break; }
  }
  out.splice(insertAt, 0, x, y);
  return out;
};

/** 按朝向变换一张棋子表；扫描顺序是 x 主序 y 次序，故变换后重排等价于重扫整盘。 */
const dpTransformStoneList = (stones: number[], trans: number, size = 15) => {
  const out: number[] = [];
  const turns = trans === 4 ? 0 : trans > 4 ? trans - 4 : trans;
  for (let index = 0; index < stones.length; index += 2) {
    let x = stones[index], y = stones[index + 1];
    if (trans >= 4) y = size - 1 - y;
    for (let turn = 0; turn < turns; turn += 1) { const nextX = size - 1 - y; y = x; x = nextX; }
    out.push(x, y);
  }
  for (let index = 2; index < out.length; index += 2) {
    const x = out[index], y = out[index + 1];
    let cursor = index - 2;
    while (cursor >= 0 && (out[cursor] > x || (out[cursor] === x && out[cursor + 1] > y))) {
      out[cursor + 2] = out[cursor]; out[cursor + 3] = out[cursor + 1]; cursor -= 2;
    }
    out[cursor + 2] = x; out[cursor + 3] = y;
  }
  return out;
};

/** 父局面规范形里的黑白棋子表（去掉尾部过手填充）。 */
const dpCanonicalStoneLists = (key: Uint8Array, blackCount: number, whiteCount: number) => {
  const stones = Array.from(key.slice(3));
  return { black: stones.slice(0, blackCount * 2), white: stones.slice(blackCount * 2, blackCount * 2 + whiteCount * 2) };
};

/** 子局面（父规范形 + 一手棋）的键字节。以前返回逗号字符串，一次查询要拼 225 次，
 *  而索引现在直接收字节 —— 拼字符串既花时间又临时产生几百个短命字符串。 */
const dpChildKeyBytes = (black: number[], white: number[], sideToMove: 0 | 1, point: Position) => {
  const nextBlack = sideToMove === 0 ? dpInsertStone(black, point.col, point.row) : black;
  const nextWhite = sideToMove === 1 ? dpInsertStone(white, point.col, point.row) : white;
  const nextSide = (sideToMove ^ 1) as 0 | 1;
  // 与 dpCanonicalKey 相同的过手填充：两侧手数差与行棋方之差，取绝对值。
  const padding = Math.abs((nextBlack.length - nextWhite.length) / 2 - nextSide);
  let best: number[] | null = null;
  for (let trans = 0; trans < 8; trans += 1) {
    const stones = dpTransformStoneList(nextBlack, trans).concat(dpTransformStoneList(nextWhite, trans));
    for (let index = 0; index < padding; index += 1) stones.push(0xff, 0xff);
    if (!best || dpStonesCompare(stones, best) <= 0) best = stones;
  }
  return new Uint8Array([2, 15, 15, ...(best as number[])]);
};

const decodeDpLabel = (bytes: Uint8Array) => {  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); }
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

/** FNV-1a 32 位。DP 的键只有几十字节，一次线性扫描就够。 */
const dpKeyHash = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) { hash ^= bytes[index]; hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
};

const dpKeyBytesFromString = (key: string) => Uint8Array.from(key.split(",").map((part) => Number(part) || 0));

/** 分块字节袋：按 16MB 定长分块追加，避免"翻倍扩容"时同时握着新旧两份（那会让开库峰值反而变大）。 */
class DpBlobStore {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private static readonly CHUNK = 16 * 1048576;

  get byteLength() { return this.length; }

  append(source: Uint8Array, start: number, end: number): number {
    const at = this.length;
    let from = start, cursor = at;
    while (from < end) {
      const chunkIndex = Math.floor(cursor / DpBlobStore.CHUNK);
      while (this.chunks.length <= chunkIndex) this.chunks.push(new Uint8Array(DpBlobStore.CHUNK));
      const chunk = this.chunks[chunkIndex];
      const within = cursor - chunkIndex * DpBlobStore.CHUNK;
      const take = Math.min(end - from, chunk.length - within);
      chunk.set(source.subarray(from, from + take), within);
      from += take; cursor += take;
    }
    this.length = cursor;
    return at;
  }

  read(at: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const cursor = at + done;
      const chunk = this.chunks[Math.floor(cursor / DpBlobStore.CHUNK)];
      const take = Math.min(length - done, DpBlobStore.CHUNK - (cursor % DpBlobStore.CHUNK));
      out.set(chunk.subarray(cursor % DpBlobStore.CHUNK, cursor % DpBlobStore.CHUNK + take), done);
      done += take;
    }
    return out;
  }

  equals(at: number, length: number, other: Uint8Array) {
    let done = 0;
    while (done < length) {
      const cursor = at + done;
      const chunk = this.chunks[Math.floor(cursor / DpBlobStore.CHUNK)];
      const take = Math.min(length - done, DpBlobStore.CHUNK - (cursor % DpBlobStore.CHUNK));
      for (let index = 0; index < take; index += 1) {
        if (chunk[cursor % DpBlobStore.CHUNK + index] !== other[done + index]) return false;
      }
      done += take;
    }
    return true;
  }
}

/**
 * 键压缩：DP 的键是 `[2,15,15] + 列行成对的棋子表`，而列与行都在 0-14 之间，
 * 所以一对棋子能塞进一个字节（高 4 位列、低 4 位行），过手对 `(0xff,0xff)` 用单字节 `0xff` 表示
 * （`0xff` 不会和任何合法棋子字节撞上，合法值最大是 0xee）。
 * 实测 384 万局面的溪月a8.db 平均每条键 68 字节，压完 34 字节——**省下的正是那 130MB**。
 * 遇到不合规的键（长度不是成对、坐标超 14）整条按原样存，用 keyPacked 标出来，不猜。
 */
const dpPackKeyInto = (source: Uint8Array, keyStart: number, keyLength: number, scratch: Uint8Array) => {
  const stones = keyLength - 3;
  if (stones < 0 || (stones & 1) === 1) return -1;
  let at = 0;
  for (let index = 0; index < stones; index += 2) {
    const col = source[keyStart + 3 + index], row = source[keyStart + 4 + index];
    if (col === 0xff && row === 0xff) scratch[at++] = 0xff;
    else if (col <= 14 && row <= 14) scratch[at++] = (col << 4) | row;
    else return -1;
  }
  return at;
};

const dpUnpackKey = (packed: Uint8Array) => {
  const out = new Uint8Array(3 + packed.length * 2);
  out[0] = 2; out[1] = 15; out[2] = 15;
  for (let index = 0; index < packed.length; index += 1) {
    const byte = packed[index];
    if (byte === 0xff) { out[3 + index * 2] = 0xff; out[4 + index * 2] = 0xff; }
    else { out[3 + index * 2] = byte >> 4; out[4 + index * 2] = byte & 15; }
  }
  return out;
};

/** DP 局面索引（2026-10-03 两次重写，为的是手机上能开大库）。
 *
 * 第一版是 `Map<string, DpState>`：每条局面在建索引那一刻就生成字符串键、225 字节棋盘、
 * key/record 两份拷贝、一个对象，还要把注释文本解析一遍。实测 384 万局面常驻 3.6GB、建表 270 秒。
 * 现在：键压成单字节存进分块袋、记录单独存一袋（**解压缓冲用完就丢**），棋盘与注释文本推迟到查询时算。
 * 语义与 Map 对齐（12 份真实库逐字节指纹对照过）：同键后者覆盖、遍历按首次出现。
 */
export class DpStateIndex {
  private readonly keyStart: Uint32Array;
  private readonly keyLength: Uint16Array;
  private readonly keyPacked: Uint8Array;
  private readonly recordStart: Uint32Array;
  private readonly recordLength: Uint16Array;
  private readonly chain: Int32Array;
  private readonly buckets: Int32Array;
  private readonly keys = new DpBlobStore();
  private readonly records = new DpBlobStore();
  private filled = 0;
  private scratch = new Uint8Array(512);

  constructor(capacity: number) {
    this.keyStart = new Uint32Array(capacity);
    this.keyLength = new Uint16Array(capacity);
    this.keyPacked = new Uint8Array(capacity);
    this.recordStart = new Uint32Array(capacity);
    this.recordLength = new Uint16Array(capacity);
    this.chain = new Int32Array(capacity).fill(-1);
    let buckets = 16;
    while (buckets < capacity * 2 && buckets < (1 << 26)) buckets *= 2;
    this.buckets = new Int32Array(buckets);   // 存 slot + 1，0 表示空桶
  }

  get size() { return this.filled; }

  /** 常驻内存估算：用于「这台机器开不开得动」的判断与提示。 */
  get residentBytes() {
    return this.keys.byteLength + this.records.byteLength + this.keyStart.byteLength + this.keyLength.byteLength
      + this.keyPacked.byteLength + this.recordStart.byteLength + this.recordLength.byteLength + this.chain.byteLength + this.buckets.byteLength;
  }

  /** 把一条原始键压进暂存区（暂存区按需长大），返回长度；-1 表示这条压不了。 */
  private packKey(source: Uint8Array, start: number, length: number) {
    if (this.scratch.length < length) this.scratch = new Uint8Array(length * 2);
    return dpPackKeyInto(source, start, length, this.scratch);
  }

  private storedKeyLength(slot: number) { return this.keyLength[slot]; }

  private sameKey(slot: number, bytes: Uint8Array) {
    return this.keyLength[slot] === bytes.length && this.keys.equals(this.keyStart[slot], bytes.length, bytes);
  }

  /** 收一条局面：`source` 是解压缓冲，只在这一刻读它，之后就可以扔掉。 */
  add(source: Uint8Array, keyStart: number, keyLength: number, recordStart: number, recordLength: number) {
    let keyAt: number, keyBytes: number, packed: number;
    const packedLength = this.packKey(source, keyStart, keyLength);
    if (packedLength >= 0) {
      keyAt = this.keys.append(this.scratch, 0, packedLength); keyBytes = packedLength; packed = 1;
    } else {
      keyAt = this.keys.append(source, keyStart, keyStart + keyLength); keyBytes = keyLength; packed = 0;
    }
    const bucket = dpKeyHash(this.keys.read(keyAt, keyBytes)) % this.buckets.length;
    for (let slot = this.buckets[bucket] - 1; slot >= 0; slot = this.chain[slot]) {
      if (!this.sameKey(slot, packed ? this.scratch.subarray(0, keyBytes) : source.subarray(keyStart, keyStart + keyLength))) continue;
      this.keyStart[slot] = keyAt; this.keyLength[slot] = keyBytes; this.keyPacked[slot] = packed;
      this.recordStart[slot] = this.records.append(source, recordStart, recordStart + recordLength);
      this.recordLength[slot] = recordLength;
      return;   // 后者覆盖，位置保持在首次出现处
    }
    const slot = this.filled;
    this.keyStart[slot] = keyAt; this.keyLength[slot] = keyBytes; this.keyPacked[slot] = packed;
    this.recordStart[slot] = this.records.append(source, recordStart, recordStart + recordLength);
    this.recordLength[slot] = recordLength;
    this.chain[slot] = this.buckets[bucket] - 1;
    this.buckets[bucket] = slot + 1;
    this.filled += 1;
  }

  indexOf(key: Uint8Array): number {
    const packedLength = this.packKey(key, 0, key.length);
    const bytes = packedLength >= 0 ? this.scratch.subarray(0, packedLength) : key;
    const bucket = dpKeyHash(bytes) % this.buckets.length;
    for (let slot = this.buckets[bucket] - 1; slot >= 0; slot = this.chain[slot]) {
      if (this.sameKey(slot, bytes)) return slot;
    }
    return -1;
  }

  /** 热路径用字节键（省一次字符串拼接与拆分）。 */
  byKey(key: Uint8Array): DpState | undefined {
    const slot = this.indexOf(key);
    return slot < 0 ? undefined : this.stateAt(slot);
  }

  /** 兼容旧调用：既收字节键，也收 `2,15,15,...` 字符串键（legacy 导入器还在用）。 */
  get(key: Uint8Array | string): DpState | undefined {
    return this.byKey(typeof key === "string" ? dpKeyBytesFromString(key) : key);
  }

  /** 一条局面按需展开：键要解包、记录从袋里拷出来，棋盘与注释文本在这里才算。 */
  stateAt(slot: number): DpState {
    // 键本身已经处在数据库的规范坐标系里：记录与它的标注坐标必须成对使用，
    // 在这里再规范一次会把不同局面并成一个，并把错误的标注集挂到可导航的那条路上。
    const stored = this.keys.read(this.keyStart[slot], this.storedKeyLength(slot));
    const key = this.keyPacked[slot] ? dpUnpackKey(stored) : stored;
    const record = this.records.read(this.recordStart[slot], this.recordLength[slot]);
    const stones = key.subarray(3);
    const position = new Uint8Array(225);
    const blackBytes = (((stones.length >>> 1) + 1) >>> 1) * 2;
    for (let index = 0; index + 1 < stones.length; index += 2) position[stones[index + 1] * 15 + stones[index]] = index < blackBytes ? 1 : 2;
    let black = 0, white = 0;
    // 与旧实现一样按**格子**数（同一格被写两次也只算一次），不是按棋子条目数
    for (let index = 0; index < 225; index += 1) { const cell = position[index]; if (cell === 1) black += 1; else if (cell === 2) white += 1; }
    return { key, record, position, sideToMove: (black === white ? 0 : 1), ...parseDpRecordText(record.subarray(5)) };
  }

  *values(): IterableIterator<DpState> {
    for (let slot = 0; slot < this.filled; slot += 1) yield this.stateAt(slot);
  }

  *[Symbol.iterator](): IterableIterator<[string, DpState]> {
    for (let slot = 0; slot < this.filled; slot += 1) { const state = this.stateAt(slot); yield [dpKeyString(state.key), state]; }
  }
}

export const parseDpDatabaseStates = (bytes: Uint8Array) => {
  if (bytes.length < 4) throw new Error("DP 数据库内容不完整");
  const declared = readU32LE(bytes, 0);
  // 每条记录至少占 5 字节（1 字节键 + 2 长度 + 2 记录头），据此给容量封顶，
  // 免得文件头里写个天文数字就先去分配几十亿的数组。
  const capacity = Math.max(1, Math.min(declared, Math.floor((bytes.length - 4) / 5)));
  const states = new DpStateIndex(capacity);
  let offset = 4;
  for (let index = 0; index < declared && offset + 2 <= bytes.length; index += 1) {
    const keyLength = bytes[offset] | (bytes[offset + 1] << 8); offset += 2;
    if (!keyLength || offset + keyLength + 2 > bytes.length) break;
    const keyStart = offset; offset += keyLength;
    const recordLength = bytes[offset] | (bytes[offset + 1] << 8); offset += 2;
    if (offset + recordLength > bytes.length) break;
    const recordStart = offset; offset += recordLength;
    if (keyLength < 3 || bytes[keyStart] !== 2 || bytes[keyStart + 1] !== 15 || bytes[keyStart + 2] !== 15) continue;
    states.add(bytes, keyStart, keyLength, recordStart, recordLength);
  }
  return states;
};

/**
 * DP 记录里的评估值（有符号 16 位）。
 * 符号约定从 dpRecordDisplayLabel 反推并经真实库核对：**越小越利于该局面的行棋方**
 * （'w' 胜 ≈ −29500、'l' 负 ≈ +29500、0xff 档按 −value 算胜率）。
 * 父局面挑「最优子」＝挑值最小的那个子（子的值是从子的行棋方算的）。
 */
export const dpRecordValue = (record: Uint8Array) => {
  const unsignedValue = (record[1] || 0) | ((record[2] || 0) << 8);
  return unsignedValue & 0x8000 ? unsignedValue - 0x10000 : unsignedValue;
};

const dpRecordDisplayLabel = (record: Uint8Array, sideToMove: 0 | 1) => {
  const label = record[0] || 0;
  const value = dpRecordValue(record);
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
export const queryDpPosition = (states: DpStateIndex, position: Uint8Array, sideToMove: 0 | 1): DpPositionQuery => {
  const canonical = dpCanonicalKey(position, sideToMove);
  const state = states.byKey(canonical.key);
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
  // 复用父局面的规范形做子节点查找：一个局面要试 225 个空点，朴素路径每个点都要
  // 重算一次全盘规范键（实测 13ms/局面），这里只在规范棋子表里插一颗子。
  let blackCount = 0, whiteCount = 0;
  for (let index = 0; index < 225; index += 1) {
    const cell = position[index];
    if (cell === 1) blackCount += 1; else if (cell === 2) whiteCount += 1;
  }
  const canonicalStones = dpCanonicalStoneLists(canonical.key, blackCount, whiteCount);
  for (let index = 0; index < 225; index += 1) {
    if (position[index]) continue;
    const point = { row: Math.floor(index / 15), col: index % 15 };
    // 候选点要先变换到父局面的规范朝向上，才能插进那张规范棋子表。
    const child = states.byKey(dpChildKeyBytes(canonicalStones.black, canonicalStones.white, sideToMove, dpPointTransform(point, canonical.trans)));
    if (!child) continue;
    branches.push({ position: point, label: labelAt.get(`${point.row},${point.col}`) || dpRecordDisplayLabel(child.record, sideToMove), state: child });
  }
  return { state, comment: state?.comment || "", marks, branches, canonicalTransform: canonical.trans };
};

export const openDpDatabaseIndex = async (source: Blob) => parseDpDatabaseStates(decodeDpDatabaseFrame(new Uint8Array(await source.arrayBuffer())));

/** Charset sniffing shared by every text import path: BOM, UTF-16 by zero-byte
 *  parity, then strict UTF-8 with a GB18030 fallback. Also used by the online
 *  sources so a GBK community page is not mangled. */
export const decodeText = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
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
    // 从 .lib 导出的 SGF 常见一种写法：按固定缓冲区落盘，没用满的部分全填 0。实测用户
    // 那批文件里有两份各拖着 2 万与 30 万字节这种尾巴，顶层扫描把它们当成"无法识别的
    // 尾部内容"，一整份完好的谱就此拒掉。属性值**里面**的 0 是合法内容，不能丢，所以只在值外丢。
    if (char === "\0") { index += 1; continue; }
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
      // 同名属性出现在同一节点里要**合并**而不是覆盖。规范写法是 CR[aa][bb]，
      // 但真实文件（含我们老版本导出的）常写成 CR[aa]CR[bb]；以前这里 `props[key] = []`
      // 会把前一次整个丢掉——实测 7 个标注只能读回 5 个。
      const list = props[key] || (props[key] = []);
      while (text[index] === "[") { list.push(value()); skipSpace(); }
    }
    return { props, children: [] };
  };
  const beginTree = (): { root: SgfNode | null; tail: SgfNode | null } => {
    skipSpace(); if (text[index] !== "(") throw new Error("SGF 缺少游戏树起点"); index += 1; skipSpace();
    let root: SgfNode | null = null, tail: SgfNode | null = null;
    while (text[index] === ";") { const current = node(); if (!root) root = current; if (tail) tail.children.push(current); tail = current; skipSpace(); }
    return { root, tail };
  };
  const tree = (): SgfNode => {
    // FF4 的游戏树 = 节点序列 + 同级变体。显式帧栈保留原文件的分支顺序，
    // 让深层括号和长序列一样不依赖 JavaScript 调用栈。
    const frames = [beginTree()];
    while (frames.length) {
      if (text[index] === "(") { frames.push(beginTree()); continue; }
      // 位置要报出来：坏文件只说"没有闭合"的话用户无法定位。
      if (text[index] !== ")") throw new Error(`SGF 游戏树没有闭合（第 ${index + 1} 个字符处读到 ${JSON.stringify(text.slice(index, index + 16))}）`);
      index += 1;
      const current = frames.pop()!;
      if (!current.root) throw new Error("SGF 中没有节点");
      if (!frames.length) return current.root;
      frames[frames.length - 1].tail?.children.push(current.root);
      skipSpace();
    }
    throw new Error("SGF 中没有节点");
  };
  skipSpace();
  const trees: SgfNode[] = [];
  while (index < text.length) {
    if (text[index] !== "(") throw new Error(`SGF 顶层包含无法识别的尾部内容（第 ${index + 1} 个字符处读到 ${JSON.stringify(text.slice(index, index + 16))}）`);
    trees.push(tree()); skipSpace();
  }
  if (!trees.length) throw new Error("SGF 中没有游戏树");
  return trees;
};

/** SGF 点值。规范写小写（`aa`–`ss`），但**大小写都收**：部分国产/老软件导出的是大写
 *  （`B[HH]`），按规范判非法会把整份棋谱拒之门外（09-19 实测）。大小写混写也一并归一。 */
const sgfPosition = (value?: string, size = 15): Position | null => {
  if (!value || value.length < 2) return null;
  const lower = value.toLowerCase();
  const col = lower.charCodeAt(0) - 97, row = lower.charCodeAt(1) - 97;
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
  const black = readPoints("AB");
  const white = readPoints("AW");
  // 缺 PL 时按黑白子数奇偶推定行棋方（很多工具导出局面不带 PL；与截图导入通道同一口径：黑多→白行棋，相等→黑行棋）
  const inferred = black.length || white.length ? (black.length > white.length ? "white" as const : "black" as const) : undefined;
  const setup = {
    black,
    white,
    empty: readPoints("AE"),
    nextPlayer: props.PL?.[0] === "W" ? "white" as const : props.PL?.[0] === "B" ? "black" as const : inferred,
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
  // RenLib 的「起始」标记（范围导出的范围根）在 SGF 里没有标准属性，用私有属性 XST 承载，
  // 与 XEV 同一套做法：只在存在时写出，读回时缺失即不设置——SGF→LIB 不会把它洗掉。
  if (hasProp(props, "XST")) node.startPosition = true;
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
  // SQ（方块）以前完全没读：别的软件写的方块标注会被整条丢掉。
  const markKeys = ["CR", "TR", "SQ", "MA", "LB"];
  if (markKeys.some((key) => hasProp(props, key))) {
    // 语义来自属性名，画法按语义给一个默认（空心圆/空心三角/实心方块/叉）。
    const styleForKind: Record<BoardMarkKind, BoardMarkStyle> = {
      circle: "circle", triangle: "triangle", square: "square-solid", cross: "cross", check: "cross", label: "text",
    };
    const shapeKeys = [["CR", "circle"], ["TR", "triangle"], ["SQ", "square"], ["MA", "cross"]] as const;
    node.marks = shapeKeys.flatMap(([key, kind]) => (props[key] || [])
      .map((point) => sgfPosition(point, size))
      .filter((point): point is Position => Boolean(point))
      .map((point) => ({ ...point, kind, style: styleForKind[kind] })));
    node.marks = [...node.marks, ...(props.LB || []).flatMap((value) => {
      const separator = value.indexOf(":");
      const point = sgfPosition(separator >= 0 ? value.slice(0, separator) : value, size);
      if (!point) return [];
      // 导入**不截断**：SGF 的 LB 没有长度上限，别的软件（爱五子棋/五林等）常写整句话，
      // 截到 4 字就是静默丢数据（09-19 实测：`LB[dd:这是一个很长的标注文字]` → 「这是一个」，
      // 再导出只剩 4 字）。4 字上限只属于「手工输入」与「LIB 盘面文字那一格」——
      // LIB 导出时超长部分本来就会走注释清单通道（见 lib-mark-annotations），不会丢。
      // 首尾空格 trim：标注是棋盘点上的短字形，外层空格没有意义；导出侧本来就裁掉它们，
      // 导入不裁会让「导入→导出→再导入」不一致（09-19 实测 ⑬）。
      const label = (separator >= 0 ? value.slice(separator + 1) : "?").trim();
      // 我们导出图形标注时会「形状属性 + 同点 LB」成对写出（形状属性没有文字位）。
      // 读回来要**并回同一个标注**，否则会多出一个重复的文字标注。
      const shape = node.marks.find((mark) => mark.row === point.row && mark.col === point.col && mark.kind !== "label");
      if (shape) { shape.label = label; return []; }
      // 空文字 LB（`LB[dd:]`，别的软件用它「清掉标签」）不造标注：造出来是个看不见的
      // 标注——用户既看不到也删不掉，导出时还会消失（往返不一致，09-19 实测 ⑪）。
      if (!label) return [];
      return [{ ...point, kind: "label" as const, style: "text" as const, label }];
    })];
  }
};

const importSgfTree = (tree: SgfNode, fallbackTitle: string): { document: GameDocument; warnings: string[] } => {
  const rawSize = tree.props.SZ?.[0];
  const sizeParts = rawSize?.split(":") || [];
  const size = rawSize ? Number(sizeParts[0]) : 15;
  if (!isSupportedBoardSize(size) || (sizeParts[1] && Number(sizeParts[1]) !== size)) throw new Error(`不支持的 SGF 棋盘尺寸：SZ[${rawSize || "?"}]（支持 5-30 路方形棋盘）`);
  const warnings: string[] = [];
  if (!rawSize) warnings.push("SGF 未声明 SZ，已按十五路读取");
  const document = createDocument(tree.props.GN?.[0] || fallbackTitle, size);
  document.metadata.black = tree.props.PB?.[0] || "黑方"; document.metadata.white = tree.props.PW?.[0] || "白方";
  document.metadata.event = tree.props.EV?.[0] || ""; document.metadata.date = tree.props.DT?.[0] || document.metadata.date;
  document.metadata.result = tree.props.RE?.[0] || "";
  const ruleText = tree.props.RU?.[0] || "";
  const rule = ruleText.toLowerCase(); document.metadata.rule = rule.includes("free") ? "freestyle" : rule.includes("standard") ? "standard" : "renju";
  // Full game-information properties. Each stays undefined when absent so that
  // re-exporting an untouched record never invents empty properties.
  const infoText = (key: string) => {
    const value = tree.props[key]?.[0]?.replace(/\s+/g, " ").trim();
    return value ? value : undefined;
  };
  document.metadata.round = infoText("RO");
  document.metadata.place = infoText("PC");
  document.metadata.blackRank = infoText("BR");
  document.metadata.whiteRank = infoText("WR");
  document.metadata.komi = infoText("KM");
  document.metadata.timeLimit = infoText("TM");
  document.metadata.overtime = infoText("OT");
  document.metadata.openingName = infoText("ON") || infoText("OP");
  document.metadata.annotator = infoText("AN");
  document.metadata.copyright = infoText("CP");
  document.metadata.sourceUrl = infoText("SO");
  document.metadata.ruleText = infoText("RU");
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
    return id;
  };
  const pending: Array<{ parentId: string; source: SgfNode }> = [];
  if (hasProp(tree.props, "B") || hasProp(tree.props, "W")) pending.push({ parentId: document.rootId, source: tree });
  else {
    const root = document.nodes[document.rootId]; root.setup = setupFromSgf(tree.props, size);
    applySgfAnnotations(root, tree.props, warnings, false, size);
    for (let index = tree.children.length - 1; index >= 0; index -= 1) pending.push({ parentId: document.rootId, source: tree.children[index] });
  }
  while (pending.length) {
    const { parentId, source } = pending.pop()!;
    const id = appendNode(parentId, source);
    for (let index = source.children.length - 1; index >= 0; index -= 1) pending.push({ parentId: id, source: source.children[index] });
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
  if (width !== height || !isSupportedBoardSize(width)) throw new Error(`不支持的 PSQ 棋盘尺寸：${width}x${height}（支持 5-30 路方形棋盘）`);
  const moveLines = lines.map((line, index) => ({ line: line.trim(), number: index + 2 })).filter((entry) => entry.line);
  if (!moveLines.length) throw new Error("PSQ 落子列表为空");
  // 第三列在真实世界里有两种方言，两种都要能读：
  //   · 颜色 0/1 —— 例如 2018 祁观 vs 弈心 人机大战的官方存档（本项目导出也是这一种）；
  //   · 每手用时毫秒 —— Gomocup 官方成绩存档（开局库着法为 0，之后是 32098、46677 这类值）。
  // 整列都落在 {0,1} 才当颜色，否则按手序交替推黑白（两者对正常交替对局结果相同）。
  const movePattern = /^(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)$/;
  const parsedLines: Array<{ entry: { line: string; number: number }; col: number; rowFromBottom: number; third: number }> = [];
  const footer: string[] = [];
  for (const entry of moveLines) {
    const fields = movePattern.exec(entry.line);
    // 真实 Gomocup 成绩存档在着法之后还有页脚：两份 AI 的 zip 名、-1、以及「规则号,规则名」
    // （1,Renju / 2,Freestyle4 / …）。着法列表在第一个不像着法的行处结束，其余按页脚处理——
    // 不这样容忍，整个 Gomocup PSQ 语料都会因为最后一行「不是着法」而导入失败。
    if (!fields) { footer.push(entry.line); continue; }
    if (footer.length) continue;
    parsedLines.push({ entry, col: Number(fields[1]), rowFromBottom: Number(fields[2]), third: Number(fields[3]) });
  }
  if (!parsedLines.length) throw new Error(`PSQ 第 ${moveLines[0].number} 行无法识别：${moveLines[0].line}`);
  // 列号的起算基准在真实世界里有两种，且都能拿到实证：
  //   · Piskvork 自己的写法是 **1 起算** —— Gomocup 官方裁判就是 Piskvork，其成绩存档里
  //     15 路文件的列落在 1..13、20 路落在 1..20，从不出现 0；同一局棋的 .psq/.sgf 配对
  //     （首手天元）也证实这一点。本项目导出的 PSQ 现在也是这一种。
  //   · 弈心等工具导出的是 **0 起算** —— 2018 祁观 vs 弈心人机大战的官方存档里 col 取到 0，
  //     且与同局 SGF 逐手一致（首手落在天元）。
  // 判别顺序（从确定到启发式；无法确定时取 1 起算，也就是我们自己写出的那一种）：
  //   ① 出现 col=0 → 只能是 0 起算；出现 col=size → 只能是 1 起算。
  //   ② 否则看首手：天元是连珠/标准/自由开局的落点，两种读法各算一次列号，**恰好命中天元**
  //      的那个胜出。这一条救的是「没有 col 0 的 0 起算文件」——实测人机大战第 1、4 局就是。
  //   ③ 都不成立 → 1 起算（Piskvork 是格式拥有者，且我们自己的写出约定也是 1 起算，
  //      这样自产文件往返永不变形）。
  const centerColumns = [Math.floor((width - 1) / 2), Math.ceil((width - 1) / 2)];
  const firstColumn = parsedLines[0].col;
  const zeroBasedColumns = (() => {
    if (parsedLines.some((move) => move.col === 0)) return true;
    if (parsedLines.some((move) => move.col === width)) return false;
    const zeroCentered = centerColumns.includes(firstColumn);
    const oneCentered = centerColumns.includes(firstColumn - 1);
    return zeroCentered !== oneCentered ? zeroCentered : false;
  })();
  const warnings: string[] = [];
  if (zeroBasedColumns) warnings.push("该 PSQ 的列号按 0 起算读取（弈心等工具的写法）");
  else if (!parsedLines.some((move) => move.col === width) && !centerColumns.includes(firstColumn - 1)) {
    warnings.push(`该 PSQ 没有列 0 也没有列 ${width}，已按 Piskvork 惯例把列号当作 1 起算；若整盘横向偏了一列，请反馈该文件`);
  }
  const colorAnnotated = parsedLines.every((move) => move.third === 0 || move.third === 1);
  if (!colorAnnotated) warnings.push("PSQ 第 3 列是每手用时（不是颜色），已按手序交替推黑白");
  // 页脚里的「规则号,规则名」是自描述的：名字里带 renju / standard / free 就能对上我们的规则集。
  const footerRule = footer.map((line) => /^\d+\s*,\s*(.+)$/.exec(line)?.[1]?.trim()).find(Boolean);
  const footerRuleSet: RuleSet | null = !footerRule ? null
    : footerRule.toLowerCase().includes("renju") ? "renju"
    : footerRule.toLowerCase().includes("standard") ? "standard"
    : footerRule.toLowerCase().includes("free") ? "freestyle" : null;
  if (footerRuleSet) warnings.push(`已按文件页脚识别规则：${footerRule} → ${footerRuleSet}`);
  if (footer.length) warnings.push(`忽略了着法之后的 ${footer.length} 行页脚（Gomocup 存档会附带 AI 名与规则行）`);
  let document = createDocument(filename.replace(/\.[^.]+$/, ""), width), currentId = document.rootId;
  for (let index = 0; index < parsedLines.length; index += 1) {
    const move = parsedLines[index];
    const { rowFromBottom } = move;
    const col = zeroBasedColumns ? move.col : move.col - 1;
    if (col < 0 || col >= width || rowFromBottom < 1 || rowFromBottom > height) throw new Error(`PSQ 第 ${index + 1} 手坐标越界：${move.col},${rowFromBottom}`);
    const position = { row: height - rowFromBottom, col };
    const player: Player = colorAnnotated ? (move.third === 0 ? "black" : "white") : (index % 2 === 0 ? "black" : "white");
    const added = addMoveAs(document, currentId, position, player);
    if (!added.created) throw new Error(`PSQ 第 ${index + 1} 手与已有棋子冲突：${move.col},${rowFromBottom}（该点此前已落子；真实存档偶见这类异常记录，此文件无法作为完整对局导入）`);
    document = added.document; currentId = added.nodeId;
  }
  if (footerRuleSet) document = { ...document, metadata: { ...document.metadata, rule: footerRuleSet } };
  return { document, warnings, format: "PSQ (Piskvorky)" };
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

export const validateJsonDocument = (value: unknown): GameDocument => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RENJU 文件不是有效对象");
  const document = value as GameDocument;
  if (document.version !== 1 || typeof document.id !== "string" || typeof document.rootId !== "string" || !document.nodes || typeof document.nodes !== "object" || Array.isArray(document.nodes) || !Object.prototype.hasOwnProperty.call(document.nodes, document.rootId)) throw new Error("RENJU 文件缺少有效的版本、ID 或节点表");
  if (!document.metadata || typeof document.metadata.title !== "string" || typeof document.metadata.black !== "string" || typeof document.metadata.white !== "string" || !["renju", "standard", "freestyle"].includes(document.metadata.rule) || !isSupportedBoardSize(document.metadata.boardSize)) throw new Error("RENJU 文件的棋谱信息不完整或规则无效");
  if (typeof document.createdAt !== "string" || typeof document.updatedAt !== "string" || !Number.isFinite(Date.parse(document.createdAt)) || !Number.isFinite(Date.parse(document.updatedAt))) throw new Error("RENJU 文件的时间信息无效");
  const root = document.nodes[document.rootId];
  if (!root || root.parentId !== null || root.move !== null || root.passPlayer) throw new Error("RENJU 文件的根节点无效");
  const evaluationKinds: NodeEvaluation[] = ["good", "bad", "doubtful", "interesting", "forced", "only", "study"];
  Object.entries(document.nodes).forEach(([id, node]) => {
    if (!node || node.id !== id || !Array.isArray(node.children) || !node.children.every((child) => typeof child === "string" && Object.prototype.hasOwnProperty.call(document.nodes, child)) || typeof node.comment !== "string" || !Array.isArray(node.marks)) throw new Error(`RENJU 节点 ${id} 结构无效`);
    if (node.preferredChildId !== undefined && (typeof node.preferredChildId !== "string" || !node.children.includes(node.preferredChildId))) throw new Error(`RENJU 节点 ${id} 的主线指针无效`);
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
      // 允许的标注语义类别。以前这里是写死的旧四项，新增 square/check 之后，
      // 带这两种标注的 JSON 会被判「无效棋盘标记」而**整份导不回来**（还会连累
      // .json 回落到别的解析器、把画法也弄丢）。改成按唯一出处校验。
      const kindOk = Object.prototype.hasOwnProperty.call(MARK_SGF_PROPERTY, mark.kind);
      if (!Number.isInteger(mark.row) || !Number.isInteger(mark.col) || mark.row < 0 || mark.row >= size || mark.col < 0 || mark.col >= size || !kindOk) throw new Error(`RENJU 节点 ${id} 含有无效棋盘标记`);
    });
  });
  const visited = new Set<string>();
  const pending = [document.rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) throw new Error(`RENJU 节点 ${id} 被多个分支重复引用`);
    const node = document.nodes[id];
    if (!node) throw new Error(`RENJU 缺少节点 ${id}`);
    visited.add(id);
    node.children.forEach((childId) => {
      const child = document.nodes[childId];
      if (!child || child.parentId !== id) throw new Error(`RENJU 节点 ${childId} 的父子关系不一致`);
      pending.push(childId);
    });
  }
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

/** Optional metadata patch for imports whose format cannot express everything
 *  the caller already knows. The online sources use it for the ruleset: a RIF
 *  rule name is free text and cannot be mapped to `rule` by string matching
 *  ("Swap-5 free" contains "free" but is a renju rule), so the source resolves
 *  it from the federation's own rule table and passes the result in here. */
export interface ImportMetadataOverride { metadata?: Partial<GameDocument["metadata"]> }

export const importRecordFile = async (file: File, options?: ImportMetadataOverride & { onPreview?: (preview: RenLibPreview) => Promise<void> | void }): Promise<ImportResult> => {
  const result = await importRecordFileRaw(file, options);
  const patch = options?.metadata;
  if (patch) patchMetadata(result.document, patch);
  return result;
};

const patchMetadata = (document: GameDocument, patch: Partial<GameDocument["metadata"]>) => {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    (document.metadata as unknown as Record<string, unknown>)[key] = value;
  }
  document.updatedAt = new Date().toISOString();
};

/** SGF 的 CA[...] 声明了文件所用字符集。GB2312/GBK 的字节序列经常**恰好也是合法
 *  UTF-8**，所以 decodeText 的「先试严格 UTF-8」在中文棋谱上会静默解出乱码而不是报错：
 *  renju.net、爱五子棋等中文软件导出的 SGF，以及官方 RenLib 核心 lib2sgf 的输出，
 *  都声明 CA[gb2312]。声明存在且不是 UTF-8 时按声明解码（标签走 WHATWG 标准名，
 *  认不出来再回落到字节探测）。 */
const decodeSgfBytes = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const declared = /CA\[([^\]]{1,40})\]/.exec(head)?.[1]?.trim().toLowerCase();
  if (declared && !/^utf-?8$/.test(declared)) {
    try { return new TextDecoder(declared).decode(bytes); } catch { /* 未知标签：回落探测 */ }
  }
  return decodeText(bytes);
};

const looksLikeSgf = (buffer: ArrayBuffer, extension: string) =>
  ["sgf", "fgf", "ren", "renjs", "wzq"].includes(extension)
  || new TextDecoder("latin1").decode(new Uint8Array(buffer).subarray(0, 64)).trimStart().startsWith("(");

const importRecordFileRaw = async (file: File, _options?: { onPreview?: (preview: RenLibPreview) => Promise<void> | void }): Promise<ImportResult> => {
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
  const sgfInput = looksLikeSgf(buffer, extension);
  const text = sgfInput ? decodeSgfBytes(buffer) : decodeText(buffer);
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
  // 按标注的**语义类别**选 SGF 属性。语义一律从画法（style）推导，style 缺失时才用
  // 存的 kind：老版本 UI 建标注时把 kind 写成 "label"，那些文档里 kind 已经不可信，
  // 只有 style 记得用户当初选的是圆圈还是三角。
  // 以前这里直接读 kind，于是圆圈/三角/叉全被写成 `LB[xx:?]`——导出到别的软件只剩问号。
  // label 类且没有文字时**不写出**：空的 LB 没有信息量，写出去只会变成 "?" 噪声。
  // 同一属性要**合并成一次多值**（CR[aa][bb]）而不是重复写属性名，这是规范写法，
  // 也让同类标注在别的软件里稳定读回。
  const grouped = new Map<string, string[]>();
  const add = (property: string, value: string) => {
    const list = grouped.get(property) || grouped.set(property, []).get(property)!;
    if (!list.includes(value)) list.push(value);
  };
  for (const mark of node.marks) {
    const kind = mark.style ? markKindForStyle(mark.style) : mark.kind;
    const property = MARK_SGF_PROPERTY[kind] || "MA";
    const text = (mark.label || "").trim();
    if (property === "LB") {
      if (text) add("LB", `${toSgfCoord(mark)}:${escapeSgf(text)}`);
      continue;
    }
    add(property, toSgfCoord(mark));
    // 形状属性（CR/TR/SQ/MA）**没有文字位**，图形标注上写的字会就此丢掉。
    // 同一个点再补一条 LB，形状与文字就都保住了（别的软件通常两者都画）。
    if (text) add("LB", `${toSgfCoord(mark)}:${escapeSgf(text)}`);
  }
  // 顺序固定为 CR/TR/SQ/MA/LB，保证同一份文档每次导出逐字节一致。
  const marks = ["CR", "TR", "SQ", "MA", "LB"].flatMap((property) => {
    const values = grouped.get(property);
    return values?.length ? [`${property}${values.map((v) => `[${v}]`).join("")}`] : [];
  }).join("");
  const renLibStart = node.startPosition ? "XST[]" : "";
  return `${boardText}${comment}${evaluationSgf(node)}${marks}${renLibStart}`;
};
/** Game-information properties beyond the core set. Written only when a value
 * exists, so records that never had them export byte-identically to before. */
const infoSgf = (metadata: GameDocument["metadata"]) => {
  const entries: Array<[string, string | undefined]> = [
    ["RO", metadata.round], ["PC", metadata.place], ["BR", metadata.blackRank], ["WR", metadata.whiteRank],
    ["KM", metadata.komi], ["TM", metadata.timeLimit], ["OT", metadata.overtime], ["ON", metadata.openingName],
    ["AN", metadata.annotator], ["CP", metadata.copyright], ["SO", metadata.sourceUrl],
  ];
  return entries
    .filter(([, value]) => Boolean(value && value.trim()))
    .map(([key, value]) => `${key}[${escapeSgfSimpleText(String(value))}]`)
    .join("");
};
export const exportSgf = (document: GameDocument) => {
  // 主线（preferredChildId）必须排在同级第一支：SGF 没有「哪支是主线」这个属性，
  // 惯例是文件里第一个分支即主线，导入侧（本文件 appendNode）也正是这样取的。
  // 若按 children 原始数组序导出，用户「设为主线」过的分支会落在第二支，
  // 导出再导入后主线就被换掉了。LIB 导出（lib-export.ts）里对同类限制有显式告警。
  const orderedChildren = (node: RecordNode): RecordNode[] => {
    const children = node.children.map((id) => document.nodes[id]).filter(Boolean);
    if (children.length <= 1) return children;
    const index = node.preferredChildId ? children.findIndex((child) => child.id === node.preferredChildId) : -1;
    return index <= 0 ? children : [children[index], ...children.slice(0, index), ...children.slice(index + 1)];
  };
  const meta = document.metadata, root = document.nodes[document.rootId];
  const props = `(;GM[4]FF[4]CA[UTF-8]AP[RenjuNote:1.0]SZ[${meta.boardSize}]GN[${escapeSgf(meta.title)}]PB[${escapeSgf(meta.black)}]PW[${escapeSgf(meta.white)}]DT[${escapeSgf(meta.date)}]EV[${escapeSgf(meta.event)}]RE[${escapeSgf(meta.result)}]RU[${meta.rule}]${infoSgf(meta)}${setupSgf(root)}${annotationSgf(root)}`;
  const parts = [props];
  const pending: Array<RecordNode | string> = [")"];
  const enqueueChildren = (node: RecordNode) => {
    const children = orderedChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (children.length > 1) pending.push(")", children[index], "(");
      else pending.push(children[index]);
    }
  };
  enqueueChildren(root);
  while (pending.length) {
    const item = pending.pop()!;
    if (typeof item === "string") { parts.push(item); continue; }
    const move = item.move ? `${item.move.player === "black" ? "B" : "W"}[${toSgfCoord(item.move)}]`
      : item.passPlayer ? `${item.passPlayer === "black" ? "B" : "W"}[]` : "";
    parts.push(`;${move}${setupSgf(item)}${annotationSgf(item)}`);
    enqueueChildren(item);
  }
  return parts.join("");
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
    // 过手在 POS 里没有写法：这里以前写 `pass` 这个记号，而 importPos 只认 A1–O15 坐标，
    // 于是**我们自己导出的文件自己读不回来**（报「没有识别到 A1–O15 形式的落子序列」）。
    // 与 PSQ 一致直接跳过；代价由导出侧的过手提示如实说明。
    if (next.move) result.push(coordinateName(next.move, document.metadata.boardSize));
    node = next;
  }
  return result.length ? `${result.join(" ")}\n` : "";
};
/** 主线上的过手数量。PSQ / POS 只承载坐标，过手在它们里面无处安放（写了记号连我们自己的
 *  导入器都读不回），导出时应据此如实告知用户丢了什么。 */
export const mainLinePassCount = (document: GameDocument) => {
  let count = 0, node = document.nodes[document.rootId];
  while (node?.children.length) { node = document.nodes[node.preferredChildId || node.children[0]]; if (node?.passPlayer) count += 1; }
  return count;
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
