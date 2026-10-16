import { coordinateName, parseCoordinate } from "../../game";
import type { BoardMarkKind, GameDocument } from "../../types";

/**
 * 分支树搜索（用户 09-26：「加入搜索功能，可以一键搜索到哪一步、哪个注释、哪个标注什么的…
 * 有多个名字一样的，就从近到远可以一个个的看，就像 Word 文档里面的查找功能一样」）。
 *
 * 抽出纯函数是为了能脱离 React 单测：面板只负责把命中画出来、按「下一个」跳过去。
 *
 * 三件事在这里定死：
 *  1. **搜什么**：手数（「41」/「第 41 手」）、坐标（「H8」）、注释（注释 + 盘面文字 +
 *     分支名）、标注（标注的中文名「三角」「叉号」、标注所在坐标、以及泛搜「标注」）。
 *  2. **排序**：以「问的时候我在第几手」为锚，命中按 |手数差| 从小到大——用户要的
 *     「从近到远」；同样近的两处按手数先后排（稳定，再远也不会跳来跳去）。
 *     锚点在**输入查询的那一刻固定**：不固定的话，「跳过去 → 当前手变了 → 重排 →
 *     又跳到别处」会自激成无限跳（Word 的查找不会因为你跳到命中处就换个顺序）。
 *  3. **一个节点算一条**：同一个节点既命中坐标又命中注释时合成一条（kinds 列出全部），
 *     否则「下一个」会在同一个节点上停两次。
 */

export type NodeSearchKind = "turn" | "coordinate" | "comment" | "mark";

export const NODE_SEARCH_KIND_LABELS: Record<NodeSearchKind, string> = {
  turn: "手数", coordinate: "坐标", comment: "注释", mark: "标注",
};

/** 标注中文名与标注栏一致（`src/annotation-presets.ts` 的样式名），搜索按这套词匹配。 */
export const MARK_KIND_LABELS: Record<BoardMarkKind, string> = {
  circle: "圆圈", triangle: "三角", square: "方块", cross: "叉号", check: "对勾", label: "文字",
};

/** 泛搜词：输入「标注」列出所有带标注的节点（用户说的「哪个标注什么的」）。 */
const MARK_ANY = "标注";

/** 索引上限：懒加载谱可能挂进来成万个节点，搜索结果没必要那么多（超了在列表里如实说）。 */
const MAX_INDEX_NODES = 20000;
/** 命中上限：再多也不会有人一个个翻，列表里写明「只列前 N 个」。 */
export const MAX_SEARCH_HITS = 300;

interface NodeSearchMark {
  /** 中文名（三角/叉号…）。 */
  label: string;
  /** 标注所在坐标（H8）。 */
  coord: string;
  /** 标注自身的文字内容（style = 文字时用）。 */
  text: string;
}

export interface NodeSearchEntry {
  id: string;
  /** 手数（0 = 起始局面这类没有着法的节点）。 */
  turn: number;
  /** 落子坐标，没有着法时为空串。 */
  coord: string;
  /** 注释 + 盘面文字，拼在一起做子串匹配。 */
  text: string;
  /** 分支显示名（用户重命名过的），也参与注释类匹配。 */
  branch: string;
  marks: NodeSearchMark[];
}

export interface NodeSearchIndex {
  entries: NodeSearchEntry[];
  /** 节点数超上限被截断：搜索结果不是全谱范围。 */
  truncated: boolean;
}

export interface NodeSearchHit {
  id: string;
  turn: number;
  kinds: NodeSearchKind[];
  /** 给用户看的命中说明：坐标、标注名、或注释里那一段原文。 */
  detail: string;
}

const coordOf = (row: number, col: number, boardSize: number) => coordinateName({ row, col }, boardSize);

/**
 * 按**先序**（父在子前、兄弟按 children 顺序）把整份棋谱走一遍，顺手算出手数。
 * 用显式栈而不是递归：长谱（几千手）递归会顶爆调用栈。
 */
