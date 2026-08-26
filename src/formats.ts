import { addMove, createDocument, otherPlayer, toggleMark } from "./game";
import type { CompactRenLibDraftNode, CompactRenLibIndex, GameDocument, ImportResult, NodeEvaluation, Player, Position, RecordNode } from "./types";
import { RenLibArrayBuilder, createLazyDocument } from "./compact-index";

interface SgfNode { props: Record<string, string[]>; children: SgfNode[] }

const decodeText = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("gb18030").decode(bytes); }
};

const parseSgfTree = (text: string): SgfNode => {
  let index = 0;
  const skipSpace = () => { while (/\s/.test(text[index] ?? "")) index += 1; };
  const value = () => {
    index += 1; let result = "";
    while (index < text.length) {
      const char = text[index++]; if (char === "]") break;
      if (char === "\\" && index < text.length) { const escaped = text[index++]; if (escaped === "\r" && text[index] === "\n") index += 1; else if (escaped !== "\n") result += escaped; }
      else result += char;
    }
    return result;
  };
  const node = (): SgfNode => {
    index += 1; const props: Record<string, string[]> = {}; skipSpace();
    while (/[A-Za-z]/.test(text[index] ?? "")) {
      let key = ""; while (/[A-Za-z]/.test(text[index] ?? "")) key += text[index++].toUpperCase();
      skipSpace(); props[key] = []; while (text[index] === "[") { props[key].push(value()); skipSpace(); }
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
  while (index < text.length && text[index] !== "(") index += 1;
  return tree();
};

const sgfPosition = (value?: string): Position | null => {
  if (!value || value.length < 2) return null;
  const col = value.charCodeAt(0) - 97, row = value.charCodeAt(1) - 97;
  return row >= 0 && row < 15 && col >= 0 && col < 15 ? { row, col } : null;
};

const hasProp = (props: Record<string, string[]>, key: string) => Object.prototype.hasOwnProperty.call(props, key);
const applySgfAnnotations = (node: RecordNode, props: Record<string, string[]>, warnings: string[], hasMove: boolean) => {
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
      .map((point) => sgfPosition(point))
      .filter((point): point is Position => Boolean(point))
      .map((point) => ({ ...point, kind })));
    node.marks = [...node.marks, ...(props.LB || []).flatMap((value) => {
      const separator = value.indexOf(":");
      const point = sgfPosition(separator >= 0 ? value.slice(0, separator) : value);
      return point ? [{ ...point, kind: "label" as const, label: separator >= 0 ? Array.from(value.slice(separator + 1)).slice(0, 4).join("") : "?" }] : [];
    })];
  }
};

const importSgf = (text: string): ImportResult => {
  const tree = parseSgfTree(text); const document = createDocument(tree.props.GN?.[0] || "导入棋谱");
  document.metadata.black = tree.props.PB?.[0] || "黑方"; document.metadata.white = tree.props.PW?.[0] || "白方";
  document.metadata.event = tree.props.EV?.[0] || ""; document.metadata.date = tree.props.DT?.[0] || document.metadata.date;
  document.metadata.result = tree.props.RE?.[0] || "";
  const rule = (tree.props.RU?.[0] || "").toLowerCase(); document.metadata.rule = rule.includes("free") ? "freestyle" : rule.includes("standard") ? "standard" : "renju";
  const warnings: string[] = [];
  applySgfAnnotations(document.nodes[document.rootId], tree.props, warnings, false);
  const walk = (source: SgfNode, parentId: string, inheritedPlayer: Player = "black") => {
    let currentId = parentId, player = inheritedPlayer; const moveValue = source.props.B?.[0] ?? source.props.W?.[0];
    if (moveValue !== undefined) {
      player = source.props.B ? "black" : "white"; const position = sgfPosition(moveValue);
      if (position) {
        const added = addMove(document, currentId, position); Object.assign(document, added.document); currentId = added.nodeId;
        const current = document.nodes[currentId]; current.move = { ...position, player }; applySgfAnnotations(current, source.props, warnings, true);
      } else warnings.push(`忽略了无法识别的落子坐标：${moveValue}`);
    } else {
      applySgfAnnotations(document.nodes[currentId], source.props, warnings, false);
    }
    source.children.forEach((child) => walk(child, currentId, player === "black" ? "white" : "black"));
  };
  tree.children.forEach((child) => walk(child, document.rootId)); document.updatedAt = new Date().toISOString();
  return { document, warnings, format: "SGF" };
};

