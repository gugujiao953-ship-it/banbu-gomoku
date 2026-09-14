import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ActionLayoutEditor } from "./features/workspace/ActionLayoutEditor";
import { WorkspaceAction } from "./features/workspace/WorkspaceAction";
import { ACTION_LABELS, actionVisibleInMode, defaultModeLayout, loadActionLayouts, saveActionLayouts, visibleModeLayout, type ActionId, type ActionLayouts, type LayoutZone, type ModeLayout } from "./features/workspace/action-layout";
import {
  ArchiveRestore, ArrowDownUp, ArrowRight, ArrowUpToLine, BookOpen, Bot, Check, ChevronDown, ChevronFirst, ChevronLast, ChevronLeft,
  ChevronRight, CircleDot, CircleHelp, Clock, Cpu, Download, FilePlus2, FlipHorizontal, FolderOpen, FolderPlus, Gauge, GitBranch,
  GripVertical, Home, Info, Layers3, Library, Lock, ListTree, Mail, Maximize2, Menu, MessageSquareText, Minimize2, MoreHorizontal, PenTool, Puzzle as PuzzleIcon, RotateCw, Search, Shield, SquarePen, Star, Tag,
  Crop, Eraser, PenLine, Redo2, Save, Settings, Sparkles, Trash2, Undo2, Upload, X, Bookmark, LocateFixed, FileClock, DatabaseBackup, XCircle, ClipboardList, Swords, Recycle,
} from "lucide-react";
import { isRecordFavorite as _isRecordFavorite, loadFavorites, pruneFavorites, saveFavorites, toggleCollectionFavorite, togglePuzzleFavorite, toggleRecordFavorite, type LibraryFavorites } from "./library-favorites";
import { solveVcf, vcfCoordName, type VcfRules } from "./features/vcf/vcf-generator";
import { toKaibaoCollectionJson, VCF_TIER_LABEL, loadVcfMaterial, type VcfTier, type VcfGenMode, type GeneratedVcfPuzzle, type MaterialFile } from "./features/vcf/vcf-corpus";
import { applyOrder, isLibraryOrderMaps, moveRelative, remapFolderOrder, removeFromOrder, sortIdsByTitles, type LibraryOrderKind, type LibraryOrderMaps } from "./library-order";
import { attachLibraryTouchDrag } from "./library-touch-drag";
import {
  addMove, addMoveAs, boardAt, coordinateName, createDocument, deleteVariation, depthOf, isSupportedBoardSize,
  forbiddenPoints, forbiddenReason, lastOnPreferredLine, nextPlayerAt, otherPlayer, pathToNode, preferredNext, setLabelMark, toggleMark, updateNode, winningLinesAt,
} from "./game";
import { downloadFile, exportJson, exportPos, exportSgf, importRecordFile, mainLineLength } from "./formats";
import { exportLib, exportPsq } from "./lib-export";
import { recognizeBoardImage, type BoardRoi, type ImageRecognitionResult } from "./image-recognition";
import { BoardAlignScreen } from "./features/record/image-align";
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
import { clearDefaultDirectoryHandle, defaultNativeExportHandle, exportLocationLabel, isSafDirectoryHandle, loadDefaultDirectoryHandle, pickDefaultDirectoryHandle, supportsDirectoryPicker, supportsNativeExportDirectory, writeFileToDirectory, type ExportDirectoryHandle } from "./file-destination";
import { boardShareFilename, renderBoardSharePng, type BoardShareOptions } from "./board-image-export";
import { sharePngFile } from "./share-file";
import { transformBoardPosition, type BoardRotation } from "./board-transform";
import { recordAction, APP_VERSION } from "./diagnostics";
import { checkForLatestRelease, type LatestRelease } from "./update-check";
import { loadUpdateAutoCheck, saveUpdateAutoCheck, loadUpdatePromptDismissed, saveUpdatePromptDismissed } from "./update-settings";
import { applyDraftToDocument, buildDraftOverlay, emptyDraft, hasDraft, overlayChildren, overlayNode, overlayPreferredChild, projectedDocument, pushDraft, redoDraft, undoDraft, type DraftState, type DraftOperation as DraftOp } from "./draft-operations";
import type { CompactRenLibIndex, RuleSet } from "./types";
import type { LargeDocumentSummary } from "./large-storage";
import VcfGenWorker from "./features/vcf/vcf-gen.worker?worker";
import RecordImportWorker from "./record-import.worker?worker";
import { verifyVcfProof } from "./vcf";
import type { BoardMark, BoardMarkStyle, GameDocument, ImportResult, OpeningRule, Player, Position, RecordNode, RecordSourceFormat } from "./types";
import PuzzleAiWorker from "./puzzle-ai.worker?worker";
import { winnerAt } from "./puzzle-ai";
import type { AiAnalysisCandidate, AiMoveResult } from "./puzzle-ai";
import { createPuzzleDocument, deriveWrongPuzzleEntries, importKaibaoPuzzleJson, isPuzzleJsonText, loadNativeKaibaoCollections, loadPuzzleCollections, loadPuzzleProgress, puzzleProgressKey, savePuzzleCollections, savePuzzleProgress, savePuzzleTitleOverride } from "./puzzles";
import type { Puzzle, PuzzleCollection, PuzzleReviewEntry } from "./puzzles";
import { addFifthCandidate, chooseFifthCount, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, isDistinctFifthCandidate, openingInstruction, openingPositionAllowed, openingRuleName, suggestFifthCandidates, suggestOpeningPlacement, type OpeningSession, type OpeningStage } from "./opening-rules";
import { ANNOTATION_COLORS, ANNOTATION_STYLES, ANNOTATION_TYPES, MOON_MARK_PATH, STAR_MARK_PATH, SUN_MARK_CORE_RADIUS, SUN_MARK_RAYS, annotationTypePreset, type AnnotationMarkType } from "./annotation-presets";
import { createBackupSnapshot, parseBackup, restoreBackup, serializeBackup } from "./backup";
import { readZip, textFromZipEntry, createZip, type ZipEntry } from "./zip";
import { banbuAudio, type SoundCue } from "./audio-engine";
import { loadSoundSettings, saveSoundSettings, type SoundSettings } from "./audio-settings";
import { loadMotionEnabled, saveMotionEnabled } from "./motion-settings";
import { ANALYSIS_METRIC_LABELS, fmtAnalysisMemory, loadEnhancementSettings, saveEnhancementSettings, getAnalysisMode, withAnalysisMode, type AnalysisCandidateMetric, type AnalysisMode, type EnhancementSettings } from "./enhancement-settings";
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
import { MANUAL_TOURS } from "./features/manual/tours";
import type { TourStep } from "./features/onboarding/tour-steps";
import { FeedbackPanel } from "./FeedbackPanel";
import { AboutPanel } from "./AboutPanel";
import type { AppMode, BoardTheme, ResolvedTheme, Sheet, StoneTheme, Tab, ThemePreference } from "./app-shell-types";
import { BottomSheet } from "./ui/overlays/BottomSheet";
import { ROOT_BACK_MESSAGE, useRootBackExit } from "./ui/overlays/useRootBackExit";
import { MetadataFields } from "./features/record/MetadataFields";
import { SettingsPage } from "./features/settings/SettingsPage";
import { DEFAULT_COORDINATE_FONT_SIZE, migrateCoordinateFontSize } from "./features/settings/display-defaults";
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
import { AppTour } from "./features/onboarding/AppTour";
import { markFirstRunWelcomeRead, markOnboardingTourSeen, shouldShowFirstRunWelcome } from "./features/onboarding/onboarding";
import { loadLastSession, loadRestoreLastPosition, saveLastSession, saveRestoreLastPosition, type LastSessionState } from "./features/session/session-restore";
import { loadStoneOpacity, saveStoneOpacity } from "./stone-opacity";
import { loadBoardOpacity, saveBoardOpacity } from "./board-opacity";
import { annotationHighlightColor, loadAnnotationHighlight, saveAnnotationHighlight, type AnnotationHighlight } from "./annotation-highlight";
import { TaskManager } from "./features/tasks/task-state";
import { AiWorkerController, type AiCancelReason } from "./features/ai/ai-worker-controller";
import { downloadEnginePack, enginePackSnapshot, ensureEnginePackUrl, installBundledEnginePack, subscribeEnginePack, type EnginePackState } from "./features/ai/engine-pack";
import { bookDeclareCount } from "./features/ai/opening-book";
import { RuleGuide } from "./features/rules/RuleGuide";
import { AI_RULE_PRESET_GUIDES } from "./features/rules/rule-guide-data";
import { UnifiedStatusBar } from "./features/workspace/UnifiedStatusBar";
import { RuleToggle } from "./features/workspace/RuleToggle";
import { RecordSelectorSheet } from "./features/workspace/RecordSelectorSheet";
import { loadRecordBookmarks, mergeRecordBookmarks, removeRecordBookmarks, saveRecordBookmarks, toggleRecordBookmark, updateRecordBookmark, type RecordBookmark, type RecordBookmarks } from "./features/record-tree/bookmarks";
import { copyRecordSubtree, pasteRecordSubtree, type SubtreeClipboard } from "./features/record-tree/subtree-clipboard";
import { PuzzleRuleSelector } from "./features/puzzles/PuzzleRuleSelector";
import { PuzzleSelectorSheet } from "./features/puzzles/PuzzleSelectorSheet";
import { fallbackLegalPuzzleMove, loadPuzzleRulePreference, puzzleMoveLegality, resolvePuzzleRule, savePuzzleRulePreference, type PuzzleRuleMode } from "./features/puzzles/puzzle-rules";
import { pickBoardImageFile, supportsNativePhotoPicker } from "./features/puzzles/photo-picker";
import { createPuzzleSetupSession, movePuzzleSetupCursor, placePuzzleSetupStone, puzzleSetupView, type PuzzleSetupSession } from "./features/puzzles/puzzle-setup-session";

type BoardMotionKind = "place" | "navigate" | "branch" | null;
type BoardFeedbackKind = "illegal" | "forbidden";
type BoardResultKind = "won" | "lost" | "draw" | "complete";
interface BoardMotionState { kind: BoardMotionKind; version: number }
interface BoardFeedbackState { position: Position; kind: BoardFeedbackKind; version: number }
interface BoardResultState { kind: BoardResultKind; label: string }
type DockPanel = "analysis" | "annotation" | "notes" | "view" | "play" | "setup" | "puzzles" | "vcf" | null;
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
type AiFloatPanel = "rule-noForbidden" | "rule-forbidden" | "difficulty" | "time" | null;
// Rules grouped by the forbidden-move badge so the setup dialog can offer two
// entry tiles (无禁手 / 有禁手) that each float up their full rule list.
const AI_RULE_GROUPS: Record<"无禁" | "有禁", readonly (typeof AI_RULE_CHOICES)[number][]> = {
  无禁: AI_RULE_PRESET_GUIDES.filter((entry) => entry.badge === "无禁"),
  有禁: AI_RULE_PRESET_GUIDES.filter((entry) => entry.badge === "有禁"),
};

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
interface AiGameState { humanPlayer: Player; aiPlayer: Player; strength: AiStrength; forbiddenEnabled: boolean; timeLimitMs: number; thinkTimeMs: number; thinkDepth: number; unlimitedThinking: boolean; outcome: "won" | "lost" | "draw" | null; opening: OpeningSession; engineChoice: AiEngineChoice }
type AiAnalysisEngine = "light" | "full" | "multi";
interface AiAnalysisState {
  status: "idle" | "thinking" | "complete" | "error";
  engine: AiAnalysisEngine;
  contextKey?: string;
  // Engine winRate/score is side-to-move relative; remember who was to move so
  // the UI can render a fixed black-perspective number instead of one that
  // appears to flip (70% → 30%) every time the turn changes.
  mover?: Player;
  depth: number;
  nodes: number;
  score?: number;
  scoreAvailable?: boolean;
  winRate?: number;
  move?: Position | null;
  candidates?: AiAnalysisCandidate[];
  principalVariation?: Array<Position & { player: Player }>;
  elapsedMs?: number;
}
// Convert a side-to-move win rate to black perspective.
const blackWinRate = (state: AiAnalysisState, raw: number | undefined): number | undefined =>
  raw === undefined ? undefined : state.mover === "white" ? 1 - raw : raw;
// Engine PV lines 2..N come from move ordering and can show values stronger
// than the current best — visualize candidates ranked by the selected metric
// so "top N" means "the N best-scoring points this search has seen".
const rankAnalysisCandidates = <T extends { winRate?: number; score?: number }>(list: T[], metric: AnalysisCandidateMetric): T[] => {
  if (metric === "winRate") return [...list].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
  if (metric === "score") return [...list].sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY));
  return list;
};
type AiEngineChoice = "light" | "strong" | "tuned";
const AI_ENGINE_CHOICE_KEY = "banbu-ai-engine-choice-v1";
const loadAiEngineChoice = (): AiEngineChoice => {
  try {
    const stored = localStorage.getItem(AI_ENGINE_CHOICE_KEY);
    // T49 期间短暂存在过 "experiment" 档，SIMD 构建并入强力后迁移。
    if (stored === "light" || stored === "strong" || stored === "tuned") return stored;
    if (stored === "experiment") {
      try { localStorage.setItem(AI_ENGINE_CHOICE_KEY, "strong"); } catch { /* best-effort */ }
      return "strong";
    }
  } catch { /* settings fall back to the default below */ }
  return "light";
};
// 档位 → worker 引擎模式 / 常驻槽键。强力 = full 构建（250615 官方 release 的
// 官方 wasm-multi-simd128 配置，T49 起随包分发；构建名含 multi 但为单线程 SIMD，
// 多线程档已移除——App 内 blob MIME 与 WebView 无 COI 双重阻塞，从未生效）。
const engineVariantFor = (choice: AiEngineChoice, packUrl: string | null): "light" | "full" =>
  choice === "light" || !packUrl ? "light" : "full";
const engineSlotKeyFor = (choice: AiEngineChoice, packUrl: string | null): string => {
  const variant = engineVariantFor(choice, packUrl);
  return variant === "light" ? "light" : `${variant}:${packUrl || ""}`;
};
const engineNeedsPack = (choice: AiEngineChoice) => choice === "strong" || choice === "tuned";
// 内存档语义（用户 09-13）：强力 = 固定 128MB（09-12 实测 TT 64-128MB 为速度
// 甜点，256MB 反而慢 29%——大表缓存失配）；自调 = 滑杆值按设备内存钳制
// （256/512/1024/2048 四档上限，防 2048 在手机上分配失败退出）；轻量不需要
// 内存档（worker 自动分档）。人机对战同用此 helper。
const engineMemoryMbFor = (choice: AiEngineChoice, sliderMb: number): number | undefined => {
  if (choice === "light") return undefined;
  const ram = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cap = ram <= 2 ? 256 : ram <= 4 ? 512 : ram <= 8 ? 1024 : 2048;
  return choice === "strong" ? Math.min(128, cap) : Math.min(Math.round(sliderMb) || 256, cap);
};
/** 只读图片的像素尺寸（不参与识别）。相册选择器与聊天软件会转码或缩放，「手机
 *  到底交了多少像素」是排查「同一张图设备间结果不同」的第一手数据：实测同一张
 *  931² 的谱图重压到 q0.6 会丢全部序号、缩到 500px 以下会开始掉子，而 1600px
 *  长边以上又会被识别器自己缩放。失败时返回空串，识别本身照常进行。 */
const describeImageSize = async (file: File): Promise<string> => {
  try {
    const bitmap = await createImageBitmap(file);
    const size = `${bitmap.width}×${bitmap.height}`;
    bitmap.close();
    return size;
  } catch {
    return "";
  }
};

interface PuzzleSetupWorkspace { session: PuzzleSetupSession; sourceOutcome: "won" | "lost" | "stopped" | null }
// 难度档时长（用户 2026-09-10 钦定）：初级 0.6s / 中级 2s / 高级 5s / 大师 10s。
const AI_STRENGTH_OPTIONS: Array<{ value: AiStrength; title: string; text: string }> = [
  { value: "初级", title: "初级", text: "约 0.6 秒/步" },
  { value: "中级", title: "中级", text: "约 2 秒/步" },
  { value: "高级", title: "高级", text: "约 5 秒/步" },
  { value: "大师", title: "大师", text: "约 10 秒/步" },
  { value: "自由", title: "自由", text: "自定义思考时间与搜索深度" },
];
const AI_STRENGTH_PROFILES: Record<Exclude<AiStrength, "自由">, { timeMs: number; maxDepth: number }> = {
  初级: { timeMs: 600, maxDepth: 32 },
  中级: { timeMs: 2000, maxDepth: 48 },
  高级: { timeMs: 5000, maxDepth: 64 },
  大师: { timeMs: 10000, maxDepth: 96 },
};
const PUZZLE_FAST_THINK_TIME_MS = 600;
// 做题「分析」的思考预算：算到杀立刻落子（stopOnProvenWin），否则最多等这个时长
// （用户 09-10 反馈：10 秒太久，控制在数秒内）。
// 提示模式（打谱/做题共用）的思考预算：有界 10s，引擎宣告杀棋立刻落子
// （用户 09-10：不要掐算力，最多十秒可以，只要算到答案马上落子；做题的
// 引擎跟随设置——选强力就用强力，配合启动预热避免现场冷加载）。
const PUZZLE_HINT_THINK_TIME_MS = 10000;
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
const loadDisplaySettings = () => {
  const positive = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  try {
    const value = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY) || "null") as Partial<{ showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean; showLastMove: boolean; moveNumberScale: number; gridLineWidth: number; coordinateFontSize: number }> | null;
    return { showNumbers: value?.showNumbers !== false, showCoordinates: value?.showCoordinates !== false, showForbidden: value?.showForbidden !== false, showLastMove: value?.showLastMove !== false, moveNumberScale: positive(value?.moveNumberScale, 1), gridLineWidth: positive(value?.gridLineWidth, 1.25), coordinateFontSize: migrateCoordinateFontSize(value?.coordinateFontSize) };
  } catch {
    return { showNumbers: true, showCoordinates: true, showForbidden: true, showLastMove: true, moveNumberScale: 1, gridLineWidth: 1.25, coordinateFontSize: DEFAULT_COORDINATE_FONT_SIZE };
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

/** Merge a review-mode local overlay into the node's own marks: the local layer
 * wins on points it covers, everything else keeps its order. */
const mergeNodeMarksWithLocal = (nodeMarks: BoardMark[], localMarks: BoardMark[]): BoardMark[] => {
  if (!localMarks.length) return nodeMarks;
  const localKeys = new Set(localMarks.map((mark) => `${mark.row},${mark.col}`));
  return [...nodeMarks.filter((mark) => !localKeys.has(`${mark.row},${mark.col}`)), ...localMarks];
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
// 分析头部自绘下拉：dock 面板整链是 overflow:hidden（.context-dock），容器内绝对
// 定位的弹层无论向上还是向下展开都可能被裁掉——所以菜单走 createPortal + fixed，
// 彻底脱离裁切链；打开时锚定触发框（向上弹、贴顶翻转、横向夹进视口），滚动即关。
function PanelSelect({ label, value, options, onChange, ariaLabel }: { label?: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnScroll = () => setOpen(false);
    // Esc 关闭：对齐站内浮层惯例（BottomSheet/QuickDrawer 均支持键盘退出）。
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); document.removeEventListener("keydown", closeOnEscape); window.removeEventListener("scroll", closeOnScroll, true); window.removeEventListener("resize", closeOnScroll); };
  }, [open]);
  const selected = options.find(([optionValue]) => optionValue === value);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    setAnchor({ left: box.left, top: box.top, width: box.width, bottom: box.bottom });
    setOpen(true);
    // 面板 dock-reveal 入场动画（160ms transform）期间首帧 rect 是动画起点——
    // 动画结束后再校正一次锚点，杜绝菜单弹到屏幕外。
    window.setTimeout(() => {
      const settled = rootRef.current?.getBoundingClientRect();
      if (settled) setAnchor({ left: settled.left, top: settled.top, width: settled.width, bottom: settled.bottom });
    }, 240);
  };
  const menuWidth = Math.max(anchor?.width ?? 0, 96);
  const menuLeft = Math.min(Math.max(8, anchor?.left ?? 8), Math.max(8, window.innerWidth - menuWidth - 8));
  // 上方空间够就向上弹，不够（例如面板贴到视口上沿时）翻到下方。
  const menuEstimate = options.length * 32 + 12;
  const dropDown = !!anchor && anchor.top < menuEstimate + 16;
  return <div className="panel-select" ref={rootRef}>
    {label && <small>{label}</small>}
    <button type="button" className="panel-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>{selected?.[1] ?? value}<i aria-hidden="true">▾</i></button>
    {open && anchor && createPortal(<div ref={menuRef} className="panel-select-menu" data-drop={dropDown ? "down" : "up"} role="listbox" aria-label={ariaLabel} style={{ left: menuLeft, top: dropDown ? anchor.bottom + 6 : anchor.top - 6, width: menuWidth }}>{options.map(([optionValue, optionLabel]) => <button key={optionValue} type="button" role="option" aria-selected={optionValue === value} className={optionValue === value ? "selected" : ""} onClick={() => { setOpen(false); if (optionValue !== value) onChange(optionValue); }}>{optionLabel}</button>)}</div>, document.body)}
  </div>;
}

const analysisMetricText = (candidate: AiAnalysisCandidate, metric: AnalysisCandidateMetric, decimals = 0) => {
  // decimals 只作用于胜率与评估分（用户 09-11）；深度/计算量是计数，无小数语义。
  if (metric === "winRate") return candidate.winRate === undefined ? "—" : `${(candidate.winRate * 100).toFixed(decimals)}%`;
  if (metric === "score") return candidate.score === undefined ? "—" : `${candidate.score > 0 ? "+" : ""}${candidate.score.toFixed(decimals)}`;
  if (metric === "nodes") {
    if (!candidate.nodes) return "—";
    if (candidate.nodes >= 1_000_000) return `${(candidate.nodes / 1_000_000).toFixed(1)}M`;
    if (candidate.nodes >= 1_000) return `${(candidate.nodes / 1_000).toFixed(1)}K`;
    return candidate.nodes.toLocaleString();
  }
  return candidate.depth ? `${candidate.depth}` : "—";
};

const analysisCandidateTone = (candidate: AiAnalysisCandidate, metric: AnalysisCandidateMetric = "winRate") => {
  // 深度/计算量是中性工程指标，不套胜负语义色（用户 09-10：切深度/计算量
  // 显示时低值点一片红）。只有胜负类指标才分档：高=深蓝、中=绿、低=红。
  if (metric === "depth" || metric === "nodes") return "neutral";
  if (candidate.winRate !== undefined) return candidate.winRate >= .67 ? "high" : candidate.winRate <= .33 ? "low" : "mid";
  if (candidate.score !== undefined) return candidate.score >= 120 ? "high" : candidate.score <= -120 ? "low" : "mid";
  return "mid";
};

