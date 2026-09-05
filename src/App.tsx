import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore, ArrowDownUp, BookOpen, Bot, Check, ChevronDown, ChevronFirst, ChevronLast, ChevronLeft,
  ChevronRight, CircleHelp, Download, FilePlus2, FlipHorizontal, FolderOpen, FolderPlus, GitBranch,
  GripVertical, Home, Info, Layers3, Library, Lock, ListTree, Mail, Maximize2, Menu, MessageSquareText, Minimize2, MoreHorizontal, RotateCw, Search, Tag,
  PenLine, Redo2, Save, Settings, Sparkles, Trash2, Undo2, Upload, X,
} from "lucide-react";
import { solveVcf, vcfCoordName, type VcfRules } from "./features/vcf/vcf-generator";
import { toKaibaoCollectionJson, VCF_TIER_LABEL, loadVcfMaterial, type VcfTier, type VcfGenMode, type GeneratedVcfPuzzle, type MaterialFile } from "./features/vcf/vcf-corpus";
import { applyOrder, isLibraryOrderMaps, moveRelative, remapFolderOrder, removeFromOrder, sortIdsByTitles, type LibraryOrderKind, type LibraryOrderMaps } from "./library-order";
import { attachLibraryTouchDrag } from "./library-touch-drag";
import {
  addMove, addMoveAs, boardAt, coordinateName, createDocument, deleteVariation, depthOf, isSupportedBoardSize,
  forbiddenPoints, forbiddenReason, lastOnPreferredLine, nextPlayerAt, otherPlayer, pathToNode, preferredNext, setLabelMark, toggleMark, updateNode, winningLinesAt,
} from "./game";
import { analyzeCandidates } from "./analysis";
import { downloadFile, exportJson, exportPos, exportSgf, importRecordFile, mainLineLength } from "./formats";
import { recognizeBoardImage, type ImageRecognitionResult } from "./image-recognition";
import { findPositionMatches, positionKey } from "./position-search";
import { loadActive, loadDraftFromLocal, loadLibrary, removeDraftFromLocal, removeFromLibrary, renameInLibrary, saveDraftToLocal, saveManyToLibrary, saveToLibrary } from "./storage";
import { commitDraftAsDerivedVersion, documentFingerprint, documentHasDraft, loadDraftForDocument, loadLargeDocument, loadLargeSummaries, moveLargeDocumentToTrash, removeDraftForDocument, removeLargeDocument, removeLargeTrashDocument, renameLargeDocument, restoreLargeDocumentFromTrash, saveCompactIndex, saveDraftForDocument, saveLargeDocument } from "./large-storage";
import { openLibraryHandle } from "./library-engine";
import { isPagedLibraryView, LibraryViewSession } from "./library-view-adapter";
import { DpViewSession, isDpDatabaseView } from "./dp-view-session";
import { RenLibWebViewSession, isRenLibWebView } from "./renlib-web/renlib-web-view-session";
import { compactBranchCount, compactChildCount, compactChildWindow, compactDiagnostics, compactFirstBranchNodeId, compactIndexOf, compactNodeCount, compactNodeIndex, compactSearch, createLazyDocument } from "./compact-index";
import { formatRenLibWebLabel, renLibDisplayMark } from "./renlib-display";
import { createEditableViewCopy, findVisibleVariationTarget, renderableBoardVariationNodes, visibleVariationPivot } from "./record-editing";
import { clearDefaultDirectoryHandle, loadDefaultDirectoryHandle, nativeExportDirectoryHandle, pickDefaultDirectoryHandle, supportsDirectoryPicker, supportsNativeExportDirectory, writeFileToDirectory, type ExportDirectoryHandle } from "./file-destination";
import { boardShareFilename, renderBoardSharePng, type BoardShareOptions } from "./board-image-export";
import { sharePngFile } from "./share-file";
import { transformBoardPosition, type BoardRotation } from "./board-transform";
import { recordAction } from "./diagnostics";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, hasDraft, overlayChildren, overlayNode, overlayPreferredChild, projectedDocument, pushDraft, redoDraft, undoDraft, type DraftState, type DraftOperation as DraftOp } from "./draft-operations";
import type { CompactRenLibIndex, RuleSet } from "./types";
import type { LargeDocumentSummary } from "./large-storage";
import VcfWorker from "./vcf.worker?worker";
import VcfGenWorker from "./features/vcf/vcf-gen.worker?worker";
import RecordImportWorker from "./record-import.worker?worker";
import { verifyVcfProof } from "./vcf";
import type { BoardMark, BoardMarkStyle, GameDocument, ImportResult, OpeningRule, Player, Position, RecordNode, RecordSourceFormat } from "./types";
import type { VcfResult } from "./vcf";
import PuzzleAiWorker from "./puzzle-ai.worker?worker";
import { winnerAt } from "./puzzle-ai";
import type { AiMoveResult } from "./puzzle-ai";
import { createPuzzleDocument, deriveWrongPuzzleEntries, importKaibaoPuzzleJson, isPuzzleJsonText, loadNativeKaibaoCollections, loadPuzzleCollections, loadPuzzleProgress, puzzleProgressKey, savePuzzleCollections, savePuzzleProgress, savePuzzleTitleOverride } from "./puzzles";
import type { Puzzle, PuzzleCollection, PuzzleReviewEntry } from "./puzzles";
import { addFifthCandidate, chooseFifthCount, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, isDistinctFifthCandidate, openingInstruction, openingPositionAllowed, openingRuleName, suggestFifthCandidates, suggestOpeningPlacement, type OpeningSession, type OpeningStage } from "./opening-rules";
import { ANNOTATION_COLORS, ANNOTATION_STYLES, ANNOTATION_TYPES, MOON_MARK_PATH, STAR_MARK_PATH, SUN_MARK_CORE_RADIUS, SUN_MARK_RAYS, annotationTypePreset, type AnnotationMarkType } from "./annotation-presets";
import { createBackupSnapshot, parseBackup, restoreBackup, serializeBackup } from "./backup";
import { readZip, textFromZipEntry, createZip, type ZipEntry } from "./zip";
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
import { addToRecycleBin, emptyRecycleBinConfirmation, loadRecycleBin, permanentDeleteConfirmation, removeFromRecycleBin, type RecycleBinEntry } from "./recycle-bin";
import { loadNativeDatabaseFile, loadNativeMatchRecords, NATIVE_DATABASE_TITLE, NATIVE_MATCH_FOLDER, NATIVE_RECORD_FOLDER } from "./native-records";
import { FeedbackPanel } from "./FeedbackPanel";
import { AboutPanel } from "./AboutPanel";
import type { AppMode, BoardTheme, ResolvedTheme, Sheet, StoneTheme, Tab, ThemePreference } from "./app-shell-types";
import { BottomSheet } from "./ui/overlays/BottomSheet";
import { ROOT_BACK_MESSAGE, useRootBackExit } from "./ui/overlays/useRootBackExit";
import { MetadataFields } from "./features/record/MetadataFields";
import { SettingsPage } from "./features/settings/SettingsPage";
import { UserManual } from "./features/manual/UserManual";
import { PlaybackButton, playbackStatusText } from "./features/research/PlaybackControls";
import { useRecordPlayback } from "./features/research/record-playback";
import { documentForExportScope, exportScopeSuffix, type RecordExportScope } from "./features/research/record-export";
import { RecordSearchPanel } from "./features/research/RecordSearchPanel";
import { DataSafetyPanel } from "./features/library/DataSafetyPanel";
import { ResearchLibraryOverview } from "./features/library/ResearchLibraryOverview";
import { largeRecordMatchesFilter, recordMatchesFilter, type RecordLibraryFilter } from "./features/library/library-research";
import { RecentPuzzleSection } from "./features/library/RecentPuzzleSection";
import { recentPuzzleItems, type RecentPuzzleItem } from "./features/library/recent-puzzles";
import { FirstRunWelcome } from "./features/onboarding/FirstRunWelcome";
import { markFirstRunWelcomeRead, shouldShowFirstRunWelcome } from "./features/onboarding/onboarding";
import { loadLastSession, loadRestoreLastPosition, saveLastSession, saveRestoreLastPosition, type LastSessionState } from "./features/session/session-restore";
import { loadStoneOpacity, saveStoneOpacity } from "./stone-opacity";
import { loadBoardOpacity, saveBoardOpacity } from "./board-opacity";
import { annotationHighlightColor, loadAnnotationHighlight, saveAnnotationHighlight, type AnnotationHighlight } from "./annotation-highlight";
import { TaskManager } from "./features/tasks/task-state";
import { AiWorkerController, type AiCancelReason } from "./features/ai/ai-worker-controller";
import { RuleGuide } from "./features/rules/RuleGuide";
import { AI_RULE_PRESET_GUIDES } from "./features/rules/rule-guide-data";
import { UnifiedStatusBar } from "./features/workspace/UnifiedStatusBar";
import { RecordSelectorSheet } from "./features/workspace/RecordSelectorSheet";
import { loadRecordBookmarks, mergeRecordBookmarks, removeRecordBookmarks, saveRecordBookmarks, toggleRecordBookmark, updateRecordBookmark, type RecordBookmark, type RecordBookmarks } from "./features/record-tree/bookmarks";
import { copyRecordSubtree, pasteRecordSubtree, type SubtreeClipboard } from "./features/record-tree/subtree-clipboard";
import { PuzzleRuleSelector } from "./features/puzzles/PuzzleRuleSelector";
import { PuzzleSelectorSheet } from "./features/puzzles/PuzzleSelectorSheet";
import { PuzzleThinkSpeedSelector, type PuzzleThinkSpeed } from "./features/puzzles/PuzzleThinkSpeedSelector";
import { fallbackLegalPuzzleMove, loadPuzzleRulePreference, puzzleMoveLegality, resolvePuzzleRule, savePuzzleRulePreference, type PuzzleRuleMode } from "./features/puzzles/puzzle-rules";
import { createPuzzleSetupSession, movePuzzleSetupCursor, placePuzzleSetupStone, puzzleSetupView, type PuzzleSetupSession } from "./features/puzzles/puzzle-setup-session";

type BoardMotionKind = "place" | "navigate" | "branch" | null;
type BoardFeedbackKind = "illegal" | "forbidden";
type BoardResultKind = "won" | "lost" | "draw" | "complete";
type ThinkVisualState = "idle" | "thinking" | "complete" | "unavailable" | "error" | "cancelled";
interface BoardMotionState { kind: BoardMotionKind; version: number }
interface BoardFeedbackState { position: Position; kind: BoardFeedbackKind; version: number }
interface BoardResultState { kind: BoardResultKind; label: string }
type DockPanel = "moves" | "annotation" | "notes" | "view" | "play" | "setup" | "puzzles" | "vcf" | null;
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

type AiRuleMode = RuleSet;
const AI_RULE_CHOICES = AI_RULE_PRESET_GUIDES;

interface LibraryFolders {
  recordFolders: string[];
  puzzleFolders: string[];
  recordAssignments: Record<string, string>;
  puzzleAssignments: Record<string, string>;
  order?: LibraryOrderMaps;
}
const FOLDER_SEPARATOR = "/";
const folderLabel = (folder: string) => folder.split(FOLDER_SEPARATOR).pop() || folder;
const folderParent = (folder: string) => {
  const index = folder.lastIndexOf(FOLDER_SEPARATOR);
  return index < 0 ? "" : folder.slice(0, index);
};
const folderChildren = (folders: string[], parent: string) => folders.filter((folder) => folderParent(folder) === parent);
const folderDisplayLabel = (folder: string) => folder.split(FOLDER_SEPARATOR).join(" / ");
interface AiGameState { humanPlayer: Player; aiPlayer: Player; strength: AiStrength; forbiddenEnabled: boolean; timeLimitMs: number; thinkTimeMs: number; thinkDepth: number; unlimitedThinking: boolean; outcome: "won" | "lost" | "draw" | null; opening: OpeningSession }
interface PuzzleSetupWorkspace { session: PuzzleSetupSession; sourceOutcome: "won" | "lost" | "stopped" | null }
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
const PUZZLE_FAST_THINK_TIME_MS = 600;
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
const THEME_PREFERENCE_KEY = "banbu-theme-preference-v1";
const DISPLAY_SETTINGS_KEY = "renju-note-display-settings-v1";
const CUSTOM_BACKGROUND_COLOR_KEY = "banbu-custom-background-color-v1";
const CUSTOM_BACKGROUND_IMAGE_KEY = "banbu-custom-background-image-v1";
const BOARD_THEME_KEY = "banbu-board-theme-v1";
const STONE_THEME_KEY = "banbu-stone-theme-v1";
const THINK_SHEET_ON_START_KEY = "banbu-think-sheet-on-start-v1";
const THINK_DIRECT_MOVE_KEY = "banbu-think-direct-move-v1";
const COACH_MARKS_KEY = "banbu-coach-marks-v1";
const REVIEW_MARKS_KEY = "banbu-review-marks-v1";
type ReviewMarks = Record<string, BoardMark[]>;
const loadReviewMarks = (): ReviewMarks => {
  try {
    const value = JSON.parse(localStorage.getItem(REVIEW_MARKS_KEY) || "null") as ReviewMarks | null;
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value).filter(([, marks]) => Array.isArray(marks))) as ReviewMarks;
  } catch { return {}; }
};
const saveReviewMarks = (value: ReviewMarks) => {
  try { localStorage.setItem(REVIEW_MARKS_KEY, JSON.stringify(value)); } catch { /* optional local-only annotations */ }
};
const REVIEW_BRANCH_NAMES_KEY = "banbu-review-branch-names-v1";
type ReviewBranchNames = Record<string, Record<string, string>>;
const loadReviewBranchNames = (): ReviewBranchNames => {
  try {
    const value = JSON.parse(localStorage.getItem(REVIEW_BRANCH_NAMES_KEY) || "null") as ReviewBranchNames | null;
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([, names]) => names && typeof names === "object" && !Array.isArray(names))
      .map(([docId, names]) => [docId, Object.fromEntries(Object.entries(names as Record<string, unknown>).filter(([, name]) => typeof name === "string" && (name as string).trim())) as Record<string, string>])) as ReviewBranchNames;
  } catch { return {}; }
};
const saveReviewBranchNames = (value: ReviewBranchNames) => {
  try { localStorage.setItem(REVIEW_BRANCH_NAMES_KEY, JSON.stringify(value)); } catch { /* optional local-only branch names */ }
};
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
const isThemePreference = (value: unknown): value is ThemePreference => value === "system" || value === "light" || value === "dark" || value === "eye" || value === "mono" || value === "rain" || value === "bamboo" || value === "snow" || value === "porcelain" || value === "plum" || value === "jiangnan" || value === "firefly" || value === "rice" || value === "pixel" || value === "cyber" || value === "blackgold" || value === "pale" || value === "kawaii" || value === "aurora" || value === "deepsea" || value === "baroque" || value === "custom";
const isBoardTheme = (value: unknown): value is BoardTheme => value === "wood" || value === "jade" || value === "notebook" || value === "emerald" || value === "porcelain" || value === "whitejade" || value === "walnut" || value === "frosted" || value === "circuit" || value === "minimal" || value === "blackgold" || value === "pale" || value === "kawaii" || value === "aurora";
const isStoneTheme = (value: unknown): value is StoneTheme => value === "classic" || value === "jade" || value === "yun" || value === "ink" || value === "mono" || value === "notebook" || value === "porcelain" || value === "snow" || value === "terminal" || value === "gold-diamond" || value === "gold" || value === "diamond" || value === "blackgold" || value === "pale" || value === "kawaii" || value === "aurora";
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
const loadDefaultBoardSize = () => {
  try { const value = Number(localStorage.getItem(DEFAULT_BOARD_SIZE_KEY) || 15); return Number.isInteger(value) && value >= 5 && value <= 21 ? value : 15; } catch { return 15; }
};
const createFreshStartupDocument = () => {
  const created = createDocument("新建棋谱", loadDefaultBoardSize());
  try { localStorage.setItem(DEFAULT_DOCUMENT_KEY, JSON.stringify(created)); } catch { /* storage is optional */ }
  return created;
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
const DEFAULT_BOARD_SIZE_KEY = "banbu-default-board-size-v1";
const ACTIVE_LARGE_RECORD_KEY = "banbu-active-large-record-v1";
const MAX_OTHER_RECORD_BYTES = 64 * 1024 * 1024;
const defaultLibraryFolders: LibraryFolders = {
  recordFolders: ["未分类"],
  puzzleFolders: ["内置题库", "我的题库"],
  recordAssignments: {},
  puzzleAssignments: {},
  order: {},
};
const loadLibraryFolders = (): LibraryFolders => {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARY_FOLDERS_KEY) || "null") as Partial<LibraryFolders> | null;
    if (!value) return defaultLibraryFolders;
    const normalize = (input: unknown, fallback: string[]) => {
      const source = Array.isArray(input) ? input : fallback;
      const result = new Set<string>();
      source.forEach((item) => {
        if (typeof item !== "string") return;
        const parts = item.split("\\").join(FOLDER_SEPARATOR).split(FOLDER_SEPARATOR).map((part: string) => part.trim()).filter(Boolean);
        for (let index = 1; index <= parts.length; index += 1) result.add(parts.slice(0, index).join(FOLDER_SEPARATOR));
      });
      fallback.forEach((item) => result.add(item));
      return [...result];
    };
    return {
      recordFolders: normalize(value.recordFolders, defaultLibraryFolders.recordFolders),
      puzzleFolders: normalize(value.puzzleFolders, defaultLibraryFolders.puzzleFolders),
      recordAssignments: value.recordAssignments || {},
      puzzleAssignments: value.puzzleAssignments || {},
      order: isLibraryOrderMaps(value.order) ? value.order : {},
    };
  } catch { return defaultLibraryFolders; }
};

const markKindLabel = (mark: BoardMark) => mark.kind === "label" ? (mark.label || "文字标注") : mark.kind === "circle" ? "圆圈" : mark.kind === "triangle" ? "三角" : "叉号";
const nodeMarksText = (marks: BoardMark[]) => marks.flatMap((mark) => [coordinateName(mark), mark.label || "", markKindLabel(mark)]).join(" ");

/** 标注样式的小尺寸示意渲染（面板按钮、样式选择器与预览共用）。 */
function MarkGlyph({ style, color, value = "", size = 34 }: { style: BoardMarkStyle; color: string; value?: string; size?: number }) {
  const label = Array.from(value).slice(0, 4).join("");
  const stroke = { fill: "none", stroke: color } as const;
  return <svg width={size} height={size} viewBox="-24 -24 48 48" aria-hidden="true">
    {style === "text" && <text textAnchor="middle" y={7} fontSize="21" fontWeight="800" fill={color}>{label || "A"}</text>}
    {style === "circle" && (label
      ? <><circle r="17" {...stroke} strokeWidth="2.6"/><text textAnchor="middle" y={6} fontSize="17" fontWeight="800" fill={color}>{label}</text></>
      : <circle r="6" fill={color}/>)}
    {style === "triangle" && <><path d="M0 -17L-15 12L15 12Z" {...stroke} strokeWidth="2.6" strokeLinejoin="round"/>{label && <text textAnchor="middle" y={6} fontSize="14" fontWeight="800" fill={color}>{label}</text>}</>}
    {style === "cross" && <><g {...stroke} strokeWidth="2.8" strokeLinecap="round"><line x1="-12" y1="-12" x2="12" y2="12"/><line x1="12" y1="-12" x2="-12" y2="12"/></g>{label && <text textAnchor="middle" y={6} fontSize="14" fontWeight="800" fill={color}>{label}</text>}</>}
    {style === "star" && <><path d={STAR_MARK_PATH} {...stroke} strokeWidth="2.4" strokeLinejoin="round"/>{label && <text textAnchor="middle" y={5.5} fontSize="12" fontWeight="800" fill={color}>{label}</text>}</>}
    {style === "sun" && <><circle r="8.5" {...stroke} strokeWidth="2.2"/><g {...stroke} strokeWidth="2.2" strokeLinecap="round">{SUN_MARK_RAYS.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2}/>)}</g>{label && <text textAnchor="middle" y={3.6} fontSize="9" fontWeight="800" fill={color}>{label}</text>}</>}
    {style === "moon" && <><path d={MOON_MARK_PATH} {...stroke} strokeWidth="2.4" strokeLinejoin="round"/>{label && <text textAnchor="middle" y={5.5} fontSize="12" fontWeight="800" fill={color}>{label}</text>}</>}
  </svg>;
}

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
  return (["sgf", "fgf", "ren", "renjs", "wzq", "json", "renju", "pos", "txt", "psq", "lib", "dp", "db"] as const).find((format) => format === extension);
};
const sgfSourceFormats = new Set<RecordSourceFormat>(["sgf", "fgf", "ren", "renjs", "wzq"]);
const jsonSourceFormats = new Set<RecordSourceFormat>(["json", "renju"]);
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