const parsePosMoves = (text: string): Position[] => {
  const compact = text.replace(/[,;\s-]+/g, "");
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
const importRenLib = async (source: Blob, title: string): Promise<ImportResult> => {
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
  const nextPlayer: Player[] = ["black"];
  let firstRecord = true;
  let recordCount = 0;
  let moveCount = 0;
  let commentCount = 0;
  let boardTextCount = 0;
  let markedNodeCount = 0;
  let edgeCount = 0, branchCount = 0, maxChildren = 0, maxDepth = 0;
  const nodeDepth: number[] = [0];
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
        const player = nextPlayer[parentIndex] || "black";
        const move = isMove && validPosition; const code = validPosition ? position!.row * 16 + position!.col + 1 : 0;
        const state = move ? 1 | (player === "white" ? 2 : 0) : 0;
        const newIndex = arrays.addNode(parentIndex, move ? code : 0, state, validPosition ? code : 0);
        nodeId = newIndex;
        const previous = arrays.lastChild[parentIndex];
        if (previous < 0) arrays.firstChild[parentIndex] = newIndex;
        else arrays.nextSibling[previous] = newIndex;
        arrays.lastChild[parentIndex] = newIndex;
        arrays.childCount[parentIndex] += 1; edgeCount += 1; if (arrays.childCount[parentIndex] === 2) branchCount += 1; maxChildren = Math.max(maxChildren, arrays.childCount[parentIndex]);
        const depth = (nodeDepth[parentIndex] || 0) + 1; nodeDepth[newIndex] = depth; maxDepth = Math.max(maxDepth, depth);
        if (arrays.preferredChild[parentIndex] < 0) arrays.preferredChild[parentIndex] = newIndex;
        nextPlayer[newIndex] = isMove ? otherPlayer(player) : player;
        if (move) moveCount += 1; recordCount += 1;
      }
    }
    firstRecord = false;
    if (nodeId < 0 || nodeId >= arrays.ids.length) break;

    // RenLib 2.x/3.0 files may carry both bits; the official reader gives old
    // comments precedence, otherwise the payload gets consumed at the wrong
    // byte boundary and every following node becomes garbage.
    if (info & 0x20) {
      const text = await readRenLibNullText(reader, true); arrays.setText(nodeId, text); if (text) commentCount += 1;
    } else if (info & 0x08) {
      const text = await readRenLibNullText(reader, false); arrays.setText(nodeId, text); if (text) commentCount += 1;
    }
    if (extendedFlags & 0x100) {
      const text = await readRenLibNullText(reader, false); arrays.textRefs[nodeId * 2 + 1] = arrays.intern(text); if (text) boardTextCount += 1;
    }
    if (info & 0x10) { arrays.state[nodeId] |= 4; markedNodeCount += 1; }
    if (info & 0x04) arrays.state[nodeId] |= 8;

    // These two transitions intentionally are independent: a node may have a
    // sibling and also be the end of a branch (DOWN + RIGHT).
    if (info & 0x80) branchStack.push(nodeId);
    if (info & 0x40) {
      const branchNodeId = branchStack.pop();
      parentId = branchNodeId !== undefined ? arrays.parent[branchNodeId] ?? 0 : 0;
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
  if (!document.metadata || typeof document.metadata.title !== "string" || typeof document.metadata.black !== "string" || typeof document.metadata.white !== "string" || !["renju", "standard", "freestyle"].includes(document.metadata.rule) || document.metadata.boardSize !== 15) throw new Error("RENJU 文件的棋谱信息不完整或规则无效");
  if (typeof document.createdAt !== "string" || typeof document.updatedAt !== "string" || !Number.isFinite(Date.parse(document.createdAt)) || !Number.isFinite(Date.parse(document.updatedAt))) throw new Error("RENJU 文件的时间信息无效");
  const root = document.nodes[document.rootId];
  if (!root || root.parentId !== null || root.move !== null) throw new Error("RENJU 文件的根节点无效");
  const evaluationKinds: NodeEvaluation[] = ["good", "bad", "doubtful", "interesting", "forced", "only", "study"];
  Object.entries(document.nodes).forEach(([id, node]) => {
    if (!node || node.id !== id || !Array.isArray(node.children) || typeof node.comment !== "string" || !Array.isArray(node.marks)) throw new Error(`RENJU 节点 ${id} 结构无效`);
    if (node.parentId !== null && typeof node.parentId !== "string") throw new Error(`RENJU 节点 ${id} 的父节点无效`);
    if (node.move && (!Number.isInteger(node.move.row) || !Number.isInteger(node.move.col) || node.move.row < 0 || node.move.row >= 15 || node.move.col < 0 || node.move.col >= 15 || !["black", "white"].includes(node.move.player))) throw new Error(`RENJU 节点 ${id} 的落子无效`);
    if (node.evaluation && !evaluationKinds.includes(node.evaluation)) throw new Error(`RENJU 节点 ${id} 的评价无效`);
    if (node.evaluationLevel && node.evaluationLevel !== 1 && node.evaluationLevel !== 2) throw new Error(`RENJU 节点 ${id} 的评价级别无效`);
    node.marks.forEach((mark) => {
      if (!Number.isInteger(mark.row) || !Number.isInteger(mark.col) || mark.row < 0 || mark.row >= 15 || mark.col < 0 || mark.col >= 15 || !["circle", "triangle", "cross", "label"].includes(mark.kind)) throw new Error(`RENJU 节点 ${id} 含有无效棋盘标记`);
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

export const importRecordFile = async (file: File): Promise<ImportResult> => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (extension === "lib") return importRenLib(file, file.name);
  const buffer = await file.arrayBuffer();
  if (extension === "renju" || extension === "json") {
    const parsed = validateJsonDocument(JSON.parse(decodeText(buffer)));
    return { document: parsed, warnings: [], format: "RENJU JSON" };
  }
  const text = decodeText(buffer);
  if (["sgf", "fgf", "ren", "renjs", "wzq"].includes(extension) || text.trimStart().startsWith("(")) return importSgf(text);
  return importPos(text, file.name);
};

const escapeSgf = (value: string) => value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
const escapeSgfSimpleText = (value: string) => escapeSgf(value.replace(/[\t\r\n ]+/g, " ").trim());
const toSgfCoord = ({ row, col }: Position) => `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`;
const evaluationSgf = (node: RecordNode) => {
  if (!node.move || !node.evaluation) return "";
  const level = node.evaluationLevel === 2 ? 2 : 1;
  if (node.evaluation === "good") return `TE[${level}]`;
  if (node.evaluation === "bad") return `BM[${level}]`;
  if (node.evaluation === "doubtful") return "DO[]";
  if (node.evaluation === "interesting") return "IT[]";
  return `XEV[${node.evaluation}]`;
};
const annotationSgf = (node: RecordNode) => {
  const comment = node.comment ? `C[${escapeSgf(node.comment)}]` : "";
  const boardText = node.boardText ? `N[${escapeSgfSimpleText(node.boardText)}]` : "";
  const marks = node.marks.map((mark) => mark.kind === "label" ? `LB[${toSgfCoord(mark)}:${escapeSgf(mark.label || "?")}]` : `${mark.kind === "circle" ? "CR" : mark.kind === "triangle" ? "TR" : "MA"}[${toSgfCoord(mark)}]`).join("");
  return `${boardText}${comment}${evaluationSgf(node)}${marks}`;
};
export const exportSgf = (document: GameDocument) => {
  const nodeText = (node: RecordNode): string => {
    if (!node.move) return "";
    const move = `${node.move.player === "black" ? "B" : "W"}[${toSgfCoord(node.move)}]`;
    const children = node.children.map((id) => document.nodes[id]).filter(Boolean);
    return children.length <= 1 ? `;${move}${annotationSgf(node)}${children[0] ? nodeText(children[0]) : ""}` : `;${move}${annotationSgf(node)}${children.map((child) => `(${nodeText(child)})`).join("")}`;
  };
  const meta = document.metadata, root = document.nodes[document.rootId];
  const props = `(;GM[4]FF[4]CA[UTF-8]AP[RenjuNote:1.0]SZ[15]GN[${escapeSgf(meta.title)}]PB[${escapeSgf(meta.black)}]PW[${escapeSgf(meta.white)}]DT[${escapeSgf(meta.date)}]EV[${escapeSgf(meta.event)}]RE[${escapeSgf(meta.result)}]RU[${meta.rule}]${annotationSgf(root)}`;
  return `${props}${root.children.map((id) => document.nodes[id]).filter(Boolean).map((child, index) => index === 0 ? nodeText(child) : `(${nodeText(child)})`).join("")})`;
};
export const exportJson = (document: GameDocument) => JSON.stringify(document, null, 2);
export const downloadText = (content: string, filename: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type })); const anchor = window.document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const mainLineLength = (document: GameDocument) => {
  let count = 0, node = document.nodes[document.rootId];
  while (node?.children.length) { count += 1; node = document.nodes[node.preferredChildId || node.children[0]]; }
  return count;
};
