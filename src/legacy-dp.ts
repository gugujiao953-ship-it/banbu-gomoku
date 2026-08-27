import { createDocument } from "./game";
import { decodeDpDatabaseFrame, dpCanonicalKey, dpPointTransform, parseDpDatabaseStates, type DpState } from "./formats";
import { buildCompactRenLibIndex, createLazyDocument } from "./compact-index";
import type { ImportResult, Position } from "./types";

const dpKeyString = (key: Uint8Array) => Array.from(key).join(",");
const dpCoordinate = (value: number) => value >= 49 && value <= 57 ? value - 49 : value >= 65 && value <= 70 ? value - 65 + 9 : -1;
const isDpCoordinate = (value: number) => dpCoordinate(value) >= 0;
const decodeDpLabel = (bytes: Uint8Array) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); }
  catch { return new TextDecoder("gb18030").decode(bytes).trim(); }
};

const parseLegacyDpLines = (bytes: Uint8Array) => {
  const marker = new TextEncoder().encode("@BTXT@"); const records: Array<Array<{ position: Position; label: string }>> = [];
  for (let at = bytes.findIndex((v, i) => marker.every((m, j) => bytes[i + j] === m)); at >= 0; ) {
    const next = bytes.findIndex((v, i) => i > at && marker.every((m, j) => bytes[i + j] === m));
    const end = next < 0 ? bytes.length : next; const lines: Array<{ position: Position; label: string }> = [];
    let cursor = at + marker.length;
    while (cursor + 1 < end) {
      if (!isDpCoordinate(bytes[cursor]) || !isDpCoordinate(bytes[cursor + 1])) { cursor += 1; continue; }
      const row = dpCoordinate(bytes[cursor++]), col = dpCoordinate(bytes[cursor++]); const start = cursor;
      while (cursor < end && ![0, 10, 13].includes(bytes[cursor])) cursor += 1;
      lines.push({ position: { row, col }, label: decodeDpLabel(bytes.subarray(start, cursor)) });
      while (cursor < end && [0, 10, 13].includes(bytes[cursor])) cursor += 1;
    }
    if (lines.length) records.push(lines); if (next < 0) break; at = next;
  }
  return records;
};

/**
 * Compatibility-only importer for fixtures from the app's old DP line/tree
 * prototype. Production .db/.dp files must use DpViewSession and query the
 * position index directly; this module is intentionally not imported by App.
 */
