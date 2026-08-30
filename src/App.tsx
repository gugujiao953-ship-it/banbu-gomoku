import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArchiveRestore, BookOpen, Bot, Check, ChevronDown, ChevronFirst, ChevronLast, ChevronLeft,
  ChevronRight, CircleHelp, Code2, Download, FilePlus2, FlipHorizontal, FolderOpen, FolderPlus, GitBranch,
  Home, Info, Layers3, Library, Lock, ListTree, Mail, Menu, MessageSquareText, MoreHorizontal, RotateCw, Search, Tag,
  PenLine, Redo2, Save, Settings, Trash2, Undo2, Upload, X,
} from "lucide-react";
import {
  addMove, addMoveAs, boardAt, coordinateName, createDocument, deleteVariation, depthOf, isSupportedBoardSize,
  forbiddenPoints, forbiddenReason, lastOnPreferredLine, nextPlayerAt, otherPlayer, pathToNode, preferredNext, setLabelMark, toggleMark, updateNode, winningLinesAt,
} from "./game";
import { analyzeCandidates } from "./analysis";
import { downloadFile, exportJson, exportPos, exportSgf, importRecordFile, mainLineLength } from "./formats";
import { recognizeBoardImage, type ImageRecognitionResult } from "./image-recognition";
import { findPositionMatches, positionKey } from "./position-search";
import { loadActive, loadDraftFromLocal, loadLibrary, removeDraftFromLocal, removeFromLibrary, renameInLibrary, saveDraftToLocal, saveManyToLibrary, saveToLibrary } from "./storage";
import { commitDraftAsDerivedVersion, documentFingerprint, loadDraftForDocument, loadLargeDocument, loadLargeSummaries, moveLargeDocumentToTrash, removeDraftForDocument, removeLargeDocument, removeLargeTrashDocument, renameLargeDocument, restoreLargeDocumentFromTrash, saveCompactIndex, saveDraftForDocument, saveLargeDocument } from "./large-storage";
import { openLibraryHandle } from "./library-engine";
import { isPagedLibraryView, LibraryViewSession } from "./library-view-adapter";
import { DpViewSession, isDpDatabaseView } from "./dp-view-session";
import { RenLibWebViewSession, isRenLibWebView } from "./renlib-web/renlib-web-view-session";
import { compactBranchCount, compactChildCount, compactChildWindow, compactDiagnostics, compactFirstBranchNodeId, compactIndexOf, compactNodeCount, compactNodeIndex, compactSearch, createLazyDocument } from "./compact-index";
import { formatRenLibWebLabel, renLibDisplayMark } from "./renlib-display";
import { createEditableViewCopy, findVisibleVariationTarget, visibleVariationPivot } from "./record-editing";
import { clearDefaultDirectoryHandle, loadDefaultDirectoryHandle, pickDefaultDirectoryHandle, supportsDirectoryPicker, writeFileToDirectory, type DirectoryHandleLike } from "./file-destination";
import { boardShareFilename, renderBoardSharePng, type BoardShareOptions } from "./board-image-export";
import { sharePngFile } from "./share-file";
import { transformBoardPosition, type BoardRotation } from "./board-transform";
import { recordAction } from "./diagnostics";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, hasDraft, isProjectedDocument, overlayChildren, overlayNode, overlayPreferredChild, projectedDocument, pushDraft, undoDraft, type DraftState, type DraftOperation as DraftOp } from "./draft-operations";
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
import { createPuzzleDocument, deriveWrongPuzzleEntries, importKaibaoPuzzleJson, isPuzzleJsonText, loadNativeKaibaoCollections, loadPuzzleCollections, loadPuzzleProgress, puzzleProgressKey, savePuzzleCollections, savePuzzleProgress, savePuzzleTitleOverride } from "./puzzles";
import type { Puzzle, PuzzleCollection, PuzzleReviewEntry } from "./puzzles";
import { addFifthCandidate, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, isDistinctFifthCandidate, openingInstruction, openingPositionAllowed, openingRuleName, suggestFifthCandidates, suggestOpeningPlacement, type OpeningSession, type OpeningStage } from "./opening-rules";
import { createBackupSnapshot, parseBackup, restoreBackup, serializeBackup } from "./backup";
import { banbuAudio, type SoundCue } from "./audio-engine";
import { loadSoundSettings, saveSoundSettings, type SoundSettings } from "./audio-settings";
import { loadMotionEnabled, saveMotionEnabled } from "./motion-settings";
import { loadEnhancementSettings, saveEnhancementSettings, type EnhancementSettings } from "./enhancement-settings";
import { fontScaleClass, loadFontScale, saveFontScale, type FontScale } from "./accessibility";
import { ImportProgressCard } from "./ImportProgressCard";
import { mergeImportProgress, type ImportProgressPatch, type ImportProgressState } from "./import-progress";
import { QuickDrawer } from "./QuickDrawer";
import { TreePanel } from "./tree-panel";
import { AppToast } from "./ui/feedback/AppToast";
import { StateIllustration } from "./ui/states/StateIllustration";
import { CoachMark, type CoachMarkAction, type CoachMarkId } from "./ui/coach/CoachMark";
import { loadRecentImports, openRecentImport, saveRecentImport, type RecentImportEntry, type RecentImportKind } from "./recent-imports";
import { addToRecycleBin, loadRecycleBin, removeFromRecycleBin, type RecycleBinEntry } from "./recycle-bin";
import { FeedbackPanel } from "./FeedbackPanel";

type Tab = "record" | "library" | "settings";
type AppMode = "record" | "puzzle";
type ThemePreference = "system" | "light" | "dark" | "eye" | "mono" | "rain" | "bamboo" | "snow" | "porcelain" | "plum" | "jiangnan" | "firefly" | "rice" | "pixel" | "cyber" | "custom";
type ResolvedTheme = "light" | "dark" | "eye" | "mono" | "rain" | "bamboo" | "snow" | "porcelain" | "plum" | "jiangnan" | "firefly" | "rice" | "pixel" | "cyber" | "custom";
type BoardTheme = "wood" | "jade" | "notebook" | "emerald" | "porcelain" | "whitejade" | "walnut" | "frosted" | "circuit" | "minimal";
type StoneTheme = "classic" | "jade" | "yun" | "ink" | "mono" | "notebook" | "porcelain" | "snow" | "terminal" | "gold-diamond" | "gold" | "diamond";
type BoardMotionKind = "place" | "navigate" | "branch" | null;
type BoardFeedbackKind = "illegal" | "forbidden";
type BoardResultKind = "won" | "lost" | "draw" | "complete";
type ThinkVisualState = "idle" | "thinking" | "complete" | "unavailable" | "error" | "cancelled";
interface BoardMotionState { kind: BoardMotionKind; version: number }
interface BoardFeedbackState { position: Position; kind: BoardFeedbackKind; version: number }
interface BoardResultState { kind: BoardResultKind; label: string }
type Sheet = "comment" | "branches" | "tree" | "metadata" | "save" | "folder" | "rename" | "export" | "help" | "manual" | "about" | "feedback" | "find" | "analysis" | "positionSearch" | "marks" | "import" | "aiGame" | "think" | "wrongbook" | "trash" | "batchEdit" | null;
type DockPanel = "moves" | "notes" | "view" | "play" | "puzzles" | null;
type LibrarySection = "puzzles" | "records";
type AiStrength = "初级" | "中级" | "高级" | "大师" | "自由";
type AiTimeControl = 0 | 60000 | 300000 | 1800000;
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
interface AiGameState { humanPlayer: Player; aiPlayer: Player; strength: AiStrength; forbiddenEnabled: boolean; timeLimitMs: number; outcome: "won" | "lost" | "draw" | null; opening: OpeningSession }
const AI_STRENGTH_OPTIONS: Array<{ value: AiStrength; title: string; text: string }> = [
  { value: "初级", title: "初级", text: "约 0.6 秒/步" },
  { value: "中级", title: "中级", text: "约 1.2 秒/步" },
  { value: "高级", title: "高级", text: "约 1.8 秒/步" },
  { value: "大师", title: "大师", text: "约 3 秒/步" },
  { value: "自由", title: "自由", text: "自定义思考时间与搜索深度" },
];
const AI_STRENGTH_PROFILES: Record<Exclude<AiStrength, "自由">, { timeMs: number; maxDepth: number }> = {
  初级: { timeMs: 600, maxDepth: 32 },
  中级: { timeMs: 1200, maxDepth: 48 },
  高级: { timeMs: 1800, maxDepth: 64 },
  大师: { timeMs: 3000, maxDepth: 80 },
};
const AI_TIME_OPTIONS: Array<{ value: AiTimeControl; title: string; text: string }> = [
  { value: 0, title: "不限", text: "只显示你的累计用时" },
  { value: 60000, title: "1 分钟", text: "适合快速对局" },
  { value: 300000, title: "5 分钟", text: "短局练习" },
  { value: 1800000, title: "30 分钟", text: "完整思考空间" },
];
const formatGameClock = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};
const BRANCH_BOOKMARKS_KEY = "renju-note-branch-bookmarks-v1";
const THEME_PREFERENCE_KEY = "banbu-theme-preference-v1";
const DISPLAY_SETTINGS_KEY = "renju-note-display-settings-v1";
const CUSTOM_BACKGROUND_COLOR_KEY = "banbu-custom-background-color-v1";
const CUSTOM_BACKGROUND_IMAGE_KEY = "banbu-custom-background-image-v1";
const BOARD_THEME_KEY = "banbu-board-theme-v1";
const STONE_THEME_KEY = "banbu-stone-theme-v1";
const THINK_SHEET_ON_START_KEY = "banbu-think-sheet-on-start-v1";
const THINK_DIRECT_MOVE_KEY = "banbu-think-direct-move-v1";
const COACH_MARKS_KEY = "banbu-coach-marks-v1";
type CoachMarkRecord = { dismissed: CoachMarkId[]; snoozedUntil: Partial<Record<CoachMarkId, number>> };
const loadCoachMarkRecord = (): CoachMarkRecord => {
  try {
    const value = JSON.parse(localStorage.getItem(COACH_MARKS_KEY) || "null") as Partial<CoachMarkRecord> | null;
    return { dismissed: Array.isArray(value?.dismissed) ? value.dismissed : [], snoozedUntil: value?.snoozedUntil || {} };
  } catch { return { dismissed: [], snoozedUntil: {} }; }
};
const saveCoachMarkRecord = (value: CoachMarkRecord) => {
  try { localStorage.setItem(COACH_MARKS_KEY, JSON.stringify(value)); } catch { /* optional convenience state */ }
};
const isThemePreference = (value: unknown): value is ThemePreference => value === "system" || value === "light" || value === "dark" || value === "eye" || value === "mono" || value === "rain" || value === "bamboo" || value === "snow" || value === "porcelain" || value === "plum" || value === "jiangnan" || value === "firefly" || value === "rice" || value === "pixel" || value === "cyber" || value === "custom";
const isBoardTheme = (value: unknown): value is BoardTheme => value === "wood" || value === "jade" || value === "notebook" || value === "emerald" || value === "porcelain" || value === "whitejade" || value === "walnut" || value === "frosted" || value === "circuit" || value === "minimal";
const isStoneTheme = (value: unknown): value is StoneTheme => value === "classic" || value === "jade" || value === "yun" || value === "ink" || value === "mono" || value === "notebook" || value === "porcelain" || value === "snow" || value === "terminal" || value === "gold-diamond" || value === "gold" || value === "diamond";
const loadThemePreference = (): ThemePreference => {
  try {
    const value = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (value === "leaves") return "snow";
    return isThemePreference(value) ? value : "system";
  } catch { return "system"; }
};
const loadBoardTheme = (): BoardTheme => {
  try { const value = localStorage.getItem(BOARD_THEME_KEY); return isBoardTheme(value) ? value : "wood"; } catch { return "wood"; }
};
const loadStoneTheme = (): StoneTheme => {
  try { const value = localStorage.getItem(STONE_THEME_KEY); return isStoneTheme(value) ? value : "classic"; } catch { return "classic"; }
};
const loadCustomBackgroundColor = () => {
  try { const value = localStorage.getItem(CUSTOM_BACKGROUND_COLOR_KEY) || ""; return /^#[0-9a-f]{6}$/i.test(value) ? value : "#e8e4dc"; } catch { return "#e8e4dc"; }
};
const loadCustomBackgroundImage = () => {
  try { const value = localStorage.getItem(CUSTOM_BACKGROUND_IMAGE_KEY) || ""; return value.startsWith("data:image/") ? value : ""; } catch { return ""; }
};
const loadThinkSheetOnStart = () => {
  try { return localStorage.getItem(THINK_SHEET_ON_START_KEY) !== "false"; } catch { return true; }
};
const loadThinkDirectMove = () => {
  try { return localStorage.getItem(THINK_DIRECT_MOVE_KEY) === "true"; } catch { return false; }
};
const loadDisplaySettings = () => {
  try {
    const value = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY) || "null") as Partial<{ showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean }> | null;
    return { showNumbers: value?.showNumbers !== false, showCoordinates: value?.showCoordinates !== false, showForbidden: value?.showForbidden !== false };
  } catch {
    return { showNumbers: true, showCoordinates: true, showForbidden: true };
  }
};
const systemTheme = (): ResolvedTheme => {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
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
const OPENING_RULE_OPTIONS: Array<[OpeningRule, string, string]> = [
  ["free", "自由开局", "从天元开始正常轮流落子"],
  ["five-two", "五手两打", "黑方第 5 手提供两个候选，由白方选择"],
  ["five-n", "五手多打", "黑方第 5 手提供 3–10 个不同棋形候选"],
  ["taraguchi-10", "塔十（塔拉山口-10）", "第 4 手后可进入十打流程"],
  ["tarannikov", "塔拉（五次交换）", "前五手提供交换选择，随后进入正常对局"],
];
const posSourceFormats = new Set<RecordSourceFormat>(["pos", "txt"]);
const binarySourceFormats = new Set<RecordSourceFormat>(["lib", "dp", "db"]);
const MAX_FULL_LIB_TO_SGF_SOURCE_BYTES = 64 * 1024 * 1024;
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

const Board = memo(function Board({ document, currentId, currentBookmarked = false, showNumbers, showCoordinates, largeBoard, rotation, mirrored, initialDepth = 0, disabled = false, forbiddenMarkers = [], winningLines = [], openingCandidates = [], openingStage, thinkingMove, thinking = false, motion, feedback, result, boardTheme = "wood", stoneTheme = "classic", gestureZoomEnabled = false, gestureSwipeEnabled = false, onPlay, onVariation, onMark, onGestureStep }: {
  document: GameDocument; currentId: string; showNumbers: boolean; showCoordinates: boolean; largeBoard: boolean;
  currentBookmarked?: boolean;
  rotation: BoardRotation; mirrored: boolean;
  initialDepth?: number; disabled?: boolean;
  boardTheme?: BoardTheme; stoneTheme?: StoneTheme;
  forbiddenMarkers?: Array<Position & { reason: string }>;
  winningLines?: Position[][];
  openingCandidates?: Position[];
  openingStage?: OpeningStage;
  thinkingMove?: Position | null;
  thinking?: boolean;
  gestureZoomEnabled?: boolean; gestureSwipeEnabled?: boolean;
  motion?: BoardMotionState;
  feedback?: BoardFeedbackState | null;
  result?: BoardResultState | null;
  onPlay: (position: Position) => void; onVariation?: (nodeId: string) => void; onMark: (position: Position) => void;
  onGestureStep?: (direction: -1 | 1) => void;
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
  const currentPoint = current.move || current.anchor;
  const currentPointKey = currentPoint ? `${currentPoint.row},${currentPoint.col}` : "";
  const winningStoneKeys = useMemo(() => new Set(winningLines.flat().map((point) => `${point.row},${point.col}`)), [winningLines]);
  const forbiddenByPoint = useMemo(() => new Map(forbiddenMarkers.map((point) => [`${point.row},${point.col}`, point.reason])), [forbiddenMarkers]);
  const displayMarks = useMemo(() => symmetricMarksForDisplay(current.marks, board, boardSize), [current.marks, board, boardSize]);
  const displayMarkKeys = useMemo(() => new Set(displayMarks.map((mark) => `${mark.row},${mark.col}`)), [displayMarks]);
  const nativeDisplayMarks = useMemo(() => displayMarks.filter((mark) => mark.renLibNativeLabel), [displayMarks]);
  const userDisplayMarks = useMemo(() => displayMarks.filter((mark) => !mark.renLibNativeLabel), [displayMarks]);
  const currentHasVisualMark = Boolean(
    currentPoint && (
      displayMarks.some((mark) => `${mark.row},${mark.col}` === currentPointKey)
      || current.boardText
      || current.renLibMark
    ),
  );
  // RenLib/DP shows the children of the current position directly on the
  // board as small variation points. Keep this separate from user marks: a
  // branch point is a stored move, while a mark is an annotation. Do not fall
  // back to the parent when the current node is a leaf. The parent's sibling
  // points are alternatives to the move just played, not legal continuations
  // of the current position; rendering them here made the remaining native
  // "A" points jump back to the same move level.
  const variationNodes = useMemo(() => {
    const pivot = current;
    const index = compactIndexOf(document);
    const pivotIndex = index && pivot ? compactNodeIndex(document, pivot.id) : undefined;
    // When the document is a projected document (viewDocument with overlay baked in),
    // use the document's children directly instead of compactChildWindow, which
    // doesn't see draft-added children.
    const isProjected = isProjectedDocument(document);
    const ids = isProjected
      ? (pivot?.children || []).slice(0, 513)
      : index && pivotIndex !== undefined
        ? compactChildWindow(index, pivotIndex, 0, 513)
        : (pivot?.children || []).slice(0, 513);
    return ids.filter((id) => id !== current.id).slice(0, 512).map((id) => document.nodes[id])
      .filter((node): node is NonNullable<typeof node> => Boolean(node?.move || node?.anchor));
  }, [current, document]);
  // The transparent interaction circles are rendered above the visual labels.
  // Resolve their coordinates back to the exact projected node before handing
  // the click to the generic move handler. This is important for DP/LIB views:
  // several visible siblings can share the same board interaction surface,
  // while only the node ID carries the branch the user actually selected.
  const variationNodeByPoint = useMemo(() => {
    const result = new Map<string, RecordNode>();
    variationNodes.forEach((node) => {
      const point = node.move || node.anchor;
      if (point && !result.has(`${point.row},${point.col}`)) result.set(`${point.row},${point.col}`, node);
    });
    return result;
  }, [variationNodes]);
  const boardTextNodes = useMemo(() => {
    const seen = new Set<string>();
    return variationNodes.filter((node) => {
      const point = node.anchor;
      if (node.move || !point || !node.boardText || board[point.row][point.col] || displayMarkKeys.has(`${point.row},${point.col}`)) return false;
      const key = [point.row, point.col, node.boardText].join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
      }).slice(0, 128);
  }, [board, displayMarkKeys, variationNodes]);
  const isNativeRenLib = isRenLibWebView(document);
  const longPressTimer = useRef<number | null>(null);
  const suppressedClickPoint = useRef<Position | null>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const gestureStartDistance = useRef<number | null>(null);
  const gestureStartCenter = useRef<{ x: number; y: number } | null>(null);
  const gestureStartScale = useRef(1);
  const gestureSwipeHandled = useRef(false);
  const touchBlockUntil = useRef(0);
  const [boardScale, setBoardScale] = useState(1);
  const margin = 34, gap = 504 / Math.max(1, boardSize - 1), end = margin + gap * (boardSize - 1);
  const visualPoint = useCallback((point: Position) => transformBoardPosition(point, boardSize, rotation, mirrored), [boardSize, mirrored, rotation]);
  const visualXY = useCallback((point: Position) => {
    const displayed = visualPoint(point);
    return { x: margin + displayed.col * gap, y: margin + displayed.row * gap };
  }, [gap, margin, visualPoint]);
  const starPoints = boardSize === 15 ? [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]] : boardSize === 19 ? [[3, 3], [3, 15], [9, 9], [15, 3], [15, 15]] : [[Math.floor(boardSize / 2), Math.floor(boardSize / 2)]];
  const clampScale = useCallback((value: number) => Math.min(2.35, Math.max(1, value)), []);
  const resetScale = useCallback(() => {
    touchPoints.current.clear();
    gestureStartDistance.current = null;
    gestureStartCenter.current = null;
    gestureStartScale.current = 1;
    gestureSwipeHandled.current = false;
    touchBlockUntil.current = 0;
    setBoardScale(1);
  }, []);
  const applyGestureTouch = useCallback((event: ReactPointerEvent<SVGElement | HTMLDivElement>, kind: "down" | "move" | "up" | "cancel") => {
    if (event.pointerType !== "touch" || (!gestureZoomEnabled && !gestureSwipeEnabled)) return;
    const point = { x: event.clientX, y: event.clientY };
    if (kind === "down") {
      touchPoints.current.set(event.pointerId, point);
    } else if (kind === "move") {
      if (!touchPoints.current.has(event.pointerId)) return;
      touchPoints.current.set(event.pointerId, point);
    } else {
      touchPoints.current.delete(event.pointerId);
      if (touchPoints.current.size === 0) {
        gestureStartDistance.current = null;
        gestureStartCenter.current = null;
        gestureStartScale.current = 1;
        gestureSwipeHandled.current = false;
        touchBlockUntil.current = Math.max(touchBlockUntil.current, Date.now() + 180);
        return;
      }
    }
    if (touchPoints.current.size < 2) {
      gestureStartDistance.current = null;
      gestureStartCenter.current = null;
      gestureStartScale.current = 1;
      gestureSwipeHandled.current = false;
      return;
    }
    const [first, second] = Array.from(touchPoints.current.values());
    const distance = Math.hypot(first.x - second.x, first.y - second.y) || 1;
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    if (gestureStartDistance.current === null || kind === "down") {
      gestureStartDistance.current = distance;
      gestureStartCenter.current = center;
      gestureStartScale.current = boardScale;
      gestureSwipeHandled.current = false;
      return;
    }
    if (gestureZoomEnabled) {
      const nextScale = clampScale(gestureStartScale.current * (distance / gestureStartDistance.current));
      if (Math.abs(nextScale - boardScale) > 0.01) setBoardScale(nextScale);
    }
    const startCenter = gestureStartCenter.current || center;
    const deltaX = center.x - startCenter.x;
    const deltaY = center.y - startCenter.y;
    if (gestureSwipeEnabled && !gestureSwipeHandled.current && onGestureStep && Math.abs(deltaX) > 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35 && Math.abs(distance - gestureStartDistance.current) < 26) {
      gestureSwipeHandled.current = true;
      touchBlockUntil.current = Date.now() + 260;
      onGestureStep(deltaX < 0 ? 1 : -1);
    }
  }, [boardScale, clampScale, gestureSwipeEnabled, gestureZoomEnabled, onGestureStep]);
  const isTouchGestureBlocked = () => touchBlockUntil.current > Date.now() || touchPoints.current.size > 1 || gestureSwipeHandled.current;
  useEffect(() => {
    resetScale();
  }, [document.id, resetScale]);
  return (
    <div className={`board-scroller board-${boardTheme} stones-${stoneTheme} ${largeBoard ? "is-large" : ""}`}>
      {boardScale > 1.01 && <button type="button" className="board-zoom-reset" onClick={resetScale} aria-label="重置棋盘缩放" title="重置棋盘缩放"><RotateCw size={14}/><span>{Math.round(boardScale * 100)}%</span></button>}
       <svg className="renju-board" viewBox="0 0 572 572" role="grid" aria-label={`${boardSize}路五子棋棋盘`} style={{ width: `${Math.round(boardScale * 100)}%`, minWidth: `${Math.round(boardScale * 100)}%`, maxWidth: "none" }} onPointerDownCapture={(event) => { applyGestureTouch(event, "down"); }} onPointerMoveCapture={(event) => { applyGestureTouch(event, "move"); }} onPointerUpCapture={(event) => { applyGestureTouch(event, "up"); }} onPointerCancelCapture={(event) => { applyGestureTouch(event, "cancel"); }}>
        <defs>
          <radialGradient id="blackStone" cx="30%" cy="24%"><stop offset="0" stopColor="#5b5a55"/><stop offset=".42" stopColor="#242420"/><stop offset="1" stopColor="#090a09"/></radialGradient>
          <radialGradient id="whiteStone" cx="30%" cy="24%"><stop offset="0" stopColor="#fffef8"/><stop offset=".6" stopColor="#e8e2d5"/><stop offset="1" stopColor="#aaa397"/></radialGradient>
          <radialGradient id="blackStone-jade" cx="30%" cy="24%"><stop offset="0" stopColor="#6ba98a"/><stop offset=".45" stopColor="#1f5943"/><stop offset="1" stopColor="#0e2b22"/></radialGradient>
          <radialGradient id="whiteStone-jade" cx="30%" cy="24%"><stop offset="0" stopColor="#f8fffb"/><stop offset=".55" stopColor="#b8dfcd"/><stop offset="1" stopColor="#6fa88d"/></radialGradient>
          <radialGradient id="blackStone-yun" cx="30%" cy="24%"><stop offset="0" stopColor="#6b6960"/><stop offset=".4" stopColor="#292a27"/><stop offset="1" stopColor="#101311"/></radialGradient>
          <radialGradient id="whiteStone-yun" cx="30%" cy="24%"><stop offset="0" stopColor="#fffdf2"/><stop offset=".55" stopColor="#eee5cf"/><stop offset="1" stopColor="#b5aa91"/></radialGradient>
          <radialGradient id="blackStone-ink" cx="30%" cy="24%"><stop offset="0" stopColor="#5c7590"/><stop offset=".45" stopColor="#1e3448"/><stop offset="1" stopColor="#0d1721"/></radialGradient>
          <radialGradient id="whiteStone-ink" cx="30%" cy="24%"><stop offset="0" stopColor="#fffdf5"/><stop offset=".58" stopColor="#e9edf0"/><stop offset="1" stopColor="#9ca9b1"/></radialGradient>
          <radialGradient id="blackStone-porcelain" cx="28%" cy="22%"><stop offset="0" stopColor="#354e73"/><stop offset=".5" stopColor="#132b52"/><stop offset="1" stopColor="#07152e"/></radialGradient>
          <radialGradient id="whiteStone-porcelain" cx="28%" cy="22%"><stop offset="0" stopColor="#fff"/><stop offset=".6" stopColor="#f0f5f7"/><stop offset="1" stopColor="#b4c9d6"/></radialGradient>
          <radialGradient id="blackStone-snow" cx="28%" cy="22%"><stop offset="0" stopColor="#c4e7f4"/><stop offset=".45" stopColor="#477f9b"/><stop offset="1" stopColor="#183b55"/></radialGradient>
          <radialGradient id="whiteStone-snow" cx="28%" cy="22%"><stop offset="0" stopColor="#fff"/><stop offset=".55" stopColor="#e4f6ff"/><stop offset="1" stopColor="#9ac4d8"/></radialGradient>
           <radialGradient id="blackStone-gold" cx="28%" cy="22%"><stop offset="0" stopColor="#fff0a8"/><stop offset=".42" stopColor="#d59a22"/><stop offset="1" stopColor="#6c3d08"/></radialGradient>
           <radialGradient id="whiteStone-gold" cx="28%" cy="22%"><stop offset="0" stopColor="#fff9d7"/><stop offset=".5" stopColor="#f1c95d"/><stop offset="1" stopColor="#a96813"/></radialGradient>
           <radialGradient id="blackStone-diamond" cx="27%" cy="20%"><stop offset="0" stopColor="#dff8ff"/><stop offset=".18" stopColor="#7ec9e4"/><stop offset=".48" stopColor="#1d5978"/><stop offset=".76" stopColor="#0b243b"/><stop offset="1" stopColor="#020914"/></radialGradient>
           <radialGradient id="whiteStone-diamond" cx="27%" cy="20%"><stop offset="0" stopColor="#ffffff"/><stop offset=".2" stopColor="#f2ffff"/><stop offset=".5" stopColor="#bcebf5"/><stop offset=".78" stopColor="#6ba8c2"/><stop offset="1" stopColor="#2e617d"/></radialGradient>
           <linearGradient id="goldFacet" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff8bd" stopOpacity=".9"/><stop offset=".3" stopColor="#f8d56b" stopOpacity=".4"/><stop offset=".62" stopColor="#9d5c09" stopOpacity=".48"/><stop offset="1" stopColor="#fff0a0" stopOpacity=".15"/></linearGradient>
           <linearGradient id="diamondFacet" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff" stopOpacity=".8"/><stop offset=".3" stopColor="#8fe7ff" stopOpacity=".28"/><stop offset=".62" stopColor="#194c72" stopOpacity=".5"/><stop offset="1" stopColor="#dffaff" stopOpacity=".2"/></linearGradient>
           <linearGradient id="jewelGlint" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff" stopOpacity=".95"/><stop offset=".35" stopColor="#ffffff" stopOpacity=".22"/><stop offset="1" stopColor="#ffffff" stopOpacity="0"/></linearGradient>
          <linearGradient id="blackStone-mono" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#000"/><stop offset="1" stopColor="#000"/></linearGradient>
          <linearGradient id="whiteStone-mono" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#fff"/></linearGradient>
          <pattern id="notebookPaper" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" fill="#faf5e7"/><path d="M0 47.5H48" stroke="#8eb3c9" strokeWidth=".8" opacity=".28"/></pattern>
          <filter id="notebookBrush" x="-25%" y="-25%" width="150%" height="150%"><feTurbulence type="fractalNoise" baseFrequency=".035 .12" numOctaves="2" seed="7" result="inkNoise"/><feDisplacementMap in="SourceGraphic" in2="inkNoise" scale="1.15" xChannelSelector="R" yChannelSelector="G"/></filter>
          <filter id="stoneShadow"><feDropShadow dx="0" dy="3" stdDeviation="2.5" floodOpacity=".38"/></filter>
        </defs>
        <rect x="4" y="4" width="564" height="564" rx="18" className="board-bg" />
        {openingStage?.kind === "place" && openingStage.radius !== null && (() => {
          const center = Math.floor(boardSize / 2), start = center - openingStage.radius, cells = openingStage.radius * 2;
          return <rect x={margin + start * gap - gap / 2} y={margin + start * gap - gap / 2} width={(cells + 1) * gap} height={(cells + 1) * gap} rx="10" className="opening-region" aria-label={`第${openingStage.moveNumber}手允许落子区域`}/>;
        })()}
        {boardTheme === "notebook" && <line x1="57" y1="8" x2="57" y2="564" className="notebook-margin-line" aria-hidden="true"/>}
        {Array.from({ length: boardSize }, (_, index) => <g key={index} className="grid-lines"><line x1={margin} y1={margin + index * gap} x2={end} y2={margin + index * gap}/><line x1={margin + index * gap} y1={margin} x2={margin + index * gap} y2={end}/></g>)}
        {starPoints.map(([row, col]) => <circle key={`${row}-${col}`} cx={margin + col * gap} cy={margin + row * gap} r="4.2" className="star"/>)}
        {showCoordinates && Array.from({ length: boardSize }, (_, index) => <g key={`coord-${index}`} className="coordinates"><text x={margin + index * gap} y="20">{String.fromCharCode(65 + index)}</text><text x={margin + index * gap} y="560">{String.fromCharCode(65 + index)}</text><text x="18" y={margin + index * gap + 3}>{boardSize - index}</text><text x="554" y={margin + index * gap + 3}>{boardSize - index}</text></g>)}
         {winningLines.map((line, index) => {
           const start = line[0], endPoint = line[line.length - 1];
           if (!start || !endPoint) return null;
           const startXY = visualXY(start), endXY = visualXY(endPoint);
           return <line key={`winning-line-${index}`} x1={startXY.x} y1={startXY.y} x2={endXY.x} y2={endXY.y} className="winning-line" aria-label="获胜五连"/>;
         })}
         {board.flatMap((row, rowIndex) => row.map((player, colIndex) => {
           if (!player) return null;
           const { x, y } = visualXY({ row: rowIndex, col: colIndex });
          const number = numbers.get(`${rowIndex},${colIndex}`), isLast = current.move?.row === rowIndex && current.move?.col === colIndex;
          const isWinningStone = winningStoneKeys.has(`${rowIndex},${colIndex}`);
           const jewelMaterial = stoneTheme === "gold-diamond" || stoneTheme === "gold" || stoneTheme === "diamond" ? (player === "black" ? "diamond" : "gold") : stoneTheme;
           const stoneGradient = jewelMaterial === "classic" ? (player === "black" ? "blackStone" : "whiteStone") : `${player === "black" ? "blackStone" : "whiteStone"}-${jewelMaterial}`;
          const notebookRotation = ((rowIndex * 7 + colIndex * 11) % 9) - 4;
          const stoneGraphic = stoneTheme === "notebook"
            ? <g className={`notebook-stone ${player}`} transform={`translate(${x} ${y}) rotate(${notebookRotation})`} filter="url(#notebookBrush)">
                {player === "black"
                  ? <><path d="M-14-10C-12-13-10-14-8-12C-1-5 6 3 14 10C16 12 14 15 11 14C3 8-5 1-13-7C-15-8-15-9-14-10Z"/><path d="M11-14C14-15 16-12 14-9C8-2 1 5-8 13C-10 15-14 13-13 10C-5 2 3-6 11-14Z"/><path className="notebook-stone-dry" d="M-11-9C-5-3 3 5 11 10M10-11C4-4-3 4-10 11"/></>
                  : <><path d="M-15-2C-16-4-13-6-11-4L-2 5C3-3 8-12 13-17C15-19 18-17 16-13C11-4 6 7 1 14C0 16-3 16-5 13L-15 2C-16 1-16 0-15-2Z"/><path className="notebook-stone-dry" d="M-12-1C-8 3-4 8-1 11C4 2 9-8 14-15"/></>}
              </g>
             : stoneTheme === "terminal"
               ? <g className={`terminal-stone ${player}`}><circle cx={x} cy={y} r="15.6" className="terminal-stone-disc"/><text x={x} y={y + 4.8} className="terminal-stone-char">{player === "black" ? "X" : "O"}</text></g>
               : (stoneTheme === "gold-diamond" || stoneTheme === "gold" || stoneTheme === "diamond")
                 ? <g className={`jewel-stone ${player}`}>
                     <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className="stone"/>
                     <path d={`M ${x - 12} ${y - 7} L ${x - 2} ${y - 14} L ${x + 7} ${y - 9} L ${x + 2} ${y - 1} L ${x - 7} ${y + 2} Z`} fill={`url(#${player === "black" ? "diamondFacet" : "goldFacet"})`} opacity=".8"/>
                     <path d={`M ${x - 9} ${y + 9} L ${x - 2} ${y + 2} L ${x + 5} ${y + 11} Z M ${x + 2} ${y - 1} L ${x + 12} ${y - 6} L ${x + 8} ${y + 7} Z`} fill={`url(#${player === "black" ? "diamondFacet" : "goldFacet"})`} opacity=".58"/>
                     <path d={`M ${x - 8} ${y - 10} Q ${x - 3} ${y - 14} ${x + 2} ${y - 11} Q ${x - 2} ${y - 7} ${x - 7} ${y - 5} Z`} fill="url(#jewelGlint)"/>
                     <path d={`M ${x - 5} ${y + 12} L ${x + 4} ${y + 5} M ${x + 2} ${y - 1} L ${x - 2} ${y - 14} M ${x + 2} ${y - 1} L ${x + 12} ${y - 6}`} className="jewel-facet-line"/>
                   </g>
               : <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className="stone"/>;
          const motionClass = isLast && motion?.kind === "place" ? "stone-enter" : "";
          return <g key={`stone-${rowIndex}-${colIndex}${isLast && motion?.kind ? `-${motion.version}` : ""}`} filter="url(#stoneShadow)" className={`stone-piece ${isWinningStone ? "winning-stone" : ""} ${motionClass}`}>{stoneGraphic}{isWinningStone && <circle cx={x} cy={y} r="19" className="winning-stone-ring"/>}{showNumbers && <text x={x} y={y + 4.2} className={`move-number ${player}`}>{number}</text>}{isLast && !showNumbers && !currentHasVisualMark && (stoneTheme === "notebook" ? <path d={`M ${x - 7} ${y + 17} Q ${x} ${y + 20} ${x + 8} ${y + 16}`} className="notebook-last-mark"/> : <circle cx={x} cy={y} r="4" className="last-dot"/>)}{isLast && hasNativeAnnotation(current) && <g className="comment-indicator" aria-label="此步有注释"><circle cx={x + 11} cy={y + 11} r="6"/><circle cx={x + 8.5} cy={y + 11} r=".85"/><circle cx={x + 11} cy={y + 11} r=".85"/><circle cx={x + 13.5} cy={y + 11} r=".85"/></g>}{isLast && currentBookmarked && <g className="bookmark-indicator" aria-label="此局面已保存分支书签"><path d={`M ${x - 15} ${y - 15} h 10 v 12 l -5 -3 -5 3 z`}/></g>}</g>;
        }))}
         {variationNodes.map((node, index) => {
           const point = node.move || node.anchor;
           if (!point) return null;
           const { x, y } = visualXY(point);
          const player = node.move?.player || "black";
          const isNativeLabel = isNativeRenLib || Boolean(node.renLibNativeLabel);
           const display = isNativeLabel ? null : renLibDisplayMark(node.boardText);
           const pointKey = `${point.row},${point.col}`;
           const hasDisplayMark = displayMarkKeys.has(pointKey);
           // User annotations own the final visual layer. Do not leave a
           // native branch label underneath them: the branch remains
           // clickable through the transparent hit target below.
           const text = hasDisplayMark
             ? ""
             : isNativeLabel
               ? (isNativeRenLib ? formatRenLibWebLabel(node.boardText, depthOf(document, safeCurrentId) + 1) : node.boardText || "")
               : display?.displayText || "";
           const hasText = Boolean(text);
           const hasUserMark = !isNativeLabel && userDisplayMarks.some((mark) => mark.row === point.row && mark.col === point.col);
           return <g key={`variation-${node.id}`} className={`renlib-variation ${player} ${isNativeLabel ? "renlib-native-variation" : display?.displayKind || "neutral-dot"}`} data-node-id={node.id} aria-label={`变化点 ${coordinateName(point, boardSize)}`}>
             {!hasText && !hasUserMark && !hasDisplayMark && <circle cx={x} cy={y} r="7" className="renlib-variation-dot"/>}
             {node.renLibMark && !hasText && !hasUserMark && !hasDisplayMark && <circle cx={x} cy={y} r="11" className="renlib-explicit-mark"/>}
            {hasText && <text x={x} y={y} className={`renlib-variation-label ${isNativeLabel ? "renlib-native-label" : ""} ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`} style={isNativeLabel ? { fill: "#1d1c19" } : undefined}>{text}</text>}
          </g>;
        })}
         {current.renLibMark && (current.move || current.anchor) && !displayMarkKeys.has(currentPointKey) && (() => {
           const point = current.move || current.anchor!;
           const { x, y } = visualXY(point);
          return <circle cx={x} cy={y} r="11" className="renlib-explicit-mark"/>;
        })()}
         {boardTextNodes.map((node) => {
           const point = node.move || node.anchor;
           if (!point || !node.boardText) return null;
           const { x, y } = visualXY(point);
          return <text key={`board-text-${node.id}`} x={x} y={y + 4} className="renlib-board-text">{node.boardText}</text>;
        })}
         {openingCandidates.map((point, index) => {
           const { x, y } = visualXY(point);
          return <g key={`opening-candidate-${point.row}-${point.col}`} className="opening-candidate" aria-label={`第5手候选 ${index + 1}`}><circle cx={x} cy={y} r="12"/><text x={x} y={y + 4}>{index + 1}</text></g>;
        })}
         {thinkingMove && !board[thinkingMove.row]?.[thinkingMove.col] && (() => {
           const { x, y } = visualXY(thinkingMove);
          return <g className="thinking-point" aria-label={`AI 推荐 ${coordinateName(thinkingMove, boardSize)}`}><circle cx={x} cy={y} r="19"/><circle cx={x} cy={y} r="4"/><text x={x} y={y + 4}>荐</text></g>;
        })()}
         {feedback && (() => {
           const { x, y } = visualXY(feedback.position);
          return <g key={`board-feedback-${feedback.version}`} className={`board-feedback ${feedback.kind}`} aria-label={feedback.kind === "forbidden" ? "禁手位置反馈" : "非法落子反馈"}><circle cx={x} cy={y} r="20"/><line x1={x - 8} y1={y - 8} x2={x + 8} y2={y + 8}/><line x1={x + 8} y1={y - 8} x2={x - 8} y2={y + 8}/></g>;
         })()}
         {/* Annotation visuals are deliberately last. A mark may sit on an
          * occupied point; it must remain visible above stones, native labels,
          * candidate hints and temporary feedback. The hit circles below are
          * interaction-only and do not change this visual priority. */}
         {nativeDisplayMarks.map((mark, index) => {
           if (!mark.label) return null;
           const { x, y } = visualXY(mark);
           const text = mark.label;
           return <text key={`native-mark-${index}`} x={x} y={y} className={`renlib-variation-label renlib-native-label ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`} style={{ fill: "#1d1c19" }}>{text}</text>;
         })}
         {userDisplayMarks.map((mark, index) => {
           const { x, y } = visualXY(mark);
           const style = mark.style || (mark.kind === "label" ? "text" : mark.kind);
           const color = mark.color || "#1d1c19";
           const label = mark.label || "";
           const labelClass = `board-label-text ${Array.from(label).length > 2 ? "compact" : ""}`;
           if (style === "text") return <text key={index} x={x} y={y + 4} className={labelClass} fill={color}>{label || "?"}</text>;
           if (style === "circle") return label ? <g key={index}><circle cx={x} cy={y} r="19" className="board-mark" stroke={color}/><text x={x} y={y + 4} className={labelClass} fill={color}>{label}</text></g> : <circle key={index} cx={x} cy={y} r="5.5" className="board-mark" fill={color} opacity=".82"/>;
           if (style === "triangle") return <g key={index}><path d={`M ${x} ${y - 20} L ${x - 18} ${y + 14} L ${x + 18} ${y + 14} Z`} className="board-mark" stroke={color}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color}>{label}</text>}</g>;
           return <g key={index} className="board-mark" stroke={color}><line x1={x - 14} y1={y - 14} x2={x + 14} y2={y + 14}/><line x1={x + 14} y1={y - 14} x2={x - 14} y2={y + 14}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color} stroke="none">{label}</text>}</g>;
         })}
         {Array.from({ length: boardSize }, (_, row) => Array.from({ length: boardSize }, (_, col) => {
           const point = { row, col };
           const variation = variationNodeByPoint.get(`${row},${col}`);
            const { x, y } = visualXY(point);
             return <circle key={`hit-${row}-${col}`} cx={x} cy={y} r="17" className="board-hit" role="gridcell" aria-disabled={disabled} aria-label={`${coordinateName(point, boardSize)}${board[row][col] ? "已有棋子" : forbiddenByPoint.get(`${row},${col}`) || "空位"}`} onPointerDown={(event) => { if (disabled || isTouchGestureBlocked()) return; longPressTimer.current = window.setTimeout(() => { if (isTouchGestureBlocked()) return; suppressedClickPoint.current = point; onMark(point); }, 520); }} onPointerUp={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerCancel={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onClick={() => { if (disabled || isTouchGestureBlocked()) return; if (suppressedClickPoint.current?.row === row && suppressedClickPoint.current.col === col) { suppressedClickPoint.current = null; return; } suppressedClickPoint.current = null; if (variation && onVariation) onVariation(variation.id); else onPlay(point); }} onContextMenu={(event) => { event.preventDefault(); if (!disabled) onMark(point); }}/>
         }))}
       </svg>
      {thinking && <div className="board-thinking-indicator" role="status" aria-live="polite"><i/><i/><i/><span>AI 思考中</span></div>}
      {result && <div className={`game-result-banner ${result.kind}`} role="status" aria-live="polite"><span>{result.kind === "draw" ? "和" : result.kind === "lost" ? "负" : "胜"}</span><b>{result.label}</b></div>}
    </div>
  );
});

