import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Bot, Check, ChevronDown, ChevronFirst, ChevronLast, ChevronLeft,
  ChevronRight, CircleHelp, Code2, Download, FilePlus2, FlipHorizontal, FolderOpen, FolderPlus, GitBranch,
  Home, Info, Layers3, Library, Lock, ListTree, Menu, MessageSquareText, MoreHorizontal, RotateCw, Search, Tag,
  PenLine, Redo2, Save, Settings, Trash2, Undo2, Upload, X,
} from "lucide-react";
import {
  addMove, addMoveAs, boardAt, coordinateName, createDocument, deleteVariation, depthOf, isSupportedBoardSize,
  forbiddenPoints, forbiddenReason, lastOnPreferredLine, nextPlayerAt, otherPlayer, pathToNode, preferredNext, setLabelMark, toggleMark, updateNode, winningLinesAt,
} from "./game";
import { analyzeCandidates } from "./analysis";
import { downloadFile, exportJson, exportPos, exportSgf, importRecordFile, mainLineLength } from "./formats";
import { recognizeBoardImage } from "./image-recognition";
import { findPositionMatches, positionKey } from "./position-search";
import { loadActive, loadDraftFromLocal, loadLibrary, removeDraftFromLocal, removeFromLibrary, renameInLibrary, saveDraftToLocal, saveManyToLibrary, saveToLibrary } from "./storage";
import { commitDraftAsDerivedVersion, documentFingerprint, loadDraftForDocument, loadLargeDocument, loadLargeSummaries, removeDraftForDocument, removeLargeDocument, renameLargeDocument, saveCompactIndex, saveDraftForDocument, saveLargeDocument } from "./large-storage";
import { openLibraryHandle } from "./library-engine";
import { isPagedLibraryView, LibraryViewSession } from "./library-view-adapter";
import { DpViewSession, isDpDatabaseView } from "./dp-view-session";
import { RenLibWebViewSession, isRenLibWebView } from "./renlib-web/renlib-web-view-session";
import { compactBranchCount, compactChildCount, compactChildWindow, compactDiagnostics, compactFirstBranchNodeId, compactIndexOf, compactNodeCount, compactNodeIndex, compactSearch, createLazyDocument } from "./compact-index";
import { formatRenLibWebLabel, renLibDisplayMark } from "./renlib-display";
import { createEditableViewCopy, findVisibleVariationTarget, visibleVariationPivot } from "./record-editing";
import { clearDefaultDirectoryHandle, loadDefaultDirectoryHandle, pickDefaultDirectoryHandle, supportsDirectoryPicker, writeFileToDirectory, type DirectoryHandleLike } from "./file-destination";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, hasDraft, overlayChildren, overlayNode, overlayPreferredChild, projectedDocument, pushDraft, undoDraft, type DraftState, type DraftOperation as DraftOp } from "./draft-operations";
import type { CompactRenLibIndex } from "./types";
import type { LargeDocumentSummary } from "./large-storage";
import VcfWorker from "./vcf.worker?worker";
import RecordImportWorker from "./record-import.worker?worker";
import { verifyVcfProof } from "./vcf";
import type { BoardMark, BoardMarkStyle, GameDocument, ImportResult, OpeningRule, Player, Position, RecordNode, RecordSourceFormat } from "./types";
import type { VcfResult } from "./vcf";
import PuzzleAiWorker from "./puzzle-ai.worker?worker";
import { winnerAt } from "./puzzle-ai";
import type { AiMoveResult } from "./puzzle-ai";
import { createPuzzleDocument, importKaibaoPuzzleJson, loadNativeKaibaoCollections, loadPuzzleCollections, loadPuzzleProgress, puzzleProgressKey, savePuzzleCollections, savePuzzleProgress, savePuzzleTitleOverride } from "./puzzles";
import type { Puzzle, PuzzleCollection } from "./puzzles";
import { addFifthCandidate, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, isDistinctFifthCandidate, openingInstruction, openingPositionAllowed, openingRuleName, suggestFifthCandidates, suggestOpeningPlacement, type OpeningSession, type OpeningStage } from "./opening-rules";

type Tab = "record" | "library" | "settings";
type AppMode = "record" | "puzzle";
type Sheet = "comment" | "branches" | "metadata" | "save" | "folder" | "rename" | "export" | "help" | "about" | "find" | "analysis" | "positionSearch" | "marks" | "import" | "aiGame" | "think" | null;
type DockPanel = "moves" | "notes" | "view" | "play" | "puzzles" | null;
type LibrarySection = "puzzles" | "records";
type LibraryRenameTarget =
  | { kind: "record-folder"; name: string }
  | { kind: "puzzle-folder"; name: string }
  | { kind: "record"; id: string; name: string }
  | { kind: "large-record"; id: string; name: string }
  | { kind: "puzzle-collection"; id: string; name: string }
  | { kind: "puzzle"; collectionId: string; id: string; name: string };
interface ParsedImport { result: ImportResult; summary?: LargeDocumentSummary; compactIndex?: CompactRenLibIndex }
const isDynamicDatabaseView = (document: GameDocument) => isDpDatabaseView(document) || isRenLibWebView(document);

interface LibraryFolders {
  recordFolders: string[];
  puzzleFolders: string[];
  recordAssignments: Record<string, string>;
  puzzleAssignments: Record<string, string>;
}

interface BranchBookmark { id: string; name: string; nodeId: string; createdAt: string }
type BranchBookmarks = Record<string, BranchBookmark[]>;
interface AiGameState { humanPlayer: Player; aiPlayer: Player; forbiddenEnabled: boolean; outcome: "won" | "lost" | "draw" | null; opening: OpeningSession }
const BRANCH_BOOKMARKS_KEY = "renju-note-branch-bookmarks-v1";
const loadBranchBookmarks = (): BranchBookmarks => {
  try {
    const value = JSON.parse(localStorage.getItem(BRANCH_BOOKMARKS_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
};

const symmetryPoint = (point: Position, transform: number, size: number): Position => {
  let x = point.col, y = point.row;
  if (transform >= 4) y = size - 1 - y;
  const turns = transform >= 4 ? transform - 4 : transform;
  for (let turn = 0; turn < turns; turn += 1) [x, y] = [size - 1 - y, x];
  return { row: y, col: x };
};

const symmetricMarksForDisplay = (marks: BoardMark[], board: ReturnType<typeof boardAt>, size: number) => {
  const displayed = new Map<string, BoardMark>();
  for (const mark of marks) displayed.set(`${mark.row},${mark.col}`, mark);
  for (const mark of marks) {
    if (!mark.nativeSymmetry) continue;
    for (let transform = 1; transform < 8; transform += 1) {
      const point = symmetryPoint(mark, transform, size);
      const key = `${point.row},${point.col}`;
      if (!board[point.row]?.[point.col] && !displayed.has(key)) displayed.set(key, { ...mark, ...point });
    }
  }
  // User-created marks on an imported DP node remain local and take priority.
  for (const mark of marks) if (!mark.nativeSymmetry) displayed.set(`${mark.row},${mark.col}`, mark);
  return [...displayed.values()];
};

const LIBRARY_FOLDERS_KEY = "renju-note-library-folders-v1";
const DEFAULT_DOCUMENT_KEY = "renju-note-default-v1";
const ACTIVE_LARGE_RECORD_KEY = "banbu-active-large-record-v1";
const MAX_OTHER_RECORD_BYTES = 64 * 1024 * 1024;
const defaultLibraryFolders: LibraryFolders = {
  recordFolders: ["未分类"],
  puzzleFolders: ["内置题库", "我的题库"],
  recordAssignments: {},
  puzzleAssignments: {},
};
const loadLibraryFolders = (): LibraryFolders => {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARY_FOLDERS_KEY) || "null") as Partial<LibraryFolders> | null;
    if (!value) return defaultLibraryFolders;
    return {
      recordFolders: value.recordFolders?.length ? value.recordFolders : defaultLibraryFolders.recordFolders,
      puzzleFolders: value.puzzleFolders?.length ? value.puzzleFolders : defaultLibraryFolders.puzzleFolders,
      recordAssignments: value.recordAssignments || {},
      puzzleAssignments: value.puzzleAssignments || {},
    };
  } catch { return defaultLibraryFolders; }
};

const markKindLabel = (mark: BoardMark) => mark.kind === "label" ? (mark.label || "文字标注") : mark.kind === "circle" ? "圆圈" : mark.kind === "triangle" ? "三角" : "叉号";
const nodeMarksText = (marks: BoardMark[]) => marks.flatMap((mark) => [coordinateName(mark), mark.label || "", markKindLabel(mark)]).join(" ");
const nodeKindLabel = (node: RecordNode) => node.move
  ? coordinateName(node.move)
  : node.passPlayer ? `${node.passPlayer === "black" ? "黑" : "白"}方过手`
  : node.setup ? "设置局面"
  : node.parentId ? "注释节点" : "起始局面";
const nativeAnnotationText = (node: Pick<RecordNode, "renLibAnnotations">) => (node.renLibAnnotations || [])
  .filter((annotation) => Boolean(annotation.text))
  .map((annotation) => `${annotation.kind === "board-text" ? "局面文字" : annotation.kind === "one-line-comment" ? "单行注释" : annotation.kind === "multi-line-comment" ? "多行注释" : "原生标记"}：${annotation.text}`);
const annotationLines = (node: Pick<RecordNode, "comment" | "renLibAnnotations" | "marks">) => {
  const native = nativeAnnotationText(node);
  const nativeComment = node.renLibAnnotations?.some((annotation) => (annotation.kind === "one-line-comment" || annotation.kind === "multi-line-comment") && annotation.text === node.comment);
  const labels = (node.marks || []).filter((mark) => mark.label).map((mark) => `${coordinateName(mark)}：${mark.label}`);
  return [...(node.comment && !nativeComment ? [`当前注释：${node.comment}`] : []), ...native, ...labels];
};
// Candidate labels/points belong to the position being displayed, not to the
// move that just landed. Counting them here made the comment indicator appear
// on every imported DP move (and made the panel show coordinate-like noise).
// Only actual node comments and native textual annotations make a move
// expandable.
const hasNativeAnnotation = (node: Pick<RecordNode, "comment" | "renLibAnnotations">) => Boolean(node.comment || node.renLibAnnotations?.some((annotation) => annotation.text));

const branchCount = (document: GameDocument) => compactBranchCount(document) ?? Object.values(document.nodes).filter((node) => node.children.length > 1).length;
const safeName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名棋谱";
const sourceFormatOf = (filename: string): RecordSourceFormat | undefined => {
  const extension = filename.split(".").pop()?.toLowerCase();
  return (["sgf", "fgf", "ren", "renjs", "wzq", "json", "renju", "pos", "txt", "lib", "dp", "db"] as const).find((format) => format === extension);
};
const sgfSourceFormats = new Set<RecordSourceFormat>(["sgf", "fgf", "ren", "renjs", "wzq"]);
const jsonSourceFormats = new Set<RecordSourceFormat>(["json", "renju"]);
const posSourceFormats = new Set<RecordSourceFormat>(["pos", "txt"]);
const binarySourceFormats = new Set<RecordSourceFormat>(["lib", "dp", "db"]);
const variationPreview = (document: GameDocument, nodeId: string, limit = 5) => {
  const result: string[] = [];
  let cursor = document.nodes[nodeId];
  while (cursor && cursor.children.length && result.length < limit) {
    const nextId = cursor.preferredChildId && cursor.children.includes(cursor.preferredChildId) ? cursor.preferredChildId : cursor.children[0];
    const next = document.nodes[nextId];
    if (!next) break;
    if (next.move) result.push(coordinateName(next.move));
    else if (next.passPlayer) result.push(`${next.passPlayer === "black" ? "黑" : "白"}过手`);
    else if (next.setup) result.push("设置局面");
    else result.push("注释节点");
    cursor = next;
  }
  return result.join(" · ");
};

const BRANCH_ROW_HEIGHT = 76;
const BRANCH_OVERSCAN = 4;

const Board = memo(function Board({ document, currentId, currentBookmarked = false, showNumbers, showCoordinates, largeBoard, rotation, mirrored, initialDepth = 0, disabled = false, forbiddenMarkers = [], winningLines = [], openingCandidates = [], openingStage, thinkingMove, onPlay, onMark }: {
  document: GameDocument; currentId: string; showNumbers: boolean; showCoordinates: boolean; largeBoard: boolean;
  currentBookmarked?: boolean;
  rotation: 0 | 90 | 180 | 270; mirrored: boolean;
  initialDepth?: number; disabled?: boolean;
  forbiddenMarkers?: Array<Position & { reason: string }>;
  winningLines?: Position[][];
  openingCandidates?: Position[];
  openingStage?: OpeningStage;
  thinkingMove?: Position | null;
  onPlay: (position: Position) => void; onMark: (position: Position) => void;
}) {
  const safeCurrentId = document.nodes[currentId] ? currentId : document.rootId;
  const board = useMemo(() => boardAt(document, safeCurrentId), [document, safeCurrentId]);
  const path = useMemo(() => pathToNode(document, safeCurrentId), [document, safeCurrentId]);
  let turn = 0;
  const numbers = new Map<string, number | undefined>();
  path.forEach((node) => {
    if (node.move || node.passPlayer) turn += 1;
    if (node.move) numbers.set(`${node.move.row},${node.move.col}`, turn > initialDepth ? turn - initialDepth : undefined);
  });
  const current = document.nodes[currentId] || document.nodes[document.rootId] || { id: document.rootId, parentId: null, children: [], move: null, comment: "", marks: [] };
  const boardSize = document.metadata.boardSize || 15;
  const winningStoneKeys = useMemo(() => new Set(winningLines.flat().map((point) => `${point.row},${point.col}`)), [winningLines]);
  const forbiddenByPoint = useMemo(() => new Map(forbiddenMarkers.map((point) => [`${point.row},${point.col}`, point.reason])), [forbiddenMarkers]);
  const displayMarks = useMemo(() => symmetricMarksForDisplay(current.marks, board, boardSize), [current.marks, board, boardSize]);
  const nativeDisplayMarks = useMemo(() => displayMarks.filter((mark) => mark.renLibNativeLabel), [displayMarks]);
  const userDisplayMarks = useMemo(() => displayMarks.filter((mark) => !mark.renLibNativeLabel), [displayMarks]);
  // RenLib/爱五子棋 shows the children of the current position directly on
  // the board as small variation points. Keep this separate from user marks:
  // a branch point is a stored move, while a mark is an annotation.
  const variationNodes = useMemo(() => {
    const pivot = visibleVariationPivot(document, current.id) || current;
    const index = compactIndexOf(document);
    const pivotIndex = index && pivot ? compactNodeIndex(document, pivot.id) : undefined;
    // When the document is a projected document (viewDocument with overlay baked in),
    // use the document's children directly instead of compactChildWindow, which
    // doesn't see draft-added children.
    const isProjected = (document.nodes as any).__isProjected;
    const ids = isProjected
      ? (pivot?.children || []).slice(0, 513)
      : index && pivotIndex !== undefined
        ? compactChildWindow(index, pivotIndex, 0, 513)
        : (pivot?.children || []).slice(0, 513);
    return ids.filter((id) => id !== current.id).slice(0, 512).map((id) => document.nodes[id])
      .filter((node): node is NonNullable<typeof node> => Boolean(node?.move || node?.anchor));
  }, [current, document]);
  const boardTextNodes = useMemo(() => {
    const seen = new Set<string>();
    return variationNodes.filter((node) => {
      const point = node.anchor;
      if (node.move || !point || !node.boardText || board[point.row][point.col]) return false;
      const key = [point.row, point.col, node.boardText].join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 128);
  }, [board, variationNodes]);
  const isNativeRenLib = isRenLibWebView(document);
  const longPressTimer = useRef<number | null>(null);
  const suppressedClickPoint = useRef<Position | null>(null);
  const margin = 34, gap = 504 / Math.max(1, boardSize - 1), end = margin + gap * (boardSize - 1);
  const starPoints = boardSize === 15 ? [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]] : boardSize === 19 ? [[3, 3], [3, 15], [9, 9], [15, 3], [15, 15]] : [[Math.floor(boardSize / 2), Math.floor(boardSize / 2)]];
  return (
    <div className={`board-scroller ${largeBoard ? "is-large" : ""}`}>
      <svg className="renju-board" viewBox="0 0 572 572" role="grid" aria-label={`${boardSize}路五子棋棋盘`} style={{ transform: `${mirrored ? "scaleX(-1) " : ""}rotate(${rotation}deg)` }}>
        <defs>
          <radialGradient id="blackStone" cx="30%" cy="24%"><stop offset="0" stopColor="#5b5a55"/><stop offset=".42" stopColor="#242420"/><stop offset="1" stopColor="#090a09"/></radialGradient>
          <radialGradient id="whiteStone" cx="30%" cy="24%"><stop offset="0" stopColor="#fffef8"/><stop offset=".6" stopColor="#e8e2d5"/><stop offset="1" stopColor="#aaa397"/></radialGradient>
          <filter id="stoneShadow"><feDropShadow dx="0" dy="3" stdDeviation="2.5" floodOpacity=".38"/></filter>
        </defs>
        <rect x="4" y="4" width="564" height="564" rx="18" className="board-bg" />
        {openingStage?.kind === "place" && openingStage.radius !== null && (() => {
          const center = Math.floor(boardSize / 2), start = center - openingStage.radius, cells = openingStage.radius * 2;
          return <rect x={margin + start * gap - gap / 2} y={margin + start * gap - gap / 2} width={(cells + 1) * gap} height={(cells + 1) * gap} rx="10" className="opening-region" aria-label={`第${openingStage.moveNumber}手允许落子区域`}/>;
        })()}
        {Array.from({ length: boardSize }, (_, index) => <g key={index} className="grid-lines"><line x1={margin} y1={margin + index * gap} x2={end} y2={margin + index * gap}/><line x1={margin + index * gap} y1={margin} x2={margin + index * gap} y2={end}/></g>)}
        {starPoints.map(([row, col]) => <circle key={`${row}-${col}`} cx={margin + col * gap} cy={margin + row * gap} r="4.2" className="star"/>)}
        {showCoordinates && Array.from({ length: boardSize }, (_, index) => <g key={`coord-${index}`} className="coordinates"><text x={margin + index * gap} y="20">{String.fromCharCode(65 + index)}</text><text x={margin + index * gap} y="560">{String.fromCharCode(65 + index)}</text><text x="18" y={margin + index * gap + 3}>{boardSize - index}</text><text x="554" y={margin + index * gap + 3}>{boardSize - index}</text></g>)}
        {winningLines.map((line, index) => {
          const start = line[0], endPoint = line[line.length - 1];
          if (!start || !endPoint) return null;
          return <line key={`winning-line-${index}`} x1={margin + start.col * gap} y1={margin + start.row * gap} x2={margin + endPoint.col * gap} y2={margin + endPoint.row * gap} className="winning-line" aria-label="获胜五连"/>;
        })}
        {board.flatMap((row, rowIndex) => row.map((player, colIndex) => {
          if (!player) return null;
          const x = margin + colIndex * gap, y = margin + rowIndex * gap;
          const number = numbers.get(`${rowIndex},${colIndex}`), isLast = current.move?.row === rowIndex && current.move?.col === colIndex;
          const isWinningStone = winningStoneKeys.has(`${rowIndex},${colIndex}`);
          return <g key={`stone-${rowIndex}-${colIndex}`} filter="url(#stoneShadow)" className={isWinningStone ? "winning-stone" : undefined}><circle cx={x} cy={y} r="15.6" fill={`url(#${player === "black" ? "blackStone" : "whiteStone"})`} className="stone"/>{isWinningStone && <circle cx={x} cy={y} r="19" className="winning-stone-ring"/>}{showNumbers && <text x={x} y={y + 4.2} className={`move-number ${player}`}>{number}</text>}{isLast && !showNumbers && <circle cx={x} cy={y} r="4" className="last-dot"/>}{isLast && hasNativeAnnotation(current) && <g className="comment-indicator" aria-label="此步有注释"><circle cx={x + 11} cy={y + 11} r="6"/><circle cx={x + 8.5} cy={y + 11} r=".85"/><circle cx={x + 11} cy={y + 11} r=".85"/><circle cx={x + 13.5} cy={y + 11} r=".85"/></g>}{isLast && currentBookmarked && <g className="bookmark-indicator" aria-label="此局面已保存分支书签"><path d={`M ${x - 15} ${y - 15} h 10 v 12 l -5 -3 -5 3 z`}/></g>}</g>;
        }))}
        {variationNodes.map((node, index) => {
          const point = node.move || node.anchor;
          if (!point) return null;
          const x = margin + point.col * gap, y = margin + point.row * gap;
          const player = node.move?.player || "black";
          const isNativeLabel = isNativeRenLib || Boolean(node.renLibNativeLabel);
          const display = isNativeLabel ? null : renLibDisplayMark(node.boardText);
          const text = isNativeLabel ? (isNativeRenLib ? formatRenLibWebLabel(node.boardText, depthOf(document, safeCurrentId) + 1) : node.boardText || "") : display?.displayText || "";
          const hasText = Boolean(text);
          const hasUserMark = !isNativeLabel && userDisplayMarks.some((mark) => mark.row === point.row && mark.col === point.col);
          return <g key={`variation-${node.id}`} className={`renlib-variation ${player} ${isNativeLabel ? "renlib-native-variation" : display?.displayKind || "neutral-dot"}`} aria-label={`变化点 ${coordinateName(point, boardSize)}`}>
            {!hasText && !hasUserMark && <circle cx={x} cy={y} r="7" className="renlib-variation-dot"/>}
            {node.renLibMark && !hasText && !hasUserMark && <circle cx={x} cy={y} r="11" className="renlib-explicit-mark"/>}
            {hasText && <text x={x} y={y} className={`renlib-variation-label ${isNativeLabel ? "renlib-native-label" : ""} ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`} style={isNativeLabel ? { fill: "#1d1c19" } : undefined}>{text}</text>}
          </g>;
        })}
        {current.renLibMark && (current.move || current.anchor) && (() => {
          const point = current.move || current.anchor!;
          const x = margin + point.col * gap, y = margin + point.row * gap;
          return <circle cx={x} cy={y} r="11" className="renlib-explicit-mark"/>;
        })()}
        {boardTextNodes.map((node) => {
          const point = node.move || node.anchor;
          if (!point || !node.boardText) return null;
          const x = margin + point.col * gap, y = margin + point.row * gap;
          return <text key={`board-text-${node.id}`} x={x} y={y + 4} className="renlib-board-text">{node.boardText}</text>;
        })}
        {nativeDisplayMarks.map((mark, index) => {
          if (!mark.label) return null;
          const x = margin + mark.col * gap, y = margin + mark.row * gap;
          const text = mark.label;
          return <text key={`native-mark-${index}`} x={x} y={y} className={`renlib-variation-label renlib-native-label ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`} style={{ fill: "#1d1c19" }}>{text}</text>;
        })}
        {userDisplayMarks.map((mark, index) => {
          const x = margin + mark.col * gap, y = margin + mark.row * gap;
          const style = mark.style || (mark.kind === "label" ? "text" : mark.kind);
          const color = mark.color || "#1d1c19";
          const label = mark.label || "";
          const labelClass = `board-label-text ${Array.from(label).length > 2 ? "compact" : ""}`;
          if (style === "text") return <text key={index} x={x} y={y + 4} className={labelClass} fill={color}>{label || "?"}</text>;
          if (style === "circle") return label ? <g key={index}><circle cx={x} cy={y} r="19" className="board-mark" stroke={color}/><text x={x} y={y + 4} className={labelClass} fill={color}>{label}</text></g> : <circle key={index} cx={x} cy={y} r="5.5" fill={color} opacity=".82"/>;
          if (style === "triangle") return <g key={index}><path d={`M ${x} ${y - 20} L ${x - 18} ${y + 14} L ${x + 18} ${y + 14} Z`} className="board-mark" stroke={color}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color}>{label}</text>}</g>;
          return <g key={index} className="board-mark" stroke={color}><line x1={x - 14} y1={y - 14} x2={x + 14} y2={y + 14}/><line x1={x + 14} y1={y - 14} x2={x - 14} y2={y + 14}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color} stroke="none">{label}</text>}</g>;
        })}
        {forbiddenMarkers.map((point) => {
          const x = margin + point.col * gap, y = margin + point.row * gap;
          return <g key={`forbidden-${point.row}-${point.col}`} className="forbidden-point" aria-label={`${coordinateName(point, boardSize)} ${point.reason}`}><line x1={x - 7} y1={y - 7} x2={x + 7} y2={y + 7}/><line x1={x + 7} y1={y - 7} x2={x - 7} y2={y + 7}/></g>;
        })}
        {openingCandidates.map((point, index) => {
          const x = margin + point.col * gap, y = margin + point.row * gap;
          return <g key={`opening-candidate-${point.row}-${point.col}`} className="opening-candidate" aria-label={`第5手候选 ${index + 1}`}><circle cx={x} cy={y} r="12"/><text x={x} y={y + 4}>{index + 1}</text></g>;
        })}
        {thinkingMove && !board[thinkingMove.row]?.[thinkingMove.col] && (() => {
          const x = margin + thinkingMove.col * gap, y = margin + thinkingMove.row * gap;
          return <g className="thinking-point" aria-label={`AI 推荐 ${coordinateName(thinkingMove, boardSize)}`}><circle cx={x} cy={y} r="19"/><circle cx={x} cy={y} r="4"/><text x={x} y={y + 4}>荐</text></g>;
        })()}
        {Array.from({ length: boardSize }, (_, row) => Array.from({ length: boardSize }, (_, col) => <circle key={`hit-${row}-${col}`} cx={margin + col * gap} cy={margin + row * gap} r="17" className="board-hit" role="gridcell" aria-disabled={disabled} aria-label={`${coordinateName({ row, col }, boardSize)}${board[row][col] ? "已有棋子" : forbiddenByPoint.get(`${row},${col}`) || "空位"}`} onPointerDown={() => { if (disabled) return; longPressTimer.current = window.setTimeout(() => { suppressedClickPoint.current = { row, col }; onMark({ row, col }); }, 520); }} onPointerUp={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerCancel={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onClick={() => { if (disabled) return; if (suppressedClickPoint.current?.row === row && suppressedClickPoint.current.col === col) { suppressedClickPoint.current = null; return; } suppressedClickPoint.current = null; onPlay({ row, col }); }} onContextMenu={(event) => { event.preventDefault(); if (!disabled) onMark({ row, col }); }}/>))}
      </svg>
    </div>
  );
});

function BottomSheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="sheet-backdrop" onMouseDown={onClose}><section className="bottom-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}><div className="sheet-handle"/><div className="sheet-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>{children}</section></div>;
}

export default function App() {
  const [document, setDocument] = useState<GameDocument>(() => {
    const active = loadActive();
    if (active) return active;
    try {
      const stored = JSON.parse(localStorage.getItem(DEFAULT_DOCUMENT_KEY) || "null");
      if (stored?.id && stored?.rootId && stored?.nodes?.[stored.rootId]) return stored as GameDocument;
    } catch { /* ignore malformed default baseline and recreate it */ }
    const created = createDocument("瑞星定式研究");
    localStorage.setItem(DEFAULT_DOCUMENT_KEY, JSON.stringify(created));
    return created;
  });
  const [currentId, setCurrentId] = useState(() => {
    const storedDraft = loadDraftFromLocal(document.id);
    const latestAdded = [...storedDraft.operations].reverse().find((operation) => operation.type === "add-move");
    return document.savedCurrentId || (latestAdded?.type === "add-move" ? latestAdded.node.id : document.rootId);
  });
  const [mode, setMode] = useState<AppMode>("record");
  const [puzzleCollections, setPuzzleCollections] = useState<PuzzleCollection[]>(loadPuzzleCollections);
  const [puzzleProgress, setPuzzleProgress] = useState(loadPuzzleProgress);
  const [puzzleCollectionIndex, setPuzzleCollectionIndex] = useState(0);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [puzzleInitialId, setPuzzleInitialId] = useState("");
  const [puzzleInitialDepth, setPuzzleInitialDepth] = useState(0);
  const [aiThinking, setAiThinking] = useState(false);
  const [puzzleOutcome, setPuzzleOutcome] = useState<"won" | "lost" | "stopped" | null>(null);
  const [aiGame, setAiGame] = useState<AiGameState | null>(null);
  const [aiRuleFamily, setAiRuleFamily] = useState<"renju" | "standard">("renju");
  const [aiForbiddenEnabled, setAiForbiddenEnabled] = useState(true);
  const [aiHumanPlayer, setAiHumanPlayer] = useState<Player>("black");
  const [aiOpeningRule, setAiOpeningRule] = useState<OpeningRule>("free");
  const [aiOpeningN, setAiOpeningN] = useState(3);
  const [dockPanel, setDockPanel] = useState<DockPanel>("moves");
  const [puzzleQuery, setPuzzleQuery] = useState("");
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);
  const [workspaceListExpanded, setWorkspaceListExpanded] = useState(false);
  const [expandedCollectionId, setExpandedCollectionId] = useState<string | null>(null);
  const [library, setLibrary] = useState(loadLibrary);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySection, setLibrarySection] = useState<LibrarySection>("records");
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolders>(loadLibraryFolders);
  const [branchBookmarks, setBranchBookmarks] = useState<BranchBookmarks>(loadBranchBookmarks);
  const [expandedLibraryFolder, setExpandedLibraryFolder] = useState<string | null>(() => libraryFolders.recordFolders[0] || null);
  const [managedPuzzleCollectionId, setManagedPuzzleCollectionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("record");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [branchPage, setBranchPage] = useState(1);
  const [branchScrollTop, setBranchScrollTop] = useState(0);
  const [bookmarksExpanded, setBookmarksExpanded] = useState(true);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkName, setEditingBookmarkName] = useState("");
  const branchListRef = useRef<HTMLDivElement>(null);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showForbidden, setShowForbidden] = useState(true);
  const [largeBoard, setLargeBoard] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [mirrored, setMirrored] = useState(false);
  const [candidateLabel, setCandidateLabel] = useState<string | null>(null);
  const [annotationStyle, setAnnotationStyle] = useState<BoardMarkStyle>("text");
  const [annotationColor, setAnnotationColor] = useState("#1d1c19");
  const [draft, setDraft] = useState<DraftState>(() => loadDraftFromLocal(document.id));
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const [customMarkLabel, setCustomMarkLabel] = useState("");
  const [largeSummaries, setLargeSummaries] = useState<LargeDocumentSummary[]>([]);
  const [importingFile, setImportingFile] = useState("");
  const [imageRecognizing, setImageRecognizing] = useState(false);
  const [placementPlayer, setPlacementPlayer] = useState<"black" | "white">("black");
  const [placementLocked, setPlacementLocked] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [saveDestination, setSaveDestination] = useState<"records" | "puzzles">("records");
  const [saveFolder, setSaveFolder] = useState("未分类");
  const [defaultDirectory, setDefaultDirectory] = useState<DirectoryHandleLike | null>(null);
  const [exportFormatMenuOpen, setExportFormatMenuOpen] = useState(false);
  const [folderCreationSection, setFolderCreationSection] = useState<LibrarySection>("records");
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<LibraryRenameTarget | null>(null);
  const [renameName, setRenameName] = useState("");
  const [commentExpanded, setCommentExpanded] = useState(false);
  const [toast, setToast] = useState("");
  const [saved, setSaved] = useState(true);
  const [vcfRunning, setVcfRunning] = useState(false);
  const [vcfResult, setVcfResult] = useState<VcfResult | null>(null);
  const [thinkRunning, setThinkRunning] = useState(false);
  const [thinkResult, setThinkResult] = useState<AiMoveResult | null>(null);
  const [matchSymmetry, setMatchSymmetry] = useState(true);
  const singleFileInput = useRef<HTMLInputElement>(null);
  const puzzleFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const nativeSourceFile = useRef<File | null>(null);
  const vcfWorker = useRef<Worker | null>(null);
  const puzzleAiWorker = useRef<Worker | null>(null);
  const thinkWorker = useRef<Worker | null>(null);
  const rapfiThinkWorker = useRef<Worker | null>(null);
  const rapfiGameWorker = useRef<Worker | null>(null);
  const thinkGeneration = useRef(0);
  const aiOpeningTimer = useRef<number | null>(null);
  const aiOpeningGeneration = useRef(0);
  const largeSaveVersions = useRef(new Map<string, number>());
  const pagedSession = useRef<LibraryViewSession | null>(null);
  const dynamicViewSession = useRef<DpViewSession | RenLibWebViewSession | null>(null);
  const pagedNavigationVersion = useRef(0);
  const pagedNavigate = useRef<(index: number) => void>(() => undefined);
  const initialDocument = useRef(document);
  const persistedDocuments = useRef(new WeakSet<GameDocument>());
  persistedDocuments.current.add(initialDocument.current);
  const recordSession = useRef<{ document: GameDocument; currentId: string }>({ document, currentId });
  const draftHasMetadataRestoredRef = useRef(false);
  const lastPersistedMetaRef = useRef("");
  const currentPuzzle = puzzleCollections[puzzleCollectionIndex]?.puzzles[puzzleIndex];
  useEffect(() => { setCommentExpanded(false); }, [currentId]);
  const draftOverlay = useMemo(() => buildDraftOverlay(draft, document), [draft, document]);
  const viewDocument = useMemo(() => {
    if (!hasDraft(draft)) return document;
    const projected = projectedDocument(document, draftOverlay);
    if (draft.metadata) projected.metadata = { ...document.metadata, ...draft.metadata };
    return projected;
  }, [document, draft, draftOverlay]);
  const current = viewDocument.nodes[currentId] || viewDocument.nodes[viewDocument.rootId] || { id: viewDocument.rootId, parentId: null, children: [], move: null, comment: "", marks: [] };
  const activeBookmarks = branchBookmarks[document.id] || [];
  const path = useMemo(() => pathToNode(viewDocument, currentId), [viewDocument, currentId]);
  const board = useMemo(() => boardAt(viewDocument, currentId), [viewDocument, currentId]);
  // Keep navigation-derived values primitive/stable. A cursor move changes currentId and
  // board, but must not make unrelated searches re-run just because document is also in scope.
  const nextPlayer = nextPlayerAt(viewDocument, currentId);
  const activePlacementPlayer = placementLocked ? placementPlayer : nextPlayer;
  const canRenderForbiddenAssistance = mode === "record" && viewDocument.metadata.rule === "renju" && !aiThinking && !aiGame?.outcome && (aiGame ? aiGame.forbiddenEnabled && nextPlayer === "black" : activePlacementPlayer === "black" && !compactIndexOf(document) && !isDynamicDatabaseView(document) && !isPagedLibraryView(document));
  const boardForbiddenMarkers = useMemo(() => showForbidden && canRenderForbiddenAssistance ? forbiddenPoints(board) : [], [showForbidden, canRenderForbiddenAssistance, board]);
  const boardWinningLines = useMemo(() => current.move ? winningLinesAt(board, current.move, viewDocument.metadata.rule) : [], [board, current.move, viewDocument.metadata.rule]);
  const aiOpeningStage = aiGame?.opening.stage;
  const machineThinking = aiThinking || thinkRunning || vcfRunning;
  const humanCanUseOpeningBoard = aiOpeningStage?.kind === "place" ? aiOpeningStage.actor === "human" : aiOpeningStage?.kind === "offer-fifths" ? aiOpeningStage.actor === "human" : aiOpeningStage?.kind === "choose-fifth" ? aiOpeningStage.chooser === "human" : false;
  const historicalAiPosition = Boolean(aiGame && currentId !== recordSession.current.currentId);
  const aiBoardDisabled = Boolean(aiGame && (aiThinking || aiGame.outcome || (aiOpeningStage?.kind === "normal" ? !historicalAiPosition && nextPlayer !== aiGame.humanPlayer : !humanCanUseOpeningBoard)));
  const currentPositionKey = useMemo(() => positionKey(board, nextPlayer, false), [board, nextPlayer]);
  // Candidate analysis is an explicit study action, not a navigation primitive.
  // Do not evaluate all 225 empty points while stepping through a large tree.
  const candidates = useMemo(() => sheet === "analysis" && (viewDocument.metadata.boardSize || 15) === 15 ? analyzeCandidates(board, nextPlayer, 8) : [], [sheet, board, nextPlayer, viewDocument.metadata.boardSize]);
  const searchableDocuments = useMemo(() => [document, ...library.filter((item) => item.id !== document.id)], [document, library]);
  const positionMatches = useMemo(() => sheet === "positionSearch" ? findPositionMatches(searchableDocuments, board, nextPlayer, matchSymmetry) : [], [sheet, searchableDocuments, board, nextPlayer, matchSymmetry]);
  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return library;
    return library.filter((item) => [item.metadata.title, item.metadata.black, item.metadata.white, item.metadata.event]
      .some((value) => value.toLowerCase().includes(query)));
  }, [library, libraryQuery]);
  const filteredLargeSummaries = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return largeSummaries;
    return largeSummaries.filter((item) => [item.metadata.title, item.metadata.black, item.metadata.white, item.metadata.event]
      .some((value) => value.toLowerCase().includes(query)));
  }, [largeSummaries, libraryQuery]);
  const findResults = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (!query) return [];
    const indexed = compactSearch(document, query, 20);
    if (indexed) return indexed.map((id) => document.nodes[id]).filter((node): node is RecordNode => Boolean(node));
    const matches = Object.values(document.nodes).flatMap((node) => {
      const depth = depthOf(document, node.id);
      const coordinate = node.move ? coordinateName(node.move) : "起始局面";
      const matched = coordinate.toLowerCase().includes(query)
        || node.comment.toLowerCase().includes(query)
        || (node.boardText || "").toLowerCase().includes(query)
        || nodeMarksText(node.marks || []).toLowerCase().includes(query)
        || String(depth).includes(query);
      return matched ? [{ node, depth }] : [];
    });
    return matches.sort((a, b) => a.depth - b.depth).slice(0, 20).map(({ node }) => node);
  }, [document, findQuery]);

  useEffect(() => {
    setCandidateLabel(null);
  }, [document.id, currentId]);
  useEffect(() => {
    (window as Window & { __banbuFindBranch?: () => { id?: string; hasCompact: boolean; branchCount: number | null; nodeCount: number | null; firstBranchId: string | null; firstBranchChildCount: number | null; rootFirstChild: string | null; rootChildCount: number | null } }).__banbuFindBranch = () => {
      const id = compactFirstBranchNodeId(document);
      if (id) setCurrentId(id);
      return { ...compactDiagnostics(document), id };
    };
    return () => { delete (window as Window & { __banbuFindBranch?: () => string | undefined }).__banbuFindBranch; };
  }, [document]);
  useEffect(() => {
    if (mode === "puzzle") return;
    // The paged document is only the UI window around the cursor. Its full
    // immutable baseline already lives in IndexedDB, so this partial view must
    // never overwrite the stored tree.
    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) { setSaved(true); return; }
    setSaved(false);
    const timer = window.setTimeout(() => {
      const compactIndex = compactIndexOf(document);
      if (compactIndex) {
        // For compact documents, the base tree is already persisted in
        // IndexedDB. Persist the draft operations + metadata (if anything
        // changed) without touching the committed baseline. Runs for every
        // compact document (including library-opened ones), so a draft is
        // never silently dropped.
        const fingerprint = documentFingerprint(document);
        const metadata = draft.metadata ? { ...document.metadata, ...draft.metadata } : document.metadata;
        const metaKey = JSON.stringify(metadata);
        const metaChanged = lastPersistedMetaRef.current !== metaKey;
        if (hasDraft(draft) || metaChanged) {
          void saveDraftForDocument(document.id, draft, fingerprint, metadata)
            .then(() => { lastPersistedMetaRef.current = metaKey; setSaved(true); })
            .catch(() => setSaved(false));
        } else {
          setSaved(true);
        }
      } else if (hasDraft(draft)) {
        try { saveDraftToLocal(document.id, draft); setSaved(true); } catch { setSaved(false); }
      } else if (largeSummaries.some((item) => item.id === document.id)) {
        const existingSummary = largeSummaries.find((item) => item.id === document.id)!;
        const saveVersion = (largeSaveVersions.current.get(document.id) || 0) + 1;
        largeSaveVersions.current.set(document.id, saveVersion);
        const preparedSummary: LargeDocumentSummary = { ...(existingSummary || { id: document.id, metadata: document.metadata, updatedAt: document.updatedAt, mainLineLength: 0, nodeCount: compactNodeCount(document) || 0, fingerprint: `edited-${document.id}` }), metadata: document.metadata, updatedAt: document.updatedAt, mainLineLength: compactNodeCount(document) ? 0 : mainLineLength(document), nodeCount: compactNodeCount(document) ?? 0, fingerprint: `edited-${document.id}-${Date.now().toString(36)}` };
        void saveLargeDocument(document, preparedSummary).then((summary) => {
          if (largeSaveVersions.current.get(document.id) !== saveVersion) return;
          setLargeSummaries((items) => [summary, ...items.filter((item) => item.id !== summary.id)]);
          setSaved(true);
        }).catch(() => { if (largeSaveVersions.current.get(document.id) === saveVersion) { setSaved(false); setToast("大型棋谱自动保存失败，请检查本机空间"); } });
      } else { setLibrary(saveToLibrary(document)); setSaved(true); }
    }, largeSummaries.some((item) => item.id === document.id) ? 1000 : 450);
    return () => window.clearTimeout(timer);
  }, [document, mode, draft]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDraft(draft)) return;
      event.preventDefault();
      event.returnValue = "当前有未保存草稿";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft]);
  useEffect(() => {
    let active = true;
    void loadLargeSummaries().then(async (summaries) => {
      if (!active) return;
      setLargeSummaries(summaries.sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0)));
      const activeLargeId = localStorage.getItem(ACTIVE_LARGE_RECORD_KEY);
      if (activeLargeId && summaries.some((item) => item.id === activeLargeId)) {
        const activeSummary = summaries.find((item) => item.id === activeLargeId)!;
        if (activeSummary.storageMode === "compact-index" && activeSummary.nodeCount > 1_000_000) {
          const handle = await openLibraryHandle(activeLargeId);
          if (active && handle) {
            const session = new LibraryViewSession(handle, activeSummary);
            const opened = await session.open(0);
            if (!active) { session.close(); return; }
            pagedSession.current?.close(); pagedSession.current = session;
            setDraft(emptyDraft()); setDocument(opened.document); setCurrentId(opened.currentId);
            recordSession.current = { document: opened.document, currentId: opened.currentId };
            lastPersistedMetaRef.current = JSON.stringify(opened.document.metadata);
            return;
          }
        }
        const activeDocument = await loadLargeDocument(activeLargeId);
        if (active && activeDocument) {
          // Restore persisted draft for compact documents
          let storedDraft: Awaited<ReturnType<typeof loadDraftForDocument>> = null;
          if (compactIndexOf(activeDocument)) {
            storedDraft = await loadDraftForDocument(activeLargeId);
            if (storedDraft && active) {
              const currentFingerprint = documentFingerprint(activeDocument);
              if (storedDraft.baseFingerprint === currentFingerprint) {
                setDraft({ operations: storedDraft.operations, redo: storedDraft.redo });
                if (storedDraft.metadata) {
                  setDocument({ ...activeDocument, metadata: { ...activeDocument.metadata, ...storedDraft.metadata } });
                }
              }
            }
          }
          // Always install the asynchronously loaded active large document.
          // Previously this only happened when stored draft metadata existed,
          // leaving a fresh reload on the default document after a derived save.
          if (storedDraft?.metadata) {
            setDocument({ ...activeDocument, metadata: { ...activeDocument.metadata, ...storedDraft.metadata } });
          } else {
            setDocument(activeDocument);
          }
          persistedDocuments.current.add(activeDocument);
          const savedCurrentId = (activeDocument as GameDocument & { savedCurrentId?: string }).savedCurrentId;
          recordSession.current = { document: activeDocument, currentId: savedCurrentId || activeDocument.rootId };
          lastPersistedMetaRef.current = JSON.stringify(activeDocument.metadata);
          setCurrentId(savedCurrentId || activeDocument.rootId);
        }
      }
    }).catch(() => setToast("大型棋谱库读取失败，普通棋谱不受影响"));
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2600); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { savePuzzleProgress(puzzleProgress); }, [puzzleProgress]);
  useEffect(() => { localStorage.setItem(LIBRARY_FOLDERS_KEY, JSON.stringify(libraryFolders)); }, [libraryFolders]);
  useEffect(() => { localStorage.setItem(BRANCH_BOOKMARKS_KEY, JSON.stringify(branchBookmarks)); }, [branchBookmarks]);
  useEffect(() => {
    let active = true;
    void loadDefaultDirectoryHandle().then((handle) => { if (active) setDefaultDirectory(handle); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void loadNativeKaibaoCollections().then((nativeCollections) => {
      if (!active) return;
      setPuzzleCollections((currentCollections) => {
        const custom = currentCollections.filter((item) => !item.id.startsWith("native-kaibao-"));
        return [...custom, ...nativeCollections];
      });
    }).catch(() => setToast("内置题库加载失败，可稍后重新打开应用"));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    vcfWorker.current?.terminate(); vcfWorker.current = null; setVcfRunning(false); setVcfResult(null);
  }, [currentPositionKey]);
  useEffect(() => {
    thinkWorker.current?.terminate(); thinkWorker.current = null; thinkGeneration.current += 1;
    rapfiThinkWorker.current?.terminate(); rapfiThinkWorker.current = null;
    setThinkRunning(false); setThinkResult(null);
  }, [currentPositionKey]);
  useEffect(() => () => { vcfWorker.current?.terminate(); puzzleAiWorker.current?.terminate(); thinkWorker.current?.terminate(); rapfiThinkWorker.current?.terminate(); rapfiGameWorker.current?.terminate(); pagedSession.current?.close(); dynamicViewSession.current?.close(); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && current.parentId) {
        if (dynamicViewSession.current && isDynamicDatabaseView(document)) { void dynamicViewSession.current.back().then((opened) => { setDocument(opened.document); setCurrentId(opened.currentId); }); return; }
        const session = pagedSession.current;
        if (session) void session.parentIndex(currentId).then((index) => { if (index !== null) pagedNavigate.current(index); });
        else setCurrentId(current.parentId);
      }
      if (event.key === "ArrowRight") {
        if (dynamicViewSession.current && isDynamicDatabaseView(document)) {
          const next = current.preferredChildId ? viewDocument.nodes[current.preferredChildId] : current.children.length ? viewDocument.nodes[current.children[0]] : undefined;
          if (next?.move) void dynamicViewSession.current.move(next.move).then((opened) => { setDocument(opened.document); setCurrentId(opened.currentId); });
          return;
        }
        const session = pagedSession.current;
        if (session) void session.preferredIndex(currentId).then((index) => { if (index !== null) pagedNavigate.current(index); });
        else { const next = preferredNext(viewDocument, currentId); if (next) setCurrentId(next); }
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [document, currentId, current.parentId, viewDocument]);

  const requestStrongAiMove = (afterDocument: GameDocument, afterId: string, aiPlayer: Player, onMove: (move: Position) => void, onNoMove: () => void) => {
    const board = boardAt(afterDocument, afterId);
    const moves = pathToNode(afterDocument, afterId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
    const useLocalFallback = () => {
      const fallback = new PuzzleAiWorker();
      puzzleAiWorker.current = fallback;
      fallback.onmessage = (event: MessageEvent<AiMoveResult>) => {
        if (puzzleAiWorker.current !== fallback) return;
        puzzleAiWorker.current = null; fallback.terminate();
        if (event.data.move) onMove(event.data.move); else onNoMove();
      };
      fallback.onerror = () => {
        if (puzzleAiWorker.current !== fallback) return;
        puzzleAiWorker.current = null; fallback.terminate(); onNoMove();
      };
      fallback.postMessage({ board, player: aiPlayer, rule: afterDocument.metadata.rule, purpose: "game" });
    };
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    const existing = rapfiGameWorker.current;
    const worker = existing || new Worker(String(import.meta.env.BASE_URL) + "rapfi/rapfi-worker.js");
    rapfiGameWorker.current = worker;
    const useFallbackAfterRapfiError = () => {
      if (rapfiGameWorker.current !== worker) return;
      worker.terminate(); rapfiGameWorker.current = null; useLocalFallback();
    };
    worker.onmessage = (event: MessageEvent<{ type: string; result?: AiMoveResult }>) => {
      if (rapfiGameWorker.current !== worker) return;
      if (event.data.type === "result" && event.data.result) {
        if (event.data.result.move) onMove(event.data.result.move); else onNoMove();
      } else if (event.data.type === "error") useFallbackAfterRapfiError();
    };
    worker.onerror = useFallbackAfterRapfiError;
    worker.postMessage({ type: "analyze", engine: "fallback", size: afterDocument.metadata.boardSize || 15, moves, player: aiPlayer, rule: afterDocument.metadata.rule, timeMs: 2500, maxDepth: 64 });
  };

  const startAiReply = (afterDocument: GameDocument, afterId: string, puzzle: Puzzle) => {
    setAiThinking(true);
    requestStrongAiMove(afterDocument, afterId, otherPlayer(puzzle.player), (move) => {
      setAiThinking(false);
      const reply = addMoveAs(afterDocument, afterId, move, otherPlayer(puzzle.player));
      setDocument(reply.document); setCurrentId(reply.nodeId);
      const replyBoard = boardAt(reply.document, reply.nodeId);
      if (winnerAt(replyBoard, move, reply.document.metadata.rule)) { setPuzzleOutcome("lost"); recordPuzzleAttempt(false); }
    }, () => { setAiThinking(false); setToast("陪练没有找到可落子点"); });
  };

  const startAiGameReply = (afterDocument: GameDocument, afterId: string, aiPlayer: Player) => {
    setAiThinking(true);
    requestStrongAiMove(afterDocument, afterId, aiPlayer, (move) => {
      setAiThinking(false);
      const beforeBoard = boardAt(afterDocument, afterId);
      const actualMove = aiPlayer === "black" && afterDocument.metadata.rule === "renju" && forbiddenReason(beforeBoard, move)
        ? suggestFifthCandidates(beforeBoard, 1)[0]
        : move;
      if (!actualMove) { setAiGame((game) => game ? { ...game, outcome: "draw" } : game); setToast("AI 没有合法落子，本局和棋"); return; }
      const reply = addMoveAs(afterDocument, afterId, actualMove, aiPlayer);
      setDocument(reply.document); setCurrentId(reply.nodeId);
      recordSession.current = { document: reply.document, currentId: reply.nodeId };
      const replyBoard = boardAt(reply.document, reply.nodeId);
      if (winnerAt(replyBoard, actualMove, afterDocument.metadata.rule)) {
        setAiGame((game) => game ? { ...game, outcome: "lost" } : game);
        setToast("AI 已连成五子，本局结束");
      } else if (replyBoard.every((row) => row.every(Boolean))) {
        setAiGame((game) => game ? { ...game, outcome: "draw" } : game);
        setToast("棋盘已满，本局和棋");
      }
    }, () => { setAiThinking(false); setAiGame((game) => game ? { ...game, outcome: "draw" } : game); setToast("AI 没有找到合法落子，本局和棋"); });
  };

  const gameWithOpening = (game: AiGameState, opening: OpeningSession): AiGameState => ({ ...game, opening, humanPlayer: opening.humanPlayer, aiPlayer: otherPlayer(opening.humanPlayer) });
  const documentWithAiNames = (source: GameDocument, game: AiGameState): GameDocument => ({
    ...source,
    metadata: { ...source.metadata, black: game.humanPlayer === "black" ? "我" : "半步 AI", white: game.humanPlayer === "white" ? "我" : "半步 AI" },
  });

  function scheduleAiOpening(game: AiGameState, afterDocument: GameDocument, afterId: string) {
    if (game.outcome) return;
    const stage = game.opening.stage;
    if (stage.kind === "normal") {
      if (nextPlayerAt(afterDocument, afterId) === game.aiPlayer) startAiGameReply(afterDocument, afterId, game.aiPlayer);
      return;
    }
    const actor = stage.kind === "place" || stage.kind === "offer-fifths" ? stage.actor : stage.kind === "swap" ? stage.chooser : stage.chooser;
    if (actor !== "ai") return;
    const generation = aiOpeningGeneration.current;
    if (aiOpeningTimer.current !== null) window.clearTimeout(aiOpeningTimer.current);
    setAiThinking(true);
    aiOpeningTimer.current = window.setTimeout(() => {
      aiOpeningTimer.current = null;
      if (generation !== aiOpeningGeneration.current) return;
      setAiThinking(false);
      if (stage.kind === "swap") {
        const opening = decideOpeningSwap(game.opening, false);
        const nextGame = gameWithOpening(game, opening);
        const namedDocument = documentWithAiNames(afterDocument, nextGame);
        setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId: afterId };
        setToast(stage.taraguchiChoice ? "AI 选择不交换，进入塔十候选阶段" : "AI 选择保持当前执子方");
        scheduleAiOpening(nextGame, namedDocument, afterId);
        return;
      }
      if (stage.kind === "offer-fifths") {
        let opening = game.opening;
        for (const point of suggestFifthCandidates(boardAt(afterDocument, afterId), stage.count)) opening = addFifthCandidate(opening, point);
        const nextGame = gameWithOpening(game, opening);
        setAiGame(nextGame); setToast(`AI 已提供 ${opening.candidates.length} 个第5手候选，请选择一个`);
        scheduleAiOpening(nextGame, afterDocument, afterId);
        return;
      }
      if (stage.kind === "choose-fifth") {
        const selected = game.opening.candidates[0];
        if (!selected) { setToast("没有可选择的第5手候选"); return; }
        const reply = addMoveAs(afterDocument, afterId, selected, "black");
        const opening = completeFifthChoice(game.opening);
        const nextGame = gameWithOpening(game, opening);
        setDocument(reply.document); setCurrentId(reply.nodeId); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
        setToast(`AI 选择了第5手候选 ${coordinateName(selected)}`);
        scheduleAiOpening(nextGame, reply.document, reply.nodeId);
        return;
      }
      const position = suggestOpeningPlacement(boardAt(afterDocument, afterId), stage);
      if (!position) { setToast("当前开局阶段没有合法落子"); return; }
      const reply = addMoveAs(afterDocument, afterId, position, stage.player);
      const opening = completeOpeningPlacement(game.opening);
      const nextGame = gameWithOpening(game, opening);
      setDocument(reply.document); setCurrentId(reply.nodeId); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
      setToast(`AI 完成第 ${stage.moveNumber} 手 · ${coordinateName(position)}`);
      scheduleAiOpening(nextGame, reply.document, reply.nodeId);
    }, 260);
  }

  const chooseOpeningSwap = (swap: boolean) => {
    if (!aiGame || aiGame.opening.stage.kind !== "swap" || aiGame.opening.stage.chooser !== "human" || aiThinking) return;
    const wasTaraguchiChoice = aiGame.opening.stage.taraguchiChoice;
    const opening = decideOpeningSwap(aiGame.opening, swap);
    const nextGame = gameWithOpening(aiGame, opening);
    const namedDocument = documentWithAiNames(document, nextGame);
    setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId };
    setToast(wasTaraguchiChoice ? (swap ? "已交换执子方，继续单点第5手" : "保持执子方，进入塔十候选阶段") : swap ? "已交换黑白执子方" : "保持当前执子方");
    scheduleAiOpening(nextGame, namedDocument, currentId);
  };

  const openPuzzle = (collectionIndex: number, nextPuzzleIndex: number, collections = puzzleCollections) => {
    const collection = collections[collectionIndex];
    const puzzle = collection?.puzzles[nextPuzzleIndex];
    if (!puzzle) return;
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
    const session = createPuzzleDocument(puzzle);
    setDraft(emptyDraft());
    setPuzzleCollectionIndex(collectionIndex); setPuzzleIndex(nextPuzzleIndex);
    setDocument(session.document); setCurrentId(session.initialNodeId);
    setPuzzleInitialId(session.initialNodeId); setPuzzleInitialDepth(session.initialDepth);
    setAiThinking(false); setPuzzleOutcome(null); setAiGame(null); setMode("puzzle"); setDockPanel("play"); setTab("record");
    setWorkspaceSelectorOpen(false); setWorkspaceListExpanded(false); setExpandedCollectionId(null); setPuzzleQuery("");
  };
  const recordPuzzleAttempt = (solved: boolean) => {
    if (!currentPuzzle) return;
    const key = puzzleProgressKey(puzzleCollections[puzzleCollectionIndex].id, currentPuzzle.id);
    setPuzzleProgress((currentProgress) => ({ ...currentProgress, [key]: { solved: solved || !!currentProgress[key]?.solved, attempts: (currentProgress[key]?.attempts || 0) + 1, updatedAt: new Date().toISOString() } }));
  };
  const switchMode = (nextMode: AppMode) => {
    if (nextMode === mode) return;
    setWorkspaceSelectorOpen(false); setWorkspaceListExpanded(false); setExpandedCollectionId(null); setPuzzleQuery("");
    if (nextMode === "puzzle") {
      guardedOpenPuzzle(puzzleCollectionIndex, puzzleIndex);
    } else {
      puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
      rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null; setAiThinking(false);
      setDocument(recordSession.current.document); setCurrentId(recordSession.current.currentId); setMode("record"); setDockPanel("moves"); setPuzzleOutcome(null); setAiGame(null);
    }
  };
  const stopPuzzleAi = () => {
    if (!puzzleAiWorker.current && !rapfiGameWorker.current) return;
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null; setAiThinking(false); setPuzzleOutcome("stopped"); setToast("已强制停止陪练，可悔棋或重启本题");
  };
  const exitAiGame = () => {
    if (!aiGame) return;
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
    thinkWorker.current?.terminate(); thinkWorker.current = null;
    rapfiThinkWorker.current?.terminate(); rapfiThinkWorker.current = null;
    thinkGeneration.current += 1;
    setAiThinking(false); setThinkRunning(false); setThinkResult(null);
    setAiGame(null); setPlacementLocked(false); setDockPanel("moves"); setSheet(null);
    setToast("已退出对弈，当前棋局可继续打谱");
  };
  const restartPuzzle = () => {
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null; setAiThinking(false); setPuzzleOutcome(null);
    setCurrentId(puzzleInitialId); setToast("已恢复到本题初始局面");
  };
  const undoPuzzleTurn = () => {
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null; setAiThinking(false); setPuzzleOutcome(null);
    let cursor = currentId;
    const first = document.nodes[cursor];
    let steps = first?.move?.player === currentPuzzle?.player ? 1 : 2;
    while (steps > 0 && cursor !== puzzleInitialId) { cursor = document.nodes[cursor]?.parentId || puzzleInitialId; steps -= 1; }
    setCurrentId(cursor); setToast("已撤销上一回合");
  };
  const movePuzzle = (delta: number) => {
    const collection = puzzleCollections[puzzleCollectionIndex];
    if (!collection?.puzzles.length) return;
    const next = (puzzleIndex + delta + collection.puzzles.length) % collection.puzzles.length;
    openPuzzle(puzzleCollectionIndex, next);
  };

  const detachViewForEditing = (nextDraft: DraftState) => {
    const copy = createEditableViewCopy(viewDocument, currentId);
    pagedNavigationVersion.current += 1;
    pagedSession.current?.close(); pagedSession.current = null;
    dynamicViewSession.current?.close(); dynamicViewSession.current = null;
    localStorage.removeItem(ACTIVE_LARGE_RECORD_KEY);
    setDocument(copy); setDraft(nextDraft); setSaved(false);
    recordSession.current = { document: copy, currentId };
    setToast("已从当前局面创建可编辑副本，原数据库棋谱保持不变");
    return copy;
  };
  const recordDraft = (operation: Parameters<typeof pushDraft>[1]) => {
    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) {
      detachViewForEditing(pushDraft(emptyDraft(), operation));
      return;
    }
    setDraft((state) => pushDraft(state, operation));
  };
  const undoDraftChange = () => {
    const operation = draft.operations[draft.operations.length - 1];
    if (!operation) return;
    setDraft((state) => undoDraft(state));
    // A draft-created node disappears from the projected document when its
    // add operation is undone. Keep the cursor on the parent so the next tap
    // on the board creates a new move instead of targeting a stale ID.
    if (operation.type === "add-move") {
      setCurrentId((id) => id === operation.node.id ? operation.parentId : id);
    } else if (operation.type === "delete-subtree") {
      setCurrentId((id) => viewDocument.nodes[id] ? id : operation.parentId);
    }
    setToast("已撤销一步");
  };
  const discardDraft = () => {
    let restoreId = currentId;
    while (!document.nodes[restoreId] && viewDocument.nodes[restoreId]?.parentId) restoreId = viewDocument.nodes[restoreId].parentId!;
    if (!document.nodes[restoreId]) restoreId = document.rootId;
    if (compactIndexOf(document)) void removeDraftForDocument(document.id);
    else removeDraftFromLocal(document.id);
    setCurrentId(restoreId); setDraft(emptyDraft()); setToast("已放弃未保存草稿");
  };
  /** Commit a compact draft as a derived version, then atomically switch the
   * live editing session to the derived version so the just-saved content stays
   * on screen and remains editable. Never overwrites the original baseline. */
  const commitCompactDraft = async (): Promise<boolean> => {
    const currentDerived = document as GameDocument & { rootBaseId?: string; committedOperations?: DraftOp[] };
    const rootBaseId = currentDerived.rootBaseId || (document.id.endsWith("-edited-") ? document.id : undefined);
    const committed = currentDerived.committedOperations || [];
    try {
      const metadata = draft.metadata ? { ...document.metadata, ...draft.metadata } : document.metadata;
      const summary = await commitDraftAsDerivedVersion(document, draft.operations, metadata, rootBaseId, committed, currentId);
      // Keep the currently visible node id; the derived document re-projects the
      // committed operations, so draft-created nodes remain addressable.
      const currentNodeId = currentId;
      setDraft(emptyDraft());
      await removeDraftForDocument(document.id);
      // Switch the active editing session to the derived version.
      localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, summary.id);
      const derivedDoc = await loadLargeDocument(summary.id);
      if (derivedDoc) {
        recordSession.current = { document: derivedDoc, currentId: currentNodeId };
        setDocument(derivedDoc);
        setCurrentId(currentNodeId);
        persistedDocuments.current.add(derivedDoc);
      }
      setLargeSummaries((items) => [summary, ...items.filter((item) => item.id !== summary.id)]);
      setToast("草稿已提交为派生版本，已切换到新版本继续编辑");
      return true;
    } catch {
      setToast("派生版本提交失败，草稿已保留，请重试");
      return false;
    }
  };
  const commitRegularDraft = () => {
    const next = applyDraftToDocument(document, draft.operations);
    const committed = { ...next, metadata: { ...document.metadata, ...draft.metadata }, updatedAt: new Date().toISOString(), savedCurrentId: currentId };
    removeDraftFromLocal(document.id);
    setDocument(committed); setCurrentId(committed.nodes[currentId] ? currentId : committed.rootId);
    setDraft(emptyDraft()); setLibrary(saveToLibrary(committed)); setSaved(true);
    recordSession.current = { document: committed, currentId: committed.nodes[currentId] ? currentId : committed.rootId };
    setToast("草稿已保存");
  };
  const saveCurrentDraft = () => {
    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) { setToast("这是数据库浏览源；点空位、标注或编辑注释会自动创建可编辑副本"); return; }
    if (!hasDraft(draft)) { setToast("当前棋谱已经保存，没有新的修改"); return; }
    if (compactIndexOf(document)) { void commitCompactDraft(); return; }
    commitRegularDraft();
  };
  const exportRecordFile = async (content: BlobPart, filename: string, type: string, successMessage: string) => {
    setSheet(null);
    if (defaultDirectory) {
      try {
        await writeFileToDirectory(defaultDirectory, filename, content, type);
        setToast(`${successMessage}，已写入“${defaultDirectory.name}”`);
        return;
      } catch {
        downloadFile(content, filename, type);
        setToast(`${successMessage}，默认文件夹写入失败，已回退到浏览器下载目录`);
        return;
      }
    }
    downloadFile(content, filename, type);
    setToast(`${successMessage}，已下载到浏览器默认下载目录（可在设置中选择文件夹）`);
  };
  const exportTextFile = exportRecordFile;
  const chooseDefaultDirectory = async () => {
    try {
      const handle = await pickDefaultDirectoryHandle();
      setDefaultDirectory(handle);
      setToast(`默认导出文件夹已设置为“${handle.name}”`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast(error instanceof Error ? error.message : "选择默认文件夹失败");
    }
  };
  const clearDefaultDirectory = async () => {
    await clearDefaultDirectoryHandle();
    setDefaultDirectory(null);
    setToast("已取消默认导出文件夹，之后将使用浏览器默认下载目录");
  };
  const openSaveDialog = () => {
    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) detachViewForEditing(emptyDraft());
    setSaveDestination("records");
    setSaveFolder(libraryFolders.recordFolders.includes("未分类") ? "未分类" : libraryFolders.recordFolders[0] || "未分类");
    setSheet("save");
  };
  const confirmSave = async () => {
    if (saveDestination === "puzzles") {
      const puzzleId = `saved-${document.id}-${Date.now().toString(36)}`;
      const puzzle: Puzzle = {
        id: puzzleId, title: viewDocument.metadata.title || "未命名题目", prompt: "从这个局面开始练习", difficulty: 3,
        player: activePlacementPlayer, stones: board.flatMap((row, rowIndex) => row.flatMap((player, colIndex) => player ? [{ row: rowIndex, col: colIndex, player }] : [])),
      };
      const collectionId = `saved-collection-${document.id}`;
      const existing = puzzleCollections.find((collection) => collection.id === collectionId);
      const nextCollections = existing
        ? puzzleCollections.map((collection) => collection.id === collectionId ? { ...collection, title: saveFolder, puzzles: [...collection.puzzles, puzzle] } : collection)
        : [...puzzleCollections, { id: collectionId, title: saveFolder, source: "半步五子棋本地保存", license: "用户本地", puzzles: [puzzle] }];
      savePuzzleCollections(nextCollections); setPuzzleCollections(nextCollections);
      setLibraryFolders((folders) => ({ ...folders, puzzleAssignments: { ...folders.puzzleAssignments, [collectionId]: saveFolder } }));
      // Saving a position as a puzzle is an independent copy operation. The
      // source record may still contain unsaved edits, so never discard its
      // draft here.
      setSheet(null); setToast("已保存到题库，原棋谱草稿保持不变"); return;
    }
    const savedId = document.id;
    if (compactIndexOf(document)) {
      const ok = await commitCompactDraft();
      if (!ok) return;
      const actualId = recordSession.current.document.id;
      setLibraryFolders((folders) => ({ ...folders, recordAssignments: { ...folders.recordAssignments, [actualId]: saveFolder } }));
    } else {
      if (hasDraft(draft)) commitRegularDraft(); else { setLibrary(saveToLibrary(document)); setSaved(true); }
      setLibraryFolders((folders) => ({ ...folders, recordAssignments: { ...folders.recordAssignments, [savedId]: saveFolder } }));
    }
    setSheet(null);
  };
  const isCompact = () => compactIndexOf(document) !== undefined;
  const applyCompactUpdate = (patch: Partial<RecordNode>) => {
    if (isCompact()) { recordDraft({ type: "update-node", nodeId: currentId, patch }); return; }
    recordDraft({ type: "update-node", nodeId: currentId, patch });
  };
  /** Safe node update for both compact and regular documents. */
  const safeUpdateNode = (patch: Partial<RecordNode>) => {
    recordDraft({ type: "update-node", nodeId: currentId, patch });
  };
  const safeClearMarks = () => {
    recordDraft({ type: "update-node", nodeId: currentId, patch: { marks: [] } });
  };
  const play = (position: Position) => {
    // Occupied points are static board content. Navigation is explicit through
    // the transport controls and variation panel, so an accidental tap on a
    // stone cannot move the cursor to an older position.
    if (board[position.row][position.col]) {
      return;
    }
    if (mode === "record" && aiGame) {
      if (aiThinking || aiGame.outcome) return;
      const openingStage = aiGame.opening.stage;
      if (openingStage.kind !== "normal") {
        if (openingStage.kind === "swap") { setToast("请先在开局提示卡中选择是否交换"); return; }
        if (openingStage.kind === "place") {
          if (openingStage.actor !== "human") { setToast("AI 正在完成开局落子"); return; }
          if (!openingPositionAllowed(board.length, position, openingStage)) { setToast(openingStage.radius === 0 ? "第1手必须落在天元" : `第${openingStage.moveNumber}手必须落在中心 ${openingStage.radius! * 2 + 1}×${openingStage.radius! * 2 + 1} 区域`); return; }
          if (openingStage.player === "black" && aiGame.forbiddenEnabled) {
            const reason = forbiddenReason(board, position);
            if (reason) { setToast(`此处为黑方${reason}，请选择其他位置`); return; }
          }
          const result = addMoveAs(document, currentId, position, openingStage.player);
          if (!result.created) return;
          const opening = completeOpeningPlacement(aiGame.opening);
          const nextGame = gameWithOpening(aiGame, opening);
          setDocument(result.document); setCurrentId(result.nodeId); setAiGame(nextGame); recordSession.current = { document: result.document, currentId: result.nodeId };
          setToast(`已完成第 ${openingStage.moveNumber} 手 · ${coordinateName(position)}`);
          scheduleAiOpening(nextGame, result.document, result.nodeId);
          return;
        }
        if (openingStage.kind === "offer-fifths") {
          if (openingStage.actor !== "human") { setToast("AI 正在准备第5手候选"); return; }
          const reason = aiGame.forbiddenEnabled ? forbiddenReason(board, position) : null;
          if (reason) { setToast(`候选点 ${coordinateName(position)} 为${reason}`); return; }
          if (!isDistinctFifthCandidate(board, aiGame.opening.candidates, position)) { setToast("这个候选与已有候选属于对称同形，请换一个位置"); return; }
          const opening = addFifthCandidate(aiGame.opening, position);
          const nextGame = gameWithOpening(aiGame, opening);
          setAiGame(nextGame); setToast(opening.stage.kind === "choose-fifth" ? "候选已齐，等待白方选择第5手" : `已加入候选 ${opening.candidates.length}/${openingStage.count}`);
          scheduleAiOpening(nextGame, document, currentId);
          return;
        }
        if (openingStage.chooser !== "human") { setToast("AI 正在选择第5手候选"); return; }
        const selected = aiGame.opening.candidates.find((candidate) => candidate.row === position.row && candidate.col === position.col);
        if (!selected) { setToast("请点击棋盘上带编号的第5手候选"); return; }
        const result = addMoveAs(document, currentId, selected, "black");
        const opening = completeFifthChoice(aiGame.opening);
        const nextGame = gameWithOpening(aiGame, opening);
        setDocument(result.document); setCurrentId(result.nodeId); setAiGame(nextGame); recordSession.current = { document: result.document, currentId: result.nodeId };
        setToast(`已选择第5手 ${coordinateName(selected)}`);
        scheduleAiOpening(nextGame, result.document, result.nodeId);
        return;
      }
      const turn = nextPlayerAt(document, currentId);
      const historicalAiPosition = currentId !== recordSession.current.currentId;
      if (historicalAiPosition) {
        const existingVariation = findVisibleVariationTarget(document, currentId, position);
        if (existingVariation) {
          setCurrentId(existingVariation.target.id); setCandidateLabel(null); setSheet(null);
          setToast("已切换到已有变化");
          return;
        }
        if (aiGame.forbiddenEnabled && turn === "black") {
          const reason = forbiddenReason(board, position);
          if (reason) { setToast("此处为黑方" + reason + "，请选择其他位置"); return; }
        }
        const branch = addMoveAs(document, currentId, position, turn);
        if (!branch.created) return;
        setDocument(branch.document); setCurrentId(branch.nodeId);
        recordSession.current = { document: branch.document, currentId: branch.nodeId };
        const branchBoard = boardAt(branch.document, branch.nodeId);
        if (winnerAt(branchBoard, position, branch.document.metadata.rule)) {
          setAiGame((game) => game ? { ...game, outcome: turn === game.humanPlayer ? "won" : "lost" } : game);
          setToast(turn === aiGame.humanPlayer ? "你已连成五子，本局结束" : "AI 分支已连成五子，本局结束");
          return;
        }
        if (branchBoard.every((row) => row.every(Boolean))) {
          setAiGame((game) => game ? { ...game, outcome: "draw" } : game);
          setToast("棋盘已满，本局和棋");
          return;
        }
        if (turn === aiGame.humanPlayer) startAiGameReply(branch.document, branch.nodeId, aiGame.aiPlayer);
        else setToast("已创建 AI 方的替代分支，现在轮到你");
        return;
      }
      if (turn !== aiGame.humanPlayer) { setToast("现在轮到 AI 落子"); return; }
      if (aiGame.forbiddenEnabled && aiGame.humanPlayer === "black") {
        const reason = forbiddenReason(board, position);
        if (reason) { setToast(`此处为黑方${reason}，请选择其他位置`); return; }
      }
      const result = addMoveAs(document, currentId, position, aiGame.humanPlayer);
      setDocument(result.document); setCurrentId(result.nodeId);
      recordSession.current = { document: result.document, currentId: result.nodeId };
      const nextBoard = boardAt(result.document, result.nodeId);
      if (winnerAt(nextBoard, position, result.document.metadata.rule)) { setAiGame({ ...aiGame, outcome: "won" }); setToast("你已连成五子，本局获胜"); return; }
      if (nextBoard.every((row) => row.every(Boolean))) { setAiGame({ ...aiGame, outcome: "draw" }); setToast("棋盘已满，本局和棋"); return; }
      startAiGameReply(result.document, result.nodeId, aiGame.aiPlayer);
      return;
    }
    if (mode === "record") {
      const variation = findVisibleVariationTarget(viewDocument, currentId, position);
      if (variation) {
        if (dynamicViewSession.current && isDynamicDatabaseView(document) && variation.target.move) {
          const session = dynamicViewSession.current;
          const pivotDepth = depthOf(viewDocument, variation.pivot.id);
          void session.moveFromDepth(pivotDepth, variation.target.move).then((opened) => {
            if (dynamicViewSession.current !== session) return;
            setDocument(opened.document); setCurrentId(opened.currentId); setCandidateLabel(null); setSheet(null);
          }).catch(() => setToast("数据库分支读取失败，请重试"));
          return;
        }
        const session = pagedSession.current;
        if (session && isPagedLibraryView(document)) {
          const index = session.indexForId(variation.target.id);
          if (index !== undefined) pagedNavigate.current(index);
          else setToast("这个分支尚未载入，请重新打开分支面板");
          setCandidateLabel(null); setSheet(null); return;
        }
        setCurrentId(variation.target.id); setCandidateLabel(null); setSheet(null); return;
      }
    }
    if (mode === "puzzle") {
      if (!currentPuzzle || aiThinking || puzzleOutcome) return;
      if (board[position.row][position.col]) return;
      const result = addMoveAs(document, currentId, position, currentPuzzle.player);
      setDocument(result.document); setCurrentId(result.nodeId);
      if (winnerAt(boardAt(result.document, result.nodeId), position)) { setPuzzleOutcome("won"); recordPuzzleAttempt(true); return; }
      startAiReply(result.document, result.nodeId, currentPuzzle);
      return;
    }
    if (candidateLabel) {
      const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
      applyCompactUpdate({ marks: setLabelMark(current.marks, position, candidateLabel, annotationStyle, annotationColor) });
      if (editingDatabaseView) setToast(`已创建编辑副本并放置标注 ${candidateLabel} · ${coordinateName(position)}`);
      else if (!isCompact()) setToast(`已放置标注 ${candidateLabel} · ${coordinateName(position)}`);
      else setToast(`标注 ${candidateLabel} 已加入草稿`);
      setCandidateLabel(null);
      return;
    }
    if (mode === "record" && isCompact()) {
      const draftId = `draft-${Date.now().toString(36)}`;
      recordDraft({ type: "add-move", parentId: currentId, node: { id: draftId, parentId: currentId, children: [], move: { ...position, player: activePlacementPlayer }, comment: "", marks: [] } });
      setCurrentId(draftId);
      setToast("已加入未保存草稿，点击保存后提交");
      return;
    }
    if (showForbidden && viewDocument.metadata.rule === "renju" && (depthOf(viewDocument, currentId) % 2 === 0)) { const reason = forbiddenReason(board, position); if (reason) setToast(`禁手辅助：${coordinateName(position)} 可能是${reason}（仍允许研究落子）`); }
    const result = placementLocked
      ? addMoveAs(viewDocument, currentId, position, activePlacementPlayer)
      : addMove(viewDocument, currentId, position);
    setCurrentId(result.nodeId);
    if (!result.created) return;
    const node = result.document.nodes[result.nodeId];
    if (node) recordDraft({ type: "add-move", parentId: currentId, node: { ...node, children: [...node.children], marks: [...node.marks] } });
  };
  const mark = (position: Position) => { if (mode !== "record") return; const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document); recordDraft({ type: "update-node", nodeId: currentId, patch: { marks: toggleMark(current.marks, position) } }); setToast(editingDatabaseView ? "已创建编辑副本并加入标注，原数据库不变" : "标注已加入草稿"); };
  const updateMetadata = (patch: Partial<GameDocument["metadata"]>) => {
    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) {
      detachViewForEditing({ ...emptyDraft(), metadata: patch });
      return;
    }
    setDraft((state) => ({ ...state, metadata: { ...state.metadata, ...patch }, redo: [] }));
  };
  const markCandidate = (index: number) => {
    const candidate = candidates[index];
    if (!candidate) return;
    const label = String.fromCharCode(65 + index);
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    applyCompactUpdate({ marks: setLabelMark(current.marks, candidate.position, label, annotationStyle, annotationColor) });
    if (editingDatabaseView) setToast(`已创建编辑副本并标记候选 ${label} · ${coordinateName(candidate.position)}`);
    else if (!isCompact()) setToast(`已标记候选 ${label} · ${coordinateName(candidate.position)}`);
  };
  const markTopCandidates = () => {
    const marks = candidates.slice(0, 5).reduce((result, candidate, index) => setLabelMark(result, candidate.position, String.fromCharCode(65 + index), annotationStyle, annotationColor), current.marks);
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    applyCompactUpdate({ marks });
    if (editingDatabaseView) setToast(`已创建编辑副本并标记前 ${Math.min(5, candidates.length)} 个候选点`);
    else if (!isCompact()) setToast(`已标记前 ${Math.min(5, candidates.length)} 个候选点`);
  };
  const runVcf = () => {
    if ((viewDocument.metadata.boardSize || 15) !== 15) { setToast("VCF 当前仅支持十五路棋盘，非十五路请使用手动打谱"); return; }
    vcfWorker.current?.terminate();
    setVcfRunning(true); setVcfResult(null);
    const worker = new VcfWorker(); vcfWorker.current = worker;
    worker.onmessage = (event: MessageEvent<VcfResult>) => {
      const result = event.data;
      if (result.status === "win") {
        const verified = verifyVcfProof(board, result.proof, result.attacker, document.metadata.rule);
        if (!verified.valid) { setToast(`VCF 证明复验失败：${verified.error || "未知原因"}`); setVcfResult({ ...result, status: "budget", proof: undefined, principalVariation: [] }); }
        else setVcfResult(result);
      } else setVcfResult(result);
      setVcfRunning(false); worker.terminate(); if (vcfWorker.current === worker) vcfWorker.current = null;
    };
    worker.onerror = () => { setVcfRunning(false); setToast("VCF 搜索线程启动失败"); worker.terminate(); if (vcfWorker.current === worker) vcfWorker.current = null; };
    worker.postMessage({ board, attacker: nextPlayerAt(document, currentId), options: { rule: document.metadata.rule, maxAttackMoves: 5, timeBudgetMs: 700, nodeBudget: 50000 } });
  };
  const startThink = () => {
    if (mode !== "record") { setToast("“思考”只用于打谱界面的当前局面分析"); return; }
    if (aiGame) { setToast("人机对局会自动思考，请在普通打谱局面使用此按钮"); return; }
    if ((viewDocument.metadata.boardSize || 15) !== 15) { setToast("AI 思考当前仅支持十五路棋盘"); return; }
    const generation = ++thinkGeneration.current;
    thinkWorker.current?.terminate(); thinkWorker.current = null;
    rapfiThinkWorker.current?.terminate();
    setSheet("think"); setThinkRunning(true); setThinkResult(null);
    const accept = (result: AiMoveResult) => {
      if (generation !== thinkGeneration.current) return;
      thinkWorker.current = null; rapfiThinkWorker.current = null; setThinkRunning(false); setThinkResult(result);
      if (result.move) setToast(`AI 推荐 ${coordinateName(result.move)}，可在面板中创建变化`);
      else setToast("AI 没有找到合法落子点");
    };
    const useFallback = () => {
      if (generation !== thinkGeneration.current) return;
      const fallback = new PuzzleAiWorker();
      thinkWorker.current = fallback;
      fallback.onmessage = (event: MessageEvent<AiMoveResult>) => {
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current) return;
        fallback.terminate(); accept(event.data);
      };
      fallback.onerror = () => {
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current) return;
        thinkWorker.current = null; fallback.terminate(); setThinkRunning(false); setToast("AI 思考线程异常，请重试");
      };
      fallback.postMessage({ board, player: nextPlayer, rule: viewDocument.metadata.rule, purpose: "think" });
    };
    const worker = new Worker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`);
    rapfiThinkWorker.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; result?: AiMoveResult; message?: string }>) => {
      if (rapfiThinkWorker.current !== worker || generation !== thinkGeneration.current) return;
      if (event.data.type === "result" && event.data.result) { worker.terminate(); accept(event.data.result); }
      else if (event.data.type === "error") { worker.terminate(); rapfiThinkWorker.current = null; useFallback(); }
    };
    worker.onerror = () => { if (rapfiThinkWorker.current !== worker || generation !== thinkGeneration.current) return; worker.terminate(); rapfiThinkWorker.current = null; useFallback(); };
    const moves = pathToNode(viewDocument, currentId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
    worker.postMessage({ type: "analyze", engine: "fallback", size: viewDocument.metadata.boardSize || 15, moves, player: nextPlayer, rule: viewDocument.metadata.rule, timeMs: 5000, maxDepth: 64 });
  };
  const navigatePagedWindow = async (index: number) => {
    const session = pagedSession.current;
    if (!session) return;
    const version = ++pagedNavigationVersion.current;
    try {
      const opened = await session.open(index);
      if (version !== pagedNavigationVersion.current || pagedSession.current !== session) return;
      setDocument(opened.document); setCurrentId(opened.currentId);
      recordSession.current = { document: opened.document, currentId: opened.currentId };
    } catch { setToast("大型棋谱页读取失败，请重试"); }
  };
  pagedNavigate.current = (index) => { void navigatePagedWindow(index); };
  const goPrev = () => {
    if (dynamicViewSession.current && isDynamicDatabaseView(document)) { void dynamicViewSession.current.back().then((opened) => { setDocument(opened.document); setCurrentId(opened.currentId); }); return; }
    const session = pagedSession.current;
    if (session) { void session.parentIndex(currentId).then((index) => { if (index !== null) pagedNavigate.current(index); }); return; }
    if (current.parentId) setCurrentId(current.parentId);
  };
  const goNext = () => {
    if (dynamicViewSession.current && isDynamicDatabaseView(document)) {
      const next = current.preferredChildId ? viewDocument.nodes[current.preferredChildId] : current.children.length ? viewDocument.nodes[current.children[0]] : undefined;
      if (next?.move) void dynamicViewSession.current.move(next.move).then((opened) => { setDocument(opened.document); setCurrentId(opened.currentId); });
      return;
    }
    const session = pagedSession.current;
    if (session) {
      void session.preferredIndex(currentId).then((index) => { if (index !== null) pagedNavigate.current(index); });
    } else if (isCompact()) {
      const next = overlayPreferredChild(document, draftOverlay, currentId);
      if (next) setCurrentId(next);
    } else {
      const next = preferredNext(viewDocument, currentId);
      if (next) setCurrentId(next);
    }
  };
  const goRoot = () => {
    if (dynamicViewSession.current && isDynamicDatabaseView(document)) void dynamicViewSession.current.root().then((opened) => { setDocument(opened.document); setCurrentId(opened.currentId); });
    else if (pagedSession.current) pagedNavigate.current(0);
    else setCurrentId(document.rootId);
  };
  const goPreferredEnd = () => {
    if (dynamicViewSession.current && isDynamicDatabaseView(document)) { setToast("动态数据库按需读取，请使用“下一手”逐步浏览"); return; }
    const session = pagedSession.current;
    if (session) { void session.preferredEndIndex(currentId).then((index) => { if (index !== null) pagedNavigate.current(index); }); return; }
    setCurrentId(lastOnPreferredLine(viewDocument, currentId));
  };
  const chooseChild = (id: string, pivotId = currentId) => {
    if (dynamicViewSession.current && isDynamicDatabaseView(document)) {
      const session = dynamicViewSession.current;
      const node = viewDocument.nodes[id];
      if (node?.move) void session.moveFromDepth(depthOf(viewDocument, pivotId), node.move).then((opened) => {
        if (dynamicViewSession.current !== session) return;
        setDocument(opened.document); setCurrentId(opened.currentId); setSheet(null);
      }).catch(() => setToast("数据库分支读取失败，请重试"));
      return;
    }
    const session = pagedSession.current;
    if (session) {
      const index = session.indexForId(id);
      if (index !== undefined) pagedNavigate.current(index);
      setSheet(null); return;
    }
    recordDraft({ type: "set-mainline", parentId: pivotId, childId: id });
    setCurrentId(id); setSheet(null);
  };
  const saveBranchBookmark = () => {
    const existing = activeBookmarks.find((bookmark) => bookmark.nodeId === currentId);
    if (existing) { setToast("这个局面已经保存过书签，可用右侧按钮重命名"); return; }
    const bookmark: BranchBookmark = {
      id: `bookmark-${Date.now().toString(36)}`,
      name: `${nodeKindLabel(current)} · 第 ${depthOf(viewDocument, currentId)} 手`,
      nodeId: currentId,
      createdAt: new Date().toISOString(),
    };
    setBranchBookmarks((all) => ({ ...all, [document.id]: [...(all[document.id] || []), bookmark] }));
    setBookmarksExpanded(true);
    setToast("已保存当前局面的分支书签，可继续重命名");
  };
  const deleteBranchBookmark = (id: string) => setBranchBookmarks((all) => ({ ...all, [document.id]: (all[document.id] || []).filter((bookmark) => bookmark.id !== id) }));
  const jumpToBranchBookmark = (bookmark: BranchBookmark) => {
    if (!viewDocument.nodes[bookmark.nodeId]) { setToast("这个分支书签对应的节点已不存在"); return; }
    setCurrentId(bookmark.nodeId); setSheet(null);
  };
  const beginRenameBranchBookmark = (bookmark: BranchBookmark) => {
    setEditingBookmarkId(bookmark.id);
    setEditingBookmarkName(bookmark.name);
  };
  const commitRenameBranchBookmark = () => {
    const name = editingBookmarkName.trim();
    if (!editingBookmarkId || !name) { setToast("书签名称不能为空"); return; }
    setBranchBookmarks((all) => ({ ...all, [document.id]: (all[document.id] || []).map((item) => item.id === editingBookmarkId ? { ...item, name } : item) }));
    setEditingBookmarkId(null);
    setEditingBookmarkName("");
    setToast("分支书签已重命名");
  };
  const deleteCurrentVariation = () => {
    if (!current.parentId) { setToast("起始局面不能删除"); return; }
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    const parentId = current.parentId;
    recordDraft({ type: "delete-subtree", parentId, rootId: currentId });
    setCurrentId(parentId); setSheet(null);
    setToast(editingDatabaseView ? "已创建编辑副本并删除当前变化，原数据库不变" : "已删除当前这一步及全部后续变化，保存后生效");
  };
  const closeWorkspaceSelector = () => { setWorkspaceSelectorOpen(false); setWorkspaceListExpanded(false); setExpandedCollectionId(null); setPuzzleQuery(""); };
  /** Perform a record switch without checking the draft. This is only called
   * after the single outer draft guard has completed. */
  const performOpenRecord = (next: GameDocument, nodeId = next.rootId, largeId?: string, sourceFile?: File) => {
    if (!isDynamicDatabaseView(next)) { dynamicViewSession.current?.close(); dynamicViewSession.current = null; }
    pagedNavigationVersion.current += 1;
    pagedSession.current?.close(); pagedSession.current = null;
    persistedDocuments.current.add(next);
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    recordSession.current = { document: next, currentId: nodeId };
    nativeSourceFile.current = sourceFile || null;
    setDocument(next); setCurrentId(nodeId); setDraft(compactIndexOf(next) ? emptyDraft() : loadDraftFromLocal(next.id));
    setMode("record"); setAiGame(null); setDockPanel("moves"); setTab("record"); closeWorkspaceSelector();
    if (largeId) localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, largeId);
    else localStorage.removeItem(ACTIVE_LARGE_RECORD_KEY);
    setToast("棋谱已打开");
  };
  /** If a draft is present, defer the switch to a 保存/放弃/取消 prompt. */
  const withDraftGuard = (action: () => void) => {
    if (hasDraft(draft)) { setSheet(null); setPendingSwitch(() => action); return; }
    action();
  };
  const openImportSheet = () => withDraftGuard(() => setSheet("import"));
  const openAiGameSheet = () => withDraftGuard(() => setSheet("aiGame"));
  const openRecordImportPicker = () => withDraftGuard(() => singleFileInput.current?.click());
  const openPuzzleImportPicker = () => withDraftGuard(() => puzzleFileInput.current?.click());
  const openImageImportPicker = () => withDraftGuard(() => imageFileInput.current?.click());
  const guardedOpenPuzzle = (collectionIndex: number, nextPuzzleIndex: number, collections = puzzleCollections) => withDraftGuard(() => {
    if (mode === "record") recordSession.current = { document, currentId };
    openPuzzle(collectionIndex, nextPuzzleIndex, collections);
  });
  const savePendingSwitch = () => {
    const action = pendingSwitch; setPendingSwitch(null);
    if (compactIndexOf(document)) void commitCompactDraft().then((ok) => { if (ok) action?.(); });
    else { commitRegularDraft(); action?.(); }
  };
  const discardPendingSwitch = () => {
    const action = pendingSwitch;
    if (compactIndexOf(document)) void removeDraftForDocument(document.id); else removeDraftFromLocal(document.id);
    setDraft(emptyDraft()); setPendingSwitch(null); action?.();
  };
  const startNewAiGame = () => withDraftGuard(() => {
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null; setAiThinking(false);
    const next = createDocument("人机对战");
    next.metadata.rule = aiForbiddenEnabled ? "renju" : aiRuleFamily === "standard" ? "standard" : "freestyle";
    next.metadata.openingRule = aiOpeningRule;
    next.metadata.openingN = aiOpeningRule === "five-two" ? 2 : aiOpeningRule === "taraguchi-10" ? 10 : aiOpeningRule === "five-n" ? aiOpeningN : undefined;
    next.metadata.black = aiHumanPlayer === "black" ? "我" : "半步 AI";
    next.metadata.white = aiHumanPlayer === "white" ? "我" : "半步 AI";
    next.metadata.event = `${aiRuleFamily === "renju" ? "连珠" : "标准五子棋"} · ${openingRuleName(aiOpeningRule, aiOpeningN)} · ${aiForbiddenEnabled ? "有禁手" : "无禁手"} · 人机对战`;
    const opening = createOpeningSession(aiOpeningRule, aiOpeningN, aiHumanPlayer);
    const game: AiGameState = { humanPlayer: aiHumanPlayer, aiPlayer: otherPlayer(aiHumanPlayer), forbiddenEnabled: aiForbiddenEnabled, outcome: null, opening };
    performOpenRecord(next);
    setAiGame(game); setPlacementPlayer(aiHumanPlayer); setPlacementLocked(true); setShowForbidden(aiForbiddenEnabled); setSheet(null); setDockPanel("moves");
    setToast(aiOpeningRule === "free" ? (aiHumanPlayer === "black" ? "人机新局已开始，你执黑先行" : "人机新局已开始，AI 执黑先行") : `${openingRuleName(aiOpeningRule, aiOpeningN)}开局已开始`);
    scheduleAiOpening(game, next, next.rootId);
  });
  const newRecord = () => withDraftGuard(() => { const next = createDocument(); performOpenRecord(next); setToast("已新建空白棋谱"); });
  const openRecord = (
    next: GameDocument,
    nodeId = next.rootId,
    options?: { largeId?: string; sourceFile?: File; onOpened?: () => void },
  ) => withDraftGuard(() => {
    performOpenRecord(next, nodeId, options?.largeId, options?.sourceFile);
    options?.onOpened?.();
  });
  const performOpenLargeRecord = async (summary: LargeDocumentSummary) => {
    setImportingFile(`正在读取 ${summary.metadata.title}`);
    try {
      if (summary.storageMode === "compact-index") {
        const handle = await openLibraryHandle(summary.id);
        if (!handle) { setToast("大型棋谱文件不存在，索引已清理"); await removeLargeDocument(summary.id); setLargeSummaries((items) => items.filter((item) => item.id !== summary.id)); return; }
        const session = new LibraryViewSession(handle, summary);
        const opened = await session.open(0);
        pagedNavigationVersion.current += 1;
        pagedSession.current?.close(); pagedSession.current = session;
        puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
        rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
        recordSession.current = { document: opened.document, currentId: opened.currentId };
        nativeSourceFile.current = null;
        setDocument(opened.document); setCurrentId(opened.currentId); setDraft(emptyDraft());
        setMode("record"); setAiGame(null); setDockPanel("moves"); setTab("record"); closeWorkspaceSelector();
        localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, summary.id);
        setToast("棋谱已用分页后端打开");
        return;
      }
      const next = await loadLargeDocument(summary.id);
      if (!next) { setToast("大型棋谱文件不存在，索引已清理"); await removeLargeDocument(summary.id); setLargeSummaries((items) => items.filter((item) => item.id !== summary.id)); return; }
      performOpenRecord(next, next.rootId, summary.id);
      void loadDraftForDocument(summary.id).then((stored) => {
        if (stored && compactIndexOf(next)) {
          const currentFingerprint = documentFingerprint(next);
          if (stored.baseFingerprint === currentFingerprint) setDraft({ operations: stored.operations, redo: stored.redo });
        }
      });
    } catch { setToast("大型棋谱读取失败，请检查本机存储"); }
    finally { setImportingFile(""); }
  };
  const openLargeRecord = (summary: LargeDocumentSummary) => withDraftGuard(() => { void performOpenLargeRecord(summary); });
  const performDeleteRecord = (item: GameDocument) => {
    if (mode === "record" && document.id === item.id) {
      pagedNavigationVersion.current += 1; pagedSession.current?.close(); pagedSession.current = null;
      const replacement = createDocument("新建棋谱");
      recordSession.current = { document: replacement, currentId: replacement.rootId };
      setDocument(replacement); setCurrentId(replacement.rootId); setDraft(emptyDraft());
    }
    setLibrary(removeFromLibrary(item.id));
  };
  const deleteRecord = (item: GameDocument) => withDraftGuard(() => performDeleteRecord(item));
  const performDeleteLargeRecord = (item: LargeDocumentSummary) => {
    if (localStorage.getItem(ACTIVE_LARGE_RECORD_KEY) === item.id) localStorage.removeItem(ACTIVE_LARGE_RECORD_KEY);
    largeSaveVersions.current.set(item.id, (largeSaveVersions.current.get(item.id) || 0) + 1);
    if (mode === "record" && document.id === item.id) {
      pagedNavigationVersion.current += 1; pagedSession.current?.close(); pagedSession.current = null;
      const replacement = createDocument("新建棋谱");
      recordSession.current = { document: replacement, currentId: replacement.rootId };
      setDocument(replacement); setCurrentId(replacement.rootId); setDraft(emptyDraft());
    }
    void removeLargeDocument(item.id)
      .then(() => setLargeSummaries((items) => items.filter((entry) => entry.id !== item.id)))
      .catch(() => setToast("大型棋谱删除失败，棋谱仍保留在库中"));
  };
  const deleteLargeRecord = (item: LargeDocumentSummary) => withDraftGuard(() => performDeleteLargeRecord(item));
  const createLibraryFolder = (kind: LibrarySection) => {
    setFolderCreationSection(kind);
    setNewFolderName("");
    setSheet("folder");
  };
  const confirmCreateLibraryFolder = () => {
    const name = newFolderName.trim();
    if (!name) { setToast("请输入文件夹名称"); return; }
    const key = folderCreationSection === "records" ? "recordFolders" : "puzzleFolders";
    if (libraryFolders[key].includes(name)) { setToast("已经有同名文件夹"); return; }
    setLibraryFolders((currentFolders) => ({ ...currentFolders, [key]: [...currentFolders[key], name] }));
    setExpandedLibraryFolder(name); setToast(`已创建文件夹“${name}”`);
    setSheet(null);
  };
  const assignLibraryItem = (kind: LibrarySection, id: string, folder: string) => {
    const key = kind === "records" ? "recordAssignments" : "puzzleAssignments";
    setLibraryFolders((currentFolders) => ({ ...currentFolders, [key]: { ...currentFolders[key], [id]: folder } }));
    setToast(`已移动到“${folder}”`);
  };
  const beginLibraryRename = (target: LibraryRenameTarget) => {
    setRenameTarget(target); setRenameName(target.name); setSheet("rename");
  };
  const confirmLibraryRename = async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) { setToast("请输入新的名称"); return; }
    if ((renameTarget.kind === "record-folder" || renameTarget.kind === "puzzle-folder") && name !== renameTarget.name) {
      const folders = renameTarget.kind === "record-folder" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders;
      if (folders.includes(name)) { setToast("已经有同名文件夹"); return; }
    }
    try {
      if (renameTarget.kind === "record-folder" || renameTarget.kind === "puzzle-folder") {
        const records = renameTarget.kind === "record-folder";
        const folderKey = records ? "recordFolders" : "puzzleFolders";
        const assignmentKey = records ? "recordAssignments" : "puzzleAssignments";
        const oldName = renameTarget.name;
        setLibraryFolders((folders) => {
          const assignments = { ...folders[assignmentKey] };
          Object.entries(assignments).forEach(([id, folder]) => { if (folder === oldName) assignments[id] = name; });
          if (records) {
            [...library, ...largeSummaries].forEach((item) => {
              if ((folders.recordAssignments[item.id] || "未分类") === oldName) assignments[item.id] = name;
            });
          } else {
            puzzleCollections.forEach((collection) => {
              const fallback = collection.id.startsWith("native-") || collection.id === "original-tactics" ? "内置题库" : "我的题库";
              if ((folders.puzzleAssignments[collection.id] || fallback) === oldName) assignments[collection.id] = name;
            });
          }
          return {
            ...folders,
            [folderKey]: folders[folderKey].map((folder) => folder === oldName ? name : folder),
            [assignmentKey]: assignments,
          } as LibraryFolders;
        });
        if (expandedLibraryFolder === oldName) setExpandedLibraryFolder(name);
        if (saveFolder === oldName) setSaveFolder(name);
      } else if (renameTarget.kind === "record") {
        const renamed = renameInLibrary(renameTarget.id, name);
        setLibrary(renamed.library);
        if (document.id === renameTarget.id) {
          const next = { ...document, metadata: { ...document.metadata, title: name }, updatedAt: renamed.document.updatedAt };
          setDocument(next); recordSession.current = { document: next, currentId };
        }
      } else if (renameTarget.kind === "large-record") {
        const renamed = await renameLargeDocument(renameTarget.id, name);
        setLargeSummaries((items) => items.map((item) => item.id === renamed.id ? renamed : item));
        if (document.id === renameTarget.id) {
          const next = { ...document, metadata: renamed.metadata, updatedAt: renamed.updatedAt };
          pagedSession.current?.setMetadata(renamed.metadata, renamed.updatedAt);
          setDocument(next); recordSession.current = { document: next, currentId };
        }
      } else if (renameTarget.kind === "puzzle-collection") {
        const next = puzzleCollections.map((collection) => collection.id === renameTarget.id ? { ...collection, title: name } : collection);
        savePuzzleTitleOverride(renameTarget.id, name); savePuzzleCollections(next); setPuzzleCollections(next);
      } else {
        const next = puzzleCollections.map((collection) => collection.id === renameTarget.collectionId
          ? { ...collection, puzzles: collection.puzzles.map((puzzle) => puzzle.id === renameTarget.id ? { ...puzzle, title: name } : puzzle) }
          : collection);
        savePuzzleTitleOverride(renameTarget.collectionId, name, renameTarget.id); savePuzzleCollections(next); setPuzzleCollections(next);
      }
      setSheet(null); setRenameTarget(null); setToast(`已重命名为“${name}”`);
    } catch (error) { setToast(error instanceof Error ? error.message : "重命名失败，请重试"); }
  };
  const setImportState = (state: string, detail?: unknown) => {
    (window as Window & { __banbuImportState?: { state: string; detail?: unknown; at: number } }).__banbuImportState = { state, detail, at: Date.now() };
  };
  const parseRecordFile = (file: File): Promise<ParsedImport> => {
    // LIB size alone is not enough to decide whether the decoded tree is
    // large. Keep every LIB in the worker so a compact index is also created
    // for a highly branching file whose bytes happen to compress well.
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["lib", "db", "dp"].includes(extension) && file.size < 4 * 1024 * 1024) return importRecordFile(file).then((result) => ({ result }));
    setImportState("worker-started", { name: file.name, size: file.size, extension });
    return new Promise((resolve, reject) => {
      const worker = new RecordImportWorker();
      let previewResolved = false;
      worker.onmessage = (event: MessageEvent<{ ok: boolean; preview?: boolean; finalOnly?: boolean; result?: ImportResult; summary?: LargeDocumentSummary; compactIndex?: CompactRenLibIndex; compactDiagnostic?: unknown; error?: string; stack?: string }>) => {
        if (event.data.finalOnly) {
          worker.terminate();
          if (event.data.summary) {
            setLargeSummaries((items) => [event.data.summary!, ...items.filter((item) => item.id !== event.data.summary!.id)]);
            setImportState("compact-saved", event.data.summary);
            (window as Window & { __banbuStorageDiagnostic?: unknown }).__banbuStorageDiagnostic = { ok: true, id: event.data.summary.id, storageMode: event.data.summary.storageMode, nodeCount: event.data.summary.nodeCount, background: true };
            // The preview session is already active. Do not recursively reopen
            // the same large record when finalOnly arrives; duplicated handles
            // caused crashes while the background index was finishing.
            // The preview is intentionally not persisted by handleFiles. Once
            // the worker commits the complete index, promote this active import
            // to the durable active record without reopening the same session.
            if (document.id === event.data.summary.id) {
              localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, event.data.summary.id);
              setImportState("compact-complete", event.data.summary);
            }
          }
          return;
        }
        if (!event.data.preview) worker.terminate();
        (window as Window & { __banbuWorkerMessage?: unknown }).__banbuWorkerMessage = { ok: event.data.ok, hasResult: Boolean(event.data.result), hasCompact: Boolean(event.data.compactIndex), diagnostic: event.data.compactDiagnostic || null, at: Date.now() };
        setImportState(event.data.ok ? "worker-message-received" : "parse-failed", event.data.ok ? event.data.compactDiagnostic || null : { error: event.data.error || "unknown", stack: event.data.stack || null });
        if (event.data.ok && event.data.result) {
          const compactIndex = event.data.compactIndex;
          const result = compactIndex
            ? { ...event.data.result, document: createLazyDocument(event.data.result.document as Omit<GameDocument, "nodes">, compactIndex) }
            : event.data.result;
          (window as Window & { __banbuImportDiagnostic?: unknown }).__banbuImportDiagnostic = event.data.compactDiagnostic || (compactIndex ? { hasCompact: true, nodeCount: compactIndex.nodeCount, rootId: compactIndex.rootId, rootFirstChild: compactIndex.firstChild[compactIndex.ids.indexOf(compactIndex.rootId)] ?? null } : { hasCompact: false });
          setImportState(compactIndex ? "compact-created" : "parse-success", event.data.compactDiagnostic || null);
          if (!previewResolved || event.data.preview) {
            previewResolved = true;
            resolve({ result, summary: event.data.summary, compactIndex });
          }
        }
        else reject(new Error(event.data.error || "大型棋谱解析失败"));
      };
      worker.onerror = () => { worker.terminate(); reject(new Error("大型棋谱后台解析线程异常")); };
      worker.postMessage(file);
    });
  };
  const handleFiles = async (files?: FileList | File[]) => {
    const requested = files ? Array.from(files) : [];
    if (!requested.length) return;
    const singleExtension = requested.length === 1 ? requested[0].name.split(".").pop()?.toLowerCase() || "" : "";
    if (requested.length !== 1 && requested.some((file) => file.name.split(".").pop()?.toLowerCase() === "lib")) {
      setToast("网页 RenLib 核心当前一次打开一份 LIB，请分开选择");
      return;
    }
    if (singleExtension === "lib") {
      setImportingFile(requested[0].name);
      setImportState("renlib-web-started", { name: requested[0].name, size: requested[0].size });
      const session = new RenLibWebViewSession();
      try {
        const opened = await session.open(requested[0]);
        dynamicViewSession.current?.close();
        dynamicViewSession.current = session;
        openRecord(opened.document, opened.currentId, { sourceFile: requested[0], onOpened: () => setImportState("renlib-web-query-ready", { name: requested[0].name, size: requested[0].size }) });
        setToast("已用网页 RenLib 核心打开，分支与注释按当前局面实时读取");
      } catch (error) {
        session.close();
        setImportState("renlib-web-failed", { error: error instanceof Error ? error.message : String(error) });
        setToast(error instanceof Error ? error.message : "RenLib 网页核心打开失败");
      } finally { setImportingFile(""); }
      return;
    }
    if (singleExtension === "db" || singleExtension === "dp") {
      setImportingFile(requested[0].name); setImportState("dp-index-started", { name: requested[0].name, size: requested[0].size });
      const session = new DpViewSession();
      try {
        const opened = await session.open(requested[0]);
        dynamicViewSession.current?.close(); dynamicViewSession.current = session;
        openRecord(opened.document, opened.currentId, { sourceFile: requested[0], onOpened: () => setImportState("dp-query-ready", { records: opened.recordCount }) });
        setToast(`已打开 DP 数据库，共 ${opened.recordCount} 条记录，分支按局面实时读取`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "DP 数据库打开失败";
        session.close();
        setImportState("dp-index-failed", { name: requested[0].name, size: requested[0].size, error: message });
        setToast(`无法打开 ${requested[0].name}：${message}`);
      } finally { setImportingFile(""); }
      return;
    }
    const supported = new Set(["sgf", "fgf", "pos", "txt", "ren", "renjs", "wzq", "lib", "renju", "json", "db", "dp"]);
    const failures: { file: string; reason: unknown }[] = [];
    const selected = requested.filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const maximum = ["lib", "db", "dp"].includes(extension) ? Number.POSITIVE_INFINITY : MAX_OTHER_RECORD_BYTES;
      const maximumLabel = "64MB";
      const reason = extension === "zip"
        ? "ZIP 只是压缩包，不是棋谱格式；请先解压后选择其中的 LIB 文件"
        : !supported.has(extension)
        ? `不支持 .${extension || "未知"} 文件`
        : file.size > maximum ? `${extension.toUpperCase()} 单个文件不能超过 ${maximumLabel}（按解压后的实际文件大小计算）` : "";
      if (reason) failures.push({ file: file.name, reason: new Error(reason) });
      return !reason;
    });
    const imported: { file: File; result: ImportResult; summary?: LargeDocumentSummary; compactIndex?: CompactRenLibIndex; sourceBytes: number; isPrimary: boolean }[] = [];
    setImportState("file-selected", { names: selected.map((file) => file.name), sizes: selected.map((file) => file.size) });
    setImportingFile(selected.length === 1 ? selected[0]?.name || "" : `正在导入 ${selected.length} 份棋谱`);
    for (let index = 0; index < selected.length; index += 2) {
      const batch = selected.slice(index, index + 2);
      const settled = await Promise.allSettled(batch.map((file) => parseRecordFile(file)));
      settled.forEach((result, resultIndex) => {
        if (result.status === "fulfilled") {
          const file = batch[resultIndex], parsed = result.value.result;
          const documents = [parsed.document, ...(parsed.additionalDocuments || [])];
          const sourceFormat = sourceFormatOf(file.name);
          documents.forEach((item) => { item.metadata = { ...item.metadata, sourceFormat, sourceFileName: file.name }; });
          const sourceBytes = Math.ceil(file.size / documents.length);
          documents.forEach((document, documentIndex) => imported.push({
            file,
            result: { ...parsed, document, additionalDocuments: undefined, warnings: documentIndex === 0 ? parsed.warnings : [] },
            summary: documentIndex === 0 ? result.value.summary : undefined,
            compactIndex: documentIndex === 0 ? result.value.compactIndex : undefined,
            sourceBytes,
            isPrimary: documentIndex === 0,
          }));
        }
        else failures.push({ file: batch[resultIndex].name, reason: result.reason });
      });
    }
    setImportingFile("");
    if (!imported.length) {
      const first = failures[0]?.reason;
      setToast(first instanceof Error ? first.message : "所选文件均导入失败");
      return;
    }
    // A transferred compact index is already complete and navigable. Show it
    // immediately while IndexedDB persistence continues; waiting for every
    // chunk to be committed made medium DP databases appear frozen for over a
    // minute even though parsing had finished.
    if (requested.length === 1) {
      const immediate = imported.find((item) => item.isPrimary && item.compactIndex && !item.summary?.preview);
      if (immediate) {
        const active = immediate.result.document;
        openRecord(active, active.rootId, {
          sourceFile: immediate.file,
          onOpened: () => setImportState("document-opened", { id: immediate.result.document.id, title: immediate.result.document.metadata.title, persistence: "background" }),
        });
        const warningCount = immediate.result.warnings.length;
        setToast(`已导入 ${active.metadata.title}${warningCount ? `，${warningCount} 条提示` : ""}，正在后台保存`);
        void saveCompactIndex(active, immediate.compactIndex!, immediate.summary).then((summary) => {
          setLargeSummaries((items) => [summary, ...items.filter((item) => item.id !== summary.id)]);
          localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, summary.id);
          setImportState("compact-saved", { id: summary.id, nodeCount: summary.nodeCount, storageMode: summary.storageMode });
          (window as Window & { __banbuStorageDiagnostic?: unknown }).__banbuStorageDiagnostic = { ok: true, id: summary.id, storageMode: summary.storageMode, nodeCount: summary.nodeCount, background: true };
        }).catch((error) => {
          (window as Window & { __banbuStorageDiagnostic?: unknown }).__banbuStorageDiagnostic = { ok: false, id: active.id, error: error instanceof Error ? error.message : String(error) };
          setToast("棋谱已打开，但后台保存失败");
        });
        return;
      }
    }
    const largeImports = imported.filter(({ result, sourceBytes, summary, compactIndex }) => Boolean(compactIndex) || sourceBytes >= 4 * 1024 * 1024 || (summary?.nodeCount || Object.keys(result.document.nodes).length) >= 40000);
    const normalImports = imported.filter((item) => !largeImports.includes(item));
    let saved = { library: loadLibrary(), resolved: [] as GameDocument[], inserted: 0, duplicates: 0, conflicts: 0 };
    let largeInserted = 0, largeDuplicates = 0, largeConflicts = 0;
    let resolvedSingle: GameDocument | null = null;
    try {
      if (normalImports.length) {
        const normalCandidates = normalImports.map(({ result }, index) => {
          if (!largeSummaries.some((item) => item.id === result.document.id)) return result.document;
          largeConflicts += 1;
          return { ...result.document, id: `${result.document.id}-import-${Date.now().toString(36)}-normal-${index}` };
        });
        saved = saveManyToLibrary(normalCandidates);
        if (requested.length === 1) {
          const primaryIndex = normalImports.findIndex((item) => item.isPrimary);
          if (primaryIndex >= 0) resolvedSingle = saved.resolved[primaryIndex] || null;
        }
      }
      const summaryPool = [...largeSummaries];
      const occupiedIds = new Set([...saved.library.map((item) => item.id), ...summaryPool.map((item) => item.id)]);
      const ordinaryFingerprints = new Map(saved.library.map((item) => [documentFingerprint(item), item]));
      for (let index = 0; index < largeImports.length; index += 1) {
        const original = largeImports[index].result.document;
        const prepared = largeImports[index].summary;
        // A preview is an in-memory window only. The worker continues parsing
        // and owns the eventual complete index, so never write the preview as
        // the official record or count it as an inserted library item.
        if (prepared?.preview) {
          if (requested.length === 1 && largeImports[index].isPrimary) resolvedSingle = original;
          continue;
        }
        const fingerprint = prepared?.fingerprint || documentFingerprint(original);
        const duplicate = summaryPool.find((item) => item.fingerprint === fingerprint);
        const ordinaryDuplicate = ordinaryFingerprints.get(fingerprint);
        if (duplicate || ordinaryDuplicate) {
          largeDuplicates += 1;
          if (requested.length === 1 && largeImports[index].isPrimary) resolvedSingle = ordinaryDuplicate || (duplicate ? await loadLargeDocument(duplicate.id) : null);
          continue;
        }
        let candidate = original;
        if (occupiedIds.has(candidate.id)) {
          candidate = { ...candidate, id: `${candidate.id}-import-${Date.now().toString(36)}-${index}` };
          largeConflicts += 1;
        }
        try {
          const compactIndex = largeImports[index].compactIndex;
          const summary = compactIndex
            ? await saveCompactIndex(candidate, compactIndex, prepared)
            : await saveLargeDocument(candidate, prepared);
          setImportState(compactIndex ? "compact-saved" : "document-saved", { id: candidate.id, nodeCount: summary.nodeCount, storageMode: summary.storageMode });
          (window as Window & { __banbuStorageDiagnostic?: unknown }).__banbuStorageDiagnostic = { ok: true, id: candidate.id, storageMode: summary.storageMode, nodeCount: summary.nodeCount };
          summaryPool.push(summary); occupiedIds.add(candidate.id); largeInserted += 1;
          if (requested.length === 1 && largeImports[index].isPrimary) resolvedSingle = candidate;
        } catch (error) {
          failures.push({ file: largeImports[index].file.name, reason: error });
          (window as Window & { __banbuStorageDiagnostic?: unknown }).__banbuStorageDiagnostic = { ok: false, id: candidate.id, error: error instanceof Error ? error.message : String(error) };
          if (requested.length === 1 && largeImports[index].isPrimary) { resolvedSingle = null; setImportState("compact-created", { id: candidate.id, nodeCount: largeImports[index].compactIndex?.nodeCount || 0, storageError: error instanceof Error ? error.message : String(error) }); }
        }
      }
      setLargeSummaries(summaryPool.sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0)));
      setLibrary(saved.library);
    } catch (error) {
      setToast(error instanceof DOMException && error.name === "QuotaExceededError" ? "本机存储空间不足，棋谱已解析但尚未保存" : "棋谱已解析，但写入本地棋谱库失败");
      return;
    }
    const warningCount = imported.reduce((count, item) => count + item.result.warnings.length, 0);
    if (requested.length === 1) {
      const active = resolvedSingle;
      if (!active) { setToast("棋谱已解析，但写入大型棋谱库失败"); return; }
      if (active && tab === "library") { setLibrarySection("records"); setExpandedLibraryFolder(libraryFolders.recordAssignments[active.id] || "未分类"); }
      else if (active) {
        const largeId = largeImports.length && !saved.library.some((item) => item.id === active.id) ? active.id : undefined;
        openRecord(active, active.rootId, { largeId, sourceFile: imported[0]?.file, onOpened: () => setImportState("document-opened", { id: active.id, title: active.metadata.title }) });
      }
      setImportState("import-success", { id: active.id, title: active.metadata.title });
      const hasBackgroundImport = largeImports.some((item) => item.summary?.preview);
      setToast(`${saved.duplicates + largeDuplicates ? "该棋谱已存在" : `已导入 ${imported[0].result.format}`}${largeInserted ? "，已存入大型棋谱库" : ""}${hasBackgroundImport ? "，首批数据已打开，后台继续建立完整索引" : ""}${warningCount ? `，${warningCount} 条提示` : ""}`);
      return;
    }
    setTab("library");
    setToast(`新增 ${saved.inserted + largeInserted} 份${saved.duplicates + largeDuplicates ? `，跳过 ${saved.duplicates + largeDuplicates} 份重复` : ""}${saved.conflicts + largeConflicts ? `，解决 ${saved.conflicts + largeConflicts} 个 ID 冲突` : ""}${failures.length ? `，${failures.length} 份失败` : ""}${warningCount ? `，${warningCount} 条提示` : ""}`);
  };
  const handleBoardImage = async (file?: File) => {
    if (!file) return;
    setImageRecognizing(true);
    try {
      const requestedSize = window.prompt("请输入图片中的棋盘路数（5–25）", String(document.metadata.boardSize || 15));
      if (requestedSize === null) return;
      const size = Number(requestedSize);
      if (!isSupportedBoardSize(size)) throw new Error("棋盘尺寸必须是 5–25 的整数");
      const result = await recognizeBoardImage(file, size);
      const next = createDocument(file.name.replace(/\.[^.]+$/, "") || "图片识谱", result.boardSize);
      const root = next.nodes[next.rootId];
      root.setup = { black: [], white: [], empty: [] };
      result.board.forEach((row, r) => row.forEach((player, c) => { if (player) root.setup?.[player].push({ row: r, col: c }); }));
      performOpenRecord(next);
      setSaved(false);
      setToast(`${result.boardSize}路图片识谱完成：识别 ${result.board.flat().filter(Boolean).length} 子，置信度 ${Math.round(result.confidence * 100)}%${result.ignoredColoredMarkers ? `，忽略 ${result.ignoredColoredMarkers} 个彩色分析点` : ""}${result.numberedMoves.length ? "，已恢复顺序" : "；未检测到可靠数字，请人工确认"}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "图片识谱失败，请使用清晰的棋盘截图"); }
    finally { setImageRecognizing(false); }
  };

  const handlePuzzleFile = async (file?: File) => {
    if (!file) return;
    try {
      const report = importKaibaoPuzzleJson(await file.text(), file.name.replace(/\.json$/i, ""));
      const nextCollections = [...puzzleCollections, report.collection];
      setPuzzleCollections(nextCollections); savePuzzleCollections(nextCollections);
      setLibraryFolders((currentFolders) => ({ ...currentFolders, puzzleAssignments: { ...currentFolders.puzzleAssignments, [report.collection.id]: "我的题库" } }));
      if (tab === "library") { setLibrarySection("puzzles"); setExpandedLibraryFolder("我的题库"); }
      else guardedOpenPuzzle(nextCollections.length - 1, 0, nextCollections);
      setToast(`已导入 ${report.collection.puzzles.length} 题${report.skipped ? `，跳过 ${report.skipped} 个空项` : ""}${report.warnings.length ? `，${report.warnings.length} 条提示` : ""}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "题库导入失败"); }
  };

  const exportDocument = hasDraft(draft) ? viewDocument : document;
  const sourceFormat = exportDocument.metadata.sourceFormat;
  const originalBinaryFile = sourceFormat && binarySourceFormats.has(sourceFormat) ? nativeSourceFile.current : null;
  const directExportAvailable = !sourceFormat
    || Boolean(sourceFormat && (sgfSourceFormats.has(sourceFormat) || jsonSourceFormats.has(sourceFormat) || posSourceFormats.has(sourceFormat)))
    || Boolean(originalBinaryFile);
  const directFormatLabel = !sourceFormat ? "SGF（新棋谱默认）"
    : sgfSourceFormats.has(sourceFormat) ? sourceFormat.toUpperCase()
    : jsonSourceFormats.has(sourceFormat) ? `${sourceFormat.toUpperCase()} JSON`
    : posSourceFormats.has(sourceFormat) ? sourceFormat.toUpperCase()
    : originalBinaryFile ? sourceFormat.toUpperCase() : `${sourceFormat.toUpperCase()}（原文件未保留）`;
  const exportAsFormat = (format: "sgf" | "json") => {
    const name = safeName(exportDocument.metadata.title);
    if (format === "sgf") {
      void exportRecordFile(exportSgf(exportDocument), `${name}.sgf`, "application/x-go-sgf;charset=utf-8", "SGF 棋谱已导出");
      return;
    }
    void exportRecordFile(exportJson(exportDocument), `${name}.json`, "application/json;charset=utf-8", "JSON 棋谱已导出");
  };
  const exportDirect = () => {
    const name = safeName(exportDocument.metadata.title);
    if (!sourceFormat || sgfSourceFormats.has(sourceFormat)) {
      const extension = sourceFormat && sgfSourceFormats.has(sourceFormat) ? sourceFormat : "sgf";
      void exportRecordFile(exportSgf(exportDocument), `${name}.${extension}`, "application/x-go-sgf;charset=utf-8", `${extension.toUpperCase()} 棋谱已直接导出`);
      return;
    }
    if (jsonSourceFormats.has(sourceFormat)) {
      void exportRecordFile(exportJson(exportDocument), `${name}.${sourceFormat}`, "application/json;charset=utf-8", `${sourceFormat.toUpperCase()} 棋谱已直接导出`);
      return;
    }
    if (posSourceFormats.has(sourceFormat)) {
      void exportRecordFile(exportPos(exportDocument), `${name}.${sourceFormat}`, "text/plain;charset=utf-8", `${sourceFormat.toUpperCase()} 主线已直接导出`);
      return;
    }
    if (originalBinaryFile) {
      void exportRecordFile(originalBinaryFile, originalBinaryFile.name, originalBinaryFile.type || "application/octet-stream", `${sourceFormat.toUpperCase()} 原文件已直接导出`);
      return;
    }
    setToast(`${sourceFormat.toUpperCase()} 原始字节未保留；请改用 SGF 或 JSON 导出当前可见棋谱`);
  };

  const sheetTitle = sheet === "comment" ? "节点注释" : sheet === "branches" ? "变化分支" : sheet === "metadata" ? "棋谱信息" : sheet === "save" ? "保存棋谱" : sheet === "folder" ? `新建${folderCreationSection === "records" ? "棋谱" : "题库"}文件夹` : sheet === "rename" ? "重命名" : sheet === "export" ? "导出与分享" : sheet === "about" ? "关于半步五子棋" : sheet === "find" ? "查找本谱" : sheet === "analysis" ? "局面分析" : sheet === "positionSearch" ? "跨谱局面检索" : sheet === "marks" ? "棋盘标注" : sheet === "import" ? "选择导入方式" : sheet === "aiGame" ? "AI 人机对战" : sheet === "think" ? "AI 思考" : "使用提示";
  // A branch exists only at a real split point: the position must have at
  // least two direct continuations. Walk backwards so a long single-line
  // continuation never gets mistaken for a branch.
  const branchNode = [...path].reverse().find((node) => node.children.length >= 2);
  const branchView = branchNode || current;
  const branchPivotId = branchNode?.id;
  const branchIndex = compactIndexOf(document);
  const branchViewIndex = branchIndex ? compactNodeIndex(document, branchView.id) : undefined;
  // When a draft exists, overlayChildren may add/remove nodes; branchTotal must
  // match the same effective children list used by the virtual window.
  const branchOverlayChildren = hasDraft(draft) && branchIndex ? overlayChildren(document, draftOverlay, branchView.id) : null;
  const branchChildIds = branchOverlayChildren || branchView.children;
  // The current node may be several moves after the branch pivot. Resolve the
  // first child on the current path so branch switching stays available.
  const branchChildId = branchNode ? path.find((node) => node.parentId === branchNode.id)?.id : undefined;
  const branchCurrentIndex = branchChildId ? branchChildIds.indexOf(branchChildId) : -1;
  const switchBranch = (delta: number) => {
    if (branchCurrentIndex < 0) return;
    const id = branchChildIds[branchCurrentIndex + delta];
    if (id) chooseChild(id, branchView.id);
  };
  const branchTotal = branchOverlayChildren
    ? branchOverlayChildren.length
    : branchViewIndex === undefined || !branchIndex ? branchView.children.length : compactChildCount(branchIndex, branchViewIndex);
  const branchWindow = useMemo(() => {
    const viewportHeight = 360;
    const start = Math.max(0, Math.floor(branchScrollTop / BRANCH_ROW_HEIGHT) - BRANCH_OVERSCAN);
    const end = Math.min(branchTotal, Math.ceil((branchScrollTop + viewportHeight) / BRANCH_ROW_HEIGHT) + BRANCH_OVERSCAN);
    let ids: string[];
    if (branchOverlayChildren) {
      ids = branchOverlayChildren.slice(start, end);
    } else if (branchIndex && branchViewIndex !== undefined) {
      ids = compactChildWindow(branchIndex, branchViewIndex, start, end);
    } else {
      ids = branchView.children.slice(start, end);
    }
    return { start, end, ids };
  }, [branchIndex, branchViewIndex, branchView, branchScrollTop, branchTotal, branchOverlayChildren]);
  const visiblePositionMatches = positionMatches.filter((match) => match.documentId !== document.id || match.nodeId !== currentId);
  const currentHasComment = mode === "record" && hasNativeAnnotation(current);
  return <div className="app-shell">
    <input ref={singleFileInput} type="file" hidden accept="*/*" onChange={(event) => { void handleFiles(event.target.files || undefined); event.target.value = ""; }}/>
    <input ref={puzzleFileInput} type="file" hidden accept=".json,application/json" onChange={(event) => { void handlePuzzleFile(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={imageFileInput} type="file" hidden accept="image/*" onChange={(event) => { void handleBoardImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <header className="topbar"><div className="brand"><span className="brand-mark">半</span><div><b>半步五子棋</b><small>{mode === "puzzle" ? `${puzzleCollections.reduce((sum, item) => sum + item.puzzles.length, 0)} 道题已就绪` : hasDraft(draft) ? "有未保存草稿" : saved ? <><Check size={12}/> 已保存</> : "保存中…"}</small></div></div><div className="top-actions"><button className="icon-button" onClick={openImportSheet} aria-label="打开导入方式"><Download size={20}/></button>{mode === "record" && <><button className="icon-button" onClick={() => setSheet("export")} aria-label="打开导出方式"><Upload size={20}/></button><button className="icon-button save-action" onClick={openSaveDialog} aria-label="保存棋谱"><Save size={20}/></button></>}</div></header>

    <main className="app-main">
      {tab === "record" && <div className="record-page">
        <section className="workspace-bar"><button className={`workspace-current ${workspaceSelectorOpen ? "open" : ""}`} onClick={() => { setWorkspaceSelectorOpen((open) => !open); if (workspaceSelectorOpen) { setWorkspaceListExpanded(false); setExpandedCollectionId(null); } }}><span>{mode === "record" ? "谱" : "题"}</span><div><b>{mode === "record" ? viewDocument.metadata.title : currentPuzzle?.title || "选择题目"}</b><small>{mode === "record" ? `${viewDocument.metadata.black} vs ${viewDocument.metadata.white} · 第 ${depthOf(viewDocument, currentId)} 手` : `${puzzleCollections[puzzleCollectionIndex]?.title || "题库"} · ${puzzleIndex + 1}/${puzzleCollections[puzzleCollectionIndex]?.puzzles.length || 0}`}</small></div><ChevronDown size={18}/></button>{mode === "record" && <div className="workspace-meta"><span>{hasDraft(draft) ? "有未保存草稿" : candidateLabel ? `标注「${candidateLabel}」` : current.move ? `${current.move.player === "black" ? "黑" : "白"} · ${coordinateName(current.move)}` : nodeKindLabel(current)}</span><small>{depthOf(viewDocument, currentId)} / {compactNodeCount(document) ? "大型" : mainLineLength(document)} 手 · {branchCount(viewDocument)} 处分支</small></div>}<div className="workspace-mode-stack"><button className={`workspace-mode-toggle ${mode}`} onClick={() => switchMode(mode === "record" ? "puzzle" : "record")} role="switch" aria-checked={mode === "puzzle"} aria-label={`当前${mode === "record" ? "打谱" : "做题"}模式，点击切换`}><i/><span>打谱</span><span>做题</span></button>{mode === "record" && aiGame && <button className="exit-ai-game" onClick={exitAiGame}>退出对弈</button>}</div></section>
        {workspaceSelectorOpen && <section className="inline-workspace-selector" aria-label={mode === "record" ? "本页切换棋谱" : "本页切换题目"}>
          <button className="selector-master-toggle" onClick={() => setWorkspaceListExpanded((expanded) => !expanded)}><span><b>{mode === "record" ? "选择棋谱" : "选择题集与题目"}</b><small>{mode === "record" ? `${searchableDocuments.length + largeSummaries.filter((item) => item.id !== document.id).length} 份棋谱，可上下滑动` : `${puzzleCollections.length} 个题集，可上下滑动`}</small></span><span>{workspaceListExpanded ? "收起" : "展开全部"}<ChevronDown size={17}/></span></button>
          {workspaceListExpanded && mode === "record" && <div className="inline-record-list">{searchableDocuments.map((item) => <button key={item.id} className={item.id === document.id ? "current" : ""} onClick={() => openRecord(item)}><span className="picker-record-stone">{mainLineLength(item)}</span><div><b>{item.metadata.title}</b><small>{item.metadata.black} vs {item.metadata.white} · {item.metadata.rule === "renju" ? "连珠" : "五子棋"}</small></div>{item.id === document.id ? <Check size={17}/> : <ChevronRight size={17}/>}</button>)}{largeSummaries.filter((item) => item.id !== document.id).map((item) => <button key={item.id} onClick={() => { void openLargeRecord(item); }}><span className="picker-record-stone">{item.mainLineLength}</span><div><b>{item.metadata.title}</b><small>{item.metadata.black} vs {item.metadata.white} · 大型棋谱</small></div><ChevronRight size={17}/></button>)}</div>}
          {workspaceListExpanded && mode === "puzzle" && <div className="inline-collection-list">{puzzleCollections.map((collection, collectionIndex) => { const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length; const expanded = expandedCollectionId === collection.id; const query = expanded ? puzzleQuery.trim().toLowerCase() : ""; const visiblePuzzles = collection.puzzles.filter((puzzle, index) => !query || puzzle.title.toLowerCase().includes(query) || puzzle.prompt.toLowerCase().includes(query) || String(index + 1).includes(query)); return <section key={collection.id} className={expanded ? "expanded" : ""}><button className="collection-accordion-head" onClick={() => { setExpandedCollectionId(expanded ? null : collection.id); setPuzzleQuery(""); }}><span className="puzzle-folder-icon"><FolderOpen size={18}/></span><div><b>{collection.title}</b><small>{solved}/{collection.puzzles.length} 已完成</small></div><ChevronDown size={18}/></button>{expanded && <div className="collection-accordion-body"><label className="picker-search"><Search size={16}/><input value={puzzleQuery} onChange={(event) => setPuzzleQuery(event.target.value)} placeholder="输入题号或关键词"/><button onClick={() => setPuzzleQuery("")} aria-label="清除"><X size={15}/></button></label><div className="inline-puzzle-list">{visiblePuzzles.map((puzzle) => { const actualIndex = collection.puzzles.indexOf(puzzle); const solvedPuzzle = puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved; return <button key={puzzle.id} className={collectionIndex === puzzleCollectionIndex && actualIndex === puzzleIndex ? "current" : ""} onClick={() => openPuzzle(collectionIndex, actualIndex)}><span className={solvedPuzzle ? "solved" : ""}>{solvedPuzzle ? <Check size={14}/> : actualIndex + 1}</span><div><b>{puzzle.title || `第 ${actualIndex + 1} 题`}</b><small>{puzzle.player === "black" ? "黑先" : "白先"} · {puzzle.prompt}</small></div><ChevronRight size={16}/></button>; })}</div></div>}</section>; })}</div>}
        </section>}
        {mode === "record" && (isDynamicDatabaseView(document) || isPagedLibraryView(document)) && <div className="database-edit-hint"><Lock size={15}/><span><b>数据库浏览模式</b><small>点已有分支继续浏览；点其他空位、标注或编辑注释会创建本地编辑副本。</small></span></div>}
        {mode === "record" && aiGame && aiOpeningStage?.kind !== "normal" && <section className="ai-opening-banner" aria-live="polite"><span className="ai-opening-step">开</span><div><b>{openingRuleName(aiGame.opening.rule, aiGame.opening.n)}</b><small>{openingInstruction(aiGame.opening)}</small></div>{aiOpeningStage?.kind === "swap" && aiOpeningStage.chooser === "human" && <div className="ai-opening-actions"><button onClick={() => chooseOpeningSwap(false)}>{aiOpeningStage.taraguchiChoice ? "进入十打" : "不交换"}</button><button className="accent" onClick={() => chooseOpeningSwap(true)}>交换</button></div>}{aiThinking && <i className="ai-opening-thinking"/>}</section>}
        <Board document={viewDocument} currentId={currentId} currentBookmarked={activeBookmarks.some((bookmark) => bookmark.nodeId === currentId)} showNumbers={showNumbers} showCoordinates={showCoordinates} largeBoard={largeBoard} rotation={rotation} mirrored={mirrored} initialDepth={mode === "puzzle" ? puzzleInitialDepth : 0} forbiddenMarkers={boardForbiddenMarkers} winningLines={boardWinningLines} openingCandidates={aiGame?.opening.candidates || []} openingStage={aiOpeningStage} thinkingMove={thinkResult?.move} disabled={(mode === "puzzle" && (aiThinking || !!puzzleOutcome)) || aiBoardDisabled} onPlay={play} onMark={mode === "record" && !aiGame ? mark : () => undefined}/>
        <div className={`workspace-status ${puzzleOutcome || ""}`}>{mode === "record" ? <><div className="record-command-bar" aria-label="常驻打谱工具">
            {mode === "record" && <button className={`command-comment ${currentHasComment ? "has-comment" : ""} ${commentExpanded && currentHasComment ? "active" : ""}`} onClick={() => currentHasComment && setCommentExpanded((open) => !open)} aria-label={currentHasComment ? (commentExpanded ? "收起注释" : "展开注释") : "当前无注释"} title={currentHasComment ? (commentExpanded ? "收起注释" : "展开注释") : "当前无注释"}><MessageSquareText/></button>}
            <button className={`command-save ${hasDraft(draft) ? "pending" : ""}`} onClick={saveCurrentDraft} aria-label={hasDraft(draft) ? `保存当前棋谱修改（${draft.operations.length} 项）` : "当前棋谱已保存"} title={hasDraft(draft) ? "保存修改" : "已保存"}><Save/></button>
            <button className="command-delete" onClick={deleteCurrentVariation} disabled={!current.parentId} aria-label="删除当前一步及后续变化" title={!current.parentId ? "起始局面不可删除" : isPagedLibraryView(document) || isDynamicDatabaseView(document) ? "将在本地编辑副本中删除，原数据库不变" : "删除本步及后续变化"}><Trash2/></button>
            <button className={`command-think ${machineThinking ? "running machine-thinking" : ""}`} onClick={startThink} disabled={machineThinking || !!aiGame} aria-label={machineThinking ? "AI 正在思考" : "思考当前局面的下一步"} title={aiGame ? "人机对局会自动思考" : machineThinking ? "AI 正在思考" : "思考当前局面的下一步"}><Bot/></button>
            <div className={`stone-color-switch ${activePlacementPlayer} ${placementLocked ? "locked" : "following"}`} role="radiogroup" aria-label="落子颜色">
              <i aria-hidden="true"/>
              <button className={activePlacementPlayer === "black" ? "selected" : ""} onClick={() => { setPlacementPlayer("black"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "black"} aria-label="黑棋" title="锁定黑棋"><span className="player-stone black"/></button>
              <button className={activePlacementPlayer === "white" ? "selected" : ""} onClick={() => { setPlacementPlayer("white"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "white"} aria-label="白棋" title="锁定白棋"><span className="player-stone white"/></button>
              <button className={`lock-toggle ${placementLocked ? "locked" : ""}`} onClick={() => setPlacementLocked((locked) => !locked)} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定，自动换色" : "跟随当前棋谱颜色"} title={placementLocked ? "解除锁定" : "自动换色"}><Lock/></button>
            </div>
          </div></> : <><span>{puzzleOutcome === "won" ? "挑战成功" : puzzleOutcome === "lost" ? "本题失败" : puzzleOutcome === "stopped" ? "思考已停止" : aiThinking ? "陪练思考中" : `${currentPuzzle?.player === "black" ? "黑" : "白"}方由你落子`}</span><small>{puzzleOutcome ? "可悔棋或重启本题" : currentPuzzle?.prompt}</small>{machineThinking && <span className="machine-thinking-status" aria-label="AI 正在思考"><Bot size={16}/></span>}</>}</div>
        {mode === "record" && hasNativeAnnotation(current) && commentExpanded && <div className="comment-review"><div className="comment-preview">{annotationLines(current).map((text, index) => <div key={`${current.id}-annotation-${index}`}>{text}</div>)}</div></div>}
        <section className="context-dock">
          <nav className="dock-tabs">{mode === "record" ? <><button aria-label="行棋" className={dockPanel === "moves" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "moves" ? null : "moves")}><Redo2/>走棋</button><button aria-label="编辑" className={dockPanel === "notes" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "notes" ? null : "notes")}><MessageSquareText/>编辑</button><button aria-label="更多" className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "view" ? null : "view")}><MoreHorizontal/>更多</button><button aria-label="标注" className={candidateLabel ? "active" : ""} onClick={() => setSheet("marks")}><Tag/>标注</button></> : <><button className={dockPanel === "play" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "play" ? null : "play")}><Undo2/>应战</button><button className={dockPanel === "puzzles" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "puzzles" ? null : "puzzles")}><BookOpen/>题目</button><button className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "view" ? null : "view")}><MoreHorizontal/>更多</button></>}</nav>
          {dockPanel && <div className="dock-panel">
            {mode === "record" && dockPanel === "moves" && <><button onClick={goRoot} aria-label="到第一手"><ChevronFirst/><span>起点</span></button><button onClick={goPrev} disabled={!current.parentId} aria-label="上一手"><ChevronLeft/><span>上一手</span></button><button className="accent" onClick={goNext} disabled={!preferredNext(viewDocument, currentId)} aria-label="下一手"><ChevronRight/><span>下一手</span></button><button onClick={goPreferredEnd} aria-label="到最后一手"><ChevronLast/><span>终点</span></button>{branchTotal >= 2 && <button onClick={() => { setBranchPage(1); setSheet("branches"); }}><GitBranch/><span>分支</span></button>}{hasDraft(draft) && <><button onClick={undoDraftChange}><Undo2/><span>撤销</span></button><button onClick={discardDraft}><X/><span>放弃</span></button></>}</>}
            {mode === "record" && dockPanel === "notes" && <><button onClick={() => setSheet("comment")}><MessageSquareText/><span>注释</span></button><button onClick={() => setSheet("metadata")}><Save/><span>信息</span></button></>}
            {dockPanel === "view" && <><button onClick={() => setSheet("find")}><Search/><span>查找</span></button><button onClick={() => setShowNumbers((value) => !value)}><Tag/><span>{showNumbers ? "隐藏手数" : "显示手数"}</span></button><button onClick={() => setShowCoordinates((value) => !value)}><Menu/><span>{showCoordinates ? "隐藏坐标" : "显示坐标"}</span></button><button onClick={() => setRotation((value) => ((value + 90) % 360) as 0 | 90 | 180 | 270)}><RotateCw/><span>旋转</span></button><button onClick={() => setMirrored((value) => !value)}><FlipHorizontal/><span>镜像</span></button></>}
            {mode === "puzzle" && dockPanel === "play" && <><button onClick={undoPuzzleTurn} disabled={depthOf(document, currentId) <= puzzleInitialDepth}><Undo2/><span>悔棋</span></button><button onClick={restartPuzzle}><RotateCw/><span>重启</span></button><button className={aiThinking ? "danger" : "accent"} onClick={aiThinking ? stopPuzzleAi : () => movePuzzle(1)}>{aiThinking ? <X/> : <ChevronRight/>}<span>{aiThinking ? "停止" : "下一题"}</span></button></>}
{mode === "puzzle" && dockPanel === "puzzles" && <><button onClick={() => movePuzzle(-1)}><ChevronLeft/><span>上一题</span></button><button className="accent" onClick={() => { setWorkspaceSelectorOpen(true); setWorkspaceListExpanded(true); setExpandedCollectionId(puzzleCollections[puzzleCollectionIndex]?.id || null); window.scrollTo({ top: 0, behavior: "smooth" }); }}><BookOpen/><span>选题</span></button><button onClick={() => movePuzzle(1)}><ChevronRight/><span>下一题</span></button></>}
          </div>}
        </section>
      </div>}

      {tab === "library" && <div className="library-page page-padding">
        <div className="page-title"><div><span>LOCAL LIBRARY</span><h1>棋谱库</h1><p>题库和棋谱分开管理，均可建立文件夹</p></div></div>
        <div className="library-segment" role="tablist"><button className={librarySection === "puzzles" ? "active" : ""} onClick={() => { setLibrarySection("puzzles"); setExpandedLibraryFolder(libraryFolders.puzzleFolders[0] || null); }} role="tab">题库 <small>{puzzleCollections.length}</small></button><button className={librarySection === "records" ? "active" : ""} onClick={() => { setLibrarySection("records"); setExpandedLibraryFolder(libraryFolders.recordFolders[0] || null); }} role="tab">棋谱 <small>{library.length + largeSummaries.length}</small></button></div>
        {librarySection === "records" ? <>
          <div className="library-actions three"><button onClick={openRecordImportPicker}><Download/>导入棋谱<small>单个 LIB / SGF / JSON</small></button><button onClick={() => createLibraryFolder("records")}><FolderPlus/>新建文件夹<small>整理棋谱分组</small></button><button onClick={newRecord}><FilePlus2/>新建棋谱<small>从空棋盘开始</small></button></div><button className="settings-link image-import-entry" onClick={openImageImportPicker} disabled={imageRecognizing}><span><Download/><b>{imageRecognizing ? "正在识别棋盘…" : "图片识谱"}</b><small>导入棋盘截图，识别黑白棋子并生成可编辑棋谱</small></span><ChevronRight/></button>
          <label className="library-search"><Search size={17}/><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜索棋谱名、棋手或主题"/><button type="button" onClick={() => setLibraryQuery("")} aria-label="清除搜索"><X size={15}/></button></label>
          <div className="folder-library-list">{libraryFolders.recordFolders.map((folder) => {
            const items = filteredLibrary.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder);
            const largeItems = filteredLargeSummaries.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder);
            const expanded = expandedLibraryFolder === folder;
            return <section key={folder}>
              <div className="library-folder-row"><button className="library-folder-head" onClick={() => setExpandedLibraryFolder(expanded ? null : folder)}><FolderOpen size={19}/><span><b>{folder}</b><small>{items.length + largeItems.length} 份棋谱</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "record-folder", name: folder })} aria-label={`重命名文件夹“${folder}”`}><PenLine size={16}/></button></div>
              {expanded && <div className="record-list folder-items">
                {items.map((item) => <article key={item.id} onClick={() => openRecord(item)}><div className="mini-board"><span>●</span><span>○</span><b>{mainLineLength(item)}</b></div><div className="record-info"><h3>{item.metadata.title}</h3><p>{item.metadata.black} vs {item.metadata.white}</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", item.id, event.target.value)}>{libraryFolders.recordFolders.map((name) => <option key={name}>{name}</option>)}</select></div><div className="library-item-actions"><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "record", id: item.id, name: item.metadata.title }); }} aria-label={`重命名棋谱“${item.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteRecord(item); }} aria-label={`删除棋谱“${item.metadata.title}”`}><Trash2 size={17}/></button></div></article>)}
                {largeItems.map((item) => <article key={item.id} onClick={() => { void openLargeRecord(item); }}><div className="mini-board"><span>●</span><span>○</span><b>{item.mainLineLength}</b></div><div className="record-info"><h3>{item.metadata.title}</h3><p>{item.metadata.black} vs {item.metadata.white} · 大型棋谱 · {item.nodeCount.toLocaleString()} 节点</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", item.id, event.target.value)}>{libraryFolders.recordFolders.map((name) => <option key={name}>{name}</option>)}</select></div><div className="library-item-actions"><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "large-record", id: item.id, name: item.metadata.title }); }} aria-label={`重命名棋谱“${item.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteLargeRecord(item); }} aria-label={`删除棋谱“${item.metadata.title}”`}><Trash2 size={17}/></button></div></article>)}
                {!items.length && !largeItems.length && <p className="folder-empty">这个文件夹还是空的</p>}
              </div>}
            </section>;
          })}</div>
        </> : <>
          <div className="library-actions puzzle-actions"><button onClick={openPuzzleImportPicker}><Download/>导入 JSON 题库<small>支持二维题目数组：坐标,颜色编号</small></button><button onClick={() => createLibraryFolder("puzzles")}><FolderPlus/>新建文件夹<small>自由整理题集</small></button></div>
          <div className="folder-library-list">{libraryFolders.puzzleFolders.map((folder) => {
            const collections = puzzleCollections.filter((collection) => (libraryFolders.puzzleAssignments[collection.id] || (collection.id.startsWith("native-") || collection.id === "original-tactics" ? "内置题库" : "我的题库")) === folder);
            const expanded = expandedLibraryFolder === folder;
            return <section key={folder}>
              <div className="library-folder-row"><button className="library-folder-head" onClick={() => setExpandedLibraryFolder(expanded ? null : folder)}><FolderOpen size={19}/><span><b>{folder}</b><small>{collections.length} 个题集</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-folder", name: folder })} aria-label={`重命名文件夹“${folder}”`}><PenLine size={16}/></button></div>
              {expanded && <div className="puzzle-collection-list folder-items">{collections.map((collection) => {
                const collectionIndex = puzzleCollections.indexOf(collection);
                const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length;
                const managing = managedPuzzleCollectionId === collection.id;
                return <article key={collection.id}><div className="puzzle-collection-main"><button onClick={() => guardedOpenPuzzle(collectionIndex, 0)}><span className="puzzle-folder-icon">題</span><div><b>{collection.title}</b><small>{solved} / {collection.puzzles.length} 已完成 · {collection.source}</small></div><ChevronRight size={18}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-collection", id: collection.id, name: collection.title })} aria-label={`重命名题集“${collection.title}”`}><PenLine size={15}/></button></div><div className="puzzle-collection-tools"><select value={folder} onChange={(event) => assignLibraryItem("puzzles", collection.id, event.target.value)} aria-label={`移动题集“${collection.title}”到文件夹`}>{libraryFolders.puzzleFolders.map((name) => <option key={name}>{name}</option>)}</select><button onClick={() => setManagedPuzzleCollectionId(managing ? null : collection.id)} aria-expanded={managing}>{managing ? "收起题目" : `管理 ${collection.puzzles.length} 道题`}</button></div>{managing && <div className="puzzle-manager-list">{collection.puzzles.map((puzzle, puzzleIndexInCollection) => <div key={puzzle.id}><button onClick={() => guardedOpenPuzzle(collectionIndex, puzzleIndexInCollection)}><span>{puzzleIndexInCollection + 1}</span><b>{puzzle.title}</b></button><button onClick={() => beginLibraryRename({ kind: "puzzle", collectionId: collection.id, id: puzzle.id, name: puzzle.title })} aria-label={`重命名题目“${puzzle.title}”`}><PenLine size={14}/></button></div>)}</div>}</article>;
              })}{!collections.length && <p className="folder-empty">这个文件夹还是空的</p>}</div>}
            </section>;
          })}</div>
        </>}
      </div>}

      {tab === "settings" && <div className="settings-page page-padding"><div className="page-title"><div><span>WORKSPACE</span><h1>打谱设置</h1><p>针对手机小屏优化显示与操作</p></div></div><section className="settings-group"><h2>棋盘显示</h2><SettingRow title="显示手数" text="在棋子上显示落子序号" checked={showNumbers} onChange={setShowNumbers}/><SettingRow title="显示坐标" text="棋盘边缘显示 A–O / 1–15" checked={showCoordinates} onChange={setShowCoordinates}/><SettingRow title="禁手辅助" text="提示黑方常见三三、四四与长连" checked={showForbidden} onChange={setShowForbidden}/></section><StorageSettings defaultDirectory={defaultDirectory} directorySupported={supportsDirectoryPicker()} onChoose={() => { void chooseDefaultDirectory(); }} onClear={() => { void clearDefaultDirectory(); }}/><section className="settings-group"><h2>数据与兼容</h2><button className="settings-link" onClick={() => singleFileInput.current?.click()}><span><Download/><b>导入棋谱</b><small>SGF / JSON / LIB / DP / DB，以及 SGF 同族扩展名</small></span><ChevronRight/></button><button className="settings-link" onClick={() => { setExportFormatMenuOpen(false); setSheet("export"); }}><span><Upload/><b>导出棋谱</b><small>识别原始格式直接导出，或转换为完整 SGF / JSON</small></span><ChevronRight/></button><button className="settings-link" onClick={() => setSheet("help")}><span><Info/><b>格式兼容说明</b><small>各格式的可写能力、保真范围与数据库边界</small></span><ChevronRight/></button></section><section className="settings-group"><h2>关于</h2><button className="settings-link" onClick={() => setSheet("about")}><span><Info/><b>关于半步五子棋</b><small>个人项目说明、后续维护与 GitHub 下载</small></span><ChevronRight/></button></section><div className="version-note">半步五子棋 1.1.3 · Web / PWA / Android</div></div>}
    </main>

    <nav className="bottom-nav"><button className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}><Home/><span>{mode === "puzzle" ? "做题" : "打谱"}</span></button><button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>棋谱库</span></button><button className="nav-center" onClick={openImportSheet}><Download/><span>导入</span></button><button className={aiGame ? "active" : ""} onClick={openAiGameSheet}><Bot/><span>AI</span></button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings/><span>设置</span></button></nav>
    {importingFile && <div className="import-progress"><i/><span><b>正在后台解析</b><small>{importingFile} · 大型 LIB 可能需要数分钟，请勿关闭页面</small></span></div>}
    {toast && <div className="toast">{toast}</div>}

    {pendingSwitch && <div className="sheet-backdrop draft-guard-backdrop" onMouseDown={() => setPendingSwitch(null)}><section className="bottom-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="未保存草稿"><div className="sheet-handle"/><div className="sheet-head"><h2>有未保存草稿</h2><button className="icon-button" onClick={() => setPendingSwitch(null)} aria-label="取消"><X size={20}/></button></div><div className="sheet-body"><p className="section-note">继续当前操作前请先处理当前未保存的草稿，否则将丢失。</p><button className="primary-button" onClick={savePendingSwitch}><Save/>保存草稿并切换</button><button className="secondary-button" onClick={discardPendingSwitch}><X/>放弃草稿并切换</button><button className="secondary-button" onClick={() => setPendingSwitch(null)}>取消</button></div></section></div>}

    {sheet && <BottomSheet title={sheetTitle} onClose={() => setSheet(null)}>
      {sheet === "aiGame" && <div className="sheet-body ai-game-setup">
        <section className="ai-setup-hero"><span><Bot size={24}/></span><div><b>新建人机棋局</b><small>完整开局流程、交换选择与禁手裁判均在本机运行</small></div></section>
        <section className="ai-setup-group"><b>对局规则</b><div className="ai-option-grid two"><button className={aiRuleFamily === "renju" ? "selected" : ""} onClick={() => { setAiRuleFamily("renju"); setAiForbiddenEnabled(true); }}><span>连珠规则</span><small>黑方三三、四四、长连禁手</small></button><button className={aiRuleFamily === "standard" ? "selected" : ""} onClick={() => { setAiRuleFamily("standard"); setAiForbiddenEnabled(false); setAiOpeningRule("free"); }}><span>标准五子棋</span><small>双方自由落子，五子连线获胜</small></button></div></section>
        {aiRuleFamily === "renju" && <section className="ai-setup-group"><b>开局规则</b><div className="ai-opening-grid">{([
          ["free", "自由开局", "直接从天元开始正常轮流落子"],
          ["five-two", "五手两打", "黑5提供两个候选，白方选择"],
          ["five-n", "五手多打", "可设置 3–10 个黑5候选"],
          ["taraguchi-10", "塔十", "塔拉山口-10，含交换与十打"],
          ["tarannikov", "塔拉", "中心区域逐步扩大，五次交换"],
        ] as Array<[OpeningRule, string, string]>).map(([rule, title, text]) => <button key={rule} className={aiOpeningRule === rule ? "selected" : ""} onClick={() => setAiOpeningRule(rule)}><span>{title}</span><small>{text}</small></button>)}</div>{aiOpeningRule === "five-n" && <label className="opening-n-control"><span><b>候选数量</b><small>黑方第5手提供 {aiOpeningN} 个不同棋形</small></span><input type="range" min="3" max="10" value={aiOpeningN} onChange={(event) => setAiOpeningN(Number(event.target.value))}/><em>{aiOpeningN}</em></label>}</section>}
        <section className="ai-setup-group"><b>禁手裁判</b><div className="ai-option-grid two"><button className={aiForbiddenEnabled ? "selected" : ""} onClick={() => { setAiForbiddenEnabled(true); setAiRuleFamily("renju"); }}><span>启用禁手</span><small>实时红色 X，并阻止非法落子</small></button><button className={!aiForbiddenEnabled ? "selected" : ""} onClick={() => setAiForbiddenEnabled(false)}><span>关闭禁手</span><small>适合自由规则练习</small></button></div></section>
        <section className="ai-setup-group"><b>初始执子</b><div className="ai-option-grid two player"><button className={aiHumanPlayer === "black" ? "selected" : ""} onClick={() => setAiHumanPlayer("black")}><i className="player-stone black"/><span>执黑 · 开局方</span><small>交换后执子颜色可能改变</small></button><button className={aiHumanPlayer === "white" ? "selected" : ""} onClick={() => setAiHumanPlayer("white")}><i className="player-stone white"/><span>执白 · 应对方</span><small>在规则允许时可选择交换</small></button></div></section>
        <button className="primary-button ai-start-button" onClick={startNewAiGame}><Bot size={18}/>{aiGame ? "按新规则重新开始" : "开始人机对战"}</button><p className="helper">开局候选是临时选择点，只有白方选中的黑5会写入棋谱；交换会同步更新双方执子颜色。</p>
      </div>}
      {sheet === "folder" && <div className="sheet-body form-grid folder-sheet"><label>文件夹名称<input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder={`例如：${folderCreationSection === "records" ? "我的实战棋谱" : "冲四题库"}`} onKeyDown={(event) => { if (event.key === "Enter") confirmCreateLibraryFolder(); }}/></label><p className="helper">新建后可在保存棋谱或题库时选择这个分组。</p><button className="primary-button" onClick={confirmCreateLibraryFolder}><FolderPlus/>创建文件夹</button></div>}
      {sheet === "rename" && renameTarget && <div className="sheet-body form-grid rename-sheet"><div className="rename-summary"><span><PenLine size={18}/></span><div><b>{renameTarget.kind.includes("folder") ? "文件夹" : renameTarget.kind === "puzzle" ? "题目" : renameTarget.kind === "puzzle-collection" ? "题集" : "棋谱"}</b><small>当前名称：{renameTarget.name}</small></div></div><label>新的名称<input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={80} onKeyDown={(event) => { if (event.key === "Enter") void confirmLibraryRename(); }}/></label><p className="helper">只修改显示名称，不会改变棋谱内容、题目进度或所在文件夹。</p><button className="primary-button" onClick={() => { void confirmLibraryRename(); }}><Check/>确认重命名</button></div>}
      {sheet === "marks" && <div className="annotation-options"><p className="section-note"><b>棋盘标注：</b>选择文字或形状与颜色后，点棋盘即可放置；也可以在棋盘交叉点长按，依次切换圆圈、三角、叉号和清除。</p><h3>显示样式</h3><div className="annotation-style-grid">{([['text','文字'],['circle','圆圈'],['triangle','三角'],['cross','叉号']] as const).map(([style, label]) => <button key={style} className={annotationStyle === style ? "selected" : ""} onClick={() => setAnnotationStyle(style)} aria-pressed={annotationStyle === style}><span className={`annotation-preview ${style}`}>{style === "text" ? "A" : style === "circle" ? "○" : style === "triangle" ? "△" : "×"}</span><small>{label}</small></button>)}</div><h3>标注颜色</h3><div className="annotation-color-grid">{[["#1d1c19","墨黑"],["#4f5357","石墨"],["#2872b8","蓝"],["#0f766e","青"],["#365e4b","松绿"],["#6b4f3a","棕"],["#b27b18","金"],["#c46a20","橙"],["#b94b3f","朱红"],["#b04474","莓红"],["#7b4fb3","紫"],["#7d8790","雾灰"]].map(([color, label]) => <button key={color} className={annotationColor === color ? "selected" : ""} style={{ "--annotation-color": color } as React.CSSProperties} onClick={() => setAnnotationColor(color)} aria-label={`${label}色`} aria-pressed={annotationColor === color} title={label}><span className="annotation-color-swatch"><Check size={11}/></span><small>{label}</small></button>)}</div></div>}
      {sheet === "find" && <div className="sheet-body find-sheet"><label className="find-input"><Search size={17}/><input autoFocus value={findQuery} onChange={(event) => setFindQuery(event.target.value)} placeholder="坐标、手数、标注、注释或局面文字"/><button type="button" onClick={() => setFindQuery("")} aria-label="清除查找"><X size={15}/></button></label>{findQuery && <p className="section-note">找到 {findResults.length} 个节点（最多显示 20 个）</p>}{findQuery && !findResults.length && <div className="sheet-empty"><Search/><b>没有找到匹配节点</b><span>可以试试 H8、2、A、圆圈，或注释中的关键词。</span></div>}{findResults.length > 0 && <div className="find-results">{findResults.map((node) => <button key={node.id} onClick={() => { setCurrentId(node.id); setSheet(null); }}><span className={`branch-stone ${node.move?.player || node.passPlayer || "black"}`}>{node.move || node.passPlayer ? depthOf(document, node.id) : node.parentId ? "·" : "起"}</span><div><b>{nodeKindLabel(node)}</b><small>{node.boardText || node.comment || (node.marks?.length ? node.marks.map((mark) => `${coordinateName(mark)}${mark.label ? `：${mark.label}` : ` · ${markKindLabel(mark)}`}`).join("，") : "无局面文字、注释或标注")}</small></div><ChevronRight/></button>)}</div>}<p className="helper">查找会覆盖当前棋谱的主线、所有变化和棋盘标注，点击结果即可跳到对应节点。</p></div>}
      {sheet === "positionSearch" && <div className="sheet-body position-search-sheet"><label className="match-toggle"><span><b>包含旋转与镜像</b><small>不同棋盘朝向也视为同一局面</small></span><input type="checkbox" checked={matchSymmetry} onChange={(event) => setMatchSymmetry(event.target.checked)}/><i/></label><p className="section-note">已扫描 {searchableDocuments.length} 份本地棋谱的主线和全部变化，找到 {visiblePositionMatches.length} 个其他节点{positionMatches.length >= 60 ? "（只显示前 60 个）" : ""}。</p><div className="position-match-list">{visiblePositionMatches.map((match) => <button key={`${match.documentId}-${match.nodeId}`} onClick={() => { const target = searchableDocuments.find((item) => item.id === match.documentId); if (!target) return; openRecord(target, match.nodeId, { onOpened: () => { setSheet(null); setToast(`已跳转到《${match.title}》第 ${match.depth} 手`); } }); }}><span>{match.depth}</span><div><b>{match.title}</b><small>第 {match.depth} 手{match.coordinate ? ` · ${match.coordinate}` : " · 起始局面"}</small></div><ChevronRight size={18}/></button>)}</div>{!visiblePositionMatches.length && <div className="sheet-empty"><Search/><b>棋谱库中没有其他相同局面</b><span>{matchSymmetry ? "已同时比较旋转与镜像方向。" : "可开启旋转与镜像后再试。"}</span></div>}<p className="helper">匹配同时比较黑白棋位置和下一手行棋方；点击结果会直接打开对应棋谱节点。</p></div>}
      {sheet === "think" && <div className="sheet-body think-sheet"><section className="think-hero"><span><Bot size={21}/></span><div><b>思考当前局面</b><small>轮到{nextPlayer === "black" ? "黑" : "白"}方 · 只分析，不会自动改谱</small></div></section>{thinkRunning && <div className="think-running"><i/><div><b>正在寻找下一步</b><span>先检查强制成五、连续冲四，再进行迭代加深搜索…</span></div></div>}{!thinkRunning && thinkResult?.move && <section className="think-result"><div className="think-recommend"><span>荐</span><div><small>AI 推荐落点</small><b>{coordinateName(thinkResult.move)}</b></div><em className={thinkResult.source === "verified-vcf" ? "proof" : "search"}>{thinkResult.source === "verified-vcf" ? "已验证强制胜" : thinkResult.source === "rapfi" ? "Rapfi 推荐" : "搜索候选"}</em></div><div className="think-stats"><span><b>{thinkResult.depth}</b> 层深度</span><span><b>{thinkResult.nodes.toLocaleString()}</b> 节点</span><span><b>{Math.round(thinkResult.elapsedMs)}ms</b> 用时</span></div>{thinkResult.principalVariation?.length ? <div className="think-pv"><small>主变化</small><div>{thinkResult.principalVariation.slice(0, 10).map((move, index) => <span key={`${move.row}-${move.col}-${index}`} className={move.player}>{index + 1}. {coordinateName(move)}</span>)}</div></div> : <p className="helper">这是启发式搜索排序结果，不代表已经证明必胜；如需严格证明，可打开“局面分析”搜索 VCF。</p>}<button className="primary-button" onClick={() => { const move = thinkResult.move; if (!move) return; setSheet(null); play(move); }}><GitBranch size={16}/>用推荐落点创建变化</button></section>}{!thinkRunning && !thinkResult?.move && <div className="sheet-empty"><Bot/><b>暂时没有可用推荐</b><span>请确认棋盘还有空位，然后重新点击“思考”。</span></div>}<button className="secondary-button" disabled={thinkRunning} onClick={startThink}>{thinkRunning ? "思考中…" : "重新思考"}</button><p className="helper">AI 会遵守当前棋谱的规则设置。红色禁手点不会作为黑方推荐；“已验证强制胜”表示冲四证明已覆盖全部合法防守。</p></div>}
      {sheet === "analysis" && <div className="sheet-body analysis-sheet"><section className="vcf-panel"><div className="vcf-heading"><div><span>强制胜证明</span><b>VCF · 连续冲四</b></div><em>最多 5 次进攻</em></div>{!vcfResult && !vcfRunning && <p>穷举进攻方的成五与冲四，并验证防守方所有合法挡点；只有全部防守都失败才报告胜法。</p>}{vcfRunning && <div className="vcf-running"><i/><span>正在搜索合法冲四与全部防点…</span></div>}{vcfResult?.status === "win" && <div className="vcf-result win"><b><Check size={17}/>已找到连续冲四胜法</b><div className="proof-line">{vcfResult.principalVariation.map((move, index) => <span key={`${move.row}-${move.col}-${index}`} className={move.player}>{index + 1}. {coordinateName(move)}</span>)}</div><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small><button onClick={() => { const first = vcfResult.principalVariation[0]; if (first) { setSheet(null); play(first); } }}>从证明首手创建变化</button></div>}{vcfResult?.status === "not-found" && <div className="vcf-result neutral"><b>当前深度未找到 VCF</b><span>这不代表局面无胜，只表示最多 5 次连续冲四内没有证明。</span><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}{vcfResult?.status === "budget" && <div className="vcf-result warning"><b>达到手机计算预算</b><span>搜索已安全中止，没有把未完成结果当作胜法。</span><small>检查 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}<button className="vcf-search-button" disabled={vcfRunning} onClick={() => { void runVcf(); }}><Search size={16}/>{vcfRunning ? "搜索中…" : vcfResult ? "重新搜索 VCF" : "搜索 VCF 胜法"}</button></section><button className="position-search-entry" onClick={() => setSheet("positionSearch")}><span><Search size={18}/></span><div><b>跨谱查找相同局面</b><small>支持旋转、镜像和所有变化节点</small></div><ChevronRight size={18}/></button><p className="section-note">下面是启发式候选排序：综合成五、活四、冲四、活三与防守点，用于研究和标记，不等同于 VCF/VCT 证明。</p><div className="analysis-list">{candidates.map((candidate, index) => <div className="analysis-row" key={`${candidate.position.row}-${candidate.position.col}`}><div className="analysis-rank">{String.fromCharCode(65 + index)}</div><div className="analysis-copy"><b>{coordinateName(candidate.position)} <small>{Math.round(candidate.score)} 分</small></b><span>{candidate.reasons.join(" · ")}</span></div><button className="analysis-mark" onClick={() => markCandidate(index)}>标记</button></div>)}</div>{!candidates.length && <div className="sheet-empty"><Search/><b>当前没有可评估的候选点</b><span>棋盘可能已满，或局面没有明显的局部连接。</span></div>}<div className="analysis-actions"><button className="primary-button" onClick={markTopCandidates}>标记前五候选</button><button className="secondary-button" onClick={() => setSheet("marks")}>打开标注面板</button></div><p className="helper">候选点会保存到当前节点，可导出为 SGF 的 LB 标记。</p></div>}
      {sheet === "comment" && <div className="sheet-body"><textarea autoFocus value={current.comment} placeholder="例如：这里白棋若防在 J9，黑棋可以继续冲四…" onChange={(event) => safeUpdateNode({ comment: event.target.value })}/><p className="helper">注释保存在当前节点，导出 SGF 时会写入 C 属性。</p>{current.renLibAnnotations?.length ? <section className="native-annotation-panel"><h3>原谱内容</h3>{annotationLines(current).map((text, index) => <p key={`${current.id}-native-${index}`}>{text}</p>)}</section> : null}<button className="primary-button" onClick={() => setSheet(null)}><Check/>完成</button></div>}
       {sheet === "branches" && <div className="sheet-body"><p className="section-note">当前分叉点有 {branchTotal.toLocaleString()} 条直接分支。下面的“上一个 / 下一个分支”是在这些分支之间切换，不是书签；书签用于记住常用局面，可单独跳转。</p><section className="branch-bookmarks"><button className="branch-bookmarks-head" onClick={() => setBookmarksExpanded((expanded) => !expanded)}><span><GitBranch size={16}/><b>分支书签</b><small>{activeBookmarks.length ? `${activeBookmarks.length} 个已保存局面` : "记录常用局面"}</small></span><ChevronDown className={bookmarksExpanded ? "expanded" : ""}/></button>{bookmarksExpanded && <div className="branch-bookmarks-body"><button className="save-bookmark-button" onClick={saveBranchBookmark}><GitBranch/>保存当前局面为书签</button>{activeBookmarks.map((bookmark) => <div className="branch-bookmark-row" key={bookmark.id}>{editingBookmarkId === bookmark.id ? <div className="bookmark-edit"><input autoFocus value={editingBookmarkName} onChange={(event) => setEditingBookmarkName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commitRenameBranchBookmark(); if (event.key === "Escape") { setEditingBookmarkId(null); setEditingBookmarkName(""); } }} /><button onClick={commitRenameBranchBookmark} aria-label="确认重命名" title="确认"><Check size={15}/></button><button onClick={() => { setEditingBookmarkId(null); setEditingBookmarkName(""); }} aria-label="取消重命名" title="取消"><X size={15}/></button></div> : <><button className="bookmark-jump" onClick={() => jumpToBranchBookmark(bookmark)}><span>书</span><div><b>{bookmark.name}</b><small>{viewDocument.nodes[bookmark.nodeId] ? nodeKindLabel(viewDocument.nodes[bookmark.nodeId]!) : "节点已删除"}</small></div></button><button onClick={() => beginRenameBranchBookmark(bookmark)} aria-label="重命名" title="重命名"><PenLine size={15}/></button><button onClick={() => deleteBranchBookmark(bookmark.id)} aria-label="删除" title="删除"><Trash2 size={15}/></button></>}</div>)}{!activeBookmarks.length && <p className="helper">保存后会记住这个棋谱中的局面位置，不影响其他棋谱。</p>}</div>}</section>{branchTotal > 1 && <div className="branch-switcher"><button onClick={() => switchBranch(-1)} disabled={branchCurrentIndex <= 0}><ChevronLeft/><span>上一个分支</span></button><span>{branchCurrentIndex >= 0 ? `${branchCurrentIndex + 1} / ${branchTotal}` : "选择分支"}</span><button onClick={() => switchBranch(1)} disabled={branchCurrentIndex < 0 || branchCurrentIndex >= branchTotal - 1}><span>下一个分支</span><ChevronRight/></button></div>}<div ref={branchListRef} className="branch-list branch-list-virtual" onScroll={(event) => setBranchScrollTop(event.currentTarget.scrollTop)}>{branchTotal > 0 && <div style={{ height: branchTotal * BRANCH_ROW_HEIGHT, position: "relative" }}>{branchWindow.ids.map((id, offset) => { const index = branchWindow.start + offset; const node = viewDocument.nodes[id]; if (!node) return null; const preview = variationPreview(viewDocument, id, 3); return <button key={id} className={id === branchChildId ? "current-branch" : ""} style={{ position: "absolute", top: index * BRANCH_ROW_HEIGHT, left: 0, right: 0, height: BRANCH_ROW_HEIGHT }} onClick={() => chooseChild(id, branchView.id)}><span className={`branch-stone ${node.move?.player || node.passPlayer || "black"}`}>{index + 1}</span><div><b>{nodeKindLabel(node)}</b><small>{node.comment || `分支 ${index + 1} · 后续 ${node.children.length} 支`}</small>{preview && <small className="branch-preview">续：{preview}</small>}</div>{id === branchChildId && <em>当前分支</em>}{branchView.preferredChildId === id && id !== branchChildId && <em>主线</em>}<ChevronRight/></button>; })}</div>}{!branchTotal && <div className="sheet-empty"><GitBranch/><b>这里还没有后续分支</b><span>关闭面板，在棋盘空位落子即可创建。</span></div>}</div>{branchPivotId && <button className="branch-create-button" onClick={() => { setCurrentId(branchPivotId); setSheet(null); setToast("已回到上一个分支点，在棋盘空位落子即可创建新分支"); }}><GitBranch/>回到上一个分支点</button>}{current.parentId && <button className="danger-button" onClick={() => { recordDraft({ type: "delete-subtree", parentId: current.parentId || document.rootId, rootId: currentId }); setCurrentId(current.parentId || document.rootId); setSheet(null); setToast("已加入删除草稿，点击保存后生效"); }}><Trash2/>删除当前分支及后续</button>}</div>}
      {sheet === "save" && <div className="sheet-body form-grid save-sheet"><label>保存名称<input autoFocus value={viewDocument.metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })}/></label><div className="save-destination" role="tablist" aria-label="保存类型"><button className={saveDestination === "records" ? "selected" : ""} onClick={() => { setSaveDestination("records"); setSaveFolder(libraryFolders.recordFolders[0] || "未分类"); }} role="tab">棋谱</button><button className={saveDestination === "puzzles" ? "selected" : ""} onClick={() => { setSaveDestination("puzzles"); setSaveFolder(libraryFolders.puzzleFolders[0] || "我的题库"); }} role="tab">题库</button></div><label>保存到分组<select value={saveFolder} onChange={(event) => setSaveFolder(event.target.value)}>{(saveDestination === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders).map((folder) => <option key={folder}>{folder}</option>)}</select></label>{saveDestination === "puzzles" && <p className="helper">将当前局面保存为一道练习题，保留当前棋盘上的全部棋子。</p>}<button className="primary-button" onClick={() => { void confirmSave(); }}><Save/>确认保存</button></div>}
      {sheet === "metadata" && <div className="sheet-body form-grid"><label>棋谱名称<input value={viewDocument.metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })}/></label><div className="two-cols"><label>黑方<input value={viewDocument.metadata.black} onChange={(event) => updateMetadata({ black: event.target.value })}/></label><label>白方<input value={viewDocument.metadata.white} onChange={(event) => updateMetadata({ white: event.target.value })}/></label></div><label>赛事 / 主题<input value={viewDocument.metadata.event} onChange={(event) => updateMetadata({ event: event.target.value })}/></label><div className="two-cols"><label>日期<input type="date" value={viewDocument.metadata.date} onChange={(event) => updateMetadata({ date: event.target.value })}/></label><label>规则<select value={viewDocument.metadata.rule} onChange={(event) => updateMetadata({ rule: event.target.value as GameDocument["metadata"]["rule"] })}><option value="renju">连珠规则</option><option value="standard">标准五子棋</option><option value="freestyle">无禁手</option></select></label></div><button className="primary-button" onClick={() => setSheet(null)}><Save/>保存信息</button></div>}
      {sheet === "import" && <div className="sheet-body import-options"><button className="import-choice" onClick={() => { setSheet(null); if (mode === "puzzle") puzzleFileInput.current?.click(); else singleFileInput.current?.click(); }}><span className="format-icon"><Download/></span><div><b>{mode === "puzzle" ? "导入题库文件" : "导入棋谱文件"}</b><small>{mode === "puzzle" ? "二维 JSON 数组；每题由“坐标,颜色编号”组成" : "SGF、LIB、JSON、POS 等格式"}</small></div><ChevronRight/></button><button className="import-choice" onClick={() => { setSheet(null); imageFileInput.current?.click(); }}><span className="format-icon json"><Download/></span><div><b>图片识谱</b><small>从棋盘截图识别黑白棋子，生成可编辑局面</small></div><ChevronRight/></button>{mode === "puzzle" && <p className="helper">格式示例：每道题是一个数组，棋子写作“J10,1”或“J10,2”；1 表示黑棋，2 表示白棋。空题和没有有效棋子的题目会跳过。</p>}{mode !== "puzzle" && <p className="helper">图片识谱会先询问棋盘路数。清晰截图识别效果最好；带数字的完整顺序目前需要人工确认。</p>}</div>}
      {sheet === "export" && <div className="sheet-body export-hub">
        <div className="export-source-card"><span>当前棋谱</span><b>{sourceFormat ? `识别为 ${sourceFormat.toUpperCase()}` : "没有原始文件格式"}</b><small>{sourceFormat ? directExportAvailable ? `可直接导出为 ${directFormatLabel}` : `${directFormatLabel}，当前只能转换导出` : "直接导出默认使用 SGF；也可以自己选择格式"}</small></div>
        <button className="export-primary-card choose" disabled={directExportAvailable && Boolean(sourceFormat)} onClick={() => setExportFormatMenuOpen((open) => !open)}><span className="format-icon"><Upload/></span><div><b>选择格式导出</b><small>{directExportAvailable && sourceFormat ? "已有可直接导出的原始格式，因此此项停用" : "展开后选择 SGF 或 JSON"}</small></div><ChevronDown className={exportFormatMenuOpen ? "expanded" : ""}/></button>
        {exportFormatMenuOpen && !(directExportAvailable && sourceFormat) && <div className="export-format-list">
          <button onClick={() => exportAsFormat("sgf")}><span className="format-icon">SGF</span><div><b>SGF 标准棋谱</b><small>完整保留变化树、注释、评价和棋盘标注；兼容 FGF / REN / WZQ 等 SGF 同族文件</small></div><Upload/></button>
          <button onClick={() => exportAsFormat("json")}><span className="format-icon json">JSON</span><div><b>JSON（半步完整棋谱）</b><small>完整保留本应用全部可编辑数据，扩展名为 .json</small></div><Upload/></button>
          <button disabled><span className="format-icon muted">LIB</span><div><b>RenLib LIB</b><small>可读取并可原样导出已打开的 LIB；当前不把普通棋谱伪造为 LIB</small></div><Lock/></button>
          <button disabled><span className="format-icon muted">DP</span><div><b>DP / DB 局面数据库</b><small>属于查询数据库而非普通变化树；目前只支持读取和原文件直接导出</small></div><Lock/></button>
        </div>}
        <button className="export-primary-card direct" disabled={!directExportAvailable} onClick={exportDirect}><span className="format-icon direct"><Download/></span><div><b>直接导出</b><small>{sourceFormat ? `已有格式直接导出：${directFormatLabel}` : "当前没有原始格式，将按默认 SGF 导出"}</small></div><Upload/></button>
        <p className="helper">导出位置：{defaultDirectory ? `“${defaultDirectory.name}”文件夹` : supportsDirectoryPicker() ? "浏览器默认下载目录（可在设置中选择文件夹）" : "浏览器默认下载目录"}。LIB、DP、DB 的二进制结构与普通棋谱树不同；本应用只会原样导出已打开的源文件，不生成无法被其他软件读取的假文件。</p>
      </div>}
      {sheet === "help" && <div className="sheet-body help-content"><div className="support-row"><b>棋谱导入</b><span>RenLib 3.x / 旧版无头 LIB（按设备能力分页导入）、SGF / FGF、REN / RENJS / WZQ（SGF 语法）、JSON、POS，以及 DP / DB 局面数据库。SGF 支持设置局面、过手、UTF-16 和同文件多盘棋。</span></div><div className="support-row"><b>导出与保真</b><span>SGF 和 JSON 会重新生成当前完整变化树；SGF 适合与其他五子棋软件交换，JSON 完整保留半步的编辑字段。已打开的 LIB、DP、DB 只支持原文件直接导出，不会伪造二进制数据库。</span></div><div className="support-row"><b>JSON 的三种用途</b><span>棋谱库读取本软件的完整变化树或带明确 moves 字段的落子列表对象；题库页读取二维数组，每道题由“坐标,颜色编号”字符串组成。数字坐标棋谱必须声明 coordinateBase，不猜测任意数组。</span></div><div className="support-row"><b>AI 完全本地</b><span>人机与“思考”使用应用内置 Rapfi WASM 数据，不访问 gomocalc.com，也不会上传当前棋局。</span></div><div className="support-row warning"><b>十五路边界</b><span>当前棋盘、规则与题库固定为十五路；其他 SGF SZ 会明确拒绝，不会缩放后生成错误棋谱。</span></div><div className="support-row warning"><b>TXT 不是统一棋谱标准</b><span>TXT 仅作为纯文本坐标序列兼容入口，例如 H8 I8 H9；带专有结构的文本应使用原软件导出的 SGF。</span></div><div className="support-row warning"><b>LIB 兼容边界</b><span>大型 LIB 在后台线程解析并按页存储。原谱的普通注释、局面文字和 RenLib 标记会分别保留并在节点详情中显示；超出 RenLib 3.4 的扩展仍会提示。实际边界由设备内存和本地存储空间决定。</span></div><h3>手机快捷操作</h3><ul><li>点空交叉点：落子；点已有棋子：不会改变局面</li><li>底部“标注”：放置数字、胜败平衡和自定义文字</li><li>长按交叉点：圆圈 → 三角 → 叉号 → 清除</li><li>左右方向键（外接键盘）：前后导航</li></ul><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></div>}
      {sheet === "about" && <div className="sheet-body about-sheet"><section className="about-hero"><span>半</span><div><b>半步五子棋</b><small>版本 1.1.3 · 个人 Vibecoding 项目</small></div></section><section className="creator-message"><b>个人项目说明</b><p>这是一个由个人通过 Vibecoding 制作的五子棋工具。开发过程中借鉴了一些公开的五子棋代码、文件格式和算法实现，仅用于学习、研究和个人使用。如有任何内容涉及侵权，请通过 GitHub 联系，我会立即删除或调整相关内容。</p></section><section className="about-card"><h3><Layers3 size={17}/>后续维护</h3><p>后续有时间会继续更新功能、改善使用体验并修复发现的 Bug。项目的新版网页、安装包和更新说明会优先发布在 GitHub，可从下面的项目主页查看和下载。</p></section><a className="github-link" href="https://github.com/gugujiao953-ship-it/banbu-gomoku" target="_blank" rel="noreferrer"><Code2 size={20}/><span><b>GitHub 项目主页与下载</b><small>github.com/gugujiao953-ship-it/banbu-gomoku</small></span><ChevronRight size={18}/></a><button className="primary-button" onClick={() => setSheet(null)}>完成</button></div>}
      {sheet === "marks" && <div className="sheet-body mark-sheet"><p className="section-note">文字、形状和颜色都会保存到当前局面，与节点注释相互独立。</p><section><h3>数字标注</h3><div className="mark-preset-grid numbers">{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><section><h3>局面结论</h3><div className="mark-preset-grid words">{["胜", "败", "平", "平衡", "攻", "守", "要", "疑"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><section><h3>字母标注</h3><div className="mark-preset-grid letters">{["A", "B", "C", "D", "E"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><div className="mark-custom-section"><h3>自定义文字</h3><div className="custom-mark-row"><input maxLength={4} value={customMarkLabel} onChange={(event) => setCustomMarkLabel(event.target.value)} placeholder="输入最多 4 个字"/><button disabled={!customMarkLabel.trim()} onClick={() => { setCandidateLabel(Array.from(customMarkLabel.trim()).slice(0, 4).join("")); setSheet(null); }}>使用</button></div><button className="mark-delete-button" disabled={!current.marks.length} onClick={() => { safeClearMarks(); setCandidateLabel(null); setSheet(null); setToast("已清除当前局面的全部标注"); }}><Trash2/>删除现有标注{current.marks.length ? `（${current.marks.length}）` : ""}</button></div></div>}
    </BottomSheet>}
  </div>;
}

function StorageSettings({ defaultDirectory, directorySupported, onChoose, onClear }: { defaultDirectory: DirectoryHandleLike | null; directorySupported: boolean; onChoose: () => void; onClear: () => void }) {
  return <section className="settings-group storage-settings-group"><h2>文件与存储</h2><div className="storage-summary"><span className="storage-icon"><Save size={18}/></span><div><div className="storage-summary-heading"><b>应用内保存</b><em>本机</em></div><p>保存按钮写入本机棋谱库，可在“棋谱库”中继续查看和编辑。</p></div></div><div className="storage-divider"/><div className="storage-destination"><span className={`storage-icon folder ${defaultDirectory ? "ready" : ""}`}><FolderOpen size={18}/></span><div className="storage-destination-copy"><div className="storage-summary-heading"><b>默认导出文件夹</b>{defaultDirectory && <em className="ready">已设置</em>}</div><p>{defaultDirectory ? `导出文件会直接写入“${defaultDirectory.name}”` : directorySupported ? "尚未设置，将使用浏览器默认下载目录" : "当前浏览器不支持选择文件夹，将使用默认下载目录"}</p></div><button className="storage-action" onClick={onChoose}>{defaultDirectory ? "更换" : "选择"}</button></div>{defaultDirectory && <button className="storage-remove" onClick={onClear}><X size={14}/>取消默认位置</button>}<div className="storage-tip"><Info size={14}/><span>{directorySupported ? "网页只会记住文件夹授权和名称，不会读取系统完整路径；可随时更换。" : "可在支持目录权限的浏览器中选择文件夹；当前环境会继续使用默认下载目录。"}</span></div></section>;
}

function SettingRow({ title, text, checked, onChange }: { title: string; text: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="setting-row"><span><b>{title}</b><small>{text}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><i/></label>;
}