export const importLegacyDpDatabase = async (source: Blob, title: string): Promise<ImportResult> => {
  const compressed = new Uint8Array(await source.arrayBuffer());
  const bytes = decodeDpDatabaseFrame(compressed);
  const states = parseDpDatabaseStates(bytes);
  if (!states.size) {
    const legacy = parseLegacyDpLines(bytes); if (!legacy.length) throw new Error("DP 数据库中没有找到可识别的局面记录");
    const document = createDocument(title.replace(/\.[^.]+$/, ""), 15); let records = 0;
    for (const lineSet of legacy) {
      if (lineSet.length < 2) { records += 1; continue; }
      let parentId = document.rootId;
      for (let i = 0; i < lineSet.length; i += 1) {
        const line = lineSet[i], parent = document.nodes[parentId];
        let child = parent.children.map((id) => document.nodes[id]).find((node) => node.move?.row === line.position.row && node.move.col === line.position.col);
        if (!child) {
          const id = `dp-legacy-${records}-${i}`;
          child = { id, parentId, children: [], move: { ...line.position, player: i % 2 ? "white" : "black" }, comment: "", marks: [] };
          document.nodes[id] = child; parent.children.push(id);
        }
        if (line.label) child.boardText = line.label;
        parentId = child.id;
      }
      records += 1;
    }
    document.updatedAt = new Date().toISOString();
    return { document, warnings: [`读取 ${records - 1} 条旧式 DP 测试记录，跳过 1 条不足两步的记录`], format: "DP/DB LZ4 棋谱数据库" };
  }
  const document = createDocument(title.replace(/\.[^.]+$/, ""), 15);
  const rootState = states.get(dpKeyString(new Uint8Array([2, 15, 15])));
  if (!rootState) throw new Error("DP 数据库缺少空局面根记录");
  const childrenByParent = new Map<string, DpState[]>();
  for (const state of states.values()) {
    if (!state.position.some((value) => value)) continue;
    const lastPlayer = state.sideToMove ^ 1;
    for (let row = 0; row < 15; row += 1) for (let col = 0; col < 15; col += 1) {
      const at = row * 15 + col; if (state.position[at] !== lastPlayer + 1) continue;
      const parentPosition = state.position.slice(); parentPosition[at] = 0;
      const parentKey = dpCanonicalKey(parentPosition, lastPlayer as 0 | 1).key;
      const parentState = states.get(dpKeyString(parentKey)); if (!parentState) continue;
      const key = dpKeyString(parentState.key), edges = childrenByParent.get(key) || [];
      if (!edges.some((edge) => edge.key === state.key)) edges.push(state);
      childrenByParent.set(key, edges);
    }
  }
  const queue: Array<{ id: string; state: DpState; board: Uint8Array; transform: number }> = [{ id: document.rootId, state: rootState, board: new Uint8Array(225), transform: 0 }];
  let queueIndex = 0;
  const stateIds = new Map<string, string>();
  let nodeCount = 0, labelCount = 0;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex++], parent = document.nodes[current.id];
    parent.comment = current.state.comment;
    parent.marks = current.state.boardText
      .map((entry) => ({ ...entry, position: dpPointTransform(entry.position, current.transform) }))
      .filter(({ position }) => !current.board[position.row * 15 + position.col])
      .map((entry) => entry.text
        ? ({ ...entry.position, kind: "label" as const, style: "text" as const, label: entry.text, nativeSymmetry: true })
        : ({ ...entry.position, kind: "circle" as const, style: "circle" as const, color: "#777168", nativeSymmetry: true }));
    labelCount += parent.marks.length;
    for (const childState of childrenByParent.get(dpKeyString(current.state.key)) || []) {
      const playerCode = current.state.sideToMove === 0 ? 1 : 2;
      const matches: Array<{ move: Position; transform: number }> = [];
      for (let trans = 0; trans < 8; trans += 1) {
        const transformed = new Uint8Array(225);
        for (let sourceRow = 0; sourceRow < 15; sourceRow += 1) for (let sourceCol = 0; sourceCol < 15; sourceCol += 1) {
          const target = dpPointTransform({ row: sourceRow, col: sourceCol }, trans);
          transformed[target.row * 15 + target.col] = childState.position[sourceRow * 15 + sourceCol];
        }
        const differences: Position[] = []; let compatible = true;
        for (let cell = 0; cell < 225; cell += 1) {
          if (transformed[cell] !== current.board[cell]) {
            if (current.board[cell] !== 0 || transformed[cell] !== playerCode) { compatible = false; break; }
            differences.push({ row: Math.floor(cell / 15), col: cell % 15 });
          }
        }
        if (compatible && differences.length === 1 && !matches.some((candidate) => candidate.move.row === differences[0].row && candidate.move.col === differences[0].col)) matches.push({ move: differences[0], transform: trans });
      }
      for (const { move, transform: childTransform } of matches) {
        const statePathKey = `${current.id}|${dpKeyString(childState.key)}|${move.row},${move.col}`;
        let childId = stateIds.get(statePathKey);
        if (!childId) {
          childId = `dp-${nodeCount++}`; stateIds.set(statePathKey, childId);
          document.nodes[childId] = { id: childId, parentId: current.id, children: [], move: { ...move, player: current.state.sideToMove === 0 ? "black" : "white" }, comment: "", marks: [] };
          const childBoard = current.board.slice(); childBoard[move.row * 15 + move.col] = playerCode;
          queue.push({ id: childId, state: childState, board: childBoard, transform: childTransform });
        }
        if (!parent.children.includes(childId)) parent.children.push(childId);
      }
    }
    parent.preferredChildId = parent.children[0];
  }
  document.updatedAt = new Date().toISOString();
  const warnings = [`按 DP 数据库局面键解析 ${states.size} 条记录，构建 ${Object.keys(document.nodes).length - 1} 个可导航局面`];
  if (labelCount) warnings.push(`保留 ${labelCount} 个原生局面标注，并将记录正文挂到对应局面注释`);
  const compactIndex = buildCompactRenLibIndex(document);
  compactIndex.idPrefix = "dp";
  compactIndex.ids = [document.rootId];
  const counts = Array.from(compactIndex.childCount || []);
  const depths = new Uint16Array(compactIndex.nodeCount);
  let maxDepth = 0;
  for (let index = 0; index < compactIndex.nodeCount; index += 1) {
    const parentIndex = compactIndex.parent[index];
    if (parentIndex >= 0) depths[index] = depths[parentIndex] + 1;
    if (depths[index] > maxDepth) maxDepth = depths[index];
  }
  const stats = {
    nodeCount: compactIndex.nodeCount,
    edgeCount: Math.max(0, compactIndex.nodeCount - 1),
    branchCount: counts.filter((count) => count > 1).length,
    maxChildren: counts.length ? Math.max(...counts) : 0,
    maxDepth,
  };
  const { nodes: _nodes, ...base } = document;
  return { document: createLazyDocument(base, compactIndex), compactIndex, warnings, format: "DP/DB LZ4 棋谱数据库", stats };
};