function BottomSheet({ title, children, onClose, className = "" }: { title: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = globalThis.document?.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")) : [];
    const focusFirst = () => (focusable()[0] || closeRef.current || dialog)?.focus();
    const timer = window.setTimeout(focusFirst, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);
  return <div className={`sheet-backdrop ${className}`.trim()} onMouseDown={onCloseRef.current}><section ref={dialogRef} className="bottom-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="sheet-handle"/><div className="sheet-head"><h2>{title}</h2><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>{children}</section></div>;
}

export default function App() {
  // Diagnostic switch for the top-level ErrorBoundary: set
  // globalThis.__banbuForceRenderError = true (e.g. via Playwright addInitScript)
  // to verify the crash card without shipping a debug UI.
  if (import.meta.env.DEV && (globalThis as { __banbuForceRenderError?: boolean }).__banbuForceRenderError) throw new Error("人为注入的渲染异常（ErrorBoundary 验收）");
  const [document, setDocument] = useState<GameDocument>(() => {
    const active = loadActive();
    if (active) return active;
    try {
      const stored = JSON.parse(localStorage.getItem(DEFAULT_DOCUMENT_KEY) || "null");
      if (stored?.id && stored?.rootId && stored?.nodes?.[stored.rootId]) {
        const restored = stored as GameDocument;
        if (restored.metadata?.title === "瑞星定式研究" && Object.keys(restored.nodes).length === 1) {
          const migrated = { ...restored, metadata: { ...restored.metadata, title: "新建棋谱" } };
          localStorage.setItem(DEFAULT_DOCUMENT_KEY, JSON.stringify(migrated));
          return migrated;
        }
        return restored;
      }
    } catch { /* ignore malformed default baseline and recreate it */ }
    const created = createDocument("新建棋谱");
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
  const [aiStrength, setAiStrength] = useState<AiStrength>("高级");
  const [aiTimeLimitMs, setAiTimeLimitMs] = useState<AiTimeControl>(0);
  const [aiHumanElapsedMs, setAiHumanElapsedMs] = useState(0);
  const [aiFreeTimeMs, setAiFreeTimeMs] = useState(2500);
  const [aiFreeDepth, setAiFreeDepth] = useState(64);
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
  const [fontScale, setFontScale] = useState<FontScale>(loadFontScale);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [batchEditMode, setBatchEditMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchReplaceFrom, setBatchReplaceFrom] = useState("");
  const [batchReplaceTo, setBatchReplaceTo] = useState("");
  const [quickDrawerOpen, setQuickDrawerOpen] = useState(false);
  const [thinkSheetOnStart, setThinkSheetOnStart] = useState(loadThinkSheetOnStart);
  const [thinkDirectMove, setThinkDirectMove] = useState(loadThinkDirectMove);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(loadSoundSettings);
  const [motionEnabled, setMotionEnabled] = useState(loadMotionEnabled);
  const [enhancementSettings, setEnhancementSettings] = useState<EnhancementSettings>(loadEnhancementSettings);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => themePreference === "system" ? systemTheme() : themePreference);
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(loadBoardTheme);
  const [stoneTheme, setStoneTheme] = useState<StoneTheme>(loadStoneTheme);
  const [customBackgroundColor, setCustomBackgroundColor] = useState(loadCustomBackgroundColor);
  const [customBackgroundImage, setCustomBackgroundImage] = useState(loadCustomBackgroundImage);
  const [branchPage, setBranchPage] = useState(1);
  const [branchScrollTop, setBranchScrollTop] = useState(0);
  const [bookmarksExpanded, setBookmarksExpanded] = useState(true);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkName, setEditingBookmarkName] = useState("");
  const branchListRef = useRef<HTMLDivElement>(null);
  const [showNumbers, setShowNumbers] = useState(() => loadDisplaySettings().showNumbers);
  const [showCoordinates, setShowCoordinates] = useState(() => loadDisplaySettings().showCoordinates);
  const [showForbidden, setShowForbidden] = useState(() => loadDisplaySettings().showForbidden);
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
  const [recycleBin, setRecycleBin] = useState<RecycleBinEntry[]>(loadRecycleBin);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [imageRecognizing, setImageRecognizing] = useState(false);
  const [placementPlayer, setPlacementPlayer] = useState<"black" | "white">("black");
  const [placementLocked, setPlacementLocked] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [saveDestination, setSaveDestination] = useState<"records" | "puzzles">("records");
  const [saveFolder, setSaveFolder] = useState("未分类");
  const [defaultDirectory, setDefaultDirectory] = useState<DirectoryHandleLike | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [exportFormatMenuOpen, setExportFormatMenuOpen] = useState(false);
  const [libSgfExporting, setLibSgfExporting] = useState(false);
  const [boardShareOptions, setBoardShareOptions] = useState<Pick<BoardShareOptions, "showMoveNumbers" | "showCoordinates" | "showAnnotations" | "showWatermark">>({
    showMoveNumbers: showNumbers,
    showCoordinates,
    showAnnotations: true,
    showWatermark: true,
  });
  const [boardShareGenerating, setBoardShareGenerating] = useState(false);
  const [dynamicNavigationBusy, setDynamicNavigationBusy] = useState(false);
  const [continuationEditMode, setContinuationEditMode] = useState(false);
  const [folderCreationSection, setFolderCreationSection] = useState<LibrarySection>("records");
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<LibraryRenameTarget | null>(null);
  const [renameName, setRenameName] = useState("");
  const [commentExpanded, setCommentExpanded] = useState(false);
  const [toast, setToast] = useState("");
  const [recentImports, setRecentImports] = useState<RecentImportEntry[]>([]);
  const [coachMark, setCoachMark] = useState<CoachMarkId | null>(null);
  const coachMarkTimer = useRef<number | null>(null);
  const [saved, setSaved] = useState(true);
  const [vcfRunning, setVcfRunning] = useState(false);
  const [vcfResult, setVcfResult] = useState<VcfResult | null>(null);
  const [thinkRunning, setThinkRunning] = useState(false);
  const [thinkResult, setThinkResult] = useState<AiMoveResult | null>(null);
  const [thinkVisualState, setThinkVisualState] = useState<ThinkVisualState>("idle");
  const [thinkContextKey, setThinkContextKey] = useState("");
  const [boardMotion, setBoardMotion] = useState<BoardMotionState>({ kind: null, version: 0 });
  const [boardFeedback, setBoardFeedback] = useState<BoardFeedbackState | null>(null);
  const [matchSymmetry, setMatchSymmetry] = useState(true);
  const singleFileInput = useRef<HTMLInputElement>(null);
  const puzzleFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const backupFileInput = useRef<HTMLInputElement>(null);
  const backgroundFileInput = useRef<HTMLInputElement>(null);
  const importProgressId = useRef(0);
  const importProgressTimer = useRef<number | null>(null);
  const nativeSourceFile = useRef<File | null>(null);
  const vcfWorker = useRef<Worker | null>(null);
  const puzzleAiWorker = useRef<Worker | null>(null);
  const thinkWorker = useRef<Worker | null>(null);
  const rapfiThinkWorker = useRef<Worker | null>(null);
  const rapfiGameWorker = useRef<Worker | null>(null);
  const thinkGeneration = useRef(0);
  const boardFeedbackTimer = useRef<number | null>(null);
  const aiOpeningTimer = useRef<number | null>(null);
  const aiOpeningGeneration = useRef(0);
  const aiClockLastAt = useRef<number | null>(null);
  const aiClockExpired = useRef(false);
  const largeSaveVersions = useRef(new Map<string, number>());
  const pagedSession = useRef<LibraryViewSession | null>(null);
  const dynamicViewSession = useRef<DpViewSession | RenLibWebViewSession | null>(null);
  const pagedNavigationVersion = useRef(0);
  const dynamicNavigationVersion = useRef(0);
  const dynamicNavigationPending = useRef(false);
  const pagedNavigate = useRef<(index: number) => void>(() => undefined);
  const initialDocument = useRef(document);
  const persistedDocuments = useRef(new WeakSet<GameDocument>());
  persistedDocuments.current.add(initialDocument.current);
  const recordSession = useRef<{ document: GameDocument; currentId: string }>({ document, currentId });
  const draftHasMetadataRestoredRef = useRef(false);
  const lastPersistedMetaRef = useRef("");
  const requestPagedIndex = (resolveIndex: (session: LibraryViewSession) => Promise<number | null>) => {
    const session = pagedSession.current;
    if (!session) return;
    const version = ++pagedNavigationVersion.current;
    void resolveIndex(session).then((index) => {
      if (version !== pagedNavigationVersion.current || pagedSession.current !== session || index === null) return;
      pagedNavigate.current(index);
    }).catch(() => {
      if (version === pagedNavigationVersion.current && pagedSession.current === session) setToast("大型棋谱页读取失败，请重试");
    });
  };
  const currentPuzzle = puzzleCollections[puzzleCollectionIndex]?.puzzles[puzzleIndex];
  const t = (key: string, params?: { count?: number }) => key === "batchEdit" ? "批量编辑" : key === "batchExit" ? "退出批量编辑" : key === "batchSelected" ? "已选择 " + (params?.count || 0) + " 项" : key === "batchSelectAll" ? "全选当前结果" : key === "batchClear" ? "清空选择" : key === "batchNoSelection" ? "请先选择至少一份普通棋谱" : key === "batchExport" ? "批量导出" : key === "batchReplace" ? "批量替换注释" : key === "batchReplaceConfirm" ? "执行替换" : key;
  useEffect(() => () => {
    if (importProgressTimer.current !== null) window.clearTimeout(importProgressTimer.current);
    if (boardFeedbackTimer.current !== null) window.clearTimeout(boardFeedbackTimer.current);
  }, []);
  useEffect(() => {
    let active = true;
    void loadRecentImports().then((entries) => { if (active) setRecentImports(entries); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const applyTheme = () => {
      const nextTheme: ResolvedTheme = themePreference === "system" ? (media?.matches ? "dark" : "light") : themePreference;
      setResolvedTheme(nextTheme);
      globalThis.document?.documentElement.setAttribute("data-theme", nextTheme);
      if (globalThis.document) globalThis.document.documentElement.style.colorScheme = nextTheme;
    };
    applyTheme();
    try { localStorage.setItem(THEME_PREFERENCE_KEY, themePreference); } catch { /* ignore unavailable storage */ }
    if (!media) return undefined;
    const onSystemThemeChange = () => { if (themePreference === "system") applyTheme(); };
    if (media.addEventListener) media.addEventListener("change", onSystemThemeChange);
    else media.addListener?.(onSystemThemeChange);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", onSystemThemeChange);
      else media.removeListener?.(onSystemThemeChange);
    };
  }, [themePreference]);
  useEffect(() => {
    banbuAudio.setSettings(soundSettings);
    saveSoundSettings(soundSettings);
  }, [soundSettings]);
  useEffect(() => {
    if (globalThis.document) globalThis.document.documentElement.dataset.motion = motionEnabled ? "on" : "off";
    saveMotionEnabled(motionEnabled);
  }, [motionEnabled]);
  useEffect(() => { saveEnhancementSettings(enhancementSettings); }, [enhancementSettings]);
  useEffect(() => { saveFontScale(fontScale); }, [fontScale]);
  useEffect(() => {
    try {
      localStorage.setItem(BOARD_THEME_KEY, boardTheme);
      localStorage.setItem(STONE_THEME_KEY, stoneTheme);
      localStorage.setItem(CUSTOM_BACKGROUND_COLOR_KEY, customBackgroundColor);
      if (customBackgroundImage) localStorage.setItem(CUSTOM_BACKGROUND_IMAGE_KEY, customBackgroundImage);
      else localStorage.removeItem(CUSTOM_BACKGROUND_IMAGE_KEY);
    } catch { /* ignore unavailable or full storage */ }
  }, [boardTheme, stoneTheme, customBackgroundColor, customBackgroundImage]);
  const draftOverlay = useMemo(() => buildDraftOverlay(draft, document), [draft, document]);
  const viewDocument = useMemo(() => {
    if (!hasDraft(draft)) return document;
    const projected = projectedDocument(document, draftOverlay);
    if (draft.metadata) projected.metadata = { ...document.metadata, ...draft.metadata };
    return projected;
  }, [document, draft, draftOverlay]);
  const current = viewDocument.nodes[currentId] || viewDocument.nodes[viewDocument.rootId] || { id: viewDocument.rootId, parentId: null, children: [], move: null, comment: "", marks: [] };
  const commentPreviewClass = hasNativeAnnotation(current) ? "comment-preview" : "comment-preview empty";
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
  const aiLivePosition = Boolean(aiGame && currentId === recordSession.current.currentId);
  const aiHumanTurn = aiGame?.opening.stage.kind === "normal"
    ? aiLivePosition && nextPlayer === aiGame.humanPlayer
    : aiLivePosition && humanCanUseOpeningBoard;
  const aiClockActive = Boolean(aiGame && !aiGame.outcome && !aiThinking && aiHumanTurn && !aiClockExpired.current);
  const currentPositionKey = useMemo(() => positionKey(board, nextPlayer, false), [board, nextPlayer]);
  const triggerBoardMotion = (kind: Exclude<BoardMotionKind, null>) => {
    if (!motionEnabled) return;
    setBoardMotion((state) => ({ kind, version: state.version + 1 }));
  };
  const clearBoardMotion = () => setBoardMotion((state) => ({ kind: null, version: state.version }));
  const showBoardFeedback = (position: Position, kind: BoardFeedbackKind) => {
    if (boardFeedbackTimer.current !== null) window.clearTimeout(boardFeedbackTimer.current);
    setBoardFeedback((state) => ({ position, kind, version: (state?.version || 0) + 1 }));
    boardFeedbackTimer.current = window.setTimeout(() => { setBoardFeedback(null); boardFeedbackTimer.current = null; }, 720);
  };
  useEffect(() => {
    if (!aiClockActive) {
      aiClockLastAt.current = null;
      return;
    }
    aiClockLastAt.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const previous = aiClockLastAt.current ?? now;
      aiClockLastAt.current = now;
      setAiHumanElapsedMs((elapsed) => {
        const nextElapsed = elapsed + Math.max(0, now - previous);
        return aiGame?.timeLimitMs ? Math.min(aiGame.timeLimitMs, nextElapsed) : nextElapsed;
      });
    }, 200);
    return () => {
      window.clearInterval(timer);
      aiClockLastAt.current = null;
    };
  }, [aiClockActive, aiGame?.timeLimitMs]);
  useEffect(() => {
    if (aiGame) return;
    aiClockLastAt.current = null;
    aiClockExpired.current = false;
    setAiHumanElapsedMs(0);
  }, [aiGame]);
  useEffect(() => {
    if (!aiGame || aiGame.timeLimitMs <= 0 || aiGame.outcome || aiClockExpired.current || aiHumanElapsedMs < aiGame.timeLimitMs) return;
    aiClockExpired.current = true;
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
    setAiThinking(false);
    setAiGame((game) => game ? { ...game, outcome: "lost" } : game);
    playSound("error");
    setToast("你的对局时长已用尽，本局结束");
  }, [aiGame, aiHumanElapsedMs]);
  const boardResult = useMemo<BoardResultState | null>(() => {
    if (aiGame?.outcome === "won") return { kind: "won", label: "你已获胜" };
    if (aiGame?.outcome === "lost") return { kind: "lost", label: "本局结束" };
    if (aiGame?.outcome === "draw") return { kind: "draw", label: "本局和棋" };
    if (puzzleOutcome === "won") return { kind: "won", label: "挑战成功" };
    if (puzzleOutcome === "lost") return { kind: "lost", label: "本题结束" };
    if (boardWinningLines.length) return { kind: "complete", label: "五连完成" };
    return null;
  }, [aiGame?.outcome, puzzleOutcome, boardWinningLines.length]);
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
  const filteredPuzzleCollections = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    return puzzleCollections.flatMap((collection, collectionIndex) => {
      if (!query) return [{ collection, puzzles: collection.puzzles, collectionIndex }];
      const collectionMatches = [collection.title, collection.source, collection.license].some((value) => value.toLowerCase().includes(query));
      const puzzles = collectionMatches ? collection.puzzles : collection.puzzles.filter((puzzle) => [puzzle.title, puzzle.prompt, puzzle.id, puzzle.player === "black" ? "黑先" : "白先"].some((value) => value.toLowerCase().includes(query)));
      return puzzles.length ? [{ collection, puzzles, collectionIndex }] : [];
    });
  }, [puzzleCollections, libraryQuery]);
  const batchSelectedDocuments = useMemo(() => library.filter((item) => batchSelectedIds.includes(item.id)), [library, batchSelectedIds]);
  const toggleBatchSelection = (id: string) => setBatchSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const selectAllBatchResults = () => setBatchSelectedIds(filteredLibrary.map((item) => item.id));
  const clearBatchSelection = () => setBatchSelectedIds([]);
  const closeBatchEdit = () => { setBatchEditMode(false); setBatchSelectedIds([]); setBatchReplaceFrom(""); setBatchReplaceTo(""); setSheet(null); };
  const runBatchReplace = () => {
    const from = batchReplaceFrom;
    if (!from || !batchSelectedDocuments.length) { setToast(!batchSelectedDocuments.length ? "请先选择至少一份普通棋谱" : "请输入要查找的文字"); return; }
    const selected = new Set(batchSelectedIds);
    const now = new Date().toISOString();
    const updated = library.map((item) => {
      if (!selected.has(item.id)) return item;
      let changed = false;
      const nodes = Object.fromEntries(Object.entries(item.nodes).map(([id, node]) => {
        const comment = node.comment.includes(from) ? node.comment.split(from).join(batchReplaceTo) : node.comment;
        const boardText = node.boardText?.includes(from) ? node.boardText.split(from).join(batchReplaceTo) : node.boardText;
        changed ||= comment !== node.comment || boardText !== node.boardText;
        return [id, comment === node.comment && boardText === node.boardText ? node : { ...node, comment, boardText }];
      }));
      return changed ? { ...item, nodes, updatedAt: now } : item;
    });
    const changedDocuments = updated.filter((item) => selected.has(item.id) && item.updatedAt === now);
    let nextLibrary = library;
    changedDocuments.forEach((item) => { nextLibrary = saveToLibrary(item); });
    setLibrary(nextLibrary);
    setToast("已更新 " + changedDocuments.length + " 份棋谱");
    setSheet(null);
  };
  const runBatchExport = () => {
    if (!batchSelectedDocuments.length) { setToast("请先选择至少一份普通棋谱"); return; }
    const items = batchSelectedDocuments.slice(0, 20);
    items.forEach((item, index) => downloadFile(exportSgf(item), `${safeName(item.metadata.title)}-${index + 1}.sgf`, "application/x-go-sgf;charset=utf-8"));
    setToast("已开始导出 " + items.length + " 份棋谱");
    if (batchSelectedDocuments.length > items.length) setToast(`已导出前 ${items.length} 份，避免一次性占用过多内存`);
  };
  const wrongPuzzleEntries = useMemo<PuzzleReviewEntry[]>(() => deriveWrongPuzzleEntries(puzzleCollections, puzzleProgress), [puzzleCollections, puzzleProgress]);
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
  useEffect(() => {
    if (!toast) return;
    const persistent = /失败|错误|异常|无法|不能|不足|拒绝|警告|注意|禁手|非法/.test(toast);
    const timer = window.setTimeout(() => setToast(""), persistent ? 5200 : 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (coachMarkTimer.current !== null) window.clearTimeout(coachMarkTimer.current);
    setCoachMark(null);
    if (!enhancementSettings.coachMarks || sheet || pendingSwitch || importProgress) return;
    const id: CoachMarkId = tab === "record" ? "record-tools" : tab === "library" ? "library-search" : "settings-groups";
    const record = loadCoachMarkRecord();
    if (record.dismissed.includes(id) || (record.snoozedUntil[id] || 0) > Date.now()) return;
    coachMarkTimer.current = window.setTimeout(() => setCoachMark(id), 700);
    return () => { if (coachMarkTimer.current !== null) window.clearTimeout(coachMarkTimer.current); };
  }, [tab, sheet, pendingSwitch, importProgress, enhancementSettings.coachMarks]);
  const handleCoachMarkAction = (action: CoachMarkAction) => {
    if (!coachMark) return;
    const record = loadCoachMarkRecord();
    if (action === "later") record.snoozedUntil[coachMark] = Date.now() + 4 * 60 * 60 * 1000;
    else if (!record.dismissed.includes(coachMark)) record.dismissed = [...record.dismissed, coachMark];
    saveCoachMarkRecord(record);
    setCoachMark(null);
  };
  useEffect(() => { savePuzzleProgress(puzzleProgress); }, [puzzleProgress]);
  useEffect(() => { localStorage.setItem(LIBRARY_FOLDERS_KEY, JSON.stringify(libraryFolders)); }, [libraryFolders]);
  useEffect(() => { localStorage.setItem(BRANCH_BOOKMARKS_KEY, JSON.stringify(branchBookmarks)); }, [branchBookmarks]);
  useEffect(() => { localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify({ showNumbers, showCoordinates, showForbidden })); }, [showNumbers, showCoordinates, showForbidden]);
  useEffect(() => {
    try { localStorage.setItem(THINK_SHEET_ON_START_KEY, String(thinkSheetOnStart)); } catch { /* ignore unavailable storage */ }
  }, [thinkSheetOnStart]);
  useEffect(() => {
    try { localStorage.setItem(THINK_DIRECT_MOVE_KEY, String(thinkDirectMove)); } catch { /* ignore unavailable storage */ }
  }, [thinkDirectMove]);
  useEffect(() => {
    if (sheet === "export") setBoardShareOptions((value) => ({ ...value, showMoveNumbers: showNumbers, showCoordinates }));
  }, [sheet, showNumbers, showCoordinates]);
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
    setThinkContextKey("");
    setThinkVisualState((state) => state === "thinking" || state === "complete" || state === "unavailable" ? "cancelled" : state);
  }, [currentPositionKey]);
  useEffect(() => () => { vcfWorker.current?.terminate(); puzzleAiWorker.current?.terminate(); thinkWorker.current?.terminate(); rapfiThinkWorker.current?.terminate(); rapfiGameWorker.current?.terminate(); pagedSession.current?.close(); dynamicViewSession.current?.close(); void banbuAudio.close(); }, []);
  const playSound = (cue: SoundCue) => { void banbuAudio.play(cue); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && current.parentId) {
        clearBoardMotion();
        const dynamicSession = dynamicViewSession.current;
        if (dynamicSession && isDynamicDatabaseView(document)) { navigateDynamic(dynamicSession, () => dynamicSession.back()); return; }
        if (pagedSession.current) requestPagedIndex((session) => session.parentIndex(currentId));
        else setCurrentId(current.parentId);
      }
      if (event.key === "ArrowRight") {
        clearBoardMotion();
        const dynamicSession = dynamicViewSession.current;
        if (dynamicSession && isDynamicDatabaseView(document)) {
          const next = current.preferredChildId ? viewDocument.nodes[current.preferredChildId] : current.children.length ? viewDocument.nodes[current.children[0]] : undefined;
          if (next?.move) { const move = next.move; navigateDynamic(dynamicSession, () => dynamicSession.move(move)); }
          return;
        }
        if (pagedSession.current) { requestPagedIndex((session) => session.preferredIndex(currentId)); }
        else { const next = preferredNext(viewDocument, currentId); if (next) setCurrentId(next); }
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [document, currentId, current.parentId, viewDocument]);

  const requestStrongAiMove = (afterDocument: GameDocument, afterId: string, aiPlayer: Player, onMove: (move: Position) => void, onNoMove: () => void, strength: AiStrength = aiStrength) => {
    const board = boardAt(afterDocument, afterId);
    const moves = pathToNode(afterDocument, afterId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
    const searchConfig = strength === "自由" ? { timeMs: aiFreeTimeMs, maxDepth: aiFreeDepth } : AI_STRENGTH_PROFILES[strength];
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
    worker.postMessage({ type: "analyze", engine: "fallback", size: afterDocument.metadata.boardSize || 15, moves, player: aiPlayer, rule: afterDocument.metadata.rule, timeMs: searchConfig.timeMs, maxDepth: searchConfig.maxDepth });
  };

  const startAiReply = (afterDocument: GameDocument, afterId: string, puzzle: Puzzle) => {
    setAiThinking(true);
    requestStrongAiMove(afterDocument, afterId, otherPlayer(puzzle.player), (move) => {
      setAiThinking(false);
      const reply = addMoveAs(afterDocument, afterId, move, otherPlayer(puzzle.player));
      setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place"); playSound(otherPlayer(puzzle.player) === "black" ? "move-black" : "move-white");
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
      setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place"); playSound(aiPlayer === "black" ? "move-black" : "move-white");
      recordSession.current = { document: reply.document, currentId: reply.nodeId };
      const replyBoard = boardAt(reply.document, reply.nodeId);
      if (winnerAt(replyBoard, actualMove, afterDocument.metadata.rule)) {
        setAiGame((game) => game ? { ...game, outcome: "lost" } : game);
        playSound("error"); setToast("AI 已连成五子，本局结束");
      } else if (replyBoard.every((row) => row.every(Boolean))) {
        setAiGame((game) => game ? { ...game, outcome: "draw" } : game);
        setToast("棋盘已满，本局和棋");
      }
    }, () => { setAiThinking(false); setAiGame((game) => game ? { ...game, outcome: "draw" } : game); setToast("AI 没有找到合法落子，本局和棋"); }, aiGame?.strength || aiStrength);
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
        setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place"); playSound("move-black"); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
        setToast(`AI 选择了第5手候选 ${coordinateName(selected)}`);
        scheduleAiOpening(nextGame, reply.document, reply.nodeId);
        return;
      }
      const position = suggestOpeningPlacement(boardAt(afterDocument, afterId), stage);
      if (!position) { setToast("当前开局阶段没有合法落子"); return; }
      const reply = addMoveAs(afterDocument, afterId, position, stage.player);
      const opening = completeOpeningPlacement(game.opening);
      const nextGame = gameWithOpening(game, opening);
      setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place"); playSound(stage.player === "black" ? "move-black" : "move-white"); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
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
    setContinuationEditMode(false);
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
      setDocument(recordSession.current.document); setCurrentId(recordSession.current.currentId); setMode("record"); setDockPanel("moves"); setPuzzleOutcome(null); setAiGame(null); setContinuationEditMode(false);
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
    aiClockLastAt.current = null; aiClockExpired.current = false; setAiHumanElapsedMs(0);
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
    dynamicNavigationVersion.current += 1;
    dynamicNavigationPending.current = false;
    setDynamicNavigationBusy(false);
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
  const exportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    recordAction("导出一键备份");
    try {
      const snapshot = await createBackupSnapshot("1.1.4");
      const stamp = snapshot.exportedAt.replace(/[:.]/g, "-").replace("Z", "");
      await exportTextFile(serializeBackup(snapshot), `半步五子棋备份-${stamp}.json`, "application/json;charset=utf-8", "应用备份已导出");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "备份导出失败，请重试");
    } finally {
      setBackupBusy(false);
    }
  };
  const handleBackupFile = async (file?: File) => {
    if (!file || backupBusy) return;
    setBackupBusy(true);
    recordAction(`恢复备份：${file.name}`);
    try {
      const parsed = parseBackup(await file.text());
      await restoreBackup(parsed);
      setSheet(null);
      setToast("备份已恢复，页面即将重新加载");
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "备份恢复失败，原有数据未改变");
    } finally {
      setBackupBusy(false);
    }
  };
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
    recordAction(`保存棋谱：${viewDocument.metadata.title || "未命名"}（${saveDestination === "puzzles" ? "题库" : "棋谱"}）`);
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
  // Navigate an already-rendered variation by its node ID. A DP/LIB view is
  // only a projection, so deriving the pivot again from a board coordinate can
  // select the wrong sibling after landing on a leaf (the native "A" labels
  // exposed this most reliably). The rendered node's parent is authoritative.
  const navigateVariation = (targetId: string) => {
    if (mode !== "record") return;
    const target = viewDocument.nodes[targetId];
    if (!target || target.id === currentId) return;
    const pivot = target.parentId ? viewDocument.nodes[target.parentId] : visibleVariationPivot(viewDocument, currentId);
    if (!pivot) return;
    clearBoardMotion();
    if (dynamicViewSession.current && isDynamicDatabaseView(document) && target.move) {
      const session = dynamicViewSession.current;
      const pivotDepth = depthOf(viewDocument, pivot.id);
      navigateDynamic(session, () => session.moveFromDepth(pivotDepth, target.move!), () => { setCandidateLabel(null); setSheet(null); });
      return;
    }
    const session = pagedSession.current;
    if (session && isPagedLibraryView(document)) {
      const index = session.indexForId(target.id);
      if (index !== undefined) pagedNavigate.current(index);
      else setToast("这个分支尚未载入，请重新打开分支面板");
      setCandidateLabel(null); setSheet(null);
      return;
    }
    setCurrentId(target.id); setCandidateLabel(null); setSheet(null);
  };
  const play = (position: Position, options: { ignoreAnnotation?: boolean } = {}) => {
    // Occupied points are static board content. Navigation is explicit through
    // the transport controls and variation panel, so an accidental tap on a
    // stone cannot move the cursor to an older position.
    if (board[position.row][position.col]) {
      playSound("warning");
      showBoardFeedback(position, "illegal");
      return;
    }
    if (dynamicNavigationPending.current && dynamicViewSession.current && isDynamicDatabaseView(document)) {
      return;
    }
    if (mode === "record" && aiGame) {
      if (aiThinking || aiGame.outcome) return;
      const openingStage = aiGame.opening.stage;
      if (openingStage.kind !== "normal") {
        if (openingStage.kind === "swap") { setToast("请先在开局提示卡中选择是否交换"); return; }
        if (openingStage.kind === "place") {
          if (openingStage.actor !== "human") { setToast("AI 正在完成开局落子"); return; }
          if (!openingPositionAllowed(board.length, position, openingStage)) { showBoardFeedback(position, "illegal"); setToast(openingStage.radius === 0 ? "第1手必须落在天元" : `第${openingStage.moveNumber}手必须落在中心 ${openingStage.radius! * 2 + 1}×${openingStage.radius! * 2 + 1} 区域`); return; }
          if (openingStage.player === "black" && aiGame.forbiddenEnabled) {
            const reason = forbiddenReason(board, position);
          if (reason) { playSound("warning"); showBoardFeedback(position, "forbidden"); setToast(`此处为黑方${reason}，请选择其他位置`); return; }
          }
          const result = addMoveAs(document, currentId, position, openingStage.player);
          if (!result.created) return;
          const opening = completeOpeningPlacement(aiGame.opening);
          const nextGame = gameWithOpening(aiGame, opening);
          setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place"); playSound(openingStage.player === "black" ? "move-black" : "move-white"); setAiGame(nextGame); recordSession.current = { document: result.document, currentId: result.nodeId };
          setToast(`已完成第 ${openingStage.moveNumber} 手 · ${coordinateName(position)}`);
          scheduleAiOpening(nextGame, result.document, result.nodeId);
          return;
        }
        if (openingStage.kind === "offer-fifths") {
          if (openingStage.actor !== "human") { setToast("AI 正在准备第5手候选"); return; }
          const reason = aiGame.forbiddenEnabled ? forbiddenReason(board, position) : null;
          if (reason) { playSound("warning"); showBoardFeedback(position, "forbidden"); setToast(`候选点 ${coordinateName(position)} 为${reason}`); return; }
          if (!isDistinctFifthCandidate(board, aiGame.opening.candidates, position)) { showBoardFeedback(position, "illegal"); setToast("这个候选与已有候选属于对称同形，请换一个位置"); return; }
          const opening = addFifthCandidate(aiGame.opening, position);
          const nextGame = gameWithOpening(aiGame, opening);
          setAiGame(nextGame); setToast(opening.stage.kind === "choose-fifth" ? "候选已齐，等待白方选择第5手" : `已加入候选 ${opening.candidates.length}/${openingStage.count}`);
          scheduleAiOpening(nextGame, document, currentId);
          return;
        }
        if (openingStage.chooser !== "human") { setToast("AI 正在选择第5手候选"); return; }
        const selected = aiGame.opening.candidates.find((candidate) => candidate.row === position.row && candidate.col === position.col);
        if (!selected) { showBoardFeedback(position, "illegal"); setToast("请点击棋盘上带编号的第5手候选"); return; }
        const result = addMoveAs(document, currentId, selected, "black");
        const opening = completeFifthChoice(aiGame.opening);
        const nextGame = gameWithOpening(aiGame, opening);
        setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place"); playSound("move-black"); setAiGame(nextGame); recordSession.current = { document: result.document, currentId: result.nodeId };
        setToast(`已选择第5手 ${coordinateName(selected)}`);
        scheduleAiOpening(nextGame, result.document, result.nodeId);
        return;
      }
      const turn = nextPlayerAt(document, currentId);
      const historicalAiPosition = currentId !== recordSession.current.currentId;
      if (historicalAiPosition) {
        const existingVariation = findVisibleVariationTarget(document, currentId, position);
        if (existingVariation) {
          setCurrentId(existingVariation.target.id); triggerBoardMotion("branch"); setCandidateLabel(null); setSheet(null);
          setToast("已切换到已有变化");
          return;
        }
        if (aiGame.forbiddenEnabled && turn === "black") {
          const reason = forbiddenReason(board, position);
          if (reason) { playSound("warning"); showBoardFeedback(position, "forbidden"); setToast("此处为黑方" + reason + "，请选择其他位置"); return; }
        }
        const branch = addMoveAs(document, currentId, position, turn);
        if (!branch.created) return;
        setDocument(branch.document); setCurrentId(branch.nodeId); triggerBoardMotion("place"); playSound(turn === "black" ? "move-black" : "move-white");
        recordSession.current = { document: branch.document, currentId: branch.nodeId };
        const branchBoard = boardAt(branch.document, branch.nodeId);
        if (winnerAt(branchBoard, position, branch.document.metadata.rule)) {
          setAiGame((game) => game ? { ...game, outcome: turn === game.humanPlayer ? "won" : "lost" } : game);
          playSound(turn === aiGame.humanPlayer ? "success" : "error"); setToast(turn === aiGame.humanPlayer ? "你已连成五子，本局结束" : "AI 分支已连成五子，本局结束");
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
      if (turn !== aiGame.humanPlayer) { showBoardFeedback(position, "illegal"); setToast("现在轮到 AI 落子"); return; }
      if (aiGame.forbiddenEnabled && aiGame.humanPlayer === "black") {
        const reason = forbiddenReason(board, position);
        if (reason) { playSound("warning"); showBoardFeedback(position, "forbidden"); setToast(`此处为黑方${reason}，请选择其他位置`); return; }
      }
      const result = addMoveAs(document, currentId, position, aiGame.humanPlayer);
      setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place"); playSound(aiGame.humanPlayer === "black" ? "move-black" : "move-white");
      recordSession.current = { document: result.document, currentId: result.nodeId };
      const nextBoard = boardAt(result.document, result.nodeId);
      if (winnerAt(nextBoard, position, result.document.metadata.rule)) { playSound("success"); setAiGame({ ...aiGame, outcome: "won" }); setToast("你已连成五子，本局获胜"); return; }
      if (nextBoard.every((row) => row.every(Boolean))) { setAiGame({ ...aiGame, outcome: "draw" }); setToast("棋盘已满，本局和棋"); return; }
      startAiGameReply(result.document, result.nodeId, aiGame.aiPlayer);
      return;
    }
    if (mode === "record" && !continuationEditMode) {
      // Dynamic database leaves intentionally do not expose their parent's
      // sibling branches as board targets. Those points are alternatives to
      // the previous move; a tap at the current leaf should be a new local
      // continuation instead. Branch browsing remains available in the
      // branch panel.
      const variation = isDynamicDatabaseView(document) && !current.children.length
        ? undefined
       : findVisibleVariationTarget(viewDocument, currentId, position);
      if (variation) { navigateVariation(variation.target.id); return; }
    }
    // Annotation mode only applies to an ordinary empty point. Existing
    // variation nodes always keep node-first navigation semantics, and an
    // occupied stone must never receive a new label as a side effect.
    if (mode === "record" && candidateLabel && !options.ignoreAnnotation) {
      const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
      applyCompactUpdate({ marks: setLabelMark(current.marks, position, candidateLabel, annotationStyle, annotationColor) });
      if (editingDatabaseView) setToast(`已创建编辑副本并放置标注 ${candidateLabel} · ${coordinateName(position)}`);
      else if (!isCompact()) setToast(`已放置标注 ${candidateLabel} · ${coordinateName(position)}`);
      else setToast(`标注 ${candidateLabel} 已加入草稿`);
      setCandidateLabel(null);
      return;
    }
    if (mode === "puzzle") {
      if (!currentPuzzle || aiThinking || puzzleOutcome) return;
      if (board[position.row][position.col]) return;
      const result = addMoveAs(document, currentId, position, currentPuzzle.player);
      setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place"); playSound(currentPuzzle.player === "black" ? "move-black" : "move-white");
      if (winnerAt(boardAt(result.document, result.nodeId), position)) { playSound("success"); setPuzzleOutcome("won"); recordPuzzleAttempt(true); return; }
      startAiReply(result.document, result.nodeId, currentPuzzle);
      return;
    }
    if (mode === "record" && isCompact()) {
      const draftId = `draft-${Date.now().toString(36)}`;
      recordDraft({ type: "add-move", parentId: currentId, node: { id: draftId, parentId: currentId, children: [], move: { ...position, player: activePlacementPlayer }, comment: "", marks: [] } });
      setCurrentId(draftId); triggerBoardMotion("place"); playSound(activePlacementPlayer === "black" ? "move-black" : "move-white");
      setToast("已加入未保存草稿，点击保存后提交");
      return;
    }
    if (showForbidden && viewDocument.metadata.rule === "renju" && (depthOf(viewDocument, currentId) % 2 === 0)) { const reason = forbiddenReason(board, position); if (reason) setToast(`禁手辅助：${coordinateName(position)} 可能是${reason}（仍允许研究落子）`); }
    const result = placementLocked
      ? addMoveAs(viewDocument, currentId, position, activePlacementPlayer)
      : addMove(viewDocument, currentId, position);
    setCurrentId(result.nodeId);
    if (!result.created) { showBoardFeedback(position, "illegal"); return; }
    triggerBoardMotion("place");
    playSound((result.document.nodes[result.nodeId]?.move?.player || activePlacementPlayer) === "black" ? "move-black" : "move-white");
    setContinuationEditMode(false);
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
  const stopThink = () => {
    if (!thinkRunning) return;
    thinkGeneration.current += 1;
    thinkWorker.current?.terminate(); thinkWorker.current = null;
    rapfiThinkWorker.current?.terminate(); rapfiThinkWorker.current = null;
    setThinkRunning(false); setThinkResult(null); setThinkContextKey(""); setThinkVisualState("cancelled");
    setToast("已中断 AI 思考，本次不会自动落子");
  };
  const startThink = () => {
    if (thinkRunning) { stopThink(); return; }
    if (mode !== "record") { setToast("“思考”只用于打谱界面的当前局面分析"); return; }
    if (aiGame) { setToast("人机对局会自动思考，请在普通打谱局面使用此按钮"); return; }
    if ((viewDocument.metadata.boardSize || 15) !== 15) { setToast("AI 思考当前仅支持十五路棋盘"); return; }
    const generation = ++thinkGeneration.current;
    thinkWorker.current?.terminate(); thinkWorker.current = null;
    rapfiThinkWorker.current?.terminate();
    if (sheet === "think") setSheet(null);
    if (thinkDirectMove) setToast("AI 已在后台思考，完成后会直接落子");
    else if (thinkSheetOnStart) setToast("AI 正在思考，完成后会弹出推荐面板");
    else setToast("AI 已在后台思考，完成后会在棋盘标出推荐点");
    setThinkRunning(true); setThinkResult(null); setThinkContextKey(currentPositionKey); setThinkVisualState("thinking");
    const accept = (result: AiMoveResult) => {
      if (generation !== thinkGeneration.current) return;
      thinkWorker.current = null; rapfiThinkWorker.current = null; setThinkRunning(false);
      if (result.move && thinkDirectMove) {
        setThinkResult(null); setThinkVisualState("idle"); setThinkContextKey(""); setCandidateLabel(null); setSheet(null);
        play(result.move, { ignoreAnnotation: true });
        setToast(`AI 已直接落子 ${coordinateName(result.move)}，记得保存修改`);
        return;
      }
      setThinkResult(result); setThinkVisualState(result.move ? "complete" : "unavailable");
      if (thinkSheetOnStart) setSheet("think");
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
        thinkWorker.current = null; fallback.terminate(); setThinkRunning(false); setThinkVisualState("error"); setToast("AI 思考线程异常，请重试");
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
  const navigateDynamic = (session: DpViewSession | RenLibWebViewSession, operation: () => Promise<{ document: GameDocument; currentId: string }>, onOpened?: () => void) => {
    if (dynamicNavigationPending.current) return;
    const version = ++dynamicNavigationVersion.current;
    dynamicNavigationPending.current = true;
    setDynamicNavigationBusy(true);
    void operation().then((opened) => {
      if (version !== dynamicNavigationVersion.current || dynamicViewSession.current !== session) return;
      setDocument(opened.document); setCurrentId(opened.currentId);
      recordSession.current = { document: opened.document, currentId: opened.currentId };
      onOpened?.();
    }).catch(() => {
      if (version === dynamicNavigationVersion.current && dynamicViewSession.current === session) setToast("数据库分支读取失败，请重试");
    }).finally(() => {
      if (version === dynamicNavigationVersion.current) {
        dynamicNavigationPending.current = false;
        setDynamicNavigationBusy(false);
      }
    });
  };
  pagedNavigate.current = (index) => { void navigatePagedWindow(index); };
  const goPrev = () => {
    clearBoardMotion();
    playSound("navigate");
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document)) { navigateDynamic(dynamicSession, () => dynamicSession.back()); return; }
    const session = pagedSession.current;
    if (session) { requestPagedIndex((activeSession) => activeSession.parentIndex(currentId)); return; }
    if (current.parentId) setCurrentId(current.parentId);
  };
  const goNext = () => {
    clearBoardMotion();
    playSound("navigate");
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document)) {
      const next = current.preferredChildId ? viewDocument.nodes[current.preferredChildId] : current.children.length ? viewDocument.nodes[current.children[0]] : undefined;
      if (next?.move) { const move = next.move; navigateDynamic(dynamicSession, () => dynamicSession.move(move)); }
      return;
    }
    const session = pagedSession.current;
    if (session) {
      requestPagedIndex((activeSession) => activeSession.preferredIndex(currentId));
    } else if (isCompact()) {
      const next = overlayPreferredChild(document, draftOverlay, currentId);
      if (next) setCurrentId(next);
    } else {
      const next = preferredNext(viewDocument, currentId);
      if (next) setCurrentId(next);
    }
  };
  const goRoot = () => {
    clearBoardMotion();
    playSound("navigate");
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document)) navigateDynamic(dynamicSession, () => dynamicSession.root());
    else if (pagedSession.current) pagedNavigate.current(0);
    else setCurrentId(document.rootId);
  };
  const goPreferredEnd = () => {
    clearBoardMotion();
    if (dynamicViewSession.current && isDynamicDatabaseView(document)) { setToast("动态数据库按需读取，请使用“下一手”逐步浏览"); return; }
    const session = pagedSession.current;
    if (session) { requestPagedIndex((activeSession) => activeSession.preferredEndIndex(currentId)); return; }
    setCurrentId(lastOnPreferredLine(viewDocument, currentId));
  };
  const chooseChild = (id: string, pivotId = currentId) => {
    clearBoardMotion();
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document)) {
      const node = viewDocument.nodes[id];
      if (node?.move) navigateDynamic(dynamicSession, () => dynamicSession.moveFromDepth(depthOf(viewDocument, pivotId), node.move!), () => setSheet(null));
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
  const selectTreeNode = (id: string, pivotId?: string) => {
    if (id === currentId) { setSheet(null); return; }
    clearBoardMotion();
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document)) {
      if (id === document.rootId) {
        navigateDynamic(dynamicSession, () => dynamicSession.root(), () => setSheet(null));
        return;
      }
      const node = viewDocument.nodes[id];
      if (!node?.move) return;
      if (path.some((entry) => entry.id === id)) {
        navigateDynamic(dynamicSession, () => dynamicSession.toDepth(depthOf(viewDocument, id)), () => setSheet(null));
      } else {
        const pivot = pivotId || node.parentId || document.rootId;
        navigateDynamic(dynamicSession, () => dynamicSession.moveFromDepth(depthOf(viewDocument, pivot), node.move!), () => setSheet(null));
      }
      return;
    }
    const session = pagedSession.current;
    if (session) {
      const index = session.indexForId(id);
      if (index !== undefined) pagedNavigate.current(index);
      setSheet(null);
      return;
    }
    const isPathNode = path.some((entry) => entry.id === id);
    if (!isPathNode && pivotId) { chooseChild(id, pivotId); return; }
    playSound("navigate");
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
    clearBoardMotion();
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
    dynamicNavigationVersion.current += 1;
    dynamicNavigationPending.current = false;
    setDynamicNavigationBusy(false);
    setContinuationEditMode(false);
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
  const rememberRecentImport = async (file: File, kind: RecentImportKind) => {
    try {
      const entry = await saveRecentImport(file, kind);
      setRecentImports((items) => [entry, ...items.filter((item) => !(item.name === entry.name && item.size === entry.size && item.kind === entry.kind))].slice(0, 5));
    } catch {
      // Recent imports are a convenience layer. A storage quota or an older
      // browser must never make the actual import fail.
    }
  };
  const reopenRecentImport = async (entry: RecentImportEntry) => {
    if (!entry.available) { setToast("这个文件超过 16MB，最近列表只保留了文件名，请重新选择原文件"); return; }
    const file = await openRecentImport(entry.id);
    if (!file) { setToast("最近导入文件已被清理，请重新选择原文件"); return; }
    setSheet(null);
    if (entry.kind === "puzzle") await handlePuzzleFile(file);
    else await handleFiles([file]);
  };
  const handleBackgroundImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setToast("请选择图片文件作为背景"); return; }
    if (file.size > 2 * 1024 * 1024) { setToast("背景图片请控制在 2MB 以内，避免占满本机存储"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCustomBackgroundImage(reader.result);
        setThemePreference("custom");
        setToast("自定义背景已应用，仅保存在本机");
      }
    };
    reader.onerror = () => setToast("背景图片读取失败，请重试");
    reader.readAsDataURL(file);
  };
  // Board images can also arrive pasted from a screenshot tool or dropped
  // from Explorer; both paths funnel into the same recognizer.
  const boardImageFromDataTransfer = (transfer: DataTransfer | null): File | undefined =>
    Array.from(transfer?.files || []).find((file) => file.type.startsWith("image/"));
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = boardImageFromDataTransfer(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      withDraftGuard(() => handleBoardImage(file));
    };
    const onDragOver = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const file = boardImageFromDataTransfer(event.dataTransfer);
      if (!file) return;
      event.preventDefault();
      withDraftGuard(() => handleBoardImage(file));
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  });
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
    const timeControlName = AI_TIME_OPTIONS.find((option) => option.value === aiTimeLimitMs)?.title || "不限";
    next.metadata.event = (aiRuleFamily === "renju" ? "连珠" : "标准五子棋") + " · " + openingRuleName(aiOpeningRule, aiOpeningN) + " · " + (aiForbiddenEnabled ? "有禁手" : "无禁手") + " · AI " + aiStrength + " · " + timeControlName + " · 人机对战";
    const opening = createOpeningSession(aiOpeningRule, aiOpeningN, aiHumanPlayer);
    const game: AiGameState = { humanPlayer: aiHumanPlayer, aiPlayer: otherPlayer(aiHumanPlayer), strength: aiStrength, forbiddenEnabled: aiForbiddenEnabled, timeLimitMs: aiTimeLimitMs, outcome: null, opening };
    aiClockLastAt.current = null; aiClockExpired.current = false; setAiHumanElapsedMs(0);
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
    const progressId = beginImportProgress(summary.metadata.title, "正在读取本机保存的棋谱索引");
    try {
      if (summary.storageMode === "compact-index") {
        const handle = await openLibraryHandle(summary.id);
        if (!handle) { setToast("大型棋谱文件不存在，索引已清理"); failImportProgress(progressId, "本机索引不存在，已清理失效记录"); await removeLargeDocument(summary.id); setLargeSummaries((items) => items.filter((item) => item.id !== summary.id)); return; }
        updateImportProgress(progressId, { phase: "indexing", detail: "正在打开分页索引与根局面" });
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
        finishImportProgress(progressId, "大型棋谱已打开");
        return;
      }
      const next = await loadLargeDocument(summary.id);
      if (!next) { setToast("大型棋谱文件不存在，索引已清理"); failImportProgress(progressId, "本机棋谱不存在，已清理失效记录"); await removeLargeDocument(summary.id); setLargeSummaries((items) => items.filter((item) => item.id !== summary.id)); return; }
      performOpenRecord(next, next.rootId, summary.id);
      void loadDraftForDocument(summary.id).then((stored) => {
        if (stored && compactIndexOf(next)) {
          const currentFingerprint = documentFingerprint(next);
          if (stored.baseFingerprint === currentFingerprint) setDraft({ operations: stored.operations, redo: stored.redo });
        }
      });
      finishImportProgress(progressId, "大型棋谱已打开");
    } catch { setToast("大型棋谱读取失败，请检查本机存储"); failImportProgress(progressId, "读取失败，请检查本机存储"); }
  };
  const openLargeRecord = (summary: LargeDocumentSummary) => withDraftGuard(() => { void performOpenLargeRecord(summary); });
  const performDeleteRecord = (item: GameDocument) => {
    const folder = libraryFolders.recordAssignments[item.id] || "未分类";
    setRecycleBin(addToRecycleBin({ id: item.id, kind: "record", item, folder, deletedAt: new Date().toISOString() }));
    if (mode === "record" && document.id === item.id) {
      pagedNavigationVersion.current += 1; pagedSession.current?.close(); pagedSession.current = null;
      const replacement = createDocument("新建棋谱");
      recordSession.current = { document: replacement, currentId: replacement.rootId };
      setDocument(replacement); setCurrentId(replacement.rootId); setDraft(emptyDraft());
    }
    setLibrary(removeFromLibrary(item.id));
    setLibraryFolders((folders) => {
      const assignments = { ...folders.recordAssignments };
      delete assignments[item.id];
      return { ...folders, recordAssignments: assignments };
    });
    setToast(`已移入回收站：${item.metadata.title}`);
  };
  const deleteRecord = (item: GameDocument) => withDraftGuard(() => performDeleteRecord(item));
  const performDeleteLargeRecord = (item: LargeDocumentSummary) => {
    const folder = libraryFolders.recordAssignments[item.id] || "未分类";
    void moveLargeDocumentToTrash(item.id).then((moved) => {
      if (!moved) throw new Error("大型棋谱不存在，未能移入回收站");
      setRecycleBin(addToRecycleBin({ id: item.id, kind: "large-record", item, folder, deletedAt: new Date().toISOString() }));
      if (localStorage.getItem(ACTIVE_LARGE_RECORD_KEY) === item.id) localStorage.removeItem(ACTIVE_LARGE_RECORD_KEY);
      largeSaveVersions.current.set(item.id, (largeSaveVersions.current.get(item.id) || 0) + 1);
      if (mode === "record" && document.id === item.id) {
        pagedNavigationVersion.current += 1; pagedSession.current?.close(); pagedSession.current = null;
        const replacement = createDocument("新建棋谱");
        recordSession.current = { document: replacement, currentId: replacement.rootId };
        setDocument(replacement); setCurrentId(replacement.rootId); setDraft(emptyDraft());
      }
      setLargeSummaries((items) => items.filter((entry) => entry.id !== item.id));
      setLibraryFolders((folders) => {
        const assignments = { ...folders.recordAssignments };
        delete assignments[item.id];
        return { ...folders, recordAssignments: assignments };
      });
      setToast(`已移入回收站：${item.metadata.title}`);
    }).catch((error) => setToast(error instanceof Error ? error.message : "大型棋谱移入回收站失败"));
  };
  const deleteLargeRecord = (item: LargeDocumentSummary) => withDraftGuard(() => performDeleteLargeRecord(item));
  const deletePuzzleCollection = (collection: PuzzleCollection) => withDraftGuard(() => {
    if (collection.id.startsWith("native-")) { setToast("内置题库不能删除"); return; }
    const folder = libraryFolders.puzzleAssignments[collection.id] || "我的题库";
    setRecycleBin(addToRecycleBin({ id: collection.id, kind: "puzzle-collection", item: collection, folder, deletedAt: new Date().toISOString() }));
    const next = puzzleCollections.filter((item) => item.id !== collection.id);
    savePuzzleCollections(next); setPuzzleCollections(next);
    setLibraryFolders((folders) => {
      const assignments = { ...folders.puzzleAssignments };
      delete assignments[collection.id];
      return { ...folders, puzzleAssignments: assignments };
    });
    if (puzzleCollectionIndex >= next.length) setPuzzleCollectionIndex(Math.max(0, next.length - 1));
    setToast(`已移入回收站：${collection.title}`);
  });
  const restoreRecycleEntry = (entry: RecycleBinEntry) => {
    if (entry.kind === "record") {
      const next = saveToLibrary(entry.item);
      setLibrary(next);
      setLibraryFolders((folders) => ({ ...folders, recordAssignments: { ...folders.recordAssignments, [entry.id]: entry.folder } }));
      setRecycleBin(removeFromRecycleBin(entry.kind, entry.id));
      setToast(`已恢复棋谱：${entry.item.metadata.title}`);
      return;
    }
    if (entry.kind === "puzzle-collection") {
      if (puzzleCollections.some((item) => item.id === entry.id)) { setToast("同名题集已存在，未恢复"); return; }
      const next = [...puzzleCollections, entry.item];
      savePuzzleCollections(next); setPuzzleCollections(next);
      setLibraryFolders((folders) => ({ ...folders, puzzleAssignments: { ...folders.puzzleAssignments, [entry.id]: entry.folder } }));
      setRecycleBin(removeFromRecycleBin(entry.kind, entry.id));
      setToast(`已恢复题集：${entry.item.title}`);
      return;
    }
    void restoreLargeDocumentFromTrash(entry.id).then((restored) => {
      if (!restored) throw new Error("大型棋谱数据不存在，未恢复");
      setLargeSummaries((items) => [...items, restored].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
      setLibraryFolders((folders) => ({ ...folders, recordAssignments: { ...folders.recordAssignments, [entry.id]: entry.folder } }));
      setRecycleBin(removeFromRecycleBin(entry.kind, entry.id));
      setToast(`已恢复棋谱：${entry.item.metadata.title}`);
    }).catch((error) => setToast(error instanceof Error ? error.message : "大型棋谱恢复失败"));
  };
  const permanentlyDeleteRecycleEntry = (entry: RecycleBinEntry) => {
    if (entry.kind === "large-record") {
      void removeLargeTrashDocument(entry.id).then(() => {
        setRecycleBin(removeFromRecycleBin(entry.kind, entry.id));
        setToast(`已彻底删除：${entry.item.metadata.title}`);
      }).catch(() => setToast("大型棋谱彻底删除失败"));
      return;
    }
    setRecycleBin(removeFromRecycleBin(entry.kind, entry.id));
    setToast(`已彻底删除：${entry.kind === "puzzle-collection" ? entry.item.title : entry.item.metadata.title}`);
  };
  const emptyRecycleBin = () => {
    const largeEntries = recycleBin.filter((entry): entry is Extract<RecycleBinEntry, { kind: "large-record" }> => entry.kind === "large-record");
    void Promise.all(largeEntries.map((entry) => removeLargeTrashDocument(entry.id))).then(() => {
      localStorage.removeItem("banbu-recycle-bin-v1");
      setRecycleBin([]);
      setToast("回收站已清空");
    }).catch(() => setToast("回收站清空失败，请稍后重试"));
  };
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
              const fallback = collection.id.startsWith("native-") ? "内置题库" : "我的题库";
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
  const beginImportProgress = (fileName: string, detail: string, totalFiles?: number) => {
    if (importProgressTimer.current !== null) window.clearTimeout(importProgressTimer.current);
    const id = ++importProgressId.current;
    setImportProgress({ id, phase: "reading", fileName, detail, currentFile: totalFiles ? 1 : undefined, totalFiles });
    return id;
  };
  const updateImportProgress = (id: number, patch: ImportProgressPatch) => {
    setImportProgress((current) => current?.id === id ? mergeImportProgress(current, patch) : current);
  };
  const settleImportProgress = (id: number, phase: "complete" | "error", detail: string) => {
    updateImportProgress(id, { phase, detail, progress: phase === "complete" ? 1 : undefined });
    if (importProgressTimer.current !== null) window.clearTimeout(importProgressTimer.current);
    importProgressTimer.current = window.setTimeout(() => {
      setImportProgress((current) => current?.id === id ? null : current);
      importProgressTimer.current = null;
    }, phase === "complete" ? 1100 : 5000);
  };
  const finishImportProgress = (id: number, detail: string) => settleImportProgress(id, "complete", detail);
  const failImportProgress = (id: number, detail: string) => settleImportProgress(id, "error", detail);
  const parseRecordFile = (file: File, progressId?: number, showWorkerStages = false): Promise<ParsedImport> => {
    // LIB size alone is not enough to decide whether the decoded tree is
    // large. Keep every LIB in the worker so a compact index is also created
    // for a highly branching file whose bytes happen to compress well.
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["lib", "db", "dp"].includes(extension) && file.size < 4 * 1024 * 1024) {
      if (progressId) updateImportProgress(progressId, { phase: "parsing", detail: `正在解析 ${file.name}` });
      return importRecordFile(file).then((result) => ({ result }));
    }
    setImportState("worker-started", { name: file.name, size: file.size, extension });
    return new Promise((resolve, reject) => {
      const worker = new RecordImportWorker();
      let previewResolved = false;
      worker.onmessage = (event: MessageEvent<{ ok?: boolean; progress?: boolean; phase?: ImportProgressState["phase"]; detail?: string; background?: boolean; preview?: boolean; finalOnly?: boolean; result?: ImportResult; summary?: LargeDocumentSummary; compactIndex?: CompactRenLibIndex; compactDiagnostic?: unknown; error?: string; stack?: string }>) => {
        if (event.data.progress) {
          if (progressId && showWorkerStages && event.data.phase) updateImportProgress(progressId, { phase: event.data.phase, detail: event.data.detail || "正在处理棋谱", background: event.data.background });
          return;
        }
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
          if (progressId) finishImportProgress(progressId, "完整索引已保存，可以继续使用");
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
    if (requested.length === 1 && singleExtension === "json" && isPuzzleJsonText(await requested[0].text())) {
      await handlePuzzleFile(requested[0]);
      return;
    }
    if (requested.length !== 1 && requested.some((file) => file.name.split(".").pop()?.toLowerCase() === "lib")) {
      setToast("网页 RenLib 核心当前一次打开一份 LIB，请分开选择");
      return;
    }
    if (singleExtension === "lib") {
      const progressId = beginImportProgress(requested[0].name, "正在读取 LIB 文件头与网页核心");
      setImportState("renlib-web-started", { name: requested[0].name, size: requested[0].size });
      const session = new RenLibWebViewSession();
      try {
        updateImportProgress(progressId, { phase: "parsing", detail: "正在打开 RenLib 核心并读取分支" });
        const opened = await session.open(requested[0]);
        updateImportProgress(progressId, { phase: "indexing", detail: "正在准备根局面与自动行棋路径" });
        dynamicViewSession.current?.close();
        dynamicViewSession.current = session;
        openRecord(opened.document, opened.currentId, { sourceFile: requested[0], onOpened: () => setImportState("renlib-web-query-ready", { name: requested[0].name, size: requested[0].size }) });
        void rememberRecentImport(requested[0], "record");
        setToast("已用网页 RenLib 核心打开，分支与注释按当前局面实时读取");
        finishImportProgress(progressId, "LIB 已打开，分支将在浏览时按需读取");
      } catch (error) {
        session.close();
        setImportState("renlib-web-failed", { error: error instanceof Error ? error.message : String(error) });
        const message = error instanceof Error ? error.message : "RenLib 网页核心打开失败";
        setToast(message); failImportProgress(progressId, message);
      }
      return;
    }
    if (singleExtension === "db" || singleExtension === "dp") {
      const progressId = beginImportProgress(requested[0].name, "正在读取数据库文件");
      setImportState("dp-index-started", { name: requested[0].name, size: requested[0].size });
      const session = new DpViewSession();
      try {
        updateImportProgress(progressId, { phase: "indexing", detail: "正在建立局面查询索引；大型数据库可能需要一些时间" });
        const opened = await session.open(requested[0]);
        dynamicViewSession.current?.close(); dynamicViewSession.current = session;
        openRecord(opened.document, opened.currentId, { sourceFile: requested[0], onOpened: () => setImportState("dp-query-ready", { records: opened.recordCount }) });
        void rememberRecentImport(requested[0], "record");
        setToast(`已打开 DP 数据库，共 ${opened.recordCount} 条记录，分支按局面实时读取`);
        finishImportProgress(progressId, `查询索引已就绪，共 ${opened.recordCount} 条记录`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "DP 数据库打开失败";
        session.close();
        setImportState("dp-index-failed", { name: requested[0].name, size: requested[0].size, error: message });
        setToast(`无法打开 ${requested[0].name}：${message}`);
        failImportProgress(progressId, message);
      }
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
    const progressName = selected.length === 1 ? selected[0]?.name || "棋谱" : `${selected.length} 份棋谱`;
    const progressId = beginImportProgress(progressName, selected.length ? "已接收文件，准备解析" : "没有可导入的棋谱", selected.length || undefined);
    for (let index = 0; index < selected.length; index += 2) {
      const batch = selected.slice(index, index + 2);
      updateImportProgress(progressId, {
        phase: "parsing",
        detail: batch.length > 1 ? `正在并行解析 ${batch.map((file) => file.name).join("、")}` : `正在解析 ${batch[0].name}`,
        currentFile: Math.min(index + 1, selected.length),
        ...(selected.length > 1 ? { progress: index / selected.length } : {}),
      });
      const settled = await Promise.allSettled(batch.map((file) => parseRecordFile(file, progressId, selected.length === 1)));
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
      updateImportProgress(progressId, {
        phase: "parsing",
        currentFile: Math.min(index + batch.length, selected.length),
        ...(selected.length > 1 ? { progress: Math.min(index + batch.length, selected.length) / selected.length } : {}),
      });
    }
    if (!imported.length) {
      const first = failures[0]?.reason;
      recordAction(`导入失败：${failures.length} 个文件${first instanceof Error ? `，${first.message.slice(0, 80)}` : ""}`);
      const message = first instanceof Error ? first.message : "所选文件均导入失败";
      setToast(message); failImportProgress(progressId, message);
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
        updateImportProgress(progressId, { phase: "saving", detail: "棋谱已可浏览，正在后台保存完整索引", background: true });
        openRecord(active, active.rootId, {
          sourceFile: immediate.file,
          onOpened: () => setImportState("document-opened", { id: immediate.result.document.id, title: immediate.result.document.metadata.title, persistence: "background" }),
        });
        void rememberRecentImport(immediate.file, "record");
        const warningCount = immediate.result.warnings.length;
        setToast(`已导入 ${active.metadata.title}${warningCount ? `，${warningCount} 条提示` : ""}，正在后台保存`);
        void saveCompactIndex(active, immediate.compactIndex!, immediate.summary).then((summary) => {
          setLargeSummaries((items) => [summary, ...items.filter((item) => item.id !== summary.id)]);
          localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, summary.id);
          setImportState("compact-saved", { id: summary.id, nodeCount: summary.nodeCount, storageMode: summary.storageMode });
          (window as Window & { __banbuStorageDiagnostic?: unknown }).__banbuStorageDiagnostic = { ok: true, id: summary.id, storageMode: summary.storageMode, nodeCount: summary.nodeCount, background: true };
          finishImportProgress(progressId, "完整索引已保存，可以继续使用");
        }).catch((error) => {
          (window as Window & { __banbuStorageDiagnostic?: unknown }).__banbuStorageDiagnostic = { ok: false, id: active.id, error: error instanceof Error ? error.message : String(error) };
          setToast("棋谱已打开，但后台保存失败");
          failImportProgress(progressId, "棋谱已打开，但后台保存失败");
        });
        return;
      }
    }
    const largeImports = imported.filter(({ result, sourceBytes, summary, compactIndex }) => Boolean(compactIndex) || sourceBytes >= 4 * 1024 * 1024 || (summary?.nodeCount || Object.keys(result.document.nodes).length) >= 40000);
    const normalImports = imported.filter((item) => !largeImports.includes(item));
    let saved = { library: loadLibrary(), resolved: [] as GameDocument[], inserted: 0, duplicates: 0, conflicts: 0 };
    let largeInserted = 0, largeDuplicates = 0, largeConflicts = 0;
    let resolvedSingle: GameDocument | null = null;
    const previewOnly = imported.every((item) => item.summary?.preview);
    updateImportProgress(progressId, previewOnly
      ? { phase: "indexing", detail: "首批内容已可浏览，后台继续建立完整索引", background: true }
      : { phase: "saving", detail: "解析完成，正在写入本机棋谱库" });
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
      const message = error instanceof DOMException && error.name === "QuotaExceededError" ? "本机存储空间不足，棋谱已解析但尚未保存" : "棋谱已解析，但写入本地棋谱库失败";
      setToast(message); failImportProgress(progressId, message);
      return;
    }
    const warningCount = imported.reduce((count, item) => count + item.result.warnings.length, 0);
    if (requested.length === 1) {
      const active = resolvedSingle;
      if (!active) { setToast("棋谱已解析，但写入大型棋谱库失败"); failImportProgress(progressId, "写入大型棋谱库失败"); return; }
      if (active && tab === "library") { setLibrarySection("records"); setExpandedLibraryFolder(libraryFolders.recordAssignments[active.id] || "未分类"); }
      else if (active) {
        const largeId = largeImports.length && !saved.library.some((item) => item.id === active.id) ? active.id : undefined;
        openRecord(active, active.rootId, { largeId, sourceFile: imported[0]?.file, onOpened: () => setImportState("document-opened", { id: active.id, title: active.metadata.title }) });
      }
      setImportState("import-success", { id: active.id, title: active.metadata.title });
      recordAction(`导入成功：${imported[0].result.format} · ${active.metadata.title}`);
      const hasBackgroundImport = largeImports.some((item) => item.summary?.preview);
      setToast(`${saved.duplicates + largeDuplicates ? "该棋谱已存在" : `已导入 ${imported[0].result.format}`}${largeInserted ? "，已存入大型棋谱库" : ""}${hasBackgroundImport ? "，首批数据已打开，后台继续建立完整索引" : ""}${warningCount ? `，${warningCount} 条提示` : ""}`);
      if (!hasBackgroundImport) finishImportProgress(progressId, "棋谱已保存并打开");
      void Promise.all([...new Set(imported.map((item) => item.file))].map((file) => rememberRecentImport(file, "record")));
      return;
    }
    setTab("library");
    void Promise.all([...new Set(imported.map((item) => item.file))].map((file) => rememberRecentImport(file, "record")));
    setToast(`新增 ${saved.inserted + largeInserted} 份${saved.duplicates + largeDuplicates ? `，跳过 ${saved.duplicates + largeDuplicates} 份重复` : ""}${saved.conflicts + largeConflicts ? `，解决 ${saved.conflicts + largeConflicts} 个 ID 冲突` : ""}${failures.length ? `，${failures.length} 份失败` : ""}${warningCount ? `，${warningCount} 条提示` : ""}`);
    finishImportProgress(progressId, failures.length ? `导入完成，${failures.length} 份未成功` : `${imported.length} 份棋谱已保存`);
  };
  const handleBoardImage = async (file?: File) => {
    if (!file) return;
    setImageRecognizing(true);
    recordAction(`图片识谱：${file.name}`);
    try {
      // No window.prompt here: embedded WebViews (and some mobile browsers)
      // disable it, which made the import silently do nothing. Try the common
      // board sizes instead and keep the first read that finds real stones.
      let best: { result: ImageRecognitionResult; stones: number } | null = null;
      let lastError: unknown = null;
      for (const size of [15, 13, 19, 9, 17]) {
        try {
          const result = await recognizeBoardImage(file, size);
          const stones = result.board.flat().filter(Boolean).length;
          if (!best || stones > best.stones) best = { result, stones };
          if (stones >= 6) break;
        } catch (error) { lastError = error; }
      }
      if (!best || best.stones < 4) {
        throw lastError instanceof Error ? lastError : new Error("没有在图片中找到可靠棋子，请确认截图包含完整棋盘");
      }
      const result = best.result;
      const next = createDocument(file.name.replace(/\.[^.]+$/, "") || "图片识谱", result.boardSize);
      const occupiedCells = result.board.flat().filter(Boolean).length;
      // When every recognized stone carries a legible move number and the
      // numbers form the complete sequence 1..N, rebuild the move sequence
      // instead of a static setup so打谱/复盘功能(手数、悔棋)可用. A single
      // misread number would scramble history, so gaps or duplicates fall
      // back to the plain position.
      const numbers = result.numberedMoves.map((move) => move.number).sort((a, b) => a - b);
      const completeSequence = occupiedCells > 0 && result.numberedMoves.length === occupiedCells
        && numbers.every((value, index) => value === index + 1);
      if (completeSequence) {
        let currentId = next.rootId;
        for (const move of result.numberedMoves) {
          const added = addMoveAs(next, currentId, move, move.player);
          if (!added.created) break;
          currentId = added.nodeId;
        }
      } else {
        const root = next.nodes[next.rootId];
        root.setup = { black: [], white: [], empty: [] };
        result.board.forEach((row, r) => row.forEach((player, c) => { if (player) root.setup?.[player].push({ row: r, col: c }); }));
      }
      performOpenRecord(next);
      setSaved(false);
      setToast(`${result.boardSize}路图片识谱完成：识别 ${occupiedCells} 子，置信度 ${Math.round(result.confidence * 100)}%${result.ignoredColoredMarkers ? `，忽略 ${result.ignoredColoredMarkers} 个彩色分析点` : ""}${completeSequence ? `，已按序号恢复 ${result.numberedMoves.length} 手顺序` : "；未检测到完整序号，已按局面导入"}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "图片识谱失败，请使用清晰的棋盘截图"); }
    finally { setImageRecognizing(false); }
  };

  const handlePuzzleFile = async (file?: File) => {
    if (!file) return;
    const progressId = beginImportProgress(file.name, "正在读取题库 JSON");
    try {
      updateImportProgress(progressId, { phase: "parsing", detail: "正在校验题目与棋盘数据" });
      const report = importKaibaoPuzzleJson(await file.text(), file.name.replace(/\.json$/i, ""));
      updateImportProgress(progressId, { phase: "saving", detail: `正在保存 ${report.collection.puzzles.length} 道题目` });
      const nextCollections = [...puzzleCollections, report.collection];
      setPuzzleCollections(nextCollections); savePuzzleCollections(nextCollections);
      setLibraryFolders((currentFolders) => ({ ...currentFolders, puzzleAssignments: { ...currentFolders.puzzleAssignments, [report.collection.id]: "我的题库" } }));
      if (tab === "library") { setLibrarySection("puzzles"); setExpandedLibraryFolder("我的题库"); }
      else guardedOpenPuzzle(nextCollections.length - 1, 0, nextCollections);
      setToast(`已导入 ${report.collection.puzzles.length} 题${report.skipped ? `，跳过 ${report.skipped} 个空项` : ""}${report.warnings.length ? `，${report.warnings.length} 条提示` : ""}`);
      void rememberRecentImport(file, "puzzle");
      finishImportProgress(progressId, `${report.collection.puzzles.length} 道题目已保存`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "题库导入失败";
      setToast(message); failImportProgress(progressId, message);
    }
  };

  const exportDocument = hasDraft(draft) ? viewDocument : document;
  const createBoardShareFile = async () => {
    const blob = await renderBoardSharePng(exportDocument, currentId, { ...boardShareOptions, rotation, mirrored });
    return new File([blob], boardShareFilename(exportDocument, currentId), { type: "image/png", lastModified: Date.now() });
  };
  const saveBoardShareFile = async (file: File, fallback = false) => {
    setSheet(null);
    if (defaultDirectory) {
      try {
        await writeFileToDirectory(defaultDirectory, file.name, file, file.type);
        setToast(`${fallback ? "当前平台不支持文件分享，" : ""}PNG 已写入“${defaultDirectory.name}”`);
        return;
      } catch {
        downloadFile(file, file.name, file.type);
        setToast(`${fallback ? "当前平台不支持文件分享，" : "默认文件夹写入失败，"}已改用浏览器下载 PNG`);
        return;
      }
    }
    downloadFile(file, file.name, file.type);
    setToast(fallback ? "当前平台不支持文件分享，已自动下载 PNG" : "当前局面 PNG 已下载");
  };
  const saveBoardSharePng = async () => {
    if (boardShareGenerating) return;
    setBoardShareGenerating(true);
    try {
      await saveBoardShareFile(await createBoardShareFile());
    } catch (error) {
      setToast(error instanceof Error ? error.message : "分享图片生成失败，请重试");
    } finally {
      setBoardShareGenerating(false);
    }
  };
  const shareBoardPng = async () => {
    if (boardShareGenerating) return;
    setBoardShareGenerating(true);
    try {
      const file = await createBoardShareFile();
      const result = await sharePngFile(file, exportDocument.metadata.title || "半步五子棋", `第 ${depthOf(exportDocument, currentId)} 手当前局面`);
      if (result === "shared") {
        setSheet(null);
        setToast("当前局面已交给系统分享");
      } else if (result === "cancelled") {
        setToast("已取消分享");
      } else {
        await saveBoardShareFile(file, true);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "系统分享失败，请改用保存 PNG");
    } finally {
      setBoardShareGenerating(false);
    }
  };
  const sourceFormat = exportDocument.metadata.sourceFormat;
  const originalBinaryFile = sourceFormat && binarySourceFormats.has(sourceFormat) ? nativeSourceFile.current : null;
  const activeRenLibSession = sourceFormat === "lib" && dynamicViewSession.current instanceof RenLibWebViewSession
    ? dynamicViewSession.current
    : null;
  const libSgfSourceTooLarge = Boolean(originalBinaryFile && originalBinaryFile.size > MAX_FULL_LIB_TO_SGF_SOURCE_BYTES);
  const fullLibSgfAvailable = Boolean(activeRenLibSession && originalBinaryFile && !libSgfSourceTooLarge);
  const exportsVisibleDatabaseContent = isDynamicDatabaseView(exportDocument);
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
  const exportFullLibAsSgf = async () => {
    const session = dynamicViewSession.current;
    if (!(session instanceof RenLibWebViewSession) || !originalBinaryFile || sourceFormat !== "lib") {
      setToast("完整 LIB 转 SGF 只对当前刚打开且未编辑的 LIB 可用");
      return;
    }
    if (originalBinaryFile.size > MAX_FULL_LIB_TO_SGF_SOURCE_BYTES) {
      setToast("源 LIB 超过 64MB，为避免设备内存不足，已停用完整转换");
      return;
    }
    if (libSgfExporting) return;
    setLibSgfExporting(true);
    setToast("正在由 RenLib 核心转换完整棋谱…");
    try {
      const sgf = await session.exportOriginalSgf();
      await exportRecordFile(
        sgf,
        `${safeName(exportDocument.metadata.title)}.sgf`,
        "application/x-go-sgf;charset=utf-8",
        "完整 LIB 已转换为 SGF",
      );
      recordAction(`完整 LIB 转 SGF：${originalBinaryFile.name}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "完整 LIB 转 SGF 失败");
    } finally {
      setLibSgfExporting(false);
    }
  };
  const openExportSheet = () => {
    setBoardShareOptions((value) => ({ ...value, showMoveNumbers: showNumbers, showCoordinates }));
    setExportFormatMenuOpen(false);
    setSheet("export");
  };

  const sheetTitle = sheet === "comment" ? "节点注释" : sheet === "branches" ? "变化分支" : sheet === "tree" ? "棋谱树" : sheet === "metadata" ? "棋谱信息" : sheet === "save" ? "保存棋谱" : sheet === "folder" ? `新建${folderCreationSection === "records" ? "棋谱" : "题库"}文件夹` : sheet === "rename" ? "重命名" : sheet === "export" ? "导出与分享" : sheet === "manual" ? "使用手册" : sheet === "about" ? "关于半步五子棋" : sheet === "feedback" ? "反馈与建议" : sheet === "find" ? "查找本谱" : sheet === "analysis" ? "局面分析" : sheet === "positionSearch" ? "跨谱局面检索" : sheet === "marks" ? "棋盘标注" : sheet === "import" ? "选择导入方式" : sheet === "aiGame" ? "AI 人机对战" : sheet === "think" ? "AI 思考" : sheet === "wrongbook" ? "错题本" : sheet === "trash" ? "回收站" : sheet === "batchEdit" ? "批量处理" : "使用提示";
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
  const currentAnnotationLines = currentHasComment ? annotationLines(current) : [];
  const commentToggleLabel = commentExpanded ? "收起注释" : currentHasComment ? "展开注释" : "打开注释（当前无内容）";
  const commentPreviewContent = currentAnnotationLines.length
    ? currentAnnotationLines.map((text, index) => <div key={`${current.id}-annotation-${index}`}>{text}</div>)
    : "当前局面暂无注释";
  const customAppStyle = themePreference === "custom" ? {
    backgroundColor: customBackgroundColor,
    ...(customBackgroundImage ? { backgroundImage: `linear-gradient(#1118, #1118), url("${customBackgroundImage}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
  } : undefined;
  return <div className={`app-shell ${fontScaleClass(fontScale)} ${enhancementSettings.tabletSplit ? "split-layout-enabled" : ""}`} lang="zh-CN" style={customAppStyle}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <input ref={singleFileInput} type="file" hidden accept="*/*" onChange={(event) => { void handleFiles(event.target.files || undefined); event.target.value = ""; }}/>
    <input ref={puzzleFileInput} type="file" hidden accept=".json,application/json" onChange={(event) => { void handlePuzzleFile(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={imageFileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif" onChange={(event) => { void handleBoardImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={backupFileInput} type="file" hidden accept=".json,application/json" onChange={(event) => { void handleBackupFile(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={backgroundFileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/*" onChange={(event) => { handleBackgroundImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <header className="topbar"><div className="brand"><button type="button" className="brand-trigger" onClick={() => setQuickDrawerOpen(true)} aria-label="打开快捷中心" aria-expanded={quickDrawerOpen} aria-controls="quick-drawer"><img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true"/></button><div><b>半步五子棋</b><small className={mode === "record" && aiGame ? "ai-clock-status" : undefined} aria-live="polite">{mode === "record" && aiGame ? aiGame.timeLimitMs === 0 ? aiGame.outcome ? `本局结束 · 人类用时 ${formatGameClock(aiHumanElapsedMs)}` : aiThinking ? `AI 思考中 · 暂停计时 · 已用 ${formatGameClock(aiHumanElapsedMs)}` : aiClockActive ? `你的回合 · 已用 ${formatGameClock(aiHumanElapsedMs)}` : `计时暂停 · 已用 ${formatGameClock(aiHumanElapsedMs)}` : aiGame.outcome ? `本局结束 · ${formatGameClock(Math.max(0, aiGame.timeLimitMs - aiHumanElapsedMs))} 剩余` : aiThinking ? `AI 思考中 · 暂停计时 · ${formatGameClock(Math.max(0, aiGame.timeLimitMs - aiHumanElapsedMs))} 剩余` : aiClockActive ? `你的回合 · ${formatGameClock(Math.max(0, aiGame.timeLimitMs - aiHumanElapsedMs))} 剩余` : `计时暂停 · ${formatGameClock(Math.max(0, aiGame.timeLimitMs - aiHumanElapsedMs))} 剩余` : mode === "puzzle" ? `${puzzleCollections.reduce((sum, item) => sum + item.puzzles.length, 0)} 道题已就绪` : hasDraft(draft) ? "有未保存草稿" : saved ? <><Check size={12}/> 已保存</> : "保存中…"}</small></div></div><div className="top-actions"><button className="icon-button" onClick={openImportSheet} aria-label="打开导入方式"><Download size={20}/></button>{mode === "record" && <><button className="icon-button" onClick={openExportSheet} aria-label="打开导出方式"><Upload size={20}/></button><button className="icon-button save-action" onClick={openSaveDialog} aria-label="保存棋谱"><Save size={20}/></button></>}</div></header>
    <QuickDrawer
      open={quickDrawerOpen}
      onClose={() => setQuickDrawerOpen(false)}
      title={mode === "record" ? viewDocument.metadata.title : currentPuzzle?.title || "当前题目"}
      subtitle={mode === "record" ? `第 ${depthOf(viewDocument, currentId)} 手 · 下一手${nextPlayer === "black" ? "黑" : "白"}方` : `${puzzleCollections[puzzleCollectionIndex]?.title || "题库"} · 第 ${puzzleIndex + 1} 题`}
      thinkPopup={thinkSheetOnStart}
       onThinkPopupChange={setThinkSheetOnStart}
       thinkDirectMove={thinkDirectMove}
       onThinkDirectMoveChange={setThinkDirectMove}
      thinkRunning={thinkRunning}
      thinkResultLabel={thinkResult?.move ? coordinateName(thinkResult.move) : undefined}
      onThink={() => { setQuickDrawerOpen(false); startThink(); }}
      onOpenThinkResult={() => { setQuickDrawerOpen(false); setSheet("think"); }}
      themePreference={themePreference}
      onThemePreferenceChange={(value) => { if (isThemePreference(value)) setThemePreference(value); }}
      boardTheme={boardTheme}
      onBoardThemeChange={(value) => { if (isBoardTheme(value)) setBoardTheme(value); }}
      stoneTheme={stoneTheme}
       onStoneThemeChange={(value) => { if (isStoneTheme(value)) setStoneTheme(value); }}
    />
     <main id="main-content" className="app-main">
      {tab === "record" && <div className="record-page">
        <section className="workspace-bar"><button className={`workspace-current ${workspaceSelectorOpen ? "open" : ""}`} onClick={() => { setWorkspaceSelectorOpen((open) => !open); if (workspaceSelectorOpen) { setWorkspaceListExpanded(false); setExpandedCollectionId(null); } }}><span>{mode === "record" ? "谱" : "题"}</span><div><b>{mode === "record" ? viewDocument.metadata.title : currentPuzzle?.title || "选择题目"}</b><small>{mode === "record" ? `${viewDocument.metadata.black} vs ${viewDocument.metadata.white} · 第 ${depthOf(viewDocument, currentId)} 手` : `${puzzleCollections[puzzleCollectionIndex]?.title || "题库"} · ${puzzleIndex + 1}/${puzzleCollections[puzzleCollectionIndex]?.puzzles.length || 0}`}</small></div><ChevronDown size={18}/></button>{mode === "record" && <div className="workspace-meta"><span>{hasDraft(draft) ? "有未保存草稿" : candidateLabel ? `标注「${candidateLabel}」` : current.move ? `${current.move.player === "black" ? "黑" : "白"} · ${coordinateName(current.move)}` : nodeKindLabel(current)}</span><small>{depthOf(viewDocument, currentId)} / {compactNodeCount(document) ? "大型" : mainLineLength(document)} 手 · {branchCount(viewDocument)} 处分支</small></div>}<div className="workspace-mode-stack"><button className={`workspace-mode-toggle ${mode}`} onClick={() => switchMode(mode === "record" ? "puzzle" : "record")} role="switch" aria-checked={mode === "puzzle"} aria-label={`当前${mode === "record" ? "打谱" : "做题"}模式，点击切换`}><i/><span>打谱</span><span>做题</span></button>{mode === "record" && aiGame && <button className="exit-ai-game" onClick={exitAiGame}>退出对弈</button>}</div></section>
        {workspaceSelectorOpen && <section className="inline-workspace-selector" aria-label={mode === "record" ? "本页切换棋谱" : "本页切换题目"}>
          <button className="selector-master-toggle" onClick={() => setWorkspaceListExpanded((expanded) => !expanded)}><span><b>{mode === "record" ? "选择棋谱" : "选择题集与题目"}</b><small>{mode === "record" ? `${searchableDocuments.length + largeSummaries.filter((item) => item.id !== document.id).length} 份棋谱，可上下滑动` : `${puzzleCollections.length} 个题集，可上下滑动`}</small></span><span>{workspaceListExpanded ? "收起" : "展开全部"}<ChevronDown size={17}/></span></button>
          {workspaceListExpanded && mode === "record" && <div className="inline-record-list">{searchableDocuments.map((item) => <button key={item.id} className={item.id === document.id ? "current" : ""} onClick={() => openRecord(item)}><span className="picker-record-stone">{mainLineLength(item)}</span><div><b>{item.metadata.title}</b><small>{item.metadata.black} vs {item.metadata.white} · {item.metadata.rule === "renju" ? "连珠" : "五子棋"}</small></div>{item.id === document.id ? <Check size={17}/> : <ChevronRight size={17}/>}</button>)}{largeSummaries.filter((item) => item.id !== document.id).map((item) => <button key={item.id} onClick={() => { void openLargeRecord(item); }}><span className="picker-record-stone">{item.mainLineLength}</span><div><b>{item.metadata.title}</b><small>{item.metadata.black} vs {item.metadata.white} · 大型棋谱</small></div><ChevronRight size={17}/></button>)}</div>}
          {workspaceListExpanded && mode === "puzzle" && <div className="inline-collection-list">{puzzleCollections.map((collection, collectionIndex) => { const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length; const expanded = expandedCollectionId === collection.id; const query = expanded ? puzzleQuery.trim().toLowerCase() : ""; const visiblePuzzles = collection.puzzles.filter((puzzle, index) => !query || puzzle.title.toLowerCase().includes(query) || puzzle.prompt.toLowerCase().includes(query) || String(index + 1).includes(query)); return <section key={collection.id} className={expanded ? "expanded" : ""}><button className="collection-accordion-head" onClick={() => { setExpandedCollectionId(expanded ? null : collection.id); setPuzzleQuery(""); }}><span className="puzzle-folder-icon"><FolderOpen size={18}/></span><div><b>{collection.title}</b><small>{solved}/{collection.puzzles.length} 已完成</small></div><ChevronDown size={18}/></button>{expanded && <div className="collection-accordion-body"><label className="picker-search"><Search size={16}/><input value={puzzleQuery} onChange={(event) => setPuzzleQuery(event.target.value)} placeholder="输入题号或关键词"/><button onClick={() => setPuzzleQuery("")} aria-label="清除"><X size={15}/></button></label><div className="inline-puzzle-list">{visiblePuzzles.map((puzzle) => { const actualIndex = collection.puzzles.indexOf(puzzle); const solvedPuzzle = puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved; return <button key={puzzle.id} className={collectionIndex === puzzleCollectionIndex && actualIndex === puzzleIndex ? "current" : ""} onClick={() => openPuzzle(collectionIndex, actualIndex)}><span className={solvedPuzzle ? "solved" : ""}>{solvedPuzzle ? <Check size={14}/> : actualIndex + 1}</span><div><b>{puzzle.title || `第 ${actualIndex + 1} 题`}</b><small>{puzzle.player === "black" ? "黑先" : "白先"} · {puzzle.prompt}</small></div><ChevronRight size={16}/></button>; })}</div></div>}</section>; })}</div>}
        </section>}
        {mode === "record" && (isDynamicDatabaseView(document) || isPagedLibraryView(document)) && <div className={`database-edit-hint ${dynamicNavigationBusy ? "is-reading" : ""}`}><Lock size={15}/><span><b>{dynamicNavigationBusy ? "正在读取分支" : "数据库浏览模式"}</b><small>{dynamicNavigationBusy ? "正在读取所选分支，请稍候…" : isDynamicDatabaseView(document) && current.children.length === 0 ? "当前分支已到数据库终点；可直接进入编辑模式，继续添加后续变化。" : "点已有分支继续浏览；点其他空位、标注或编辑注释会创建本地编辑副本。"}</small></span>{isDynamicDatabaseView(document) && current.children.length === 0 && <button className="database-edit-button" onClick={() => { detachViewForEditing(emptyDraft()); setContinuationEditMode(true); }} disabled={dynamicNavigationBusy}>在此处继续编辑</button>}</div>}
         {mode === "record" && aiGame && aiOpeningStage?.kind !== "normal" && <section className="ai-opening-banner" aria-live="polite"><span className="ai-opening-step">开</span><div><b>{openingRuleName(aiGame.opening.rule, aiGame.opening.n)}</b><small>{openingInstruction(aiGame.opening)}</small></div>{aiOpeningStage?.kind === "swap" && aiOpeningStage.chooser === "human" && <div className="ai-opening-actions"><button onClick={() => chooseOpeningSwap(false)}>{aiOpeningStage.taraguchiChoice ? "进入十打" : "不交换"}</button><button className="accent" onClick={() => chooseOpeningSwap(true)}>交换</button></div>}{aiThinking && <i className="ai-opening-thinking"/>}</section>}
          <Board document={viewDocument} currentId={currentId} currentBookmarked={activeBookmarks.some((bookmark) => bookmark.nodeId === currentId)} showNumbers={showNumbers} showCoordinates={showCoordinates} largeBoard={largeBoard} rotation={rotation} mirrored={mirrored} boardTheme={boardTheme} stoneTheme={stoneTheme} initialDepth={mode === "puzzle" ? puzzleInitialDepth : 0} forbiddenMarkers={boardForbiddenMarkers} winningLines={boardWinningLines} openingCandidates={enhancementSettings.aiBoardHints ? aiGame?.opening.candidates || [] : []} openingStage={aiOpeningStage} thinkingMove={enhancementSettings.aiBoardHints && thinkContextKey === currentPositionKey ? thinkResult?.move : null} thinking={aiThinking || thinkRunning} motion={boardMotion} feedback={boardFeedback} result={boardResult} gestureZoomEnabled={enhancementSettings.gestureZoom} gestureSwipeEnabled={enhancementSettings.gestureSwipe} disabled={dynamicNavigationBusy || (mode === "puzzle" && (aiThinking || !!puzzleOutcome)) || aiBoardDisabled} onPlay={play} onVariation={mode === "record" && !aiGame && !continuationEditMode ? navigateVariation : undefined} onMark={mode === "record" && !aiGame ? mark : () => undefined} onGestureStep={mode === "record" ? (delta) => { if (delta < 0) goPrev(); else goNext(); } : undefined}/>
         <div className={`workspace-status ${puzzleOutcome || ""}`}>{mode === "record" ? <><div className="record-command-bar" aria-label="常驻打谱工具">
             {mode === "record" && <button className={`command-comment ${currentHasComment ? "has-comment" : ""} ${commentExpanded ? "active" : ""}`} onClick={() => setCommentExpanded((open) => !open)} aria-label={commentToggleLabel} title={commentToggleLabel}><MessageSquareText/></button>}
            {mode === "record" && <button className="command-new" onClick={newRecord} aria-label="新建空白棋局" title="新建空白棋局"><FilePlus2/></button>}
            <button className={`command-save ${hasDraft(draft) ? "pending" : ""}`} onClick={saveCurrentDraft} aria-label={hasDraft(draft) ? `保存当前棋谱修改（${draft.operations.length} 项）` : "当前棋谱已保存"} title={hasDraft(draft) ? "保存修改" : "已保存"}><Save/></button>
            <button className="command-delete" onClick={deleteCurrentVariation} disabled={!current.parentId} aria-label="删除当前一步及后续变化" title={!current.parentId ? "起始局面不可删除" : isPagedLibraryView(document) || isDynamicDatabaseView(document) ? "将在本地编辑副本中删除，原数据库不变" : "删除本步及后续变化"}><Trash2/></button>
            <button className={`command-think ${machineThinking ? "running machine-thinking" : ""} think-state-${thinkVisualState}`} data-think-state={thinkVisualState} onClick={startThink} disabled={vcfRunning || !!aiGame} aria-label={thinkRunning ? "中断 AI 思考" : machineThinking ? "AI 正在思考" : thinkVisualState === "complete" ? "AI 推荐已完成" : thinkVisualState === "error" ? "AI 思考异常，可重试" : "思考当前局面的下一步"} title={aiGame ? "人机对局会自动思考" : thinkRunning ? "再次点击中断 AI 思考" : machineThinking ? "AI 正在思考" : thinkVisualState === "complete" ? "推荐已完成，点击重新思考" : "思考当前局面的下一步"}><Bot/></button>
            <div className={`stone-color-switch ${activePlacementPlayer} ${placementLocked ? "locked" : "following"}`} role="radiogroup" aria-label="落子颜色">
              <i aria-hidden="true"/>
              <button className={activePlacementPlayer === "black" ? "selected" : ""} onClick={() => { setPlacementPlayer("black"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "black"} aria-label="黑棋" title="锁定黑棋"><span className="player-stone black"/></button>
              <button className={activePlacementPlayer === "white" ? "selected" : ""} onClick={() => { setPlacementPlayer("white"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "white"} aria-label="白棋" title="锁定白棋"><span className="player-stone white"/></button>
              <button className={`lock-toggle ${placementLocked ? "locked" : ""}`} onClick={() => setPlacementLocked((locked) => !locked)} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定，自动换色" : "跟随当前棋谱颜色"} title={placementLocked ? "解除锁定" : "自动换色"}><Lock/></button>
            </div>
          </div></> : <><span>{puzzleOutcome === "won" ? "挑战成功" : puzzleOutcome === "lost" ? "本题失败" : puzzleOutcome === "stopped" ? "思考已停止" : aiThinking ? "陪练思考中" : `${currentPuzzle?.player === "black" ? "黑" : "白"}方由你落子`}</span><small>{puzzleOutcome ? "可悔棋或重启本题" : currentPuzzle?.prompt}</small>{machineThinking && <span className="machine-thinking-status" aria-label="AI 正在思考"><Bot size={16}/></span>}</>}</div>
        {mode === "record" && commentExpanded && <div className="comment-review"><div className={commentPreviewClass} aria-live="polite">{commentPreviewContent}</div></div>}
        <section className="context-dock">
          <nav className="dock-tabs">{mode === "record" ? <><button aria-label="行棋" className={dockPanel === "moves" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "moves" ? null : "moves")}><Redo2/>走棋</button><button aria-label="编辑" className={dockPanel === "notes" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "notes" ? null : "notes")}><MessageSquareText/>编辑</button><button aria-label="更多" className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "view" ? null : "view")}><MoreHorizontal/>更多</button><button aria-label="标注" className={candidateLabel ? "active" : ""} onClick={() => setSheet("marks")}><Tag/>标注</button></> : <><button className={dockPanel === "play" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "play" ? null : "play")}><Undo2/>应战</button><button className={dockPanel === "puzzles" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "puzzles" ? null : "puzzles")}><BookOpen/>题目</button><button className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "view" ? null : "view")}><MoreHorizontal/>更多</button></>}</nav>
          {dockPanel && <div className="dock-panel">
            {mode === "record" && dockPanel === "moves" && <><button onClick={goRoot} disabled={dynamicNavigationBusy} aria-label="到第一手"><ChevronFirst/><span>起点</span></button><button onClick={goPrev} disabled={dynamicNavigationBusy || !current.parentId} aria-label="上一手"><ChevronLeft/><span>上一手</span></button><button className="accent" onClick={goNext} disabled={dynamicNavigationBusy || !preferredNext(viewDocument, currentId)} aria-label="下一手"><ChevronRight/><span>下一手</span></button><button onClick={goPreferredEnd} disabled={dynamicNavigationBusy} aria-label="到最后一手"><ChevronLast/><span>终点</span></button><button onClick={() => setSheet("tree")} disabled={dynamicNavigationBusy} aria-label="打开棋谱树"><ListTree/><span>棋谱树</span></button>{branchTotal >= 2 && <button onClick={() => { setBranchPage(1); setSheet("branches"); }} disabled={dynamicNavigationBusy}><GitBranch/><span>分支</span></button>}{hasDraft(draft) && <><button onClick={undoDraftChange}><Undo2/><span>撤销</span></button><button onClick={discardDraft}><X/><span>放弃</span></button></>}</>}
             {mode === "record" && dockPanel === "notes" && <><button onClick={() => setSheet("comment")}><MessageSquareText/><span>注释</span></button><button onClick={() => setSheet("metadata")}><Save/><span>信息</span></button><button onClick={() => setRotation((value) => ((value + 90) % 360) as BoardRotation)}><RotateCw/><span>旋转</span></button><button onClick={() => setMirrored((value) => !value)}><FlipHorizontal/><span>镜像</span></button></>}
             {dockPanel === "view" && <><button onClick={() => setSheet("find")}><Search/><span>查找</span></button><button onClick={() => { setDockPanel(null); setSheet("positionSearch"); }}><GitBranch/><span>跨谱查找</span></button><button onClick={() => setShowNumbers((value) => !value)}><Tag/><span>{showNumbers ? "隐藏手数" : "显示手数"}</span></button><button onClick={() => setShowCoordinates((value) => !value)}><Menu/><span>{showCoordinates ? "隐藏坐标" : "显示坐标"}</span></button></>}
            {mode === "puzzle" && dockPanel === "play" && <><button onClick={undoPuzzleTurn} disabled={depthOf(document, currentId) <= puzzleInitialDepth}><Undo2/><span>悔棋</span></button><button onClick={restartPuzzle}><RotateCw/><span>重启</span></button><button className={aiThinking ? "danger" : "accent"} onClick={aiThinking ? stopPuzzleAi : () => movePuzzle(1)}>{aiThinking ? <X/> : <ChevronRight/>}<span>{aiThinking ? "停止" : "下一题"}</span></button></>}
{mode === "puzzle" && dockPanel === "puzzles" && <><button onClick={() => movePuzzle(-1)}><ChevronLeft/><span>上一题</span></button><button className="accent" onClick={() => { setWorkspaceSelectorOpen(true); setWorkspaceListExpanded(true); setExpandedCollectionId(puzzleCollections[puzzleCollectionIndex]?.id || null); window.scrollTo({ top: 0, behavior: "smooth" }); }}><BookOpen/><span>选题</span></button><button onClick={() => movePuzzle(1)}><ChevronRight/><span>下一题</span></button></>}
          </div>}
        </section>
      </div>}

      {tab === "library" && <div className="library-page page-padding">
        <div className="library-segment" role="tablist"><button className={librarySection === "puzzles" ? "active" : ""} onClick={() => { setLibrarySection("puzzles"); setExpandedLibraryFolder(libraryFolders.puzzleFolders[0] || null); }} role="tab">题库 <small>{puzzleCollections.length}</small></button><button className={librarySection === "records" ? "active" : ""} onClick={() => { setLibrarySection("records"); setExpandedLibraryFolder(libraryFolders.recordFolders[0] || null); }} role="tab">棋谱 <small>{library.length + largeSummaries.length}</small></button></div>
        <label className="library-search"><Search size={17}/><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={librarySection === "records" ? "搜索棋谱名、棋手或主题" : "搜索题库、题目或题面"}/><button type="button" onClick={() => setLibraryQuery("")} aria-label="清除搜索"><X size={15}/></button></label>
        {librarySection === "records" ? <>
          <div className={`library-actions batch-actions ${batchEditMode ? "batch-active" : ""}`}><button onClick={openRecordImportPicker}><Download/>导入棋谱<small>单个 LIB / SGF / JSON</small></button><button onClick={() => createLibraryFolder("records")}><FolderPlus/>新建文件夹<small>整理棋谱分组</small></button><button onClick={newRecord}><FilePlus2/>新建棋谱<small>从空棋盘开始</small></button><button onClick={() => { setBatchEditMode((active) => !active); setBatchSelectedIds([]); }}><ListTree/>{batchEditMode ? "退出批量" : "批量处理"}<small>{batchEditMode ? `已选择 ${batchSelectedIds.length} 份` : "选择普通棋谱后批量处理"}</small></button></div>
          {batchEditMode && <div className="batch-selection-bar" role="status" aria-live="polite"><span>已选择 {batchSelectedIds.length} 份</span><button type="button" onClick={selectAllBatchResults}>全选</button><button type="button" onClick={clearBatchSelection}>清空选择</button><button type="button" className="accent" disabled={!batchSelectedIds.length} onClick={() => setSheet("batchEdit")}>批量处理</button></div>}
          <button className="settings-link image-import-entry" onClick={openImageImportPicker} disabled={imageRecognizing}><span><Download/><b>{imageRecognizing ? "正在识别棋盘…" : "图片识谱"}</b><small>自动定位网格识别棋子与颜色，带手数截图可恢复落子顺序</small></span><ChevronRight/></button><button className="settings-link recycle-bin-entry" onClick={() => setSheet("trash")}><span><ArchiveRestore/><b>回收站</b><small>{recycleBin.length ? `${recycleBin.length} 项已删除，可恢复` : "暂时没有已删除内容"}</small></span><ChevronRight/></button>
          <div className="folder-library-list">{libraryFolders.recordFolders.map((folder) => {
            const items = filteredLibrary.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder);
            const largeItems = filteredLargeSummaries.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder);
            const expanded = expandedLibraryFolder === folder;
            return <section key={folder}>
              <div className="library-folder-row"><button className="library-folder-head" onClick={() => setExpandedLibraryFolder(expanded ? null : folder)}><FolderOpen size={19}/><span><b>{folder}</b><small>{items.length + largeItems.length} 份棋谱</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "record-folder", name: folder })} aria-label={`重命名文件夹“${folder}”`}><PenLine size={16}/></button></div>
              {expanded && <div className="record-list folder-items">
                {items.map((item) => <article key={item.id} className={batchEditMode ? "batch-selectable" : ""} onClick={() => batchEditMode ? toggleBatchSelection(item.id) : openRecord(item)}>{batchEditMode && <label className="batch-selection-checkbox" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={batchSelectedIds.includes(item.id)} onChange={() => toggleBatchSelection(item.id)} aria-label={`选择棋谱“${item.metadata.title}”`}/><i/></label>}<div className="mini-board"><span>●</span><span>○</span><b>{mainLineLength(item)}</b></div><div className="record-info"><h3>{item.metadata.title}</h3><p>{item.metadata.black} vs {item.metadata.white}</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", item.id, event.target.value)}>{libraryFolders.recordFolders.map((name) => <option key={name}>{name}</option>)}</select></div><div className="library-item-actions">{!batchEditMode && <><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "record", id: item.id, name: item.metadata.title }); }} aria-label={`重命名棋谱“${item.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteRecord(item); }} aria-label={`删除棋谱“${item.metadata.title}”`}><Trash2 size={17}/></button></>}</div></article>)}
                {largeItems.map((item) => <article key={item.id} onClick={() => { void openLargeRecord(item); }}><div className="mini-board"><span>●</span><span>○</span><b>{item.mainLineLength}</b></div><div className="record-info"><h3>{item.metadata.title}</h3><p>{item.metadata.black} vs {item.metadata.white} · 大型棋谱 · {item.nodeCount.toLocaleString()} 节点</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", item.id, event.target.value)}>{libraryFolders.recordFolders.map((name) => <option key={name}>{name}</option>)}</select></div><div className="library-item-actions"><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "large-record", id: item.id, name: item.metadata.title }); }} aria-label={`重命名棋谱“${item.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteLargeRecord(item); }} aria-label={`删除棋谱“${item.metadata.title}”`}><Trash2 size={17}/></button></div></article>)}
                {!items.length && !largeItems.length && <StateIllustration variant={libraryQuery.trim() ? "search" : "library"} title={libraryQuery.trim() ? "没有匹配的棋谱" : "这个文件夹还是空的"} description={libraryQuery.trim() ? "换一个棋谱名、棋手或主题关键词。" : "导入棋谱，或从空棋盘开始记录。"}/>}
              </div>}
            </section>;
          })}</div>
        </> : <>
          <div className="library-actions puzzle-actions three"><button onClick={() => setSheet("wrongbook")}><Layers3/>错题本<small>{wrongPuzzleEntries.length ? `${wrongPuzzleEntries.length} 道待复习` : "尝试过但尚未攻克的题目"}</small></button><button onClick={openPuzzleImportPicker}><Download/>导入 JSON 题库<small>支持 puzzles 题库对象和二维题目数组</small></button><button onClick={() => createLibraryFolder("puzzles")}><FolderPlus/>新建文件夹<small>自由整理题集</small></button></div><button className="settings-link recycle-bin-entry" onClick={() => setSheet("trash")}><span><ArchiveRestore/><b>回收站</b><small>{recycleBin.length ? `${recycleBin.length} 项已删除，可恢复` : "暂时没有已删除内容"}</small></span><ChevronRight/></button>
          <div className="folder-library-list">{libraryFolders.puzzleFolders.map((folder) => {
            const collections = filteredPuzzleCollections.filter(({ collection }) => (libraryFolders.puzzleAssignments[collection.id] || (collection.id.startsWith("native-") ? "内置题库" : "我的题库")) === folder);
            const expanded = expandedLibraryFolder === folder;
            return <section key={folder}>
              <div className="library-folder-row"><button className="library-folder-head" onClick={() => setExpandedLibraryFolder(expanded ? null : folder)}><FolderOpen size={19}/><span><b>{folder}</b><small>{collections.length} 个题集</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-folder", name: folder })} aria-label={`重命名文件夹“${folder}”`}><PenLine size={16}/></button></div>
              {expanded && <div className="puzzle-collection-list folder-items">{collections.map(({ collection, puzzles, collectionIndex }) => {
                const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length;
                const managing = managedPuzzleCollectionId === collection.id;
                return <article key={collection.id}><div className="puzzle-collection-main"><button onClick={() => guardedOpenPuzzle(collectionIndex, 0)}><span className="puzzle-folder-icon">題</span><div><b>{collection.title}</b><small>{libraryQuery.trim() && puzzles.length !== collection.puzzles.length ? `${puzzles.length} / ${collection.puzzles.length} 道题匹配 · ` : `${solved} / ${collection.puzzles.length} 已完成 · `}{collection.source}</small></div><ChevronRight size={18}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-collection", id: collection.id, name: collection.title })} aria-label={`重命名题集“${collection.title}”`}><PenLine size={15}/></button>{!collection.id.startsWith("native-") && <button className="library-inline-action delete-puzzle-collection" onClick={() => deletePuzzleCollection(collection)} aria-label={`删除题集“${collection.title}”`}><Trash2 size={15}/></button>}</div><div className="puzzle-collection-tools"><select value={folder} onChange={(event) => assignLibraryItem("puzzles", collection.id, event.target.value)} aria-label={`移动题集“${collection.title}”到文件夹`}>{libraryFolders.puzzleFolders.map((name) => <option key={name}>{name}</option>)}</select><button onClick={() => setManagedPuzzleCollectionId(managing ? null : collection.id)} aria-expanded={managing}>{managing ? "收起题目" : `管理 ${puzzles.length} 道题`}</button></div>{managing && <div className="puzzle-manager-list">{puzzles.map((puzzle) => { const puzzleIndexInCollection = collection.puzzles.indexOf(puzzle); return <div key={puzzle.id}><button onClick={() => guardedOpenPuzzle(collectionIndex, puzzleIndexInCollection)}><span>{puzzleIndexInCollection + 1}</span><b>{puzzle.title}</b></button><button onClick={() => beginLibraryRename({ kind: "puzzle", collectionId: collection.id, id: puzzle.id, name: puzzle.title })} aria-label={`重命名题目“${puzzle.title}”`}><PenLine size={14}/></button></div>; })}</div>}</article>;
              })}{!collections.length && <StateIllustration variant={libraryQuery.trim() ? "search" : "puzzle"} title={libraryQuery.trim() ? "没有匹配的题库或题目" : "这个文件夹还是空的"} description={libraryQuery.trim() ? "换一个题集、题目或题面关键词。" : "导入 JSON 题库后即可开始练习。"}/>}</div>}
            </section>;
          })}</div>
        </>}
      </div>}

      {tab === "settings" && <div className="settings-page page-padding"><div className="page-title"><div><span>WORKSPACE</span><h1>设置</h1><p>棋盘、文件、兼容性与项目选项</p></div></div><SettingsSection title="思考" summary={thinkDirectMove ? "完成后直接落子" : thinkSheetOnStart ? "完成后弹出结果面板" : "后台显示推荐点"}><SettingRow title="思考后直接落子" text="跳过推荐确认，自动在当前棋谱创建推荐落点" checked={thinkDirectMove} onChange={setThinkDirectMove}/><SettingRow title="思考后弹出结果面板" text={thinkDirectMove ? "直接落子开启时暂不弹出，关闭后恢复此偏好" : "关闭后只在棋盘标出推荐点"} checked={thinkSheetOnStart} disabled={thinkDirectMove} onChange={setThinkSheetOnStart}/></SettingsSection><SettingsSection title="无障碍与字号" summary="调整文字大小，改善键盘与屏幕阅读器使用体验"><div className="font-scale-options" role="radiogroup" aria-label="界面字号">{[["normal", "正常"], ["large", "大字"], ["xlarge", "特大字"]].map(([value, label]) => <button key={value} type="button" className={fontScale === value ? "selected" : ""} role="radio" aria-checked={fontScale === value} onClick={() => setFontScale(value as FontScale)}><b>{label}</b><small>{value === "normal" ? "100%" : value === "large" ? "115%" : "130%"}</small></button>)}</div><p className="helper">字号只放大界面文字与控件，不整体缩放棋盘，避免棋盘布局变形。</p></SettingsSection><SettingsSection title="外观主题" summary={`当前为${resolvedTheme === "dark" ? "深色" : resolvedTheme === "eye" ? "护眼" : resolvedTheme === "mono" ? "黑白极简" : resolvedTheme === "rain" ? "雨幕" : resolvedTheme === "bamboo" ? "水墨竹林" : resolvedTheme === "snow" ? "雪落" : resolvedTheme === "porcelain" ? "青花瓷影" : resolvedTheme === "plum" ? "梅枝映雪" : resolvedTheme === "jiangnan" ? "夜雨江南" : resolvedTheme === "firefly" ? "萤火森林" : resolvedTheme === "rice" ? "宣纸留白" : resolvedTheme === "pixel" ? "像素街机" : resolvedTheme === "cyber" ? "霓虹赛博" : resolvedTheme === "custom" ? "自定义" : "浅色"} · ${themePreference === "system" ? "跟随系统" : themePreference === "dark" ? "手动深色" : themePreference === "eye" ? "护眼" : themePreference === "mono" ? "黑白极简" : themePreference === "rain" ? "雨幕" : themePreference === "bamboo" ? "水墨竹林" : themePreference === "snow" ? "雪落" : themePreference === "porcelain" ? "青花瓷影" : themePreference === "plum" ? "梅枝映雪" : themePreference === "jiangnan" ? "夜雨江南" : themePreference === "firefly" ? "萤火森林" : themePreference === "rice" ? "宣纸留白" : themePreference === "pixel" ? "像素街机" : themePreference === "cyber" ? "霓虹赛博" : themePreference === "custom" ? "自定义背景" : "手动浅色"}`}><div className="theme-preference" role="radiogroup" aria-label="外观主题">{([["system", "跟随系统", "根据设备外观自动切换"], ["light", "浅色", "保持明亮纸张风格"], ["dark", "深色", "降低夜间屏幕亮度"], ["eye", "护眼", "降低蓝光感，适合长时间复盘"], ["mono", "黑白极简", "低彩度、清晰专注"], ["rain", "雨幕", "缓慢雨丝，适合夜间复盘"], ["bamboo", "水墨竹林", "青绿竹影与竹叶缓慢飘落"], ["snow", "雪落", "冷色雪花安静飘落"], ["porcelain", "青花瓷影", "青白瓷纹与水墨留白"], ["plum", "梅枝映雪", "梅枝、雪点与冷色宣纸"], ["jiangnan", "夜雨江南", "屋檐雨丝与远处灯火"], ["firefly", "萤火森林", "深林暗色与微弱萤火"], ["rice", "宣纸留白", "极简宣纸与淡墨晕染"], ["pixel", "像素街机", "低分辨率像素与复古色块"], ["cyber", "霓虹赛博", "蓝紫霓虹与电路光"], ["custom", "自定义背景", "支持静态图和 GIF 动图"]] as const).map(([value, label, text]) => <button key={value} type="button" className={themePreference === value ? "selected" : ""} role="radio" aria-checked={themePreference === value} onClick={() => setThemePreference(value)}><span className={`theme-swatch ${value}`} aria-hidden="true"/><span><b>{label}</b><small>{text}</small></span><Check className="theme-check" aria-hidden="true"/></button>)}</div>{themePreference === "custom" && <div className="custom-background-controls"><label><span>背景颜色</span><input type="color" value={customBackgroundColor} onChange={(event) => setCustomBackgroundColor(event.target.value)}/></label><button type="button" onClick={() => backgroundFileInput.current?.click()}>选择本地背景图片</button>{customBackgroundImage && <button type="button" className="custom-background-clear" onClick={() => setCustomBackgroundImage("")}>清除图片背景</button>}<p>图片只保存在本机，最大 2MB；使用深色半透明遮罩保证文字和棋盘控件可读。</p></div>}</SettingsSection><SettingsSection title="棋盘与棋子" summary="青花瓷、白玉、胡桃木、磨砂玻璃、电路与多种棋子"><VisualThemeSettings boardTheme={boardTheme} stoneTheme={stoneTheme} onBoardThemeChange={setBoardTheme} onStoneThemeChange={setStoneTheme}/></SettingsSection><SettingsSection title="声音与反馈" summary={soundSettings.enabled ? `${soundSettings.profile === "wood" ? "木石" : soundSettings.profile === "crystal" ? "清响" : "经典"} · 音量 ${Math.round(soundSettings.volume * 100)}%` : "已静音"}><SoundSettingsPanel settings={soundSettings} onChange={setSoundSettings} onPreview={playSound}/></SettingsSection><SettingsSection title="棋盘显示" summary={`显示、坐标、禁手辅助 · 动效${motionEnabled ? "开启" : "关闭"}`}><SettingRow title="显示手数" text="在棋子上显示落子序号" checked={showNumbers} onChange={setShowNumbers}/><SettingRow title="显示坐标" text="棋盘边缘显示 A–O / 1–15" checked={showCoordinates} onChange={setShowCoordinates}/><SettingRow title="禁手辅助" text="提示黑方常见三三、四四与长连" checked={showForbidden} onChange={setShowForbidden}/><SettingRow title="界面动效" text="关闭落子、导航、胜线与界面过渡" checked={motionEnabled} onChange={setMotionEnabled}/></SettingsSection><SettingsSection title="文件与存储" summary="应用内保存与默认导出文件夹"><StorageSettings defaultDirectory={defaultDirectory} directorySupported={supportsDirectoryPicker()} onChoose={() => { void chooseDefaultDirectory(); }} onClear={() => { void clearDefaultDirectory(); }}/></SettingsSection><SettingsSection title="数据与兼容" summary="导入、导出、备份与格式说明"><button className="settings-link" onClick={() => singleFileInput.current?.click()}><span><Download/><b>导入棋谱</b><small>SGF / JSON / LIB / DP / DB，以及 SGF 同族扩展名</small></span><ChevronRight/></button><button className="settings-link" onClick={() => { setExportFormatMenuOpen(false); setSheet("export"); }}><span><Upload/><b>导出棋谱</b><small>识别原始格式直接导出，或转换为完整 SGF / JSON</small></span><ChevronRight/></button><button className="settings-link" disabled={backupBusy} onClick={() => { void exportBackup(); }}><span><Save/><b>{backupBusy ? "正在处理备份…" : "一键备份"}</b><small>棋谱库、题库、进度、草稿、设置与大型索引清单</small></span><ChevronRight/></button><button className="settings-link" disabled={backupBusy} onClick={() => backupFileInput.current?.click()}><span><RotateCw/><b>恢复备份</b><small>导入前完整校验，失败自动回滚，不覆盖目录授权</small></span><ChevronRight/></button><button className="settings-link" onClick={() => setSheet("help")}><span><Info/><b>格式兼容说明</b><small>各格式的可写能力、保真范围与数据库边界</small></span><ChevronRight/></button></SettingsSection><SettingsSection title="关于" summary="项目说明、维护计划与下载地址"><button className="settings-link" onClick={() => setSheet("about")}><span><Info/><b>关于半步五子棋</b><small>个人项目说明、后续维护与 GitHub 下载</small></span><ChevronRight/></button></SettingsSection><div className="version-note">半步五子棋 1.1.4 · Web / PWA / Android</div></div>}
      {tab === "settings" && <section className="settings-help-extension page-padding" aria-label="使用手册与反馈"><SettingsSection open title="使用手册与反馈" summary="先看操作说明，再反馈问题或建议"><button className="settings-link manual-entry-link" onClick={() => setSheet("manual")}><span><BookOpen/><b>使用手册</b><small>逐项了解棋盘、棋谱库、题库、AI、导入导出和设置</small></span><ChevronRight/></button><button className="settings-link" onClick={() => setSheet("feedback")}><span><Mail/><b>反馈问题或建议</b><small>通过邮件或 GitHub Issue 发送，内容不会自动上传</small></span><ChevronRight/></button></SettingsSection></section>}
      {tab === "settings" && <section className="settings-enhancement-extension page-padding" aria-label="可选增强功能"><SettingsSection title="可选增强功能" summary={`${Object.values(enhancementSettings).filter(Boolean).length} 项已开启 · 新功能默认关闭`}><div className="enhancement-settings"><p className="settings-feature-note">下面这些功能会增加界面提示或触摸处理，默认关闭；需要时逐项打开即可。</p><SettingRow title="双指缩放棋盘" text="用两根手指放大或缩小棋盘，适合平板复盘" checked={enhancementSettings.gestureZoom} onChange={(gestureZoom) => setEnhancementSettings({ ...enhancementSettings, gestureZoom })}/><SettingRow title="双指滑动切手" text="双指左右滑动切换上一手或下一手" checked={enhancementSettings.gestureSwipe} onChange={(gestureSwipe) => setEnhancementSettings({ ...enhancementSettings, gestureSwipe })}/><SettingRow title="最近导入列表" text="在导入面板保留最近 5 个可快速重开的文件" checked={enhancementSettings.recentImports} onChange={(recentImports) => setEnhancementSettings({ ...enhancementSettings, recentImports })}/><SettingRow title="AI 棋盘提示点" text="在棋盘上显示 AI 推荐落点和开局候选编号" checked={enhancementSettings.aiBoardHints} onChange={(aiBoardHints) => setEnhancementSettings({ ...enhancementSettings, aiBoardHints })}/><SettingRow title="操作引导卡片" text="在记录、棋谱库和设置页显示轻量使用提示" checked={enhancementSettings.coachMarks} onChange={(coachMarks) => setEnhancementSettings({ ...enhancementSettings, coachMarks })}/></div></SettingsSection></section>}
      {tab === "settings" && <section className="settings-layout-extension page-padding" aria-label="设备布局"><SettingsSection title="设备布局" summary={enhancementSettings.tabletSplit ? "平板横屏双栏已开启" : "默认单栏 · 双栏默认关闭"}><SettingRow title="平板横屏双栏" text="在平板或横屏设备上将棋盘与操作区并排显示" checked={enhancementSettings.tabletSplit} onChange={(tabletSplit) => setEnhancementSettings({ ...enhancementSettings, tabletSplit })}/></SettingsSection></section>}
      </main>

    <nav className="bottom-nav" aria-label="主导航"><button aria-current={tab === "record" ? "page" : undefined} className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}><Home/><span>{mode === "puzzle" ? "做题" : "打谱"}</span></button><button aria-current={tab === "library" ? "page" : undefined} className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>棋谱库</span></button><button className="nav-center" onClick={openImportSheet}><Download/><span>导入</span></button><button className={aiGame ? "active" : ""} onClick={openAiGameSheet}><Bot/><span>AI</span></button><button aria-current={tab === "settings" ? "page" : undefined} className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings/><span>设置</span></button></nav>
    {importProgress && <ImportProgressCard state={importProgress}/>}
      {enhancementSettings.coachMarks && coachMark && <CoachMark id={coachMark} onAction={handleCoachMarkAction}/>}
    {toast && <AppToast message={toast} onClose={() => setToast("")}/>}

    {pendingSwitch && <BottomSheet title="有未保存草稿" className="draft-guard-backdrop" onClose={() => setPendingSwitch(null)}><div className="sheet-body"><p className="section-note">继续当前操作前请先处理当前未保存的草稿，否则将丢失。</p><button className="primary-button" onClick={savePendingSwitch}><Save/>保存草稿并切换</button><button className="secondary-button" onClick={discardPendingSwitch}><X/>放弃草稿并切换</button><button className="secondary-button" onClick={() => setPendingSwitch(null)}>取消</button></div></BottomSheet>}

    {sheet && <BottomSheet title={sheetTitle} onClose={() => setSheet(null)}>
    {sheet === "batchEdit" && <div className="sheet-body batch-action-sheet">
        <p className="section-note">仅处理普通棋谱，不会改写大型数据库。大型 LIB、DP、DB 只支持单独打开或导出。</p>
        <button className="export-primary-card" disabled={!batchSelectedIds.length} onClick={runBatchExport}><span className="format-icon"><Download/></span><div><b>批量导出</b><small>{batchSelectedIds.length ? "已选择 " + batchSelectedIds.length + " 项" : "请先选择至少一份普通棋谱"}</small></div><Upload/></button>
        <section className="batch-replace-card"><div className="batch-action-heading"><MessageSquareText size={19}/><div><b>批量替换注释</b><small>同时处理节点注释与局面文字</small></div></div><label>查找文字<input value={batchReplaceFrom} onChange={(event) => setBatchReplaceFrom(event.target.value)} placeholder="例如：待复核"/></label><label>替换为<input value={batchReplaceTo} onChange={(event) => setBatchReplaceTo(event.target.value)} placeholder="留空表示删除"/></label><button className="primary-button" disabled={!batchSelectedIds.length || !batchReplaceFrom} onClick={runBatchReplace}><Save/>执行替换</button></section>
        <button className="secondary-button" onClick={closeBatchEdit}><X/>完成</button>
      </div>}
      {sheet === "aiGame" && <div className="sheet-body ai-game-setup">
        <section className="ai-setup-hero"><span><Bot size={24}/></span><div><b>新建人机棋局</b><small>完整开局流程、交换选择与禁手裁判均在本机运行</small></div></section>
        <section className="ai-setup-group"><b>对局规则</b><div className="ai-option-grid two"><button className={aiRuleFamily === "renju" ? "selected" : ""} onClick={() => { setAiRuleFamily("renju"); setAiForbiddenEnabled(true); }}><span>连珠规则</span><small>黑方三三、四四、长连禁手</small></button><button className={aiRuleFamily === "standard" ? "selected" : ""} onClick={() => { setAiRuleFamily("standard"); setAiForbiddenEnabled(false); setAiOpeningRule("free"); }}><span>标准五子棋</span><small>双方自由落子，五子连线获胜</small></button></div></section>
        <section className="ai-setup-group"><b>对局时长</b><div className="ai-time-grid">{AI_TIME_OPTIONS.map((option) => <button key={option.value} className={aiTimeLimitMs === option.value ? "selected" : ""} onClick={() => setAiTimeLimitMs(option.value)} aria-pressed={aiTimeLimitMs === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div><p className="ai-time-note">只统计你的操作时间；AI 思考、浏览历史局面和对局结束后都会暂停。</p></section>
        <section className="ai-setup-group"><b>AI 强度</b><div className="ai-strength-grid fixed">{AI_STRENGTH_OPTIONS.filter((option) => option.value !== "自由").map((option) => <button key={option.value} className={aiStrength === option.value ? "selected" : ""} onClick={() => setAiStrength(option.value)} aria-pressed={aiStrength === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>{AI_STRENGTH_OPTIONS.filter((option) => option.value === "自由").map((option) => <button key={option.value} className={`ai-strength-free-option ${aiStrength === option.value ? "selected" : ""}`} onClick={() => setAiStrength(option.value)} aria-pressed={aiStrength === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}{aiStrength === "自由" && <div className="ai-free-controls"><label><span>思考时间</span><div className="ai-free-time-entry"><input aria-label="自定义思考时间（秒）" type="number" min="0.3" max="300" step="0.1" value={(aiFreeTimeMs / 1000).toFixed(1)} onChange={(event) => setAiFreeTimeMs(Math.max(300, Math.min(300000, Math.round((Number(event.target.value) || 0.3) * 1000))))}/><em>秒</em></div><input aria-label="思考时间滑杆" type="range" min="300" max="300000" step="100" value={aiFreeTimeMs} onChange={(event) => setAiFreeTimeMs(Number(event.target.value))}/><small>可输入 0.3–300 秒，最长 5 分钟</small></label><label><span>搜索深度</span><output>{aiFreeDepth} 层</output><input aria-label="搜索深度滑杆" type="range" min="16" max="128" step="8" value={aiFreeDepth} onChange={(event) => setAiFreeDepth(Number(event.target.value))}/></label></div>}</section>
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
      {sheet === "think" && <div className="sheet-body think-sheet"><section className="think-hero"><span><Bot size={21}/></span><div><b>思考当前局面</b><small>轮到{nextPlayer === "black" ? "黑" : "白"}方 · 只分析，不会自动改谱</small></div></section>{thinkRunning && <div className="think-running"><i/><div><b>正在寻找下一步</b><span>先检查强制成五、连续冲四，再进行迭代加深搜索…</span></div></div>}{!thinkRunning && thinkResult?.move && <section className="think-result"><div className="think-recommend"><span>荐</span><div><small>AI 推荐落点</small><b>{coordinateName(thinkResult.move)}</b></div><em className={thinkResult.source === "verified-vcf" ? "proof" : "search"}>{thinkResult.source === "verified-vcf" ? "已验证强制胜" : thinkResult.source === "rapfi" ? "Rapfi 推荐" : "搜索候选"}</em></div><div className="think-stats"><span><b>{thinkResult.depth}</b> 层深度</span><span><b>{thinkResult.nodes.toLocaleString()}</b> 节点</span><span><b>{Math.round(thinkResult.elapsedMs)}ms</b> 用时</span><span><b>{thinkResult.winRate === undefined ? "暂无" : `${Math.round(thinkResult.winRate * 100)}%`}</b> 胜率</span></div>{thinkResult.source !== "rapfi" && <p className="think-engine-note">当前为{thinkResult.source === "verified-vcf" ? "已验证 VCF" : "自研启发式"}回退，未伪造 Rapfi 胜率。</p>}{thinkResult.candidates?.length ? <div className="think-top-candidates"><small>Top-3 推荐{thinkResult.candidates.length < 3 ? ` · 引擎返回 ${thinkResult.candidates.length} 项` : ""}</small><div>{thinkResult.candidates.slice(0, 3).map((candidate, index) => <div className={`think-candidate ${index === 0 ? "primary" : ""}`} key={`${candidate.move.row}-${candidate.move.col}`}><b>{index + 1}. {coordinateName(candidate.move)}</b><span>{candidate.winRate === undefined ? candidate.score !== undefined && thinkResult.scoreAvailable ? `${Math.round(candidate.score)} 分` : "暂无胜率" : `${Math.round(candidate.winRate * 100)}%`}</span></div>)}</div></div> : <div className="think-top-candidates unavailable"><small>Top-3 推荐</small><span>当前回退搜索只返回主推荐，未把启发式排序冒充 Rapfi 多候选。</span></div>}{thinkResult.principalVariation?.length ? <div className="think-pv"><small>主变化 · 最多 10 手</small><div>{thinkResult.principalVariation.slice(0, 10).map((move, index) => <span key={`${move.row}-${move.col}-${index}`} className={move.player}>{index + 1}. {coordinateName(move)}</span>)}</div></div> : <p className="helper">这是启发式搜索排序结果，不代表已经证明必胜；如需严格证明，可打开“局面分析”搜索 VCF。</p>}<button className="primary-button" onClick={() => { const move = thinkResult.move; if (!move) return; setSheet(null); play(move); }}><GitBranch size={16}/>用推荐落点创建变化</button></section>}{!thinkRunning && !thinkResult?.move && <div className={`sheet-empty think-empty ${thinkVisualState}`}><Bot/><b>{thinkVisualState === "error" ? "思考线程异常" : thinkVisualState === "cancelled" ? "已停止旧局面分析" : thinkVisualState === "unavailable" ? "没有合法推荐点" : "暂时没有可用推荐"}</b><span>{thinkVisualState === "error" ? "本次计算已安全停止，可重新尝试。" : thinkVisualState === "cancelled" ? "棋盘局面已经变化，需要按当前局面重新思考。" : thinkVisualState === "unavailable" ? "棋盘可能已满，或当前规则下没有合法落点。" : "请确认棋盘还有空位，然后点击下方按钮。"}</span></div>}<button className="secondary-button" disabled={thinkRunning} onClick={startThink}>{thinkRunning ? "思考中…" : thinkVisualState === "idle" ? "开始思考" : "重新思考"}</button><p className="helper">AI 会遵守当前棋谱的规则设置。红色禁手点不会作为黑方推荐；Rapfi 只在引擎真实输出胜率时显示胜率，否则明确标记暂无。</p></div>}
      {sheet === "analysis" && <div className="sheet-body analysis-sheet"><section className="vcf-panel"><div className="vcf-heading"><div><span>强制胜证明</span><b>VCF · 连续冲四</b></div><em>最多 5 次进攻</em></div>{!vcfResult && !vcfRunning && <p>穷举进攻方的成五与冲四，并验证防守方所有合法挡点；只有全部防守都失败才报告胜法。</p>}{vcfRunning && <div className="vcf-running"><i/><span>正在搜索合法冲四与全部防点…</span></div>}{vcfResult?.status === "win" && <div className="vcf-result win"><b><Check size={17}/>已找到连续冲四胜法</b><div className="proof-line">{vcfResult.principalVariation.map((move, index) => <span key={`${move.row}-${move.col}-${index}`} className={move.player}>{index + 1}. {coordinateName(move)}</span>)}</div><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small><button onClick={() => { const first = vcfResult.principalVariation[0]; if (first) { setSheet(null); play(first); } }}>从证明首手创建变化</button></div>}{vcfResult?.status === "not-found" && <div className="vcf-result neutral"><b>当前深度未找到 VCF</b><span>这不代表局面无胜，只表示最多 5 次连续冲四内没有证明。</span><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}{vcfResult?.status === "budget" && <div className="vcf-result warning"><b>达到手机计算预算</b><span>搜索已安全中止，没有把未完成结果当作胜法。</span><small>检查 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}<button className="vcf-search-button" disabled={vcfRunning} onClick={() => { void runVcf(); }}><Search size={16}/>{vcfRunning ? "搜索中…" : vcfResult ? "重新搜索 VCF" : "搜索 VCF 胜法"}</button></section><button className="position-search-entry" onClick={() => setSheet("positionSearch")}><span><Search size={18}/></span><div><b>跨谱查找相同局面</b><small>支持旋转、镜像和所有变化节点</small></div><ChevronRight size={18}/></button><p className="section-note">下面是启发式候选排序：综合成五、活四、冲四、活三与防守点，用于研究和标记，不等同于 VCF/VCT 证明。</p><div className="analysis-list">{candidates.map((candidate, index) => <div className="analysis-row" key={`${candidate.position.row}-${candidate.position.col}`}><div className="analysis-rank">{String.fromCharCode(65 + index)}</div><div className="analysis-copy"><b>{coordinateName(candidate.position)} <small>{Math.round(candidate.score)} 分</small></b><span>{candidate.reasons.join(" · ")}</span></div><button className="analysis-mark" onClick={() => markCandidate(index)}>标记</button></div>)}</div>{!candidates.length && <div className="sheet-empty"><Search/><b>当前没有可评估的候选点</b><span>棋盘可能已满，或局面没有明显的局部连接。</span></div>}<div className="analysis-actions"><button className="primary-button" onClick={markTopCandidates}>标记前五候选</button><button className="secondary-button" onClick={() => setSheet("marks")}>打开标注面板</button></div><p className="helper">候选点会保存到当前节点，可导出为 SGF 的 LB 标记。</p></div>}
      {sheet === "comment" && <div className="sheet-body"><textarea autoFocus value={current.comment} placeholder="例如：这里白棋若防在 J9，黑棋可以继续冲四…" onChange={(event) => safeUpdateNode({ comment: event.target.value })}/><p className="helper">注释保存在当前节点，导出 SGF 时会写入 C 属性。</p>{current.renLibAnnotations?.length ? <section className="native-annotation-panel"><h3>原谱内容</h3>{annotationLines(current).map((text, index) => <p key={`${current.id}-native-${index}`}>{text}</p>)}</section> : null}<button className="primary-button" onClick={() => setSheet(null)}><Check/>完成</button></div>}
       {sheet === "tree" && <div className="sheet-body tree-sheet"><TreePanel document={viewDocument} currentId={currentId} path={path} compactIndex={compactIndexOf(document)} onSelect={selectTreeNode}/></div>}
       {sheet === "branches" && <div className="sheet-body"><p className="section-note">当前分叉点有 {branchTotal.toLocaleString()} 条直接分支。下面的“上一个 / 下一个分支”是在这些分支之间切换，不是书签；书签用于记住常用局面，可单独跳转。</p><section className="branch-bookmarks"><button className="branch-bookmarks-head" onClick={() => setBookmarksExpanded((expanded) => !expanded)}><span><GitBranch size={16}/><b>分支书签</b><small>{activeBookmarks.length ? `${activeBookmarks.length} 个已保存局面` : "记录常用局面"}</small></span><ChevronDown className={bookmarksExpanded ? "expanded" : ""}/></button>{bookmarksExpanded && <div className="branch-bookmarks-body"><button className="save-bookmark-button" onClick={saveBranchBookmark}><GitBranch/>保存当前局面为书签</button>{activeBookmarks.map((bookmark) => <div className="branch-bookmark-row" key={bookmark.id}>{editingBookmarkId === bookmark.id ? <div className="bookmark-edit"><input autoFocus value={editingBookmarkName} onChange={(event) => setEditingBookmarkName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commitRenameBranchBookmark(); if (event.key === "Escape") { setEditingBookmarkId(null); setEditingBookmarkName(""); } }} /><button onClick={commitRenameBranchBookmark} aria-label="确认重命名" title="确认"><Check size={15}/></button><button onClick={() => { setEditingBookmarkId(null); setEditingBookmarkName(""); }} aria-label="取消重命名" title="取消"><X size={15}/></button></div> : <><button className="bookmark-jump" onClick={() => jumpToBranchBookmark(bookmark)}><span>书</span><div><b>{bookmark.name}</b><small>{viewDocument.nodes[bookmark.nodeId] ? nodeKindLabel(viewDocument.nodes[bookmark.nodeId]!) : "节点已删除"}</small></div></button><button onClick={() => beginRenameBranchBookmark(bookmark)} aria-label="重命名" title="重命名"><PenLine size={15}/></button><button onClick={() => deleteBranchBookmark(bookmark.id)} aria-label="删除" title="删除"><Trash2 size={15}/></button></>}</div>)}{!activeBookmarks.length && <p className="helper">保存后会记住这个棋谱中的局面位置，不影响其他棋谱。</p>}</div>}</section>{branchTotal > 1 && <div className="branch-switcher"><button onClick={() => switchBranch(-1)} disabled={dynamicNavigationBusy || branchCurrentIndex <= 0}><ChevronLeft/><span>上一个分支</span></button><span>{branchCurrentIndex >= 0 ? `${branchCurrentIndex + 1} / ${branchTotal}` : "选择分支"}</span><button onClick={() => switchBranch(1)} disabled={dynamicNavigationBusy || branchCurrentIndex < 0 || branchCurrentIndex >= branchTotal - 1}><span>下一个分支</span><ChevronRight/></button></div>}<div ref={branchListRef} className="branch-list branch-list-virtual" onScroll={(event) => setBranchScrollTop(event.currentTarget.scrollTop)}>{branchTotal > 0 && <div style={{ height: branchTotal * BRANCH_ROW_HEIGHT, position: "relative" }}>{branchWindow.ids.map((id, offset) => { const index = branchWindow.start + offset; const node = viewDocument.nodes[id]; if (!node) return null; const preview = variationPreview(viewDocument, id, 3); return <button key={id} className={id === branchChildId ? "current-branch" : ""} style={{ position: "absolute", top: index * BRANCH_ROW_HEIGHT, left: 0, right: 0, height: BRANCH_ROW_HEIGHT }} onClick={() => chooseChild(id, branchView.id)} disabled={dynamicNavigationBusy}><span className={`branch-stone ${node.move?.player || node.passPlayer || "black"}`}>{index + 1}</span><div><b>{nodeKindLabel(node)}</b><small>{node.comment || `分支 ${index + 1} · 后续 ${node.children.length} 支`}</small>{preview && <small className="branch-preview">续：{preview}</small>}</div>{id === branchChildId && <em>当前分支</em>}{branchView.preferredChildId === id && id !== branchChildId && <em>主线</em>}<ChevronRight/></button>; })}</div>}{!branchTotal && <div className="sheet-empty"><GitBranch/><b>这里还没有后续分支</b><span>关闭面板，在棋盘空位落子即可创建。</span></div>}</div>{branchPivotId && <button className="branch-create-button" onClick={() => { setCurrentId(branchPivotId); setSheet(null); setToast("已回到上一个分支点，在棋盘空位落子即可创建新分支"); }} disabled={dynamicNavigationBusy}><GitBranch/>回到上一个分支点</button>}{current.parentId && <button className="danger-button" onClick={() => { recordDraft({ type: "delete-subtree", parentId: current.parentId || document.rootId, rootId: currentId }); setCurrentId(current.parentId || document.rootId); setSheet(null); setToast("已加入删除草稿，点击保存后生效"); }} disabled={dynamicNavigationBusy}><Trash2/>删除当前分支及后续</button>}</div>}
      {sheet === "save" && <div className="sheet-body form-grid save-sheet"><label>保存名称<input autoFocus value={viewDocument.metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })}/></label><div className="save-destination" role="tablist" aria-label="保存类型"><button className={saveDestination === "records" ? "selected" : ""} onClick={() => { setSaveDestination("records"); setSaveFolder(libraryFolders.recordFolders[0] || "未分类"); }} role="tab">棋谱</button><button className={saveDestination === "puzzles" ? "selected" : ""} onClick={() => { setSaveDestination("puzzles"); setSaveFolder(libraryFolders.puzzleFolders[0] || "我的题库"); }} role="tab">题库</button></div><label>保存到分组<select value={saveFolder} onChange={(event) => setSaveFolder(event.target.value)}>{(saveDestination === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders).map((folder) => <option key={folder}>{folder}</option>)}</select></label>{saveDestination === "puzzles" && <p className="helper">将当前局面保存为一道练习题，保留当前棋盘上的全部棋子。</p>}<details className="save-info-disclosure"><summary><span><b>编辑棋谱信息</b><small>棋手、赛事、规则与开局设置</small></span><ChevronDown/></summary><div className="save-info-content form-grid"><MetadataFields metadata={viewDocument.metadata} onChange={updateMetadata}/></div></details><button className="primary-button" onClick={() => { void confirmSave(); }}><Save/>确认保存</button></div>}
      {sheet === "metadata" && <div className="sheet-body form-grid"><MetadataFields metadata={viewDocument.metadata} onChange={updateMetadata}/><button className="primary-button" onClick={() => setSheet(null)}><Save/>保存信息</button></div>}
      {sheet === "import" && <div className="sheet-body import-options"><button className="import-choice" onClick={() => { setSheet(null); if (mode === "puzzle") puzzleFileInput.current?.click(); else singleFileInput.current?.click(); }}><span className="format-icon"><Download/></span><div><b>{mode === "puzzle" ? "导入题库文件" : "导入棋谱文件"}</b><small>{mode === "puzzle" ? "puzzles 题库对象、连续坐标串、二维 JSON 数组" : "SGF、LIB、JSON、POS 等格式；题库 JSON 会自动识别"}</small></div><ChevronRight/></button><button className="import-choice" onClick={() => { setSheet(null); imageFileInput.current?.click(); }}><span className="format-icon json"><Download/></span><div><b>图片识谱</b><small>自动定位网格识别棋子与颜色，带手数截图可恢复落子顺序</small></div><ChevronRight/></button>{enhancementSettings.recentImports && recentImports.length > 0 && <section className="recent-imports" aria-label="最近导入"><div className="recent-imports-heading"><b>最近导入</b><small>保留最近 5 个来源文件</small></div><div className="recent-import-list">{recentImports.map((entry) => <button key={entry.id} className="recent-import-item" onClick={() => { void reopenRecentImport(entry); }} aria-label={`重新打开 ${entry.name}`}><span className="recent-import-icon">{entry.kind === "puzzle" ? "题" : "谱"}</span><span className="recent-import-copy"><b title={entry.name}>{entry.name}</b><small>{entry.kind === "puzzle" ? "题库" : "棋谱"} · {entry.available ? "可一键重开" : "文件较大，请重新选择"}</small></span><ChevronRight size={16}/></button>)}</div></section>}{mode === "puzzle" && <p className="helper">题库 JSON 可使用 puzzles 包装格式：每题支持 stones 连续坐标串，或 blackStones / whiteStones 分色坐标串；也兼容旧格式的“坐标,颜色编号”二维数组。side 会作为题目先手读取，空题会跳过。</p>}{mode !== "puzzle" && <p className="helper">图片识谱会自动定位网格并识别棋子颜色；截图带手数时还能恢复落子顺序。识别后请快速核对一遍，题库 JSON 选择后会自动转入题库。</p>}</div>}
      {sheet === "trash" && <div className="sheet-body recycle-bin-sheet"><div className="support-row"><b>已删除内容</b><span>删除后会暂存于此，恢复时会保留原来的文件夹归属。</span></div>{recycleBin.length ? <><div className="recycle-bin-toolbar"><span>{recycleBin.length} 项</span><button className="danger-text-button" onClick={emptyRecycleBin}><Trash2 size={14}/>清空回收站</button></div><div className="recycle-bin-list">{recycleBin.map((entry) => { const isPuzzle = entry.kind === "puzzle-collection"; const title = isPuzzle ? entry.item.title : entry.item.metadata.title; const detail = isPuzzle ? `${entry.item.puzzles.length} 道题 · ${entry.item.source}` : entry.kind === "large-record" ? `大型棋谱 · ${entry.item.nodeCount.toLocaleString()} 节点` : `${entry.item.metadata.black} vs ${entry.item.metadata.white}`; return <article key={`${entry.kind}-${entry.id}`} className="recycle-bin-card"><div className={`recycle-bin-icon ${isPuzzle ? "puzzle" : "record"}`}><ArchiveRestore size={18}/></div><div className="recycle-bin-copy"><b>{title}</b><small>{detail}</small><small>原文件夹：{entry.folder} · {new Date(entry.deletedAt).toLocaleDateString("zh-CN")}</small></div><div className="recycle-bin-actions"><button onClick={() => restoreRecycleEntry(entry)} aria-label={`恢复“${title}”`} title="恢复"><ArchiveRestore size={16}/></button><button className="delete-record" onClick={() => permanentlyDeleteRecycleEntry(entry)} aria-label={`彻底删除“${title}”`} title="彻底删除"><Trash2 size={16}/></button></div></article>; })}</div></> : <div className="sheet-empty"><ArchiveRestore size={34}/><b>回收站是空的</b><span>从棋谱库删除的棋谱、用户题集会先出现在这里。</span></div>}</div>}
      {sheet === "wrongbook" && <div className="sheet-body"><div className="support-row"><b>错题本</b><span>只收录已尝试但当前尚未攻克的题目。</span></div>{wrongPuzzleEntries.length ? <div className="export-options">{wrongPuzzleEntries.map((entry) => <button key={`${entry.collectionId}/${entry.puzzleId}`} className="settings-link" onClick={() => { setSheet(null); guardedOpenPuzzle(entry.collectionIndex, entry.puzzleIndex); }}><span><Layers3/><b>{entry.puzzleTitle}</b><small>{entry.collectionTitle} · {entry.attempts} 次尝试 · {new Date(entry.updatedAt).toLocaleDateString("zh-CN")}</small></span><ChevronRight/></button>)}</div> : <div className="sheet-empty"><Layers3 size={34}/><b>还没有错题</b><span>先做几道题，没过的题会自动收进这里。</span></div>}</div>}
      {sheet === "export" && <div className="sheet-body export-hub">
        <section className="board-share-card">
          <div className="board-share-heading"><span className="format-icon share"><Upload/></span><div><b>分享当前局面</b><small>生成高清 PNG，保留当前旋转、镜像和未保存草稿</small></div></div>
          <div className="board-share-options" aria-label="分享图片内容">
            {([
              ["showMoveNumbers", "手数"],
              ["showCoordinates", "坐标"],
              ["showAnnotations", "标注"],
              ["showWatermark", "水印"],
            ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={boardShareOptions[key]} onChange={(event) => setBoardShareOptions((value) => ({ ...value, [key]: event.target.checked }))}/><i/><span>{label}</span></label>)}
          </div>
          <div className="board-share-actions"><button className="primary-button" disabled={boardShareGenerating} onClick={() => { void shareBoardPng(); }}><Upload/>{boardShareGenerating ? "正在生成…" : "系统分享"}</button><button className="secondary-button" disabled={boardShareGenerating} onClick={() => { void saveBoardSharePng(); }}><Download/>保存 PNG</button></div>
          <p>图片只包含当前可见局面；AI 推荐点、禁手提示和点击区域不会进入图片。</p>
        </section>
        <div className="export-source-card"><span>当前棋谱</span><b>{sourceFormat ? `识别为 ${sourceFormat.toUpperCase()}` : "没有原始文件格式"}</b><small>{sourceFormat ? directExportAvailable ? `可直接导出为 ${directFormatLabel}` : `${directFormatLabel}，当前只能转换导出` : "直接导出默认使用 SGF；也可以自己选择格式"}</small></div>
        {sourceFormat === "lib" && <button className="export-primary-card lib-convert" disabled={!fullLibSgfAvailable || libSgfExporting} onClick={() => { void exportFullLibAsSgf(); }}><span className="format-icon">SGF</span><div><b>{libSgfExporting ? "正在转换完整 LIB…" : "完整 LIB 转换为 SGF"}</b><small>{libSgfSourceTooLarge ? "源文件超过 64MB；转换会额外申请完整 SGF 缓冲区，为避免设备内存不足已停用" : fullLibSgfAvailable ? "由 RenLib 核心转换当前未编辑的完整源棋谱" : "只对当前刚打开且未编辑、仍保留原文件的 LIB 可用"}</small></div><Upload/></button>}
        <button className="export-primary-card choose" onClick={() => setExportFormatMenuOpen((open) => !open)}><span className="format-icon"><Upload/></span><div><b>选择格式导出</b><small>{exportsVisibleDatabaseContent ? "可将已加载路径、可见分支与注释导出为 SGF 或 JSON" : "展开后选择 SGF 或 JSON"}</small></div><ChevronDown className={exportFormatMenuOpen ? "expanded" : ""}/></button>
        {exportFormatMenuOpen && <div className="export-format-list">
          <button onClick={() => exportAsFormat("sgf")}><span className="format-icon">SGF</span><div><b>{exportsVisibleDatabaseContent ? "SGF（当前可见内容）" : "SGF 标准棋谱"}</b><small>{exportsVisibleDatabaseContent ? "只包含已加载路径、可见分支与注释，不代表整个原始数据库" : "完整保留变化树、注释、评价和棋盘标注；兼容 FGF / REN / WZQ 等 SGF 同族文件"}</small></div><Upload/></button>
          <button onClick={() => exportAsFormat("json")}><span className="format-icon json">JSON</span><div><b>{exportsVisibleDatabaseContent ? "JSON（当前可见内容）" : "JSON（半步完整棋谱）"}</b><small>{exportsVisibleDatabaseContent ? "保存当前已加载的浏览窗口，不重新生成 LIB、DP 或 DB 数据库" : "完整保留本应用全部可编辑数据，扩展名为 .json"}</small></div><Upload/></button>
          <button disabled><span className="format-icon muted">LIB</span><div><b>RenLib LIB</b><small>可读取并可原样导出已打开的 LIB；当前不把普通棋谱伪造为 LIB</small></div><Lock/></button>
          <button disabled><span className="format-icon muted">DP</span><div><b>DP / DB 局面数据库</b><small>可原样导出已打开的源文件，但不重新编码或生成新的 DP / DB</small></div><Lock/></button>
        </div>}
        <button className="export-primary-card direct" disabled={!directExportAvailable} onClick={exportDirect}><span className="format-icon direct"><Download/></span><div><b>直接导出</b><small>{sourceFormat ? `已有格式直接导出：${directFormatLabel}` : "当前没有原始格式，将按默认 SGF 导出"}</small></div><Upload/></button>
        <p className="helper">导出位置：{defaultDirectory ? `“${defaultDirectory.name}”文件夹` : supportsDirectoryPicker() ? "浏览器默认下载目录（可在设置中选择文件夹）" : "浏览器默认下载目录"}。LIB 可在当前未编辑会话中完整转换为 SGF，但源文件超过 64MB 时只允许原文件直出或导出当前可见内容；DP / DB 不会被重新编码。</p>
      </div>}
       {sheet === "help" && <div className="sheet-body help-content"><div className="support-row"><b>棋谱导入</b><span>RenLib 3.x / 旧版无头 LIB（按设备能力分页导入）、SGF / FGF、REN / RENJS / WZQ（SGF 语法）、JSON、POS，以及 DP / DB 局面数据库。SGF 支持设置局面、过手、UTF-16 和同文件多盘棋。</span></div><div className="support-row"><b>导出与保真</b><span>普通 SGF 和 JSON 会重新生成当前完整变化树。当前刚打开且未编辑的 LIB 在 64MB 以内可由 RenLib 核心完整转换为 SGF，也可原文件直出；大型 LIB 只允许原文件直出或导出当前可见内容。编辑副本可导出 SGF / JSON，但不会写回 LIB。DP / DB 可原文件直出或导出当前可见内容，不生成新数据库。</span></div><div className="support-row"><b>规则与开局</b><span>连珠规则：黑方受三三、四四、长连禁手约束，双方五连获胜；标准五子棋：双方无禁手，先成五者胜；无禁手：双方自由落子，先成五者胜。开局规则目前支持自由开局、五手两打、五手多打（3–10 打）、塔十（塔拉山口-10）和塔拉（五次交换），可在棋谱信息或人机设置中查看与使用。</span></div><div className="support-row"><b>JSON 的用途</b><span>棋谱库读取本软件的完整变化树或带明确 moves 字段的落子列表对象；题库页读取 puzzles 包装题库、连续坐标串、黑白分色坐标串和旧版二维数组。数字坐标棋谱必须声明 coordinateBase，不猜测任意数组。</span></div><div className="support-row"><b>AI 完全本地</b><span>人机与“思考”使用应用内置 Rapfi WASM 数据，不访问 gomocalc.com，也不会上传当前棋局。</span></div><div className="support-row warning"><b>棋盘路数边界</b><span>棋盘支持 5–25 路方形棋盘，范围外的 SGF SZ 会明确拒绝，不会缩放后生成错误棋谱；内置题库固定为十五路。</span></div><div className="support-row warning"><b>TXT 不是统一棋谱标准</b><span>TXT 仅作为纯文本坐标序列兼容入口，例如 H8 I8 H9；带专有结构的文本应使用原软件导出的 SGF。</span></div><div className="support-row warning"><b>LIB 兼容边界</b><span>大型 LIB 在后台线程解析并按页存储。完整转 SGF 会额外申请整份输出缓冲区，因此源文件超过 64MB 时主动停用，避免手机或低内存设备崩溃。原谱的普通注释、局面文字和 RenLib 标记会分别保留并在节点详情中显示；超出 RenLib 3.4 的扩展仍会提示。</span></div><h3>手机快捷操作</h3><ul><li>点空交叉点：落子；点已有棋子：不会改变局面</li><li>底部“标注”：放置数字、胜败平衡和自定义文字</li><li>长按交叉点：圆圈 → 三角 → 叉号 → 清除</li><li>左右方向键（外接键盘）：前后导航</li></ul><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></div>}
      {sheet === "about" && <div className="sheet-body about-sheet"><section className="about-hero"><span>半</span><div><b>半步五子棋</b><small>版本 1.1.4 · 个人 Vibecoding 项目</small></div></section><section className="creator-message"><b>个人项目说明</b><p>这是一个由个人通过 Vibecoding 制作的五子棋工具。开发过程中借鉴了一些公开的五子棋代码、文件格式和算法实现，仅用于学习、研究和个人使用。如有任何内容涉及侵权，请通过 GitHub 联系，我会立即删除或调整相关内容。</p></section><section className="about-card"><h3><Layers3 size={17}/>后续维护</h3><p>后续有时间会继续更新功能、改善使用体验并修复发现的 Bug。项目的新版网页、安装包和更新说明会优先发布在 GitHub，可从下面的项目主页查看和下载。</p></section><a className="github-link" href="https://github.com/gugujiao953-ship-it/banbu-gomoku" target="_blank" rel="noreferrer"><Code2 size={20}/><span><b>GitHub 项目主页与下载</b><small>github.com/gugujiao953-ship-it/banbu-gomoku</small></span><ChevronRight size={18}/></a><button className="primary-button" onClick={() => setSheet(null)}>完成</button></div>}
      {sheet === "feedback" && <FeedbackPanel version="1.1.4" location={tab === "settings" ? "设置" : tab === "library" ? "棋谱库" : "打谱"} onNotice={setToast}/>}
      {sheet === "marks" && <div className="sheet-body mark-sheet"><p className="section-note">文字、形状和颜色都会保存到当前局面，与节点注释相互独立。</p><section><h3>数字标注</h3><div className="mark-preset-grid numbers">{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><section><h3>局面结论</h3><div className="mark-preset-grid words">{["胜", "败", "平", "平衡", "攻", "守", "要", "疑"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><section><h3>字母标注</h3><div className="mark-preset-grid letters">{["A", "B", "C", "D", "E"].map((label) => <button key={label} onClick={() => { setCandidateLabel(label); setSheet(null); }}><span>{label}</span></button>)}</div></section><div className="mark-custom-section"><h3>自定义文字</h3><div className="custom-mark-row"><input maxLength={4} value={customMarkLabel} onChange={(event) => setCustomMarkLabel(event.target.value)} placeholder="输入最多 4 个字"/><button disabled={!customMarkLabel.trim()} onClick={() => { setCandidateLabel(Array.from(customMarkLabel.trim()).slice(0, 4).join("")); setSheet(null); }}>使用</button></div><button className="mark-delete-button" disabled={!current.marks.length} onClick={() => { safeClearMarks(); setCandidateLabel(null); setSheet(null); setToast("已清除当前局面的全部标注"); }}><Trash2/>删除现有标注{current.marks.length ? `（${current.marks.length}）` : ""}</button></div></div>}
      {sheet === "manual" && <UserManual onClose={() => setSheet(null)}/>}
    </BottomSheet>}
  </div>;
}

type ManualIconName = "home" | "new" | "save" | "import" | "export" | "library" | "folder" | "comment" | "mark" | "search" | "branch" | "tree" | "ai" | "undo" | "backup" | "settings" | "help" | "info";

const manualSections: Array<{ icon: ManualIconName; title: string; summary: string; body: string[]; steps?: string[]; tip?: string }> = [
  { icon: "home", title: "打谱首页：认识主界面", summary: "这里是落子、浏览和编辑棋谱的主要工作区。", body: ["打开应用后默认进入打谱页。上方是当前棋谱名称与保存状态，中间是棋盘，下方是行棋、编辑、更多和标注工具。底部导航用于切换打谱、棋谱库、导入、AI 和设置。", "棋盘上的每个交叉点都对应一个位置。空点可以落子，已有棋子不会被覆盖；当前手、禁手点、候选点和胜线会用不同的颜色或形状区分。"], steps: ["先看棋盘中央的当前局面。", "需要落子时直接点击空交叉点。", "需要切换功能时使用棋盘下方的工具栏。"], tip: "如果不确定某个按钮做什么，可以先打开本手册对应条目；手册中的图标就是界面实际使用的图标。" },
  { icon: "new", title: "新建空白棋局", summary: "清理当前棋盘并开始一份新的空白棋谱。", body: ["棋盘下方的文件加号图标就是“新建空白棋局”。点击后会创建一个只有起始局面的新棋谱，当前棋盘上的棋子、当前浏览位置和临时标注都会切换到新的空白局面。", "如果当前存在未保存草稿，系统不会直接清理，而是先要求你选择保存草稿、放弃草稿或取消。这是为了防止误删正在编辑的变化。"], steps: ["点击棋盘下方的文件加号图标。", "没有草稿时直接进入空棋盘。", "有草稿时选择“保存草稿并切换”或“放弃草稿并切换”。"], tip: "新建不会删除棋谱库里已经保存的旧棋谱；它只会切换当前编辑会话。" },
  { icon: "save", title: "保存棋谱与草稿保护", summary: "把当前修改写入本机棋谱库。", body: ["顶部保存图标用于提交当前棋谱修改。普通棋谱会保存到本机存储；大型 LIB、DP、DB 浏览源会按照应用的编辑副本规则处理，不会擅自改写原始数据库。", "落子、删除变化、注释、标注和棋谱信息修改后会先形成未保存草稿。看到“有未保存草稿”时，切换棋谱、导入或新建前都要先处理它。"], steps: ["编辑棋盘或信息。", "点击保存图标提交修改。", "等待状态变为“已保存”后再关闭或切换。"], tip: "保存失败时不要反复覆盖原文件；先导出备份或查看错误提示。" },
  { icon: "import", title: "导入棋谱与题库", summary: "打开 SGF、LIB、JSON、POS、DP、DB 等文件。", body: ["底部中间的下载箭头是导入入口。它会根据当前模式打开棋谱文件或题库文件选择器。普通棋谱支持 SGF/FGF、REN/RENJS/WZQ、JSON、POS、TXT 等兼容格式；大型 LIB、DP、DB 会在后台解析或按需读取。", "导入过程中会显示解析、索引和完成状态。大型文件不要在后台解析时强制关闭页面，否则可能需要重新建立索引。"], steps: ["点击底部“导入”。", "选择“导入棋谱文件”或“图片识谱”。", "选择文件后等待解析完成，再检查棋盘、分支和注释。"], tip: "TXT 只是坐标序列兼容入口，不是统一棋谱标准；重要棋谱优先使用原软件导出的 SGF。" },
  { icon: "export", title: "导出与分享", summary: "保存为 SGF/JSON，或生成棋盘图片分享。", body: ["顶部上传箭头是导出入口。普通棋谱可导出为完整 SGF 或应用完整 JSON；刚打开的原始 LIB、DP、DB 可以按界面提示原样导出或导出当前可见内容。", "分享图片会按当前棋盘、棋子主题、坐标、手数、标注和水印选项生成 PNG。导出的图片是副本，不会改变原棋谱。"], steps: ["点击顶部导出图标。", "选择直接导出或指定 SGF/JSON。", "如需发给别人，选择图片导出并检查预览。"], tip: "大型数据库不等于已经全部加载；导出的“当前可见内容”只代表已打开的路径和分支。" },
  { icon: "library", title: "棋谱库：查找与打开棋谱", summary: "管理已经保存的棋谱、题库和文件夹。", body: ["底部“棋谱库”用于查看本机保存的普通棋谱和大型棋谱。顶部的“题库/棋谱”切换按钮只改变当前列表，不会改变棋谱数据。搜索框可以按棋谱名、棋手、赛事或主题筛选。", "点击一条棋谱会回到打谱页并打开它；右侧编辑图标用于重命名，垃圾桶用于删除。删除前如果有草稿，系统会先要求处理草稿。"], steps: ["进入底部“棋谱库”。", "选择“棋谱”或“题库”。", "搜索、打开、重命名或删除目标记录。"], tip: "删除的内容会进入回收站，不是立即永久消失。" },
  { icon: "folder", title: "文件夹整理", summary: "用文件夹给棋谱和题集分类。", body: ["棋谱库中的文件夹用于整理记录，不会改变棋谱内容。可以新建文件夹、重命名文件夹，并通过每条记录的下拉选择移动到其他文件夹。", "题库和棋谱拥有各自的文件夹体系；在题库页整理题集，不会把题集混入棋谱列表。"], steps: ["在棋谱库点击“新建文件夹”。", "在记录或题集的文件夹选择器中重新归类。", "点击文件夹标题展开或收起内容。"], tip: "文件夹只是管理视图，备份和恢复时会一并保留归类信息。" },
  { icon: "comment", title: "注释与棋谱信息", summary: "记录当前局面的讲解、棋手和赛事信息。", body: ["棋盘下方“编辑”里的对话框图标打开当前节点注释。注释属于当前节点，可以随着变化树保存并导出到 SGF 的 C 属性。", "“信息”入口用于编辑棋谱名称、黑方、白方、赛事/主题、日期、规则和开局规则。信息修改也会进入草稿，需要保存后才正式写入。"], steps: ["点击“编辑”→“注释”填写说明。", "点击“编辑”→“信息”修改棋谱元数据。", "点击保存提交。"], tip: "节点注释和棋盘上的数字、胜负、攻守标注是两套独立信息，可以同时使用。" },
  { icon: "mark", title: "棋盘标注", summary: "在局面上放置数字、结论、字母或自定义文字。", body: ["棋盘下方的标签图标打开标注面板。数字适合表示阅读顺序，胜/败/平衡/攻/守等文字适合表达判断，字母或自定义文字适合建立个人记号。", "长按棋盘交叉点也可以快速循环标记样式：圆圈、三角、叉号，再次操作可清除。标注会绑定到当前节点，不会自动套用到其他分支。"], steps: ["进入“标注”面板选择一种标记。", "或长按一个交叉点快速标注。", "需要删除时在标注面板清除当前局面标注。"], tip: "标注不是落子；它不会改变轮到谁，也不会参与胜负判定。" },
  { icon: "undo", title: "走棋导航与撤销", summary: "在起点、上一手、下一手和终点之间浏览。", body: ["“行棋”面板包含起点、上一手、下一手、终点和分支入口。它只改变当前浏览节点，不会删除棋谱内容。", "如果当前有草稿，“撤销”只撤销最近一次草稿操作；“放弃”会清除当前未保存修改并恢复到最近保存状态。"], steps: ["点击“行棋”展开导航按钮。", "使用左右方向键也可以前后浏览。", "编辑中的临时操作用撤销回退，全部不要时用放弃。"], tip: "浏览旧节点后再落子通常会创建变化分支，不会悄悄覆盖原主线。" },
  { icon: "branch", title: "变化分支与棋谱树", summary: "查看、切换和理解同一局面下的不同变化。", body: ["当某个节点有多个后续走法时，棋盘下方会显示分支提示。分支面板列出当前分叉点的直接子变化，可以在分支之间切换，也可以回到分叉点创建新变化。", "棋谱树以层级方式展示整份变化树，点击节点可跳到对应局面。大型棋谱采用按需窗口显示，避免一次性渲染全部节点。"], steps: ["点击“行棋”→“分支”或“棋谱树”。", "选择目标分支或树节点。", "回到分叉点后在空位落子即可创建新分支。"], tip: "切换分支不会删除其他变化；只有明确使用删除功能并保存后才会移除。" },
  { icon: "search", title: "查找与跨谱局面检索", summary: "在当前棋谱或整个棋谱库中快速定位内容。", body: ["“更多”里的查找可以按坐标、手数、标注、注释和局面文字搜索当前棋谱。跨谱查找会在已建立索引的棋谱库中寻找相同局面，并可选择是否把旋转和镜像视为同一局面。", "点击结果会直接跳到匹配节点；搜索只改变视图，不会修改棋谱。"], steps: ["在“更多”中点击“查找”或“跨谱查找”。", "输入坐标、关键词或局面条件。", "点击结果打开对应节点。"], tip: "大型数据库的索引可能在后台建立；索引未完成时，结果范围会明确提示。" },
  { icon: "ai", title: "AI 人机对战", summary: "在本机与 Rapfi AI 对弈。", body: ["底部 AI 入口用于新建人机棋局。可以选择连珠规则或标准五子棋、执黑或执白、开局规则和 AI 强度。AI 和规则判断在本机运行，不上传当前棋局。", "开局规则需要按照界面提示完成交换、五手两打、五手多打、塔十或塔拉等步骤；在特殊阶段，棋盘会限制可落子区域并给出说明。"], steps: ["点击底部“AI”。", "选择规则、强度、执子方和开局规则。", "点击开始后按状态提示落子或等待 AI。"], tip: "如果 AI 正在思考，先等待或使用停止按钮；不要连续点击开始，避免重复启动计算线程。" },
  { icon: "tree", title: "局面思考与候选点", summary: "让 AI 分析当前局面并显示推荐走法。", body: ["“思考”会分析当前局面，显示候选点、排序理由、节点数和耗时；Rapfi 能提供真实胜率时会显示胜率，否则会明确标记为暂无。", "候选点是研究辅助，不等于裁判证明。VCF 等专项搜索会单独说明是否找到完整证明，不要把普通启发式候选当成必胜结论。"], steps: ["在打谱页点击 AI 思考入口。", "等待分析完成或取消。", "查看候选理由，必要时标记或从首手创建变化。"], tip: "分析结果只针对当前节点；切换棋谱或落子后应重新思考。" },
  { icon: "backup", title: "一键备份与恢复", summary: "迁移棋谱库、题库、设置和进度。", body: ["设置中的“一键备份”会打包普通棋谱、大型棋谱索引清单、题库、做题进度、草稿、主题和音效设置。恢复前会校验版本和内容，失败会回滚，避免半恢复状态。", "备份文件是数据迁移副本，不等于把文件上传到云端。请把导出的 JSON 备份保存到可靠位置。"], steps: ["设置→数据与兼容→一键备份。", "在新浏览器或新设备进入同一位置选择“恢复备份”。", "等待校验完成，再检查棋谱库和设置。"], tip: "原始 LIB/DP/DB 文件本身不一定包含在备份包中；如需保留原文件，请单独保存源文件。" },
  { icon: "settings", title: "外观、棋盘与声音设置", summary: "调整主题、棋盘材质、棋子材质和音效。", body: ["外观主题控制应用整体色彩和背景；棋盘与棋子控制棋盘材质、棋子外观；声音与反馈控制音效总开关、音色、音量和提示音类别。", "这些设置只影响显示和反馈，不改变棋谱规则、落子结果或文件格式。声音使用轻量程序化音效，不下载大音频包。"], steps: ["设置→外观主题选择整体风格。", "设置→棋盘与棋子选择材质。", "设置→声音与反馈试听并调整音量。"], tip: "夜间或长时间复盘可选择深色/护眼主题，并关闭不需要的动效或声音。" },
  { icon: "settings", title: "棋盘显示、动效和无障碍", summary: "控制手数、坐标、禁手提示、动效和字号。", body: ["“棋盘显示”可以开关落子手数、坐标、禁手辅助和界面动效。无障碍与字号可以把界面文字放大到大字或特大字，棋盘本身不会被强行拉伸。", "界面支持键盘焦点、可见焦点轮廓、屏幕阅读器标签和减少动态效果路径。关闭动效后仍会保留颜色、文字和图标等状态信息。"], steps: ["设置→棋盘显示调整显示辅助。", "设置→无障碍与字号选择文字大小。", "需要安静或减少刺激时关闭界面动效。"], tip: "颜色不是唯一信息来源；禁手、选中和错误状态同时有形状或文字提示。" },
  { icon: "import", title: "图片识谱", summary: "从棋盘截图识别棋子，并进入可校对的棋谱草稿。", body: ["图片识谱会尝试定位棋盘网格、识别黑白棋子，并在有手数信息时推断落子顺序。识别结果不会直接写入棋谱库，而是先打开为可检查的当前会话。", "由于截图可能有透视、阴影、棋子遮挡或主题差异，识别后必须逐点核对，尤其是边缘棋子、最后一步和棋子颜色。"], steps: ["底部导入→图片识谱，或从棋谱库点击图片识谱。", "选择 PNG/JPG/WebP 等棋盘截图。", "检查棋盘和手数，确认后再保存。"], tip: "图片越正、棋盘边界越完整、棋子越清晰，识别结果越可靠。" },
  { icon: "help", title: "格式兼容与规则边界", summary: "了解可读、可写和不会被误处理的格式。", body: ["设置→数据与兼容→格式兼容说明会解释 SGF、JSON、LIB、DP、DB、TXT 的能力边界。应用支持 5–25 路方形棋盘，但内置题库固定为十五路。", "连珠规则会约束黑方三三、四四和长连；标准五子棋与无禁手模式不启用这些禁手。导入时如果棋盘尺寸、坐标基准或格式结构不明确，应用会拒绝或提示，而不是猜测。"], steps: ["先查看文件扩展名和来源。", "导入后检查规则、路数和分支。", "需要交给其他软件时优先导出标准 SGF。"], tip: "大型 LIB/DP/DB 的“原样导出”和“当前可见内容导出”含义不同，请看导出面板说明。" },
  { icon: "undo", title: "回收站与删除恢复", summary: "恢复误删的棋谱，或永久清理不需要的记录。", body: ["棋谱库和题库中的删除操作会把记录移到回收站。回收站里可以查看删除项目、恢复项目或永久删除。恢复后会重新回到原有的管理数据中。", "永久删除不可依赖应用恢复，因此请在清理前确认标题、来源和删除范围。"], steps: ["进入棋谱库或题库。", "打开回收站。", "选择恢复或确认永久删除。"], tip: "如果删除前有未保存草稿，先处理草稿再删除，避免把临时修改误当成正式版本。" },
  { icon: "info", title: "关于、反馈与更新", summary: "查看版本、项目说明、下载和问题反馈入口。", body: ["设置中的“关于”会显示当前版本、项目说明和 GitHub 下载入口；“反馈问题或建议”用于提交可复现的问题、功能想法和设备信息。", "反馈时最好附上操作步骤、棋谱格式、设备/浏览器、是否能稳定复现，以及页面提示或诊断信息。不要在公开反馈中放入私人棋谱或敏感文件。"], steps: ["设置→关于查看版本和项目主页。", "设置→使用手册与反馈→反馈问题或建议。", "按步骤描述问题并附必要截图。"], tip: "提交前先确认是否为当前版本问题，并说明是网页、PWA 还是 Android 安装包。" },
];

function ManualIcon({ name }: { name: ManualIconName }) {
  const props = { size: 20, strokeWidth: 2 };
  if (name === "home") return <Home {...props}/>;
  if (name === "new") return <FilePlus2 {...props}/>;
  if (name === "save") return <Save {...props}/>;
  if (name === "import") return <Download {...props}/>;
  if (name === "export") return <Upload {...props}/>;
  if (name === "library") return <Library {...props}/>;
  if (name === "folder") return <FolderOpen {...props}/>;
  if (name === "comment") return <MessageSquareText {...props}/>;
  if (name === "mark") return <Tag {...props}/>;
  if (name === "search") return <Search {...props}/>;
  if (name === "branch") return <GitBranch {...props}/>;
  if (name === "tree") return <ListTree {...props}/>;
  if (name === "ai") return <Bot {...props}/>;
  if (name === "undo") return <Undo2 {...props}/>;
  if (name === "backup") return <ArchiveRestore {...props}/>;
  if (name === "settings") return <Settings {...props}/>;
  if (name === "help") return <CircleHelp {...props}/>;
  return <Info {...props}/>;
}

function UserManual({ onClose }: { onClose: () => void }) {
  return <div className="sheet-body manual-sheet"><div className="manual-intro"><span className="manual-intro-icon"><BookOpen size={24}/></span><div><b>先看这里，再开始操作</b><p>本手册按“打谱 → 管理 → 分析 → 设置”介绍所有主要功能。点击下面任意条目展开详细说明；每个条目顶部的图标就是界面中的真实图标。</p></div></div><div className="manual-icon-legend"><span>图标示例</span><div><span><Home size={15}/>主界面</span><span><Save size={15}/>保存</span><span><Download size={15}/>导入</span><span><Bot size={15}/>AI</span><span><Settings size={15}/>设置</span></div></div><div className="manual-list">{manualSections.map((section, index) => <details className="manual-item" key={section.title}><summary><span className="manual-icon-shot"><ManualIcon name={section.icon}/></span><span className="manual-summary-copy"><b>{String(index + 1).padStart(2, "0")} · {section.title}</b><small>{section.summary}</small></span><ChevronDown className="manual-chevron" size={18}/></summary><div className="manual-item-body">{section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.steps && <div className="manual-steps"><b>怎么操作</b><ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>}{section.tip && <div className="manual-tip"><Info size={15}/><span><b>小提示</b>{section.tip}</span></div>}</div></details>)}</div><button className="primary-button" onClick={onClose}><Check/>知道了</button></div>;
}

function MetadataFields({ metadata, onChange }: { metadata: GameDocument["metadata"]; onChange: (patch: Partial<GameDocument["metadata"]>) => void }) {
  return <><label>棋谱名称<input value={metadata.title} onChange={(event) => onChange({ title: event.target.value })}/></label><div className="two-cols"><label>黑方<input value={metadata.black} onChange={(event) => onChange({ black: event.target.value })}/></label><label>白方<input value={metadata.white} onChange={(event) => onChange({ white: event.target.value })}/></label></div><label>赛事 / 主题<input value={metadata.event} onChange={(event) => onChange({ event: event.target.value })}/></label><div className="two-cols"><label>日期<input type="date" value={metadata.date} onChange={(event) => onChange({ date: event.target.value })}/></label><label>规则<select value={metadata.rule} onChange={(event) => onChange({ rule: event.target.value as GameDocument["metadata"]["rule"] })}><option value="renju">连珠规则</option><option value="standard">标准五子棋</option><option value="freestyle">无禁手</option></select></label></div><label>开局规则<select value={metadata.openingRule || "free"} onChange={(event) => onChange({ openingRule: event.target.value as OpeningRule, openingN: event.target.value === "five-n" ? (metadata.openingN || 3) : undefined })}>{OPENING_RULE_OPTIONS.map(([rule, title]) => <option key={rule} value={rule}>{title}</option>)}</select></label>{metadata.openingRule === "five-n" && <label>五手多打候选数<input type="number" min="3" max="10" value={metadata.openingN || 3} onChange={(event) => onChange({ openingN: Math.max(3, Math.min(10, Number(event.target.value) || 3)) })}/></label>}<p className="helper">开局规则会作为棋谱信息保存；五手两打、五手多打、塔十和塔拉目前可在人机模式中使用。</p></>;
}

function SettingsSection({ title, summary, open = false, children }: { title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return <details className="settings-group settings-collapsible" open={open}><summary className="settings-section-toggle"><span className="settings-section-title"><b>{title}</b><small>{summary}</small></span><ChevronDown/></summary><div className="settings-section-content">{children}</div></details>;
}

function StorageSettings({ defaultDirectory, directorySupported, onChoose, onClear }: { defaultDirectory: DirectoryHandleLike | null; directorySupported: boolean; onChoose: () => void; onClear: () => void }) {
  return <div className="storage-settings-body"><div className="storage-summary"><span className="storage-icon"><Save size={18}/></span><div><div className="storage-summary-heading"><b>应用内保存</b><em>本机</em></div><p>保存按钮写入本机棋谱库，可在“棋谱库”中继续查看和编辑。</p></div></div><div className="storage-divider"/><div className="storage-destination"><span className={`storage-icon folder ${defaultDirectory ? "ready" : ""}`}><FolderOpen size={18}/></span><div className="storage-destination-copy"><div className="storage-summary-heading"><b>默认导出文件夹</b>{defaultDirectory && <em className="ready">已设置</em>}</div><p>{defaultDirectory ? `导出文件会直接写入“${defaultDirectory.name}”` : directorySupported ? "尚未设置，将使用浏览器默认下载目录" : "当前浏览器不支持选择文件夹，将使用默认下载目录"}</p></div><button className="storage-action" onClick={onChoose}>{defaultDirectory ? "更换" : "选择"}</button></div>{defaultDirectory && <button className="storage-remove" onClick={onClear}><X size={14}/>取消默认位置</button>}<div className="storage-tip"><Info size={14}/><span>{directorySupported ? "网页只会记住文件夹授权和名称，不会读取系统完整路径；可随时更换。" : "可在支持目录权限的浏览器中选择文件夹；当前环境会继续使用默认下载目录。"}</span></div></div>;
}

function SettingRow({ title, text, checked, disabled = false, onChange }: { title: string; text: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className={`setting-row ${disabled ? "disabled" : ""}`}><span><b>{title}</b><small>{text}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/><i/></label>;
}

function EnhancementSettingsPanel({ settings, onChange }: { settings: EnhancementSettings; onChange: (value: EnhancementSettings) => void }) {
  const update = (patch: Partial<EnhancementSettings>) => onChange({ ...settings, ...patch });
  return <div className="enhancement-settings">
    <p className="settings-feature-note">下面这些功能会增加界面提示或触摸处理，默认关闭；需要时逐项打开即可。</p>
    <SettingRow title="双指缩放棋盘" text="用两根手指放大或缩小棋盘，适合平板复盘" checked={settings.gestureZoom} onChange={(gestureZoom) => update({ gestureZoom })}/>
    <SettingRow title="双指滑动切手" text="双指左右滑动切换上一手或下一手" checked={settings.gestureSwipe} onChange={(gestureSwipe) => update({ gestureSwipe })}/>
    <SettingRow title="最近导入列表" text="在导入面板保留最近 5 个可快速重开的文件" checked={settings.recentImports} onChange={(recentImports) => update({ recentImports })}/>
    <SettingRow title="AI 棋盘提示点" text="在棋盘上显示 AI 推荐落点和开局候选编号" checked={settings.aiBoardHints} onChange={(aiBoardHints) => update({ aiBoardHints })}/>
    <SettingRow title="操作引导卡片" text="在记录、棋谱库和设置页显示轻量使用提示" checked={settings.coachMarks} onChange={(coachMarks) => update({ coachMarks })}/>
  </div>;
}

function SoundSettingsPanel({ settings, onChange, onPreview }: { settings: SoundSettings; onChange: (value: SoundSettings) => void; onPreview: (cue: SoundCue) => void }) {
  const update = (patch: Partial<SoundSettings>) => onChange({ ...settings, ...patch });
  return <div className="sound-settings">
    <SettingRow title="启用音效" text="关闭后不会创建或唤醒音频上下文" checked={settings.enabled} onChange={(enabled) => update({ enabled })}/>
    <SettingRow title="落子与导航音" text="黑白落子使用不同音色，前后浏览使用轻提示" checked={settings.moveEnabled} onChange={(moveEnabled) => update({ moveEnabled })}/>
    <SettingRow title="结果与警告音" text="胜利、禁手、非法操作与错误反馈" checked={settings.feedbackEnabled} onChange={(feedbackEnabled) => update({ feedbackEnabled })}/>
    <div className="sound-profile">
      <span><b>落子音色</b><small>只改变黑白落子的质感，导航与提示音保持清晰</small></span>
      <div role="radiogroup" aria-label="落子音色">
        {([[
          "classic", "经典", "均衡、熟悉",
        ], ["wood", "木石", "低沉、短促"], ["crystal", "清响", "明亮、轻柔"]] as const).map(([profile, label, text]) => <button key={profile} type="button" className={settings.profile === profile ? "selected" : ""} role="radio" aria-checked={settings.profile === profile} onClick={() => update({ profile })}><b>{label}</b><small>{text}</small><Check aria-hidden="true"/></button>)}
      </div>
    </div>
    <label className={`sound-volume ${!settings.enabled ? "disabled" : ""}`}>
      <span><b>音量</b><small>只调整半步五子棋，不改变系统媒体音量</small></span>
      <output>{Math.round(settings.volume * 100)}%</output>
      <input aria-label="音效音量" type="range" min="0" max="100" step="1" value={Math.round(settings.volume * 100)} disabled={!settings.enabled} onChange={(event) => update({ volume: Number(event.target.value) / 100 })}/>
    </label>
    <div className="sound-preview" aria-label="试听音效">
      <button type="button" disabled={!settings.enabled || !settings.moveEnabled} onClick={() => onPreview("move-black")}>试听落子</button>
      <button type="button" disabled={!settings.enabled || !settings.feedbackEnabled} onClick={() => onPreview("success")}>试听完成</button>
      <button type="button" disabled={!settings.enabled || !settings.feedbackEnabled} onClick={() => onPreview("warning")}>试听警告</button>
    </div>
    <p className="sound-budget-note">音效由 Web Audio 实时合成，不下载声音文件；首次试听或落子后才会启用浏览器音频。</p>
  </div>;
}

function VisualThemeSettings({ boardTheme, stoneTheme, onBoardThemeChange, onStoneThemeChange }: { boardTheme: BoardTheme; stoneTheme: StoneTheme; onBoardThemeChange: (value: BoardTheme) => void; onStoneThemeChange: (value: StoneTheme) => void }) {
  const boards: Array<[BoardTheme, string, string]> = [["wood", "原木棋盘", "温暖木色，默认风格"], ["jade", "玉石棋盘", "青玉底色，柔和对比"], ["notebook", "练习本", "纸张横线与红色边线"], ["emerald", "翡翠棋盘", "深翠绿与金色网格"], ["porcelain", "青花瓷棋盘", "青白瓷纹与清晰网格"], ["whitejade", "白玉棋盘", "柔白玉色，冷静通透"], ["walnut", "深胡桃木", "深棕木纹与暖色边框"], ["frosted", "磨砂玻璃", "半透明雾面与柔和网格"], ["circuit", "电路棋盘", "暗色底与蓝绿发光线路"], ["minimal", "极简棋盘", "纯色棋面与清晰灰黑网格"]];
  const stones: Array<[StoneTheme, string, string]> = [["classic", "经典棋子", "黑白高光"], ["jade", "玉石棋子", "青玉与白玉"], ["yun", "云子棋子", "温润黑白云子"], ["ink", "墨蓝棋子", "练习本墨水质感"], ["mono", "黑白极简", "纯黑纯白，无光泽"], ["notebook", "勾叉棋子", "黑叉与红勾手绘笔迹"], ["porcelain", "青花瓷棋子", "青白瓷釉与蓝色纹样"], ["snow", "雪晶棋子", "冰晶质感与冷色边缘"], ["terminal", "终端字符棋子", "X / O 字符，避开禁手红叉"], ["gold-diamond", "黑钻白金棋子", "黑棋钻石质感，白棋黄金质感"]];
  return <div className="visual-theme-settings"><div><b className="visual-theme-label">棋盘材质</b><div className="visual-option-grid">{boards.map(([value, label, text]) => <button key={value} type="button" className={boardTheme === value ? "selected" : ""} onClick={() => onBoardThemeChange(value)}><i className={`board-preview ${value}`} aria-hidden="true"/><span><b>{label}</b><small>{text}</small></span><Check className="visual-check" aria-hidden="true"/></button>)}</div></div><div><b className="visual-theme-label">棋子材质</b><div className="visual-option-grid">{stones.map(([value, label, text]) => <button key={value} type="button" className={stoneTheme === value ? "selected" : ""} onClick={() => onStoneThemeChange(value)}><i className={`stone-preview ${value}`} aria-hidden="true"/><span><b>{label}</b><small>{text}</small></span><Check className="visual-check" aria-hidden="true"/></button>)}</div></div><p className="visual-theme-note"><b>建议关闭显示手数。</b> 手绘勾叉需要保持笔触完整；禁手叉号、AI 推荐点、胜负光效和落子编号会自动使用适合当前材质的对比色，动画也会尊重系统的减少动态效果设置。</p></div>;
}
