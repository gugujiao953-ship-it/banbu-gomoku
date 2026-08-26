import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, BookOpen, Check, ChevronDown, ChevronFirst, ChevronLast, ChevronLeft,
  ChevronRight, CircleHelp, Code2, Download, FilePlus2, FlipHorizontal, FolderOpen, FolderPlus, GitBranch,
  Home, Info, Layers3, Library, Lock, ListTree, Menu, MessageSquareText, MoreHorizontal, RotateCw, Search, Tag,
  PenLine, Redo2, Save, Settings, Share2, Trash2, Undo2, Upload, X,
} from "lucide-react";
import {
  addMove, addMoveAs, boardAt, coordinateName, createDocument, deleteVariation, depthOf, isSupportedBoardSize,
  forbiddenReason, lastOnPreferredLine, nextPlayerAt, otherPlayer, pathToNode, preferredNext, replaceMove, setLabelMark, toggleMark, updateNode,
} from "./game";
import { analyzeCandidates } from "./analysis";
import { downloadText, exportJson, exportSgf, importRecordFile, mainLineLength } from "./formats";
import { recognizeBoardImage } from "./image-recognition";
import { findPositionMatches, positionKey } from "./position-search";
import { loadActive, loadDraftFromLocal, loadLibrary, removeDraftFromLocal, removeFromLibrary, saveDraftToLocal, saveManyToLibrary, saveToLibrary } from "./storage";
import { commitDraftAsDerivedVersion, documentFingerprint, loadDraftForDocument, loadLargeDocument, loadLargeSummaries, removeDraftForDocument, removeLargeDocument, saveCompactIndex, saveDraftForDocument, saveLargeDocument } from "./large-storage";
import { compactBranchCount, compactChildCount, compactChildWindow, compactDiagnostics, compactFirstBranchNodeId, compactIndexOf, compactNodeCount, compactNodeIndex, compactSearch, createLazyDocument } from "./compact-index";
import { renLibDisplayMark } from "./renlib-display";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, hasDraft, overlayChildren, overlayNode, overlayPreferredChild, projectedDocument, pushDraft, redoDraft, undoDraft, type DraftState, type DraftOperation as DraftOp } from "./draft-operations";
import type { CompactRenLibIndex } from "./types";
import type { LargeDocumentSummary } from "./large-storage";
import VcfWorker from "./vcf.worker?worker";
import RecordImportWorker from "./record-import.worker?worker";
import { verifyVcfProof } from "./vcf";
import type { BoardMarkStyle, GameDocument, ImportResult, NodeEvaluation, Position, RecordNode } from "./types";
import type { VcfResult } from "./vcf";
import PuzzleAiWorker from "./puzzle-ai.worker?worker";
import { winnerAt } from "./puzzle-ai";
import { createPuzzleDocument, importKaibaoPuzzleJson, loadNativeKaibaoCollections, loadPuzzleCollections, loadPuzzleProgress, puzzleProgressKey, savePuzzleCollections, savePuzzleProgress } from "./puzzles";
import type { Puzzle, PuzzleCollection } from "./puzzles";

type Tab = "record" | "library" | "settings";
type AppMode = "record" | "puzzle";
type Sheet = "comment" | "boardText" | "branches" | "metadata" | "save" | "folder" | "export" | "help" | "about" | "find" | "analysis" | "positionSearch" | "marks" | "import" | null;
type DockPanel = "moves" | "notes" | "view" | "play" | "puzzles" | null;
type LibrarySection = "puzzles" | "records";
interface ParsedImport { result: ImportResult; summary?: LargeDocumentSummary; compactIndex?: CompactRenLibIndex }

interface LibraryFolders {
  recordFolders: string[];
  puzzleFolders: string[];
  recordAssignments: Record<string, string>;
  puzzleAssignments: Record<string, string>;
}

const LIBRARY_FOLDERS_KEY = "renju-note-library-folders-v1";
const DEFAULT_DOCUMENT_KEY = "renju-note-default-v1";
const ACTIVE_LARGE_RECORD_KEY = "banbu-active-large-record-v1";
const MAX_LIB_FILE_BYTES = 200 * 1024 * 1024;
const MAX_OTHER_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_BYTES = 320 * 1024 * 1024;
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

const evaluationOptions: { value: NodeEvaluation; label: string; hint: string }[] = [
  { value: "good", label: "好手", hint: "值得推荐" },
  { value: "bad", label: "坏手", hint: "明显失误" },
  { value: "doubtful", label: "疑问手", hint: "需要复盘" },
  { value: "interesting", label: "趣着", hint: "有研究价值" },
  { value: "forced", label: "胜着", hint: "形成强制胜势" },
  { value: "only", label: "唯一手", hint: "只有此手成立" },
  { value: "study", label: "研究点", hint: "待继续拆解" },
];
const evaluationLabel = (value?: NodeEvaluation) => evaluationOptions.find((option) => option.value === value)?.label || "未评价";
const nodeKindLabel = (node: RecordNode) => node.move
  ? coordinateName(node.move)
  : node.passPlayer ? `${node.passPlayer === "black" ? "黑" : "白"}方过手`
  : node.setup ? "设置局面"
  : node.parentId ? "注释节点" : "起始局面";

const branchCount = (document: GameDocument) => compactBranchCount(document) ?? Object.values(document.nodes).filter((node) => node.children.length > 1).length;
const safeName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名棋谱";
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