const Board = memo(function Board({ document, currentId, currentBookmarked = false, showNumbers, showCoordinates, largeBoard, rotation, mirrored, initialDepth = 0, disabled = false, forbiddenMarkers = [], winningLines = [], openingCandidates = [], openingStage, thinkingMove, thinking = false, motion, feedback, result, boardTheme = "wood", stoneTheme = "classic", boardOpacity = 1, stoneOpacity = 1, annotationHighlight = "none", gestureZoomEnabled = false, gestureSwipeEnabled = false, onPlay, onVariation, onMark, onGestureStep }: {
  document: GameDocument; currentId: string; showNumbers: boolean; showCoordinates: boolean; largeBoard: boolean;
  currentBookmarked?: boolean;
  rotation: BoardRotation; mirrored: boolean;
  initialDepth?: number; disabled?: boolean;
  boardTheme?: BoardTheme; stoneTheme?: StoneTheme; boardOpacity?: number; stoneOpacity?: number; annotationHighlight?: AnnotationHighlight;
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
  const markHighlightColor = annotationHighlightColor(annotationHighlight);
  const markHighlightFilter = markHighlightColor ? "url(#annotationHighlightGlow)" : undefined;
  const currentHasVisualMark = Boolean(
    currentPoint && (
      displayMarks.some((mark) => `${mark.row},${mark.col}` === currentPointKey)
      || current.boardText
      || current.renLibMark
    ),
  );
  const occupiedPointKeys = useMemo(() => {
    const result = new Set<string>();
    board.forEach((row, rowIndex) => row.forEach((player, colIndex) => {
      if (player) result.add(`${rowIndex},${colIndex}`);
    }));
    return result;
  }, [board]);
  // Board variations are canonicalized before any visual or interaction layer
  // consumes them: only next moves from the current position, one empty-board
  // intersection per target. Previous-ply siblings belong behind the cursor.
  const variationNodes = useMemo(
    () => renderableBoardVariationNodes(document, safeCurrentId, occupiedPointKeys, 512),
    [document, occupiedPointKeys, safeCurrentId],
  );
  const variationNodeByPoint = useMemo(() => {
    const result = new Map<string, RecordNode>();
    variationNodes.forEach((node) => {
      const point = node.move || node.anchor;
      if (point) result.set(`${point.row},${point.col}`, node);
    });
    return result;
  }, [variationNodes]);
  const isNativeRenLib = isRenLibWebView(document);
  const longPressTimer = useRef<number | null>(null);
  const suppressedClickPoint = useRef<Position | null>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const gestureStartDistance = useRef<number | null>(null);
  const gestureStartCenter = useRef<{ x: number; y: number } | null>(null);
  const gestureStartScale = useRef(1);
  const gestureSwipeHandled = useRef(false);
  const boardPanRef = useRef({ active: false, lastX: 0, lastY: 0, moved: false });
  const touchBlockUntil = useRef(0);
  const [boardScale, setBoardScale] = useState(1);
  const margin = 34, gap = 504 / Math.max(1, boardSize - 1), end = margin + gap * (boardSize - 1);
  // Keep stones visually proportional to the grid: compact boards get a
  // little more presence while dense 19–21 line boards stay readable.
  const stoneRadius = Math.min(24, Math.max(10, gap * 0.43));
  const stoneScale = stoneRadius / 15.6;
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
      if (boardScale > 1.01) {
        boardPanRef.current = { active: true, lastX: point.x, lastY: point.y, moved: false };
      }
    } else if (kind === "move") {
      if (!touchPoints.current.has(event.pointerId)) return;
      if (boardScale > 1.01 && touchPoints.current.size === 1 && boardPanRef.current.active) {
        const scroller = event.currentTarget.parentElement;
        const dx = point.x - boardPanRef.current.lastX;
        const dy = point.y - boardPanRef.current.lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) boardPanRef.current.moved = true;
        if (scroller) { scroller.scrollLeft -= dx; scroller.scrollTop -= dy; }
        if (boardPanRef.current.moved) touchBlockUntil.current = Date.now() + 260;
        boardPanRef.current.lastX = point.x; boardPanRef.current.lastY = point.y;
      }
      touchPoints.current.set(event.pointerId, point);
    } else {
      touchPoints.current.delete(event.pointerId);
      boardPanRef.current.active = false;
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
          <radialGradient id="blackStone-porcelain" cx="28%" cy="22%"><stop offset="0" stopColor="#315f91"/><stop offset=".48" stopColor="#123f73"/><stop offset="1" stopColor="#071b36"/></radialGradient>
          <radialGradient id="whiteStone-porcelain" cx="28%" cy="22%"><stop offset="0" stopColor="#fffdf8"/><stop offset=".58" stopColor="#f3f2ea"/><stop offset="1" stopColor="#9fbaca"/></radialGradient>
          <radialGradient id="blackStone-snow" cx="25%" cy="18%"><stop offset="0" stopColor="#d9fbff"/><stop offset=".2" stopColor="#73d7ef"/><stop offset=".52" stopColor="#2479aa"/><stop offset=".8" stopColor="#0d416c"/><stop offset="1" stopColor="#051c38"/></radialGradient>
          <radialGradient id="whiteStone-snow" cx="25%" cy="18%"><stop offset="0" stopColor="#fff"/><stop offset=".25" stopColor="#e9fbff"/><stop offset=".56" stopColor="#bfe7fa"/><stop offset=".82" stopColor="#83b7da"/><stop offset="1" stopColor="#537da8"/></radialGradient>
          <radialGradient id="blackStone-blackgold" cx="27%" cy="20%"><stop offset="0" stopColor="#6f6a5d"/><stop offset=".25" stopColor="#25231f"/><stop offset=".67" stopColor="#090909"/><stop offset="1" stopColor="#010101"/></radialGradient>
          <radialGradient id="whiteStone-blackgold" cx="30%" cy="24%"><stop offset="0" stopColor="#fff9d9"/><stop offset=".24" stopColor="#f4df9a"/><stop offset=".58" stopColor="#d8b45f"/><stop offset=".84" stopColor="#bd8e35"/><stop offset="1" stopColor="#96651d"/></radialGradient>
          <radialGradient id="blackStone-pale" cx="27%" cy="20%"><stop offset="0" stopColor="#8b8d8f"/><stop offset=".38" stopColor="#3b3c3e"/><stop offset="1" stopColor="#111214"/></radialGradient>
          <radialGradient id="whiteStone-pale" cx="27%" cy="20%"><stop offset="0" stopColor="#fff"/><stop offset=".48" stopColor="#ececed"/><stop offset=".78" stopColor="#c4c5c7"/><stop offset="1" stopColor="#85878a"/></radialGradient>
          <radialGradient id="blackStone-kawaii" cx="27%" cy="20%"><stop offset="0" stopColor="#ffd9ea"/><stop offset=".24" stopColor="#ff9fc5"/><stop offset=".58" stopColor="#f06f9f"/><stop offset=".84" stopColor="#cf477d"/><stop offset="1" stopColor="#a82f64"/></radialGradient>
          <radialGradient id="whiteStone-kawaii" cx="27%" cy="20%"><stop offset="0" stopColor="#eafffb"/><stop offset=".25" stopColor="#b8f3e8"/><stop offset=".58" stopColor="#7fdccc"/><stop offset=".84" stopColor="#4ab8ae"/><stop offset="1" stopColor="#278b8a"/></radialGradient>
          <radialGradient id="blackStone-aurora" cx="27%" cy="20%"><stop offset="0" stopColor="#527d86"/><stop offset=".28" stopColor="#173f49"/><stop offset=".68" stopColor="#071e2b"/><stop offset="1" stopColor="#020914"/></radialGradient>
          <radialGradient id="whiteStone-aurora" cx="27%" cy="20%"><stop className="aurora-stone-light" offset="0" stopColor="#f1ffff"/><stop className="aurora-stone-mid" offset=".44" stopColor="#75ead3"/><stop className="aurora-stone-edge" offset=".76" stopColor="#6987e8"/><stop offset="1" stopColor="#443d91"/></radialGradient>
          <linearGradient id="blackGoldBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#1d1a16"/><stop offset=".48" stopColor="#080807"/><stop offset="1" stopColor="#21190f"/></linearGradient>
          <linearGradient id="paleBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fafafa"/><stop offset=".5" stopColor="#dedfe0"/><stop offset="1" stopColor="#bfc1c3"/></linearGradient>
          <linearGradient id="kawaiiBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff8f2"/><stop offset=".48" stopColor="#f7dbe9"/><stop offset="1" stopColor="#decdf0"/></linearGradient>
          <linearGradient id="auroraBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#061928"/><stop className="aurora-board-cyan" offset=".36" stopColor="#164e5b"/><stop className="aurora-board-green" offset=".64" stopColor="#236458"/><stop className="aurora-board-violet" offset="1" stopColor="#322b62"/></linearGradient>
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
          {markHighlightColor && <filter id="annotationHighlightGlow" x="-90%" y="-90%" width="280%" height="280%"><feDropShadow dx="0" dy="0" stdDeviation="1.7" floodColor={markHighlightColor} floodOpacity="1"/><feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={markHighlightColor} floodOpacity=".82"/></filter>}
        </defs>
        <rect x="4" y="4" width="564" height="564" rx="18" className="board-bg" style={{ opacity: boardOpacity }} />
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
         {variationNodes.map((node) => {
           const point = node.move || node.anchor;
           if (!point) return null;
           const { x, y } = visualXY(point);
           const player = node.move?.player || "black";
           const isNativeLabel = isNativeRenLib || Boolean(node.renLibNativeLabel);
           const display = isNativeLabel ? null : renLibDisplayMark(node.boardText);
           const pointKey = `${point.row},${point.col}`;
           const hasDisplayMark = displayMarkKeys.has(pointKey);
           const text = hasDisplayMark
             ? ""
             : isNativeLabel
               ? (isNativeRenLib ? formatRenLibWebLabel(node.boardText, depthOf(document, node.id)) : node.boardText || "")
               : display?.displayText || "";
           const hasText = Boolean(text);
           const hasUserMark = !isNativeLabel && userDisplayMarks.some((mark) => mark.row === point.row && mark.col === point.col);
           return <g key={`variation-${node.id}`} className={`renlib-variation ${player} ${isNativeLabel ? "renlib-native-variation" : display?.displayKind || "neutral-dot"}`} data-node-id={node.id} aria-label={`变化点 ${coordinateName(point, boardSize)}`} filter={markHighlightFilter && (hasText || node.renLibMark) ? markHighlightFilter : undefined}>
             {!hasText && !hasUserMark && !hasDisplayMark && <circle cx={x} cy={y} r="7" className="renlib-variation-dot"/>}
             {node.renLibMark && !hasText && !hasUserMark && !hasDisplayMark && <circle cx={x} cy={y} r="11" className="renlib-explicit-mark"/>}
             {hasText && <text x={x} y={y} className={`renlib-variation-label ${isNativeLabel ? "renlib-native-label" : ""} ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`} style={isNativeLabel ? { fill: "#1d1c19" } : undefined}>{text}</text>}
           </g>;
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
               : stoneTheme === "kawaii"
                 ? <g className={`kawaii-stone ${player}`}>
                     <path d={`M ${x - 12.4} ${y - 8.2} L ${x - 10.2} ${y - 17} L ${x - 4.2} ${y - 12.6} Q ${x} ${y - 15.3} ${x + 4.2} ${y - 12.6} L ${x + 10.2} ${y - 17} L ${x + 12.4} ${y - 8.2} Z`} className="kawaii-stone-ears"/>
                     <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className="stone kawaii-stone-disc"/>
                     <ellipse cx={x - 5.2} cy={y - 1.1} rx="1.55" ry="2.15" className="kawaii-eye"/><ellipse cx={x + 5.2} cy={y - 1.1} rx="1.55" ry="2.15" className="kawaii-eye"/>
                     <path d={`M ${x - 2.6} ${y + 4} Q ${x} ${y + 6.4} ${x + 2.6} ${y + 4} M ${x} ${y + 3.8} V ${y + 6.2}`} className="kawaii-mouth"/>
                     <ellipse cx={x - 9} cy={y + 4} rx="2.6" ry="1.25" className="kawaii-blush"/><ellipse cx={x + 9} cy={y + 4} rx="2.6" ry="1.25" className="kawaii-blush"/>
                     <path d={`M ${x - 8.5} ${y - 9.5} C ${x - 10.5} ${y - 12} ${x - 13.4} ${y - 9.4} ${x - 8.5} ${y - 6.4} C ${x - 3.6} ${y - 9.4} ${x - 6.5} ${y - 12} ${x - 8.5} ${y - 9.5} Z`} className="kawaii-heart"/>
                   </g>
               : stoneTheme === "snow"
                 ? <g className={`snow-crystal-stone ${player}`}>
                     <circle cx={x} cy={y} r="15.8" fill={`url(#${stoneGradient})`} className="stone snow-crystal-base"/>
                     <path d={`M ${x} ${y - 15} L ${x + 10.8} ${y - 10.8} L ${x + 15} ${y} L ${x + 10.2} ${y + 11.2} L ${x} ${y + 15.4} L ${x - 10.8} ${y + 10.8} L ${x - 15.2} ${y} L ${x - 10.4} ${y - 11.1} Z`} className="snow-crystal-rim"/>
                     <path d={`M ${x} ${y - 14} L ${x - 4.2} ${y - 2} L ${x - 13} ${y} L ${x - 3.5} ${y + 3.2} L ${x} ${y + 14} L ${x + 3.8} ${y + 3} L ${x + 13.4} ${y} L ${x + 3.6} ${y - 2.8} Z`} className="snow-crystal-facet"/>
                     <path d={`M ${x} ${y - 10} V ${y + 10} M ${x - 8.7} ${y - 5} L ${x + 8.7} ${y + 5} M ${x + 8.7} ${y - 5} L ${x - 8.7} ${y + 5}`} className="snow-crystal-snowflake"/>
                     <path d={`M ${x - 9} ${y - 10} L ${x - 4} ${y - 13.2} L ${x - 1} ${y - 9.5} L ${x - 5.5} ${y - 6.5} Z`} className="snow-crystal-glint"/>
                   </g>
               : (stoneTheme === "gold-diamond" || stoneTheme === "gold" || stoneTheme === "diamond")
                 ? <g className={`jewel-stone ${player}`}>
                     <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className="stone"/>
                     <path d={`M ${x - 12} ${y - 7} L ${x - 2} ${y - 14} L ${x + 7} ${y - 9} L ${x + 2} ${y - 1} L ${x - 7} ${y + 2} Z`} fill={`url(#${player === "black" ? "diamondFacet" : "goldFacet"})`} opacity=".8"/>
                     <path d={`M ${x - 9} ${y + 9} L ${x - 2} ${y + 2} L ${x + 5} ${y + 11} Z M ${x + 2} ${y - 1} L ${x + 12} ${y - 6} L ${x + 8} ${y + 7} Z`} fill={`url(#${player === "black" ? "diamondFacet" : "goldFacet"})`} opacity=".58"/>
                     <path d={`M ${x - 8} ${y - 10} Q ${x - 3} ${y - 14} ${x + 2} ${y - 11} Q ${x - 2} ${y - 7} ${x - 7} ${y - 5} Z`} fill="url(#jewelGlint)"/>
                     <path d={`M ${x - 5} ${y + 12} L ${x + 4} ${y + 5} M ${x + 2} ${y - 1} L ${x - 2} ${y - 14} M ${x + 2} ${y - 1} L ${x + 12} ${y - 6}`} className="jewel-facet-line"/>
                   </g>
               : <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className={`stone ${player}`}/>;
          const motionClass = isLast && motion?.kind === "place" ? "stone-enter" : "";
           const outlineOpacity = stoneTheme === "notebook" ? 0 : Math.max(0, (1 - stoneOpacity) * .72);
           return <g key={`stone-${rowIndex}-${colIndex}${isLast && motion?.kind ? `-${motion.version}` : ""}`} filter="url(#stoneShadow)" className={`stone-piece ${isWinningStone ? "winning-stone" : ""} ${motionClass}`}><g className="stone-body" transform={`translate(${x} ${y}) scale(${stoneScale}) translate(${-x} ${-y})`} style={{ opacity: stoneOpacity }}>{stoneGraphic}</g>{outlineOpacity > 0 && <circle cx={x} cy={y} r={stoneRadius + .1} className={`stone-visibility-outline ${player}`} style={{ opacity: outlineOpacity }}/>} {isWinningStone && <circle cx={x} cy={y} r={stoneRadius * 1.22} className="winning-stone-ring"/>}{showNumbers && <text x={x} y={y + stoneRadius * .28} className={`move-number ${player}`} style={{ fontSize: `${Math.max(8, stoneRadius * .64)}px` }}>{number}</text>}{isLast && !showNumbers && !currentHasVisualMark && (stoneTheme === "notebook" ? <path d={`M ${x - stoneRadius * .45} ${y + stoneRadius * 1.08} Q ${x} ${y + stoneRadius * 1.28} ${x + stoneRadius * .52} ${y + stoneRadius * 1.02}`} className="notebook-last-mark"/> : <circle cx={x} cy={y} r={Math.max(3, stoneRadius * .25)} className="last-dot"/>)}{isLast && hasNativeAnnotation(current) && <g className="comment-indicator" aria-label="此步有注释"><circle cx={x + stoneRadius * .7} cy={y + stoneRadius * .7} r={stoneRadius * .38}/><circle cx={x + stoneRadius * .53} cy={y + stoneRadius * .7} r=".85"/><circle cx={x + stoneRadius * .7} cy={y + stoneRadius * .7} r=".85"/><circle cx={x + stoneRadius * .87} cy={y + stoneRadius * .7} r=".85"/></g>}{isLast && currentBookmarked && <g className="bookmark-indicator" aria-label="此局面已保存分支书签"><path d={`M ${x - stoneRadius} ${y - stoneRadius} h ${stoneRadius * .67} v ${stoneRadius * .8} l -${stoneRadius * .33} -${stoneRadius * .2} -${stoneRadius * .33} ${stoneRadius * .2} z`}/></g>}</g>;
        }))}
         {current.renLibMark && (current.move || current.anchor) && !displayMarkKeys.has(currentPointKey) && (() => {
           const point = current.move || current.anchor!;
           const { x, y } = visualXY(point);
          return <circle cx={x} cy={y} r="11" className="renlib-explicit-mark" filter={markHighlightFilter}/>;
        })()}
         {openingCandidates.map((point, index) => {
           const { x, y } = visualXY(point);
          return <g key={`opening-candidate-${point.row}-${point.col}`} className="opening-candidate" aria-label={`第5手打点 A${index + 1}`}><circle className="opening-candidate-glow" cx={x} cy={y} r={stoneRadius * 1.22}/><circle className="opening-candidate-stone" cx={x} cy={y} r={stoneRadius}/><text x={x} y={y + stoneRadius * .2}>A{index + 1}</text></g>;
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
          * occupied point and must remain visible above stones and hints. */}
         <g className={`board-annotation-layer highlight-${annotationHighlight}`} filter={markHighlightFilter}>
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
           const markLabel = label ? <text x={x} y={y + 4} className={labelClass} fill={color} stroke="var(--paper, #f8f6f1)" strokeWidth="3.4" paintOrder="stroke">{label}</text> : null;
           if (style === "text") return <text key={index} x={x} y={y + 4} className={labelClass} fill={color}>{label || "?"}</text>;
           if (style === "circle") return label ? <g key={index}><circle cx={x} cy={y} r="19" className="board-mark" stroke={color}/>{markLabel}</g> : <circle key={index} cx={x} cy={y} r="5.5" className="board-mark" fill={color} opacity=".82"/>;
           if (style === "triangle") return <g key={index}><path d={`M ${x} ${y - 20} L ${x - 18} ${y + 14} L ${x + 18} ${y + 14} Z`} className="board-mark" stroke={color}/>{markLabel}</g>;
           if (style === "star") return <g key={index}><path d={STAR_MARK_PATH} transform={`translate(${x} ${y})`} className="board-mark" stroke={color} strokeLinejoin="round"/>{markLabel}</g>;
           if (style === "sun") return <g key={index}><circle cx={x} cy={y} r={SUN_MARK_CORE_RADIUS + 1} className="board-mark" stroke={color}/><g className="board-mark" stroke={color}>{SUN_MARK_RAYS.map(([x1, y1, x2, y2], ray) => <line key={ray} x1={x + x1} y1={y + y1} x2={x + x2} y2={y + y2}/>)}</g>{markLabel}</g>;
           if (style === "moon") return <g key={index}><path d={MOON_MARK_PATH} transform={`translate(${x} ${y})`} className="board-mark" stroke={color}/>{markLabel}</g>;
           return <g key={index} className="board-mark" stroke={color}><line x1={x - 14} y1={y - 14} x2={x + 14} y2={y + 14}/><line x1={x + 14} y1={y - 14} x2={x - 14} y2={y + 14}/>{label && <text x={x} y={y + 4} className={labelClass} fill={color} stroke="none">{label}</text>}</g>;
         })}
         </g>
         {Array.from({ length: boardSize }, (_, row) => Array.from({ length: boardSize }, (_, col) => {
           const point = { row, col };
           const variation = variationNodeByPoint.get(`${row},${col}`);
            const { x, y } = visualXY(point);
             return <circle key={`hit-${row}-${col}`} cx={x} cy={y} r={Math.max(14, stoneRadius * 1.14)} className="board-hit" role="gridcell" aria-disabled={disabled} aria-label={variation ? `切换到变化 ${coordinateName(point, boardSize)}` : `${coordinateName(point, boardSize)}${board[row][col] ? "已有棋子" : forbiddenByPoint.get(`${row},${col}`) || "空位"}`} onPointerDown={(event) => { if (disabled || isTouchGestureBlocked()) return; longPressTimer.current = window.setTimeout(() => { if (isTouchGestureBlocked()) return; suppressedClickPoint.current = point; onMark(point); }, 520); }} onPointerUp={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerCancel={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onClick={() => { if (disabled || isTouchGestureBlocked()) return; if (suppressedClickPoint.current?.row === row && suppressedClickPoint.current.col === col) { suppressedClickPoint.current = null; return; } suppressedClickPoint.current = null; if (variation && onVariation) onVariation(variation.id); else onPlay(point); }} onContextMenu={(event) => { event.preventDefault(); if (!disabled) onMark(point); }}/>
          }))}
       </svg>
      {thinking && <div className="board-thinking-indicator" role="status" aria-live="polite"><i/><i/><i/><span>AI 思考中</span></div>}
      {result && <div className={`game-result-banner ${result.kind}`} role="status" aria-live="polite"><span>{result.kind === "draw" ? "和" : result.kind === "lost" ? "负" : "胜"}</span><b>{result.label}</b></div>}
    </div>
  );
});