const Board = memo(function Board({ document, currentId, currentBookmarked = false, showNumbers, showCoordinates, showLastMove = true, moveNumberScale = 1, gridLineWidth = 1.25, coordinateFontSize = DEFAULT_COORDINATE_FONT_SIZE, largeBoard, rotation, mirrored, initialDepth = 0, disabled = false, forbiddenMarkers = [], winningLines = [], openingCandidates = [], analysisCandidates = [], analysisCandidateMetric = "winRate", analysisCandidateDecimals = 0, analysisPreviewLine = [], analysisPreviewMove = null, analysisPreviewGuide = false, openingStage, thinking = false, thinkingIndicatorPosition = "corner", onStopThinking, motion, feedback, result, boardTheme = "wood", stoneTheme = "classic", boardOpacity = 1, stoneOpacity = 1, annotationHighlight = "none", gestureZoomEnabled = false, gestureSwipeEnabled = false, onPlay, onVariation, onMark, onGestureStep }: {
  document: GameDocument; currentId: string; showNumbers: boolean; showCoordinates: boolean; showLastMove?: boolean; moveNumberScale?: number; gridLineWidth?: number; coordinateFontSize?: number; largeBoard: boolean;
  currentBookmarked?: boolean;
  rotation: BoardRotation; mirrored: boolean;
  initialDepth?: number; disabled?: boolean;
  boardTheme?: BoardTheme; stoneTheme?: StoneTheme; boardOpacity?: number; stoneOpacity?: number; annotationHighlight?: AnnotationHighlight;
  forbiddenMarkers?: Array<Position & { reason: string }>;
  winningLines?: Position[][];
  openingCandidates?: Position[];
  analysisCandidates?: AiAnalysisCandidate[];
  analysisCandidateMetric?: AnalysisCandidateMetric;
  analysisPreviewLine?: Array<Position & { player: Player }>;
  analysisPreviewMove?: Position | null;
  // 候选点胜率/评估分的小数位数（0-2），只影响圆标与面板文本。
  analysisCandidateDecimals?: number;
  // 候选变化预览是否画出各手之间的连线；默认关闭（带序号的预览棋子已足够表达变化图）。
  analysisPreviewGuide?: boolean;
  openingStage?: OpeningStage;
  thinking?: boolean;
  thinkingIndicatorPosition?: "corner" | "below";
  onStopThinking?: () => void;
  gestureZoomEnabled?: boolean; gestureSwipeEnabled?: boolean;
  motion?: BoardMotionState;
  feedback?: BoardFeedbackState | null;
  result?: BoardResultState | null;
  onPlay: (position: Position) => void; onVariation?: (nodeId: string) => void; onMark: (position: Position) => void;
  onGestureStep?: (direction: -1 | 1) => void;
}) {
  const safeCurrentId = document.nodes[currentId] ? currentId : document.rootId;
  // The result banner stays until the player dismisses it; a new outcome (or a
  // cleared board) brings it back.
  const [resultDismissed, setResultDismissed] = useState(false);
  useEffect(() => { setResultDismissed(false); }, [result?.kind, result?.label]);
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
          <radialGradient id="blackStone-yun" cx="43%" cy="38%" r="65%"><stop offset="0" stopColor="#343a35"/><stop offset=".46" stopColor="#272e29"/><stop offset=".76" stopColor="#18221c"/><stop offset=".9" stopColor="#111a14"/><stop offset="1" stopColor="#3c5140"/></radialGradient>
          <radialGradient id="whiteStone-yun" cx="43%" cy="38%" r="65%"><stop offset="0" stopColor="#f6f4e7"/><stop offset=".46" stopColor="#efedde"/><stop offset=".76" stopColor="#e5e2cd"/><stop offset=".9" stopColor="#d5d2bb"/><stop offset="1" stopColor="#aaa992"/></radialGradient>
          <radialGradient id="blackStone-ink" cx="35%" cy="28%" r="76%"><stop offset="0" stopColor="#6886b1"/><stop offset=".24" stopColor="#355a8b"/><stop offset=".56" stopColor="#173662"/><stop offset=".84" stopColor="#0b203f"/><stop offset="1" stopColor="#06152b"/></radialGradient>
          <radialGradient id="whiteStone-ink" cx="35%" cy="28%" r="76%"><stop offset="0" stopColor="#f9fcff"/><stop offset=".3" stopColor="#e7effc"/><stop offset=".6" stopColor="#c5d5ee"/><stop offset=".84" stopColor="#9bb1d1"/><stop offset="1" stopColor="#637eab"/></radialGradient>
          <radialGradient id="blackStone-porcelain" cx="28%" cy="22%"><stop offset="0" stopColor="#315f91"/><stop offset=".48" stopColor="#123f73"/><stop offset="1" stopColor="#071b36"/></radialGradient>
          <radialGradient id="whiteStone-porcelain" cx="28%" cy="22%"><stop offset="0" stopColor="#fffdf8"/><stop offset=".58" stopColor="#f3f2ea"/><stop offset="1" stopColor="#9fbaca"/></radialGradient>
          <radialGradient id="blackStone-snow" cx="25%" cy="18%"><stop offset="0" stopColor="#d9fbff"/><stop offset=".2" stopColor="#73d7ef"/><stop offset=".52" stopColor="#2479aa"/><stop offset=".8" stopColor="#0d416c"/><stop offset="1" stopColor="#051c38"/></radialGradient>
          <radialGradient id="whiteStone-snow" cx="25%" cy="18%"><stop offset="0" stopColor="#fff"/><stop offset=".25" stopColor="#e9fbff"/><stop offset=".56" stopColor="#bfe7fa"/><stop offset=".82" stopColor="#83b7da"/><stop offset="1" stopColor="#537da8"/></radialGradient>
          <radialGradient id="blackStone-blackgold" cx="27%" cy="20%"><stop offset="0" stopColor="#6f6a5d"/><stop offset=".25" stopColor="#25231f"/><stop offset=".67" stopColor="#090909"/><stop offset="1" stopColor="#010101"/></radialGradient>
          <radialGradient id="whiteStone-blackgold" cx="30%" cy="24%"><stop offset="0" stopColor="#fff9d9"/><stop offset=".24" stopColor="#f4df9a"/><stop offset=".58" stopColor="#d8b45f"/><stop offset=".84" stopColor="#bd8e35"/><stop offset="1" stopColor="#96651d"/></radialGradient>
          <radialGradient id="blackStone-pale" cx="32%" cy="26%" r="78%"><stop offset="0" stopColor="#bfc3c8"/><stop offset=".2" stopColor="#777c86"/><stop offset=".48" stopColor="#41434b"/><stop offset=".7" stopColor="#555650"/><stop offset=".86" stopColor="#292d34"/><stop offset="1" stopColor="#91969d"/></radialGradient>
          <radialGradient id="whiteStone-pale" cx="32%" cy="26%" r="78%"><stop offset="0" stopColor="#fff"/><stop offset=".28" stopColor="#f8f9fc"/><stop offset=".52" stopColor="#e2e3e8"/><stop offset=".7" stopColor="#eceae4"/><stop offset=".86" stopColor="#adb4bd"/><stop offset="1" stopColor="#f5f6f8"/></radialGradient>
          <radialGradient id="blackStone-kawaii" cx="35%" cy="28%" r="75%"><stop stopColor="#eeb0cf"/><stop offset=".35" stopColor="#bc628e"/><stop offset=".76" stopColor="#84345e"/><stop offset="1" stopColor="#652341"/></radialGradient>
          <radialGradient id="whiteStone-kawaii" cx="35%" cy="28%" r="75%"><stop stopColor="#fffefa"/><stop offset=".4" stopColor="#e5faf1"/><stop offset=".78" stopColor="#b5dfd2"/><stop offset="1" stopColor="#70aa9a"/></radialGradient>
          <radialGradient id="blackStone-aurora" cx="27%" cy="20%"><stop offset="0" stopColor="#527d86"/><stop offset=".28" stopColor="#173f49"/><stop offset=".68" stopColor="#071e2b"/><stop offset="1" stopColor="#020914"/></radialGradient>
          <radialGradient id="whiteStone-aurora" cx="27%" cy="20%"><stop className="aurora-stone-light" offset="0" stopColor="#f1ffff"/><stop className="aurora-stone-mid" offset=".44" stopColor="#75ead3"/><stop className="aurora-stone-edge" offset=".76" stopColor="#6987e8"/><stop offset="1" stopColor="#443d91"/></radialGradient>
          <linearGradient id="blackGoldBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#1d1a16"/><stop offset=".48" stopColor="#080807"/><stop offset="1" stopColor="#21190f"/></linearGradient>
          <linearGradient id="paleBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset=".2" stopColor="#e9ecf1"/><stop offset=".38" stopColor="#fafafa"/><stop offset=".57" stopColor="#e5e3e6"/><stop offset=".73" stopColor="#f4f3ef"/><stop offset=".9" stopColor="#d6dce2"/><stop offset="1" stopColor="#f8f9fa"/></linearGradient>
          <pattern id="paleStrata" width="572" height="142" patternUnits="userSpaceOnUse"><path d="M0 30 Q140 8 286 38 T572 26 M0 34 Q140 12 286 42 T572 30" fill="none" stroke="#fff" strokeWidth="2" opacity=".45"/><path d="M0 98 Q180 58 330 102 T572 94" fill="none" stroke="#7d8794" strokeWidth=".65" opacity=".13"/></pattern>
          <linearGradient id="kawaiiBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff8f2"/><stop offset=".48" stopColor="#f7dbe9"/><stop offset="1" stopColor="#decdf0"/></linearGradient>
          <linearGradient id="auroraBoard" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#061928"/><stop className="aurora-board-cyan" offset=".36" stopColor="#164e5b"/><stop className="aurora-board-green" offset=".64" stopColor="#236458"/><stop className="aurora-board-violet" offset="1" stopColor="#322b62"/></linearGradient>
           <radialGradient id="blackStone-gold" cx="28%" cy="22%"><stop offset="0" stopColor="#fff0a8"/><stop offset=".42" stopColor="#d59a22"/><stop offset="1" stopColor="#6c3d08"/></radialGradient>
           <radialGradient id="whiteStone-gold" cx="28%" cy="22%"><stop offset="0" stopColor="#fff9d7"/><stop offset=".5" stopColor="#f1c95d"/><stop offset="1" stopColor="#a96813"/></radialGradient>
           <radialGradient id="blackStone-diamond" cx="32%" cy="24%" r="82%"><stop offset="0" stopColor="#c8dce8"/><stop offset=".22" stopColor="#657b8b"/><stop offset=".48" stopColor="#26313e"/><stop offset=".76" stopColor="#0d1520"/><stop offset="1" stopColor="#02060b"/></radialGradient>
           <radialGradient id="whiteStone-diamond" cx="32%" cy="24%" r="82%"><stop offset="0" stopColor="#ffffff"/><stop offset=".3" stopColor="#f8fcff"/><stop offset=".56" stopColor="#e2eaf1"/><stop offset=".8" stopColor="#adbfce"/><stop offset="1" stopColor="#728c9e"/></radialGradient>
           <linearGradient id="goldFacet" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff8bd" stopOpacity=".9"/><stop offset=".3" stopColor="#f8d56b" stopOpacity=".4"/><stop offset=".62" stopColor="#9d5c09" stopOpacity=".48"/><stop offset="1" stopColor="#fff0a0" stopOpacity=".15"/></linearGradient>
           <linearGradient id="diamondFacet" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff" stopOpacity=".8"/><stop offset=".3" stopColor="#8fe7ff" stopOpacity=".28"/><stop offset=".62" stopColor="#194c72" stopOpacity=".5"/><stop offset="1" stopColor="#dffaff" stopOpacity=".2"/></linearGradient>
           <linearGradient id="jewelGlint" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff" stopOpacity=".95"/><stop offset=".35" stopColor="#ffffff" stopOpacity=".22"/><stop offset="1" stopColor="#ffffff" stopOpacity="0"/></linearGradient>
          <linearGradient id="blackStone-mono" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#000"/><stop offset="1" stopColor="#000"/></linearGradient>
          <linearGradient id="whiteStone-mono" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#fff"/></linearGradient>
          <pattern id="notebookPaper" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" fill="#faf5e7"/><path d="M0 47.5H48" stroke="#8eb3c9" strokeWidth=".8" opacity=".28"/></pattern>
          <filter id="notebookBrush" x="-25%" y="-25%" width="150%" height="150%"><feTurbulence type="fractalNoise" baseFrequency=".035 .12" numOctaves="2" seed="7" result="inkNoise"/><feDisplacementMap in="SourceGraphic" in2="inkNoise" scale="1.15" xChannelSelector="R" yChannelSelector="G"/></filter>
          <filter id="stoneShadow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" floodOpacity=".38"/></filter>
          <filter id="yunStoneShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.1" stdDeviation=".85" floodOpacity=".28"/></filter>
          {markHighlightColor && <filter id="annotationHighlightGlow" x="-90%" y="-90%" width="280%" height="280%"><feDropShadow dx="0" dy="0" stdDeviation="1.7" floodColor={markHighlightColor} floodOpacity="1"/><feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={markHighlightColor} floodOpacity=".82"/></filter>}
        </defs>
        <rect x="4" y="4" width="564" height="564" rx="18" className="board-bg" style={{ opacity: boardOpacity }} />
        {boardTheme === "pale" && <rect x="4" y="4" width="564" height="564" rx="18" fill="url(#paleStrata)" opacity={boardOpacity} pointerEvents="none"/>}
        {openingStage?.kind === "place" && openingStage.radius !== null && (() => {
          const center = Math.floor(boardSize / 2), start = center - openingStage.radius, cells = openingStage.radius * 2;
          return <rect x={margin + start * gap - gap / 2} y={margin + start * gap - gap / 2} width={(cells + 1) * gap} height={(cells + 1) * gap} rx="10" className="opening-region" aria-label={`第${openingStage.moveNumber}手允许落子区域`}/>;
        })()}
        {boardTheme === "notebook" && <line x1="57" y1="8" x2="57" y2="564" className="notebook-margin-line" aria-hidden="true"/>}
        {Array.from({ length: boardSize }, (_, index) => <g key={index} className="grid-lines" style={{ strokeWidth: gridLineWidth }}><line x1={margin} y1={margin + index * gap} x2={end} y2={margin + index * gap}/><line x1={margin + index * gap} y1={margin} x2={margin + index * gap} y2={end}/></g>)}
        {starPoints.map(([row, col]) => <circle key={`${row}-${col}`} cx={margin + col * gap} cy={margin + row * gap} r="4.2" className="star"/>)}
        {showCoordinates && Array.from({ length: boardSize }, (_, index) => <g key={`coord-${index}`} className="coordinates"><text style={{ fontSize: coordinateFontSize }} x={margin + index * gap} y="20">{String.fromCharCode(65 + index)}</text><text style={{ fontSize: coordinateFontSize }} x={margin + index * gap} y="560">{String.fromCharCode(65 + index)}</text><text style={{ fontSize: coordinateFontSize }} x="18" y={margin + index * gap + 3}>{boardSize - index}</text><text style={{ fontSize: coordinateFontSize }} x="554" y={margin + index * gap + 3}>{boardSize - index}</text></g>)}
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
           const jewelMaterial = stoneTheme === "gold-diamond" ? (player === "black" ? "diamond" : "gold") : stoneTheme;
           const stoneGradient = jewelMaterial === "classic" ? (player === "black" ? "blackStone" : "whiteStone") : `${player === "black" ? "blackStone" : "whiteStone"}-${jewelMaterial}`;
          const notebookRotation = ((rowIndex * 7 + colIndex * 11) % 9) - 4;
          const stoneGraphic = stoneTheme === "notebook"
            ? <g className={`notebook-stone ${player}`} transform={`translate(${x} ${y}) rotate(${notebookRotation})`} filter="url(#notebookBrush)">
                {player === "black"
                  ? <><path d="M-14-10C-12-13-10-14-8-12C-1-5 6 3 14 10C16 12 14 15 11 14C3 8-5 1-13-7C-15-8-15-9-14-10Z"/><path d="M11-14C14-15 16-12 14-9C8-2 1 5-8 13C-10 15-14 13-13 10C-5 2 3-6 11-14Z"/><path className="notebook-stone-dry" d="M-11-9C-5-3 3 5 11 10M10-11C4-4-3 4-10 11"/></>
                  : <><path d="M-15-2C-16-4-13-6-11-4L-2 5C3-3 8-12 13-17C15-19 18-17 16-13C11-4 6 7 1 14C0 16-3 16-5 13L-15 2C-16 1-16 0-15-2Z"/><path className="notebook-stone-dry" d="M-12-1C-8 3-4 8-1 11C4 2 9-8 14-15"/></>}
              </g>
             : stoneTheme === "terminal"
               ? <g className={`terminal-stone ${player}`}><circle cx={x} cy={y} r="15.6" className="terminal-stone-disc"/></g>
               : stoneTheme === "kawaii"
                 ? <g className={`kawaii-stone ${player}`}>
                     <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className="stone kawaii-stone-disc"/>
                     <path d={`M ${x - 11} ${y - 6} Q ${x - 13} ${y - 16} ${x - 8} ${y - 13} L ${x - 4} ${y - 9} M ${x + 11} ${y - 6} Q ${x + 13} ${y - 16} ${x + 8} ${y - 13} L ${x + 4} ${y - 9}`} className="kawaii-stone-ears"/>
                     {!showNumbers && <><ellipse cx={x - 5.2} cy={y - 1.1} rx="1.55" ry="2.15" className="kawaii-eye"/><ellipse cx={x + 5.2} cy={y - 1.1} rx="1.55" ry="2.15" className="kawaii-eye"/>
                     <path d={`M ${x - 3} ${y + 3} Q ${x - 1.5} ${y + 6} ${x} ${y + 3.5} Q ${x + 1.5} ${y + 6} ${x + 3} ${y + 3}`} className="kawaii-mouth"/></>}
                     <ellipse cx={x - 9} cy={y + 4} rx="2.6" ry="1.25" className="kawaii-blush"/><ellipse cx={x + 9} cy={y + 4} rx="2.6" ry="1.25" className="kawaii-blush"/>
                     <path d={`M ${x - 6} ${y - 11} Q ${x} ${y - 14} ${x + 5} ${y - 11}`} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".65"/>
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
                 ? <g className={`jewel-stone ${player} material-${jewelMaterial}`}>
                     <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className="stone"/>
                     {Array.from({ length: 12 }, (_, facet) => {
                       const a = facet * Math.PI / 6, b = (facet + 1) * Math.PI / 6;
                       const point = (angle: number, radius: number) => `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`;
                       return <polygon key={facet} points={`${point(a, 14.6)} ${point(b, 14.6)} ${point(b, 7.5)} ${point(a, 7.5)}`} fill={facet % 3 === 0 ? "#fff" : facet % 3 === 1 ? (jewelMaterial === "gold" ? "#71450c" : "#233344") : (jewelMaterial === "gold" ? "#fff0ad" : "#d9edfa")} opacity={[.48, .27, .16, .1, .3, .45, .22, .12, .4, .2, .12, .5][facet]}/>;
                     })}
                     <circle cx={x} cy={y} r="7.5" fill="none" stroke={jewelMaterial === "gold" ? "#fff2be" : "#fff"} strokeWidth=".55" opacity=".3"/>
                     <path d={`M ${x - 11} ${y - 8} L ${x - 5} ${y - 12} M ${x + 9} ${y + 7} L ${x + 6} ${y + 11}`} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity=".85"/>
                   </g>
               : <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className={`stone ${player}`}/>;
          const motionClass = isLast && motion?.kind === "place" ? "stone-enter" : "";
           const outlineOpacity = stoneTheme === "notebook" ? 0 : Math.max(0, (1 - stoneOpacity) * .72);
           return <g key={`stone-${rowIndex}-${colIndex}${isLast && motion?.kind ? `-${motion.version}` : ""}`} filter="url(#stoneShadow)" className={`stone-piece ${isWinningStone ? "winning-stone" : ""} ${motionClass}`}><g className="stone-body" transform={`translate(${x} ${y}) scale(${stoneScale}) translate(${-x} ${-y})`} style={{ opacity: stoneOpacity }}>{stoneGraphic}</g>{outlineOpacity > 0 && <circle cx={x} cy={y} r={stoneRadius + .1} className={`stone-visibility-outline ${player}`} style={{ opacity: outlineOpacity }}/>} {isWinningStone && <circle cx={x} cy={y} r={stoneRadius * 1.22} className="winning-stone-ring"/>}{showNumbers && <text x={x} y={y + stoneRadius * .28} className={`move-number ${player}${isLast && showLastMove ? " last-move-number" : ""}`} style={{ fontSize: `${Math.max(8, stoneRadius * .64) * moveNumberScale}px` }}>{number}</text>}{isLast && showLastMove && !showNumbers && !currentHasVisualMark && (stoneTheme === "notebook" ? <path d={`M ${x - stoneRadius * .45} ${y + stoneRadius * 1.08} Q ${x} ${y + stoneRadius * 1.28} ${x + stoneRadius * .52} ${y + stoneRadius * 1.02}`} className="notebook-last-mark"/> : <circle cx={x} cy={y} r={Math.max(3, stoneRadius * .25)} className="last-dot"/>)}{isLast && hasNativeAnnotation(current) && <g className="comment-indicator" aria-label="此步有注释"><path className="comment-bubble-tail" d={`M ${x + stoneRadius * .5} ${y + stoneRadius * .93} L ${x + stoneRadius * .43} ${y + stoneRadius * 1.15} L ${x + stoneRadius * .7} ${y + stoneRadius * .93} Z`}/><rect className="comment-bubble" x={x + stoneRadius * .33} y={y + stoneRadius * .48} width={stoneRadius * .74} height={stoneRadius * .48} rx={stoneRadius * .15}/><circle className="comment-dot" cx={x + stoneRadius * .52} cy={y + stoneRadius * .72} r={stoneRadius * .07}/><circle className="comment-dot" cx={x + stoneRadius * .7} cy={y + stoneRadius * .72} r={stoneRadius * .07}/><circle className="comment-dot" cx={x + stoneRadius * .88} cy={y + stoneRadius * .72} r={stoneRadius * .07}/></g>}{isLast && currentBookmarked && <g className="bookmark-indicator" aria-label="此局面已保存分支书签"><path d={`M ${x - stoneRadius} ${y - stoneRadius} h ${stoneRadius * .67} v ${stoneRadius * .8} l -${stoneRadius * .33} -${stoneRadius * .2} -${stoneRadius * .33} ${stoneRadius * .2} z`}/></g>}</g>;
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
         {analysisCandidates.filter((candidate, index, all) => !board[candidate.move.row]?.[candidate.move.col] && all.findIndex((item) => item.move.row === candidate.move.row && item.move.col === candidate.move.col) === index).map((candidate, index) => {
           const { x, y } = visualXY(candidate.move);
           // 正在显示变化预览时不叠胜率等指标文本：候选点圆盘会被带序号的预览棋子覆盖，
           // 数字夹在中间反而互相干扰（用户 09-11：预览时不显示指标，圆盘点一下即见）。
           const showMetric = analysisPreviewLine.length === 0;
           // 胜率圆标不带 %（面板带 %）；两者都按小数位设置显示（0-2 位）。
           const candidateLabel = analysisCandidateMetric === "winRate" && candidate.winRate !== undefined
             ? (Math.max(0, Math.min(1, candidate.winRate)) * 100).toFixed(analysisCandidateDecimals)
             : analysisMetricText(candidate, analysisCandidateMetric, analysisCandidateDecimals);
           const candidateSelected = !!analysisPreviewMove && analysisPreviewMove.row === candidate.move.row && analysisPreviewMove.col === candidate.move.col;
          return <g key={`analysis-candidate-${candidate.move.row}-${candidate.move.col}`} className={`analysis-candidate-point ${analysisCandidateTone(candidate, analysisCandidateMetric)} ${candidateSelected ? "candidate-active" : ""}`} aria-label={`AI 候选 ${index + 1} ${coordinateName(candidate.move, boardSize)} ${analysisMetricText(candidate, analysisCandidateMetric, analysisCandidateDecimals)}`}><circle cx={x} cy={y} r={stoneRadius}/>{showMetric && <text x={x} y={y} dy=".35em" style={{ fontSize: Math.min(stoneRadius * 1.4, stoneRadius * 3 / Math.max(2, candidateLabel.length)) }}>{candidateLabel}</text>}</g>;
         })}
         {analysisPreviewLine.length > 0 && (() => {
           const projected = analysisPreviewLine.map((point, index) => ({ point, index })).filter(({ point }) => !board[point.row]?.[point.col] && !openingCandidates.some((candidate) => candidate.row === point.row && candidate.col === point.col));
          return <g className="analysis-preview-line" aria-label={`候选变化预览，${projected.length} 手`}>
            {analysisPreviewGuide && projected.map((entry, position) => position === 0 ? null : (() => { const from = visualXY(projected[position - 1].point); const to = visualXY(entry.point); return <line key={`pv-link-${position}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}/>; })())}
            {projected.map((entry) => {
              const { x, y } = visualXY(entry.point);
             return <g key={`pv-${entry.index}`} className={`analysis-preview-stone ${entry.point.player}`}><circle cx={x} cy={y} r={stoneRadius * .78}/><text x={x} y={y} dy=".35em" style={{ fontSize: Math.max(8, stoneRadius * .62) }}>{entry.index + 1}</text></g>;
            })}
          </g>;
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
           const textLength = Array.from(label).length;
           // 用户标注默认与原生标注同一视觉规格：粗大、居中（用户 09-10：默认像原生标注一样更粗更大）。
           const labelClass = `renlib-variation-label renlib-native-label ${textLength <= 1 ? "renlib-text-single" : textLength === 2 ? "renlib-text-double" : "renlib-text-compact"}`;
           const markLabel = label ? <text x={x} y={y} className={labelClass} fill={color}>{label}</text> : null;
           if (style === "text") return <text key={index} x={x} y={y} className={labelClass} fill={color}>{label || "?"}</text>;
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
            const forbiddenReasonText = forbiddenByPoint.get(`${row},${col}`);
            const forbiddenGlyph = forbiddenReasonText ? (forbiddenReasonText.includes("三三") ? "三" : forbiddenReasonText.includes("四四") ? "四" : "长") : null;
            return <g key={`cell-${row}-${col}`}>
             {forbiddenGlyph && !board[row][col] && <g pointerEvents="none"><circle cx={x} cy={y} r={stoneRadius * 0.66} className="forbidden-point" fill="none"/><text x={x} y={y + stoneRadius * 0.2} textAnchor="middle" className="forbidden-point-label" style={{ fontSize: `${Math.max(9, stoneRadius * 0.5)}px`, fill: "var(--red)", fontWeight: 700 }} stroke="none">{forbiddenGlyph}</text></g>}
             <circle key={`hit-${row}-${col}`} cx={x} cy={y} r={Math.max(14, stoneRadius * 1.14)} className="board-hit" role="gridcell" aria-disabled={disabled} aria-label={variation ? `切换到变化 ${coordinateName(point, boardSize)}` : `${coordinateName(point, boardSize)}${board[row][col] ? "已有棋子" : forbiddenByPoint.get(`${row},${col}`) || "空位"}`} onPointerDown={(event) => { if (disabled || isTouchGestureBlocked()) return; longPressTimer.current = window.setTimeout(() => { if (isTouchGestureBlocked()) return; suppressedClickPoint.current = point; onMark(point); }, 520); }} onPointerUp={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerCancel={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onClick={() => { if (disabled || isTouchGestureBlocked()) return; if (suppressedClickPoint.current?.row === row && suppressedClickPoint.current.col === col) { suppressedClickPoint.current = null; return; } suppressedClickPoint.current = null; if (variation && onVariation) onVariation(variation.id); else onPlay(point); }} onContextMenu={(event) => { event.preventDefault(); if (!disabled) onMark(point); }}/>
            </g>;
          }))}
       </svg>
      {thinking && <button type="button" className={`board-thinking-indicator ${thinkingIndicatorPosition}`} onClick={onStopThinking} role="status" aria-live="polite" aria-label="停止思考" title="点击停止思考"><span className="thinking-swap" aria-hidden="true"><i className="s-black"/><i className="s-white"/></span><span>思考中</span></button>}
      {result && !resultDismissed && <div className={`game-result-banner ${result.kind}`} role="status" aria-live="polite"><span>{result.kind === "draw" ? "和" : result.kind === "lost" ? "负" : "胜"}</span><b>{result.label}</b><button type="button" className="game-result-dismiss" onClick={() => setResultDismissed(true)} aria-label="关闭结果提示" title="关闭"><X/></button></div>}
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
  const [tourOpen, setTourOpen] = useState(false);
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
  // 当前题会话是否已记录过一次尝试（用户 2026-09-10：点开一题落子即进「最近棋题」；
  // 同题会话只记一次，避免每次落子都 +1；openPuzzle 时重置）。
  const puzzleAttemptRecordedRef = useRef(false);
  const [puzzleCollectionIndex, setPuzzleCollectionIndex] = useState(0);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [puzzleInitialId, setPuzzleInitialId] = useState("");
  const [puzzleInitialDepth, setPuzzleInitialDepth] = useState(0);
  const [puzzleRulePreference, setPuzzleRulePreference] = useState<PuzzleRuleMode>(loadPuzzleRulePreference);
  const [aiThinking, setAiThinking] = useState(false);
  const [puzzleOutcome, setPuzzleOutcome] = useState<"won" | "lost" | "stopped" | null>(null);
  const [puzzleSetup, setPuzzleSetup] = useState<PuzzleSetupWorkspace | null>(null);
  // 做题「换边」：应战里把黑白切换搬到了状态条（首行之上右侧，用户 09-10 反馈）。
  // 切到另一色=本回合由你执另一色（陪练执原色）；重启/换题/切规则时归 null 回题目默认。
  const [puzzleSideOverride, setPuzzleSideOverride] = useState<Player | null>(null);
  const [aiGame, setAiGame] = useState<AiGameState | null>(null);
  const [aiRuleFamily, setAiRuleFamily] = useState<AiRuleMode>("freestyle");
  const [aiHumanPlayer, setAiHumanPlayer] = useState<Player>("black");
  const [aiStrength, setAiStrength] = useState<AiStrength>("初级");
  const [aiEngineChoice, setAiEngineChoice] = useState<AiEngineChoice>(loadAiEngineChoice);
  // 引擎包下载意图：未装包时点「强力/自调」触发下载，下载完成的自动切档
  // 必须遵循用户点击的档位（否则选自调会被劫持成强力）。
  const engineDownloadIntentRef = useRef<"strong" | "tuned" | null>(null);
  // 自调内存输入框（非受控，读 DOM 提交；滑杆拖动用 ref 同步显示）。
  const memoryNumberRef = useRef<HTMLInputElement | null>(null);
  const [enginePackState, setEnginePackState] = useState<EnginePackState | null>(() => enginePackSnapshot().state);
  const [enginePackReady, setEnginePackReady] = useState(() => Boolean(enginePackSnapshot().objectUrl));
  const [enginePackDownloading, setEnginePackDownloading] = useState(false);
  // 人机界面这条入口以前不接进度回调，只有一句静态文字：47MB 的包下几分钟，
  // 用户完全看不出是在走还是卡住。改成和设置页一样吃 DownloadProgress。
  const [aiPackProgress, setAiPackProgress] = useState<{ receivedBytes: number; totalBytes: number } | null>(null);
  const [aiTimeLimitMs, setAiTimeLimitMs] = useState<AiTimeControl>(0);
  const [aiHumanElapsedMs, setAiHumanElapsedMs] = useState(0);
  const [aiFreeTimeMs, setAiFreeTimeMs] = useState(2500);
  const [aiFreeDepth, setAiFreeDepth] = useState(64);
  const [aiFreeUnlimited, setAiFreeUnlimited] = useState(false);
  const [aiOpeningRule, setAiOpeningRule] = useState<OpeningRule>("free");
  const [aiFloatPanel, setAiFloatPanel] = useState<AiFloatPanel>(null);
  const [aiOpeningN] = useState(3);
  const [dockPanel, setDockPanel] = useState<DockPanel>(null);
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);
  const [library, setLibrary] = useState(loadLibrary);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySection, setLibrarySection] = useState<LibrarySection>("records");
  const [recordFilter, setRecordFilter] = useState<RecordLibraryFilter>("all");
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolders>(loadLibraryFolders);
  const [favorites, setFavorites] = useState<LibraryFavorites>(loadFavorites);
  useEffect(() => { saveFavorites(favorites); }, [favorites]);
  // 分支书签入口（棋谱库）：展开的棋谱 id 集合（用于在书签文件夹里逐谱展开书签列表）。
  const [expandedBookmarkRecords, setExpandedBookmarkRecords] = useState<Set<string>>(new Set());
  // 分支书签管理：正在重命名的书签 id + 输入草稿。
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [guideTour, setGuideTour] = useState<{ index: number; steps: TourStep[] } | null>(null);
  const [manualFocusSection, setManualFocusSection] = useState<number | null>(null);
  const [bookmarkTitleDraft, setBookmarkTitleDraft] = useState("");
  const isRecordFavorite = (id: string) => _isRecordFavorite(favorites, id);
  const isCollectionFavorite = (id: string) => favorites.puzzleCollections.includes(id);
  const isPuzzleFavorite = (collectionId: string, puzzleId: string) => Boolean(favorites.puzzles[collectionId]?.includes(puzzleId));
  const toggleRecordFav = (id: string) => setFavorites((current) => toggleRecordFavorite(current, id));
  const toggleCollectionFav = (id: string) => setFavorites((current) => toggleCollectionFavorite(current, id));
  const togglePuzzleFav = (collectionId: string, puzzleId: string) => setFavorites((current) => togglePuzzleFavorite(current, collectionId, puzzleId));
  const [branchBookmarks, setBranchBookmarks] = useState<RecordBookmarks>(loadRecordBookmarks);
  const [expandedLibraryFolders, setExpandedLibraryFolders] = useState<Set<string>>(() => new Set([libraryFolders.recordFolders[0] || ""]));
  const [managedPuzzleCollectionId, setManagedPuzzleCollectionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("record");
  const [fontScale, setFontScale] = useState<FontScale>(loadFontScale);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [batchEditMode, setBatchEditMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [puzzleBatchMode, setPuzzleBatchMode] = useState(false);
  const [puzzleBatchSelectedIds, setPuzzleBatchSelectedIds] = useState<string[]>([]);
  const [batchReplaceFrom, setBatchReplaceFrom] = useState("");
  const [batchReplaceTo, setBatchReplaceTo] = useState("");
  const [quickDrawerOpen, setQuickDrawerOpen] = useState(false);
  const [actionLayouts, setActionLayouts] = useState(loadActionLayouts);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  // 手册目录引导期间功能区按出厂默认布局渲染（用户自定义过布局也不影响定位）
  const actionLayout = guideTour ? defaultModeLayout(mode) : visibleModeLayout(actionLayouts.modes[mode]);
  const openLayoutEditor = () => setLayoutEditorOpen(true);
  const applyActionLayout = (value: ActionLayouts) => {
    if (!saveActionLayouts(value)) return false;
    setActionLayouts(value); setLayoutEditorOpen(false);
    setAnnotationPopover(null);
    if (dockPanel && value.modes[mode].hidden.includes(dockPanel as ActionId)) setDockPanel(null);
    if (value.modes[mode].hidden.includes("comment")) setCommentExpanded(false);
    return true;
  };
  const [updateAutoCheck, setUpdateAutoCheck] = useState(loadUpdateAutoCheck);
  const [latestUpdate, setLatestUpdate] = useState<LatestRelease | null>(null);
  const [updatePrompt, setUpdatePrompt] = useState<LatestRelease | null>(null);
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
  const [showLastMove, setShowLastMove] = useState(() => loadDisplaySettings().showLastMove);
  const [moveNumberScale, setMoveNumberScale] = useState(() => loadDisplaySettings().moveNumberScale);
  const [gridLineWidth, setGridLineWidth] = useState(() => loadDisplaySettings().gridLineWidth);
  const [coordinateFontSize, setCoordinateFontSize] = useState(() => loadDisplaySettings().coordinateFontSize);
  const [largeBoard, setLargeBoard] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [mirrored, setMirrored] = useState(false);
  const [annotationType, setAnnotationType] = useState<AnnotationMarkType>("number");
  const [annotationValue, setAnnotationValue] = useState("1");
  const [annotationPopover, setAnnotationPopover] = useState<"style" | "color" | "type" | "value" | null>(null);
  useEffect(() => {
    const closeTool = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || sheet || quickDrawerOpen || layoutEditorOpen) return;
      if (annotationPopover) setAnnotationPopover(null);
      else if (dockPanel) setDockPanel(null);
    };
    window.addEventListener("keydown", closeTool);
    return () => window.removeEventListener("keydown", closeTool);
  }, [sheet, quickDrawerOpen, layoutEditorOpen, annotationPopover, dockPanel]);
  const [annotationStyle, setAnnotationStyle] = useState<BoardMarkStyle>("text");
  const [annotationColor, setAnnotationColor] = useState("#1d1c19");
  // 去标注（擦除）模式：标注面板里的独立状态——点棋盘已有标注=擦除，点空位无动作；退出按钮/再点按钮/关面板均退出。
  const [annotationErase, setAnnotationErase] = useState(false);
  // 去子模式（2026-09-11 用户需求）：编辑面板进入，点棋盘上任意现存棋子直接删除；
  // 对带手序/分支的棋谱，首次删除会把局面拍平为静态 setup（无分支无手序），
  // 专为图片导入后多子/少子的修正场景。退出按钮在状态栏右侧（与去标注一致）。
  const [eraseStone, setEraseStone] = useState(false);
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
  const [imageImportPreview, setImageImportPreview] = useState<{ file: File; url: string; name: string } | null>(null);
  const [restoreMoveOrder, setRestoreMoveOrder] = useState(false);
  const [placementPlayer, setPlacementPlayer] = useState<"black" | "white">("black");
  const [placementLocked, setPlacementLocked] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [saveDestination, setSaveDestination] = useState<"records" | "puzzles">("records");
  const [saveFolder, setSaveFolder] = useState("未分类");
  const [defaultDirectory, setDefaultDirectory] = useState<ExportDirectoryHandle | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
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
  const [commentExpanded, setCommentExpanded] = useState(false);
  const [commentPreviewExpanded, setCommentPreviewExpanded] = useState(false);
  useEffect(() => { setCommentExpanded(false); setCommentPreviewExpanded(false); }, [mode]);
  const [toast, setToast] = useState("");
  const [recentImports, setRecentImports] = useState<RecentImportEntry[]>([]);
  const [coachMark, setCoachMark] = useState<CoachMarkId | null>(null);
  const coachMarkTimer = useRef<number | null>(null);
  const [saved, setSaved] = useState(true);
  const [thinkRunning, setThinkRunning] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisState>({ status: "idle", engine: "light", depth: 0, nodes: 0, contextKey: "" });
  // Which analysis candidate the user tapped for a variation preview. We only
  // remember the point; the line itself is resolved from the LIVE candidate
  // list each render, so the preview deepens along with the ongoing search.
  const [analysisPreview, setAnalysisPreview] = useState<{ contextKey: string; row: number; col: number } | null>(null);
  const aiAnalysisEngineRef = useRef<AiAnalysisEngine>("light");
  const [boardMotion, setBoardMotion] = useState<BoardMotionState>({ kind: null, version: 0 });
  const [boardFeedback, setBoardFeedback] = useState<BoardFeedbackState | null>(null);
  // 跨谱局面检索（「更多」面板 → 跨谱查找）里的「包含旋转与镜像」开关。
  const [matchSymmetry, setMatchSymmetry] = useState(true);
  const singleFileInput = useRef<HTMLInputElement>(null);
  const puzzleFileInput = useRef<HTMLInputElement>(null);
  const imageFileInput = useRef<HTMLInputElement>(null);
  const backupFileInput = useRef<HTMLInputElement>(null);
  const backgroundFileInput = useRef<HTMLInputElement>(null);
  const importProgressId = useRef(0);
  const importProgressTimer = useRef<number | null>(null);
  const taskManager = useRef(new TaskManager());
  const rapfiPersistentWorker = useRef<{ worker: Worker; key: string } | null>(null);
  // 分析轮双 worker 乒乓（T47，用户 09-11「底层架构」）：WASM 同步搜索阻塞
  // worker 事件循环，落子/换手时新轮只能等旧轮跑满预算才开始（cancel 消息也
  // 排队）——轻量引擎双开（~5MB/个），落子后立即在空闲 slot 上开始真计算，
  // 候选 1s 内出现且是新搜索结果（非继承旧路线）；滚动续算仍在同一 slot
  // （TT 继承）。slot.running 标记物理忙（cancel 不清，等旧轮 accept 自然收尾）。
  // 强力引擎（40MB heap）单 worker，继续走 rapfiPersistentWorker。
  const analysisPersistent = useRef<Array<{ worker: Worker; key: string; controller: AiWorkerController; running: boolean } | null>>([null, null]);
  // 最近一次分析用的 slot（滚动续算同 slot 保 TT；换手优先用另一已加载 slot，
  // 避免 terminate 重建的 slot 还在 warmup 时被选中而冷等待）。
  const lastAnalysisSlot = useRef(0);
  const aiWorkerController = useRef(new AiWorkerController((discarded) => {
    // The controller terminates a persistent engine on unconditional-cancel
    // paths (or when the local fallback replaces it); drop the warm slot then.
    if (rapfiPersistentWorker.current?.worker === discarded) rapfiPersistentWorker.current = null;
  }));
  const nativeSourceFile = useRef<File | null>(null);
  const vcfGenWorker = useRef<Worker | null>(null);
  const puzzleAiWorker = useRef<Worker | null>(null);
  const thinkWorker = useRef<Worker | null>(null);
  const rapfiThinkWorker = useRef<Worker | null>(null);
  const rapfiGameWorker = useRef<Worker | null>(null);
  // 对局思考的实时快照（T29）：WASM 同步搜索不让出 worker 事件循环，用户点
  // 「强制停止」时 worker 端可能根本还没处理 stop——所以 app 侧持续记录
  // progress 流里的当前最强点，停止即用它直接落子。
  const gameThinkLive = useRef<{ requestId: string; onMove: (move: Position) => void; best: Position | null } | null>(null);
  // 提示/自对弈回合的 PV0 快照（progress 一更）：点「停止」时先落当前最强点——与
  // T29 人机对局同一语义，否则提示模式点停止会直接掐掉这一回合（用户 09-10 反馈）。
  const analysisThinkLive = useRef<{ requestId: string; best: Position | null } | null>(null);
  const enginePackUrlRef = useRef<string | null>(null);
  const enginePackStateRef = useRef<EnginePackState | null>(enginePackSnapshot().state);
  const thinkGeneration = useRef(0);
  const autoAnalysisKey = useRef("");
  // 持续分析轮预算递增：换面后第 1 轮 2s（候选快出），同面每轮 +2s 封顶 20s——
  // 「长时间分析选越来越明确的强点」由预算增长兑现（09-12 实测每轮 2s 在手机大
  // NNUE 上深度爬升吃不到 TT 热迭代）。换面/关开关重置。
  const analysisRoundRef = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  // 内存档失败降级重试：1024/2048 高档在手机上分配失败引擎退出 → 先降至 256MB
  // 重试一次强力，仍失败才换轻量（09-12 用户反馈「自设拉满后节点显示永久冻结」）。
  const engineMemoryRetryRef = useRef<number | null>(null);
  // 人机/陪练路径的内存降级重试（F3）：与 engineMemoryRetryRef 同策略但独立
  // 计数——持续分析的降级不该污染对局（tune 拉满 2048 打人机会每步崩一次）。
  const gameMemoryRetryRef = useRef<number | null>(null);
  // 分析 rapfi 持续失败（内存分配/包损坏）→ 本会话锁轻量：后续轮次、换面重启
  // 一律不再重建 rapfi 槽（原实现每轮重试→崩溃→toast 连环 + 反复 40MB 冷加载，
  // 09-12 体检 F1）。用户切引擎档位 / 重下引擎包 / 重开分析开关时复位重试。
  const rapfiAnalysisBlockedRef = useRef(false);
  // 持续分析模式下强力未就绪的一次性提示（与提示模式对齐；blocked 场景已有
  // useFallback 的 toast，不重复）。
  const analysisPackNotifiedRef = useRef(false);
  const continuousBudgetMs = (key: string): number => {
    const entry = analysisRoundRef.current;
    if (entry.key !== key) { entry.key = key; entry.count = 1; } else entry.count += 1;
    return Math.min(20000, 2000 + (entry.count - 1) * 2000);
  };
  // 自对弈：ref 镜像开关（accept 回调读最新值），key 记录已为哪个局面发过回合，
  // 局面一变 effect 自然续下一回合。
  const selfPlayRef = useRef(false);
  const selfPlayKeyRef = useRef("");
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
  useEffect(() => {
    const unsubscribe = subscribeEnginePack((snapshot) => {
      enginePackUrlRef.current = snapshot.objectUrl;
      setEnginePackReady(Boolean(snapshot.objectUrl));
      // Downloading the pack IS the intent to use it: on the null->present
      // transition switch the game engine choice to strong so a freshly
      // downloaded pack can never sit unused behind the light default.
      const previousState = enginePackStateRef.current;
      enginePackStateRef.current = snapshot.state;
      if (snapshot.state && !previousState) {
        // 遵循下载意图（点强力→切强力；点自调→切自调）；无意图时仅把「轻量」
        // 用户升为强力（已选强力/自调的保持不动——设置页直接下载按钮场景）。
        const intent = engineDownloadIntentRef.current;
        engineDownloadIntentRef.current = null;
        setAiEngineChoice((current) => {
          const target = intent && (intent === "strong" || intent === "tuned") ? intent : current === "light" ? "strong" : current;
          if (current === target) return current;
          try { localStorage.setItem(AI_ENGINE_CHOICE_KEY, target); } catch { /* best-effort */ }
          return target;
        });
      }
      setEnginePackState(snapshot.state);
      // A flagged download without a warmed object URL happens right after app
      // start; load it in the background so the next AI request already uses it.
      // 注意：必须在自带包安装「之后」才调用——两者都会创建 objectURL，并发时
      // 会互相替换，导致先启动的预热 worker 拿到已失效的 blob（实测报
      // Network Error，见 rapfi-single.js）。见下方串行链。
    });
    // 引擎随包分发（用户 09-13）：启动时把包内自带的引擎静默装好，装完即用、
    // 不再依赖应用内下载。用户在设置里主动删包后不会被装回（opt-out 标记）。
    // 安装与「恢复已存包 URL」串行执行，避免两个 objectURL 互相覆盖（见上）。
    void installBundledEnginePack().then((installed) => {
      if (installed) {
        const snapshot = enginePackSnapshot();
        // 同步 ref：预热 effect 读 enginePackUrlRef.current；只更新 state 会让
        // 预热拿到 null（worker 加载 blob 失败）。
        enginePackUrlRef.current = snapshot.objectUrl;
        enginePackStateRef.current = snapshot.state;
        setEnginePackState(snapshot.state);
        setEnginePackReady(Boolean(snapshot.objectUrl));
      }
      // 自带包不存在（Web 部署）或已被安装时，才是「恢复已存包」的时机。
      if (!enginePackSnapshot().objectUrl) void ensureEnginePackUrl();
    });
    return () => { unsubscribe(); };
  }, []);
  // 引擎资产自检（2026-09-14）：WASM 引擎本体（public/rapfi，约 2.4MB）**没有
  // 下载兜底**，只能随包分发；测试包为了体积可能被剥掉。此时任何 AI 入口
  // （分析/人机/自对弈/VCF）都只会在回退到轻量档时静默失败——用户只看到
  // "点了没反应"。这里启动后探一次（探测用 608 字节的 NOTICE.txt，比 HEAD
  // 兼容性稳），缺失就明说，一体化打包与剥离打包都不会再出现"起不来还不知道
  // 为什么"。带引擎的正式包探到文件即静默通过，零额外请求成本（同源、本地）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const missing = "本安装包未包含 AI 引擎（测试包剥离了引擎本体），分析与人对战不可用；请安装带引擎的正式包";
      try {
        const probe = await fetch(`${import.meta.env.BASE_URL}rapfi/fallback/NOTICE.txt`, { cache: "force-cache" });
        if (!cancelled && !probe.ok) setToast(missing);
      } catch {
        if (!cancelled) setToast(missing);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // 强力/实验引擎后台预热：用户选了且包就绪时，提前把引擎加载好（40MB 包在
  // 手机上冷加载 10-30s）——否则第一次点分析要现场等加载。T47 起分析轮双
  // worker 乒乓：同时预热 slot0+slot1 两个实例（落子/换手立即在空闲实例上
  // 真计算）；aiGame 的 rapfiPersistentWorker 首次使用时再加载（避免 3 个
  // 40MB 并行预热拖垮启动——门禁实测 45s 都等不到就绪）。
  // 低内存设备由 worker 内 chooseVariant 的 deviceMemory 门槛自动降级。
  useEffect(() => {
    if (!engineNeedsPack(aiEngineChoice) || !enginePackReady) return;
    const packUrl = enginePackUrlRef.current;
    if (!packUrl) return;
    const warmEngine = engineVariantFor(aiEngineChoice, packUrl);
    const slotKey = `${warmEngine}:${packUrl}`;
    const warmOne = () => {
      const warm = new Worker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`);
      warm.postMessage({ type: "warmup", engine: warmEngine, dataUrl: packUrl });
      return warm;
    };
    for (let i = 0; i < 2; i += 1) {
      const slot = analysisPersistent.current[i];
      if (slot?.key === slotKey) continue;
      if (slot) slot.worker.terminate();
      const slotController = new AiWorkerController((discarded) => {
        const idx = analysisPersistent.current.findIndex((s) => s?.worker === discarded);
        if (idx >= 0) analysisPersistent.current[idx] = null;
      });
      analysisPersistent.current[i] = { worker: warmOne(), key: slotKey, controller: slotController, running: false };
    }
  }, [aiEngineChoice, enginePackReady]);
  const runUpdateCheck = useCallback(() => {
    // Silent by design: a failed or offline check must never nag the user.
    checkForLatestRelease(APP_VERSION)
      .then((release) => {
        if (release.relation !== "update-available") return;
        setLatestUpdate(release);
        // Interrupt once per release; "以后再说" records the version so the
        // same release never pops again, while a future one prompts once more.
        if (loadUpdatePromptDismissed() !== release.version) setUpdatePrompt(release);
      })
      .catch(() => { /* offline or rate limited; the About page allows a manual retry */ });
  }, []);
  const dismissUpdatePrompt = useCallback(() => {
    setUpdatePrompt((current) => { if (current) saveUpdatePromptDismissed(current.version); return null; });
  }, []);
  // 手动检查（快捷中心底部按钮）：与启动检查共用同一逻辑，但把结果交给调用方，
  // 已发现的新版本会同步到 latestUpdate，让品牌红点与按钮红点保持一致。
  const checkUpdateNow = useCallback(async (): Promise<LatestRelease | null> => {
    try {
      const release = await checkForLatestRelease(APP_VERSION);
      if (release.relation === "update-available") setLatestUpdate(release);
      return release;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    if (updateAutoCheck) runUpdateCheck();
    // Runs once per app launch; the About page re-checks manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeUpdateAutoCheck = (value: boolean) => {
    setUpdateAutoCheck(value);
    saveUpdateAutoCheck(value);
    if (value && !latestUpdate) runUpdateCheck();
  };
  const updateAiEngineChoice = (value: AiEngineChoice) => {
    // 引擎档位切换 = 用户显式重试信号：解开 rapfi 锁轻量 / 清强力未就绪提示 /
    // 复位两路内存降级重试计数。
    rapfiAnalysisBlockedRef.current = false;
    analysisPackNotifiedRef.current = false;
    engineMemoryRetryRef.current = null;
    gameMemoryRetryRef.current = null;
    cancelActiveAiComputation("settings-change");
    autoAnalysisKey.current = "";
    if (engineNeedsPack(value) && !enginePackState && !enginePackDownloading) {
      // 记录下载意图：下载完成自动切档时遵循此值（自调不会被劫持成强力）。
      engineDownloadIntentRef.current = value === "tuned" || value === "strong" ? value : null;
      setEnginePackDownloading(true);
      setToast("正在下载强力引擎包（38.4MB），完成后自动启用");
      void downloadEnginePack()
        .then(() => setToast("强力引擎包下载完成，持续将使用全量引擎"))
        .catch((error) => setToast(error instanceof Error ? error.message : "强力引擎包下载失败"))
        .finally(() => setEnginePackDownloading(false));
    }
    if (engineNeedsPack(value) && enginePackState && !enginePackReady) void ensureEnginePackUrl();
    setAiEngineChoice(value);
    try { localStorage.setItem(AI_ENGINE_CHOICE_KEY, value); } catch { /* persistence is best-effort */ }
  };
  useEffect(() => () => {
    setImageImportPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);
  function cancelActiveAiComputation(reason: AiCancelReason, announce = false) {
    const activeKind = aiWorkerController.current.current?.kind;
    const controlledWorker = aiWorkerController.current.current?.worker;
    const analysisActiveBefore = analysisPersistent.current.some((slot) => slot?.controller.current);
    aiWorkerController.current.cancel(reason);
    // 分析双 slot 一并取消（persistent 不 terminate，物理搜索自然收尾；
    // running 标记保留到旧轮 accept，乒乓选择据此避开仍忙的 worker）。
    for (const slot of analysisPersistent.current) if (slot) slot.controller.cancel(reason);
    // 换手/落子（position-change）：旧局面的 WASM 轮已无意义——stop 消息会被
    // 同步搜索阻塞排队，等它自然收尾要 2s；只 terminate 正在跑的那个 slot，
    // 空闲 slot（已预热好引擎）保活——下次 startThink 立即在空闲实例上开算，
    // 免去手机 10-30s 冷加载（09-12 用户反馈「回退后思考停止」根因：旧实现把
    // 两个 slot 全杀，重启只剩冷 worker）。被杀的 slot 立即重建预热供下次乒乓。
    if (reason === "position-change") {
      const packUrl = engineNeedsPack(aiEngineChoice) ? enginePackUrlRef.current : null;
      const rebuildKey = engineSlotKeyFor(aiEngineChoice, packUrl);
      const warmEngine = engineVariantFor(aiEngineChoice, packUrl);
      for (let i = 0; i < analysisPersistent.current.length; i += 1) {
        const slot = analysisPersistent.current[i];
        if (!slot?.running) continue;
        slot.worker.terminate();
        const slotController = new AiWorkerController((discarded) => {
          const idx = analysisPersistent.current.findIndex((s) => s?.worker === discarded);
          if (idx >= 0) analysisPersistent.current[idx] = null;
        });
        const rebuilt = new Worker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`);
        rebuilt.postMessage({ type: "warmup", engine: warmEngine, dataUrl: packUrl || undefined });
        analysisPersistent.current[i] = { worker: rebuilt, key: rebuildKey, controller: slotController, running: false };
      }
    }
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    for (const ref of [puzzleAiWorker, rapfiGameWorker, thinkWorker, rapfiThinkWorker]) {
      // 分析双 slot 是 persistent worker（TT 保热），cancel 不 terminate
      if (ref.current && ref.current !== controlledWorker && !analysisPersistent.current.some((slot) => slot?.worker === ref.current)) ref.current.terminate();
      ref.current = null;
    }
    if (activeKind === "analysis" || analysisActiveBefore) {
      thinkGeneration.current += 1;
      setThinkRunning(false);
      setAiAnalysis((current) => ({ ...current, status: "idle", move: null, candidates: [], depth: 0, nodes: 0, score: undefined, scoreAvailable: false, winRate: undefined, contextKey: "" }));
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
  const boardWinningLines = useMemo(() => current.move ? winningLinesAt(board, current.move, viewDocument.metadata.rule) : [], [board, current.move, viewDocument.metadata.rule]);
  // 连五即终局：与做题（puzzleOutcome）/人机（aiGame.outcome）一致，打谱出连五后不再给"可落子禁手"标记。
  const canRenderForbiddenAssistance = mode === "puzzle"
    ? !puzzleSetup && currentPuzzleRule.mode === "forbidden" && currentPuzzle?.player === "black" && !aiThinking && !puzzleOutcome
    : viewDocument.metadata.rule === "renju" && !aiThinking && !aiGame?.outcome && !boardWinningLines.length && (aiGame ? aiGame.forbiddenEnabled && nextPlayer === "black" : activePlacementPlayer === "black" && !compactIndexOf(document) && !isDynamicDatabaseView(document) && !isPagedLibraryView(document));
  const boardForbiddenMarkers = useMemo(() => showForbidden && canRenderForbiddenAssistance ? forbiddenPoints(board) : [], [showForbidden, canRenderForbiddenAssistance, board]);
  useEffect(() => { (window as unknown as Record<string, unknown>).__fbd = { showForbidden, canRender: canRenderForbiddenAssistance, markers: boardForbiddenMarkers.length, rule: viewDocument.metadata.rule, mode, nextPlayer, placementLocked, placementPlayer: activePlacementPlayer, aiThinking }; });
  const aiOpeningStage = aiGame?.opening.stage;
  // KataGo 式常亮：持续分析激活期间（analysisAuto 开且当前面在分析中）思考
  // 指示保持显示，不再每轮 accept 间隙闪一下（用户 09-11 观察实锤 2s 一眨眼）。
  const humanCanUseOpeningBoard = aiOpeningStage?.kind === "place" ? aiOpeningStage.actor === "human" : aiOpeningStage?.kind === "offer-fifths" ? aiOpeningStage.actor === "human" : aiOpeningStage?.kind === "choose-fifth" ? aiOpeningStage.chooser === "human" : false;
  const historicalAiPosition = Boolean(aiGame && currentId !== recordSession.current.currentId);
  const aiBoardDisabled = Boolean(aiGame && (aiThinking || aiGame.outcome || (aiOpeningStage?.kind === "normal" ? !historicalAiPosition && nextPlayer !== aiGame.humanPlayer : !humanCanUseOpeningBoard)));
  const aiLivePosition = Boolean(aiGame && currentId === recordSession.current.currentId);
  const aiHumanTurn = aiGame?.opening.stage.kind === "normal"
    ? aiLivePosition && nextPlayer === aiGame.humanPlayer
    : aiLivePosition && humanCanUseOpeningBoard;
  const aiClockActive = Boolean(aiGame && !aiGame.outcome && !aiThinking && aiHumanTurn && !aiClockExpired.current);
  const currentPositionKey = useMemo(() => `${document.id}/${currentId}/${positionKey(board, nextPlayer, false)}`, [document.id, currentId, board, nextPlayer]);
  // KataGo 式常亮：持续分析激活期间（analysisAuto 开且当前面在分析中）思考
  // 指示保持显示，不再每轮 accept 间隙闪一下（用户 09-11 观察实锤 2s 一眨眼）。
  const machineThinking = aiThinking || thinkRunning || (enhancementSettings.analysisAuto && !enhancementSettings.analysisSelfPlay && !enhancementSettings.analysisHintMode && aiAnalysis.contextKey === currentPositionKey);
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
  // 人机对战不暴露胜率：棋盘选点整个隐藏（见 Board 调用处），面板里的指标也
  // 从胜率降级为评估分——即使玩家在分析设置里选了胜率也一样（用户 09-13）。
  const analysisShownMetric: AnalysisCandidateMetric = aiGame && enhancementSettings.analysisCandidateMetric === "winRate" ? "score" : enhancementSettings.analysisCandidateMetric;
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
  const togglePuzzleBatchSelection = (id: string) => setPuzzleBatchSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const clearPuzzleBatchSelection = () => setPuzzleBatchSelectedIds([]);
  const selectAllPuzzleBatch = () => setPuzzleBatchSelectedIds(puzzleCollections.map((item) => item.id));
  const closePuzzleBatch = () => { setPuzzleBatchMode(false); setPuzzleBatchSelectedIds([]); setSheet(null); };
  const movePuzzleBatchToFolder = () => {
    if (!puzzleBatchSelectedIds.length || !folderCreationParent) return;
    puzzleBatchSelectedIds.forEach((id) => assignLibraryItem("puzzles", id, folderCreationParent));
    setToast(`已移动 ${puzzleBatchSelectedIds.length} 个题集到“${folderCreationParent}”`);
    setExpandedLibraryFolders((current) => new Set([...current, folderCreationParent]));
    setSheet(null);
  };
  const deletePuzzleBatchSelection = () => {
    const deletable = puzzleCollections.filter((collection) => puzzleBatchSelectedIds.includes(collection.id) && !collection.id.startsWith("native-"));
    if (!deletable.length) { setToast("内置题库不可删除"); return; }
    if (window.confirm(`确认删除已选择的 ${deletable.length} 个题集？`)) { deletable.forEach((collection) => deletePuzzleCollection(collection)); closePuzzleBatch(); }
  };
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
  useEffect(() => { localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify({ showNumbers, showCoordinates, showForbidden, showLastMove, moveNumberScale, gridLineWidth, coordinateFontSize })); }, [showNumbers, showCoordinates, showForbidden, showLastMove, moveNumberScale, gridLineWidth, coordinateFontSize]);
  useEffect(() => { saveStoneOpacity(stoneOpacity); }, [stoneOpacity]);
  useEffect(() => { saveBoardOpacity(boardOpacity); }, [boardOpacity]);
  useEffect(() => { saveAnnotationHighlight(annotationHighlight); }, [annotationHighlight]);
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
  }, [currentPositionKey]);
  useEffect(() => {
    const active = aiWorkerController.current.current;
    if (active && active.contextKey !== currentPositionKey) cancelActiveAiComputation("position-change");
    else if (!active) {
      thinkWorker.current?.terminate(); thinkWorker.current = null; thinkGeneration.current += 1;
      rapfiThinkWorker.current?.terminate(); rapfiThinkWorker.current = null;
      setThinkRunning(false);
      setAiAnalysis((current) => current.contextKey === currentPositionKey ? current : { status: "idle", engine: engineVariantFor(aiEngineChoice, enginePackUrlRef.current), depth: 0, nodes: 0, contextKey: "" });
    }
  }, [currentPositionKey, aiEngineChoice]);
  useEffect(() => {
    const suspend = () => { if (globalThis.document?.visibilityState === "hidden") cancelActiveAiComputation("background"); };
    const pageHide = () => cancelActiveAiComputation("background");
    globalThis.document?.addEventListener("visibilitychange", suspend);
    window.addEventListener("pagehide", pageHide);
    return () => {
      globalThis.document?.removeEventListener("visibilitychange", suspend);
      window.removeEventListener("pagehide", pageHide);
      cancelActiveAiComputation("unmount");
      vcfGenWorker.current?.terminate(); vcfGenWorker.current = null; pagedSession.current?.close(); dynamicViewSession.current?.close(); void banbuAudio.close();
    };
  }, []);
  useEffect(() => {
    if (tab === "record") return;
    cancelActiveAiComputation("mode-switch");
    // 离开打谱页会中止持续分析，但开关不能停在「开」（用户 09-13：去设置页再
    // 回来，分析已停却仍显示开关开启）。这里把它同步关掉，语义为「停止分析」。
    // 仅处理持续分析：自对弈/提示的回合由各自流程管理，不在此联动。
    if (getAnalysisMode(enhancementSettings) === "continuous" && enhancementSettings.analysisAuto) {
      autoAnalysisKey.current = currentPositionKey;
      analysisRoundRef.current = { key: "", count: 0 };
      setEnhancementSettings((current) => ({ ...current, analysisAuto: false }));
    }
  }, [tab]);
  const playSound = (cue: SoundCue) => { void banbuAudio.play(cue); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (layoutEditorOpen || quickDrawerOpen || sheet) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
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
  }, [document, currentId, current.parentId, draftOverlay, viewDocument, layoutEditorOpen, quickDrawerOpen, sheet]);

  const requestStrongAiMove = (afterDocument: GameDocument, afterId: string, aiPlayer: Player, onMove: (move: Position) => void, onNoMove: () => void, options: { strength?: AiStrength; timeMs?: number; maxDepth?: number; unlimited?: boolean; kind?: "game" | "puzzle"; engineChoice?: AiEngineChoice } = {}) => {
    cancelActiveAiComputation("superseded");
    setAiThinking(true);
    const board = boardAt(afterDocument, afterId);
    const moves = pathToNode(afterDocument, afterId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
    const strength = options.strength || aiStrength;
    const profile = strength === "自由" ? { timeMs: aiFreeTimeMs, maxDepth: aiFreeDepth } : AI_STRENGTH_PROFILES[strength];
    const searchConfig = { timeMs: options.timeMs ?? profile.timeMs, maxDepth: options.maxDepth ?? profile.maxDepth, unlimited: options.unlimited === true };
    const kind = options.kind || "game";
    const engineChoice = options.engineChoice || aiEngineChoice;
    const enginePackUrl = engineNeedsPack(engineChoice) ? enginePackUrlRef.current : null;
    aiAnalysisEngineRef.current = engineVariantFor(engineChoice, enginePackUrl);
    setAiAnalysis({ status: "thinking", engine: aiAnalysisEngineRef.current, mover: aiPlayer, depth: 0, nodes: 0, contextKey: `${afterDocument.id}/${afterId}/${positionKey(board, aiPlayer, false)}` });
    const slotKey = engineSlotKeyFor(engineChoice, enginePackUrl);
    // One long-lived Rapfi worker per engine mode: skipping the per-move
    // reload (~1.4s) and keeping the transposition table warm across moves is
    // worth real search depth inside the same think budget.
    let persistentEntry = rapfiPersistentWorker.current;
    if (!persistentEntry || persistentEntry.key !== slotKey) {
      persistentEntry?.worker.terminate();
      persistentEntry = { worker: new Worker(String(import.meta.env.BASE_URL) + "rapfi/rapfi-worker.js"), key: slotKey };
      rapfiPersistentWorker.current = persistentEntry;
    }
    const worker = persistentEntry.worker;
    rapfiGameWorker.current = worker;
    const handle = aiWorkerController.current.start(worker, kind, `${afterDocument.id}/${afterId}/${positionKey(board, aiPlayer, false)}`, { persistent: true, unlimited: searchConfig.unlimited });
    if (kind === "game") gameThinkLive.current = { requestId: handle.requestId, onMove, best: null };
    else gameThinkLive.current = null;
    let strongFallbackNotified = false;
    const noteEngineVariant = (variant: string | undefined) => {
      // The user picked the strong/experiment engine: a silent fallback would
      // look like "the champion engine is weak", so surface the downgrade once
      // per game.
      if (engineNeedsPack(engineChoice) && !strongFallbackNotified && variant === "fallback") {
        strongFallbackNotified = true;
        setToast(enginePackState ? "强力引擎未能加载，本局改用轻量引擎（可在设置中重新下载）" : "强力引擎包尚未下载，本局先用轻量引擎");
      }
    };
    taskManager.current.start({ kind: "ai", title: kind === "puzzle" ? "陪练思考" : "人机思考", taskId: handle.requestId, cancellable: true, retryable: true });
    taskManager.current.update({ stage: searchConfig.unlimited ? "searching-unlimited" : "searching", message: searchConfig.unlimited ? "不限时思考中，可随时停止" : "正在寻找下一步" });
    const complete = (result: AiMoveResult) => {
      if (!aiWorkerController.current.isCurrent(handle)) return;
      aiWorkerController.current.finish(handle);
      rapfiGameWorker.current = null; puzzleAiWorker.current = null;
      if (gameThinkLive.current?.requestId === handle.requestId) gameThinkLive.current = null;
      setAiAnalysis((current) => ({ ...current, status: result.move ? "complete" : "error", engine: aiAnalysisEngineRef.current, depth: result.depth, nodes: result.nodes, score: result.score, scoreAvailable: result.scoreAvailable, winRate: result.winRate !== undefined ? result.winRate : current.winRate, move: result.move, candidates: result.candidates?.length ? result.candidates : current.candidates, principalVariation: result.principalVariation, elapsedMs: result.elapsedMs }));
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
      // F3：高档内存分配失败（引擎退出）→ 先降 256MB 重试一次强力，再换轻量
      // （与持续分析同策略；原实现 tune 拉满 2048 打人机每步崩一次+toast）。
      const usedMem = gameMemoryRetryRef.current ?? engineMemoryMbFor(engineChoice, enhancementSettings.analysisMaxMemoryMb) ?? 0;
      if (usedMem > 256 && !gameMemoryRetryRef.current) {
        gameMemoryRetryRef.current = 256;
        setToast("AI 引擎内存分配失败，已自动降至 256MB 重试");
        cancelActiveAiComputation("settings-change");
        window.setTimeout(() => requestStrongAiMove(afterDocument, afterId, aiPlayer, onMove, onNoMove, { ...options, engineChoice }), 0);
        return;
      }
      useLocalFallback();
      // 回切轻量必须提示（用户 09-13）：尤其高内存档（≥1GB）下根因大概率是
      // 引擎分配失败而非偶发异常。
      setToast(enhancementSettings.analysisMaxMemoryMb >= 1024 ? "AI 引擎未能分配内存，本局已改用轻量引擎；可调低「分析内存」后重试" : "AI 引擎异常，本局已改用轻量引擎");
    };
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: string; generation?: number; result?: AiMoveResult; variant?: string; depth?: number; nodes?: number; score?: number; winRate?: number; candidates?: AiAnalysisCandidate[] }>) => {
      if (rapfiGameWorker.current !== worker || !aiWorkerController.current.isCurrent(handle, event.data.requestId || handle.requestId, event.data.generation ?? handle.generation)) return;
      if (event.data.type === "ready") { noteEngineVariant(event.data.variant); aiAnalysisEngineRef.current = event.data.variant === "full" ? "full" : "light"; }
      if (event.data.type === "result" && event.data.variant) aiAnalysisEngineRef.current = event.data.variant === "full" ? "full" : "light";
      if (event.data.type === "progress") {
        aiAnalysisEngineRef.current = event.data.variant === "full" ? "full" : "light";
        if (gameThinkLive.current && gameThinkLive.current.requestId === (event.data.requestId || handle.requestId)) {
          const liveList = event.data.candidates || [];
          const primary = liveList.find((candidate) => (candidate.pvIndex ?? 0) <= 0) || liveList[0];
          if (primary?.move) gameThinkLive.current.best = { row: primary.move.row, col: primary.move.col };
        }
        setAiAnalysis((current) => ({ ...current, status: "thinking", engine: aiAnalysisEngineRef.current, depth: event.data.depth || current.depth, nodes: event.data.nodes || current.nodes, score: event.data.score !== undefined ? event.data.score : current.score, scoreAvailable: event.data.score !== undefined || current.scoreAvailable, winRate: event.data.winRate !== undefined ? event.data.winRate : current.winRate, candidates: event.data.candidates?.length ? event.data.candidates : current.candidates }));
      } else if (event.data.type === "result" && event.data.result) {
        if (event.data.result.source === "book" && event.data.result.move) {
          recordAction(`开局库应着 ${coordinateName(event.data.result.move)}${event.data.result.bookLabel ? `（${event.data.result.bookLabel}打）` : ""}`);
          setToast(`开局库：${coordinateName(event.data.result.move)}${event.data.result.bookLabel ? `（${event.data.result.bookLabel}打）` : ""}`);
        }
        complete(event.data.result);
      } else if (event.data.type === "error") useFallbackAfterRapfiError();
    };
    worker.onerror = useFallbackAfterRapfiError;
    worker.postMessage({ type: "analyze", requestId: handle.requestId, generation: handle.generation, engine: enginePackUrl ? "auto" : "fallback", dataUrl: enginePackUrl || undefined, size: afterDocument.metadata.boardSize || 15, moves, player: aiPlayer, rule: afterDocument.metadata.rule, openingRule: afterDocument.metadata.openingRule, timeMs: searchConfig.unlimited ? 0 : searchConfig.timeMs, maxDepth: searchConfig.unlimited ? 512 : searchConfig.maxDepth, unlimited: searchConfig.unlimited, topN: 5, finishOnBareMove: true, stopOnProvenWin: true, book: kind === "game" && enhancementSettings.openingBook === true, maxMemoryMb: engineMemoryMbFor(engineChoice, enhancementSettings.analysisMaxMemoryMb) });
  };

  // Opening decisions (placements, fifth-move offers/choices) used to be
  // shape heuristics that answered instantly and handed the human winning
  // lines. They now query the same engine the game uses; heuristics remain
  // only as the fallback when the engine is unavailable.
  // 开局链临时探测 worker 集合（全盘体检 P2-4）：组件卸载时统一回收，
  // 防极端慢网络下守卫到点前 worker 存活泄漏。开局链在途不主动 terminate（会打断摆子）。
  const openingProbeWorkersRef = useRef<Set<Worker>>(new Set());
  useEffect(() => () => { for (const probeWorker of openingProbeWorkersRef.current) probeWorker.terminate(); openingProbeWorkersRef.current.clear(); }, []);
  const requestOpeningEngineCandidates = (baseMoves: Position[], player: Player, count: number, timeMs: number, rule: RuleSet, boardSize: number, strong: boolean, book = false, openingRule?: OpeningRule): Promise<{ moves: Position[]; score: number | null; ranks: number[]; bookHit: boolean }> => new Promise((resolve) => {
    const packUrl = strong ? enginePackUrlRef.current : null;
    const worker = new Worker(String(import.meta.env.BASE_URL) + "rapfi/rapfi-worker.js");
    openingProbeWorkersRef.current.add(worker);
    let settled = false;
    const finish = (result: { moves: Position[]; score: number | null; ranks?: number[]; bookHit?: boolean }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(guard);
      openingProbeWorkersRef.current.delete(worker);
      worker.terminate();
      resolve({ ranks: [], bookHit: false, ...result });
    };
    // 每阶段 new Worker 冷启动，旧守卫 timeMs+20s 让无响应阶段拖满 20 秒「思考中」
    const guard = window.setTimeout(() => finish({ moves: [], score: null }), timeMs + Math.max(6000, timeMs * 3));
    worker.onmessage = (event: MessageEvent<{ type: string; result?: AiMoveResult; message?: string }>) => {
      const data = event.data || {};
      if (data.type === "result" && data.result) {
        if (data.result.source === "book") recordAction(`开局库提供 ${count} 个第5手打点候选`);
        const rawCandidates = data.result.candidates || [];
        const candidates = rawCandidates.map((candidate) => candidate.move).filter(Boolean);
        const moves = candidates.length ? candidates : data.result.move ? [data.result.move] : [];
        finish({ moves, score: typeof data.result.score === "number" ? data.result.score : null, ranks: rawCandidates.map((candidate) => candidate.rank ?? 0).filter((rank) => rank > 0), bookHit: data.result.source === "book" });
      } else if (data.type === "error") finish({ moves: [], score: null });
    };
    worker.onerror = () => finish({ moves: [], score: null });
    worker.postMessage({ type: "analyze", engine: packUrl ? "auto" : "fallback", dataUrl: packUrl || undefined, size: boardSize, moves: baseMoves.map((move) => ({ ...move })), player, rule, openingRule, timeMs, maxDepth: 64, topN: count, finishOnBareMove: true, stopOnProvenWin: true, book, maxMemoryMb: engineMemoryMbFor(aiEngineChoice, enhancementSettings.analysisMaxMemoryMb) });
  });

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
    }, () => { setAiThinking(false); setToast("陪练没有找到可落子点"); }, { kind: "puzzle", timeMs: PUZZLE_FAST_THINK_TIME_MS });
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
    }, () => { setAiThinking(false); setAiGame((currentGame) => currentGame ? { ...currentGame, outcome: "draw" } : currentGame); setToast("AI 没有找到合法落子，本局和棋"); }, { strength: game?.strength || aiStrength, timeMs: game?.thinkTimeMs, maxDepth: game?.thinkDepth, unlimited: game?.unlimitedThinking, kind: "game", engineChoice: game?.engineChoice || aiEngineChoice });
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
      void (async () => {
        const engineStrong = (game.engineChoice || aiEngineChoice) === "strong";
        const thinkTimeMs = game.thinkTimeMs || (game.strength !== "自由" ? AI_STRENGTH_PROFILES[game.strength]?.timeMs : undefined) || 2200;
        const boardSize = afterDocument.metadata.boardSize || 15;
        const rule = afterDocument.metadata.rule;
        const openingMoves = pathToNode(afterDocument, afterId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
        try {
          if (stage.kind === "swap") {
            setAiThinking(false);
            const opening = decideOpeningSwap(game.opening, false);
            const nextGame = gameWithOpening(game, opening);
            const namedDocument = documentWithAiNames(afterDocument, nextGame);
            setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId: afterId };
            setToast(stage.taraguchiChoice ? "AI 选择不交换，进入塔十候选阶段" : "AI 选择保持当前执子方");
            scheduleAiOpening(nextGame, namedDocument, afterId);
            return;
          }
          if (stage.kind === "choose-fifth-count") {
            setAiThinking(false);
            // 宣布打点数（T31）：开局库开启时查本局面宣布层的「库内好点数」K，
            // 宣布 K+1——黑只有 K 个体面点，多逼一个劣点暴露，白保留其一并下第6手。
            // 库关/未命中保持旧行为（保守 3 打）。
            let declared = 3;
            const limit = game.opening.rule === "five-n" ? { min: 3, max: 10 } : game.opening.rule === "soosyrv-8" ? { min: 1, max: 8 } : null;
            if (limit && enhancementSettings.openingBook === true) {
              const probe = await requestOpeningEngineCandidates(openingMoves, "black", 10, Math.min(600, thinkTimeMs || 600), rule, boardSize, engineStrong, true, afterDocument.metadata.openingRule);
              if (generation !== aiOpeningGeneration.current) return;
              if (probe.bookHit && probe.ranks.length) declared = bookDeclareCount(probe.ranks, limit.min, limit.max);
            }
            const opening = chooseFifthCount(game.opening, declared);
            const nextGame = gameWithOpening(game, opening);
            setAiGame(nextGame);
            setToast(opening.stage.kind === "swap"
              ? `AI 已宣布 ${opening.n} 个第5手打点，请决定是否交换`
              : `AI 已选择 ${opening.n} 个第5手打点，请选择一个`);
            scheduleAiOpening(nextGame, afterDocument, afterId);
            return;
          }
          if (stage.kind === "offer-fifths") {
            const board = boardAt(afterDocument, afterId);
            const engine = await requestOpeningEngineCandidates(openingMoves, "black", stage.count, thinkTimeMs, rule, boardSize, engineStrong, enhancementSettings.openingBook === true, afterDocument.metadata.openingRule);
            if (generation !== aiOpeningGeneration.current) return;
            const seen: Position[] = [];
            const candidates: Position[] = [];
            for (const move of engine.moves) {
              if (board[move.row]?.[move.col] || !isDistinctFifthCandidate(board, seen, move)) continue;
              seen.push(move); candidates.push(move);
              if (candidates.length >= stage.count) break;
            }
            for (const fallback of suggestFifthCandidates(board, stage.count + 2)) {
              if (candidates.length >= stage.count) break;
              if (board[fallback.row]?.[fallback.col] || !isDistinctFifthCandidate(board, seen, fallback)) continue;
              seen.push(fallback); candidates.push(fallback);
            }
            if (!candidates.length) { setAiThinking(false); setToast("AI 没有找到可用的第5手打点"); return; }
            let opening = game.opening;
            for (const point of candidates) opening = addFifthCandidate(opening, point);
            const nextGame = gameWithOpening(game, opening);
            setAiThinking(false);
            setAiGame(nextGame); setToast(`AI 已提供 ${opening.candidates.length} 个第5手候选，请选择一个`);
            scheduleAiOpening(nextGame, afterDocument, afterId);
            return;
          }
          if (stage.kind === "choose-fifth") {
            const board = boardAt(afterDocument, afterId);
            // Evaluate each offered candidate from white's perspective and take
            // the one where white stands best, instead of blindly taking A1.
            let bestScore = -Infinity;
            let selected: Position | undefined = game.opening.candidates[0];
            // 逐打点评估各起一个冷 worker（~1.4s 启动），初级下 5 个候选=10s+「一直思考」；
            // 封顶 3 个候选且时长按强度走（初级 600ms），尾差交给启发式。
            for (const candidate of game.opening.candidates.slice(0, 3)) {
              if (board[candidate.row]?.[candidate.col]) continue;
              const engine = await requestOpeningEngineCandidates([...openingMoves, { row: candidate.row, col: candidate.col, player: "black" as Player }], "white", 1, Math.max(600, Math.min(2200, thinkTimeMs)), rule, boardSize, engineStrong);
              if (generation !== aiOpeningGeneration.current) return;
              const score = engine.score ?? -Infinity;
              if (score > bestScore) { bestScore = score; selected = candidate; }
            }
            if (!selected) { setAiThinking(false); setToast("没有可选择的第5手候选"); return; }
            const reply = addMoveAs(afterDocument, afterId, selected, "black");
            const opening = completeFifthChoice(game.opening);
            const nextGame = gameWithOpening(game, opening);
            setAiThinking(false);
            setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place"); playSound("move-black"); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
            setToast(`AI 选择了第5手候选 ${coordinateName(selected)}`);
            scheduleAiOpening(nextGame, reply.document, reply.nodeId);
            return;
          }
          const board = boardAt(afterDocument, afterId);
          let position: Position | null = null;
          if (stage.kind === "place" && stage.moveNumber === 1) {
            const center = Math.floor(boardSize / 2);
            position = { row: center, col: center };
          } else {
            const engine = await requestOpeningEngineCandidates(openingMoves, stage.player, 3, thinkTimeMs, rule, boardSize, engineStrong, enhancementSettings.openingBook === true, afterDocument.metadata.openingRule);
            if (generation !== aiOpeningGeneration.current) return;
            position = engine.moves.find((move) => !board[move.row]?.[move.col] && openingPositionAllowed(boardSize, move, stage)) || null;
            // TEMP-DEBUG
            console.log("[opening-place]", JSON.stringify({ stage: stage.moveNumber + ":" + stage.player, radius: stage.radius, engineMoves: engine.moves.map((m) => `${m.row},${m.col}`), bookHit: engine.bookHit, picked: position ? `${position.row},${position.col}` : null }));
          }
          if (!position) position = suggestOpeningPlacement(board, stage);
          if (!position) { setAiThinking(false); setToast("当前开局阶段没有合法落子"); return; }
          const reply = addMoveAs(afterDocument, afterId, position, stage.player);
          const opening = completeOpeningPlacement(game.opening);
          const nextGame = gameWithOpening(game, opening);
          setAiThinking(false);
          setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place"); playSound(stage.player === "black" ? "move-black" : "move-white"); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
          setToast(`AI 完成第 ${stage.moveNumber} 手 · ${coordinateName(position)}`);
          scheduleAiOpening(nextGame, reply.document, reply.nodeId);
        } catch {
          setAiThinking(false);
        }
      })();
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
    // 打开（或切换）题目时重置「本次会话已记录尝试」标记：同题重新打开也重计一次。
    puzzleAttemptRecordedRef.current = false;

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
    setPuzzleSideOverride(null);
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
  const recordPuzzleAttempt = (solved: boolean) => {
    if (!currentPuzzle) return;
    const key = puzzleProgressKey(puzzleCollections[puzzleCollectionIndex].id, currentPuzzle.id);
    // 终局记录总是更新 solved；attempts 只在本会话首次落子时 +1（进「最近棋题」，
    // 避免每次落子都计数；openPuzzle 重置标记后，重开同题可再记一次）。
    setPuzzleProgress((currentProgress) => {
      const existing = currentProgress[key];
      const firstMove = !puzzleAttemptRecordedRef.current;
      puzzleAttemptRecordedRef.current = true;
      if (!firstMove && !solved) return currentProgress;
      const attempts = firstMove ? (existing?.attempts || 0) + 1 : (existing?.attempts || 0);
      return { ...currentProgress, [key]: { solved: solved || !!existing?.solved, attempts, updatedAt: new Date().toISOString() } };
    });
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
    // 强制停止=先落当前最强点再停（T29）。WASM 同步搜索不让出 worker 事件
    // 循环，worker 可能还没看到 stop 消息——所以首选 app 侧 progress 快照
    // （100ms 一更）直接落子；进度未到时退回 worker 端收尾（requestResultOnStop），
    // 再不行 3.5s 兜底走旧取消逻辑。
    const live = gameThinkLive.current;
    const stopping = aiWorkerController.current.current;
    if (live && stopping && stopping.kind === "game" && stopping.requestId === live.requestId) {
      if (live.best) {
        cancelActiveAiComputation("user");
        setToast(`已停止思考：落当前最强点 ${coordinateName(live.best)}`);
        gameThinkLive.current = null;
        live.onMove(live.best);
        return;
      }
      if (aiWorkerController.current.requestResultOnStop()) {
        setToast("已停止思考：AI 将落当前最强点");
        const stoppingId = stopping.requestId;
        window.setTimeout(() => {
          const now = aiWorkerController.current.current;
          if (now && now.requestId === stoppingId) cancelActiveAiComputation("user", true);
        }, 3500);
        return;
      }
    }
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
    setAiThinking(false); setThinkRunning(false);
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
    // 应战后题目导航常驻在走棋行里（见 puzzleNavRow），不再需要 dock 面板。
    if (!puzzleSetup) { setDockPanel(null); return; }
    setDocument(puzzleSetup.session.sourceDocument); setCurrentId(puzzleSetup.session.sourceCurrentId);
    setPuzzleOutcome(puzzleSetup.sourceOutcome); setPuzzleSetup(null); setPlacementLocked(false); setDockPanel(null);
    setToast("已返回应战，题目局面保持不变");
  };
  const navigatePuzzleSetup = (cursor: number) => {
    if (!puzzleSetup) return;
    const session = movePuzzleSetupCursor(puzzleSetup.session, cursor);
    applyPuzzleSetupSession(session); triggerBoardMotion("navigate");
  };
  const restartPuzzle = () => {
    cancelActiveAiComputation("position-change");
    // 重建全新题目文档：旧作答分支（含上一局的落子）整体丢弃，棋盘上不再残留
    // 之前的子/变化点痕迹；同时复位换边（回到题目默认执子方）并退出摆棋。
    const collection = puzzleCollections[puzzleCollectionIndex];
    const puzzle = collection?.puzzles[puzzleIndex];
    if (puzzle) {
      const ruleResolution = resolvePuzzleRule(puzzle, collection, puzzleRulePreference);
      const session = createPuzzleDocument(puzzle, ruleResolution.rule);
      setDraft(emptyDraft());
      setDocument(session.document); setCurrentId(session.initialNodeId);
      setPuzzleInitialId(session.initialNodeId); setPuzzleInitialDepth(session.initialDepth);
    }
    setPuzzleSetup(null); setPuzzleSideOverride(null); setPlacementLocked(false);
    setAiThinking(false); setPuzzleOutcome(null);
    setToast("已恢复到本题初始局面");
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
    suppressAnnotationContextEffect.current = true;
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
    const destination = defaultDirectory || (supportsNativeExportDirectory() ? await defaultNativeExportHandle() : null);
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
      // 重选时把当前文件夹作为系统选择器的起点（Android 11+）：不再每次从「文档」翻起。
      const handle = await pickDefaultDirectoryHandle({ initialUri: isSafDirectoryHandle(defaultDirectory) ? defaultDirectory.uri : undefined });
      setDefaultDirectory(handle);
      setToast(`默认导出文件夹已设置为“${exportLocationLabel(handle) ?? handle.name}”`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast(error instanceof Error ? error.message : "选择默认文件夹失败");
    }
  };
  const clearDefaultDirectory = async () => {
    await clearDefaultDirectoryHandle();
    setDefaultDirectory(null);
    setToast(supportsNativeExportDirectory()
      ? `已恢复默认导出位置：手机“${exportLocationLabel(await defaultNativeExportHandle()) ?? "文档"}”`
      : "已取消默认导出文件夹，之后将使用浏览器默认下载目录");
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
  const exitAnnotationMode = () => { setDockPanel((panel) => panel === "annotation" ? null : panel); setAnnotationPopover(null); setAnnotationErase(false); };
  const annotationContextRef = useRef(`${document.id}:${currentId}`);
  // 编辑副本切换（DP/分页视图就地创建可编辑副本）会换 document.id 但局面未导航，
  // 不能因此关闭标注面板（用户 09-10：导入谱点标注创建副本后，下一手标注变落子）。
  const suppressAnnotationContextEffect = useRef(false);
  useEffect(() => {
    const nextContext = `${document.id}:${currentId}`;
    if (annotationContextRef.current === nextContext) return;
    const wasSuppressed = suppressAnnotationContextEffect.current;
    suppressAnnotationContextEffect.current = false;
    annotationContextRef.current = nextContext;
    if (wasSuppressed) return;
    // 导航到其他局面时保留标注面板（用户 09-10：上一手/下一手会把标注面板
    // 收起，不方便连续标注）；只清掉去标注的擦除态，避免在新局面误擦。
    setAnnotationPopover(null);
    setAnnotationErase(false);
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
  // 就地进入编辑（标注点击触发）：与 switchMode("record") 等价的草稿恢复语义，
  // 但不关闭面板、不动 document/currentId —— 删棋谱原有标注时保持操作连贯。
  const enterRecordForEdit = () => {
    if (mode !== "review") return;
    cancelActiveAiComputation("mode-switch");
    setPuzzleSetup(null);
    setWorkspaceSelectorOpen(false);
    setAiThinking(false);
    setSheet(null);
    const restoredDraft = reviewDrafts.current.get(document.id);
    reviewDrafts.current.delete(document.id);
    setDraft(restoredDraft || (compactIndexOf(document) ? emptyDraft() : loadDraftFromLocal(document.id)));
    setMode("record");
    setContinuationEditMode(false);
  };
  // 研读模式的「保存」入口：本机标注层整体合入草稿，顶栏「保存棋谱」落盘。
  const commitAllReviewMarksToDraft = () => {
    const prefix = `${document.id}:`;
    const keys = Object.keys(reviewMarks).filter((key) => key.startsWith(prefix) && reviewMarks[key]?.length);
    if (!keys.length) { setToast("本谱还没有本机标注"); return; }
    if (compactIndexOf(document) || isPagedLibraryView(document) || isDynamicDatabaseView(document)) { setToast("DP/大型谱不支持把本机标注写回原谱"); return; }
    enterRecordForEdit();
    setDraft((state) => keys.reduce((acc, key) => {
      const nodeId = key.slice(prefix.length);
      // 合并基线=原谱叠加草稿此前 ops 后的视图（全盘体检 P2-2：直接用原始 node.marks
      // 会把草稿里对该节点的既有未保存编辑冲掉）。
      const node = applyDraftToDocument(document, acc.operations).nodes[nodeId];
      if (!node) return acc;
      return pushDraft(acc, { type: "update-node", nodeId, patch: { marks: mergeNodeMarksWithLocal(node.marks || [], reviewMarks[key] || []) } });
    }, state));
    setReviewMarks((all) => { const next = { ...all }; for (const key of keys) delete next[key]; return next; });
    setToast(`本机标注已并入草稿（${keys.length} 处），点顶栏「保存棋谱」写入棋谱`);
  };
  const editAnnotationAt = (position: Position) => {
    const boardSize = viewDocument.metadata.boardSize || 15;
    const samePoint = (mark: { row: number; col: number }) => mark.row === position.row && mark.col === position.col;
    const labelSuffix = currentAnnotationLabel ? ` ${currentAnnotationLabel}` : "";
    // 原生标注判定：当前节点 marks（带 renLibNativeLabel）或该坐标的变化点子节点
    // boardText（DP/分页视图的原生标注渲染在变化点上，不在 current.marks——九天指南
    // 等数据库谱「去标注点原生标注显示没有标注」的根因，2026-09-11 修复）。
    // App 作用域没有 Board 内部那份 variationNodes，这里用同一数据源现算。
    const appNativeVariationNodes = (() => {
      try {
        const occupied = new Set<string>();
        board.forEach((row, r) => row.forEach((cell, c) => { if (cell) occupied.add(`${r},${c}`); }));
        return renderableBoardVariationNodes(viewDocument, currentId, occupied, 512);
      } catch { return []; }
    })();
    const nativeVariationAt = (point: Position) => appNativeVariationNodes.find((node) => {
      const nodePoint = node.move || node.anchor;
      return Boolean(node.boardText) && nodePoint?.row === point.row && nodePoint.col === point.col && (isRenLibWebView(document) || Boolean(node.renLibNativeLabel));
    });
    // 普通放置/移除判定：只看当前节点 marks（用户标注 + 原生 marks）。
    // 变化点（含无标注的子节点）不算「已有标注」，否则点它会被当成删除而非放置。
    const marksAt = (point: Position) => (current.marks || []).some((mark) => samePoint(mark));
    // 去标注（擦除）判定：marks + 变化点原生标注（DP/分页视图的原生标注在子节点 boardText）。
    const nativeMarkAt = (point: Position) => marksAt(point) || Boolean(nativeVariationAt(point));
    // ── 去标注（擦除）模式：点棋盘只擦不画 ──
    // 用户 09-10 反馈「想去掉一个标注，点已有标注却盖一层新的」——擦除模式把
    // 「删」从「点已有=取消」的隐式语义里独立出来：点已有标注（本机浮层或棋谱
    // 原标注）一律移除，点空位给出提示，杜绝误盖。退出按钮/再点按钮/关闭面板退出。
    if (annotationErase) {
      if (mode === "review") {
        const previous = reviewMarks[reviewMarkKey] || [];
        const localHere = previous.some(samePoint);
        const nativeHere = nativeMarkAt(position);
        if (localHere) {
          const nextMarks = previous.filter((mark) => !samePoint(mark));
          const next = { ...reviewMarks };
          if (nextMarks.length) next[reviewMarkKey] = nextMarks;
          else delete next[reviewMarkKey];
          setReviewMarks(next);
          setToast(`已擦除本机标注 · ${coordinateName(position, boardSize)}${nativeHere ? "，棋谱原有标注仍在（再点一次可擦除它）" : ""}`);
          return;
        }
        if (nativeHere) {
          enterRecordForEdit();
          // enterRecordForEdit 只是 setMode("record")（异步生效），本闭包的 mode
          // 仍是 review——不能走 recordDraft（其 review 守卫会静默丢弃删除）。
          // 按 recordDraft 同款分发：可编辑视图直接入草稿；只读数据库/分页视图
          // 自动创建编辑副本再删（原库不变）。
          // DP/分页视图原生标注在变化点子节点 boardText——必须 patch 子节点 id；
          // 普通原生标注在当前节点 marks（2026-09-11 根修：此分支此前一律清
          // currentId.marks，变化点标注完全删不掉，正是「去标注对原生标注无效」）。
          const variationNode = nativeVariationAt(position);
          const operation = variationNode
            ? { type: "update-node" as const, nodeId: variationNode.id, patch: { boardText: "" } }
            : { type: "update-node" as const, nodeId: currentId, patch: { marks: (current.marks || []).filter((mark) => !samePoint(mark)) } };
          if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) {
            if (hasDraft(draft)) setDraft((state) => pushDraft(state, operation));
            else detachViewForEditing(pushDraft(emptyDraft(), operation));
          } else {
            setDraft((state) => pushDraft(state, operation));
          }
          if (previous.length) setReviewMarks((all) => { const next = { ...all }; delete next[reviewMarkKey]; return next; });
          setToast(`已删除棋谱原有标注 ${coordinateName(position, boardSize)}，已切到编辑模式，点顶栏「保存棋谱」落盘`);
          return;
        }
        setToast("该点没有标注，无需擦除");
        return;
      }
      if (mode === "record") {
        const existingHere = nativeMarkAt(position);
        if (!existingHere) { setToast("该点没有标注，无需擦除"); return; }
        const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
        const variationNode = nativeVariationAt(position);
        if (variationNode) {
          // 变化点上的原生标注在**子节点**的 boardText——必须 patch variationNode.id，
          // applyCompactUpdate 的 nodeId 写死 currentId 会清错节点（2026-09-11 根修）。
          recordDraft({ type: "update-node", nodeId: variationNode.id, patch: { boardText: "" } });
          if (editingDatabaseView) setToast(`已创建编辑副本并擦除原生标注 · ${coordinateName(position, boardSize)}`);
          else setToast(`已擦除原生标注 · ${coordinateName(position, boardSize)}`);
        } else {
          applyCompactUpdate({ marks: (current.marks || []).filter((mark) => !samePoint(mark)) });
          if (editingDatabaseView) setToast(`已创建编辑副本并擦除标注${labelSuffix} · ${coordinateName(position, boardSize)}`);
          else if (!isCompact()) setToast(`已擦除标注${labelSuffix} · ${coordinateName(position, boardSize)}`);
          else setToast(`标注${labelSuffix} 已从草稿擦除`);
        }
        return;
      }
    }
    if (mode === "review") {
      const previous = reviewMarks[reviewMarkKey] || [];
      const localHere = previous.some(samePoint);
      const nativeHere = nativeMarkAt(position);
      // 删除类点击不依赖标签文本；仅「放置新标注」要求已输入文字（全盘体检 P2-1：
      // 此前顶部空标签守卫会把三条删除路径一起挡死，自定义文字清空后删不动标注）。
      if (!localHere && !nativeHere && !currentAnnotationLabel) { setToast("请先在标注面板输入自定义文字"); return; }
      // 棋谱原有标注不能靠本机浮层盖掉再「还原」——点它就直接删除：切到编辑模式，
      // 把该点从棋谱 marks 里去掉（该节点已有的本机标注一并合入），由用户点顶栏保存落盘。
      // 大谱/DP/分页视图同语义：recordDraft 对只读数据库/分页视图会自动创建编辑副本
      // 再删（原库不变），不会落到下方「放置本机浮层」造成点已有标注却盖一层新标注
      // （用户 09-10 反馈：点已有标注=覆盖而非去掉）。
      if (nativeHere && !localHere) {
        const variationNode = nativeVariationAt(position);
        enterRecordForEdit();
        // 注意：enterRecordForEdit 只是 setMode("record")（异步生效），本闭包的
        // mode 仍是 review——不能走 recordDraft（其 review 守卫会静默丢弃删除）。
        // 按 recordDraft 同款分发：可编辑视图直接入草稿；只读数据库/分页视图
        // 自动创建编辑副本再删（原库不变）。
        const operation = variationNode
          ? { type: "update-node" as const, nodeId: variationNode.id, patch: { boardText: "" } }
          : { type: "update-node" as const, nodeId: currentId, patch: { marks: (current.marks || []).filter((mark) => !samePoint(mark)) } };
        if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) {
          if (hasDraft(draft)) setDraft((state) => pushDraft(state, operation));
          else detachViewForEditing(pushDraft(emptyDraft(), operation));
        } else {
          setDraft((state) => pushDraft(state, operation));
        }
        if (previous.length) setReviewMarks((all) => { const next = { ...all }; delete next[reviewMarkKey]; return next; });
        setToast(`已删除棋谱原有标注 ${coordinateName(position, boardSize)}，已切到编辑模式，点顶栏「保存棋谱」落盘`);
        return;
      }
      // 本机层一步取消：该点已有本机标注（任意内容）→ 移除；否则放置。
      const nextMarks = localHere ? previous.filter((mark) => !samePoint(mark)) : [...previous, { ...position, kind: "label" as const, label: currentAnnotationLabel, style: annotationStyle, color: annotationColor }];
      const next = { ...reviewMarks };
      if (nextMarks.length) next[reviewMarkKey] = nextMarks;
      else delete next[reviewMarkKey];
      setReviewMarks(next);
      setToast(localHere
        ? `已移除本机标注 · ${coordinateName(position, boardSize)}${nativeHere ? "，棋谱原有标注仍在（再点一次可删除它）" : ""}`
        : `已放置本机标注 ${currentAnnotationLabel} · ${coordinateName(position, boardSize)}，再次点击可移除`);
      return;
    }
    if (mode !== "record") return;
    const editingDatabaseView = isPagedLibraryView(document) || isDynamicDatabaseView(document);
    // 一步取消：该点已有任何标注（不论文字/样式，含变化点原生标注）→ 整点移除；空点 → 放置（需已输入文字，P2-1 同前）。
    const existingHere = nativeMarkAt(position);
    if (!existingHere && !currentAnnotationLabel) { setToast("请先在标注面板输入自定义文字"); return; }
    const variationNode = nativeVariationAt(position);
    if (variationNode && existingHere) {
      // 变化点上的原生标注在子节点 boardText——patch variationNode.id（applyCompactUpdate 写死 currentId）。
      recordDraft({ type: "update-node", nodeId: variationNode.id, patch: { boardText: "" } });
      if (editingDatabaseView) setToast(`已创建编辑副本并移除原生标注${labelSuffix} · ${coordinateName(position, boardSize)}`);
      else if (!isCompact()) setToast(`已移除原生标注${labelSuffix} · ${coordinateName(position, boardSize)}`);
      else setToast(`原生标注${labelSuffix} 已从草稿移除`);
      return;
    }
    const nextMarks = existingHere
      ? (current.marks || []).filter((mark) => !samePoint(mark))
      : [...(current.marks || []), { ...position, kind: "label" as const, label: currentAnnotationLabel, style: annotationStyle, color: annotationColor }];
    applyCompactUpdate({ marks: nextMarks });
    const removed = existingHere;
    const action = removed ? "已移除标注" : "已放置标注";
    if (editingDatabaseView) setToast(`已创建编辑副本并${removed ? "移除" : "放置"}标注${labelSuffix} · ${coordinateName(position, boardSize)}`);
    else if (!isCompact()) setToast(`${action}${labelSuffix} · ${coordinateName(position, boardSize)}${removed ? "" : "，再次点击可移除"}`);
    else setToast(`标注${labelSuffix} ${removed ? "已从草稿移除" : "已加入草稿"}`);
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
  // 去子：点棋盘上任意现存棋子直接删除。对带落子记录（手序/分支）的棋谱，首次
  // 删除先把局面拍平为静态 setup——重建文档去掉全部落子记录与分支（无分支、无
  // 手序；拍平本身不可撤销，这是去子功能的语义）；拍平后的每次删子走草稿
  // update-node，悔棋可逐步回退。
  const eraseStoneAt = (position: Position) => {
    const rootId = viewDocument.rootId;
    const root = viewDocument.nodes[rootId];
    if (!root) return;
    const hadLine = root.children.length > 0;
    if (hadLine) {
      // 拍平：先落定未保存草稿，再基于最终文档的当前局面重建静态 setup。
      const base = hasDraft(draft) ? applyDraftToDocument(document, draft.operations) : document;
      const baseBoard = boardAt(base, currentId);
      const flat: NonNullable<RecordNode["setup"]> = { black: [], white: [], empty: [], nextPlayer: "black" };
      baseBoard.forEach((row, r) => row.forEach((player, c) => {
        if (!player || (r === position.row && c === position.col)) return;
        flat[player].push({ row: r, col: c });
      }));
      flat.nextPlayer = flat.black.length > flat.white.length ? "white" : "black";
      const rootNode = base.nodes[rootId];
      const nextDoc = { ...base, nodes: { ...base.nodes, [rootId]: { ...rootNode, children: [], preferredChildId: undefined, move: null, setup: flat } } };
      setDocument(nextDoc); setCurrentId(rootId); setDraft(emptyDraft());
      recordSession.current = { document: nextDoc, currentId: rootId };
      setToast(`已删除 ${coordinateName(position)}；棋谱已转为无手序的静态局面`);
      return;
    }
    const setup: NonNullable<RecordNode["setup"]> = { black: [], white: [], empty: [], nextPlayer: "black" };
    board.forEach((row, r) => row.forEach((player, c) => {
      if (!player || (r === position.row && c === position.col)) return;
      setup[player].push({ row: r, col: c });
    }));
    setup.nextPlayer = setup.black.length > setup.white.length ? "white" : "black";
    recordDraft({ type: "update-node", nodeId: rootId, patch: { setup } });
    setCurrentId(rootId);
    recordSession.current = { document, currentId: rootId };
    setToast(`已删除 ${coordinateName(position)}`);
  };
  const toggleEraseStone = () => {
    if (aiGame) { setToast("人机对局中暂不能去子，请先退出对局"); return; }
    if (mode === "review") { reviewBlocked(); return; }
    const next = !eraseStone;
    setEraseStone(next);
    if (next) {
      exitAnnotationMode(); setAnnotationErase(false); setDockPanel(null);
      setToast("去子模式：点击棋盘上的棋子即可删除，点状态栏右侧「退出」结束");
    } else {
      setToast("已退出去子模式");
    }
  };
  const play = (position: Position, options: { ignoreAnnotation?: boolean } = {}) => {
    // 去子模式优先：点已有棋子=删除（无论哪一手），点空位=提示。与标注互斥
    // （进入去子时已退出标注），拦截放在所有落子/导航判定之前。
    if (eraseStone && mode === "record" && !aiGame) {
      const cell = board[position.row]?.[position.col];
      if (!cell) { playSound("warning"); showBoardFeedback(position, "illegal"); setToast("去子模式：请点击棋盘上已有的棋子"); return; }
      eraseStoneAt(position);
      return;
    }
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
      // 回退后的对局语义（用户 09-13 定案）：回退 = 回到「轮到自己」的局面，
      // 之后落子必须和正常对局完全一样——落在已有分支点上就是「重下这一步」，
      // 直接复用那个节点并让 AI 正常应手，绝不弹「修改分支」或只切光标不落子。
      // 旧实现把「已在树中」的点当成分支导航（只 setCurrentId + 提示），于是
      // 点分支点看似有反应却永远轮不到 AI，用户体感是「总让我修改分支」。
      const humanTurn = turn === aiGame.humanPlayer;
      if (historicalAiPosition) {
        // 已经在这个点上（回退后原地重下）：复用节点，继续让 AI 应手。
        const existingVariation = findVisibleVariationTarget(document, currentId, position);
        const existingChild = current.children
          .map((id) => document.nodes[id])
          .find((node) => node?.move && node.move.row === position.row && node.move.col === position.col);
        const resumeTarget = existingVariation?.target ?? existingChild;
        if (resumeTarget && humanTurn) {
          // 复用已有节点＝就是「下这一步」。光标推进到该节点，然后照常让 AI 应手，
          // 这样棋力与正常对局一致，也不会在树里重复造出同一个点的分支。
          setCurrentId(resumeTarget.id); triggerBoardMotion("place");
          playSound(aiGame.humanPlayer === "black" ? "move-black" : "move-white");
          setSheet(null);
          const resumedBoard = boardAt(document, resumeTarget.id);
          if (winnerAt(resumedBoard, position, document.metadata.rule)) {
            setAiGame((game) => game ? { ...game, outcome: "won" } : game);
            playSound("success"); setToast("你已连成五子，本局获胜");
            return;
          }
          if (resumedBoard.every((row) => row.every(Boolean))) {
            setAiGame((game) => game ? { ...game, outcome: "draw" } : game);
            setToast("棋盘已满，本局和棋");
            return;
          }
          // 树里若已有 AI 的应手，直接推进到它（避免重复思考）；没有才让引擎算。
          const aiChild = (document.nodes[resumeTarget.id]?.children ?? [])
            .map((id) => document.nodes[id])
            .find((node) => node?.move?.player === aiGame.aiPlayer);
          if (aiChild) {
            setCurrentId(aiChild.id); triggerBoardMotion("place");
            playSound(aiGame.aiPlayer === "black" ? "move-black" : "move-white");
            recordSession.current = { document, currentId: aiChild.id };
            const afterBoard = boardAt(document, aiChild.id);
            if (winnerAt(afterBoard, aiChild.move!, document.metadata.rule)) {
              setAiGame((game) => game ? { ...game, outcome: "lost" } : game);
              playSound("error"); setToast("AI 已连成五子，本局结束");
              return;
            }
            if (afterBoard.every((row) => row.every(Boolean))) {
              setAiGame((game) => game ? { ...game, outcome: "draw" } : game);
              setToast("棋盘已满，本局和棋");
              return;
            }
            recordSession.current = { document, currentId: aiChild.id };
            return;
          }
          recordSession.current = { document, currentId: resumeTarget.id };
          startAiGameReply(document, resumeTarget.id, aiGame.aiPlayer, aiGame);
          return;
        }
        // AI 方的替代分支：保留原行为，但不再是「修改分支」提示。
        if (resumeTarget && !humanTurn) {
          setCurrentId(resumeTarget.id); triggerBoardMotion("branch"); setSheet(null);
          setToast(`已回到这一步（${coordinateName(position)}），现在轮到你`);
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
      const battlePlayer = puzzleSideOverride ?? currentPuzzle.player;
      // 换边后与陪练对调执子方：非我方回合的点按直接挡掉，避免替陪练落子。
      if (nextPlayer !== battlePlayer) { showBoardFeedback(position, "illegal"); setToast("现在轮到陪练落子"); return; }
      const legality = puzzleMoveLegality(board, position, battlePlayer, currentPuzzleRule.mode);
      if (!legality.legal) {
        playSound(legality.reason === "该位置已有棋子" ? "error" : "warning");
        showBoardFeedback(position, legality.reason === "该位置已有棋子" ? "illegal" : "forbidden");
        setToast(legality.reason === "该位置已有棋子" ? legality.reason : `此处为黑方${legality.reason}，本题按禁手规则不可落子`);
        return;
      }
      const result = addMoveAs(document, currentId, position, battlePlayer);
      setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place"); playSound(battlePlayer === "black" ? "move-black" : "move-white");
      // 每次成功落子都记录一次尝试（用户 2026-09-10：点开一题打过就该出现在「最近棋题」，
      // 不必等到分胜负）；赢了补 solved。
      const win = Boolean(winnerAt(boardAt(result.document, result.nodeId), position, result.document.metadata.rule));
      recordPuzzleAttempt(win);
      if (win) { playSound("success"); setPuzzleOutcome("won"); return; }
      startAiReply(result.document, result.nodeId, { ...currentPuzzle, player: battlePlayer });
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
      let removed = false;
      setReviewMarks((allMarks) => {
        const previous = allMarks[reviewMarkKey] || [];
        removed = previous.some((mark) => mark.row === position.row && mark.col === position.col);
        const nextMarks = toggleMark(previous, position);
        const next = { ...allMarks };
        if (nextMarks.length) next[reviewMarkKey] = nextMarks;
        else delete next[reviewMarkKey];
        return next;
      });
      setToast(removed ? "已移除本机标注，原棋谱不变" : "已放置本机标注，原棋谱不变，再次长按可移除");
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
  const changeRecordRule = (rule: Extract<RuleSet, "freestyle" | "renju">) => {
    if (mode === "review") { setToast("读谱模式为只读，不能切换当前局面规则"); return; }
    if (aiGame) { setToast("人机对战请在开始对局前设置完整规则"); return; }
    updateMetadata({ rule, openingRule: "free", openingN: undefined });
    setToast(`当前局面已切换为${rule === "renju" ? "有禁" : "无禁"}`);
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
  const stopThink = () => {
    if (!thinkRunning) return;
    cancelActiveAiComputation("user", true);
    // 手动停止 = 关闭持续分析（F2，用户 09-12 授权按想法做）：开关从此永远等于
    // 真实状态，不再出现「开关显示开、实际没在算」。提示/自对弈的停止走
    // stopUnifiedThinking 的落子分支，不受影响。
    // 注意：不能走 changeEnhancementSettings——其「关闭」分支会回调 stopThink，
    // 而 thinkRunning 是异步 state（cancel 后闭包值仍 true）→ stopThink ↔
    // change 互递归爆栈（09-13 实测 RangeError）。这里直接置 state + 重置 refs
    //（useEffect 会照常持久化），语义与手动停止完全一致。
    if (getAnalysisMode(enhancementSettings) === "continuous" && enhancementSettings.analysisAuto) {
      autoAnalysisKey.current = currentPositionKey;
      analysisRoundRef.current = { key: "", count: 0 };
      setEnhancementSettings({ ...enhancementSettings, analysisAuto: false });
    }
  };
  const stopUnifiedThinking = () => {
    if (aiGame && aiThinking) { stopAiGameThinking(); return; }
    if (mode === "puzzle" && aiThinking) { stopPuzzleAi(); return; }
    if (thinkRunning) {
      // 提示/自对弈（落子型回合）：停止 = 先落当前最强点，再停（与 T29 人机同语义）。
      const live = analysisThinkLive.current;
      if (live?.best) {
        const best = live.best;
        analysisThinkLive.current = null;
        cancelActiveAiComputation("user");
        setToast(`已停止思考：落当前最强点 ${coordinateName(best)}`);
        play({ row: best.row, col: best.col });
        return;
      }
      // 快照还没来（刚开跑）：退 worker 端收尾——引擎完成当前迭代后交出 result，
      // accept 的 playMove 分支会把它落盘；3.5s 仍未回则回旧取消逻辑。
      // 落子型回合固定跑在分析 slot0（非 auto 不走乒乓）。
      if (live && (analysisPersistent.current[0]?.controller.requestResultOnStop() ?? false)) {
        setToast("已停止思考：AI 将落当前最强点");
        const stoppingId = live.requestId;
        window.setTimeout(() => {
          const now = analysisPersistent.current[0]?.controller.current;
          if (now && now.requestId === stoppingId) { analysisThinkLive.current = null; cancelActiveAiComputation("user", true); }
        }, 3500);
        return;
      }
      stopThink();
    }
  };
  const changeEnhancementSettings = (value: EnhancementSettings): boolean => {
    // 提示模式会改变分析主按钮的行为（不再展开面板），面板 segment、设置页、快捷
    // 中心三个入口都经过这里，共用同一次确认；取消则保持原模式、不产生任何副作用。
    if (value.analysisHintMode && !enhancementSettings.analysisHintMode && !window.confirm("开启提示？分析按钮将不再展开面板：点一下即为当前行棋方思考一手并直接落子（最多 10 秒，算出杀棋立刻落子）。之后可在快捷中心的「分析」里切回其他模式。")) return false;
    if (value.analysisAuto && !enhancementSettings.analysisAuto) { autoAnalysisKey.current = ""; analysisRoundRef.current = { key: "", count: 0 }; rapfiAnalysisBlockedRef.current = false; analysisPackNotifiedRef.current = false; }
    if (!value.analysisAuto && enhancementSettings.analysisAuto) {
      autoAnalysisKey.current = currentPositionKey;
      analysisRoundRef.current = { key: "", count: 0 };
      stopThink();
      // 自对弈进行中关掉「开启」：当前回合直接取消，不再落子。
      if (enhancementSettings.analysisSelfPlay && thinkRunning) cancelActiveAiComputation("settings-change");
    }
    if (value.analysisMaxMemoryMb !== enhancementSettings.analysisMaxMemoryMb) { engineMemoryRetryRef.current = null; gameMemoryRetryRef.current = null; }
    if (value.analysisCandidateCount !== enhancementSettings.analysisCandidateCount && thinkRunning) {
      autoAnalysisKey.current = "";
      cancelActiveAiComputation("settings-change");
    }
    // 离开自对弈模式时终止当前回合（落子守卫会阻止落子）；进入自对弈模式不再自动
    // 开轮——只有「开启」按钮（analysisAuto）打开时 effect 才逐回合落子。
    if (value.analysisSelfPlay !== enhancementSettings.analysisSelfPlay) {
      selfPlayKeyRef.current = "";
      if (!value.analysisSelfPlay && thinkRunning) cancelActiveAiComputation("settings-change");
      autoAnalysisKey.current = value.analysisSelfPlay ? currentPositionKey : "";
    }
    if (value.analysisQuickToggle !== enhancementSettings.analysisQuickToggle) applyAnalysisToggleLayout(value.analysisQuickToggle);
    setEnhancementSettings(value);
    return true;
  };
  // Click a candidate (panel button): pin its predicted line as a ghost
  // variation on the board; click again to unpin. The background analysis is
  // untouched — the preview resolves from the LIVE candidate list every
  // render, so it keeps deepening together with the ongoing search.
  const toggleCandidatePreview = (candidate: AiAnalysisCandidate) => {
    const active = analysisPreview && analysisPreview.contextKey === aiAnalysis.contextKey && analysisPreview.row === candidate.move.row && analysisPreview.col === candidate.move.col;
    setAnalysisPreview(active ? null : { contextKey: aiAnalysis.contextKey || currentPositionKey, row: candidate.move.row, col: candidate.move.col });
  };
  const analysisPreviewLine = analysisPreview && aiAnalysis.contextKey === analysisPreview.contextKey
    ? ((aiAnalysis.candidates || []).find((candidate) => candidate.move.row === analysisPreview.row && candidate.move.col === analysisPreview.col)?.principalVariation || []).slice(0, 24)
    : [];
  const toggleAnalysis = (enabled: boolean) => {
    if (enabled) autoAnalysisKey.current = "";
    else autoAnalysisKey.current = currentPositionKey;
    // 提示模式下打开「开启」= 切回持续分析模式（提示模式不跑后台滚动分析，见 withAnalysisMode）。
    changeEnhancementSettings(enabled && enhancementSettings.analysisHintMode
      ? withAnalysisMode({ ...enhancementSettings, analysisAuto: true }, "continuous")
      : { ...enhancementSettings, analysisAuto: enabled });
  };
  const startThink = (options: { auto?: boolean; continuous?: boolean; playMove?: "hint" | "selfplay"; timeMsOverride?: number } = {}) => {
    // 用户主动的落子型回合（提示/自对弈）可以打断正在跑的后台滚动分析：否则
    // 「提示模式下点分析没反应」——分析轮把请求静默吞掉（用户 09-10 反馈）。
    if (thinkRunning && !options.auto && !options.playMove) return;
    // 做题只放行「提示模式」这一种落子型请求（用户 2026-09-10）；持续分析/自对弈仍限打谱。
    const puzzleHint = mode === "puzzle" && options.playMove === "hint";
    if ((mode === "puzzle" && !puzzleHint) || aiGame) return;
    if ((viewDocument.metadata.boardSize || 15) !== 15) return;
    // 落子型回合（提示/自对弈）只在打谱（以及做题的提示）生效：读谱下 play() 会变成走子导航。
    if (options.playMove && mode !== "record" && !puzzleHint) return;
    cancelActiveAiComputation("superseded");
    const generation = ++thinkGeneration.current;
    setThinkRunning(true);
    // 引擎跟随设置：用户选强力/实验就用对应引擎（做题也不例外——用户 09-10
    // 明确不要掐算力）。冷加载由启动预热 effect 提前消化，点分析时引擎通常已就绪。
    let analysisPackUrl = engineNeedsPack(aiEngineChoice) ? enginePackUrlRef.current : null;
    // 本会话 rapfi 已持续失败（F1）：直接落轻量，不再触发「重建→崩→toast→轻量」
    // 连环；双槽已被 useFallback 清空，换面重启也不会再冷加载 40MB 包。
    if (rapfiAnalysisBlockedRef.current) analysisPackUrl = null;
    const analysisEngineVariant = engineVariantFor(aiEngineChoice, analysisPackUrl);
    // Re-runs on the same position keep the previous round's visible results
    // (rolling accumulation): a pass with a warm transposition table only
    // strengthens the numbers, it must never blank or reset them.
    setAiAnalysis((current) => current.contextKey === currentPositionKey
      ? { ...current, status: "thinking", engine: analysisEngineVariant, mover: nextPlayer }
      : { status: "thinking", engine: analysisEngineVariant, mover: nextPlayer, depth: 0, nodes: 0, contextKey: currentPositionKey });
    // 引擎 worker 槽：持续分析轮走双 worker 乒乓（slot0 主 / slot1 备）——落子/
    // 换手时旧轮 WASM 物理忙（cancel 消息排队），立即在空闲 slot 上开始真计算。
    // 轻量引擎双开（~5MB/个）；强力引擎启动时也已双预热（40MB×2 heap，低内存
    // 设备由 worker 内 chooseVariant 自动降级），同样乒乓。aiGame 人机对局另用
    // rapfiPersistentWorker（1895），与分析 slot 互不干扰。
    const thinkSlotKey = engineSlotKeyFor(aiEngineChoice, analysisPackUrl);
    const slots = analysisPersistent.current;
    const a = slots[0], b = slots[1];
    // 滚动续算（同面）：用上次的 slot，TT 继承；换手（key 已变）：优先另一
    // 个已加载的空闲 slot（terminate 重建的 slot 在 warmup，选中会冷等待）。
    const rolling = autoAnalysisKey.current === currentPositionKey;
    let slotIndex: number;
    if (rolling && slots[lastAnalysisSlot.current]) slotIndex = lastAnalysisSlot.current;
    else if (slots[1 - lastAnalysisSlot.current] && !slots[1 - lastAnalysisSlot.current]!.running) slotIndex = 1 - lastAnalysisSlot.current;
    else slotIndex = !a || !a.running ? 0 : b && !b.running ? 1 : 0;
    lastAnalysisSlot.current = slotIndex;
    let slot = slots[slotIndex];
    if (!slot || slot.key !== thinkSlotKey) {
      if (slot) slot.worker.terminate();
      const slotController = new AiWorkerController((discarded) => {
        const idx = analysisPersistent.current.findIndex((s) => s?.worker === discarded);
        if (idx >= 0) analysisPersistent.current[idx] = null;
      });
      slot = { worker: new Worker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`), key: thinkSlotKey, controller: slotController, running: false };
      analysisPersistent.current[slotIndex] = slot;
    }
    const worker = slot.worker;
    const controller = slot.controller;
    slot.running = true;
    rapfiThinkWorker.current = worker;
    const continuous = options.continuous === true || options.auto === true;
    const handle = controller.start(worker, "analysis", currentPositionKey, { persistent: true });
    // 只有落子型回合（提示/自对弈）需要「停止即落最强点」的快照。
    analysisThinkLive.current = options.playMove ? { requestId: handle.requestId, best: null } : null;
    taskManager.current.start({ kind: "ai", title: "AI 思考", taskId: handle.requestId, cancellable: true, retryable: true });
    taskManager.current.update({ stage: "searching", message: "正在寻找下一步" });
    const accept = (result: AiMoveResult) => {
      if (generation !== thinkGeneration.current || !controller.isCurrent(handle)) {
        // 旧轮收尾（被 supersede/position-change 顶掉）：物理搜索已结束，清忙标
        if (slotIndex >= 0) { const entry = analysisPersistent.current[slotIndex]; if (entry?.worker === worker) entry.running = false; }
        return;
      }
      controller.finish(handle);
      if (slotIndex >= 0) { const entry = analysisPersistent.current[slotIndex]; if (entry?.worker === worker) entry.running = false; }
      analysisThinkLive.current = null;
      thinkWorker.current = null; rapfiThinkWorker.current = null; setThinkRunning(false);
      // KataGo 式单调流：滚动轮 accept 时 depth/nodes 只涨不跌（max 合并），
      // 否则每 2s 一轮 accept 会把数字打回该轮起点——用户看到深度 21→18、
      // 节点 85 万→14 万周期性回跳（09-11 观察探针实锤）。换面时 contextKey
      // 变化会整体重置，同面内数字保持单调。
      setAiAnalysis((current) => ({ ...current, status: result.move ? "complete" : "error", engine: aiAnalysisEngineRef.current, depth: Math.max(result.depth || 0, current.depth || 0), nodes: Math.max(result.nodes || 0, current.nodes || 0), score: result.score, scoreAvailable: result.scoreAvailable, winRate: result.winRate !== undefined ? result.winRate : current.winRate, move: result.move, candidates: result.candidates?.length ? result.candidates : current.candidates, principalVariation: result.principalVariation, elapsedMs: result.elapsedMs }));
      if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.success(result);
      // 提示模式 / 自对弈：把这一回合引擎认定的最佳点直接落盘。杀棋即落由
      // finishOnBareMove/stopOnProvenWin 在 worker 侧保证（有界回合到 timeout 也
      // 交终局）。自对弈额外校验开关仍是开着的——用户中途关掉就不会多落一子。
      if (options.playMove && result.move && !(options.playMove === "selfplay" && !selfPlayRef.current)) {
        const engineMove = result.move;
        play({ row: engineMove.row, col: engineMove.col });
      }
      // Rolling re-analysis: with the warm transposition table each extra pass
      // starts deeper, so the displayed win rate and candidates keep improving
      // until the position changes or auto-analysis is switched off. 间隙 150→0：
      // 消除每轮 accept 后思考指示的 idle 闪烁（用户 09-11 观察实锤 2s 一眨眼）。
      if (options.auto && enhancementSettings.analysisAuto && !enhancementSettings.analysisSelfPlay) {
        window.setTimeout(() => {
          if (thinkGeneration.current === generation && autoAnalysisKey.current === currentPositionKey && !aiGame) startThink({ auto: true, continuous: true });
        }, 0);
      }
    };
    const useFallback = () => {
      if (generation !== thinkGeneration.current || !controller.isCurrent(handle)) return;
      const fallback = new PuzzleAiWorker();
      if (!controller.replaceWorker(handle, fallback)) return;
      // 回切轻量必须提示（用户 09-13）：高内存档下根因大概率是引擎分配失败。
      setToast(enhancementSettings.analysisMaxMemoryMb >= 1024 ? "AI 引擎未能分配内存，已改用轻量引擎；可调低「分析内存」后重试" : "AI 引擎异常，已改用轻量引擎");
      // 自研兜底引擎替换 rapfi worker：轻量双 slot 全清空——本会话锁轻量
      // （rapfiAnalysisBlockedRef），后续轮次/换面不再重建 rapfi 槽（F1：
      // 原实现每轮重试→崩溃→toast 连环 + 反复 40MB 冷加载）。引擎包仍坏时
      // 由 startThink 的 blocked 分支直接用轻量，不再打 rapfi。
      rapfiAnalysisBlockedRef.current = true;
      analysisPersistent.current[0] = null;
      analysisPersistent.current[1] = null;
      aiAnalysisEngineRef.current = "light";
      setAiAnalysis((current) => ({ ...current, engine: "light" }));
      rapfiThinkWorker.current = null;
      thinkWorker.current = fallback;
      fallback.onmessage = (event: MessageEvent<AiMoveResult & { requestId?: string; generation?: number; result?: AiMoveResult }>) => {
        const requestId = event.data.requestId || handle.requestId;
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current || !controller.isCurrent(handle, requestId, event.data.generation ?? handle.generation)) return;
        accept(event.data.result || event.data);
      };
      fallback.onerror = () => {
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current || !controller.isCurrent(handle)) return;
        controller.finish(handle); thinkWorker.current = null; setThinkRunning(false); setToast("AI 分析线程异常，请重试");
        if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.fail(new Error("AI 思考线程异常"));
      };
      fallback.postMessage({ requestId: handle.requestId, generation: handle.generation, board, player: nextPlayer, rule: viewDocument.metadata.rule, purpose: "think" });
    };
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: string; generation?: number; result?: AiMoveResult; message?: string; variant?: string; depth?: number; nodes?: number; score?: number; winRate?: number; candidates?: AiAnalysisCandidate[] }>) => {
      if (generation !== thinkGeneration.current || !controller.isCurrent(handle, event.data.requestId || handle.requestId, event.data.generation ?? handle.generation)) return;
      // O1：持续分析模式下强力未就绪的一次性提示（用户选了强力但实际在跑轻量）。
      // blocked 场景已在 useFallback 弹过、提示模式由 runHintMove 先行提示，不重复。
      if (!options.playMove && engineNeedsPack(aiEngineChoice) && !rapfiAnalysisBlockedRef.current && (event.data.type === "progress" || event.data.type === "result") && event.data.variant === "fallback" && !analysisPackNotifiedRef.current) {
        analysisPackNotifiedRef.current = true;
        setToast("强力引擎未就绪，当前用轻量引擎计算；可在设置中下载引擎包");
      }
      // 提示/自对弈：用 progress 的 PV0 维护「当前最强点」快照（停止时直接落它）。
      if (event.data.type === "progress" && analysisThinkLive.current && analysisThinkLive.current.requestId === (event.data.requestId || handle.requestId)) {
        const first = event.data.candidates?.[0]?.move;
        if (first) analysisThinkLive.current.best = { row: first.row, col: first.col };
      }
      if (event.data.type === "progress") setAiAnalysis((current) => {
        // 只覆盖本消息带了的字段，绝不回退 depth/nodes（max 合并保单调）——
        // 旧轮结论是新轮爬升期的上界，回跳会让用户看到 21→18 的假退步（09-11
        // 实锤）。旧实现深度低于峰值时整体冻结面板（节点卡 10 万不动，09-12 手机
        // 反馈），现在候选/胜率/节点照常流动，只有 depth/nodes 数字保持峰值。
        return { ...current, status: "thinking", engine: event.data.variant === "full" ? "full" : "light", depth: Math.max(event.data.depth || 0, current.depth || 0), nodes: Math.max(event.data.nodes || 0, current.nodes || 0), score: event.data.score !== undefined ? event.data.score : current.score, scoreAvailable: event.data.score !== undefined || current.scoreAvailable, winRate: event.data.winRate !== undefined ? event.data.winRate : current.winRate, candidates: event.data.candidates?.length ? event.data.candidates : current.candidates };
      });
      else if (event.data.type === "result" && event.data.result) accept(event.data.result);
      else if (event.data.type === "error") {
        // 高档内存分配失败（引擎退出）→ 先降 256MB 重试一次强力，别再直接换轻量
        // （09-12 用户「自设拉满节点显示冻结」根因；换轻量后自研兜底无 progress）。
        const usedMem = engineMemoryRetryRef.current ?? engineMemoryMbFor(aiEngineChoice, enhancementSettings.analysisMaxMemoryMb) ?? 0;
        if (usedMem > 256 && !engineMemoryRetryRef.current) {
          engineMemoryRetryRef.current = 256;
          setToast("AI 引擎内存分配失败，已自动降至 256MB 重试");
          cancelActiveAiComputation("settings-change");
          window.setTimeout(() => startThink(options), 0);
          return;
        }
        useFallback();
      }
    };
    worker.onerror = () => { if (generation !== thinkGeneration.current || !controller.isCurrent(handle)) return; useFallback(); };
    // The engine only sees the position through the move stream, so stones that
    // live in node.setup (图片识谱 static positions, SGF AB/AW setups) must travel
    // with it — otherwise分析拿到的是空棋盘（复现：识谱 8 子，moves=0，回天元）。
    // canonicalBoardMoves 会把任意颜色石子袋重排成引擎要求的 SELF/OPPO 流。
    const moves = pathToNode(viewDocument, currentId).flatMap((node) => [
      ...(node.setup?.black ?? []).map((point) => ({ row: point.row, col: point.col, player: "black" as const })),
      ...(node.setup?.white ?? []).map((point) => ({ row: point.row, col: point.col, player: "white" as const })),
      ...(node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []),
    ]);
    aiAnalysisEngineRef.current = analysisEngineVariant;
    setAiAnalysis((current) => ({ ...current, engine: aiAnalysisEngineRef.current }));
    worker.postMessage({ type: "analyze", requestId: handle.requestId, generation: handle.generation, engine: analysisPackUrl ? "auto" : "fallback", dataUrl: analysisPackUrl || undefined, size: viewDocument.metadata.boardSize || 15, moves, player: nextPlayer, rule: viewDocument.metadata.rule, timeMs: options.timeMsOverride ?? (continuous ? continuousBudgetMs(currentPositionKey) : enhancementSettings.analysisTimeMs), maxDepth: continuous ? 512 : options.playMove ? 64 : 96, topN: options.playMove ? 1 : enhancementSettings.analysisCandidateCount, finishOnBareMove: !continuous, stopOnProvenWin: !continuous, continuous, maxMemoryMb: engineMemoryRetryRef.current ?? engineMemoryMbFor(aiEngineChoice, enhancementSettings.analysisMaxMemoryMb) });
  };
  // 提示模式：不展开分析面板，点一下就是「为当前行棋方想一手」——有界 10s、
  // 引擎宣告杀棋立刻落子；落子走 play() 正常通路（禁手/音/动画/终局检测全复用）。
  const runHintMove = () => {
    if (aiGame || (mode !== "record" && mode !== "puzzle")) { setToast("提示需要在打谱或做题中使用"); return; }
    if (mode === "puzzle" && puzzleSetup) { setToast("摆棋中不能用提示，请先点「应战」"); return; }
    if (mode === "puzzle" && (aiThinking || puzzleOutcome)) { setToast(puzzleOutcome ? "本题已结束，可悔棋或下一题" : "陪练正在思考"); return; }
    // 后台分析在跑也照样响应用户：startThink 会打断旧轮（见其上守卫）。
    if (mode === "record" && selfPlayRef.current) return;
    if (!enginePackUrlRef.current && engineNeedsPack(aiEngineChoice)) setToast("强力引擎包未就绪，将使用轻量引擎");
    setPlacementLocked(false);
    setDockPanel(null);
    startThink({ playMove: "hint", timeMsOverride: PUZZLE_HINT_THINK_TIME_MS });
  };
  useEffect(() => { selfPlayRef.current = enhancementSettings.analysisAuto && enhancementSettings.analysisSelfPlay; }, [enhancementSettings.analysisAuto, enhancementSettings.analysisSelfPlay]);
  // 自对弈：开关开着就为「当前局面」发回合；play() 换面后 effect 自动续下一回合，
  // 直到五连/满盘终局（自动关开关）。持续分析的滚动在开关开启时让位（见 effect 守卫）。
  useEffect(() => {
    // 只有「开启」按钮打开（analysisAuto）且模式为自对弈时才逐回合落子；
    // 仅在模式选择器里选中自对弈不会启动。
    if (!(enhancementSettings.analysisAuto && enhancementSettings.analysisSelfPlay) || enhancementSettings.analysisHintMode) { selfPlayKeyRef.current = ""; return; }
    if (tab !== "record" || mode !== "record" || aiGame) return;
    if ((viewDocument.metadata.boardSize || 15) !== 15) return;
    if (thinkRunning || aiThinking) return;
    const gameOver = boardWinningLines.length > 0 || board.every((row) => row.every(Boolean));
    if (gameOver) {
      // 终局即全停：开关关闭、模式回到持续分析（不会转头又开始滚动分析）。
      changeEnhancementSettings({ ...enhancementSettings, analysisSelfPlay: false, analysisAuto: false });
      setToast(boardWinningLines.length > 0 ? "自对弈结束：五连达成" : "自对弈结束：棋盘已满");
      return;
    }
    if (selfPlayKeyRef.current === currentPositionKey) return;
    selfPlayKeyRef.current = currentPositionKey;
    const timer = window.setTimeout(() => { setPlacementLocked(false); startThink({ playMove: "selfplay", timeMsOverride: enhancementSettings.analysisSelfPlayTimeMs }); }, 200);
    return () => window.clearTimeout(timer);
  }, [enhancementSettings.analysisAuto, enhancementSettings.analysisSelfPlay, enhancementSettings.analysisSelfPlayTimeMs, tab, mode, aiGame, viewDocument, currentPositionKey, thinkRunning, aiThinking, boardWinningLines.length, board]);
  useEffect(() => {
    if (!enhancementSettings.analysisAuto) { autoAnalysisKey.current = ""; return undefined; }
    // 提示模式不跑后台滚动分析（09-10 用户反馈）：那边的「分析」是手动点一下想一手。
    if (tab !== "record" || mode === "puzzle" || aiGame || aiThinking || enhancementSettings.analysisSelfPlay || enhancementSettings.analysisHintMode || (engineNeedsPack(aiEngineChoice) && !enginePackReady) || autoAnalysisKey.current === currentPositionKey) return undefined;
    // 换手/换面时旧局面还在滚（thinkRunning）：旧轮结果已无意义——只 terminate
    // 正在跑的 slot（stop 消息会被 WASM 同步搜索阻塞排队，实测旧轮预算到点仍
    // 不返回，等它自然收尾要 2s+）；空闲 slot 保留（已预热加载，强力引擎避免
    // 40MB 冷加载），被终止的 slot 立即后台重建（warmup）供下次换手乒乓。
    // 滚动续算（同面）不触发此分支，TT 保留。
    if (thinkRunning) {
      // F1 锁轻量中：槽位已被 useFallback 清空、startThink 直接走轻量——这里
      // 不做任何 rebuild（否则又起两个 rapfi 冷加载后台空转 80MB）。
      if (!rapfiAnalysisBlockedRef.current) {
        const packUrl = engineNeedsPack(aiEngineChoice) ? enginePackUrlRef.current : null;
        const slotKey = engineSlotKeyFor(aiEngineChoice, packUrl);
        const warmupEngine = engineVariantFor(aiEngineChoice, packUrl);
        for (let i = 0; i < analysisPersistent.current.length; i += 1) {
          const slot = analysisPersistent.current[i];
          if (slot?.running) {
            slot.worker.terminate();
            const slotController = new AiWorkerController((discarded) => {
              const idx = analysisPersistent.current.findIndex((s) => s?.worker === discarded);
              if (idx >= 0) analysisPersistent.current[idx] = null;
            });
            const rebuilt = new Worker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`);
            rebuilt.postMessage({ type: "warmup", engine: warmupEngine, dataUrl: packUrl || undefined });
            analysisPersistent.current[i] = { worker: rebuilt, key: slotKey, controller: slotController, running: false };
          }
        }
      }
      cancelActiveAiComputation("position-change");
    }
    const timer = window.setTimeout(() => {
      if (aiGame || aiThinking) return;
      autoAnalysisKey.current = currentPositionKey;
      startThink({ auto: true, continuous: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentPositionKey, enhancementSettings.analysisAuto, enhancementSettings.analysisCandidateCount, enhancementSettings.analysisSelfPlay, tab, mode, aiGame, aiThinking, thinkRunning, aiEngineChoice, enginePackReady]);
  useEffect(() => {
    if (!enhancementSettings.analysisAuto || !engineNeedsPack(aiEngineChoice) || !enginePackReady) return;
    // 引擎包下载完成 = 可重试 rapfi（解开会话级锁轻量）。
    rapfiAnalysisBlockedRef.current = false;
    autoAnalysisKey.current = "";
    if (aiWorkerController.current.current?.kind === "analysis") cancelActiveAiComputation("settings-change");
  }, [enginePackReady]);
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
    // 人机对战的回退语义（用户 09-13 定案）：退完必须落在「轮到自己」的局面。
    // 一次「悔棋」＝退回自己上一手之前（即连着退掉 AI 的应手 + 自己的落子，
    // 最多两步），否则会停在“轮到 AI 却没有任何动静”的僵尸局面——用户看到的
    // 就是「回退后总让我处理分支」。停在非自己回合时继续往回退，直到轮到自己
    // 或到达起点。
    if (aiGame && !aiGame.outcome && current.parentId) {
      let cursorId = current.parentId;
      for (let guard = 0; guard < 4; guard += 1) {
        if (nextPlayerAt(document, cursorId) === aiGame.humanPlayer) break;
        const parent = document.nodes[cursorId]?.parentId;
        if (!parent) break;
        cursorId = parent;
      }
      setCurrentId(cursorId);
      recordSession.current = { document, currentId: cursorId };
      return;
    }
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
  // 分支书签区（棋谱库）的管理：操作任意棋谱的书签（不依赖当前打开的谱）。
  const editAnyBookmark = (documentId: string, bookmark: RecordBookmark, patch: Partial<Pick<RecordBookmark, "title" | "note" | "accent">>) => {
    setBranchBookmarks((all) => ({ ...all, [documentId]: updateRecordBookmark(all[documentId] || [], bookmark.id, patch) }));
    setToast("书签已更新");
  };
  const deleteAnyBookmark = (documentId: string, bookmark: RecordBookmark) => {
    setBranchBookmarks((all) => {
      const next = { ...all };
      const rest = (all[documentId] || []).filter((item) => item.id !== bookmark.id);
      if (rest.length) next[documentId] = rest;
      else delete next[documentId];
      return next;
    });
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
  // 图片识谱选图：Android 走系统相册选择器（默认停在相册，用户仍可在系统 UI 里
  // 切到其他图库/文件夹），其他环境回退到原生 <input type="file">。用户取消时
  // 原生侧 reject，这里静默忽略、不产生任何副作用。
  const openImageImportPicker = () => withDraftGuard(() => {
    if (!supportsNativePhotoPicker()) { imageFileInput.current?.click(); return; }
    void pickBoardImageFile().then((file) => { if (file) beginBoardImageImport(file); });
  });
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
      withDraftGuard(() => beginBoardImageImport(file));
    };
    const onDragOver = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const file = boardImageFromDataTransfer(event.dataTransfer);
      if (!file) return;
      event.preventDefault();
      withDraftGuard(() => beginBoardImageImport(file));
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
    if (engineNeedsPack(aiEngineChoice) && !enginePackState) setToast("强力引擎包尚未下载，本局先用轻量引擎；可在设置或对局设置里下载");
    const game: AiGameState = { humanPlayer: aiHumanPlayer, aiPlayer: otherPlayer(aiHumanPlayer), strength: aiStrength, forbiddenEnabled: aiRuleFamily === "renju", timeLimitMs: aiTimeLimitMs, thinkTimeMs: thinkProfile.timeMs, thinkDepth: thinkProfile.maxDepth, unlimitedThinking: aiStrength === "自由" && aiFreeUnlimited, outcome: null, opening, engineChoice: engineNeedsPack(aiEngineChoice) && !enginePackState ? "light" : aiEngineChoice };
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
    setFavorites((current) => pruneFavorites(current, [item.id], [], []));
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
      setFavorites((current) => pruneFavorites(current, [item.id], [], []));
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
    setFavorites((current) => pruneFavorites(current, [], [collection.id], collection.puzzles.map((puzzle) => [collection.id, puzzle.id] as [string, string])));
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
  // 文件夹置顶：把该文件夹移到同级的第一个位置（写入 order 桶，与拖拽同机制）。
  const pinFolderToTop = (kind: "recordFolders" | "puzzleFolders", folder: string) => {
    const allFolders = kind === "recordFolders" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders;
    const parent = folderParent(folder);
    const siblings = folderChildren(allFolders, parent);
    if (siblings.length < 2 || siblings[0] === folder) return;
    const ordered = applyOrder(siblings, libraryFolders.order?.[kind]?.[parent]);
    const next = [folder, ...ordered.filter((entry) => entry !== folder)];
    updateLibraryOrder(kind, parent, next);
    setExpandedLibraryFolders((current) => new Set([...current, folder]));
    setToast(`已将“${folderLabel(folder)}”置顶`);
  };
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
  const beginBoardImageImport = (file?: File) => {
    if (!file) return;
    setImageImportPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setRestoreMoveOrder(false);
    setImageImportPreview({ file, url: URL.createObjectURL(file), name: file.name });
    setSheet("imageImport");
  };

  const closeImageImportSheet = () => {
    setImageImportPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setSheet(null);
  };

  // restoreMoveOrder (default off): rebuild the game from move 1 to N using
  // the numbers printed on the stones instead of importing only the final
  // position. Requires every stone to carry a legible, complete 1..N number.
  const runBoardImageRecognition = async (file: File, displayName: string, opts: { restoreMoveOrder?: boolean; roi?: BoardRoi } = {}) => {
    cancelActiveAiComputation("record-switch");
    setImageRecognizing(true);
    recordAction(`图片识谱：${displayName}`);
    // 15路 only: the app's board is 15x15. Trying other sizes let a wrong-size
    // guess (grid not detected, UI chrome misread as stones) out-rank the real
    // board by raw stone count — so recognize 15路 directly and skip the rest.
    const progressId = beginImportProgress(displayName, "正在识别棋盘图片");
    setSheet(null);
    try {
      // 把送进识别器的文件信息显示出来：相册选择器/聊天软件有时会转码或缩放，
      // 远程排查「同一张图手机与电脑结果不同」时这行就是最直接的证据。
      // 像素尺寸必须一起显示：识别器只看这份解码结果（长边超 1600px 会被缩放），
      // 实测同一张图重压到 q0.6、或缩到 500px 以下就会开始掉子/丢序号，所以
      // 「手机到底交了多少像素」是判断设备差异的第一手数据，不能靠猜。
      const decodedSize = await describeImageSize(file);
      updateImportProgress(progressId, { phase: "parsing", detail: `按 15 路识别棋盘 · ${file.name.slice(0, 24)} · ${file.type || "?"} · ${Math.round(file.size / 1024)}KB${decodedSize ? ` · ${decodedSize}` : ""}`, progress: 0 });
      // 只有勾选「复原手序」（且实验开关开启）才需要逐手序号；默认静态局面导入
      // 直接跳过序号匹配——那是整条识别管线最重的部分（40% 耗时）。
      // parallel：设置「可选增强功能 · 识谱多核加速」（默认开）。开时网格探测与
      // 逐格分析跑在 worker 池上、界面不冻结，结果与单线程逐位相同；关时回落单线程。
      const result = await recognizeBoardImage(file, 15, { skipMoveOrder: !opts.restoreMoveOrder, roi: opts.roi, parallel: enhancementSettings.fastRecognition });
      const stones = result.board.flat().filter(Boolean).length;
      if (stones < 4) {
        throw new Error("没有在图片中找到可靠棋子，请确认截图包含完整棋盘");
      }
      const next = createDocument(displayName.replace(/\.[^.]+$/, "") || "图片识谱", result.boardSize);
      const occupiedCells = result.board.flat().filter(Boolean).length;
      // When every recognized stone carries a legible move number and the
      // numbers form the complete sequence 1..N, rebuild the move sequence
      // instead of a static setup so打谱/复盘功能(手数、悔棋)可用. A single
      // misread number would scramble history, so gaps or duplicates fall
      // back to the plain position.
      const numbers = result.numberedMoves.map((move) => move.number).sort((a, b) => a - b);
      const completeSequence = occupiedCells > 0 && result.numberedMoves.length === occupiedCells
        && numbers.every((value, index) => value === index + 1);
      const restoreFromNumbers = opts.restoreMoveOrder === true && completeSequence;
      // addMoveAs is immutable-style — each call returns a NEW document. The
      // loop must carry that document forward; adding every stone against the
      // original (empty) `next` silently dropped the whole sequence after the
      // first stone, importing a blank board.
      let importedDocument = next;
      if (restoreFromNumbers) {
        let currentId = next.rootId;
        for (const move of result.numberedMoves) {
          const added = addMoveAs(importedDocument, currentId, move, move.player);
          if (!added.created) break;
          importedDocument = added.document;
          currentId = added.nodeId;
        }
      } else {
        const root = next.nodes[next.rootId];
        root.setup = { black: [], white: [], empty: [], nextPlayer: "black" };
        result.board.forEach((row, r) => row.forEach((player, c) => { if (player) root.setup?.[player].push({ row: r, col: c }); }));
        // 同上：静态局面的行棋方按黑白子数奇偶推出（SGF PL 语义）。
        root.setup.nextPlayer = (root.setup.black.length > root.setup.white.length) ? "white" : "black";
      }
      performOpenRecord(importedDocument);
      setSaved(false);
      finishImportProgress(progressId, `${result.boardSize} 路识谱完成：识别 ${occupiedCells} 子`);
      setToast(`${result.boardSize}路图片识谱完成：识别 ${occupiedCells} 子，置信度 ${Math.round(result.confidence * 100)}%${result.ignoredColoredMarkers ? `，忽略 ${result.ignoredColoredMarkers} 个彩色分析点` : ""}${restoreFromNumbers
        ? `；已按序号复原第 1 手到第 ${result.numberedMoves.length} 手的完整落子顺序`
        : opts.restoreMoveOrder
          ? `；「复原手序」未生效：${result.numberedMoves.length === 0 ? "未检测到手数标记" : `仅识别到 ${result.numberedMoves.length}/${occupiedCells} 个序号`}，需每颗子带清晰连续的 1..N 数字，已按局面导入`
          : completeSequence && enhancementSettings.devMoveOrderRestore ? "；图中带完整序号，可开启「复原手序」重建落子顺序" : ""}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "图片识谱失败，请使用清晰的棋盘截图";
      failImportProgress(progressId, detail);
    } finally { setImageRecognizing(false); }
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
    const destination = defaultDirectory || (supportsNativeExportDirectory() ? await defaultNativeExportHandle() : null);
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
  // A dynamic library view only projects the currently loaded path and branch
  // set; exporting LIB/PSQ from an untouched view would silently drop the rest
  // of the original library. Editing (draft) makes the visible tree the intent.
  const dynamicViewEdited = exportsVisibleDatabaseContent && hasDraft(draft);
  const binaryExportBlocked = exportsVisibleDatabaseContent && !dynamicViewEdited;
  // Recommend the record's own format: its icon enlarges so users keep lossless
  // round-trips by default. pos/txt/db/dp have no grid button and highlight the
  // direct-export card instead.
  const recommendedFormat: "sgf" | "json" | "lib" | "psq" | "db" | null = !sourceFormat ? null
    : sourceFormat === "lib" ? "lib"
    : sourceFormat === "psq" ? "psq"
    : sourceFormat === "json" || sourceFormat === "renju" ? "json"
    : sgfSourceFormats.has(sourceFormat) ? "sgf"
    // DB / DP 局面数据库只能原样导出：推荐落在网格里的 DB 按钮上（用户 09-13：
    // 此前只标了下方「原格式直接导出」卡片，网格里的 DB 按钮又被禁用，看起来像没生效）。
    : binarySourceFormats.has(sourceFormat) ? "db"
    : null;
  const recommendDirect = Boolean(sourceFormat && (posSourceFormats.has(sourceFormat) || binarySourceFormats.has(sourceFormat)));
  const fidelityNote = exportScope !== "whole"
    ? "LIB 与 PSQ 需“整份棋谱”范围；LIB / SGF / JSON 互转保留变化树与注释，PSQ / POS 只保留主线。"
    : !sourceFormat
    ? "LIB / SGF / JSON 互转保留变化树与注释；PSQ / POS 只保留主线。"
    : sourceFormat === "lib"
    ? "原谱是 LIB：动态视图只含当前可见分支与主线注释；完整原库请用“原格式直接导出”。"
    : sgfSourceFormats.has(sourceFormat) || sourceFormat === "json" || sourceFormat === "renju"
    ? "注释与变化树可完整转入 LIB / SGF / JSON；盘面标记在 LIB 中合并为标记位；PSQ / POS 只保留主线。"
    : "LIB / SGF / JSON 互转保留变化树与注释；PSQ / POS 只保留主线。";;
  const directExportAvailable = !sourceFormat
    || Boolean(sourceFormat && (sgfSourceFormats.has(sourceFormat) || jsonSourceFormats.has(sourceFormat) || posSourceFormats.has(sourceFormat)))
    || Boolean(originalBinaryFile);
  const directFormatLabel = !sourceFormat ? "SGF（新棋谱默认）"
    : sgfSourceFormats.has(sourceFormat) ? sourceFormat.toUpperCase()
    : jsonSourceFormats.has(sourceFormat) ? `${sourceFormat.toUpperCase()} JSON`
    : posSourceFormats.has(sourceFormat) ? sourceFormat.toUpperCase()
    : originalBinaryFile ? sourceFormat.toUpperCase() : `${sourceFormat.toUpperCase()}（原文件未保留）`;
  // 导出并分享（用户 09-14 要求，对齐智子的"导出即分享"）：与「分享图片」并列，
  // 把棋谱**文件**直接交给系统分享面板。默认用 SGF——它是跨软件最通用的谱文件
  // （智子/爱五子棋/Gomocup 都能打开），比图片更有用（对方可继续打谱）。
  // 复用已有的 sharePngFile：它先试 Web Share API，再退回 Capacitor 写缓存+分享。
  const shareRecordFile = async () => {
    try {
      const title = exportDocument.metadata.title?.trim() || "半步五子棋打谱";
      const file = new File([exportSgf(exportDocument)], `${title}.sgf`, { type: "application/x-go-sgf" });
      const outcome = await sharePngFile(file, title, "半步五子棋打谱 · SGF 棋谱");
      if (outcome === "shared") setToast("已分享棋谱文件");
      else if (outcome === "unavailable") setToast("当前环境不支持直接分享文件，请用下方格式导出后再手动分享");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "分享失败，请改用下方格式导出");
    }
  };
  const exportAsFormat = (format: "sgf" | "json" | "lib" | "psq" | "fgf" | "ren" | "renjs" | "wzq") => {
    const name = `${safeName(exportDocument.metadata.title)}-${exportScopeSuffix(exportScope)}`;
    if (format === "sgf" || format === "fgf" || format === "ren" || format === "renjs" || format === "wzq") {
      const extension = format === "sgf" ? "sgf" : format;
      void exportRecordFile(exportSgf(scopedExportDocument), `${name}.${extension}`, "application/x-go-sgf;charset=utf-8", `${exportScopeSuffix(exportScope)} ${extension.toUpperCase()} 已导出`);
      return;
    }
    if (format === "lib") {
      try {
        const result = exportLib(scopedExportDocument);
        void exportRecordFile(result.bytes, `${name}.lib`, "application/octet-stream", `${exportScopeSuffix(exportScope)} LIB 已导出`);
        for (const warning of result.warnings) setToast(warning);
        if (dynamicViewEdited) setToast("已导出当前可见分支（含编辑）；原库的其余分支未包含在 LIB 中");
        return;
      } catch (error) {
        setToast(error instanceof Error ? error.message : "LIB 导出失败");
        return;
      }
    }
    if (format === "psq") {
      void exportRecordFile(exportPsq(scopedExportDocument), `${name}.psq`, "text/plain;charset=utf-8", `${exportScopeSuffix(exportScope)} PSQ 已导出`);
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
    setSheet("export");
  };

  const sheetTitle = sheet === "comment" ? "节点注释" : sheet === "branches" ? "变化分支" : sheet === "tree" ? "棋谱树" : sheet === "metadata" ? "棋谱信息" : sheet === "save" ? "保存棋谱" : sheet === "folder" ? (folderSheetMode === "batch-move" ? "移动棋谱" : `新建${folderCreationSection === "records" ? "棋谱" : "题库"}文件夹`) : sheet === "rename" ? "重命名" : sheet === "export" ? "导出与分享" : sheet === "manual" ? "使用手册" : sheet === "rules" ? "规则说明" : sheet === "about" ? "关于半步五子棋打谱" : sheet === "feedback" ? "反馈与建议" : sheet === "find" ? "查找本谱" : sheet === "positionSearch" ? "跨谱局面检索" : sheet === "import" ? "选择导入方式" : sheet === "aiGame" ? "AI 人机对战" : sheet === "fifthCount" ? "选择五手打数量" : sheet === "wrongbook" ? "错题本" : sheet === "bookmarks" ? "分支书签" : sheet === "favorites" ? "收藏棋谱" : sheet === "puzzleFavorites" ? "收藏题集" : sheet === "trash" ? "回收站" : sheet === "dataSafety" ? "资料安全" : sheet === "batchEdit" ? "批量处理" : "使用提示";
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
    if (annotationPopover) { setAnnotationPopover(null); return true; }
    if (dockPanel) { setDockPanel(null); return true; }
    if (tab !== "record") { setTab("record"); return; }
    setToast(ROOT_BACK_MESSAGE);
  });
  const playbackBlocked = mode !== "review" || Boolean(aiGame) || machineThinking || dynamicNavigationBusy || layoutEditorOpen;
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
  // 手册目录引导（用户 09-12）：从手册某章启动联动式引导；引导期间功能区走默认布局，
  // 完成后重新打开手册并聚焦到该章。
  // 分析快捷开关：选项开启时把「分析开关」插入各模式首行（默认在「分析」左侧），
  // 关闭时从所有布局移除；之后用户可在功能区布局编辑器里自由移动/隐藏。
  const applyAnalysisToggleLayout = (enabled: boolean) => {
    setActionLayouts((layouts) => {
      const modes = {} as Record<AppMode, ModeLayout>;
      const LAYOUT_MODES_LOCAL: AppMode[] = ["record", "review", "puzzle"];
      for (const mode of LAYOUT_MODES_LOCAL) {
        const layout = layouts.modes[mode];
        if (enabled) {
          const bottom = layout.bottom;
          const has = bottom.includes("analysisToggle");
          if (has) { modes[mode] = layout; continue; }
          const idx = bottom.indexOf("analysis");
          const next: ActionId[] = idx >= 0 ? [...bottom.slice(0, idx), "analysisToggle", ...bottom.slice(idx)] : [...bottom, "analysisToggle"];
          modes[mode] = { ...layout, bottom: next };
        } else {
          const clean = (zone: ActionId[]): ActionId[] => zone.filter((id): id is ActionId => id !== "analysisToggle");
          modes[mode] = { ...layout, top: clean(layout.top), moves: clean(layout.moves), bottom: clean(layout.bottom) };
        }
      }
      const next = { ...layouts, modes };
      saveActionLayouts(next);
      return next;
    });
  };
  // 启动/设置变化时对齐「首行快捷滑动开关」：设置说开着、布局里却没有该按钮
  // （或反过来）就自动补齐/移除。旧实现只在用户手动拨动开关时同步布局，
  // 于是「设置开着但首行看不到按钮、要重新开关一次才出现」（用户 09-13 反馈）。
  useEffect(() => {
    applyAnalysisToggleLayout(enhancementSettings.analysisQuickToggle);
  }, [enhancementSettings.analysisQuickToggle]);
  const startManualGuide = (index: number) => {
    const steps = MANUAL_TOURS[index];
    if (!steps?.length) { setToast("本章引导正在制作中，先看文字说明吧"); return; }
    setSheet(null);
    setDockPanel(null);
    setGuideTour({ index, steps });
  };
  const handleGuideStep = (step: TourStep) => {
    // tab 在 AppTour mount（首步）时不会触发 goto，这里统一处理，幂等。
    if (step.tab) setTab(step.tab);
    setQuickDrawerOpen(!!step.openQuickDrawer);
    if (step.sheet) setSheet(step.sheet);
    if (step.panel) setDockPanel(step.panel);
    if (step.mode) switchMode(step.mode);
  };
  const finishManualGuide = () => {
    const focus = guideTour?.index;
    setGuideTour(null);
    setQuickDrawerOpen(false);
    setSheet(null);
    setDockPanel(null);
    setManualFocusSection(focus ?? null);
    setSheet("manual");
  };
  const openManualFromFirstRun = () => {
    dismissFirstRunWelcome();
    setSheet("manual");
  };
  const startFirstRunTour = () => {
    dismissFirstRunWelcome();
    setTab("record");
    setTourOpen(true);
  };
  const finishTour = (completed: boolean) => {
    markOnboardingTourSeen();
    setTourOpen(false);
    setToast(completed ? "新手引导完成——祝打谱愉快，设置里可随时重播" : "已退出新手引导，可在「设置 → 使用手册与反馈」重新观看");
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
    : puzzleSetup ? `${activePlacementPlayer === "black" ? "黑" : "白"}棋摆放` : puzzleOutcome ? "本题结束" : `${(puzzleSideOverride ?? currentPuzzle?.player) === "black" ? "黑" : "白"}方应战`;
  const statusStateKind = playback.isPlaying ? "playing" : hasDraft(draft) ? "draft" : saved ? "saved" : "neutral";
  const statusStateLabel = playback.isPlaying ? "自动演示"
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
      <div className="library-folder-row"><button className="library-folder-head" draggable={!batchEditMode} onDragStart={onLibraryDragStart("recordFolders", parentFolder, folder)} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("recordFolders", parentFolder, siblingFolders)} data-order-id={folder} data-drag-kind="recordFolders" data-drag-key={parentFolder} onClick={() => toggleLibraryFolder(folder)} aria-expanded={expanded} title="点击展开，拖动调整顺序"><FolderOpen size={19}/><span><b>{folderLabel(folder)}</b><small>{items.length + largeItems.length + (nativeDatabaseVisible ? 1 : 0)} 份棋谱{children.length ? ` · ${children.length} 个子文件夹` : ""}</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => pinFolderToTop("recordFolders", folder)} aria-label={`置顶文件夹“${folderLabel(folder)}”`} title="置顶"><ArrowUpToLine size={16}/></button><button className="library-inline-action" onClick={() => toggleLibrarySortMenu(sortMenuId)} aria-label={`排序“${folderLabel(folder)}”中的内容`} aria-expanded={librarySortMenu === sortMenuId} title="排序"><ArrowDownUp size={16}/></button>{renderLibrarySortMenu(sortMenuId, [
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
          if (regular) return <article key={id} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("records", folder, fullNaturalIds)} data-order-id={id} data-drag-kind="records" data-drag-key={folder} className={batchEditMode ? `batch-selectable ${batchSelectedIds.includes(regular.id) ? "selected" : ""}`.trim() : ""} title="拖动可调整顺序" onClick={() => batchEditMode ? toggleBatchSelection(regular.id) : openRecord(regular)}><span className="puzzle-row-drag" draggable onDragStart={onLibraryDragStart("records", folder, id)} title="拖动调整顺序"><GripVertical size={12}/></span>{batchEditMode && <label className="batch-selection-checkbox" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={batchSelectedIds.includes(regular.id)} onChange={() => toggleBatchSelection(regular.id)} aria-label={`选择棋谱“${regular.metadata.title}”`}/><i/></label>}<div className="mini-board"><span>●</span><span>○</span><b>{mainLineLength(regular)}</b></div><div className="record-info"><h3>{regular.metadata.title}</h3><p>{regular.metadata.black} vs {regular.metadata.white}</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", regular.id, event.target.value)}>{folderOptions(libraryFolders.recordFolders)}</select></div><div className="library-item-actions">{!batchEditMode && <><button className={isRecordFavorite(id) ? "fav-on" : ""} onClick={(event) => { event.stopPropagation(); toggleRecordFav(id); }} aria-label={isRecordFavorite(id) ? `取消收藏棋谱“${regular.metadata.title}”` : `收藏棋谱“${regular.metadata.title}”`} title={isRecordFavorite(id) ? "取消收藏" : "收藏"}><Star size={16} fill={isRecordFavorite(id) ? "currentColor" : "none"}/></button><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "record", id: regular.id, name: regular.metadata.title }); }} aria-label={`重命名棋谱“${regular.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteRecord(regular); }} aria-label={`删除棋谱“${regular.metadata.title}”`}><Trash2 size={17}/></button></>}</div></article>;
          const large = largeById.get(id);
          if (!large) return null;
          return <article key={id} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("records", folder, fullNaturalIds)} data-order-id={id} data-drag-kind="records" data-drag-key={folder}><span className="puzzle-row-drag" draggable onDragStart={onLibraryDragStart("records", folder, id)} title="拖动调整顺序"><GripVertical size={12}/></span><div className="mini-board"><span>●</span><span>○</span><b>{large.mainLineLength}</b></div><div className="record-info"><h3>{large.metadata.title}</h3><p>{large.metadata.black} vs {large.metadata.white} · 大型棋谱 · {large.nodeCount.toLocaleString()} 节点</p><select value={folder} onClick={(event) => event.stopPropagation()} onChange={(event) => assignLibraryItem("records", large.id, event.target.value)}>{folderOptions(libraryFolders.recordFolders)}</select></div><div className="library-item-actions"><button className={isRecordFavorite(id) ? "fav-on" : ""} onClick={(event) => { event.stopPropagation(); toggleRecordFav(id); }} aria-label={isRecordFavorite(id) ? `取消收藏棋谱“${large.metadata.title}”` : `收藏棋谱“${large.metadata.title}”`} title={isRecordFavorite(id) ? "取消收藏" : "收藏"}><Star size={16} fill={isRecordFavorite(id) ? "currentColor" : "none"}/></button><button onClick={(event) => { event.stopPropagation(); beginLibraryRename({ kind: "large-record", id: large.id, name: large.metadata.title }); }} aria-label={`重命名棋谱“${large.metadata.title}”`}><PenLine size={16}/></button><button className="delete-record" onClick={(event) => { event.stopPropagation(); deleteLargeRecord(large); }} aria-label={`删除棋谱“${large.metadata.title}”`}><Trash2 size={17}/></button></div></article>;
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
      <div className="library-folder-row"><button className="library-folder-head" draggable onDragStart={onLibraryDragStart("puzzleFolders", folderParent(folder), folder)} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzleFolders", folderParent(folder), folderChildren(libraryFolders.puzzleFolders, folderParent(folder)))} data-order-id={folder} data-drag-kind="puzzleFolders" data-drag-key={folderParent(folder)} onClick={() => toggleLibraryFolder(folder)} aria-expanded={expanded} title="点击展开，拖动调整顺序"><FolderOpen size={19}/><span><b>{folderLabel(folder)}</b><small>{collections.length} 个题集{children.length ? ` · ${children.length} 个子文件夹` : ""}</small></span><ChevronDown size={18}/></button><button className="library-inline-action" onClick={() => pinFolderToTop("puzzleFolders", folder)} aria-label={`置顶文件夹“${folderLabel(folder)}”`} title="置顶"><ArrowUpToLine size={16}/></button><button className="library-inline-action" onClick={() => toggleLibrarySortMenu(sortMenuId)} aria-label={`排序“${folderLabel(folder)}”中的内容`} aria-expanded={librarySortMenu === sortMenuId} title="排序"><ArrowDownUp size={16}/></button>{renderLibrarySortMenu(sortMenuId, [
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
        {orderedIds.map((id) => { const entry = entryById.get(id); if (!entry) return null; const { collection, puzzles, collectionIndex } = entry; const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length; const managing = managedPuzzleCollectionId === collection.id; const naturalPuzzleIds = collection.puzzles.map((puzzle) => puzzle.id); const orderedPuzzleIds = applyOrder(naturalPuzzleIds, libraryFolders.order?.puzzles?.[collection.id]); const puzzleById = new Map(collection.puzzles.map((puzzle) => [puzzle.id, puzzle])); const puzzleSortMenuId = `puzzles:${collection.id}`; return <article key={collection.id} className={puzzleBatchMode ? `batch-selectable ${puzzleBatchSelectedIds.includes(collection.id) ? "selected" : ""}`.trim() : ""} onClick={() => puzzleBatchMode ? togglePuzzleBatchSelection(collection.id) : undefined} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzleCollections", folder, naturalIds)} data-order-id={collection.id} data-drag-kind="puzzleCollections" data-drag-key={folder}><div className="puzzle-collection-main"><span className="puzzle-row-drag" draggable={!puzzleBatchMode} data-order-id={collection.id} data-drag-kind="puzzleCollections" data-drag-key={folder} title="拖动调整顺序" onDragStart={onLibraryDragStart("puzzleCollections", folder, collection.id)}><GripVertical size={14}/></span>{puzzleBatchMode && <label className="batch-selection-checkbox" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={puzzleBatchSelectedIds.includes(collection.id)} onChange={() => togglePuzzleBatchSelection(collection.id)} aria-label={`选择题集“${collection.title}”`}/><i/></label>}<button onClick={() => guardedOpenPuzzle(collectionIndex, 0)} disabled={puzzleBatchMode}><span className="puzzle-folder-icon">題</span><div><b>{collection.title}</b><small>{libraryQuery.trim() && puzzles.length !== collection.puzzles.length ? `${puzzles.length} / ${collection.puzzles.length} 道题匹配` : `${solved} / ${collection.puzzles.length} 已完成`}</small></div><ChevronRight size={18}/></button>{!puzzleBatchMode && <><button className={`library-inline-action ${isCollectionFavorite(collection.id) ? "fav-on" : ""}`} onClick={() => toggleCollectionFav(collection.id)} aria-label={isCollectionFavorite(collection.id) ? `取消收藏题集“${collection.title}”` : `收藏题集“${collection.title}”`} title={isCollectionFavorite(collection.id) ? "取消收藏" : "收藏"}><Star size={15} fill={isCollectionFavorite(collection.id) ? "currentColor" : "none"}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-collection", id: collection.id, name: collection.title })} aria-label={`重命名题集“${collection.title}”`}><PenLine size={15}/></button>{!collection.id.startsWith("native-") && <button className="library-inline-action delete-puzzle-collection" onClick={() => deletePuzzleCollection(collection)} aria-label={`删除题集“${collection.title}”`}><Trash2 size={15}/></button>}</>}</div><div className="puzzle-collection-tools"><select value={folder} onChange={(event) => assignLibraryItem("puzzles", collection.id, event.target.value)} aria-label={`移动题集“${collection.title}”到文件夹`}>{folderOptions(libraryFolders.puzzleFolders)}</select><button onClick={() => setManagedPuzzleCollectionId(managing ? null : collection.id)} aria-expanded={managing}>{managing ? "收起题目" : `管理 ${puzzles.length} 道题`}</button><button className="library-inline-action" onClick={() => toggleLibrarySortMenu(puzzleSortMenuId)} aria-label={`排序题集“${collection.title}”中的题目`} aria-expanded={librarySortMenu === puzzleSortMenuId} title="排序题目"><ArrowDownUp size={15}/></button>{renderLibrarySortMenu(puzzleSortMenuId, [
          ["题目 A→Z", () => sortLibraryContainer("puzzles", collection.id, naturalPuzzleIds, (id: string) => puzzleById.get(id)?.title || "", "az")],
          ["题目 Z→A", () => sortLibraryContainer("puzzles", collection.id, naturalPuzzleIds, (id: string) => puzzleById.get(id)?.title || "", "za")],
          ["恢复默认排序", () => resetLibraryOrder([["puzzles", collection.id]])],
        ])}</div>{managing && <div className="puzzle-manager-list" key={orderedPuzzleIds.join("|")}>{orderedPuzzleIds.map((puzzleId) => { const puzzle = puzzleById.get(puzzleId); if (!puzzle) return null; const puzzleIndexInCollection = naturalPuzzleIds.indexOf(puzzleId); return <div key={puzzleId} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzles", collection.id, naturalPuzzleIds)} data-order-id={puzzleId} data-drag-kind="puzzles" data-drag-key={collection.id}><span className="puzzle-row-drag" draggable data-order-id={puzzleId} data-drag-kind="puzzles" data-drag-key={collection.id} title="拖动调整顺序" onDragStart={onLibraryDragStart("puzzles", collection.id, puzzleId)}><GripVertical size={13}/></span><button onClick={() => guardedOpenPuzzle(collectionIndex, puzzleIndexInCollection)}><span>{puzzleIndexInCollection + 1}</span><b>{puzzle.title}</b></button><button className={isPuzzleFavorite(collection.id, puzzleId) ? "fav-on" : ""} onClick={() => togglePuzzleFav(collection.id, puzzleId)} aria-label={isPuzzleFavorite(collection.id, puzzleId) ? `取消收藏题目“${puzzle.title}”` : `收藏题目“${puzzle.title}”`} title={isPuzzleFavorite(collection.id, puzzleId) ? "取消收藏" : "收藏"}><Star size={14} fill={isPuzzleFavorite(collection.id, puzzleId) ? "currentColor" : "none"}/></button><button onClick={() => beginLibraryRename({ kind: "puzzle", collectionId: collection.id, id: puzzle.id, name: puzzle.title })} aria-label={`重命名题目“${puzzle.title}”`}><PenLine size={14}/></button></div>; })}</div>}</article>; })}
        {!collections.length && !children.length && <p className="folder-empty">这个文件夹还是空的</p>}
      </div>}
    </section>;
  };
  const playbackElement = <PlaybackButton isPlaying={playback.isPlaying} disabled={playbackBlocked} stopReason={playback.stopReason} onToggle={playback.toggle}/>;
  // 走棋功能区：七个导航按钮逐个独立，可跨区拖拽；撤销/重做/放弃仅打谱出现，
  // 播放仅读谱出现（renderWorkspaceAction 按模式过滤）。data-moves-labels 控制文字。
  // 做题模式的分析永远是「提示模式」（用户 2026-09-10）：点一下让引擎想一手并直接落子，
  // 不展开分析面板；摆棋/终局/陪练思考中由 runHintMove 拦截并给出提示。
  const analysisHintActive = mode === "puzzle" || enhancementSettings.analysisHintMode;
  // 做题的落子颜色：在状态条（首行之上右侧）。摆棋时=摆放颜色切换（含锁定）；应战时
  // =换边（本题你执哪一色，陪练执另一色），换边只对本回合生效——重启/换题/切规则回默认。
  const puzzleBattleSide = puzzleSideOverride ?? currentPuzzle?.player ?? "black";
  const puzzleColorSwitch = puzzleSetup ? <div className={`stone-color-switch setup-stone-switch ${activePlacementPlayer} ${placementLocked ? "locked" : "following"}`} role="radiogroup" aria-label="落子颜色">
    <i aria-hidden="true"/>
    <button className={activePlacementPlayer === "black" ? "selected" : ""} onClick={() => { setPlacementPlayer("black"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "black"} aria-label="黑棋" title="锁定黑棋"><span className="player-stone black"/></button>
    <button className={activePlacementPlayer === "white" ? "selected" : ""} onClick={() => { setPlacementPlayer("white"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "white"} aria-label="白棋" title="锁定白棋"><span className="player-stone white"/></button>
    <button className={`lock-toggle ${placementLocked ? "locked" : ""}`} onClick={() => setPlacementLocked((locked) => !locked)} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定" : "自动交替颜色"} title={placementLocked ? "解除锁定" : "自动换色"}><Lock/></button>
  </div> : <div className={`stone-color-switch setup-stone-switch battle-side-switch ${puzzleBattleSide}`} role="radiogroup" aria-label="落子颜色">
    <i aria-hidden="true"/>
    <button className={puzzleBattleSide === "black" ? "selected" : ""} onClick={() => setPuzzleSideOverride("black")} role="radio" aria-checked={puzzleBattleSide === "black"} aria-label="黑棋" title="本题由黑方落子（重启/换题后恢复默认）"><span className="player-stone black"/></button>
    <button className={puzzleBattleSide === "white" ? "selected" : ""} onClick={() => setPuzzleSideOverride("white")} role="radio" aria-checked={puzzleBattleSide === "white"} aria-label="白棋" title="换为白方落子（重启/换题后恢复默认）"><span className="player-stone white"/></button>
  </div>;
  const workspaceActions = {
    navStart: <button onClick={goRoot} disabled={dynamicNavigationBusy} aria-label="到第一手" title="回到第一手"><ChevronFirst/></button>,
    navPrev: <button onClick={goPrev} disabled={dynamicNavigationBusy || !current.parentId} aria-label="上一手" title="上一手"><ChevronLeft/></button>,
    navNext: <button className="accent" onClick={goNext} disabled={dynamicNavigationBusy || !preferredNext(viewDocument, currentId)} aria-label="下一手" title="下一手"><ChevronRight/></button>,
    navEnd: <button onClick={goPreferredEnd} disabled={dynamicNavigationBusy} aria-label="到最后一手" title="到最后一手"><ChevronLast/></button>,
    navUndo: <button onClick={undoDraftChange} disabled={!draft.operations.length} aria-label="撤销编辑" title={draft.operations.length ? "撤销最近一次编辑" : "暂无可撤销的编辑"}><Undo2/></button>,
    navRedo: <button onClick={redoDraftChange} disabled={!draft.redo.length} aria-label="重做编辑" title={draft.redo.length ? "恢复最近一次撤销的编辑" : "暂无可重做的编辑"}><Redo2/></button>,
    navDiscard: <button onClick={discardDraft} disabled={!hasDraft(draft)} aria-label="放弃编辑" title={hasDraft(draft) ? "放弃当前未保存修改" : "暂无未保存修改"}><X/></button>,
    playback: playbackElement,
    comment: <button className={`command-comment ${currentHasComment ? "has-comment" : ""} ${commentExpanded ? "active" : ""}`} onClick={() => setCommentExpanded((open) => !open)} aria-label={commentToggleLabel} title={commentToggleLabel}><MessageSquareText/></button>,
    new: <button className={`command-new ${mode === "review" ? "review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : newRecord} aria-label="新建空白棋局" title={mode === "review" ? "读谱模式无法进行该操作" : "新建空白棋局"}><FilePlus2/></button>,
    save: <button className={`command-save ${hasDraft(draft) ? "pending" : ""} ${mode === "review" ? "review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : saveCurrentDraft} aria-label={mode === "review" ? "读谱模式无法保存棋谱" : hasDraft(draft) ? `保存当前棋谱修改（${draft.operations.length} 项）` : "当前棋谱已保存"} title={mode === "review" ? "读谱模式无法进行该操作" : hasDraft(draft) ? "保存修改" : "已保存"}><Save/></button>,
    delete: <button className={`command-delete ${mode === "review" ? "review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : deleteCurrentVariation} disabled={mode === "record" && !current.parentId} aria-label="删除当前一步及后续变化" title={mode === "review" ? "读谱模式无法进行该操作" : !current.parentId ? "起始局面不可删除" : isPagedLibraryView(document) || isDynamicDatabaseView(document) ? "将在本地编辑副本中删除，原数据库不变" : "删除本步及后续变化"}><Trash2/></button>,
    analysis: <button aria-label={analysisHintActive ? (mode === "puzzle" ? "分析（提示模式：点击帮你想一手）" : "分析（提示模式：点击让引擎落一子）") : "分析"} aria-pressed={analysisHintActive ? false : dockPanel === "analysis"} className={!analysisHintActive && dockPanel === "analysis" ? "active" : ""} title={mode === "puzzle" ? "分析：帮你想一手，算到杀棋立刻落子（≤10 秒）" : analysisHintActive ? "提示：点一下想一手直接落子（≤10 秒，杀棋即落）" : "展开/收起分析面板"} onClick={() => { if (analysisHintActive) { runHintMove(); return; } setDockPanel((panel) => panel === "analysis" ? null : "analysis"); }}><Gauge/><span className="action-label">分析</span></button>,
    analysisToggle: <label className={`analysis-toggle ${enhancementSettings.analysisAuto ? "on" : ""}`} title={enhancementSettings.analysisAuto ? "分析运行中，点击停止" : "点击开启分析"}><input type="checkbox" checked={enhancementSettings.analysisAuto} onChange={() => toggleAnalysis(!enhancementSettings.analysisAuto)} aria-label={enhancementSettings.analysisAuto ? "关闭分析" : "开启分析"}/><i aria-hidden="true"/><span className="action-label">分析</span></label>,
    color: mode === "puzzle" ? puzzleColorSwitch : <div className={`stone-color-switch ${activePlacementPlayer} ${placementLocked ? "locked" : "following"} ${mode === "review" ? "review-blocked" : ""}`} role="radiogroup" aria-label="落子颜色">
              <i aria-hidden="true"/>
              <button className={activePlacementPlayer === "black" ? "selected" : ""} onClick={mode === "review" ? reviewBlocked : () => { setPlacementPlayer("black"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "black"} aria-label="黑棋" title={mode === "review" ? "读谱模式无法进行该操作" : "锁定黑棋"}><span className="player-stone black"/></button>
              <button className={activePlacementPlayer === "white" ? "selected" : ""} onClick={mode === "review" ? reviewBlocked : () => { setPlacementPlayer("white"); setPlacementLocked(true); }} role="radio" aria-checked={activePlacementPlayer === "white"} aria-label="白棋" title={mode === "review" ? "读谱模式无法进行该操作" : "锁定白棋"}><span className="player-stone white"/></button>
              <button className={`lock-toggle ${placementLocked ? "locked" : ""}`} onClick={mode === "review" ? reviewBlocked : () => setPlacementLocked((locked) => !locked)} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定，自动换色" : "跟随当前棋谱颜色"} title={mode === "review" ? "读谱模式无法进行该操作" : placementLocked ? "解除锁定" : "自动换色"}><Lock/></button>
            </div>,
    rule: mode === "puzzle"
      ? <PuzzleRuleSelector value={currentPuzzleRule} onChange={changePuzzleRule}/>
      : <RuleToggle value={viewDocument.metadata.rule} disabled={mode === "review" || Boolean(aiGame)} onChange={changeRecordRule}/>,
    annotation: <button aria-label="标注" aria-pressed={annotationActive} className={annotationActive ? "active" : ""} onClick={() => { if (aiGame) { setToast("人机对局中暂不能标注，请先退出对局"); return; } setDockPanel((panel) => { const next = panel === "annotation" ? null : "annotation"; if (!next) setAnnotationPopover(null); return next; }); }} title={annotationActive ? "关闭标注模式" : "打开当前局面标注模式"}><Tag/><span className="action-label">标注</span></button>,
    notes: <button aria-label="编辑" className={dockPanel === "notes" ? "active" : ""} onClick={() => setDockPanel((panel) => panel === "notes" ? null : "notes")}><SquarePen/><span className="action-label">编辑</span></button>,
    tree: <button aria-label="打开分支树" className={sheet === "tree" ? "active" : ""} onClick={() => setSheet("tree")}><ListTree/><span className="action-label">分支树</span></button>,
    view: <button aria-label="更多" className={dockPanel === "view" ? "active" : ""} onClick={() => setDockPanel((panel) => panel === "view" ? null : "view")}><MoreHorizontal/><span className="action-label">更多</span></button>,
    play: <button className={puzzleSetup ? "" : "active"} onClick={exitPuzzleSetup}><Swords/><span className="action-label">应战</span></button>,
    setup: <button className={puzzleSetup ? "active" : ""} onClick={enterPuzzleSetup}><PenLine/><span className="action-label">摆棋</span></button>,
    vcf: <button className={dockPanel === "vcf" ? "active" : ""} onClick={() => setDockPanel(dockPanel === "vcf" ? null : "vcf")} aria-label="VCF 生成器"><Sparkles/><span className="action-label">VCF</span></button>,
  };
  // 紧凑态（非常驻区或仅图标）下，禁手规则与落子颜色不再展开弹层：按钮本身就是
  // 状态——规则点一下切有禁/无禁，颜色是一颗棋子加一把锁。
  const renderCompactRule = (id: ActionId) => {
    if (mode === "puzzle") {
      const forbidden = currentPuzzleRule.mode === "forbidden";
      return <button key={id} type="button" data-action-id={id} className={`workspace-action rule-compact ${forbidden ? "renju" : "freestyle"}`} disabled={currentPuzzleRule.locked} aria-label={forbidden ? "本题当前有禁手，点击切为无禁手" : "本题当前无禁手，点击切为有禁手"} title={currentPuzzleRule.locked ? "题目指定规则，不可切换" : "点击切换有禁/无禁"} onClick={() => changePuzzleRule(forbidden ? "unrestricted" : "forbidden")}><Shield aria-hidden="true"/><span>{forbidden ? "有禁" : "无禁"}</span></button>;
    }
    const forbidden = viewDocument.metadata.rule === "renju";
    const blocked = mode === "review" || Boolean(aiGame);
    return <button key={id} type="button" data-action-id={id} className={`workspace-action rule-compact ${forbidden ? "renju" : "freestyle"}`} disabled={blocked} aria-label={forbidden ? "当前有禁手规则，点击切为无禁手" : "当前无禁手规则，点击切为有禁手"} title={blocked ? "读谱/人机对局中规则固定" : "点击切换有禁/无禁"} onClick={() => changeRecordRule(forbidden ? "freestyle" : "renju")}><Shield aria-hidden="true"/><span>{forbidden ? "有禁" : "无禁"}</span></button>;
  };
  const renderCompactColor = (id: ActionId) => {
    // 做题：应战的颜色由题目决定（只有摆棋里能切），否则会替对手落子。
    const blocked = mode === "review" || (mode === "puzzle" && !puzzleSetup);
    const blockedTitle = mode === "review" ? "读谱模式无法进行该操作" : "应战中颜色由题目决定，点「摆棋」后可切换";
    const blockedNotice = () => { if (mode === "review") reviewBlocked(); else setToast(blockedTitle); };
    return <div key={id} data-action-id={id} className={`stone-color-compact ${activePlacementPlayer} ${placementLocked ? "locked" : "following"} ${blocked ? "review-blocked" : ""}`} role="group" aria-label={`落子颜色${activePlacementPlayer === "black" ? "黑" : "白"}，${placementLocked ? "已锁定" : "自动跟随棋谱"}`}>
      <button type="button" disabled={blocked} aria-label={`当前${activePlacementPlayer === "black" ? "黑" : "白"}子，点击切换颜色`} title={blocked ? blockedTitle : "点击切换黑白"} onClick={() => { if (blocked) { blockedNotice(); return; } setPlacementPlayer(activePlacementPlayer === "black" ? "white" : "black"); setPlacementLocked(true); }}><span className={`player-stone ${activePlacementPlayer}`}/></button>
      <button type="button" className={`lock-toggle ${placementLocked ? "locked" : ""}`} disabled={blocked} aria-pressed={placementLocked} aria-label={placementLocked ? "解除颜色锁定，自动换色" : "锁定当前颜色"} title={blocked ? blockedTitle : placementLocked ? "解除锁定，自动换色" : "锁定当前颜色"} onClick={() => { if (blocked) { blockedNotice(); return; } setPlacementLocked(!placementLocked); }}><Lock aria-hidden="true"/></button>
    </div>;
  };
  const renderWorkspaceAction = (id: ActionId, zone: LayoutZone) => {
    if (!actionVisibleInMode(id, mode)) return null;
    // 做题：应战与摆棋是同一枚按钮的两种状态（应战中显示「摆棋」，摆棋中显示「应战」），
    // 保证首行功能区在 392px 手机上仍是 6 格一行（用户 09-10 复选）。
    if (mode === "puzzle" && ((id === "play" && !puzzleSetup) || (id === "setup" && puzzleSetup))) return null;
    const compact = zone === "bottom" || actionLayout.iconsOnly;
    if (compact && id === "rule") return renderCompactRule(id);
    if (compact && id === "color") return renderCompactColor(id);
    if (zone === "top" && id === "rule") return <div key={id} data-action-id={id} className="workspace-action-slot">{workspaceActions[id]}</div>;
    return <WorkspaceAction key={id} id={id} element={workspaceActions[id]} label={["comment", "new", "save", "delete", "navStart", "navPrev", "navNext", "navEnd", "navUndo", "navRedo", "navDiscard"].includes(id)}/>;
  };
  const commentPreview = mode !== "puzzle" && commentExpanded && <div className="comment-review"><textarea id="comment-preview" className={`${commentPreviewClass} ${commentPreviewExpanded ? "expanded" : ""}`} readOnly value={commentPreviewText} onDoubleClick={() => setCommentPreviewExpanded((expanded) => !expanded)} aria-label="当前局面注释" title={commentPreviewExpanded ? "双击或点击右侧按钮收起注释框" : "双击或点击右侧按钮展开注释框"}/><button type="button" className="comment-expand-toggle" onClick={() => setCommentPreviewExpanded((expanded) => !expanded)} aria-controls="comment-preview" aria-expanded={commentPreviewExpanded} aria-label={commentPreviewExpanded ? "收起注释文本框" : "展开注释文本框"} title={commentPreviewExpanded ? "收起注释" : "展开注释"}>{commentPreviewExpanded ? <Minimize2 aria-hidden="true"/> : <Maximize2 aria-hidden="true"/>}</button></div>;
  // 做题：分析面板不渲染（那里的分析永远是提示模式，点一下即落子）；应战/摆棋的按钮
  // 已移入常驻走棋区，对应 dock 面板不再需要，避免出现空面板。
  const workspaceDockPanel = dockPanel && !(mode === "puzzle" && (dockPanel === "analysis" || dockPanel === "play")) && (<div className={`dock-panel dock-panel-${dockPanel}`}>
            {dockPanel === "analysis" && <div className="ai-analysis-panel" aria-label="AI 分析">
              <div className="ai-analysis-head"><label className={`analysis-toggle ${enhancementSettings.analysisAuto ? "on" : ""}`}><input type="checkbox" checked={enhancementSettings.analysisAuto} onChange={(event) => toggleAnalysis(event.target.checked)} aria-label={enhancementSettings.analysisSelfPlay ? "自对弈" : "持续分析"}/><i aria-hidden="true"/></label><PanelSelect ariaLabel="分析模式" value={getAnalysisMode(enhancementSettings)} options={[["continuous", "持续"], ["selfplay", "自对弈"], ["hint", "提示"]] as const} onChange={(mode) => { if (changeEnhancementSettings(withAnalysisMode(enhancementSettings, mode as AnalysisMode))) { setAnalysisPreview(null); } }}/><button type="button" className={`ai-engine-badge ${aiEngineChoice}`} onClick={() => updateAiEngineChoice(aiEngineChoice === "light" ? "strong" : aiEngineChoice === "strong" ? "tuned" : "light")} title={aiEngineChoice === "light" ? "点击切换强力引擎" : aiEngineChoice === "strong" ? enginePackState ? "当前选择强力引擎（128MB 标准），点击切换自调引擎" : "强力引擎尚未下载，点击切换自调引擎" : "当前选择自调引擎（内存可自定义），点击切换轻量引擎"}>{aiEngineChoice === "strong" ? "强力" : aiEngineChoice === "tuned" ? "自调" : "轻量"}</button><PanelSelect ariaLabel="选点数量" value={String(enhancementSettings.analysisCandidateCount)} options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => [String(count), `${count} 选`] as const)} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, analysisCandidateCount: Number(value) })}/><PanelSelect ariaLabel="选点显示内容" value={enhancementSettings.analysisCandidateMetric} options={[["winRate", "胜率"], ["score", "评估分"], ["depth", "深度"], ["nodes", "计算量"]] as const} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, analysisCandidateMetric: value as AnalysisCandidateMetric })}/><PanelSelect ariaLabel="选点小数位数" value={String(enhancementSettings.analysisCandidateDecimals)} options={([[0, "0 位"], [1, "1 位"], [2, "2 位"]] as const).map(([count, label]) => [String(count), label] as const)} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, analysisCandidateDecimals: Number(value) })}/></div>
              {getAnalysisMode(enhancementSettings) === "hint"
                ? <div className="ai-hint-panel" aria-label="提示模式说明"><Gauge size={18}/><p><b>提示模式</b><span>点击分析区域外任意位置或「分析」按钮，引擎会为当前行棋方算一手并直接落子（算出杀棋会立刻落）。</span></p><p className="ai-hint-panel-sub"><span>需要回到持续分析时，把上方模式切回「持续」即可；也可以在快捷中心的「分析模式」里切换。</span></p></div>
                : <>{getAnalysisMode(enhancementSettings) === "selfplay" && <label className="quick-think-slider"><span><b>自对弈每步时限</b><small>到点即落子；提前算出杀棋会立刻落下，五连或满盘自动结束</small></span><output>{(enhancementSettings.analysisSelfPlayTimeMs / 1000).toFixed(1)} 秒</output><input aria-label="自对弈每步时限" type="range" min="1000" max="10000" step="500" value={enhancementSettings.analysisSelfPlayTimeMs} onChange={(event) => changeEnhancementSettings({ ...enhancementSettings, analysisSelfPlayTimeMs: Number(event.target.value) })}/></label>}</>}
              <div className="ai-analysis-stats"><span className="stat-depth"><small>深度</small><b>{aiAnalysis.depth || "-"}</b></span><span className="stat-score"><small>评估分</small><b className={(aiAnalysis.score ?? 0) > 0 ? "pos" : (aiAnalysis.score ?? 0) < 0 ? "neg" : ""}>{aiAnalysis.scoreAvailable ? `${(aiAnalysis.score || 0) > 0 ? "+" : ""}${Math.round(aiAnalysis.score || 0)}` : "-"}</b></span>{!aiGame && <span className="stat-winrate"><small>黑方胜率</small><b className={(() => { const wr = aiAnalysis.status === "thinking" && aiAnalysis.depth < 12 ? undefined : blackWinRate(aiAnalysis, aiAnalysis.winRate); if (wr === undefined) return ""; return wr >= .67 ? "high" : wr <= .33 ? "low" : "mid"; })()}>{aiAnalysis.status === "thinking" && aiAnalysis.depth < 12 ? "计算中" : blackWinRate(aiAnalysis, aiAnalysis.winRate) === undefined ? "-" : `${Math.round((blackWinRate(aiAnalysis, aiAnalysis.winRate) ?? 0) * 100)}%`}</b></span>}<span className="stat-nodes"><small>节点</small><b>{aiAnalysis.nodes ? aiAnalysis.nodes.toLocaleString() : "-"}</b></span></div>
              {aiAnalysis.candidates?.length ? <div className="ai-analysis-candidates"><small>{`行棋方（${aiAnalysis.mover === "white" ? "白" : "黑"}）${ANALYSIS_METRIC_LABELS[analysisShownMetric]} · 点击看变化 · 本地棋力有限，仅供参考`}</small>{rankAnalysisCandidates(aiAnalysis.candidates, analysisShownMetric).slice(0, enhancementSettings.analysisCandidateCount).map((candidate, index) => <button type="button" key={`${candidate.move.row}-${candidate.move.col}`} className={`analysis-candidate-chip ${analysisPreview && analysisPreview.row === candidate.move.row && analysisPreview.col === candidate.move.col ? "selected" : ""}`} aria-pressed={!!(analysisPreview && analysisPreview.row === candidate.move.row && analysisPreview.col === candidate.move.col)} onClick={() => toggleCandidatePreview(candidate)}><b>{index + 1}. {coordinateName(candidate.move)}</b><em>{analysisMetricText(candidate, analysisShownMetric, enhancementSettings.analysisCandidateDecimals)}</em></button>)}</div> : null}
            </div>}
            {!isPuzzleMode && dockPanel === "annotation" && <div className="mark-studio" ref={markStudioRef} aria-label="当前局面标注工具">
              <div className="mark-studio-grid">
                <div className="mark-studio-preview" aria-label="标注预览"><MarkGlyph style={annotationStyle} color={annotationColor} value={currentAnnotationLabel}/><small>预览</small></div>
                <button type="button" className={`mark-studio-box ${annotationPopover === "style" ? "open" : ""}`} onClick={() => openAnnotationPopover("style")} aria-expanded={annotationPopover === "style"}><small>样式</small><b>{ANNOTATION_STYLES.find((item) => item.id === annotationStyle)?.label}</b></button>
                <button type="button" className={`mark-studio-box ${annotationPopover === "color" ? "open" : ""}`} onClick={() => openAnnotationPopover("color")} aria-expanded={annotationPopover === "color"}><small>颜色</small><b><span className="mark-studio-swatch" style={{ background: annotationColor }}/></b></button>
                <button type="button" className={`mark-studio-box ${annotationPopover === "type" ? "open" : ""}`} onClick={() => openAnnotationPopover("type")} aria-expanded={annotationPopover === "type"}><small>类型</small><b>{annotationTypePreset(annotationType).label}</b></button>
                {annotationType === "custom"
                  ? <input className="mark-studio-box mark-studio-input" value={annotationValue} maxLength={4} placeholder="输入文字" aria-label="自定义标注文字" onChange={(event) => setAnnotationValue(event.target.value)}/>
                  : <button type="button" className={`mark-studio-box ${annotationPopover === "value" ? "open" : ""}`} onClick={() => openAnnotationPopover("value")} aria-expanded={annotationPopover === "value"}><small>内容</small><b>{annotationValue}</b></button>}
                <button type="button" className={`mark-studio-box mark-studio-erase${annotationErase ? " active" : ""}`} onClick={() => { setAnnotationErase((erase) => !erase); setAnnotationPopover(null); }} aria-pressed={annotationErase} title={annotationErase ? "退出去标注（再点一次）" : "进入去标注：点棋盘已有标注即擦除"}><small>去标注</small><b>{annotationErase ? <Check size={13}/> : <Eraser size={13}/>}</b></button>
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
              <p className="mark-studio-hint">{annotationErase
                ? (mode === "review" ? "去标注中：点棋盘已有标注即擦除（棋谱原有标注会切编辑删除），点空位无动作。" : "去标注中：点棋盘已有标注即擦除，点空位无动作。")
                : (mode === "review" ? "点已有标注=取消；点棋谱原有标注会切到编辑模式删除它，保存后写入棋谱。" : "点已有标注=取消该点标注；不会落子或进入分支。")}</p>
              {mode === "review" && <button type="button" className="mark-studio-commit" onClick={commitAllReviewMarksToDraft}><Save size={16}/><span>把本机标注写入棋谱（再点顶栏「保存棋谱」落盘）</span></button>}
            </div>}
            {/* 摆棋的局面导航：常驻走棋行恒为题目五键，摆棋导航留在弹出面板里（用户 09-10 复选）。 */}
            {isPuzzleMode && puzzleSetup && dockPanel === "setup" && <><button onClick={() => navigatePuzzleSetup(0)} disabled={puzzleSetup.session.cursor === 0} aria-label="摆棋起点"><ChevronFirst/><span>起点</span></button><button onClick={() => navigatePuzzleSetup(puzzleSetup.session.cursor - 1)} disabled={puzzleSetup.session.cursor === 0} aria-label="摆棋上一手"><ChevronLeft/><span>上一手</span></button><button className="accent" onClick={() => navigatePuzzleSetup(puzzleSetup.session.cursor + 1)} disabled={puzzleSetup.session.cursor >= puzzleSetup.session.moves.length} aria-label="摆棋下一手"><ChevronRight/><span>下一手</span></button><button onClick={() => navigatePuzzleSetup(puzzleSetup.session.moves.length)} disabled={puzzleSetup.session.cursor >= puzzleSetup.session.moves.length} aria-label="摆棋终点"><ChevronLast/><span>终点</span></button></>}
             {!isPuzzleMode && dockPanel === "notes" && <><button className={mode === "review" ? "review-blocked" : ""} onClick={mode === "review" ? reviewBlocked : () => setSheet("comment")} title={mode === "review" ? "读谱模式无法进行该操作" : "编辑节点注释"}><MessageSquareText/><span>注释</span></button><button className={mode === "review" ? "review-blocked" : ""} onClick={mode === "review" ? reviewBlocked : () => setSheet("metadata")} title={mode === "review" ? "读谱模式无法进行该操作" : "编辑棋谱信息"}><Save/><span>信息</span></button><button onClick={() => setRotation((value) => ((value + 90) % 360) as BoardRotation)}><RotateCw/><span>旋转</span></button><button onClick={() => setMirrored((value) => !value)}><FlipHorizontal/><span>镜像</span></button><button className={eraseStone ? "active" : ""} onClick={toggleEraseStone} aria-pressed={eraseStone} title={eraseStone ? "退出去子模式" : "去子：点棋盘上的棋子直接删除（图片导入多子/少子修正，棋谱将转为静态局面）"}><XCircle/><span>去子</span></button></>}
             {dockPanel === "view" && <>{!isPuzzleMode && <><button onClick={() => setSheet("find")}><Search/><span>查找</span></button><button onClick={() => { setDockPanel(null); setSheet("positionSearch"); }}><GitBranch/><span>跨谱查找</span></button><label className={`dock-board-size ${mode === "review" ? "review-blocked" : ""}`}><span>棋盘路数</span><select className="board-size-select" aria-label="选择新棋谱棋盘路数" value={viewDocument.metadata.boardSize || 15} onChange={(event) => { if (mode === "review") reviewBlocked(); else createBoardWithSize(Number(event.target.value)); }}><option value={viewDocument.metadata.boardSize || 15}>{viewDocument.metadata.boardSize || 15}路</option>{Array.from({ length: 17 }, (_, index) => index + 5).filter((size) => size !== (viewDocument.metadata.boardSize || 15)).map((size) => <option key={size} value={size}>{size}路</option>)}</select></label></>}<button onClick={() => setShowNumbers((value) => !value)}><Tag/><span>{showNumbers ? "隐藏手数" : "显示手数"}</span></button><button onClick={() => setShowCoordinates((value) => !value)}><Menu/><span>{showCoordinates ? "隐藏坐标" : "显示坐标"}</span></button></>}
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
          </div>);
  // 做题的「常驻走棋区」：固定渲染、不进布局池——**永远这五键**（用户 09-10 复选：
  // 摆棋时也保持五键不变，摆棋的局面导航仍在弹出的 dock 面板里）。
  const puzzleNavRow = <div className="moves-row puzzle-nav-row" aria-label="走棋导航">
    {isPuzzleMode && actionLayout.iconsOnly && <button onClick={() => { setDockPanel((panel) => panel === "setup" ? null : "setup"); }} aria-label={puzzleSetup ? "退出摆棋" : "摆棋"} aria-pressed={Boolean(puzzleSetup)} title={puzzleSetup ? "退出摆棋" : "摆棋"}><PenLine/></button>}
    <button onClick={() => movePuzzle(-1)} aria-label="上一题"><ChevronLeft/><span>上一题</span></button>
    <button onClick={() => { setSheet(null); setWorkspaceSelectorOpen(true); }} aria-label="选题"><BookOpen/><span>选题</span></button>
    <button className={aiThinking ? "danger" : "accent"} onClick={aiThinking ? stopPuzzleAi : () => movePuzzle(1)} aria-label="下一题">{aiThinking ? <X/> : <ChevronRight/>}<span>{aiThinking ? "停止" : "下一题"}</span></button>
    <button onClick={undoPuzzleTurn} disabled={depthOf(document, currentId) <= puzzleInitialDepth} aria-label="悔棋"><Undo2/><span>悔棋</span></button>
    <button onClick={restartPuzzle} aria-label="重启"><RotateCw/><span>重启</span></button>
  </div>;
  const puzzleStatusCopy = <div className="puzzle-status-copy"><span>{puzzleSetup ? "自由摆棋" : puzzleOutcome === "won" ? "挑战成功" : puzzleOutcome === "lost" ? "本题失败" : puzzleOutcome === "stopped" ? "思考已停止" : aiThinking ? "陪练思考中" : `${(puzzleSideOverride ?? currentPuzzle?.player) === "black" ? "黑" : "白"}方由你落子`}</span><small>{puzzleSetup ? "回退后重新落子会覆盖旧后续" : puzzleOutcome ? "可悔棋或重启本题" : currentPuzzle?.prompt}</small></div>;
  // 做题默认常驻区只有禁手规则选择器：此时把「应战状态」文案并进同一行，
  // 给棋盘让出垂直空间。用户把其它按钮搬进常驻区后退回普通两行布局。
  const compactPuzzleHeader = isPuzzleMode && actionLayout.top.length > 0 && actionLayout.top.every((id) => id === "rule");
  // 黑白切换在状态条右侧（用户 09-10 反馈：首行的上面、靠右）。
  const puzzleColorSwitchSlot = <div className="puzzle-color-switch-slot">{puzzleColorSwitch}</div>;
  const puzzleStatusRow = (copy: ReactNode) => <div className="workspace-status puzzle-mode">{copy}{puzzleColorSwitchSlot}</div>;
  const renderTopRow = (ids: ActionId[]) => ids.length > 0 && (compactPuzzleHeader
    ? <div className="workspace-status puzzle-mode"><div className="puzzle-mode-selectors action-top-row action-puzzle-default" aria-label="常驻做题工具">{ids.map((id) => renderWorkspaceAction(id, "top"))}</div>{puzzleStatusCopy}{puzzleColorSwitchSlot}</div>
    : <div className={`workspace-status ${isPuzzleMode ? "puzzle-mode" : ""}`}><div className="record-command-bar action-top-row" aria-label={isPuzzleMode ? "常驻做题工具" : "常驻打谱工具"}>{ids.map((id) => renderWorkspaceAction(id, "top"))}</div></div>);
  return <div className={`app-shell ${fontScaleClass(fontScale)} ${enhancementSettings.tabletSplit ? "split-layout-enabled" : ""}`} lang="zh-CN" data-ai-worker-state={aiWorkerController.current.snapshot.running ? "running" : "idle"} data-ai-request-id={aiWorkerController.current.snapshot.requestId || undefined} style={customAppStyle}>
      {/* 雪落主题的飘雪装饰层（指针穿透，只 snow 主题显示） */}
      <div className="snow-layer" aria-hidden="true" data-testid="snow-layer"/>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <input ref={singleFileInput} type="file" hidden accept=".sgf,.fgf,.pos,.txt,.psq,.ren,.renjs,.wzq,.lib,.renju,.json,.db,.dp,.zip,*/*" onChange={(event) => { void handleFiles(event.target.files || undefined); event.target.value = ""; }}/>
    <input ref={puzzleFileInput} type="file" hidden accept=".json,.zip,application/json,application/zip" onChange={(event) => { const file = event.target.files?.[0]; void (file?.name.toLowerCase().endsWith(".zip") ? handleZipFile(file) : handlePuzzleFile(file)); event.target.value = ""; }}/>
    <input ref={imageFileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif" onChange={(event) => { beginBoardImageImport(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={backupFileInput} type="file" hidden accept=".json,.zip,application/json,application/zip" onChange={(event) => { void handleBackupFile(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={backgroundFileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/*" onChange={(event) => { handleBackgroundImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <header className={`topbar${tab === "record" ? " record-topbar" : ""}`}><div className="brand"><button type="button" className={`brand-trigger${latestUpdate ? " has-update" : ""}`} onClick={() => setQuickDrawerOpen(true)} aria-label={latestUpdate ? "打开快捷中心（有新版本）" : "打开快捷中心"} aria-expanded={quickDrawerOpen} aria-controls="quick-drawer"><img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true"/>{latestUpdate && <span className="update-dot" aria-hidden="true"/>}</button>{tab !== "record" ? <div><b>半步五子棋打谱</b><small>本地棋谱研究工具</small></div> : <div className="brand-hint">快捷中心</div>}</div>{tab === "record" && <div className="topbar-mode-toggle" role="tablist" aria-label="工作模式"><button type="button" role="tab" aria-selected={mode === "record"} className={mode === "record" ? "selected" : ""} onClick={() => switchMode("record")} aria-label="打谱模式"><PenTool aria-hidden="true"/><span>打谱</span></button><button type="button" role="tab" aria-selected={mode === "review"} className={mode === "review" ? "selected" : ""} onClick={() => switchMode("review")} aria-label="读谱模式"><BookOpen aria-hidden="true"/><span>读谱</span></button><button type="button" role="tab" aria-selected={mode === "puzzle"} className={mode === "puzzle" ? "selected" : ""} onClick={() => switchMode("puzzle")} aria-label="做题模式"><PuzzleIcon aria-hidden="true"/><span>做题</span></button></div>}<div className="top-actions">{tab === "record" ? <><button className="icon-button" onClick={openExportSheet} aria-label="打开导出方式"><Upload size={20}/></button><button className={`icon-button save-action${mode === "review" ? " review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : openSaveDialog} aria-label={mode === "review" ? "读谱模式无法保存棋谱" : "保存棋谱"}><Save size={20}/></button></> : <><button className="icon-button" onClick={openImportSheet} aria-label="打开导入方式"><Download size={20}/></button><button className="icon-button" onClick={openExportSheet} aria-label="打开导出方式"><Upload size={20}/></button><button className={`icon-button save-action${mode === "review" ? " review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : openSaveDialog} aria-label={mode === "review" ? "读谱模式无法保存棋谱" : "保存棋谱"}><Save size={20}/></button></>}</div></header>
    <QuickDrawer
      onOpenLayout={openLayoutEditor}
      suspended={layoutEditorOpen}
      open={quickDrawerOpen}
      onClose={() => setQuickDrawerOpen(false)}
      updateRelease={latestUpdate}
      onCheckUpdate={checkUpdateNow}
      title={mode !== "puzzle" ? viewDocument.metadata.title : currentPuzzle?.title || "当前题目"}
      subtitle={mode !== "puzzle" ? `第 ${depthOf(viewDocument, currentId)} 手 · 下一手${nextPlayer === "black" ? "黑" : "白"}方` : `${puzzleCollections[puzzleCollectionIndex]?.title || "题库"} · 第 ${puzzleIndex + 1} 题`}
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
      soundSettings={soundSettings}
      onSoundSettingsChange={setSoundSettings}
      onPreviewSound={playSound}
      enhancementSettings={enhancementSettings}
      onEnhancementSettingsChange={changeEnhancementSettings}
      thinkingIndicatorPosition={enhancementSettings.thinkingIndicatorPosition}
      onThinkingIndicatorPositionChange={(thinkingIndicatorPosition) => changeEnhancementSettings({ ...enhancementSettings, thinkingIndicatorPosition })}
      aiEngineChoice={aiEngineChoice}
      enginePackReady={enginePackReady}
      onAiEngineChoiceChange={updateAiEngineChoice}
      showNumbers={showNumbers}
      onShowNumbersChange={setShowNumbers}
      showCoordinates={showCoordinates}
      onShowCoordinatesChange={setShowCoordinates}
      showForbidden={showForbidden}
      onShowForbiddenChange={setShowForbidden}
      showLastMove={showLastMove}
      onShowLastMoveChange={setShowLastMove}
      moveNumberScale={moveNumberScale}
      onMoveNumberScaleChange={setMoveNumberScale}
      gridLineWidth={gridLineWidth}
      onGridLineWidthChange={setGridLineWidth}
      coordinateFontSize={coordinateFontSize}
      onCoordinateFontSizeChange={setCoordinateFontSize}
      fontScale={fontScale}
      onFontScaleChange={setFontScale}
      restoreLastPosition={restoreLastPosition}
      onRestoreLastPositionChange={setRestoreLastPosition}
      onOpenImport={openImportSheet}
      onOpenExport={openExportSheet}
      onBackup={() => { void exportBackup(); }}
      onRestoreBackup={() => backupFileInput.current?.click()}
      onOpenHelp={() => setSheet("help")}
      onOpenTour={() => { setTab("record"); setTourOpen(true); }}
      onOpenManual={() => setSheet("manual")}
      onOpenFeedback={() => setSheet("feedback")}
      onOpenAbout={() => setSheet("about")}
    />
     {layoutEditorOpen && <ActionLayoutEditor value={actionLayouts} mode={mode} onApply={applyActionLayout} onClose={() => setLayoutEditorOpen(false)}/>}
     <main id="main-content" className={`app-main ${tab === "settings" ? "settings-main" : ""}`.trim()}>
      {tab === "record" && <div className={`record-page action-layout-page ${recordToolsCount >= 2 ? "record-tools-stacked" : ""} ${commentExpandedWithTools ? "comment-expanded-with-tools" : ""}`.trim()}>
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
          aiGame={Boolean(aiGame)}
          onToggleSelector={() => { if (mode === "puzzle") setSheet(null); setWorkspaceSelectorOpen((open) => !open); }}
          onExitAiGame={exitAiGame}
          annotationErase={annotationErase}
          onExitAnnotationErase={() => setAnnotationErase(false)}
          eraseStone={eraseStone}
          onExitEraseStone={() => setEraseStone(false)}
        />
         {mode === "record" && aiGame && aiOpeningStage?.kind !== "normal" && <section className="ai-opening-banner" aria-live="polite"><span className="ai-opening-step">开</span><div><b>{openingRuleName(aiGame.opening.rule, aiGame.opening.n)}</b><small>{openingInstruction(aiGame.opening)}</small></div>{aiOpeningStage?.kind === "swap" && aiOpeningStage.chooser === "human" && <div className="ai-opening-actions"><button onClick={() => chooseOpeningSwap(false)}>{aiOpeningStage.taraguchiChoice ? "进入十打" : "不交换"}</button><button className="accent" onClick={() => chooseOpeningSwap(true)}>交换</button></div>}{aiThinking && <i className="ai-opening-thinking"/>}</section>}
          <Board document={reviewDocument} currentId={currentId} currentBookmarked={activeBookmarks.some((bookmark) => bookmark.nodeId === currentId)} showNumbers={showNumbers} showCoordinates={showCoordinates} showLastMove={showLastMove} moveNumberScale={moveNumberScale} gridLineWidth={gridLineWidth} coordinateFontSize={coordinateFontSize} largeBoard={largeBoard} rotation={rotation} mirrored={mirrored} boardTheme={boardTheme} stoneTheme={stoneTheme} boardOpacity={boardOpacity} stoneOpacity={stoneOpacity} annotationHighlight={annotationHighlight} initialDepth={isPuzzleMode ? puzzleSetup ? 0 : puzzleInitialDepth : 0} forbiddenMarkers={boardForbiddenMarkers} winningLines={boardWinningLines} openingCandidates={aiGame?.opening.candidates || []} analysisCandidates={!aiGame && enhancementSettings.analysisShowCandidates && aiAnalysis.contextKey === currentPositionKey ? rankAnalysisCandidates(aiAnalysis.candidates || [], analysisShownMetric).slice(0, enhancementSettings.analysisCandidateCount) : []} analysisCandidateMetric={analysisShownMetric} analysisCandidateDecimals={enhancementSettings.analysisCandidateDecimals} analysisPreviewLine={analysisPreviewLine} analysisPreviewMove={analysisPreviewLine.length ? analysisPreview : null} analysisPreviewGuide={enhancementSettings.analysisPreviewGuide} openingStage={aiOpeningStage} thinking={machineThinking} thinkingIndicatorPosition={enhancementSettings.thinkingIndicatorPosition} onStopThinking={stopUnifiedThinking} motion={boardMotion} feedback={boardFeedback} result={boardResult} gestureZoomEnabled={enhancementSettings.gestureZoom} gestureSwipeEnabled={enhancementSettings.gestureSwipe} disabled={dynamicNavigationBusy || (isPuzzleMode && !puzzleSetup && (aiThinking || !!puzzleOutcome)) || aiBoardDisabled} onPlay={play} onVariation={!isPuzzleMode && !aiGame && !continuationEditMode && !annotationActive && !eraseStone ? navigateVariation : undefined} onMark={(mode === "record" || mode === "review") && !aiGame ? mark : () => undefined} onGestureStep={!isPuzzleMode ? (delta) => { if (delta < 0) goPrev(); else goNext(); } : undefined}/>
          <div className="record-rail">
          <div className="action-layout-workspace" data-action-size={actionLayout.size} data-icons-only={actionLayout.iconsOnly}>
          {/* 做题的状态文字 + 黑白切换在首行功能区之上（用户 09-10）；常驻操作区做题默认为空。 */}
          {isPuzzleMode && !compactPuzzleHeader && puzzleStatusRow(puzzleStatusCopy)}
          {actionLayout.bottom.length > 0 && <nav className="dock-tabs action-bottom-row" aria-label="首行功能区">{actionLayout.bottom.map((id) => renderWorkspaceAction(id, "bottom"))}</nav>}
          {renderTopRow(actionLayout.top)}
        {isPuzzleMode
          ? puzzleNavRow
          : actionLayout.moves.length > 0 && <div className="moves-row" aria-label="走棋导航" data-moves-labels={actionLayout.movesLabels && !actionLayout.iconsOnly ? "on" : "off"}>{actionLayout.moves.map((id) => renderWorkspaceAction(id, "moves"))}</div>}
        {dockPanel && <section className="context-dock action-subpanels" aria-label="子功能区">
          <div className="action-tool-panel">{workspaceDockPanel}</div>
        </section>}
        {commentPreview}
          </div>
          </div>
      </div>}

      {tab === "library" && <div className="library-page page-padding">
        <div className="library-segment" role="tablist"><button className={librarySection === "records" ? "active" : ""} onClick={() => { setLibrarySection("records"); setExpandedLibraryFolders(new Set([libraryFolders.recordFolders[0] || ""])); }} role="tab">棋谱 <small>{library.length + largeSummaries.length}</small></button><button className={librarySection === "puzzles" ? "active" : ""} onClick={() => { setLibrarySection("puzzles"); setExpandedLibraryFolders(new Set([libraryFolders.puzzleFolders[0] || ""])); }} role="tab">题库 <small>{puzzleCollections.length}</small></button></div>
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
          <div className="library-shortcuts" aria-label="棋谱库快捷入口"><button onClick={openRecordImportPicker} title="导入 SGF / LIB / JSON 等棋谱文件"><Download/>导入棋谱</button><button onClick={newRecord} title="从空棋盘开始"><FilePlus2/>新建棋谱</button><button onClick={() => createLibraryFolder("records")} title="整理棋谱分组"><FolderPlus/>新建文件夹</button><button onClick={() => setSheet("favorites")} title="收藏的棋谱"><Star/>收藏</button><button onClick={() => setSheet("bookmarks")} title="带分支书签的棋谱"><Bookmark/>分支书签</button><button onClick={() => setSheet("dataSafety")} title="完整备份与恢复"><ArchiveRestore/>资料安全</button><button className="recycle-bin-entry" onClick={() => setSheet("trash")} aria-label="回收站" title="删除的内容可恢复或彻底清理"><Recycle/>回收站</button><button aria-label="批量处理" className={batchEditMode ? "batch-active" : ""} onClick={() => { setBatchEditMode((active) => !active); setBatchSelectedIds([]); }}><ClipboardList/>{batchEditMode ? "退出批量" : "批量处理"}</button></div>
          {batchEditMode && <div className="batch-selection-bar" role="status" aria-live="polite"><span>已选择 {batchSelectedIds.length} 份</span><button type="button" onClick={selectAllBatchResults}>全选</button><button type="button" onClick={clearBatchSelection}>取消全选</button><button type="button" disabled={!batchSelectedIds.length} onClick={() => { setFolderSheetMode("batch-move"); setFolderCreationParent(libraryFolders.recordFolders[0] || "未分类"); setSheet("folder"); }}>移动</button><button type="button" className="batch-delete-action" disabled={!batchSelectedIds.length} onClick={() => { if (window.confirm(`确认删除已选择的 ${batchSelectedIds.length} 份棋谱？`)) { batchSelectedDocuments.forEach((item) => deleteRecord(item)); closeBatchEdit(); } }}>删除</button><button type="button" className="accent" disabled={!batchSelectedIds.length} onClick={() => setSheet("batchEdit")}>更多</button><button type="button" onClick={closeBatchEdit}>退出</button></div>}
          <div className="folder-library-list">{folderChildren(libraryFolders.recordFolders, "").map(renderRecordFolder)}</div>
         </> : <>
           <RecentPuzzleSection items={recentPuzzles} onOpen={(item: RecentPuzzleItem) => guardedOpenPuzzle(item.collectionIndex, item.puzzleIndex)} />
           <div className="library-shortcuts" aria-label="题库快捷入口"><button onClick={() => setSheet("wrongbook")} title="尝试过但尚未攻克的题目"><Layers3/>错题本</button><button onClick={openPuzzleImportPicker} title="导入 puzzles 题库 JSON"><Download/>导入题库</button><button onClick={() => createLibraryFolder("puzzles")} title="自由整理题集"><FolderPlus/>新建文件夹</button><button onClick={() => setSheet("puzzleFavorites")} title="收藏的题集"><Star/>收藏</button><button onClick={() => setSheet("dataSafety")} title="完整备份与恢复"><ArchiveRestore/>资料安全</button><button className="recycle-bin-entry" onClick={() => setSheet("trash")} aria-label="回收站" title="删除的内容可恢复或彻底清理"><Recycle/>回收站</button><button aria-label="批量处理" className={puzzleBatchMode ? "batch-active" : ""} onClick={() => { setPuzzleBatchMode((active) => !active); setPuzzleBatchSelectedIds([]); }}><ClipboardList/>{puzzleBatchMode ? "退出批量" : "批量编辑"}</button></div>
          {puzzleBatchMode && <div className="batch-selection-bar" role="status" aria-live="polite"><span>已选择 {puzzleBatchSelectedIds.length} 个题集</span><button type="button" onClick={selectAllPuzzleBatch}>全选</button><button type="button" onClick={clearPuzzleBatchSelection}>取消全选</button><button type="button" disabled={!puzzleBatchSelectedIds.length} onClick={() => { setFolderSheetMode("batch-move"); setFolderCreationSection("puzzles"); setFolderCreationParent(libraryFolders.puzzleFolders[0] || ""); setSheet("folder"); }}>移动</button><button type="button" className="batch-delete-action" disabled={!puzzleBatchSelectedIds.length} onClick={deletePuzzleBatchSelection}>删除</button><button type="button" onClick={closePuzzleBatch}>退出</button></div>}
          <div className="folder-library-list">{folderChildren(libraryFolders.puzzleFolders, "").map(renderPuzzleFolder)}</div>
        </>}
      </div>}

      {tab === "settings" && <SettingsPage
        onOpenLayout={openLayoutEditor}
        aiEngineChoice={aiEngineChoice}
        enginePackReady={enginePackReady}
        onAiEngineChoiceChange={updateAiEngineChoice}
        thinkingIndicatorPosition={enhancementSettings.thinkingIndicatorPosition}
        onThinkingIndicatorPositionChange={(thinkingIndicatorPosition) => changeEnhancementSettings({ ...enhancementSettings, thinkingIndicatorPosition })}
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
        showLastMove={showLastMove}
        moveNumberScale={moveNumberScale}
        gridLineWidth={gridLineWidth}
        coordinateFontSize={coordinateFontSize}
         motionEnabled={motionEnabled}
         restoreLastPosition={restoreLastPosition}
        onShowNumbersChange={setShowNumbers}
        onShowCoordinatesChange={setShowCoordinates}
        onShowLastMoveChange={setShowLastMove}
        onMoveNumberScaleChange={setMoveNumberScale}
        onGridLineWidthChange={setGridLineWidth}
        onCoordinateFontSizeChange={setCoordinateFontSize}
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
        onOpenTour={() => { setTab("record"); setTourOpen(true); }}
        onOpenFeedback={() => setSheet("feedback")}
        enhancementSettings={enhancementSettings}
        onEnhancementSettingsChange={changeEnhancementSettings}
        updateAutoCheck={updateAutoCheck}
        onUpdateAutoCheckChange={changeUpdateAutoCheck}
      />}
      </main>

    <nav className="bottom-nav" aria-label="主导航"><button aria-current={tab === "record" ? "page" : undefined} className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}><Home/><span>{mode === "puzzle" ? "做题" : "打谱"}</span></button><button aria-current={tab === "library" ? "page" : undefined} className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>棋谱库</span></button><button className="nav-center" onClick={openImportSheet}><Download/><span>导入</span></button><button className={aiGame ? "active" : ""} onClick={openAiGameSheet}><Bot/><span>AI</span></button><button aria-current={tab === "settings" ? "page" : undefined} className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings/><span>设置</span></button></nav>
      {importProgress && <ImportProgressCard state={importProgress}/>}
       {enhancementSettings.coachMarks && coachMark && <CoachMark id={coachMark} onAction={handleCoachMarkAction}/>}
     <AppToast message={toast} onClose={() => setToast("")}/>

     {welcomeOpen && <FirstRunWelcome onDismiss={dismissFirstRunWelcome} onOpenManual={openManualFromFirstRun} onStartTour={startFirstRunTour}/>}
     {tourOpen && <AppTour onNavigate={(t) => setTab(t)} onFinish={finishTour} onStepChange={(step) => setQuickDrawerOpen(step.id === "quick-layout")}/>}
     {guideTour && <AppTour key={`guide-${guideTour.index}`} steps={guideTour.steps} onNavigate={(t) => setTab(t)} onFinish={finishManualGuide} onStepChange={handleGuideStep}/>}

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
        folders={[...libraryFolders.recordFolders, NATIVE_RECORD_FOLDER]}
        assignments={libraryFolders.recordAssignments}
        onSelectRecord={(item) => { closeWorkspaceSelector(); openRecord(item, item.rootId, { mode: mode === "review" ? "review" : "record" }); }}
        onSelectLargeRecord={(item) => { closeWorkspaceSelector(); openLargeRecord(item, mode === "review" ? "review" : "record"); }}
        nativeDatabase={{ title: NATIVE_DATABASE_TITLE, hint: "内置局面数据库 · 分支按局面实时查询", onOpen: () => { closeWorkspaceSelector(); openNativeDatabase(); } }}
        onClose={closeWorkspaceSelector}
      />}

     {pendingSwitch && <BottomSheet title="有未保存草稿" className="draft-guard-backdrop" manageHistory onClose={() => setPendingSwitch(null)}><div className="sheet-body"><p className="section-note">继续当前操作前请先处理当前未保存的草稿，否则将丢失。</p><button className="primary-button" onClick={savePendingSwitch}><Save/>保存草稿并切换</button><button className="secondary-button" onClick={discardPendingSwitch}><X/>放弃草稿并切换</button><button className="secondary-button" onClick={() => setPendingSwitch(null)}>取消</button></div></BottomSheet>}
      {updatePrompt && <BottomSheet title="发现新版本" manageHistory onClose={dismissUpdatePrompt}><div className="sheet-body update-prompt-sheet">
        <div className="update-prompt-versions"><span><b>v{APP_VERSION}</b><small>当前版本</small></span><ArrowRight size={18} aria-hidden="true"/><span className="to"><b>v{updatePrompt.version}</b><small>最新版本{updatePrompt.publishedAt ? ` · ${updatePrompt.publishedAt.slice(0, 10)}` : ""}</small></span></div>
        <p className="section-note">下载新版安装包覆盖安装即可，本地棋谱、题库与设置数据不受影响。现在不方便的话，之后也可以在「设置 → 关于」里随时再次检查。</p>
        <a className="primary-button" href={updatePrompt.url} target="_blank" rel="noreferrer" onClick={dismissUpdatePrompt}><Download size={16}/>立即更新到 v{updatePrompt.version}</a>
        <button className="secondary-button" onClick={dismissUpdatePrompt}>以后再说</button>
      </div></BottomSheet>}

    {sheet && <BottomSheet title={displaySheetTitle} className={sheet === "tree" ? "tree-sheet-backdrop" : sheet === "manual" ? "manual-sheet-backdrop" : ""} manageHistory onClose={() => setSheet(null)}>
    {sheet === "batchEdit" && <div className="sheet-body batch-action-sheet">
        <p className="section-note">仅处理普通棋谱，不会改写大型数据库。大型 LIB、DP、DB 只支持单独打开或导出。</p>
        <button className="export-primary-card" disabled={!batchSelectedIds.length} onClick={runBatchExport}><span className="format-icon"><Download/></span><div><b>批量导出</b><small>{batchSelectedIds.length ? "已选择 " + batchSelectedIds.length + " 项" : "请先选择至少一份普通棋谱"}</small></div><Upload/></button>
        <button className="export-primary-card" disabled={!batchSelectedIds.length} onClick={() => { setFavorites((current) => ({ ...current, records: [...new Set([...current.records, ...batchSelectedIds])] })); setToast(`已收藏 ${batchSelectedIds.length} 份棋谱`); closeBatchEdit(); }}><span className="format-icon"><Star size={18}/></span><div><b>收藏所选</b><small>{batchSelectedIds.length ? "加入收藏文件夹（已收藏的保留）" : "请先选择至少一份普通棋谱"}</small></div><ChevronRight/></button>
        <section className="batch-replace-card"><div className="batch-action-heading"><MessageSquareText size={19}/><div><b>批量替换注释</b><small>同时处理节点注释与局面文字</small></div></div><label>查找文字<input value={batchReplaceFrom} onChange={(event) => setBatchReplaceFrom(event.target.value)} placeholder="例如：待复核"/></label><label>替换为<input value={batchReplaceTo} onChange={(event) => setBatchReplaceTo(event.target.value)} placeholder="留空表示删除"/></label><button className="primary-button" disabled={!batchSelectedIds.length || !batchReplaceFrom} onClick={runBatchReplace}><Save/>执行替换</button></section>
        <button className="secondary-button" onClick={closeBatchEdit}><X/>完成</button>
      </div>}
      {sheet === "aiGame" && <div className="sheet-body ai-game-setup">
        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><Cpu size={14}/>引擎</div>
          <div className="ai-setup-cells three">
            <button type="button" className={aiEngineChoice === "light" ? "selected" : ""} onClick={() => updateAiEngineChoice("light")} aria-pressed={aiEngineChoice === "light"}><span>轻量引擎</span><small>随包快速版 · 免下载</small></button>
            <button type="button" className={aiEngineChoice === "strong" ? "selected" : ""} onClick={() => { if (!engineNeedsPack(aiEngineChoice) && !enginePackState) setToast("强力引擎包尚未下载（38.4MB），可点下方立即下载"); updateAiEngineChoice("strong"); }} aria-pressed={aiEngineChoice === "strong"}><span>强力引擎</span><small>{enginePackState ? "128MB 标准 · 已生效" : "冠军网络 · 需下载"}</small></button>
            <button type="button" className={aiEngineChoice === "tuned" ? "selected" : ""} onClick={() => { if (!engineNeedsPack(aiEngineChoice) && !enginePackState) setToast("自调引擎依赖冠军引擎包（38.4MB），可点下方立即下载"); updateAiEngineChoice("tuned"); }} aria-pressed={aiEngineChoice === "tuned"}><span>自调引擎</span><small>{enginePackState ? "内存可自定义" : "内存可自定义 · 需下载"}</small></button>
          </div>
          {aiEngineChoice === "tuned" && <label className="think-search-row"><span><b>分析内存</b><small>128-2048MB 自调，长分析/不限时更深（实验）；分配失败先降 256MB 重试，仍失败再回落轻量</small></span><output>{fmtAnalysisMemory(enhancementSettings.analysisMaxMemoryMb)}</output><input aria-label="分析内存滑杆" type="range" min="256" max="2048" step="32" value={enhancementSettings.analysisMaxMemoryMb} onChange={(event) => { const v = Math.min(2048, Math.max(256, Number(event.target.value))); changeEnhancementSettings({ ...enhancementSettings, analysisMaxMemoryMb: v }); if (memoryNumberRef.current) memoryNumberRef.current.value = String(v); }}/><input ref={memoryNumberRef} aria-label="分析内存数值" type="number" min="256" max="2048" step="32" defaultValue={enhancementSettings.analysisMaxMemoryMb} onBlur={(event) => { const v = Math.min(2048, Math.max(256, Math.round(Number(event.target.value) || 256))); changeEnhancementSettings({ ...enhancementSettings, analysisMaxMemoryMb: v }); event.currentTarget.value = String(v); }} onKeyDown={(event) => { if (event.key === "Enter") { const target = event.currentTarget; const v = Math.min(2048, Math.max(256, Math.round(Number(target.value) || 256))); changeEnhancementSettings({ ...enhancementSettings, analysisMaxMemoryMb: v }); target.value = String(v); target.blur(); } }}/></label>}
          {engineNeedsPack(aiEngineChoice) && !enginePackState && <div className="ai-engine-download-row">{enginePackDownloading ? <p className="helper">{aiPackProgress && aiPackProgress.totalBytes > 0 ? `正在下载强力引擎包… ${Math.floor((aiPackProgress.receivedBytes / aiPackProgress.totalBytes) * 100)}%（${(aiPackProgress.receivedBytes / 1048576).toFixed(1)} / ${(aiPackProgress.totalBytes / 1048576).toFixed(1)}MB），下载完成后自动生效` : "正在连接下载源…（下载完成后自动生效，无需重启）"}</p> : <button type="button" className="primary-button" onClick={() => { setEnginePackDownloading(true); setAiPackProgress(null); downloadEnginePack((next) => setAiPackProgress(next)).then(() => setToast("强力引擎包下载完成，已自动生效")).catch((error) => setToast(error instanceof Error ? error.message : "引擎包下载失败")).finally(() => { setEnginePackDownloading(false); setAiPackProgress(null); }); }}><Download size={16}/>立即下载强力引擎包（38.4MB）</button>}</div>}
        </section>

        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><BookOpen size={14}/>规则<button type="button" className="ai-rule-help-btn" aria-label="查看所有规则说明" title="查看所有规则说明" onClick={() => setSheet("rules")}>?</button></div>
          <div className="ai-setup-cells two">
            <button type="button" className={selectedAiRule.badge === "无禁" ? "selected" : ""} onClick={() => setAiFloatPanel(aiFloatPanel === "rule-noForbidden" ? null : "rule-noForbidden")} aria-expanded={aiFloatPanel === "rule-noForbidden"}><span>无禁手</span><small>{selectedAiRule.badge === "无禁" ? selectedAiRule.name : `${AI_RULE_GROUPS["无禁"].length} 种规则`}</small><ChevronDown size={14}/></button>
            <button type="button" className={selectedAiRule.badge === "有禁" ? "selected" : ""} onClick={() => setAiFloatPanel(aiFloatPanel === "rule-forbidden" ? null : "rule-forbidden")} aria-expanded={aiFloatPanel === "rule-forbidden"}><span>有禁手</span><small>{selectedAiRule.badge === "有禁" ? selectedAiRule.name : `${AI_RULE_GROUPS["有禁"].length} 种规则`}</small><ChevronDown size={14}/></button>
          </div>
        </section>

        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><Gauge size={14}/>难度</div>
          <div className="ai-setup-difficulty-line">
            <button type="button" className="ai-setup-cell single" onClick={() => setAiFloatPanel(aiFloatPanel === "difficulty" ? null : "difficulty")} aria-expanded={aiFloatPanel === "difficulty"}><span>{aiStrength}</span><small>{AI_STRENGTH_OPTIONS.find((option) => option.value === aiStrength)?.text}</small><ChevronDown size={14}/></button>
            {/* 开局库只服务人机：开关放在本弹窗难度行右侧（默认关，关闭时引擎路径与无库版本一致） */}
            <button type="button" className={`ai-setup-book-toggle ${enhancementSettings.openingBook ? "on" : ""}`} aria-pressed={enhancementSettings.openingBook} title="开局库（打点簿）：开启后人机对局优先查内置打点簿（索索夫 / 山口五手两打，按开局规则自动选簿），命中毫秒级秒落；未命中照常走引擎。开关持久生效（默认关），设置「可选增强功能」里有同一开关" onClick={() => changeEnhancementSettings({ ...enhancementSettings, openingBook: !enhancementSettings.openingBook })}><Library size={14}/><span>开局库</span><small>{enhancementSettings.openingBook ? "已开启" : "已关闭"}</small></button>
          </div>
        </section>

        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><Clock size={14}/>时间</div>
          <button type="button" className="ai-setup-cell single" onClick={() => setAiFloatPanel(aiFloatPanel === "time" ? null : "time")} aria-expanded={aiFloatPanel === "time"}><span>{AI_TIME_OPTIONS.find((option) => option.value === aiTimeLimitMs)?.title}</span><small>{AI_TIME_OPTIONS.find((option) => option.value === aiTimeLimitMs)?.text}</small><ChevronDown size={14}/></button>
        </section>

        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><CircleDot size={14}/>执子</div>
          <div className="ai-setup-cells two">
            <button type="button" className={aiHumanPlayer === "black" ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiHumanPlayer("black"); }} aria-pressed={aiHumanPlayer === "black"}><i className="player-stone black"/><span>执黑</span><small>开局方</small></button>
            <button type="button" className={aiHumanPlayer === "white" ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiHumanPlayer("white"); }} aria-pressed={aiHumanPlayer === "white"}><i className="player-stone white"/><span>执白</span><small>应对方</small></button>
          </div>
        </section>

        <button className="primary-button ai-start-button" onClick={startNewAiGame}><Bot size={18}/>{aiGame ? "按新规则重新开始" : "开始人机对战"}</button>
        <p className="helper">开局交换只影响起始流程，后续仍按当前规则继续。开局库开关在难度行右侧，默认关闭；开启后 AI 开局优先按内置打点簿（索索夫 / 山口五手两打，按规则自动选书）毫秒落子。</p>

        {aiFloatPanel && <div className="ai-float-wrap" role="dialog" aria-modal="true">
          <div className="ai-float-backdrop" onClick={() => setAiFloatPanel(null)} />
          <div className="ai-float-panel">
            <div className="ai-float-head"><b>{aiFloatPanel === "rule-noForbidden" ? "无禁手规则" : aiFloatPanel === "rule-forbidden" ? "有禁手规则" : aiFloatPanel === "difficulty" ? "AI 难度" : "对局时长"}</b><button type="button" onClick={() => setAiFloatPanel(null)} aria-label="关闭"><X size={16}/></button></div>
            {aiFloatPanel === "rule-noForbidden" && <div className="ai-float-list">{AI_RULE_GROUPS["无禁"].map((choice) => <button type="button" key={choice.key} className={selectedAiRule.key === choice.key ? "selected" : ""} onClick={() => { applyAiRuleChoice(choice); setAiFloatPanel(null); }} aria-pressed={selectedAiRule.key === choice.key}><span>{choice.name}</span><small>{choice.summary}</small></button>)}</div>}
            {aiFloatPanel === "rule-forbidden" && <div className="ai-float-list">{AI_RULE_GROUPS["有禁"].map((choice) => <button type="button" key={choice.key} className={selectedAiRule.key === choice.key ? "selected" : ""} onClick={() => { applyAiRuleChoice(choice); setAiFloatPanel(null); }} aria-pressed={selectedAiRule.key === choice.key}><span>{choice.name}</span><small>{choice.summary}</small></button>)}</div>}
            {aiFloatPanel === "difficulty" && <>
              {/* 选完即关（用户 09-10）：只有「自由」需要继续调参数，留在此面板。 */}
              <div className="ai-float-list">{AI_STRENGTH_OPTIONS.map((option) => <button type="button" key={option.value} className={aiStrength === option.value ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiStrength(option.value); if (option.value !== "自由") setAiFloatPanel(null); }} aria-pressed={aiStrength === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>
              {aiStrength === "自由" && <div className="ai-free-controls"><button type="button" className={`ai-unlimited-option ${aiFreeUnlimited ? "selected" : ""}`} aria-pressed={aiFreeUnlimited} onClick={() => { cancelActiveAiComputation("settings-change"); setAiFreeUnlimited((value) => !value); }}><span><b>不限时思考</b><small>持续搜索，直到你主动停止、切换局面或应用进入后台</small></span><Check/></button><label className={aiFreeUnlimited ? "disabled" : ""}><span>思考时间</span><div className="ai-free-time-entry"><input aria-label="自定义思考时间（秒）" type="number" min="0.3" max="300" step="0.1" disabled={aiFreeUnlimited} value={(aiFreeTimeMs / 1000).toFixed(1)} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeTimeMs(Math.max(300, Math.min(300000, Math.round((Number(event.target.value) || 0.3) * 1000)))); }}/><em>秒</em></div><input aria-label="思考时间滑杆" type="range" min="300" max="300000" step="100" disabled={aiFreeUnlimited} value={aiFreeTimeMs} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeTimeMs(Number(event.target.value)); }}/><small>{aiFreeUnlimited ? "不限时模式不会自动到时落子" : "可输入 0.3–300 秒，最长 5 分钟"}</small></label><label><span>搜索深度</span><output>{aiFreeUnlimited ? "持续加深" : `${aiFreeDepth} 层`}</output><input aria-label="搜索深度滑杆" type="range" min="16" max="128" step="8" disabled={aiFreeUnlimited} value={aiFreeDepth} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeDepth(Number(event.target.value)); }}/></label></div>}
            </>}
            {/* 对局时长都是预设档，选完即关（无自定义项）。 */}
            {aiFloatPanel === "time" && <div className="ai-float-list">{AI_TIME_OPTIONS.map((option) => <button type="button" key={option.value} className={aiTimeLimitMs === option.value ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiTimeLimitMs(option.value); setAiFloatPanel(null); }} aria-pressed={aiTimeLimitMs === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>}
          </div>
        </div>}
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
      {sheet === "folder" && <div className="sheet-body form-grid folder-sheet"><label>{folderSheetMode === "batch-move" ? "移动到文件夹" : "上级文件夹"}<select value={folderCreationParent} onChange={(event) => setFolderCreationParent(event.target.value)}>{folderSheetMode === "create" && <option value="">根目录</option>}{folderOptions(folderCreationSection === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders)}</select></label>{folderSheetMode === "create" ? <><label>文件夹名称<input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder={`例如：${folderCreationSection === "records" ? "我的实战棋谱" : "冲四题库"}`} onKeyDown={(event) => { if (event.key === "Enter") confirmCreateLibraryFolder(); }}/></label><p className="helper">可选择上级文件夹建立子目录；移动棋谱或题集时也会显示完整层级。</p><button className="primary-button" onClick={confirmCreateLibraryFolder}><FolderPlus/>创建文件夹</button></> : <><p className="helper">{folderCreationSection === "puzzles" ? `已选择 ${puzzleBatchSelectedIds.length} 个题集，将移动到所选文件夹。` : `已选择 ${batchSelectedIds.length} 份棋谱，将移动到所选文件夹。`}</p><button className="primary-button" onClick={folderCreationSection === "puzzles" ? movePuzzleBatchToFolder : moveBatchSelectionToFolder}><FolderOpen/>确认移动</button></>}</div>}
      {sheet === "rename" && renameTarget && <div className="sheet-body form-grid rename-sheet"><div className="rename-summary"><span><PenLine size={18}/></span><div><b>{renameTarget.kind.includes("folder") ? "文件夹" : renameTarget.kind === "puzzle" ? "题目" : renameTarget.kind === "puzzle-collection" ? "题集" : "棋谱"}</b><small>当前位置：{renameTarget.kind.includes("folder") ? folderDisplayLabel(renameTarget.name) : renameTarget.name}</small></div></div><label>新的名称<input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={80} onKeyDown={(event) => { if (event.key === "Enter") void confirmLibraryRename(); }}/></label><p className="helper">{renameTarget.kind.includes("folder") ? "重命名父文件夹时，里面的子文件夹和内容会一起保留并更新路径。" : "只修改显示名称，不会改变棋谱内容、题目进度或所在文件夹。"}</p><button className="primary-button" onClick={() => { void confirmLibraryRename(); }}><Check/>确认重命名</button></div>}
      {sheet === "find" && <RecordSearchPanel document={document} query={findQuery} results={findResults} onQueryChange={setFindQuery} onJump={(nodeId) => { clearBoardMotion(); setCurrentId(nodeId); }}/>}
      {sheet === "positionSearch" && <div className="sheet-body position-search-sheet"><label className="match-toggle"><span><b>包含旋转与镜像</b><small>不同棋盘朝向也视为同一局面</small></span><input type="checkbox" checked={matchSymmetry} onChange={(event) => setMatchSymmetry(event.target.checked)}/><i/></label><p className="section-note">已扫描 {searchableDocuments.length} 份本地棋谱的主线和全部变化，找到 {visiblePositionMatches.length} 个其他节点{positionMatches.length >= 60 ? "（只显示前 60 个）" : ""}。</p><div className="position-match-list">{visiblePositionMatches.map((match) => <button key={`${match.documentId}-${match.nodeId}`} onClick={() => { const target = searchableDocuments.find((item) => item.id === match.documentId); if (!target) return; openRecord(target, match.nodeId, { onOpened: () => { setSheet(null); setToast(`已跳转到《${match.title}》第 ${match.depth} 手`); } }); }}><span>{match.depth}</span><div><b>{match.title}</b><small>第 {match.depth} 手{match.coordinate ? ` · ${match.coordinate}` : " · 起始局面"}</small></div><ChevronRight size={18}/></button>)}</div>{!visiblePositionMatches.length && <div className="sheet-empty"><Search/><b>棋谱库中没有其他相同局面</b><span>{matchSymmetry ? "已同时比较旋转与镜像方向。" : "可开启旋转与镜像后再试。"}</span></div>}<p className="helper">匹配同时比较黑白棋位置和下一手行棋方；点击结果会直接打开对应棋谱节点。</p></div>}
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
      {sheet === "import" && <div className="sheet-body import-options"><button className="import-choice" onClick={() => { setSheet(null); if (mode === "puzzle") puzzleFileInput.current?.click(); else singleFileInput.current?.click(); }}><span className="format-icon"><Download/></span><div><b>{mode === "puzzle" ? "导入题库文件" : "导入棋谱文件"}</b><small>{mode === "puzzle" ? "puzzles 题库对象、连续坐标串、二维 JSON 数组" : "SGF、LIB、JSON、POS 等格式；题库 JSON 会自动识别"}</small></div><ChevronRight/></button><button className="import-choice" onClick={() => { setSheet(null); imageFileInput.current?.click(); }}><span className="format-icon json"><Download/></span><div><b>图片识谱</b><small>{enhancementSettings.devMoveOrderRestore ? "自动定位网格识别棋子与颜色；可开启「复原手序」按棋子序号重建落子顺序" : "自动定位网格识别棋子与颜色"}</small></div><ChevronRight/></button>{enhancementSettings.recentImports && recentImports.length > 0 && <section className="recent-imports" aria-label="最近导入"><div className="recent-imports-heading"><b>最近导入</b><small>保留最近 5 个来源文件</small></div><div className="recent-import-list">{recentImports.map((entry) => <button key={entry.id} className="recent-import-item" onClick={() => { void reopenRecentImport(entry); }} aria-label={`重新打开 ${entry.name}`}><span className="recent-import-icon">{entry.kind === "puzzle" ? "题" : "谱"}</span><span className="recent-import-copy"><b title={entry.name}>{entry.name}</b><small>{entry.kind === "puzzle" ? "题库" : "棋谱"} · {entry.available ? "可一键重开" : "文件较大，请重新选择"}</small></span><ChevronRight size={16}/></button>)}</div></section>}{mode === "puzzle" && <p className="helper">题库 JSON 可使用 puzzles 包装格式：每题支持 stones 连续坐标串，或 blackStones / whiteStones 分色坐标串；也兼容旧格式的“坐标,颜色编号”二维数组。side 会作为题目先手读取，空题会跳过。</p>}{mode !== "puzzle" && <p className="helper">图片识谱会自动定位网格并识别棋子颜色。识别后请快速核对一遍，题库 JSON 选择后会自动转入题库。</p>}</div>}
      {sheet === "imageImport" && imageImportPreview && createPortal(
        <BoardAlignScreen
          src={imageImportPreview.url}
          alt={imageImportPreview.name}
          busy={imageRecognizing}
          restoreMoveOrder={restoreMoveOrder}
          restoreEnabled={enhancementSettings.devMoveOrderRestore}
          onRestoreMoveOrderChange={setRestoreMoveOrder}
          onCancel={closeImageImportSheet}
          onRecognize={(roi) => { void runBoardImageRecognition(imageImportPreview.file, imageImportPreview.name, { restoreMoveOrder: restoreMoveOrder && enhancementSettings.devMoveOrderRestore, roi: roi || undefined }); }}
        />,
        window.document.body,
      )}
      {sheet === "dataSafety" && <DataSafetyPanel backupBusy={backupBusy} onExportBackup={() => { void exportBackup(); }} onRestoreBackup={() => backupFileInput.current?.click()}/>}
      {sheet === "trash" && <div className="sheet-body recycle-bin-sheet"><div className="support-row"><b>已删除内容</b><span>删除后会暂存于此，恢复时会保留原来的文件夹归属。</span></div>{recycleBin.length ? <><div className="recycle-bin-toolbar"><span>{recycleBin.length} 项</span><button className="danger-text-button" onClick={emptyRecycleBin}><Trash2 size={14}/>清空回收站</button></div><div className="recycle-bin-list">{recycleBin.map((entry) => { const isPuzzle = entry.kind === "puzzle-collection"; const title = isPuzzle ? entry.item.title : entry.item.metadata.title; const detail = isPuzzle ? `${entry.item.puzzles.length} 道题 · ${entry.item.source}` : entry.kind === "large-record" ? `大型棋谱 · ${entry.item.nodeCount.toLocaleString()} 节点` : `${entry.item.metadata.black} vs ${entry.item.metadata.white}`; return <article key={`${entry.kind}-${entry.id}`} className="recycle-bin-card"><div className={`recycle-bin-icon ${isPuzzle ? "puzzle" : "record"}`}><ArchiveRestore size={18}/></div><div className="recycle-bin-copy"><b>{title}</b><small>{detail}</small><small>原文件夹：{entry.folder} · {new Date(entry.deletedAt).toLocaleDateString("zh-CN")}</small></div><div className="recycle-bin-actions"><button onClick={() => restoreRecycleEntry(entry)} aria-label={`恢复“${title}”`} title="恢复"><ArchiveRestore size={16}/></button><button className="delete-record" onClick={() => permanentlyDeleteRecycleEntry(entry)} aria-label={`彻底删除“${title}”`} title="彻底删除"><Trash2 size={16}/></button></div></article>; })}</div></> : <div className="sheet-empty"><ArchiveRestore size={34}/><b>回收站是空的</b><span>从棋谱库删除的棋谱、用户题集会先出现在这里。</span></div>}</div>}
      {sheet === "wrongbook" && <div className="sheet-body"><div className="support-row"><b>错题本</b><span>只收录已尝试但当前尚未攻克的题目。</span></div>{wrongPuzzleEntries.length ? <div className="export-options">{wrongPuzzleEntries.map((entry) => <button key={`${entry.collectionId}/${entry.puzzleId}`} className="settings-link" onClick={() => { setSheet(null); guardedOpenPuzzle(entry.collectionIndex, entry.puzzleIndex); }}><span><Layers3/><b>{entry.puzzleTitle}</b><small>{entry.collectionTitle} · {entry.attempts} 次尝试 · {new Date(entry.updatedAt).toLocaleDateString("zh-CN")}</small></span><ChevronRight/></button>)}</div> : <div className="sheet-empty"><Layers3 size={34}/><b>还没有错题</b><span>先做几道题，没过的题会自动收进这里。</span></div>}</div>}
      {sheet === "bookmarks" && <div className="sheet-body bookmark-sheet">{Object.keys(branchBookmarks).length ? <div className="bookmark-records-list">{Object.entries(branchBookmarks).map(([documentId, bookmarks]) => {
            const regular = library.find((item) => item.id === documentId);
            const large = largeSummaries.find((item) => item.id === documentId);
            const recordTitle = regular?.metadata.title || large?.metadata.title || "未找到的棋谱";
            const expanded = expandedBookmarkRecords.has(documentId);
            return <div key={documentId} className="bookmark-record">
              <button type="button" className="bookmark-record-head" onClick={() => setExpandedBookmarkRecords((set) => { const next = new Set(set); if (next.has(documentId)) next.delete(documentId); else next.add(documentId); return next; })} aria-expanded={expanded}><span className="bookmark-record-icon">{regular ? <FileClock/> : large ? <DatabaseBackup/> : <Bookmark/>}</span><span className="bookmark-record-copy"><b>{recordTitle}</b><small>{large ? "大型棋谱 · " : ""}{bookmarks.length} 个书签</small></span><ChevronRight size={16} className="bookmark-record-chevron"/></button>
              {expanded && <div className="bookmark-list">{bookmarks.map((bookmark) => editingBookmarkId === bookmark.id
                ? <div key={bookmark.id} className="bookmark-edit-row"><input className="bookmark-edit-input" value={bookmarkTitleDraft} maxLength={40} autoFocus aria-label="书签新标题" onChange={(event) => setBookmarkTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { editAnyBookmark(documentId, bookmark, { title: bookmarkTitleDraft }); setEditingBookmarkId(null); } else if (event.key === "Escape") setEditingBookmarkId(null); }}/><button type="button" className="bookmark-edit-confirm" onClick={() => { editAnyBookmark(documentId, bookmark, { title: bookmarkTitleDraft }); setEditingBookmarkId(null); }} aria-label="保存书签标题"><Check size={14}/></button><button type="button" className="bookmark-edit-cancel" onClick={() => setEditingBookmarkId(null)} aria-label="取消重命名"><X size={14}/></button></div>
                : <div key={bookmark.id} className="bookmark-jump-row"><button type="button" className="bookmark-jump-main" onClick={() => { if (regular) { openRecord(regular, bookmark.nodeId); } else if (large) { openLargeRecord(large); setToast("大型棋谱已打开，可在棋谱树中定位该书签"); } }}><span className="bookmark-dot" style={bookmark.accent ? { background: `var(--bookmark-${bookmark.accent}, var(--green))` } : undefined}/><span className="bookmark-jump-copy"><b>{bookmark.title}</b><small>{bookmark.note || "分支书签"}</small></span><LocateFixed size={14}/></button><div className="bookmark-row-actions"><button type="button" className="bookmark-action" onClick={() => { setEditingBookmarkId(bookmark.id); setBookmarkTitleDraft(bookmark.title); }} aria-label={`重命名书签“${bookmark.title}”`} title="重命名"><PenLine size={14}/></button><button type="button" className="bookmark-action bookmark-action-danger" onClick={() => { if (window.confirm(`确认删除书签“${bookmark.title}”？`)) deleteAnyBookmark(documentId, bookmark); }} aria-label={`删除书签“${bookmark.title}”`} title="删除"><Trash2 size={14}/></button></div></div>)}</div>}
            </div>;
          })}</div> : <div className="sheet-empty"><Bookmark size={34}/><b>还没有分支书签</b><span>在棋谱树面板里选中分支节点点书签，即可在这里回看。</span></div>}</div>}
      {sheet === "favorites" && <div className="sheet-body favorites-sheet">{favorites.records.length ? <div className="folder-items record-list">{[...library.filter((item) => favorites.records.includes(item.id)).map((regular) => <article key={regular.id} onClick={() => openRecord(regular)}><div className="mini-board"><span>●</span><span>○</span><b>{mainLineLength(regular)}</b></div><div className="record-info"><h3>{regular.metadata.title}</h3><p>{regular.metadata.black} vs {regular.metadata.white}</p></div><div className="library-item-actions"><button className="fav-on" onClick={(event) => { event.stopPropagation(); toggleRecordFav(regular.id); }} aria-label={`取消收藏棋谱“${regular.metadata.title}”`}><Star size={16} fill="currentColor"/></button></div></article>), ...largeSummaries.filter((item) => favorites.records.includes(item.id)).map((large) => <article key={large.id} onClick={() => openLargeRecord(large)}><div className="mini-board"><span>●</span><span>○</span><b>{large.mainLineLength}</b></div><div className="record-info"><h3>{large.metadata.title}</h3><p>{large.metadata.black} vs {large.metadata.white} · 大型棋谱</p></div><div className="library-item-actions"><button className="fav-on" onClick={(event) => { event.stopPropagation(); toggleRecordFav(large.id); }} aria-label={`取消收藏棋谱“${large.metadata.title}”`}><Star size={16} fill="currentColor"/></button></div></article>)]}</div> : <div className="sheet-empty"><Star size={34}/><b>还没有收藏的棋谱</b><span>点棋谱条目上的星标收藏。</span></div>}</div>}
      {sheet === "puzzleFavorites" && <div className="sheet-body favorites-sheet">{favorites.puzzleCollections.length ? <div className="puzzle-collection-list folder-items">{[...filteredPuzzleCollections.filter(({ collection }) => favorites.puzzleCollections.includes(collection.id)).map(({ collection, collectionIndex }) => <article key={collection.id} onClick={() => guardedOpenPuzzle(collectionIndex, 0)}><div className="puzzle-collection-main"><button style={{ width: "100%", minWidth: 0, minHeight: 56, padding: "8px 9px", border: 0, background: "transparent", display: "flex", alignItems: "center", gap: 9, textAlign: "left" }}><span className="puzzle-folder-icon">題</span><div style={{ minWidth: 0, flex: 1 }}><b>{collection.title}</b><small>{collection.puzzles.length} 道题</small></div><ChevronRight size={18}/></button><button className="library-inline-action fav-on" onClick={(event) => { event.stopPropagation(); toggleCollectionFav(collection.id); }} aria-label={`取消收藏题集“${collection.title}”`}><Star size={15} fill="currentColor"/></button></div></article>)]}</div> : <div className="sheet-empty"><Star size={34}/><b>还没有收藏的题集</b><span>点题集上的星标收藏。</span></div>}</div>}

      {sheet === "export" && <div className="sheet-body export-hub">
        <button className="export-primary-card" onClick={() => { void shareRecordFile(); }}><span className="format-icon">SGF</span><div><b>导出并分享</b><small>把当前棋谱作为 SGF 文件交给系统分享面板（微信/QQ 发出去对方可直接打开打谱）</small></div><Upload/></button>
        <section className="board-share-card">
          <div className="board-share-heading"><span className="format-icon share"><Upload/></span><div><b>分享为图片</b></div><div className="board-share-actions"><button className="primary-button" disabled={boardShareGenerating} onClick={() => { void shareBoardPng(); }}><Upload/>{boardShareGenerating ? "生成中" : "系统分享"}</button><button className="secondary-button" disabled={boardShareGenerating} onClick={() => { void saveBoardSharePng(); }}><Download/>保存</button></div></div>
          <div className="board-share-options" aria-label="分享图片内容">
            {([
              ["showMoveNumbers", "手数"],
              ["showCoordinates", "坐标"],
              ["showAnnotations", "标注"],
              ["showWatermark", "水印"],
            ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={boardShareOptions[key]} onChange={(event) => setBoardShareOptions((value) => ({ ...value, [key]: event.target.checked }))}/><i/><span>{label}</span></label>)}
          </div>
        </section>
        <section className="export-scope-section"><div className="export-scope-grid">{([
          ["whole", "整份棋谱", exportsVisibleDatabaseContent ? "当前已加载路径、分支与注释" : "完整变化树、注释与标注"],
          ["variation", "当前变化", "从起点到当前选择，并沿主线到末尾"],
          ["position", "当前局面", "只保留盘面、轮到谁走与当前标注"],
        ] as const).map(([scope, label, detail]) => <button key={scope} className={exportScope === scope ? "selected" : ""} onClick={() => setExportScope(scope)} aria-pressed={exportScope === scope} title={detail}><b>{label}</b></button>)}</div></section>
        {sourceFormat === "lib" && <button className="export-primary-card lib-convert" disabled={exportScope !== "whole" || !fullLibSgfAvailable || libSgfExporting} onClick={() => { void exportFullLibAsSgf(); }}><span className="format-icon">SGF</span><div><b>{libSgfExporting ? "正在转换完整 LIB…" : "完整 LIB 转换为 SGF"}</b><small>{exportScope !== "whole" ? "完整 LIB 转换只适用于“整份棋谱”范围" : libSgfSourceTooLarge ? "源文件超过 64MB；转换会额外申请完整 SGF 缓冲区，为避免设备内存不足已停用" : fullLibSgfAvailable ? "由 RenLib 核心转换当前未编辑的完整源棋谱" : "只对当前刚打开且未编辑、仍保留原文件的 LIB 可用"}</small></div><Upload/></button>}
        <section className="export-format-section">
          <div className="export-format-heading"><b>导出格式</b>{exportScope !== "whole" && <small>LIB 与 PSQ 需“整份棋谱”范围</small>}</div>
          <div className="export-format-grid">
            <button type="button" className={recommendedFormat === "sgf" ? "recommended" : ""} onClick={() => exportAsFormat("sgf")} title={`SGF（${exportScopeSuffix(exportScope)}）· 完整变化树、注释、评价和棋盘标注，最通用`}>{recommendedFormat === "sgf" && <em>原格式 · SGF</em>}<span className="format-icon">SGF</span><b>SGF</b></button>
            <button type="button" onClick={() => exportAsFormat("fgf")} title={`FGF（${exportScopeSuffix(exportScope)}）· SGF 语法内容，供按 .fgf 扩展名识别的五子棋软件使用`}><span className="format-icon sgf-family">FGF</span><b>FGF</b></button>
            <button type="button" onClick={() => exportAsFormat("ren")} title={`REN（${exportScopeSuffix(exportScope)}）· SGF 语法内容，按 .ren 扩展名导出`}><span className="format-icon sgf-family">REN</span><b>REN</b></button>
            <button type="button" onClick={() => exportAsFormat("renjs")} title={`RENJS（${exportScopeSuffix(exportScope)}）· SGF 语法内容，按 .renjs 扩展名导出`}><span className="format-icon sgf-family">RENJS</span><b>RENJS</b></button>
            <button type="button" onClick={() => exportAsFormat("wzq")} title={`WZQ（${exportScopeSuffix(exportScope)}）· SGF 语法内容，按 .wzq 扩展名导出`}><span className="format-icon sgf-family">WZQ</span><b>WZQ</b></button>
            <button type="button" className={recommendedFormat === "lib" ? "recommended" : ""} onClick={() => exportAsFormat("lib")} disabled={exportScope !== "whole" || binaryExportBlocked} title={exportScope !== "whole" ? "LIB 是整份棋谱格式，先切换为“整份棋谱”" : binaryExportBlocked ? "动态库视图只加载了当前可见分支；要保存完整原库请用下方“原格式直接导出”。编辑棋谱后即可把所见内容导出为 LIB" : "RenLib 3.x 棋谱库：完整变化树与注释（首手天元且无过手时写 3.0 兼容格式），爱五子棋等连珠软件可读；仅十五路"}>{recommendedFormat === "lib" && <em>原格式 · LIB</em>}<span className="format-icon lib">LIB</span><b>LIB</b></button>
            <button type="button" className={recommendedFormat === "psq" ? "recommended" : ""} onClick={() => exportAsFormat("psq")} disabled={exportScope !== "whole" || binaryExportBlocked} title={exportScope !== "whole" ? "PSQ 是整份棋谱格式，先切换为“整份棋谱”" : binaryExportBlocked ? "动态库视图只加载了当前可见分支；要保存完整原库请用“原格式直接导出”" : "Piskvorky 视角棋谱（x,y,颜色），弈心 / Gomocup 兼容，只保留主线"}>{recommendedFormat === "psq" && <em>原格式 · PSQ</em>}<span className="format-icon psq">PSQ</span><b>PSQ</b></button>
            <button type="button" className={recommendedFormat === "json" ? "recommended" : ""} onClick={() => exportAsFormat("json")} title={`JSON（${exportScopeSuffix(exportScope)}）· 半步原生数据，保留完整可编辑信息`}>{recommendedFormat === "json" && <em>原格式 · JSON</em>}<span className="format-icon json">JSON</span><b>JSON</b></button>
            <button type="button" className={recommendedFormat === "db" ? "recommended" : ""} disabled={recommendedFormat !== "db"} onClick={() => { if (recommendedFormat === "db") exportDirect(); }} title={recommendedFormat === "db" ? `按原格式 ${sourceFormat ? sourceFormat.toUpperCase() : "DB"} 原样导出（局面数据库不重新编码）` : "DP / DB 局面数据库可原样导出已打开的源文件，但不重新编码或生成新数据库"}>{recommendedFormat === "db" && <em>原格式 · {sourceFormat ? sourceFormat.toUpperCase() : "DB"}</em>}<span className="format-icon muted">DB</span><b>DB</b></button>
          </div>
          <small className="format-fidelity">{fidelityNote}</small>
        </section>
        <button className={`export-primary-card direct${recommendDirect ? " recommended" : ""}`} disabled={exportScope !== "whole" || !directExportAvailable} onClick={exportDirect}>{recommendDirect && <em className="direct-flag">原格式{sourceFormat ? ` · ${sourceFormat.toUpperCase()}` : ""}</em>}<span className="format-icon direct"><Download/></span><div><b>原格式直接导出</b><small>{exportScope !== "whole" ? "切换到“整份棋谱”后可使用原格式直出" : sourceFormat ? `按 ${sourceFormat.toUpperCase()} 原样导出${binarySourceFormats.has(sourceFormat) ? "完整原库与全部注释" : ""}` : "当前没有原始格式，将按默认 SGF 导出"}</small></div><Upload/></button>
      </div>}
       {sheet === "help" && <div className="sheet-body help-content"><div className="support-row"><b>棋谱导入</b><span>RenLib 3.x / 旧版无头 LIB（按设备能力分页导入）、SGF / FGF、REN / RENJS / WZQ（SGF 语法）、JSON、POS，以及 DP / DB 局面数据库。SGF 支持设置局面、过手、UTF-16 和同文件多盘棋。</span></div><div className="support-row"><b>导出与保真</b><span>可导出 SGF、FGF、REN、RENJS、WZQ（均为 SGF 语法内容，扩展名供不同软件识别）、RenLib LIB（十五路，含变化树与注释，首手天元且无过手时写 3.0 兼容格式，爱五子棋等连珠软件可读）、Piskvorky PSQ（只剩主线）、JSON 和 POS / TXT。普通 SGF 和 JSON 会重新生成当前完整变化树。当前刚打开且未编辑的 LIB 在 64MB 以内可由 RenLib 核心完整转换为 SGF，也可原文件直出；大型 LIB 只允许原文件直出或导出当前可见内容。编辑副本可导出 LIB / SGF / JSON 等，但不会写回源 LIB。DP / DB 可原文件直出或导出当前可见内容，不生成新数据库。</span></div><div className="support-row"><b>规则与开局</b><span>连珠规则：黑方恰五获胜、白方五个以上获胜，黑方受三三、四四、长连禁手约束；标准五子棋：双方无禁手，必须恰好五连；自由五子棋：双方无禁手，五个以上即可获胜。开局规则目前支持自由开局、五手两打、五手多打（3–10 打）、山口（先手方开局时宣布 1–10 打）、索索夫-8（白4后宣布 1–8 打，宣布后可再交换）、塔十（塔拉山口-10）和塔拉（五次交换），可在人机设置的“规则说明”中比较。</span></div><div className="support-row"><b>JSON 的用途</b><span>棋谱库读取本软件的完整变化树或带明确 moves 字段的落子列表对象；题库页读取 puzzles 包装题库、连续坐标串、黑白分色坐标串和旧版二维数组。数字坐标棋谱必须声明 coordinateBase，不猜测任意数组。</span></div><div className="support-row"><b>AI 完全本地</b><span>人机与“思考”使用应用内置 Rapfi WASM 数据，不访问 gomocalc.com，也不会上传当前棋局。</span></div><div className="support-row warning"><b>棋盘路数边界</b><span>棋盘支持 5–25 路方形棋盘，范围外的 SGF SZ 会明确拒绝，不会缩放后生成错误棋谱；内置题库固定为十五路。</span></div><div className="support-row warning"><b>TXT 不是统一棋谱标准</b><span>TXT 仅作为纯文本坐标序列兼容入口，例如 H8 I8 H9；带专有结构的文本应使用原软件导出的 SGF。</span></div><div className="support-row warning"><b>LIB 兼容边界</b><span>大型 LIB 在后台线程解析并按页存储。完整转 SGF 会额外申请整份输出缓冲区，因此源文件超过 64MB 时主动停用，避免手机或低内存设备崩溃。原谱的普通注释、局面文字和 RenLib 标记会分别保留并在节点详情中显示；超出 RenLib 3.4 的扩展仍会提示。导出 LIB 仅支持十五路；摆局面节点无法在 LIB 中表达，导出时会提升其子分支并提示。</span></div><h3>手机快捷操作</h3><ul><li>点空交叉点：落子；点已有棋子：不会改变局面</li><li>底部“标注”：放置数字、胜败平衡和自定义文字</li><li>长按交叉点：圆圈 → 三角 → 叉号 → 清除</li><li>左右方向键（外接键盘）：前后导航</li></ul><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></div>}
      {sheet === "about" && <AboutPanel onClose={() => setSheet(null)}/>}
      {sheet === "feedback" && <FeedbackPanel version={APP_VERSION} location={tab === "settings" ? "设置" : tab === "library" ? "棋谱库" : "打谱"} onNotice={setToast}/>}
      {sheet === "manual" && <UserManual onClose={() => setSheet(null)} onOpenRules={() => setSheet("rules")} onStartGuide={startManualGuide} focusSection={manualFocusSection}/>}
      {sheet === "rules" && (
        <RuleGuide onOpenManual={() => setSheet("manual")}/>
      )}
    </BottomSheet>}
  </div>;
}
