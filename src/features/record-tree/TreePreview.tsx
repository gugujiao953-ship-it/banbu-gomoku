import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { boardAt, coordinateName } from "../../game";
import type { BoardTheme } from "../../app-shell-types";
import type { CompactRenLibIndex, GameDocument, RecordNode } from "../../types";

/**
 * 棋谱预览（用户 09-20：去掉侧栏列表，改成「点到哪个分支点就显示那个局面」的预览）。
 *
 * 只画棋盘与当前手：不渲染手数、不渲染标注，所以几百个节点也只是重画一张 SVG。
 * 默认收起——需要看盘面时点开，面板其余部分（图谱）不被挤走。
 */
export interface TreePreviewProps {
  document: GameDocument;
  /** 选中节点（没有选中就退回当前局面）。 */
  node: RecordNode | undefined;
  compactIndex?: CompactRenLibIndex;
  open: boolean;
  onToggle: () => void;
  /** 图谱使用独立的「棋盘预览 / 节点操作」选项行。 */
  hideHeader?: boolean;
  /** Numbered next moves, restricted to the navigator's current page. */
  candidates?: readonly { node: RecordNode; number: number }[];
  onCandidate?: (id: string) => void;
  busy?: boolean;
}

const BOARD_SIZE = 15;
const PREVIEW_SIZE = 200;
const PADDING = 10;
const BOARD_THEME_KEY = "banbu-board-theme-v1";
/** 与 App 的棋盘主题同一份取值（app-shell-types 的 BoardTheme 联合类型）。 */
const BOARD_THEMES = ["wood", "jade", "notebook", "emerald", "porcelain", "whitejade", "walnut", "frosted", "circuit", "minimal", "blackgold", "pale", "kawaii", "aurora"] as const satisfies readonly BoardTheme[];
const storedBoardTheme = (): BoardTheme => {
  try {
    const value = localStorage.getItem(BOARD_THEME_KEY);
    return BOARD_THEMES.find((theme) => theme === value) ?? "wood";
  } catch { return "wood"; }
};

export function TreePreview(props: TreePreviewProps) {
  const boardSize = props.document.metadata.boardSize || BOARD_SIZE;
  const starPoints = boardSize === 15 ? [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]] : boardSize === 19 ? [[3, 3], [3, 15], [9, 9], [15, 3], [15, 15]] : [[Math.floor(boardSize / 2), Math.floor(boardSize / 2)]];
  const cell = (PREVIEW_SIZE - PADDING * 2) / Math.max(1, boardSize - 1);
  const at = (index: number) => PADDING + index * cell;
  const stoneRadius = Math.max(2.4, cell * 0.42);
  const boardTheme = useMemo(storedBoardTheme, []);

  const board = useMemo(() => {
    if (!props.open || !props.node) return null;
    try {
      return boardAt(props.document, props.node.id);
    } catch {
      // 大型懒加载谱里节点可能还没读回来：预览留空，不抛错打断面板
      return null;
    }
  }, [props.document, props.node, props.open]);

  const title = props.node
    ? props.node.move
      ? coordinateName(props.node.move, boardSize)
      : props.node.passPlayer
        ? `${props.node.passPlayer === "black" ? "黑" : "白"}方过手`
        : props.node.setup
          ? "设置局面"
          : "起始局面"
    : "未选中";

  return <section className={`tree-preview ${props.open ? "open" : ""}`} aria-label="棋谱预览">
    {!props.hideHeader && <button type="button" className="tree-preview-head" onClick={props.onToggle} aria-expanded={props.open}>
      {props.open ? <ChevronDown/> : <ChevronRight/>}
      <b>{props.candidates ? "局面与候选" : "棋谱预览"}</b>
      <small>{title}{props.node?.boardText?.trim() ? ` · ${props.node.boardText.trim()}` : ""}</small>
    </button>}
    {props.open && <div className="tree-preview-body">
      {/* 左边注释、右边棋盘（用户 09-23）：DOM 顺序就是视觉顺序，窄屏退回上下排列时
          也是「注释在上、棋盘在下」——两边顺序始终一致，不用 order 之类的手段。 */}
      <p className="tree-preview-meta">{props.node ? <><b>{title}</b>{props.node.comment?.trim() ? <span>{props.node.comment.trim().slice(0, 120)}</span> : <span>没有注释</span>}</> : <span>点图谱里的节点，这里显示那个局面。</span>}</p>
      {board ? <svg className={`tree-preview-board board-${boardTheme}`} width="100%" viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`} role={props.candidates ? "group" : "img"} aria-label={`局面预览：${title}`}>
        <rect className="board-bg" x="0" y="0" width={PREVIEW_SIZE} height={PREVIEW_SIZE} rx="8"/>
        <g className="grid-lines">
          {Array.from({ length: boardSize }, (_value, index) => <line key={`h${index}`} x1={at(0)} y1={at(index)} x2={at(boardSize - 1)} y2={at(index)}/>)}
          {Array.from({ length: boardSize }, (_value, index) => <line key={`v${index}`} x1={at(index)} y1={at(0)} x2={at(index)} y2={at(boardSize - 1)}/>)}
        </g>
        <g className="tree-preview-stars">{starPoints.map(([row, col]) => <circle key={`${row}-${col}`} cx={at(col)} cy={at(row)} r={Math.max(1.2, cell * 0.1)}/> )}</g>
        <g>{board.flatMap((rowCells, row) => rowCells.map((value, col) => value
          ? <circle key={`${row}-${col}`} className={`stone ${value}`} cx={at(col)} cy={at(row)} r={stoneRadius}/>
          : null))}</g>
        {props.node?.move && <circle className="last-dot" cx={at(props.node.move.col)} cy={at(props.node.move.row)} r={Math.max(1.6, cell * 0.14)}/>}
        {props.candidates?.map(({ node, number }) => {
          const move = node.move;
          if (!move || move.row < 0 || move.col < 0 || move.row >= boardSize || move.col >= boardSize || board[move.row]?.[move.col]) return null;
          return <g key={node.id} className="tree-preview-candidate" transform={`translate(${at(move.col)} ${at(move.row)})`} role="button" tabIndex={props.busy ? -1 : 0} aria-disabled={props.busy || undefined} aria-label={`落点 ${coordinateName(move, boardSize)}，候选 ${number}`} onClick={() => { if (!props.busy) props.onCandidate?.(node.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!props.busy) props.onCandidate?.(node.id); } }}>
            <title>{coordinateName(move, boardSize)} · {node.boardText || `候选 ${number}`}</title>
            <circle r={cell * 0.48}/><text y="0.5" style={{ fontSize: Math.max(5, cell * 0.6) }}>{number}</text>
          </g>;
        })}
      </svg> : <p className="tree-preview-empty">这个局面的盘面还没读回来（大型棋谱按需加载）。</p>}
    </div>}
  </section>;
}