export default function App() {
  // Diagnostic switch for the top-level ErrorBoundary: set
  // globalThis.__banbuForceRenderError = true (e.g. via Playwright addInitScript)
  // to verify the crash card without shipping a debug UI.
  if (import.meta.env.DEV && (globalThis as { __banbuForceRenderError?: boolean }).__banbuForceRenderError) throw new Error("人为注入的渲染异常（ErrorBoundary 验收）");
  const [initialSession] = useState<LastSessionState | null>(() => loadLastSession());
  const [restoreLastPosition, setRestoreLastPosition] = useState(loadRestoreLastPosition);
  const [welcomeOpen, setWelcomeOpen] = useState(shouldShowFirstRunWelcome);
  const restorePendingRef = useRef<LastSessionState | null>(restoreLastPosition ? initialSession : null);
  const [document, setDocument] = useState<GameDocument>(() => {
    const shouldRestore = loadRestoreLastPosition();
    if (!shouldRestore) return createFreshStartupDocument();
    const active = shouldRestore ? loadActive() : null;
    if (active && (!initialSession || initialSession.documentId === active.id || initialSession.mode === "puzzle")) return active;
    if (shouldRestore && initialSession?.mode === "record") {
      const libraryDocument = loadLibrary().find((item) => item.id === initialSession.documentId);
      if (libraryDocument) return libraryDocument;
    }
    if (active && shouldRestore && !initialSession) return active;
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
    return createFreshStartupDocument();
  });
  const [currentId, setCurrentId] = useState(() => {
    const storedDraft = loadDraftFromLocal(document.id);
    if (restoreLastPosition && initialSession?.mode === "record" && initialSession.documentId === document.id) {
      if (document.nodes[initialSession.nodeId]) return initialSession.nodeId;
      return document.rootId;
    }
    const latestAdded = [...storedDraft.operations].reverse().find((operation) => operation.type === "add-move" || operation.type === "add-subtree");
    const latestAddedId = latestAdded?.type === "add-move" ? latestAdded.node.id : latestAdded?.type === "add-subtree" ? latestAdded.rootId : undefined;
    return document.savedCurrentId || latestAddedId || document.rootId;
  });
  const [mode, setMode] = useState<AppMode>("record");
  const [puzzleCollections, setPuzzleCollections] = useState<PuzzleCollection[]>(loadPuzzleCollections);
  const [vcfOptions, setVcfOptions] = useState<{ tier: VcfTier; count: number; mode: VcfGenMode }>({ tier: "short", count: 5, mode: "transform" });
  const [vcfGenRunning, setVcfGenRunning] = useState(false);
  const [vcfProgress, setVcfProgress] = useState({ done: 0, attempts: 0 });
  const [vcfBatch, setVcfBatch] = useState<Array<{ depth: number; solutionText: string; collectionIndex: number; puzzleIndex: number }>>([]);
  const [vcfBatchIndex, setVcfBatchIndex] = useState(0);
  const [vcfSolveNote, setVcfSolveNote] = useState("");
  const vcfExportJsonRef = useRef("");
  const [puzzleProgress, setPuzzleProgress] = useState(loadPuzzleProgress);
  const [puzzleCollectionIndex, setPuzzleCollectionIndex] = useState(0);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [puzzleInitialId, setPuzzleInitialId] = useState("");
  const [puzzleInitialDepth, setPuzzleInitialDepth] = useState(0);
  const [puzzleRulePreference, setPuzzleRulePreference] = useState<PuzzleRuleMode>(loadPuzzleRulePreference);
  const [puzzleThinkSpeed, setPuzzleThinkSpeed] = useState<PuzzleThinkSpeed>("fast");
  const [aiThinking, setAiThinking] = useState(false);
  const [puzzleOutcome, setPuzzleOutcome] = useState<"won" | "lost" | "stopped" | null>(null);
  const [puzzleSetup, setPuzzleSetup] = useState<PuzzleSetupWorkspace | null>(null);
  const [aiGame, setAiGame] = useState<AiGameState | null>(null);
  const [aiRuleFamily, setAiRuleFamily] = useState<AiRuleMode>("freestyle");
  const [aiHumanPlayer, setAiHumanPlayer] = useState<Player>("black");
  const [aiStrength, setAiStrength] = useState<AiStrength>("高级");
  const [aiTimeLimitMs, setAiTimeLimitMs] = useState<AiTimeControl>(0);
  const [aiHumanElapsedMs, setAiHumanElapsedMs] = useState(0);
  const [aiFreeTimeMs, setAiFreeTimeMs] = useState(2500);
  const [aiFreeDepth, setAiFreeDepth] = useState(64);
  const [aiFreeUnlimited, setAiFreeUnlimited] = useState(false);
  const [aiOpeningRule, setAiOpeningRule] = useState<OpeningRule>("free");
  const [aiRuleDetail, setAiRuleDetail] = useState<string | null>(null);
  const [aiOpeningN] = useState(3);
  const [dockPanel, setDockPanel] = useState<DockPanel>(null);
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);
  const [library, setLibrary] = useState(loadLibrary);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySection, setLibrarySection] = useState<LibrarySection>("records");
  const [recordFilter, setRecordFilter] = useState<RecordLibraryFilter>("all");
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolders>(loadLibraryFolders);
  const [branchBookmarks, setBranchBookmarks] = useState<RecordBookmarks>(loadRecordBookmarks);
  const [expandedLibraryFolders, setExpandedLibraryFolders] = useState<Set<string>>(() => new Set([libraryFolders.recordFolders[0] || ""]));
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
  const [defaultBoardSize, setDefaultBoardSize] = useState(loadDefaultBoardSize);
  const [stoneTheme, setStoneTheme] = useState<StoneTheme>(loadStoneTheme);
  const [boardOpacity, setBoardOpacity] = useState(loadBoardOpacity);
  const [stoneOpacity, setStoneOpacity] = useState(loadStoneOpacity);
  const [annotationHighlight, setAnnotationHighlight] = useState<AnnotationHighlight>(loadAnnotationHighlight);
  const [customBackgroundColor, setCustomBackgroundColor] = useState(loadCustomBackgroundColor);
  const [customBackgroundImage, setCustomBackgroundImage] = useState(loadCustomBackgroundImage);
  const [branchPage, setBranchPage] = useState(1);
  const [branchScrollTop, setBranchScrollTop] = useState(0);
  const [treeClipboard, setTreeClipboard] = useState<SubtreeClipboard | null>(null);
  const branchListRef = useRef<HTMLDivElement>(null);
  const [showNumbers, setShowNumbers] = useState(() => loadDisplaySettings().showNumbers);
  const [showCoordinates, setShowCoordinates] = useState(() => loadDisplaySettings().showCoordinates);
  const [showForbidden, setShowForbidden] = useState(() => loadDisplaySettings().showForbidden);
  const [largeBoard, setLargeBoard] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [mirrored, setMirrored] = useState(false);
  const [annotationType, setAnnotationType] = useState<AnnotationMarkType>("number");
  const [annotationValue, setAnnotationValue] = useState("1");
  const [annotationPopover, setAnnotationPopover] = useState<"style" | "color" | "type" | "value" | null>(null);
  const [annotationStyle, setAnnotationStyle] = useState<BoardMarkStyle>("text");
  const [annotationColor, setAnnotationColor] = useState("#1d1c19");
  const [reviewMarks, setReviewMarks] = useState<ReviewMarks>(loadReviewMarks);
  const [reviewBranchNames, setReviewBranchNames] = useState<ReviewBranchNames>(loadReviewBranchNames);
  const reviewDrafts = useRef(new Map<string, DraftState>());
  const [draft, setDraft] = useState<DraftState>(() => loadDraftFromLocal(document.id));
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const [largeSummaries, setLargeSummaries] = useState<LargeDocumentSummary[]>([]);
  const [largeDraftIds, setLargeDraftIds] = useState<string[]>([]);
  const [recycleBin, setRecycleBin] = useState<RecycleBinEntry[]>(loadRecycleBin);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [imageRecognizing, setImageRecognizing] = useState(false);
  const [placementPlayer, setPlacementPlayer] = useState<"black" | "white">("black");
  const [placementLocked, setPlacementLocked] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [saveDestination, setSaveDestination] = useState<"records" | "puzzles">("records");
  const [saveFolder, setSaveFolder] = useState("未分类");
  const [defaultDirectory, setDefaultDirectory] = useState<ExportDirectoryHandle | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [exportFormatMenuOpen, setExportFormatMenuOpen] = useState(false);
  const [exportScope, setExportScope] = useState<RecordExportScope>("whole");
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
  const [folderCreationParent, setFolderCreationParent] = useState("");
  const [folderSheetMode, setFolderSheetMode] = useState<"create" | "batch-move">("create");
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<LibraryRenameTarget | null>(null);
  const [renameName, setRenameName] = useState("");
  const [commentExpanded, setCommentExpanded] = useState(true);
  const [commentPreviewExpanded, setCommentPreviewExpanded] = useState(false);
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
  const taskManager = useRef(new TaskManager());
  const aiWorkerController = useRef(new AiWorkerController());
  const nativeSourceFile = useRef<File | null>(null);
  const vcfWorker = useRef<Worker | null>(null);
  const vcfGenWorker = useRef<Worker | null>(null);
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
  // When editing starts from a dynamic DP/LIB projection, keep the read-only
  // query session alive. The projection only contains the currently loaded
  // path; without this handle, returning to an unloaded original branch would
  // turn its next move into a brand-new local move.
  const detachedDynamicSource = useRef<DpViewSession | RenLibWebViewSession | null>(null);
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
  function cancelActiveAiComputation(reason: AiCancelReason, announce = false) {
    const activeKind = aiWorkerController.current.current?.kind;
    const controlledWorker = aiWorkerController.current.current?.worker;
    aiWorkerController.current.cancel(reason);
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    for (const ref of [puzzleAiWorker, rapfiGameWorker, thinkWorker, rapfiThinkWorker]) {
      if (ref.current && ref.current !== controlledWorker) ref.current.terminate();
      ref.current = null;
    }
    if (activeKind === "analysis") {
      thinkGeneration.current += 1;
      setThinkRunning(false); setThinkResult(null); setThinkContextKey(""); setThinkVisualState("cancelled");
    }
    if (activeKind === "game" || activeKind === "puzzle" || aiThinking) setAiThinking(false);
    if (taskManager.current.state?.kind === "ai") taskManager.current.cancel(reason === "user" ? "用户已停止" : "局面或页面已变化，任务已取消");
    if (announce) setToast(reason === "user" ? "已停止 AI 思考，后台计算线程已终止" : "已取消旧局面的 AI 思考");
  }
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
  const currentPuzzleCollection = puzzleCollections[puzzleCollectionIndex];
  const currentPuzzleRule = resolvePuzzleRule(currentPuzzle, currentPuzzleCollection, puzzleRulePreference);
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
      if (globalThis.document) globalThis.document.documentElement.style.colorScheme = ["dark", "rain", "jiangnan", "firefly", "pixel", "cyber"].includes(nextTheme) ? "dark" : "light";
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
  useEffect(() => { saveReviewMarks(reviewMarks); }, [reviewMarks]);
  useEffect(() => { saveReviewBranchNames(reviewBranchNames); }, [reviewBranchNames]);
  useEffect(() => { saveFontScale(fontScale); }, [fontScale]);
  useEffect(() => { try { localStorage.setItem(DEFAULT_BOARD_SIZE_KEY, String(defaultBoardSize)); } catch { /* optional storage */ } }, [defaultBoardSize]);
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
    // Review mode always renders the persisted source document. A pending
    // record draft may remain in memory so returning to edit mode does not
    // discard it, but it must never leak into read-only browsing.
    if (mode === "review" || !hasDraft(draft)) return document;
    const projected = projectedDocument(document, draftOverlay);
    if (draft.metadata) projected.metadata = { ...document.metadata, ...draft.metadata };
    return projected;
  }, [document, draft, draftOverlay, mode]);
  const reviewMarkKey = `${document.id}:${currentId}`;
  const reviewDocument = useMemo(() => {
    if (mode !== "review") return viewDocument;
    const marks = reviewMarks[reviewMarkKey];
    const node = viewDocument.nodes[currentId];
    if (!marks?.length || !node) return viewDocument;
    return { ...viewDocument, nodes: { ...viewDocument.nodes, [currentId]: { ...node, marks: [...node.marks, ...marks] } } };
  }, [currentId, mode, reviewMarkKey, reviewMarks, viewDocument]);
  const current = viewDocument.nodes[currentId] || viewDocument.nodes[viewDocument.rootId] || { id: viewDocument.rootId, parentId: null, children: [], move: null, comment: "", marks: [] };
  useEffect(() => {
    const pending = restorePendingRef.current;
    if (!restoreLastPosition || !pending || pending.mode !== "record" || pending.documentId !== document.id) return;
    const restoredId = viewDocument.nodes[pending.nodeId] ? pending.nodeId : document.rootId;
    restorePendingRef.current = null;
    setCurrentId(restoredId);
    recordSession.current = { document, currentId: restoredId };
  }, [document, restoreLastPosition, viewDocument]);
  useEffect(() => {
    saveRestoreLastPosition(restoreLastPosition);
  }, [restoreLastPosition]);
  useEffect(() => {
    const pending = restorePendingRef.current;
    if (!restoreLastPosition || (pending && pending.mode === "record")) return;
    if (mode === "record" && !compactIndexOf(document) && hasDraft(draft)) {
      try { saveDraftToLocal(document.id, draft); } catch { /* normal autosave will retry */ }
    }
    const state: Omit<LastSessionState, "updatedAt"> = {
      documentId: document.id,
      nodeId: currentId,
      mode,
      ...(mode === "record" ? (() => {
        try {
          const largeId = localStorage.getItem(ACTIVE_LARGE_RECORD_KEY);
          return largeId ? { largeId } : {};
        } catch { return {}; }
      })() : {}),
      ...(mode === "puzzle" && puzzleCollections[puzzleCollectionIndex]?.id && currentPuzzle ? {
        puzzleCollectionId: puzzleCollections[puzzleCollectionIndex].id,
        puzzleId: currentPuzzle.id,
      } : {}),
    };
    saveLastSession(state);
  }, [currentId, currentPuzzle, document, draft, mode, puzzleCollectionIndex, puzzleCollections, restoreLastPosition]);
  const commentPreviewClass = hasNativeAnnotation(current) ? "comment-preview" : "comment-preview empty";
  const activeBookmarks = branchBookmarks[document.id] || [];
  const path = useMemo(() => pathToNode(viewDocument, currentId), [viewDocument, currentId]);
  const board = useMemo(() => boardAt(viewDocument, currentId), [viewDocument, currentId]);
  // Keep navigation-derived values primitive/stable. A cursor move changes currentId and
  // board, but must not make unrelated searches re-run just because document is also in scope.
  const nextPlayer = nextPlayerAt(viewDocument, currentId);
  const activePlacementPlayer = placementLocked ? placementPlayer : nextPlayer;
  const canRenderForbiddenAssistance = mode === "puzzle"
    ? !puzzleSetup && currentPuzzleRule.mode === "forbidden" && currentPuzzle?.player === "black" && !aiThinking && !puzzleOutcome
    : viewDocument.metadata.rule === "renju" && !aiThinking && !aiGame?.outcome && (aiGame ? aiGame.forbiddenEnabled && nextPlayer === "black" : activePlacementPlayer === "black" && !compactIndexOf(document) && !isDynamicDatabaseView(document) && !isPagedLibraryView(document));
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
  const currentPositionKey = useMemo(() => `${document.id}/${currentId}/${positionKey(board, nextPlayer, false)}`, [document.id, currentId, board, nextPlayer]);
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
    if (puzzleSetup) return null;
    if (aiGame?.outcome === "won") return { kind: "won", label: "你已获胜" };
    if (aiGame?.outcome === "lost") return { kind: "lost", label: "本局结束" };
    if (aiGame?.outcome === "draw") return { kind: "draw", label: "本局和棋" };
    if (puzzleOutcome === "won") return { kind: "won", label: "挑战成功" };
    if (puzzleOutcome === "lost") return { kind: "lost", label: "本题结束" };
    if (boardWinningLines.length) return { kind: "complete", label: "五连完成" };
    return null;
  }, [aiGame?.outcome, puzzleOutcome, boardWinningLines.length, puzzleSetup]);
  // Candidate analysis is an explicit study action, not a navigation primitive.
  // Do not evaluate all 225 empty points while stepping through a large tree.
  const candidates = useMemo(() => sheet === "analysis" && (viewDocument.metadata.boardSize || 15) === 15 ? analyzeCandidates(board, nextPlayer, 8) : [], [sheet, board, nextPlayer, viewDocument.metadata.boardSize]);
  const searchableDocuments = useMemo(() => [document, ...library.filter((item) => item.id !== document.id)], [document, library]);
  // A loaded large document is represented by its summary in the selector.
  // Remove the partial in-memory copy from the regular list so the current
  // item is shown once with its database metadata and accurate count.
  const selectorRecords = useMemo(() => {
    const largeIds = new Set(largeSummaries.map((item) => item.id));
    return searchableDocuments.filter((item) => !largeIds.has(item.id));
  }, [largeSummaries, searchableDocuments]);
  const positionMatches = useMemo(() => sheet === "positionSearch" ? findPositionMatches(searchableDocuments, board, nextPlayer, matchSymmetry) : [], [sheet, searchableDocuments, board, nextPlayer, matchSymmetry]);
  const draftPresent = hasDraft(draft);
  const regularDraftIds = useMemo(() => {
    const ids = new Set(library.filter((item) => hasDraft(loadDraftFromLocal(item.id))).map((item) => item.id));
    if (draftPresent && library.some((item) => item.id === document.id)) ids.add(document.id);
    return ids;
  }, [document.id, draftPresent, library]);
  const largeDraftIdSet = useMemo(() => new Set(largeDraftIds), [largeDraftIds]);
  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    return library.filter((item) => recordMatchesFilter(item, recordFilter, regularDraftIds)
      && (!query || [item.metadata.title, item.metadata.black, item.metadata.white, item.metadata.event]
        .some((value) => value.toLowerCase().includes(query))));
  }, [library, libraryQuery, recordFilter, regularDraftIds]);
  const filteredLargeSummaries = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    return largeSummaries.filter((item) => largeRecordMatchesFilter(item, recordFilter, largeDraftIdSet)
      && (!query || [item.metadata.title, item.metadata.black, item.metadata.white, item.metadata.event]
        .some((value) => value.toLowerCase().includes(query))));
  }, [largeDraftIdSet, largeSummaries, libraryQuery, recordFilter]);
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
  const recentPuzzles = useMemo(() => recentPuzzleItems(puzzleCollections, puzzleProgress), [puzzleCollections, puzzleProgress]);
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
    (window as Window & { __banbuFindBranch?: () => { id?: string; hasCompact: boolean; branchCount: number | null; nodeCount: number | null; firstBranchId: string | null; firstBranchChildCount: number | null; rootFirstChild: string | null; rootChildCount: number | null } }).__banbuFindBranch = () => {
      const id = compactFirstBranchNodeId(document);
      if (id) setCurrentId(id);
      return { ...compactDiagnostics(document), id };
    };
    return () => { delete (window as Window & { __banbuFindBranch?: () => string | undefined }).__banbuFindBranch; };
  }, [document]);
  useEffect(() => {
    if (mode === "puzzle") return;
    // Review is a read-only projection. Do not rewrite the library or active
    // snapshot merely because the cursor moved through an existing record.
    if (mode === "review") { setSaved(true); return; }
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
      const activeLargeId = restoreLastPosition ? (initialSession?.largeId || localStorage.getItem(ACTIVE_LARGE_RECORD_KEY)) : null;
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
    let active = true;
    void Promise.all(largeSummaries.map(async (item) => ({ id: item.id, hasDraft: await documentHasDraft(item.id) })))
      .then((items) => {
        if (!active) return;
        const ids = items.filter((item) => item.hasDraft).map((item) => item.id);
        if (draftPresent && largeSummaries.some((item) => item.id === document.id) && !ids.includes(document.id)) ids.push(document.id);
        setLargeDraftIds(ids);
      })
      .catch(() => { if (active) setLargeDraftIds(draftPresent && largeSummaries.some((item) => item.id === document.id) ? [document.id] : []); });
    return () => { active = false; };
  }, [document.id, draftPresent, largeSummaries]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
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
  useEffect(() => { savePuzzleRulePreference(puzzleRulePreference); }, [puzzleRulePreference]);
  useEffect(() => {
    if (!sheet) return;
    setWorkspaceSelectorOpen(false);
  }, [sheet]);
  useEffect(() => {
    const stage = aiGame?.opening.stage;
    if (mode === "record" && stage?.kind === "choose-fifth-count" && stage.actor === "human" && sheet === null) {
      setSheet("fifthCount");
    }
  }, [aiGame?.opening.stage, mode, sheet]);
  useEffect(() => { localStorage.setItem(LIBRARY_FOLDERS_KEY, JSON.stringify(libraryFolders)); }, [libraryFolders]);
  useEffect(() => { saveRecordBookmarks(branchBookmarks); }, [branchBookmarks]);
  useEffect(() => { localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify({ showNumbers, showCoordinates, showForbidden })); }, [showNumbers, showCoordinates, showForbidden]);
  useEffect(() => { saveStoneOpacity(stoneOpacity); }, [stoneOpacity]);
  useEffect(() => { saveBoardOpacity(boardOpacity); }, [boardOpacity]);
  useEffect(() => { saveAnnotationHighlight(annotationHighlight); }, [annotationHighlight]);
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
    let active = true;
    void loadNativeMatchRecords().then((nativeRecords) => {
      if (!active) return;
      const existing = loadLibrary();
      const existingIds = new Set(existing.map((item) => item.id));
      const missing = nativeRecords.filter((item) => !existingIds.has(item.id));
      const saved = missing.length ? saveManyToLibrary(missing) : { library: existing };
      if (!active) return;
      setLibrary(saved.library);
      setLibraryFolders((folders) => {
        const recordFolders = [...new Set([...folders.recordFolders, NATIVE_RECORD_FOLDER, NATIVE_MATCH_FOLDER])];
        const recordAssignments = { ...folders.recordAssignments };
        nativeRecords.forEach((item) => {
          if (!recordAssignments[item.id]) recordAssignments[item.id] = NATIVE_MATCH_FOLDER;
        });
        return { ...folders, recordFolders, recordAssignments };
      });
      setExpandedLibraryFolders((folders) => new Set([...folders, NATIVE_RECORD_FOLDER, NATIVE_MATCH_FOLDER]));
    }).catch(() => {
      if (active) setToast("内置人机大战棋谱加载失败，可稍后重新打开应用");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    vcfWorker.current?.terminate(); vcfWorker.current = null; setVcfRunning(false); setVcfResult(null);
  }, [currentPositionKey]);
  useEffect(() => {
    const active = aiWorkerController.current.current;
    if (active && active.contextKey !== currentPositionKey) cancelActiveAiComputation("position-change");
    else if (!active) {
      thinkWorker.current?.terminate(); thinkWorker.current = null; thinkGeneration.current += 1;
      rapfiThinkWorker.current?.terminate(); rapfiThinkWorker.current = null;
      setThinkRunning(false); setThinkResult(null); setThinkContextKey("");
      setThinkVisualState((state) => state === "thinking" || state === "complete" || state === "unavailable" ? "cancelled" : state);
    }
  }, [currentPositionKey]);
  useEffect(() => {
    const suspend = () => { if (globalThis.document?.visibilityState === "hidden") cancelActiveAiComputation("background"); };
    const pageHide = () => cancelActiveAiComputation("background");
    globalThis.document?.addEventListener("visibilitychange", suspend);
    window.addEventListener("pagehide", pageHide);
    return () => {
      globalThis.document?.removeEventListener("visibilitychange", suspend);
      window.removeEventListener("pagehide", pageHide);
      cancelActiveAiComputation("unmount");
      vcfWorker.current?.terminate(); vcfGenWorker.current?.terminate(); vcfGenWorker.current = null; pagedSession.current?.close(); dynamicViewSession.current?.close(); void banbuAudio.close();
    };
  }, []);
  useEffect(() => { if (tab !== "record") cancelActiveAiComputation("mode-switch"); }, [tab]);
  const playSound = (cue: SoundCue) => { void banbuAudio.play(cue); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && current.parentId) {
        clearBoardMotion();
        const dynamicSession = dynamicViewSession.current;
        if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(currentId)) { navigateDynamic(dynamicSession, () => dynamicSession.back()); return; }
        if (pagedSession.current) requestPagedIndex((session) => session.parentIndex(currentId));
        else setCurrentId(current.parentId);
      }
      if (event.key === "ArrowRight") {
        clearBoardMotion();
        const dynamicSession = dynamicViewSession.current;
        if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(currentId)) {
          const next = current.preferredChildId ? viewDocument.nodes[current.preferredChildId] : current.children.length ? viewDocument.nodes[current.children[0]] : undefined;
          if (next?.move) {
            if (draftOverlay.added.has(next.id)) setCurrentId(next.id);
            else { const move = next.move; navigateDynamic(dynamicSession, () => dynamicSession.move(move)); }
          }
          return;
        }
        if (pagedSession.current) { requestPagedIndex((session) => session.preferredIndex(currentId)); }
        else { const next = preferredNext(viewDocument, currentId); if (next) setCurrentId(next); }
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [document, currentId, current.parentId, draftOverlay, viewDocument]);

  const requestStrongAiMove = (afterDocument: GameDocument, afterId: string, aiPlayer: Player, onMove: (move: Position) => void, onNoMove: () => void, options: { strength?: AiStrength; timeMs?: number; maxDepth?: number; unlimited?: boolean; kind?: "game" | "puzzle" } = {}) => {
    cancelActiveAiComputation("superseded");
    vcfWorker.current?.terminate(); vcfWorker.current = null; setVcfRunning(false); setVcfResult(null);
    setAiThinking(true);
    const board = boardAt(afterDocument, afterId);
    const moves = pathToNode(afterDocument, afterId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
    const strength = options.strength || aiStrength;
    const profile = strength === "自由" ? { timeMs: aiFreeTimeMs, maxDepth: aiFreeDepth } : AI_STRENGTH_PROFILES[strength];
    const searchConfig = { timeMs: options.timeMs ?? profile.timeMs, maxDepth: options.maxDepth ?? profile.maxDepth, unlimited: options.unlimited === true };
    const kind = options.kind || "game";
    const worker = new Worker(String(import.meta.env.BASE_URL) + "rapfi/rapfi-worker.js");
    rapfiGameWorker.current = worker;
    const handle = aiWorkerController.current.start(worker, kind, `${afterDocument.id}/${afterId}/${positionKey(board, aiPlayer, false)}`);
    taskManager.current.start({ kind: "ai", title: kind === "puzzle" ? "陪练思考" : "人机思考", taskId: handle.requestId, cancellable: true, retryable: true });
    taskManager.current.update({ stage: searchConfig.unlimited ? "searching-unlimited" : "searching", message: searchConfig.unlimited ? "不限时思考中，可随时停止" : "正在寻找下一步" });
    const complete = (result: AiMoveResult) => {
      if (!aiWorkerController.current.isCurrent(handle)) return;
      aiWorkerController.current.finish(handle);
      rapfiGameWorker.current = null; puzzleAiWorker.current = null;
      if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.success(result);
      if (result.move) onMove(result.move); else onNoMove();
    };
    const useLocalFallback = () => {
      if (!aiWorkerController.current.isCurrent(handle)) return;
      const fallback = new PuzzleAiWorker();
      if (!aiWorkerController.current.replaceWorker(handle, fallback)) return;
      rapfiGameWorker.current = null;
      puzzleAiWorker.current = fallback;
      fallback.onmessage = (event: MessageEvent<AiMoveResult & { requestId?: string; generation?: number; result?: AiMoveResult }>) => {
        const requestId = event.data.requestId || handle.requestId;
        const result = event.data.result || event.data;
        if (puzzleAiWorker.current !== fallback || !aiWorkerController.current.isCurrent(handle, requestId, event.data.generation ?? handle.generation)) return;
        complete(result);
      };
      fallback.onerror = () => {
        if (puzzleAiWorker.current !== fallback || !aiWorkerController.current.isCurrent(handle)) return;
        aiWorkerController.current.finish(handle); puzzleAiWorker.current = null;
        if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.fail(new Error("本地 AI 线程异常"));
        onNoMove();
      };
      fallback.postMessage({ requestId: handle.requestId, generation: handle.generation, board, player: aiPlayer, rule: afterDocument.metadata.rule, purpose: kind === "puzzle" ? "puzzle" : "game", timeMs: searchConfig.timeMs, maxDepth: searchConfig.maxDepth, unlimited: searchConfig.unlimited });
    };
    const useFallbackAfterRapfiError = () => {
      if (rapfiGameWorker.current !== worker || !aiWorkerController.current.isCurrent(handle)) return;
      useLocalFallback();
    };
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: string; generation?: number; result?: AiMoveResult }>) => {
      if (rapfiGameWorker.current !== worker || !aiWorkerController.current.isCurrent(handle, event.data.requestId || handle.requestId, event.data.generation ?? handle.generation)) return;
      if (event.data.type === "result" && event.data.result) {
        complete(event.data.result);
      } else if (event.data.type === "error") useFallbackAfterRapfiError();
    };
    worker.onerror = useFallbackAfterRapfiError;
    worker.postMessage({ type: "analyze", requestId: handle.requestId, generation: handle.generation, engine: "fallback", size: afterDocument.metadata.boardSize || 15, moves, player: aiPlayer, rule: afterDocument.metadata.rule, timeMs: searchConfig.unlimited ? 0 : searchConfig.timeMs, maxDepth: searchConfig.unlimited ? 512 : searchConfig.maxDepth, unlimited: searchConfig.unlimited });
  };

  const startAiReply = (afterDocument: GameDocument, afterId: string, puzzle: Puzzle) => {
    setAiThinking(true);
    requestStrongAiMove(afterDocument, afterId, otherPlayer(puzzle.player), (move) => {
      setAiThinking(false);
      const replyPlayer = otherPlayer(puzzle.player);
      const beforeBoard = boardAt(afterDocument, afterId);
      const ruleMode: PuzzleRuleMode = afterDocument.metadata.rule === "renju" ? "forbidden" : "unrestricted";
      const actualMove = puzzleMoveLegality(beforeBoard, move, replyPlayer, ruleMode).legal ? move : fallbackLegalPuzzleMove(beforeBoard, replyPlayer, ruleMode);
      if (!actualMove) { setPuzzleOutcome("won"); recordPuzzleAttempt(true); setToast("陪练在当前规则下没有合法落子，本题完成"); return; }
      const reply = addMoveAs(afterDocument, afterId, actualMove, replyPlayer);
      setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place"); playSound(replyPlayer === "black" ? "move-black" : "move-white");
      const replyBoard = boardAt(reply.document, reply.nodeId);
      if (winnerAt(replyBoard, actualMove, reply.document.metadata.rule)) { setPuzzleOutcome("lost"); recordPuzzleAttempt(false); }
    }, () => { setAiThinking(false); setToast("陪练没有找到可落子点"); }, { kind: "puzzle", timeMs: puzzleThinkSpeed === "fast" ? PUZZLE_FAST_THINK_TIME_MS : undefined });
  };

  const startAiGameReply = (afterDocument: GameDocument, afterId: string, aiPlayer: Player, game: AiGameState | null = aiGame) => {
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
    }, () => { setAiThinking(false); setAiGame((currentGame) => currentGame ? { ...currentGame, outcome: "draw" } : currentGame); setToast("AI 没有找到合法落子，本局和棋"); }, { strength: game?.strength || aiStrength, timeMs: game?.thinkTimeMs, maxDepth: game?.thinkDepth, unlimited: game?.unlimitedThinking, kind: "game" });
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
      if (nextPlayerAt(afterDocument, afterId) === game.aiPlayer) startAiGameReply(afterDocument, afterId, game.aiPlayer, game);
      return;
    }
    const actor = stage.kind === "place" || stage.kind === "offer-fifths" || stage.kind === "choose-fifth-count" ? stage.actor : stage.kind === "swap" ? stage.chooser : stage.chooser;
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
      if (stage.kind === "choose-fifth-count") {
        const opening = chooseFifthCount(game.opening, 3);
        const nextGame = gameWithOpening(game, opening);
        setAiGame(nextGame);
        setToast(opening.stage.kind === "swap"
          ? `AI 已宣布 ${opening.n} 个第5手打点，请决定是否交换`
          : `AI 已选择 ${opening.n} 个第5手打点，请选择一个`);
        scheduleAiOpening(nextGame, afterDocument, afterId);
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

  const chooseOpeningFifthCount = (count: number) => {
    if (!aiGame || aiGame.opening.stage.kind !== "choose-fifth-count" || aiGame.opening.stage.actor !== "human" || aiThinking) return;
    const opening = chooseFifthCount(aiGame.opening, count);
    const nextGame = gameWithOpening(aiGame, opening);
    setAiGame(nextGame);
    setSheet(null);
    setToast(`已选择 ${opening.n} 个第5手打点，请依次点击棋盘空位`);
    scheduleAiOpening(nextGame, document, currentId);
  };

  const openPuzzle = (collectionIndex: number, nextPuzzleIndex: number, collections = puzzleCollections, restoreNodeId?: string, rulePreference = puzzleRulePreference) => {
    const collection = collections[collectionIndex];
    const puzzle = collection?.puzzles[nextPuzzleIndex];
    if (!puzzle) return;
    cancelActiveAiComputation("record-switch");
    const ruleResolution = resolvePuzzleRule(puzzle, collection, rulePreference);
    const session = createPuzzleDocument(puzzle, ruleResolution.rule);
    setDraft(emptyDraft());
    setPuzzleCollectionIndex(collectionIndex); setPuzzleIndex(nextPuzzleIndex);
    const nodeId = restoreNodeId && session.document.nodes[restoreNodeId] ? restoreNodeId : session.initialNodeId;
    setDocument(session.document); setCurrentId(nodeId);
    setPuzzleInitialId(session.initialNodeId); setPuzzleInitialDepth(session.initialDepth);
    setPuzzleSetup(null);
    setAiThinking(false); setPuzzleOutcome(null); setAiGame(null); setMode("puzzle"); exitAnnotationMode(); setDockPanel("play"); setTab("record");
    setContinuationEditMode(false);
    setWorkspaceSelectorOpen(false);
  };
  const changePuzzleRule = (nextRule: PuzzleRuleMode) => {
    if (currentPuzzleRule.locked) {
      setToast(currentPuzzleRule.source === "puzzle" ? "本题已指定规则，不能用做题偏好覆盖" : "本题集已指定规则，不能用做题偏好覆盖");
      return;
    }
    if (nextRule === puzzleRulePreference) return;
    const challengeDocument = puzzleSetup?.session.sourceDocument || document;
    const challengeCurrentId = puzzleSetup?.session.sourceCurrentId || currentId;
    const hadAnswer = aiThinking || Boolean(puzzleSetup?.sourceOutcome || puzzleOutcome) || depthOf(challengeDocument, challengeCurrentId) > puzzleInitialDepth;
    setPuzzleRulePreference(nextRule);
    openPuzzle(puzzleCollectionIndex, puzzleIndex, puzzleCollections, undefined, nextRule);
    setToast(`${hadAnswer ? "规则已切换，当前作答已安全重置；" : "规则已切换；"}现在按${nextRule === "forbidden" ? "禁手" : "无禁手"}做题`);
  };
  const changePuzzleThinkSpeed = (nextSpeed: PuzzleThinkSpeed) => {
    if (nextSpeed === puzzleThinkSpeed) return;
    cancelActiveAiComputation("settings-change");
    setPuzzleThinkSpeed(nextSpeed);
    setToast(nextSpeed === "fast" ? "陪练速度已切换为快，保证在 1 秒内落子" : "陪练速度已切换为慢，沿用当前思考时间");
  };
  const recordPuzzleAttempt = (solved: boolean) => {
    if (!currentPuzzle) return;
    const key = puzzleProgressKey(puzzleCollections[puzzleCollectionIndex].id, currentPuzzle.id);
    setPuzzleProgress((currentProgress) => ({ ...currentProgress, [key]: { solved: solved || !!currentProgress[key]?.solved, attempts: (currentProgress[key]?.attempts || 0) + 1, updatedAt: new Date().toISOString() } }));
  };
  const switchMode = (nextMode: AppMode) => {
    if (nextMode === mode) return;
    cancelActiveAiComputation("mode-switch");
    setPuzzleSetup(null);
    setWorkspaceSelectorOpen(false);
    if (nextMode === "puzzle") {
      guardedOpenPuzzle(puzzleCollectionIndex, puzzleIndex);
    } else if (nextMode === "review") {
      puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
      rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
      thinkWorker.current?.terminate(); thinkWorker.current = null; rapfiThinkWorker.current?.terminate(); rapfiThinkWorker.current = null;
      setAiThinking(false); setAiGame(null); setContinuationEditMode(false); exitAnnotationMode(); setSheet(null);
      if (mode === "record" && hasDraft(draft)) reviewDrafts.current.set(document.id, draft);
      setDocument(recordSession.current.document); setCurrentId(recordSession.current.currentId); setMode("review"); setDockPanel(null); setTab("record");
    } else {
      setAiThinking(false); exitAnnotationMode(); setSheet(null);
      const restoredDraft = reviewDrafts.current.get(recordSession.current.document.id);
      reviewDrafts.current.delete(recordSession.current.document.id);
      setDocument(recordSession.current.document); setCurrentId(recordSession.current.currentId); setDraft(restoredDraft || (compactIndexOf(recordSession.current.document) ? emptyDraft() : loadDraftFromLocal(recordSession.current.document.id))); setMode("record"); setDockPanel(null); setPuzzleOutcome(null); setAiGame(null); setContinuationEditMode(false);
    }
  };
  const stopPuzzleAi = () => {
    if (!puzzleAiWorker.current && !rapfiGameWorker.current) return;
    cancelActiveAiComputation("user"); setPuzzleOutcome("stopped"); setToast("已强制停止陪练，后台线程已终止；可悔棋或重启本题");
  };
  const stopAiGameThinking = () => {
    if (!aiGame || !aiThinking) return;
    cancelActiveAiComputation("user", true);
  };
  const resumeAiGameThinking = () => {
    if (!aiGame || aiThinking || aiGame.outcome) return;
    scheduleAiOpening(aiGame, document, currentId);
  };
  const exitAiGame = () => {
    if (!aiGame) return;
    cancelActiveAiComputation("mode-switch");
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
    thinkWorker.current?.terminate(); thinkWorker.current = null;
    rapfiThinkWorker.current?.terminate(); rapfiThinkWorker.current = null;
    thinkGeneration.current += 1;
    setAiThinking(false); setThinkRunning(false); setThinkResult(null);
    aiClockLastAt.current = null; aiClockExpired.current = false; setAiHumanElapsedMs(0);
    setAiGame(null); setPlacementLocked(false); exitAnnotationMode(); setDockPanel(null); setSheet(null);
    setToast("已退出对弈，当前棋局可继续打谱");
  };
  const applyPuzzleSetupSession = (session: PuzzleSetupSession) => {
    const view = puzzleSetupView(session);
    setPuzzleSetup((workspace) => workspace ? { ...workspace, session } : workspace);
    setDocument(view.document); setCurrentId(view.currentId);
  };
  const enterPuzzleSetup = () => {
    if (puzzleSetup) { setDockPanel("setup"); return; }
    cancelActiveAiComputation("mode-switch");
    const session = createPuzzleSetupSession(document, currentId);
    const view = puzzleSetupView(session);
    setPuzzleSetup({ session, sourceOutcome: puzzleOutcome });
    setDocument(view.document); setCurrentId(view.currentId); setPuzzleOutcome(null); setAiThinking(false);
    setPlacementPlayer(nextPlayerAt(view.document, view.currentId)); setPlacementLocked(false); setDockPanel("setup");
    setToast("已进入摆棋：自由落子，不会触发陪练或记录题目进度");
  };
  const exitPuzzleSetup = () => {
    if (!puzzleSetup) { setDockPanel("play"); return; }
    setDocument(puzzleSetup.session.sourceDocument); setCurrentId(puzzleSetup.session.sourceCurrentId);
    setPuzzleOutcome(puzzleSetup.sourceOutcome); setPuzzleSetup(null); setPlacementLocked(false); setDockPanel("play");
    setToast("已返回应战，题目局面保持不变");
  };
  const navigatePuzzleSetup = (cursor: number) => {
    if (!puzzleSetup) return;
    const session = movePuzzleSetupCursor(puzzleSetup.session, cursor);
    applyPuzzleSetupSession(session); triggerBoardMotion("navigate");
  };
  const restartPuzzle = () => {
    cancelActiveAiComputation("position-change"); setAiThinking(false); setPuzzleOutcome(null);
    setCurrentId(puzzleInitialId); setToast("已恢复到本题初始局面");
  };
  const undoPuzzleTurn = () => {
    cancelActiveAiComputation("position-change"); setAiThinking(false); setPuzzleOutcome(null);
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
  useEffect(() => {
    const pending = restorePendingRef.current;
    if (!restoreLastPosition || !pending || pending.mode !== "puzzle" || !pending.puzzleCollectionId || !pending.puzzleId) return;
    const collectionIndex = puzzleCollections.findIndex((collection) => collection.id === pending.puzzleCollectionId);
    const puzzleIndex = collectionIndex < 0 ? -1 : puzzleCollections[collectionIndex].puzzles.findIndex((puzzle) => puzzle.id === pending.puzzleId);
    if (collectionIndex < 0 || puzzleIndex < 0) {
      restorePendingRef.current = null;
      return;
    }
    restorePendingRef.current = null;
    openPuzzle(collectionIndex, puzzleIndex, puzzleCollections, pending.nodeId);
  }, [puzzleCollections, restoreLastPosition]);

  const detachViewForEditing = (nextDraft: DraftState) => {
    const dynamicSource = isDynamicDatabaseView(document) ? dynamicViewSession.current : null;
    const copy = createEditableViewCopy(viewDocument, currentId);
    pagedNavigationVersion.current += 1;
    dynamicNavigationVersion.current += 1;
    dynamicNavigationPending.current = false;
    setDynamicNavigationBusy(false);
    pagedSession.current?.close(); pagedSession.current = null;
    if (dynamicSource) {
      detachedDynamicSource.current = dynamicSource;
    } else {
      dynamicViewSession.current?.close(); dynamicViewSession.current = null;
      detachedDynamicSource.current = null;
    }
    localStorage.removeItem(ACTIVE_LARGE_RECORD_KEY);
    setDocument(copy); setDraft(nextDraft); setSaved(false);
    recordSession.current = { document: copy, currentId };
    setToast("已从当前局面创建可编辑副本，原数据库棋谱保持不变");
    return copy;
  };
  const recordDraft = (operation: Parameters<typeof pushDraft>[1]) => {
    if (mode === "review") { setToast("读谱模式为只读，不能修改棋谱"); return; }
    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) {
      // Once a dynamic source has been detached, keep subsequent edits in the
      // same local draft instead of rebuilding a second copy and discarding the
      // live query session that can load original branch continuations.
      if (hasDraft(draft)) { setDraft((state) => pushDraft(state, operation)); return; }
      detachViewForEditing(pushDraft(emptyDraft(), operation));
      return;
    }
    setDraft((state) => pushDraft(state, operation));
  };
  const undoDraftChange = () => {
    const operation = draft.operations[draft.operations.length - 1];
    if (!operation) return;
    const nextDraft = undoDraft(draft);
    setDraft(nextDraft);
    if (compactIndexOf(document)) {
      if (!hasDraft(nextDraft)) void removeDraftForDocument(document.id);
    } else saveDraftToLocal(document.id, nextDraft);
    if (operation.type === "add-subtree" && operation.bookmarks?.length) {
      const bookmarkIds = operation.bookmarks.map((bookmark) => bookmark.id);
      setBranchBookmarks((all) => ({ ...all, [document.id]: removeRecordBookmarks(all[document.id] || [], bookmarkIds) }));
    }
    // A draft-created node disappears from the projected document when its
    // add operation is undone. Keep the cursor on the parent so the next tap
    // on the board creates a new move instead of targeting a stale ID.
    if (operation.type === "add-move") {
      setCurrentId((id) => id === operation.node.id ? operation.parentId : id);
    } else if (operation.type === "add-subtree") {
      const addedIds = new Set(Object.keys(operation.nodes));
      setCurrentId((id) => addedIds.has(id) ? operation.parentId : id);
    } else if (operation.type === "delete-subtree") {
      setCurrentId((id) => viewDocument.nodes[id] ? id : operation.parentId);
    }
    setToast("已撤销一步");
  };
  const redoDraftChange = () => {
    const operation = draft.redo[draft.redo.length - 1];
    if (!operation) return;
    const nextDraft = redoDraft(draft);
    setDraft(nextDraft);
    if (!compactIndexOf(document)) saveDraftToLocal(document.id, nextDraft);
    if (operation.type === "add-subtree" && operation.bookmarks?.length) {
      setBranchBookmarks((all) => ({ ...all, [document.id]: mergeRecordBookmarks(all[document.id] || [], operation.bookmarks || []) }));
    }
    if (operation.type === "add-move") setCurrentId(operation.node.id);
    else if (operation.type === "add-subtree") setCurrentId(operation.rootId);
    else if (operation.type === "delete-subtree") setCurrentId(operation.parentId);
    setToast("已重做一步");
  };
  const removePastedDraftBookmarks = (state: DraftState) => {
    const ids = state.operations.flatMap((operation) => operation.type === "add-subtree" ? (operation.bookmarks || []).map((bookmark) => bookmark.id) : []);
    if (ids.length) setBranchBookmarks((all) => ({ ...all, [document.id]: removeRecordBookmarks(all[document.id] || [], ids) }));
  };
  const discardDraft = () => {
    let restoreId = currentId;
    while (!document.nodes[restoreId] && viewDocument.nodes[restoreId]?.parentId) restoreId = viewDocument.nodes[restoreId].parentId!;
    if (!document.nodes[restoreId]) restoreId = document.rootId;
    removePastedDraftBookmarks(draft);
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
    const destination = defaultDirectory || (supportsNativeExportDirectory() ? nativeExportDirectoryHandle() : null);
    if (destination) {
      try {
        await writeFileToDirectory(destination, filename, content, type);
        setToast(`${successMessage}，已写入“${destination.name}”`);
        return;
      } catch {
        downloadFile(content, filename, type);
        setToast(`${successMessage}，默认文件夹写入失败，已回退到浏览器下载目录`);
        return;
      }
    }
    downloadFile(content, filename, type);
    setToast(`${successMessage}，已保存到浏览器默认“下载”位置：${filename}`);
  };
  const exportTextFile = exportRecordFile;
  const exportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    recordAction("导出一键备份");
    try {
      const snapshot = await createBackupSnapshot("1.1.7");
      const stamp = snapshot.exportedAt.replace(/[:.]/g, "-").replace("Z", "");
      const zip = await createZip([
        { name: "banbu-backup.json", data: serializeBackup(snapshot) },
        { name: "README.txt", data: "半步五子棋打谱完整备份包\n\n此 ZIP 包含棋谱库、题库、草稿、书签、设置及大型棋谱索引。请在半步五子棋打谱的‘资料安全 → 恢复完整备份’中选择此文件。\n" },
      ]);
      await exportTextFile(new Blob([zip.buffer]), `半步五子棋打谱备份-${stamp}.zip`, "application/zip", "应用备份包已导出");
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
      if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
        const entries = await readZip(file);
        const candidates = entries.filter((entry) => /\.json$/i.test(entry.name));
        let parsed: ReturnType<typeof parseBackup> | null = null;
        let lastError: unknown = null;
        for (const entry of candidates.sort((a, b) => Number(/backup|备份/i.test(b.name)) - Number(/backup|备份/i.test(a.name)))) {
          try { parsed = parseBackup(textFromZipEntry(entry)); break; } catch (error) { lastError = error; }
        }
        if (!parsed) throw (lastError instanceof Error ? lastError : new Error("ZIP 中没有找到有效的半步五子棋打谱备份 JSON"));
        await restoreBackup(parsed);
        setSheet(null); setToast("备份 ZIP 已恢复，页面即将重新加载");
        window.setTimeout(() => window.location.reload(), 350);
        return;
      }
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
        player: activePlacementPlayer, rule: viewDocument.metadata.rule, boardSize: viewDocument.metadata.boardSize || 15,
        stones: board.flatMap((row, rowIndex) => row.flatMap((player, colIndex) => player ? [{ row: rowIndex, col: colIndex, player }] : [])),
      };
      const collectionId = `saved-collection-${document.id}`;
      const existing = puzzleCollections.find((collection) => collection.id === collectionId);
      const nextCollections = existing
        ? puzzleCollections.map((collection) => collection.id === collectionId ? { ...collection, title: saveFolder, puzzles: [...collection.puzzles, puzzle] } : collection)
        : [...puzzleCollections, { id: collectionId, title: saveFolder, source: "半步五子棋打谱本地保存", license: "用户本地", puzzles: [puzzle] }];
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
  const reviewBlocked = () => setToast("读谱模式无法进行该操作");
  const safeUpdateNode = (patch: Partial<RecordNode>) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    recordDraft({ type: "update-node", nodeId: currentId, patch });
  };
  // 标注作为底部 dock 的一个标签页：激活态由 dockPanel === "annotation" 驱动（与走棋旧的展开/收纳一致）。
  const annotationOpen = dockPanel === "annotation";
  // 面板打开时优先拦截棋盘点击（进入标注态，落子被禁用、点空位改放标注）。
  const annotationActive = annotationOpen && !aiGame && mode !== "puzzle";
  // 注释 / 标注 / 走棋工具坞彼此独立共存。棋盘尺寸优先：只有当“注释框展开”同时叠加标注或走棋、
  // 且落在极窄/矮屏时才允许收窄棋盘（CSS 侧再按视口收窄）；单独开标注或走棋绝不缩棋盘——注释框可关，
  // 关掉即可回到一屏。record-tools-stacked 仅负责非尺寸的行距压缩。
  const recordToolsCount = (mode !== "puzzle" && commentExpanded ? 1 : 0) + (annotationActive ? 1 : 0) + (dockPanel ? 1 : 0);
  const commentExpandedWithTools = mode !== "puzzle" && commentExpanded && (annotationActive || Boolean(dockPanel));
  const currentAnnotationLabel = annotationType === "custom" ? Array.from(annotationValue.trim()).slice(0, 4).join("") : annotationValue;
  const exitAnnotationMode = () => { setDockPanel((panel) => panel === "annotation" ? null : panel); setAnnotationPopover(null); };
  const annotationContextRef = useRef(`${document.id}:${currentId}`);
  useEffect(() => {
    const nextContext = `${document.id}:${currentId}`;
    if (annotationContextRef.current === nextContext) return;
    annotationContextRef.current = nextContext;
    // 标注只编辑当前局面；切换工具面板不会退出，真正导航到其他
    // 棋谱节点时才安全结束，避免把下一次棋盘点击误标到新局面。
    setDockPanel((panel) => panel === "annotation" ? null : panel);
    setAnnotationPopover(null);
  }, [document.id, currentId]);
  const markStudioRef = useRef<HTMLDivElement | null>(null);
  const [annotationPopoverBottom, setAnnotationPopoverBottom] = useState(240);
  // 弹出选择器渲染到 body 并按面板上沿固定定位：dock 面板有 overflow:hidden，直接绝对定位会被裁剪。
  const openAnnotationPopover = (kind: "style" | "color" | "type" | "value") => {
    const rect = markStudioRef.current?.getBoundingClientRect();
    setAnnotationPopoverBottom(rect ? Math.max(120, Math.round(window.innerHeight - rect.top + 8)) : 240);
    setAnnotationPopover((current) => current === kind ? null : kind);
  };
  const switchAnnotationType = (type: AnnotationMarkType) => {
    setAnnotationType(type);
    setAnnotationValue(annotationTypePreset(type).fallback);
  };
  const editAnnotationAt = (position: Position) => {
    if (!currentAnnotationLabel) { setToast("请先在标注面板输入自定义文字"); return; }
    const boardSize = viewDocument.metadata.boardSize || 15;
    if (mode === "review") {
      const previous = reviewMarks[reviewMarkKey] || [];
      const nextMarks = setLabelMark(previous, position, currentAnnotationLabel, annotationStyle, annotationColor);
      const next = { ...reviewMarks };
      if (nextMarks.length) next[reviewMarkKey] = nextMarks;
      else delete next[reviewMarkKey];
      setReviewMarks(next);
      const removed = nextMarks.length < previous.length;
      setToast(removed
        ? `已移除本机标注 ${currentAnnotationLabel} · ${coordinateName(position, boardSize)}`
        : `已放置本机标注 ${currentAnnotationLabel} · ${coordinateName(position, boardSize)}，再次点击可移除`);
      return;
    }
    if (mode !== "record") return;
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    const nextMarks = setLabelMark(current.marks, position, currentAnnotationLabel, annotationStyle, annotationColor);
    applyCompactUpdate({ marks: nextMarks });
    const removed = nextMarks.length < current.marks.length;
    const action = removed ? "已移除标注" : "已放置标注";
    if (editingDatabaseView) setToast(`已创建编辑副本并${removed ? "移除" : "放置"}标注 ${currentAnnotationLabel} · ${coordinateName(position, boardSize)}`);
    else if (!isCompact()) setToast(`${action} ${currentAnnotationLabel} · ${coordinateName(position, boardSize)}${removed ? "" : "，再次点击可移除"}`);
    else setToast(`标注 ${currentAnnotationLabel} ${removed ? "已从草稿移除" : "已加入草稿"}`);
  };
  // Navigate an already-rendered next move by its node ID. A DP/LIB view is
  // only a projection, so the rendered node's parent remains authoritative.
  const navigateVariation = (targetId: string) => {
    if (mode === "puzzle") return;
    const target = viewDocument.nodes[targetId];
    if (!target || target.id === currentId) return;
    const pivot = target.parentId ? viewDocument.nodes[target.parentId] : visibleVariationPivot(viewDocument, currentId);
    if (!pivot) return;
    clearBoardMotion();
    const dynamicSession = dynamicViewSession.current;
    const detachedSource = detachedDynamicSource.current;
    // Draft-created nodes only exist in the local editing overlay. They must
    // never be sent to the database query session as if they were source
    // branches; doing so loses the local branch and makes later taps appear
    // stuck at the same ply.
    const isLocalDraftTarget = draftOverlay.added.has(target.id);
    if (dynamicSession && target.move && !isLocalDraftTarget && (isDynamicDatabaseView(document) || detachedSource === dynamicSession)) {
      const session = dynamicSession;
      const pivotDepth = depthOf(viewDocument, pivot.id);
      navigateDynamic(session, () => session.moveFromDepth(pivotDepth, target.move!), () => { exitAnnotationMode(); setSheet(null); }, hasDraft(draft) ? draft : undefined);
      return;
    }
    const session = pagedSession.current;
    if (session && isPagedLibraryView(document)) {
      const index = session.indexForId(target.id);
      if (index !== undefined) pagedNavigate.current(index);
      else setToast("这个分支尚未载入，请重新打开分支面板");
      exitAnnotationMode(); setSheet(null);
      return;
    }
    setCurrentId(target.id); exitAnnotationMode(); setSheet(null);
  };
  const play = (position: Position, options: { ignoreAnnotation?: boolean } = {}) => {
    // The open annotation panel is an independent, node-local editing mode.
    // Intercept every board tap before occupied-point rejection and variation
    // navigation so a branch dot or stone can be labelled without entering it.
    if (annotationActive && !options.ignoreAnnotation && (mode === "record" || mode === "review")) {
      editAnnotationAt(position);
      return;
    }
    const occupiedPoint = Boolean(board[position.row]?.[position.col]);
    // A variation affordance is only valid on an empty intersection. Reject an
    // occupied click before any fallback coordinate lookup can navigate to a
    // stale or malformed branch target. Annotation editing has already returned.
    if (occupiedPoint) {
      playSound("warning");
      showBoardFeedback(position, "illegal");
      return;
    }
    if (mode === "review") {
      const existing = findVisibleVariationTarget(viewDocument, currentId, position);
      if (existing) { navigateVariation(existing.target.id); return; }
      setToast(current.children.length ? "读谱模式只能点击已有变化" : "当前已到棋谱末尾");
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
        if (openingStage.kind === "choose-fifth-count") {
          if (openingStage.actor !== "human") { setToast("AI 正在选择第5手打点数量"); return; }
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
          setCurrentId(existingVariation.target.id); triggerBoardMotion("branch"); setSheet(null);
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
        if (turn === aiGame.humanPlayer) startAiGameReply(branch.document, branch.nodeId, aiGame.aiPlayer, aiGame);
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
      startAiGameReply(result.document, result.nodeId, aiGame.aiPlayer, aiGame);
      return;
    }
    if (mode === "record" && !continuationEditMode) {
      const variation = findVisibleVariationTarget(viewDocument, currentId, position);
      if (variation) { navigateVariation(variation.target.id); return; }
    }
    if (mode === "puzzle") {
      if (puzzleSetup) {
        const result = placePuzzleSetupStone(puzzleSetup.session, position, activePlacementPlayer);
        if (!result.placed) { showBoardFeedback(position, "illegal"); playSound("error"); return; }
        applyPuzzleSetupSession(result.session); triggerBoardMotion("place");
        playSound(activePlacementPlayer === "black" ? "move-black" : "move-white");
        return;
      }
      if (!currentPuzzle || aiThinking || puzzleOutcome) return;
      const legality = puzzleMoveLegality(board, position, currentPuzzle.player, currentPuzzleRule.mode);
      if (!legality.legal) {
        playSound(legality.reason === "该位置已有棋子" ? "error" : "warning");
        showBoardFeedback(position, legality.reason === "该位置已有棋子" ? "illegal" : "forbidden");
        setToast(legality.reason === "该位置已有棋子" ? legality.reason : `此处为黑方${legality.reason}，本题按禁手规则不可落子`);
        return;
      }
      const result = addMoveAs(document, currentId, position, currentPuzzle.player);
      setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place"); playSound(currentPuzzle.player === "black" ? "move-black" : "move-white");
      if (winnerAt(boardAt(result.document, result.nodeId), position, result.document.metadata.rule)) { playSound("success"); setPuzzleOutcome("won"); recordPuzzleAttempt(true); return; }
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
    if (!result.created) { showBoardFeedback(position, "illegal"); return; }
    setCurrentId(result.nodeId);
    triggerBoardMotion("place");
    playSound((result.document.nodes[result.nodeId]?.move?.player || activePlacementPlayer) === "black" ? "move-black" : "move-white");
    setContinuationEditMode(false);
    const node = result.document.nodes[result.nodeId];
    if (node) recordDraft({ type: "add-move", parentId: currentId, node: { ...node, children: [...node.children], marks: [...node.marks] } });
  };
  const mark = (position: Position) => {
    if (mode === "review") {
      setReviewMarks((allMarks) => {
        const nextMarks = toggleMark(allMarks[reviewMarkKey] || [], position);
        const next = { ...allMarks };
        if (nextMarks.length) next[reviewMarkKey] = nextMarks;
        else delete next[reviewMarkKey];
        return next;
      });
      setToast("已更新本机标注，原棋谱不变");
      return;
    }
    if (mode !== "record") return;
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    recordDraft({ type: "update-node", nodeId: currentId, patch: { marks: toggleMark(current.marks, position) } });
    setToast(editingDatabaseView ? "已创建编辑副本并加入标注，原数据库不变" : "标注已加入草稿");
  };
  const updateMetadata = (patch: Partial<GameDocument["metadata"]>) => {
    if (mode === "review") { setToast("读谱模式为只读，不能编辑棋谱信息"); return; }
    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) {
      detachViewForEditing({ ...emptyDraft(), metadata: patch });
      return;
    }
    setDraft((state) => ({ ...state, metadata: { ...state.metadata, ...patch }, redo: [] }));
  };
  const addReviewLabel = (position: Position, label: string) => {
    setReviewMarks((allMarks) => {
      const nextMarks = setLabelMark(allMarks[reviewMarkKey] || [], position, label, annotationStyle, annotationColor);
      const next = { ...allMarks };
      if (nextMarks.length) next[reviewMarkKey] = nextMarks;
      else delete next[reviewMarkKey];
      return next;
    });
  };
  const markCandidate = (index: number) => {
    const candidate = candidates[index];
    if (!candidate) return;
    const label = String.fromCharCode(65 + index);
    if (mode === "review") {
      addReviewLabel(candidate.position, label);
      setToast(`已标记候选 ${label} · ${coordinateName(candidate.position)}，原棋谱不变`);
      return;
    }
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    applyCompactUpdate({ marks: setLabelMark(current.marks, candidate.position, label, annotationStyle, annotationColor) });
    if (editingDatabaseView) setToast(`已创建编辑副本并标记候选 ${label} · ${coordinateName(candidate.position)}`);
    else if (!isCompact()) setToast(`已标记候选 ${label} · ${coordinateName(candidate.position)}`);
  };
  const markTopCandidates = () => {
    if (mode === "review") {
      candidates.slice(0, 5).forEach((candidate, index) => addReviewLabel(candidate.position, String.fromCharCode(65 + index)));
      setToast(`已标记前 ${Math.min(5, candidates.length)} 个候选点，原棋谱不变`);
      return;
    }
    const marks = candidates.slice(0, 5).reduce((result, candidate, index) => setLabelMark(result, candidate.position, String.fromCharCode(65 + index), annotationStyle, annotationColor), current.marks);
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    applyCompactUpdate({ marks });
    if (editingDatabaseView) setToast(`已创建编辑副本并标记前 ${Math.min(5, candidates.length)} 个候选点`);
    else if (!isCompact()) setToast(`已标记前 ${Math.min(5, candidates.length)} 个候选点`);
  };  const runVcf = () => {
    if ((viewDocument.metadata.boardSize || 15) !== 15) { setToast("VCF 当前仅支持十五路棋盘，非十五路请使用手动打谱"); return; }
    cancelActiveAiComputation("superseded");
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
    cancelActiveAiComputation("user", true);
  };
  const startThink = () => {
    if (thinkRunning) { stopThink(); return; }
    if (mode !== "record") { setToast("“思考”只用于打谱界面的当前局面分析"); return; }
    if (aiGame) { setToast("人机对局会自动思考，请在普通打谱局面使用此按钮"); return; }
    if ((viewDocument.metadata.boardSize || 15) !== 15) { setToast("AI 思考当前仅支持十五路棋盘"); return; }
    cancelActiveAiComputation("superseded");
    vcfWorker.current?.terminate(); vcfWorker.current = null; setVcfRunning(false); setVcfResult(null);
    const generation = ++thinkGeneration.current;
    if (sheet === "think") setSheet(null);
    if (thinkDirectMove) setToast("AI 已在后台思考，完成后会直接落子");
    else if (thinkSheetOnStart) setToast("AI 正在思考，完成后会弹出推荐面板");
    else setToast("AI 已在后台思考，完成后会在棋盘标出推荐点");
    setThinkRunning(true); setThinkResult(null); setThinkContextKey(currentPositionKey); setThinkVisualState("thinking");
    const worker = new Worker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`);
    rapfiThinkWorker.current = worker;
    const handle = aiWorkerController.current.start(worker, "analysis", currentPositionKey);
    taskManager.current.start({ kind: "ai", title: "AI 思考", taskId: handle.requestId, cancellable: true, retryable: true });
    taskManager.current.update({ stage: "searching", message: "正在寻找下一步" });
    const accept = (result: AiMoveResult) => {
      if (generation !== thinkGeneration.current || !aiWorkerController.current.isCurrent(handle)) return;
      aiWorkerController.current.finish(handle);
      thinkWorker.current = null; rapfiThinkWorker.current = null; setThinkRunning(false);
      if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.success(result);
      if (result.move && thinkDirectMove) {
        setThinkResult(null); setThinkVisualState("idle"); setThinkContextKey(""); setSheet(null);
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
      if (generation !== thinkGeneration.current || !aiWorkerController.current.isCurrent(handle)) return;
      const fallback = new PuzzleAiWorker();
      if (!aiWorkerController.current.replaceWorker(handle, fallback)) return;
      rapfiThinkWorker.current = null;
      thinkWorker.current = fallback;
      fallback.onmessage = (event: MessageEvent<AiMoveResult & { requestId?: string; generation?: number; result?: AiMoveResult }>) => {
        const requestId = event.data.requestId || handle.requestId;
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current || !aiWorkerController.current.isCurrent(handle, requestId, event.data.generation ?? handle.generation)) return;
        accept(event.data.result || event.data);
      };
      fallback.onerror = () => {
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current || !aiWorkerController.current.isCurrent(handle)) return;
        aiWorkerController.current.finish(handle); thinkWorker.current = null; setThinkRunning(false); setThinkVisualState("error"); setToast("AI 思考线程异常，请重试");
        if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.fail(new Error("AI 思考线程异常"));
      };
      fallback.postMessage({ requestId: handle.requestId, generation: handle.generation, board, player: nextPlayer, rule: viewDocument.metadata.rule, purpose: "think" });
    };
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: string; generation?: number; result?: AiMoveResult; message?: string }>) => {
      if (rapfiThinkWorker.current !== worker || generation !== thinkGeneration.current || !aiWorkerController.current.isCurrent(handle, event.data.requestId || handle.requestId, event.data.generation ?? handle.generation)) return;
      if (event.data.type === "result" && event.data.result) accept(event.data.result);
      else if (event.data.type === "error") useFallback();
    };
    worker.onerror = () => { if (rapfiThinkWorker.current !== worker || generation !== thinkGeneration.current || !aiWorkerController.current.isCurrent(handle)) return; useFallback(); };
    const moves = pathToNode(viewDocument, currentId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
    worker.postMessage({ type: "analyze", requestId: handle.requestId, generation: handle.generation, engine: "fallback", size: viewDocument.metadata.boardSize || 15, moves, player: nextPlayer, rule: viewDocument.metadata.rule, timeMs: 5000, maxDepth: 64 });
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
  const navigateDynamic = (session: DpViewSession | RenLibWebViewSession, operation: () => Promise<{ document: GameDocument; currentId: string }>, onOpened?: () => void, preserveDraft?: DraftState) => {
    if (dynamicNavigationPending.current) return;
    const version = ++dynamicNavigationVersion.current;
    dynamicNavigationPending.current = true;
    setDynamicNavigationBusy(true);
    void operation().then((opened) => {
      if (version !== dynamicNavigationVersion.current || dynamicViewSession.current !== session) return;
      setDocument(opened.document); setCurrentId(opened.currentId);
      if (preserveDraft && hasDraft(preserveDraft)) setDraft(preserveDraft);
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
    if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(currentId)) { navigateDynamic(dynamicSession, () => dynamicSession.back()); return; }
    const session = pagedSession.current;
    if (session) { requestPagedIndex((activeSession) => activeSession.parentIndex(currentId)); return; }
    if (current.parentId) setCurrentId(current.parentId);
  };
  const goNext = () => {
    clearBoardMotion();
    playSound("navigate");
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(currentId)) {
      const next = current.preferredChildId ? viewDocument.nodes[current.preferredChildId] : current.children.length ? viewDocument.nodes[current.children[0]] : undefined;
      if (next?.move) {
        if (draftOverlay.added.has(next.id)) setCurrentId(next.id);
        else { const move = next.move; navigateDynamic(dynamicSession, () => dynamicSession.move(move)); }
      }
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
    if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(id)) {
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
    if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(id)) {
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
    if (!isPathNode && pivotId && mode !== "review") { chooseChild(id, pivotId); return; }
    playSound("navigate");
    setCurrentId(id); setSheet(null);
  };
  const toggleTreeBookmark = (nodeId: string) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    const node = viewDocument.nodes[nodeId];
    if (!node) { setToast("节点不存在，无法添加书签"); return; }
    const existed = activeBookmarks.some((bookmark) => bookmark.nodeId === nodeId);
    const title = `${nodeKindLabel(node)} · 第 ${depthOf(viewDocument, nodeId)} 手`;
    setBranchBookmarks((all) => ({ ...all, [document.id]: toggleRecordBookmark(all[document.id] || [], nodeId, title) }));
    setToast(existed ? "已取消书签" : "已添加书签，可在棋谱树中编辑标题和备注");
  };
  const editTreeBookmark = (bookmark: RecordBookmark, patch: Partial<Pick<RecordBookmark, "title" | "note" | "accent">>) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    setBranchBookmarks((all) => ({ ...all, [document.id]: updateRecordBookmark(all[document.id] || [], bookmark.id, patch) }));
    setToast("书签已更新");
  };
  const deleteTreeBookmark = (bookmark: RecordBookmark) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    setBranchBookmarks((all) => ({ ...all, [document.id]: (all[document.id] || []).filter((item) => item.id !== bookmark.id) }));
    setToast("书签已删除");
  };
  const copyTreeBranch = (nodeId: string) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    if (compactIndexOf(document)) { setToast("大型棋谱当前只加载可视窗口，请先创建编辑副本再复制完整分支"); return; }
    const clipboard = copyRecordSubtree(viewDocument, nodeId, activeBookmarks);
    if (!clipboard) { setToast("这个分支不完整，暂时无法复制"); return; }
    setTreeClipboard(clipboard);
    setToast(`已复制 ${Object.keys(clipboard.nodes).length} 个节点，请在树中选择粘贴目标`);
  };
  const cutTreeBranch = (nodeId: string) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    copyTreeBranch(nodeId);
    deleteTreeBranch(nodeId);
    setToast("已剪切分支，可选择目标节点后粘贴");
  };
  const pasteTreeBranch = (targetId: string) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    if (!treeClipboard) { setToast("请先复制一个分支"); return; }
    if (compactIndexOf(document)) { setToast("大型棋谱需先创建编辑副本再粘贴完整分支"); return; }
    const result = pasteRecordSubtree(viewDocument, targetId, treeClipboard);
    if (!result.ok) { setToast(result.reason); return; }
    recordDraft({ type: "add-subtree", parentId: targetId, rootId: result.rootId, nodes: result.nodes, bookmarks: result.bookmarks });
    if (result.bookmarks.length) setBranchBookmarks((all) => ({ ...all, [document.id]: mergeRecordBookmarks(all[document.id] || [], result.bookmarks) }));
    setCurrentId(result.rootId);
    setToast(`已粘贴 ${Object.keys(result.nodes).length} 个节点，可用“撤销”整体回退`);
  };
  const renameTreeBranch = (nodeId: string, title: string) => {
    const normalized = title.trim();
    if (!normalized) { setToast("分支名称不能为空"); return; }
    const docId = viewDocument.id;
    if (mode === "review") {
      setReviewBranchNames((current) => ({ ...current, [docId]: { ...(current[docId] || {}), [nodeId]: normalized } }));
      setToast("已保存为本机分支名称，读谱模式不修改原谱");
      return;
    }
    recordDraft({ type: "update-node", nodeId, patch: { boardText: normalized } });
    if (reviewBranchNames[docId]?.[nodeId]) {
      const rest = { ...reviewBranchNames[docId] };
      delete rest[nodeId];
      const next = { ...reviewBranchNames };
      if (Object.keys(rest).length) next[docId] = rest; else delete next[docId];
      setReviewBranchNames(next);
    }
    setToast("分支名称已更新");
  };
  const createBranchFromTree = (nodeId: string) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    if (!viewDocument.nodes[nodeId]) return;
    clearBoardMotion(); setCurrentId(nodeId); setSheet(null);
    setToast("已定位到分支起点，请在棋盘空位落子创建新分支");
  };
  const deleteTreeBranch = (nodeId: string) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    const node = viewDocument.nodes[nodeId];
    if (!node?.parentId) { setToast("起始局面不能删除"); return; }
    if (!window.confirm(`确定删除“${nodeKindLabel(node)}”及其全部后续吗？保存前可用撤销恢复。`)) return;
    recordDraft({ type: "delete-subtree", parentId: node.parentId, rootId: nodeId });
    if (path.some((entry) => entry.id === nodeId) || currentId === nodeId) setCurrentId(node.parentId);
    setToast("已加入删除草稿，保存前可撤销");
  };
  const deleteCurrentVariation = () => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    if (!current.parentId) { setToast("起始局面不能删除"); return; }
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    const parentId = current.parentId;
    recordDraft({ type: "delete-subtree", parentId, rootId: currentId });
    setCurrentId(parentId); setSheet(null);
    setToast(editingDatabaseView ? "已创建编辑副本并删除当前变化，原数据库不变" : "已删除当前这一步及全部后续变化，保存后生效");
  };
  const closeWorkspaceSelector = () => setWorkspaceSelectorOpen(false);
  /** Perform a record switch without checking the draft. This is only called
   * after the single outer draft guard has completed. */
  const performOpenRecord = (next: GameDocument, nodeId = next.rootId, largeId?: string, sourceFile?: File, openMode: AppMode = "record") => {
    cancelActiveAiComputation("record-switch");
    dynamicNavigationVersion.current += 1;
    dynamicNavigationPending.current = false;
    setDynamicNavigationBusy(false);
    setContinuationEditMode(false);
    // A record switch invalidates any source session retained by a detached
    // editing copy. Keep the newly opened dynamic session (it is installed by
    // the importer before this function runs), but never let an old source
    // identity leak into the next record.
    detachedDynamicSource.current = null;
    if (!isDynamicDatabaseView(next)) { dynamicViewSession.current?.close(); dynamicViewSession.current = null; }
    pagedNavigationVersion.current += 1;
    pagedSession.current?.close(); pagedSession.current = null;
    persistedDocuments.current.add(next);
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    recordSession.current = { document: next, currentId: nodeId };
    nativeSourceFile.current = sourceFile || null;
    setDocument(next); setCurrentId(nodeId); setDraft(compactIndexOf(next) || openMode === "review" ? emptyDraft() : loadDraftFromLocal(next.id));
    setMode(openMode); setAiGame(null); exitAnnotationMode(); setDockPanel(null); setTab("record"); setSheet(null); closeWorkspaceSelector();
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
    removePastedDraftBookmarks(draft);
    if (compactIndexOf(document)) void removeDraftForDocument(document.id); else removeDraftFromLocal(document.id);
    setDraft(emptyDraft()); setPendingSwitch(null); action?.();
  };
  const applyAiRuleChoice = (choice: typeof AI_RULE_CHOICES[number]) => {
    cancelActiveAiComputation("settings-change");
    setAiRuleFamily(choice.rule);
    setAiOpeningRule(choice.openingRule);
    setAiRuleDetail(null);
  };
  const selectedAiRule = AI_RULE_CHOICES.find((choice) => choice.rule === aiRuleFamily && choice.openingRule === aiOpeningRule) || AI_RULE_CHOICES[0];
  const startNewAiGame = () => withDraftGuard(() => {
    cancelActiveAiComputation("settings-change"); setAiThinking(false);
    const next = createDocument("人机对战");
    next.metadata.rule = aiRuleFamily;
    next.metadata.openingRule = aiOpeningRule;
    // 五手多打的数量在第4手后由对局中的小弹窗决定，不在开局前写死。
    next.metadata.openingN = undefined;
    next.metadata.black = aiHumanPlayer === "black" ? "我" : "半步 AI";
    next.metadata.white = aiHumanPlayer === "white" ? "我" : "半步 AI";
    const timeControlName = AI_TIME_OPTIONS.find((option) => option.value === aiTimeLimitMs)?.title || "不限";
    next.metadata.event = `${selectedAiRule.name} · ${selectedAiRule.badge} · AI ${aiStrength} · ${timeControlName} · 人机对战`;
    const opening = createOpeningSession(aiOpeningRule, aiOpeningN, aiHumanPlayer);
    const thinkProfile = aiStrength === "自由" ? { timeMs: aiFreeTimeMs, maxDepth: aiFreeDepth } : AI_STRENGTH_PROFILES[aiStrength];
    const game: AiGameState = { humanPlayer: aiHumanPlayer, aiPlayer: otherPlayer(aiHumanPlayer), strength: aiStrength, forbiddenEnabled: aiRuleFamily === "renju", timeLimitMs: aiTimeLimitMs, thinkTimeMs: thinkProfile.timeMs, thinkDepth: thinkProfile.maxDepth, unlimitedThinking: aiStrength === "自由" && aiFreeUnlimited, outcome: null, opening };
    aiClockLastAt.current = null; aiClockExpired.current = false; setAiHumanElapsedMs(0);
    performOpenRecord(next);
    setAiGame(game); setPlacementPlayer(aiHumanPlayer); setPlacementLocked(true); setSheet(null); setDockPanel(null);
    setToast(`${selectedAiRule.name}开局已开始`);
    scheduleAiOpening(game, next, next.rootId);
  });
  const newRecord = () => withDraftGuard(() => { const next = createDocument("新建棋谱", defaultBoardSize); performOpenRecord(next); setToast("已新建空白棋谱"); });
  const createBoardWithSize = (size: number) => withDraftGuard(() => {
    const next = createDocument(`新建${size}路棋谱`, size);
    performOpenRecord(next);
    setToast(`已新建 ${size} 路空白棋谱`);
  });
  const openRecord = (
    next: GameDocument,
    nodeId = next.rootId,
    options?: { largeId?: string; sourceFile?: File; mode?: Extract<AppMode, "record" | "review">; onOpened?: () => void },
  ) => withDraftGuard(() => {
    performOpenRecord(next, nodeId, options?.largeId, options?.sourceFile, options?.mode || "record");
    options?.onOpened?.();
  });
  const openNativeDatabase = () => withDraftGuard(() => {
    cancelActiveAiComputation("record-switch");
    const progressId = beginImportProgress(NATIVE_DATABASE_TITLE, "正在读取内置局面数据库");
    const session = new DpViewSession();
    void loadNativeDatabaseFile().then(async (file) => {
      updateImportProgress(progressId, { phase: "indexing", detail: "正在建立局面查询索引；数据库内容按需读取" });
      const opened = await session.open(file);
      dynamicViewSession.current?.close();
      dynamicViewSession.current = session;
      openRecord(opened.document, opened.currentId, { sourceFile: file, onOpened: () => setImportState("dp-query-ready", { records: opened.recordCount, native: true }) });
      setToast(`已打开内置数据库，共 ${opened.recordCount} 条局面记录，分支按局面实时读取`);
      finishImportProgress(progressId, `内置数据库查询已就绪，共 ${opened.recordCount} 条记录`);
    }).catch((error) => {
      session.close();
      const message = error instanceof Error ? error.message : "内置局面数据库打开失败";
      setToast(`无法打开 ${NATIVE_DATABASE_TITLE}：${message}`);
      failImportProgress(progressId, message);
    });
  });
  const performOpenLargeRecord = async (summary: LargeDocumentSummary, openMode: Extract<AppMode, "record" | "review"> = "record") => {
    cancelActiveAiComputation("record-switch");
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
        setMode(openMode); setAiGame(null); exitAnnotationMode(); setDockPanel(null); setTab("record"); closeWorkspaceSelector();
        localStorage.setItem(ACTIVE_LARGE_RECORD_KEY, summary.id);
        setToast("棋谱已用分页后端打开");
        finishImportProgress(progressId, "大型棋谱已打开");
        return;
      }
      const next = await loadLargeDocument(summary.id);
      if (!next) { setToast("大型棋谱文件不存在，索引已清理"); failImportProgress(progressId, "本机棋谱不存在，已清理失效记录"); await removeLargeDocument(summary.id); setLargeSummaries((items) => items.filter((item) => item.id !== summary.id)); return; }
      performOpenRecord(next, next.rootId, summary.id, undefined, openMode);
      void loadDraftForDocument(summary.id).then((stored) => {
        // A review session must never receive an editor draft. Also ignore a
        // late response if the user has already switched to another record.
        if (openMode !== "record" || recordSession.current.document.id !== summary.id) return;
        if (stored && compactIndexOf(next)) {
          const currentFingerprint = documentFingerprint(next);
          if (stored.baseFingerprint === currentFingerprint) setDraft({ operations: stored.operations, redo: stored.redo });
        }
      });
      finishImportProgress(progressId, "大型棋谱已打开");
    } catch { setToast("大型棋谱读取失败，请检查本机存储"); failImportProgress(progressId, "读取失败，请检查本机存储"); }
  };
  const openLargeRecord = (summary: LargeDocumentSummary, openMode: Extract<AppMode, "record" | "review"> = "record") => withDraftGuard(() => { void performOpenLargeRecord(summary, openMode); });
  const performDeleteRecord = (item: GameDocument) => {
    cancelActiveAiComputation("record-switch");
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
    cancelActiveAiComputation("record-switch");
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
    cancelActiveAiComputation("record-switch");
    if (collection.id.startsWith("native-")) { setToast("内置题库不能删除"); return; }
    const folder = libraryFolders.puzzleAssignments[collection.id] || "我的题库";
    setRecycleBin(addToRecycleBin({ id: collection.id, kind: "puzzle-collection", item: collection, folder, deletedAt: new Date().toISOString() }));
    const next = puzzleCollections.filter((item) => item.id !== collection.id);
    savePuzzleCollections(next); setPuzzleCollections(next);
    setLibraryFolders((folders) => {
      const assignments = { ...folders.puzzleAssignments };
      delete assignments[collection.id];
      let order = folders.order;
      if (order) {
        const puzzleBucket = { ...(order.puzzles ?? {}) };
        delete puzzleBucket[collection.id];
        order = removeFromOrder({ ...order, puzzles: puzzleBucket }, "puzzleCollections", folder, collection.id);
      }
      return { ...folders, puzzleAssignments: assignments, order };
    });
    if (puzzleCollectionIndex >= next.length) setPuzzleCollectionIndex(Math.max(0, next.length - 1));
    setToast(`已移入回收站：${collection.title}`);
  });
  const restoreRecycleEntry = (entry: RecycleBinEntry) => {
    cancelActiveAiComputation("record-switch");
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
    if (!window.confirm(permanentDeleteConfirmation(entry))) return;
    cancelActiveAiComputation("record-switch");
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
    if (!recycleBin.length || !window.confirm(emptyRecycleBinConfirmation(recycleBin.length))) return;
    cancelActiveAiComputation("record-switch");
    const largeEntries = recycleBin.filter((entry): entry is Extract<RecycleBinEntry, { kind: "large-record" }> => entry.kind === "large-record");
    void Promise.all(largeEntries.map((entry) => removeLargeTrashDocument(entry.id))).then(() => {
      localStorage.removeItem("banbu-recycle-bin-v1");
      setRecycleBin([]);
      setToast("回收站已清空");
    }).catch(() => setToast("回收站清空失败，请稍后重试"));
  };
  const createLibraryFolder = (kind: LibrarySection, parent = "") => {
    setFolderSheetMode("create");
    setFolderCreationSection(kind);
    setFolderCreationParent(parent);
    setNewFolderName("");
    setSheet("folder");
  };
  const moveBatchSelectionToFolder = () => {
    if (!batchSelectedIds.length || !folderCreationParent) return;
    const selected = new Set(batchSelectedIds);
    setLibraryFolders((folders) => ({ ...folders, recordAssignments: {
      ...folders.recordAssignments,
      ...Object.fromEntries([...selected].map((id) => [id, folderCreationParent])),
    } }));
    setToast(`已移动 ${selected.size} 份棋谱到“${folderCreationParent}”`);
    setExpandedLibraryFolders((current) => new Set([...current, folderCreationParent]));
    setSheet(null);
  };
  const confirmCreateLibraryFolder = () => {
    const name = newFolderName.trim().split("\\").join(" ").split(FOLDER_SEPARATOR).join(" ");
    if (!name) { setToast("请输入文件夹名称"); return; }
    const key = folderCreationSection === "records" ? "recordFolders" : "puzzleFolders";
    const path = folderCreationParent ? `${folderCreationParent}${FOLDER_SEPARATOR}${name}` : name;
    if (libraryFolders[key].includes(path)) { setToast("当前文件夹中已经有同名子文件夹"); return; }
    setLibraryFolders((currentFolders) => ({ ...currentFolders, [key]: [...currentFolders[key], path] }));
    setExpandedLibraryFolders((current) => new Set([...current, folderCreationParent, path])); setToast(`已创建文件夹“${path}”`);
    setSheet(null);
  };
  const assignLibraryItem = (kind: LibrarySection, id: string, folder: string) => {
    const key = kind === "records" ? "recordAssignments" : "puzzleAssignments";
    setLibraryFolders((currentFolders) => ({ ...currentFolders, [key]: { ...currentFolders[key], [id]: folder } }));
    setToast(`已移动到“${folder}”`);
  };
  // Manual ordering: an absent order entry always means the natural insertion
  // order, so clearing a key is the "恢复默认" action and stays reversible.
  const updateLibraryOrder = (kind: LibraryOrderKind, key: string, ids: string[] | null) => setLibraryFolders((folders) => {
    const maps: LibraryOrderMaps = { ...(folders.order ?? {}) };
    const bucket = { ...(maps[kind] ?? {}) };
    if (ids && ids.length > 1) bucket[key] = ids; else delete bucket[key];
    if (Object.keys(bucket).length) maps[kind] = bucket; else delete maps[kind];
    return { ...folders, order: maps };
  });
  const libraryFoldersRef = useRef(libraryFolders);
  libraryFoldersRef.current = libraryFolders;
  const naturalIdsFor = (kind: LibraryOrderKind, key: string): string[] => {
    if (kind === "records") return [
      ...library.filter((item) => (libraryFoldersRef.current.recordAssignments[item.id] || "未分类") === key).map((item) => item.id),
      ...largeSummaries.filter((item) => (libraryFoldersRef.current.recordAssignments[item.id] || "未分类") === key).map((item) => item.id),
    ];
    if (kind === "puzzleCollections") return puzzleCollections
      .filter((collection) => (libraryFoldersRef.current.puzzleAssignments[collection.id] || (collection.id.startsWith("native-") ? "内置题库" : "我的题库")) === key)
      .map((collection) => collection.id);
    if (kind === "puzzles") return puzzleCollections.find((collection) => collection.id === key)?.puzzles.map((puzzle) => puzzle.id) ?? [];
    return folderChildren(kind === "recordFolders" ? libraryFoldersRef.current.recordFolders : libraryFoldersRef.current.puzzleFolders, key);
  };
  const performLibraryDrop = (kind: LibraryOrderKind, key: string, draggedId: string, targetId: string, placeBefore: boolean) => {
    updateLibraryOrder(kind, key, moveRelative(applyOrder(naturalIdsFor(kind, key), libraryFoldersRef.current.order?.[kind]?.[key]), draggedId, targetId, placeBefore));
  };
  const touchDragBridge = useRef<{ enabled: () => boolean; performDrop: typeof performLibraryDrop }>({ enabled: () => true, performDrop: performLibraryDrop });
  touchDragBridge.current = { enabled: () => !batchEditMode, performDrop: performLibraryDrop };
  useEffect(() => attachLibraryTouchDrag({
    enabled: () => touchDragBridge.current.enabled(),
    performDrop: (kind, key, draggedId, targetId, placeBefore) => touchDragBridge.current.performDrop(kind, key, draggedId, targetId, placeBefore),
  }), []);
  const libraryDrag = useRef<{ kind: LibraryOrderKind; key: string; id: string } | null>(null);
  const onLibraryDragStart = (kind: LibraryOrderKind, key: string, id: string) => (event: ReactDragEvent) => {
    libraryDrag.current = { kind, key, id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };
  const onLibraryDragOver = (event: ReactDragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = event.currentTarget as HTMLElement;
    const before = event.clientY < target.getBoundingClientRect().top + target.clientHeight / 2;
    target.classList.toggle("drag-before", before);
    target.classList.toggle("drag-after", !before);
  };
  const onLibraryDragLeave = (event: ReactDragEvent) => {
    (event.currentTarget as HTMLElement).classList.remove("drag-before", "drag-after");
  };
  const onLibraryDrop = (kind: LibraryOrderKind, key: string, naturalIds: string[]) => (event: ReactDragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const dragged = libraryDrag.current;
    const targetId = target.dataset.orderId || "";
    target.classList.remove("drag-before", "drag-after");
    libraryDrag.current = null;
    if (!dragged || dragged.kind !== kind || dragged.key !== key || !targetId || dragged.id === targetId) return;
    const before = event.clientY < target.getBoundingClientRect().top + target.clientHeight / 2;
    performLibraryDrop(kind, key, dragged.id, targetId, before);
  };
  const [librarySortMenu, setLibrarySortMenu] = useState<string | null>(null);
  const toggleLibrarySortMenu = (menuId: string) => setLibrarySortMenu((current) => current === menuId ? null : menuId);
  const announceOrderToast = (message: string) => {
    // Same-commit toast mount + list remount crashes React DOM placement
    // (insertBefore anchor); defer the toast to the next frame.
    window.setTimeout(() => setToast(message), 0);
  };
  const sortLibraryContainer = (kind: LibraryOrderKind, key: string, naturalIds: string[], titleOf: (id: string) => string, direction: "az" | "za" | null) => {
    setLibrarySortMenu(null);
    if (!direction) { updateLibraryOrder(kind, key, null); announceOrderToast("已恢复默认排序"); return; }
    const titles = Object.fromEntries(naturalIds.map((id) => [id, titleOf(id) || ""]));
    updateLibraryOrder(kind, key, sortIdsByTitles(naturalIds, titles, direction));
    announceOrderToast(direction === "az" ? "已按标题 A→Z 排序" : "已按标题 Z→A 排序");
  };
  const resetLibraryOrder = (targets: Array<[LibraryOrderKind, string]>) => {
    targets.forEach(([kind, key]) => updateLibraryOrder(kind, key, null));
    setLibrarySortMenu(null);
    announceOrderToast("已恢复默认排序");
  };
  const renderLibrarySortMenu = (menuId: string, items: Array<[string, () => void]>) => librarySortMenu !== menuId ? null : <>
    <div className="library-sort-backdrop" onClick={() => setLibrarySortMenu(null)}/>
    <div className="library-sort-menu" role="menu" aria-label="排序方式">
      {items.map(([label, action]) => <button key={label} type="button" role="menuitem" onClick={action}>{label}</button>)}
    </div>
  </>;
  const beginLibraryRename = (target: LibraryRenameTarget) => {
    setRenameTarget(target); setRenameName(target.kind.includes("folder") ? folderLabel(target.name) : target.name); setSheet("rename");
  };
  const confirmLibraryRename = async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) { setToast("请输入新的名称"); return; }
    if ((renameTarget.kind === "record-folder" || renameTarget.kind === "puzzle-folder") && name !== renameTarget.name) {
      const folders = renameTarget.kind === "record-folder" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders;
      const nextPath = folderParent(renameTarget.name) ? `${folderParent(renameTarget.name)}/${name}` : name;
      if (folders.includes(nextPath) && nextPath !== renameTarget.name) { setToast("当前文件夹中已经有同名子文件夹"); return; }
    }
    try {
      if (renameTarget.kind === "record-folder" || renameTarget.kind === "puzzle-folder") {
        const records = renameTarget.kind === "record-folder";
        const folderKey = records ? "recordFolders" : "puzzleFolders";
        const assignmentKey = records ? "recordAssignments" : "puzzleAssignments";
        const oldName = renameTarget.name;
        const newName = folderParent(oldName) ? `${folderParent(oldName)}/${name}` : name;
        setLibraryFolders((folders) => {
          const assignments = { ...folders[assignmentKey] };
          Object.entries(assignments).forEach(([id, folder]) => {
            if (folder === oldName || folder.startsWith(`${oldName}/`)) assignments[id] = `${newName}${folder.slice(oldName.length)}`;
          });
          if (records) {
            [...library, ...largeSummaries].forEach((item) => {
              if ((folders.recordAssignments[item.id] || "未分类") === oldName) assignments[item.id] = newName;
            });
          } else {
            puzzleCollections.forEach((collection) => {
              const fallback = collection.id.startsWith("native-") ? "内置题库" : "我的题库";
              if ((folders.puzzleAssignments[collection.id] || fallback) === oldName) assignments[collection.id] = newName;
            });
          }
          return {
            ...folders,
            [folderKey]: folders[folderKey].map((folder) => folder === oldName || folder.startsWith(`${oldName}/`) ? `${newName}${folder.slice(oldName.length)}` : folder),
            [assignmentKey]: assignments,
            order: remapFolderOrder(folders.order, folderKey, records ? "records" : "puzzleCollections", oldName, newName) ?? folders.order,
          } as LibraryFolders;
        });
        setExpandedLibraryFolders((current) => new Set([...current].map((folder) => folder === oldName || folder.startsWith(`${oldName}/`) ? `${newName}${folder.slice(oldName.length)}` : folder)));
        if (saveFolder === oldName || saveFolder.startsWith(`${oldName}/`)) setSaveFolder(`${newName}${saveFolder.slice(oldName.length)}`);
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
    taskManager.current.start({ kind: "import", title: "导入棋谱", taskId: `import-${id}`, cancellable: true, retryable: true });
    taskManager.current.update({ stage: "reading", message: detail, progress: 0 });
    setImportProgress({ id, phase: "reading", fileName, detail, currentFile: totalFiles ? 1 : undefined, totalFiles });
    return id;
  };
  const updateImportProgress = (id: number, patch: ImportProgressPatch) => {
    setImportProgress((current) => current?.id === id ? mergeImportProgress(current, patch) : current);
    if (taskManager.current.state?.taskId === `import-${id}`) taskManager.current.update({ stage: patch.phase, message: patch.detail, progress: patch.progress });
  };
  const settleImportProgress = (id: number, phase: "complete" | "error", detail: string) => {
    updateImportProgress(id, { phase, detail, progress: phase === "complete" ? 1 : undefined });
    if (taskManager.current.state?.taskId === `import-${id}`) phase === "complete" ? taskManager.current.success() : taskManager.current.fail(new Error(detail));
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
    if (requested.length === 1 && (/\.zip$/i.test(requested[0].name) || requested[0].type === "application/zip")) {
      await handleZipFile(requested[0]);
      return;
    }
    cancelActiveAiComputation("record-switch");
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
    const supported = new Set(["sgf", "fgf", "pos", "txt", "psq", "ren", "renjs", "wzq", "lib", "renju", "json", "db", "dp", "zip"]);
    const failures: { file: string; reason: unknown }[] = [];
    const selected = requested.filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const maximum = ["lib", "db", "dp"].includes(extension) ? Number.POSITIVE_INFINITY : MAX_OTHER_RECORD_BYTES;
      const maximumLabel = "64MB";
      const reason = !supported.has(extension)
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
      if (active && tab === "library") { setLibrarySection("records"); setExpandedLibraryFolders(new Set([libraryFolders.recordAssignments[active.id] || "未分类"])); }
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
    cancelActiveAiComputation("record-switch");
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
    cancelActiveAiComputation("record-switch");
    const progressId = beginImportProgress(file.name, "正在读取题库 JSON");
    try {
      updateImportProgress(progressId, { phase: "parsing", detail: "正在校验题目与棋盘数据" });
      const report = importKaibaoPuzzleJson(await file.text(), file.name.replace(/\.json$/i, ""));
      updateImportProgress(progressId, { phase: "saving", detail: `正在保存 ${report.collection.puzzles.length} 道题目` });
      const nextCollections = [...puzzleCollections, report.collection];
      setPuzzleCollections(nextCollections); savePuzzleCollections(nextCollections);
      setLibraryFolders((currentFolders) => ({ ...currentFolders, puzzleAssignments: { ...currentFolders.puzzleAssignments, [report.collection.id]: "我的题库" } }));
      if (tab === "library") { setLibrarySection("puzzles"); setExpandedLibraryFolders(new Set(["我的题库"])); }
      else guardedOpenPuzzle(nextCollections.length - 1, 0, nextCollections);
      setToast(`已导入 ${report.collection.puzzles.length} 题${report.skipped ? `，跳过 ${report.skipped} 个空项` : ""}${report.warnings.length ? `，${report.warnings.length} 条提示` : ""}`);
      void rememberRecentImport(file, "puzzle");
      finishImportProgress(progressId, `${report.collection.puzzles.length} 道题目已保存`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "题库导入失败";
      setToast(message); failImportProgress(progressId, message);
    }
  };

  /** VCF 生成：素材驱动（变形/原创），放到独立 worker 线程生成不阻塞 UI；完成后经开宝导入管线入库。 */
  const runVcfGeneration = () => {
    if (vcfGenRunning) {
      vcfGenWorker.current?.terminate(); vcfGenWorker.current = null;
      setVcfGenRunning(false); setToast("VCF 生成已停止");
      return;
    }
    const seed = (Date.now() % 2147483647) | 0;
    const target = vcfOptions.count;
    const { tier, mode } = vcfOptions;
    vcfGenWorker.current?.terminate(); vcfGenWorker.current = null;
    setVcfGenRunning(true); setVcfProgress({ done: 0, attempts: 0 }); setVcfBatch([]); setVcfBatchIndex(0); setVcfSolveNote("");

    const worker = new VcfGenWorker();
    vcfGenWorker.current = worker;

    const finish = (results: { puzzles: GeneratedVcfPuzzle[]; attempts: number; fallbackUsed: boolean; error: string | null }) => {
      if (vcfGenWorker.current === worker) { vcfGenWorker.current?.terminate(); vcfGenWorker.current = null; }
      setVcfGenRunning(false);
      const drafts = results.puzzles;
      if (!drafts.length) {
        if (results.error) setVcfSolveNote(results.error);
        setToast(results.error ? `生成失败：${results.error}` : "未生成有效 VCF 题，请再试一次");
        return;
      }
      const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
      const title = `VCF 生成题集 ${stamp}`;
      const exportJson = toKaibaoCollectionJson(drafts, title);
      vcfExportJsonRef.current = exportJson;
      try {
        const report = importKaibaoPuzzleJson(exportJson, title);
        const currentCollections = loadPuzzleCollections();
        const nextCollections = [...currentCollections, report.collection];
        savePuzzleCollections(nextCollections); setPuzzleCollections(nextCollections);
        setLibraryFolders((currentFolders) => ({ ...currentFolders, puzzleAssignments: { ...currentFolders.puzzleAssignments, [report.collection.id]: "我的题库" } }));
        const collectionIndex = nextCollections.length - 1;
        setVcfBatch(drafts.map((p, i) => ({
          depth: p.depth,
          solutionText: p.solution.filter((m) => m.player === p.attacker).map(vcfCoordName).join(" → "),
          collectionIndex, puzzleIndex: i,
        })));
        setToast(`${results.fallbackUsed ? "深档原创未产出、部分用真题变形补充：已生成 " : `已生成 ${drafts.length} 题（尝试 ${results.attempts} 次局面），` } 已存入题库"我的题库"`);
      } catch (error) {
        setToast(error instanceof Error ? `VCF 题集入库失败：${error.message}` : "VCF 题集入库失败");
      }
    };

    worker.onmessage = (event: MessageEvent) => {
      const m = event.data as { type: string; done?: number; attempts?: number; puzzles?: GeneratedVcfPuzzle[]; fallbackUsed?: boolean; error?: string | null };
      if (m.type === "progress") setVcfProgress({ done: m.done ?? 0, attempts: m.attempts ?? 0 });
      else if (m.type === "result") finish({ puzzles: m.puzzles ?? [], attempts: m.attempts ?? 0, fallbackUsed: m.fallbackUsed ?? false, error: m.error ?? null });
    };
    worker.onerror = () => {
      if (vcfGenWorker.current === worker) vcfGenWorker.current = null;
      setVcfGenRunning(false); setToast("VCF 生成线程启动失败");
    };

    void loadVcfMaterial().then((material: MaterialFile | null) => {
      if (vcfGenWorker.current !== worker) return; // 已被停止/替换
      if (!material || !material.items.length) {
        worker.terminate(); vcfGenWorker.current = null;
        setVcfGenRunning(false); setVcfSolveNote("素材库加载失败（/puzzles/vcf-material.json 缺失）");
        return;
      }
      worker.postMessage({ type: "generate", tier, mode, count: target, seed, material });
    });
  };

  /** 用 VCF 求解器分析当前局面（连续冲四）。 */
  const solveCurrentBoardVcf = () => {
    const board = boardAt(viewDocument, currentId);
    const cells = new Int8Array(225);
    board.forEach((row, r) => row.forEach((cell, c) => { if (cell === "black") cells[r * 15 + c] = 1; else if (cell === "white") cells[r * 15 + c] = 2; }));
    const rule = viewDocument.metadata.rule;
    const rules: VcfRules = rule === "renju" ? "renju" : "freestyle";
    const attackerIsBlack = nextPlayerAt(viewDocument, currentId) === "black";
    const sol = solveVcf(cells, { attacker: attackerIsBlack ? 1 : 2, rules, maxDepth: 9 });
    if (!sol.win) { setVcfSolveNote(`当前局面（${rule === "renju" ? "连珠" : "无禁"}）在 9 手内未找到连续冲四胜，不代表无杀`); return; }
    const attackerPlayer: Player = attackerIsBlack ? "black" : "white";
    const line = sol.line.map((m) => `${vcfCoordName(m)}${m.player === (attackerIsBlack ? 1 : 2) ? "" : "防"}`);
    setVcfSolveNote(`当前局面 VCF 成立（${attackerPlayer === "black" ? "黑" : "白"}先，${sol.line.filter((m) => m.player === (attackerIsBlack ? 1 : 2)).length} 手）：${line.join(" ")}`);
  };

  /** Import a portable ZIP container. A container may hold the native full
   * backup JSON alongside ordinary record files and puzzle JSON files. Each
   * category is routed through the same importer used by the corresponding
   * picker, so validation, deduplication and storage behavior stay consistent.
   */
  const handleZipFile = async (file: File) => {
    if (!file) return;
    cancelActiveAiComputation("record-switch");
    try {
      const entries = await readZip(file);
      if (!entries.length) throw new Error("ZIP 文件为空");
      const makeFile = (entry: ZipEntry) => {
        const copy = new Uint8Array(entry.data.length); copy.set(entry.data);
        const name = entry.name.split("/").pop() || entry.name;
        const extension = name.split(".").pop()?.toLowerCase() || "";
        const type = extension === "json" ? "application/json" : extension === "sgf" ? "application/x-go-sgf" : "application/octet-stream";
        return new File([copy.buffer], name, { type, lastModified: Date.now() });
      };
      const jsonEntries = entries.filter((entry) => /\.json$/i.test(entry.name));
      const backupCandidates = jsonEntries
        .filter((entry) => /backup|备份/i.test(entry.name))
        .concat(jsonEntries.filter((entry) => !/backup|备份/i.test(entry.name)));
      let backupEntry: ZipEntry | null = null;
      let parsedBackup: ReturnType<typeof parseBackup> | null = null;
      let restoredBackup = false;
      for (const entry of backupCandidates) {
        try { parsedBackup = parseBackup(textFromZipEntry(entry)); backupEntry = entry; break; } catch { /* ordinary JSON may be a puzzle/record */ }
      }
      if (parsedBackup) {
        setBackupBusy(true);
        recordAction(`恢复备份 ZIP：${file.name}`);
        try {
          await restoreBackup(parsedBackup);
          restoredBackup = true;
          setSheet(null); setToast("备份 ZIP 已恢复，正在处理包内其它文件");
        } finally { setBackupBusy(false); }
      }
      const puzzleFiles: File[] = [];
      const recordFiles: File[] = [];
      for (const entry of entries) {
        if (entry === backupEntry || entry.name.endsWith("/")) continue;
        const converted = makeFile(entry);
        const extension = converted.name.split(".").pop()?.toLowerCase() || "";
        if (extension === "json") {
          try {
            if (isPuzzleJsonText(textFromZipEntry(entry))) { puzzleFiles.push(converted); continue; }
          } catch { /* let the normal record importer report malformed JSON */ }
        }
        if (["sgf", "fgf", "pos", "txt", "psq", "ren", "renjs", "wzq", "lib", "renju", "json", "db", "dp"].includes(extension)) recordFiles.push(converted);
      }
      if (puzzleFiles.length) {
        const reports = await Promise.all(puzzleFiles.map(async (puzzleFile) => importKaibaoPuzzleJson(await puzzleFile.text(), puzzleFile.name.replace(/\.json$/i, ""))));
        const nextCollections = [...loadPuzzleCollections(), ...reports.map((report) => report.collection)];
        savePuzzleCollections(nextCollections); setPuzzleCollections(nextCollections);
        setLibraryFolders((currentFolders) => {
          const baseFolders = restoredBackup ? loadLibraryFolders() : currentFolders;
          return { ...baseFolders, puzzleAssignments: {
          ...baseFolders.puzzleAssignments,
          ...Object.fromEntries(reports.map((report) => [report.collection.id, "我的题库"])),
          } };
        });
        void Promise.all(puzzleFiles.map((puzzleFile) => rememberRecentImport(puzzleFile, "puzzle")));
      }
      // Binary database formats open a live worker and therefore must be
      // processed one at a time. Text records can retain the normal batch path.
      const binary = recordFiles.filter((item) => /\.(lib|db|dp)$/i.test(item.name));
      const textRecords = recordFiles.filter((item) => !/\.(lib|db|dp)$/i.test(item.name));
      if (textRecords.length) await handleFiles(textRecords);
      for (const binaryFile of binary) await handleFiles([binaryFile]);
      if (restoredBackup) {
        setToast(puzzleFiles.length || recordFiles.length ? "备份已恢复，包内其它文件也已导入" : "备份 ZIP 已恢复，页面即将重新加载");
        window.setTimeout(() => window.location.reload(), 350);
        return;
      }
      if (!parsedBackup && !puzzleFiles.length && !recordFiles.length) throw new Error("ZIP 中没有识别到棋谱、题库或半步五子棋打谱备份");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "ZIP 导入失败，请检查文件是否完整");
    }
  };

  const exportDocument = hasDraft(draft) ? viewDocument : document;
  const scopedExportDocument = useMemo(() => documentForExportScope(exportDocument, currentId, exportScope), [currentId, exportDocument, exportScope]);
  const createBoardShareFile = async () => {
    const blob = await renderBoardSharePng(exportDocument, currentId, { ...boardShareOptions, rotation, mirrored, stoneOpacity });
    return new File([blob], boardShareFilename(exportDocument, currentId), { type: "image/png", lastModified: Date.now() });
  };
  const saveBoardShareFile = async (file: File, fallback = false) => {
    setSheet(null);
    const destination = defaultDirectory || (supportsNativeExportDirectory() ? nativeExportDirectoryHandle() : null);
    if (destination) {
      try {
        await writeFileToDirectory(destination, file.name, file, file.type);
        setToast(`${fallback ? "当前平台不支持文件分享，" : ""}PNG 已写入“${destination.name}”`);
        return;
      } catch {
        downloadFile(file, file.name, file.type);
        setToast(`${fallback ? "当前平台不支持文件分享，" : "默认文件夹写入失败，"}已改用浏览器下载 PNG`);
        return;
      }
    }
    downloadFile(file, file.name, file.type);
    setToast(`${fallback ? "当前平台不支持文件分享，" : ""}PNG 已保存到浏览器默认“下载”位置：${file.name}`);
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
      const result = await sharePngFile(file, exportDocument.metadata.title || "半步五子棋打谱", `第 ${depthOf(exportDocument, currentId)} 手当前局面`);
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
    const name = `${safeName(exportDocument.metadata.title)}-${exportScopeSuffix(exportScope)}`;
    if (format === "sgf") {
      void exportRecordFile(exportSgf(scopedExportDocument), `${name}.sgf`, "application/x-go-sgf;charset=utf-8", `${exportScopeSuffix(exportScope)} SGF 已导出`);
      return;
    }
    void exportRecordFile(exportJson(scopedExportDocument), `${name}.json`, "application/json;charset=utf-8", `${exportScopeSuffix(exportScope)} JSON 已导出`);
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
    setExportScope("whole");
    setExportFormatMenuOpen(false);
    setSheet("export");
  };

  const sheetTitle = sheet === "comment" ? "节点注释" : sheet === "branches" ? "变化分支" : sheet === "tree" ? "棋谱树" : sheet === "metadata" ? "棋谱信息" : sheet === "save" ? "保存棋谱" : sheet === "folder" ? (folderSheetMode === "batch-move" ? "移动棋谱" : `新建${folderCreationSection === "records" ? "棋谱" : "题库"}文件夹`) : sheet === "rename" ? "重命名" : sheet === "export" ? "导出与分享" : sheet === "manual" ? "使用手册" : sheet === "rules" ? "规则说明" : sheet === "about" ? "关于半步五子棋打谱" : sheet === "feedback" ? "反馈与建议" : sheet === "find" ? "查找本谱" : sheet === "analysis" ? "局面分析" : sheet === "positionSearch" ? "跨谱局面检索" : sheet === "import" ? "选择导入方式" : sheet === "aiGame" ? "AI 人机对战" : sheet === "fifthCount" ? "选择五手打数量" : sheet === "think" ? "AI 思考" : sheet === "wrongbook" ? "错题本" : sheet === "trash" ? "回收站" : sheet === "dataSafety" ? "资料安全" : sheet === "batchEdit" ? "批量处理" : "使用提示";
  const displaySheetTitle = sheet === "tree" ? "分支树" : sheetTitle;
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
  // Android convention: back first leaves a non-home tab for the home
  // (record) tab; at home, the root sentinel turns a single press into a
  // "press again to exit" hint instead of quitting outright. Overlays own
  // their history entries via BottomSheet/QuickDrawer, so their back closes
  // the overlay first.
  useRootBackExit(() => {
    if (tab !== "record") { setTab("record"); return; }
    setToast(ROOT_BACK_MESSAGE);
  });
  const playbackBlocked = mode === "puzzle" || Boolean(aiGame) || machineThinking || dynamicNavigationBusy;
  const playback = useRecordPlayback({
    currentId,
    childIds: current.children,
    preferredChildId: current.preferredChildId,
    sessionKey: `${mode}:${document.id}`,
    disabled: playbackBlocked,
    onAdvance: (targetId) => {
      clearBoardMotion();
      playSound("navigate");
      const target = viewDocument.nodes[targetId];
      const dynamicSession = dynamicViewSession.current;
      if (dynamicSession && isDynamicDatabaseView(document) && target?.move && !draftOverlay.added.has(targetId)) {
        navigateDynamic(dynamicSession, () => dynamicSession.move(target.move!));
        return true;
      }
      const session = pagedSession.current;
      if (session) {
        const index = session.indexForId(targetId);
        if (index === undefined) return false;
        pagedNavigate.current(index);
        return true;
      }
      if (!target) return false;
      setCurrentId(targetId);
      return true;
    },
    onLoop: (targetId) => {
      clearBoardMotion();
      const dynamicSession = dynamicViewSession.current;
      if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(targetId)) {
        navigateDynamic(dynamicSession, () => dynamicSession.toDepth(depthOf(viewDocument, targetId)));
        return true;
      }
      const session = pagedSession.current;
      if (session) {
        const index = session.indexForId(targetId);
        if (index === undefined) return false;
        pagedNavigate.current(index);
        return true;
      }
      if (!viewDocument.nodes[targetId]) return false;
      setCurrentId(targetId);
      return true;
    },
  });
  useEffect(() => {
    if (playback.stopReason !== "idle") setToast(playbackStatusText(playback.stopReason));
  }, [playback.stopReason]);
  const visiblePositionMatches = positionMatches.filter((match) => match.documentId !== document.id || match.nodeId !== currentId);
  const currentHasComment = mode !== "puzzle" && hasNativeAnnotation(current);
  const dismissFirstRunWelcome = () => {
    markFirstRunWelcomeRead();
    setWelcomeOpen(false);
  };
  const openManualFromFirstRun = () => {
    dismissFirstRunWelcome();
    setSheet("manual");
  };
  const currentAnnotationLines = currentHasComment ? annotationLines(current) : [];
  const commentToggleLabel = commentExpanded ? "收起注释" : currentHasComment ? "展开注释" : "打开注释（当前无内容）";
  const commentPreviewText = currentAnnotationLines.length
    ? currentAnnotationLines.join("\n")
    : "当前局面暂无注释";
  const customAppStyle = themePreference === "custom" ? {
    backgroundColor: customBackgroundColor,
    ...(customBackgroundImage ? { backgroundImage: `linear-gradient(#1118, #1118), url("${customBackgroundImage}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
  } : undefined;
  const statusStepLabel = mode !== "puzzle"
    ? `第 ${depthOf(viewDocument, currentId)} 手${compactNodeCount(document) ? " · 大型" : ` / ${mainLineLength(viewDocument)}`}`
    : `${puzzleIndex + 1} / ${puzzleCollections[puzzleCollectionIndex]?.puzzles.length || 0}`;
  const statusRuleChoice = mode !== "puzzle"
    ? AI_RULE_CHOICES.find((choice) => choice.rule === viewDocument.metadata.rule && choice.openingRule === viewDocument.metadata.openingRule)
      || (aiGame ? AI_RULE_CHOICES.find((choice) => choice.rule === viewDocument.metadata.rule && choice.openingRule === aiGame.opening.rule) : undefined)
    : undefined;
  const statusRuleLabel = statusRuleChoice?.name;
  const statusTurnLabel = mode !== "puzzle"
    ? aiGame?.outcome ? "对局结束" : `${nextPlayer === "black" ? "黑" : "白"}方落子`
    : puzzleSetup ? `${activePlacementPlayer === "black" ? "黑" : "白"}棋摆放` : puzzleOutcome ? "本题结束" : `${currentPuzzle?.player === "black" ? "黑" : "白"}方应战`;
  const statusStateKind = machineThinking ? "analysis" : playback.isPlaying ? "playing" : hasDraft(draft) ? "draft" : saved ? "saved" : "neutral";
  const statusStateLabel = machineThinking
    ? aiThinking ? aiGame?.unlimitedThinking ? "AI 不限时思考" : "AI 思考中" : thinkRunning ? "AI 分析" : "VCF 搜索"
    : playback.isPlaying ? "自动演示"
    : mode === "puzzle" ? puzzleSetup ? "摆棋中" : puzzleOutcome === "won" ? "挑战成功" : puzzleOutcome === "lost" ? "本题失败" : "练习中"
    : annotationActive ? `标注中 · ${currentAnnotationLabel || "自定义"}`
    : mode === "review" ? "只读浏览"
    : aiGame ? aiClockActive ? `对弈 · ${formatGameClock(aiHumanElapsedMs)}` : "AI 对弈"
    : hasDraft(draft) ? "未保存草稿" : saved ? "已保存" : "保存中";
  const canResumeAiGame = Boolean(aiGame && !aiGame.outcome && nextPlayerAt(document, currentId) === aiGame.aiPlayer);
  const isPuzzleMode = mode === "puzzle";
  const toggleLibraryFolder = (folder: string) => setExpandedLibraryFolders((current) => {
    const next = new Set(current);
    if (next.has(folder)) next.delete(folder); else next.add(folder);
    return next;
  });
  const folderOptions = (folders: string[]) => folders.map((folder) => <option key={folder} value={folder}>{`${"　".repeat(folder.split("/").length - 1)}${folderDisplayLabel(folder)}`}</option>);
  const renderRecordFolder = (folder: string): ReactNode => {
    const items = filteredLibrary.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder);
    const largeItems = filteredLargeSummaries.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder);
    const naturalIds = [...items.map((item) => item.id), ...largeItems.map((item) => item.id)];
    const fullNaturalIds = [
      ...library.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder).map((item) => item.id),
      ...largeSummaries.filter((item) => (libraryFolders.recordAssignments[item.id] || "未分类") === folder).map((item) => item.id),
    ];
    const orderedIds = applyOrder(naturalIds, libraryFolders.order?.records?.[folder]);
    const regularById = new Map(items.map((item) => [item.id, item] as const));
    const largeById = new Map(largeItems.map((item) => [item.id, item] as const));
    const titleForRecord = (id: string) => regularById.get(id)?.metadata.title || largeById.get(id)?.metadata.title || "";
    const query = libraryQuery.trim().toLowerCase();
    const nativeDatabaseVisible = folder === NATIVE_RECORD_FOLDER && (!query || [NATIVE_RECORD_FOLDER, NATIVE_DATABASE_TITLE, "九天指南v5-1.db", "局面数据库", "DP", "DB"].some((value) => value.toLowerCase().includes(query)));
    const children = folderChildren(libraryFolders.recordFolders, folder);
    const expanded = Boolean(libraryQuery.trim()) || expandedLibraryFolders.has(folder);
    const parentFolder = folderParent(folder);
    const siblingFolders = folderChildren(libraryFolders.recordFolders, parentFolder);
    const sortMenuId = `records:${folder}`;
    return <section key={folder} className="library-folder-section">
      <div className="library-folder-row"><button className="library-folder-head" draggable={!batchEditMode} onDragStart={onLibraryDragStart("recordFolders", parentFolder, folder)} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("recordFolders", parentFolder, siblingFolders)} data-order-id={folder} data-drag-kind="recordFolders" data-drag-key={parentFolder} onClick={() => toggleLibraryFolder(folder)} aria-expanded={expanded} title="点击展开，拖动调整顺序"><FolderOpen size={19}/><span><b>{folderLabel(folder)}</b><small>{items.length + largeItems.length + (nativeDatabaseVisible ? 1 : 0)} 份棋谱{children.length ? ` · ${children.length} 个子文件夹` : ""}</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => toggleLibrarySortMenu(sortMenuId)} aria-label={`排序“${folderLabel(folder)}”中的内容`} aria-expanded={librarySortMenu === sortMenuId} title="排序"><ArrowDownUp size={16}/></button>{renderLibrarySortMenu(sortMenuId, [
        ...(children.length ? [
          ["子文件夹 A→Z", () => sortLibraryContainer("recordFolders", folder, children, (id: string) => folderLabel(id), "az")],
          ["子文件夹 Z→A", () => sortLibraryContainer("recordFolders", folder, children, (id: string) => folderLabel(id), "za")],
        ] as Array<[string, () => void]> : []),
        ["内容 A→Z", () => sortLibraryContainer("records", folder, fullNaturalIds, titleForRecord, "az")],
        ["内容 Z→A", () => sortLibraryContainer("records", folder, fullNaturalIds, titleForRecord, "za")],
        ["恢复默认排序", () => resetLibraryOrder([["records", folder], ["recordFolders", folder]])],
      ])}<button className="library-inline-action" onClick={() => createLibraryFolder("records", folder)} aria-label={`在“${folder}”中新建子文件夹`} title="新建子文件夹"><FolderPlus size={16}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "record-folder", name: folder })} aria-label={`重命名文件夹“${folder}”`}><PenLine size={16}/></button></div>
      {expanded && <div className="folder-items record-list" key={orderedIds.join("|")}>
        {children.length > 0 && <div className="nested-folder-list">{children.map(renderRecordFolder)}</div>}
        {nativeDatabaseVisible && <article className="native-record-entry" onClick={openNativeDatabase}><div className="mini-board"><span>DB</span><span>↗</span><b>实时</b></div><div className="record-info"><h3>{NATIVE_DATABASE_TITLE}</h3><p>内置 DP/DB 局面数据库 · 点击打开实时查询</p></div><div className="library-item-actions"><ChevronRight size={18}/></div></article>}
        {orderedIds.map((id) => {
          const regular = regularById.get(id);
          if (regular) return <article key={id} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("records", folder, fullNaturalIds)} data-order-id={id} data-drag-kind="records" data-drag-key={folder} className={batchEditMode ? `batch-selectable ${batchSelectedIds.includes(regular.id) ? "selected" : ""}`.trim() : ""} title="拖动可调整顺序" onClick={() => batchEditMode ? toggleBatchSelection(regular.id) : openRecord(regular)}><span className="puzzle-row-drag" draggable onDragStart={onLibraryDragStart("records", folder, id)} title="拖动调整顺序"><GripVertical size={12}/></span>{batchEditMode && <label className="batch-selection-checkbox" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={batchSelectedIds.includes(regular.id)} onChange={() => toggleBatchSelection(regular.id)} aria-label={`选择棋谱“${regular.metadata.title}”`}/><i/></label>}<div className="mini-board"><span>●</span><span>○</span><b>{mainLineLength(regular)}</b></div><div className="record-info"><h3>{regular.metadata.title}</h3><p>{regular.metadata.black} vs {regular.metadata.white}</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", regular.id, event.target.value)}>{folderOptions(libraryFolders.recordFolders)}</select></div><div className="library-item-actions">{!batchEditMode && <><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "record", id: regular.id, name: regular.metadata.title }); }} aria-label={`重命名棋谱“${regular.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteRecord(regular); }} aria-label={`删除棋谱“${regular.metadata.title}”`}><Trash2 size={17}/></button></>}</div></article>;
          const large = largeById.get(id);
          if (!large) return null;
          return <article key={id} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("records", folder, fullNaturalIds)} data-order-id={id} data-drag-kind="records" data-drag-key={folder}><span className="puzzle-row-drag" draggable onDragStart={onLibraryDragStart("records", folder, id)} title="拖动调整顺序"><GripVertical size={12}/></span><div className="mini-board"><span>●</span><span>○</span><b>{large.mainLineLength}</b></div><div className="record-info"><h3>{large.metadata.title}</h3><p>{large.metadata.black} vs {large.metadata.white} · 大型棋谱 · {large.nodeCount.toLocaleString()} 节点</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", large.id, event.target.value)}>{folderOptions(libraryFolders.recordFolders)}</select></div><div className="library-item-actions"><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "large-record", id: large.id, name: large.metadata.title }); }} aria-label={`重命名棋谱“${large.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteLargeRecord(large); }} aria-label={`删除棋谱“${large.metadata.title}”`}><Trash2 size={17}/></button></div></article>;
        })}
        {!items.length && !largeItems.length && !nativeDatabaseVisible && !children.length && <p className="folder-empty">这个文件夹还是空的</p>}
      </div>}
    </section>;
  };

  const renderPuzzleFolder = (folder: string): ReactNode => {
    const collections = filteredPuzzleCollections.filter(({ collection }) => (libraryFolders.puzzleAssignments[collection.id] || (collection.id.startsWith("native-") ? "内置题库" : "我的题库")) === folder);
    const naturalIds = puzzleCollections.filter((collection) => (libraryFolders.puzzleAssignments[collection.id] || (collection.id.startsWith("native-") ? "内置题库" : "我的题库")) === folder).map((collection) => collection.id);
    const orderedIds = applyOrder(collections.map(({ collection }) => collection.id), libraryFolders.order?.puzzleCollections?.[folder]);
    const entryById = new Map(collections.map((entry) => [entry.collection.id, entry]));
    const children = folderChildren(libraryFolders.puzzleFolders, folder);
    const expanded = Boolean(libraryQuery.trim()) || expandedLibraryFolders.has(folder);
    const sortMenuId = `puzzle-collections:${folder}`;
    return <section key={folder} className="library-folder-section">
      <div className="library-folder-row"><button className="library-folder-head" draggable onDragStart={onLibraryDragStart("puzzleFolders", folderParent(folder), folder)} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzleFolders", folderParent(folder), folderChildren(libraryFolders.puzzleFolders, folderParent(folder)))} data-order-id={folder} data-drag-kind="puzzleFolders" data-drag-key={folderParent(folder)} onClick={() => toggleLibraryFolder(folder)} aria-expanded={expanded} title="点击展开，拖动调整顺序"><FolderOpen size={19}/><span><b>{folderLabel(folder)}</b><small>{collections.length} 个题集{children.length ? ` · ${children.length} 个子文件夹` : ""}</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => toggleLibrarySortMenu(sortMenuId)} aria-label={`排序“${folderLabel(folder)}”中的内容`} aria-expanded={librarySortMenu === sortMenuId} title="排序"><ArrowDownUp size={16}/></button>{renderLibrarySortMenu(sortMenuId, [
        ...(children.length ? [
          ["子文件夹 A→Z", () => sortLibraryContainer("puzzleFolders", folder, children, (id: string) => folderLabel(id), "az")],
          ["子文件夹 Z→A", () => sortLibraryContainer("puzzleFolders", folder, children, (id: string) => folderLabel(id), "za")],
        ] as Array<[string, () => void]> : []),
        ["题集 A→Z", () => sortLibraryContainer("puzzleCollections", folder, naturalIds, (id: string) => puzzleCollections.find((collection) => collection.id === id)?.title || "", "az")],
        ["题集 Z→A", () => sortLibraryContainer("puzzleCollections", folder, naturalIds, (id: string) => puzzleCollections.find((collection) => collection.id === id)?.title || "", "za")],
        ["恢复默认排序", () => resetLibraryOrder([["puzzleCollections", folder], ["puzzleFolders", folder]])],
      ])}<button className="library-inline-action" onClick={() => createLibraryFolder("puzzles", folder)} aria-label={`在“${folder}”中新建子文件夹`} title="新建子文件夹"><FolderPlus size={16}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-folder", name: folder })} aria-label={`重命名文件夹“${folder}”`}><PenLine size={16}/></button></div>
      {expanded && <div className="puzzle-collection-list folder-items" key={orderedIds.join("|")}>
        {children.length > 0 && <div className="nested-folder-list">{children.map(renderPuzzleFolder)}</div>}
        {orderedIds.map((id) => { const entry = entryById.get(id); if (!entry) return null; const { collection, puzzles, collectionIndex } = entry; const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length; const managing = managedPuzzleCollectionId === collection.id; const naturalPuzzleIds = collection.puzzles.map((puzzle) => puzzle.id); const orderedPuzzleIds = applyOrder(naturalPuzzleIds, libraryFolders.order?.puzzles?.[collection.id]); const puzzleById = new Map(collection.puzzles.map((puzzle) => [puzzle.id, puzzle])); const puzzleSortMenuId = `puzzles:${collection.id}`; return <article key={collection.id} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzleCollections", folder, naturalIds)} data-order-id={collection.id} data-drag-kind="puzzleCollections" data-drag-key={folder}><div className="puzzle-collection-main"><span className="puzzle-row-drag" draggable data-order-id={collection.id} data-drag-kind="puzzleCollections" data-drag-key={folder} title="拖动调整顺序" onDragStart={onLibraryDragStart("puzzleCollections", folder, collection.id)}><GripVertical size={14}/></span><button onClick={() => guardedOpenPuzzle(collectionIndex, 0)}><span className="puzzle-folder-icon">題</span><div><b>{collection.title}</b><small>{libraryQuery.trim() && puzzles.length !== collection.puzzles.length ? `${puzzles.length} / ${collection.puzzles.length} 道题匹配 · ` : `${solved} / ${collection.puzzles.length} 已完成 · `}{collection.source}</small></div><ChevronRight size={18}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-collection", id: collection.id, name: collection.title })} aria-label={`重命名题集“${collection.title}”`}><PenLine size={15}/></button>{!collection.id.startsWith("native-") && <button className="library-inline-action delete-puzzle-collection" onClick={() => deletePuzzleCollection(collection)} aria-label={`删除题集“${collection.title}”`}><Trash2 size={15}/></button>}</div><div className="puzzle-collection-tools"><select value={folder} onChange={(event) => assignLibraryItem("puzzles", collection.id, event.target.value)} aria-label={`移动题集“${collection.title}”到文件夹`}>{folderOptions(libraryFolders.puzzleFolders)}</select><button onClick={() => setManagedPuzzleCollectionId(managing ? null : collection.id)} aria-expanded={managing}>{managing ? "收起题目" : `管理 ${puzzles.length} 道题`}</button><button className="library-inline-action" onClick={() => toggleLibrarySortMenu(puzzleSortMenuId)} aria-label={`排序题集“${collection.title}”中的题目`} aria-expanded={librarySortMenu === puzzleSortMenuId} title="排序题目"><ArrowDownUp size={15}/></button>{renderLibrarySortMenu(puzzleSortMenuId, [
          ["题目 A→Z", () => sortLibraryContainer("puzzles", collection.id, naturalPuzzleIds, (id: string) => puzzleById.get(id)?.title || "", "az")],
          ["题目 Z→A", () => sortLibraryContainer("puzzles", collection.id, naturalPuzzleIds, (id: string) => puzzleById.get(id)?.title || "", "za")],
          ["恢复默认排序", () => resetLibraryOrder([["puzzles", collection.id]])],
        ])}</div>{managing && <div className="puzzle-manager-list" key={orderedPuzzleIds.join("|")}>{orderedPuzzleIds.map((puzzleId) => { const puzzle = puzzleById.get(puzzleId); if (!puzzle) return null; const puzzleIndexInCollection = naturalPuzzleIds.indexOf(puzzleId); return <div key={puzzleId} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzles", collection.id, naturalPuzzleIds)} data-order-id={puzzleId} data-drag-kind="puzzles" data-drag-key={collection.id}><span className="puzzle-row-drag" draggable data-order-id={puzzleId} data-drag-kind="puzzles" data-drag-key={collection.id} title="拖动调整顺序" onDragStart={onLibraryDragStart("puzzles", collection.id, puzzleId)}><GripVertical size={13}/></span><button onClick={() => guardedOpenPuzzle(collectionIndex, puzzleIndexInCollection)}><span>{puzzleIndexInCollection + 1}</span><b>{puzzle.title}</b></button><button onClick={() => beginLibraryRename({ kind: "puzzle", collectionId: collection.id, id: puzzle.id, name: puzzle.title })} aria-label={`重命名题目“${puzzle.title}”`}><PenLine size={14}/></button></div>; })}</div>}</article>; })}
        {!collections.length && !children.length && <p className="folder-empty">这个文件夹还是空的</p>}
      </div>}
    </section>;
  };
  // 走棋导航按钮：常驻行（默认）与「并入功能栏」两种布局复用同一份，data-moves-labels 控制文字/纯图标。
  const movesNavButtons = <>
    <button onClick={goRoot} disabled={dynamicNavigationBusy} aria-label="到第一手"><ChevronFirst/><span>起点</span></button>
    <button onClick={goPrev} disabled={dynamicNavigationBusy || !current.parentId} aria-label="上一手"><ChevronLeft/><span>上一手</span></button>
    <button className="accent" onClick={goNext} disabled={dynamicNavigationBusy || !preferredNext(viewDocument, currentId)} aria-label="下一手"><ChevronRight/><span>下一手</span></button>
    <button onClick={goPreferredEnd} disabled={dynamicNavigationBusy} aria-label="到最后一手"><ChevronLast/><span>终点</span></button>
    {mode === "review" && <PlaybackButton isPlaying={playback.isPlaying} disabled={playbackBlocked} stopReason={playback.stopReason} onToggle={playback.toggle}/>}
    {mode === "record" && <><button onClick={undoDraftChange} disabled={!draft.operations.length} aria-label="撤销编辑" title={draft.operations.length ? "撤销最近一次编辑" : "暂无可撤销的编辑"}><Undo2/><span>撤销</span></button><button onClick={redoDraftChange} disabled={!draft.redo.length} aria-label="重做编辑" title={draft.redo.length ? "恢复最近一次撤销的编辑" : "暂无可重做的编辑"}><Redo2/><span>重做</span></button><button onClick={discardDraft} disabled={!hasDraft(draft)} aria-label="放弃编辑" title={hasDraft(draft) ? "放弃当前未保存修改" : "暂无未保存修改"}><X/><span>放弃</span></button></>}
  </>;
  return <div className={`app-shell ${fontScaleClass(fontScale)} ${enhancementSettings.tabletSplit ? "split-layout-enabled" : ""}`} lang="zh-CN" data-ai-worker-state={aiWorkerController.current.snapshot.running ? "running" : "idle"} data-ai-request-id={aiWorkerController.current.snapshot.requestId || undefined} style={customAppStyle}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <input ref={singleFileInput} type="file" hidden accept=".sgf,.fgf,.pos,.txt,.psq,.ren,.renjs,.wzq,.lib,.renju,.json,.db,.dp,.zip,*/*" onChange={(event) => { void handleFiles(event.target.files || undefined); event.target.value = ""; }}/>
    <input ref={puzzleFileInput} type="file" hidden accept=".json,.zip,application/json,application/zip" onChange={(event) => { const file = event.target.files?.[0]; void (file?.name.toLowerCase().endsWith(".zip") ? handleZipFile(file) : handlePuzzleFile(file)); event.target.value = ""; }}/>
    <input ref={imageFileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif" onChange={(event) => { void handleBoardImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={backupFileInput} type="file" hidden accept=".json,.zip,application/json,application/zip" onChange={(event) => { void handleBackupFile(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={backgroundFileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/*" onChange={(event) => { handleBackgroundImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <header className="topbar"><div className="brand"><button type="button" className="brand-trigger" onClick={() => setQuickDrawerOpen(true)} aria-label="打开快捷中心" aria-expanded={quickDrawerOpen} aria-controls="quick-drawer"><img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true"/></button><div><b>半步五子棋打谱</b><small>本地棋谱研究工具</small></div></div><div className="top-actions"><button className="icon-button" onClick={openImportSheet} aria-label="打开导入方式"><Download size={20}/></button>{mode === "record" && <><button className="icon-button" onClick={openExportSheet} aria-label="打开导出方式"><Upload size={20}/></button><button className="icon-button save-action" onClick={openSaveDialog} aria-label="保存棋谱"><Save size={20}/></button></>}</div></header>
    <QuickDrawer
      open={quickDrawerOpen}
      onClose={() => setQuickDrawerOpen(false)}
      title={mode !== "puzzle" ? viewDocument.metadata.title : currentPuzzle?.title || "当前题目"}
      subtitle={mode !== "puzzle" ? `第 ${depthOf(viewDocument, currentId)} 手 · 下一手${nextPlayer === "black" ? "黑" : "白"}方` : `${puzzleCollections[puzzleCollectionIndex]?.title || "题库"} · 第 ${puzzleIndex + 1} 题`}
      thinkPopup={thinkSheetOnStart}
       onThinkPopupChange={setThinkSheetOnStart}
       thinkDirectMove={thinkDirectMove}
       onThinkDirectMoveChange={setThinkDirectMove}
      thinkRunning={thinkRunning}
      thinkResultLabel={thinkResult?.move ? coordinateName(thinkResult.move) : undefined}
      onThink={() => { setQuickDrawerOpen(false); startThink(); }}
      onOpenThinkResult={() => { setQuickDrawerOpen(false); setSheet("think"); }}
      playbackSpeed={playback.speed}
      onPlaybackSpeedChange={playback.setSpeed}
      playbackBranchPolicy={playback.branchPolicy}
      onPlaybackBranchPolicyChange={playback.setBranchPolicy}
      playbackLoop={playback.loop}
      onPlaybackLoopChange={playback.setLoop}
      themePreference={themePreference}
      onThemePreferenceChange={(value) => { if (isThemePreference(value)) setThemePreference(value); }}
      boardTheme={boardTheme}
      onBoardThemeChange={(value) => { if (isBoardTheme(value)) setBoardTheme(value); }}
       stoneTheme={stoneTheme}
       onStoneThemeChange={(value) => { if (isStoneTheme(value)) setStoneTheme(value); }}
       defaultBoardSize={defaultBoardSize}
       onDefaultBoardSizeChange={setDefaultBoardSize}
    />
     <main id="main-content" className={`app-main ${tab === "settings" ? "settings-main" : ""}`.trim()}>
      {tab === "record" && <div className={`record-page ${recordToolsCount >= 2 ? "record-tools-stacked" : ""} ${commentExpandedWithTools ? "comment-expanded-with-tools" : ""}`.trim()}>
        <UnifiedStatusBar
          kind={mode === "puzzle" ? "puzzle" : mode}
          title={mode !== "puzzle" ? viewDocument.metadata.title : currentPuzzle?.title || "选择题目"}
          subtitle={mode !== "puzzle" ? `${viewDocument.metadata.black || "黑方"} vs ${viewDocument.metadata.white || "白方"}` : puzzleCollections[puzzleCollectionIndex]?.title || "题库"}
          ruleLabel={statusRuleLabel}
          stepLabel={statusStepLabel}
          turnLabel={statusTurnLabel}
          stateLabel={statusStateLabel}
          stateKind={statusStateKind}
          selectorOpen={workspaceSelectorOpen}
          mode={mode}
          aiGame={Boolean(aiGame)}
          aiThinking={Boolean(aiGame && aiThinking)}
          onToggleSelector={() => { if (mode === "puzzle") setSheet(null); setWorkspaceSelectorOpen((open) => !open); }}
          onToggleMode={(nextMode) => switchMode(nextMode)}
          onExitAiGame={exitAiGame}
          onStopAiThinking={stopAiGameThinking}
        />
         {mode === "record" && aiGame && aiOpeningStage?.kind !== "normal" && <section className="ai-opening-banner" aria-live="polite"><span className="ai-opening-step">开</span><div><b>{openingRuleName(aiGame.opening.rule, aiGame.opening.n)}</b><small>{openingInstruction(aiGame.opening)}</small></div>{aiOpeningStage?.kind === "swap" && aiOpeningStage.chooser === "human" && <div className="ai-opening-actions"><button onClick={() => chooseOpeningSwap(false)}>{aiOpeningStage.taraguchiChoice ? "进入十打" : "不交换"}</button><button className="accent" onClick={() => chooseOpeningSwap(true)}>交换</button></div>}{aiThinking && <i className="ai-opening-thinking"/>}</section>}
          <Board document={reviewDocument} currentId={currentId} currentBookmarked={activeBookmarks.some((bookmark) => bookmark.nodeId === currentId)} showNumbers={showNumbers} showCoordinates={showCoordinates} largeBoard={largeBoard} rotation={rotation} mirrored={mirrored} boardTheme={boardTheme} stoneTheme={stoneTheme} boardOpacity={boardOpacity} stoneOpacity={stoneOpacity} annotationHighlight={annotationHighlight} initialDepth={isPuzzleMode ? puzzleSetup ? 0 : puzzleInitialDepth : 0} forbiddenMarkers={boardForbiddenMarkers} winningLines={boardWinningLines} openingCandidates={aiGame?.opening.candidates || []} openingStage={aiOpeningStage} thinkingMove={enhancementSettings.aiBoardHints && thinkContextKey === currentPositionKey ? thinkResult?.move : null} thinking={aiThinking || thinkRunning} motion={boardMotion} feedback={boardFeedback} result={boardResult} gestureZoomEnabled={enhancementSettings.gestureZoom} gestureSwipeEnabled={enhancementSettings.gestureSwipe} disabled={dynamicNavigationBusy || (isPuzzleMode && !puzzleSetup && (aiThinking || !!puzzleOutcome)) || aiBoardDisabled} onPlay={play} onVariation={!isPuzzleMode && !aiGame && !continuationEditMode && !annotationActive ? navigateVariation : undefined} onMark={(mode === "record" || mode === "review") && !aiGame ? mark : () => undefined} onGestureStep={!isPuzzleMode ? (delta) => { if (delta < 0) goPrev(); else goNext(); } : undefined}/>
          {(mode === "record" || mode === "review" || mode === "puzzle") && <div className={`workspace-status ${mode === "puzzle" ? "puzzle-mode" : ""} ${puzzleOutcome || ""}`}>{mode !== "puzzle" ? <><div className="record-command-bar" aria-label="常驻打谱工具">
            <button className={`command-comment ${currentHasComment ? "has-comment" : ""} ${commentExpanded ? "active" : ""}`} onClick={() => setCommentExpanded((open) => !open)} aria-label={commentToggleLabel} title={commentToggleLabel}><MessageSquareText/></button>
            <button className={`command-new ${mode === "review" ? "review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : newRecord} aria-label="新建空白棋局" title={mode === "review" ? "读谱模式无法进行该操作" : "新建空白棋局"}><FilePlus2/></button>
            <button className={`command-save ${hasDraft(draft) ? "pending" : ""} ${mode === "review" ? "review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : saveCurrentDraft} aria-label={mode === "review" ? "读谱模式无法保存棋谱" : hasDraft(draft) ? `保存当前棋谱修改（${draft.operations.length} 项）` : "当前棋谱已保存"} title={mode === "review" ? "读谱模式无法进行该操作" : hasDraft(draft) ? "保存修改" : "已保存"}><Save/></button>
            <button className={`command-delete ${mode === "review" ? "review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : deleteCurrentVariation} disabled={mode === "record" && !current.parentId} aria-label="删除当前一步及后续变化" title={mode === "review" ? "读谱模式无法进行该操作" : !current.parentId ? "起始局面不可删除" : isPagedLibraryView(document) || isDynamicDatabaseView(document) ? "将在本地编辑副本中删除，原数据库不变" : "删除本步及后续变化"}><Trash2/></button>
            <button className={`command-think ${machineThinking ? "running machine-thinking" : ""} think-state-${thinkVisualState}`} data-think-state={thinkVisualState} onClick={aiGame ? (aiThinking ? stopAiGameThinking : resumeAiGameThinking) : startThink} disabled={vcfRunning || Boolean(aiGame && !aiThinking && !canResumeAiGame)} aria-label={aiGame ? aiThinking ? "停止人机 AI 思考" : "继续人机 AI 思考" : thinkRunning ? "中断 AI 思考" : machineThinking ? "AI 正在思考" : thinkVisualState === "complete" ? "AI 推荐已完成" : thinkVisualState === "error" ? "AI 思考异常，可重试" : "思考当前局面的下一步"} title={aiGame ? aiThinking ? "立即停止并终止计算线程" : canResumeAiGame ? "继续让 AI 完成本手" : "当前轮到你落子" : thinkRunning ? "再次点击中断 AI 思考" : machineThinking ? "AI 正在思考" : thinkVisualState === "complete" ? "推荐已完成，点击重新思考" : "思考当前局面的下一步"}><Bot/></button>
            <div className={`stone-color-switch ${activePlacementPlayer} ${placementLocked ? "locked" : "following"} ${mode === "review" ? "review-blocked" : ""}`} role="radiogroup" aria-label="落子颜色">
              <i aria-hidden="true"/>
              <button className={activePlacementPlayer === "black" ? "selected" : ""} onClick={mode === "review" ? reviewBlocked : () => { setPlacementPlayer("black"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "black"} aria-label="黑棋" title={mode === "review" ? "读谱模式无法进行该操作" : "锁定黑棋"}><span className="player-stone black"/></button>
              <button className={activePlacementPlayer === "white" ? "selected" : ""} onClick={mode === "review" ? reviewBlocked : () => { setPlacementPlayer("white"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "white"} aria-label="白棋" title={mode === "review" ? "读谱模式无法进行该操作" : "锁定白棋"}><span className="player-stone white"/></button>
              <button className={`lock-toggle ${placementLocked ? "locked" : ""}`} onClick={mode === "review" ? reviewBlocked : () => setPlacementLocked((locked) => !locked)} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定，自动换色" : "跟随当前棋谱颜色"} title={mode === "review" ? "读谱模式无法进行该操作" : placementLocked ? "解除锁定" : "自动换色"}><Lock/></button>
            </div>
          </div></> : <><div className="puzzle-mode-selectors"><PuzzleRuleSelector value={currentPuzzleRule} onChange={changePuzzleRule}/><PuzzleThinkSpeedSelector value={puzzleThinkSpeed} onChange={changePuzzleThinkSpeed}/></div><div className="puzzle-status-copy"><span>{puzzleSetup ? "自由摆棋" : puzzleOutcome === "won" ? "挑战成功" : puzzleOutcome === "lost" ? "本题失败" : puzzleOutcome === "stopped" ? "思考已停止" : aiThinking ? "陪练思考中" : `${currentPuzzle?.player === "black" ? "黑" : "白"}方由你落子`}</span><small>{puzzleSetup ? "回退后重新落子会覆盖旧后续" : puzzleOutcome ? "可悔棋或重启本题" : currentPuzzle?.prompt}</small>{!puzzleSetup && machineThinking && <span className="machine-thinking-status" aria-label="AI 正在思考"><Bot size={16}/></span>}</div></>}</div>}
        {mode !== "puzzle" && commentExpanded && <div className="comment-review"><textarea id="comment-preview" className={`${commentPreviewClass} ${commentPreviewExpanded ? "expanded" : ""}`} readOnly value={commentPreviewText} onDoubleClick={() => setCommentPreviewExpanded((expanded) => !expanded)} aria-label="当前局面注释" title={commentPreviewExpanded ? "双击或点击右侧按钮收起注释框" : "双击或点击右侧按钮展开注释框"}/><button type="button" className="comment-expand-toggle" onClick={() => setCommentPreviewExpanded((expanded) => !expanded)} aria-controls="comment-preview" aria-expanded={commentPreviewExpanded} aria-label={commentPreviewExpanded ? "收起注释文本框" : "展开注释文本框"} title={commentPreviewExpanded ? "收起注释" : "展开注释"}>{commentPreviewExpanded ? <Minimize2 aria-hidden="true"/> : <Maximize2 aria-hidden="true"/>}</button></div>}
        {mode !== "puzzle" && !enhancementSettings.dockMergeMoves && <div className="moves-row" aria-label="走棋导航" data-moves-labels={enhancementSettings.movesTextDisplay ? "on" : "off"}>{movesNavButtons}</div>}
        <section className="context-dock">
        <nav className={`dock-tabs${enhancementSettings.dockMergeMoves && !isPuzzleMode ? " dock-tabs-five" : ""}`}>{!isPuzzleMode ? <>{enhancementSettings.dockMergeMoves && <button aria-label="行棋" aria-pressed={dockPanel === "moves"} className={dockPanel === "moves" ? "active" : ""} onClick={() => setDockPanel((panel) => panel === "moves" ? null : "moves")} title="走棋导航"><Redo2/>走棋</button>}<button aria-label="标注" aria-pressed={annotationActive} className={annotationActive ? "active" : ""} onClick={() => { if (aiGame) { setToast("人机对局中暂不能标注，请先退出对局"); return; } setDockPanel((panel) => { const next = panel === "annotation" ? null : "annotation"; if (!next) setAnnotationPopover(null); return next; }); }} title={annotationActive ? "关闭标注模式" : "打开当前局面标注模式"}><Tag/>标注</button><button aria-label="编辑" className={dockPanel === "notes" ? "active" : ""} onClick={() => setDockPanel((panel) => panel === "notes" ? null : "notes")}><MessageSquareText/>编辑</button><button aria-label="打开分支树" className={sheet === "tree" ? "active" : ""} onClick={() => setSheet("tree")}><ListTree/>分支树</button><button aria-label="更多" className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel((panel) => panel === "view" ? null : "view")}><MoreHorizontal/>更多</button></> : <><button className={!puzzleSetup && dockPanel === "play" ? "active" : ""} onClick={exitPuzzleSetup}><Undo2/>应战</button><button className={puzzleSetup ? "active" : ""} onClick={enterPuzzleSetup}><PenLine/>摆棋</button><button className={dockPanel === "vcf" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "vcf" ? null : "vcf")} aria-label="VCF 生成器"><Sparkles/>VCF</button><button className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "view" ? null : "view")}><MoreHorizontal/>更多</button></>}</nav>
          {dockPanel && <div className={`dock-panel dock-panel-${dockPanel}`}>
            {!isPuzzleMode && dockPanel === "moves" && <>{movesNavButtons}</>}
            {!isPuzzleMode && dockPanel === "annotation" && <div className="mark-studio" ref={markStudioRef} aria-label="当前局面标注工具">
              <div className="mark-studio-grid">
                <div className="mark-studio-preview" aria-label="标注预览"><MarkGlyph style={annotationStyle} color={annotationColor} value={currentAnnotationLabel}/><small>预览</small></div>
                <button type="button" className={`mark-studio-box ${annotationPopover === "style" ? "open" : ""}`} onClick={() => openAnnotationPopover("style")} aria-expanded={annotationPopover === "style"}><small>样式</small><b>{ANNOTATION_STYLES.find((item) => item.id === annotationStyle)?.label}</b></button>
                <button type="button" className={`mark-studio-box ${annotationPopover === "color" ? "open" : ""}`} onClick={() => openAnnotationPopover("color")} aria-expanded={annotationPopover === "color"}><small>颜色</small><b><span className="mark-studio-swatch" style={{ background: annotationColor }}/></b></button>
                <button type="button" className={`mark-studio-box ${annotationPopover === "type" ? "open" : ""}`} onClick={() => openAnnotationPopover("type")} aria-expanded={annotationPopover === "type"}><small>类型</small><b>{annotationTypePreset(annotationType).label}</b></button>
                {annotationType === "custom"
                  ? <input className="mark-studio-box mark-studio-input" value={annotationValue} maxLength={4} placeholder="输入文字" aria-label="自定义标注文字" onChange={(event) => setAnnotationValue(event.target.value)}/>
                  : <button type="button" className={`mark-studio-box ${annotationPopover === "value" ? "open" : ""}`} onClick={() => openAnnotationPopover("value")} aria-expanded={annotationPopover === "value"}><small>内容</small><b>{annotationValue}</b></button>}
              </div>
              {annotationPopover && createPortal(<>
                <div className="mark-studio-backdrop" onClick={() => setAnnotationPopover(null)} aria-hidden="true"/>
                <div className="mark-studio-popover" role="dialog" aria-label="标注选项" style={{ bottom: annotationPopoverBottom }}>
                  {annotationPopover === "style" && <div className="mark-studio-options styles">{ANNOTATION_STYLES.map((item) => <button key={item.id} type="button" className={annotationStyle === item.id ? "selected" : ""} onClick={() => { setAnnotationStyle(item.id); setAnnotationPopover(null); }} aria-pressed={annotationStyle === item.id}><MarkGlyph style={item.id} color={annotationColor} value={annotationType === "custom" ? "" : annotationValue}/><small>{item.label}</small></button>)}</div>}
                  {annotationPopover === "color" && <div className="mark-studio-options colors">{ANNOTATION_COLORS.map(([color, label]) => <button key={color} type="button" className={annotationColor === color ? "selected" : ""} style={{ "--annotation-color": color } as React.CSSProperties} onClick={() => { setAnnotationColor(color); setAnnotationPopover(null); }} aria-label={`${label}色`} aria-pressed={annotationColor === color} title={label}><span className="mark-studio-swatch"><Check size={12}/></span><small>{label}</small></button>)}</div>}
                  {annotationPopover === "type" && <div className="mark-studio-options types">{ANNOTATION_TYPES.map((preset) => <button key={preset.id} type="button" className={annotationType === preset.id ? "selected" : ""} onClick={() => { switchAnnotationType(preset.id); setAnnotationPopover(preset.values.length ? "value" : null); }} aria-pressed={annotationType === preset.id}><b>{preset.label}</b><small>{preset.hint}</small></button>)}</div>}
                  {annotationPopover === "value" && <div className="mark-studio-options values">{annotationTypePreset(annotationType).values.map((value) => <button key={value} type="button" className={annotationValue === value ? "selected" : ""} onClick={() => { setAnnotationValue(value); setAnnotationPopover(null); }} aria-pressed={annotationValue === value}>{value}</button>)}</div>}
                </div>
              </>, window.document.body)}
              <p className="mark-studio-hint">{mode === "review" ? "点击标注可覆盖 / 去除标注；仅保存在本机，不修改原棋谱。" : "点击标注可覆盖 / 去除标注；不会落子或进入分支。"}</p>
            </div>}
             {!isPuzzleMode && dockPanel === "notes" && <><button className={mode === "review" ? "review-blocked" : ""} onClick={mode === "review" ? reviewBlocked : () => setSheet("comment")} title={mode === "review" ? "读谱模式无法进行该操作" : "编辑节点注释"}><MessageSquareText/><span>注释</span></button><button className={mode === "review" ? "review-blocked" : ""} onClick={mode === "review" ? reviewBlocked : () => setSheet("metadata")} title={mode === "review" ? "读谱模式无法进行该操作" : "编辑棋谱信息"}><Save/><span>信息</span></button><button onClick={() => setRotation((value) => ((value + 90) % 360) as BoardRotation)}><RotateCw/><span>旋转</span></button><button onClick={() => setMirrored((value) => !value)}><FlipHorizontal/><span>镜像</span></button></>}
             {dockPanel === "view" && <>{!isPuzzleMode && <><button onClick={() => setSheet("find")}><Search/><span>查找</span></button><button onClick={() => { setDockPanel(null); setSheet("positionSearch"); }}><GitBranch/><span>跨谱查找</span></button><label className={`dock-board-size ${mode === "review" ? "review-blocked" : ""}`}><span>棋盘路数</span><select className="board-size-select" aria-label="选择新棋谱棋盘路数" value={viewDocument.metadata.boardSize || 15} onChange={(event) => { if (mode === "review") reviewBlocked(); else createBoardWithSize(Number(event.target.value)); }}><option value={viewDocument.metadata.boardSize || 15}>{viewDocument.metadata.boardSize || 15}路</option>{Array.from({ length: 17 }, (_, index) => index + 5).filter((size) => size !== (viewDocument.metadata.boardSize || 15)).map((size) => <option key={size} value={size}>{size}路</option>)}</select></label></>}<button onClick={() => setShowNumbers((value) => !value)}><Tag/><span>{showNumbers ? "隐藏手数" : "显示手数"}</span></button><button onClick={() => setShowCoordinates((value) => !value)}><Menu/><span>{showCoordinates ? "隐藏坐标" : "显示坐标"}</span></button></>}
            {isPuzzleMode && dockPanel === "play" && <><button onClick={undoPuzzleTurn} disabled={depthOf(document, currentId) <= puzzleInitialDepth}><Undo2/><span>悔棋</span></button><button onClick={restartPuzzle}><RotateCw/><span>重启</span></button><button className={aiThinking ? "danger" : "accent"} onClick={aiThinking ? stopPuzzleAi : () => movePuzzle(1)}>{aiThinking ? <X/> : <ChevronRight/>}<span>{aiThinking ? "停止" : "下一题"}</span></button><button onClick={() => movePuzzle(-1)} aria-label="上一题"><ChevronLeft/><span>上一题</span></button><button onClick={() => { setSheet(null); setWorkspaceSelectorOpen(true); }} aria-label="选题"><BookOpen/><span>选题</span></button></>}
            {isPuzzleMode && puzzleSetup && dockPanel === "setup" && <><button onClick={() => navigatePuzzleSetup(0)} disabled={puzzleSetup.session.cursor === 0} aria-label="摆棋起点"><ChevronFirst/><span>起点</span></button><button onClick={() => navigatePuzzleSetup(puzzleSetup.session.cursor - 1)} disabled={puzzleSetup.session.cursor === 0} aria-label="摆棋上一手"><ChevronLeft/><span>上一手</span></button><button className="accent" onClick={() => navigatePuzzleSetup(puzzleSetup.session.cursor + 1)} disabled={puzzleSetup.session.cursor >= puzzleSetup.session.moves.length} aria-label="摆棋下一手"><ChevronRight/><span>下一手</span></button><button onClick={() => navigatePuzzleSetup(puzzleSetup.session.moves.length)} disabled={puzzleSetup.session.cursor >= puzzleSetup.session.moves.length} aria-label="摆棋终点"><ChevronLast/><span>终点</span></button><div className={`setup-stone-switch stone-color-switch ${activePlacementPlayer} ${placementLocked ? "locked" : "following"}`} role="radiogroup" aria-label="摆棋颜色"><i aria-hidden="true"/><button className={activePlacementPlayer === "black" ? "selected" : ""} onClick={() => { setPlacementPlayer("black"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "black"} aria-label="摆黑棋"><span className="player-stone black"/></button><button className={activePlacementPlayer === "white" ? "selected" : ""} onClick={() => { setPlacementPlayer("white"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "white"} aria-label="摆白棋"><span className="player-stone white"/></button><button className={`lock-toggle ${placementLocked ? "locked" : ""}`} onClick={() => setPlacementLocked((locked) => !locked)} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定" : "自动交替颜色"} title={placementLocked ? "解除锁定" : "自动换色"}><Lock/></button></div></>}
{isPuzzleMode && dockPanel === "vcf" && <div className="vcf-panel">
              {vcfBatch.length > 0 && (() => { const solvedCount = vcfBatch.filter((item) => { const collection = puzzleCollections[item.collectionIndex]; const entry = collection && puzzleProgress[puzzleProgressKey(collection.id, collection.puzzles[item.puzzleIndex]?.id || "")]; return entry?.solved; }).length; return <div className="vcf-group vcf-group-batch">
                <div className="vcf-group-head"><b>本次生成 · {vcfBatch.length} 题</b><small>{solvedCount} / {vcfBatch.length} 已完成</small></div>
                <div className="vcf-chips" role="group" aria-label="本次生成的 VCF 题目列表">
                  {vcfBatch.map((item, index) => {
                    const collection = puzzleCollections[item.collectionIndex];
                    const entry = collection && puzzleProgress[puzzleProgressKey(collection.id, collection.puzzles[item.puzzleIndex]?.id || "")];
                    const current = puzzleCollectionIndex === item.collectionIndex && puzzleIndex === item.puzzleIndex;
                    const flag = entry?.solved ? "✓" : (entry?.attempts || 0) > 0 ? "·" : "";
                    return <button key={index} type="button" className={`vcf-chip${current ? " current" : ""}${entry?.solved ? " solved" : ""}${!entry?.solved && (entry?.attempts || 0) > 0 ? " attempted" : ""}`} aria-pressed={current} title={`第 ${index + 1} 题 · ${item.depth} 手 · ${entry?.solved ? "已通过" : (entry?.attempts || 0) > 0 ? `尝试 ${entry.attempts} 次` : "未做"}`} onClick={() => { setVcfBatchIndex(index); if (current) setDockPanel(null); else guardedOpenPuzzle(item.collectionIndex, item.puzzleIndex); }}><span className="vcf-chip-no">{index + 1}</span><span className="vcf-chip-depth">{item.depth} 手</span><i className="vcf-chip-flag" aria-hidden="true">{flag}</i></button>;
                  })}
                </div>
                <p className="vcf-group-hint" role="status">第 {Math.min(vcfBatchIndex, vcfBatch.length - 1) + 1} 题 · {vcfBatch[Math.min(vcfBatchIndex, vcfBatch.length - 1)]?.depth} 手 · 正解 {vcfBatch[Math.min(vcfBatchIndex, vcfBatch.length - 1)]?.solutionText}；点题号直达，当前题再次点击收起面板</p>
              </div>; })()}
              <div className="vcf-group vcf-group-settings">
                <div className="vcf-group-head"><b>出题设置</b>{vcfGenRunning && <small className="vcf-running">{vcfProgress.done} / {vcfOptions.count} 题 · 已尝试 {vcfProgress.attempts} 次</small>}</div>
                <div className="vcf-opt"><span className="vcf-opt-label">模式</span><div className="vcf-seg" role="radiogroup" aria-label="VCF 出题模式"><button type="button" className={vcfOptions.mode === "transform" ? "on" : ""} disabled={vcfGenRunning} role="radio" aria-checked={vcfOptions.mode === "transform"} title="真题换朝向" onClick={() => setVcfOptions({ ...vcfOptions, mode: "transform" })}>变形</button><button type="button" className={vcfOptions.mode === "novel" ? "on" : ""} disabled={vcfGenRunning} role="radio" aria-checked={vcfOptions.mode === "novel"} title="造题库里没有的新题" onClick={() => setVcfOptions({ ...vcfOptions, mode: "novel" })}>原创</button></div></div>
                <div className="vcf-opt"><span className="vcf-opt-label">档位</span><div className="vcf-seg" role="radiogroup" aria-label="VCF 难度档位">{(["short", "middle", "deep"] as VcfTier[]).map((t) => <button key={t} type="button" className={vcfOptions.tier === t ? "on" : ""} disabled={vcfGenRunning} role="radio" aria-checked={vcfOptions.tier === t} title={VCF_TIER_LABEL[t]} onClick={() => setVcfOptions({ ...vcfOptions, tier: t })}>{t === "short" ? "短" : t === "middle" ? "中" : "深"}</button>)}</div></div>
                <div className="vcf-opt"><span className="vcf-opt-label">数量</span><div className="vcf-seg" role="radiogroup" aria-label="VCF 生成数量">{[1, 5, 10].map((n) => <button key={n} type="button" className={vcfOptions.count === n ? "on" : ""} disabled={vcfGenRunning} role="radio" aria-checked={vcfOptions.count === n} onClick={() => setVcfOptions({ ...vcfOptions, count: n })}>{n}</button>)}</div></div>
              </div>
              <div className="vcf-group vcf-group-actions">
                <div className="vcf-group-head"><b>操作</b></div>
                <div className="vcf-actions">
                  <button className={vcfGenRunning ? "danger" : "accent"} onClick={runVcfGeneration} aria-label={vcfGenRunning ? "停止生成" : "开始生成"} title={vcfGenRunning ? "停止生成" : "按当前设置生成题目"}>{vcfGenRunning ? <X/> : <Sparkles/>}<span>{vcfGenRunning ? "停止生成" : "生成题目"}</span></button>
                  <button onClick={() => { if (vcfExportJsonRef.current) downloadFile(vcfExportJsonRef.current, `vcf-${vcfOptions.tier}-题集.json`, "application/json"); }} disabled={!vcfBatch.length} aria-label="导出本次生成的题库 JSON" title="导出本次生成的题库 JSON"><Download/><span>导出题集</span></button>
                  <button onClick={solveCurrentBoardVcf} aria-label="解答当前局面连续冲四" title="解答当前局面连续冲四"><ListTree/><span>解答本局</span></button>
                </div>
              </div>
              {!vcfBatch.length && !vcfGenRunning && <p className="vcf-progress" role="status">选模式与档位后点“生成题目”：真题变形换朝向，原创作曲造新局；自动存入题库“我的题库”，题号列表会记录每题状态。</p>}
              {vcfSolveNote && <p className="vcf-progress" role="status">{vcfSolveNote}</p>}
            </div>}
          </div>}
        </section>
      </div>}

      {tab === "library" && <div className="library-page page-padding">
        <div className="library-segment" role="tablist"><button className={librarySection === "puzzles" ? "active" : ""} onClick={() => { setLibrarySection("puzzles"); setExpandedLibraryFolders(new Set([libraryFolders.puzzleFolders[0] || ""])); }} role="tab">题库 <small>{puzzleCollections.length}</small></button><button className={librarySection === "records" ? "active" : ""} onClick={() => { setLibrarySection("records"); setExpandedLibraryFolders(new Set([libraryFolders.recordFolders[0] || ""])); }} role="tab">棋谱 <small>{library.length + largeSummaries.length}</small></button></div>
        <label className="library-search"><Search size={17}/><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={librarySection === "records" ? "搜索棋谱名、棋手或主题" : "搜索题库、题目或题面"}/><button type="button" onClick={() => setLibraryQuery("")} aria-label="清除搜索"><X size={15}/></button></label>
        {librarySection === "records" ? <>
          <ResearchLibraryOverview
            activeTitle={(mode === "record" ? viewDocument : recordSession.current.document).metadata.title}
            activeDepth={depthOf(mode === "record" ? viewDocument : recordSession.current.document, mode === "record" ? currentId : recordSession.current.currentId)}
            activeHasDraft={mode === "record" ? hasDraft(draft) : regularDraftIds.has(recordSession.current.document.id) || largeDraftIdSet.has(recordSession.current.document.id)}
            activeUpdatedAt={(mode === "record" ? viewDocument : recordSession.current.document).updatedAt}
            activeId={(mode === "record" ? document : recordSession.current.document).id}
            records={library}
            largeRecords={largeSummaries}
            regularDraftIds={regularDraftIds}
            largeDraftIds={largeDraftIdSet}
            filter={recordFilter}
            onFilterChange={setRecordFilter}
            onContinue={() => { if (mode === "puzzle") switchMode("record"); setTab("record"); }}
            onOpenRecord={openRecord}
            onOpenLargeRecord={openLargeRecord}
            onOpenDataSafety={() => setSheet("dataSafety")}
            recycleCount={recycleBin.length}
          />
          <div className={`library-actions batch-actions ${batchEditMode ? "batch-active" : ""}`}><button onClick={openRecordImportPicker}><Download/>导入棋谱<small>单个 LIB / SGF / JSON</small></button><button onClick={() => createLibraryFolder("records")}><FolderPlus/>新建文件夹<small>整理棋谱分组</small></button><button onClick={newRecord}><FilePlus2/>新建棋谱<small>从空棋盘开始</small></button><button onClick={() => { setBatchEditMode((active) => !active); setBatchSelectedIds([]); }}><ListTree/>{batchEditMode ? "退出批量" : "批量处理"}<small>{batchEditMode ? `已选择 ${batchSelectedIds.length} 份` : "选择普通棋谱后批量处理"}</small></button></div>
          {batchEditMode && <div className="batch-selection-bar" role="status" aria-live="polite"><span>已选择 {batchSelectedIds.length} 份</span><button type="button" onClick={selectAllBatchResults}>全选</button><button type="button" onClick={clearBatchSelection}>取消全选</button><button type="button" disabled={!batchSelectedIds.length} onClick={() => { setFolderSheetMode("batch-move"); setFolderCreationParent(libraryFolders.recordFolders[0] || "未分类"); setSheet("folder"); }}>移动</button><button type="button" className="batch-delete-action" disabled={!batchSelectedIds.length} onClick={() => { if (window.confirm(`确认删除已选择的 ${batchSelectedIds.length} 份棋谱？`)) { batchSelectedDocuments.forEach((item) => deleteRecord(item)); closeBatchEdit(); } }}>删除</button><button type="button" className="accent" disabled={!batchSelectedIds.length} onClick={() => setSheet("batchEdit")}>更多</button><button type="button" onClick={closeBatchEdit}>退出</button></div>}
          <button className="settings-link image-import-entry" onClick={openImageImportPicker} disabled={imageRecognizing}><span><Download/><b>{imageRecognizing ? "正在识别棋盘…" : "图片识谱"}</b><small>自动定位网格识别棋子与颜色，带手数截图可恢复落子顺序</small></span><ChevronRight/></button>
          <div className="folder-library-list">{folderChildren(libraryFolders.recordFolders, "").map(renderRecordFolder)}</div>
         </> : <>
           <RecentPuzzleSection items={recentPuzzles} onOpen={(item: RecentPuzzleItem) => guardedOpenPuzzle(item.collectionIndex, item.puzzleIndex)} />
           <div className="library-actions puzzle-actions three"><button onClick={() => setSheet("wrongbook")}><Layers3/>错题本<small>{wrongPuzzleEntries.length ? `${wrongPuzzleEntries.length} 道待复习` : "尝试过但尚未攻克的题目"}</small></button><button onClick={openPuzzleImportPicker}><Download/>导入 JSON 题库<small>支持 puzzles 题库对象和二维题目数组</small></button><button onClick={() => createLibraryFolder("puzzles")}><FolderPlus/>新建文件夹<small>自由整理题集</small></button></div><button className="settings-link recycle-bin-entry" onClick={() => setSheet("dataSafety")}><span><ArchiveRestore/><b>资料安全</b><small>{recycleBin.length ? `${recycleBin.length} 项可恢复；也可备份全部资料` : "回收站、完整备份与恢复"}</small></span><ChevronRight/></button>
          <div className="folder-library-list">{folderChildren(libraryFolders.puzzleFolders, "").map(renderPuzzleFolder)}</div>
        </>}
      </div>}

      {tab === "settings" && <SettingsPage
        thinkDirectMove={thinkDirectMove}
        thinkSheetOnStart={thinkSheetOnStart}
        onThinkDirectMoveChange={setThinkDirectMove}
        onThinkSheetOnStartChange={setThinkSheetOnStart}
        playbackSpeed={playback.speed}
        onPlaybackSpeedChange={playback.setSpeed}
        playbackBranchPolicy={playback.branchPolicy}
        onPlaybackBranchPolicyChange={playback.setBranchPolicy}
        playbackLoop={playback.loop}
        onPlaybackLoopChange={playback.setLoop}
        fontScale={fontScale}
        onFontScaleChange={setFontScale}
        resolvedTheme={resolvedTheme}
        themePreference={themePreference}
        onThemePreferenceChange={setThemePreference}
        customBackgroundColor={customBackgroundColor}
        customBackgroundImage={customBackgroundImage}
        onCustomBackgroundColorChange={setCustomBackgroundColor}
        onChooseBackgroundImage={() => backgroundFileInput.current?.click()}
        onClearBackgroundImage={() => setCustomBackgroundImage("")}
        boardTheme={boardTheme}
        stoneTheme={stoneTheme}
        boardOpacity={boardOpacity}
        stoneOpacity={stoneOpacity}
        annotationHighlight={annotationHighlight}
        defaultBoardSize={defaultBoardSize}
        onDefaultBoardSizeChange={setDefaultBoardSize}
        onBoardThemeChange={setBoardTheme}
        onStoneThemeChange={setStoneTheme}
        onBoardOpacityChange={setBoardOpacity}
        onStoneOpacityChange={setStoneOpacity}
        onAnnotationHighlightChange={setAnnotationHighlight}
        soundSettings={soundSettings}
        onSoundSettingsChange={setSoundSettings}
        onPreviewSound={playSound}
        showNumbers={showNumbers}
        showCoordinates={showCoordinates}
        showForbidden={showForbidden}
         motionEnabled={motionEnabled}
         restoreLastPosition={restoreLastPosition}
        onShowNumbersChange={setShowNumbers}
        onShowCoordinatesChange={setShowCoordinates}
        onShowForbiddenChange={setShowForbidden}
         onMotionEnabledChange={setMotionEnabled}
         onRestoreLastPositionChange={setRestoreLastPosition}
        defaultDirectory={defaultDirectory}
        directorySupported={supportsDirectoryPicker()}
        nativeDirectorySupported={supportsNativeExportDirectory()}
        onChooseDefaultDirectory={() => { void chooseDefaultDirectory(); }}
        onClearDefaultDirectory={() => { void clearDefaultDirectory(); }}
        backupBusy={backupBusy}
        onImportRecord={() => singleFileInput.current?.click()}
        onOpenExport={openExportSheet}
        onExportBackup={() => { void exportBackup(); }}
        onRestoreBackup={() => backupFileInput.current?.click()}
        onOpenHelp={() => setSheet("help")}
        onOpenAbout={() => setSheet("about")}
        onOpenManual={() => setSheet("manual")}
        onOpenFeedback={() => setSheet("feedback")}
        enhancementSettings={enhancementSettings}
        onEnhancementSettingsChange={setEnhancementSettings}
      />}
      </main>

    <nav className="bottom-nav" aria-label="主导航"><button aria-current={tab === "record" ? "page" : undefined} className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}><Home/><span>{mode === "puzzle" ? "做题" : "打谱"}</span></button><button aria-current={tab === "library" ? "page" : undefined} className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>棋谱库</span></button><button className="nav-center" onClick={openImportSheet}><Download/><span>导入</span></button><button className={aiGame ? "active" : ""} onClick={openAiGameSheet}><Bot/><span>AI</span></button><button aria-current={tab === "settings" ? "page" : undefined} className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings/><span>设置</span></button></nav>
      {importProgress && <ImportProgressCard state={importProgress}/>}
       {enhancementSettings.coachMarks && coachMark && <CoachMark id={coachMark} onAction={handleCoachMarkAction}/>}
     <AppToast message={toast} onClose={() => setToast("")}/>

     {welcomeOpen && <FirstRunWelcome onDismiss={dismissFirstRunWelcome} onOpenManual={openManualFromFirstRun}/>}

     {workspaceSelectorOpen && mode === "puzzle" && <PuzzleSelectorSheet
      collections={puzzleCollections}
      progress={puzzleProgress}
      currentCollectionIndex={puzzleCollectionIndex}
      currentPuzzleIndex={puzzleIndex}
      folders={libraryFolders.puzzleFolders}
      assignments={libraryFolders.puzzleAssignments}
      onSelect={(collectionIndex, nextPuzzleIndex) => openPuzzle(collectionIndex, nextPuzzleIndex)}
       onNext={() => movePuzzle(1)}
       onClose={() => setWorkspaceSelectorOpen(false)}
      />}

      {workspaceSelectorOpen && (mode === "record" || mode === "review") && <RecordSelectorSheet
        records={selectorRecords}
        largeRecords={largeSummaries}
        currentId={document.id}
        folders={libraryFolders.recordFolders}
        assignments={libraryFolders.recordAssignments}
        onSelectRecord={(item) => { closeWorkspaceSelector(); openRecord(item, item.rootId, { mode: mode === "review" ? "review" : "record" }); }}
        onSelectLargeRecord={(item) => { closeWorkspaceSelector(); openLargeRecord(item, mode === "review" ? "review" : "record"); }}
        nativeDatabase={{ title: NATIVE_DATABASE_TITLE, hint: "内置局面数据库 · 分支按局面实时查询", onOpen: () => { closeWorkspaceSelector(); openNativeDatabase(); } }}
        onClose={closeWorkspaceSelector}
      />}

     {pendingSwitch && <BottomSheet title="有未保存草稿" className="draft-guard-backdrop" manageHistory onClose={() => setPendingSwitch(null)}><div className="sheet-body"><p className="section-note">继续当前操作前请先处理当前未保存的草稿，否则将丢失。</p><button className="primary-button" onClick={savePendingSwitch}><Save/>保存草稿并切换</button><button className="secondary-button" onClick={discardPendingSwitch}><X/>放弃草稿并切换</button><button className="secondary-button" onClick={() => setPendingSwitch(null)}>取消</button></div></BottomSheet>}

    {sheet && <BottomSheet title={displaySheetTitle} className={sheet === "tree" ? "tree-sheet-backdrop" : sheet === "manual" ? "manual-sheet-backdrop" : ""} manageHistory onClose={() => setSheet(null)}>
    {sheet === "batchEdit" && <div className="sheet-body batch-action-sheet">
        <p className="section-note">仅处理普通棋谱，不会改写大型数据库。大型 LIB、DP、DB 只支持单独打开或导出。</p>
        <button className="export-primary-card" disabled={!batchSelectedIds.length} onClick={runBatchExport}><span className="format-icon"><Download/></span><div><b>批量导出</b><small>{batchSelectedIds.length ? "已选择 " + batchSelectedIds.length + " 项" : "请先选择至少一份普通棋谱"}</small></div><Upload/></button>
        <section className="batch-replace-card"><div className="batch-action-heading"><MessageSquareText size={19}/><div><b>批量替换注释</b><small>同时处理节点注释与局面文字</small></div></div><label>查找文字<input value={batchReplaceFrom} onChange={(event) => setBatchReplaceFrom(event.target.value)} placeholder="例如：待复核"/></label><label>替换为<input value={batchReplaceTo} onChange={(event) => setBatchReplaceTo(event.target.value)} placeholder="留空表示删除"/></label><button className="primary-button" disabled={!batchSelectedIds.length || !batchReplaceFrom} onClick={runBatchReplace}><Save/>执行替换</button></section>
        <button className="secondary-button" onClick={closeBatchEdit}><X/>完成</button>
      </div>}
      {sheet === "aiGame" && <div className="sheet-body ai-game-setup">
        <section className="ai-setup-hero"><span><Bot size={24}/></span><div><b>新建人机棋局</b><small>规则、交换与强度都在本机设置好，再开始对局</small></div></section>
        <details className="ai-setup-folder" open>
          <summary className="ai-setup-folder-head"><span><FolderOpen size={16}/>规则</span><small>所有规则集中在一个目录</small><ChevronDown size={18}/></summary>
          <div className="ai-setup-folder-body">
            <div className="ai-rule-list">
              {AI_RULE_CHOICES.map((choice) => {
                const selected = selectedAiRule.key === choice.key;
                return <div className={`ai-rule-row ${selected ? "selected" : ""}`} key={choice.key}>
                  <button type="button" className="ai-rule-choice" onClick={() => applyAiRuleChoice(choice)} aria-pressed={selected}><span>{choice.name} · {choice.badge}</span><small>{choice.summary}</small></button>
                  <button type="button" className="ai-rule-help" aria-label={`查看${choice.name}规则说明`} title={`查看${choice.name}规则说明`} onClick={() => setAiRuleDetail(aiRuleDetail === choice.key ? null : choice.key)}>?</button>
                </div>;
              })}
            </div>
            {aiRuleDetail && (() => { const choice = AI_RULE_CHOICES.find((item) => item.key === aiRuleDetail); if (!choice) return null; return <section className="ai-rule-detail"><div><b>{choice.name} · {choice.badge}</b><button type="button" onClick={() => setAiRuleDetail(null)} aria-label="关闭规则详情"><X size={15}/></button></div><p>{choice.detail}</p><small><b>流程：</b>{choice.steps}</small><small><b>胜负：</b>{choice.winning}</small></section>; })()}
            <button type="button" className="rule-guide-entry ai-rule-guide-entry" onClick={() => setSheet("rules")}><CircleHelp size={16}/>查看完整规则说明</button>
          </div>
        </details>
        <details className="ai-setup-folder" open>
          <summary className="ai-setup-folder-head"><span><FolderOpen size={16}/>对局时长</span><small>只统计你操作棋盘的时间</small><ChevronDown size={18}/></summary>
          <div className="ai-setup-folder-body">
            <div className="ai-time-grid">{AI_TIME_OPTIONS.map((option) => <button key={option.value} className={aiTimeLimitMs === option.value ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiTimeLimitMs(option.value); }} aria-pressed={aiTimeLimitMs === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>
            <p className="ai-time-note">AI 思考、浏览历史局面和对局结束后都会暂停计时。</p>
          </div>
        </details>
        <details className="ai-setup-folder" open>
          <summary className="ai-setup-folder-head"><span><FolderOpen size={16}/>AI 强度</span><small>先给一个档位，再决定是否自由搜索</small><ChevronDown size={18}/></summary>
          <div className="ai-setup-folder-body">
            <div className="ai-strength-grid fixed">{AI_STRENGTH_OPTIONS.filter((option) => option.value !== "自由").map((option) => <button key={option.value} className={aiStrength === option.value ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiStrength(option.value); }} aria-pressed={aiStrength === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>
            {AI_STRENGTH_OPTIONS.filter((option) => option.value === "自由").map((option) => <button key={option.value} className={`ai-strength-free-option ${aiStrength === option.value ? "selected" : ""}`} onClick={() => { cancelActiveAiComputation("settings-change"); setAiStrength(option.value); }} aria-pressed={aiStrength === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}
            {aiStrength === "自由" && <div className="ai-free-controls"><button type="button" className={`ai-unlimited-option ${aiFreeUnlimited ? "selected" : ""}`} aria-pressed={aiFreeUnlimited} onClick={() => { cancelActiveAiComputation("settings-change"); setAiFreeUnlimited((value) => !value); }}><span><b>不限时思考</b><small>持续搜索，直到你主动停止、切换局面或应用进入后台</small></span><Check/></button><label className={aiFreeUnlimited ? "disabled" : ""}><span>思考时间</span><div className="ai-free-time-entry"><input aria-label="自定义思考时间（秒）" type="number" min="0.3" max="300" step="0.1" disabled={aiFreeUnlimited} value={(aiFreeTimeMs / 1000).toFixed(1)} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeTimeMs(Math.max(300, Math.min(300000, Math.round((Number(event.target.value) || 0.3) * 1000)))); }}/><em>秒</em></div><input aria-label="思考时间滑杆" type="range" min="300" max="300000" step="100" disabled={aiFreeUnlimited} value={aiFreeTimeMs} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeTimeMs(Number(event.target.value)); }}/><small>{aiFreeUnlimited ? "不限时模式不会自动到时落子" : "可输入 0.3–300 秒，最长 5 分钟"}</small></label><label><span>搜索深度</span><output>{aiFreeUnlimited ? "持续加深" : `${aiFreeDepth} 层`}</output><input aria-label="搜索深度滑杆" type="range" min="16" max="128" step="8" value={aiFreeDepth} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeDepth(Number(event.target.value)); }}/></label></div>}
          </div>
        </details>
        <section className="ai-setup-player">
          <b>初始执子</b>
          <div className="ai-option-grid two player"><button className={aiHumanPlayer === "black" ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiHumanPlayer("black"); }}><i className="player-stone black"/><span>执黑 · 开局方</span><small>交换后执子颜色可能改变</small></button><button className={aiHumanPlayer === "white" ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiHumanPlayer("white"); }}><i className="player-stone white"/><span>执白 · 应对方</span><small>在规则允许时可选择交换</small></button></div>
        </section>
        <button className="primary-button ai-start-button" onClick={startNewAiGame}><Bot size={18}/>{aiGame ? "按新规则重新开始" : "开始人机对战"}</button><p className="helper">开局交换只影响起始流程，后续仍按当前规则继续。</p>
      </div>}
      {sheet === "fifthCount" && aiGame?.opening.stage.kind === "choose-fifth-count" && (() => {
        const openingRule = aiGame.opening.rule;
        const range = openingRule === "soosyrv-8" ? [1, 2, 3, 4, 5, 6, 7, 8] : openingRule === "yamaguchi" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [3, 4, 5, 6, 7, 8, 9, 10];
        const note = openingRule === "soosyrv-8"
          ? "索索夫-8：白方落第4手时宣布 1–8 个第5手打点数量；宣布后对方仍有一次交换权。"
          : openingRule === "yamaguchi"
            ? "山口：请宣布本局第5手打点数量（1–10）；宣布后由对方决定是否交换，再由白方落第4手。"
            : "五手多打的数量在对局中决定。请选择本局要提供的不同第5手候选数量。";
        return <div className="sheet-body fifth-count-sheet"><p className="section-note">{note}</p><div className="fifth-count-grid">{range.map((count) => <button key={count} onClick={() => chooseOpeningFifthCount(count)}><b>{count}</b><span>个打点</span><small>A1–A{count}</small></button>)}</div></div>;
      })()}
      {sheet === "folder" && <div className="sheet-body form-grid folder-sheet"><label>{folderSheetMode === "batch-move" ? "移动到文件夹" : "上级文件夹"}<select value={folderCreationParent} onChange={(event) => setFolderCreationParent(event.target.value)}>{folderSheetMode === "create" && <option value="">根目录</option>}{folderOptions(folderCreationSection === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders)}</select></label>{folderSheetMode === "create" ? <><label>文件夹名称<input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder={`例如：${folderCreationSection === "records" ? "我的实战棋谱" : "冲四题库"}`} onKeyDown={(event) => { if (event.key === "Enter") confirmCreateLibraryFolder(); }}/></label><p className="helper">可选择上级文件夹建立子目录；移动棋谱或题集时也会显示完整层级。</p><button className="primary-button" onClick={confirmCreateLibraryFolder}><FolderPlus/>创建文件夹</button></> : <><p className="helper">已选择 {batchSelectedIds.length} 份棋谱，将移动到所选文件夹。</p><button className="primary-button" onClick={moveBatchSelectionToFolder}><FolderOpen/>确认移动</button></>}</div>}
      {sheet === "rename" && renameTarget && <div className="sheet-body form-grid rename-sheet"><div className="rename-summary"><span><PenLine size={18}/></span><div><b>{renameTarget.kind.includes("folder") ? "文件夹" : renameTarget.kind === "puzzle" ? "题目" : renameTarget.kind === "puzzle-collection" ? "题集" : "棋谱"}</b><small>当前位置：{renameTarget.kind.includes("folder") ? folderDisplayLabel(renameTarget.name) : renameTarget.name}</small></div></div><label>新的名称<input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={80} onKeyDown={(event) => { if (event.key === "Enter") void confirmLibraryRename(); }}/></label><p className="helper">{renameTarget.kind.includes("folder") ? "重命名父文件夹时，里面的子文件夹和内容会一起保留并更新路径。" : "只修改显示名称，不会改变棋谱内容、题目进度或所在文件夹。"}</p><button className="primary-button" onClick={() => { void confirmLibraryRename(); }}><Check/>确认重命名</button></div>}
      {sheet === "find" && <RecordSearchPanel document={document} query={findQuery} results={findResults} onQueryChange={setFindQuery} onJump={(nodeId) => { clearBoardMotion(); setCurrentId(nodeId); }}/>}
      {sheet === "positionSearch" && <div className="sheet-body position-search-sheet"><label className="match-toggle"><span><b>包含旋转与镜像</b><small>不同棋盘朝向也视为同一局面</small></span><input type="checkbox" checked={matchSymmetry} onChange={(event) => setMatchSymmetry(event.target.checked)}/><i/></label><p className="section-note">已扫描 {searchableDocuments.length} 份本地棋谱的主线和全部变化，找到 {visiblePositionMatches.length} 个其他节点{positionMatches.length >= 60 ? "（只显示前 60 个）" : ""}。</p><div className="position-match-list">{visiblePositionMatches.map((match) => <button key={`${match.documentId}-${match.nodeId}`} onClick={() => { const target = searchableDocuments.find((item) => item.id === match.documentId); if (!target) return; openRecord(target, match.nodeId, { onOpened: () => { setSheet(null); setToast(`已跳转到《${match.title}》第 ${match.depth} 手`); } }); }}><span>{match.depth}</span><div><b>{match.title}</b><small>第 {match.depth} 手{match.coordinate ? ` · ${match.coordinate}` : " · 起始局面"}</small></div><ChevronRight size={18}/></button>)}</div>{!visiblePositionMatches.length && <div className="sheet-empty"><Search/><b>棋谱库中没有其他相同局面</b><span>{matchSymmetry ? "已同时比较旋转与镜像方向。" : "可开启旋转与镜像后再试。"}</span></div>}<p className="helper">匹配同时比较黑白棋位置和下一手行棋方；点击结果会直接打开对应棋谱节点。</p></div>}
      {sheet === "think" && <div className="sheet-body think-sheet"><section className="think-hero"><span><Bot size={21}/></span><div><b>思考当前局面</b><small>轮到{nextPlayer === "black" ? "黑" : "白"}方 · 只分析，不会自动改谱</small></div></section>{thinkRunning && <div className="think-running"><i/><div><b>正在寻找下一步</b><span>先检查强制成五、连续冲四，再进行迭代加深搜索…</span></div></div>}{!thinkRunning && thinkResult?.move && <section className="think-result"><div className="think-recommend"><span>荐</span><div><small>AI 推荐落点</small><b>{coordinateName(thinkResult.move)}</b></div><em className={thinkResult.source === "verified-vcf" ? "proof" : "search"}>{thinkResult.source === "verified-vcf" ? "已验证强制胜" : thinkResult.source === "rapfi" ? "Rapfi 推荐" : "搜索候选"}</em></div><div className="think-stats"><span><b>{thinkResult.depth}</b> 层深度</span><span><b>{thinkResult.nodes.toLocaleString()}</b> 节点</span><span><b>{Math.round(thinkResult.elapsedMs)}ms</b> 用时</span><span><b>{thinkResult.winRate === undefined ? "暂无" : `${Math.round(thinkResult.winRate * 100)}%`}</b> 胜率</span></div>{thinkResult.source !== "rapfi" && <p className="think-engine-note">当前为{thinkResult.source === "verified-vcf" ? "已验证 VCF" : "自研启发式"}回退，未伪造 Rapfi 胜率。</p>}{thinkResult.candidates?.length ? <div className="think-top-candidates"><small>Top-3 推荐{thinkResult.candidates.length < 3 ? ` · 引擎返回 ${thinkResult.candidates.length} 项` : ""}</small><div>{thinkResult.candidates.slice(0, 3).map((candidate, index) => <div className={`think-candidate ${index === 0 ? "primary" : ""}`} key={`${candidate.move.row}-${candidate.move.col}`}><b>{index + 1}. {coordinateName(candidate.move)}</b><span>{candidate.winRate === undefined ? candidate.score !== undefined && thinkResult.scoreAvailable ? `${Math.round(candidate.score)} 分` : "暂无胜率" : `${Math.round(candidate.winRate * 100)}%`}</span></div>)}</div></div> : <div className="think-top-candidates unavailable"><small>Top-3 推荐</small><span>当前回退搜索只返回主推荐，未把启发式排序冒充 Rapfi 多候选。</span></div>}{thinkResult.principalVariation?.length ? <div className="think-pv"><small>主变化 · 最多 10 手</small><div>{thinkResult.principalVariation.slice(0, 10).map((move, index) => <span key={`${move.row}-${move.col}-${index}`} className={move.player}>{index + 1}. {coordinateName(move)}</span>)}</div></div> : <p className="helper">这是启发式搜索排序结果，不代表已经证明必胜；如需严格证明，可打开“局面分析”搜索 VCF。</p>}<button className="primary-button" onClick={() => { const move = thinkResult.move; if (!move) return; setSheet(null); play(move); }}><GitBranch size={16}/>用推荐落点创建变化</button></section>}{!thinkRunning && !thinkResult?.move && <div className={`sheet-empty think-empty ${thinkVisualState}`}><Bot/><b>{thinkVisualState === "error" ? "思考线程异常" : thinkVisualState === "cancelled" ? "已停止旧局面分析" : thinkVisualState === "unavailable" ? "没有合法推荐点" : "暂时没有可用推荐"}</b><span>{thinkVisualState === "error" ? "本次计算已安全停止，可重新尝试。" : thinkVisualState === "cancelled" ? "棋盘局面已经变化，需要按当前局面重新思考。" : thinkVisualState === "unavailable" ? "棋盘可能已满，或当前规则下没有合法落点。" : "请确认棋盘还有空位，然后点击下方按钮。"}</span></div>}<button className={`secondary-button ${thinkRunning ? "danger" : ""}`} onClick={startThink}>{thinkRunning ? "停止思考" : thinkVisualState === "idle" ? "开始思考" : "重新思考"}</button><p className="helper">AI 会遵守当前棋谱的规则设置。红色禁手点不会作为黑方推荐；Rapfi 只在引擎真实输出胜率时显示胜率，否则明确标记暂无。</p></div>}
      {sheet === "analysis" && <div className="sheet-body analysis-sheet"><section className="vcf-panel"><div className="vcf-heading"><div><span>强制胜证明</span><b>VCF · 连续冲四</b></div><em>最多 5 次进攻</em></div>{!vcfResult && !vcfRunning && <p>穷举进攻方的成五与冲四，并验证防守方所有合法挡点；只有全部防守都失败才报告胜法。</p>}{vcfRunning && <div className="vcf-running"><i/><span>正在搜索合法冲四与全部防点…</span></div>}{vcfResult?.status === "win" && <div className="vcf-result win"><b><Check size={17}/>已找到连续冲四胜法</b><div className="proof-line">{vcfResult.principalVariation.map((move, index) => <span key={`${move.row}-${move.col}-${index}`} className={move.player}>{index + 1}. {coordinateName(move)}</span>)}</div><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small><button onClick={() => { const first = vcfResult.principalVariation[0]; if (first) { setSheet(null); play(first); } }}>从证明首手创建变化</button></div>}{vcfResult?.status === "not-found" && <div className="vcf-result neutral"><b>当前深度未找到 VCF</b><span>这不代表局面无胜，只表示最多 5 次连续冲四内没有证明。</span><small>搜索 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}{vcfResult?.status === "budget" && <div className="vcf-result warning"><b>达到手机计算预算</b><span>搜索已安全中止，没有把未完成结果当作胜法。</span><small>检查 {vcfResult.nodes.toLocaleString()} 节点 · {Math.round(vcfResult.elapsedMs)}ms</small></div>}<button className="vcf-search-button" disabled={vcfRunning} onClick={() => { void runVcf(); }}><Search size={16}/>{vcfRunning ? "搜索中…" : vcfResult ? "重新搜索 VCF" : "搜索 VCF 胜法"}</button></section><button className="position-search-entry" onClick={() => setSheet("positionSearch")}><span><Search size={18}/></span><div><b>跨谱查找相同局面</b><small>支持旋转、镜像和所有变化节点</small></div><ChevronRight size={18}/></button><p className="section-note">下面是启发式候选排序：综合成五、活四、冲四、活三与防守点，用于研究和标记，不等同于 VCF/VCT 证明。</p><div className="analysis-list">{candidates.map((candidate, index) => <div className="analysis-row" key={`${candidate.position.row}-${candidate.position.col}`}><div className="analysis-rank">{String.fromCharCode(65 + index)}</div><div className="analysis-copy"><b>{coordinateName(candidate.position)} <small>{Math.round(candidate.score)} 分</small></b><span>{candidate.reasons.join(" · ")}</span></div><button className="analysis-mark" onClick={() => markCandidate(index)}>标记</button></div>)}</div>{!candidates.length && <div className="sheet-empty"><Search/><b>当前没有可评估的候选点</b><span>{matchSymmetry ? "已同时比较旋转与镜像方向。" : "可开启旋转与镜像后再试。"}</span></div>}<div className="analysis-actions"><button className="primary-button" onClick={markTopCandidates}>标记前五候选</button><button className="secondary-button" onClick={() => { setSheet(null); setDockPanel("annotation"); }}>打开标注模式</button></div><p className="helper">候选点会保存到当前节点，可导出为 SGF 的 LB 标记。</p></div>}
      {sheet === "comment" && <div className="sheet-body"><textarea autoFocus value={current.comment} placeholder="例如：这里白棋若防在 J9，黑棋可以继续冲四…" onChange={(event) => safeUpdateNode({ comment: event.target.value })}/><p className="helper">注释保存在当前节点，导出 SGF 时会写入 C 属性。</p>{current.renLibAnnotations?.length ? <section className="native-annotation-panel"><h3>原谱内容</h3>{annotationLines(current).map((text, index) => <p key={`${current.id}-native-${index}`}>{text}</p>)}</section> : null}<button className="primary-button" onClick={() => setSheet(null)}><Check/>完成</button></div>}
       {sheet === "tree" && <div className="sheet-body tree-sheet"><TreePanel
         document={viewDocument}
         currentId={currentId}
         path={path}
         compactIndex={compactIndexOf(document)}
         bookmarks={activeBookmarks}
         clipboard={treeClipboard}
         busy={dynamicNavigationBusy}
         readOnly={false}
         branchNameOverrides={reviewBranchNames[viewDocument.id] || {}}
         onLocate={selectTreeNode}
         onCreateBranch={createBranchFromTree}
         onRenameBranch={renameTreeBranch}
         onDeleteBranch={deleteTreeBranch}
         onCopy={copyTreeBranch}
         onCut={cutTreeBranch}
         onPaste={pasteTreeBranch}
         onCancelCopy={() => { setTreeClipboard(null); setToast("已取消分支复制"); }}
         onToggleBookmark={toggleTreeBookmark}
         onEditBookmark={editTreeBookmark}
         onDeleteBookmark={deleteTreeBookmark}
       /></div>}
       {sheet === "branches" && <div className="sheet-body"><div className="support-row"><b>分支操作已并入棋谱树</b><span>在树中点选节点即可切换、创建、复制、重命名或删除分支。</span></div><button className="primary-button" onClick={() => setSheet("tree")}><ListTree/>打开棋谱树</button></div>}
      {sheet === "save" && <div className="sheet-body form-grid save-sheet"><label>保存名称<input autoFocus value={viewDocument.metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })}/></label><div className="save-destination" role="tablist" aria-label="保存类型"><button className={saveDestination === "records" ? "selected" : ""} onClick={() => { setSaveDestination("records"); setSaveFolder(libraryFolders.recordFolders[0] || "未分类"); }} role="tab">棋谱</button><button className={saveDestination === "puzzles" ? "selected" : ""} onClick={() => { setSaveDestination("puzzles"); setSaveFolder(libraryFolders.puzzleFolders[0] || "我的题库"); }} role="tab">题库</button></div><label>保存到分组<select value={saveFolder} onChange={(event) => setSaveFolder(event.target.value)}>{folderOptions(saveDestination === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders)}</select></label>{saveDestination === "puzzles" && <p className="helper">将当前局面保存为一道练习题，保留当前棋盘上的全部棋子。</p>}<details className="save-info-disclosure"><summary><span><b>编辑棋谱信息</b><small>棋手、赛事、规则与开局设置</small></span><ChevronDown/></summary><div className="save-info-content form-grid"><MetadataFields metadata={viewDocument.metadata} onChange={updateMetadata}/></div></details><button className="primary-button" onClick={() => { void confirmSave(); }}><Save/>确认保存</button></div>}
      {sheet === "metadata" && <div className="sheet-body form-grid"><MetadataFields metadata={viewDocument.metadata} onChange={updateMetadata}/><button className="primary-button" onClick={() => setSheet(null)}><Save/>保存信息</button></div>}
      {sheet === "import" && <div className="sheet-body import-options"><button className="import-choice" onClick={() => { setSheet(null); if (mode === "puzzle") puzzleFileInput.current?.click(); else singleFileInput.current?.click(); }}><span className="format-icon"><Download/></span><div><b>{mode === "puzzle" ? "导入题库文件" : "导入棋谱文件"}</b><small>{mode === "puzzle" ? "puzzles 题库对象、连续坐标串、二维 JSON 数组" : "SGF、LIB、JSON、POS 等格式；题库 JSON 会自动识别"}</small></div><ChevronRight/></button><button className="import-choice" onClick={() => { setSheet(null); imageFileInput.current?.click(); }}><span className="format-icon json"><Download/></span><div><b>图片识谱</b><small>自动定位网格识别棋子与颜色，带手数截图可恢复落子顺序</small></div><ChevronRight/></button>{enhancementSettings.recentImports && recentImports.length > 0 && <section className="recent-imports" aria-label="最近导入"><div className="recent-imports-heading"><b>最近导入</b><small>保留最近 5 个来源文件</small></div><div className="recent-import-list">{recentImports.map((entry) => <button key={entry.id} className="recent-import-item" onClick={() => { void reopenRecentImport(entry); }} aria-label={`重新打开 ${entry.name}`}><span className="recent-import-icon">{entry.kind === "puzzle" ? "题" : "谱"}</span><span className="recent-import-copy"><b title={entry.name}>{entry.name}</b><small>{entry.kind === "puzzle" ? "题库" : "棋谱"} · {entry.available ? "可一键重开" : "文件较大，请重新选择"}</small></span><ChevronRight size={16}/></button>)}</div></section>}{mode === "puzzle" && <p className="helper">题库 JSON 可使用 puzzles 包装格式：每题支持 stones 连续坐标串，或 blackStones / whiteStones 分色坐标串；也兼容旧格式的“坐标,颜色编号”二维数组。side 会作为题目先手读取，空题会跳过。</p>}{mode !== "puzzle" && <p className="helper">图片识谱会自动定位网格并识别棋子颜色；截图带手数时还能恢复落子顺序。识别后请快速核对一遍，题库 JSON 选择后会自动转入题库。</p>}</div>}
      {sheet === "dataSafety" && <DataSafetyPanel recycleCount={recycleBin.length} backupBusy={backupBusy} onOpenTrash={() => setSheet("trash")} onExportBackup={() => { void exportBackup(); }} onRestoreBackup={() => backupFileInput.current?.click()}/>}
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
        <section className="export-scope-section"><div className="export-section-heading"><b>1. 选择导出范围</b><small>先决定内容，再选择文件格式</small></div><div className="export-scope-grid">{([
          ["whole", "整份棋谱", exportsVisibleDatabaseContent ? "当前已加载路径、分支与注释" : "完整变化树、注释与标注"],
          ["variation", "当前变化", "从起点到当前选择，并沿主线到末尾"],
          ["position", "当前局面", "只保留盘面、轮到谁走与当前标注"],
        ] as const).map(([scope, label, detail]) => <button key={scope} className={exportScope === scope ? "selected" : ""} onClick={() => setExportScope(scope)} aria-pressed={exportScope === scope}><b>{label}</b><small>{detail}</small></button>)}</div></section>
        <div className="export-source-card"><span>当前选择</span><b>{exportScopeSuffix(exportScope)} · {sourceFormat ? sourceFormat.toUpperCase() : "新建棋谱"}</b><small>{exportScope === "whole" ? sourceFormat ? directExportAvailable ? `可按原格式直接导出：${directFormatLabel}` : `${directFormatLabel}，当前只能转换导出` : "可导出为 SGF 或 JSON" : "范围导出会生成新的 SGF 或 JSON，不会伪装成原二进制文件"}</small></div>
        {sourceFormat === "lib" && <button className="export-primary-card lib-convert" disabled={exportScope !== "whole" || !fullLibSgfAvailable || libSgfExporting} onClick={() => { void exportFullLibAsSgf(); }}><span className="format-icon">SGF</span><div><b>{libSgfExporting ? "正在转换完整 LIB…" : "完整 LIB 转换为 SGF"}</b><small>{exportScope !== "whole" ? "完整 LIB 转换只适用于“整份棋谱”范围" : libSgfSourceTooLarge ? "源文件超过 64MB；转换会额外申请完整 SGF 缓冲区，为避免设备内存不足已停用" : fullLibSgfAvailable ? "由 RenLib 核心转换当前未编辑的完整源棋谱" : "只对当前刚打开且未编辑、仍保留原文件的 LIB 可用"}</small></div><Upload/></button>}
        <button className="export-primary-card choose" onClick={() => setExportFormatMenuOpen((open) => !open)}><span className="format-icon"><Upload/></span><div><b>选择格式导出</b><small>{exportsVisibleDatabaseContent ? "可将已加载路径、可见分支与注释导出为 SGF 或 JSON" : "展开后选择 SGF 或 JSON"}</small></div><ChevronDown className={exportFormatMenuOpen ? "expanded" : ""}/></button>
        {exportFormatMenuOpen && <div className="export-format-list">
          <button onClick={() => exportAsFormat("sgf")}><span className="format-icon">SGF</span><div><b>SGF（{exportScopeSuffix(exportScope)}）</b><small>{exportScope === "whole" && exportsVisibleDatabaseContent ? "只包含已加载路径、可见分支与注释，不代表整个原始数据库" : exportScope === "position" ? "使用 SGF 设置局面保存当前盘面，可被常见棋谱软件读取" : "保留所选范围内的变化、注释、评价和棋盘标注"}</small></div><Upload/></button>
          <button onClick={() => exportAsFormat("json")}><span className="format-icon json">JSON</span><div><b>JSON（{exportScopeSuffix(exportScope)}）</b><small>{exportScope === "position" ? "只保存当前盘面和当前节点资料" : "保存所选范围内的半步完整可编辑数据"}</small></div><Upload/></button>
          <button disabled><span className="format-icon muted">LIB</span><div><b>RenLib LIB</b><small>可读取并可原样导出已打开的 LIB；当前不把普通棋谱伪造为 LIB</small></div><Lock/></button>
          <button disabled><span className="format-icon muted">DP</span><div><b>DP / DB 局面数据库</b><small>可原样导出已打开的源文件，但不重新编码或生成新的 DP / DB</small></div><Lock/></button>
        </div>}
        <button className="export-primary-card direct" disabled={exportScope !== "whole" || !directExportAvailable} onClick={exportDirect}><span className="format-icon direct"><Download/></span><div><b>原格式直接导出</b><small>{exportScope !== "whole" ? "切换到“整份棋谱”后可使用原格式直出" : sourceFormat ? `已有格式直接导出：${directFormatLabel}` : "当前没有原始格式，将按默认 SGF 导出"}</small></div><Upload/></button>
        <p className="helper">导出位置：{defaultDirectory ? `“${defaultDirectory.name}”文件夹` : supportsDirectoryPicker() ? "浏览器默认下载目录（可在设置中选择文件夹）" : "浏览器默认下载目录"}。LIB 可在当前未编辑会话中完整转换为 SGF，但源文件超过 64MB 时只允许原文件直出或导出当前可见内容；DP / DB 不会被重新编码。</p>
      </div>}
       {sheet === "help" && <div className="sheet-body help-content"><div className="support-row"><b>棋谱导入</b><span>RenLib 3.x / 旧版无头 LIB（按设备能力分页导入）、SGF / FGF、REN / RENJS / WZQ（SGF 语法）、JSON、POS，以及 DP / DB 局面数据库。SGF 支持设置局面、过手、UTF-16 和同文件多盘棋。</span></div><div className="support-row"><b>导出与保真</b><span>普通 SGF 和 JSON 会重新生成当前完整变化树。当前刚打开且未编辑的 LIB 在 64MB 以内可由 RenLib 核心完整转换为 SGF，也可原文件直出；大型 LIB 只允许原文件直出或导出当前可见内容。编辑副本可导出 SGF / JSON，但不会写回 LIB。DP / DB 可原文件直出或导出当前可见内容，不生成新数据库。</span></div><div className="support-row"><b>规则与开局</b><span>连珠规则：黑方恰五获胜、白方五个以上获胜，黑方受三三、四四、长连禁手约束；标准五子棋：双方无禁手，必须恰好五连；自由五子棋：双方无禁手，五个以上即可获胜。开局规则目前支持自由开局、五手两打、五手多打（3–10 打）、山口（先手方开局时宣布 1–10 打）、索索夫-8（白4后宣布 1–8 打，宣布后可再交换）、塔十（塔拉山口-10）和塔拉（五次交换），可在人机设置的“规则说明”中比较。</span></div><div className="support-row"><b>JSON 的用途</b><span>棋谱库读取本软件的完整变化树或带明确 moves 字段的落子列表对象；题库页读取 puzzles 包装题库、连续坐标串、黑白分色坐标串和旧版二维数组。数字坐标棋谱必须声明 coordinateBase，不猜测任意数组。</span></div><div className="support-row"><b>AI 完全本地</b><span>人机与“思考”使用应用内置 Rapfi WASM 数据，不访问 gomocalc.com，也不会上传当前棋局。</span></div><div className="support-row warning"><b>棋盘路数边界</b><span>棋盘支持 5–25 路方形棋盘，范围外的 SGF SZ 会明确拒绝，不会缩放后生成错误棋谱；内置题库固定为十五路。</span></div><div className="support-row warning"><b>TXT 不是统一棋谱标准</b><span>TXT 仅作为纯文本坐标序列兼容入口，例如 H8 I8 H9；带专有结构的文本应使用原软件导出的 SGF。</span></div><div className="support-row warning"><b>LIB 兼容边界</b><span>大型 LIB 在后台线程解析并按页存储。完整转 SGF 会额外申请整份输出缓冲区，因此源文件超过 64MB 时主动停用，避免手机或低内存设备崩溃。原谱的普通注释、局面文字和 RenLib 标记会分别保留并在节点详情中显示；超出 RenLib 3.4 的扩展仍会提示。</span></div><h3>手机快捷操作</h3><ul><li>点空交叉点：落子；点已有棋子：不会改变局面</li><li>底部“标注”：放置数字、胜败平衡和自定义文字</li><li>长按交叉点：圆圈 → 三角 → 叉号 → 清除</li><li>左右方向键（外接键盘）：前后导航</li></ul><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></div>}
      {sheet === "about" && <AboutPanel onClose={() => setSheet(null)}/>}
      {sheet === "feedback" && <FeedbackPanel version="1.1.7" location={tab === "settings" ? "设置" : tab === "library" ? "棋谱库" : "打谱"} onNotice={setToast}/>}
      {sheet === "manual" && <UserManual onClose={() => setSheet(null)} onOpenRules={() => setSheet("rules")}/>}
      {sheet === "rules" && (
        <RuleGuide onOpenManual={() => setSheet("manual")}/>
      )}
    </BottomSheet>}
  </div>;
}