const Board = memo(function Board({ document, currentId, showNumbers, showCoordinates, largeBoard, rotation, mirrored, initialDepth = 0, disabled = false, onPlay, onMark }: {
  document: GameDocument; currentId: string; showNumbers: boolean; showCoordinates: boolean; largeBoard: boolean;
  rotation: 0 | 90 | 180 | 270; mirrored: boolean;
  initialDepth?: number; disabled?: boolean;
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
  // RenLib/爱五子棋 shows the children of the current position directly on
  // the board as small variation points. Keep this separate from user marks:
  // a branch point is a stored move, while a mark is an annotation.
  const variationNodes = useMemo(() => {
    const pivot = current.children.length ? current : current.parentId ? document.nodes[current.parentId] : current;
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
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const boardSize = document.metadata.boardSize || 15;
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
        {Array.from({ length: boardSize }, (_, index) => <g key={index} className="grid-lines"><line x1={margin} y1={margin + index * gap} x2={end} y2={margin + index * gap}/><line x1={margin + index * gap} y1={margin} x2={margin + index * gap} y2={end}/></g>)}
        {starPoints.map(([row, col]) => <circle key={`${row}-${col}`} cx={margin + col * gap} cy={margin + row * gap} r="4.2" className="star"/>)}
        {showCoordinates && Array.from({ length: boardSize }, (_, index) => <g key={`coord-${index}`} className="coordinates"><text x={margin + index * gap} y="20">{String.fromCharCode(65 + index)}</text><text x={margin + index * gap} y="560">{String.fromCharCode(65 + index)}</text><text x="18" y={margin + index * gap + 3}>{boardSize - index}</text><text x="554" y={margin + index * gap + 3}>{boardSize - index}</text></g>)}
        {board.flatMap((row, rowIndex) => row.map((player, colIndex) => {
          if (!player) return null;
          const x = margin + colIndex * gap, y = margin + rowIndex * gap;
          const number = numbers.get(`${rowIndex},${colIndex}`), isLast = current.move?.row === rowIndex && current.move?.col === colIndex;
          return <g key={`stone-${rowIndex}-${colIndex}`} filter="url(#stoneShadow)"><circle cx={x} cy={y} r="15.6" fill={`url(#${player === "black" ? "blackStone" : "whiteStone"})`} className="stone"/>{showNumbers && <text x={x} y={y + 4.2} className={`move-number ${player}`}>{number}</text>}{isLast && !showNumbers && <circle cx={x} cy={y} r="4" className="last-dot"/>}{isLast && current.comment && <g className="comment-indicator" aria-label="此步有注释"><circle cx={x + 11} cy={y + 11} r="6"/><circle cx={x + 8.5} cy={y + 11} r=".85"/><circle cx={x + 11} cy={y + 11} r=".85"/><circle cx={x + 13.5} cy={y + 11} r=".85"/></g>}</g>;
        }))}
        {variationNodes.map((node, index) => {
          const point = node.move || node.anchor;
          if (!point) return null;
          const x = margin + point.col * gap, y = margin + point.row * gap;
          const player = node.move?.player || "black";
          const display = renLibDisplayMark(node.boardText);
          const hasText = Boolean(display.displayText);
          const hasUserMark = current.marks.some((mark) => mark.row === point.row && mark.col === point.col);
          return <g key={`variation-${node.id}`} className={`renlib-variation ${player} ${display.displayKind}`} aria-label={`变化点 ${coordinateName(point, boardSize)}`}>
            {!hasText && !hasUserMark && <circle cx={x} cy={y} r="7" className="renlib-variation-dot"/>}
            {node.renLibMark && !hasText && !hasUserMark && <circle cx={x} cy={y} r="11" className="renlib-explicit-mark"/>}
            {hasText && (() => { const text = display.displayText || ""; return <text x={x} y={y} className={`renlib-variation-label ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`}>{text}</text>; })()}
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
        {current.marks.map((mark, index) => {
          const x = margin + mark.col * gap, y = margin + mark.row * gap;
          const style = mark.style || (mark.kind === "label" ? "text" : mark.kind);
          const color = mark.color || "#2872b8";
          const label = mark.label || "";
          const labelClass = `board-label-text ${Array.from(label).length > 2 ? "compact" : ""}`;
          if (style === "text") return <text key={index} x={x} y={y + 4} className={labelClass} fill={color}>{label || "?"}</text>;
          if (style === "circle") return <g key={index}><circle cx={x} cy={y} r="19" className="board-mark" stroke={color}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color}>{label}</text>}</g>;
          if (style === "triangle") return <g key={index}><path d={`M ${x} ${y - 20} L ${x - 18} ${y + 14} L ${x + 18} ${y + 14} Z`} className="board-mark" stroke={color}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color}>{label}</text>}</g>;
          return <g key={index} className="board-mark" stroke={color}><line x1={x - 14} y1={y - 14} x2={x + 14} y2={y + 14}/><line x1={x + 14} y1={y - 14} x2={x - 14} y2={y + 14}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color} stroke="none">{label}</text>}</g>;
        })}
        {Array.from({ length: boardSize }, (_, row) => Array.from({ length: boardSize }, (_, col) => <circle key={`hit-${row}-${col}`} cx={margin + col * gap} cy={margin + row * gap} r="17" className="board-hit" role="gridcell" aria-disabled={disabled} aria-label={`${coordinateName({ row, col }, boardSize)}${board[row][col] ? "已有棋子" : "空位"}`} onPointerDown={() => { if (disabled) return; longPressTimer.current = window.setTimeout(() => { suppressClick.current = true; onMark({ row, col }); }, 520); }} onPointerUp={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerCancel={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onClick={() => { if (disabled) return; if (suppressClick.current) { suppressClick.current = false; return; } onPlay({ row, col }); }} onContextMenu={(event) => { event.preventDefault(); if (!disabled) onMark({ row, col }); }}/>))}
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
  const [dockPanel, setDockPanel] = useState<DockPanel>("moves");
  const [puzzleQuery, setPuzzleQuery] = useState("");
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);
  const [workspaceListExpanded, setWorkspaceListExpanded] = useState(false);
  const [expandedCollectionId, setExpandedCollectionId] = useState<string | null>(null);
  const [library, setLibrary] = useState(loadLibrary);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySection, setLibrarySection] = useState<LibrarySection>("records");
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolders>(loadLibraryFolders);
  const [expandedLibraryFolder, setExpandedLibraryFolder] = useState<string | null>("未分类");
  const [tab, setTab] = useState<Tab>("record");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [branchPage, setBranchPage] = useState(1);
  const [branchScrollTop, setBranchScrollTop] = useState(0);
  const branchListRef = useRef<HTMLDivElement>(null);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showForbidden, setShowForbidden] = useState(true);
  const [largeBoard, setLargeBoard] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [mirrored, setMirrored] = useState(false);
  const [candidateLabel, setCandidateLabel] = useState<string | null>(null);
  const [annotationStyle, setAnnotationStyle] = useState<BoardMarkStyle>("text");
  const [annotationColor, setAnnotationColor] = useState("#2872b8");
  const [draft, setDraft] = useState<DraftState>(() => loadDraftFromLocal(document.id));
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const [customMarkLabel, setCustomMarkLabel] = useState("");
  const [largeSummaries, setLargeSummaries] = useState<LargeDocumentSummary[]>([]);
  const [importingFile, setImportingFile] = useState("");
  const [imageRecognizing, setImageRecognizing] = useState(false);
  const [editMoveMode, setEditMoveMode] = useState(false);
  const [placementPlayer, setPlacementPlayer] = useState<"black" | "white">("black");
  const [placementLocked, setPlacementLocked] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [saveDestination, setSaveDestination] = useState<"records" | "puzzles">("records");
  const [saveFolder, setSaveFolder] = useState("未分类");
  const [folderCreationSection, setFolderCreationSection] = useState<LibrarySection>("records");
  const [newFolderName, setNewFolderName] = useState("");
  const [commentExpanded, setCommentExpanded] = useState(false);
  const [toast, setToast] = useState("");
  const [saved, setSaved] = useState(true);
  const [vcfRunning, setVcfRunning] = useState(false);
  const [vcfResult, setVcfResult] = useState<VcfResult | null>(null);
  const [matchSymmetry, setMatchSymmetry] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const singleFileInput = useRef<HTMLInputElement>(null);
  const puzzleFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const vcfWorker = useRef<Worker | null>(null);
  const puzzleAiWorker = useRef<Worker | null>(null);
  const largeSaveVersions = useRef(new Map<string, number>());
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
  const path = useMemo(() => pathToNode(viewDocument, currentId), [viewDocument, currentId]);
  const board = useMemo(() => boardAt(viewDocument, currentId), [viewDocument, currentId]);
  // Keep navigation-derived values primitive/stable. A cursor move changes currentId and
  // board, but must not make unrelated searches re-run just because document is also in scope.
  const nextPlayer = nextPlayerAt(viewDocument, currentId);
  const activePlacementPlayer = placementLocked ? placementPlayer : nextPlayer;
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
        || evaluationLabel(node.evaluation).includes(query)
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
  useEffect(() => () => { vcfWorker.current?.terminate(); puzzleAiWorker.current?.terminate(); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && current.parentId) setCurrentId(current.parentId);
      if (event.key === "ArrowRight") { const next = preferredNext(viewDocument, currentId); if (next) setCurrentId(next); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [document, currentId, current.parentId, viewDocument]);

  const startAiReply = (afterDocument: GameDocument, afterId: string, puzzle: Puzzle) => {
    puzzleAiWorker.current?.terminate();
    const worker = new PuzzleAiWorker();
    puzzleAiWorker.current = worker;
    setAiThinking(true);
    worker.onmessage = (event: MessageEvent<{ move: Position | null }>) => {
      if (puzzleAiWorker.current !== worker) return;
      puzzleAiWorker.current = null; worker.terminate(); setAiThinking(false);
      if (!event.data.move) { setToast("陪练没有找到可落子点"); return; }
      const reply = addMoveAs(afterDocument, afterId, event.data.move, otherPlayer(puzzle.player));
      setDocument(reply.document); setCurrentId(reply.nodeId);
      const replyBoard = boardAt(reply.document, reply.nodeId);
      if (winnerAt(replyBoard, event.data.move)) { setPuzzleOutcome("lost"); recordPuzzleAttempt(false); }
    };
    worker.onerror = () => { if (puzzleAiWorker.current === worker) puzzleAiWorker.current = null; worker.terminate(); setAiThinking(false); setToast("陪练线程异常，已安全停止"); };
    worker.postMessage({ board: boardAt(afterDocument, afterId), player: otherPlayer(puzzle.player) });
  };

  const openPuzzle = (collectionIndex: number, nextPuzzleIndex: number, collections = puzzleCollections) => {
    const collection = collections[collectionIndex];
    const puzzle = collection?.puzzles[nextPuzzleIndex];
    if (!puzzle) return;
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    const session = createPuzzleDocument(puzzle);
    setDraft(emptyDraft());
    setPuzzleCollectionIndex(collectionIndex); setPuzzleIndex(nextPuzzleIndex);
    setDocument(session.document); setCurrentId(session.initialNodeId);
    setPuzzleInitialId(session.initialNodeId); setPuzzleInitialDepth(session.initialDepth);
    setAiThinking(false); setPuzzleOutcome(null); setMode("puzzle"); setDockPanel("play"); setTab("record");
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
      puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null; setAiThinking(false);
      setDocument(recordSession.current.document); setCurrentId(recordSession.current.currentId); setMode("record"); setDockPanel("moves"); setPuzzleOutcome(null);
    }
  };
  const stopPuzzleAi = () => {
    if (!puzzleAiWorker.current) return;
    puzzleAiWorker.current.terminate(); puzzleAiWorker.current = null; setAiThinking(false); setPuzzleOutcome("stopped"); setToast("已强制停止陪练，可悔棋或重启本题");
  };
  const restartPuzzle = () => {
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null; setAiThinking(false); setPuzzleOutcome(null);
    setCurrentId(puzzleInitialId); setToast("已恢复到本题初始局面");
  };
  const undoPuzzleTurn = () => {
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null; setAiThinking(false); setPuzzleOutcome(null);
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

  const recordDraft = (operation: Parameters<typeof pushDraft>[1]) => setDraft((state) => pushDraft(state, operation));
  const undoDraftChange = () => setDraft((state) => undoDraft(state));
  const redoDraftChange = () => setDraft((state) => redoDraft(state));
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
    if (!hasDraft(draft)) { setToast("当前棋谱已经保存，没有新的修改"); return; }
    if (compactIndexOf(document)) { void commitCompactDraft(); return; }
    commitRegularDraft();
  };
  const openSaveDialog = () => {
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
    // An occupied point is navigation, never a new label target. Labels on
    // stones are created through the mark/comment tools, not by placing a
    // candidate on top of a move.
    if (board[position.row][position.col]) {
      const node = [...path].reverse().find((item) => item.move?.row === position.row && item.move.col === position.col);
      if (node) setCurrentId(node.id);
      setCandidateLabel(null);
      return;
    }
    if (mode === "record" && isCompact()) {
      // Navigate within compact baseline + overlay: use viewDocument / overlay
      const currentNode = viewDocument.nodes[currentId];
      const pivot = currentNode?.children.length ? currentNode : currentNode?.parentId ? viewDocument.nodes[currentNode.parentId] : currentNode;
      if (pivot) {
        const target = pivot.children.map((id) => viewDocument.nodes[id]).find((node) => {
          const point = node?.move || node?.anchor;
          return point?.row === position.row && point.col === position.col && (!node?.move || node.move.player === activePlacementPlayer);
        });
        if (target) { setCurrentId(target.id); setCandidateLabel(null); setSheet(null); return; }
      }
      if (candidateLabel || editMoveMode) { setToast("大型棋谱编辑已进入草稿功能，点击保存后提交"); setCandidateLabel(null); setEditMoveMode(false); return; }
      const draftId = `draft-${Date.now().toString(36)}`;
      recordDraft({ type: "add-move", parentId: currentId, node: { id: draftId, parentId: currentId, children: [], move: { ...position, player: activePlacementPlayer }, comment: "", marks: [] } });
      setCurrentId(draftId);
      setToast("已加入未保存草稿，点击保存后提交");
      return;
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
      applyCompactUpdate({ marks: setLabelMark(current.marks, position, candidateLabel, annotationStyle, annotationColor) });
      if (!isCompact()) setToast(`已放置标注 ${candidateLabel} · ${coordinateName(position)}`);
      else setToast(`标注 ${candidateLabel} 已加入草稿`);
      setCandidateLabel(null);
      return;
    }
    if (editMoveMode) {
      const result = replaceMove(viewDocument, currentId, position);
      if (result.changed) {
        const nextMove = result.document.nodes[currentId]?.move;
        if (nextMove) recordDraft({ type: "update-node", nodeId: currentId, patch: { move: nextMove } });
        setEditMoveMode(false); setToast(`已将第 ${depthOf(viewDocument, currentId)} 手改为 ${coordinateName(position)}，待保存生效`);
      } else setToast(result.reason || "当前着法无法修改");
      return;
    }
    if (showForbidden && viewDocument.metadata.rule === "renju" && (depthOf(viewDocument, currentId) % 2 === 0)) { const reason = forbiddenReason(board, position); if (reason) setToast(`禁手辅助：${coordinateName(position)} 可能是${reason}（仍允许研究落子）`); }
    const result = placementLocked
      ? addMoveAs(viewDocument, currentId, position, activePlacementPlayer)
      : addMove(viewDocument, currentId, position);
    setCurrentId(result.nodeId);
    if (!result.created) { setToast("该变化已经存在，已跳转到对应节点"); return; }
    const node = result.document.nodes[result.nodeId];
    if (node) recordDraft({ type: "add-move", parentId: currentId, node: { ...node, children: [...node.children], marks: [...node.marks] } });
  };
  const mark = (position: Position) => { if (mode !== "record") return; recordDraft({ type: "update-node", nodeId: currentId, patch: { marks: toggleMark(current.marks, position) } }); setToast("标注已加入草稿"); };
  const updateMetadata = (patch: Partial<GameDocument["metadata"]>) => {
    setDraft((state) => ({ ...state, metadata: { ...state.metadata, ...patch }, redo: [] }));
  };
  const markCandidate = (index: number) => {
    const candidate = candidates[index];
    if (!candidate) return;
    const label = String.fromCharCode(65 + index);
    applyCompactUpdate({ marks: setLabelMark(current.marks, candidate.position, label, annotationStyle, annotationColor) });
    if (!isCompact()) setToast(`已标记候选 ${label} · ${coordinateName(candidate.position)}`);
  };
  const markTopCandidates = () => {
    const marks = candidates.slice(0, 5).reduce((result, candidate, index) => setLabelMark(result, candidate.position, String.fromCharCode(65 + index), annotationStyle, annotationColor), current.marks);
    applyCompactUpdate({ marks });
    if (!isCompact()) setToast(`已标记前 ${Math.min(5, candidates.length)} 个候选点`);
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
  const goPrev = () => { if (current.parentId) setCurrentId(current.parentId); };
  const goNext = () => {
    if (isCompact()) {
      const next = overlayPreferredChild(document, draftOverlay, currentId);
      if (next) setCurrentId(next);
    } else {
      const next = preferredNext(viewDocument, currentId);
      if (next) setCurrentId(next);
    }
  };
  const chooseChild = (id: string, pivotId = currentId) => {
    recordDraft({ type: "set-mainline", parentId: pivotId, childId: id });
    setCurrentId(id); setSheet(null);
  };
  const deleteCurrentVariation = () => {
    if (!current.parentId) { setToast("起始局面不能删除"); return; }
    const parentId = current.parentId;
    recordDraft({ type: "delete-subtree", parentId, rootId: currentId });
    setCurrentId(parentId); setSheet(null);
    setToast("已删除当前这一步及全部后续变化，保存后生效");
  };
  const closeWorkspaceSelector = () => { setWorkspaceSelectorOpen(false); setWorkspaceListExpanded(false); setExpandedCollectionId(null); setPuzzleQuery(""); };
  /** Perform a record switch without checking the draft. This is only called
   * after the single outer draft guard has completed. */
  const performOpenRecord = (next: GameDocument, nodeId = next.rootId, largeId?: string) => {
    persistedDocuments.current.add(next);
    puzzleAiWorker.current?.terminate();
    recordSession.current = { document: next, currentId: nodeId };
    setDocument(next); setCurrentId(nodeId); setDraft(compactIndexOf(next) ? emptyDraft() : loadDraftFromLocal(next.id));
    setMode("record"); setDockPanel("moves"); setTab("record"); closeWorkspaceSelector();
    if (largeId) localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, largeId);
    else localStorage.removeItem(ACTIVE_LARGE_RECORD_KEY);
    setToast("棋谱已打开");
  };
  /** If a draft is present, defer the switch to a 保存/放弃/取消 prompt. */
  const withDraftGuard = (action: () => void) => {
    if (hasDraft(draft)) { setPendingSwitch(() => action); return; }
    action();
  };
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
  const newRecord = () => withDraftGuard(() => { const next = createDocument(); performOpenRecord(next); setToast("已新建空白棋谱"); });
  const openRecord = (
    next: GameDocument,
    nodeId = next.rootId,
    options?: { largeId?: string; onOpened?: () => void },
  ) => withDraftGuard(() => {
    performOpenRecord(next, nodeId, options?.largeId);
    options?.onOpened?.();
  });
  const openLargeRecord = async (summary: LargeDocumentSummary) => {
    setImportingFile(`正在读取 ${summary.metadata.title}`);
    try {
      const next = await loadLargeDocument(summary.id);
      if (!next) { setToast("大型棋谱文件不存在，索引已清理"); await removeLargeDocument(summary.id); setLargeSummaries((items) => items.filter((item) => item.id !== summary.id)); return; }
      withDraftGuard(() => {
        performOpenRecord(next, next.rootId, summary.id);
        void loadDraftForDocument(summary.id).then((stored) => {
          if (stored && compactIndexOf(next)) {
            const currentFingerprint = documentFingerprint(next);
            if (stored.baseFingerprint === currentFingerprint) setDraft({ operations: stored.operations, redo: stored.redo });
          }
        });
      });
    } catch { setToast("大型棋谱读取失败，请检查本机存储"); }
    finally { setImportingFile(""); }
  };
  const performDeleteRecord = (item: GameDocument) => {
    if (mode === "record" && document.id === item.id) {
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
  const setImportState = (state: string, detail?: unknown) => {
    (window as Window & { __banbuImportState?: { state: string; detail?: unknown; at: number } }).__banbuImportState = { state, detail, at: Date.now() };
  };
  const parseRecordFile = (file: File): Promise<ParsedImport> => {
    // LIB size alone is not enough to decide whether the decoded tree is
    // large. Keep every LIB in the worker so a compact index is also created
    // for a highly branching file whose bytes happen to compress well.
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (extension !== "lib" && file.size < 4 * 1024 * 1024) return importRecordFile(file).then((result) => ({ result }));
    setImportState("worker-started", { name: file.name, size: file.size, extension });
    return new Promise((resolve, reject) => {
      const worker = new RecordImportWorker();
      worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: ImportResult; summary?: LargeDocumentSummary; compactIndex?: CompactRenLibIndex; compactDiagnostic?: unknown; error?: string; stack?: string }>) => {
        worker.terminate();
        (window as Window & { __banbuWorkerMessage?: unknown }).__banbuWorkerMessage = { ok: event.data.ok, hasResult: Boolean(event.data.result), hasCompact: Boolean(event.data.compactIndex), diagnostic: event.data.compactDiagnostic || null, at: Date.now() };
        setImportState(event.data.ok ? "worker-message-received" : "parse-failed", event.data.ok ? event.data.compactDiagnostic || null : { error: event.data.error || "unknown", stack: event.data.stack || null });
        if (event.data.ok && event.data.result) {
          const compactIndex = event.data.compactIndex;
          const result = compactIndex
            ? { ...event.data.result, document: createLazyDocument(event.data.result.document as Omit<GameDocument, "nodes">, compactIndex) }
            : event.data.result;
          (window as Window & { __banbuImportDiagnostic?: unknown }).__banbuImportDiagnostic = event.data.compactDiagnostic || (compactIndex ? { hasCompact: true, nodeCount: compactIndex.nodeCount, rootId: compactIndex.rootId, rootFirstChild: compactIndex.firstChild[compactIndex.ids.indexOf(compactIndex.rootId)] ?? null } : { hasCompact: false });
          setImportState(compactIndex ? "compact-created" : "parse-success", event.data.compactDiagnostic || null);
          resolve({ result, summary: event.data.summary, compactIndex });
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
    const supported = new Set(["sgf", "fgf", "pos", "txt", "ren", "renjs", "wzq", "lib", "renju", "json"]);
    const failures: { file: string; reason: unknown }[] = requested.slice(50).map((file) => ({ file: file.name, reason: new Error("单次最多导入 50 份棋谱") }));
    let totalBytes = 0;
    const selected = requested.slice(0, 50).filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const maximum = extension === "lib" ? MAX_LIB_FILE_BYTES : MAX_OTHER_RECORD_BYTES;
      const maximumLabel = extension === "lib" ? "200MB" : "64MB";
      const reason = extension === "zip"
        ? "ZIP 只是压缩包，不是棋谱格式；请先解压后选择其中的 LIB 文件"
        : !supported.has(extension)
        ? `不支持 .${extension || "未知"} 文件`
        : file.size > maximum ? `${extension.toUpperCase()} 单个文件不能超过 ${maximumLabel}（按解压后的实际文件大小计算）`
        : totalBytes + file.size > MAX_BATCH_BYTES ? "本批文件总计不能超过 320MB" : "";
      if (reason) failures.push({ file: file.name, reason: new Error(reason) });
      else totalBytes += file.size;
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
    const largeImports = imported.filter(({ result, sourceBytes, summary, compactIndex }) => sourceBytes >= 4 * 1024 * 1024 || (summary?.nodeCount || compactIndex?.nodeCount || Object.keys(result.document.nodes).length) >= 40000);
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
        openRecord(active, active.rootId, { largeId, onOpened: () => setImportState("document-opened", { id: active.id, title: active.metadata.title }) });
      }
      setImportState("import-success", { id: active.id, title: active.metadata.title });
      setToast(`${saved.duplicates + largeDuplicates ? "该棋谱已存在" : `已导入 ${imported[0].result.format}`}${largeInserted ? "，已存入大型棋谱库" : ""}${warningCount ? `，${warningCount} 条提示` : ""}`);
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
      setToast(`${result.boardSize}路图片识谱完成：识别 ${result.board.flat().filter(Boolean).length} 子，置信度 ${Math.round(result.confidence * 100)}%${result.numberedMoves.length ? "，已恢复顺序" : "；未检测到可靠数字，请人工确认"}`);
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

  const sheetTitle = sheet === "comment" ? "节点注释" : sheet === "boardText" ? "局面文字与评价" : sheet === "branches" ? "变化分支" : sheet === "metadata" ? "棋谱信息" : sheet === "save" ? "保存棋谱" : sheet === "folder" ? `新建${folderCreationSection === "records" ? "棋谱" : "题库"}文件夹` : sheet === "export" ? "导出与分享" : sheet === "about" ? "关于半步五子棋" : sheet === "find" ? "查找本谱" : sheet === "analysis" ? "局面分析" : sheet === "positionSearch" ? "跨谱局面检索" : sheet === "marks" ? "棋盘标注" : sheet === "import" ? "选择导入方式" : "使用提示";
  // When sitting on a leaf, show its parent's siblings so the user can switch
  // variations without first navigating back to the split point.
  const branchView = current.children.length || !current.parentId ? current : (viewDocument.nodes[current.parentId] || current);
  const branchPivotId = current.children.length ? current.id : current.parentId;
  const branchIndex = compactIndexOf(document);
  const branchViewIndex = branchIndex ? compactNodeIndex(document, branchView.id) : undefined;
  // When a draft exists, overlayChildren may add/remove nodes; branchTotal must
  // match the same effective children list used by the virtual window.
  const branchOverlayChildren = hasDraft(draft) && branchIndex ? overlayChildren(document, draftOverlay, branchView.id) : null;
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
  return <div className="app-shell">
    <input ref={fileInput} type="file" hidden multiple accept="*/*" onChange={(event) => { void handleFiles(event.target.files || undefined); event.target.value = ""; }}/>
    <input ref={singleFileInput} type="file" hidden accept="*/*" onChange={(event) => { void handleFiles(event.target.files || undefined); event.target.value = ""; }}/>
    <input ref={puzzleFileInput} type="file" hidden accept=".json,application/json" onChange={(event) => { void handlePuzzleFile(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={imageFileInput} type="file" hidden accept="image/*" onChange={(event) => { void handleBoardImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <header className="topbar"><div className="brand"><span className="brand-mark">半</span><div><b>半步五子棋</b><small>{mode === "puzzle" ? `${puzzleCollections.reduce((sum, item) => sum + item.puzzles.length, 0)} 道题已就绪` : hasDraft(draft) ? "有未保存草稿" : saved ? <><Check size={12}/> 已保存</> : "保存中…"}</small></div></div><div className="top-actions"><button className="icon-button" onClick={() => setSheet("import")} aria-label="打开导入方式"><Upload size={20}/></button>{mode === "record" && <button className="icon-button save-action" onClick={openSaveDialog} aria-label="保存棋谱"><Save size={20}/></button>}</div></header>

    <main className="app-main">
      {tab === "record" && <div className="record-page">
        <section className="workspace-bar"><button className={`workspace-current ${workspaceSelectorOpen ? "open" : ""}`} onClick={() => { setWorkspaceSelectorOpen((open) => !open); if (workspaceSelectorOpen) { setWorkspaceListExpanded(false); setExpandedCollectionId(null); } }}><span>{mode === "record" ? "谱" : "题"}</span><div><b>{mode === "record" ? viewDocument.metadata.title : currentPuzzle?.title || "选择题目"}</b><small>{mode === "record" ? `${viewDocument.metadata.black} vs ${viewDocument.metadata.white} · 第 ${depthOf(viewDocument, currentId)} 手` : `${puzzleCollections[puzzleCollectionIndex]?.title || "题库"} · ${puzzleIndex + 1}/${puzzleCollections[puzzleCollectionIndex]?.puzzles.length || 0}`}</small></div><ChevronDown size={18}/></button><button className={`workspace-mode-toggle ${mode}`} onClick={() => switchMode(mode === "record" ? "puzzle" : "record")} role="switch" aria-checked={mode === "puzzle"} aria-label={`当前${mode === "record" ? "打谱" : "做题"}模式，点击切换`}><i/><span>打谱</span><span>做题</span></button></section>
        {workspaceSelectorOpen && <section className="inline-workspace-selector" aria-label={mode === "record" ? "本页切换棋谱" : "本页切换题目"}>
          <button className="selector-master-toggle" onClick={() => setWorkspaceListExpanded((expanded) => !expanded)}><span><b>{mode === "record" ? "选择棋谱" : "选择题集与题目"}</b><small>{mode === "record" ? `${searchableDocuments.length + largeSummaries.filter((item) => item.id !== document.id).length} 份棋谱，可上下滑动` : `${puzzleCollections.length} 个题集，可上下滑动`}</small></span><span>{workspaceListExpanded ? "收起" : "展开全部"}<ChevronDown size={17}/></span></button>
          {workspaceListExpanded && mode === "record" && <div className="inline-record-list">{searchableDocuments.map((item) => <button key={item.id} className={item.id === document.id ? "current" : ""} onClick={() => openRecord(item)}><span className="picker-record-stone">{mainLineLength(item)}</span><div><b>{item.metadata.title}</b><small>{item.metadata.black} vs {item.metadata.white} · {item.metadata.rule === "renju" ? "连珠" : "五子棋"}</small></div>{item.id === document.id ? <Check size={17}/> : <ChevronRight size={17}/>}</button>)}{largeSummaries.filter((item) => item.id !== document.id).map((item) => <button key={item.id} onClick={() => { void openLargeRecord(item); }}><span className="picker-record-stone">{item.mainLineLength}</span><div><b>{item.metadata.title}</b><small>{item.metadata.black} vs {item.metadata.white} · 大型棋谱</small></div><ChevronRight size={17}/></button>)}</div>}
          {workspaceListExpanded && mode === "puzzle" && <div className="inline-collection-list">{puzzleCollections.map((collection, collectionIndex) => { const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length; const expanded = expandedCollectionId === collection.id; const query = expanded ? puzzleQuery.trim().toLowerCase() : ""; const visiblePuzzles = collection.puzzles.filter((puzzle, index) => !query || puzzle.title.toLowerCase().includes(query) || puzzle.prompt.toLowerCase().includes(query) || String(index + 1).includes(query)); return <section key={collection.id} className={expanded ? "expanded" : ""}><button className="collection-accordion-head" onClick={() => { setExpandedCollectionId(expanded ? null : collection.id); setPuzzleQuery(""); }}><span className="puzzle-folder-icon"><FolderOpen size={18}/></span><div><b>{collection.title}</b><small>{solved}/{collection.puzzles.length} 已完成</small></div><ChevronDown size={18}/></button>{expanded && <div className="collection-accordion-body"><label className="picker-search"><Search size={16}/><input value={puzzleQuery} onChange={(event) => setPuzzleQuery(event.target.value)} placeholder="输入题号或关键词"/><button onClick={() => setPuzzleQuery("")} aria-label="清除"><X size={15}/></button></label><div className="inline-puzzle-list">{visiblePuzzles.map((puzzle) => { const actualIndex = collection.puzzles.indexOf(puzzle); const solvedPuzzle = puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved; return <button key={puzzle.id} className={collectionIndex === puzzleCollectionIndex && actualIndex === puzzleIndex ? "current" : ""} onClick={() => openPuzzle(collectionIndex, actualIndex)}><span className={solvedPuzzle ? "solved" : ""}>{solvedPuzzle ? <Check size={14}/> : actualIndex + 1}</span><div><b>{puzzle.title || `第 ${actualIndex + 1} 题`}</b><small>{puzzle.player === "black" ? "黑先" : "白先"} · {puzzle.prompt}</small></div><ChevronRight size={16}/></button>; })}</div></div>}</section>; })}</div>}
        </section>}
        <Board document={viewDocument} currentId={currentId} showNumbers={showNumbers} showCoordinates={showCoordinates} largeBoard={largeBoard} rotation={rotation} mirrored={mirrored} initialDepth={mode === "puzzle" ? puzzleInitialDepth : 0} disabled={mode === "puzzle" && (aiThinking || !!puzzleOutcome)} onPlay={play} onMark={mode === "record" ? mark : () => undefined}/>
        <div className={`workspace-status ${puzzleOutcome || ""}`}>{mode === "record" ? <><div className="workspace-status-copy"><span>{hasDraft(draft) ? "有未保存草稿" : candidateLabel ? `点棋盘放置标注「${candidateLabel}」` : current.move ? `${current.move.player === "black" ? "黑" : "白"} · ${coordinateName(current.move)}` : nodeKindLabel(current)}</span><small>{depthOf(viewDocument, currentId)} / {compactNodeCount(document) ? "大型" : mainLineLength(document)} 手 · {branchCount(viewDocument)} 处分支</small></div><div className="record-command-bar" aria-label="常驻打谱工具">
            {current.comment && <button className={`command-comment ${commentExpanded ? "active" : ""}`} onClick={() => setCommentExpanded((open) => !open)} aria-label={commentExpanded ? "收起注释" : "展开注释"} title={commentExpanded ? "收起注释" : "展开注释"}><MessageSquareText/></button>}
            <button className={`command-save ${hasDraft(draft) ? "pending" : ""}`} onClick={saveCurrentDraft} aria-label={hasDraft(draft) ? `保存当前棋谱修改（${draft.operations.length} 项）` : "当前棋谱已保存"} title={hasDraft(draft) ? "保存修改" : "已保存"}><Save/></button>
            <button className="command-delete" onClick={deleteCurrentVariation} disabled={!current.parentId} aria-label="删除当前一步及后续变化" title={current.parentId ? "删除本步及后续变化" : "起始局面不可删除"}><Trash2/></button>
            <div className={`stone-color-switch ${activePlacementPlayer} ${placementLocked ? "locked" : "following"}`} role="radiogroup" aria-label="落子颜色">
              <i aria-hidden="true"/>
              <button className={activePlacementPlayer === "black" ? "selected" : ""} onClick={() => { setPlacementPlayer("black"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "black"} aria-label="黑棋" title="锁定黑棋"><span className="player-stone black"/></button>
              <button className={activePlacementPlayer === "white" ? "selected" : ""} onClick={() => { setPlacementPlayer("white"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "white"} aria-label="白棋" title="锁定白棋"><span className="player-stone white"/></button>
              <button className={`lock-toggle ${placementLocked ? "locked" : ""}`} onClick={() => setPlacementLocked((locked) => !locked)} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定，自动换色" : "跟随当前棋谱颜色"} title={placementLocked ? "解除锁定" : "自动换色"}><Lock/></button>
            </div>
          </div></> : <><span>{puzzleOutcome === "won" ? "挑战成功" : puzzleOutcome === "lost" ? "本题失败" : puzzleOutcome === "stopped" ? "思考已停止" : aiThinking ? "陪练思考中" : `${currentPuzzle?.player === "black" ? "黑" : "白"}方由你落子`}</span><small>{puzzleOutcome ? "可悔棋或重启本题" : currentPuzzle?.prompt}</small>{aiThinking && <i/>}</>}</div>
        {mode === "record" && current.comment && commentExpanded && <div className="comment-review"><div className="comment-preview">{current.comment}</div></div>}
        {!commentExpanded && <section className="context-dock">
          <nav className="dock-tabs">{mode === "record" ? <><button aria-label="行棋" className={dockPanel === "moves" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "moves" ? null : "moves")}><Redo2/>走棋</button><button aria-label="编辑" className={dockPanel === "notes" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "notes" ? null : "notes")}><MessageSquareText/>编辑</button><button aria-label="查找" onClick={() => setSheet("find")}><Search/>查找</button><button aria-label="更多" className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "view" ? null : "view")}><MoreHorizontal/>更多</button></> : <><button className={dockPanel === "play" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "play" ? null : "play")}><Undo2/>应战</button><button className={dockPanel === "puzzles" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "puzzles" ? null : "puzzles")}><BookOpen/>题目</button><button className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "view" ? null : "view")}><MoreHorizontal/>更多</button></>}</nav>
          {dockPanel && <div className="dock-panel">
            {mode === "record" && dockPanel === "moves" && <><button onClick={() => setCurrentId(document.rootId)} aria-label="到第一手"><ChevronFirst/><span>起点</span></button><button onClick={goPrev} disabled={!current.parentId} aria-label="上一手"><ChevronLeft/><span>上一手</span></button><button className="accent" onClick={goNext} disabled={!preferredNext(viewDocument, currentId)} aria-label="下一手"><ChevronRight/><span>下一手</span></button><button onClick={() => setCurrentId(lastOnPreferredLine(viewDocument, currentId))} aria-label="到最后一手"><ChevronLast/><span>终点</span></button><button onClick={() => { setBranchPage(1); setSheet("branches"); }}><GitBranch/><span>变化</span></button>{hasDraft(draft) && <><button onClick={undoDraftChange}><Undo2/><span>撤销</span></button><button onClick={redoDraftChange}><Redo2/><span>重做</span></button><button onClick={discardDraft}><X/><span>放弃</span></button></>}</>}
            {mode === "record" && dockPanel === "notes" && <><button className={editMoveMode ? "selected" : ""} onClick={() => { if (!current.move) { setToast("起始局面没有可修改的着法"); return; } setCandidateLabel(null); setEditMoveMode((value) => !value); }}><PenLine/><span>改着</span></button><button onClick={() => setSheet("comment")}><MessageSquareText/><span>注释</span></button><button onClick={() => setSheet("boardText")}><Tag/><span>评价</span></button><button onClick={() => setSheet("metadata")}><Save/><span>信息</span></button><button onClick={() => setSheet("export")}><Share2/><span>导出</span></button></>}
            {dockPanel === "view" && <><button onClick={() => setShowNumbers((value) => !value)}><Tag/><span>{showNumbers ? "隐藏手数" : "显示手数"}</span></button><button onClick={() => setShowCoordinates((value) => !value)}><Menu/><span>{showCoordinates ? "隐藏坐标" : "显示坐标"}</span></button><button onClick={() => setRotation((value) => ((value + 90) % 360) as 0 | 90 | 180 | 270)}><RotateCw/><span>旋转</span></button><button onClick={() => setMirrored((value) => !value)}><FlipHorizontal/><span>镜像</span></button></>}
            {mode === "puzzle" && dockPanel === "play" && <><button onClick={undoPuzzleTurn} disabled={depthOf(document, currentId) <= puzzleInitialDepth}><Undo2/><span>悔棋</span></button><button onClick={restartPuzzle}><RotateCw/><span>重启</span></button><button className={aiThinking ? "danger" : "accent"} onClick={aiThinking ? stopPuzzleAi : () => movePuzzle(1)}>{aiThinking ? <X/> : <ChevronRight/>}<span>{aiThinking ? "停止" : "下一题"}</span></button></>}
{mode === "puzzle" && dockPanel === "puzzles" && <><button onClick={() => movePuzzle(-1)}><ChevronLeft/><span>上一题</span></button><button className="accent" onClick={() => { setWorkspaceSelectorOpen(true); setWorkspaceListExpanded(true); setExpandedCollectionId(puzzleCollections[puzzleCollectionIndex]?.id || null); window.scrollTo({ top: 0, behavior: "smooth" }); }}><BookOpen/><span>选题</span></button><button onClick={() => movePuzzle(1)}><ChevronRight/><span>下一题</span></button></>}
          </div>}
        </section>}
      </div>}

      {tab === "library" && <div className="library-page page-padding">
        <div className="page-title"><div><span>LOCAL LIBRARY</span><h1>棋谱库</h1><p>题库和棋谱分开管理，均可建立文件夹</p></div><button className="round-add" onClick={() => createLibraryFolder(librarySection)} aria-label="新建文件夹"><FolderPlus size={20}/></button></div>
        <div className="library-segment" role="tablist"><button className={librarySection === "puzzles" ? "active" : ""} onClick={() => { setLibrarySection("puzzles"); setExpandedLibraryFolder("内置题库"); }} role="tab">题库 <small>{puzzleCollections.length}</small></button><button className={librarySection === "records" ? "active" : ""} onClick={() => { setLibrarySection("records"); setExpandedLibraryFolder("未分类"); }} role="tab">棋谱 <small>{library.length + largeSummaries.length}</small></button></div>
        {librarySection === "records" ? <>
          <div className="library-actions three"><button onClick={() => singleFileInput.current?.click()}><Upload/>导入棋谱<small>单个 LIB / SGF / JSON</small></button><button onClick={() => fileInput.current?.click()}><FolderOpen/>批量导入<small>一次选择多份</small></button><button onClick={newRecord}><FilePlus2/>新建棋谱<small>从空棋盘开始</small></button></div><button className="settings-link image-import-entry" onClick={() => imageFileInput.current?.click()} disabled={imageRecognizing}><span><Upload/><b>{imageRecognizing ? "正在识别棋盘…" : "图片识谱"}</b><small>导入棋盘截图，识别黑白棋子并生成可编辑棋谱</small></span><ChevronRight/></button>
          <label className="library-search"><Search size={17}/><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜索棋谱名、棋手或主题"/><button type="button" onClick={() => setLibraryQuery("")} aria-label="清除搜索"><X size={15}/></button></label>
          <div className="folder-library-list">{libraryFolders.recordFolders.map((folder) => { const items = filteredLibrary.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder); const largeItems = filteredLargeSummaries.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder); const expanded = expandedLibraryFolder === folder; return <section key={folder}><button className="library-folder-head" onClick={() => setExpandedLibraryFolder(expanded ? null : folder)}><FolderOpen size={19}/><span><b>{folder}</b><small>{items.length + largeItems.length} 份棋谱</small></span><ChevronDown size={18}/></button>{expanded && <div className="record-list folder-items">{items.map((item) => <article key={item.id} onClick={() => openRecord(item)}><div className="mini-board"><span>●</span><span>○</span><b>{mainLineLength(item)}</b></div><div className="record-info"><h3>{item.metadata.title}</h3><p>{item.metadata.black} vs {item.metadata.white}</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", item.id, event.target.value)}>{libraryFolders.recordFolders.map((name) => <option key={name}>{name}</option>)}</select></div><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteRecord(item); }} aria-label="删除"><Trash2 size={17}/></button></article>)}{largeItems.map((item) => <article key={item.id} onClick={() => { void openLargeRecord(item); }}><div className="mini-board"><span>●</span><span>○</span><b>{item.mainLineLength}</b></div><div className="record-info"><h3>{item.metadata.title}</h3><p>{item.metadata.black} vs {item.metadata.white} · 大型棋谱 · {item.nodeCount.toLocaleString()} 节点</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", item.id, event.target.value)}>{libraryFolders.recordFolders.map((name) => <option key={name}>{name}</option>)}</select></div><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteLargeRecord(item); }} aria-label="删除"><Trash2 size={17}/></button></article>)}{!items.length && !largeItems.length && <p className="folder-empty">这个文件夹还是空的</p>}</div>}</section>; })}</div>
        </> : <>
          <div className="library-actions puzzle-actions"><button onClick={() => puzzleFileInput.current?.click()}><Upload/>导入 JSON 题库<small>支持开宝题集数组格式</small></button><button onClick={() => createLibraryFolder("puzzles")}><FolderPlus/>新建文件夹<small>自由整理题集</small></button></div>
          <div className="folder-library-list">{libraryFolders.puzzleFolders.map((folder) => { const collections = puzzleCollections.filter((collection) => (libraryFolders.puzzleAssignments[collection.id] || (collection.id.startsWith("native-") || collection.id === "original-tactics" ? "内置题库" : "我的题库")) === folder); const expanded = expandedLibraryFolder === folder; return <section key={folder}><button className="library-folder-head" onClick={() => setExpandedLibraryFolder(expanded ? null : folder)}><FolderOpen size={19}/><span><b>{folder}</b><small>{collections.length} 个题集</small></span><ChevronDown size={18}/></button>{expanded && <div className="puzzle-collection-list folder-items">{collections.map((collection) => { const collectionIndex = puzzleCollections.indexOf(collection); const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length; return <article key={collection.id}><button onClick={() => guardedOpenPuzzle(collectionIndex, 0)}><span className="puzzle-folder-icon">題</span><div><b>{collection.title}</b><small>{solved} / {collection.puzzles.length} 已完成 · {collection.source}</small></div><ChevronRight size={18}/></button><select value={folder} onChange={(event) => assignLibraryItem("puzzles", collection.id, event.target.value)} aria-label="移动题集到文件夹">{libraryFolders.puzzleFolders.map((name) => <option key={name}>{name}</option>)}</select></article>; })}{!collections.length && <p className="folder-empty">这个文件夹还是空的</p>}</div>}</section>; })}</div>
        </>}
      </div>}

      {tab === "settings" && <div className="settings-page page-padding"><div className="page-title"><div><span>WORKSPACE</span><h1>打谱设置</h1><p>针对手机小屏优化显示与操作</p></div></div><section className="settings-group"><h2>棋盘显示</h2><SettingRow title="显示手数" text="在棋子上显示落子序号" checked={showNumbers} onChange={setShowNumbers}/><SettingRow title="显示坐标" text="棋盘边缘显示 A–O / 1–15" checked={showCoordinates} onChange={setShowCoordinates}/><SettingRow title="禁手辅助" text="提示黑方常见三三、四四与长连" checked={showForbidden} onChange={setShowForbidden}/></section><section className="settings-group"><h2>数据与兼容</h2><button className="settings-link" onClick={() => fileInput.current?.click()}><span><Upload/><b>导入棋谱</b><small>LIB（最大 200MB）/ SGF / FGF / REN / WZQ / RENJU JSON</small></span><ChevronRight/></button><button className="settings-link" onClick={() => setSheet("export")}><span><Download/><b>导出棋谱</b><small>标准 SGF（含分支与标注）或 RENJU JSON</small></span><ChevronRight/></button><button className="settings-link" onClick={() => setSheet("help")}><span><Info/><b>格式兼容说明</b><small>JSON 两类用途与 TXT 坐标文本说明</small></span><ChevronRight/></button></section><section className="settings-group"><h2>关于</h2><button className="settings-link" onClick={() => setSheet("about")}><span><Info/><b>关于半步五子棋</b><small>参考项目、技术架构、致谢与源代码</small></span><ChevronRight/></button></section><div className="version-note">半步五子棋 1.0.0 · Web / PWA / Android</div></div>}
    </main>

    <nav className="bottom-nav"><button className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}><Home/><span>{mode === "puzzle" ? "做题" : "打谱"}</span></button><button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>棋谱库</span></button><button className="nav-center" onClick={() => setSheet("import")}><Upload/><span>导入</span></button><button className={candidateLabel ? "active" : ""} onClick={() => { setTab("record"); if (mode === "record") setSheet("marks"); else setDockPanel("play"); }}><Tag/><span>{mode === "record" ? "标注" : "应战"}</span></button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings/><span>设置</span></button></nav>
    {importingFile && <div className="import-progress"><i/><span><b>正在后台解析</b><small>{importingFile} · 大型 LIB 可能需要数分钟，请勿关闭页面</small></span></div>}
    {toast && <div className="toast">{toast}</div>}

    {pendingSwitch && <div className="sheet-backdrop" onMouseDown={() => setPendingSwitch(null)}><section className="bottom-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="未保存草稿"><div className="sheet-handle"/><div className="sheet-head"><h2>有未保存草稿</h2><button className="icon-button" onClick={() => setPendingSwitch(null)} aria-label="取消"><X size={20}/></button></div><div className="sheet-body"><p className="section-note">切换棋谱前请先处理当前未保存的草稿，否则将丢失。</p><button className="primary-button" onClick={savePendingSwitch}><Save/>保存草稿并切换</button><button className="secondary-button" onClick={discardPendingSwitch}><X/>放弃草稿并切换</button><button className="secondary-button" onClick={() => setPendingSwitch(null)}>取消</button></div></section></div>}

    {sheet && <BottomSheet title={sheetTitle} onClose={() => setSheet(null)}>
      {sheet === "folder" && <div className="sheet-body form-grid folder-sheet"><label>文件夹名称<input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder={`例如：${folderCreationSection === "records" ? "我的实战棋谱" : "冲四题库"}`} onKeyDown={(event) => { if (event.key === "Enter") confirmCreateLibraryFolder(); }}/></label><p className="helper">新建后可在保存棋谱或题库时选择这个分组。</p><button className="primary-button" onClick={confirmCreateLibraryFolder}><FolderPlus/>创建文件夹</button></div>}
      {sheet === "marks" && <div className="annotation-options"><p className="section-note">默认直接显示原棋谱文字；也可以切换圆圈、三角或叉号，并选择标注颜色。</p><h3>显示样式</h3><div className="annotation-style-grid">{([['text','文字'],['circle','圆圈'],['triangle','三角'],['cross','叉号']] as const).map(([style, label]) => <button key={style} className={annotationStyle === style ? "selected" : ""} onClick={() => setAnnotationStyle(style)}><span className={`annotation-preview ${style}`}>{style === "text" ? "A" : style === "circle" ? "○" : style === "triangle" ? "△" : "×"}</span><small>{label}</small></button>)}</div><h3>标注颜色</h3><div className="annotation-color-grid">{[["#2872b8","蓝"],["#b94b3f","红"],["#365e4b","绿"],["#b27b18","金"]].map(([color, label]) => <button key={color} className={annotationColor === color ? "selected" : ""} style={{ "--annotation-color": color } as React.CSSProperties} onClick={() => setAnnotationColor(color)} aria-label={`${label}色`}><span/></button>)}</div></div>}
      {sheet === "find" && <div className="sheet-body find-sheet"><label className="find-input"><Search size={17}/><input autoFocus value={findQuery} onChange={(event) => setFindQuery(event.target.value)} placeholder="坐标、手数、注释或局面文字"/><button type="button" onClick={() => setFindQuery("")} aria-label="清除查找"><X size={15}/></button></label>{findQuery && <p className="section-note">找到 {findResults.length} 个节点（最多显示 20 个）</p>}{findQuery && !findResults.length && <div className="sheet-empty"><Search/><b>没有找到匹配节点</b><span>可以试试 H8、2、好手，或注释中的关键词。</span></div>}{findResults.length > 0 && <div className="find-results">{findResults.map((node) => <button key={node.id} onClick={() => { setCurrentId(node.id); setSheet(null); }}><span className={`branch-stone ${node.move?.player || node.passPlayer || "black"}`}>{node.move || node.passPlayer ? depthOf(document, node.id) : node.parentId ? "·" : "起"}</span><div><b>{nodeKindLabel(node)}{node.evaluation ? ` · ${evaluationLabel(node.evaluation)}` : ""}</b><small>{node.boardText || node.comment || "无局面文字或注释"}</small></div><ChevronRight/></button>)}</div>}<p className="helper">查找会覆盖当前棋谱的主线与所有变化，点击结果即可跳到对应节点。</p></div>}
      {sheet === "positionSearch" && <div className="sheet-body position-search-sheet"><label className="match-toggle"><span><b>包含旋转与镜像</b><small>不同棋盘朝向也视为同一局面</small></span><input type="checkbox" checked={matchSymmetry} onChange={(event) => setMatchSymmetry(event.target.checked)}/><i/></label><p className="section-note">已扫描 {searchableDocuments.length} 份本地棋谱的主线和全部变化，找到 {visiblePositionMatches.length} 个其他节点{positionMatches.length >= 60 ? "（只显示前 60 个）" : ""}。</p><div className="position-match-list">{visiblePositionMatches.map((match) => <button key={`${match.documentId}-${match.nodeId}`} onClick={() => { const target = searchableDocuments.find((item) => item.id === match.documentId); if (!target) return; openRecord(target, match.nodeId, { onOpened: () => { setSheet(null); setToast(`已跳转到《${match.title}》第 ${match.depth} 手`); } }); }}><span>{match.depth}</span><div><b>{match.title}</b><small>第 {match.depth} 手{match.coordinate ? ` · ${match.coordinate}` : " · 起始局面"}</small></div><ChevronRight size={18}/></button>)}</div>{!visiblePositionMatches.length && <div className="sheet-empty"><Search/><b>棋谱库中没有其他相同局面</b><span>{matchSymmetry ? "已同时比较旋转与镜像方向。" : "可开启旋转与镜像后再试。"}</span></div>}<p className="helper">匹配同时比较黑白棋位置和下一手行棋方；点击结果会直接打开对应棋谱节点。</p></div>}
      {sheet === "analysis" && <div className="sheet-body analysis-sheet"><section className="vcf-panel"><div className="vcf-heading"><div><span>强制胜证明</span><b>VCF · 连续冲四</b></div><em>最多 5 次进攻</em></div>{!vcfResult && !vcfRunning && <p>穷举进攻方的成五与冲四，并验证防守方所有合法挡点；只有全部防守都失败才报告胜法。</p>}{vcfRunning && <div className="vcf-running"><i/><span>正在搜索合法冲四与全部防点…</span></div>}{vcfResult?.status === "win" && <div className="vcf-result win"><b><Check size={17}/>已找到连续冲四胜法</b><div className="proof-line">{vcfResult.principalVariation.map((move, index) => <span key={`${move.row}-${move.col}-${index}`} className={move.player}>{index + 1}. {coordinateName(move)}</span>)}</div><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small><button onClick={() => { const first = vcfResult.principalVariation[0]; if (first) { setSheet(null); play(first); } }}>从证明首手创建变化</button></div>}{vcfResult?.status === "not-found" && <div className="vcf-result neutral"><b>当前深度未找到 VCF</b><span>这不代表局面无胜，只表示最多 5 次连续冲四内没有证明。</span><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}{vcfResult?.status === "budget" && <div className="vcf-result warning"><b>达到手机计算预算</b><span>搜索已安全中止，没有把未完成结果当作胜法。</span><small>检查 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}<button className="vcf-search-button" disabled={vcfRunning} onClick={() => { void runVcf(); }}><Search size={16}/>{vcfRunning ? "搜索中…" : vcfResult ? "重新搜索 VCF" : "搜索 VCF 胜法"}</button></section><button className="position-search-entry" onClick={() => setSheet("positionSearch")}><span><Search size={18}/></span><div><b>跨谱查找相同局面</b><small>支持旋转、镜像和所有变化节点</small></div><ChevronRight size={18}/></button><p className="section-note">下面是启发式候选排序：综合成五、活四、冲四、活三与防守点，用于研究和标记，不等同于 VCF/VCT 证明。</p><div className="analysis-list">{candidates.map((candidate, index) => <div className="analysis-row" key={`${candidate.position.row}-${candidate.position.col}`}><div className="analysis-rank">{String.fromCharCode(65 + index)}</div><div className="analysis-copy"><b>{coordinateName(candidate.position)} <small>{Math.round(candidate.score)} 分</small></b><span>{candidate.reasons.join(" · ")}</span></div><button className="analysis-mark" onClick={() => markCandidate(index)}>标记</button></div>)}</div>{!candidates.length && <div className="sheet-empty"><Search/><b>当前没有可评估的候选点</b><span>棋盘可能已满，或局面没有明显的局部连接。</span></div>}<div className="analysis-actions"><button className="primary-button" onClick={markTopCandidates}>标记前五候选</button><button className="secondary-button" onClick={() => setSheet("marks")}>打开标注面板</button></div><p className="helper">候选点会保存到当前节点，可导出为 SGF 的 LB 标记。</p></div>}
      {sheet === "comment" && <div className="sheet-body"><textarea autoFocus value={current.comment} placeholder="例如：这里白棋若防在 J9，黑棋可以继续冲四…" onChange={(event) => safeUpdateNode({ comment: event.target.value })}/><p className="helper">注释保存在当前节点，导出 SGF 时会写入 C 属性。</p><button className="primary-button" onClick={() => setSheet(null)}><Check/>完成</button></div>}
      {sheet === "boardText" && <div className="sheet-body position-note-sheet"><label className="position-text-field"><span>局面文字（节点名）</span><input autoFocus maxLength={80} value={current.boardText || ""} placeholder="例如：白方唯一防点、黑方强攻起点" onChange={(event) => safeUpdateNode({ boardText: event.target.value })}/><small>{(current.boardText || "").length} / 80 · 导出为 SGF 的 N 属性</small></label>{current.move ? <><div className="evaluation-heading"><b>着法评价</b><button type="button" onClick={() => safeUpdateNode({ evaluation: undefined, evaluationLevel: undefined })}>清除评价</button></div><div className="evaluation-grid">{evaluationOptions.map((option) => <button key={option.value} className={current.evaluation === option.value ? "selected" : ""} onClick={() => safeUpdateNode({ evaluation: current.evaluation === option.value ? undefined : option.value, evaluationLevel: option.value === "good" || option.value === "bad" ? 1 : undefined })}><span>{option.label}</span><small>{option.hint}</small></button>)}</div><p className="helper">好手、坏手、疑问手和趣着写入通用 SGF 属性；其他评价使用兼容扩展属性并完整保留在 RENJU 文件中。</p></> : <div className="root-evaluation-note"><Info size={18}/><span>起始局面没有着法，因此只保存局面文字，不添加“好手/坏手”等着法评价。</span></div>}<button className="primary-button" onClick={() => setSheet(null)}><Check/>完成</button></div>}
      {sheet === "branches" && <div className="sheet-body"><p className="section-note">当前支点后续有 {branchTotal.toLocaleString()} 个变化。选择一个变化会将它设为默认主线；列表采用固定窗口渲染。</p><div ref={branchListRef} className="branch-list branch-list-virtual" onScroll={(event) => setBranchScrollTop(event.currentTarget.scrollTop)}>{branchTotal > 0 && <div style={{ height: branchTotal * BRANCH_ROW_HEIGHT, position: "relative" }}>{branchWindow.ids.map((id, offset) => { const index = branchWindow.start + offset; const node = viewDocument.nodes[id]; if (!node) return null; const preview = variationPreview(viewDocument, id, 3); return <button key={id} style={{ position: "absolute", top: index * BRANCH_ROW_HEIGHT, left: 0, right: 0, height: BRANCH_ROW_HEIGHT }} onClick={() => chooseChild(id, branchView.id)}><span className={`branch-stone ${node.move?.player || node.passPlayer || "black"}`}>{index + 1}</span><div><b>{nodeKindLabel(node)}</b><small>{node.comment || `变化 ${index + 1} · 后续 ${node.children.length} 支`}</small>{preview && <small className="branch-preview">续：{preview}</small>}</div>{branchView.preferredChildId === id && <em>主线</em>}<ChevronRight/></button>; })}</div>}{!branchTotal && <div className="sheet-empty"><GitBranch/><b>这里还没有后续变化</b><span>关闭面板，在棋盘空位落子即可创建。</span></div>}</div>{branchPivotId && <button className="branch-create-button" onClick={() => { setCurrentId(branchPivotId); setSheet(null); setToast("已回到分叉支点，在棋盘空位落子即可创建新变化"); }}><GitBranch/>回到分叉支点创建变化</button>}{current.parentId && <button className="danger-button" onClick={() => { recordDraft({ type: "delete-subtree", parentId: current.parentId || document.rootId, rootId: currentId }); setCurrentId(current.parentId || document.rootId); setSheet(null); setToast("已加入删除草稿，点击保存后提交"); }}><Trash2/>删除当前变化及后续</button>}</div>}
      {sheet === "save" && <div className="sheet-body form-grid save-sheet"><label>保存名称<input autoFocus value={viewDocument.metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })}/></label><div className="save-destination" role="tablist" aria-label="保存类型"><button className={saveDestination === "records" ? "selected" : ""} onClick={() => { setSaveDestination("records"); setSaveFolder(libraryFolders.recordFolders[0] || "未分类"); }} role="tab">棋谱</button><button className={saveDestination === "puzzles" ? "selected" : ""} onClick={() => { setSaveDestination("puzzles"); setSaveFolder(libraryFolders.puzzleFolders[0] || "我的题库"); }} role="tab">题库</button></div><label>保存到分组<select value={saveFolder} onChange={(event) => setSaveFolder(event.target.value)}>{(saveDestination === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders).map((folder) => <option key={folder}>{folder}</option>)}</select></label>{saveDestination === "puzzles" && <p className="helper">将当前局面保存为一道练习题，保留当前棋盘上的全部棋子。</p>}<button className="primary-button" onClick={() => { void confirmSave(); }}><Save/>确认保存</button></div>}
      {sheet === "metadata" && <div className="sheet-body form-grid"><label>棋谱名称<input value={viewDocument.metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })}/></label><div className="two-cols"><label>黑方<input value={viewDocument.metadata.black} onChange={(event) => updateMetadata({ black: event.target.value })}/></label><label>白方<input value={viewDocument.metadata.white} onChange={(event) => updateMetadata({ white: event.target.value })}/></label></div><label>赛事 / 主题<input value={viewDocument.metadata.event} onChange={(event) => updateMetadata({ event: event.target.value })}/></label><div className="two-cols"><label>日期<input type="date" value={viewDocument.metadata.date} onChange={(event) => updateMetadata({ date: event.target.value })}/></label><label>规则<select value={viewDocument.metadata.rule} onChange={(event) => updateMetadata({ rule: event.target.value as GameDocument["metadata"]["rule"] })}><option value="renju">连珠规则</option><option value="standard">标准五子棋</option><option value="freestyle">无禁手</option></select></label></div><button className="primary-button" onClick={() => setSheet(null)}><Save/>保存信息</button></div>}
      {sheet === "import" && <div className="sheet-body import-options"><button className="import-choice" onClick={() => { setSheet(null); if (mode === "puzzle") puzzleFileInput.current?.click(); else singleFileInput.current?.click(); }}><span className="format-icon"><Upload/></span><div><b>{mode === "puzzle" ? "导入题库文件" : "导入棋谱文件"}</b><small>{mode === "puzzle" ? "选择 JSON 题库" : "SGF、LIB、JSON、POS 等格式"}</small></div><ChevronRight/></button><button className="import-choice" onClick={() => { setSheet(null); imageFileInput.current?.click(); }}><span className="format-icon json"><Upload/></span><div><b>图片识谱</b><small>从棋盘截图识别黑白棋子，生成可编辑局面</small></div><ChevronRight/></button><p className="helper">图片识谱会先询问棋盘路数。清晰截图识别效果最好；带数字的完整顺序目前需要人工确认。</p></div>}
      {sheet === "export" && <div className="sheet-body export-options"><button onClick={() => { const exportDoc = hasDraft(draft) ? viewDocument : document; downloadText(exportSgf(exportDoc), `${safeName(exportDoc.metadata.title)}.sgf`, "application/x-go-sgf;charset=utf-8"); setToast("SGF 已导出"); }}><span className="format-icon">SGF</span><div><b>标准 SGF 棋谱</b><small>兼容变着、注释和棋盘标记</small></div><ArrowDownToLine/></button><button onClick={() => { const exportDoc = hasDraft(draft) ? viewDocument : document; downloadText(exportJson(exportDoc), `${safeName(exportDoc.metadata.title)}.renju`, "application/json;charset=utf-8"); setToast("跨端棋谱已导出"); }}><span className="format-icon json">R</span><div><b>RENJU 跨端文件</b><small>完整保留全部移动端数据</small></div><ArrowDownToLine/></button><p className="helper">未来桌面端和网页版将直接读取 RENJU 文件；SGF 用于与现有五子棋软件交换。</p></div>}
      {sheet === "help" && <div className="sheet-body help-content"><div className="support-row"><b>棋谱导入</b><span>RenLib 3.x / 旧版无头 LIB（单文件最大 200MB）、SGF / FGF、REN / RENJS / WZQ（SGF 语法）、RENJU JSON、POS，以及 TXT 坐标序列。SGF 支持设置局面、过手、UTF-16 和同文件多盘棋。</span></div><div className="support-row"><b>JSON 的三种用途</b><span>棋谱库读取本软件的 RENJU 完整变化树或带明确 moves 字段的落子列表对象；题库页读取开宝兼容数组。数字坐标列表必须声明 coordinateBase，不猜测任意数组。</span></div><div className="support-row warning"><b>十五路边界</b><span>当前棋盘、规则与题库固定为十五路；其他 SGF SZ 会明确拒绝，不会缩放后生成错误棋谱。</span></div><div className="support-row warning"><b>TXT 不是统一棋谱标准</b><span>TXT 仅作为纯文本坐标序列兼容入口，例如 H8 I8 H9；带专有结构的文本应使用原软件导出的 SGF。</span></div><div className="support-row warning"><b>LIB 兼容边界</b><span>大型 LIB 在后台线程解析并存入 IndexedDB，不再受普通浏览器存储容量限制。已读取主线、分支、常见节点注释和标记控制字节；超出 RenLib 3.4 的扩展仍会提示。 200MB 是手机端完整变化树的安全上限；压缩包大小不等于解压后的 LIB 大小，解压后更大的超大型开局库需要在桌面端分卷或裁剪。</span></div><h3>手机快捷操作</h3><ul><li>点空交叉点：落子；点已有棋子：跳到该手</li><li>底部“标注”：放置数字、胜败平衡和自定义文字</li><li>长按交叉点：圆圈 → 三角 → 叉号 → 清除</li><li>左右方向键（外接键盘）：前后导航</li></ul><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></div>}
      {sheet === "about" && <div className="sheet-body about-sheet"><section className="about-hero"><span>半</span><div><b>半步五子棋</b><small>版本 1.0.0 · 移动优先的打谱与做题工具</small></div></section><section className="creator-message"><b>写在前面</b><p>这是一个 Vibecoding 的产物，也是一款永久免费、开放源代码的五子棋软件。希望它能让手机打谱和做题更方便；如果内容涉及侵权，请通过 GitHub 联系，我会及时处理或删除。</p></section><section className="about-card"><h3><Code2 size={17}/>参考与致谢</h3><p>打谱功能参考了爱五子棋打谱软件与 RenLib / SGF 生态；做题交互和题集格式参考了开宝五子棋；AI 搜索思路参考了 SlowRenju 等公开项目。感谢这些前辈软件与开源社区。</p></section><section className="about-card"><h3><Layers3 size={17}/>技术架构</h3><p>React 19 + TypeScript + Vite · PWA / Workbox 离线网页 · Capacitor 8 Android · Web Worker 本地 AI 与 VCF 搜索。棋谱采用变化树模型，为网页、安卓和未来桌面端共享。</p></section><a className="github-link" href="https://github.com/gugujiao953-ship-it/banbu-gomoku" target="_blank" rel="noreferrer"><Code2 size={20}/><span><b>GitHub 源代码</b><small>gugujiao953-ship-it/banbu-gomoku</small></span><ChevronRight size={18}/></a><button className="primary-button" onClick={() => setSheet(null)}>完成</button></div>}
      {sheet === "marks" && <div className="sheet-body mark-sheet"><p className="section-note">标注属于当前局面，与注释、着法评价相互独立；可放在空点或棋子上，并随 SGF 的 LB / CR / TR / MA 属性导入导出。</p><section><h3>数字标注</h3><div className="mark-preset-grid numbers">{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><section><h3>局面结论</h3><div className="mark-preset-grid words">{["胜", "败", "平", "平衡", "攻", "守", "要", "疑"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><section><h3>字母与自定义</h3><div className="mark-preset-grid letters">{["A", "B", "C", "D", "E"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div><div className="custom-mark-row"><input maxLength={4} value={customMarkLabel} onChange={(event) => setCustomMarkLabel(event.target.value)} placeholder="最多 4 个字"/><button disabled={!customMarkLabel.trim()} onClick={() => { setCandidateLabel(Array.from(customMarkLabel.trim()).slice(0, 4).join("")); setSheet(null); }}>使用</button></div></section><div className="mark-shape-tip"><b>形状标记</b><span>在棋盘交叉点长按，可依次切换圆圈、三角、叉号和清除。</span></div>{current.marks.length > 0 && <button className="danger-button" onClick={() => { safeClearMarks(); setCandidateLabel(null); setSheet(null); setToast("已清除当前局面的全部标注"); }}><Trash2/>清除当前局面全部标注（{current.marks.length}）</button>}</div>}
    </BottomSheet>}
  </div>;
}

function SettingRow({ title, text, checked, onChange }: { title: string; text: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="setting-row"><span><b>{title}</b><small>{text}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><i/></label>;
}
