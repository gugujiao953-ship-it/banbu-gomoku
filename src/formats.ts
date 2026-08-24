import { addMove, createDocument, toggleMark } from "./game";
import type { GameDocument, ImportResult, NodeEvaluation, Player, Position, RecordNode } from "./types";

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

/**
 * RenLib's .lib stream is a compact pre-order traversal. Each node is stored
 * as a position byte plus a flags byte; DOWN pushes the current branch before
 * descending, while RIGHT pops back to the next sibling. The format is
 * documented by the open-source RenLib reader and has a 20-byte `RenLib`
 * header in modern files.
 */
const importRenLib = (buffer: ArrayBuffer, title: string): ImportResult => {
  const bytes = new Uint8Array(buffer);
  const modernHeader = [0xff, 82, 101, 110, 76, 105, 98, 0xff];
  const isModern = bytes.length >= 20 && modernHeader.every((value, index) => bytes[index] === value);
  let cursor = 0;
  const warnings: string[] = [];
  if (isModern) {
    const major = bytes[8], minor = bytes[9];
    if (major * 100 + minor > 304) throw new Error(`暂不支持 RenLib ${major}.${minor}（当前最高支持 3.4）`);
    cursor = 20;
  } else if (bytes[0] !== 0x78) {
    throw new Error("文件没有有效的 RenLib 头（FF RenLib FF）");
  } else {
    warnings.push("这是旧版无头 RenLib 文件，已按兼容模式读取");
  }

  let document = createDocument(title.replace(/\.[^.]+$/, ""));
  let parentId = document.rootId;
  const branchStack: string[] = [];
  const depths = new Map<string, number>([[document.rootId, 0]]);
  let firstRecord = true;
  let moveCount = 0;
  let commentCount = 0;
  const readPair = () => {
    if (cursor + 1 >= bytes.length) return null;
    return [bytes[cursor++], bytes[cursor++]] as const;
  };
  const readText = (oldFormat: boolean) => {
    let text = "";
    while (true) {
      const pair = readPair();
      if (!pair) break;
      for (const raw of pair) {
        if (!oldFormat && raw === 0) return text;
        if (oldFormat && raw & 0x80) return text + String.fromCharCode(raw & 0x7f);
        text += String.fromCharCode(raw);
      }
    }
    return text;
  };

  while (cursor < bytes.length) {
    const pair = readPair();
    if (!pair) break;
    const [positionByte, info] = pair;
    let extended = 0;
    if (info & 0x01) {
      const extension = readPair();
      if (!extension) break;
      extended = (extension[0] << 8) | extension[1];
    }
    const position = positionByte === 0 ? null : {
      col: (positionByte % 16) - 1,
      row: Math.floor(positionByte / 16),
    };
    let nodeId = parentId;
    const validPosition = position && position.col >= 0 && position.col < 15 && position.row >= 0 && position.row < 15;
    const isMove = (info & 0x02) === 0;
    if (!(firstRecord && !validPosition) && isMove && validPosition) {
      const parent = document.nodes[parentId];
      const existingId = parent.children.find((id) => {
        const move = document.nodes[id]?.move;
        return move?.row === position.row && move.col === position.col;
      });
      if (existingId) nodeId = existingId;
      else {
        nodeId = `renlib-${document.id}-${moveCount.toString(36)}`;
        const depth = (depths.get(parentId) || 0) + 1;
        document.nodes[nodeId] = { id: nodeId, parentId, children: [], move: { ...position, player: depth % 2 ? "black" : "white" }, comment: "", marks: [] };
        parent.children.push(nodeId);
        if (!parent.preferredChildId) parent.preferredChildId = nodeId;
        depths.set(nodeId, depth); moveCount += 1;
      }
    } else if (isMove && !validPosition) {
      warnings.push(`跳过无效 RenLib 坐标字节：${positionByte}`);
    }
    firstRecord = false;
    const node = document.nodes[nodeId];
    if (info & 0x08) {
      node.comment = readText(false);
      if (node.comment) commentCount += 1;
    } else if (info & 0x20) {
      node.comment = readText(true);
      if (node.comment) commentCount += 1;
    }
    if (extended & 0x100) readText(false);
    if (info & 0x10 && validPosition) node.marks = toggleMark(node.marks, position);
    if (info & 0x80) {
      branchStack.push(parentId);
      parentId = nodeId;
    } else if (info & 0x40) {
      parentId = branchStack.pop() || document.rootId;
    } else if (nodeId !== document.rootId) {
      parentId = nodeId;
    }
  }
  if (!moveCount) throw new Error("RenLib 文件中没有可识别的落子");
  document.updatedAt = new Date().toISOString();
  if (commentCount) warnings.push(`已读取 ${commentCount} 个节点注释`);
  return { document, warnings, format: "RenLib LIB" };
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
  const buffer = await file.arrayBuffer();
  if (extension === "lib") return importRenLib(buffer, file.name);
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