export const buildNodeSearchIndex = (document: GameDocument, branchNameOverrides?: Record<string, string>): NodeSearchIndex => {
  const boardSize = document.metadata.boardSize || 15;
  const entries: NodeSearchEntry[] = [];
  const seen = new Set<string>();
  const stack: { id: string; turn: number }[] = [{ id: document.rootId, turn: 0 }];
  while (stack.length) {
    const frame = stack.pop() as { id: string; turn: number };
    if (seen.has(frame.id)) continue;
    const node = document.nodes[frame.id];
    if (!node) continue;
    seen.add(frame.id);
    if (entries.length >= MAX_INDEX_NODES) continue;
    const turn = frame.turn + (node.move || node.passPlayer ? 1 : 0);
    entries.push({
      id: frame.id,
      turn,
      coord: node.move ? coordOf(node.move.row, node.move.col, boardSize) : "",
      text: [node.comment, node.boardText].filter(Boolean).join("\n"),
      branch: branchNameOverrides?.[frame.id]?.trim() || "",
      marks: node.marks.map((mark) => ({
        label: MARK_KIND_LABELS[mark.kind] || "",
        coord: coordOf(mark.row, mark.col, boardSize),
        text: mark.label?.trim() || "",
      })),
    });
    // 反向压栈：出栈顺序才是 children 的书写顺序（先序＝文档顺序）。
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ id: node.children[index], turn });
    }
  }
  return { entries, truncated: entries.length >= MAX_INDEX_NODES };
};

/** 「H8」这类坐标查询：按当前路数接受 A–Z、AA–AD 等列名，越界的不当坐标解。 */
const asCoordinate = (query: string, boardSize: number): string | null => {
  const position = parseCoordinate(query, boardSize);
  return position ? coordinateName(position, boardSize) : null;
};

/** 「41」「第41手」这类手数查询。 */
const asTurn = (query: string): number | null => {
  const found = query.match(/^第?\s*(\d{1,4})\s*手?$/);
  return found ? Number(found[1]) : null;
};

export const searchNodes = (document: GameDocument, index: NodeSearchIndex, query: string, anchorTurn: number, limit = MAX_SEARCH_HITS): NodeSearchHit[] => {
  const text = query.trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  const boardSize = document.metadata.boardSize || 15;
  const turnQuery = asTurn(text);
  const coordQuery = asCoordinate(text, boardSize);
  const hits: NodeSearchHit[] = [];
  for (const entry of index.entries) {
    const kinds: NodeSearchKind[] = [];
    const details: string[] = [];
    if (turnQuery !== null && entry.turn === turnQuery) { kinds.push("turn"); details.push(`第 ${entry.turn} 手`); }
    if (entry.coord && (entry.coord === coordQuery || (!coordQuery && entry.coord.toLowerCase() === lower))) { kinds.push("coordinate"); details.push(entry.coord); }
    if (entry.text.toLowerCase().includes(lower) || entry.branch.toLowerCase().includes(lower)) {
      kinds.push("comment");
      const source = entry.branch && !entry.text.toLowerCase().includes(lower) ? entry.branch : entry.text;
      const at = source.toLowerCase().indexOf(lower);
      details.push(at >= 0 ? source.slice(Math.max(0, at - 6), at + text.length + 8).replace(/\s+/g, " ").trim() : source.slice(0, 20));
    }
    const marks: string[] = [];
    for (const mark of entry.marks) {
      if (coordQuery && mark.coord === coordQuery) marks.push(`${mark.label} ${mark.coord}`);
      else if (mark.label.includes(text) || mark.text.toLowerCase().includes(lower) || text === MARK_ANY) marks.push(`${mark.label} ${mark.coord}`);
    }
    if (marks.length) { kinds.push("mark"); details.push(marks.slice(0, 3).join("、")); }
    if (kinds.length) hits.push({ id: entry.id, turn: entry.turn, kinds, detail: details.join(" · ") });
  }
  // 「从近到远」：离锚点（输入查询时所在的那一手）越近越靠前；同样近按手数先后。
  hits.sort((left, right) => Math.abs(left.turn - anchorTurn) - Math.abs(right.turn - anchorTurn) || left.turn - right.turn);
  return hits.slice(0, limit);
};
