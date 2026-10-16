import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { ActionLayoutEditor } from "./features/workspace/ActionLayoutEditor";
import { WorkspaceAction } from "./features/workspace/WorkspaceAction";
import { ACTION_LABELS, actionVisibleInMode, defaultModeLayout, loadActionLayouts, saveActionLayouts, visibleModeLayout, withAnalysisToggle, type ActionId, type ActionLayouts, type LayoutZone, type ModeLayout } from "./features/workspace/action-layout";
import { ActionRailBar } from "./features/workspace/ActionRailBar";
import {
  ArchiveRestore, ArrowDownUp, ArrowRight, ArrowUpToLine, BookOpen, Bot, Check, ChevronDown, ChevronFirst, ChevronLast, ChevronLeft, ChevronUp,
  ChevronRight, CircleDot, CircleHelp, Clock, Cpu, Download, FilePlus2, FlipHorizontal, FolderOpen, FolderPlus, Gauge, GitBranch,
  GripVertical, Home, Info, Layers3, Library, Lock, ListTree, Mail, Maximize2, Menu, MessageSquareText, Minimize2, MoreHorizontal, PenTool, Puzzle as PuzzleIcon, RotateCw, Search, Shield, SquarePen, Star, Tag,
  Crop, Eraser, PenLine, Redo2, Save, Settings, Sparkles, Trash2, Undo2, Upload, X, Bookmark, LocateFixed, FileClock, DatabaseBackup, XCircle, ClipboardList, Swords, Recycle, Globe, ClipboardCopy, ClipboardPaste, ArrowDown, ArrowLeft, ArrowUp, Move,PictureInPicture2,
  EyeOff, Scissors, Settings2, Plus, Merge, Copy, ChevronsDown} from "lucide-react";
import { isRecordFavorite as _isRecordFavorite, loadFavorites, pruneFavorites, saveFavorites, toggleCollectionFavorite, togglePuzzleFavorite, toggleRecordFavorite, type LibraryFavorites } from "./library-favorites";
import { applyOrder, isLibraryOrderMaps, moveRelative, remapFolderOrder, removeFromOrder, sortIdsByTitles, type LibraryOrderKind, type LibraryOrderMaps } from "./library-order";
import { attachLibraryTouchDrag } from "./library-touch-drag";
import { useWorkspaceShortcuts } from "./features/workspace/use-workspace-shortcuts";
import { AiRequestRetry } from "./features/ai/request-retry";
import { createEngineProgressPump, type EngineProgressPump } from "./features/ai/progress-frame-gate";
import { aiAnalysisStore, INITIAL_AI_ANALYSIS, useAiAnalysisState, type AiAnalysisEngine, type AiAnalysisState } from "./features/ai/analysis-store";
import { BoardMoveRail } from "./features/workspace/BoardMoveRail";
import { BoardRadialMenu } from "./features/workspace/BoardRadialMenu";
import { buildRadialMenuItems, copyCoordinateCaveats, evaluationLabel, formatRecordAsCoordinates, nextEvaluation, shouldOpenRadialMenu, type RadialMenuActionId, type RadialMenuPageId } from "./features/workspace/radial-menu";
import { DEFAULT_MOVE_NUMBER_SCALE, clampMoveNumberScale } from "./features/settings/move-number-size";
import {
  addMove, addMoveAs, boardAt, coordinateName, columnName, createDocument, deleteVariation, depthOf, isSupportedBoardSize, MAX_BOARD_SIZE, MIN_BOARD_SIZE,
  forbiddenPoints, forbiddenReason, lastOnPreferredLine, nextPlayerAt, nodeIdAtDepth, otherPlayer, pathToNode, preferredNext, setLabelMark, toggleMark, updateNode, winningLinesAt,
} from "./game";
import { downloadFile, exportJson, exportPos, exportSgf, importRecordFile, mainLineLength, mainLinePassCount } from "./formats";
import { exportLib, exportPsq } from "./lib-export";
import { libExportFromSource } from "./lib-source-export";
import { recognizeBoardImage, type BoardRoi, type BoardScanner, type DigitReader, type ImageRecognitionResult } from "./image-recognition";
import { ImageVerifyScreen, type RecognitionGrid } from "./features/record/image-verify";
import { BoardAlignScreen } from "./features/record/image-align";
import { getImagePreview } from "./features/record/image-preview";
import { findPositionMatches, positionKey } from "./position-search";
import { duplicateSummary, findDuplicateRecords, loadActive, loadDraftFromLocal, loadLibrary, removeDraftFromLocal, removeFromLibrary, renameInLibrary, saveDraftToLocal, saveManyToLibrary, saveToLibrary, type DuplicateGroup } from "./storage";
import { commitDraftAsDerivedVersion, documentFingerprint, documentHasDraft, loadDraftForDocument, loadLargeDocument, loadLargeSummaries, moveLargeDocumentToTrash, removeDraftForDocument, removeLargeDocument, removeLargeTrashDocument, renameLargeDocument, restoreLargeDocumentFromTrash, saveCompactIndex, saveDraftForDocument, saveLargeDocument } from "./large-storage";
import { snapshotRepository, type SnapshotRecord } from "./features/data-safety/snapshots";
import { openLibraryHandle } from "./library-engine";
import { isPagedLibraryView, LibraryViewSession } from "./library-view-adapter";
import { DpViewSession, isDpDatabaseView } from "./dp-view-session";
import { RenLibWebViewSession, isRenLibWebView } from "./renlib-web/renlib-web-view-session";
import { compactBranchCount, compactChildCount, compactChildWindow, compactDiagnostics, compactFirstBranchNodeId, compactIndexOf, compactNodeCount, compactNodeIndex, compactSearch, createLazyDocument } from "./compact-index";
import { formatRenLibWebLabel, renLibDisplayMark } from "./renlib-display";
import { createEditableViewCopy, createModificationCopy, storedRecordHasMoveOrder, findVisibleVariationTarget, renderableBoardVariationNodes, visibleVariationPivot } from "./record-editing";
import { clearDefaultDirectoryHandle, defaultNativeExportHandle, exportLocationLabel, isSafDirectoryHandle, loadDefaultDirectoryHandle, pickDefaultDirectoryHandle, supportsDirectoryPicker, supportsNativeExportDirectory, writeFileToDirectory, type ExportDirectoryHandle } from "./file-destination";
import { boardShareFilename, renderBoardSharePng, type BoardShareOptions } from "./board-image-export";
import { sharePngFile } from "./share-file";
import { applyRotationStep, normalizeAngleDelta, pointerAngle, rotationStepForAngleDelta, transformBoardPosition, type BoardRotation } from "./board-transform";
import { recordAction, APP_VERSION } from "./diagnostics";
import { checkForLatestRelease, type LatestRelease } from "./update-check";
import { loadUpdateAutoCheck, saveUpdateAutoCheck, loadUpdatePromptDismissed, saveUpdatePromptDismissed } from "./update-settings";
import { apkDownloadSources, apkFilename } from "./features/update/apk-sources";
import { downloadAndInstallUpdate, supportsNativeApkInstall } from "./features/update/install-update";
import { UpdateDownloadLinks } from "./features/update/UpdateDownloadLinks";
import { applyDraftToDocument, buildBatchReplaceOperations, buildDraftOverlay, draftOperationLabel, emptyDraft, hasDraft, overlayChildren, overlayNode, overlayPreferredChild, projectedDocument, pushDraft, redoDraft, type DraftOperation as DraftOp, type DraftState, undoDraft } from "./draft-operations";
import type { CompactRenLibIndex, RuleSet } from "./types";
import type { LargeDocumentSummary } from "./large-storage";
import RecordImportWorker from "./record-import.worker?worker";
import { verifyVcfProof } from "./vcf";
import type { BoardMark, BoardMarkStyle, Cell, GameDocument, ImportResult, NodeEvaluation, OpeningRule, Player, Position, RecordNode, RecordSourceFormat } from "./types";
import { CONCRETE_THEME_IDS, isDarkTheme, isThemePreference } from "./theme-options";
import { ThemeScene } from "./themes/ThemeScene";
import { loadCustomUiTheme, saveCustomUiTheme } from "./custom-ui-theme";
import { LEGACY_BOARD_THEMES, LEGACY_STONE_THEMES, boardLayers, boardLineProps, newMaterialBoard, newMaterialStone, normalizeBoardTheme, normalizeStoneTheme, stoneMarkup } from "./appearance/render";
import { SvgHtml } from "./appearance/svg-html";
import { BoardMaterialSurface } from "./appearance/BoardMaterialSurface";
import PuzzleAiWorker from "./puzzle-ai.worker?worker";
import { winnerAt } from "./puzzle-ai";
import type { AiAnalysisCandidate, AiMoveResult } from "./puzzle-ai";
import { createPuzzleDocument, deriveWrongPuzzleEntries, exportPuzzleCollectionJson, importKaibaoPuzzleJson, isPuzzleJsonText, loadNativeKaibaoCollections, loadPuzzleCollections, loadPuzzleProgress, puzzleProgressKey, savePuzzleCollections, savePuzzleProgress, savePuzzleTitleOverride } from "./puzzles";
import type { Puzzle, PuzzleCollection, PuzzleProgress, PuzzleReviewEntry } from "./puzzles";
import {
  addPuzzlesToCollection, createPuzzleFromBoard, dequeuePuzzleReview, derivePuzzleStats, emptyPuzzleReviewQueue,
  enqueuePuzzleReview, isPuzzleQueued, loadHiddenPuzzleCollections, loadPuzzleOverlays, loadPuzzleReviewQueue,
  mergeCollections, movePuzzleBetweenCollections, nextPuzzleId, prunePuzzleRecords, removePuzzleFromCollection,
  resetPuzzleProgressState, saveHiddenPuzzleCollections, savePuzzleOverlays, savePuzzleReviewQueue, splitCollection,
  summarizeCollection, updatePuzzleInCollection, updatePuzzleOverlay,
  type PuzzleEditPatch, type PuzzleLastResult, type PuzzleOverlays, type PuzzleReviewQueue,
} from "./features/puzzles/puzzle-collection-edit";
import { decideDailyPuzzle, loadDailyTraining, localDateKey, markDailyStarted, recordPuzzleCompletion, saveDailyTraining, type DailyCandidate, type DailyTrainingState } from "./features/puzzles/daily-training";
// 做题结算的**共用口径**（2026-10-11）：打谱工作区与每日一题页都走它，
// 所以"攻克一道题发多少、每日一题发多少"两个入口不可能发出不同的东西。
import { nextPuzzleProgressEntry, planPuzzleSoul } from "./features/daily/puzzle-settle";
import { DuelPage } from "./features/duel/DuelPage";
import { GENERATED_DEFAULT_FOLDER, generatedCollection, generatedCollectionIdForFolder, generatedMatchesPuzzle, mergeGeneratedCollection, readGeneratedProofText } from './features/puzzle-generator/collection';
import type { GeneratedPuzzle } from './features/puzzle-generator/model';
import { GameScreen, type DuelRecentMove, type DuelResultInfo, type DuelSideInfo } from "./features/duel/GameScreen";
import { OpeningReveal } from "./features/duel/OpeningReveal";
import { identifyOpeningFromMoves } from "./features/duel/opening-name";
import { DuelStatsSheet } from "./features/duel/DuelStatsSheet";
import { appendDuelHistory, clearDuelHistory, loadDuelHistory, shouldRecordDuel, type DuelHistoryEntry } from "./features/duel/duel-history";
import { clearDuelSession, duelAwaitingSide, duelSessionSummary, loadDuelSession, saveDuelSession, type DuelSessionSnapshot } from "./features/duel/duel-session";
// 自定义开局的「局面库」（用户 2026-10-14）：保存/载入摆好的局面、导入棋谱、开始对战时把树剪成当前那一条线。
import { addDuelSetup, defaultSetupName, lineOnlyDocument, lineStoneCount, loadDuelSetups, positionAlreadyDecided, removeDuelSetup, renameDuelSetup, type DuelSetupEntry } from "./features/duel/duel-setups";
import { DuelClockPanel } from "./features/clock/DuelClockPanel";
import { clockWinner, createClock, isClockOver, switchClock, type ClockSettings, type ClockSide, type ClockState } from "./features/clock/duel-clock";
import { loadClockSettings, saveClockSettings } from "./features/clock/clock-settings";
import { addFifthCandidate, chooseFifthCount, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, chooseTaraguchiFifth, isDistinctFifthCandidate, placeBatchStone, rewindOpeningToMove, selectFifthCandidates, swap2Choose, swap2PickSide, symmetricCounterpart, openingInstruction, openingPositionAllowed, openingRuleName, suggestFifthCandidates, suggestOpeningPlacement, type OpeningSession, type OpeningStage } from "./opening-rules";
import { ANNOTATION_COLORS, ANNOTATION_STYLES, ANNOTATION_TYPES, annotationTypePreset, markKindForStyle, markStyleLabel, styleForMark, type AnnotationMarkType } from "./annotation-presets";
import { friendlyAnnotationColor, friendlyAnnotationPalette } from "./color-vision";
import { MarkShape } from "./mark-shape";
import { applyMarksToLibDocument } from "./lib-mark-annotations";
import { documentFromCoreSgf } from "./lib-source-export";
import { createBackupSnapshot, parseBackup, restoreBackup, serializeBackup } from "./backup";
import { readZip, textFromZipEntry, createZip, type ZipEntry, type ZipEntryInput } from "./zip";
import { banbuAudio, type SoundCue } from "./audio-engine";
import { playHapticCue } from "./haptics";
// 成就与棋魂（2026-10-09）：接线只留这几处（hook、信号、弹窗、面板），细节全在 features/progress。
import { useProgress } from "./features/progress/use-achievements";
import { useSoulShop } from "./features/progress/use-soul-shop";
// 外观锁：判断"某个主题/棋盘/棋子要不要钱、买了没有"（快捷中心与设置页共用同一套）
import { soulUnlockForTarget } from "./features/progress/soul-unlocks";
// 棋魂定价（VCF 手数加成 / 对弈档位）——口径集中在 soul.ts，这里只调用。
import { claimVcfLevelRewards, soulAmount, soulForDuelResult, soulForVcfProblem, vcfLevelSoul } from "./features/progress/soul";
import { ProgressRewardQueue } from "./features/progress/ProgressReward";
import { AchievementsPanel } from "./features/progress/AchievementsPanel";
import { SoulPanel } from "./features/progress/SoulPanel";
import { SoulShopPanel, shopRemainingCount } from "./features/progress/SoulShopPanel";
import "./features/progress/soul-panel.css";
import "./features/progress/soul-lockable.css";
import "./features/progress/achievement-unlock.css";
import "./features/progress/achievements-panel.css";

const UserManual = lazy(() => import("./features/manual/UserManual").then((m) => ({ default: m.UserManual })));
let manualToursCache: typeof import("./features/manual/tours").MANUAL_TOURS | null = null;
const loadManualTours = async () => {
  manualToursCache ??= (await import("./features/manual/tours")).MANUAL_TOURS;
  return manualToursCache;
};
import { loadSoundSettings, saveSoundSettings, type SoundSettings } from "./audio-settings";
import { loadMotionEnabled, saveMotionEnabled } from "./motion-settings";
import { findDropEffect, findPlaceEffect, loadMotionEffectsSettings, saveMotionEffectsSettings, type MotionEffectsSettings } from "./motion-effects-settings";
import { effectAccent, isDarkBoard, type EffectScheme } from "./appearance/effects";
import { formatEngineCount } from "./engine-metrics";
import { ANALYSIS_METRIC_LABELS, fmtAnalysisMemory, loadEnhancementSettings, saveEnhancementSettings, getAnalysisMode, withAnalysisMode, type AnalysisCandidateMetric, type AnalysisMode, type EnhancementSettings } from "./enhancement-settings";
import { fontScaleClass, loadFontScale, saveFontScale, type FontScale } from "./accessibility";
import { ImportProgressCard } from "./ImportProgressCard";
import { mergeImportProgress, type ImportProgressPatch, type ImportProgressState } from "./import-progress";
import { QuickDrawer } from "./QuickDrawer";
import { TreePanel } from "./tree-panel";
import { AppToast } from "./ui/feedback/AppToast";
import { StateIllustration } from "./ui/states/StateIllustration";
import { CoachMark, type CoachMarkAction, type CoachMarkId } from "./ui/coach/CoachMark";
import { loadRecentImports, openRecentImport, readRecentImportText, saveRecentImport, saveRecentText, type RecentImportEntry, type RecentImportKind } from "./recent-imports";
import { addToRecycleBin, emptyRecycleBinConfirmation, loadRecycleBinPruned, permanentDeleteConfirmation, recycleBinRetentionHint, removeFromRecycleBin, type RecycleBinEntry } from "./recycle-bin";
import { loadNativeDatabaseFile, loadNativeMatchRecords, NATIVE_DATABASE_TITLE, NATIVE_MATCH_FOLDER, NATIVE_RECORD_FOLDER } from "./native-records";
// 手册正文与引导数据（19 章 ≈154KB 源码）只在打开手册/引导时才用：懒加载分片，
// 不进启动关键路径（09-23 性能走查：启动是生产版唯一有长任务阻塞的环节）。
// SW 预缓存 glob 覆盖全部构建 JS，新分片自动进离线清单，离线打开不受影响。
import type { TourStep } from "./features/onboarding/tour-steps";
import { FeedbackPanel } from "./FeedbackPanel";
import { AboutPanel, type AboutView } from "./AboutPanel";
import type { AppMode, BoardTheme, ResolvedTheme, Sheet, StoneTheme, Tab, ThemePreference } from "./app-shell-types";
import { BottomSheet } from "./ui/overlays/BottomSheet";
import { EngineSwitchOverlay, type EngineSwitchChannel, type EngineSwitchStatus } from "./ui/overlays/EngineSwitchOverlay";
import { OverlayPattern } from "./ui/overlays/OverlayBrand";
import { appearanceForSheet } from "./ui/overlays/overlay-appearance";
import { ROOT_BACK_MESSAGE, useRootBackExit } from "./ui/overlays/useRootBackExit";
import { createEngineWorker, nativeEngineInfo, nativeEngineUsable, probeNativeEngine, probeNativeKataGo, setNativeDotprod, stopNativeEngine, stopNativeKataGo, subscribeNativeEngine, nativeKataGoInfo, kataDiag } from "./features/ai/native-engine";
import { KataTuning } from "./features/ai/KataTuning";
import { IkatagoTuning } from "./features/ai/IkatagoTuning";
import { setKataRestartHandler } from "./features/ai/kata-settings";
import { ensureKataNetForRule } from "./features/ai/kata-net";
import { IKATAGO_PLATFORM_CHOICES, loadIkatagoConfig, saveIkatagoConfig, ikatagoUrlProblem, type IkatagoConfig } from "./features/ai/ikatago";

import { engineThreadOptionsCompact } from "./features/settings/engine-threads";
import { MetadataFields } from "./features/record/MetadataFields";
import { recordRuleDisplayName } from "./features/rules/rule-guide-data";
import { OnlineLibraryPanel, type OnlineImportOutcome } from "./features/online/OnlineLibraryPanel";
import type { OnlineFetchedRecord } from "./features/online/types";
import { loadOnlineProxyTemplate, saveOnlineProxyTemplate } from "./features/online/online-http";
import { isAiVisionConfigured, loadAiVisionConfig, recognizeMoveOrderViaAi, recognizePositionViaAi, saveAiVisionConfig, type AiVisionConfig } from "./features/record/move-order-ai";
import { normalizePuzzleSet } from "./features/online/puzzle-set-format";
import { SettingsPage } from "./features/settings/SettingsPage";
import { DEFAULT_COORDINATE_FONT_SIZE, migrateCoordinateFontSize } from "./features/settings/display-defaults";
import { BOARD_VIEWBOX, DEFAULT_BOARD_MARGIN, boardMarginLabel, clampBoardMargin, coordinateLayout } from "./features/settings/board-margin";
import { DEFAULT_STONE_SCALE, MAX_STONE_SCALE, MIN_STONE_SCALE, STONE_SCALE_STEP, clampStoneScale, stoneHitRadiusFor, stoneRadiusFor, stoneSizeLabel } from "./features/settings/stone-size";
import { WHEEL_ZOOM_STEP, clampBoardScale, shouldZoomOnWheel, zoomAnchorScroll } from "./board-zoom";
import { applySystemBars } from "./features/system-bars";

import { PlaybackButton, playbackStatusText } from "./features/research/PlaybackControls";
import { useRecordPlayback } from "./features/research/record-playback";
import { describeCurrentStep, describeMove, loadSpeechEnabled, loadSpeechRate, saveSpeechEnabled, saveSpeechRate, speakStep, stopSpeaking, speechSupported, type SpeechRate } from "./speech";
import { documentForExportScope, exportScopeSuffix, type RecordExportScope } from "./features/research/record-export";
import { RecordSearchPanel } from "./features/research/RecordSearchPanel";
import { PuzzleManagePanel } from "./features/library/PuzzleManagePanel";
import { DataSafetyPanel } from "./features/library/DataSafetyPanel";
// 本机凭证（2026-10-11）：写在 App 之外的加密快照，卸载/换机后能恢复。
import { VaultPanel } from "./features/vault/VaultPanel";
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
import { loadPlacementConfirm, savePlacementConfirm } from "./placement-confirm";
import type { VcfItemId } from "./features/vcf-challenge/items";
import { loadActionOpacity, saveActionOpacity, withAlpha } from "./action-opacity";
import { applyLegacyThemeColors } from "./legacy-theme-colors";
import { loadThemeMotion, saveThemeMotion } from "./theme-motion";
import { annotationHighlightColor, loadAnnotationHighlight, saveAnnotationHighlight, type AnnotationHighlight } from "./annotation-highlight";
import { TaskManager } from "./features/tasks/task-state";
import { AiWorkerController, type AiCancelReason, type AiWorkerHandle } from "./features/ai/ai-worker-controller";
import { getAnalysisCacheEntry, getDocumentAnalysisCache, putAnalysisCacheEntry, type AnalysisCacheEntry } from "./features/ai/analysis-cache";
import {
  buildReviewCurve, buildReviewEntries, buildReviewSummary, buildWinrateSeries, loadStoredGameReview, saveStoredGameReview, openingProcedureLastMove,
  REVIEW_GRADE_LABELS, type ReviewEntry, type ReviewGrade, type ReviewSample,
} from "./features/research/game-review";
import { boardSizeStrengthNotice, engineSupportsBoardSize, kataFallsBackToRapfi } from "./features/ai/board-size-support";
import { deleteEnginePack, downloadEnginePack, enginePackSnapshot, ensureEnginePackUrl, installBundledEnginePack, subscribeEnginePack, type EnginePackState } from "./features/ai/engine-pack";
import { bookDeclareCount } from "./features/ai/opening-book";
import { RuleGuide } from "./features/rules/RuleGuide";
import { AI_RULE_PRESET_GUIDES } from "./features/rules/rule-guide-data";
import { UnifiedStatusBar } from "./features/workspace/UnifiedStatusBar";
import { RuleToggle } from "./features/workspace/RuleToggle";
import { RecordSelectorSheet } from "./features/workspace/RecordSelectorSheet";
import { findOrphanBookmarks, loadRecordBookmarks, mergeRecordBookmarks, orphanBookmarkConfirmation, pruneOrphanBookmarks, removeRecordBookmarks, saveRecordBookmarks, toggleRecordBookmark, type RecordBookmark, type RecordBookmarks, updateRecordBookmark } from "./features/record-tree/bookmarks";
import { copyRecordSubtree, pasteRecordSubtree, type SubtreeClipboard } from "./features/record-tree/subtree-clipboard";
import { buildTranspositionIndex } from "./features/record-tree/transposition";
import { mergeSamePositions } from "./features/record-tree/transposition-merge";
import { CoordinateCodePanel } from "./features/record/CoordinateCodePanel";
import { buildDocumentFromCoordinateCode, formatCoordinateCode, mainLineBranchCount, mainLineEndId, parseCoordinateCode } from "./coordinate-code";
import { PuzzleRuleSelector } from "./features/puzzles/PuzzleRuleSelector";
import { PuzzleSelectorSheet } from "./features/puzzles/PuzzleSelectorSheet";
import { fallbackLegalPuzzleMove, loadPuzzleRulePreference, puzzleMoveLegality, resolveDailyPuzzleRule, resolvePuzzleRule, savePuzzleRulePreference, type PuzzleRuleMode } from "./features/puzzles/puzzle-rules";
import { pickBoardImageFile, supportsNativePhotoPicker } from "./features/puzzles/photo-picker";
import { onIncomingFiles, takeIncomingFiles } from "./features/incoming/incoming-files";
import { createPuzzleSetupSession, movePuzzleSetupCursor, placePuzzleSetupStone, puzzleSetupView, type PuzzleSetupSession } from "./features/puzzles/puzzle-setup-session";

type BoardMotionKind = "place" | "navigate" | "branch" | null;
type BoardFeedbackKind = "illegal" | "forbidden";
type BoardResultKind = "won" | "lost" | "draw" | "complete";
interface BoardMotionState { kind: BoardMotionKind; version: number; /** 这次动效归属的节点 id。只有「落子那一刻」光标指向的节点才配得上进场动画；光标自己移动（撤销、重做、跳手）时它不匹配，旧事件就不许再放一遍动画。 */ at: string | null }
interface BoardFeedbackState { position: Position; kind: BoardFeedbackKind; version: number }
interface BoardResultState { kind: BoardResultKind; label: string }
const PuzzleGeneratorPage = lazy(() => import('./features/puzzle-generator/PuzzleGeneratorPage').then(module => ({ default: module.PuzzleGeneratorPage })));
const VcfChallengePage = lazy(() => import('./features/vcf-challenge/VcfChallengePage').then(module => ({ default: module.VcfChallengePage })));
// 每日一题的**专门界面**（用户 2026-10-11：「我们给每日一题做一个专门的界面吧，
// 因为我发现这个每日一题可以用分析解决，不像是一个专门的挑战界面」）。
// 沿 VCF 的骨架（独立全屏页 + 顶部返回 + 棋盘 + 底部状态），但**没有**等级分/
// 棋力档位/倒计时/道具 —— 那些是"挑战"的东西，一天一题用不上（见页面文件头那张对照表）。
const DailyPuzzlePage = lazy(() => import('./features/daily/DailyPuzzlePage').then(module => ({ default: module.DailyPuzzlePage })));
type DockPanel = "analysis" | "annotation" | "notes" | "view" | "play" | "setup" | "puzzles" | null;
type LibrarySection = "puzzles" | "records";
// 棋谱库的三个界面：棋谱 / 题库 / 在线。LibrarySection 仍只用于本地资料（文件夹归属、
// 批量处理按这两类走），在线界面不参与那些逻辑。
type LibraryTab = LibrarySection | "online";
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
/**
 * 「这份棋谱只是一部分」——**所有「遍历整份文档得结论」的功能都该问它**。
 *
 * 三种来源（2026-10-11 排查出的同类 bug 全家桶）：
 *   · DP/DB 局面库与 RenLib 网页核心读的 .lib（`isDynamicDatabaseView`，投影）；
 *   · 按需窗口的大型棋谱（`isPagedLibraryView`）；
 *   · 分页紧凑索引（`compactIndexOf`）。
 *
 * 为什么还要看 `document.partial`：前三个判据都依赖**不可枚举的 Symbol / 代理身份**，
 * 而「在懒加载谱上做一次编辑」会自动生成一份 `createEditableViewCopy`——那是对象展开、
 * Symbol 刻意不跨过去。于是副本的 `unloadedChildren` 还在、却不再被判为不完整，
 * 同型局面 / 查找 / 复制分支就会拿子集当全谱。`partial` 是可枚举字段，会带过去。
 */
const isPartialDocument = (document: GameDocument): boolean =>
  document.partial === true || isDynamicDatabaseView(document) || isPagedLibraryView(document) || Boolean(compactIndexOf(document));

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
/** 按 (题集 id, 题 id) 定位题目：每日一题与错题重温都只记 id，打开时才换下标。 */
const locatePuzzleIn = (collections: PuzzleCollection[], collectionId: string, puzzleId: string) => {
  const collectionIndex = collections.findIndex((collection) => collection.id === collectionId);
  if (collectionIndex < 0) return null;
  const puzzleIndex = collections[collectionIndex].puzzles.findIndex((puzzle) => puzzle.id === puzzleId);
  if (puzzleIndex < 0) return null;
  return { collectionIndex, puzzleIndex, collection: collections[collectionIndex], puzzle: collections[collectionIndex].puzzles[puzzleIndex] };
};
/** `id` 是一局一个的战绩 token（新开一局生成、恢复时沿用快照里那个），见 duel-history 的去重说明。
 *  `custom*` 三个是「自定义开局」模式（用户 2026-10-13）：`customOpening` = 这一局是自定义开局；
 *  `customStarted` = 已经点过「开始对局」（false = 还在摆子阶段，AI 不许动、棋盘按摆子分派）；
 *  `customSetupCount` = 摆子阶段落下的子数，也就是**正式对局的边界**（悔棋不许退到它以下，
 *  而"开局 10 手不许悔"只数边界之后的手）。三个都是可选字段：老快照读出来是 undefined，
 *  按 falsy 处理即可，会话存档因此不用升版本号（见 `duel-session.ts` 里那条先例注释）。 */
interface AiGameState { id: string; humanPlayer: Player; aiPlayer: Player; strength: AiStrength; forbiddenEnabled: boolean; timeLimitMs: number; readOffMs: number; thinkTimeMs: number; thinkDepth: number; unlimitedThinking: boolean; outcome: "won" | "lost" | "draw" | null; opening: OpeningSession; engineChoice: AiEngineChoice; customOpening?: boolean; customStarted?: boolean; customSetupCount?: number }
/** 战绩 token：不用 crypto.randomUUID——本应用也跑在 http 与 Capacitor 本地域上，那两处不一定有。 */
const newDuelId = () => `d${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** 整局复盘的运行态：除样本与主线外，还要带上「开局流程覆盖到第几手」与规则名——
 *  打点类规则的开局段不判失误（用户 09-19），这两个字段决定分档与汇总怎么说。 */
interface GameReviewRunExtra { openingLastMove: number; openingRuleLabel: string }

/** 整局复盘的界面状态。done 时 entries/samples 来自刚跑完的一轮或本机沉淀（loadStoredGameReview）。 */
interface GameReviewState {
  status: "idle" | "running" | "done" | "error";
  documentId?: string;
  total?: number;
  done?: number;
  entries?: ReviewEntry[];
  samples?: ReviewSample[];
  message?: string;
}
interface GameReviewRun { documentId: string; active: boolean; queue: string[]; index: number; samples: (ReviewSample | undefined)[]; moveNodes: Array<{ nodeId: string; move: Position | null   /** 开局流程覆盖到第几手（0=无）。 */
}>; openingLastMove: number; openingRuleLabel: string; handle: AiWorkerHandle | null }
// 胜率视角（2026-09-30 定案：**引擎恒输出「行棋方视角」**）。
//
// 引擎侧两道保险，缺一不可：
//   1. kata.cfg 写 `reportAnalysisWinratesAs = SIDETOMOVE`；
//   2. 原生插件启动时再用 `-override-config reportAnalysisWinratesAs=SIDETOMOVE` 兜一道
//      —— **不依赖 payload 文件是否刷新**。上一版「黑白颠倒」的根因正是栽在这里：
//      cfg 改成 BLACK 却忘了升 PAYLOAD_VERSION，设备上跑的仍是旧 cfg（行棋方视角），
//      而前端已经按「引擎给的就是黑方胜率」透传，于是白行棋时把白方胜率当黑方显示。
// Rapfi 本来就是行棋方视角；云端（ikatago）取 KataGo 默认值，同为行棋方视角。
//
// 显示约定（用户 2026-09-30 钦定，与「智子本地版」同款）：
//   * 面板 / 候选点 / 「上次分析」读数：**直接显示引擎原值**，标签跟着行棋方走
//     —— 谁在走就显示谁的胜率，既不必折算也不会反；
//   * 胜率曲线 / 整局复盘 / 复盘样本：这类要「跨手比较大小、算这一手损失了多少胜率」的
//     用途必须**单一视角**才有意义，所以一律折到黑方视角（mover=白 时取 1-x）。
/** 面板胜率 = 引擎原值（行棋方视角），不折算。 */
const panelWinRate = (raw: number | undefined): number | undefined => raw;
/** 行棋方视角 → 黑方视角（曲线/复盘/样本专用；视角只随行棋方翻面，与引擎无关）。 */
const toBlackWinRate = (raw: number | undefined, mover: Player | undefined): number | undefined =>
  raw === undefined ? undefined : mover === "white" ? 1 - raw : raw;
/** 面板胜率标签跟着行棋方走：谁在走，显示的就是谁的胜率。 */
const moverWinRateLabel = (mover: Player | undefined): string => (mover === "white" ? "白方胜率" : "黑方胜率");
// Engine PV lines 2..N come from move ordering and can show values stronger
// than the current best — visualize candidates ranked by the selected metric
// so "top N" means "the N best-scoring points this search has seen".
const rankAnalysisCandidates = <T extends { winRate?: number; score?: number }>(list: T[], metric: AnalysisCandidateMetric): T[] => {
  if (metric === "winRate") return [...list].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
  if (metric === "score") return [...list].sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY));
  return list;
};
type AiEngineChoice = "light" | "strong" | "tuned" | "kata" | "ikatago";
type EngineSwitchState = {
  id: number;
  from: AiEngineChoice;
  to: AiEngineChoice;
  channel: EngineSwitchChannel;
  status: EngineSwitchStatus;
  percent: number;
  phase?: string;
  error?: string;
  canCancel: boolean;
  /** 失败时给用户的两个选项（2026-10-15 用户要求：不要偷偷回落，弹窗让人选）。
   *  把闭包存进 state 是可以的：它们是稳定闭包，React 不比较 state 内容。 */
  retryAction?: () => void;
  fallbackAction?: () => void;
  fallbackLabel?: string;
};

/** 只在「必须按屏幕形态改变 DOM 位置或按钮可见性」时用；布局本身仍然交给 CSS 媒体查询。
 *  现有布局规则全部是媒体查询，JS 里没有横屏判定，这个 hook 是第一处。 */
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => Boolean(globalThis.matchMedia?.(query).matches));
  useEffect(() => {
    const list = globalThis.matchMedia?.(query);
    if (!list) return;
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
};

const aiEngineChoiceLabel = (choice: AiEngineChoice): string => {
  if (choice === "kata") return "KataGo";
  if (choice === "ikatago") return "iKataGo";
  if (choice === "tuned") return "rapfi 自调";
  if (choice === "light") return "rapfi 轻量";
  return "rapfi";
};

/* 切到旗舰/云端时，若先到的是备用引擎的 ready，等这么久再判失败（KataGo 冷启动约 6 秒）。 */
const ENGINE_SWITCH_FALLBACK_GRACE_MS = 12_000;

/** 切走旗舰后**保留进程**的宽限窗口（用户 2026-10-08：「启动速度没有变化……有没有更好的
 *  优化启动速度的方法」）。KataGo 的启动成本在 Native 侧（进程 spawn + ONNX Runtime 初始化
 *  + 模型加载，实测 1.4s 起），JS 侧改不动；但「切回旗舰要重新冷启」可以避免：窗口内切回来
 *  直接复用活进程（Java start() 早退 + 已就绪标记还在 → 秒回），超时仍停留在 rapfi 才真正
 *  回收。引擎互斥（09-26 用户要求）的本意是省内存与发热，短暂保留是速度/占用之间的折中。 */
const KATA_KEEPWARM_MS = 60_000;

/** 大棋谱/数据库分支的异步读取上限（见 navigateDynamic 的看门狗）。
 *  正常一次分支读取是毫秒级，给到 12 秒是留足低端机 + 大库的余量；
 *  超过它就把「棋盘禁用」解开，而不是让一个永不返回的 promise 把界面钉死。 */
const DYNAMIC_NAV_WATCHDOG_MS = 12_000;

const engineSwitchChannelFor = (choice: AiEngineChoice): EngineSwitchChannel => {
  if (choice !== "ikatago") return "local";
  try {
    const raw = loadIkatagoConfig().serverUrl.trim();
    const host = new URL(raw).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)) return "internal";
  } catch { /* invalid or incomplete config is handled by the config state */ }
  return "cloud";
};
// worker 回报的实际变体 → 分析面板的档位标签。多线程档单独显示，否则用户
// 开了多线程却在界面上看不到任何区别（诊断时无从确认它真的生效了）。
const analysisEngineLabel = (variant: string | undefined): AiAnalysisEngine =>
  variant === "kata" ? "kata"
    : variant === "ikatago" ? "ikatago"
      : variant === "native" ? "native"
        : variant === "multi" ? "multi"
          : variant === "full" || /^experiment/.test(variant || "") ? "full" : "light";
const AI_ENGINE_CHOICE_KEY = "banbu-ai-engine-choice-v1";
/**
 * 一条引擎 progress 帧里**会进面板读数的标量字段**（候选点单独走慢档，见
 * features/ai/progress-frame-gate.ts；requestId/generation/percent 等不进 state，不必携带）。
 */
interface EngineProgressScalars {
  variant?: string;
  depth?: number;
  selDepth?: number;
  nodes?: number;
  speed?: number;
  score?: number;
  winRate?: number;
  drawRate?: number;
}
/**
 * 合流窗口内两帧的合并规则：**必须与两处 setAiAnalysis 的合并规则一一对应**
 * （depth/selDepth/nodes 单调取大、其余「带了就覆盖」）。逐帧落地与先合并再落地不等价
 * —— 某一帧独带的字段（例如只有部分帧上报的 drawRate）若被后来的帧直接覆盖成
 * undefined，面板上就永远看不到它了。
 *
 * depth/nodes 取大是 09-11 实锤的既有语义：旧轮结论是新轮爬升期的上界，回跳会让用户
 * 看到 21→18 的「假退步」；节流窗口里同样不许回跳。
 */
const mergeEngineProgressScalars = (previous: EngineProgressScalars, next: EngineProgressScalars): EngineProgressScalars => ({
  ...previous,
  ...next,
  depth: Math.max(next.depth || 0, previous.depth || 0),
  selDepth: Math.max(next.selDepth || 0, previous.selDepth || 0),
  nodes: Math.max(next.nodes || 0, previous.nodes || 0),
  speed: next.speed ?? previous.speed,
  score: next.score !== undefined ? next.score : previous.score,
  winRate: next.winRate !== undefined ? next.winRate : previous.winRate,
  drawRate: next.drawRate !== undefined ? next.drawRate : previous.drawRate,
});
/**
 * 把一条 progress 消息拆成两片投给合流闸。候选为空时不投 —— 沿用原来
 * `candidates?.length ? … : current.candidates` 的语义（空榜不该把棋盘上的候选抹掉，
 * 那本身就是「闪一下没了又回来」的一种成因）。
 */
const progressFrameSlices = (frame: EngineProgressScalars & { candidates?: AiAnalysisCandidate[] }) => ({
  scalars: {
    variant: frame.variant, depth: frame.depth, selDepth: frame.selDepth, nodes: frame.nodes,
    speed: frame.speed, score: frame.score, winRate: frame.winRate, drawRate: frame.drawRate,
  } as EngineProgressScalars,
  ...(frame.candidates?.length ? { candidates: frame.candidates } : {}),
});
const loadAiEngineChoice = (): AiEngineChoice => {
  // 单一引擎档（用户 09-16：「去掉轻量引擎以及自调模式，全部一体化，rapfi 这一个
  // 地方就本身有自调的功能」）：轻量与自调并入强力，内存自调内置。旧存档里的
  // light/tuned/experiment 一律归一到 strong 并回写，避免残留值在别处被读到。
  // 注意：内部仍保留 light 变体作为**兜底**（引擎包未就绪时回落，见 engineVariantFor），
  // 否则网页版在没下载权重时会没有任何可用引擎——那是「没有轻量档可选」，不是「删掉兜底」。
  // "kata"（旗舰档，2026-09-25）是用户显式选择：允许持久化，但只在本机原生
  // KataGo 可用时真正生效（engineVariantFor 里把关），否则照常走 rapfi。
  try {
    if (localStorage.getItem(AI_ENGINE_CHOICE_KEY) === "kata") return "kata";
    // iKataGo 云引擎（2026-09-29）：用户填自己的服务器地址自连，算力在远端。
    // 与旗舰一样允许持久化——配置在，重启后仍用云端；配置丢了会如实报错。
    if (localStorage.getItem(AI_ENGINE_CHOICE_KEY) === "ikatago") return "ikatago";
    if (localStorage.getItem(AI_ENGINE_CHOICE_KEY) !== "strong") localStorage.setItem(AI_ENGINE_CHOICE_KEY, "strong");
  } catch { /* best-effort */ }
  return "strong";
};
// 档位 → worker 引擎模式 / 常驻槽键。强力 = full 构建（250615 官方 release 的
// 官方 wasm-multi-simd128 配置，T49 起随包分发；构建名含 multi 但为单线程 SIMD，
// 多线程档已移除——App 内 blob MIME 与 WebView 无 COI 双重阻塞，从未生效）。
// kata = 旗舰档（KataGo·作者网，仅安卓原生）：引擎二进制随 APK，无需引擎包；
// 探测未完成/不可用时静默落回 rapfi（worker 侧还会再兜一层启动失败回落）。
//
// 旗舰档有两个前置条件，不满足时**按「强力」档走**（不是降级到轻量）：本机原生
// KataGo 可用、且盘面不超过它的编译上限（15 路）。盘面上限必须在选型阶段处理：
// 超限时连 GTP 坐标都拼不出来，等引擎报错就晚了（见 KATA_MAX_BOARD_SIZE）。
//
// 关于「探测未完成」：**不能用 `available !== true` 当降级条件**。探测是异步的，
// 启动后有 1.2/3/7/15 秒的退避重试窗口，在此之前 nativeKataGoInfo() 是 null——
// 旧写法把那段时间里的 kata 全部静默换成 strong(rapfi)：用户明明选了旗舰、
// katago 进程也已经吃掉 850MB，分析请求却发 rapfi 的 engine 值，rapfi 起不来
// → 每下一手都报「引擎未启动」（用户 09-26 报）。判定逻辑收在
// kataFallsBackToRapfi（三态：只有明确不可用才降级），并带单测。
const effectiveEngineChoice = (choice: AiEngineChoice, boardSize?: number): AiEngineChoice =>
  choice === "kata" && kataFallsBackToRapfi(nativeKataGoInfo()?.available, boardSize)
    ? "strong"
    : choice;
const engineVariantFor = (choice: AiEngineChoice, packUrl: string | null, boardSize?: number): "light" | "full" | "kata" | "ikatago" => {
  const effective = effectiveEngineChoice(choice, boardSize);
  if (effective === "kata") return "kata";
  if (effective === "ikatago") return "ikatago";
  return effective === "light" || !packUrl ? "light" : "full";
};
const engineSlotKeyFor = (choice: AiEngineChoice, packUrl: string | null, boardSize?: number): string => {
  const variant = engineVariantFor(choice, packUrl, boardSize);
  return variant === "light" ? "light" : variant === "kata" ? "kata" : variant === "ikatago" ? "ikatago" : `${variant}:${packUrl || ""}`;
};
// iKataGo 是云引擎：不需要本机引擎包（算力在远端）。
const engineNeedsPack = (choice: AiEngineChoice) => choice !== "kata" && choice !== "ikatago" && (choice === "strong" || choice === "tuned");
// 内存档语义（用户 09-16 一体化后）：**单一档位**，滑杆值即生效、按设备内存钳制
// （默认 128MB、最低 64；上限 256/512/1024/2048 按内存分档——2048 在低内存机上会
// 分配失败、引擎退出）。人机对战、做题、分析同用同一套 helper。
//
// ⚠ 2026-10-11 把这几个函数**搬去 `features/ai/engine-memory.ts`** ——
// 原因是这里出过一个真 bug（见那个文件头）：对局路径"降级重试"时**没读降级值**，
// 于是每一手都失败一遍、用户看到"一直报错"。
// 搬出去之后它们能被单测直接钉住（那个文件一万多行、import 进来会拖一堆副作用），
// 而且"这次该发多少内存"只剩一个正确写法。
import { engineMemoryMbFor, MEMORY_RETRY_MB, resolveAnalyzeMemoryMb, shouldRetryWithLowerMemory } from "./features/ai/engine-memory";
// 说明：这里原先有个 describeImageSize(file)，在识别前又 createImageBitmap 一次
// 只为显示原图像素尺寸，大图在 iOS 上白解码一遍（100-400ms）。现在识别器会把
// 解码后的原图尺寸随结果一起回报（ImageRecognitionResult.imageWidth/Height），
// 直接复用即可，同一个文件不再被解码两次。

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
/**
 * 包干时限的读法。**不能**四舍五入成"几分钟"：加时卡 (+30 秒) 会把 `timeLimitMs` 推出选项表，
 * 1 分钟那档用一张卡就变 90 秒 —— 旧写法 `Math.round(ms/60000)` 直接报成「包干 2 分钟」，
 * 用户看到的是一条凭空多出来的 30 秒。（整分钟仍照选项名，跟设置浮层里选的叫法一致。）
 */
const formatTimeLimitLabel = (ms: number) => ms % 60_000 === 0
  ? `${Math.round(ms / 60_000)} 分钟`
  : ms < 60_000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
// 每手读秒（用户 09-17 第一梯队④）：在你的回合内限时，超时与总时限同样判负。
// AI 不占钟——它的思考预算就是难度档自身。
const AI_READ_OFF_OPTIONS: Array<{ value: number; title: string; text: string }> = [
  { value: 0, title: "无", text: "不限每手用时" },
  { value: 30000, title: "30 秒", text: "快棋节奏" },
  { value: 60000, title: "60 秒", text: "标准读秒" },
];
const AI_READ_OFF_KEY = "banbu-ai-move-readoff-v1";
const loadAiReadOffMs = (): number => {
  try {
    const raw = Number(localStorage.getItem(AI_READ_OFF_KEY));
    return AI_READ_OFF_OPTIONS.some((option) => option.value === raw) ? raw : 0;
  } catch { return 0; }
};
const formatGameClock = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};
const THEME_PREFERENCE_KEY = "banbu-theme-preference-v1";

/**
 * **外观预览**期间不写盘（用户 2026-10-10：「我们这个外观啊，现在不交钱无法预览了，
 * 就很不好……而主题呢，也是可以预览，但是不买就回到自己使用的那个」）。
 *
 * 做法：预览 = 照常把 state 改掉（于是界面立刻变过去，这是"预览"的全部意义），
 * 但**跳过落盘**。不买就退出预览时，把 state 还原成预览前的那一套
 * （见 `previewAppearance`）—— 于是"没买就回到自己原来用的那个"。
 *
 * 为什么用模块级标记而不是把预览状态塞进 state：
 * 写盘发生在两个 `useEffect` 里（主题一个、棋盘/棋子一个），它们只看得到 state。
 * 让 state 多带一个 `previewing` 字段会改动这两处 effect 的依赖数组与全部写盘点，
 * 而那两处在 `App.tsx` 这种一万行的文件里越少动越好。
 * 模块级标记只被这两个 effect 读，语义清楚、改动面最小。
 */
let appearancePreviewing = false;
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
/* 合法主题值 = 本体原有那批（走 `.board-X` CSS）+ 实验室搬进来那批（走 `src/appearance` 数据路）。
   数据路那份是生成的，所以白名单**跟着数据走**，不再手写第二份清单 ——
   手写清单和 `backup.ts` 里那份一旦对不齐，老备份就会被整份判非法（见改造表 R108 第四节）。 */
const isBoardTheme = (value: unknown): value is BoardTheme =>
  typeof value === "string" && (LEGACY_BOARD_THEMES.includes(value) || newMaterialBoard(value) !== null);
const isStoneTheme = (value: unknown): value is StoneTheme =>
  typeof value === "string" && (LEGACY_STONE_THEMES.includes(value) || newMaterialStone(value) !== null);
const loadThemePreference = (): ThemePreference => {
  try {
    const value = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (value === "leaves") return "snow";
    return isThemePreference(value) ? value : "system";
  } catch { return "system"; }
};
/* 被删掉的主题（notebook / porcelain / frosted 盘、gold 子）在老存档里可能还留着。
   读的时候归一化到默认，而不是判非法 —— 用户点开设置发现"我原来的盘变成了默认"，
   远好过整份备份还原不了。校验白名单仍然认这些旧值，就是为了这个。 */
const loadBoardTheme = (): BoardTheme => {
  try { const value = localStorage.getItem(BOARD_THEME_KEY); return isBoardTheme(value) ? normalizeBoardTheme(value) as BoardTheme : "wood"; } catch { return "wood"; }
};
const loadStoneTheme = (): StoneTheme => {
  try { const value = localStorage.getItem(STONE_THEME_KEY); return isStoneTheme(value) ? normalizeStoneTheme(value) as StoneTheme : "classic"; } catch { return "classic"; }
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
    const value = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY) || "null") as Partial<{ showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean; showLastMove: boolean; moveNumberScale: number; gridLineWidth: number; coordinateFontSize: number; boardMargin: number; stoneSize: number }> | null;
    const coordinateFontSize = migrateCoordinateFontSize(value?.coordinateFontSize);
    // 旧存档没有 boardMargin（以及字号被改大后原先存的窄值）都要收敛，否则坐标会被挤出画布。
    return { showNumbers: value?.showNumbers !== false, showCoordinates: value?.showCoordinates !== false, showForbidden: value?.showForbidden !== false, showLastMove: value?.showLastMove !== false, moveNumberScale: clampMoveNumberScale(positive(value?.moveNumberScale, DEFAULT_MOVE_NUMBER_SCALE)), gridLineWidth: positive(value?.gridLineWidth, 1.25), coordinateFontSize, boardMargin: value?.boardMargin === undefined ? DEFAULT_BOARD_MARGIN : clampBoardMargin(value.boardMargin, coordinateFontSize), stoneSize: clampStoneScale(value?.stoneSize) };
  } catch {
    return { showNumbers: true, showCoordinates: true, showForbidden: true, showLastMove: true, moveNumberScale: DEFAULT_MOVE_NUMBER_SCALE, gridLineWidth: 1.25, coordinateFontSize: DEFAULT_COORDINATE_FONT_SIZE, boardMargin: DEFAULT_BOARD_MARGIN, stoneSize: DEFAULT_STONE_SCALE };
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
/** 应用是否被切出（进后台、锁屏、多任务）。
 *
 *  为什么每个「点火引擎」的入口都要单独查它一次：切到后台时 JS 计时器只是被降频、**不会被停**，
 *  所以 visibilitychange 里那次取消（见 cancelActiveAiComputation("background")）会被随后的
 *  自动分析 / 自愈保活 / 自对弈 effect 重新点燃。真机取证（2026-10-02，Redmi marble）：
 *  16:16:28 正确发出 GTP `stop` → 16:16:32 保活 interval 又 `kata-analyze 10` → 连跑 5 分钟 →
 *  16:21:08 系统按 reason=9 EXCESSIVE RESOURCE USAGE / subreason=7 EXCESSIVE CPU USAGE
 *  （"Caused by child process: excessive cpu 1113780 during 300304, limit=25"）杀掉整个进程，
 *  用户看到的「切出去一会儿局面没了、改动也没了」就是这一次冷启动。
 *
 * ⚠ 组件作用域里 `document` 指**当前棋谱**（GameDocument），浏览器那份必须走 globalThis.document。 */
const appHidden = () => globalThis.document?.visibilityState === "hidden";
const DEFAULT_BOARD_SIZE_KEY = "banbu-default-board-size-v1";
const ACTIVE_LARGE_RECORD_KEY = "banbu-active-large-record-v1";
const MAX_OTHER_RECORD_BYTES = 64 * 1024 * 1024;
/**
 * 小于这个体积的棋谱在主线程直接解析（省掉 worker 往返），更大的交给
 * RecordImportWorker。实测解析吞吐约 4.5M 字符/秒：512KB ≈ 110ms，仍在一次
 * 长任务的量级以内；而 4MB（旧阈值）在主线程要 ~870ms，用户能看到明显卡顿
 * ——2.56MB 的 SGF 实测主线程长任务 524ms。所以阈值从 4MB 下调到 512KB。
 */
const MAIN_THREAD_PARSE_MAX_BYTES = 512 * 1024;
/**
 * 「这个 .json 会不会是生成题证明」的识别上限（用户 2026-10-11 加）。
 *
 * 判据是文件本身有硬边界：证明受 `isGeneratedPuzzle` 约束（棋盘 ≤30 路、
 * 每色子 ≤900、solution ≤2×depth），所以真实的证明 JSON 只有几十 KB。
 * 而**棋谱** JSON 可能几 MB —— 那种不该为了"看看能不能当题"先在主线程整个 parse 一遍，
 * 直接落到棋谱流程。取 2MB：比任何真实证明大两个数量级，又远小于大棋谱。
 */
const GENERATED_PROOF_DETECT_MAX_BYTES = 2 * 1024 * 1024;
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

// 说明文字统一走 markStyleLabel（样式清单的标签），别在这里再写一套映射，
// 否则新增画法后这里会退化成兜底的「叉号」。
const markKindLabel = (mark: BoardMark) => markStyleLabel(mark);
const nodeMarksText = (marks: BoardMark[]) => marks.flatMap((mark) => [coordinateName(mark), mark.label || "", markKindLabel(mark)]).join(" ");

/** 标注样式的小尺寸示意渲染（面板按钮、样式选择器与预览共用）。
 *  形状几何交给 MarkShape——与棋盘同一份实现，避免预览与落盘观感分叉。 */
function MarkGlyph({ style, color, value = "", size = 34 }: { style: BoardMarkStyle; color: string; value?: string; size?: number }) {
  const label = Array.from(value).slice(0, 4).join("");
  return <svg width={size} height={size} viewBox="-24 -24 48 48" aria-hidden="true">
    <MarkShape style={style} color={color} r={17} label={label} labelFontSize={16} strokeWidth={2.6}/>
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
// 新建棋谱可选路数：与 game.ts 的 isSupportedBoardSize 同源（5–30）。
// 这里原来写死 Array.from({length:17}) 只到 21 路，于是「能导入 23 路 SGF、
// 却无法新建 23 路棋谱」——用户 09-23 指出口径不统一，改为从常量推导。
const BOARD_SIZE_CHOICES = Array.from({ length: MAX_BOARD_SIZE - MIN_BOARD_SIZE + 1 }, (_, index) => index + MIN_BOARD_SIZE);
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
    const closeOnScroll = (event: Event) => {
      // **菜单自己内部的滚动不算「页面滚动」**（用户 09-29 报「选点数量往上拉
      // 就直接关掉选框」）：菜单是 portal 到 body 的 fixed 浮层，选项多时本来就要
      // 在菜单里滑动。旧写法用 capture 捕获一切 scroll 事件（含菜单内部），于是
      // 手指一往上滑菜单立刻被关掉——选不了后面的项。
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
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
  // 上限 2 位（用户 09-27：5 位字都看不清了——选择器历史值可能是 5，展示层统一钳制）。
  const digits = Math.min(2, Math.max(0, decimals));
  if (metric === "winRate") return candidate.winRate === undefined ? "—" : `${(candidate.winRate * 100).toFixed(digits)}%`;
  if (metric === "score") return candidate.score === undefined ? "—" : `${candidate.score > 0 ? "+" : ""}${candidate.score.toFixed(digits)}`;
  // 和棋率（KataGo 专属）：本构建的 scoreMean 字段就是它（gtp.cpp:649），
  // 单位是百分数。与胜率同样吃小数位设置，但下限 1 位（和棋率通常很小，
  // 取整会全变成 0%）。
  if (metric === "drawRate") {
    if (candidate.drawRate === undefined) return "—";
    return `${candidate.drawRate.toFixed(Math.max(1, digits))}%`;
  }
  if (metric === "nodes") {
    // 与面板上的「节点/速度」用同一套 k 规则（用户 09-15：过千用 k 更好比较），
    // 原来这里是 1.0K / 1.0M 两位不同单位，量级看不出来。
    if (!candidate.nodes) return "—";
    return formatEngineCount(candidate.nodes);
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

// 为什么要有这两个模块级空数组常量：Board 用 React.memo 包裹，默认浅比较 props。
// 只要有一个 prop 每次渲染换成新引用，memo 就失效、整盘（225 个格子 + 全部棋子）
// 会跟着父组件重渲染。而调用处写的 `aiGame?.opening.candidates || []`、三元表达式
// 里的 `: []` 都是「渲染时现建数组」——引用必然每次都变。提到模块级后引用永久
// 稳定，且 Board 只读不写这些数组，共享是安全的。
const EMPTY_POSITIONS: Position[] = [];
const EMPTY_ANALYSIS_CANDIDATES: AiAnalysisCandidate[] = [];
// 变化预览线的空值：元素类型比 Position 多一个 player（Board 的
// analysisPreviewLine prop 类型），单独建常量避免每次渲染现建空数组。
const EMPTY_PREVIEW_LINE: Array<Position & { player: Player }> = [];
// onMark 在不适用时曾传内联 `() => undefined`，同样是每渲染新函数；用模块级常量
// 替代，保证 Board 的 onMark 引用始终稳定。
const NOOP_MARK = () => undefined;

type EngineLoadState = { percent: number; label: string };

/**
 * Keep the loading slot mounted while the engine starts. Older Android
 * WebViews repaint the surrounding panel when a progress node is inserted or
 * removed, which is visible as a full-page flash on animated themes.
 */
const EngineLoadStatus = memo(function EngineLoadStatus({ load }: { load: EngineLoadState | null }) {
  const active = load !== null;
  const percent = active ? Math.max(6, Math.min(100, load.percent)) : 6;
  return <div className={`engine-load ${active ? "active" : "inactive"}${active && load.percent >= 100 ? " done" : ""}`} data-engine-load-active={active ? "true" : "false"} role={active ? "status" : undefined} aria-hidden={active ? undefined : "true"}>
    <div className="engine-load-track"><span style={{ width: `${percent}%` }}/></div>
    <small>{active ? load.label : ""}</small>
  </div>;
});

/**
 * The candidate/PV overlay is intentionally subscribed outside App. Engine info
 * frames are allowed to repaint this small SVG, but they must not reconcile the
 * topbar, theme scene, hidden file inputs, or the main board SVG.
 */
const BoardAnalysisSurface = memo(function BoardAnalysisSurface({
  board,
  boardSize,
  stoneRadius,
  visualXY,
  analysisCandidates,
  analysisContextKey,
  analysisCandidateMetric,
  analysisCandidateDecimals,
  analysisShowCandidates,
  analysisPreviewLine,
  analysisPreviewSelection,
  analysisPreviewGuide,
  openingCandidates,
}: {
  board: Cell[][];
  boardSize: number;
  stoneRadius: number;
  visualXY: (position: Position) => { x: number; y: number };
  analysisCandidates: AiAnalysisCandidate[];
  analysisContextKey?: string;
  analysisCandidateMetric: AnalysisCandidateMetric;
  analysisCandidateDecimals: number;
  analysisShowCandidates: boolean;
  analysisPreviewLine: Array<Position & { player: Player }>;
  analysisPreviewSelection?: { contextKey: string; row: number; col: number } | null;
  analysisPreviewGuide: boolean;
  openingCandidates: Position[];
}) {
  const live = useAiAnalysisState();
  const liveActive = Boolean(analysisContextKey && live.contextKey === analysisContextKey);
  const source = liveActive && analysisShowCandidates ? (live.candidates || EMPTY_ANALYSIS_CANDIDATES) : analysisCandidates;
  const candidates = source
    .filter((candidate, index, all) => !board[candidate.move.row]?.[candidate.move.col]
      && all.findIndex((item) => item.move.row === candidate.move.row && item.move.col === candidate.move.col) === index);
  const selection = analysisPreviewSelection && liveActive ? analysisPreviewSelection : null;
  const previewCandidate = selection
    ? candidates.find((candidate) => candidate.move.row === selection.row && candidate.move.col === selection.col)
    : undefined;
  const previewLine = previewCandidate?.principalVariation?.slice(0, 24) ?? analysisPreviewLine;

  return <svg className="board-analysis-surface" viewBox="0 0 572 572" aria-hidden="true" focusable="false">
    {candidates.map((candidate, index) => {
      const { x, y } = visualXY(candidate.move);
      const showMetric = previewLine.length === 0;
      const candidateLabel = analysisCandidateMetric === "winRate" && candidate.winRate !== undefined
        ? (Math.max(0, Math.min(1, candidate.winRate)) * 100).toFixed(analysisCandidateDecimals)
        : analysisMetricText(candidate, analysisCandidateMetric, analysisCandidateDecimals);
      const candidateSelected = !!selection && selection.row === candidate.move.row && selection.col === candidate.move.col;
      return <g key={`analysis-candidate-${candidate.move.row}-${candidate.move.col}`} className={`analysis-candidate-point ${analysisCandidateTone(candidate, analysisCandidateMetric)} ${candidateSelected ? "candidate-active" : ""}`} aria-label={`AI 候选 ${index + 1} ${coordinateName(candidate.move, boardSize)} ${analysisMetricText(candidate, analysisCandidateMetric, analysisCandidateDecimals)}`}><circle cx={x} cy={y} r={stoneRadius}/>{showMetric && <text x={x} y={y} dy=".35em" style={{ fontSize: Math.min(stoneRadius * 1.4, stoneRadius * 3 / Math.max(2, candidateLabel.length)) }}>{candidateLabel}</text>}</g>;
    })}
    {previewLine.length > 0 && (() => {
      const projected = previewLine.map((point, index) => ({ point, index })).filter(({ point }) => !board[point.row]?.[point.col] && !openingCandidates.some((candidate) => candidate.row === point.row && candidate.col === point.col));
      return <g className="analysis-preview-line" aria-label={`候选变化预览，${projected.length} 手`}>
        {analysisPreviewGuide && projected.map((entry, position) => position === 0 ? null : (() => { const from = visualXY(projected[position - 1].point); const to = visualXY(entry.point); return <line key={`pv-link-${position}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}/>; })())}
        {projected.map((entry) => { const { x, y } = visualXY(entry.point); return <g key={`pv-${entry.index}`} className={`analysis-preview-stone ${entry.point.player}`}><circle cx={x} cy={y} r={stoneRadius}/><text x={x} y={y} dy=".35em" style={{ fontSize: Math.max(8, stoneRadius * .62) }}>{entry.index + 1}</text></g>; })}
      </g>;
    })()}
  </svg>;
});

const AnalysisLiveReadout = memo(function AnalysisLiveReadout({
  board,
  currentPositionKey,
  analysisContextKey,
  aiGame,
  nextPlayer,
  analysisShownMetric,
  analysisCandidateCount,
  analysisCandidateDecimals,
  analysisShowCandidates,
  analysisPreview,
  onToggleCandidate,
}: {
  board: Cell[][];
  currentPositionKey: string;
  analysisContextKey?: string;
  aiGame: boolean;
  nextPlayer: Player;
  analysisShownMetric: AnalysisCandidateMetric;
  analysisCandidateCount: number;
  analysisCandidateDecimals: number;
  analysisShowCandidates: boolean;
  analysisPreview: { contextKey: string; row: number; col: number } | null;
  onToggleCandidate: (candidate: AiAnalysisCandidate) => void;
}) {
  const live = useAiAnalysisState();
  const panelRead = live.contextKey === currentPositionKey ? live : null;
  const kataAnalysisStats = live.engine === "kata";
  const candidates = analysisShowCandidates && !aiGame && analysisContextKey === currentPositionKey
    ? (live.contextKey === currentPositionKey ? live.candidates || EMPTY_ANALYSIS_CANDIDATES : EMPTY_ANALYSIS_CANDIDATES)
      .filter((candidate) => !board[candidate.move.row]?.[candidate.move.col])
    : EMPTY_ANALYSIS_CANDIDATES;
  const ranked = rankAnalysisCandidates(candidates, analysisShownMetric).slice(0, analysisCandidateCount);
  const mover = panelRead?.mover ?? live.mover ?? nextPlayer;
  const panelWin = panelWinRate(panelRead?.winRate);
  const winTone = panelWin === undefined ? "" : panelWin >= .67 ? "high" : panelWin <= .33 ? "low" : "mid";
  const depth = panelRead?.depth || 0;
  const selDepth = panelRead?.selDepth || 0;
  return <>
    <div className="ai-analysis-stats">
      {kataAnalysisStats
        ? <>{!aiGame && <span className="stat-winrate"><small>{moverWinRateLabel(mover)}</small><b className={winTone}>{panelWin === undefined ? "-" : `${Math.round(panelWin * 100)}%`}</b></span>}<span className="stat-speed" title="每秒搜索访问量（KataGo 以访问量计）"><small>速度</small><b>{formatEngineCount(panelRead?.speed)}</b></span><span className="stat-nodes" title={panelRead?.nodes ? panelRead.nodes.toLocaleString() : undefined}><small>访问</small><b>{panelRead?.nodes ? formatEngineCount(panelRead.nodes) : "-"}</b></span><span className="stat-pvlen" title="主变化（PV）长度：引擎算出的后续最佳应对序列长度"><small>PV</small><b>{panelRead?.principalVariation?.length || panelRead?.candidates?.[0]?.principalVariation?.length || "-"}</b></span></>
        : <><span className="stat-depth" title="完成迭代深度-实际到达的最大深度（含选择延伸）"><small>深度</small><b>{!depth ? "-" : selDepth > depth ? `${depth}-${selDepth}` : String(depth)}</b></span><span className="stat-speed" title="每秒搜索节点数"><small>速度</small><b>{formatEngineCount(panelRead?.speed)}</b></span><span className="stat-score"><small>评估分</small><b className={(panelRead?.score ?? 0) > 0 ? "pos" : (panelRead?.score ?? 0) < 0 ? "neg" : ""}>{panelRead?.scoreAvailable ? `${(panelRead.score || 0) > 0 ? "+" : ""}${Math.round(panelRead.score || 0)}` : "-"}</b></span>{!aiGame && <span className="stat-winrate"><small>{moverWinRateLabel(mover)}</small><b className={panelRead?.status === "thinking" && depth < 12 ? "" : winTone}>{panelRead?.status === "thinking" && depth < 12 ? "计算中" : panelWin === undefined ? "-" : `${Math.round(panelWin * 100)}%`}</b></span>}<span className="stat-nodes" title={panelRead?.nodes ? panelRead.nodes.toLocaleString() : undefined}><small>节点</small><b>{panelRead?.nodes ? formatEngineCount(panelRead.nodes) : "-"}</b></span></>}
    </div>
    {ranked.length > 0 && <div className="ai-analysis-candidates"><small>{`行棋方（${mover === "white" ? "白" : "黑"}）${kataAnalysisStats && analysisShownMetric === "nodes" ? "访问量" : ANALYSIS_METRIC_LABELS[analysisShownMetric]} · 点击看变化 · 本地棋力有限，仅供参考`}</small>{ranked.map((candidate, index) => <button type="button" key={`${candidate.move.row}-${candidate.move.col}`} className={`analysis-candidate-chip ${analysisPreview && analysisPreview.row === candidate.move.row && analysisPreview.col === candidate.move.col ? "selected" : ""}`} aria-pressed={!!(analysisPreview && analysisPreview.row === candidate.move.row && analysisPreview.col === candidate.move.col)} onClick={() => onToggleCandidate(candidate)}><b>{index + 1}. {coordinateName(candidate.move)}</b><em>{analysisMetricText(candidate, analysisShownMetric, analysisCandidateDecimals)}</em></button>)}</div>}
  </>;
});

/** Keep the win-rate tab live without waking the App shell for every engine frame. */
const LiveWinratePanel = memo(function LiveWinratePanel({
  positions,
  reviewSamples,
  cacheRates,
  currentPositionKey,
  currentId,
  nextPlayer,
  onOpenReview,
  renderChart,
}: {
  positions: Array<{ nodeId: string }>;
  reviewSamples: ReviewSample[] | undefined;
  cacheRates: Record<string, number | undefined>;
  currentPositionKey: string;
  currentId: string;
  nextPlayer: Player;
  onOpenReview: () => void;
  renderChart: (points: Array<{ moveNumber: number; blackWinRate: number }>) => ReactNode;
}) {
  const live = useAiAnalysisState();
  const livePoint = useMemo(() => {
    if (live.status === "idle" || live.contextKey !== currentPositionKey || typeof live.winRate !== "number") return null;
    const blackRate = toBlackWinRate(live.winRate, live.mover || nextPlayer);
    return blackRate === undefined ? null : { nodeId: currentId, blackWinRate: Math.round(blackRate * 1000) / 10 };
  }, [live.status, live.contextKey, live.winRate, live.mover, currentPositionKey, currentId, nextPlayer]);
  const points = useMemo(() => {
    const rates = { ...cacheRates };
    if (livePoint && positions.some((position) => position.nodeId === livePoint.nodeId)) rates[livePoint.nodeId] = livePoint.blackWinRate;
    return buildWinrateSeries(positions, reviewSamples, rates)
      .filter((point): point is typeof point & { blackWinRate: number } => typeof point.blackWinRate === "number");
  }, [positions, reviewSamples, cacheRates, livePoint]);
  if (points.length <= 1) return <p className="ai-review-note">还没有可以画的胜率：先在「计算」页分析几手，或去「复盘」页整局跑一遍。</p>;
  return <>
    {renderChart(points)}
    <p className="ai-review-note">当前局面在算的过程中就会实时更新 · 已积累 {points.length} / {positions.length}</p>
    {points.length < positions.length && <div className="ai-review-actions"><button type="button" className="ai-review-copy" data-winrate-to-review="true" onClick={onOpenReview}>去整局复盘补全</button></div>}
  </>;
});

// 把「每次渲染都会换身份」的事件回调转发成引用稳定的回调。Board 的 memo 要求
// onPlay/onMark/onVariation/onGestureStep/onStopThinking 引用稳定，但这些实现
// （play/mark/navigateVariation/…）依赖几十个 state 与其它回调，逐个写进
// useCallback 依赖数组极易漏项，从而产生陈旧闭包——这类 bug 极难排查（落子用到
// 旧 state，现象是偶发、难复现）。这里用 latest-ref 方案：布局阶段把最新实现写进
// ref，稳定的 useCallback 永远调用 ref.current，因此既稳住了引用，又保证执行的是
// 最新逻辑，不存在陈旧闭包。用 useLayoutEffect（而非 useEffect）是为了在浏览器
// 绘制/用户事件之前就完成更新，事件回调永远拿到本帧的实现。
function useStableCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const ref = useRef(callback);
  useLayoutEffect(() => { ref.current = callback; });
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}

const Board = memo(function Board({ document, currentId, currentBookmarked = false, showNumbers, showCoordinates, showLastMove = true, moveNumberScale = DEFAULT_MOVE_NUMBER_SCALE, gridLineWidth = 1.25, coordinateFontSize = DEFAULT_COORDINATE_FONT_SIZE, boardMargin = DEFAULT_BOARD_MARGIN, stoneSize = DEFAULT_STONE_SCALE, largeBoard, rotation, mirrored, initialDepth = 0, disabled = false, confirmPlacement = false, forbiddenMarkers = [], winningLines = [], openingCandidates = [], analysisCandidates = [], analysisContextKey = "", analysisCandidateMetric = "winRate", analysisCandidateDecimals = 0, analysisShowCandidates = false, analysisPreviewLine = [], analysisPreviewSelection = null, analysisPreviewGuide = false, openingStage, thinking = false, thinkingIndicatorPosition = "corner", onStopThinking, motion, placeEffect, dropEffect, feedback, result, boardTheme = "wood", stoneTheme = "classic", boardOpacity = 1, stoneOpacity = 1, annotationHighlight = "none", gestureZoomEnabled = false, gestureSwipeEnabled = false, gestureRotateEnabled = false, onRotateStep, radialMenuEnabled = false, onRadialMenu, onStepBack, onPlay, onVariation, onMark, onGestureStep, onReview }: {
  document: GameDocument; currentId: string; showNumbers: boolean; showCoordinates: boolean; showLastMove?: boolean; moveNumberScale?: number; gridLineWidth?: number; coordinateFontSize?: number; largeBoard: boolean;
  // 四边坐标缝宽度（SVG 单位）：默认 34，越小棋盘本体越大，最小档只够勉强容纳坐标。
  boardMargin?: number;
  // 棋子大小档位（1 = 默认的自动大小）：0.85–1.2，上限被「相邻棋子相切」截断。
  stoneSize?: number;
  currentBookmarked?: boolean;
  rotation: BoardRotation; mirrored: boolean;
  initialDepth?: number; disabled?: boolean;
  /** 两段式落子（设置「点击确认落子」）：点空位先出圈，再点同一格才落子。 */
  confirmPlacement?: boolean;
  /** 人机对弈「提示卡」建议的那一手（只画圈）。 */
  boardTheme?: BoardTheme; stoneTheme?: StoneTheme; boardOpacity?: number; stoneOpacity?: number; annotationHighlight?: AnnotationHighlight;
  forbiddenMarkers?: Array<Position & { reason: string }>;
  winningLines?: Position[][];
  openingCandidates?: Position[];
  analysisCandidates?: AiAnalysisCandidate[];
  analysisContextKey?: string;
  analysisCandidateMetric?: AnalysisCandidateMetric;
  analysisPreviewLine?: Array<Position & { player: Player }>;
  analysisPreviewSelection?: { contextKey: string; row: number; col: number } | null;
  // 候选点胜率/评估分的小数位数（0-2），只影响圆标与面板文本。
  analysisCandidateDecimals?: number;
  analysisShowCandidates?: boolean;
  // 候选变化预览是否画出各手之间的连线；默认关闭（带序号的预览棋子已足够表达变化图）。
  analysisPreviewGuide?: boolean;
  openingStage?: OpeningStage;
  thinking?: boolean;
  thinkingIndicatorPosition?: "corner" | "below";
  onStopThinking?: () => void;
  gestureZoomEnabled?: boolean; gestureSwipeEnabled?: boolean; gestureRotateEnabled?: boolean;
  /** 双指旋转手势的步进回调（rotation 状态在 App，手势在 Board 内）。 */
  onRotateStep?: (step: 0 | 90 | 270) => void;
  /** 长按环形菜单开关与呼出回调（用户 09-17 第二批①）：长按已有棋子/右键触发。 */
  radialMenuEnabled?: boolean;
  /** 右键回退一步（用户 09-26）：返回 true 表示这次右键已被消费，调用方不要再弹环形菜单。 */
  onStepBack?: () => boolean;
  onRadialMenu?: (position: Position, clientX: number, clientY: number) => void;

  motion?: BoardMotionState;
  /** 公用「落子交互」方案：落子时在落点炸开（插进 #board）。全局动效或总开关关时为 null。 */
  placeEffect?: EffectScheme | null;
  /** 公用「棋子进场」方案：只剩刚落那一枚 .stone-piece 挂它的类名。全局动效或总开关关时为 null。 */
  dropEffect?: EffectScheme | null;
  feedback?: BoardFeedbackState | null;
  result?: BoardResultState | null;
  onPlay: (position: Position) => void; onVariation?: (nodeId: string) => void; onMark: (position: Position) => void;
  onGestureStep?: (direction: -1 | 1) => void;
  /** 结果横幅的「复盘本局」回调：仅人机对局出结局时由 App 传入。 */
  onReview?: () => void;
}) {
  const safeCurrentId = document.nodes[currentId] ? currentId : document.rootId;
  // The result banner stays until the player dismisses it; a new outcome (or a
  // cleared board) brings it back.
  const [resultDismissed, setResultDismissed] = useState(false);
  useEffect(() => { setResultDismissed(false); }, [result?.kind, result?.label]);
  const board = useMemo(() => boardAt(document, safeCurrentId), [document, safeCurrentId]);
  /** 两段式落子的「待确认点」（用户 2026-10-13：点一下先出圈，再点才落子）。
   *  ⚠ 必须在局面变化时清掉：悔棋／切分支／新开一局会让那个点不再是"我刚点过的位置"，
   *    而 AI 或别的入口把子下到那儿时，圈会留在一个已经不能落子的格上。 */
  const [pendingPoint, setPendingPoint] = useState<Position | null>(null);
  useEffect(() => { setPendingPoint(null); }, [safeCurrentId, document]);
  const pendingLive = pendingPoint !== null && !board[pendingPoint.row]?.[pendingPoint.col];
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
  // 长按环形菜单要按"手指在哪"定位菜单，而长按回调只有棋盘坐标——所以记下最后一次
  // 指针屏幕位置（pointermove 更新，pointerdown 也算一次）。
  const lastPointerX = useRef(0);
  const lastPointerY = useRef(0);
  const suppressedClickPoint = useRef<Position | null>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const gestureStartDistance = useRef<number | null>(null);
  const gestureStartCenter = useRef<{ x: number; y: number } | null>(null);
  const gestureStartScale = useRef(1);
  // 双指旋转（用户 09-17 第二批②）：起点两指连线角度。拧过阈值就转 90° 并把基准
  // 重置到当前角度（棘轮式）——继续拧可以连着转，而不是「一次手势只转一下」。
  const gestureStartAngle = useRef<number | null>(null);
  // 一次手势只转一格（用户 09-17 第二批②实测：不锁的话拧 100° 会连转 4 次回到原点，
  // 手感像"失控"）。要再转就抬手重拧一次。
  const gestureRotateHandled = useRef(false);
  const gestureSwipeHandled = useRef(false);
  const boardPanRef = useRef({ active: false, lastX: 0, lastY: 0, startX: 0, startY: 0, moved: false });
  const touchBlockUntil = useRef(0);
  // 本轮触摸交互里是否真的发生过手势（缩放/平移/滑动/多指）。只有它为真才吞掉
  // 尾随的那次 click——原先「最后一根手指抬起就无条件吞 180ms」会让触摸设备在
  // 开启手势后整块板落不了子（详见 applyGestureTouch 的说明）。
  const gestureActiveRef = useRef(false);
  const [boardScale, setBoardScale] = useState(1);
  // 缩放容器与「围绕某点缩放」的锚点：滚轮/捏合都把光标位置记在这里，
  // 等 React 提交新宽度后在 layout 阶段换算滚动量，保证指针下那一点不跑。
  const boardScrollerRef = useRef<HTMLDivElement | null>(null);
  const pendingZoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const previousScaleRef = useRef(1);
  // 四边坐标缝宽度：默认 34 与改造前一致，调窄则把省下的空间让给棋盘本体。
  const margin = clampBoardMargin(boardMargin, coordinateFontSize);
  const gap = (BOARD_VIEWBOX - 2 * margin) / Math.max(1, boardSize - 1), end = BOARD_VIEWBOX - margin;
  const coordLayout = coordinateLayout(margin, coordinateFontSize);
  /* 实验室搬进来的材质：查得到就走数据路，查不到（本体现有那 14 盘 / 16 子）继续走
     `.board-X` CSS 老路。两条路**刻意互斥** —— CSS 优先级高于呈现属性，同时用会被
     旧规则悄悄盖掉，表现就是"改了数据没反应"。见 src/appearance/render.ts 的 LEGACY 名单。 */
  const matBoard = newMaterialBoard(boardTheme);
  const matStone = newMaterialStone(stoneTheme);
  const matLine = matBoard ? boardLineProps(matBoard) : null;
  const separateMaterialSurface = Boolean(matBoard?.motions.length);
  // 棋子半径：自动大小仍按格距算（紧凑盘面多一点存在感、19–21 路仍看得清），
  // 用户档位在此基础上缩放，再由 stoneRadiusFor 的相切上限兜住——推到头也不会压住邻子。
  const stoneRadius = stoneRadiusFor(gap, stoneSize);
  const stoneScale = stoneRadius / 15.6;
  const visualPoint = useCallback((point: Position) => transformBoardPosition(point, boardSize, rotation, mirrored), [boardSize, mirrored, rotation]);
  const visualXY = useCallback((point: Position) => {
    const displayed = visualPoint(point);
    return { x: margin + displayed.col * gap, y: margin + displayed.row * gap };
  }, [gap, margin, visualPoint]);
  /* 公用「落子交互」特效的宿主就是这个 <svg id="board">（用 ref，避免依赖全局
     getElementById 撞上同名节点）。 */
  const boardRef = useRef<SVGSVGElement | null>(null);
  const boardCanvasRef = useRef<HTMLDivElement | null>(null);
  /* 落子交互 spawn：与 boardMotion("place") 同源 —— 所有会落子的路径（人落、AI 应手、
     开局、做题、草稿、回退后重下）都已经统一调 triggerBoardMotion("place")，在这里
     按 version 去重即可，不必逐个 call site 埋点。
     初始值取当前 version：Board 在切页/重挂后若 motion 仍是旧的 "place"，
     不会把上一手的特效重炸一遍；之后每落一手 version+1 才真正 spawn。 */
  const placedEffectVersion = useRef(motion?.version ?? -1);
  useEffect(() => {
    if (!placeEffect && !dropEffect) return;
    if (motion?.kind !== "place") return;
    if (placedEffectVersion.current === motion.version) return;
    placedEffectVersion.current = motion.version;
    const point = current.move;
    const host = boardRef.current;
    // 与进场类同一判定：这一事件必须属于当前节点，否则（撤销后 place 态还在、光标移到了
    // 老子身上）会在别的位置凭空炸一次。
    if (!point || !host || motion.at !== current.id) return;
    // 几何全部取本体实际值：x/y 走 visualXY（已含旋转/镜像与可变 margin/gap），
    // r 走本体 stoneRadius（不是实验室的 GAP*0.42），gridMin/gridMax 是网格起止，
    // 「行光贯穿」靠它横贯整条行列。
    const payload = { ...visualXY(point), r: stoneRadius, host, accent: effectAccent(isDarkBoard()), gridMin: margin, gridMax: end };
    placeEffect?.spawn?.(placeEffect.id, payload);
    /* 「棋子进场」那 4 套（dp-spin 拖尾 / dp-squash 冲击环 / dp-fall 扬尘 / dp-spiral 螺旋）
       除了给子挂动画类，还各带一段插在棋子**下面**的伴随特效。之前这里只调了
       placeEffect.spawn，drop 的 spawn 从没被叫过 —— 于是方案说明写着「落地扬尘」，
       实盘和设置预览里都只有那颗子弹下来，特效一次都没出现。 */
    dropEffect?.spawn?.(dropEffect.id, payload);
  }, [motion?.kind, motion?.version, motion?.at, placeEffect, dropEffect, current.move, current.id, visualXY, stoneRadius, margin, end]);
  const starPoints = boardSize === 15 ? [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]] : boardSize === 19 ? [[3, 3], [3, 15], [9, 9], [15, 3], [15, 15]] : [[Math.floor(boardSize / 2), Math.floor(boardSize / 2)]];
  const clampScale = useCallback((value: number) => clampBoardScale(value), []);
  /** 放大期间把 `.board-scroller` 的高度冻在放大前那一档。
   *  竖屏下这个容器没有固定高度：内容一放大它自己就被撑高（实测 410 → 590），
   *  于是纵向无处可滚，锚点只能锚住横向 —— 用户 10-06 报的「缩放固定从左上角」就是这条。
   *  必须在**改 scale 之前**量这个高度：等布局算完再量，容器已经变高了。 */
  const [frozenScrollerHeight, setFrozenScrollerHeight] = useState(0);
  // 必须走 state 而不是直接写 style：`boardScrollerStyle` 每次渲染都会重新赋 style，
  // 命令式设的 maxHeight 会被冲掉（第一版就是这么写的，实测完全没生效）。
  const freezeScrollerForZoom = useCallback(() => {
    const scroller = boardScrollerRef.current;
    if (!scroller) return;
    setFrozenScrollerHeight((current) => current || scroller.clientHeight);
  }, []);
  const releaseScrollerFreeze = useCallback(() => setFrozenScrollerHeight(0), []);
  const resetScale = useCallback(() => {
    touchPoints.current.clear();
    gestureStartDistance.current = null;
    gestureStartCenter.current = null;
    gestureStartScale.current = 1;
    gestureSwipeHandled.current = false;
    gestureActiveRef.current = false;
    touchBlockUntil.current = 0;
    releaseScrollerFreeze();
    setBoardScale(1);
  }, [releaseScrollerFreeze]);
  /**
   * 手势/滚轮缩放期间**只改 transform**，松手（或滚轮停顿）才提交一次 React 状态。
   *
   * 为什么（2026-10-15 用户报「放大时棋盘闪烁、引擎计算时也闪」）：原来每动一步都
   * `setBoardScale` → 棋盘整棵 React 树重建 + 按新宽度重新光栅化。生产包实测每一步
   * 脚本 200–500ms、光栅尖峰 326ms（`qa/tmp-zoom-flicker.mjs`：p95 帧间隔 133ms、
   * 最长 450ms、20+ 帧超 50ms），于是肉眼看到闪。改成：手势中只写一条 CSS transform
   * （合成器层面，不重建树、不重新光栅化），锚点用 transform-origin 的百分比表达
   * （与提交时 `zoomAnchorScroll` 用的是同一个锚点，所以松手前后视觉一致）。
   * 附带好处：缩放期间 React 一次都不 render。
   */
  const liveScaleRef = useRef<number | null>(null);
  const liveCommitTimer = useRef<number | null>(null);
  const applyLiveScale = useCallback((next: number, anchor: { x: number; y: number }) => {
    const svg = boardCanvasRef.current;
    const scroller = boardScrollerRef.current;
    if (!svg || !scroller) return;
    const ratio = next / previousScaleRef.current;
    const width = svg.clientWidth || 1;
    const height = svg.clientHeight || 1;
    const fracX = Math.min(100, Math.max(0, ((scroller.scrollLeft + anchor.x) / width) * 100));
    const fracY = Math.min(100, Math.max(0, ((scroller.scrollTop + anchor.y) / height) * 100));
    svg.style.transformOrigin = `${fracX.toFixed(3)}% ${fracY.toFixed(3)}%`;
    svg.style.transform = `scale(${ratio.toFixed(4)})`;
    svg.style.willChange = "transform";
    liveScaleRef.current = next;
  }, []);
  const commitLiveScale = useCallback(() => {
    if (liveCommitTimer.current !== null) { window.clearTimeout(liveCommitTimer.current); liveCommitTimer.current = null; }
    const live = liveScaleRef.current;
    if (live === null) return;
    liveScaleRef.current = null;
    const svg = boardCanvasRef.current;
    if (svg) { svg.style.transform = ""; svg.style.transformOrigin = ""; svg.style.willChange = ""; }
    setBoardScale(live);
  }, []);
  /** 滚轮没有「结束」事件：停顿 160ms 视为一次缩放结束，那时才提交。 */
  const scheduleLiveScaleCommit = useCallback(() => {
    if (liveCommitTimer.current !== null) window.clearTimeout(liveCommitTimer.current);
    liveCommitTimer.current = window.setTimeout(() => { liveCommitTimer.current = null; commitLiveScale(); }, 160);
  }, [commitLiveScale]);
  // 触摸手势与点按的共处规则（2026-09-15 修 BUG：开手势后落不了子）：
  // 浏览器处理一次点按时，click 紧跟在 pointerup 之后几毫秒到达。这里原先在
  // 最后一根手指抬起时**无条件**设 180ms 闸门，于是 .board-hit 的 onClick 永远
  // 被 isTouchGestureBlocked() 判掉——触摸设备上只要打开「双指缩放/双指滑动」，
  // 整块棋盘就再也落不了子（鼠标 pointerType=mouse 根本走不到这个分支，所以
  // 桌面手工和门禁都测不出来）。现在改成：只有本轮交互真的产生了缩放/平移/滑动，
  // 或多指同时按过，才吞掉尾随的那次 click；纯点按一律放行。
  const endGestureInteraction = useCallback(() => {
    gestureStartDistance.current = null;
    gestureStartCenter.current = null;
    gestureStartScale.current = 1;
    gestureSwipeHandled.current = false;
    // 手势结束才把手势期间的 transform 缩放**提交**成真实宽度（一次 React 渲染），
    // 见 applyLiveScale 的注释：手势中每步 setState 会让整棵棋盘树重建 → 闪。
    commitLiveScale();
    if (gestureActiveRef.current) touchBlockUntil.current = Math.max(touchBlockUntil.current, Date.now() + 260);
    gestureActiveRef.current = false;
  }, [commitLiveScale]);
  // 手指可能在棋盘外抬起（双指捏合时手指漂出板外很常见），这时 SVG 上的
  // pointerupCapture 收不到 → 残留一个「按着的手指」把交互永久判成手势中，
  // 只有换文档触发 resetScale 才恢复（用户原话「要新建一个局面才行」）。
  // pointerup/pointercancel 会冒泡到 window，用它兜底；两边都调同一个收尾函数，
  // 靠 Map.delete 的返回值保证只执行一次。
  useEffect(() => {
    if (!gestureZoomEnabled && !gestureSwipeEnabled) return;
    const release = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (!touchPoints.current.delete(event.pointerId)) return;
      boardPanRef.current.active = false;
      if (touchPoints.current.size > 0) return;
      endGestureInteraction();
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    };
  }, [endGestureInteraction, gestureSwipeEnabled, gestureZoomEnabled]);
  const applyGestureTouch = useCallback((event: ReactPointerEvent<SVGElement | HTMLDivElement>, kind: "down" | "move" | "up" | "cancel") => {
    if (event.pointerType !== "touch" || (!gestureZoomEnabled && !gestureSwipeEnabled && !gestureRotateEnabled)) return;
    const point = { x: event.clientX, y: event.clientY };
    if (kind === "down") {
      touchPoints.current.set(event.pointerId, point);
      // 多指同时按在板上即视为手势交互，全部抬起前都不落子。
      if (touchPoints.current.size > 1) gestureActiveRef.current = true;
      if (boardScale > 1.01) {
        boardPanRef.current = { active: true, lastX: point.x, lastY: point.y, startX: point.x, startY: point.y, moved: false };
      }
    } else if (kind === "move") {
      if (!touchPoints.current.has(event.pointerId)) return;
      if (boardScale > 1.01 && touchPoints.current.size === 1 && boardPanRef.current.active) {
        const scroller = event.currentTarget.parentElement;
        const dx = point.x - boardPanRef.current.lastX;
        const dy = point.y - boardPanRef.current.lastY;
        // 按「离按下点多远」判拖动：逐帧 2px 抖动会把放大后的一次正常点按误判成拖动。
        if (Math.abs(point.x - boardPanRef.current.startX) + Math.abs(point.y - boardPanRef.current.startY) > 8) boardPanRef.current.moved = true;
        if (scroller) { scroller.scrollLeft -= dx; scroller.scrollTop -= dy; }
        if (boardPanRef.current.moved) { gestureActiveRef.current = true; touchBlockUntil.current = Date.now() + 260; }
        boardPanRef.current.lastX = point.x; boardPanRef.current.lastY = point.y;
      }
      touchPoints.current.set(event.pointerId, point);
    } else {
      if (!touchPoints.current.delete(event.pointerId)) return;
      boardPanRef.current.active = false;
      if (touchPoints.current.size === 0) { endGestureInteraction(); return; }
    }
    if (touchPoints.current.size < 2) {
      gestureStartDistance.current = null;
      gestureStartCenter.current = null;
      gestureStartScale.current = 1;
      gestureStartAngle.current = null;
      gestureRotateHandled.current = false;
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
      gestureStartAngle.current = pointerAngle(first, second);
      gestureRotateHandled.current = false;
      gestureSwipeHandled.current = false;
      return;
    }
    if (gestureZoomEnabled) {
      const nextScale = clampScale(gestureStartScale.current * (distance / gestureStartDistance.current));
      if (Math.abs(nextScale - boardScale) > 0.01) {
        gestureActiveRef.current = true;
        // 锚点 = 两指中心相对滚动容器的位置，交给下面那个 useLayoutEffect 做「围着这一点放大」。
        // 原先这里只有 setBoardScale，所以放大永远从**左上角**长出去（用户 10-06 在安卓上报的
        // 「固定的缩放的是左上角，而不是随心所欲」）；桌面 Ctrl+滚轮那条一直是锚定的，
        // 所以这个手感问题只在手机/平板上出现。
        const scroller = boardScrollerRef.current;
        if (scroller) {
          const box = scroller.getBoundingClientRect();
          pendingZoomAnchor.current = { x: center.x - box.left, y: center.y - box.top };
          freezeScrollerForZoom();
          applyLiveScale(nextScale, pendingZoomAnchor.current);
        }
      }
    }
    const startCenter = gestureStartCenter.current || center;
    const deltaX = center.x - startCenter.x;
    const deltaY = center.y - startCenter.y;
    // 双指旋转（用户 09-17 第二批②）：与缩放、切手共用同一套基准与互斥判据——
    // 「没在缩放」（双指距离变化 < 26）且「不是横向滑动」（|deltaX| 未达切手阈值）
    // 才认旋转，否则三个手势会互相抢。转完重置角度基准，实现棘轮式连续旋转。
    if (gestureRotateEnabled && !gestureRotateHandled.current && gestureStartAngle.current !== null && Math.abs(distance - gestureStartDistance.current) < 26 && Math.abs(deltaX) < 72) {
      const delta = normalizeAngleDelta(pointerAngle(first, second) - gestureStartAngle.current);
      const step = rotationStepForAngleDelta(delta);
      if (step !== 0) {
        gestureRotateHandled.current = true;
        gestureActiveRef.current = true;
        touchBlockUntil.current = Date.now() + 260;
        onRotateStep?.(step);
      }
    }
    if (gestureSwipeEnabled && !gestureSwipeHandled.current && onGestureStep && Math.abs(deltaX) > 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35 && Math.abs(distance - gestureStartDistance.current) < 26) {
      gestureSwipeHandled.current = true;
      gestureActiveRef.current = true;
      touchBlockUntil.current = Date.now() + 260;
      onGestureStep(deltaX < 0 ? 1 : -1);
    }
  }, [boardScale, clampScale, endGestureInteraction, freezeScrollerForZoom, gestureSwipeEnabled, gestureZoomEnabled, gestureRotateEnabled, onRotateStep, onGestureStep]);
  // 手势中（多指按着 / 正在拖动）或刚结束的 260ms 内不落子；单纯点按不受影响。
  const isTouchGestureBlocked = () => touchBlockUntil.current > Date.now() || gestureActiveRef.current;
  // 桌面端的「双指缩放」不是 touch 指针事件，而是 Ctrl/⌘+滚轮——触摸板捏合在
  // Chromium/WebKit 里就是带 ctrlKey 的 wheel。只听 touch 的话，装了手势却在电脑上
  // 一点反应都没有（这条是用户报「棋盘不能缩放了」的一半原因）。wheel 必须用非
  // passive 的原生监听：React 的 onWheel 是 passive 的，preventDefault 会被忽略，
  // 浏览器的页面缩放会跟着一起放大。
  useEffect(() => {
    const scroller = boardScrollerRef.current;
    if (!scroller || !gestureZoomEnabled) return;
    const onWheel = (event: WheelEvent) => {
      if (!shouldZoomOnWheel(event)) return;
      event.preventDefault();
      const box = scroller.getBoundingClientRect();
      pendingZoomAnchor.current = { x: event.clientX - box.left, y: event.clientY - box.top };
      freezeScrollerForZoom();
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      applyLiveScale(clampBoardScale((liveScaleRef.current ?? previousScaleRef.current) * factor), pendingZoomAnchor.current);
      scheduleLiveScaleCommit();
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [freezeScrollerForZoom, gestureZoomEnabled]);
  // 提交新宽度之后再换算滚动量：这里才拿得到新的 scrollWidth/scrollHeight，
  // 也才能把「锚点在内容里的那一处」重新贴回原来的视口位置。
  // 提交新宽度之后再补滚动量：这时才拿得到新的 scrollWidth/scrollHeight，
  // 也才能把「锚点在内容里的那一处」换算到新滚动量上，否则手指原位会跳回左上角。
  useLayoutEffect(() => {
    const scroller = boardScrollerRef.current;
    const anchor = pendingZoomAnchor.current;
    const fromScale = previousScaleRef.current;
    previousScaleRef.current = boardScale;
    if (!scroller || !anchor || fromScale === boardScale) return;
    pendingZoomAnchor.current = null;
    const next = zoomAnchorScroll({
      anchorX: anchor.x, anchorY: anchor.y,
      scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop,
      fromScale, toScale: boardScale,
    });
    scroller.scrollLeft = next.left;
    scroller.scrollTop = next.top;
    if (boardScale <= 1.01) releaseScrollerFreeze();
  }, [boardScale, releaseScrollerFreeze]);
  useEffect(() => {
    resetScale();
  }, [document.id, resetScale]);
  // 开启棋盘手势时把浏览器的触摸手势让开：否则一次捏合会同时触发页面缩放
  // （实测页面被放到 144%）与棋盘缩放，叠在一起。“pan-x pan-y” 保留单指滚动、
  // 但把 pinch-zoom 从浏览器手里拿走；已经放大时改成 none，平移完全交给上面
  // 的 boardPanRef 逻辑，避免与浏览器滚动打架。
  const gestureTouchAction = (!gestureZoomEnabled && !gestureSwipeEnabled && !gestureRotateEnabled) ? undefined : (boardScale > 1.01 ? "none" : "pan-x pan-y");
  const boardZoomed = boardScale > 1.01;
  // 放大后必须把棋盘**装进一个定高滚动区**：否则 SVG 会把它所在的滚动容器一起撑高
  // （实测 235% 时容器 clientHeight 跟着变成 964px），容器永远不出现纵向溢出，于是
  // 上面的平移逻辑无处可滚、而 touch-action:none 又挡住了页面滚动 —— 放大的下半张
  // 棋盘根本够不到。定高之后捏合/拖动就是标准的「地图式」行为：容器内两轴都能平移，
  // 页面高度不再变化。
  // 放大时容器高度冻在放大前那一档：原先 410 → 615 的跳变会让锚点的参考系自己动，
  // 于是横向锚得住、纵向跑（用户 10-06 报的「缩放固定从左上角」）。
  /** 容器样式：① 放大时冻高度（下面那段历史注释说的锚点问题）；② 把**坐标带占整块棋盘的比例**
   *  交给 CSS —— 「思考中」浮标用它把自身高度收进坐标带里，而不是写死 22px。
   *  写死的版本在小屏越线：360×640 棋盘 292px 高、带子只有 17.4px，22px 的浮标压进第一行 5.6px；
   *  844×390 越 7.7px（右下角那一档同样越，只是它压的是最后一行）——用户 10-13 要的就是"不占棋盘"。 */
  const boardScrollerStyle = {
    "--board-axis-band-frac": (margin / 572).toFixed(4),
    ...(boardZoomed ? { maxHeight: frozenScrollerHeight ? `${frozenScrollerHeight}px` : "max(260px, calc(100dvh - 300px))" } : {}),
  } as React.CSSProperties;
  /**
   * 静态棋盘层（棋子）：单独 memo（2026-10-15）。
   *
   * 为什么：引擎思考期间每 ~100ms 推一次分析，父组件重渲染时**棋子这棵子树内容根本没变**，
   * 却每次都跟着重建（百子盘金钻棋子 ≈700+ 元素/次；缩放那轮量到单次重渲染 200–500ms）。
   * 用户看到的「引擎计算时一闪一闪」就是这条：memo 之后分析 tick 只重画叠层（候选点/预览）。
   *
   * 依赖用**内容签名**而不是一串对象引用（`numbers` 每次渲染都是新 Map、`motion` 同理），
   * 并且**刻意宁可多列**：多列只是多重建一次，漏列才会出现「棋子不更新」那种更难查的 bug。
   * 改动这几层的 JSX 时，**必须同时改这个签名**。
   */
  const staticBoardKey = JSON.stringify([
    board, current.move ?? null, [...winningStoneKeys].sort(),
    path.length, initialDepth, document.id, current.id,
    stoneTheme, matStone ?? null, stoneRadius, stoneScale, stoneOpacity,
    showNumbers, showLastMove, currentBookmarked, currentHasVisualMark, hasNativeAnnotation,
    annotationHighlight ?? null, feedback ?? null, result?.kind ?? null,
    motion ? `${motion.at ?? ""},${motion.kind ?? ""},${motion.version}` : "",
    placeEffect?.id ?? "", dropEffect?.id ?? "",
    rotation, mirrored, largeBoard, boardSize, margin, gap, gridLineWidth, coordinateFontSize, boardTheme,
  ]);
  const stoneLayer = useMemo(() => (
board.flatMap((row, rowIndex) => row.map((player, colIndex) => {
           if (!player) return null;
           const { x, y } = visualXY({ row: rowIndex, col: colIndex });
          const number = numbers.get(`${rowIndex},${colIndex}`), isLast = current.move?.row === rowIndex && current.move?.col === colIndex;
          const isWinningStone = winningStoneKeys.has(`${rowIndex},${colIndex}`);
           const jewelMaterial = stoneTheme === "gold-diamond" ? (player === "black" ? "diamond" : "gold") : stoneTheme;
           const stoneGradient = jewelMaterial === "classic" ? (player === "black" ? "blackStone" : "whiteStone") : `${player === "black" ? "blackStone" : "whiteStone"}-${jewelMaterial}`;
          const notebookRotation = ((rowIndex * 7 + colIndex * 11) % 9) - 4;
          /* 实验室材质的子：整段 markup 由数据里的 stone() 生成（它只认 x/y/r/player）。
             外面的 .stone-piece 外壳（缩放、透明度、胜利环、手数、当前手标记）照用本体的。 */
          const stoneGraphic = matStone
            ? <SvgHtml tag="g" className="material-stone" html={stoneMarkup(matStone, x, y, stoneRadius, player === "black" ? 1 : 2, isLast, isWinningStone)} />
            : stoneTheme === "notebook"
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
                     {/* 12 个面片走 <defs> 模板 + <use> 平移（元素数 18→7，见 defs 里的注释） */}
                     <use href={`#jewel-facets-${jewelMaterial === "gold" ? "gold" : "diamond"}`} transform={`translate(${x} ${y})`}/>
                     <circle cx={x} cy={y} r="7.5" fill="none" stroke={jewelMaterial === "gold" ? "#fff2be" : "#fff"} strokeWidth=".55" opacity=".3"/>
                     <path d={`M ${x - 11} ${y - 8} L ${x - 5} ${y - 12} M ${x + 9} ${y + 7} L ${x + 6} ${y + 11}`} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity=".85"/>
                   </g>
               : <circle cx={x} cy={y} r="15.6" fill={`url(#${stoneGradient})`} className={`stone ${player}`}/>;
          // 只有「这一次落子的那一枚」才挂进场类：isLast 只按落点判断，光标自己移动
          // （撤销 / 重做 / 回退 / 跳手）时它会指到已经在场上的老子，所以还要 motion.at
          // 对上当前节点。motion.version 参与 key，换手即重挂，动画必定重放。
          const motionHere = isLast && motion?.kind === "place" && motion.at === current.id;
          // 没有开「棋子进场」就**不播任何东西**，落子瞬间出现（用户 10-04：那个内置的 140ms 弹一下
          // 就是「看着卡」的来源，去掉；想要进场动效请在公用效果里打开「棋子进场」）。
          const motionClass = motionHere ? (dropEffect ? dropEffect.id : "") : "";
           const outlineOpacity = stoneTheme === "notebook" ? 0 : Math.max(0, (1 - stoneOpacity) * .72);
           return <g key={`stone-${rowIndex}-${colIndex}${motionHere ? `-${motion.version}` : ""}`} filter="url(#stoneShadow)" className={`stone-piece ${isWinningStone ? "winning-stone" : ""} ${motionClass}`}><g className="stone-body" transform={`translate(${x} ${y}) scale(${stoneScale}) translate(${-x} ${-y})`} style={{ opacity: stoneOpacity }}>{stoneGraphic}</g>{outlineOpacity > 0 && <circle cx={x} cy={y} r={stoneRadius + .1} className={`stone-visibility-outline ${player}`} style={{ opacity: outlineOpacity }}/>} {isWinningStone && <circle cx={x} cy={y} r={stoneRadius * 1.22} className="winning-stone-ring"/>}{showNumbers && <text x={x} y={y + stoneRadius * .28} className={`move-number ${player}${isLast && showLastMove ? " last-move-number" : ""}`} style={{ fontSize: `${Math.max(8, stoneRadius * .64) * moveNumberScale}px` }}>{number}</text>}{isLast && showLastMove && !showNumbers && !currentHasVisualMark && (stoneTheme === "notebook" ? <path d={`M ${x - stoneRadius * .45} ${y + stoneRadius * 1.08} Q ${x} ${y + stoneRadius * 1.28} ${x + stoneRadius * .52} ${y + stoneRadius * 1.02}`} className="notebook-last-mark"/> : <circle cx={x} cy={y} r={Math.max(3, stoneRadius * .25)} className="last-dot"/>)}{isLast && hasNativeAnnotation(current) && <g className="comment-indicator" aria-label="此步有注释"><path className="comment-bubble-tail" d={`M ${x + stoneRadius * .5} ${y + stoneRadius * .93} L ${x + stoneRadius * .43} ${y + stoneRadius * 1.15} L ${x + stoneRadius * .7} ${y + stoneRadius * .93} Z`}/><rect className="comment-bubble" x={x + stoneRadius * .33} y={y + stoneRadius * .48} width={stoneRadius * .74} height={stoneRadius * .48} rx={stoneRadius * .15}/><circle className="comment-dot" cx={x + stoneRadius * .52} cy={y + stoneRadius * .72} r={stoneRadius * .07}/><circle className="comment-dot" cx={x + stoneRadius * .7} cy={y + stoneRadius * .72} r={stoneRadius * .07}/><circle className="comment-dot" cx={x + stoneRadius * .88} cy={y + stoneRadius * .72} r={stoneRadius * .07}/></g>}{isLast && currentBookmarked && <g className="bookmark-indicator" aria-label="此局面已保存分支书签"><path d={`M ${x - stoneRadius} ${y - stoneRadius} h ${stoneRadius * .67} v ${stoneRadius * .8} l -${stoneRadius * .33} -${stoneRadius * .2} -${stoneRadius * .33} ${stoneRadius * .2} z`}/></g>}</g>;
        }))
  ), [staticBoardKey]);

  /**
   * 静态几何层（网格 / 星位 / 坐标）单独 memo（2026-10-15）：这三层的输入全是纯几何量，
   * 却在每次父组件重渲染时跟着重建（约 250 个元素/次）。引擎思考期间每 ~100ms 推一次分析，
   * 这些重建纯属浪费——用户报的「落子初期很容易闪、过一会就稳、再落子又闪」（更新越密越闪）
   * 要的就是少做这种无谓重建。**点击层（board-hit 225 格）故意不 memo**：它挂着长按/环形菜单/
   * 两段式落子那套交互逻辑、依赖面广，冻错了会「点不动」，风险不值得。
   * ⚠ 改这三层的 JSX 时必须同时改下面的签名。
   */
  const boardGeometryKey = JSON.stringify([
    boardSize, margin, gap, end, gridLineWidth, coordinateFontSize, showCoordinates,
    coordLayout.topY, coordLayout.bottomY, coordLayout.leftX, coordLayout.rightX,
    matLine?.stroke ?? "", matLine?.opacity ?? 0, matLine?.star ?? "", matLine?.starOpacity ?? 0,
    starPoints,
  ]);
  const gridLayer = useMemo(() => (Array.from({ length: boardSize }, (_, index) => <g key={index} className="grid-lines" style={matLine ? { strokeWidth: gridLineWidth, stroke: matLine.stroke, opacity: matLine.opacity } : { strokeWidth: gridLineWidth }}><line x1={margin} y1={margin + index * gap} x2={end} y2={margin + index * gap}/><line x1={margin + index * gap} y1={margin} x2={margin + index * gap} y2={end}/></g>)), [boardGeometryKey]);
  const starLayer = useMemo(() => (starPoints.map(([row, col]) => <circle key={`${row}-${col}`} cx={margin + col * gap} cy={margin + row * gap} r="4.2" className="star" style={matLine ? { fill: matLine.star, opacity: matLine.starOpacity } : undefined}/>)), [boardGeometryKey]);
  const coordinateLayer = useMemo(() => (showCoordinates && Array.from({ length: boardSize }, (_, index) => <g key={`coord-${index}`} className="coordinates"><text style={{ fontSize: coordinateFontSize }} x={margin + index * gap} y={coordLayout.topY}>{columnName(index)}</text><text style={{ fontSize: coordinateFontSize }} x={margin + index * gap} y={coordLayout.bottomY}>{columnName(index)}</text><text style={{ fontSize: coordinateFontSize }} x={coordLayout.leftX} y={margin + index * gap + 3}>{boardSize - index}</text><text style={{ fontSize: coordinateFontSize }} x={coordLayout.rightX} y={margin + index * gap + 3}>{boardSize - index}</text></g>)), [boardGeometryKey]);
  return (
    <div ref={boardScrollerRef} style={boardScrollerStyle} className={`board-scroller board-${boardTheme} stones-${stoneTheme} ${largeBoard ? "is-large" : ""} ${boardZoomed ? "is-zoomed" : ""}`.trim()} data-rotation={rotation} data-mirrored={mirrored ? "true" : "false"}>
      {boardScale > 1.01 && <button type="button" className="board-zoom-reset" onClick={resetScale} aria-label="重置棋盘缩放" title="重置棋盘缩放"><RotateCw size={14}/><span>{Math.round(boardScale * 100)}%</span></button>}
      <div ref={boardCanvasRef} className="board-canvas" style={{ width: `${Math.round(boardScale * 100)}%`, minWidth: `${Math.round(boardScale * 100)}%`, maxWidth: "none" }}>
       {separateMaterialSurface && matBoard && <BoardMaterialSurface material={matBoard} boardSize={boardSize} margin={margin} gap={gap} opacity={boardOpacity} />}
       <svg id="board" ref={boardRef} className="renju-board" viewBox="0 0 572 572" role="grid" aria-label={`${boardSize}路五子棋棋盘`} style={{ width: "100%", minWidth: "100%", maxWidth: "none", ...(gestureTouchAction ? { touchAction: gestureTouchAction } : {}) }} onPointerDownCapture={(event) => { applyGestureTouch(event, "down"); }} onPointerMoveCapture={(event) => { applyGestureTouch(event, "move"); }} onPointerUpCapture={(event) => { applyGestureTouch(event, "up"); }} onPointerCancelCapture={(event) => { applyGestureTouch(event, "cancel"); }}>
        <defs>
          <radialGradient id="blackStone" cx="30%" cy="24%"><stop offset="0" stopColor="#5b5a55"/><stop offset=".42" stopColor="#242420"/><stop offset="1" stopColor="#090a09"/></radialGradient>
          <radialGradient id="whiteStone" cx="30%" cy="24%"><stop offset="0" stopColor="#fffef8"/><stop offset=".6" stopColor="#e8e2d5"/><stop offset="1" stopColor="#aaa397"/></radialGradient>
          <radialGradient id="blackStone-jade" cx="30%" cy="24%"><stop offset="0" stopColor="#6ba98a"/><stop offset=".45" stopColor="#1f5943"/><stop offset="1" stopColor="#0e2b22"/></radialGradient>
          <radialGradient id="whiteStone-jade" cx="30%" cy="24%"><stop offset="0" stopColor="#f8fffb"/><stop offset=".55" stopColor="#b8dfcd"/><stop offset="1" stopColor="#6fa88d"/></radialGradient>
          {/* 金/钻棋子的 12 个面片（2026-10-15）：原来每颗子各画 12 个 polygon（实测每颗 18 个元素、
              百子盘每次重渲染要重建 ~2500 个元素，引擎每 100ms 推一次分析就卡一次 → 「一闪一闪」）。
              这些面片的几何与透明度对**同材质的每颗子逐值相同**，所以抽成一份 `<defs>` 模板、
              每颗子用 `<use>` 平移引用：元素数 18 → 7，像素结果不变（改完用棋盘像素指纹逐位比对过）。
              注意模板以**原点为中心**（面片点用 cos/sin 偏移），位置通过 `<use transform="translate(x y)">`
              施加 —— 与原来「在绝对坐标上算点」数学等价。 */}
          <g id="jewel-facets-gold">
            {Array.from({ length: 12 }, (_, facet) => {
              const a = facet * Math.PI / 6, b = (facet + 1) * Math.PI / 6;
              const pt = (angle: number, radius: number) => `${(Math.cos(angle) * radius).toFixed(3)},${(Math.sin(angle) * radius).toFixed(3)}`;
              return <polygon key={facet} points={`${pt(a, 14.6)} ${pt(b, 14.6)} ${pt(b, 7.5)} ${pt(a, 7.5)}`} fill={facet % 3 === 0 ? "#fff" : facet % 3 === 1 ? "#71450c" : "#fff0ad"} opacity={[.48, .27, .16, .1, .3, .45, .22, .12, .4, .2, .12, .5][facet]}/>;
            })}
          </g>
          <g id="jewel-facets-diamond">
            {Array.from({ length: 12 }, (_, facet) => {
              const a = facet * Math.PI / 6, b = (facet + 1) * Math.PI / 6;
              const pt = (angle: number, radius: number) => `${(Math.cos(angle) * radius).toFixed(3)},${(Math.sin(angle) * radius).toFixed(3)}`;
              return <polygon key={facet} points={`${pt(a, 14.6)} ${pt(b, 14.6)} ${pt(b, 7.5)} ${pt(a, 7.5)}`} fill={facet % 3 === 0 ? "#fff" : facet % 3 === 1 ? "#233344" : "#d9edfa"} opacity={[.48, .27, .16, .1, .3, .45, .22, .12, .4, .2, .12, .5][facet]}/>;
            })}
          </g>
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
        {matBoard
          /* 材质自带盘底色，所以不再画 .board-bg —— 那块的本体 CSS 规则会给它上色，
             两条一起用就是"数据被 CSS 悄悄盖掉"那个坑。 */
          ? <>
              {!separateMaterialSurface && <SvgHtml tag="g" className="board-material" style={{ opacity: boardOpacity }} html={boardLayers(matBoard, boardSize, margin, gap)} />}
            </>
          : <rect x="4" y="4" width="564" height="564" rx="18" className="board-bg" style={{ opacity: boardOpacity }} />}
        {/* 材质的子半边也要自己的 defs（渐变/滤镜）和动效 CSS —— 它们和盘半边是
            两条独立的路：盘可能是本体老 CSS、子是实验室新材质，反之亦然。 */}
        {matStone && <>
          {!!matStone.defs && <SvgHtml tag="defs" html={matStone.defs} />}
        </>}
        {boardTheme === "pale" && <rect x="4" y="4" width="564" height="564" rx="18" fill="url(#paleStrata)" opacity={boardOpacity} pointerEvents="none"/>}
        {openingStage?.kind === "place" && openingStage.radius !== null && (() => {
          const center = Math.floor(boardSize / 2), start = center - openingStage.radius, cells = openingStage.radius * 2;
          return <rect x={margin + start * gap - gap / 2} y={margin + start * gap - gap / 2} width={(cells + 1) * gap} height={(cells + 1) * gap} rx="10" className="opening-region" aria-label={`第${openingStage.moveNumber}手允许落子区域`}/>;
        })()}
        {boardTheme === "notebook" && <line x1="57" y1="8" x2="57" y2="564" className="notebook-margin-line" aria-hidden="true"/>}
        {gridLayer}
        {starLayer}
        {coordinateLayer}
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
               ? (isNativeRenLib ? formatRenLibWebLabel(node.boardText, depthOf(document, current.id)) : node.boardText || "")
               : display?.displayText || "";
           const hasText = Boolean(text);
           const hasUserMark = !isNativeLabel && userDisplayMarks.some((mark) => mark.row === point.row && mark.col === point.col);
           return <g key={`variation-${node.id}`} className={`renlib-variation ${player} ${isNativeLabel ? "renlib-native-variation" : display?.displayKind || "neutral-dot"}`} data-node-id={node.id} aria-label={`变化点 ${coordinateName(point, boardSize)}`} filter={markHighlightFilter && (hasText || node.renLibMark) ? markHighlightFilter : undefined}>
             {!hasText && !hasUserMark && !hasDisplayMark && <circle cx={x} cy={y} r="7" className="renlib-variation-dot"/>}
             {node.renLibMark && !hasText && !hasUserMark && !hasDisplayMark && <circle cx={x} cy={y} r="11" className="renlib-explicit-mark"/>}
             {hasText && <text x={x} y={y} className={`renlib-variation-label ${isNativeLabel ? "renlib-native-label" : ""} ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`} style={isNativeLabel ? { fill: "#1d1c19" } : undefined}>{text}</text>}
           </g>;
         })}
         {stoneLayer}
         {/* 打标角标（用户 10-01 新增：环形菜单标注页的三档评价）。读的是当前可见路径上
             每一手的 evaluation，所以前进后退、切变化都跟着走；三档之外的旧数据（IT/study 等）
             不画，避免在盘上出现没教过的符号。 */}
         {path.filter((node) => node.move && (node.evaluation === "good" || node.evaluation === "bad" || node.evaluation === "doubtful")).map((node) => {
           const point = node.move!;
           const { x, y } = visualXY(point);
           const radius = Math.max(5.5, stoneRadius * .44);
           const cx = x + stoneRadius * .84, cy = y - stoneRadius * .84;
           return <g key={`evaluation-${node.id}`} className={`evaluation-mark ${node.evaluation}`} aria-label={`${coordinateName(point, boardSize)} 标为${evaluationLabel(node.evaluation)}`}>
             <circle cx={cx} cy={cy} r={radius}/>
             <text x={cx} y={cy + radius * .62} style={{ fontSize: `${radius * 1.45}px` }}>{node.evaluation === "good" ? "+" : node.evaluation === "bad" ? "－" : "?"}</text>
           </g>;
        })}
         {current.renLibMark && (current.move || current.anchor) && !displayMarkKeys.has(currentPointKey) && (() => {
           const point = current.move || current.anchor!;
           const { x, y } = visualXY(point);
          return <circle cx={x} cy={y} r="11" className="renlib-explicit-mark" filter={markHighlightFilter}/>;
        })()}
         {openingCandidates.map((point, index) => {
           const { x, y } = visualXY(point);
          return <g key={`opening-candidate-${point.row}-${point.col}`} className="opening-candidate" aria-label={`第5手打点 A${index + 1}`}><circle className="opening-candidate-glow" cx={x} cy={y} r={stoneRadius * 1.22}/><circle className="opening-candidate-stone" cx={x} cy={y} r={stoneRadius}/><text x={x} y={y + stoneRadius * .2}>A{index + 1}</text></g>;
        })}
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
           // 原生标注（外来棋谱的盘面文字，如九天指南的「九天」）也走 MarkShape，
           // 与对局软件的形制一致：浅色底圆盘 + 文字（圆盘盖住交叉点上的网格线）。
           const labelClass = `renlib-variation-label renlib-native-label ${text.length <= 1 ? "renlib-text-single" : text.length === 2 ? "renlib-text-double" : "renlib-text-compact"}`;
           return <g key={`native-mark-${index}`} data-board-mark="native" transform={`translate(${x} ${y})`}>
             <text x={0} y={0} className={labelClass} style={{ fill: "#1d1c19" }}>{text}</text>
           </g>;
         })}
         {userDisplayMarks.map((mark, index) => {
           const { x, y } = visualXY(mark);
           const style = styleForMark(mark);
           const color = mark.color || "#1d1c19";
           const label = mark.label || "";
           const textLength = Array.from(label).length;
           // 用户标注与原生标注同一视觉规格（粗大、居中，用户 09-10 钦定），但**不能带
           // `renlib-native-label` 这个类**：那条 CSS 是 `fill:var(--renlib-native-label)!important`
           // （= 墨黑），`!important` 连内联样式都压得住 —— 于是用户选的颜色对**文字类**标注
           // 永远不生效（图形类不带这个类所以正常）。这正是用户 09-17 报的「切换颜色不生效」。
           // 改带 `renlib-user-label`：与原生同字体、同字重、**同样不带白色描边**，只有颜色听用户的。
           // （`.renlib-variation-label` 自带的 3px 白描边是给变化说明护底的；去掉 native 类之后
           //  它会跟着回来 → 用户看到的就是「我的标注有高亮」，09-17 报的第二个问题。）
           const labelClass = `renlib-variation-label renlib-user-label ${textLength <= 1 ? "renlib-text-single" : textLength === 2 ? "renlib-text-double" : "renlib-text-compact"}`;
           // 形状一律走 MarkShape（与面板预览同一份几何）。以前这里的 else 分支把
           // 圆圈/三角也画成两条交叉线，选「圆圈」在棋盘上却显示成叉。
           // 半径跟棋子走，缩放/换路数时标注与棋子比例保持一致。
           // chip：浅色底圆盘（盖住网格线 + 给颜色一层固定底色，任何主题都读得清）。
           // data-board-mark：棋盘标注的稳定钩子。glyph 本身没有 class（几何全在 MarkShape 里），
           // 门禁原来按 `.board-mark` 数标注，那个类早已不再挂在棋盘 glyph 上——于是「长按标注」
           // 这条断言数到 0 变假红（09-17 全量回归扫到）。给个 data-* 钩子，别再靠类名猜。
           return <g key={index} data-board-mark="user" transform={`translate(${x} ${y})`}>
             <MarkShape style={style} color={color} r={stoneRadius * 1.18} label={label} labelClassName={labelClass} strokeWidth={2.5}/>
           </g>;
         })}
         </g>
         {pendingLive && pendingPoint && <circle className="board-pending-ring" {...(() => { const { x, y } = visualXY(pendingPoint); return { cx: x, cy: y }; })()} r={stoneRadius * 0.94} pointerEvents="none" aria-hidden="true" data-board-pending="1"/>}
         {Array.from({ length: boardSize }, (_, row) => Array.from({ length: boardSize }, (_, col) => {
           const point = { row, col };
           const variation = variationNodeByPoint.get(`${row},${col}`);
            const { x, y } = visualXY(point);
            const forbiddenReasonText = forbiddenByPoint.get(`${row},${col}`);
            const forbiddenGlyph = forbiddenReasonText ? (forbiddenReasonText.includes("三三") ? "三" : forbiddenReasonText.includes("四四") ? "四" : "长") : null;
            return <g key={`cell-${row}-${col}`}>
             {forbiddenGlyph && !board[row][col] && <g pointerEvents="none"><circle cx={x} cy={y} r={stoneRadius * 0.66} className="forbidden-point" fill="none"/><text x={x} y={y + stoneRadius * 0.2} textAnchor="middle" className="forbidden-point-label" style={{ fontSize: `${Math.max(9, stoneRadius * 0.5)}px`, fill: "var(--red)", fontWeight: 700 }} stroke="none">{forbiddenGlyph}</text></g>}
             <circle key={`hit-${row}-${col}`} cx={x} cy={y} r={stoneHitRadiusFor(gap, stoneSize)} className="board-hit" role="gridcell" aria-disabled={disabled} aria-label={variation ? `切换到变化 ${coordinateName(point, boardSize)}` : `${coordinateName(point, boardSize)}${board[row][col] ? "已有棋子" : forbiddenByPoint.get(`${row},${col}`) || "空位"}`} onPointerDown={(event) => { if (disabled || isTouchGestureBlocked()) return; lastPointerX.current = event.clientX; lastPointerY.current = event.clientY; const hasStone = Boolean(board[row][col]); longPressTimer.current = window.setTimeout(() => { if (isTouchGestureBlocked()) return; suppressedClickPoint.current = point; // 长按已有棋子=呼出环形菜单（用户 09-17 第二批①）；空位长按仍是老规矩=加标注。
 if (shouldOpenRadialMenu({ enabled: radialMenuEnabled, hasHandler: Boolean(onRadialMenu), source: "longPress", hasStone }) && onRadialMenu) { onRadialMenu(point, lastPointerX.current, lastPointerY.current); return; }
 onMark(point); }, 520); }} onPointerUp={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerCancel={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerLeave={() => { if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; } }} onPointerMove={(event) => { lastPointerX.current = event.clientX; lastPointerY.current = event.clientY; }} onClick={() => { if (disabled || isTouchGestureBlocked()) return; if (suppressedClickPoint.current?.row === row && suppressedClickPoint.current.col === col) { suppressedClickPoint.current = null; return; } suppressedClickPoint.current = null; if (variation && onVariation) onVariation(variation.id); else if (confirmPlacement && !board[row][col]) {
             /* 两段式落子（设置「点击确认落子」）：第一下只把圈放到这儿，第二下点**同一格**才落子；
                点别的空位是把圈挪过去，不是落子。已有子的格子、变化分支、标注与长按都不走这条。 */
             if (pendingLive && pendingPoint?.row === row && pendingPoint?.col === col) { setPendingPoint(null); onPlay(point); } else setPendingPoint(point);
           } else onPlay(point); }} onContextMenu={(event) => { event.preventDefault(); if (disabled) return; // 右键呼出环形菜单（用户 09-17 第二批①）；开关关闭时回落老行为=加标注。
 if (onStepBack?.()) return; // 右键＝回退一步（用户 09-26）：能回退的盘面优先回退，处理不了才轮到下面的环形菜单/加标注。
 if (shouldOpenRadialMenu({ enabled: radialMenuEnabled, hasHandler: Boolean(onRadialMenu), source: "contextMenu", hasStone: Boolean(board[row][col]) }) && onRadialMenu) { onRadialMenu(point, event.clientX, event.clientY); return; }
 onMark(point); }}/>
            </g>;
          }))}
       </svg>
       {/* 引擎候选点与变化预览是高频更新的视觉层。单独放在 SVG 上，避免每一帧
           修改主棋盘 SVG 后让 Android WebView 重新光栅化网格、棋子和材质；
           pointer-events 由 CSS 穿透，不影响主棋盘的落子命中层。 */}
       <BoardAnalysisSurface
         board={board}
         boardSize={boardSize}
         stoneRadius={stoneRadius}
         visualXY={visualXY}
         analysisCandidates={analysisCandidates}
         analysisContextKey={analysisContextKey}
         analysisCandidateMetric={analysisCandidateMetric}
         analysisCandidateDecimals={analysisCandidateDecimals}
         analysisShowCandidates={analysisShowCandidates}
         analysisPreviewLine={analysisPreviewLine}
         analysisPreviewSelection={analysisPreviewSelection}
         analysisPreviewGuide={analysisPreviewGuide}
         openingCandidates={openingCandidates}
       />
      </div>
       {/* 常驻这个绝对定位节点，启动引擎时只切换可见性，避免 WebView 因插入节点而重绘整块棋盘。 */}
       <button type="button" data-active={thinking ? "true" : "false"} className={`board-thinking-indicator ${thinkingIndicatorPosition}`} onClick={onStopThinking} role="status" aria-live="polite" aria-hidden={thinking ? undefined : "true"} tabIndex={thinking ? 0 : -1} aria-label="停止思考" title="点击停止思考"><span className="thinking-swap" aria-hidden="true"><i className="s-black"/><i className="s-white"/></span><span>思考中</span></button>
      {result && !resultDismissed && <div className={`game-result-banner ${result.kind}`} role="status" aria-live="polite"><span>{result.kind === "draw" ? "和" : result.kind === "lost" ? "负" : "胜"}</span><b>{result.label}</b>{result.kind !== "draw" && onReview && <button type="button" className="game-result-review" onClick={onReview} aria-label="复盘本局" title="存档并整局复盘：逐手评估、找败着">复盘本局</button>}<button type="button" className="game-result-dismiss" onClick={() => setResultDismissed(true)} aria-label="关闭结果提示" title="关闭"><X/></button></div>}
    </div>
  );
});

/**
 * 识谱增强包（2026-10-07，内置）：cell-cls 逐格补位（找漏子）+ 长头数字头读号。
 * 两个模型与 onnxruntime wasm 都随应用分发（public/models、public/ort），点「复原手序-本地」
 * 即用、零下载。懒加载一次并缓存 Promise；任何失败（模型缺失/推理环境不支持）
 * 都返回 null 由识别器静默回落模板匹配——与「多核加速」同一纪律。
 */
let recognitionEnhancementPromise: Promise<{ digitReader: DigitReader | null; boardScanner: BoardScanner | null }> | null = null;
const loadRecognitionEnhancement = () => {
  if (!recognitionEnhancementPromise) {
    recognitionEnhancementPromise = (async () => {
      try {
        const { createDigitHeadReader, createBoardScanner, DIGIT_HEAD_MODEL_URL, CELL_CLS_MODEL_URL } = await import("./features/record/digit-head");
        const [digitReader, boardScanner] = await Promise.all([
          // 线程数交回默认（loadOrt 内部：有跨源隔离就 4 线程，否则老实单线程）。
          // 2026-10-07 修：此前生产构建下 ORT 只 emit 了 .wasm、缺线程加载器 .mjs →
          // 多线程静默失效；现在运行时三件套都在 public/ort，dev 与构建一致。
          createDigitHeadReader({ modelUrl: DIGIT_HEAD_MODEL_URL }),
          createBoardScanner({ modelUrl: CELL_CLS_MODEL_URL, digitModelUrl: DIGIT_HEAD_MODEL_URL }),
        ]);
        return { digitReader, boardScanner };
      } catch (error) {
        // 静默降级（功能回落模板匹配），但留一条日志便于排查「为什么某台设备上增强没生效」。
        console.warn("[识谱增强] 加载失败，已回落模板匹配：", error);
        return { digitReader: null, boardScanner: null };
      }
    })();
  }
  return recognitionEnhancementPromise;
};

/** 折叠按钮的四档说明（用户 10-07 的四级递进）：文案说的是**按下去会发生什么**。
 *  0 未折叠 → 1 压缩顶部 → 2 再收状态栏 → 3 再收金刚页 → 再按回到 0。 */
const CHROME_LEVEL_LABELS = [
  "收起：把顶栏压成一条（第一档）",
  "再收起状态栏（第二档）",
  "再收起底部导航（第三档）",
  "展开全部，回到初始（第四档）",
] as const;

/** 第四档图标：三道下箭头（lucide 只到双箭头 ChevronsDown，这里是手写的同风格 SVG）。 */
function TripleChevronDown({ size = 17 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m7 2 5 5 5-5"/><path d="m7 9 5 5 5-5"/><path d="m7 16 5 5 5-5"/>
  </svg>;
}

/** 识谱增强包的空闲预热（2026-10-07）：模型与 ORT 的首次装载约 1–1.2 秒，原来全压
 *  在用户第一次导入上（点「识别」后先等装载再开始算）。这里在页面空闲时提前装载，
 *  失败也无所谓——导入时还会再试一次（loadRecognitionEnhancement 内部自缓存 Promise）。
 *  两个闸门：① 只在「识谱多核加速」开着时预热（关掉多核的用户不在乎这点预备时间，
 *  而且预热会常驻一份主线程 ORT 会话，约 20MB）；② 只在非首次启动预热（首次启动的
 *  用户多半先看界面/引导，不该为一个可能用不上的功能先吃内存）。 */
function useRecognitionPrewarm(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    try {
      if (localStorage.getItem("banbu-first-run-welcome-v1") !== "true") return;
    } catch {
      return;
    }
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    const warm = () => { void loadRecognitionEnhancement(); };
    const requestIdle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (requestIdle) idleHandle = requestIdle(warm, { timeout: 6000 });
    else timeoutHandle = window.setTimeout(warm, 4000);
    return () => {
      const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
      if (idleHandle !== null && cancelIdle) cancelIdle(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [enabled]);
}

export default function App() {
  // Diagnostic switch for the top-level ErrorBoundary: set
  // globalThis.__banbuForceRenderError = true (e.g. via Playwright addInitScript)
  // to verify the crash card without shipping a debug UI.
  if (import.meta.env.DEV && (globalThis as { __banbuForceRenderError?: boolean }).__banbuForceRenderError) throw new Error("人为注入的渲染异常（ErrorBoundary 验收）");
  const [initialSession] = useState<LastSessionState | null>(() => loadLastSession());
  const [restoreLastPosition, setRestoreLastPosition] = useState(loadRestoreLastPosition);
  const [welcomeOpen, setWelcomeOpen] = useState(shouldShowFirstRunWelcome);
  /** 关于面板打开时落在哪个视图（首运行弹窗的「本版本更新了什么」会直接开到 notes）。 */
  const [aboutInitialView, setAboutInitialView] = useState<AboutView>("main");
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
  // Generation can finish while native collections are still loading. Keep a
  // current mirror so saving a batch never falls back to the pre-native local
  // storage snapshot and replaces the in-memory native collections.
  const puzzleCollectionsRef = useRef(puzzleCollections);
  puzzleCollectionsRef.current = puzzleCollections;
  const [puzzleProgress, setPuzzleProgress] = useState(loadPuzzleProgress);
  // 每日一题 + 打卡 + 错题间隔重温（用户 2026-09-17）：选题与排期都在
  // features/puzzles/daily-training.ts 里做纯计算，这里只持有状态。
  const [dailyTraining, setDailyTraining] = useState<DailyTrainingState>(loadDailyTraining);
  // 当前题会话是否已记录过一次尝试（用户 2026-09-10：点开一题落子即进「最近棋题」；
  // 同题会话只记一次，避免每次落子都 +1；openPuzzle 时重置）。
  const puzzleAttemptRecordedRef = useRef(false);
  // 本次做题的开始时刻（openPuzzle 时重置）：终局时算用时，写进覆盖层供管理区显示。
  const puzzleOpenedAtRef = useRef<number>(0);
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
  /** 上次对弈的会话快照（用户 09-28：退出后再点「人机对战」要问是否回到上次对局）。 */
  const [duelResume, setDuelResume] = useState<DuelSessionSnapshot | null>(null);
  // 比赛棋钟（用户 09-23）：**独立的纯计时器**。与棋盘、与人机对局毫无关系——
  // 两个人用真实棋盘棋子下棋，把设备摆在旁边当钟。所以它占满整屏、里面只有钟与控制，
  // 没有棋盘（详见 DuelClockPanel 顶部注释）。
  const [clockOpen, setClockOpen] = useState(false);
  const [clockSettings, setClockSettings] = useState<ClockSettings>(loadClockSettings);
  const [aiRuleFamily, setAiRuleFamily] = useState<AiRuleMode>("freestyle");
  /**
   * 「自定义开局」开关（用户 2026-10-13：先选有禁无禁 → 自己摆棋子 → 随时点「开始」进对局，
   * 这一局不给棋魂）。
   *
   * ⚠ 它**不是** `AI_RULE_PRESET_GUIDES` 的第 12 条：那张表是"开局流程预设"（swap2、五手两打…），
   *   而自定义开局是"不要流程、局面由人摆"，硬塞进去会让 `selectedAiRule` 的反查
   *   （按 rule + openingRule 两个维度找）与 `rule-guide-data.test.ts` 的精确数组比较全乱。
   *   有禁/无禁仍然走原来的 `aiRuleFamily`（这正是"先选有禁无禁"的落点）。
   */
  const [aiCustomOpening, setAiCustomOpening] = useState(false);
  /**
   * 摆子阶段的「局面库」（用户 2026-10-14：「很多时候会专门挑战一些固定开局，保存下来下次直接拿来用」）。
   * 只在摆子界面用；每次存/删/改名都从存储重读一遍（这份表很小，不做乐观更新，省一类不一致）。
   */
  const [duelSetups, setDuelSetups] = useState<DuelSetupEntry[]>(() => loadDuelSetups());
  /** 局面库里正在改名的那一条（id）与输入框草稿——就地改，不弹第二层浮层。 */
  const [duelSetupRenaming, setDuelSetupRenaming] = useState<string | null>(null);
  const [duelSetupNameDraft, setDuelSetupNameDraft] = useState("");
  /** 「载入」浮层开在哪一层：菜单（棋谱库 / 题库两行）→ 对应那个选择器。 */
  const [duelLoad, setDuelLoad] = useState<"off" | "record" | "puzzle">("off");
  const [aiHumanPlayer, setAiHumanPlayer] = useState<Player>("black");
  const [aiStrength, setAiStrength] = useState<AiStrength>("初级");
  const [aiEngineChoice, setAiEngineChoice] = useState<AiEngineChoice>(loadAiEngineChoice);
  // 横屏顶部折叠（用户 10-04：「状态栏和最上面那一行也占空间，出个折叠按钮，折叠后上面
  // 变成一行按钮，点一下又恢复」）。只记本次会话、不写盘：折叠是当下看盘的习惯，
  // 下次横屏默认还是全展开，免得哪天布局改了老用户被自己的历史选择卡住。
  const landscapeViewport = useMediaQuery("(orientation: landscape)");
  // 「双栏且高度装得下」才把走棋区挪到棋盘下面：844×390 那种矮横屏物理上放不下
  // 「大棋盘 + 顶栏 + 走棋区」在一屏里（实测棋盘 214 时走棋区底边到 406 > 390），
  // 那种情况仍留在右栏原位，靠折叠按钮腾高度。
  const wideSplitViewport = useMediaQuery("(orientation: landscape) and (min-width: 640px) and (min-height: 600px)");
  // 顶栏折叠按钮的四档（用户 10-07：「做四种状态…每个状态的图标都不一样，
  // 第一个是收起状态，第二个是你之前就有的一个下滑箭，第三个会是两个下划箭，第四个是三个下滑箭」）：
  //   0 = 全部显示（图标：收起＝上箭头）
  //   1 = 压缩顶部：顶栏压成一条紧凑工具条，状态栏、金刚页照旧（图标：一道下箭头）
  //   2 = 再收状态栏：连状态栏及以上一起收（图标：两道下箭头）
  //   3 = 再收金刚页：底部导航（横屏是右缘竖条）也滑出屏幕（图标：三道下箭头）；再点回到 0 全展开
  // 三个派生标志分别挂成外壳类名，CSS 按级叠加（.chrome-compact ⊂ .chrome-collapsed ⊂ .chrome-nav-off）。
  const [chromeLevel, setChromeLevel] = useState(0);
  const chromeCompact = chromeLevel >= 1;
  const chromeStatusHidden = chromeLevel >= 2;
  const chromeNavOff = chromeLevel >= 3;
  // 引擎包下载意图：未装包时点「强力/自调」触发下载，下载完成的自动切档
  // 必须遵循用户点击的档位（否则选自调会被劫持成强力）。
  const engineDownloadIntentRef = useRef<"strong" | "tuned" | null>(null);
  // 自调内存输入框（非受控，读 DOM 提交；滑杆拖动用 ref 同步显示）。
  // 内存数值输入框已并入「可拖可读」的单一控件（用户 09-19），不再需要它的 ref。
  const [enginePackState, setEnginePackState] = useState<EnginePackState | null>(() => enginePackSnapshot().state);
  const [enginePackReady, setEnginePackReady] = useState(() => Boolean(enginePackSnapshot().objectUrl));
  // 安卓原生引擎就绪（探测到随包可执行文件 + 权重铺好）。它对 UI 与门禁的语义等价于
  // 「rapfi 可用」：不再需要下载 40MB 的 wasm 引擎包。
  const [nativeEngineReady, setNativeEngineReady] = useState(false);
  // 探测是否已完成。预热必须等它——worker 一旦按 wasm 加载了引擎，本次生命周期内不会
  // 再换成原生（load() 见到 engine 就返回），留了强力档的老用户会在启动预热时踩到。
  const [nativeProbed, setNativeProbed] = useState(false);
  // KataGo 旗舰引擎探测结果（reactive：设置页开关的可用性跟着它走）
  const [kataEngineReady, setKataEngineReady] = useState(nativeKataGoInfo()?.available === true);
  // 旗舰档是否「真正生效」（选中 + 本机可用）：引擎相关的控件按它二选一显示——
  // rapfi 显示内存/多线程/线程数/DotProd，旗舰显示自己的线程/缓存（见 KataTuning）。
  const kataActive = aiEngineChoice === "kata" && kataEngineReady;
  // 引擎切换/冷启动的加载进度（kata：准备文件→起进程→加载网络→标定；100% 即就绪）
  const [engineLoad, setEngineLoad] = useState<EngineLoadState | null>(null);
  // 加载进度同时存一份 ref：错误处理里要**同步**判断「引擎是不是还在合法加载中」。
  // 旗舰冷启动要 ~6 秒（模型 3.4MB + ORT 初始化），加载期出现的 error 多半是
  // 瞬态噪音，此时绝不能对用户说「启动失败」（用户 09-26 报「每次 1 秒左右就说
  // 启动失败，我还以为真的失败了呢」）。state 在回调里是旧值，必须用 ref。
  const engineLoadRef = useRef<{ percent: number; label: string } | null>(null);
  useEffect(() => { engineLoadRef.current = engineLoad; }, [engineLoad]);
  // 引擎切换覆盖层与实际 worker 生命周期分开管理：选择器可以先更新，但只有
  // worker 回报加载完成/ready，覆盖层才会进入成功态，避免「选中」被误报成「可用」。
  const [engineSwitch, setEngineSwitch] = useState<EngineSwitchState | null>(null);
  const engineSwitchIdRef = useRef(0);
  const engineSwitchTargetRef = useRef<AiEngineChoice | null>(null);
  const engineSwitchStatusRef = useRef<EngineSwitchStatus | null>(null);
  const engineSwitchTimerRef = useRef<number | null>(null);
  const engineSwitchWatchdogRef = useRef<number | null>(null);
  /* 旗舰/云端切换时「备用引擎先就绪」的宽限计时器（见 handleEngineReadyEvent）：
     冷启动期间不许把备用引擎的 ready 当成切换失败。 */
  const engineSwitchFallbackTimerRef = useRef<number | null>(null);
  /** 本轮切换的发起时刻：settle 时算总耗时写进 kata_diag（真机排障用，见 kataDiag）。 */
  const engineSwitchStartRef = useRef(0);
  /** 切走旗舰后的「保留进程」宽限计时器（KATA_KEEPWARM_MS，见引擎互斥 effect）。 */
  const kataKeepWarmTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (engineSwitchTimerRef.current !== null) window.clearTimeout(engineSwitchTimerRef.current);
    if (engineSwitchWatchdogRef.current !== null) window.clearTimeout(engineSwitchWatchdogRef.current);
    if (engineSwitchFallbackTimerRef.current !== null) window.clearTimeout(engineSwitchFallbackTimerRef.current);
    if (kataKeepWarmTimerRef.current !== null) window.clearTimeout(kataKeepWarmTimerRef.current);
  }, []);
  const updateEngineSwitch = (patch: Partial<EngineSwitchState>) => {
    setEngineSwitch((current) => {
      if (!current || current.id !== engineSwitchIdRef.current) return current;
      if (current.status === "config" && patch.status === "loading") return current;
      // 进度不能覆盖最终结果，但当前切换的真实 ready 可以纠正超时判断。
      if ((current.status === "success" || current.status === "failure" || current.status === "same")
        && patch.status && patch.status !== current.status
        && !(current.status === "failure" && patch.status === "success")) return current;
      return { ...current, ...patch };
    });
  };

  /**
   * KataGo 起不来时的**选择**弹窗（2026-10-15 用户要求：「如果真的切换失败要换到 rapfi 兜底，
   * 可不可以先出一个提示弹窗让人选择，不要直接就调用了」）。
   *
   * 行为：把「已经用内置引擎继续本局」这件事**明确告诉用户**，并给两个按钮——
   * ① 重试切换：重新探测并启动 KataGo（会取消当前计算，让下一轮重新发起）；
   * ② 改用 rapfi：老老实实把档位切到 rapfi（界面随之更新，不再出现「显示 KataGo、跑的是 rapfi」）。
   * 注意**不自动切档位**：用户不选就保持现状（KataGo 档位不变，只是本局用内置引擎算完）。
   */
  const askEngineFallback = useCallback((error: string, options: { retry?: () => void; fallback?: () => void }) => {
    const id = ++engineSwitchIdRef.current;
    engineSwitchStatusRef.current = "failure";
    setEngineSwitch({
      id, from: "kata", to: "kata", channel: engineSwitchChannelFor("kata"),
      status: "failure", percent: 0, phase: "", error, canCancel: true,
      retryAction: options.retry, fallbackAction: options.fallback, fallbackLabel: "改用 rapfi 继续",
    });
  }, []);

  const settleEngineSwitch = (status: EngineSwitchStatus, patch: Partial<EngineSwitchState> = {}) => {
    if (!engineSwitchTargetRef.current) return;
    // 收到 ready 之后的搜索错误不能取消成功态的自动关闭计时器。
    if (engineSwitchStatusRef.current === "success" || engineSwitchStatusRef.current === "same") return;
    engineSwitchStatusRef.current = status;
    const id = engineSwitchIdRef.current;
    kataDiag(`switch: settle id=${id} status=${status} after ${Date.now() - engineSwitchStartRef.current}ms`);
    updateEngineSwitch({ status, ...patch });
    if (engineSwitchTimerRef.current !== null) window.clearTimeout(engineSwitchTimerRef.current);
    if (status === "success" || status === "failure" || status === "config" || status === "same") {
      if (engineSwitchFallbackTimerRef.current !== null) {
        window.clearTimeout(engineSwitchFallbackTimerRef.current);
        engineSwitchFallbackTimerRef.current = null;
      }
      if (engineSwitchWatchdogRef.current !== null) {
        window.clearTimeout(engineSwitchWatchdogRef.current);
        engineSwitchWatchdogRef.current = null;
      }
    }
    if (status === "config") engineSwitchTargetRef.current = null;
    if (status === "success" || status === "same") {
      engineSwitchTimerRef.current = window.setTimeout(() => {
        setEngineSwitch((current) => current?.id === id ? null : current);
        if (engineSwitchIdRef.current === id) engineSwitchTargetRef.current = null;
        engineSwitchTimerRef.current = null;
      }, 700);   // 成功态停留 0.7s（2026-10-07 真机实测后从 1.25s 收紧：引擎就绪本身只要 ~1.4s，收尾再拖 1.25s 让切换显得比实际慢）
    }
  };
  const armEngineSwitchWatchdog = (id: number, value: AiEngineChoice, phase: "loading" | "download" = "loading") => {
    if (engineSwitchWatchdogRef.current !== null) window.clearTimeout(engineSwitchWatchdogRef.current);
    // 下载/恢复阶段可能跨越一次网络重连，给它更长的窗口；无论哪条链路都
    // 必须有上限，避免选择器已经持久化成功而覆盖层永远停在 loading。
    // 上限按实测定：KataGo 热启动 1.4s，冷机/降频/内存紧张时用户实测可到四五十秒
    // （2026-10-08 用户：「目测我切换要四五十秒……加到 90 秒吧，反正要切换的」）。
    // 90s 给足余量且仍有明确上限；超时后给失败 + 重试按钮，不会无声干等。
    const waitMs = phase === "download" ? 120_000 : value === "kata" ? 90_000 : 35_000;
    engineSwitchWatchdogRef.current = window.setTimeout(() => {
      if (engineSwitchIdRef.current === id) settleEngineSwitch("failure", {
        error: phase === "download" ? "引擎资源准备超时" : "引擎就绪确认超时，可关闭此窗口后重试",
        canCancel: false,
      });
      engineSwitchWatchdogRef.current = null;
    }, waitMs);
  };
  const handleEngineLoadingEvent = (event: { engine?: string; percent?: number; label?: string; done?: boolean }) => {
    const target = engineSwitchTargetRef.current;
    if (target && ((target === "kata" && event.engine && event.engine !== "kata")
      || (target !== "kata" && event.engine === "kata")
      || (target === "ikatago" && event.engine && event.engine !== "ikatago")
      || (target !== "ikatago" && event.engine === "ikatago"))) return;
    const percent = Number(event.percent) || 0;
    setEngineLoad(event.done ? null : { percent, label: String(event.label || "") });
    if (!engineSwitchTargetRef.current) return;
    // done 也用于关闭失败加载进度，不能把它当成启动成功；只认 ready/有效结果。
    if (event.done) updateEngineSwitch({ percent, phase: String(event.label || "等待引擎就绪确认") });
    else updateEngineSwitch({ status: "loading", percent, phase: String(event.label || "正在准备引擎…") });
  };
  const handleEngineReadyEvent = (variant: string | undefined, requestedChoice: AiEngineChoice) => {
    if (!variant) return;
    const target = engineSwitchTargetRef.current;
    if (!target || target !== requestedChoice) return;
    const matches = target === "kata" ? variant === "kata" : target === "ikatago" ? variant === "ikatago" : variant !== "kata" && variant !== "ikatago";
    if (matches) {
      if (engineSwitchFallbackTimerRef.current !== null) {
        window.clearTimeout(engineSwitchFallbackTimerRef.current);
        engineSwitchFallbackTimerRef.current = null;
      }
      settleEngineSwitch("success", { percent: 100, phase: "引擎已经接管棋局" });
      return;
    }
    /* 目标是旗舰/云端、但先到的是**备用引擎**的 ready（旧档位残留，或旗舰还不具备条件时的兜底预热）。
       这时既不能说成功，也**不能立刻判失败**——KataGo 冷启动要 ~6 秒；真机上「切到 kata 先弹失败、
       过一会又能用」，就是被这一句提前宣告的（用户 10-06 报）。给一个宽限期：
       期间真目标就绪就走上面的 success 分支（并把这里的计时器清掉），宽限到期仍只有备用引擎才判失败。 */
    if ((target === "kata" || target === "ikatago") && variant !== "kata" && variant !== "ikatago") {
      updateEngineSwitch({ phase: `${aiEngineChoiceLabel(target)} 正在冷启动…`, percent: 100 });
      if (engineSwitchFallbackTimerRef.current !== null) window.clearTimeout(engineSwitchFallbackTimerRef.current);
      const id = engineSwitchIdRef.current;
      engineSwitchFallbackTimerRef.current = window.setTimeout(() => {
        engineSwitchFallbackTimerRef.current = null;
        if (engineSwitchIdRef.current !== id) return;
        if (engineSwitchStatusRef.current === "success" || engineSwitchStatusRef.current === "same") return;
        settleEngineSwitch("failure", {
          error: `${aiEngineChoiceLabel(target)} 未能就绪，当前已启用本机 Rapfi 备用引擎`, canCancel: false,
        });
      }, ENGINE_SWITCH_FALLBACK_GRACE_MS);
    }
  };
  /** 「rapfi 可用」= wasm 引擎包已装 或 本机原生引擎就绪。UI、预热、分析自动启动
   *  都看它——这样原生端不需要下载 40MB 的 wasm 引擎包。 */
  const strongEngineReady = enginePackReady || nativeEngineReady;
  /**
   * 这个档位**还缺引擎包**吗？原生就绪时必须返回 false（用户 09-15 报的 bug）：
   * 原生引擎用的是同一套 Rapfi 冠军权重，装了它再下 38.4MB 的 wasm 包毫无用处，
   * 而且「两个引擎包永不共存」是硬约束——原生就绪后应用还会主动释放旧 wasm 包
   * （见下面的 release-legacy-wasm effect）。旧代码只判 `!enginePackState`，于是
   * 安卓上点「rapfi」会弹「正在下载 rapfi 引擎包」、设置页显示未下载，用户完全
   * 分不清是降级了还是报错。
   */
  const enginePackMissingFor = (choice: AiEngineChoice) => engineNeedsPack(choice) && !enginePackState && !nativeEngineReady;

  const [enginePackDownloading, setEnginePackDownloading] = useState(false);
  // 人机界面这条入口以前不接进度回调，只有一句静态文字：47MB 的包下几分钟，
  // 用户完全看不出是在走还是卡住。改成和设置页一样吃 DownloadProgress。
  const [aiPackProgress, setAiPackProgress] = useState<{ receivedBytes: number; totalBytes: number } | null>(null);
  const [aiTimeLimitMs, setAiTimeLimitMs] = useState<AiTimeControl>(0);
  // 每手读秒（用户 09-17）：选择持久化，下次开局沿用。
  const [aiReadOffMs, setAiReadOffMs] = useState<number>(loadAiReadOffMs);
  useEffect(() => { try { localStorage.setItem(AI_READ_OFF_KEY, String(aiReadOffMs)); } catch { /* best-effort */ } }, [aiReadOffMs]);
  // 读秒的进行时：只在「活局 + 轮到你」累计；超时同样判负。
  const [aiMoveElapsedMs, setAiMoveElapsedMs] = useState(0);
  const aiMoveLastAt = useRef<number | null>(null);
  const aiReadOffExpired = useRef(false);
  // 整局复盘（用户 09-17 第一梯队①）：主线逐手评估 → 失误分档 → 曲线与讲解。
  // 运行器用独立 worker + 独立 controller，与持续分析 / 人机思考互斥。
  const [gameReview, setGameReview] = useState<GameReviewState>({ status: "idle" });
  // 分析面板的三个页签（用户 09-19，对标智子）：计算=原主面板；复盘=整局复盘；
  // 胜率=常态胜率图（分析缓存自动积累，复盘数据优先）。会话内记忆最后一次所在页签。
  const [analysisPanelTab, setAnalysisPanelTab] = useState<"compute" | "review" | "winrate">("compute");
  // 分析缓存写入计数（用户 09-19：「胜率图不是实时的」）：胜率图的数据一半来自分析缓存，
  // 而写缓存是 localStorage 操作、不触发 React 重算——原来只有等 viewDocument 变化（走下一手）
  // 才会把新点画上去，于是永远落后一手。写入即 bump，图表当场重算。
  const [analysisCacheVersion, setAnalysisCacheVersion] = useState(0);
  // 正在算的那一轮的读数镜像（用户 09-19「胜率图不是实时的」）：换手会 terminate 掉这一轮，
  // 结果消息根本不会回来，那一手在胜率图上就永远是空的。所以在 INFO 流里另存一份，
  // 离开局面时把它落进缓存。只会存「当前轮」的读数——stale 消息在 onmessage 开头就被 return 了。
  const liveAnalysisRef = useRef<{ contextKey: string; documentId: string; nodeId: string; mover: Player; winRate: number; depth: number; nodes: number; score?: number; scoreAvailable?: boolean; engine?: "rapfi" | "kata" | "ikatago" } | null>(null);
  const gameReviewWorkerRef = useRef<{ worker: Worker; controller: AiWorkerController } | null>(null);
  const gameReviewRunRef = useRef<GameReviewRun | null>(null);
  // 终局自动存档：一次对局只落一次盘（结局可被悔棋清空再来）。
  const aiGameSavedRef = useRef<string | null>(null);
  /**
   * 「这一份棋谱是一盘**还没被用户保存**的人机对局」——它的 id 存在这里。
   *
   * 为什么要这个标记：应用有一条通用规矩——打开/编辑过的棋谱会被自动写进棋谱库
   * （下面那个 450ms 的自动保存 effect）。对人机对局来说这条规矩与用户 09-28 的要求
   * 冲突（「用户如果不主动保存就不会进棋谱库」）：开局 450ms 后那盘棋就已经躺在库里了，
   * 于是「保存本局」按钮、终局面板的「已保存」、乃至「未保存的局留在上次对局里」全都失去意义。
   * 所以对局期间按 id 把这条自动写库挡掉，直到用户点「保存本局」（`commitAiGameRecord`）为止。
   */
  const duelUnsavedDocIdRef = useRef<string | null>(null);
  /** 本局为什么结束（终局面板要说清楚，不能只写「输了」）。
   *  用 ref 而不是塞进 AiGameState：它只是给界面看的一句话，不参与任何对局判定。 */
  const aiGameEndReason = useRef<string>("");
  /** 本进程已经记过账的局（防"终局→刷新→恢复→再结算"把一局算两次）。 */
  const duelRecordedRef = useRef<Set<string>>(new Set());
  /** 战绩账本（`banbu-duel-history-v1`）。面板上的所有数字都从它现算。 */
  const [duelHistory, setDuelHistory] = useState<DuelHistoryEntry[]>(() => loadDuelHistory());
  const [aiHumanElapsedMs, setAiHumanElapsedMs] = useState(0);
  const [aiFreeTimeMs, setAiFreeTimeMs] = useState(2500);
  const [aiFreeDepth, setAiFreeDepth] = useState(64);
  const [aiFreeUnlimited, setAiFreeUnlimited] = useState(false);
  const [aiOpeningRule, setAiOpeningRule] = useState<OpeningRule>("free");
  const [aiFloatPanel, setAiFloatPanel] = useState<AiFloatPanel>(null);
  const [aiOpeningN] = useState(3);
  const [dockPanel, setDockPanel] = useState<DockPanel>(null);
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useState(false);
  // 长按环形菜单（用户 09-17 第二批①）：记录呼出点的屏幕坐标与棋盘坐标。
  // 10-01 内环分页：page 记住当前是哪一页；每次呼出都回到「通用」（用户定的默认页）。
  const [radialMenu, setRadialMenu] = useState<{ x: number; y: number; position: Position; page: RadialMenuPageId } | null>(null);
  const [library, setLibrary] = useState(loadLibrary);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySection, setLibrarySection] = useState<LibraryTab>("records");
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
  // 题库改造（用户 2026-09-21）：覆盖层 / 隐藏题集 / 重做队列三个槽位各自独立，
  // 沿用 puzzleProgress 的「state + effect 落盘」写法（progress 就是这么做的）。
  const [puzzleOverlays, setPuzzleOverlays] = useState<PuzzleOverlays>(loadPuzzleOverlays);
  const [hiddenPuzzleCollectionIds, setHiddenPuzzleCollectionIds] = useState<string[]>(loadHiddenPuzzleCollections);
  const [puzzleReviewQueue, setPuzzleReviewQueue] = useState<PuzzleReviewQueue>(loadPuzzleReviewQueue);
  // 删除类操作的撤销：只留最近一次，任何一处新改动就作废（避免撤到「中间态」）。
  const puzzleUndoRef = useRef<{ collections: PuzzleCollection[]; label: string; folderAssignments: Record<string, string> } | null>(null);
  // 题目编辑浮层 / 合并 / 拆分的目标
  const [puzzleEditTarget, setPuzzleEditTarget] = useState<{ collectionId: string; puzzleId: string; title: string; prompt: string; difficulty: Puzzle["difficulty"]; player: Player; rule: "" | RuleSet } | null>(null);
  const [puzzleMergeOpen, setPuzzleMergeOpen] = useState(false);
  const [puzzleMergeDedupe, setPuzzleMergeDedupe] = useState(true);
  const [puzzleSplitTarget, setPuzzleSplitTarget] = useState<{ collectionId: string; title: string; total: number; from: string; to: string } | null>(null);
  const [puzzleAddTargetId, setPuzzleAddTargetId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("record");
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorInitial, setGeneratorInitial] = useState<GeneratedPuzzle | null>(null);
  const [vcfChallengeOpen, setVcfChallengeOpen] = useState(false);
  /* 系统返回递进「挑战页要退出了」的请求计数：VCF 页自己判要不要先弹确认。
     用计数而不是布尔：连续两次返回（第一次弹确认、第二次当继续挑战）都要能传达。 */
  const [vcfExitRequest, setVcfExitRequest] = useState(0);
  /**
   * 每日一题页（2026-10-11）。
   *
   * 与 VCF 挑战**同一个骨架**（独立全屏页 + 系统返回先递请求），保存的是
   * **这一局的题目定位**（题集/题目 id）而不是"算好的文档"：
   * 文档在页面挂载时按当前规则偏好建一次就够，而存定位能让"重做一遍 / 换规则"
   * 这类动作有地方可改（存文档字符串化反而更难维护）。
   */
  const [dailyOpen, setDailyOpen] = useState(false);
  const [dailySession, setDailySession] = useState<{ collectionId: string; puzzleId: string } | null>(null);
  const [dailyExitRequest, setDailyExitRequest] = useState(0);
  useEffect(() => {
    if (tab !== 'duel' && generatorOpen) { setGeneratorOpen(false); setGeneratorInitial(null); }
    /* VCF 挑战**不能**在离开「对弈」tab 时关掉（用户 2026-10-06：切到别的版面再回来
       直接退到对弈首页了）。它保持挂载、只在别的 tab 下隐藏：题目、局面、计时都不重建。 */
  }, [tab, generatorOpen]);
  const generatedPuzzles = useMemo(() => puzzleCollections.flatMap(collection => collection.puzzles.flatMap(puzzle =>
    generatedMatchesPuzzle(puzzle.generated, puzzle) ? [puzzle.generated] : [])), [puzzleCollections]);
  /**
   * 把一批生成题并进题库：合并 → 持久化 → 记文件夹归属。
   *
   * ⚠ **不带成就信号**，也不弹 toast —— 所以生成器保存与「导入证明 JSON」能共用它。
   * 分开的理由：生成器的成就写的是「用「棋题生成器」**造出**第 N 道题」
   * （`achievement-catalog.ts` 的 `puzzle-generator-shape` / `-text` 等读 `generatorKinds`），
   * 而**导入别人（或自己以前）的证明并不是"造"** —— 信号放在这里就等于
   * 把同一个文件反复导入可以刷出"生成图案题"那条成就。
   */
  const commitGeneratedPuzzles = (puzzles: GeneratedPuzzle[], folder: string) => {
    // 默认文件夹沿用固定集合 ID，老用户已保存的生成题不会搬家；换文件夹才另开集合，
    // 因为一个集合只能挂一个文件夹，否则后一次保存会把前一批一起搬走。
    const target = folder.trim() || GENERATED_DEFAULT_FOLDER;
    const generatedCollectionId = generatedCollectionIdForFolder(target);
    const collections = mergeGeneratedCollection(puzzleCollectionsRef.current, puzzles, generatedCollectionId,
      'VCF 生成题');
    puzzleCollectionsRef.current = collections;
    savePuzzleCollections(collections); setPuzzleCollections(collections);
    setLibraryFolders(folders => ({ ...folders,
      puzzleFolders: folders.puzzleFolders.includes(target) ? folders.puzzleFolders : [...folders.puzzleFolders, target],
      puzzleAssignments: { ...folders.puzzleAssignments, [generatedCollectionId]: target } }));
    return { target, count: puzzles.length };
  };
  const saveGeneratedPuzzles = (puzzles: GeneratedPuzzle[], _batchId: string, folder: string) => {
    const { target, count } = commitGeneratedPuzzles(puzzles, folder);
    // 成就：生成器产出（题型与最深手数都是信号位，账本里没有）。
    progress.signal({ generatorKinds: [...new Set(puzzles.map((item) => item.theme?.kind === 'shape' ? 'shape' : item.theme?.text ? 'text' : item.ending === 'forbidden' ? 'forbidden' : 'ordinary'))], generatorMaxDepth: Math.max(0, ...puzzles.map((item) => item.verification?.depth || item.depth || 0)) });
    setToast(`已保存 ${count} 道题到“${folderDisplayLabel(target)} · VCF 生成题”`);
  };
  const [fontScale, setFontScale] = useState<FontScale>(loadFontScale);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [batchEditMode, setBatchEditMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  // 批量导出要打包 ZIP（可能几十份），打包期间按钮要禁用，避免连点。
  const [batchExportBusy, setBatchExportBusy] = useState(false);
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
  // 应用内下载新版安装包的进度（null = 未在下载）。下载是长任务，必须能用取消键
  // 中断；中止后回到空闲态，用户可以改用网盘入口。
  const [updateDownload, setUpdateDownload] = useState<{ percent: number; text: string } | null>(null);
  const updateDownloadAbort = useRef<AbortController | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(loadSoundSettings);
  const [motionEnabled, setMotionEnabled] = useState(loadMotionEnabled);
  const [motionEffects, setMotionEffects] = useState<MotionEffectsSettings>(loadMotionEffectsSettings);
  const [enhancementSettings, setEnhancementSettings] = useState<EnhancementSettings>(loadEnhancementSettings);
  // 识谱增强包：空闲时预热模型（见 useRecognitionPrewarm 注释；只影响首次导入的等待时间）。
  useRecognitionPrewarm(enhancementSettings.fastRecognition);
  // 冷启动一律**关闭**「持续分析」（用户 09-26 明确要求「按理来说应该默认关闭」）：
  // 这项设置是持久化的，上一会话开着的分析会在每次重开应用时自动恢复并自动跑起来
  // ——用户没点过它、却在耗电发热，而且开关显示「开」、看起来像自己开了。
  // 挂载时落回关闭并持久化：开关如实显示「关」、不自动跑，符合预期。
  // 会话内（不重启）用户手动开启后照常滚动续算，不受影响。
  useEffect(() => {
    if (!enhancementSettings.analysisAuto) return;
    const next = { ...enhancementSettings, analysisAuto: false };
    setEnhancementSettings(next);
    saveEnhancementSettings(next);
    // 只在挂载时执行一次：之后用户手动开启必须保留
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 顶栏折叠按钮是「可选增强功能」里的开关项（用户 10-07）：关闭时按钮从顶栏消失，
  // 已折叠的界面必须自动展开——否则没有任何入口能把顶栏展开回来。
  useEffect(() => {
    if (!enhancementSettings.chromeCollapseToggle) setChromeLevel(0);
  }, [enhancementSettings.chromeCollapseToggle]);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => themePreference === "system" ? systemTheme() : themePreference);
  /** 「自定义背景」时界面用哪一套主题（用户 2026-10-12；背景归自定义、界面归它，见 custom-ui-theme.ts）。 */
  const [customUiTheme, setCustomUiTheme] = useState<ResolvedTheme>(loadCustomUiTheme);
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(loadBoardTheme);
  const [defaultBoardSize, setDefaultBoardSize] = useState(loadDefaultBoardSize);
  const [stoneTheme, setStoneTheme] = useState<StoneTheme>(loadStoneTheme);
  const [boardOpacity, setBoardOpacity] = useState(loadBoardOpacity);
  /** 落子方式（用户 2026-10-13）：false＝点一下直接落子（默认、历史行为）；
   *  true＝点一下先出圈，再点同一格才落。单独标量键，**不在挂载时写盘**
   *  （否则"从没动过这个选项"与"选了直接落子"就分不开了，见 placement-confirm.ts 头注）。 */
  const [placementConfirm, setPlacementConfirm] = useState(loadPlacementConfirm);
  const [stoneOpacity, setStoneOpacity] = useState(loadStoneOpacity);
  /** 功能区按钮透明度（用户 2026-10-09 新增，入口在「功能区布局」里）。 */
  const [actionOpacity, setActionOpacity] = useState(loadActionOpacity);
  /** 主题动效开关（默认开；K20 老 WebView 误报 reduce 时靠它把装饰动画放出来）。 */
  const [themeMotion, setThemeMotion] = useState(loadThemeMotion);
  const [annotationHighlight, setAnnotationHighlight] = useState<AnnotationHighlight>(loadAnnotationHighlight);
  // 语音报手（用户 09-23）：读谱自动播放时念出「黑 7 · H8」。默认关闭，且只在
  // 平台支持时才会出现在设置页——安卓应用内 WebView 没有 speechSynthesis，
  // 那里不该给出一个点了没反应的开关。
  const speechAvailable = speechSupported();
  const [speechEnabled, setSpeechEnabled] = useState(() => speechAvailable && loadSpeechEnabled());
  const [speechRate, setSpeechRate] = useState<SpeechRate>(loadSpeechRate);
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
  const [boardMargin, setBoardMargin] = useState(() => loadDisplaySettings().boardMargin);
  const [stoneSize, setStoneSize] = useState(() => loadDisplaySettings().stoneSize);
  const [largeBoard, setLargeBoard] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [mirrored, setMirrored] = useState(false);
  const [annotationType, setAnnotationType] = useState<AnnotationMarkType>("number");
  const [annotationValue, setAnnotationValue] = useState("1");
  const [annotationPopover, setAnnotationPopover] = useState<"style" | "color" | "type" | "value" | null>(null);
  const [annotationStyle, setAnnotationStyle] = useState<BoardMarkStyle>("text");
  const [annotationColor, setAnnotationColor] = useState("#1d1c19");
  // 色觉友好配色（用户 09-23）：色板随开关切换，当前选中色同步归一——否则开关一开，
  // 用户会停在「色板上没有任何一项高亮」的悬空状态（旧色值不在新色板里）。
  const annotationPalette = useMemo(() => (enhancementSettings.colorVisionFriendly ? friendlyAnnotationPalette(ANNOTATION_COLORS) : [...ANNOTATION_COLORS]), [enhancementSettings.colorVisionFriendly]);
  useEffect(() => { setAnnotationColor((current) => friendlyAnnotationColor(current)); }, [enhancementSettings.colorVisionFriendly]);
  // 去标注（擦除）模式：标注面板里的独立状态——点棋盘已有标注=擦除，点空位无动作；退出按钮/再点按钮/关面板均退出。
  const [annotationErase, setAnnotationErase] = useState(false);
  // 去子模式（2026-09-11 用户需求）：编辑面板进入，点棋盘上任意现存棋子直接删除；
  // 对带手序/分支的棋谱，首次删除会把局面拍平为静态 setup（无分支无手序），
  // 专为图片导入后多子/少子的修正场景。
  // 09-17 改版（用户）：状态栏那条「去子中 · 退出」已删——按钮本身就是状态（斜纹图案 +
  // 玉青描边 + 对勾），再点一次结束；因此下面这条效应保证「离开编辑面板 = 自动结束」，
  // 不会留下一个看不见却仍然生效的去子状态。
  const [eraseStone, setEraseStone] = useState(false);
  // 整体位移（用户 09-17）：编辑面板里的小工具，把当前局面所有棋子往一个方向挪一格。
  // 修「图片识谱整体偏一格」最常用——小工具网站里也有这排按钮。
  const [boardShiftOpen, setBoardShiftOpen] = useState(false);
  const [boardShiftBottom, setBoardShiftBottom] = useState(240);
  useEffect(() => {
    const closeTool = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || sheet || quickDrawerOpen || layoutEditorOpen || boardShiftOpen) return;
      if (annotationPopover) setAnnotationPopover(null);
      else if (dockPanel) setDockPanel(null);
    };
    window.addEventListener("keydown", closeTool);
    return () => window.removeEventListener("keydown", closeTool);
  }, [sheet, quickDrawerOpen, layoutEditorOpen, annotationPopover, dockPanel, boardShiftOpen]);
  // 「去子」只挂在编辑面板里，离开就结束（不留看不见却仍然生效的状态）。
  // 「位移」方向盘 10-02 起改成全局弹层（环形菜单也要用），所以不再跟着 dockPanel 收起。
  useEffect(() => {
    if (dockPanel !== "notes" && eraseStone) setEraseStone(false);
  }, [dockPanel, eraseStone]);
  // 方向盘是带遮罩的小模态盘：Esc 先关它（这条只能写在 boardShiftOpen 之后，否则 TDZ 炸渲染）。
  useEffect(() => {
    if (!boardShiftOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sheet) { event.preventDefault(); setBoardShiftOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardShiftOpen, sheet]);
  // ── 拍平原谱＝坏谱风险，改成三选一裁决（用户 2026-09-28）────────────────
  // 「去子 / 位移」的第一次改动会把带手序的棋谱拍平成静态局面（既有语义，不可撤销），
  // 而下面那条自动保存效应会在 450ms 后把内存里的结果**原样覆盖回棋谱库里那份带手序的
  // 原谱**——用户完全没有任何提示。现在把这种改动记成一笔待裁决：落盘先挡住，退出编辑
  // 面板或切换棋谱时让用户在「新建修改副本 / 覆盖棋谱 / 放弃改动」里选一个。
  // restore 存的是棋谱库里那一份，"放弃"要回到的是真正的原样，不是内存里的半成品。
  const [flattenChoice, setFlattenChoice] = useState<{ documentId: string; restore: GameDocument } | null>(null);
  const [flattenPromptOpen, setFlattenPromptOpen] = useState(false);
  // 三选裁决完还要继续做的那件事（由 withDraftGuard 那条链触发：切谱、新建、导入…）。
  const [afterFlatten, setAfterFlatten] = useState<(() => void) | null>(null);
  // 「退出」= 离开编辑面板（去子/位移只挂在那里）。没裁决就先不落盘，只把三选弹出来。
  useEffect(() => {
    if (dockPanel !== "notes" && flattenChoice && !flattenPromptOpen) setFlattenPromptOpen(true);
  }, [dockPanel, flattenChoice, flattenPromptOpen]);
  const [reviewMarks, setReviewMarks] = useState<ReviewMarks>(loadReviewMarks);
  const [reviewBranchNames, setReviewBranchNames] = useState<ReviewBranchNames>(loadReviewBranchNames);
  // 成就与棋魂（用户 2026-10-09）：判定引擎只读已有账本，所以这里不需要传任何业务数据——
  // 挂载时自动把历史数据兑现一次，之后由各结算点显式调 `progress.check()`。
  const progress = useProgress();
  /**
   * 商店徽章上那个数字（还有几项外观没解锁）。
   *
   * 读的是**可订阅的商店快照**（不是 localStorage 直读）——否则买完一项之后
   * 徽章上的数字不会跟着降，看起来像没买成功。
   */
  const soulShop = useSoulShop();
  const shopRemaining = shopRemainingCount(soulShop.unlocks);

  /**
   * **外观预览**的控制器（用户 2026-10-10：「现在不交钱无法预览了，就很不好，
   * 棋盘棋子你可以让我们点击可以预览，点击右边那个地方才是购买。而主题呢，
   * 也是可以预览，但是不买就回到自己使用的那个」）。
   *
   * 语义：`onPreview` = 临时切过去看（不落盘）；`onPreviewEnd(commit)` =
   * `commit=true` 留着（买了/自己本来就有的），`false` **还原到预览前那一套**。
   *
   * 为什么记"预览前那一套"而不是每次退出都读 localStorage：
   * 用户可能连着预览三个主题。每次都读盘的话，第一个预览**已经**把盘上的值
   * 改掉了吗？没有 —— 预览不落盘。所以盘上一直是"他真正在用的那套"，
   * 读盘其实也对。但**键盘/多点几下**的路径里，state 与盘可能短暂不同步
   * （比如他刚在别的入口改过、那个 effect 还没跑），记快照更稳、也更直白。
   */
  const previewBackup = useRef<{ theme: ThemePreference; customUiTheme: ResolvedTheme; board: BoardTheme; stone: StoneTheme } | null>(null);
  /* 四个"最新值"的 ref：`endPreview` 是 `[]` 依赖的，闭包里的 state 会是旧的，
     而 commit 那条路需要**当前**这一套（见那里的注释）。 */
  const themePreferenceRef = useRef(themePreference);
  themePreferenceRef.current = themePreference;
  const customUiThemeRef = useRef(customUiTheme);
  customUiThemeRef.current = customUiTheme;
  const boardThemeRef = useRef(boardTheme);
  boardThemeRef.current = boardTheme;
  const stoneThemeRef = useRef(stoneTheme);
  stoneThemeRef.current = stoneTheme;
  const previewAppearance = useCallback((patch: { theme?: ThemePreference; customUiTheme?: ResolvedTheme; board?: BoardTheme; stone?: StoneTheme }) => {
    if (!appearancePreviewing) {
      previewBackup.current = { theme: themePreference, customUiTheme, board: boardTheme, stone: stoneTheme };
      appearancePreviewing = true;
    }
    if (patch.theme !== undefined) setThemePreference(patch.theme);
    if (patch.customUiTheme !== undefined) setCustomUiTheme(patch.customUiTheme);
    if (patch.board !== undefined) setBoardTheme(patch.board);
    if (patch.stone !== undefined) setStoneTheme(patch.stone);
  }, [themePreference, customUiTheme, boardTheme, stoneTheme]);
  /**
   * 预览收尾。
   *
   * `commit = true`（买了）时必须**显式落盘**，不能指望那两个"写盘 effect"。
   *
   * ⚠ 这里踩过一个真 bug（2026-10-11 自检抓到）：买下正在预览的那一项时，
   * `onUnlocked` 调的是 `onChange(value)` —— 而**那个值当前就是它**
   * （用户正在预览它）。React 对"设成同一个值"会 **bail out、不重渲染**，
   * 于是写盘 effect 根本不会再跑一次（它只在 `themePreference` 变化时跑）；
   * 而预览期间那次跑又被 `appearancePreviewing` 挡掉了。
   *
   * 净效果：界面是对的、**盘上还是旧值 ⇒ 一刷新就退回旧外观**，
   * 看起来就像"钱花了但主题没买到"。
   *
   * 所以 commit 分支必须自己把当前这一套写进去（用 ref 读最新值：
   * 这个回调是 `[]` 依赖的，闭包里的 state 会是旧的）。
   */
  const endPreview = useCallback((commit: boolean) => {
    const backup = previewBackup.current;
    appearancePreviewing = false;
    previewBackup.current = null;
    if (!backup) return;
    if (commit) {
      try {
        localStorage.setItem(THEME_PREFERENCE_KEY, themePreferenceRef.current);
        localStorage.setItem(BOARD_THEME_KEY, boardThemeRef.current);
        localStorage.setItem(STONE_THEME_KEY, stoneThemeRef.current);
        saveCustomUiTheme(customUiThemeRef.current);
      } catch { /* 存储不可用时忽略：本次会话仍然生效 */ }
      return;
    }
    // 没买 ⇒ 回到预览前那一套（"不买就回到自己使用的那个"）
    setThemePreference(backup.theme);
    setCustomUiTheme(backup.customUiTheme);
    setBoardTheme(backup.board);
    setStoneTheme(backup.stone);
  }, []);

  /**
   * 离开「设置」页时**收尾外观预览**（用户 2026-10-10：「而主题呢，也是可以预览，
   * 但是不买就回到自己使用的那个」）。
   *
   * 外观设置住在**设置页**里（那是底部导航的一格，不是 sheet），所以"看完了"的
   * 判据是切走这一格。已买的那条路在 `onUnlocked` 里已经 `endPreview(true)` 收尾过，
   * 这里再收一次是幂等的（backup 已被清空，直接 return）。
   */
  useEffect(() => {
    if (tab !== "settings") endPreview(false);
  }, [tab, endPreview]);

  /**
   * **快捷中心的外观锁**（用户 2026-10-10：「我发现快捷中心里面，那些外观其实还可以
   * 自由切换，不受这些购买的约束，你修复一下，没买的选项，会有一把锁在右边，
   * 点击后提示没有购买是否购买，然后多少棋魂这样的」）。
   *
   * 三个 `xxxLockCost` 返回"这一项要多少棋魂"（可用/免费 ⇒ `undefined`）。
   * 判据统一走 `soulUnlockForTarget` + `soulShop.isUnlocked`，与设置页同一套
   * —— 两处各写一份判断迟早会有一处漏掉（这次漏的就是快捷中心）。
   */
  const lockCostOf = useCallback((kind: "theme" | "board" | "stone", value: string): number | undefined => {
    const item = soulUnlockForTarget(kind, value);
    if (!item || item.cost <= 0) return undefined;
    return soulShop.isUnlocked(item) ? undefined : item.cost;
  }, [soulShop]);
  const themeLockCost = useCallback((value: ThemePreference) => lockCostOf("theme", value), [lockCostOf]);
  const boardLockCost = useCallback((value: BoardTheme) => lockCostOf("board", value), [lockCostOf]);
  const stoneLockCost = useCallback((value: StoneTheme) => lockCostOf("stone", value), [lockCostOf]);

  /**
   * 在快捷中心点到锁着的项：**如实告诉他没买 + 多少钱 + 去哪里买**。
   *
   * 用 `window.confirm` 而不是自绘弹窗：快捷中心本身就是个抽屉，
   * 再叠一层自定义弹窗要处理层级、遮罩、返回键一堆事；而这里只需"告诉 + 指路"。
   * 真正的购买入口在**设置 → 外观**（那里有完整卡片：点一下预览、点价格购买）。
   * 如果余额够，问一句"要不要现在去买"并直接把他送过去 —— 少一步找路。
   */
  const onLockedAppearancePick = useCallback((kind: "theme" | "board" | "stone", value: string, cost: number, label: string) => {
    const kindLabel = kind === "theme" ? "主题" : kind === "board" ? "棋盘" : "棋子";
    const enough = soulShop.balance >= cost;
    const message = [
      `「${label}」还没有解锁（${kindLabel}）。`,
      `需要 ${cost} 棋魂，你现有 ${soulShop.balance}。`,
      "",
      enough
        ? "去「设置 → 外观」里买？点那项右边的价格就能买。"
        : "棋魂不够。下棋、做题、点魂火都能攒；也可以先在设置里预览看看。",
    ].join("\n");
    if (!window.confirm(message)) return;
    // 确认 ⇒ 直接把他送到外观设置（省掉"自己找路"）
    setTab("settings");
    setToast(`去「外观与音效 → ${kindLabel}」里挑，点右边的价格即可购买`);
  }, [soulShop.balance]);
  const reviewDrafts = useRef(new Map<string, DraftState>());
  const [draft, setDraft] = useState<DraftState>(() => loadDraftFromLocal(document.id));
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const [largeSummaries, setLargeSummaries] = useState<LargeDocumentSummary[]>([]);
  const [largeDraftIds, setLargeDraftIds] = useState<string[]>([]);
  const [recycleBin, setRecycleBin] = useState<RecycleBinEntry[]>(loadRecycleBinPruned);
  // 版本历史（audit 2026-09-17）：保存时自动留档的旧版本列表，面板打开时按当前棋谱拉取。
  const [versionHistory, setVersionHistory] = useState<SnapshotRecord[]>([]);
  // 库内重复体检（audit 2026-09-17）：只报告不自动删——同名不同谱、同谱不同注释都是合法存在。
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [imageRecognizing, setImageRecognizing] = useState(false);
  const [imageImportPreview, setImageImportPreview] = useState<{ file: File; url: string; name: string } | null>(null);
  // 识谱「叠图核对」屏（用户 09-17）：识别完成先不建谱，把结果按识别到的网格叠回原图
  // 让用户核对、顺手改错子；点「确认导入」才真的建谱并直接进入编辑面板。
  // 在线预览（用户 09-19 晚）：从在线面板「在线查看」打开的那一份**只在本机看**，
  // 不写进棋谱库。标记成预览态，自动保存效应会跳过它（否则 450ms 后就悄悄入库了）。
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [imageVerify, setImageVerify] = useState<{
    url: string; name: string; board: Cell[][]; boardSize: number; note: string; confidence: number;
    grid: RecognitionGrid | null; gridCanvas: { width: number; height: number } | null;
    editable: boolean; restoreFromNumbers: boolean;
    numberedMoves: Array<Position & { player: Player; number: number }>;
    imageWidth: number; imageHeight: number; ignoredColoredMarkers: number;
    // 「复原手序-本地」（正式功能，09-28 转正）要在核对屏重跑一遍带序号匹配的识别，
    // 原件得留着：原文件、对齐框 ROI、这次送进识别器的路数（0=自动检测）。
    // partialNumbers：序号只读出部分时的全集——凑不成完整 1..N 虽不能重建
    // 手序，也要把读到的号标到图上，让用户看到识别器究竟读到了什么。
    file: File | null; roi: BoardRoi | null; recognizeSize: number;
    /** 导入那一次识别到的网格几何（2026-10-09）。复原会重跑一遍识别，网格与导入
     *  必然逐值相同——传下去让识别器跳过网格检测（实测 5～7.6 秒、占导入约一半）。
     *  识别器侧还有越界体检：几何与当前画布不符时自动回落重算，宁慢不错。 */
    knownGrid: { originX: number; originY: number; spacingX: number; spacingY: number } | null;
    partialNumbers: Array<Position & { player: Player; number: number }>;
    /** 棋盘被**整份替换**的版本号（2026-10-13）：导入、复原出结果、AI 回填时 +1。
     *  核对屏的本地编辑态按它重置；用户的每一下「去子/改色」则通过 onBoardChange 实时
     *  写回本对象的 board——复原那一趟据此只在这些格上读号（不会再把他删掉的子找回来）。 */
    boardRevision: number;
  } | null>(null);
  // 「不限 15 路」：对齐屏右上角开关（实验功能 devBoardSizeDetect 打开时才渲染）。
  // 打开后识别器收到 boardSize = 0，自行检测棋盘路数。
  const [anyBoardSize, setAnyBoardSize] = useState(false);
  const [placementPlayer, setPlacementPlayer] = useState<"black" | "white">("black");
  const [placementLocked, setPlacementLocked] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [saveDestination, setSaveDestination] = useState<"records" | "puzzles">("records");
  const [saveFolder, setSaveFolder] = useState("未分类");
  // 存为题目时的目标题集（用户 2026-09-21）：空串 = 新建一个题集，用「保存到分组」的名字。
  const [savePuzzleTarget, setSavePuzzleTarget] = useState("");
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
  // Engine progress is a high-frequency stream. Keep the App shell subscribed only
  // to lifecycle changes; the live panel and board overlay subscribe to the external
  // store below so old WebViews do not reconcile every hidden input/topbar node.
  const [aiAnalysis, setAiAnalysisState] = useState<AiAnalysisState>(INITIAL_AI_ANALYSIS);
  const aiAnalysisRef = useRef<AiAnalysisState>(INITIAL_AI_ANALYSIS);
  useEffect(() => {
    // The store is module-scoped so the board overlay can subscribe without
    // lifting progress frames into App. Reset it when a fresh App mounts so a
    // previous page instance cannot leak its last analysis into this one.
    aiAnalysisRef.current = INITIAL_AI_ANALYSIS;
    aiAnalysisStore.reset();
  }, []);
  const setAiAnalysis = (update: AiAnalysisState | ((current: AiAnalysisState) => AiAnalysisState)) => {
    const next = typeof update === "function" ? update(aiAnalysisRef.current) : update;
    aiAnalysisRef.current = next;
    aiAnalysisStore.publish(next);
    setAiAnalysisState(next);
  };
  const publishLiveAiAnalysis = (update: (current: AiAnalysisState) => AiAnalysisState) => {
    const next = update(aiAnalysisRef.current);
    aiAnalysisRef.current = next;
    aiAnalysisStore.publish(next);
  };
  /**
   * 引擎 progress 帧的合流闸（2026-10-15，见 features/ai/progress-frame-gate.ts 的文件头）。
   *
   * 背景：真机 diag 里持续分析期 `app:progress` 是「每秒 10 条，一直满速」，而下面每个
   * progress 分支都直接 `setAiAnalysis` —— App 级 state，等于每秒把整棵组件树重渲染十几次。
   * 棋盘跟着反复重绘，棋盘区里带 backdrop-filter 的「思考中」浮标每次都要重糊背景，
   * 用户看到的就是「落子初期很容易闪，过一会就稳定了，然后再落子又闪」。
   *
   * 两个闸各管一条链：分析（startThink）与对局/做题（requestStrongAiMove）。窗口 320ms
   * ≈ 6 次/秒，够读数字、远低于引擎出帧率。合并不丢终值 —— result/error/停止前必须
   * `flush()`，换手必须 `reset()`（否则待发的旧帧会落在新局面上）。
   */
  /**
   * 引擎 progress 帧的两档合流闸（2026-10-15，见 features/ai/progress-frame-gate.ts 的文件头）。
   *
   * 背景：真机 diag 里持续分析期 `app:progress` 是「每秒 10 条，一直满速」，而下面每个
   * progress 分支都直接 `setAiAnalysis` —— App 级 state，等于每秒把整棵组件树重渲染十几次。
   * 更要紧的是**候选点每一帧都可能换一批**：搜索初期两层深度之间就够换一次榜，逐帧重画
   * 就是棋盘上那圈彩点每秒明灭十次。「落子初期很容易闪，过一会就稳定了，然后再落子又闪」
   * 正是这个 —— 算深了每层越来越慢、榜单不再每帧都变，于是自己「稳定」下来。
   *
   * 所以拆两档、各管一条链（分析 startThink / 对局·做题 requestStrongAiMove）：
   * 读数 320ms（旧 WebView 上更稳），候选点 600ms（人眼读得过来的频率，也让棋盘重绘降一个量级）。
   * 两档都不丢终值 —— result/error/停止前 `flush()`，换手 `reset()`。
   */
  const analysisProgressPump = useRef<EngineProgressPump<EngineProgressScalars, AiAnalysisCandidate[]> | null>(null);
  const gameProgressPump = useRef<EngineProgressPump<EngineProgressScalars, AiAnalysisCandidate[]> | null>(null);
  if (analysisProgressPump.current === null) {
    analysisProgressPump.current = createEngineProgressPump<EngineProgressScalars, AiAnalysisCandidate[]>(
      (frame) => publishLiveAiAnalysis((current) => ({
        ...current, status: "thinking", engine: frame.variant !== undefined ? analysisEngineLabel(frame.variant) : current.engine,
        depth: Math.max(frame.depth || 0, current.depth || 0), selDepth: Math.max(frame.selDepth || 0, current.selDepth || 0), nodes: Math.max(frame.nodes || 0, current.nodes || 0),
        speed: frame.speed ?? current.speed, score: frame.score !== undefined ? frame.score : current.score, scoreAvailable: frame.score !== undefined || current.scoreAvailable,
        winRate: frame.winRate !== undefined ? frame.winRate : current.winRate, drawRate: frame.drawRate !== undefined ? frame.drawRate : current.drawRate,
      })),
      mergeEngineProgressScalars,
      (candidates) => publishLiveAiAnalysis((current) => ({ ...current, candidates })),
    );
  }
  if (gameProgressPump.current === null) {
    gameProgressPump.current = createEngineProgressPump<EngineProgressScalars, AiAnalysisCandidate[]>(
      (frame) => publishLiveAiAnalysis((current) => ({
        ...current, status: "thinking", engine: frame.variant !== undefined ? analysisEngineLabel(frame.variant) : current.engine,
        depth: frame.depth || current.depth, nodes: frame.nodes || current.nodes, speed: frame.speed ?? current.speed,
        score: frame.score !== undefined ? frame.score : current.score, scoreAvailable: frame.score !== undefined || current.scoreAvailable,
        winRate: frame.winRate !== undefined ? frame.winRate : current.winRate,
      })),
      mergeEngineProgressScalars,
      (candidates) => publishLiveAiAnalysis((current) => ({ ...current, candidates })),
    );
  }
  // Which analysis candidate the user tapped for a variation preview. We only
  // remember the point; the line itself is resolved from the LIVE candidate
  // list each render, so the preview deepens along with the ongoing search.
  const [analysisPreview, setAnalysisPreview] = useState<{ contextKey: string; row: number; col: number } | null>(null);
  const aiAnalysisEngineRef = useRef<AiAnalysisEngine>("light");
  const [boardMotion, setBoardMotion] = useState<BoardMotionState>({ kind: null, version: 0, at: null });
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
  const rapfiPersistentWorker = useRef<{ worker: Worker; key: string; dead?: boolean } | null>(null);
  // 分析轮双 worker 乒乓（T47，用户 09-11「底层架构」）：WASM 同步搜索阻塞
  // worker 事件循环，落子/换手时新轮只能等旧轮跑满预算才开始（cancel 消息也
  // 排队）——轻量引擎双开（~5MB/个），落子后立即在空闲 slot 上开始真计算，
  // 候选 1s 内出现且是新搜索结果（非继承旧路线）；滚动续算仍在同一 slot
  // （TT 继承）。slot.running 标记物理忙（cancel 不清，等旧轮 accept 自然收尾）。
  // rapfi（40MB heap）单 worker，继续走 rapfiPersistentWorker。
  const analysisPersistent = useRef<Array<{ worker: Worker; key: string; controller: AiWorkerController; running: boolean; dead?: boolean } | null>>([null, null]);
  // Worker 的 ready 可能早于切换覆盖层下一次 render 到达；记录实际变体，已经
  // 预热完成的实例，这样切换到同一常驻槽时可以立即收束，不必再等一条不存在的事件。
  const readyEngineWorkers = useRef(new WeakMap<Worker, string>());
  // 最近一次分析用的 slot（滚动续算同 slot 保 TT；换手优先用另一已加载 slot，
  // 避免 terminate 重建的 slot 还在 warmup 时被选中而冷等待）。
  const lastAnalysisSlot = useRef(0);
  const aiWorkerController = useRef(new AiWorkerController((discarded) => {
    // The controller terminates a persistent engine on unconditional-cancel
    // paths (or when the local fallback replaces it); drop the warm slot then.
    if (rapfiPersistentWorker.current?.worker === discarded) rapfiPersistentWorker.current = null;
  }));
  const nativeSourceFile = useRef<File | null>(null);
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
  const aiRequestRetry = useRef(new AiRequestRetry());
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
  /** 旗舰档启动失败计数（换引擎/换会话时清零）。
   *
   * 弹「启动失败」的门槛 = **连续 5 次**（用户 09-26 明确要求）：旗舰冷启动
   * 本来就要几秒，而加载期的瞬态 error 余波（旧进程被清扫/复用时的收尾）会
   * 触发 1~2 次假失败——弹一次「正在重试」再看到引擎 2 秒后正常起来，让人
   * 以为真的坏了。前 4 次只静默重试（引擎很快就好，用户根本无感），第 5 次
   * 仍失败才弹提示并降级。 */
  const kataRetryRef = useRef(0);
  const KATA_FAIL_TOAST_THRESHOLD = 5;
  /**
   * 「持续分析」是否由**本次会话**的用户动作开启。
   *
   * 设置存 localStorage（跨启动保留），而自动分析 effect 只看 `analysisAuto`——
   * 于是每次重开应用，上一会话开着的持续分析都会自动恢复、自动跑起来（用户
   * 09-26 报「为什么每次重新进去，他这个分析还会自动打开自动进行啊，按理来说
   * 应该默认关闭的呀」）。分析是耗电/发热大户，默认应当不自动开。
   * 判据用 sessionStorage（只在**本次会话**存活，重开应用即清空）：本次会话里
   * 用户没打开过就不自动跑，设置值照旧保留（面板上的开关显示还是「开」，
   * 用户点一下才真正开始算）。这样也保留了「后台被系统杀掉又恢复」的意图。
   */
  const ANALYSIS_ARMED_KEY = "banbu-analysis-armed-v1";
  const readAnalysisArmed = (): boolean => {
    try { return sessionStorage.getItem(ANALYSIS_ARMED_KEY) === "1"; } catch { return false; }
  };
  const analysisAutoArmedRef = useRef<boolean>(readAnalysisArmed());
  // 持续分析自愈保活（09-27 加）：记录「最后一次观察到没有任何一轮在跑」的时刻，
  // 以及连续补发却没把分析跑起来的次数（退避用，防止引擎彻底坏时每 1.5s 一次风暴）。
  const analysisIdleSinceRef = useRef<number>(0);
  const analysisKeepAliveStrikesRef = useRef<number>(0);
  /**
   * 这个 error 能不能算「旗舰引擎启动失败」？
   *
   * 不能只看「收到 error」：旗舰冷启动要 ~6 秒（进程 spawn + 3.4MB 模型 + ORT
   * 初始化 + 4 轮标定），加载期出现的 error 大多是瞬态噪音——最典型的是
   * 「进程已退出」的余波（上一次 spawn 被清扫/复用时的收尾），用户看到的却是
   * 「启动失败，正在重试」，1 秒左右就弹一次，让人以为真坏了（用户 09-26 报）。
   * 判据：**加载进度条还在跑（未到 100%）就继续等**，此时既不宣告失败、也不
   * 停进程——让加载自然走完；只有「加载已完成却仍报错」才是真失败。
   * 给足的时间由引擎侧的启动超时兜底（kata 40s，见 KATA_START_TIMEOUT_MS），
   * 超时那一刻进度条会被收掉，之后的 error 自然按真失败处理。
   */
  const isKataLoadInFlight = () => {
    const load = engineLoadRef.current;
    return load !== null && load.percent < 100;
  };
  // 加载期宽限的重投次数上限：防止「报错→等 800ms→重投」在引擎始终不就绪时
  // 无限自旋。过几轮后进度条通常已被引擎侧超时收掉，下面的真失败分支自会接手；
  // 这里再兜一层，确保宽限最多 5 次（≈4 秒）就交还给正常的失败/重试链路。
  // 加载期宽限：不再用「次数」而用**时间**——引擎侧的启动超时已放宽到 90s
  // （见 rapfi-worker.js 的 KATA_START_TIMEOUT_MS），App 侧的宽限必须跟它同量级，
  // 否则「次数用完」又会抢在引擎真正就绪之前宣告失败。这里给 85s（略短于引擎
  // 超时，让引擎先自己收尾进度条），期间收到 error 一律视为瞬态噪音、继续等。
  const kataLoadGraceUntilRef = useRef(0);
  const KATA_LOAD_GRACE_MS = 85000;
  const takeKataLoadGrace = () => {
    if (!isKataLoadInFlight()) return false;
    const now = Date.now();
    if (kataLoadGraceUntilRef.current === 0) kataLoadGraceUntilRef.current = now + KATA_LOAD_GRACE_MS;
    return now < kataLoadGraceUntilRef.current;
  };
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
      const pendingTarget = engineSwitchTargetRef.current;
      if (snapshot.objectUrl && pendingTarget) {
        const switchId = engineSwitchIdRef.current;
        setEngineSwitch((current) => current?.id === switchId && current.to === pendingTarget && current.status === "download"
          ? { ...current, status: "loading", percent: 0, phase: "引擎资源已准备好，正在启动新引擎…" }
          : current);
        if (engineSwitchIdRef.current === switchId) armEngineSwitchWatchdog(switchId, pendingTarget);
      }
      setEnginePackState(snapshot.state);
      // A flagged download without a warmed object URL happens right after app
      // start; load it in the background so the next AI request already uses it.
      // 注意：必须在自带包安装「之后」才调用——两者都会创建 objectURL，并发时
      // 会互相替换，导致先启动的预热 worker 拿到已失效的 blob（实测报
      // Network Error，见 rapfi-single.js）。见下方串行链。
    });
    // 原生引擎探测（安卓 APK）：只做几次文件检查，不复制权重（39MB 的复制推迟到
    // 真正要用引擎时）。探测结果决定发给 worker 的 native 开关，以及下面要不要
    // 释放旧的 wasm 强力包。
    // 关键：**探测失败 ≠ 本机没有原生引擎**。Capacitor 插件注册可能晚于启动
    // effect（09-15 在 MuMu 上实测过），只探一次会把整个会话钉死成「没有原生
    // 引擎」→ 界面一直说「引擎包未就绪、去下载 38MB」，而安装包里其实带着模型
    // （09-18 用户报「本来就有模型，却让我下载引擎」）。所以：订阅探测结果 + 按
    // 退避重探 + 回到前台再探；一旦探到可用立刻把 UI 状态抬起来。
    const unsubscribeNative = subscribeNativeEngine((info) => {
      if (info) setNativeProbed(true);
      if (info?.available === true) setNativeEngineReady(true);
    });
    void probeNativeEngine();
    // KataGo 旗舰引擎探测（仅安卓）：与 Rapfi 探测同退避策略。结果进模块缓存
    // （nativeKataGoInfo），engineVariantFor 据此决定 "kata" 是否真正生效。
    const refreshKataProbe = () => {
      void probeNativeKataGo().then((info) => { if (info) setKataEngineReady(info.available === true); });
    };
    /**
     * KataGo 探测改为**按需**（2026-10-15 用户要求）。
     *
     * 原实现：启动时无条件探测 + 4 次退避重试。而探测本身会去把**原生 KataGo 进程拉起来**
     * （见 native-engine 里 check()/prepare() 的说明，进程能吃 ~850MB），于是「用户在跑 rapfi，
     * 后台却同时起 KataGo」——既拖慢启动，又会在探测失败时弹出「引擎切换失败 / KataGo 启动失败」，
     * 而用户根本没打算用 KataGo，那两句话纯属噪音。
     *
     * 现在只在**本局确实要用 KataGo** 时才在启动阶段探测；另外两种情况（用户切到 kata、
     * 打开会列出引擎档位的界面）由下面那个 effect 触发——档位列表要靠探测结果决定
     * 要不要给出「KataGo」这一项，所以那两个界面一打开就必须探。
     */
    const kataRetryTimers = [] as number[];
    if (aiEngineChoice === "kata") {
      for (const delay of [1200, 3000, 7000, 15000]) kataRetryTimers.push(window.setTimeout(refreshKataProbe, delay));
      refreshKataProbe();
    }
    // 用户**动手把档位切到 kata** 的那一刻也探测（启动时不是 kata、后来切过去的情况）。
    // 注意：**不能**用「打开了设置页/分析面板」当触发条件（用户 2026-10-15 指出）——
    // rapfi 的配置也住在同样的面板里，只是打开面板看一眼就又变成「后台把 KataGo 拉起来」。
    // KataGo 档位改为在这些选择列表里**恒定列出**（见下面两处 `Capacitor.isNativePlatform()`），
    // 于是不必靠探测结果决定「要不要给出这一项」；探测只发生在「真被选中/真在用」。
    const nativeRetryTimers = [1200, 3000, 7000, 15000, 30000].map((delay) =>
      window.setTimeout(() => { void probeNativeEngine(); }, delay));
    // 注意：本组件作用域里的 `document` 是棋谱文档，全局 document 要显式走 window。
    const onNativeVisibility = () => { if (window.document.visibilityState === "visible") void probeNativeEngine(); };
    window.document.addEventListener("visibilitychange", onNativeVisibility);
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
    return () => {
      unsubscribe();
      unsubscribeNative();
      for (const timer of nativeRetryTimers) window.clearTimeout(timer);
      for (const timer of kataRetryTimers) window.clearTimeout(timer);
      window.document.removeEventListener("visibilitychange", onNativeVisibility);
    };
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
  // 2026-09 扩展：默认「轻量档」此前完全不预热，而网页版首次对弈/分析要现场
  // new Worker + importScripts + WASM 编译，第一手明显卡顿。现在轻量档在网页
  // （非 Capacitor 原生）改为「页面空闲后再预热」：用 requestIdleCallback（Safari
  // 等不支持时退回 setTimeout），不跟启动阶段的渲染/索引抢资源；原生端有本地
  // 资源与自己的冷启动策略，保持不预热。调度可取消，依赖变化或卸载都不会泄漏。
  useEffect(() => {
    const needsPack = engineNeedsPack(aiEngineChoice);
    // 原生端也预热轻量档（2026-09-16 用户「加载时能不能更快」）：默认档位就是轻量，
    // 而安卓上轻量档走的是**同一个原生引擎**——预热顺带把 38MB 权重的首次复制
    // （prepare → copyPayload，实测约 1s）与进程启动挪到用户还在看界面的时候，
    // 第一次点分析就不必再等这些。仍走「页面空闲后」调度，不跟启动渲染抢资源。
    const lightWebIdleWarm = aiEngineChoice === "light" && typeof Worker !== "undefined";
    // KataGo 旗舰档同样要预热（2026-09-26 真机验收发现漏了）：进程启动 + 3.4MB
    // 模型复制 + 首启标定合计 5~10s，不预热就会全部压在用户第一次点分析上。
    const kataWarm = aiEngineChoice === "kata" && nativeKataGoInfo()?.available === true;
    // `typeof Worker` 兜底，防止无 Worker 的环境报错。
    if (!needsPack && !lightWebIdleWarm && !kataWarm) return;
    // 安卓要等原生探测落定；浏览器没有原生插件，不能把 null 探测结果
    // 当成「还没准备好」，否则 rapfi 切换永远没有 warmup/ready 事件。
    if (Capacitor.isNativePlatform() && !nativeProbed) return;
    if (needsPack && !strongEngineReady) return;
    const packUrl = needsPack ? enginePackUrlRef.current : null;
    // 安卓原生 Rapfi 不依赖 wasm 引擎包；engineVariantFor 会在 native=true
    // 时把 light 请求解析为 native。只有非原生环境才需要 packUrl 才能预热强力档。
    if (needsPack && !packUrl && !nativeEngineReady) return;
    const warmEngine = engineVariantFor(aiEngineChoice, packUrl);
    const slotKey = engineSlotKeyFor(aiEngineChoice, packUrl);
    const warmSlots = () => {
      // 双槽乒乓是给 WASM 用的（旧轮物理忙时用备用槽接新请求）。旗舰走的是
      // **单例原生进程**：第二个槽不提供任何并行（两个 worker 共用同一进程，
      // 只会多发一次 kata-start、多一条竞争启动链），所以旗舰只预热一个槽。
      const slotCount = warmEngine === "kata" ? 1 : 2;
      for (let i = 0; i < slotCount; i += 1) {
        const slot = analysisPersistent.current[i];
        // 键不同必须创建并预热目标引擎；只改旧槽键名不会启动 KataGo。
        if (slot?.key === slotKey && !slot.dead) {
          if (engineSwitchTargetRef.current === aiEngineChoice) {
            handleEngineReadyEvent(readyEngineWorkers.current.get(slot.worker), aiEngineChoice);
          }
          continue;
        }
        if (slot) slot.worker.terminate();
        const warmSlot = makeAnalysisSlot(slotKey);
        // 预热也要画进度：切换引擎后用户立刻能看到「加载到哪了」，而不是干等
        const switchId = engineSwitchIdRef.current;
        const switchTarget = engineSwitchTargetRef.current;
        const isCurrentSwitch = () => engineSwitchIdRef.current === switchId
          && engineSwitchTargetRef.current === switchTarget
          && analysisPersistent.current.some((slot) => slot?.worker === warmSlot.worker && !slot.dead);
        warmSlot.worker.addEventListener("message", (event: MessageEvent<{ type?: string; engine?: string; variant?: string; percent?: number; label?: string; done?: boolean; message?: string }>) => {
          if (event.data?.type === "engine-loading") {
            if (isCurrentSwitch()) handleEngineLoadingEvent(event.data);
            return;
          }
          if (event.data?.type === "ready") {
            if (event.data.variant) readyEngineWorkers.current.set(warmSlot.worker, event.data.variant);
            if (isCurrentSwitch()) handleEngineReadyEvent(event.data.variant, aiEngineChoice);
            return;
          }
          if (event.data?.type === "error" && isCurrentSwitch() && switchTarget) {
            settleEngineSwitch("failure", { error: String(event.data.message || "新引擎启动失败"), canCancel: false });
          }
        });
        warmSlot.worker.addEventListener("error", () => {
          if (isCurrentSwitch() && switchTarget) settleEngineSwitch("failure", { error: "新引擎线程启动失败", canCancel: false });
        });
        warmSlot.worker.addEventListener("messageerror", () => {
          if (isCurrentSwitch() && switchTarget) settleEngineSwitch("failure", { error: "引擎线程通信失败", canCancel: false });
        });
        analysisPersistent.current[i] = warmSlot;
        warmSlot.worker.postMessage({ type: "warmup", engine: warmEngine, dataUrl: packUrl || undefined, multi: enhancementSettings.engineMultiThread, threads: enhancementSettings.engineThreads, bigCores: nativeEngineInfo()?.bigCores, native: nativeEngineUsable() });
      }
      for (let i = slotCount; i < analysisPersistent.current.length; i += 1) {
        killAnalysisSlot(analysisPersistent.current[i]?.worker);
      }
    };
    // 强力/实验档：包一就绪立即预热（40MB 冷加载 10-30s，等不到空闲）。
    if (!lightWebIdleWarm) { warmSlots(); return; }
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    const requestIdle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (requestIdle) idleHandle = requestIdle(() => { idleHandle = null; warmSlots(); }, { timeout: 4000 });
    else timeoutHandle = window.setTimeout(() => { timeoutHandle = null; warmSlots(); }, 2500);
    return () => {
      const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
      if (idleHandle !== null && cancelIdle) cancelIdle(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [aiEngineChoice, enginePackReady, nativeProbed, nativeEngineReady, kataEngineReady]);
  // 页面卸载时收掉分析槽的常驻 worker（含上面空闲预热的轻量实例）：实例存活在
  // ref 里，不挂 pagehide 就会一直留到进程结束。进 bfcache 的 pagehide
  //（persisted=true）不终止——缓存页返回后 worker 无法复活，杀掉会让返回后
  //「分析」直接失效。
  useEffect(() => {
    const teardown = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      for (let i = 0; i < analysisPersistent.current.length; i += 1) {
        analysisPersistent.current[i]?.worker.terminate();
        analysisPersistent.current[i] = null;
      }
    };
    window.addEventListener("pagehide", teardown);
    return () => window.removeEventListener("pagehide", teardown);
  }, []);
  const runUpdateCheck = useCallback(() => {
    // Silent by design: a failed or offline check must never nag the user.
    checkForLatestRelease(APP_VERSION)
      .then((release) => {
        if (release.relation !== "update-available") return;
        setLatestUpdate(release);
        // Interrupt once per release; "以后再说" records the version so the
        // same release never pops again, while a future one prompts once more.
        // ?qa=1 时不弹：这是会挡住点击的模态弹层，自动化门禁（qa runner 统一带 ?qa=1）
        // 若被它拦住会变成「点不动」的假失败——首运行欢迎页同理由同一参数抑制。
        // 快捷中心的「发现新版本」角标仍会更新，手动检查也照常。
        if (typeof location !== "undefined" && new URLSearchParams(location.search).get("qa") === "1") return;
        if (loadUpdatePromptDismissed() !== release.version) setUpdatePrompt(release);
      })
      .catch(() => { /* offline or rate limited; the About page allows a manual retry */ });
  }, []);
  const dismissUpdatePrompt = useCallback(() => {
    setUpdatePrompt((current) => { if (current) saveUpdatePromptDismissed(current.version); return null; });
  }, []);
  // 应用内下载安装包：候选源 = 版本元数据里的直连地址（缺失时由 update-check 按
  // 标准文件名拼），外加站点上的同源镜像。下载完交给系统安装器或降级交接，全部
  // 失败时给出可操作的原因，并把网盘入口留在一屏之内。
  const downloadUpdateApk = useCallback(async (release: LatestRelease) => {
    if (updateDownload) return;
    const controller = new AbortController();
    updateDownloadAbort.current = controller;
    setUpdateDownload({ percent: 0, text: "正在准备下载…" });
    try {
      const filename = apkFilename(release.version);
      const result = await downloadAndInstallUpdate({
        urls: apkDownloadSources(release),
        filename,
        expectedSha256: release.apkSha256,
        signal: controller.signal,
        onProgress: ({ receivedBytes, totalBytes }) => {
          const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;
          setUpdateDownload({ percent, text: `正在下载安装包 ${percent}%` });
        },
      });
      setUpdateDownload(null);
      if (result.outcome.status === "installing") setToast("安装包已下载完成，请在系统提示里确认安装");
      else if (result.outcome.status === "handed-off") setToast("安装包已下载完成，请在文件管理器里点开安装");
      else if (result.outcome.status === "browser") setToast("已交给浏览器下载，下载完成后点开即可安装");
    } catch (error) {
      setUpdateDownload(null);
      const message = error instanceof Error ? error.message : String(error);
      if (/已取消/.test(message)) setToast("已取消下载");
      else setToast(`${message}。可改用下方网盘入口下载`);
    } finally {
      updateDownloadAbort.current = null;
    }
  }, [updateDownload]);
  const cancelUpdateDownload = useCallback(() => {
    updateDownloadAbort.current?.abort();
    updateDownloadAbort.current = null;
    setUpdateDownload(null);
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
    // 用户**主动**把档位切到 kata：这时才探测/启动原生 KataGo（2026-10-15）。
    if (value === "kata") void probeNativeKataGo().then((info) => { if (info) setKataEngineReady(info.available === true); });
    if (value === aiEngineChoice) {
      const id = ++engineSwitchIdRef.current;
      if (engineSwitchWatchdogRef.current !== null) window.clearTimeout(engineSwitchWatchdogRef.current);
      engineSwitchTargetRef.current = value;
      engineSwitchStatusRef.current = "same";
      setEngineSwitch({ id, from: value, to: value, channel: engineSwitchChannelFor(value), status: "same", percent: 100, phase: "当前已经在使用这个引擎", canCancel: false });
      return;
    }
    const id = ++engineSwitchIdRef.current;
    engineSwitchTargetRef.current = value;
    engineSwitchStatusRef.current = "loading";
    engineSwitchStartRef.current = Date.now();
    kataDiag(`switch: open id=${id} ${aiEngineChoice}->${value}`);
    if (engineSwitchTimerRef.current !== null) window.clearTimeout(engineSwitchTimerRef.current);
    // 上一轮「备用引擎先就绪」的宽限计时器也要清掉，否则它可能在这次切换中途误判失败
    if (engineSwitchFallbackTimerRef.current !== null) {
      window.clearTimeout(engineSwitchFallbackTimerRef.current);
      engineSwitchFallbackTimerRef.current = null;
    }
    const missingConfig = value === "ikatago" && !loadIkatagoConfig().serverUrl.trim();
    const missingPack = enginePackMissingFor(value);
    const needsPackPreparation = engineNeedsPack(value) && !nativeEngineReady && !enginePackReady;
    engineSwitchStatusRef.current = missingConfig ? "config" : needsPackPreparation ? "download" : "loading";
    setEngineSwitch({
      id,
      from: aiEngineChoice,
      to: value,
      channel: engineSwitchChannelFor(value),
      status: missingConfig ? "config" : needsPackPreparation ? "download" : "loading",
      percent: 0,
      phase: missingConfig ? "请先完成云端引擎配置" : needsPackPreparation ? (missingPack ? "等待引擎包下载完成" : "正在恢复本地引擎资源") : "正在启动新引擎…",
      canCancel: false,
    });
    if (engineSwitchWatchdogRef.current !== null) window.clearTimeout(engineSwitchWatchdogRef.current);
    if (!missingConfig) armEngineSwitchWatchdog(id, value, needsPackPreparation ? "download" : "loading");
    // 引擎档位切换 = 用户显式重试信号：解开 rapfi 锁轻量 / 清强力未就绪提示 /
    // 复位两路内存降级重试计数。
    rapfiAnalysisBlockedRef.current = false;
    analysisPackNotifiedRef.current = false;
    engineMemoryRetryRef.current = null;
    gameMemoryRetryRef.current = null;
    kataLoadGraceUntilRef.current = 0;   // 换档 = 新一轮加载，宽限窗口重置
    cancelActiveAiComputation("settings-change");
    autoAnalysisKey.current = "";
    // 云端引擎：**没填服务器地址就先让用户填**，不要切过去再连接失败
    // （用户 09-29 报「云端 katago 应该先给用户填配置，目前没有」）。
    // 这里只提示并保留配置面板可见（选择器已切到云端，面板会显示 IkatagoTuning），
    // 不发起连接——真正的连接由下一次分析请求带着配置去建。
    if (value === "ikatago" && !loadIkatagoConfig().serverUrl.trim()) {
      setToast("请先填写云端服务器地址（下方「云端引擎」配置），填好后再开始分析");
    }
    if (enginePackMissingFor(value) && !enginePackDownloading) {
      // 记录下载意图：下载完成自动切档时遵循此值（自调不会被劫持成强力）。
      engineDownloadIntentRef.current = value === "tuned" || value === "strong" ? value : null;
      setEnginePackDownloading(true);
      setToast("正在下载 rapfi 引擎包（38.4MB），完成后自动启用");
      void downloadEnginePack((progress) => {
        const nextPercent = progress.totalBytes > 0 ? Math.round((progress.receivedBytes / progress.totalBytes) * 100) : 0;
        updateEngineSwitch({ status: "download", percent: nextPercent, phase: `正在下载引擎包 · ${nextPercent}%` });
        setAiPackProgress(progress);
      })
        .then(() => {
          setEngineSwitch((current) => current?.id === id ? { ...current, status: "loading", percent: 0, phase: "引擎包已就绪，正在启动新引擎…" } : current);
          if (engineSwitchIdRef.current === id) armEngineSwitchWatchdog(id, value, "loading");
          setToast("rapfi 引擎包下载完成，持续将使用全量引擎");
        })
        .catch((error) => {
          setEngineSwitch((current) => current?.id === id ? { ...current, status: "failure", error: error instanceof Error ? error.message : "rapfi 引擎包下载失败" } : current);
          if (engineSwitchIdRef.current === id) engineSwitchTargetRef.current = null;
          setToast(error instanceof Error ? error.message : "rapfi 引擎包下载失败");
        })
        .finally(() => { setEnginePackDownloading(false); setAiPackProgress(null); });
    }
    if (engineNeedsPack(value) && enginePackState && !strongEngineReady) void ensureEnginePackUrl();
    setAiEngineChoice(value);
    try { localStorage.setItem(AI_ENGINE_CHOICE_KEY, value); } catch { /* persistence is best-effort */ }
    // 换档要跟着**当前这一局**走（用户 2026-10-03 报「我已经是 rapfi，落一子后下一子
    // 却变成 KataGo 在想」）：对局每一手读的都是开局那一刻定格的 aiGame.engineChoice
    // （见 startAiGameReply 传的实参），不回写它，设置改成 rapfi 也管不到正在下的这局。
    setAiGame((current) => (current && !current.outcome && current.engineChoice !== value ? { ...current, engineChoice: value } : current));
    // iKataGo 的连接是首次分析时按需建立，切换动作本身没有可等待的本地
    // warmup 事件；保留一小段棋子动画后收束为“已切换”，文案会说明连接时机。
    if (value === "ikatago" && !missingConfig) {
      window.setTimeout(() => {
        if (engineSwitchIdRef.current !== id || engineSwitchTargetRef.current !== value) return;
        settleEngineSwitch("success", { percent: 100, phase: "已切换，首次分析时建立连接" });
      }, 900);
    }
  };
  // 引擎互斥（2026-09-26 用户要求）：一次只让一套原生引擎常驻——切到旗舰就停 rapfi、
  // 切回 rapfi 就停旗舰。省掉第二个进程的内存与发热；切换时新引擎随预热 effect 立即
  // 拉起（kata 首启含模型加载，桥会缓存就绪态，热进程切换是秒回的）。
  // 2026-10-08 加**宽限窗口**（KATA_KEEPWARM_MS）：切走旗舰不立刻杀进程，窗口内切回来
  // 直接复用（切回秒开）；超时仍停留在 rapfi 才真正回收——把「切回来要等冷启」这件事消掉。
  // 先取消在算的请求：否则被停掉的进程会让在飞请求走进「引擎退出」错误分支。
  useEffect(() => {
    // 换引擎 = 一次干净的尝试：清掉所有「本会话不再试这个引擎」的锁死标记，
    // 否则一次失败会跟着会话走到结束（用户 09-26 报的「切回/重启后一直起不来」）。
    rapfiAnalysisBlockedRef.current = false;
    engineMemoryRetryRef.current = null;
    kataRetryRef.current = 0;      // 换档 = 全新计数（连续 5 次失败才弹提示）
    // 「忙就不停」：正有对局/分析在算时硬停对方进程，会让在飞请求走进「引擎退出」
    // 错误分支、整档降级到内置兜底引擎——那种情况留给槽位替换时的自然回收。
    const busy = aiThinking || thinkRunning;
    if (!busy) {
      if (aiEngineChoice === "kata") {
        // 切回旗舰：取消待回收计时（进程还在就是秒回）
        if (kataKeepWarmTimerRef.current !== null) {
          window.clearTimeout(kataKeepWarmTimerRef.current);
          kataKeepWarmTimerRef.current = null;
        }
        void stopNativeEngine();
      } else {
        // 切走旗舰：宽限保留，窗口到期时若仍没切回来才真正停进程
        if (kataKeepWarmTimerRef.current !== null) window.clearTimeout(kataKeepWarmTimerRef.current);
        kataKeepWarmTimerRef.current = window.setTimeout(() => {
          kataKeepWarmTimerRef.current = null;
          if (loadAiEngineChoice() === "kata") return;    // 窗口内已切回：什么都不做
          void stopNativeKataGo("mutex:switch-to-rapfi（宽限窗口到期）");
        }, KATA_KEEPWARM_MS);
      }
    }
    // 仅在档位变化时执行（探测结果不影响互斥方向）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEngineChoice]);
  const cancelAiRef = useRef(cancelActiveAiComputation);
  cancelAiRef.current = cancelActiveAiComputation;
  /**
   * KataGo 设置（线程/缓存/档位）变更后的重启编排。
   *
   * **改回 1.1.9 正式版的语义：只取消在算请求 + 停进程，不在这里预热。**
   *
   * 为什么不能在这里预热（用户 2026-10-10 报「切换所有东西后，点击打开分析才会开始加载并
   * 换配置，偏偏这样会有十几秒的延迟」）：这两个设置项**只在进程启动时读一次 cfg**，所以
   * 每次改动都必须换一个新进程。而曾经在这里接过一句 `.then(() => prewarmKataEngine())`，
   * 它带来两个后果：
   *   ① 用户每调一档（比如线程 16→8）都当场触发一次完整的引擎重载 —— 进程 spawn +
   *      ONNX Runtime 初始化 + 3.4MB 模型加载 + 标定，真机几十秒级。改三项就是三轮。
   *   ② 那轮重载**看不出任何进度**：重启链路不走切换浮层，用户只看到界面卡着。
   * 于是「改设置」这个本该轻快的动作变成了最重的一步。
   *
   * 1.1.9 的做法（在归档的正式版 APK `assets/public/assets/index-DUvBHHQO.js` 里逐字核对过）
   * 是**只停不启**：`LC(() => { rf.current('settings-change'); WS('settings-restart') })`
   * ——取消在算请求、`stop({reason})`、给各 worker 发 `kata-stopped`，就结束了。停进程本身
   * 是毫秒级的（Java 侧 `killProcess()` 后立刻 `call.resolve()`），所以改设置即时完成、
   * 不卡不等。真正要加载时（用户下一次点分析 / 切档），worker 的 `load()` 自然会按**新**
   * cfg 拉起新进程——配置该换的一件不少，只是把等待挪到用户真的要用引擎的那一刻。
   *
   * 停完那一刻的 `kataProcessReady = false` 是关键：它保证下一次分析不会误以为旧进程还
   * 可用而直接发命令（那样会打进一个配置已变的进程）。
   */
  useEffect(() => {
    setKataRestartHandler(() => {
      cancelAiRef.current("settings-change");
      void stopNativeKataGo("settings-restart");
    });
    return () => setKataRestartHandler(null);
  }, []);
  useEffect(() => () => {
    // 预览 URL 归 image-preview 缓存管，卸载时不手动 revoke。
    setImageImportPreview(null);
  }, []);
  /** 把「正在算但即将被顶掉」的那个局面的读数落进缓存（用户 09-19：胜率图不是实时的）。 */
  function flushLiveAnalysisToCache() {
    const live = liveAnalysisRef.current;
    if (!live || !enhancementSettings.analysisCache) return;
    // 当前局面还在算：让它自然完成（完成时会自己写缓存），这里不动。
    if (live.contextKey === currentPositionKey) return;
    liveAnalysisRef.current = null;
    setAnalysisCacheVersion((version) => version + 1);
    putAnalysisCacheEntry(live.documentId, live.nodeId, {
      ts: Date.now(), mover: live.mover, depth: live.depth, nodes: live.nodes,
      score: live.score, scoreAvailable: live.scoreAvailable, winRate: live.winRate,
      ...(live.engine ? { engine: live.engine } : {}),
    });
  }
  /**
   * 杀掉一个分析槽 worker，**同时把槽位清空**。
   *
   * 09-27 真机定位的头号根因：`thinkWorker` / `rapfiThinkWorker` 这两个 ref 在
   * 面板分析时指向的就是分析槽里那个常驻 worker（startThink 会赋值）。有些清理
   * 代码「顺手 terminate」它们，却没清槽——槽里留下一个已终止的 worker，下一次
   * startThink 看到 `slot.key` 仍然匹配就把它当活的复用，而 **postMessage 投进已
   * terminate 的 worker 是静默丢弃**（不报错、不抛异常、不进 onerror）。真机日志
   * 实锤：`app:startThink post gen=6` 之后 worker 侧的 analyze in / runKata /
   * cmd> 全部为 0，引擎却还在算旧局面（info move H7 visits 一路涨）——用户看到的
   * 就是「点一手没反应」「面板全是 -」「引擎只在第一次算」。
   * 所有要 terminate 分析槽 worker 的地方都必须走这里（配套还有 startThink 的
   * dead 兜底，双保险）。
   */
  function killAnalysisSlot(worker: Worker | null | undefined) {
    if (!worker) return;
    const idx = analysisPersistent.current.findIndex((slot) => slot?.worker === worker);
    if (idx >= 0) {
      const slot = analysisPersistent.current[idx];
      if (slot) slot.dead = true;
      analysisPersistent.current[idx] = null;
    }
    try { worker.terminate(); } catch { /* 已终止 */ }
  }
  /** 释放 thinkWorker / rapfiThinkWorker 指向的 worker（分析槽的会连带清槽）。 */
  function releaseThinkWorkerRefs() {
    killAnalysisSlot(thinkWorker.current);
    killAnalysisSlot(rapfiThinkWorker.current);
    thinkWorker.current = null;
    rapfiThinkWorker.current = null;
  }
  /**
   * 建一个分析槽条目，并把 worker.terminate 包一层：**任何一次终止都会把槽标记为
   * dead**，startThink 据此绝不复用（复用死 worker 就是「analyze 投进虚空」那个
   * bug 的成因）。这样即使将来又有别处忘了走 killAnalysisSlot，也不会静默失联。
   */
  function makeAnalysisSlot(key: string): { worker: Worker; key: string; controller: AiWorkerController; running: boolean; dead?: boolean } {
    const worker = createEngineWorker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`);
    const controller = new AiWorkerController((discarded) => {
      const idx = analysisPersistent.current.findIndex((s) => s?.worker === discarded);
      if (idx >= 0) analysisPersistent.current[idx] = null;
    });
    const slot = { worker, key, controller, running: false } as { worker: Worker; key: string; controller: AiWorkerController; running: boolean; dead?: boolean };
    // 所有分析槽都登记 ready；预热监听器可能被后续逻辑替换，但这个独立监听器
    // 保证 ready 不会因为 onmessage 归属变化而丢失。
    worker.addEventListener("message", (event: MessageEvent<{ type?: string; variant?: string }>) => {
      if (event.data?.type === "native-stopped" || event.data?.type === "kata-stopped") {
        readyEngineWorkers.current.delete(worker);
        return;
      }
      if (event.data?.type !== "ready") return;
      if (event.data.variant) readyEngineWorkers.current.set(worker, event.data.variant);
      if (!analysisPersistent.current.some((slot) => slot?.worker === worker && !slot.dead)) return;
      const target = engineSwitchTargetRef.current;
      if (!target || key !== engineSlotKeyFor(target, enginePackUrlRef.current)) return;
      handleEngineReadyEvent(event.data.variant, target);
    });
    const originalTerminate = worker.terminate.bind(worker);
    worker.terminate = () => { slot.dead = true; originalTerminate(); };
    return slot;
  }
  function cancelActiveAiComputation(reason: AiCancelReason, announce = false) {
    aiRequestRetry.current.cancel();
    // 这一轮到此为止：合流窗口里的待发帧一起作废。留着它会在停止/换手之后落地，
    // 把「thinking + 一堆读数」又写回面板（用户看到的是「停了还在动」）。
    analysisProgressPump.current?.reset();
    gameProgressPump.current?.reset();
    flushLiveAnalysisToCache();
    const activeKind = aiWorkerController.current.current?.kind;
    const controlledWorker = aiWorkerController.current.current?.worker;
    const analysisActiveBefore = analysisPersistent.current.some((slot) => Boolean(slot && !slot.dead && slot.controller.current));
    aiWorkerController.current.cancel(reason);
    // 分析双 slot 一并取消（persistent 不 terminate，物理搜索自然收尾；
    // running 标记保留到旧轮 accept，乒乓选择据此避开仍忙的 worker）。
    for (const slot of analysisPersistent.current) if (slot) slot.controller.cancel(reason);
    // 换手/落子（position-change）：旧局面的 WASM 轮已无意义——stop 消息会被
    // 同步搜索阻塞排队，等它自然收尾要 2s；只 terminate 正在跑的那个 slot，
    // 空闲 slot（已预热好引擎）保活——下次 startThink 立即在空闲实例上开算，
    // 免去手机 10-30s 冷加载（09-12 用户反馈「回退后思考停止」根因：旧实现把
    // 两个 slot 全杀，重启只剩冷 worker）。被杀的 slot 立即重建预热供下次乒乓。
    if (reason === "position-change" && aiEngineChoice !== "kata") {
      // **旗舰档不做乒乓重建（A 项持续制前提）**：引擎单例常驻，旧轮由 worker
      // 增量同步 + 原地打断处理；terminate 会杀掉正在分析的引擎。见 thinkRunning 分支。
      const packUrl = engineNeedsPack(aiEngineChoice) ? enginePackUrlRef.current : null;
      const rebuildKey = engineSlotKeyFor(aiEngineChoice, packUrl);
      const warmEngine = engineVariantFor(aiEngineChoice, packUrl);
      for (let i = 0; i < analysisPersistent.current.length; i += 1) {
        const slot = analysisPersistent.current[i];
        if (!slot?.running) continue;
        slot.worker.terminate();
        const rebuilt = makeAnalysisSlot(rebuildKey);
        rebuilt.worker.postMessage({ type: "warmup", engine: warmEngine, dataUrl: packUrl || undefined, multi: enhancementSettings.engineMultiThread, threads: enhancementSettings.engineThreads, bigCores: nativeEngineInfo()?.bigCores, native: nativeEngineUsable() });
        analysisPersistent.current[i] = rebuilt;
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

  // ---- 整局复盘（用户 09-17 第一梯队①） --------------------------------
  // 主线 = 从根沿 preferredChildId 走到底。逐「局面」（含最后一手之后的终局）
  // 给引擎一个有界搜索，样本记录黑方视角胜率 + 引擎最佳点；分档与讲解全部
  // 由 game-review.ts 的纯函数完成。
  const gameReviewMainline = (doc: GameDocument) => {
    const nodes: Array<{ nodeId: string; move: Position | null }> = [];
    let nodeId: string | undefined = doc.rootId;
    const seen = new Set<string>();
    while (nodeId && doc.nodes[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node: RecordNode = doc.nodes[nodeId];
      if (node.move || node.passPlayer) nodes.push({ nodeId: node.id, move: node.move ? { row: node.move.row, col: node.move.col } : null });
      nodeId = node.preferredChildId && node.children.includes(node.preferredChildId) ? node.preferredChildId : node.children[0];
    }
    return nodes;
  };
  const finishGameReview = (status: "done" | "error" | "idle", message?: string) => {
    const run = gameReviewRunRef.current;
    gameReviewRunRef.current = null;
    gameReviewWorkerRef.current?.worker.terminate();
    gameReviewWorkerRef.current = null;
    if (!run) { setGameReview({ status: "idle" }); return; }
    // 稀疏样本（中途停止）按前缀分档：buildReviewEntries 在第一个缺样本处停，
    // 所以把含 undefined 的数组断言成完整样本交给它是安全的。
    const entries = buildReviewEntries(run.samples as ReviewSample[], run.moveNodes, { openingLastMove: run.openingLastMove });
    const evaluated = run.samples.filter(Boolean) as ReviewSample[];
    if (entries.length >= 1 && evaluated.length >= 2) {
      saveStoredGameReview(run.documentId, { ts: Date.now(), totalMoves: run.moveNodes.length, samples: run.samples as ReviewSample[], entries });
      // 棋魂：跑完一局复盘（涨棋的主路径，给得比下棋多）。token 带完成时刻——
      // 同一份棋谱复盘多轮是真实的多次投入，各给一份（所以不像对弈只用 id）。
      /**
       * 棋魂：复盘**不再单独发**（2026-10-11）——理由与备份那处相同：
       * 用户在评审稿里把 `review` 从来源表删了，`soulAmount("review")` 返回 0，
       * 这一笔本来就发不出去。留一行"看起来在发、实际发 0"的代码只会误导下一个人。
       *
       * ⚠ 复盘仍然有回报：下面的 `progress.check()` 会给「复盘一次 / 复盘者」
       * 两条成就，成就奖励照发（那两条加起来 25 + 150）。所以"做完事有回报"没有丢。
       * 想恢复：把 `review` 补回 `SOUL_EARN_RULES` 并把这一行改回来。
       */
      // 成就：复盘样本刚落盘就判一次（判定引擎读的就是这份存储，无时序问题）。
      progress.check();
    }
    setGameReview({
      status,
      documentId: run.documentId,
      total: run.moveNodes.length,
      done: run.index,
      entries: entries.length ? entries : undefined,
      samples: evaluated.length ? evaluated : undefined,
      ...(message ? { message } : {}),
    });
  };
  const cancelGameReview = (announce = false) => {
    if (!gameReviewRunRef.current?.active) return;
    gameReviewWorkerRef.current?.controller.cancel("user");
    finishGameReview(gameReviewRunRef.current ? "done" : "idle", announce ? "复盘已停止，已完成部分已保留" : undefined);
  };
  const startGameReview = () => {
    if (gameReviewRunRef.current?.active) { setToast("复盘已在运行中"); return; }
    if (aiGame && !aiGame.outcome) { setToast("人机对局中不能复盘，请先退出对局"); return; }
    if (aiThinking || thinkRunning) { setToast("请先停止当前分析或思考，再开始复盘"); return; }
    if (isDynamicDatabaseView(document) || pagedSession.current) { setToast("大型数据库按局面加载，暂不支持整局复盘"); return; }
    if (!engineSupportsBoardSize(viewDocument.metadata.boardSize || 15)) { setToast("当前棋盘路数超出引擎支持范围，无法复盘"); return; }
    const doc = viewDocument;
    const moveNodes = gameReviewMainline(doc);
    if (moveNodes.length < 3) { setToast("主线手数太少，先下几手或换一份有内容的棋谱再复盘"); return; }
    const rootId = doc.nodes[moveNodes[0].nodeId]?.parentId || doc.rootId;
    const queue = [rootId, ...moveNodes.map((node) => node.nodeId)];
    cancelActiveAiComputation("superseded");
    gameReviewWorkerRef.current?.worker.terminate();
    const controller = new AiWorkerController(() => { });
    const worker = createEngineWorker(`${import.meta.env.BASE_URL}rapfi/rapfi-worker.js`);
    gameReviewWorkerRef.current = { worker, controller };
    const packUrl = engineNeedsPack(aiEngineChoice) ? enginePackUrlRef.current : null;
    gameReviewRunRef.current = { documentId: doc.id, active: true, queue, index: 0, samples: new Array(queue.length).fill(undefined), moveNodes,
      openingLastMove: openingProcedureLastMove(doc.metadata.openingRule),
      openingRuleLabel: doc.metadata.openingRule ? recordRuleDisplayName(doc.metadata).split(" · ")[0] : "", handle: null };
    setGameReview({ status: "running", documentId: doc.id, total: queue.length, done: 0 });
    const advance = () => {
      const run = gameReviewRunRef.current;
      if (!run?.active) return;
      if (run.index >= run.queue.length) { finishGameReview("done"); return; }
      const nodeId = run.queue[run.index];
      const mover = nextPlayerAt(doc, nodeId);
      // 与 startThink 同源的盘面输入：setup 石子必须随路径一起给引擎（识谱静态局面）。
      const moves = pathToNode(doc, nodeId).flatMap((node) => [
        ...(node.setup?.black ?? []).map((point) => ({ row: point.row, col: point.col, player: "black" as const })),
        ...(node.setup?.white ?? []).map((point) => ({ row: point.row, col: point.col, player: "white" as const })),
        ...(node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []),
      ]);
      const handle = controller.start(worker, "analysis", `${doc.id}/${nodeId}`, { persistent: true });
      run.handle = handle;
      worker.postMessage({
        type: "analyze", requestId: handle.requestId, generation: handle.generation,
        engine: packUrl ? "auto" : "fallback", dataUrl: packUrl || undefined,
        size: doc.metadata.boardSize || 15, moves, player: mover, rule: doc.metadata.rule,
        timeMs: Math.max(300, Math.min(5000, enhancementSettings.gameReviewBudgetMs)),
        maxDepth: enhancementSettings.analysisDepthMax > 0 ? enhancementSettings.analysisDepthMax : 96,
        topN: 1,
        // finishOnBareMove 必须关：复盘分档要每个局面的胜率，而空盘这类「平凡局面」
        // 引擎会不带任何 INFO（含 WINRATE）就秒答裸坐标——样本 0 缺胜率，分档整段
        // 消失（09-19 用户实测「只剩曲线、没有分档/讲解」）。杀棋仍有 stopOnProvenWin
        // 提前收手；其余局面跑满预算由 deadline 收尾，胜率稳定可读。
        finishOnBareMove: false, stopOnProvenWin: true,
        multi: enhancementSettings.engineMultiThread, threads: enhancementSettings.engineThreads,
        bigCores: nativeEngineInfo()?.bigCores, native: nativeEngineUsable(),
        maxMemoryMb: engineMemoryMbFor(aiEngineChoice, enhancementSettings.analysisMaxMemoryMb),
      });
    };
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: string; generation?: number; result?: AiMoveResult }>) => {
      const run = gameReviewRunRef.current;
      const state = gameReviewWorkerRef.current;
      if (!run?.active || !state) return;
      if (event.data.type === "error") { finishGameReview("error", "复盘引擎异常，已停止；可重试"); return; }
      if (event.data.type !== "result" || !event.data.result) return;
      if (!run.handle || !state.controller.isCurrent(run.handle, event.data.requestId || run.handle.requestId, event.data.generation ?? run.handle.generation)) return;
      state.controller.finish(run.handle);
      run.handle = null;
      const result = event.data.result;
      const nodeId = run.queue[run.index];
      const mover = nextPlayerAt(doc, nodeId);
      // winRate 是行棋方视角（0-1）→ 黑方视角百分数；引擎没报就留空（该手不参与分档）。
      const blackRateRaw = toBlackWinRate(result.winRate, mover);
      const blackRate = blackRateRaw === undefined ? undefined : Math.round(blackRateRaw * 1000) / 10;
      const primary = (result.candidates || []).find((candidate) => (candidate.pvIndex ?? 0) <= 0) || (result.candidates || [])[0];
      const best = primary?.move || result.move || null;
      run.samples[run.index] = {
        nodeId, mover,
        ...(blackRate !== undefined ? { blackWinRate: blackRate } : {}),
        best,
        provenWinForMover: result.scoreAvailable === true && (result.score || 0) >= 10000,
      };
      // 分析沉淀：复盘的每手评估同时进缓存（①②共用一份地基）。
      if (enhancementSettings.analysisCache) {
        setAnalysisCacheVersion((version) => version + 1);
        putAnalysisCacheEntry(doc.id, nodeId, {
          ts: Date.now(), mover,
          depth: result.depth || 0, selDepth: result.selDepth, nodes: result.nodes || 0,
          score: result.score, scoreAvailable: result.scoreAvailable, winRate: result.winRate,
          candidates: (result.candidates || []).slice(0, 3).map((candidate) => ({
            move: { row: candidate.move.row, col: candidate.move.col },
            ...(typeof candidate.score === "number" ? { score: candidate.score } : {}),
            ...(typeof candidate.winRate === "number" ? { winRate: candidate.winRate } : {}),
            ...(typeof candidate.depth === "number" ? { depth: candidate.depth } : {}),
          })),
        });
      }
      run.index += 1;
      setGameReview((current) => ({ ...current, done: run.index }));
      window.setTimeout(advance, 0);
    };
    worker.onerror = () => { if (gameReviewRunRef.current?.active) finishGameReview("error", "复盘引擎线程异常，已停止"); };
    advance();
  };
  // 换棋谱：停掉旧谱的复盘，并把已沉淀的结果装回面板。
  useEffect(() => {
    if (gameReviewRunRef.current?.active && gameReviewRunRef.current.documentId !== document.id) cancelGameReview(false);
    const stored = loadStoredGameReview(document.id);
    if (stored) setGameReview({ status: "done", documentId: document.id, total: stored.totalMoves, done: stored.entries.length, entries: stored.entries, samples: stored.samples });
    else setGameReview((current) => current.documentId === document.id && current.status !== "running" ? current : { status: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id]);

  // ---- 终局自动存档 + 直接进复盘（用户 09-17 第一梯队④） ----------------
  const aiGameResultText = (game: AiGameState): string => {
    if (game.outcome === "draw") return "和棋";
    const winner = game.outcome === "won" ? game.humanPlayer : game.aiPlayer;
    return `${winner === "black" ? "黑" : "白"}${aiClockExpired.current || aiReadOffExpired.current ? "超时胜" : "胜"}`;
  };
  /** 把已结束的对局写成棋谱库记录（结果/时限元数据一次写全）。同一局只落一次盘。 */
  const commitAiGameRecord = (): boolean => {
    const game = aiGame;
    if (!game || !game.outcome) return false;
    if (aiGameSavedRef.current === document.id) return false;
    const resultText = aiGameResultText(game);
    const timeLabel = game.timeLimitMs
      ? `${AI_TIME_OPTIONS.find((option) => option.value === game.timeLimitMs)?.title || formatTimeLimitLabel(game.timeLimitMs)}${game.readOffMs ? ` + ${game.readOffMs / 1000} 秒读秒` : ""}`
      : "";
    const committed: GameDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        title: `人机对战·${resultText}`,
        result: resultText,
        ...(timeLabel ? { timeLimit: timeLabel } : {}),
      },
      updatedAt: new Date().toISOString(),
      savedCurrentId: currentId,
    };
    setDocument(committed);
    setLibrary(saveToLibrary(committed));
    setSaved(true);
    aiGameSavedRef.current = committed.id;
    // 用户主动保存了：撤掉「不进库」的挡板（后面若还有编辑，走常规自动保存）。
    duelUnsavedDocIdRef.current = null;
    recordSession.current = { document: committed, currentId: committed.nodes[currentId] ? currentId : committed.rootId };
    return true;
  };
  useEffect(() => {
    if (!aiGame?.outcome || !enhancementSettings.aiGameAutoSave) return;
    if (commitAiGameRecord()) setToast("对局已存入棋谱库；结果横幅可一键复盘");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiGame?.outcome]);
  /**
   * 对弈会话落盘（用户 09-28：「如果对弈时候退出了，下次打开人机对战按钮时候，会弹窗是否
   * 回到上次对局，就是可以保存状态」）。整份棋谱一起存——对局棋谱默认**不进棋谱库**
   * （用户同轮决定「不主动保存就不入库」），库里没有落点，只存 id 的话用户中途新建一盘
   * 或清个库，回来就什么都找不到了。
   *
   * ⚠ 这里**不做去抖**，每次落子都同步写。理由正是用户担心的那件事的另一半：
   * 走完最后一手立刻杀进程时，去抖里待写的几百毫秒会让会话停在「上一手」——而上一手
   * 恰好是「轮到 AI」的局面，恢复方于是又调度一次 AI；轻则白烧一次算力，重则多落一手。
   * 一次写只是序列化一份几十节点的棋谱（毫秒级），换来的是「最后一手一定保住」。
   * 另外挂 pagehide / visibilitychange 兜住计时数字。
   */
  const duelPayload = useRef<{ game: AiGameState; document: GameDocument; currentId: string; clock: DuelSessionSnapshot["clock"] } | null>(null);
  duelPayload.current = aiGame ? {
    game: aiGame,
    document,
    currentId,
    clock: { humanElapsedMs: aiHumanElapsedMs, moveElapsedMs: aiMoveElapsedMs, expired: aiClockExpired.current, readOffExpired: aiReadOffExpired.current },
  } : null;
  const flushDuelSession = () => {
    const payload = duelPayload.current;
    if (!payload) return;
    saveDuelSession({
      savedAt: new Date().toISOString(),
      document: payload.document,
      currentId: payload.currentId,
      game: { ...payload.game, rule: payload.game.opening.rule },
      clock: payload.clock,
    });
  };
  useEffect(() => {
    // ⚠ 这里**不能**在 aiGame 变 null 时清快照：退出对弈（状态条的「退出」）本身就会把
    // aiGame 置空，那正是「下次还想接着下」的路径——清了就等于没有恢复功能。
    // 快照只在两处清：终局后点「完成」离开（这一局已经结束，没有恢复价值），
    // 以及在恢复弹窗里选「放弃这局」。新开一局会被下一次写入直接覆盖。
    if (!aiGame) return;
    flushDuelSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiGame, document, currentId]);
  useEffect(() => {
    // ⚠ 组件作用域里 `document` 是**当前棋谱**（GameDocument），要用浏览器那份必须走 window.document。
    const onHide = () => flushDuelSession();
    const onVisibility = () => { if (window.document.visibilityState === "hidden") flushDuelSession(); };
    window.addEventListener("pagehide", onHide);
    window.document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("pagehide", onHide); window.document.removeEventListener("visibilitychange", onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * 「复盘本局」：跳到终局 → 开分析面板 → 未复盘过就自动开跑。
   *
   * ⚠ 两处与旧版不同（用户 09-28：「用户如果不主动保存就不会进棋谱库」）：
   *  ① **不再静默落盘**——旧版这里为了「复盘结果能存进库里那条记录」先偷偷 commit 一次，
   *    等于用户没点保存棋谱就多了个文件。复盘结果的沉淀是按 documentId 存在本机的
   *    （`loadStoredGameReview`），不入库也照样能用。
   *  ② 复盘用的是打谱侧的分析面板，所以**显式切回打谱页**：从对弈界面点「复盘」时
   *    若只 setDockPanel("analysis")，那块面板所在的页面根本没渲染，点了像没反应。
   */
  const openReviewAfterGame = () => {
    if (!aiGame?.outcome) return;
    cancelActiveAiComputation("user");
    setTab("record");
    goPreferredEnd();
    setSheet(null);
    setDockPanel("analysis");
    setAnalysisPanelTab("review");
    if (!loadStoredGameReview(document.id) && !gameReviewRunRef.current?.active) startGameReview();
  };
  // Board 是 memo 组件：回调身份必须稳定，否则每次渲染都会击穿 memo 重绘整盘
  // 225 格（09-15 iOS 跟手性修复的同一坑）。latest-ref 模式。
  const openReviewAfterGameRef = useRef(openReviewAfterGame);
  openReviewAfterGameRef.current = openReviewAfterGame;
  const openReviewStable = useCallback(() => openReviewAfterGameRef.current(), []);

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
      /* 「自定义背景」把**界面**交给用户选的界面主题（用户 2026-10-12）：
         `data-theme` 取所选主题（令牌、顶栏、面板、控件全随它），另挂 `data-custom-bg`
         让主题自己的盘面底色与场景装饰让位给自定义背景（样式见 styles.css 那段）。
         非自定义时行为与改动前一模一样：`data-theme` 就是解析出来的主题。 */
      const appliedTheme: ResolvedTheme = nextTheme === "custom" ? customUiTheme : nextTheme;
      const root = globalThis.document?.documentElement;
      root?.setAttribute("data-theme", appliedTheme);
      if (root) {
        if (nextTheme === "custom") root.setAttribute("data-custom-bg", "1");
        else root.removeAttribute("data-custom-bg");
      }
      // 深色主题清单在 theme-options.ts（单一来源）——原名单位里写死的这份
      // **漏了 blackgold / aurora / deepsea / pelican**，导致那四套的原生控件
      // （输入框/下拉/滚动条）一直按浅色渲染。详见 DARK_THEME_IDS 的注释。
      // ⚠ 判深色要用 **appliedTheme**（自定义背景时是所选界面主题）：判 `custom` 恒为浅色，
      //   用户选了深色界面主题时原生控件会错成浅色。
      if (globalThis.document) globalThis.document.documentElement.style.colorScheme = isDarkTheme(appliedTheme) ? "dark" : "light";
      // 系统栏是透明的（原生 enableEdgeToEdge），图标深浅必须跟着界面主题走，
      // 否则用户换深色主题时状态栏图标会隐形。
      applySystemBars(enhancementSettings.fullScreenMode, isDarkTheme(appliedTheme));
    };
    applyTheme();
    // 预览期间不落盘（见 appearancePreviewing 的注释）
    if (!appearancePreviewing) {
      try { localStorage.setItem(THEME_PREFERENCE_KEY, themePreference); } catch { /* ignore unavailable storage */ }
      saveCustomUiTheme(customUiTheme);
    }
    if (!media) return undefined;
    const onSystemThemeChange = () => { if (themePreference === "system") applyTheme(); };
    if (media.addEventListener) media.addEventListener("change", onSystemThemeChange);
    else media.addListener?.(onSystemThemeChange);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", onSystemThemeChange);
      else media.removeListener?.(onSystemThemeChange);
    };
  }, [themePreference, customUiTheme, enhancementSettings.fullScreenMode]);
  useEffect(() => {
    banbuAudio.setSettings(soundSettings);
    saveSoundSettings(soundSettings);
  }, [soundSettings]);
  useEffect(() => {
    if (globalThis.document) globalThis.document.documentElement.dataset.motion = motionEnabled ? "on" : "off";
    saveMotionEnabled(motionEnabled);
  }, [motionEnabled]);
  /* 功能区按钮透明度的"整十档"写到 <html> 上：
     老 WebView（K20 实测）不支持 calc() / color-mix()，算不出 `--action-opacity` 的乘积，
     legacy-webview.css 里用 `[data-action-alpha="NN"]` 的属性选择器兜住那几个档位。
     这里与 --action-opacity 同步更新，两者永远一致（就近取整到 10%）。 */
  useEffect(() => {
    if (!globalThis.document) return;
    globalThis.document.documentElement.dataset.actionAlpha = String(Math.round(actionOpacity * 10) * 10);
  }, [actionOpacity]);
  /* 顶栏/底栏 + **功能区按钮/卡片**的底色都要跟着透明度调（用户 2026-10-09：
     「金刚页」也要跟着调节；后续又发现"只修复了一半"）。
     老内核不能把 hex 拆成 rgba、也没有 color-mix，所以在 JS 里合成好再写进 CSS 变量：
       `--paper-with-alpha` / `--line-with-alpha`        —— 顶栏/底栏
       `--action-surface` / `--action-border`            —— 面板按钮、常驻操作区、设置卡片
     主题切换或透明度变化都要重算 —— 依赖里带上 resolvedTheme（自定义背景时界面色随
     customUiTheme，所以它也进依赖；否则选了新界面主题这一处不重算、按钮底色停在旧主题）。
     ⚠ 这里必须写到 **documentElement**（不是 .app-shell）：action-opacity.css 里也有同名变量的
       兜底定义（`var(--surface)`），内联样式的优先级高于样式表，所以 JS 的值一定生效。
     ⚠ 读色也要从 documentElement 读：`--surface` / `--paper` 都定义在 :root 上，
       而深色/材质主题的 `--surface` 带 alpha（如 deepsea #142a31e8）——
       withAlpha 会把自带的 alpha 与用户透明度**相乘**，不会把半透明块写成全不透明。 */
  useEffect(() => {
    if (!globalThis.document) return;
    const root = globalThis.document.documentElement;
    const read = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    const paper = read("--paper");
    const line = read("--line");
    const surface = read("--surface") || paper;
    const surfaceBorder = read("--surface-border") || line;
    root.style.setProperty("--paper-with-alpha", withAlpha(paper, actionOpacity));
    root.style.setProperty("--line-with-alpha", withAlpha(line, actionOpacity));
    root.style.setProperty("--action-surface", withAlpha(surface, actionOpacity));
    root.style.setProperty("--action-border", withAlpha(surfaceBorder, actionOpacity));
    applyLegacyThemeColors(root);
  }, [actionOpacity, resolvedTheme, customUiTheme]);
  // 公用效果（落子交互 / 棋子进场）设置：写 localStorage，并把选中方案的 CSS 注入 head。
  // 与 Board 里 material-motion-css 同一套「内容没变就不重写」的做法 —— 重写 textContent
  // 会让所有在跑的 @keyframes 从 0 重来（项目踩过的坑）。总开关为关或全局动效为关时不注入。
  useEffect(() => { saveMotionEffectsSettings(motionEffects); }, [motionEffects]);
  useEffect(() => {
    const dom = window.document;
    const id = "effect-motion-css";
    const css = motionEnabled ? [
      motionEffects.placeOn ? findPlaceEffect(motionEffects.placeId).css(motionEffects.placeId) : "",
      motionEffects.dropOn ? findDropEffect(motionEffects.dropId).css(motionEffects.dropId) : "",
    ].filter(Boolean).join("\n") : "";
    let el = dom.getElementById(id) as HTMLStyleElement | null;
    if (!css) { el?.remove(); return; }
    if (!el) { el = dom.createElement("style"); el.id = id; dom.head.appendChild(el); }
    if (el.textContent !== css) el.textContent = css;
    return () => { dom.getElementById(id)?.remove(); };
  }, [motionEnabled, motionEffects.placeOn, motionEffects.placeId, motionEffects.dropOn, motionEffects.dropId]);
  // 色觉友好配色：开关状态挂到 <html> 上，样式表按 html[data-color-vision="friendly"] 覆盖。
  useEffect(() => {
    if (!globalThis.document) return;
    if (enhancementSettings.colorVisionFriendly) globalThis.document.documentElement.dataset.colorVision = "friendly";
    else delete globalThis.document.documentElement.dataset.colorVision;
  }, [enhancementSettings.colorVisionFriendly]);
  useEffect(() => { saveEnhancementSettings(enhancementSettings); }, [enhancementSettings]);
  // 「在线」入口常驻（用户 09-26），原来那条「开关关掉时把在线面退回棋谱面」的效应随之删除。
  // 10-04 又把开关加回来了（群友要求），所以那条退回效应跟着回来：关掉入口时如果正停在
  // 在线页，必须退回「棋谱」，否则用户会对着一个没有页签支撑的面板。
  useEffect(() => {
    if (!enhancementSettings.libraryOnlineEntry) setLibrarySection((current) => (current === "online" ? "records" : current));
  }, [enhancementSettings.libraryOnlineEntry]);
  useEffect(() => { saveReviewMarks(reviewMarks); }, [reviewMarks]);
  useEffect(() => { saveReviewBranchNames(reviewBranchNames); }, [reviewBranchNames]);
  useEffect(() => { saveFontScale(fontScale); }, [fontScale]);
  useEffect(() => { try { localStorage.setItem(DEFAULT_BOARD_SIZE_KEY, String(defaultBoardSize)); } catch { /* optional storage */ } }, [defaultBoardSize]);
  useEffect(() => {
    try {
      // 预览期间不落盘（同上）
      if (!appearancePreviewing) {
        localStorage.setItem(BOARD_THEME_KEY, boardTheme);
        localStorage.setItem(STONE_THEME_KEY, stoneTheme);
      }
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
  /**
   * 旗舰引擎**按规则换网**（用户 2026-10-12）。
   *
   * 网的类别只有两个：连珠（有禁手）用 r15、freestyle/standard 用 f15；而网是**启动参数**，
   * KataGo 没有运行期换网的命令 —— 所以规则类别一变就得写贴纸 + 停进程，等下一次真要用时
   * 按新网加载（与线程/缓存、档位变更同一条「只停不启」链路）。实现见 features/ai/kata-net.ts。
   *
   * 规则取自 `viewDocument.metadata.rule`：**分析**（下面那个 analyze 请求）与人机**对弈**
   * （AI 那一步读的也是 document 的 metadata.rule）读的是同一处，所以一个来源就够。
   *
   * ⚠ 只在选了旗舰档时动作：换网会**取消正在算的分析**（restart handler 就干这个），
   *   若用户跑的是 Rapfi/云端，跟着调会平白打断他 —— Rapfi 与网无关，不参与换网。
   */
  useEffect(() => {
    if (aiEngineChoice !== "kata") return;
    void ensureKataNetForRule(viewDocument.metadata.rule);
  }, [aiEngineChoice, viewDocument.metadata.rule]);
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
  /* 识谱 / 坐标代码建的是**静态摆拍局面**：石子在 node.setup 里、没有手序，`nextPlayerAt` 只能按
     黑白子数奇偶猜轮到谁（App 里那句 `black.length > white.length ? "white" : "black"`）。
     猜成白方时下面这条门禁会把整条禁手辅助抹掉——用户明明开了「禁手辅助」却什么都不显示
     （群友 10-04 报：图片导入的棋谱不显示禁手点，实测 43 子的图就是这样）。
     静态局面没有"该谁走"的事实可言，所以这一类不看轮次，只看规则里有没有禁手。 */
  const isStaticSetupPosition = !current.move && Boolean(current.setup?.black?.length || current.setup?.white?.length);
  // 打谱/读谱：只要「禁手辅助」开着、轮到黑方（或这是静态摆子局面）就标。
  // ⚠ 这里**不再要求棋谱的规则字段是 renju**（2026-10-06 用户报障：五林能标我们标不出）。
  // 棋谱里的 RU 常常是 freestyle 或干脆没有——尤其摆子局面（题库/题）与外来 SGF；
  // 用户要看的是"按连珠口径，黑方哪些点是禁手"，那是**显示层**的事，不该被一个常错、
  // 且与"这盘棋怎么判胜负"无关的元数据字段封杀。规则字段仍然决定落子是否禁手/胜负判定。
  const canRenderForbiddenAssistance = mode === "puzzle"
    ? !puzzleSetup && currentPuzzleRule.mode === "forbidden" && currentPuzzle?.player === "black" && !aiThinking && !puzzleOutcome
    : !aiThinking && !aiGame?.outcome && !boardWinningLines.length && (aiGame ? aiGame.forbiddenEnabled && nextPlayer === "black" : (isStaticSetupPosition || activePlacementPlayer === "black") && !compactIndexOf(document) && !isDynamicDatabaseView(document) && !isPagedLibraryView(document));
  // 禁手点辅助是**叠加提示**，不该拖住落子本身：全盘扫描要为每个空点跑一次禁手判定
  // （15 路实测 65–85ms），原先放在 render 里的 useMemo 会把棋子出现推迟到算完——
  // 用户感受到的就是「落子有延迟」，而且只在「这一手之后轮到黑方」时出现（因为禁手
  // 只对黑方算），所以是隔一手卡一下。这里改成先让棋子落到画面上，下一帧再补提示：
  // 提示晚一帧没人看得出来，落子晚一帧手感就完全不一样。
  const [boardForbiddenMarkers, setBoardForbiddenMarkers] = useState<Array<Position & { reason: string }>>([]);
  useEffect(() => {
    if (!showForbidden || !canRenderForbiddenAssistance) {
      setBoardForbiddenMarkers((previous) => (previous.length ? [] : previous));
      return;
    }
    let cancelled = false;
    let timer = 0;
    // rAF 之后再排队：保证这一帧先把棋子画出去，再在下一个任务里算提示。
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => { if (!cancelled) setBoardForbiddenMarkers(forbiddenPoints(board)); }, 0);
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); if (timer) window.clearTimeout(timer); };
  }, [showForbidden, canRenderForbiddenAssistance, board]);
  useEffect(() => { (window as unknown as Record<string, unknown>).__fbd = { showForbidden, canRender: canRenderForbiddenAssistance, markers: boardForbiddenMarkers.length, rule: viewDocument.metadata.rule, mode, nextPlayer, placementLocked, placementPlayer: activePlacementPlayer, aiThinking }; });
  const aiOpeningStage = aiGame?.opening.stage;
  // 开局横幅文案：AI 正在自己落子/决策时如实说明轮到 AI，避免横幅催人类落子而棋盘
  // 又是 disabled 的（点上去毫无反应，会被读成「判定坏了」）。只在 AI 自己的 place/swap
  // 回合覆盖；offer-fifths 等「等人类操作」的阶段必须保留原提示。
  const aiOpeningBannerText = aiThinking && (aiOpeningStage?.kind === "place" || aiOpeningStage?.kind === "swap")
    ? (aiOpeningStage.kind === "place" ? `AI 正在落第 ${aiOpeningStage.moveNumber} 手…` : "AI 正在决定是否交换黑白方…")
    : null;
  // KataGo 式常亮：持续分析激活期间（analysisAuto 开且当前面在分析中）思考
  // 指示保持显示，不再每轮 accept 间隙闪一下（用户 09-11 观察实锤 2s 一眨眼）。
  const humanCanUseOpeningBoard = aiOpeningStage?.kind === "place" || aiOpeningStage?.kind === "batch" ? aiOpeningStage.actor === "human" : aiOpeningStage?.kind === "offer-fifths" ? aiOpeningStage.actor === "human" : aiOpeningStage?.kind === "choose-fifth" ? aiOpeningStage.chooser === "human" : false;
  const historicalAiPosition = Boolean(aiGame && currentId !== recordSession.current.currentId);
  /**
   * 「自定义开局」还在**摆子阶段**（用户 2026-10-13：先选有禁无禁 → 自己摆棋子 → 随时点开始）。
   * 这一步没有对局，只有局面，所以三件事必须一起压住：
   *  ① 棋盘不许按"轮到 AI"禁用（落点分派走 `play()` 里的摆子分支）；
   *  ② AI 一律不许点火 —— 看门狗、`startAiGameReply`、开局调度三处都排除（摆的黑白是轮流落的，
   *    颜色随时可能"轮到 AI 的颜色"，不压住就会出现"我还在摆，它自己落子了"）；
   *  ③ 时钟不许走（摆子不是想棋，摆十分钟也不该判超时）。
   */
  const duelSetupPhase = Boolean(aiGame?.customOpening && !aiGame.customStarted);
  const aiBoardDisabled = Boolean(aiGame && !duelSetupPhase && (aiThinking || aiGame.outcome || (aiOpeningStage?.kind === "normal" ? !historicalAiPosition && nextPlayer !== aiGame.humanPlayer : !humanCanUseOpeningBoard)));
  const aiLivePosition = Boolean(aiGame && currentId === recordSession.current.currentId);
  const aiHumanTurn = aiGame?.opening.stage.kind === "normal"
    ? aiLivePosition && nextPlayer === aiGame.humanPlayer
    : aiLivePosition && humanCanUseOpeningBoard;
  const aiClockActive = Boolean(aiGame && !duelSetupPhase && !aiGame.outcome && !aiThinking && aiHumanTurn && !aiClockExpired.current);
  const currentPositionKey = useMemo(() => `${document.id}/${currentId}/${positionKey(board, nextPlayer, false)}`, [document.id, currentId, board, nextPlayer]);
  // KataGo 式常亮：持续分析激活期间（analysisAuto 开且当前面在分析中）思考
  // 指示保持显示，不再每轮 accept 间隙闪一下（用户 09-11 观察实锤 2s 一眨眼）。
  const machineThinking = aiThinking || thinkRunning || (enhancementSettings.analysisAuto && !enhancementSettings.analysisSelfPlay && !enhancementSettings.analysisHintMode && aiAnalysis.contextKey === currentPositionKey);
  /** `at` = 这一次动效归属的节点 id（新落那一手 / 复用到的那一手）。
   *  ⚠ 必须传：Board 只给「`current.id === motion.at` 的那一枚」挂进场类并让它重挂。
   *    早先只按 `isLast` 判定，于是撤销/重做/回退这类「光标自己动、没落子」的路径
   *    会把上一个事件留下的 place 态套到已经在场上的棋子上 —— 实测点「撤销编辑」
   *    那颗前一手的老子会再弹一次落子动画（用户 10-03 报的「点一下又重播」同源）。 */
  const triggerBoardMotion = (kind: Exclude<BoardMotionKind, null>, at: string | null) => {
    if (!motionEnabled) return;
    setBoardMotion((state) => ({ kind, version: state.version + 1, at }));
  };
  const clearBoardMotion = () => setBoardMotion((state) => ({ kind: null, version: state.version, at: null }));
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
    aiReadOffExpired.current = false;
    setAiHumanElapsedMs(0);
    setAiMoveElapsedMs(0);
  }, [aiGame]);
  useEffect(() => {
    if (aiGame?.outcome) return;
    aiReadOffExpired.current = false;
  }, [aiGame?.outcome]);
  // 每手读秒（用户 09-17）：只在「活局 + 活局面 + 轮到你 + AI 没在思考」累计。
  // 回合重新开始（落子 / 回退重下 / 导航回到活局面）读秒从零起算。
  const aiReadOffActive = Boolean(aiGame && !aiGame.outcome && (aiGame.readOffMs || 0) > 0 && aiLivePosition && nextPlayer === aiGame.humanPlayer && !aiThinking);
  useEffect(() => {
    if (!aiReadOffActive) { aiMoveLastAt.current = null; return; }
    setAiMoveElapsedMs(0);
    aiMoveLastAt.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const previous = aiMoveLastAt.current ?? now;
      aiMoveLastAt.current = now;
      setAiMoveElapsedMs((elapsed) => Math.min(aiGame?.readOffMs || 0, elapsed + Math.max(0, now - previous)));
    }, 200);
    return () => { window.clearInterval(timer); aiMoveLastAt.current = null; };
  }, [aiReadOffActive, aiGame?.readOffMs, currentId]);
  useEffect(() => {
    if (!aiGame || !aiGame.readOffMs || aiGame.outcome || aiReadOffExpired.current || aiMoveElapsedMs < aiGame.readOffMs) return;
    aiReadOffExpired.current = true; aiGameEndReason.current = "读秒超时";
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    puzzleAiWorker.current?.terminate(); puzzleAiWorker.current = null;
    rapfiGameWorker.current?.terminate(); rapfiGameWorker.current = null;
    setAiThinking(false);
    setAiGame((game) => game ? { ...game, outcome: "lost" } : game);
    playSound("error");
    setToast("本手读秒超时，本局结束");
  }, [aiGame, aiMoveElapsedMs]);
  useEffect(() => {
    if (!aiGame || aiGame.timeLimitMs <= 0 || aiGame.outcome || aiClockExpired.current || aiHumanElapsedMs < aiGame.timeLimitMs) return;
    aiClockExpired.current = true; aiGameEndReason.current = "包干超时";
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
  // 候选点展示数组：以前直接在 Board 调用点 rank+slice，父组件每次渲染都得到
  // 新数组引用——即使坐标/指标文本/胜负色调完全没变，也会击穿 Board 的 memo
  //（引擎进度每 100ms 一次，2 秒里白白把整盘 225 格重渲染 ~20 次，iOS 上体感
  // 就是落子不跟手）。这里按「展示内容签名」记忆化：签名不变就复用旧引用、Board
  // 直接跳过；内容真变了（候选集/指标文本/色调变化）才换引用放行更新，视觉与
  // 之前完全一致。签名不含 depth/nodes——棋盘标记不展示它们，纯进度爬升不应重绘。
  // 防御性过滤（09-27 真机截图实锤）：候选点若已被占（盘面推进比引擎快、或引擎
  // 盘面短暂落后），一律不进展示——棋盘标记本来就会跳过被占点，候选列表此前没有
  // 过滤，出现「已占的点挂着数值」的诡异观感（用户一看就知道不对）。
  // **局面守卫（10-01 用户报「落子后旧选点残余」）**：这里是棋盘标记与选点列表的
  // 唯一候选来源，源头就把「非本局面」的候选整批作废——旧一帧还没被新一帧覆盖、
  // 或换手清空还没跑到时，落子瞬间旧标记必须立刻消失（参考软件落子即 analysisData
  // = null，同语义）。rankedAnalysisCandidates 里的 key 比较因此从「双保险」变成
  // 「兜底」，真正的拦截在源头完成。
  const unoccupiedAnalysisCandidates = useMemo(
    () => (aiAnalysis.contextKey === currentPositionKey ? aiAnalysis.candidates || EMPTY_ANALYSIS_CANDIDATES : EMPTY_ANALYSIS_CANDIDATES).filter((candidate) => {
      const row = board[candidate.move.row];
      return !(row && row[candidate.move.col]);
    }),
    [aiAnalysis.contextKey, aiAnalysis.candidates, currentPositionKey, board],
  );
  const rankedAnalysisCandidates = useMemo(
    () => (!aiGame && enhancementSettings.analysisShowCandidates && aiAnalysis.contextKey === currentPositionKey)
      ? rankAnalysisCandidates(unoccupiedAnalysisCandidates, analysisShownMetric).slice(0, enhancementSettings.analysisCandidateCount)
      : EMPTY_ANALYSIS_CANDIDATES,
    [aiGame, enhancementSettings.analysisShowCandidates, aiAnalysis.contextKey, aiAnalysis.candidates, currentPositionKey, analysisShownMetric, enhancementSettings.analysisCandidateCount],
  );
  const analysisCandidatesSignature = rankedAnalysisCandidates
    .map((candidate) => `${candidate.move.row},${candidate.move.col},${analysisMetricText(candidate, analysisShownMetric, enhancementSettings.analysisCandidateDecimals)},${analysisCandidateTone(candidate, analysisShownMetric)}`)
    .join("|");
  const boardAnalysisCandidates = useMemo(
    () => rankedAnalysisCandidates,
    // 有意只依赖内容签名：签名不变就复用上一次的数组引用（见上方说明）。
    [analysisCandidatesSignature], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
  /**
   * 跨谱局面检索的可扫集合：**剔掉懒加载源**（DP/DB 库、RenLib 网页核心读的 .lib）。
   *
   * 为什么（2026-10-10 排查）：`findPositionMatches` 是深度遍历 `document.nodes`，
   * 而懒加载源的文档只是投影（九天指南 905/107242），扫出来的结果是**子集的**，
   * 界面却写「已扫描 N 份本地棋谱的主线和全部变化」——用户会以为搜全了。
   * 剔掉之后下面那行如实写明跳过了几份，比给一个看不出问题的数字诚实。
   */
  const positionScanDocuments = useMemo(
    () => searchableDocuments.filter((item) => !isDynamicDatabaseView(item) && !isPagedLibraryView(item) && !compactIndexOf(item)),
    [searchableDocuments],
  );
  const positionScanSkipped = searchableDocuments.length - positionScanDocuments.length;
  // A loaded large document is represented by its summary in the selector.
  // Remove the partial in-memory copy from the regular list so the current
  // item is shown once with its database metadata and accurate count.
  const selectorRecords = useMemo(() => {
    const largeIds = new Set(largeSummaries.map((item) => item.id));
    return searchableDocuments.filter((item) => !largeIds.has(item.id));
  }, [largeSummaries, searchableDocuments]);
  const positionMatches = useMemo(() => sheet === "positionSearch" ? findPositionMatches(positionScanDocuments, board, nextPlayer, matchSymmetry) : [], [sheet, positionScanDocuments, board, nextPlayer, matchSymmetry]);
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
      // 隐藏的题集连搜索也不参与（用户主动把它收起来了，除非去设置里恢复）。
      if (hiddenPuzzleCollectionIds.includes(collection.id)) return [];
      if (!query) return [{ collection, puzzles: collection.puzzles, collectionIndex }];
      const collectionMatches = [collection.title, collection.source, collection.license].some((value) => value.toLowerCase().includes(query));
      const puzzles = collectionMatches ? collection.puzzles : collection.puzzles.filter((puzzle) => [puzzle.title, puzzle.prompt, puzzle.id, puzzle.player === "black" ? "黑先" : "白先"].some((value) => value.toLowerCase().includes(query)));
      return puzzles.length ? [{ collection, puzzles, collectionIndex }] : [];
    });
  }, [puzzleCollections, libraryQuery, hiddenPuzzleCollectionIds]);
  const batchSelectedDocuments = useMemo(() => library.filter((item) => batchSelectedIds.includes(item.id)), [library, batchSelectedIds]);
  // 选中的大型库（LIB/DP/DB）：批量导出是 SGF 打包，它们转不了，要如实列出而不是静默跳过。
  const skippedBatchItems = useMemo(
    () => batchSelectedIds
      .filter((id) => !library.some((item) => item.id === id))
      .map((id) => largeSummaries.find((summary) => summary.id === id)?.metadata.title || id),
    [batchSelectedIds, library, largeSummaries],
  );
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

  // ---- 题库改造（用户 2026-09-21）：单题编辑、隐藏、合并拆分 -------------------
  //
  // 撤销只保留最近一次删除类操作（单题删除、合并、拆分）。这些操作全部只改
  // puzzleCollections 这一个数组，所以「把操作前的整份数组存起来」就是完整快照
  // ——题集数量在几百的量级，一份引用不吃内存。任何一次新的改动都会作废上一个
  // 快照，避免撤销撤到用户没预期的中间态。
  const pushPuzzleUndo = (label: string) => {
    puzzleUndoRef.current = { collections: puzzleCollections, label, folderAssignments: libraryFolders.puzzleAssignments };
  };
  /** 题库数据统一从这里落盘：state + localStorage 必须同步，漏一处就会出现「界面已改、重开又回来」。 */
  const commitPuzzleCollections = (next: PuzzleCollection[]) => { savePuzzleCollections(next); setPuzzleCollections(next); };
  const undoPuzzleEdit = () => {
    const undo = puzzleUndoRef.current;
    if (!undo) { setToast("没有可撤销的题库改动"); return; }
    commitPuzzleCollections(undo.collections);
    setLibraryFolders((folders) => ({ ...folders, puzzleAssignments: undo.folderAssignments }));
    puzzleUndoRef.current = null;
    setToast(`已撤销${undo.label}`);
  };

  const hidePuzzleCollection = (collection: PuzzleCollection) => {
    setHiddenPuzzleCollectionIds((ids) => ids.includes(collection.id) ? ids : [...ids, collection.id]);
    if (managedPuzzleCollectionId === collection.id) setManagedPuzzleCollectionId(null);
    setToast(`已隐藏题集“${collection.title}”，可在设置 →「题库管理」里恢复显示`);
  };

  const deletePuzzle = (collection: PuzzleCollection, puzzle: Puzzle) => {
    if (!window.confirm(`确认从“${collection.title}”中删除题目“${puzzle.title}”？该题的做题进度也会一并清除。`)) return;
    pushPuzzleUndo(`删除题目“${puzzle.title}”`);
    commitPuzzleCollections(puzzleCollections.map((item) => item.id === collection.id ? removePuzzleFromCollection(item, puzzle.id) : item));
    const pruned = prunePuzzleRecords(puzzleProgress, puzzleOverlays, puzzleReviewQueue, collection.id, puzzle.id);
    setPuzzleProgress(pruned.progress);
    setPuzzleOverlays(pruned.overlays);
    setPuzzleReviewQueue(pruned.queue);
    setFavorites((current) => pruneFavorites(current, [], [], [[collection.id, puzzle.id]]));
    setToast(`已删除题目“${puzzle.title}”`);
  };

  const movePuzzleToCollection = (collection: PuzzleCollection, puzzle: Puzzle, targetId: string) => {
    const target = puzzleCollections.find((item) => item.id === targetId);
    if (!target || target.id === collection.id) return;
    pushPuzzleUndo(`移动题目“${puzzle.title}”`);
    const moved = movePuzzleBetweenCollections(collection, target, puzzle.id);
    commitPuzzleCollections(puzzleCollections.map((item) => item.id === collection.id ? moved.from : item.id === target.id ? moved.to : item));
    setToast(`已把“${puzzle.title}”移到“${target.title}”`);
  };

  const openPuzzleEdit = (collection: PuzzleCollection, puzzle: Puzzle) => {
    setSheet("puzzleEdit");
    setPuzzleEditTarget({
      collectionId: collection.id, puzzleId: puzzle.id, title: puzzle.title, prompt: puzzle.prompt,
      difficulty: puzzle.difficulty, player: puzzle.player,
      // 空串 = 继承题集规则（题目级 rule 为空时由 resolvePuzzleRule 落到题集/偏好）。
      rule: puzzle.rule || "",
    });
  };

  const confirmPuzzleEdit = () => {
    const target = puzzleEditTarget;
    if (!target) return;
    const title = target.title.trim();
    if (!title) { setToast("题目名称不能为空"); return; }
    const collection = puzzleCollections.find((item) => item.id === target.collectionId);
    if (!collection) { setPuzzleEditTarget(null); return; }
    // 规则用「继承题集」的空串表达：写 undefined 而不是删除字段，才能把已有题目级规则改回继承。
    const patch: PuzzleEditPatch = { title, prompt: target.prompt.trim() || "从这个局面开始练习", difficulty: target.difficulty, player: target.player, rule: target.rule === "" ? undefined : target.rule };
    commitPuzzleCollections(puzzleCollections.map((item) => item.id === collection.id ? updatePuzzleInCollection(item, target.puzzleId, patch) : item));
    setPuzzleEditTarget(null); setSheet(null);
    setToast("题目已更新");
  };

  /** 把当前棋盘局面加进指定题集（与「保存到题库」共用同一套字段口径）。 */
  const addCurrentPositionToPuzzleCollection = (collectionId: string) => {
    const collection = puzzleCollections.find((item) => item.id === collectionId);
    if (!collection) { setPuzzleAddTargetId(null); return; }
    const stones = board.flatMap((row, rowIndex) => row.flatMap((player, colIndex) => player ? [{ row: rowIndex, col: colIndex, player }] : []));
    if (!stones.length) { setToast("当前棋盘是空的，先摆出局面再加题"); return; }
    pushPuzzleUndo("添加题目");
    const puzzle = createPuzzleFromBoard({
      id: nextPuzzleId(collection),
      title: `第 ${collection.puzzles.length + 1} 题`,
      prompt: "从这个局面开始练习",
      player: activePlacementPlayer,
      stones,
      boardSize: document.metadata.boardSize || 15,
      ...(document.metadata.rule ? { rule: document.metadata.rule } : {}),
    });
    commitPuzzleCollections(puzzleCollections.map((item) => item.id === collection.id ? addPuzzlesToCollection(item, [puzzle]) : item));
    setPuzzleAddTargetId(null); setSheet(null);
    setManagedPuzzleCollectionId(collection.id);
    setToast(`已加入“${collection.title}”：${puzzle.title}`);
  };

  const confirmPuzzleMerge = () => {
    const ids = puzzleBatchSelectedIds.filter((id) => puzzleCollections.some((collection) => collection.id === id));
    if (ids.length < 2) { setToast("请选择至少两个题集再合并"); return; }
    pushPuzzleUndo("合并题集");
    const merged = mergeCollections({
      collections: puzzleCollections,
      ids,
      result: { id: `merged-${Date.now().toString(36)}`, title: "合并题集", source: "半步五子棋打谱本地保存", license: "用户本地" },
      dedupe: puzzleMergeDedupe,
    });
    commitPuzzleCollections(merged.collections);
    // 合并题集落在第一个来源题集所在的文件夹，用户不用再找一遍。
    const folder = libraryFolders.puzzleAssignments[ids[0]] || "我的题库";
    setLibraryFolders((folders) => {
      const puzzleAssignments = { ...folders.puzzleAssignments };
      for (const id of ids) delete puzzleAssignments[id];
      puzzleAssignments[merged.merged.id] = folder;
      let order = folders.order;
      if (order) {
        const buckets = { ...(order.puzzles ?? {}) };
        for (const id of ids) delete buckets[id];
        order = { ...order, puzzles: buckets };
      }
      return { ...folders, puzzleAssignments, order };
    });
    setPuzzleMergeOpen(false); setSheet(null);
    setPuzzleBatchMode(false);
    setPuzzleBatchSelectedIds([]);
    setToast(merged.duplicateCount
      ? `已合并 ${ids.length} 个题集、去掉 ${merged.duplicateCount} 道重复题（可撤销）`
      : `已合并 ${ids.length} 个题集共 ${merged.merged.puzzles.length} 道题（可撤销）`);
  };

  const confirmPuzzleSplit = () => {
    const target = puzzleSplitTarget;
    if (!target) return;
    const from = Number.parseInt(target.from, 10);
    const to = Number.parseInt(target.to, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) { setToast("请输入有效的题号范围"); return; }
    pushPuzzleUndo("拆分题集");
    const split = splitCollection({
      collections: puzzleCollections,
      collectionId: target.collectionId,
      from, to,
      result: { id: `split-${Date.now().toString(36)}`, title: `${target.title}（拆分）`, source: "半步五子棋打谱本地保存", license: "用户本地" },
    });
    if (!split.created) { puzzleUndoRef.current = null; setToast("这个范围里没有题目"); return; }
    commitPuzzleCollections(split.collections);
    const folder = libraryFolders.puzzleAssignments[target.collectionId] || "我的题库";
    setLibraryFolders((folders) => ({ ...folders, puzzleAssignments: { ...folders.puzzleAssignments, [split.created!.id]: folder } }));
    setPuzzleSplitTarget(null); setSheet(null);
    setToast(`已拆出“${split.created.title}”共 ${split.created.puzzles.length} 道题（可撤销）`);
  };

  // ---- 错题本：重做队列与已掌握（不做排期，理由见 daily-training.ts 顶部注释）----
  const markPuzzleMastered = (entry: PuzzleReviewEntry, mastered: boolean) => {
    setPuzzleOverlays((current) => updatePuzzleOverlay(current, entry.collectionId, entry.puzzleId, mastered ? { mastered: true } : null));
    if (mastered) setPuzzleReviewQueue((queue) => dequeuePuzzleReview(queue, entry.collectionId, entry.puzzleId));
    setToast(mastered ? `已把“${entry.puzzleTitle}”标为掌握，不再出现在错题本` : `已把“${entry.puzzleTitle}”放回错题本`);
  };

  /**
   * 重置做题进度（设置 →「题库管理」）。只清做题记录（完局进度与重做队列），
   * **保留**已掌握标记与隐藏题集——用户明确要求这两件事分开（2026-09-21）：
   * 「做过没有」是可重来的记录，「已掌握」「不想看到」是用户的意愿。
   */
  const resetPuzzleProgress = () => {
    const count = Object.keys(puzzleProgress).length;
    if (!count) { setToast("当前没有做题记录"); return; }
    if (!window.confirm(`确认重置做题进度？

将清空 ${count} 道题的完成状态、尝试次数与重做队列；已掌握标记与隐藏的题集保留。此操作不能撤销。`)) return;
    const reset = resetPuzzleProgressState(puzzleOverlays);
    setPuzzleProgress(reset.progress);
    setPuzzleOverlays(reset.overlays);
    setPuzzleReviewQueue(reset.queue);
    setToast("已重置做题进度");
  };

  /** 把所有「已掌握」标记撤掉（错题本底部的「全部放回」）。 */
  const clearMasteredPuzzles = () => {
    const masteredCount = masteredPuzzleKeys.size;
    if (!masteredCount) { setToast("当前没有标记为掌握的题"); return; }
    if (!window.confirm(`把 ${masteredCount} 道「已掌握」的题放回错题本？`)) return;
    // 逐条走 updatePuzzleOverlay（mastered: false 会顺带把只剩标记的空条目清掉），
    // 而不是手写 map + filter——后者容易留下 `{}` 这种没意义的键。
    setPuzzleOverlays((current) => {
      let next = current;
      for (const key of masteredPuzzleKeys) {
        const separator = key.indexOf("/");
        if (separator < 0) continue;
        next = updatePuzzleOverlay(next, key.slice(0, separator), key.slice(separator + 1), { mastered: false });
      }
      return next;
    });
    setToast(`已把 ${masteredCount} 道题放回错题本`);
  };

  const redoWrongPuzzle = (entry: PuzzleReviewEntry) => {
    setPuzzleReviewQueue((queue) => enqueuePuzzleReview(queue, entry.collectionId, entry.puzzleId, new Date().toISOString()));
    setSheet(null);
    guardedOpenPuzzle(entry.collectionIndex, entry.puzzleIndex);
    setToast("已加入重做队列并打开这道题");
  };

  const runBatchReplace = () => {
    const from = batchReplaceFrom;
    if (!from || !batchSelectedDocuments.length) { setToast(!batchSelectedDocuments.length ? "请先选择至少一份普通棋谱" : "请输入要查找的文字"); return; }
    // 批量替换走草稿、可撤销（audit 2026-09-17）：以前这里直接 saveToLibrary 落库，
    // 绕过草稿系统——替换错了没有任何办法回退（同一份棋谱的「撤销」只认自己的草稿）。
    // 现在改成：替换结果进每份棋谱各自的草稿（update-node 操作），用户到那份棋谱里
    // 用「撤销」即可回退，或「放弃」丢掉；不点保存就永远不会写进棋谱。
    const selected = new Set(batchSelectedIds);
    const targets = batchSelectedDocuments.filter((item) => selected.has(item.id));
    let touchedDocuments = 0;
    let touchedNodes = 0;
    let skippedDirty = 0;
    targets.forEach((item) => {
      // 已有未保存草稿的棋谱跳过：把替换叠进用户还没定稿的编辑里，撤销语义会乱。
      if (regularDraftIds.has(item.id) || largeDraftIdSet.has(item.id)) { skippedDirty += 1; return; }
      const operations = buildBatchReplaceOperations(item.nodes, from, batchReplaceTo);
      if (!operations.length) return;
      touchedDocuments += 1;
      touchedNodes += operations.length;
      const next: DraftState = { operations, redo: [] };
      if (compactIndexOf(item) || largeSummaries.some((summary) => summary.id === item.id)) void saveDraftForDocument(item.id, next, documentFingerprint(item), item.metadata);
      else saveDraftToLocal(item.id, next);
    });
    if (touchedDocuments) setLibrary(loadLibrary());
    const parts = [`已在 ${touchedDocuments} 份棋谱的 ${touchedNodes} 个节点上替换「${from}」`];
    parts.push(touchedDocuments ? "改动已进各自草稿，撤销或放弃都在那份棋谱里" : "");
    if (skippedDirty) parts.push(`${skippedDirty} 份因有未保存草稿被跳过`);
    setToast(parts.filter(Boolean).join("；"));
    setSheet(null);
  };
  // 批量导出（用户 09-23 修）：原来只导前 20 份、其余静默丢弃，而且每份单独触发一次下载。
  // 现在打包成一个 ZIP（内部按序号 + 标题命名，重名自动加后缀），并如实报告份数；
  // 大型库（LIB/DP/DB 的索引副本）无法转成 SGF，单独列进 README 说明而不是悄悄漏掉。
  const runBatchExport = async () => {
    if (!batchSelectedDocuments.length) { setToast("请先选择至少一份普通棋谱"); return; }
    if (batchExportBusy) return;
    setBatchExportBusy(true);
    recordAction(`批量导出 ${batchSelectedDocuments.length} 份`);
    try {
      const entries: ZipEntryInput[] = [];
      const used = new Set<string>();
      batchSelectedDocuments.forEach((item, index) => {
        const stem = `${String(index + 1).padStart(3, "0")}-${safeName(item.metadata.title)}`;
        let name = `${stem}.sgf`;
        let suffix = 2;
        while (used.has(name)) { name = `${stem}(${suffix}).sgf`; suffix += 1; }
        used.add(name);
        entries.push({ name, data: exportSgf(item) });
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
      entries.push({
        name: "README.txt",
        data: [
          "半步五子棋打谱 · 批量导出",
          "",
          `导出份数：${batchSelectedDocuments.length}`,
          `导出时间：${new Date().toLocaleString("zh-CN")}`,
          "格式：SGF（FGF / REN / RENJS / WZQ 与 SGF 内容相同，只是扩展名不同，需要时自行改扩展名）",
          "",
          "文件名形如 001-棋谱名.sgf，序号即你在棋谱库里的选择顺序；重名会自动加 (2)、(3) 后缀。",
          ...(skippedBatchItems.length ? ["", "以下内容未能导出：", ...skippedBatchItems.map((title) => `- ${title}`)] : []),
        ].join("\n"),
      });
      const zip = await createZip(entries);
      await exportTextFile(new Blob([zip.buffer]), `半步五子棋打谱-批量导出-${batchSelectedDocuments.length}份-${stamp}.zip`, "application/zip", `已导出 ${batchSelectedDocuments.length} 份棋谱（ZIP 打包）`);
      setSheet(null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "批量导出失败，请重试");
    } finally {
      setBatchExportBusy(false);
    }
  };
  // 已掌握的题（用户手动标记）不进错题本；键与 puzzleProgressKey 同构。
  const masteredPuzzleKeys = useMemo(() => new Set(Object.entries(puzzleOverlays).filter(([, overlay]) => overlay.mastered === true).map(([key]) => key)), [puzzleOverlays]);
  const wrongPuzzleEntries = useMemo<PuzzleReviewEntry[]>(() => deriveWrongPuzzleEntries(puzzleCollections, puzzleProgress, masteredPuzzleKeys), [puzzleCollections, puzzleProgress, masteredPuzzleKeys]);
  // 可见题集：隐藏的（内置与自建都可隐藏）不入题库列表，但进度、收藏、文件夹归属都保留。
  const visiblePuzzleCollections = useMemo(
    () => puzzleCollections.map((collection, collectionIndex) => ({ collection, collectionIndex })).filter(({ collection }) => !hiddenPuzzleCollectionIds.includes(collection.id)),
    [puzzleCollections, hiddenPuzzleCollectionIds],
  );
  const recentPuzzles = useMemo(() => recentPuzzleItems(puzzleCollections, puzzleProgress), [puzzleCollections, puzzleProgress]);
  // 每日一题 / 打卡 / 到期重温的派生数据。todayKey 是本地日期键，跨零点时下一轮渲染
  // 自然换新的一天（useMemo 按字符串值比较，不会因为每次新建字符串而重算）。
  const todayKey = localDateKey();
  const dailyCandidates = useMemo<DailyCandidate[]>(() => puzzleCollections.flatMap((collection) => collection.puzzles.map((puzzle) => {
    const entry = puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)];
    return { collectionId: collection.id, puzzleId: puzzle.id, solved: entry?.solved === true, attempts: entry?.attempts || 0, updatedAt: entry?.updatedAt || "" };
  })), [puzzleCollections, puzzleProgress]);
  const dailyDecision = useMemo(() => decideDailyPuzzle(dailyTraining, dailyCandidates, todayKey), [dailyTraining, dailyCandidates, todayKey]);
  const dailyCheckedIn = dailyTraining.days[todayKey]?.solved === true;
  const dailyPuzzle = dailyDecision ? locatePuzzleIn(puzzleCollections, dailyDecision.pick.collectionId, dailyDecision.pick.puzzleId) : null;
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
    // 在线预览：这一份是「打开来看看局面」的，绝不写进棋谱库、也不落草稿。
    // 用户 09-19 晚明确：在线棋谱可以看，但不要下载入库。
    if (previewDocId === document.id) { setSaved(false); return; }
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
      } else if (flattenChoice && flattenChoice.documentId === document.id) {
        // 这笔拍平还没裁决，**不覆盖棋谱库里那份带手序的原谱**（用户 2026-09-28：
        // 原来这一步会把静态局面静默写回原谱＝坏谱）。状态条显示未保存是诚实的。
        setSaved(false);
      } else if (duelUnsavedDocIdRef.current === document.id) {
        // 人机对局且用户还没点「保存本局」：不写棋谱库（用户 09-28）。
        // 状态保持「未保存」是诚实的——这盘棋此刻只在内存与「上次对局」快照里。
        setSaved(false);
      } else { setLibrary(saveToLibrary(document)); setSaved(true); }
    }, largeSummaries.some((item) => item.id === document.id) ? 1000 : 450);
    return () => window.clearTimeout(timer);
  }, [document, mode, draft, previewDocId, flattenChoice]);
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
  // 「退出后恢复上次局面」关着时，启动会直接开一份空白新谱（见 document 初始化里那句 !shouldRestore）。
  // 用户刚保存完就重开，看到空盘会以为棋谱没了——10-06 群友报的「新谱保存后关闭再进去就不见了」正是这个
  // 现象（棋谱其实都在棋谱库里）。所以这种情况给一句说清去向的提示，别让人自己翻。
  useEffect(() => {
    if (loadRestoreLastPosition()) return;
    const timer = window.setTimeout(() => setToast("已按你的设置从空白新谱开始 · 保存过的棋谱都在「棋谱库」"), 1400);
    return () => window.clearTimeout(timer);
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
  useEffect(() => { savePuzzleOverlays(puzzleOverlays); }, [puzzleOverlays]);
  useEffect(() => { saveHiddenPuzzleCollections(hiddenPuzzleCollectionIds); }, [hiddenPuzzleCollectionIds]);
  useEffect(() => { savePuzzleReviewQueue(puzzleReviewQueue); }, [puzzleReviewQueue]);
  useEffect(() => { saveDailyTraining(dailyTraining); }, [dailyTraining]);
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
  useEffect(() => { localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify({ showNumbers, showCoordinates, showForbidden, showLastMove, moveNumberScale, gridLineWidth, coordinateFontSize, boardMargin, stoneSize })); }, [showNumbers, showCoordinates, showForbidden, showLastMove, moveNumberScale, gridLineWidth, coordinateFontSize, boardMargin, stoneSize]);
  useEffect(() => { saveStoneOpacity(stoneOpacity); }, [stoneOpacity]);
  useEffect(() => { saveBoardOpacity(boardOpacity); }, [boardOpacity]);
  useEffect(() => { saveActionOpacity(actionOpacity); }, [actionOpacity]);
  useEffect(() => {
    if (globalThis.document) globalThis.document.documentElement.dataset.themeMotion = themeMotion ? "on" : "off";
    saveThemeMotion(themeMotion);
  }, [themeMotion]);
  useEffect(() => { saveAnnotationHighlight(annotationHighlight); }, [annotationHighlight]);
  useEffect(() => { saveSpeechEnabled(speechEnabled); }, [speechEnabled]);
  useEffect(() => { saveSpeechRate(speechRate); }, [speechRate]);
  // 离开读谱 / 关掉开关时掐掉正在念的那句，免得停止播放后还在自言自语。
  useEffect(() => {
    if (!speechEnabled || mode !== "review") stopSpeaking();
  }, [speechEnabled, mode]);
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
    // Failed requests release their controller before retrying. Navigation
    // must cancel that pending retry even when no worker currently owns it.
    aiRequestRetry.current.cancel();
    // **必须同时看分析槽**：面板持续分析的请求挂在 slot.controller 上，不在
    // aiWorkerController 里。旧代码只查后者，于是「没有对局轮」时这个清理分支
    // 会在每次落子后把分析槽 worker 直接 terminate 掉（且不清槽）——下一条
    // analyze 投进死 worker 静默丢弃，引擎继续算旧局面。见 killAnalysisSlot 注释。
    const analysisActive = analysisPersistent.current.some((slot) => Boolean(slot && !slot.dead && slot.controller.current));
    if (active && active.contextKey !== currentPositionKey) cancelActiveAiComputation("position-change");
    else if (!active && !analysisActive) {
      thinkGeneration.current += 1;
      releaseThinkWorkerRefs();
      setThinkRunning(false);
      setAiAnalysis((current) => current.contextKey === currentPositionKey ? current : { status: "idle", engine: engineVariantFor(aiEngineChoice, enginePackUrlRef.current), depth: 0, nodes: 0, speed: undefined, score: undefined, scoreAvailable: false, winRate: undefined, candidates: [], move: null, contextKey: "" });
    }
  }, [currentPositionKey, aiEngineChoice]);
  /** 前后台状态。只用来给 effect 当依赖（让回前台那一刻重新评估一次），
   *  真正的判据一律现读 `appHidden()`，免得拿到渲染时的旧值。 */
  const [appVisible, setAppVisible] = useState(() => !appHidden());
  useEffect(() => {
    // 切到后台就不再让引擎继续算（省电、也免得回到前台时结果早已过期）。
    // 原先这里还放行"画中画里继续跑分析"（用户 09-17 第二批⑥）——画中画整个功能
    // 09-26 按用户要求删掉了，那条例外判据随之取消。
    // ⚠ 取消只是「停掉当前这一轮」；后台里的自动分析/保活/自对弈 effect 会再点火，
    //    所以它们必须各自看 appHidden()（见 appHidden 的取证注释）。
    // 三条长跑任务一次停齐。复盘与 VCF 生成的循环不经过 startThink，所以「后台只停分析」
    // 的话它们照样能满速烧够那 5 分钟被系统杀掉整个进程（见 appHidden 取证）。
    // 收尾沿用用户点「停止」那同一条路：复盘按已完成前缀落盘、VCF 批次直接作废，不另造半套状态。
    const stopLongRunningWork = () => {
      cancelActiveAiComputation("background");
      if (gameReviewRunRef.current?.active) cancelGameReview(true);
    };
    const suspend = () => {
      const hidden = appHidden();
      setAppVisible(!hidden);
      if (hidden) stopLongRunningWork();
    };
    const pageHide = () => stopLongRunningWork();
    globalThis.document?.addEventListener("visibilitychange", suspend);
    window.addEventListener("pagehide", pageHide);
    return () => {
      globalThis.document?.removeEventListener("visibilitychange", suspend);
      window.removeEventListener("pagehide", pageHide);
      cancelActiveAiComputation("unmount");
      gameReviewWorkerRef.current?.worker.terminate(); gameReviewWorkerRef.current = null; gameReviewRunRef.current = null;
      pagedSession.current?.close(); dynamicViewSession.current?.close(); void banbuAudio.close();
    };
  }, []);
  /**
   * 回前台补一次调度。
   *
   * 为什么需要：切出时那次取消会把「轮到 AI 的一手」一起取消，而 AI 应手**不是**由
   * 「轮到 AI 就把棋下了」的监视 effect 驱动的（见 duel-session.ts 头部注释），人做完动作
   * 才顺手调度一次——于是切出去再回来，棋盘正等着 AI，却没人再调度，看着像卡死。
   * `scheduleAiOpening` 自己会判断该谁动手（已终局直接返回；正常阶段只在进行方是 AI 时开算；
   * 开局阶段只在 actor 是 AI 时开算），所以这里不重复它的判据，只挡住「已经有一轮在跑」。
   */
  useEffect(() => {
    if (!appVisible) return;
    if (!aiGame || aiThinking || aiGame.outcome) return;
    scheduleAiOpening(aiGame, document, currentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appVisible]);
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
  // 触觉反馈挂在这一个入口上：落子、导航、警告、胜负全都经过它（用户 09-17，默认关闭）。
  const playSound = (cue: SoundCue) => { void banbuAudio.play(cue); playHapticCue(cue, enhancementSettings.haptics); };
  const requestStrongAiMove = (afterDocument: GameDocument, afterId: string, aiPlayer: Player, onMove: (move: Position) => void, onNoMove: () => void, options: { strength?: AiStrength; timeMs?: number; maxDepth?: number; unlimited?: boolean; kind?: "game" | "puzzle"; engineChoice?: AiEngineChoice } = {}) => {
    cancelActiveAiComputation("superseded");
    setAiThinking(true);
    const board = boardAt(afterDocument, afterId);
    const moves = pathToNode(afterDocument, afterId).flatMap((node) => node.move ? [{ row: node.move.row, col: node.move.col, player: node.move.player }] : []);
    const strength = options.strength || aiStrength;
    const profile = strength === "自由" ? { timeMs: aiFreeTimeMs, maxDepth: aiFreeDepth } : AI_STRENGTH_PROFILES[strength];
    const searchConfig = { timeMs: options.timeMs ?? profile.timeMs, maxDepth: options.maxDepth ?? profile.maxDepth, unlimited: options.unlimited === true };
    const kind = options.kind || "game";
    // 盘面尺寸参与选型：旗舰档（KataGo）只支持 15 路以内，超限自动按强力档走。
    const engineChoiceRaw = effectiveEngineChoice(options.engineChoice || aiEngineChoice, board.length);
    // 与 startThink 同一口径（用户 10-01）：katago 还在加载时，做题的应手这一轮先用 rapfi，
    // 就绪后下一手自动回到 katago。不写回选择、不落盘。
    const engineChoice = engineChoiceRaw === "kata" && !kataEngineReady ? "strong" : engineChoiceRaw;
    const enginePackUrl = engineNeedsPack(engineChoice) ? enginePackUrlRef.current : null;
    aiAnalysisEngineRef.current = engineVariantFor(engineChoice, enginePackUrl, board.length);
    setAiAnalysis({ status: "thinking", engine: aiAnalysisEngineRef.current, mover: aiPlayer, depth: 0, nodes: 0, speed: undefined, score: undefined, scoreAvailable: false, winRate: undefined, candidates: [], move: null, contextKey: `${afterDocument.id}/${afterId}/${positionKey(board, aiPlayer, false)}` });
    // 同 startThink：新一轮的读数已清空，合流窗口里上一轮的待发帧必须一起丢掉。
    gameProgressPump.current?.reset();
    const slotKey = engineSlotKeyFor(engineChoice, enginePackUrl, board.length);
    // One long-lived Rapfi worker per engine mode: skipping the per-move
    // reload (~1.4s) and keeping the transposition table warm across moves is
    // worth real search depth inside the same think budget.
    let persistentEntry = rapfiPersistentWorker.current;
    if (!persistentEntry || persistentEntry.key !== slotKey || persistentEntry.dead) {
      // dead 兜底同 makeAnalysisSlot：`cancelActiveAiComputation` 会 terminate
      // rapfiGameWorker（它不是分析槽 worker），但不清这个 ref——复用死 worker 会让
      // 对弈的 analyze 投进虚空（表现为「AI 一直不思考」）。
      persistentEntry?.worker.terminate();
      const gameWorker = createEngineWorker(String(import.meta.env.BASE_URL) + "rapfi/rapfi-worker.js");
      persistentEntry = { worker: gameWorker, key: slotKey };
      const originalGameTerminate = gameWorker.terminate.bind(gameWorker);
      // 闭包必须绑到**这一个** entry 对象上：若捕获可变变量，worker 被替换后旧
      // worker 的 terminate 会把新 entry 误标成 dead（下次复用又被丢进虚空）。
      const ownedEntry = persistentEntry;
      gameWorker.terminate = () => { ownedEntry.dead = true; originalGameTerminate(); };
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
        setToast(nativeEngineReady ? "本机原生引擎未能加载，本局改用内置轻量引擎（棋力弱一些）" : enginePackState ? "rapfi 引擎未能加载，本局改用内置轻量引擎（可在设置中重新下载冠军网络包）" : "本局先用内置轻量引擎（自带轻量网络）；下载冠军网络包可提升棋力");
      }
    };
    taskManager.current.start({ kind: "ai", title: kind === "puzzle" ? "陪练思考" : "人机思考", taskId: handle.requestId, cancellable: true, retryable: true });
    taskManager.current.update({ stage: searchConfig.unlimited ? "searching-unlimited" : "searching", message: searchConfig.unlimited ? "不限时思考中，可随时停止" : "正在寻找下一步" });
    const complete = (result: AiMoveResult) => {
      if (!aiWorkerController.current.isCurrent(handle)) return;
      aiWorkerController.current.finish(handle);
      rapfiGameWorker.current = null; puzzleAiWorker.current = null;
      if (gameThinkLive.current?.requestId === handle.requestId) gameThinkLive.current = null;
      setAiAnalysis((current) => ({ ...current, status: result.move ? "complete" : "error", engine: aiAnalysisEngineRef.current, depth: Math.max(result.depth || 0, current.depth || 0), selDepth: Math.max(result.selDepth || 0, current.selDepth || 0), nodes: Math.max(result.nodes || 0, current.nodes || 0), speed: result.speed, score: result.score, scoreAvailable: result.scoreAvailable, winRate: result.winRate !== undefined ? result.winRate : current.winRate, move: result.move, candidates: result.candidates?.length ? result.candidates : current.candidates, principalVariation: result.principalVariation, elapsedMs: result.elapsedMs }));
      if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.success(result);
      if (result.move) onMove(result.move); else onNoMove();
    };
    const useLocalFallback = () => {
      if (!aiWorkerController.current.isCurrent(handle)) return;
      // 本局就此改用 rapfi：aiGame.engineChoice 每一手都会被读一次，不回写的话
      // 下一手又是「叫旗舰 → 失败 → 兜底」，用户看到的是每子一条失败提示
      // （2026-10-03 真机日志实锤：同一局里 14 次 engine=kata 请求）。
      if (kind === "game" && engineChoice === "kata") {
        setAiGame((current) => (current && !current.outcome ? { ...current, engineChoice: "strong" } : current));
      }
      // ⚠ 引擎名以**本局实际在用**的为准（2026-10-15 用户报「开局用 rapfi，算着算着弹出
      // 『katago 引擎启动失败』」）：`engineSwitchTargetRef` 记的是「上一次切换目标」，
      // 用户中途换回 rapfi 时它可能还留着旧的 kata，于是 rapfi 的启动失败被贴上了 KataGo 的名字。
      // rapfi 档失败本来就有自己的提示（见上面的 noteEngineVariant），所以这里只在本局真跑
      // KataGo 时才用 KataGo 的说法。
      // 弹「选择」而不是只弹一句提示（2026-10-15 用户要求：不要偷偷回落、让人选）。
      // 不自动改档位：用户不选就保持现状（档位仍是 KataGo，本局先用内置引擎算完）。
      if (engineChoice === "kata") {
        askEngineFallback("KataGo 启动失败，本局已用内置轻量引擎继续。", {
          retry: () => {
            setEngineSwitch(null);
            cancelActiveAiComputation("settings-change");
            void probeNativeKataGo().then((info) => { if (info) setKataEngineReady(info.available === true); });
          },
          fallback: () => { setEngineSwitch(null); updateAiEngineChoice("strong"); },
        });
      }
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
      // 旗舰档：内存设置对它无效（那是 rapfi 的 MAX_MEMORY），所以「降内存重试」
      // 无意义。改为清引擎后原样重试一次（含清扫残留进程），仍失败才降级——
      // 与分析路径同策略（用户 09-26 报「旗舰关掉再开就一直起不来」）。
      if (engineChoice === "kata") {
        // 用户已把档位切走（例如刚从 katago 切回 rapfi）时，**飞行中的旧一轮**仍带着
        // 旧档位继续跑；它出错就会被按「katago 启动失败」报出来（用户 2026-10-07 实测：
        // 「切到 rapfi 后几手内还弹 katago 启动失败」）。现行档位不再是 kata 时静默放弃。
        if (loadAiEngineChoice() !== "kata") return;
        // 加载进行中的报错不算失败（同上：旗舰冷启动 ~6s，别在 1 秒就宣告失败）
        if (takeKataLoadGrace()) {
          aiRequestRetry.current.schedule(() => requestStrongAiMove(afterDocument, afterId, aiPlayer, onMove, onNoMove, { ...options, engineChoice }), 800, () => !appHidden() && aiWorkerController.current.isCurrent(handle));
          return;
        }
        // **连续 5 次失败才弹提示**（与分析路径同策略，用户 09-26 明确要求）：
        // 前 4 次静默重试，瞬态余波引擎 2 秒就自己好了。
        kataRetryRef.current += 1;
        if (kataRetryRef.current < KATA_FAIL_TOAST_THRESHOLD) {
          cancelActiveAiComputation("settings-change");
          void stopNativeKataGo("game-retry");
          aiRequestRetry.current.schedule(() => requestStrongAiMove(afterDocument, afterId, aiPlayer, onMove, onNoMove, { ...options, engineChoice }), 400, () => !appHidden());
          return;
        }
        useLocalFallback();
        setToast("KataGo 连续 5 次未能启动：本局已改用内置轻量引擎，想再用 KataGo 可在设置里重新切过去");
        return;
      }
      /**
       * 高档内存分配失败（引擎退出）→ 先降 256MB 重试一次，再换内置轻量引擎。
       *
       * ## ⚠ 这里原来有个真 bug：降级**根本没生效**（2026-10-11 修，用户报「一直报错」）
       *
       * 上一版把 `gameMemoryRetryRef.current = 256` 设好、然后递归调
       * `requestStrongAiMove` —— 可是**那条 postMessage 读的不是这个 ref**：
       * 对局路径发的是 `maxMemoryMb: engineMemoryMbFor(engineChoice, …)`（见函数末尾），
       * 也就是说**每次重试都还带着原来那个高档值**。
       * 后果是一局里每一手都走一遍"失败 → 记 256 → 重试（还是高档）→ 再失败 →
       * 才换轻量"，表现就是用户说的「总是显示…一直报错」，
       * 而且该降的档位永远没降下去（`usedMem > 256 && !gameMemoryRetryRef.current`
       * 在第二轮就被 ref 挡住了，所以连"降到 256 重试"这条提示都只弹一次）。
       *
       * 修法：把 ref 接进 postMessage（与分析路径 `engineMemoryRetryRef` 的写法对齐，
       * 那边一直是 `engineMemoryRetryRef.current ?? engineMemoryMbFor(…)`）。
       *
       * 顺带记一笔：**"设了状态但没人读"是最隐蔽的一类 bug** ——
       * 类型没错、逻辑读起来也对、测试也绿（它只验到"要不要重试"，验不到"重试时用了什么值"），
       * 只有真机上把内存拉满才会暴露。所以下面的 postMessage 里那个 ref 必须有名字地写出来。
       */
      const usedMem = gameMemoryRetryRef.current ?? engineMemoryMbFor(engineChoice, enhancementSettings.analysisMaxMemoryMb) ?? 0;
      if (shouldRetryWithLowerMemory(engineChoice, enhancementSettings.analysisMaxMemoryMb, gameMemoryRetryRef.current)) {
        gameMemoryRetryRef.current = MEMORY_RETRY_MB;
        recordAction(`对局 AI 引擎内存分配失败（原 ${usedMem}MB），已降到 ${MEMORY_RETRY_MB}MB 重试`);
        setToast(`AI 引擎内存分配失败，已自动降至 ${MEMORY_RETRY_MB}MB 重试`);
        cancelActiveAiComputation("settings-change");
        aiRequestRetry.current.schedule(() => requestStrongAiMove(afterDocument, afterId, aiPlayer, onMove, onNoMove, { ...options, engineChoice }), 0, () => !appHidden());
        return;
      }
      useLocalFallback();
      /**
       * 回切内置轻量引擎必须提示（用户 09-13）。
       *
       * ⚠ 文案在 2026-10-11 改过一次（用户问「网页版我们不是只有 rapfi 吗，
       * 哪里来的备用引擎啊」）：原来写的是"已改用**内置备用引擎**"，
       * 而"备用引擎"听起来像"另一个 Rapfi 档位"——其实它是**完全独立的**那个
       * 纯 JS 简易引擎（`puzzle-ai.worker.ts`，不依赖引擎包、棋力弱得多）。
       * 名字必须点明是"轻量"，否则用户会以为还留在同一个引擎上。
       *
       * 同时把原因与出路写清：内存档只在**装了引擎包 / 或安卓原生**时才生效
       * （`engineMemoryMbFor` 对 light 直接返回 undefined），所以提示里说
       * "调低分析内存"是对的；但**先要看清当前跑的是哪一档**。
       */
      const memoryTier = engineMemoryMbFor(engineChoice, enhancementSettings.analysisMaxMemoryMb);
      setToast(memoryTier && memoryTier >= 1024
        ? `AI 引擎未能分配内存（本机设定 ${memoryTier}MB），本局已改用内置轻量引擎；到设置把「分析内存」调低后重试`
        : "AI 引擎异常，本局已改用内置轻量引擎");
    };
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: string; generation?: number; result?: AiMoveResult; variant?: string; depth?: number; selDepth?: number; nodes?: number; speed?: number; score?: number; winRate?: number; candidates?: AiAnalysisCandidate[]; percent?: number; label?: string; done?: boolean }>) => {
      if (rapfiGameWorker.current !== worker || !aiWorkerController.current.isCurrent(handle, event.data.requestId || handle.requestId, event.data.generation ?? handle.generation)) return;
      if (event.data.type === "engine-loading") { handleEngineLoadingEvent(event.data); return; }
      if (event.data.type === "ready") { noteEngineVariant(event.data.variant); aiAnalysisEngineRef.current = analysisEngineLabel(event.data.variant); handleEngineReadyEvent(event.data.variant, engineChoice); }
      if ((event.data.type === "result" || event.data.type === "progress") && event.data.variant) { aiAnalysisEngineRef.current = analysisEngineLabel(event.data.variant); handleEngineReadyEvent(event.data.variant, engineChoice); }
      if (event.data.type === "progress") {
        aiAnalysisEngineRef.current = analysisEngineLabel(event.data.variant);
        if (gameThinkLive.current && gameThinkLive.current.requestId === (event.data.requestId || handle.requestId)) {
          const liveList = event.data.candidates || [];
          const primary = liveList.find((candidate) => (candidate.pvIndex ?? 0) <= 0) || liveList[0];
          if (primary?.move) gameThinkLive.current.best = { row: primary.move.row, col: primary.move.col };
        }
        // 读数走合流闸（见文件头）：真机每秒 ~10 条 progress 若逐条 setState，等于每秒
        // 重渲染整棵组件树十几次。上面的 ref 写入（best 落点）必须保持逐帧即时 ——
        // 停止时要用最新的最强点落子，节流会漏掉最后几手。
        gameProgressPump.current?.push(progressFrameSlices(event.data));
      } else if (event.data.type === "result" && event.data.result) {
        gameProgressPump.current?.flush();
        if (event.data.result.source === "book" && event.data.result.move) {
          recordAction(`开局库应着 ${coordinateName(event.data.result.move)}${event.data.result.bookLabel ? `（${event.data.result.bookLabel}打）` : ""}`);
          setToast(`开局库：${coordinateName(event.data.result.move)}${event.data.result.bookLabel ? `（${event.data.result.bookLabel}打）` : ""}`);
        }
        complete(event.data.result);
      } else if (event.data.type === "error") useFallbackAfterRapfiError();
    };
    worker.onerror = useFallbackAfterRapfiError;
    /**
     * ⚠ `maxMemoryMb` 必须带 `gameMemoryRetryRef`：内存分配失败时上面的
     * `useFallbackAfterRapfiError` 会把降级值写进这个 ref，而**只有这里读它**，
     * 降级才真的生效。原来这里只发 `engineMemoryMbFor(…)`，
     * 于是"降到 256MB 重试"实际还是拿原高档位重试 ⇒ 一局里每手都失败重来一遍
     * （2026-10-11 用户报「总是显示 AI 引擎未能分配内存…一直报错」）。
     * 分析路径（`startThink`）一直是 `engineMemoryRetryRef.current ?? …` 的写法，
     * 这里与它对齐。
     */
    worker.postMessage({ type: "analyze", requestId: handle.requestId, generation: handle.generation, engine: aiAnalysisEngineRef.current === "kata" ? "kata" : enginePackUrl ? "auto" : "fallback", dataUrl: enginePackUrl || undefined, size: afterDocument.metadata.boardSize || 15, moves, player: aiPlayer, rule: afterDocument.metadata.rule, openingRule: afterDocument.metadata.openingRule, timeMs: searchConfig.unlimited ? 0 : searchConfig.timeMs, maxDepth: enhancementSettings.analysisDepthMax > 0 ? enhancementSettings.analysisDepthMax : searchConfig.unlimited ? 512 : searchConfig.maxDepth, unlimited: searchConfig.unlimited, topN: 5, finishOnBareMove: true, stopOnProvenWin: true, book: kind === "game" && enhancementSettings.openingBook === true, multi: enhancementSettings.engineMultiThread, threads: enhancementSettings.engineThreads, bigCores: nativeEngineInfo()?.bigCores, depthMin: enhancementSettings.analysisDepthMin, native: nativeEngineUsable(), maxMemoryMb: resolveAnalyzeMemoryMb(engineChoice, enhancementSettings.analysisMaxMemoryMb, gameMemoryRetryRef.current) });
  };

  // Opening decisions (placements, fifth-move offers/choices) used to be
  // shape heuristics that answered instantly and handed the human winning
  // lines. They now query the same engine the game uses; heuristics remain
  // only as the fallback when the engine is unavailable.
  // 开局链临时探测 worker 集合（全盘体检 P2-4）：组件卸载时统一回收，
  // 防极端慢网络下守卫到点前 worker 存活泄漏。开局链在途不主动 terminate（会打断摆子）。
  const openingProbeWorkersRef = useRef<Set<Worker>>(new Set());
  useEffect(() => () => { for (const probeWorker of openingProbeWorkersRef.current) probeWorker.terminate(); openingProbeWorkersRef.current.clear(); }, []);
  const requestOpeningEngineCandidates = (baseMoves: Position[], player: Player, count: number, timeMs: number, rule: RuleSet, boardSize: number, strong: boolean, book = false, openingRule?: OpeningRule): Promise<{ moves: Position[]; scores: number[]; score: number | null; ranks: number[]; bookHit: boolean }> => new Promise((resolve) => {
    const packUrl = strong ? enginePackUrlRef.current : null;
    const worker = createEngineWorker(String(import.meta.env.BASE_URL) + "rapfi/rapfi-worker.js");
    openingProbeWorkersRef.current.add(worker);
    let settled = false;
    const finish = (result: { moves: Position[]; scores?: number[]; score: number | null; ranks?: number[]; bookHit?: boolean }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(guard);
      openingProbeWorkersRef.current.delete(worker);
      worker.terminate();
      resolve({ ranks: [], scores: [], bookHit: false, ...result });
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
        finish({
          moves,
          scores: rawCandidates.map((candidate) => (typeof candidate.score === "number" ? candidate.score : NaN)).filter((_, index) => Boolean(rawCandidates[index]?.move)),
          score: typeof data.result.score === "number" ? data.result.score : null,
          ranks: rawCandidates.map((candidate) => candidate.rank ?? 0).filter((rank) => rank > 0),
          bookHit: data.result.source === "book",
        });
      } else if (data.type === "error") finish({ moves: [], score: null });
    };
    worker.onerror = () => finish({ moves: [], score: null });
    worker.postMessage({ type: "analyze", engine: packUrl ? "auto" : "fallback", dataUrl: packUrl || undefined, size: boardSize, moves: baseMoves.map((move) => ({ ...move })), player, rule, openingRule, timeMs, maxDepth: 64, topN: count, finishOnBareMove: true, stopOnProvenWin: true, book, maxMemoryMb: engineMemoryMbFor(aiEngineChoice, enhancementSettings.analysisMaxMemoryMb), multi: enhancementSettings.engineMultiThread, threads: enhancementSettings.engineThreads, bigCores: nativeEngineInfo()?.bigCores, native: nativeEngineUsable() });
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
      setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place", reply.nodeId); playSound(replyPlayer === "black" ? "move-black" : "move-white");
      const replyBoard = boardAt(reply.document, reply.nodeId);
      if (winnerAt(replyBoard, actualMove, reply.document.metadata.rule)) { setPuzzleOutcome("lost"); recordPuzzleAttempt(false); }
    }, () => { setAiThinking(false); setToast("陪练没有找到可落子点"); }, { kind: "puzzle", timeMs: PUZZLE_FAST_THINK_TIME_MS });
  };

  const startAiGameReply = (afterDocument: GameDocument, afterId: string, aiPlayer: Player, game: AiGameState | null = aiGame) => {
    // 后台不点火（同 startThink，见 appHidden 注释）。回前台由「恢复被后台打断的 AI 一手」
    // 那个 effect 补发——AI 的应手没有「轮到 AI 就自己下」的监视 effect，不补就会僵在这一手。
    if (appHidden()) return;
    // 自定义开局的摆子阶段：AI 一步都不许动 —— 摆的黑白是轮流落的，按颜色算随时可能
    // "轮到 AI 的颜色"，不在这道总闸上拦住，就会出现"我还在摆，它自己落子了"。
    if (duelSetupPhase) return;
    setAiThinking(true);
    requestStrongAiMove(afterDocument, afterId, aiPlayer, (move) => {
      setAiThinking(false);
      const beforeBoard = boardAt(afterDocument, afterId);
      const actualMove = aiPlayer === "black" && afterDocument.metadata.rule === "renju" && forbiddenReason(beforeBoard, move)
        ? suggestFifthCandidates(beforeBoard, 1)[0]
        : move;
      if (!actualMove) { aiGameEndReason.current = "AI 没有合法落子，判和"; setAiGame((game) => game ? { ...game, outcome: "draw" } : game); setToast("AI 没有合法落子，本局和棋"); return; }
      const reply = addMoveAs(afterDocument, afterId, actualMove, aiPlayer);
      setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place", reply.nodeId); playSound(aiPlayer === "black" ? "move-black" : "move-white");
      recordSession.current = { document: reply.document, currentId: reply.nodeId };
      const replyBoard = boardAt(reply.document, reply.nodeId);
      if (winnerAt(replyBoard, actualMove, afterDocument.metadata.rule)) {
        aiGameEndReason.current = "AI 连成五子";
        setAiGame((game) => game ? { ...game, outcome: "lost" } : game);
        playSound("error"); setToast("AI 已连成五子，本局结束");
      } else if (replyBoard.every((row) => row.every(Boolean))) {
        aiGameEndReason.current = "棋盘下满，判和";
        setAiGame((game) => game ? { ...game, outcome: "draw" } : game);
        setToast("棋盘已满，本局和棋");
      }
    }, () => { setAiThinking(false); aiGameEndReason.current = "AI 没有找到合法落子，判和"; setAiGame((currentGame) => currentGame ? { ...currentGame, outcome: "draw" } : currentGame); setToast("AI 没有找到合法落子，本局和棋"); }, { strength: game?.strength || aiStrength, timeMs: game?.thinkTimeMs, maxDepth: game?.thinkDepth, unlimited: game?.unlimitedThinking, kind: "game", engineChoice: game?.engineChoice || aiEngineChoice });
  };

  /** 「轮到 AI 却没人点火」的兜底（用户 10-06 报的「有时空白盘点不了子，新建棋盘后才能点」里最像的一条）。
   *  AI 的应手原先只在几个具体流程里调用（开局续手、分支切换、撤销后…），代码注释自己写着
   *  「AI 的应手没有『轮到 AI 就自己下』的监视 effect，不补就会僵在这一手」。那一手一旦丢掉
   *  （切后台、引擎静默失败、恢复对局），`aiBoardDisabled` 会一直成立，而棋盘是 disabled 的
   *  ——点击连 play() 都进不去，所以**没有任何提示**，只能新建。这里补一次，并把发生过写进环形日志。 */
  const aiReplyWatchdogFiredFor = useRef("");
  useEffect(() => {
    if (!aiGame || aiGame.outcome || aiThinking || !aiBoardDisabled) return;
    if (currentId !== recordSession.current.currentId) return;   // 用户翻历史局面时不该自动续手
    if (appHidden()) return;                                     // 后台不点火（与 startAiGameReply 同一口径）
    const key = `${aiGame.id}/${currentId}`;
    if (aiReplyWatchdogFiredFor.current === key) return;         // 同一手只补一次，绝不连环点火
    const timer = window.setTimeout(() => {
      if (aiReplyWatchdogFiredFor.current === key) return;
      aiReplyWatchdogFiredFor.current = key;
      recordAction("对局等待 AI 超时：自动补发这一手");
      setToast("等了很久没等到 AI 落子，正在重发这一手");
      startAiGameReply(recordSession.current.document, recordSession.current.currentId, aiGame.aiPlayer, aiGame);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [aiGame, aiThinking, aiBoardDisabled, currentId]);

  const gameWithOpening = (game: AiGameState, opening: OpeningSession): AiGameState => ({ ...game, opening, humanPlayer: opening.humanPlayer, aiPlayer: otherPlayer(opening.humanPlayer) });
  const documentWithAiNames = (source: GameDocument, game: AiGameState): GameDocument => ({
    ...source,
    metadata: { ...source.metadata, black: game.humanPlayer === "black" ? "我" : "半步 AI", white: game.humanPlayer === "white" ? "我" : "半步 AI" },
  });
  /**
   * 悔棋时把开局状态机一起倒回（用户 2026-10-09 报的 bug）。
   *
   * 用户原话：「我在五手两打规则，在摆出选点然后选择了一个后，我再去悔棋几步，竟然会回到
   * 前面的局面不说，还可以布置打点，这不是在第五手的时候打点，而是在第三手，第二手的时候打点」。
   *
   * 根因：回退只动了树游标，`aiGame.opening.stage` 原封不动 —— 盘面回到第 2 手、阶段却仍停在
   * `offer-fifths`，于是「第二手还能打点」。这里按**目标游标处的实际手数**重建开局会话
   * （重放逻辑在 `rewindOpeningToMove`，与开局推进共用同一套前向函数）。
   *
   * 同时必须**取消 AI 正在跑的开局调度**：那个异步回合是按旧阶段算出来的，若不打断，
   * 它落子后会拿着旧阶段继续推进，把状态机再推歪一次（generation 递增即让旧回合作废）。
   */
  const rewindOpeningForCursor = (cursorId: string) => {
    if (!aiGame || aiGame.outcome) return;
    const stones = pathToNode(document, cursorId).filter((node) => node.move || node.passPlayer).length;
    const opening = rewindOpeningToMove(aiGame.opening, stones);
    // 阶段没变化（例如已经在起点附近）就不白刷一次状态，省掉一次整页重渲染。
    if (opening.stage === aiGame.opening.stage && opening.candidates.length === aiGame.opening.candidates.length) return;
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    setAiThinking(false);
    setAiGame(gameWithOpening(aiGame, opening));
  };

  function scheduleAiOpening(game: AiGameState, afterDocument: GameDocument, afterId: string) {
    if (game.outcome) return;
    const stage = game.opening.stage;
    if (stage.kind === "normal") {
      if (nextPlayerAt(afterDocument, afterId) === game.aiPlayer) startAiGameReply(afterDocument, afterId, game.aiPlayer, game);
      return;
    }
    const actor = stage.kind === "place" || stage.kind === "offer-fifths" || stage.kind === "choose-fifth-count" || stage.kind === "batch" || stage.kind === "taraguchi-fifth" ? stage.actor : stage.chooser;
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
            // 塔十第4手后只是行使交换权（是否换色），黑5方式留到下一阶段选。
            const opening = decideOpeningSwap(game.opening, false);
            const nextGame = gameWithOpening(game, opening);
            const namedDocument = documentWithAiNames(afterDocument, nextGame);
            setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId: afterId };
            setToast("AI 选择保持当前执子方");
            scheduleAiOpening(nextGame, namedDocument, afterId);
            return;
          }
          if (stage.kind === "taraguchi-fifth") {
            // AI 作为此时的黑方：走「单点第5手」（保守默认；摆 10 个打点等于把选点权交给白方）。
            setAiThinking(false);
            const opening = chooseTaraguchiFifth(game.opening, "single");
            const nextGame = gameWithOpening(game, opening);
            const namedDocument = documentWithAiNames(afterDocument, nextGame);
            setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId: afterId };
            setToast("AI 选择单点第5手");
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
          if (stage.kind === "swap2-choice") {
            // AI 作为后手：保持白方并再补一颗白子（与本应用 AI 在其它交换规则里「从不主动交换」的策略一致）。
            setAiThinking(false);
            const opening = swap2Choose(game.opening, "white");
            const nextGame = gameWithOpening(game, opening);
            const namedDocument = documentWithAiNames(afterDocument, nextGame);
            setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId: afterId };
            setToast("AI（Swap2 后手）选择执白");
            scheduleAiOpening(nextGame, namedDocument, afterId);
            return;
          }
          if (stage.kind === "swap2-pick") {
            // AI 作为先手选色：拿黑（3 黑 2 白时黑多一子，但由白先走第 6 手）。
            setAiThinking(false);
            const opening = swap2PickSide(game.opening, "black");
            const nextGame = gameWithOpening(game, opening);
            const namedDocument = documentWithAiNames(afterDocument, nextGame);
            setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId: afterId };
            setToast("AI（Swap2 先手）选择执黑");
            scheduleAiOpening(nextGame, namedDocument, afterId);
            return;
          }
          if (stage.kind === "offer-fifths") {
            const board = boardAt(afterDocument, afterId);
            // 候选来自引擎的多路搜索。对齐五林的做法（`runAction(PutAlternations) →
            // searchAlternations(10) → searchNBestMoves(黑, 10, advancedLevel)`，再按引擎给出的
            // 顺序取前「声明数」个过 `canPutAlternativeStone` 过滤），但他们多给一档：
            // **只多取不排序**在我们这里会踩坑——实测引擎返回的候选顺序与评估分并不一致
            // （同一局面 2200ms 与 5000ms 的头三点都不一样），照单取前三个等于随机取。
            // 所以这里多要 10 个候选（不按声明数只要 count 个），按评估分降序取最好的 count 个。
            const engine = await requestOpeningEngineCandidates(openingMoves, "black", Math.max(stage.count, 10), Math.max(thinkTimeMs, 2500), rule, boardSize, engineStrong, enhancementSettings.openingBook === true, afterDocument.metadata.openingRule);
            if (generation !== aiOpeningGeneration.current) return;
            const candidates = selectFifthCandidates(engine.moves, engine.scores, board, stage.count, { preserveOrder: engine.bookHit });
            const seen = [...candidates];
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
            setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place", reply.nodeId); playSound("move-black"); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
            setToast(`AI 选择了第5手候选 ${coordinateName(selected)}`);
            scheduleAiOpening(nextGame, reply.document, reply.nodeId);
            return;
          }
          // 统一成「AI 要落一颗某色子」：place 阶段直接可用；batch（Swap2 连下）转成等效 place 视图。
          const placeStage = stage.kind === "place"
            ? stage
            : stage.kind === "batch"
              ? { kind: "place" as const, moveNumber: stage.placed + 1, player: stage.colors[stage.placed], actor: stage.actor, radius: stage.radius }
              : null;
          if (!placeStage) { setAiThinking(false); return; }
          const board = boardAt(afterDocument, afterId);
          let position: Position | null = null;
          if (placeStage.moveNumber === 1 && stage.kind === "place") {
            const center = Math.floor(boardSize / 2);
            position = { row: center, col: center };
          } else {
            const engine = await requestOpeningEngineCandidates(openingMoves, placeStage.player, 3, thinkTimeMs, rule, boardSize, engineStrong, enhancementSettings.openingBook === true, afterDocument.metadata.openingRule);
            if (generation !== aiOpeningGeneration.current) return;
            position = engine.moves.find((move) => !board[move.row]?.[move.col] && openingPositionAllowed(boardSize, move, placeStage)) || null;
          }
          if (!position) position = suggestOpeningPlacement(board, placeStage);
          if (!position) { setAiThinking(false); setToast("当前开局阶段没有合法落子"); return; }
          const reply = addMoveAs(afterDocument, afterId, position, placeStage.player);
          const opening = stage.kind === "batch" ? placeBatchStone(game.opening) : completeOpeningPlacement(game.opening);
          const nextGame = gameWithOpening(game, opening);
          setAiThinking(false);
          setDocument(reply.document); setCurrentId(reply.nodeId); triggerBoardMotion("place", reply.nodeId); playSound(placeStage.player === "black" ? "move-black" : "move-white"); setAiGame(nextGame); recordSession.current = { document: reply.document, currentId: reply.nodeId };
          setToast(stage.kind === "batch"
            ? `AI 已下第 ${stage.placed + 1} 颗开局子 · ${coordinateName(position)}`
            : `AI 完成第 ${placeStage.moveNumber} 手 · ${coordinateName(position)}`);
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
    setToast(wasTaraguchiChoice
      ? (swap ? "已交换黑白方，由新的黑方选择黑5方式" : "保持执子方，由你选择黑5方式")
      : swap ? "已交换黑白执子方" : "保持当前执子方");
    scheduleAiOpening(nextGame, namedDocument, currentId);
  };

  // Swap2 后手三选一 / 先手选色（写法对齐官方规则，见 opening-rules.ts 的 swap2Choose 注释）。
  const chooseSwap2Option = (choice: "white" | "black" | "two-more") => {
    if (!aiGame || aiGame.opening.stage.kind !== "swap2-choice" || aiGame.opening.stage.chooser !== "human" || aiThinking) return;
    const opening = swap2Choose(aiGame.opening, choice);
    const nextGame = gameWithOpening(aiGame, opening);
    const namedDocument = documentWithAiNames(document, nextGame);
    setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId };
    setToast(choice === "black" ? "Swap2：你执黑（已交换）" : choice === "white" ? "Swap2：你执白" : "Swap2：再下两颗（白、黑），随后由先手选执子颜色");
    scheduleAiOpening(nextGame, namedDocument, currentId);
  };

  const chooseSwap2Side = (side: "black" | "white") => {
    if (!aiGame || aiGame.opening.stage.kind !== "swap2-pick" || aiGame.opening.stage.chooser !== "human" || aiThinking) return;
    const opening = swap2PickSide(aiGame.opening, side);
    const nextGame = gameWithOpening(aiGame, opening);
    const namedDocument = documentWithAiNames(document, nextGame);
    setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId };
    setToast(`Swap2：你选择执${side === "black" ? "黑" : "白"}`);
    scheduleAiOpening(nextGame, namedDocument, currentId);
  };

  // 塔十第4手后的第二步：此时的黑方选黑5方式（单点 / 摆 10 个打点）。
  const chooseTaraguchiFifthMode = (mode: "single" | "offers") => {
    if (!aiGame || aiGame.opening.stage.kind !== "taraguchi-fifth" || aiGame.opening.stage.actor !== "human" || aiThinking) return;
    const opening = chooseTaraguchiFifth(aiGame.opening, mode);
    const nextGame = gameWithOpening(aiGame, opening);
    const namedDocument = documentWithAiNames(document, nextGame);
    setDocument(namedDocument); setAiGame(nextGame); setPlacementPlayer(nextGame.humanPlayer); recordSession.current = { document: namedDocument, currentId };
    setToast(mode === "single" ? "已选择单点第5手（中心 9×9 内）" : "已选择摆 10 个第5手打点，请依次点击棋盘");
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
    // 开始计时：终局时用它算本次用时（用户 2026-09-21 的管理区「平均用时」）。
    puzzleOpenedAtRef.current = Date.now();

    const collection = collections[collectionIndex];
    const puzzle = collection?.puzzles[nextPuzzleIndex];
    if (!puzzle) return;
    /* 生成器出的题（带 generated 证明链）**也当普通题打开**（用户 2026-10-06：
       「我的做题页面呢，打谱里面的那个做题页面呢，怎么一点就是题目生成器了啊，这两个完全不是一个东西」）。
       以前这里一碰到 generated 就把人弹回「棋题生成器」——那是查看/重生成题目的地方，
       不是做题的地方。现在只在证明与题面不符时拦下（防伪校验照旧），其余情况照常进做题页；
       想再看生成参数/导出这道题，走「对弈 → 进入生成器」那条入口（那边会列出已保存的生成题）。 */
    if (puzzle.generated && !generatedMatchesPuzzle(puzzle.generated, puzzle)) {
      setToast('生成证明与题面不一致，无法打开这道题');
      return;
    }
    // 真实尝试次数在这里 +1（打开即算，含中途放弃）：与 progress.attempts（完局次数）
    // 分开记，才能让「放弃过的题」也进重做队列、让正确率分母有意义。
    setPuzzleOverlays((current) => {
      const key = puzzleProgressKey(collection.id, puzzle.id);
      return updatePuzzleOverlay(current, collection.id, puzzle.id, { attemptCount: (current[key]?.attemptCount || 0) + 1, lastPlayedAt: new Date().toISOString() });
    });
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
    const allCollections = puzzleCollections[puzzleCollectionIndex];
    const key = puzzleProgressKey(allCollections.id, currentPuzzle.id);
    // 终局记录总是更新 solved；attempts 只在本会话首次落子时 +1（进「最近棋题」，
    // 避免每次落子都计数；openPuzzle 重置标记后，重开同题可再记一次）。
    // ⚠ 口径本身在 `nextPuzzleProgressEntry`（与每日一题页共用同一份，别在这里再写一遍）。
    setPuzzleProgress((currentProgress) => {
      const firstMove = !puzzleAttemptRecordedRef.current;
      puzzleAttemptRecordedRef.current = true;
      // 没落子、也没做对 ⇒ 什么都不用记（保持原来那早退，避免空条目进进度表）。
      if (!firstMove && !solved) return currentProgress;
      return {
        ...currentProgress,
        [key]: nextPuzzleProgressEntry(currentProgress[key], solved, firstMove, new Date().toISOString()),
      };
    });
    // 每日一题 / 打卡 / 错题排期：纯函数派生自上一份状态，所以放进 updater 里也是
    // 幂等的（StrictMode 双调用不会重复推进间隔，同一天重复完成也在模块内去重）。
    const collectionId = allCollections.id;
    const todayKey = localDateKey();
    setDailyTraining((current) => recordPuzzleCompletion(current, { collectionId, puzzleId: currentPuzzle.id, solved, today: todayKey }));
    /**
     * 棋魂：**攻克一题 + （若今天这道）完成每日一题**。
     *
     * 这两笔的口径在 `planPuzzleSoul`（与每日一题页共用），这里只负责取了发。
     *
     * ⚠ 这里修掉一个**真实存在过的漏发**：`puzzle-solve`（"攻克一道题"）的说明写着
     * **"题库、生成器出的题都算"**，而实际上只有**生成器**那条路在发 ——
     * 从题库做题这条路只发了 `daily`（而且仅限"今天那道"）。
     * 也就是"从题库攻克十道题，一块棋魂都没有，而说明页写着会给"，
     * 与 `daily` 那次（表里有、代码没有）是同一类问题。
     */
    const isTodaysDaily = Boolean(dailyDecision
      && dailyDecision.pick.puzzleId === currentPuzzle.id
      && dailyDecision.pick.collectionId === collectionId);
    for (const grant of planPuzzleSoul({
      collectionId,
      collectionTitle: allCollections.title,
      puzzleId: currentPuzzle.id,
      puzzleTitle: currentPuzzle.title,
      solved,
      isTodaysDaily,
      today: todayKey,
      amountOf: soulAmount,
    })) {
      progress.earn({ reason: grant.reason, amount: grant.amount, detail: grant.detail, token: grant.token });
    }
    // 覆盖层（用户 2026-09-21）：记录「最近一次结果」与本次用时，供管理区显示正确率/用时。
    // 与 progress.attempts（完局次数）分开记——那个口径错题本与「最近棋题」都在用，不动它。
    const duration = puzzleOpenedAtRef.current ? Date.now() - puzzleOpenedAtRef.current : 0;
    const lastResult: PuzzleLastResult = solved ? "won" : "lost";
    setPuzzleOverlays((current) => updatePuzzleOverlay(current, collectionId, currentPuzzle.id, {
      lastResult,
      lastPlayedAt: new Date().toISOString(),
      ...(duration > 0 ? { lastDurationMs: duration } : {}),
      // 做了题就说明还要继续练：顺手撤掉「已掌握」，否则这道题会一直从错题本消失。
      mastered: false,
    }));
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
      // 离开打谱：分析槽 worker 一并释放，**且必须清槽**（否则下次 startThink
      // 会复用这个已终止的 worker，analyze 投进虚空）。
      releaseThinkWorkerRefs();
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
    // 退出对弈：thinkWorker/rapfiThinkWorker 可能指向分析槽 worker，走统一释放
    // （连带清槽），不能裸 terminate。
    releaseThinkWorkerRefs();
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
    return view.currentId;
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
    applyPuzzleSetupSession(session); triggerBoardMotion("navigate", null);
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
    // 副本只含**已加载的当前可见分支**（动态视图是懒加载的有界投影）。LIB 源另存时导出
    // 仍会以完整原谱为底板（见 exportAsFormat 的 lib 分支），所以只有 DP/分页这类没有
    // 「完整原谱」概念的来源才需要提醒用户：导出不会包含库内其余分支。
    setToast(dynamicSource instanceof RenLibWebViewSession
      ? "已从当前局面创建可编辑副本；另存为 LIB 时会连同原库其余分支一起写出"
      : "已从当前局面创建可编辑副本（只含当前可见分支，原数据库棋谱保持不变）");
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
    // 长按进入历史面板后，松手会再触发一次 onClick；这里把那一次吃掉。
    if (suppressUndoClick.current) { suppressUndoClick.current = false; return; }
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
  /**
   * 撤销历史（audit 2026-09-17）：原来只有「撤销/重做」两个按钮、没有历史面板，
   * 用户连自己刚才改了几步、改了什么都得靠记。这里把草稿栈列成人话，
   * 并支持一次回退到某一步之前（= 连续撤销到那一步）。
   */
  // 撤销按钮长按看历史（audit 2026-09-17）：手机上没有右键，长按是唯一入口。
  const undoHistoryPress = useRef<number | null>(null);
  const suppressUndoClick = useRef(false);
  /** 长按呼出面板时，面板正好盖在手指底下（手机竖屏尤其明显），松手那一下浏览器会把合成的
   *  `mousedown`/`mouseup`/`click` 派给面板里那一行 —— 用户 10-02 报的「功能框出来了，
   *  棋也回退了一步」就是这一串幽灵事件命中了「撤销历史」列表项（`undoToStep`）；平板横屏
   *  则是 mousedown 打在遮罩上，面板刚弹出来就被自己关掉。所以面板弹出后把**落在面板里的
   *  这一串**吞掉；下一次真实按压开始（新的 pointerdown）或触摸被取消就撤防 —— 按住多久都
   *  挡得住，也不会吃掉用户下一次真点击。 */
  const swallowHeldClickInSheet = () => {
    const onGhost = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".sheet-backdrop")) return;
      event.stopPropagation();
      event.preventDefault();
      if (event.type === "click") {
        // 这一发是面板接走的，撤销按钮自己的 onClick 不会再跑，别把那把锁留到下一次点击上。
        suppressUndoClick.current = false;
        disarm();
      }
    };
    const disarm = () => {
      for (const type of ["mousedown", "mouseup", "click"] as const) window.removeEventListener(type, onGhost, true);
      window.removeEventListener("pointerdown", disarm, true);
      window.removeEventListener("pointercancel", disarm, true);
    };
    for (const type of ["mousedown", "mouseup", "click"] as const) window.addEventListener(type, onGhost, true);
    window.addEventListener("pointerdown", disarm, true);
    window.addEventListener("pointercancel", disarm, true);
  };
  const undoToStep = (keepCount: number) => {
    const total = draft.operations.length;
    if (keepCount >= total) return;
    let next = draft;
    for (let index = total; index > keepCount; index -= 1) next = undoDraft(next);
    setDraft(next);
    if (compactIndexOf(document)) {
      if (!hasDraft(next)) void removeDraftForDocument(document.id);
    } else saveDraftToLocal(document.id, next);
    // 被回退掉的 add-move 会让游标指向已经不存在的节点，回到它的父节点。
    const removedMoves = new Set(
      draft.operations.slice(keepCount).filter((op): op is Extract<DraftOp, { type: "add-move" }> => op.type === "add-move").map((op) => op.node.id),
    );
    if (removedMoves.size) setCurrentId((id) => (removedMoves.has(id) ? document.rootId : id));
    setToast(`已回退到第 ${keepCount} 步`);
  };
  const undoHistoryEntries = useMemo(() => {
    const size = document.metadata.boardSize || 15;
    return draft.operations.map((operation, index) => ({ index: index + 1, label: draftOperationLabel(operation, size) }));
  }, [draft.operations, document.metadata.boardSize]);
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
    // 版本历史（audit 2026-09-17）：把**保存前**的那一版留档，这样"改坏了想退回上一版"
    // 才有路可走。SnapshotRepository 早就写好（含按对象条数上限、总字节上限、pinned 不清），
    // 一直没有调用方——这里接上第一处。写失败不影响保存本身。
    try { snapshotRepository.create(document, "manual", "保存前自动留档"); } catch { /* 版本历史是尽力而为，绝不阻断保存 */ }
    // 顺序很重要：**先写库，写成功了才删草稿**。原先是先 removeDraftFromLocal 再 saveToLibrary，
    // 而整份棋谱库是一个 localStorage 键，写满配额时 setItem 会抛 —— 那种情况下草稿也没了、
    // 库里也没写进去，用户看到的就是一份凭空消失的新谱（10-06 报障先按这条兜住）。
    let nextLibrary: GameDocument[];
    try {
      nextLibrary = saveToLibrary(committed);
    } catch (error) {
      recordAction(`保存失败（存储写不进）：${String(error instanceof Error ? error.message : error).slice(0, 80)}`);
      setToast(`保存失败：本机存储写不进去（${String(error instanceof Error ? error.message : error).slice(0, 48)}）。这份棋谱的草稿还留着，请先删几条旧棋谱或做一次导出备份再试`);
      return;
    }
    removeDraftFromLocal(document.id);
    setDocument(committed); setCurrentId(committed.nodes[currentId] ? currentId : committed.rootId);
    setDraft(emptyDraft()); setLibrary(nextLibrary); setSaved(true);
    recordSession.current = { document: committed, currentId: committed.nodes[currentId] ? currentId : committed.rootId };
    setToast("草稿已保存");
  };
  /** 库健康体检：扫一遍重复棋谱（内容签名相同），只报告不自动删。 */
  const openHealthCheck = () => {
    try { setDuplicateGroups(findDuplicateRecords()); } catch { setDuplicateGroups([]); }
    setSheet("health");
  };

  /** 版本历史：打开面板时拉取当前棋谱的留档列表。 */
  const openVersionHistory = () => {    try { setVersionHistory(snapshotRepository.list(document.id)); } catch { setVersionHistory([]); }
    setSheet("versions");
  };

  /** 回到某个留档版本：当前版本会被自动保护（pinned），所以这个动作可以再来一次。 */
  const restoreVersion = (record: SnapshotRecord) => {
    const label = new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false });
    if (!window.confirm(`回到 ${label} 的版本？当前版本会自动留一份保护档，可再次恢复。`)) return;
    void snapshotRepository.restore(record.id, document, async (restored) => {
      const committed = { ...restored, updatedAt: new Date().toISOString(), savedCurrentId: restored.rootId };
      setDocument(committed);
      setCurrentId(committed.rootId);
      setDraft(emptyDraft());
      setLibrary(saveToLibrary(committed));
      setSaved(true);
      recordSession.current = { document: committed, currentId: committed.rootId };
      try { setVersionHistory(snapshotRepository.list(committed.id)); } catch { /* 面板下次打开再刷新 */ }
      setToast(`已回到 ${label} 的版本`);
    }).catch((error: unknown) => setToast(error instanceof Error ? error.message : "恢复版本失败"));
  };

  const saveCurrentDraft = () => {    if (isPagedLibraryView(document) || isDynamicDatabaseView(document)) { setToast("这是数据库浏览源；点空位、标注或编辑注释会自动创建可编辑副本"); return; }
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
      // 备份里的 appVersion 必须跟着构建走：以前写死 "1.1.7"，导出/诊断里一直显示旧版本。
      const snapshot = await createBackupSnapshot(APP_VERSION);
      const stamp = snapshot.exportedAt.replace(/[:.]/g, "-").replace("Z", "");
      const zip = await createZip([
        { name: "banbu-backup.json", data: serializeBackup(snapshot) },
        { name: "README.txt", data: "半步五子棋打谱完整备份包\n\n此 ZIP 包含棋谱库、题库、草稿、书签、设置及大型棋谱索引。请在半步五子棋打谱的‘资料安全 → 恢复完整备份’中选择此文件。\n" },
      ]);
      await exportTextFile(new Blob([zip.buffer]), `半步五子棋打谱备份-${stamp}.zip`, "application/zip", "应用备份包已导出");
      // 成就：完整备份过一次（一次性信号位——备份成功没有账本可查）。
      progress.signal({ didBackup: true });
      /**
       * 棋魂：备份**不再单独发**（2026-10-11）。
       *
       * 原因：用户在评审稿里把 `study`（打谱批注）从来源表删掉了，
       * 于是 `soulAmount("study")` 返回 0 —— 这一笔**本来就发不出去了**。
       * 与其留一行"看起来在发、实际发 0"的代码，不如明确断掉并写清为什么
       * （那行代码会让下一个人以为"备份给棋魂"，而实际不给）。
       *
       * ⚠ 备份这件事本身仍然有反馈：上面的 `signal({ didBackup: true })`
       * 会给「有备无患」那条成就，成就奖励照发。所以"做完事有回报"没有丢。
       * 若将来想恢复：把 `study` 补回 `SOUL_EARN_RULES` 并把这一行改回来。
       */
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
    // 用户主动把这份预览存下来：解除预览标记，之后按正常棋谱走自动保存。
    if (previewDocId === document.id) setPreviewDocId(null);
    recordAction(`保存棋谱：${viewDocument.metadata.title || "未命名"}（${saveDestination === "puzzles" ? "题库" : "棋谱"}）`);
    if (saveDestination === "puzzles") {
      const puzzle: Puzzle = {
        id: `saved-${document.id}-${Date.now().toString(36)}`,
        title: viewDocument.metadata.title || "未命名题目", prompt: "从这个局面开始练习", difficulty: 3,
        player: activePlacementPlayer, rule: viewDocument.metadata.rule, boardSize: viewDocument.metadata.boardSize || 15,
        stones: board.flatMap((row, rowIndex) => row.flatMap((player, colIndex) => player ? [{ row: rowIndex, col: colIndex, player }] : [])),
      };
      // 存进用户选定的题集（用户 2026-09-21）。以前只能按「保存到分组」自动归堆，
      // 结果不同棋谱用同一个分组名就会各建一个同名题集；现在可以直接指定目标。
      const target = savePuzzleTarget ? puzzleCollections.find((collection) => collection.id === savePuzzleTarget) : undefined;
      if (target) {
        commitPuzzleCollections(puzzleCollections.map((collection) => collection.id === target.id ? { ...collection, puzzles: [...collection.puzzles, puzzle] } : collection));
        setSheet(null); setToast(`已存为题目：${target.title}（原棋谱草稿保持不变）`); return;
      }
      const collectionId = `saved-collection-${document.id}`;
      const existing = puzzleCollections.find((collection) => collection.id === collectionId);
      const nextCollections = existing
        ? puzzleCollections.map((collection) => collection.id === collectionId ? { ...collection, title: saveFolder, puzzles: [...collection.puzzles, puzzle] } : collection)
        : [...puzzleCollections, { id: collectionId, title: saveFolder, source: "半步五子棋打谱本地保存", license: "用户本地", puzzles: [puzzle] }];
      commitPuzzleCollections(nextCollections);
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
      if (hasDraft(draft)) commitRegularDraft();
      else {
        // 没有草稿也要先确认写得进去（与 commitRegularDraft 同一口径的失败提示）。
        try { setLibrary(saveToLibrary(document)); setSaved(true); }
        catch (error) { recordAction(`保存失败（存储写不进）：${String(error instanceof Error ? error.message : error).slice(0, 80)}`); setToast(`保存失败：本机存储写不进去（${String(error instanceof Error ? error.message : error).slice(0, 48)}），请先删几条旧棋谱或做一次导出备份再试`); return; }
      }
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
      // kind 由画法推导（不能恒为 label，否则圆圈/三角会被导出成 LB[..:?] 问号）。
      const nextMarks = localHere ? previous.filter((mark) => !samePoint(mark)) : [...previous, { ...position, kind: markKindForStyle(annotationStyle), label: currentAnnotationLabel, style: annotationStyle, color: annotationColor }];
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
    // 一步取消：该点已有任何标注（不论文字/样式，含变化点原生标注）→ 整点移除；空点 → 放置。
    // 只有「文字」画法才必须有内容；图形（勾/叉/圆/方…）配合内容「无」时可以纯图案放置。
    const existingHere = nativeMarkAt(position);
    if (!existingHere && !currentAnnotationLabel && annotationStyle === "text") { setToast("请先在标注面板输入文字，或把「内容」切到「无」只放图案"); return; }
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
      : [...(current.marks || []), { ...position, kind: markKindForStyle(annotationStyle), label: currentAnnotationLabel, style: annotationStyle, color: annotationColor }];
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
      navigateDynamic(session, () => session.moveToNodeId(target.id, target.move!), () => { exitAnnotationMode(); setSheet(null); }, hasDraft(draft) ? draft : undefined);
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
  // ── 拍平原谱的三选一裁决（用户 2026-09-28）───────────────────────────
  // 两个"退出"动作会把三选弹出来：离开编辑面板（上面那条效应）、以及 withDraftGuard
  // 那条链（切谱 / 新建 / 导入）。这里只登记事实与执行选择。
  /** 只有「棋谱库里那份还带手序」才武装这笔待裁决改动：新建的谱、识谱刚导入的谱
   * （库里那份本来就是静态局面，或还没入库）拍平都不丢已保存的手序，不该被打断。 */
  const armFlattenGuard = () => {
    if (previewDocId === document.id) return;
    const stored = library.find((item) => item.id === document.id);
    if (!storedRecordHasMoveOrder(stored)) return;
    setFlattenChoice({ documentId: document.id, restore: stored as GameDocument });
    setFlattenPromptOpen(false);
  };
  /** 把当前这份（含未保存草稿与刚拍平的结果）另存为棋谱库里独立的一份「修改副本」，原谱不动。 */
  const createModificationCopyHere = () => {
    const base = hasDraft(draft) ? applyDraftToDocument(document, draft.operations) : document;
    const copy = createModificationCopy(base, currentId);
    const copyId = copy.savedCurrentId && copy.nodes[copy.savedCurrentId] ? copy.savedCurrentId : copy.rootId;
    setDocument(copy);
    setCurrentId(copyId);
    setDraft(emptyDraft());
    recordSession.current = { document: copy, currentId: copyId };
    setLibrary(saveToLibrary(copy));
    setSaved(true);
    return copy;
  };
  const finishFlattenChoice = (action: (() => void) | null) => {
    setFlattenChoice(null); setFlattenPromptOpen(false); setAfterFlatten(null);
    action?.();
  };
  const resolveFlattenOverwrite = () => {
    const action = afterFlatten;
    const committed = hasDraft(draft) ? applyDraftToDocument(document, draft.operations) : document;
    setLibrary(saveToLibrary(committed));
    setSaved(true);
    finishFlattenChoice(action);
    setToast("已覆盖棋谱：手序与分支已转成静态局面，这一步不可撤销");
  };
  const resolveFlattenCopy = () => {
    const action = afterFlatten;
    createModificationCopyHere();
    finishFlattenChoice(action);
    setToast("已另存为「修改副本」，棋谱库里那份原谱保持不变");
  };
  const resolveFlattenDiscard = () => {
    const pending = flattenChoice;
    const action = afterFlatten;
    if (pending) {
      const original = library.find((item) => item.id === pending.documentId) || pending.restore;
      const backId = original.savedCurrentId && original.nodes[original.savedCurrentId] ? original.savedCurrentId : original.rootId;
      setDocument(original); setCurrentId(backId); setDraft(emptyDraft());
      recordSession.current = { document: original, currentId: backId };
      setSaved(true);
    }
    finishFlattenChoice(action);
    setToast("已放弃这次改动，棋谱库里那份仍带手序");
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
      armFlattenGuard();
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
      // 保留编辑面板（用户 09-17：去掉状态栏的「退出」按钮，改由按钮自身的图案/颜色表示状态，
      // 面板关掉就看不出还在去子，所以进入时把面板钉在编辑上）。
      exitAnnotationMode(); setAnnotationErase(false); setDockPanel("notes");
      setToast("去子已开启：点击棋盘上的棋子即可删除；再点一次「去子」结束");
    } else {
      setToast("已结束去子");
    }
  };
  // 环形菜单的「去子」（用户 09-26 改版）：**一次动作删一颗**，不再借 toggleEraseStone
  // 进入常驻的去子状态。菜单本身就是"我已经选中了这颗子"，再进状态等于让后面每一次
  // 点击棋盘都在删子，用户要退还得回编辑面板找那个按钮。编辑面板里的「去子」保持原样
  // （那里没有"命中的是哪颗子"这个信息，只能做成模式）。删子语义仍走 eraseStoneAt：
  // 带手序/分支的谱第一次删会拍平成静态局面，这是去子功能既有的规矩。
  const eraseStoneOnce = (position: Position) => {
    if (aiGame) { setToast("人机对局中暂不能去子，请先退出对局"); return; }
    if (mode === "review") { reviewBlocked(); return; }
    // 长按只在有子的点上出菜单，但**右键空位也出**（shouldOpenRadialMenu 对 contextMenu
    // 不看 hasStone）。不挡的话右键空位→去子，会在"删一颗不存在的子"的同时把整谱拍平。
    if (!board[position.row]?.[position.col]) {
      playSound("warning"); showBoardFeedback(position, "illegal");
      setToast(`${coordinateName(position, viewDocument.metadata.boardSize || 15)} 上没有棋子，无需去子`);
      return;
    }
    eraseStoneAt(position);
  };
  // 点已有棋子＝回退一步（用户 09-26：五子棋工具里的同类手感）。返回 true 表示这次点击
  // 已被消费，调用方不要再走"点不动"的提示。
  // 生效范围只认**没有对弈**的盘面：打谱与读谱都算；人机/双人对局、做题，以及标注/去子
  // 这类"点棋盘另有含义"的编辑态一律不生效（它们在 play() 里要么先返回、要么被这层排除）。
  // 开关在设置 →「可选增强功能」→「点棋子回退一步」，默认开。
  const stepBackByStoneTap = (): boolean => {
    if (!enhancementSettings.tapStonePrev) return false;
    if (isPuzzleMode) return false;
    if (aiGame) return false;
    if (annotationActive || eraseStone) return false;
    // 已经在起始局面：给出明确交代并**消费掉**这次点击/右键，不再落回"这里不能落子"的
    // 非法提示、也不弹环形菜单——否则同一个右键会在不同手数下有两个含义，用户会以为是 bug。
    // （开关关掉、或在对弈/做题里，上面已经 return false，那时右键照旧呼出环形菜单。）
    if (!current.parentId && !pagedSession.current && !dynamicViewSession.current) {
      setToast("已经在起始局面了");
      return true;
    }
    goPrev();
    return true;
  };
  /** 位移弹层：贴编辑面板上沿弹出（面板 overflow:hidden，必须 portal 到 body）。 */
  const openBoardShift = () => {
    // ⚠ 必须写 window.document：本文件里 `document` 是棋谱状态（GameDocument），
    // 直接写 document.querySelector 会 TS2339，而且读的是棋谱对象不是 DOM。
    const rect = window.document.querySelector(".dock-panel")?.getBoundingClientRect();
    // 有编辑面板就贴着它上沿；从环形菜单进来时底部 dock 可能停在任何标签页、甚至没展开，
    // 那就落在底部导航上方（手机竖屏导航 78px 上下，92 刚好不被压住）。
    const wanted = rect ? Math.max(120, Math.round(window.innerHeight - rect.top + 8)) : 92;
    // 矮横屏（844×390）放不下 320 高的方向盘：按视口高收一下，别让顶边被推出屏幕上沿。
    setBoardShiftBottom(Math.max(12, Math.min(wanted, Math.round(window.innerHeight - 350))));
    setBoardShiftOpen(true);
  };
  // 整体位移：dx/dy 是格数（-1/0/1）。语义与「去子」一致——带落子记录的棋谱先拍平为
  // 静态局面（拍平不可撤销，会明说），静态局面下的位移走草稿、可用「撤销」逐步退回。
  // 有棋子会移出棋盘时**直接拒绝**（不静默裁剪：裁过的局面看起来像「识别又错了几颗」，
  // 比原样不动更难排查）。
  const shiftPosition = (dx: number, dy: number) => {
    const label = dy < 0 ? "上" : dy > 0 ? "下" : dx < 0 ? "左" : "右";
    if (aiGame) { setToast("人机对局中暂不能整体位移，请先退出对局"); return; }
    if (mode === "review") { reviewBlocked(); return; }
    const rootId = viewDocument.rootId;
    const root = viewDocument.nodes[rootId];
    if (!root) return;
    const base = hasDraft(draft) ? applyDraftToDocument(document, draft.operations) : document;
    const baseBoard = boardAt(base, currentId);
    const size = base.metadata.boardSize || 15;
    const stones: Array<{ player: Player; row: number; col: number }> = [];
    baseBoard.forEach((row, r) => row.forEach((player, c) => { if (player) stones.push({ player, row: r, col: c }); }));
    if (!stones.length) { setToast("当前局面还没有棋子，无法整体位移"); return; }
    const outside = stones.filter((stone) => stone.row + dy < 0 || stone.col + dx < 0 || stone.row + dy >= size || stone.col + dx >= size).length;
    if (outside) {
      playSound("warning");
      setToast(`整体${label}移会把这 ${outside} 颗棋子移出棋盘（${size} 路），已取消；先往回移或改方向`);
      return;
    }
    const flat: NonNullable<RecordNode["setup"]> = { black: [], white: [], empty: [], nextPlayer: "black" };
    for (const stone of stones) flat[stone.player].push({ row: stone.row + dy, col: stone.col + dx });
    flat.nextPlayer = flat.black.length > flat.white.length ? "white" : "black";
    if (root.children.length > 0) {
      const rootNode = base.nodes[rootId];
      const nextDoc = { ...base, nodes: { ...base.nodes, [rootId]: { ...rootNode, children: [], preferredChildId: undefined, move: null, setup: flat } } };
      setDocument(nextDoc); setCurrentId(rootId); setDraft(emptyDraft());
      recordSession.current = { document: nextDoc, currentId: rootId };
      armFlattenGuard();
      setToast(`已整体${label}移一格；棋谱已转为无手序的静态局面`);
      return;
    }
    recordDraft({ type: "update-node", nodeId: rootId, patch: { setup: flat } });
    setCurrentId(rootId);
    recordSession.current = { document, currentId: rootId };
    setToast(`已整体${label}移一格`);
  };
  const play = (position: Position, options: { ignoreAnnotation?: boolean } = {}) => {
    // AI 思考期间棋盘是 disabled 的（见 aiBoardDisabled），但点击会被**静默**吞掉：
    // 用户看到 banner 已经写着「第 4 手 · 白方可在棋盘任意空位落子」，点上去毫无反应，
    // 很容易误判成「规则判定坏了」或「卡住了」。09-16 排查「对称也能下子」时，这类误判
    // 正是把探针竞态读成产品 bug 的原因（那一下根本不会进候选数组）。给一句明确反馈。
    if (aiThinking && mode === "record" && aiGame) {
      setToast(aiOpeningStage && aiOpeningStage.kind === "place"
        ? `AI 正在按开局规则落第 ${aiOpeningStage.moveNumber} 手，请稍候`
        : "AI 正在思考，请稍候");
      return;
    }
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
    /**
     * 自定义开局的**摆子阶段**（用户 2026-10-13）。必须拦在下面那段"点已有棋子"处理**之前**：
     * 否则会被打谱侧的「点子回退一步」（`stepBackByStoneTap`）吞掉，而摆子时那一下应该什么都不改。
     * 颜色按 `nextPlayer` 轮流（黑先），所以摆出来的永远是**合法对局局面**，"该谁走"也由手数
     * 自然决定；摆错了用横幅上的「撤销摆子」往回退，不做"点子改色"那种破坏轮流的事。
     */
    if (duelSetupPhase && aiGame) {
      if (occupiedPoint) { playSound("warning"); showBoardFeedback(position, "illegal"); setToast("摆子阶段点已有棋子不生效：要重摆请用「撤销摆子」"); return; }
      if (nextPlayer === "black" && aiGame.forbiddenEnabled) {
        const reason = forbiddenReason(board, position);
        if (reason) { playSound("warning"); showBoardFeedback(position, "forbidden"); setToast(`此处为黑方${reason}：这一局按有禁手摆，换一个点或用「撤销摆子」`); return; }
      }
      /**
       * 摆子不许摆出**已经分出胜负**的局面。胜负是在「落子那一刻」判的（`winnerAt(nextBoard, …)`），
       * 摆下去的这些子没经过那一刻 —— 一旦连五留在盘上，开始对局之后谁也不会再判它，
       * AI 会照常在一个早就结束的局面上下下去。所以当场拒，而不是等「开始对局」再补判。
       */
      const trial = board.map((row) => [...row]); trial[position.row][position.col] = nextPlayer;
      if (winnerAt(trial, position, document.metadata.rule)) { playSound("warning"); showBoardFeedback(position, "illegal"); setToast(`这一手会连成五子：自定义开局摆不出已经分出胜负的局面，换一个点或用「撤销摆子」`); return; }
      const result = addMoveAs(document, currentId, position, nextPlayer);
      if (!result.created) return;
      setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place", result.nodeId);
      playSound(nextPlayer === "black" ? "move-black" : "move-white");
      recordSession.current = { document: result.document, currentId: result.nodeId };
      /**
       * **每摆一颗不弹提示**（用户 2026-10-14：「每摆一颗子，都会弹出一个提示然后在棋盘上面浮现，
       * 遮挡棋盘……放到最底下或者直接不要这个弹窗了」）。选「不要」：这一屏本来就一直在报进度
       * （棋盘上面那行「已摆 N 子 · 下一手 X」带 aria-live）＋落子音＋子就出现在点上，
       * 弹层只是把刚落下那颗子盖住。真正需要说话的是**拒绝**（点到已有子、禁手点、摆出连五），
       * 那几条仍然弹，因为它们解释"为什么没落子"。
       */
      return;
    }
    // A variation affordance is only valid on an empty intersection. Reject an
    // occupied click before any fallback coordinate lookup can navigate to a
    // stale or malformed branch target. Annotation editing has already returned.
    if (occupiedPoint) {
      // 点已有棋子＝回退一步（用户 09-26，可在设置里关）。它要么消费掉这次点击，
      // 要么保持原来的"点不动"提示——绝不会在提示的同时顺带改别的东西。
      if (stepBackByStoneTap()) return;
      playSound("warning");
      showBoardFeedback(position, "illegal");
      return;
    }
    if (mode === "review") {
      const existing = findVisibleVariationTarget(viewDocument, currentId, position);
      if (existing) { navigateVariation(existing.target.id); return; }
      // 原先空棋盘上这句会显示「当前已到棋谱末尾」，听起来像坏了 —— 其实是因为
      // 处在读谱模式（本来就不能落子）。把原因和解法一起说（用户 10-06 报的
      // 「有时在空白盘点不了棋子」，先消掉这类误导）。
      setToast(current.children.length ? "读谱模式只能点已有的变化 · 要落子请切到「打谱」" : "读谱模式不能落子 · 要摆棋请切到「打谱」");
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
          setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place", result.nodeId); playSound(openingStage.player === "black" ? "move-black" : "move-white"); setAiGame(nextGame); recordSession.current = { document: result.document, currentId: result.nodeId };
          setToast(`已完成第 ${openingStage.moveNumber} 手 · ${coordinateName(position)}`);
          scheduleAiOpening(nextGame, result.document, result.nodeId);
          return;
        }
        // Swap2 的连下阶段：一方一次放多子，颜色按 colors 顺序（黑·白·黑 / 白 / 白·黑）
        if (openingStage.kind === "batch") {
          if (openingStage.actor !== "human") { setToast("AI 正在摆放开局棋子"); return; }
          if (board[position.row]?.[position.col]) { showBoardFeedback(position, "illegal"); setToast("该位置已有棋子，请换一个位置"); return; }
          const player = openingStage.colors[openingStage.placed];
          const result = addMoveAs(document, currentId, position, player);
          if (!result.created) return;
          const opening = placeBatchStone(aiGame.opening);
          const nextGame = gameWithOpening(aiGame, opening);
          setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place", result.nodeId); playSound(player === "black" ? "move-black" : "move-white"); setAiGame(nextGame); recordSession.current = { document: result.document, currentId: result.nodeId };
          setToast(`已完成第 ${openingStage.placed + 1} 颗开局子 · ${coordinateName(position)}`);
          scheduleAiOpening(nextGame, result.document, result.nodeId);
          return;
        }
      if (openingStage.kind === "offer-fifths") {
          if (openingStage.actor !== "human") { setToast("AI 正在准备第5手候选"); return; }
          const reason = aiGame.forbiddenEnabled ? forbiddenReason(board, position) : null;
          if (reason) { playSound("warning"); showBoardFeedback(position, "forbidden"); setToast(`候选点 ${coordinateName(position)} 为${reason}`); return; }
          const counterpart = symmetricCounterpart(board, aiGame.opening.candidates, position);
          if (counterpart) {
            showBoardFeedback(position, "illegal");
            setToast(counterpart.row === position.row && counterpart.col === position.col
              ? "这个位置已经摆过打点了，请换一个位置"
              : `本局局面自身关于某条轴/某个中心对称，${coordinateName(position)} 与已摆的 ${coordinateName(counterpart)} 同形，请换一个位置`);
            return;
          }
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
        if (openingStage.kind !== "choose-fifth") { setToast("请先在开局提示卡中完成当前开局步骤"); return; }
        if (openingStage.chooser !== "human") { setToast("AI 正在选择第5手候选"); return; }
        const selected = aiGame.opening.candidates.find((candidate) => candidate.row === position.row && candidate.col === position.col);
        if (!selected) { showBoardFeedback(position, "illegal"); setToast("请点击棋盘上带编号的第5手候选"); return; }
        const result = addMoveAs(document, currentId, selected, "black");
        const opening = completeFifthChoice(aiGame.opening);
        const nextGame = gameWithOpening(aiGame, opening);
        setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place", result.nodeId); playSound("move-black"); setAiGame(nextGame); recordSession.current = { document: result.document, currentId: result.nodeId };
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
        // 开局阶段不许「回退后重下」（对齐五林 msg.15051「开局阶段不能悔棋」）：
        // 开局会话（aiGame.opening）按落子顺序推进，回退重下会让阶段与盘面脱节。
        if (aiOpeningStage && aiOpeningStage.kind !== "normal") { setToast("开局阶段不能悔棋，请先完成开局"); return; }
        // 已经在这个点上（回退后原地重下）：复用节点，继续让 AI 应手。
        const existingVariation = findVisibleVariationTarget(document, currentId, position);
        const existingChild = current.children
          .map((id) => document.nodes[id])
          .find((node) => node?.move && node.move.row === position.row && node.move.col === position.col);
        const resumeTarget = existingVariation?.target ?? existingChild;
        if (resumeTarget && humanTurn) {
          // 复用已有节点＝就是「下这一步」。光标推进到该节点，然后照常让 AI 应手，
          // 这样棋力与正常对局一致，也不会在树里重复造出同一个点的分支。
          setCurrentId(resumeTarget.id); triggerBoardMotion("place", resumeTarget.id);
          playSound(aiGame.humanPlayer === "black" ? "move-black" : "move-white");
          setSheet(null);
          const resumedBoard = boardAt(document, resumeTarget.id);
          if (winnerAt(resumedBoard, position, document.metadata.rule)) {
            aiGameEndReason.current = "你连成五子"; setAiGame((game) => game ? { ...game, outcome: "won" } : game);
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
            setCurrentId(aiChild.id); triggerBoardMotion("place", aiChild.id);
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
          setCurrentId(resumeTarget.id); triggerBoardMotion("branch", null); setSheet(null);
          setToast(`已回到这一步（${coordinateName(position)}），现在轮到你`);
          return;
        }
        if (aiGame.forbiddenEnabled && turn === "black") {
          const reason = forbiddenReason(board, position);
          if (reason) { playSound("warning"); showBoardFeedback(position, "forbidden"); setToast("此处为黑方" + reason + "，请选择其他位置"); return; }
        }
        const branch = addMoveAs(document, currentId, position, turn);
        if (!branch.created) return;
        setDocument(branch.document); setCurrentId(branch.nodeId); triggerBoardMotion("place", branch.nodeId); playSound(turn === "black" ? "move-black" : "move-white");
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
      setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place", result.nodeId); playSound(aiGame.humanPlayer === "black" ? "move-black" : "move-white");
      recordSession.current = { document: result.document, currentId: result.nodeId };
      const nextBoard = boardAt(result.document, result.nodeId);
      if (winnerAt(nextBoard, position, result.document.metadata.rule)) { playSound("success"); aiGameEndReason.current = "你连成五子"; setAiGame({ ...aiGame, outcome: "won" }); setToast("你已连成五子，本局获胜"); return; }
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
        triggerBoardMotion("place", applyPuzzleSetupSession(result.session));
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
      setDocument(result.document); setCurrentId(result.nodeId); triggerBoardMotion("place", result.nodeId); playSound(battlePlayer === "black" ? "move-black" : "move-white");
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
      setCurrentId(draftId); triggerBoardMotion("place", draftId); playSound(activePlacementPlayer === "black" ? "move-black" : "move-white");
      setToast("已加入未保存草稿，点击保存后提交");
      return;
    }
    // 禁手只对黑棋成立，判「现在是不是黑走」必须用 nextPlayerAt：depthOf 只数带
    // 落子的节点，遇到 setup.nextPlayer 预置局面（题目预置、SGF 的 PL[W]）会与棋盘
    // 上实际行棋方不一致——那样会在白棋回合弹禁手提示，或者黑棋回合不弹。
    // 与上面 canRenderForbiddenAssistance 同口径：提示也不再要求棋谱规则字段是 renju
    // （2026-10-06：否则 freestyle/无 RU 的棋谱会出现"看点有标记、点上去却不说为什么"）。
    if (showForbidden && nextPlayerAt(viewDocument, currentId) === "black") { const reason = forbiddenReason(board, position); if (reason) setToast(`禁手辅助：${coordinateName(position)} 可能是${reason}（仍允许研究落子）`); }
    const result = placementLocked
      ? addMoveAs(viewDocument, currentId, position, activePlacementPlayer)
      : addMove(viewDocument, currentId, position);
    if (!result.created) { showBoardFeedback(position, "illegal"); return; }
    setCurrentId(result.nodeId);
    triggerBoardMotion("place", result.nodeId);
    playSound((result.document.nodes[result.nodeId]?.move?.player || activePlacementPlayer) === "black" ? "move-black" : "move-white");
    setContinuationEditMode(false);
    const node = result.document.nodes[result.nodeId];
    if (node) recordDraft({ type: "add-move", parentId: currentId, node: { ...node, children: [...node.children], marks: [...node.marks] } });
  };
  const mark = (position: Position) => {
    // 长按/右键标注用的画笔：面板打开时带上它选的形状/颜色/文字（不带就会出现
    // 「面板里选了颜色、标出来还是墨黑」，用户 09-17 报的就是这个）。
    const brush: Partial<BoardMark> = annotationActive
      ? { kind: markKindForStyle(annotationStyle), style: annotationStyle, color: annotationColor, ...(currentAnnotationLabel ? { label: currentAnnotationLabel } : {}) }
      : {};
    if (mode === "review") {
      let removed = false;
      setReviewMarks((allMarks) => {
        const previous = allMarks[reviewMarkKey] || [];
        removed = previous.some((mark) => mark.row === position.row && mark.col === position.col);
        const nextMarks = toggleMark(previous, position, brush);
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
    recordDraft({ type: "update-node", nodeId: currentId, patch: { marks: toggleMark(current.marks, position, brush) } });
    setToast(editingDatabaseView ? "已创建编辑副本并加入标注，原数据库不变" : "标注已加入草稿");
  };
  // 环形菜单的「打标」（用户 10-01：三档循环，第四下清除；按钮在默认页）。写的是**按下的那一手**
  // 的节点——safeUpdateNode 把 nodeId 写死成 currentId，这里必须显式带 id，否则"给第 5 手
  // 打标"会打到当前手上去。撤销走草稿栈，与别的改谱动作一致。
  const setNodeEvaluationAt = (nodeId: string, value: NodeEvaluation | "") => {
    if (mode === "review") { reviewBlocked(); return; }
    if (mode !== "record" || aiGame || isPuzzleMode) { setToast("现在不能改棋谱，请先回到打谱或退出对局"); return; }
    const node = viewDocument.nodes[nodeId];
    if (!node) return;
    const hand = depthOf(viewDocument, nodeId);
    recordDraft({ type: "update-node", nodeId, patch: value
      ? { evaluation: value, evaluationLevel: 1 }
      : { evaluation: undefined, evaluationLevel: undefined } });
    setToast(value ? `第 ${hand} 手标为${evaluationLabel(value)}` : `第 ${hand} 手的标记已清除`);
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
  // Board 是 memo 组件：预览线为空时必须复用同一个空数组常量（原先的 `: []`
  // 每渲染都换新引用，引擎进度每 100ms 一次 → 2 秒内白白重渲染整盘 ~20 次）。
  // 未固定预览点时 previewCandidate 恒为 undefined，依赖不变、结果恒为常量；
  // 固定了预览点时只在候选对象真正变化时重算，避免无意义的新数组。
  const previewCandidate = analysisPreview && aiAnalysis.contextKey === analysisPreview.contextKey
    ? (aiAnalysis.candidates || EMPTY_ANALYSIS_CANDIDATES).find((candidate) => candidate.move.row === analysisPreview.row && candidate.move.col === analysisPreview.col)
    : undefined;
  const analysisPreviewLine = useMemo(
    () => previewCandidate?.principalVariation?.slice(0, 24) ?? EMPTY_PREVIEW_LINE,
    [previewCandidate],
  );
  // 非 15 路的棋力降级只弹一次（同一「路数+规则」组合），面板里的常驻标记仍然
  // 一直在，所以不必每次开分析都打断；换路数或换规则会重新提示。
  const strengthNoticeShownRef = useRef("");
  const announceEngineDowngrade = () => {
    const size = viewDocument.metadata.boardSize || 15;
    const rule = viewDocument.metadata.rule;
    const notice = boardSizeStrengthNotice(size, rule);
    if (!notice) return;
    const key = `${size}:${rule}`;
    if (strengthNoticeShownRef.current === key) return;
    strengthNoticeShownRef.current = key;
    setToast(notice);
  };
  const toggleAnalysis = (enabled: boolean) => {
    // 复盘独占引擎：运行中打开分析开关若是静默 no-op，用户会看到「开关开着却不算」
    // 的鬼状态（startThink 的 auto 路径不打 toast）——在入口直接拦下并说明。
    if (enabled && gameReviewRunRef.current?.active) { setToast("整局复盘运行中，请先在复盘区点「停止」再开启分析"); return; }
    // 用户本次会话显式开启 → 解除「本会话未武装」状态，后续换手/换面自动续算
    analysisAutoArmedRef.current = enabled;
    try {
      if (enabled) sessionStorage.setItem("banbu-analysis-armed-v1", "1");
      else sessionStorage.removeItem("banbu-analysis-armed-v1");
    } catch { /* 隐私模式等：拿不到就按未武装处理（更保守） */ }
    if (enabled) { autoAnalysisKey.current = ""; announceEngineDowngrade(); }
    else autoAnalysisKey.current = currentPositionKey;
    // 提示模式下打开「开启」= 切回持续分析模式（提示模式不跑后台滚动分析，见 withAnalysisMode）。
    changeEnhancementSettings(enabled && enhancementSettings.analysisHintMode
      ? withAnalysisMode({ ...enhancementSettings, analysisAuto: true }, "continuous")
      : { ...enhancementSettings, analysisAuto: enabled });
  };
  const startThink = (options: { auto?: boolean; continuous?: boolean; playMove?: "hint" | "selfplay"; timeMsOverride?: number } = {}) => {
    // **后台不点火**（真机取证见 appHidden 注释）：自动分析、自愈保活、自对弈三条路都会
    // 绕到这里重发请求，拦在入口比在三处 effect 各补一遍可靠。这里必须在改任何状态之前返回，
    // `autoAnalysisKey` 保持旧值，回前台时自动分析 effect 会照常重新开一轮。
    if (appHidden()) return;
    // 用户主动的落子型回合（提示/自对弈）可以打断正在跑的后台滚动分析：否则
    // 「提示模式下点分析没反应」——分析轮把请求静默吞掉（用户 09-10 反馈）。
    if (thinkRunning && !options.auto && !options.playMove) return;
    // 整局复盘独占引擎：复盘运行时不接受新的分析请求（提示/自对弈同样让路）。
    if (gameReviewRunRef.current?.active) {
      if (!options.auto && !options.playMove) setToast("整局复盘运行中，请先在复盘区点「停止」再分析");
      return;
    }
    // 做题只放行「提示模式」这一种落子型请求（用户 2026-09-10）；持续分析/自对弈仍限打谱。
    const puzzleHint = mode === "puzzle" && options.playMove === "hint";
    if ((mode === "puzzle" && !puzzleHint) || aiGame) return;
    // 引擎支持 22 路以内的任意盘面（实测 5–22 生效、23 路起引擎回
    // "Unsupported board size!"）。非 15 路仍可分析，只是冠军权重覆盖不同，
    // 由 announceEngineDowngrade() 明确提示，不再静默禁用。
    if (!engineSupportsBoardSize(viewDocument.metadata.boardSize || 15)) return;
    announceEngineDowngrade();
    // 落子型回合（提示/自对弈）只在打谱（以及做题的提示）生效：读谱下 play() 会变成走子导航。
    if (options.playMove && mode !== "record" && !puzzleHint) return;
    cancelActiveAiComputation("superseded");
    const generation = ++thinkGeneration.current;
    setThinkRunning(true);
    // 盘面尺寸参与选型：旗舰档（KataGo）只支持 15 路以内，超限自动按强力档走。
    const thinkBoardSize = viewDocument.metadata.boardSize || 15;
    const thinkEngineChoiceRaw = effectiveEngineChoice(aiEngineChoice, thinkBoardSize);
    // 用户 10-01：「现在应该是随着引擎切换而切换，不过切换需要时间，不知道这个耗费的时间
    // 能不能做到无缝切换 rapfi」。答：能，且只在「还没就绪」这一段时间里生效 ——
    // 选了 katago 但网络包/进程还在加载（代码里记录的实测：手机冷加载 10~30 秒）时，
    // 这一轮先用已就绪的 rapfi（强力档）答完，kata 预热完成后**下一轮自动回到 kata**。
    // 刻意不写回 aiEngineChoice、也不落盘：那是用户的设置，不是本轮的事实。
    // 面板与 toast 说的都是这一轮真正跑的引擎（noteEngineVariant / aiAnalysisEngineRef）。
    const thinkEngineChoice = thinkEngineChoiceRaw === "kata" && !kataEngineReady ? "strong" : thinkEngineChoiceRaw;
    // 引擎跟随设置：用户选强力/实验就用对应引擎（做题也不例外——用户 09-10
    // 明确不要掐算力）。冷加载由启动预热 effect 提前消化，点分析时引擎通常已就绪。
    let analysisPackUrl = engineNeedsPack(thinkEngineChoice) ? enginePackUrlRef.current : null;
    // 本会话 rapfi 已持续失败（F1）：直接落轻量，不再触发「重建→崩→toast→轻量」
    // 连环；双槽已被 useFallback 清空，换面重启也不会再冷加载 40MB 包。
    if (rapfiAnalysisBlockedRef.current) analysisPackUrl = null;
    const analysisEngineVariant = engineVariantFor(thinkEngineChoice, analysisPackUrl, thinkBoardSize);
    // Re-runs on the same position keep the previous round's visible results
    // (rolling accumulation): a pass with a warm transposition table only
    // strengthens the numbers, it must never blank or reset them.
    // **换手（key 已变）必须把上一局的读数一并清空**——旧实现在这里只清了
    // depth/nodes，胜率/评估分/候选都留着，而新轮要过好几秒才吐第一帧
    // （真机实测首帧延迟 0.46~47.9s），这段时间面板显示的是**上一手的胜率**，
    // 用户看到的就是「换了手但胜率还是老样子、过一会儿才跳」（用户 09-28 报）。
    setAiAnalysis((current) => current.contextKey === currentPositionKey
      ? { ...current, status: "thinking", engine: analysisEngineVariant, mover: nextPlayer }
      : { status: "thinking", engine: analysisEngineVariant, mover: nextPlayer, depth: 0, nodes: 0, speed: undefined, score: undefined, scoreAvailable: false, winRate: undefined, candidates: [], move: null, contextKey: currentPositionKey });
    // 新一轮开始：丢掉合流窗口里上一轮的待发帧。否则那个旧帧会在这个「换手就清空读数」
    // 之后落地，把刚清掉的胜率/候选又写回来（看起来就是换手后先闪一下旧数字）。
    analysisProgressPump.current?.reset();
    // 引擎 worker 槽：持续分析轮走双 worker 乒乓（slot0 主 / slot1 备）——落子/
    // 换手时旧轮 WASM 物理忙（cancel 消息排队），立即在空闲 slot 上开始真计算。
    // 轻量引擎双开（~5MB/个）；rapfi 启动时也已双预热（40MB×2 heap，低内存
    // 设备由 worker 内 chooseVariant 自动降级），同样乒乓。aiGame 人机对局另用
    // rapfiPersistentWorker（1895），与分析 slot 互不干扰。
    const thinkSlotKey = engineSlotKeyFor(thinkEngineChoice, analysisPackUrl, thinkBoardSize);
    const slots = analysisPersistent.current;
    const a = slots[0], b = slots[1];
    // 滚动续算（同面）：用上次的 slot，TT 继承；换手（key 已变）：优先另一
    // 个已加载的空闲 slot（terminate 重建的 slot 在 warmup，选中会冷等待）。
    const rolling = autoAnalysisKey.current === currentPositionKey;
    // 旗舰只用一个槽（单例进程，见预热处的注释）：乒乓选择会去拿不存在的
    // slots[1]、或把唯一的槽判成「忙」而频繁重建 worker——单例引擎下重建
    // 毫无收益（进程与缓存都在原生侧，worker 只是管道）。
    const dualSlot = thinkEngineChoice !== "kata";
    let slotIndex: number;
    if (!dualSlot) slotIndex = 0;
    else if (rolling && slots[lastAnalysisSlot.current]) slotIndex = lastAnalysisSlot.current;
    else if (slots[1 - lastAnalysisSlot.current] && !slots[1 - lastAnalysisSlot.current]!.running) slotIndex = 1 - lastAnalysisSlot.current;
    else slotIndex = !a || !a.running ? 0 : b && !b.running ? 1 : 0;
    lastAnalysisSlot.current = slotIndex;
    let slot = slots[slotIndex];
    if (!slot || slot.key !== thinkSlotKey || slot.dead) {
      // dead = 这个 worker 已被某处 terminate（槽没清干净）：复用它等于把 analyze
      // 投进虚空（postMessage 到已终止 worker 静默丢弃），必须重建。
      if (slot) slot.worker.terminate();
      slot = makeAnalysisSlot(thinkSlotKey);
      analysisPersistent.current[slotIndex] = slot;
    } else if (dualSlot && rolling && slot.running) {
      // WASM 旧轮物理忙：用备用槽接新请求（单例引擎没有这个问题，不必换槽）
      const spare = analysisPersistent.current[1 - slotIndex];
      if (spare && spare.key === thinkSlotKey && !spare.running) slot = spare;
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
      kataDiag(`app:accept gen=${generation} curGen=${thinkGeneration.current} isCurrent=${controller.isCurrent(handle)} move=${result.move ? result.move.row + "," + result.move.col : "null"}`);
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
      setAiAnalysis((current) => ({ ...current, status: result.move ? "complete" : "error", engine: aiAnalysisEngineRef.current, depth: Math.max(result.depth || 0, current.depth || 0), selDepth: Math.max(result.selDepth || 0, current.selDepth || 0), nodes: Math.max(result.nodes || 0, current.nodes || 0), speed: result.speed, score: result.score, scoreAvailable: result.scoreAvailable, winRate: result.winRate !== undefined ? result.winRate : current.winRate, move: result.move, candidates: result.candidates?.length ? result.candidates : current.candidates, principalVariation: result.principalVariation, elapsedMs: result.elapsedMs }));
      // 分析结果沉淀（用户 09-17 第一梯队②）：面板驱动的分析每轮完成都写缓存，
      // 供下次打开同一局面时「载入上次结果」。提示/自对弈的落子型回合不入缓存。
      if (enhancementSettings.analysisCache && result.move && !options.playMove) {
        setAnalysisCacheVersion((version) => version + 1);
        putAnalysisCacheEntry(viewDocument.id, currentId, {
          ts: Date.now(), mover: nextPlayer,
          depth: result.depth || 0, selDepth: result.selDepth, nodes: result.nodes || 0,
          score: result.score, scoreAvailable: result.scoreAvailable, winRate: result.winRate,
          candidates: (result.candidates || []).slice(0, 3).map((candidate) => ({
            move: { row: candidate.move.row, col: candidate.move.col },
            ...(typeof candidate.score === "number" ? { score: candidate.score } : {}),
            ...(typeof candidate.winRate === "number" ? { winRate: candidate.winRate } : {}),
            ...(typeof candidate.depth === "number" ? { depth: candidate.depth } : {}),
          })),
        });
      }
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
      // **续算条件不再依赖 options.auto**（09-27 真机定位「只有第一次开在计算」）：
      // 只要持续分析开关是开着的、且这一轮不是落子型回合，就必须续下一轮——
      // 旧写法只在「本轮由 auto 触发」时续算，任何一次由别的入口（面板按钮、
      // 提示回落、自愈重试）起的轮次结束后就静默停摆，用户看到的就是「点一手
      // 没反应、引擎只在第一次算」。提示/自对弈模式仍不续（它们有自己的通路）。
      if (enhancementSettings.analysisAuto && !options.playMove && !enhancementSettings.analysisSelfPlay && !enhancementSettings.analysisHintMode) {
        window.setTimeout(() => {
          if (thinkGeneration.current === generation && autoAnalysisKey.current === currentPositionKey && !aiGame) startThink({ auto: true, continuous: true });
        }, 0);
      }
    };
    const useFallback = () => {
      if (generation !== thinkGeneration.current || !controller.isCurrent(handle)) return;
      setEngineLoad(null);
      // Use this request's actual engine, including the temporary Rapfi used
      // while KataGo warms up. A previous switch target is not the failure source.
      const failedEngine = aiEngineChoiceLabel(thinkEngineChoice);
      if (engineSwitchTargetRef.current === thinkEngineChoice) {
        settleEngineSwitch("failure", { error: `${failedEngine} 计算失败，已回到内置备用引擎`, canCancel: false });
      }
      // **旗舰失败要回落到内置备用引擎**（用户 09-29 报「开了一会直接给我干到
      // rapfi 了，但框框里还显示 katago」）：旗舰失败时若把选择器留在 "kata"，
      // 面板显示 katago、实际跑别的引擎——UI 与事实不符，用户无法判断当前到底在用谁。
      // 这里把选择器同步切到 rapfi 档位，但把实际备用 worker 与提示说清楚。
      const fallback = new PuzzleAiWorker();
      if (!controller.replaceWorker(handle, fallback)) { fallback.terminate(); return; }
      setToast(`${failedEngine} 计算失败，本次先用内置备用引擎；可关闭分析后重新开启重试`);
      rapfiAnalysisBlockedRef.current = true;
      analysisPersistent.current[0] = null;
      analysisPersistent.current[1] = null;
      aiAnalysisEngineRef.current = "light";
      setAiAnalysis((current) => ({ ...current, engine: "light" }));
      // 选择器**只在本会话内**同步成 rapfi（面板显示与实际跑的必须一致），
      // 但**不再写进 localStorage**（用户 10-01：「现在默认是 rapfi…应该随着引擎切换而切换」）：
      // 之前每次旗舰启动失败就把档位永久落盘，等于一次失败之后他选的 katago 悄悄没了，
      // 做题/分析从此一直用 rapfi。失败提示已经说了这一轮用谁，下次启动该照他的选择再试。
      if (thinkEngineChoice === "kata" || thinkEngineChoice === "ikatago") setAiEngineChoice("strong");
      rapfiThinkWorker.current = null;
      thinkWorker.current = fallback;
      fallback.onmessage = (event: MessageEvent<AiMoveResult & { requestId?: string; generation?: number; result?: AiMoveResult }>) => {
        const requestId = event.data.requestId || handle.requestId;
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current || !controller.isCurrent(handle, requestId, event.data.generation ?? handle.generation)) return;
        accept(event.data.result || event.data);
      };
      fallback.onerror = () => {
        if (thinkWorker.current !== fallback || generation !== thinkGeneration.current || !controller.isCurrent(handle)) return;
        // 走到这里说明**连回退引擎的线程都起不来**（旗舰失败会先回退到 rapfi）。
        // 群友报的「AI 分析线程异常，请重试」就是这一条，所以原因必须留下记录。
        recordAction("AI 分析线程异常：回退引擎（内置）线程也失败，本机可能内存不足或内核不支持该 worker");
        controller.finish(handle); thinkWorker.current = null; setThinkRunning(false); setToast("AI 分析线程异常，请重试");
        if (taskManager.current.state?.taskId === handle.requestId) taskManager.current.fail(new Error("AI 思考线程异常"));
      };
      fallback.postMessage({ requestId: handle.requestId, generation: handle.generation, board, player: nextPlayer, rule: viewDocument.metadata.rule, purpose: "think" });
    };
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: string; generation?: number; result?: AiMoveResult; message?: string; variant?: string; depth?: number; selDepth?: number; nodes?: number; speed?: number; score?: number; winRate?: number; drawRate?: number; candidates?: AiAnalysisCandidate[]; percent?: number; label?: string; done?: boolean }>) => {
      if (generation !== thinkGeneration.current || !controller.isCurrent(handle, event.data.requestId || handle.requestId, event.data.generation ?? handle.generation)) return;
      // 引擎切换/冷启动进度（kata）：画进度条，100% 时清掉
      if (event.data.type === "engine-loading") { handleEngineLoadingEvent(event.data); return; }
      if (event.data.type === "result" || event.data.type === "ready" || event.data.type === "progress") { setEngineLoad(null); handleEngineReadyEvent(event.data.variant, thinkEngineChoice); }
      // O1：持续分析模式下强力未就绪的一次性提示（用户选了强力但实际在跑轻量）。
      // blocked 场景已在 useFallback 弹过、提示模式由 runHintMove 先行提示，不重复。
      if (!options.playMove && engineNeedsPack(aiEngineChoice) && !rapfiAnalysisBlockedRef.current && (event.data.type === "progress" || event.data.type === "result") && event.data.variant === "fallback" && !analysisPackNotifiedRef.current) {
        analysisPackNotifiedRef.current = true;
        setToast("当前用内置引擎（自带轻量网络）计算；下载冠军网络包可提升棋力");
      }
      // 提示/自对弈：用 progress 的 PV0 维护「当前最强点」快照（停止时直接落它）。
      if (event.data.type === "progress" && analysisThinkLive.current && analysisThinkLive.current.requestId === (event.data.requestId || handle.requestId)) {
        const first = event.data.candidates?.[0]?.move;
        if (first) analysisThinkLive.current.best = { row: first.row, col: first.col };
      }
      if (event.data.type === "progress" && typeof event.data.winRate === "number") {
        const [documentId, nodeId] = handle.contextKey.split("/");
        if (documentId && nodeId) liveAnalysisRef.current = { contextKey: handle.contextKey, documentId, nodeId, mover: nextPlayer, winRate: event.data.winRate, depth: event.data.depth || 0, nodes: event.data.nodes || 0, score: event.data.score, scoreAvailable: event.data.score !== undefined, engine: (event.data.variant === "kata" || event.data.variant === "ikatago" ? event.data.variant : "rapfi") };
      }
      if (event.data.type === "progress") kataDiag(`app:progress nodes=${event.data.nodes} cands=${event.data.candidates?.length ?? 0} wr=${event.data.winRate} variant=${event.data.variant}`);
      // **过期帧的归属判定交给 worker 侧**（2026-10-01 二次修正）：
      // 我一度在 App 侧加过「帧的局面必须等于当前局面」的守卫，结果真机上**所有
      // 帧都被丢掉、面板只剩「思考中」**（用户实测：引擎吐了 82 帧 info、0 条
      // progress）。原因是 handle.contextKey 是 startThink 时建的，而复盘/导航等
      // 场景下 currentPositionKey 的构成与它并不同源，比对必然误杀。
      //
      // 真正可靠的机制本来就有两条，不需要这条：
      //   1. worker 侧换手时对旧轮发 `stopped`，并只在 `active` 存在时转发 info
      //      （见 parseKataOutput 的 `if (!active) return`）；
      //   2. App 侧 `startThink` 在换手时整体清空读数（下面那条 setAiAnalysis
      //      的 contextKey 分支），配合统计区读 panelRead（局面守卫），旧值不会
      //      被显示——**这才是「不残留」的落点，而不是丢帧**。
      // 非 progress 的帧（result/error/ready/stopped）先把窗口里最后一帧补齐落地：
      // 节流**绝不能丢终值** —— 面板上的深度/节点/胜率必须停在引擎真正算到的那一档。
      if (event.data.type !== "progress") analysisProgressPump.current?.flush();
      if (event.data.type === "progress") analysisProgressPump.current?.push(progressFrameSlices(event.data));
      else if (event.data.type === "result" && event.data.result) accept(event.data.result);
      else if (event.data.type === "error") {
        // 引擎失败要**有区别地**重试，别一律锁死到内置兜底：
        //  · 旗舰档（katago）：内存设置对它无效（那是 rapfi 的 MAX_MEMORY），
        //    所以「降内存重试」这条路对它毫无意义——原先会直接 useFallback()，
        //    而 useFallback 会把本会话永久锁在兜底引擎上，于是用户「关掉再开、
        //    把内存调到多小都还是失败」（2026-09-26 用户报）。改为：清掉引擎
        //    并原样重试一次（含清扫残留进程，见 NativeKataGoPlugin.start），
        //    仍失败才降级，并明确告诉用户原因。
        if (thinkEngineChoice === "kata") {
          // 同上：切走后旧一轮的余波不该再报 katago 错（读 localStorage 现行值，
          // 避免闭包里的旧 state）。
          if (loadAiEngineChoice() !== "kata") return;
          // 加载还在进行中就报错 → 多半是瞬态噪音：**不宣告失败、不停进程**，
          // 让加载走完（引擎侧有 40s 启动超时兜底）。用户 09-26 报「每次 1 秒
          // 左右就说启动失败」就是这里抢跑了。
          if (takeKataLoadGrace()) {
            aiRequestRetry.current.schedule(() => { startThink(options); }, 800, () => !appHidden() && controller.isCurrent(handle));
            return;
          }
          // **连续 5 次失败才弹提示**（用户 09-26 明确要求）：前 4 次静默重试——
          // 加载期的瞬态余波引擎 2 秒就自己好了，弹「正在重试」反而让人以为坏了。
          // 每次失败都真停进程重试（Java 对活进程早退复用，不杀就复用僵死进程）。
          kataRetryRef.current += 1;
          if (kataRetryRef.current < KATA_FAIL_TOAST_THRESHOLD) {
            cancelActiveAiComputation("settings-change");
            void stopNativeKataGo("analysis-retry");
            aiRequestRetry.current.schedule(() => startThink(options), 400, () => !appHidden());
            return;
          }
          useFallback();
          recordAction(`KataGo 连续 5 次未能启动，改用内置引擎：${event.data.message || "引擎未给原因"}`);
          setToast("KataGo 连续 5 次未能启动：已改用内置引擎，可到设置重新切过去");
          return;
        }
        // 高档内存分配失败（引擎退出）→ 先降 256MB 重试一次强力，别再直接换轻量
        // （09-12 用户「自设拉满节点显示冻结」根因；换轻量后自研兜底无 progress）。
        const usedMem = engineMemoryRetryRef.current ?? engineMemoryMbFor(thinkEngineChoice, enhancementSettings.analysisMaxMemoryMb) ?? 0;
        if (usedMem > 256 && !engineMemoryRetryRef.current) {
          engineMemoryRetryRef.current = 256;
          recordAction(`AI 引擎内存分配失败（原 ${usedMem}MB），降到 256MB 重试：${event.data.message || "引擎未给原因"}`);
          setToast("AI 引擎内存分配失败，已自动降至 256MB 重试");
          cancelActiveAiComputation("settings-change");
          aiRequestRetry.current.schedule(() => startThink(options), 0, () => !appHidden());
          return;
        }
        useFallback();
        recordAction(`AI 引擎报错，本会话改用内置引擎：${event.data.message || "引擎未给原因"}`);
      }
    };
    worker.onerror = (error) => {
      if (generation !== thinkGeneration.current || !controller.isCurrent(handle)) return;
      // 线程级异常（加载失败 / 内核把 worker 杀掉 / 未捕获错误）以前只弹一句 toast，
      // 事后什么都查不到；群友报「AI 分析线程异常」时我们连是 OOM 还是不支持都分不清。
      recordAction(`AI 思考线程异常（${error?.message || "无信息"}），改用内置引擎`);
      useFallback();
    };
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
    kataDiag(`app:startThink post gen=${generation} slot=${slotIndex} continuous=${continuous} key=${currentPositionKey}`);
    worker.postMessage({ type: "analyze", requestId: handle.requestId, generation: handle.generation, engine: analysisEngineVariant === "kata" ? "kata" : analysisEngineVariant === "ikatago" ? "ikatago" : analysisPackUrl ? "auto" : "fallback", ikatago: loadIkatagoConfig(), dataUrl: analysisPackUrl || undefined, size: viewDocument.metadata.boardSize || 15, moves, player: nextPlayer, rule: viewDocument.metadata.rule, timeMs: options.timeMsOverride ?? (continuous ? continuousBudgetMs(currentPositionKey) : enhancementSettings.analysisTimeMs), maxDepth: enhancementSettings.analysisDepthMax > 0 ? enhancementSettings.analysisDepthMax : continuous ? 512 : options.playMove ? 64 : 96, topN: options.playMove ? 1 : enhancementSettings.analysisCandidateCount, finishOnBareMove: !continuous, stopOnProvenWin: !continuous, continuous, depthMin: enhancementSettings.analysisDepthMin, maxMemoryMb: resolveAnalyzeMemoryMb(aiEngineChoice, enhancementSettings.analysisMaxMemoryMb, engineMemoryRetryRef.current), multi: enhancementSettings.engineMultiThread, threads: enhancementSettings.engineThreads, bigCores: nativeEngineInfo()?.bigCores, native: nativeEngineUsable() });
  };
  // 保活 effect 用 ref 调 startThink：interval 闭包捕获的是渲染期的函数实例，
  // 而 startThink 读大量 state（棋盘/设置）——经 ref 取最新一份，避免用旧状态
  // 发请求（例如换面后仍按旧局面的 moves 开轮）。
  const startThinkRef = useRef(startThink);
  startThinkRef.current = startThink;
  // 提示模式：不展开分析面板，点一下就是「为当前行棋方想一手」——有界 10s、
  // 引擎宣告杀棋立刻落子；落子走 play() 正常通路（禁手/音/动画/终局检测全复用）。
  const runHintMove = () => {
    if (gameReviewRunRef.current?.active) { setToast("整局复盘运行中，请先停止复盘再使用提示"); return; }
    if (aiGame || (mode !== "record" && mode !== "puzzle")) { setToast("提示需要在打谱或做题中使用"); return; }
    if (mode === "puzzle" && puzzleSetup) { setToast("摆棋中不能用提示，请先点「应战」"); return; }
    if (mode === "puzzle" && (aiThinking || puzzleOutcome)) { setToast(puzzleOutcome ? "本题已结束，可悔棋或下一题" : "陪练正在思考"); return; }
    // 后台分析在跑也照样响应用户：startThink 会打断旧轮（见其上守卫）。
    if (mode === "record" && selfPlayRef.current) return;
    if (!nativeEngineReady && !enginePackUrlRef.current && engineNeedsPack(aiEngineChoice)) setToast("本次用内置引擎（自带轻量网络）计算；下载冠军网络包可提升棋力");
    setPlacementLocked(false);
    setDockPanel(null);
    startThink({ playMove: "hint", timeMsOverride: PUZZLE_HINT_THINK_TIME_MS });
  };
  useEffect(() => { selfPlayRef.current = enhancementSettings.analysisAuto && enhancementSettings.analysisSelfPlay; }, [enhancementSettings.analysisAuto, enhancementSettings.analysisSelfPlay]);
  // 自对弈：开关开着就为「当前局面」发回合；play() 换面后 effect 自动续下一回合，
  // 直到五连/满盘终局（自动关开关）。持续分析的滚动在开关开启时让位（见 effect 守卫）。
  useEffect(() => {
    // 后台不逐回合落子（回前台由 appVisible 依赖重新评估；引擎入口 startThink 也另有闸门）。
    if (appHidden()) return undefined;
    // 只有「开启」按钮打开（analysisAuto）且模式为自对弈时才逐回合落子；
    // 仅在模式选择器里选中自对弈不会启动。
    if (!(enhancementSettings.analysisAuto && enhancementSettings.analysisSelfPlay) || enhancementSettings.analysisHintMode) { selfPlayKeyRef.current = ""; return; }
    // 与持续分析同一道会话闸门：本次会话没主动开过就不自动对弈
    if (!analysisAutoArmedRef.current) { selfPlayKeyRef.current = ""; return; }
    if (tab !== "record" || mode !== "record" || aiGame) return;
    if (!engineSupportsBoardSize(viewDocument.metadata.boardSize || 15)) return;
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
  }, [enhancementSettings.analysisAuto, enhancementSettings.analysisSelfPlay, enhancementSettings.analysisSelfPlayTimeMs, tab, mode, aiGame, viewDocument, currentPositionKey, thinkRunning, aiThinking, boardWinningLines.length, board, appVisible]);
  useEffect(() => {
    kataDiag(`app:autoEffect auto=${enhancementSettings.analysisAuto} armed=${analysisAutoArmedRef.current} tab=${tab} mode=${mode} thinkRunning=${thinkRunning} autoKey=${autoAnalysisKey.current} curKey=${currentPositionKey}`);
    if (!enhancementSettings.analysisAuto) { autoAnalysisKey.current = ""; return undefined; }
    // 后台不自动开跑：切出时那次取消必须真的停在「停止」，否则引擎在看不见的地方全速烧 CPU，
    // 五分钟后被系统按 EXCESSIVE CPU USAGE 杀掉（真机取证见 appHidden 注释）。
    // 回前台时 appVisible 变化会让本 effect 重新评估，照常给当前局面续一轮。
    if (appHidden()) { autoAnalysisKey.current = ""; kataDiag("app:autoEffect skip: hidden"); return undefined; }
    // 本次会话用户没开过持续分析 → **不自动开跑**（设置值保留，开关照旧显示「开」，
    // 用户点一下才真正开始算）。用户 09-26 报「每次重进去都自动打开自动进行」。
    if (!analysisAutoArmedRef.current) return undefined;
    // 引擎包没就绪时要不要等（2026-09-18 修「网页版/点分析没反应」）：
    //   包在（enginePackState，只是还在预热或下载完正在加载）→ 等它，几秒后自然开跑；
    //   这个环境根本没有这个包（网页版不随包、`/app/` 也没有该目录）= 等不来 →
    //   不能干等：引擎链路本来就支持无 packUrl 时回落内置引擎（engineVariantFor 给
    //   "light"，startThink 发 engine:"fallback"），照跑并让 onmessage 里既有的
    //   「引擎包未就绪，当前用内置备用引擎计算」提示把话说明白。
    // 旧写法把这个条件直接并进下面那行 return，于是开关亮了、面板永远是
    // 「深度-速度-评估分-黑方胜率-节点-」，没有 toast、没有报错——用户看到的就是
    // 「分析打不开」。安卓原生引擎就绪时 strongEngineReady 为真，不进这条分支。
    const enginePackPending = engineNeedsPack(aiEngineChoice) && !strongEngineReady;
    if (enginePackPending && enginePackState) return undefined;
    // 提示模式不跑后台滚动分析（09-10 用户反馈）：那边的「分析」是手动点一下想一手。
    if (tab !== "record" || mode === "puzzle" || aiGame || aiThinking || enhancementSettings.analysisSelfPlay || enhancementSettings.analysisHintMode || autoAnalysisKey.current === currentPositionKey) return undefined;
    // 换手/换面时旧局面还在滚（thinkRunning）：旧轮结果已无意义——只 terminate
    // 正在跑的 slot（stop 消息会被 WASM 同步搜索阻塞排队，实测旧轮预算到点仍
    // 不返回，等它自然收尾要 2s+）；空闲 slot 保留（已预热加载，rapfi 避免
    // 40MB 冷加载），被终止的 slot 立即后台重建（warmup）供下次换手乒乓。
    // 滚动续算（同面）不触发此分支，TT 保留。
    if (thinkRunning) {
      // **旗舰档不重建 worker（A 项持续制的前提）**：引擎是单例常驻进程，旧轮
      // 由 worker 内的增量同步 + 原地打断处理（新局面的 play 命令自动打断旧
      // 搜索），terminate 会把正在加载/分析的引擎整个杀掉，下一手冷启动——
      // 这正是「每次落子都像重新启动」的机制。rapfi 的 WASM 搜索是物理忙的，
      // 乒乓重建对它才有意义。
      if (aiEngineChoice !== "kata" && !rapfiAnalysisBlockedRef.current) {
        const packUrl = engineNeedsPack(aiEngineChoice) ? enginePackUrlRef.current : null;
        // 与 startThink 的 thinkSlotKey 同口径（含盘面尺寸）：旗舰档在超 15 路时
        // 要让位给 Rapfi，键必须一致，否则重建的槽位会被下一次请求立即替换。
        const slotBoardSize = viewDocument.metadata.boardSize || 15;
        const slotKey = engineSlotKeyFor(aiEngineChoice, packUrl, slotBoardSize);
        const warmupEngine = engineVariantFor(aiEngineChoice, packUrl, slotBoardSize);
        for (let i = 0; i < analysisPersistent.current.length; i += 1) {
          const slot = analysisPersistent.current[i];
          if (slot?.running) {
            slot.worker.terminate();
            const rebuilt = makeAnalysisSlot(slotKey);
            rebuilt.worker.postMessage({ type: "warmup", engine: warmupEngine, dataUrl: packUrl || undefined, multi: enhancementSettings.engineMultiThread, threads: enhancementSettings.engineThreads, bigCores: nativeEngineInfo()?.bigCores, native: nativeEngineUsable() });
            analysisPersistent.current[i] = rebuilt;
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
    // enginePackState / nativeEngineReady 必须进依赖：上面的「等包还是不等」判据读它们。
    // 同一局面重入会在最前面的 autoAnalysisKey 守卫处直接返回，不会打断正在跑的一轮。
  }, [currentPositionKey, enhancementSettings.analysisAuto, enhancementSettings.analysisCandidateCount, enhancementSettings.analysisSelfPlay, tab, mode, aiGame, aiThinking, thinkRunning, aiEngineChoice, enginePackReady, enginePackState, nativeEngineReady, appVisible]);
  // **持续分析的自愈保活**（09-27 真机定位「引擎只有第一次开在计算」后加的兜底）：
  // 开关开着、模式/局面都满足，却长时间**没有任何一轮在跑**（thinkRunning 为假且
  // 分析槽 controller 无活动请求）＝ 某个触发环节丢了（换手 effect 被守卫挡下、
  // 续算竞态、worker 重建丢消息、引擎侧收尾行归属错位……）。这种「面板写思考中、
  // 引擎却空转」的鬼状态用户无法自救，由这里在空闲超过 1.5s 后自动补发一轮——
  // 把任何单点失效降级成一次静默重试。空闲计时跨 interval 两次采样确认，避免与
  // 「一轮刚结束、续算 setTimeout 还没跑」的正常交接窗口抢发（会变成双轮）。
  useEffect(() => {
    if (!enhancementSettings.analysisAuto || !analysisAutoArmedRef.current) return undefined;
    const timer = window.setInterval(() => {
      // **后台不补发**——真机被杀那次就是这条 interval 在切后台 4 秒后重新点火的
      //（16:16:28 stop → 16:16:32 kata-analyze 10，见 appHidden 注释）。
      // 空闲计时清零，回前台按正常 1.5s 节奏重试，不会一回来就连环补发。
      if (appHidden()) { analysisIdleSinceRef.current = 0; analysisKeepAliveStrikesRef.current = 0; return; }
      if (tab !== "record" || mode === "puzzle" || aiGame || aiThinking) return;
      if (enhancementSettings.analysisSelfPlay || enhancementSettings.analysisHintMode) return;
      if (gameReviewRunRef.current?.active) return;
      if (!engineSupportsBoardSize(viewDocument.metadata.boardSize || 15)) return;
      // 引擎包已知存在但还没就绪时**等它**（与自动分析 effect 同口径）：补发早了
      // 会以「无包 → 内置轻量引擎」的名义先算一轮，等包好了再换引擎，来回抖动。
      if (engineNeedsPack(aiEngineChoice) && !strongEngineReady && enginePackState) return;
      // 终局不补发（五连已达成 / 棋盘已满）：没有可分析的行棋方
      if (boardWinningLines.length > 0 || board.every((row) => row.every(Boolean))) return;
      const liveRound = analysisPersistent.current.some((slot) => Boolean(slot && !slot.dead && slot.controller.current));
      if (thinkRunning || liveRound) { analysisIdleSinceRef.current = 0; analysisKeepAliveStrikesRef.current = 0; return; }
      if (analysisIdleSinceRef.current === 0) { analysisIdleSinceRef.current = Date.now(); return; }
      // 退避：连续补发仍起不来的（引擎彻底坏了），间隔 1.5s→3s→6s→12s→24s 封顶——
      // 每次都是合法的恢复尝试，但不会变成每 1.5s 一次的重试风暴。
      const strikes = Math.min(analysisKeepAliveStrikesRef.current, 4);
      if (Date.now() - analysisIdleSinceRef.current < 1500 * (2 ** strikes)) return;
      analysisIdleSinceRef.current = Date.now();
      analysisKeepAliveStrikesRef.current = strikes + 1;
      startThinkRef.current({ auto: true, continuous: true });
    }, 700);
    return () => window.clearInterval(timer);
  }, [enhancementSettings.analysisAuto, enhancementSettings.analysisSelfPlay, enhancementSettings.analysisHintMode, tab, mode, aiGame, aiThinking, viewDocument, board, boardWinningLines.length, thinkRunning, aiEngineChoice, enginePackState, nativeEngineReady]);
  useEffect(() => {
    if (!enhancementSettings.analysisAuto || !engineNeedsPack(aiEngineChoice) || !strongEngineReady) return;
    // 引擎包下载完成 = 可重试 rapfi（解开会话级锁轻量）。
    rapfiAnalysisBlockedRef.current = false;
    autoAnalysisKey.current = "";
    if (aiWorkerController.current.current?.kind === "analysis") cancelActiveAiComputation("settings-change");
  }, [enginePackReady]);
  // 老用户升级路径：1.1.8 及更早的包自带（或用户下载过）40MB 的 wasm 强力包。安卓
  // 现在改用本机原生引擎，这份空间要还回去——「同一个引擎不能存在两份」。探测与
  // 「恢复已存包」是两条独立异步线，谁先完成都可能，所以依赖 enginePackReady 再看。
  useEffect(() => {
    if (!nativeEngineReady || !enginePackReady) return;
    void deleteEnginePack().then(() => {
      setToast("已改用本机原生引擎，释放了 40MB 引擎包空间");
    });
  }, [nativeEngineReady, enginePackReady]);

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
  /**
   * 懒加载源（DP/DB 库、RenLib 网页核心读的 .lib）打开后会在后台铺分支树结构，
   * 每批结果回推一次文档，另有「用户点开某一支」时按需查询后的回推。
   * 节点 id 由位置路径决定，所以换文档不会动到「我在哪」：只换 document，不碰 currentId。
   */
  const attachDynamicSessionUpdates = (session: DpViewSession | RenLibWebViewSession) => {
    session.onUpdate = (updated) => {
      if (dynamicViewSession.current !== session) return;
      setDocument(updated);
      recordSession.current = { document: updated, currentId: updated.savedCurrentId || updated.rootId };
    };
  };
  /**
   * 分支树点「展开」时，把这一支在库里的后续查回来（2026-10-10）。
   *
   * 群友报「九天指南 / 丘月败10.db / 花月黑必胜地毯.lib 打谱看得见、分支树里没有」：
   * 这几个都是**按局面查询**的懒加载源，投影只能铺「已经问过的」分支，其余的在树上
   * 是一个带「还有后续」标记的节点——点展开就等于「去要一次」。两套会话各有实现
   * （DP 的 loadBranchByNodeId / LIB 的 loadBranch），查完都经 onUpdate 回推文档。
   *
   * 失败不回退也不弹窗：点开一支是低风险的读操作，查不到时维持现状、用户再点一次即可
   * ——与 DP 侧 loadBranch 的既有口径一致。
   */
  const loadTreeBranch = (nodeId: string) => {
    const session = dynamicViewSession.current;
    if (!session) return;
    const operation = session instanceof RenLibWebViewSession
      ? session.loadBranch(nodeId)
      : session.loadBranchByNodeId(nodeId);
    if (!operation) return;
    void Promise.resolve(operation).catch(() => { /* 读不到维持现状 */ });
  };
  const navigateDynamic = (session: DpViewSession | RenLibWebViewSession, operation: () => Promise<{ document: GameDocument; currentId: string }>, onOpened?: () => void, preserveDraft?: DraftState) => {
    if (dynamicNavigationPending.current) return;
    const version = ++dynamicNavigationVersion.current;
    dynamicNavigationPending.current = true;
    setDynamicNavigationBusy(true);
    // 看门狗：operation() 有可能**永远不 settle**（会话被 close 之后再 open 就是这条，
    // qa/dp-battery 的注释里记过实测 500 秒超时）。原先没有任何兜底，busy 会一直留着 true，
    // 于是棋盘**静默点不动**、上一手/下一手也全灰，只有新建或换一份棋谱才解锁
    // ——用户 10-06 报的「有时空白盘点不了子，新建棋盘后才能点，不知道触发方式」就是这条。
    const watchdog = window.setTimeout(() => {
      if (version !== dynamicNavigationVersion.current) return;
      dynamicNavigationPending.current = false;
      setDynamicNavigationBusy(false);
      setToast("数据库读取超时，已恢复操作 —— 再点一次试试；反复出现请把这份库关掉重开");
    }, DYNAMIC_NAV_WATCHDOG_MS);
    void operation().then((opened) => {
      if (version !== dynamicNavigationVersion.current || dynamicViewSession.current !== session) return;
      setDocument(opened.document); setCurrentId(opened.currentId);
      if (preserveDraft && hasDraft(preserveDraft)) setDraft(preserveDraft);
      recordSession.current = { document: opened.document, currentId: opened.currentId };
      onOpened?.();
    }).catch(() => {
      if (version === dynamicNavigationVersion.current && dynamicViewSession.current === session) setToast("数据库分支读取失败，请重试");
    }).finally(() => {
      window.clearTimeout(watchdog);
      if (version === dynamicNavigationVersion.current) {
        dynamicNavigationPending.current = false;
        setDynamicNavigationBusy(false);
      }
    });
  };
  pagedNavigate.current = (index) => { void navigatePagedWindow(index); };
  /**
   * `forceDuelRewind`：终局之后仍要走"退到轮到自己"那套**悔棋**语义（自定义开局的终局悔棋用，
   * 见 `takeDuelUndo`）。平时的 ‹ › 在终局后只是回看，退一步停一步。
   */
  const goPrev = (options?: { forceDuelRewind?: boolean }) => {
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
    if (aiGame && (!aiGame.outcome || options?.forceDuelRewind) && current.parentId) {
      let cursorId = current.parentId;
      for (let guard = 0; guard < 4; guard += 1) {
        if (nextPlayerAt(document, cursorId) === aiGame.humanPlayer) break;
        const parent = document.nodes[cursorId]?.parentId;
        if (!parent) break;
        cursorId = parent;
      }
      setCurrentId(cursorId);
      recordSession.current = { document, currentId: cursorId };
      rewindOpeningForCursor(cursorId);
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
  // Board 的 memo 要求这些交互回调引用稳定（见模块级 useStableCallback 注释）。
  // 包成稳定引用后，AI 引擎思考期间父组件每 100ms 的重渲染不会再重绘棋盘。
  const stablePlay = useStableCallback(play);
  const stableMark = useStableCallback(mark);
  const stableStepBack = useStableCallback(stepBackByStoneTap);
  const stableNavigateVariation = useStableCallback(navigateVariation);
  const stableStopUnifiedThinking = useStableCallback(stopUnifiedThinking);
  /**
   * 识别池预热（2026-10-14）：把「第一次图片识别要等的那十几秒」挪到应用空闲时。
   * 页面首次识别的耗时几乎全在「每个 worker 各自创建 ORT 会话（编译 wasm + 建图）+ 装两个
   * fp16 模型」，与「哪张图」无关；预热只建池与装载，**不跑识别、不碰任何判定**。
   * 走 requestIdleCallback（不支持退 3s 定时）：别在应用刚起来那几秒抢 CPU（真机上就是首屏卡）。
   *
   * ⚠ 必须挂在 **App 根组件**（而 `Board`）：Board 会随屏幕切换卸载，
   *   而它的 effect cleanup 会 `cancelIdleCallback` 掉还没触发的预热——用户一进来就点导入，
   *   预热反而被取消。挂在根上则整场只跑一次、幂等。
   */
  useEffect(() => {
    const run = () => {
      // 全写 globalThis：本文件里 `document` 常被当作棋谱对象（GameDocument）的局部名。
      const doc = (globalThis as { document?: { visibilityState?: string } }).document;
      if (doc?.visibilityState === "hidden") return;
      void import("./features/recognition/recognition-accelerator").then((mod) => mod.prewarmRecognitionPool()).catch(() => {});
    };
    const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(run, { timeout: 5000 });
      return () => (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(id);
    }
    const timer = setTimeout(run, 3000);
    return () => clearTimeout(timer);
  }, []);
  // 手数滑轨的跳手回调：Board 是 memo，必须给稳定引用，否则每次渲染都会重挂指针处理。
  // 外部文件（用户 2026-09-23 文件关联）：安卓把用户点/分享过来的棋谱暂存好，这里取回来导入。
  // 用 ref 装最新处理器，订阅本身只挂一次——否则每次重渲染都会重新订阅，事件会被重复响应。
  const intakeExternalFilesRef = useRef<(files: File[]) => void>(() => {});
  useEffect(() => {
    let active = true;
    let pulling = false;
    const pull = () => {
      // 原生现在会在每次回到前台都补发一次通知，可能与之重叠；takeFiles 读完即删，
      // 但并发两发还是会白跑一趟，所以在同一时刻只留一次拉取。
      if (pulling) return;
      pulling = true;
      void takeIncomingFiles().then((files) => {
        pulling = false;
        // 组件已卸载、或这次没取到文件（非原生环境恒为空）时什么都不做。
        if (!active || !files.length) return;
        // 留一条环形日志：兼容性自检能据此分清「系统没把文件交给我们」和
        // 「交给我们了却没处理」（用户 2026-10-03 报的就是后一种）。
        recordAction(`外部文件进入导入管线：${files.map((file) => file.name).join("、").slice(0, 120)}`);
        intakeExternalFilesRef.current(files);
      });
    };
    // 冷启动：原生在 Activity onCreate 就把文件暂存好了，这里主动拉一次。
    pull();
    // 热启动：应用在后台时又收到文件，原生发事件提醒（拉取路径与冷启动相同）。
    const unsubscribe = onIncomingFiles(pull);
    // 回到前台再拉一次：原生那发事件可能落在 WebView 被暂停/还没加载的窗口里丢掉，
    // 而「可见」这一刻页面一定活着——这是「不立刻处理、要等下次启动」的兜底。
    // 写全 window.document：本组件里 document 是棋谱状态（GameDocument）。
    const onVisibility = () => { if (window.document.visibilityState === "visible") pull(); };
    window.document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; unsubscribe(); window.document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  // 长按环形菜单的呼出回调：Board 是 memo，必须稳定引用。
  const stableOpenRadialMenu = useStableCallback((position: Position, clientX: number, clientY: number) => {
    setRadialMenu({ x: clientX, y: clientY, position, page: "general" });
  });
  // 双指旋转的步进回调：与工具栏「旋转」按钮走同一个 setRotation，顺时针累加。
  const stableRotateStep = useStableCallback((step: 0 | 90 | 270) => {
    setRotation((value) => applyRotationStep(value, step));
  });
  const stableRailSeek = useStableCallback((depth: number) => { jumpToDepth(depth, { keepSheetOpen: true }); });
  const stableGestureStep = useStableCallback((direction: -1 | 1) => { if (direction < 0) goPrev(); else goNext(); });
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
  const chooseChild = (id: string, pivotId = currentId, options?: { keepSheetOpen?: boolean }) => {
    const closeSheet = () => { if (!options?.keepSheetOpen) setSheet(null); };
    clearBoardMotion();
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(id)) {
      const node = viewDocument.nodes[id];
      if (node?.move) navigateDynamic(dynamicSession, () => dynamicSession.moveToNodeId(id, node.move!), closeSheet);
      return;
    }
    const session = pagedSession.current;
    if (session) {
      const index = session.indexForId(id);
      if (index !== undefined) pagedNavigate.current(index);
      closeSheet(); return;
    }
    recordDraft({ type: "set-mainline", parentId: pivotId, childId: id });
    setCurrentId(id); closeSheet();
  };
  /**
   * 变化列表/画布里点一手：**只看那个局面**——不改主线（preferredChildId）、不进草稿、不关面板。
   * 原来走 chooseChild，它做的是「把这一支设为主线」的草稿编辑，于是「读谱」在偷偷改棋谱，
   * 也让「切回主分支」永远触发不了（智子的做法是：读图不动主分支，「设为主分支」是单独动作）。
   */
  const previewTreeNode = (id: string) => {
    clearBoardMotion();
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(id)) {
      selectTreeNode(id, viewDocument.nodes[id]?.parentId || undefined, { keepSheetOpen: true });
      return;
    }
    if (!viewDocument.nodes[id]) return;
    playSound("navigate");
    setCurrentId(id);
  };
  /**
   * 「设为主分支」（智子的 makeMainBranch）：把当前这一手所在的**一整条线**设为主分支。
   * 只写「分岔处偏了」的那些叉：沿这条线往上，凡是分叉点没有把 preferredChildId
   * 指向这条线的，补一条 set-mainline 草稿——单链和已经指对的叉不动，
   * 所以一般只产生一两条草稿，撤销也一叉一条。数据库/分页视图结构由库自己给，不开放。
   */
  const setMainBranch = (id: string) => {
    if ((dynamicViewSession.current && isDynamicDatabaseView(document)) || pagedSession.current) {
      setToast("数据库与分页视图的主线由库决定，暂不支持设为主分支");
      return;
    }
    const chain: string[] = [];
    let cursor: string | undefined = id;
    while (cursor && viewDocument.nodes[cursor]) {
      chain.push(cursor);
      cursor = viewDocument.nodes[cursor].parentId ?? undefined;
    }
    if (!chain.length || chain[chain.length - 1] !== viewDocument.rootId) { setToast("找不到这一手到起点的分支路径"); return; }
    chain.reverse();
    let changed = 0;
    for (let index = 0; index + 1 < chain.length; index += 1) {
      const parent = viewDocument.nodes[chain[index]];
      const childId = chain[index + 1];
      if (!parent || parent.children.length < 2) continue;
      const effective = parent.preferredChildId && parent.children.includes(parent.preferredChildId) ? parent.preferredChildId : parent.children[0];
      if (effective === childId) continue;
      recordDraft({ type: "set-mainline", parentId: parent.id, childId });
      changed += 1;
    }
    setToast(changed ? `已把这一手所在分支设为主分支（调整了 ${changed} 处分岔）` : "这一手已经在主分支上");
  };
  const selectTreeNode = (id: string, pivotId?: string, options?: { keepSheetOpen?: boolean }) => {
    // 变化列表里点一手要能一边读一边走，所以允许「跳过去但不关面板」（keepSheetOpen）。
    const closeSheet = () => { if (!options?.keepSheetOpen) setSheet(null); };
    if (id === currentId) { closeSheet(); return; }
    clearBoardMotion();
    const dynamicSession = dynamicViewSession.current;
    if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(id)) {
      if (id === document.rootId) {
        navigateDynamic(dynamicSession, () => dynamicSession.root(), closeSheet);
        return;
      }
      const node = viewDocument.nodes[id];
      if (!node?.move) return;
      navigateDynamic(dynamicSession, () => dynamicSession.moveToNodeId(id, node.move!), closeSheet);
      return;
    }
    const session = pagedSession.current;
    if (session) {
      const index = session.indexForId(id);
      if (index !== undefined) pagedNavigate.current(index);
      closeSheet();
      return;
    }
    const isPathNode = path.some((entry) => entry.id === id);
    if (!isPathNode && pivotId && mode !== "review") { chooseChild(id, pivotId, options); return; }
    playSound("navigate");
    // 只有**往回走**才需要倒回开局状态机：往前跳（回看之后回到最新手）不该重置阶段，
    // 否则玩家回看一眼再回来，正在等他的打点就被清掉了。
    const isForwardJump = depthOf(document, id) > depthOf(document, currentId);
    setCurrentId(id); closeSheet();
    if (aiGame && !aiGame.outcome && !isForwardJump) rewindOpeningForCursor(id);
  };
  // 跳到主线第 N 手（用户 09-17 第二批③④：跳手浮层、键盘数字键、手数滑轨共用）。
  // 走 selectTreeNode 而不是直接 setCurrentId，这样大型分页库与动态数据库视图也能
  // 用同一入口（它们各自需要异步跳转）；主线节点必在当前路径上，所以读谱不会被拦。
  const jumpToDepth = (depth: number, options?: { keepSheetOpen?: boolean }) => {
    const target = Math.max(0, Math.min(mainLineLength(viewDocument), Math.round(depth)));
    const id = nodeIdAtDepth(viewDocument, target);
    if (id === currentId) return;
    selectTreeNode(id, undefined, options);
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
  // 孤儿书签（audit 2026-09-17）：删分支不会带走挂在被删节点上的书签，它们会一直
  // 留在面板里点不动。这里按「该谱当前实际存在的节点 id」扫出失效的那些，并给一个清理入口。
  const orphanBookmarkReport = useMemo(() => {
    const regularIds = new Map(library.map((item) => [item.id, new Set(Object.keys(item.nodes))] as const));
    return findOrphanBookmarks(branchBookmarks, (documentId) => {
      const nodes = regularIds.get(documentId);
      if (nodes) return nodes;
      // 大型棋谱只加载可视窗口，拿窗口节点判断会把好书签当孤儿误删；
      // 只在「本库有这份棋谱的摘要」时放行空集合，否则返回 null 表示无法判定。
      return largeSummaries.some((summary) => summary.id === documentId) ? new Set<string>() : null;
    });
  }, [branchBookmarks, library, largeSummaries]);
  const cleanOrphanBookmarks = () => {
    const report = orphanBookmarkReport;
    if (!report.count) { setToast("没有失效书签"); return; }
    if (!window.confirm(orphanBookmarkConfirmation(report))) return;
    setBranchBookmarks((all) => pruneOrphanBookmarks(all, report));
    setToast(`已清理 ${report.count} 条失效书签`);
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
    if (isPartialDocument(document)) { setToast("这份棋谱只加载了一部分：复制/粘贴会把没读回来的分支漏掉，先「展开」更多分支或稍后再试"); return; }
    const result = pasteRecordSubtree(viewDocument, targetId, treeClipboard);
    if (!result.ok) { setToast(result.reason); return; }
    recordDraft({ type: "add-subtree", parentId: targetId, rootId: result.rootId, nodes: result.nodes, bookmarks: result.bookmarks });
    if (result.bookmarks.length) setBranchBookmarks((all) => ({ ...all, [document.id]: mergeRecordBookmarks(all[document.id] || [], result.bookmarks) }));
    setCurrentId(result.rootId);
    setToast(`已粘贴 ${Object.keys(result.nodes).length} 个节点，可用“撤销”整体回退`);
  };
  /**
   * 「同型局面 · 并入」（用户 2026-10-10）：把 donorId 那一处同型（走子顺序不同、
   * 盘面相同）的后续搬到 keeperId 下、并删掉那一处重复。
   *
   * 与「跳过去看」的区别：这个是**真的整理棋谱**，所以照复制/粘贴那一套落成草稿——
   * 保存前可用撤销整体回退，读谱模式与大型按需窗口一律拒绝（不许在只读/窗口视图上改）。
   * 计算本身在 features/record-tree/transposition-merge.ts（有单测证明结果仍是严格的树）。
   */
  const mergeSamePositionsInto = (keeperId: string, donorId: string) => {
    if (mode === "review") { setToast("读谱模式无法进行该操作"); return; }
    // 懒加载源（DP/DB 局面库、.lib）与分页大棋谱一律拒绝：全库还没读完，「同型」
    // 是拿已加载子集算出来的，合并会漏掉未加载分支里的同型。用统一判据，
    // 这样「编辑副本」（Symbol 跨不过去、但带 partial 字段）也照样被拦住。
    if (isPartialDocument(viewDocument)) { setToast("这份棋谱只加载了一部分，暂不做同型合并（可在分支树里展开更多分支）"); return; }
    const index = buildTranspositionIndex(viewDocument);
    const result = mergeSamePositions(viewDocument, index, keeperId, {
      bookmarks: branchBookmarks[document.id] || [],
      // 当前路径上的节点不删也不搬：删了用户的光标就没了，而且那是他正在读的那条线
      protectedIds: new Set(path.map((entry) => entry.id)),
    });
    if (!result.ok) { setToast(result.reason || "没有可合并的内容"); return; }
    for (const operation of result.operations) recordDraft(operation);
    setToast(`已并入 ${result.movedSubtrees} 支后续、去掉 ${result.removedNodes} 处重复${result.notices.length ? `（${result.notices[0]}）` : ""}，保存前可撤销`);
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
    // 有一笔"拍平了带手序的原谱"还没裁决：先问这个（覆盖/副本/放弃），裁决完再接着切。
    // 三个选项各自结束时草稿都是空的，所以不会再叠一层草稿守卫。
    if (flattenChoice) { setSheet(null); setAfterFlatten(() => action); setFlattenPromptOpen(true); return; }
    if (hasDraft(draft)) { setSheet(null); setPendingSwitch(() => action); return; }
    action();
  };
  const openImportSheet = () => withDraftGuard(() => setSheet("import"));
  // 在线棋谱库是可停在任意页签上的浮层：下载完直接进本机棋谱库，不强制切页。
  // 在线棋谱库已是棋谱库的第三个界面（用户 2026-09-15 要求），不再走「导入」弹窗。
  const openOnlineLibrary = () => { setSheet(null); setLibrarySection("online"); setTab("library"); };
  const [onlineProxy, setOnlineProxy] = useState(loadOnlineProxyTemplate);
  const updateOnlineProxy = (value: string) => { saveOnlineProxyTemplate(value); setOnlineProxy(value); };
  // AI 识图复原手序（用户 09-28 方案③）：端点/Key/模型全由用户自备，只存本机不进备份。
  const [aiVision, setAiVision] = useState<AiVisionConfig>(loadAiVisionConfig);
  const updateAiVision = (value: AiVisionConfig) => { saveAiVisionConfig(value); setAiVision(value); };
  const [aiRestoreBusy, setAiRestoreBusy] = useState(false);
  const [localRestoreBusy, setLocalRestoreBusy] = useState(false);
  // 复原未完整时的续做（用户 2026-10-09）：「重新识别」整盘重读、「补全识别」只补漏读的子。
  // restoreAttempted：本屏已经试过复原（成功或部分），据此决定要不要露这两颗按钮。
  const [reRestoreBusy, setReRestoreBusy] = useState(false);
  const [completeRestoreBusy, setCompleteRestoreBusy] = useState(false);
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  // 「AI 辅助识别」（2026-10-02，本地为主、云端为辅）：本地读错时的大模型重读通道。
  const [aiRecogBusy, setAiRecogBusy] = useState(false);
  const openAiGameSheet = () => withDraftGuard(() => {
    setGeneratorOpen(false); setGeneratorInitial(null);
    // 有一盘没下完的对局就先问「回到上次对局 / 开新局」（用户 09-28）；内存里正在下的那种
    // 不算（入口按钮那时显示的是「继续对局」，直接切回对局界面）。
    const saved = aiGame ? null : loadDuelSession();
    if (saved) { setDuelResume(saved); setSheet("duelResume"); return; }
    setSheet("aiGame");
  });
  // 在线棋谱库只在用户点选后才取回棋谱，取回的是一份标准 SGF，走与文件导入
  // 完全相同的一条路：解析 → 去重 → 入本机棋谱库，因此手序、分支和对弈信息
  // 与手动导入没有任何差别。
  const importOnlineRecords = async (records: OnlineFetchedRecord[]): Promise<OnlineImportOutcome> => {
    const outcome: OnlineImportOutcome = { inserted: 0, duplicates: 0, failures: [] };
    const candidates: GameDocument[] = [];
    for (const record of records) {
      try {
        const parsed = await importRecordFile(
          new File([record.sgf], record.filename, { type: "application/octet-stream" }),
          { metadata: { ...record.info, sourceFormat: "sgf", sourceFileName: record.filename } },
        );
        candidates.push(parsed.document);
      } catch (error) {
        outcome.failures.push({ name: record.filename, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (candidates.length) {
      const saved = saveManyToLibrary(candidates);
      setLibrary(saved.library);
      outcome.inserted = saved.inserted;
      outcome.duplicates = saved.duplicates;
      setToast(saved.inserted ? `已从在线棋谱库导入 ${saved.inserted} 局` : "这些棋谱已经在本机棋谱库里了");
    }
    return outcome;
  };
  /**
   * 「在线查看」（用户 09-19 晚：在线棋谱要能在本应用里看局面，但不下载入库）。
   *
   * 与 importOnlineRecords 的唯一区别：**不写进棋谱库**。取回的那一局按未保存棋谱打开，
   * 棋盘直接在本应用里看；要留档由用户自己点顶栏「保存棋谱」（那是他自己的本机动作）。
   *
   * 用户 09-26 改了口径：在线面上的每一局都是「点了才在浏览器打开对应网页」，所以这个
   * 回调目前**没有接线**（面板里的行按钮已换成跳转链接）。代码与它依赖的「未保存预览」
   * 状态管道都留着，要恢复只需把行内按钮和 `onPreview` 传参加回来。
   */
  const previewOnlineRecord = async (record: OnlineFetchedRecord) => {
    const parsed = await importRecordFile(
      new File([record.sgf], record.filename, { type: "application/octet-stream" }),
      { metadata: { ...record.info, sourceFormat: "sgf", sourceFileName: record.filename } },
    );
    performOpenRecord(parsed.document);
    // 打开到主线最后一手：这一份是「看局面」用的，停在第 0 手是空盘（61 手都没落），
    // 用户还得自己按「到最后一手」——实测就是这么别扭。
    setCurrentId(lastOnPreferredLine(parsed.document, parsed.document.rootId));
    setPreviewDocId(parsed.document.id);
    setSaved(false);
    setTab("record");
    setToast(`在线查看：${parsed.document.metadata.title || record.filename}（只在本机看，没有写进棋谱库）`);
  };
  /**
   * 在线题库：题集整集取回后走与「导入题库 JSON」完全同一条解析管线（同样的坐标、
   * 规则与难度口径），差别只在 id 由来源文件名决定——同一个题集重复下载是**覆盖更新**，
   * 不会在题库里越堆越多份。覆盖是就地替换，不改变数组顺序，正在进行的那一题不会跳题。
   */
  const openRecordImportPicker = () => withDraftGuard(() => singleFileInput.current?.click());
  const openPuzzleImportPicker = () => withDraftGuard(() => puzzleFileInput.current?.click());
  // 图片识谱选图：Android 走系统相册选择器（默认停在相册，用户仍可在系统 UI 里
  // 切到其他图库/文件夹），其他环境回退到原生 <input type="file">。用户取消时
  // 原生侧 reject，这里静默忽略、不产生任何副作用。
  const openImageImportPicker = () => withDraftGuard(() => {
    // 预览识别池（2026-10-14）：用户紧接着要在系统相册里选图（通常好几秒），
    // 正好用来把「每个 worker 编译 13.5MB ORT wasm + 装模型」这段预热掉。
    // 无损：只建池与装载，不跑识别、不碰判定；失败静默（真识别会自己重建）。
    void import("./features/recognition/recognition-accelerator").then((mod) => mod.prewarmRecognitionPool()).catch(() => {});
    if (!supportsNativePhotoPicker()) { imageFileInput.current?.click(); return; }
    void pickBoardImageFile().then((file) => { if (!file) return; void rememberRecentImport(file, "image"); beginBoardImageImport(file); });
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
  /** 非文件来源（粘贴的坐标代码）也记进「最近导入」（用户 10-06：图片识别、其他来源都该算进去）。 */
  const rememberRecentText = async (text: string, kind: RecentImportKind, name: string) => {
    try {
      const entry = await saveRecentText(text, kind, name);
      setRecentImports((items) => [entry, ...items.filter((item) => !(item.name === entry.name && item.kind === entry.kind))].slice(0, 5));
    } catch { /* 同 rememberRecentImport：只是便利层，失败不影响导入本身 */ }
  };
  const reopenRecentImport = async (entry: RecentImportEntry) => {
    setSheet(null);
    /* 坐标代码：不是文件，读回原文重新摆一遍 */
    if (entry.kind === "coordinate") {
      const text = await readRecentImportText(entry.id);
      if (!text) { setToast("这条坐标代码已被清理，请重新粘贴"); return; }
      const parsed = parseCoordinateCode(text, viewDocument.metadata.boardSize || 15);
      if (!parsed.positions.length) { setToast("这条坐标代码已经读不出来了，请重新粘贴"); return; }
      applyCoordinateCode(parsed.positions, viewDocument.metadata.boardSize || 15, parsed.warnings);
      return;
    }
    if (!entry.available) { setToast("这个文件太大，最近列表只保留了文件名，请重新选择原文件"); return; }
    const file = await openRecentImport(entry.id);
    if (!file) { setToast("最近导入的内容已被清理，请重新选择原文件"); return; }
    // 图片识谱记住的是那张图片：重开＝再识别一遍
    if (entry.kind === "image") { beginBoardImageImport(file); return; }
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
  /**
   * 外部送来的文件统一入口（用户 2026-09-23 文件关联）。
   *
   * 来源有三处，全都汇到这里：安卓系统的「用半步打开 / 分享给半步」（冷启动与热启动）、
   * 拖拽落入窗口、以及下面这两个 dataTransfer 钩子。
   *
   * 刻意**不**在这里做任何类型判定或解析：棋谱/题库/备份/压缩包一律交给既有的
   * `handleFiles`（它已经按序处理 zip → 题库 JSON → lib → dp/db → 白名单批量解析），
   * 图片交给既有的识谱入口。这样"从系统打开一份棋谱"与"在应用内点导入"走的是同一条
   * 已验证的管线：先进预览、不自动入库、有未保存草稿先弹保存/放弃/取消。
   */
  const intakeExternalFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    const images = incoming.filter((file) => file.type.startsWith("image/"));
    const documents = incoming.filter((file) => !file.type.startsWith("image/"));
    // 识谱一次只处理一张，多张图片逐张走既有提示，不做静默丢弃。
    if (images.length > 1) setToast(`一次只认一张棋盘图片，先处理「${images[0].name}」，其余请稍后再分享`);
    if (images.length) {
      const [first] = images;
      withDraftGuard(() => beginBoardImageImport(first));
      // 图片与棋谱混在一起时，棋谱照常导入（两条管线互不干扰）。
      if (documents.length) void handleFiles(documents);
      return;
    }
    void handleFiles(documents);
  };
  intakeExternalFilesRef.current = intakeExternalFiles;
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
      // 以前这里只挑图片，拖进来的 .sgf 会被**静默忽略**（用户 2026-09-23 一并修掉）：
      // 现在有图片就走识谱、没有图片的整体交给棋谱导入管线。
      const dropped = Array.from(event.dataTransfer?.files || []);
      if (!dropped.length) return;
      event.preventDefault();
      intakeExternalFiles(dropped);
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
  /**
   * 「对弈」页的每日一题（2026-10-11 起进**专门界面**）。
   *
   * 原来是 `guardedOpenPuzzle` —— 打开打谱工作区的"做题模式"。用户点破了那为什么不对：
   * 「我发现这个每日一题可以用分析解决，不像是一个专门的挑战界面」。工作区里
   * 带着整套常驻工具（分析引擎、看解答、摆棋、变化树），于是"做题"很容易变成
   * "等引擎算"；而它又不是挑战（没规则、没代价、没分数）。所以改成进这一页：
   * 只留棋盘、陪练、悔棋、重来。
   *
   * 三件事与原来**完全一致**（不能因为换了界面就改了口径）：
   *  · 先 `markDailyStarted` 把"今天这道"定下来（已有当天记录则沿用，中途不换题）；
   *  · 题目没变、规则解析仍走 `resolvePuzzleRule`（题目级 → 题集级 → 用户偏好）；
   *  · 结算走共用的 `planPuzzleSoul`（见 `puzzle-settle.ts`）。
   */
  const startDailyPuzzle = () => {
    if (!dailyDecision) { setToast("题库里暂时没有可练的题目"); return; }
    const location = locatePuzzleIn(puzzleCollections, dailyDecision.pick.collectionId, dailyDecision.pick.puzzleId);
    if (!location) { setToast("这道题已经不在题库里了"); return; }
    setDailyTraining((current) => markDailyStarted(current, dailyDecision.pick, localDateKey()));
    setDailySession({ collectionId: dailyDecision.pick.collectionId, puzzleId: dailyDecision.pick.puzzleId });
    setDailyOpen(true);
  };
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
  /** 真正开一局（不含草稿守卫）：对弈界面里的「重开 / 再来一局」自己做了确认，
   *  再套一层草稿守卫会对着一盘本来就未保存的对局反复弹「有未保存改动」。 */
  const beginAiGame = () => {
    cancelActiveAiComputation("settings-change"); setAiThinking(false);
    const next = createDocument("人机对战");
    next.metadata.rule = aiRuleFamily;
    next.metadata.openingRule = aiCustomOpening ? "free" : aiOpeningRule;
    // 五手多打的数量在第4手后由对局中的小弹窗决定，不在开局前写死。
    next.metadata.openingN = undefined;
    next.metadata.black = aiHumanPlayer === "black" ? "我" : "半步 AI";
    next.metadata.white = aiHumanPlayer === "white" ? "我" : "半步 AI";
    const timeControlName = AI_TIME_OPTIONS.find((option) => option.value === aiTimeLimitMs)?.title || "不限";
    const ruleLabel = aiCustomOpening ? "自定义开局" : selectedAiRule.name;
    next.metadata.event = `${ruleLabel} · ${selectedAiRule.badge} · AI ${aiStrength} · ${timeControlName}${aiReadOffMs ? ` + ${aiReadOffMs / 1000} 秒读秒` : ""} · 人机对战`;
    if (aiTimeLimitMs || aiReadOffMs) {
      next.metadata.timeLimit = `${timeControlName}${aiReadOffMs ? ` + ${aiReadOffMs / 1000} 秒读秒` : ""}`;
    }
    const baseOpening = createOpeningSession(aiOpeningRule, aiOpeningN, aiHumanPlayer);
    /**
     * 自定义开局**不要开局流程**：`createOpeningSession` 对非 swap2 的规则一律给一个
     * `place` 阶段（那是"前三手按规则摆"的机器），而这里要的是"人自己爱摆多少摆多少"，
     * 所以直接把 stage 钉成 normal，摆子阶段由 `customStarted=false` 自己管
     * （不复用 `place`：那套的 actor/radius/手数上限都对不上，而且新增 stage kind 会被
     *  `duel-session.ts` 的 STAGE_KINDS 白名单判非法，存档一恢复就被删）。
     */
    const opening = aiCustomOpening
      ? { ...baseOpening, rule: "free" as const, n: 0, stage: { kind: "normal" as const }, candidates: [] }
      : baseOpening;
    const thinkProfile = aiStrength === "自由" ? { timeMs: aiFreeTimeMs, maxDepth: aiFreeDepth } : AI_STRENGTH_PROFILES[aiStrength];
    if (enginePackMissingFor(aiEngineChoice)) setToast("本局先用内置引擎（自带轻量网络）；下载冠军网络包可提升棋力");
    const game: AiGameState = { id: newDuelId(), humanPlayer: aiHumanPlayer, aiPlayer: otherPlayer(aiHumanPlayer), strength: aiStrength, forbiddenEnabled: aiRuleFamily === "renju", timeLimitMs: aiTimeLimitMs, readOffMs: aiReadOffMs, thinkTimeMs: thinkProfile.timeMs, thinkDepth: thinkProfile.maxDepth, unlimitedThinking: aiStrength === "自由" && aiFreeUnlimited, outcome: null, opening, engineChoice: enginePackMissingFor(aiEngineChoice) ? "light" : aiEngineChoice, customOpening: aiCustomOpening || undefined, customStarted: aiCustomOpening ? false : undefined, customSetupCount: aiCustomOpening ? 0 : undefined };
    aiClockLastAt.current = null; aiClockExpired.current = false; aiReadOffExpired.current = false; aiGameSavedRef.current = null; aiGameEndReason.current = ""; setAiHumanElapsedMs(0); setAiMoveElapsedMs(0);
    // 新开一局：这份棋谱在用户点「保存本局」之前不进棋谱库。
    duelUnsavedDocIdRef.current = next.id;
    cancelGameReview(false);
    performOpenRecord(next);
    setAiGame(game); setPlacementPlayer(aiHumanPlayer); setPlacementLocked(true); setSheet(null); setDockPanel(null);
    // 开局就留在对弈界面（用户 09-28：「进入人机对弈后，是进入专门的对弈界面，而不是打谱界面」）。
    // performOpenRecord 里会 setTab("record")，所以这一句必须在它之后。
    setTab("duel");
    if (aiCustomOpening) {
      // 摆子阶段：AI 一步都不许动（既不 scheduleAiOpening，也不走"轮到 AI 就补一手"那条看门狗），
      // 时钟也不该走（`aiClockActive` 里已排除 setupPhase）。
      setToast("先摆局面，随时点「开始对局」；开始之后摆的子就不能撤了");
      return;
    }
    setToast(`${ruleLabel}开局已开始`);
    scheduleAiOpening(game, next, next.rootId);
  };
  const startNewAiGame = () => withDraftGuard(beginAiGame);
  /**
   * 回到上次对局（用户 09-28）。命门在最后那段补调度：AI 的应手**不是**由「轮到 AI 就把棋
   * 下了」的监视 effect 驱动的，而是人做完动作后顺手调度一次（play / 开局决策 / 悔棋里
   * 调 `scheduleAiOpening`）。进程一退出，那次调度就没了——恢复回来的局面若正等着 AI，
   * 不补这一次棋盘就僵死，正是用户担心的「人机这一手不落子」。
   * 开局阶段同理：该 AI 交换 / 宣言打点 / 落子时退出，恢复后要重新进开局调度。
   */
  const resumeDuelSession = () => {
    const saved = duelResume;
    setDuelResume(null);
    if (!saved) return;
    withDraftGuard(() => {
      // 先取一次判定：performOpenRecord 会把 aiGame 置空，之后就没有「这局是谁的」可问了。
      const awaiting = duelAwaitingSide(saved.game, saved.document, saved.currentId);
      performOpenRecord(saved.document, saved.currentId);
      const game: AiGameState = {
        id: saved.game.id || newDuelId(),
        humanPlayer: saved.game.humanPlayer, aiPlayer: saved.game.aiPlayer, strength: saved.game.strength,
        forbiddenEnabled: saved.game.forbiddenEnabled, timeLimitMs: saved.game.timeLimitMs, readOffMs: saved.game.readOffMs,
        thinkTimeMs: saved.game.thinkTimeMs, thinkDepth: saved.game.thinkDepth, unlimitedThinking: saved.game.unlimitedThinking,
        outcome: saved.game.outcome, opening: saved.game.opening, engineChoice: saved.game.engineChoice,
        // 自定义开局三件套：这里不抄一遍，恢复出来就丢了（丢的后果比丢一个显示字段严重——
        // 摆子阶段会被当成正常对局，AI 会自己落子、悔棋也能退进摆好的局面）。
        customOpening: saved.game.customOpening, customStarted: saved.game.customStarted, customSetupCount: saved.game.customSetupCount,
      };
      // 面板要跟着这一局走：自定义局恢复后如果面板还停在"普通规则"上，点「重开」就变成
      // 用别的规则重开一局（与上面那段"重开跳档"的教训同源）。
      setAiCustomOpening(Boolean(game.customOpening));
      // 对局设置面板必须跟着这一局走（群友 10-03 报：下了几十手后点「重开」，难度自己跳到初级）。
      // 「重开」读的是面板状态 aiStrength / aiTimeLimitMs…，而恢复快照只填了 aiGame——
      // 两边不同步，面板就停在本机默认值上，重开等于按默认值重开一局。
      setAiStrength(game.strength);
      setAiHumanPlayer(game.humanPlayer);
      setAiTimeLimitMs(game.timeLimitMs as AiTimeControl);
      setAiReadOffMs(game.readOffMs);
      if (game.strength === "自由") { setAiFreeTimeMs(game.thinkTimeMs); setAiFreeDepth(game.thinkDepth || 64); }
      // 规则只在能唯一对上时才同步：forbiddenEnabled 是有禁手这一个比特，
      // 无禁手里的几种（自由/长/…）在快照里分不开，猜错不如不动。
      const savedRule = AI_RULE_CHOICES.find((choice) => choice.openingRule === game.opening.rule
        && (choice.rule === "renju") === game.forbiddenEnabled);
      if (savedRule) { setAiRuleFamily(savedRule.rule); setAiOpeningRule(savedRule.openingRule); }
      // 恢复来的快照**已经终局**：那一局的账在它还活着时就结过了（本功能上线前的老快照则是根本没记过），
      // 两种情况都不能在这里再记一次，否则"刷新一下页面"就会让战绩多出一局幽灵对局。
      if (game.outcome) duelRecordedRef.current.add(game.id);
      // 计时：累计用时按存的恢复；「本手剩余」重新给足——退出期间人没在想棋，不该扣。
      aiClockLastAt.current = null; aiClockExpired.current = saved.clock.expired; aiReadOffExpired.current = saved.clock.readOffExpired;
      setAiHumanElapsedMs(saved.clock.humanElapsedMs); setAiMoveElapsedMs(0);
      const alreadyInLibrary = library.some((item) => item.id === saved.document.id);
      aiGameSavedRef.current = alreadyInLibrary ? saved.document.id : null;
      duelUnsavedDocIdRef.current = alreadyInLibrary ? null : saved.document.id;
      // 恢复时把「为什么结束」也带回来（超时这一条快照里有记录），否则终局面板会说不出原因。
      aiGameEndReason.current = saved.game.outcome ? (saved.clock.expired || saved.clock.readOffExpired ? "超时" : "") : "";
      setAiGame(game); setPlacementPlayer(game.humanPlayer); setPlacementLocked(true);
      cancelGameReview(false);
      setSheet(null); setTab("duel"); setDockPanel(null);
      if (awaiting === "ai-move" || awaiting === "ai-opening") { scheduleAiOpening(game, saved.document, saved.currentId); setToast("已回到上次对局，AI 接着想"); }
      else if (awaiting === "human") setToast("已回到上次对局，轮到你");
      else setToast("上一局已结束，可回看或保存");
    });
  };
  /** 放弃上次对局，直接开新局（弹窗里的第二个选项）。 */
  const discardDuelSessionAndOpenSetup = () => {
    clearDuelSession(); setDuelResume(null); setSheet("aiGame");
  };
  /** 认输：判负并结束本局（结果与原因由终局面板说清楚）。 */
  const resignAiGame = () => {
    if (!aiGame || aiGame.outcome) return;
    cancelActiveAiComputation("user");
    aiOpeningGeneration.current += 1;
    if (aiOpeningTimer.current !== null) { window.clearTimeout(aiOpeningTimer.current); aiOpeningTimer.current = null; }
    setAiThinking(false);
    aiGameEndReason.current = "认输";
    setAiGame({ ...aiGame, outcome: "lost" });
    setToast("已认输，本局结束");
  };
  /**
   * 对弈界面的「完成」：离开对局界面。未终局的对局**保留为可恢复会话**（下次点「人机对战」
   * 会问），已终局的会话没有恢复价值——连同快照一起清掉。
   */
  const closeDuelScreen = () => {
    if (aiGame?.outcome) clearDuelSession();
    exitAiGame();
    setTab("duel");
  };
  const newRecord = () => withDraftGuard(() => { const next = createDocument("新建棋谱", defaultBoardSize); performOpenRecord(next); setToast("已新建空白棋谱"); });
  /** 坐标代码：一串坐标直接开一份未保存棋谱（与图片识谱同一落点——先核对再保存）。 */
  const applyCoordinateCode = (positions: Position[], boardSize: number, warnings: string[]) => {
    const next = buildDocumentFromCoordinateCode(positions, boardSize);
    // 停在最后一手：粘贴代码的人要看的是「这串坐标摆出来是什么局面」，不是空盘。
    performOpenRecord(next, mainLineEndId(next));
    // 粘贴的坐标也进「最近导入」：重开＝把这串代码重新摆一遍（用户 10-06）
    void rememberRecentText(formatCoordinateCode(next), "coordinate", "坐标代码 · " + positions.length + " 手");
    setSaved(false);
    setSheet(null);
    setToast(`已按坐标代码生成 ${positions.length} 手${warnings.length ? `；${warnings.join("；")}` : ""}`);
  };
  /** 反向：把当前棋谱主线复制成坐标代码。只含主线，丢掉的（分支、过手）如实说明。 */
  const copyCoordinateCode = () => {
    const code = formatCoordinateCode(viewDocument);
    if (!code) { setToast("当前棋谱还没有主线着法，生成不了坐标代码"); return; }
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) { setToast("当前环境不允许访问剪贴板，可改用「导出 → POS / TXT」"); return; }
    const branches = mainLineBranchCount(viewDocument);
    const passes = mainLinePassCount(viewDocument);
    const notes = [branches ? `${branches} 处分支未包含` : "", passes ? `${passes} 处过手写不出来` : ""].filter(Boolean);
    void clipboard.writeText(code).then(
      () => setToast(`已复制 ${mainLineLength(viewDocument)} 手坐标代码${notes.length ? `（只含主线：${notes.join("、")}）` : ""}`),
      () => setToast("复制失败：当前环境不允许访问剪贴板，可改用「导出 → POS / TXT」"),
    );
  };
  /** 纯坐标代码导出成 TXT 文件（用户 10-07：导出面板一直缺这个按钮 —— 帮助文案里写着
      「可导出…POS / TXT」，但那条通路只兑现了导入侧）。内容与「复制坐标代码」同一份：
      `formatCoordinateCode` 只走主线，分支与过手写不出来。 */
  const exportCoordinateTxt = () => {
    const code = formatCoordinateCode(viewDocument);
    if (!code) { setToast("当前棋谱还没有主线着法，生成不了坐标代码"); return; }
    void exportRecordFile(code, `${safeName(viewDocument.metadata.title)}-坐标代码.txt`, "text/plain;charset=utf-8",
      `坐标代码 TXT 已导出（${mainLineLength(viewDocument)} 手${mainLineBranchCount(viewDocument) ? "，只含主线" : ""}）`);
  };
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
    attachDynamicSessionUpdates(session);
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
  const touchDragBridge = useRef<{ enabled: () => boolean; hapticsEnabled: () => boolean; performDrop: typeof performLibraryDrop }>({ enabled: () => true, hapticsEnabled: () => false, performDrop: performLibraryDrop });
  touchDragBridge.current = { enabled: () => !batchEditMode, hapticsEnabled: () => enhancementSettings.haptics, performDrop: performLibraryDrop };
  useEffect(() => attachLibraryTouchDrag({
    enabled: () => touchDragBridge.current.enabled(),
    hapticsEnabled: () => touchDragBridge.current.hapticsEnabled(),
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
    if (!["lib", "db", "dp"].includes(extension) && file.size < MAIN_THREAD_PARSE_MAX_BYTES) {
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
    const raw = files ? Array.from(files) : [];
    if (!raw.length) return;
    /* 同名同大小去重（用户 2026-10-08）：QQ 这类应用把同一个文件从 getData() 与
       EXTRA_STREAM 两处同时交给系统，原生暂存各存一份 → 一次「导入两份」，
       第 2/2 份会把 .db 卷进批量解析、报「必须通过动态局面查询会话打开」
       （用户复现几次后暂存消费掉就恢复正常，正是这个来源）。原生侧也加了
       「显示名+大小」判重，这里是第二道保险（覆盖旧版原生/网页拖拽等路径）。 */
    const requested: File[] = [];
    const seen = new Set<string>();
    for (const file of raw) {
      const key = `${file.name}\u0000${file.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requested.push(file);
    }
    if (!requested.length) return;
    if (requested.length === 1 && (/\.zip$/i.test(requested[0].name) || requested[0].type === "application/zip")) {
      await handleZipFile(requested[0]);
      return;
    }
    cancelActiveAiComputation("record-switch");
    /* 批量里混着 .db/.dp：数据库只能按「动态局面查询会话」单独打开，绝不能进批量
       解析（formats 的 importRecordFileRaw 对 db/dp 直接抛错——用户看到的那句）。
       处理顺序：先把其余文件照常批量导入，最后打开数据库（它是当前视图）。
       ⚠ 别把其余文件丢掉：旧行为里它们本来就能正常导入（只有 db 那一份报错），
       这一版只是把 db 也接上，不能连累同批的普通棋谱。 */
    if (requested.length > 1) {
      const dbFiles = requested.filter((file) => ["db", "dp"].includes(file.name.split(".").pop()?.toLowerCase() || ""));
      if (dbFiles.length) {
        const rest = requested.filter((file) => !dbFiles.includes(file));
        setToast(dbFiles.length > 1
          ? `一次只打开一份数据库：先打开 ${dbFiles[0].name}${rest.length ? `；同批其余 ${rest.length} 份先照常导入` : ""}`
          : `数据库 ${dbFiles[0].name} 单独打开${rest.length ? `；同批其余 ${rest.length} 份先照常导入` : ""}`);
        if (rest.length) await handleFiles(rest);
        requested.length = 0;
        requested.push(dbFiles[0]);
      }
    }
    const singleExtension = requested.length === 1 ? requested[0].name.split(".").pop()?.toLowerCase() || "" : "";
    const isJsonFile = (file: File) => (file.name.split(".").pop()?.toLowerCase() || "") === "json";
    // ① 题库集合（顶层有 puzzles 数组）——单份。**这一段与从前逐字一致**（判据、加不加尺寸门都没动）。
    if (requested.length === 1 && singleExtension === "json" && isPuzzleJsonText(await requested[0].text())) {
      await handlePuzzleFile(requested[0]);
      return;
    }
    /* ② 生成题目的**证明** JSON（用户 2026-10-11：「为什么 json 文件导入会失败了，是不是其他格式文件也会失败了」）。
       查下来的结论：其他格式都好，只有这一类文件没有入口 —— 它不是棋谱（没有 nodes/rootId），
       也不是题库集合（顶层没有 puzzles 数组），于是两条路各自报错
       （"RENJU 文件缺少有效的版本、ID 或节点表" / "顶层需要题目数组，或包含 puzzles 数组"）。
       实测 `artifacts/research/**` 里真实存在两种形态，`readGeneratedProofText` 两种都认：
         · 裸证明 `{schema:"banbu-vcf-proof/1",…}`；
         · 带外壳 `{puzzle:{schema:…}, difficulty, geometry, stats}`。
       认出后走**生成器保存题目的同一条** `commitGeneratedPuzzles`（并入「VCF 生成器」文件夹）。
       ⚠ 两点别改坏：
         · **不 fire 生成器成就**（那条写的是"用生成器造出第 N 道题"，导入别人的证明不算"造"，
           否则反复导入同一个文件就能刷出来）——所以共用的是 commit 而不是 saveGeneratedPuzzles；
         · **认不出就返回 null、绝不抛**：同目录里还混着研究报表（`{stats:…}` / source-hashes.json），
           它们不是题，必须原样落到下面的棋谱流程去报自己的错。
       支持**多选**（一次几十份）：逐个认，只要有一份不是证明就整批放弃、交回既有流程 —— 不做"挑着导"，
       因为半路分拣会让"为什么只导进来一部分"变得难解释。 */
    if (requested.length > 0 && requested.every((file) => isJsonFile(file) && file.size <= GENERATED_PROOF_DETECT_MAX_BYTES)) {
      const proofs: GeneratedPuzzle[] = [];
      for (const file of requested) {
        const proof = readGeneratedProofText(await file.text());
        if (!proof) { proofs.length = 0; break; }
        proofs.push(proof);
      }
      if (proofs.length) {
        const { count } = commitGeneratedPuzzles(proofs, GENERATED_DEFAULT_FOLDER);
        if (count) {
          void Promise.all(requested.map((file) => rememberRecentImport(file, "puzzle")));
          setToast(count === 1
            ? `已导入生成题「${proofs[0].title}」（${proofs[0].attacker === "black" ? "黑" : "白"}先 ${proofs[0].depth} 手）到题库「${GENERATED_DEFAULT_FOLDER}」`
            : `已导入 ${count} 道生成题到题库「${GENERATED_DEFAULT_FOLDER}」`);
        }
        return;
      }
    }
    if (requested.length !== 1 && requested.some((file) => file.name.split(".").pop()?.toLowerCase() === "lib")) {
      setToast("网页 RenLib 核心当前一次打开一份 LIB，请分开选择");
      return;
    }
    if (singleExtension === "lib") {
      const progressId = beginImportProgress(requested[0].name, "正在读取 LIB 文件头与网页核心");
      setImportState("renlib-web-started", { name: requested[0].name, size: requested[0].size });
      const session = new RenLibWebViewSession();
      attachDynamicSessionUpdates(session);
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
      attachDynamicSessionUpdates(session);
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
    const summaryPool = [...largeSummaries];
    let quotaFallback = false;
    try {
      if (normalImports.length) {
        const normalCandidates = normalImports.map(({ result }, index) => {
          if (!largeSummaries.some((item) => item.id === result.document.id)) return result.document;
          largeConflicts += 1;
          return { ...result.document, id: `${result.document.id}-import-${Date.now().toString(36)}-normal-${index}` };
        });
        try {
          saved = saveManyToLibrary(normalCandidates);
          if (requested.length === 1) {
            const primaryIndex = normalImports.findIndex((item) => item.isPrimary);
            if (primaryIndex >= 0) resolvedSingle = saved.resolved[primaryIndex] || null;
          }
        } catch (error) {
          // localStorage 上限约 5MB。中等体积棋谱（约 1.5–4MB、节点数不足 4 万）既没被判定
          // 为大型、又装不进 localStorage，以前会在这里抛 QuotaExceededError，用户看到
          // 「本机存储空间不足，棋谱已解析但尚未保存」而**整次导入失败**（实测 2.56MB /
          // 3.5 万节点的 SGF 必挂）。这里退回大型棋谱库（IndexedDB）——把判定从「按体积预估」
          // 改成「真写不下就换库」，与本来就判定为大型的那条通道共用 saveLargeDocument。
          if (!(error instanceof DOMException && error.name === "QuotaExceededError")) throw error;
          quotaFallback = true;
          saved = { library: loadLibrary(), resolved: [], inserted: 0, duplicates: 0, conflicts: 0 };
          for (let index = 0; index < normalCandidates.length; index += 1) {
            const candidate = normalCandidates[index];
            // 显式给出摘要：summarizeLargeDocument 只认 compact 索引的节点数，
            // 普通文档走它会得到 nodeCount 0（列表里会显示「0 节点」）。
            const summary = await saveLargeDocument(candidate, {
              id: candidate.id,
              metadata: candidate.metadata,
              updatedAt: candidate.updatedAt,
              mainLineLength: mainLineLength(candidate),
              nodeCount: Object.keys(candidate.nodes).length,
              fingerprint: documentFingerprint(candidate),
              storageMode: "document",
            });
            summaryPool.push(summary);
            largeInserted += 1;
            if (requested.length === 1 && normalImports[index]?.isPrimary) resolvedSingle = candidate;
          }
        }
      }
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
    // 识别池预热（2026-10-14）：这里是**所有**图片入口的汇合点——相册选择器、系统「分享到
    // 半步五子棋」、粘贴、拖拽、最近导入，都会走到这个函数然后进对齐屏。分享进来时应用是
    // 被系统拉起来的，没有「看首页」那段空闲，能用的就是用户在**对齐屏上调整识别范围**的时间；
    // 这里先起预热，等他点「开始识别」时池子通常已经热好。幂等、失败静默、不影响任何判定。
    void import("./features/recognition/recognition-accelerator").then((mod) => mod.prewarmRecognitionPool()).catch(() => {});
    // 预览 URL 由 image-preview 模块持有（≤2048px 缩小图，带缓存）：对齐屏与核对屏
    // 都只负责显示，用缩小图不再解码整张原图——这就是「每次进去都卡一下」的根因。
    // 识别器仍直接读原始 File，精度不受影响。这里先空着进入，预览就绪即显示。
    setImageImportPreview(null);
    setSheet("imageImport");
    void getImagePreview(file).then((preview) => {
      setImageImportPreview({ file, url: preview.url, name: file.name });
    }).catch(() => {
      // 预览失败（解码不了）就退回原图直显：与旧行为一致，至少让用户看到图。
      setImageImportPreview({ file, url: URL.createObjectURL(file), name: file.name });
    });
  };

  const closeImageImportSheet = () => {
    // 预览 URL 归 image-preview 的缓存管（淘汰时自己回收），这里只清状态。
    setImageImportPreview(null);
    setSheet(null);
  };

  // 识谱默认走「静态局面」快路径（跳过序号匹配——那是整条管线最重的部分）；
  // 要按图上序号重建落子顺序时（前提：棋子印有手序数字），在核对屏点「复原手序-本地 / 复原手序-云端」（正式功能，09-28 转正）。
  const runBoardImageRecognition = async (file: File, displayName: string, opts: { roi?: BoardRoi; anyBoardSize?: boolean } = {}) => {
    cancelActiveAiComputation("record-switch");
    setImageRecognizing(true);
    recordAction(`图片识谱：${displayName}`);
    // 15路 only: the app's board is 15x15. Trying other sizes let a wrong-size
    // guess (grid not detected, UI chrome misread as stones) out-rank the real
    // board by raw stone count — so recognize 15路 directly and skip the rest.
    // 例外：实验功能「不限 15 路」（对齐屏右上角开关，设置→开发测试功能里开启）
    // 显式打开时传 0，由识别器检测路数。之所以要显式开关：路数判错的代价是整盘
    // 错位重排，比「多一颗子」严重得多，不能默认开。
    const recognizeSize = opts.anyBoardSize ? 0 : 15;
    const progressId = beginImportProgress(displayName, "正在识别棋盘图片");
    setSheet(null);
    try {
      // 把送进识别器的文件信息显示出来：相册选择器/聊天软件有时会转码或缩放，
      // 远程排查「同一张图手机与电脑结果不同」时这行就是最直接的证据。
      // 这里不再预先 createImageBitmap 取尺寸（大图在 iOS 上会白解码 100-400ms）：
      // 原图像素尺寸改由识别器回报（result.imageWidth/Height），识别完成后那行
      //（finishImportProgress 的 detail）会补上“宽×高”。早期这行拿不到尺寸是
      // 可以接受的——它出现的瞬间用户主要在等识别，识别完的完成行才是要看的证据。
      // 另外不再传 progress: 0：定量 0% 会让进度条停在 0 直到完成、观感像卡死；
      // 去掉后卡片走它已有的不定量动画（is-indeterminate + 骨架），如实表达
      //「正在进行、不知道确切百分比」，也不需要用定时器伪造百分比。
      updateImportProgress(progressId, { phase: "parsing", detail: `${recognizeSize === 0 ? "自动识别路数" : `按 ${recognizeSize} 路识别`}棋盘 · ${file.name.slice(0, 24)} · ${file.type || "?"} · ${Math.round(file.size / 1024)}KB` });
      // 默认快路径：跳过序号匹配（整条识别管线最重的部分，约 40% 耗时）。
      // 要手序的话，核对屏上现点「复原手序-本地」再补这一趟，或走「复原手序-云端」。
      // parallel：设置「可选增强功能 · 识谱多核加速」（默认开）。开时网格探测与
      // 逐格分析跑在 worker 池上、界面不冻结，结果与单线程逐位相同；关时回落单线程。
      // 静态识谱也走 cell-cls 补位（2026-10-07）：白底/低对比照片上默认识别会漏掉
      // 一半以上的子，补位用「占用置信极高」的严格阈值捞回来（实测 40→77 子、
      // 零假阳零错色）。模型没就绪时 scanner 为空，行为与以前完全一致。
      const boostReaders = await loadRecognitionEnhancement();
      const result = await recognizeBoardImage(file, recognizeSize, { skipMoveOrder: true, roi: opts.roi, parallel: enhancementSettings.fastRecognition, boardScanner: boostReaders.boardScanner ?? undefined });
      const stones = result.board.flat().filter(Boolean).length;
      if (stones < 4) {
        throw new Error("没有在图片中找到可靠棋子，请确认截图包含完整棋盘");
      }
      const occupiedCells = result.board.flat().filter(Boolean).length;
      // 用户 09-17：识别完**先进叠图核对屏**（把结果按识别到的网格画回原图，可改错子），
      // 点「确认导入」才建谱。这里新建一条 object URL 专供核对屏、关闭时自己回收，
      // 免得与对齐屏那份预览 URL 的归属搅在一起。
      // 核对屏与对齐屏共用同一张预览（网格坐标全按比例换算，缩小图不影响落点）。
      // URL 归预览缓存管，closeImageVerify 不再回收——「返回对齐」还要继续用它。
      const verifyUrl = (await getImagePreview(file)).url;
      // 网格退回时的醒目提示（2026-10-08）：`gridFallback` 表示「15 路拟合与自动路数救援
      // 都没找到可靠网格」——书页插图裁块、多盘合页、或根本不是棋盘的图。这种结果多半
      // 整体错位，只在备注里写一句太隐蔽（用户反馈「棋子不完全、序号一塌糊涂」就是这类图
      // 被默认为有效结果）。这里把提示提到最前面，并说明下一步该做什么。
      const fallbackWarning = result.gridFallback
        ? "⚠ 没有找到可靠网格：这张图可能是棋盘的局部、一页多盘、或不是棋盘。下面的棋子位置很可能整体错位，建议框选/对齐到完整单盘后重新识别。"
        : "";
      // 新的核对屏：还没试过复原，「重新识别 / 补全识别」两颗按钮先不露。
      setRestoreAttempted(false);
      setImageVerify({
        url: verifyUrl,
        name: displayName,        board: result.board.map((row) => [...row]),
        boardRevision: 1,
        boardSize: result.boardSize,
        note: fallbackWarning ? `${fallbackWarning}（${result.note}）` : result.note,
        confidence: result.confidence,
        grid: result.grid ?? null,
        gridCanvas: result.gridCanvas ?? null,
        editable: true,
        restoreFromNumbers: false,
        numberedMoves: [],
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        ignoredColoredMarkers: result.ignoredColoredMarkers,
        file,
        roi: opts.roi ?? null,
        recognizeSize,
        // 导入这一趟算好的网格几何（2026-10-09）：复原要重跑一次识别，网格必然与
        // 这次逐值相同，传下去可直接跳过「网格检测」（实测 5～7.6 秒、占导入约一半）。
        // 只是省掉重算：逐格特征、读号、装配全部照旧按这份几何跑。
        knownGrid: result.grid ? { originX: result.grid.originX, originY: result.grid.originY, spacingX: result.grid.spacingX, spacingY: result.grid.spacingY } : null,
        partialNumbers: [],
      });
      finishImportProgress(progressId, `${result.boardSize} 路识谱完成：识别 ${occupiedCells} 子 · ${result.imageWidth}×${result.imageHeight} · 待核对`);
      setToast(`${result.boardSize} 路识谱完成：识别 ${occupiedCells} 子（置信度 ${Math.round(result.confidence * 100)}%），请核对叠图后确认导入`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "图片识谱失败，请使用清晰的棋盘截图";
      failImportProgress(progressId, detail);
    } finally { setImageRecognizing(false); }
  };

  const closeImageVerify = () => setImageVerify(null); // 预览 URL 归缓存管，不在这里回收

  /** 核对通过后建谱。addMoveAs 是不可变风格——每次返回**新**文档，循环必须把新文档
   *  带着往下走；拿最初的空文档去加每一颗子，会把第一颗之后的整段静默丢掉（导入空盘）。 */
  const openVerifiedRecognition = (board: Cell[][]) => {
    const session = imageVerify;
    if (!session) return;
    closeImageVerify();
    // 成就：识谱成功（用户点了「确认导入」才算数——识别出来没采纳不算）。
    // 手数取复原线长度与盘面子数的较大者，覆盖「只识别局面、没有手序」的图。
    const recognizedStones = board.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    progress.signal({
      recognitionCount: 1,
      recognitionMaxMoves: Math.max(recognizedStones, session.numberedMoves?.length || 0),
      ...(session.restoreFromNumbers && session.numberedMoves?.length ? { restoredMoveOrder: true } : {}),
    });
    // 棋魂：识谱成功（token 带时刻——同一张图重新识别导入是一次新的工作）。
    progress.earn({
      reason: "recognition",
      amount: soulAmount("recognition"),   // 从来源表读（理由同 puzzle-solve 那处）
      detail: `识谱导入 ${recognizedStones} 子`,
      token: `recognition:${Date.now()}`,
    });
    const next = createDocument(session.name.replace(/\.[^.]+$/, "") || "图片识谱", session.boardSize);
    let importedDocument = next;
    // 复原手序导入后光标要落在最后一手：performOpenRecord 默认打开 rootId，
    // 而重建出的棋谱第 0 手是空盘——不带 headId 就会停在空局面上，看起来像
    // 「导入了个寂寞」（09-28 AI 通道 E2E 抓到，序号原生路径同病）。
    let headId = next.rootId;
    if (session.restoreFromNumbers) {
      let currentId = next.rootId;
      for (const move of session.numberedMoves) {
        const added = addMoveAs(importedDocument, currentId, move, move.player);
        if (!added.created) break;
        importedDocument = added.document;
        currentId = added.nodeId;
      }
      headId = currentId;
    } else {
      const root = next.nodes[next.rootId];
      root.setup = { black: [], white: [], empty: [], nextPlayer: "black" };
      board.forEach((row, r) => row.forEach((player, c) => { if (player) root.setup?.[player].push({ row: r, col: c }); }));
      // 静态局面的行棋方按黑白子数奇偶推出（SGF PL 语义）。
      root.setup.nextPlayer = (root.setup.black.length > root.setup.white.length) ? "white" : "black";
    }
    performOpenRecord(importedDocument, headId);
    setSaved(false);
    // 用户 09-17：识谱导入后**默认进入编辑面板**——识别难免有错子，进来就能用
    // 「去子」「位移」修，不用再自己找入口（放在 performOpenRecord 之后，避免被它重置）。
    setDockPanel("notes");
    const occupied = board.flat().filter(Boolean).length;
    setToast(`已导入 ${session.boardSize} 路识谱结果：${occupied} 子${session.restoreFromNumbers ? `，已按序号复原第 1 手到第 ${session.numberedMoves.length} 手` : ""}${session.ignoredColoredMarkers ? `，忽略 ${session.ignoredColoredMarkers} 个彩色分析点` : ""}；改错子用「去子」，整体偏一格用「位移」`);
  };

  /** 叠图棋子上要印的手序号：完整复原（restoreFromNumbers）用全序列；
   *  否则用「复原手序-本地」部分读出的号。键 "row,col"，交给核对屏绘制。 */
  const verifyNumberAt = useMemo<Record<string, number>>(() => {
    const session = imageVerify;
    if (!session) return {};
    const list = session.restoreFromNumbers ? session.numberedMoves : session.partialNumbers;
    const map: Record<string, number> = {};
    for (const move of list) map[`${move.row},${move.col}`] = move.number;
    return map;
  }, [imageVerify]);

  /**
   * 复原手序-本地（正式功能，09-28 从实验转正）：核对屏上用原文件重跑一遍
   * **带序号匹配**的识别（首次识别走的是跳过序号的快路径）。
   *  - 每颗子都带可读号且恰好凑成 1..N：重建落子顺序、全子标号、锁编辑；
   *  - 只读出部分号：把读到的标到图上、如实说明无法全序（缺号补猜＝编造）；
   *  - 一个都没读到：提示换「复原手序-云端」或按局面导入。
   * 注意这是重新识别、不保留用户在核对屏改过的子——复原的是「原图的手序」。
   */
  const runLocalMoveOrderRestore = () => runMoveOrderRestore("full");
  /** 「重新识别」：与第一次复原同一条路（整盘重读），用于怀疑上次读漏了。 */
  const runReMoveOrderRestore = () => runMoveOrderRestore("full", "re");
  /** 「补全识别」：只对上次没读到的子重读——已读准的号直接沿用（省掉绝大部分模板扫描）。 */
  const runCompleteMoveOrderRestore = () => runMoveOrderRestore("complete");

  /**
   * 复原手序的统一实现（2026-10-09 从 runLocalMoveOrderRestore 抽出，新增两种模式）：
   *  - mode "full"：整盘重读（原行为，按钮「复原手序-本地」与「重新识别」都用它）；
   *  - mode "complete"：把本屏**已经读到的号**通过 knownNumbers 钉住，只对没读到的子
   *    跑模板扫描。原理与依据见 RecognizeOptions.knownNumbers：读号段占复原路径八成以上
   *    耗时，而它逐子可切——钉住已读的号，这一趟只在少数难读的子上花时间。
   *    安全性：钉住的号仍要过装配器的完整门控（唯一号 / 1..N / 奇偶 / 边际），
   *    所以「上次读错」不会被这一趟掩盖成成功，最坏情况就是如实报告仍然不完整。
   *
   * 两个模式共用同一段结果处理：完整 1..N 就重建手序、部分读出就标注、无读出就如实拒绝。
   */
  const runMoveOrderRestore = async (mode: "full" | "complete", busyKind: "local" | "re" | "complete" = "local") => {
    const session = imageVerify;
    const anyBusy = localRestoreBusy || aiRestoreBusy || reRestoreBusy || completeRestoreBusy;
    if (!session || anyBusy) return;
    if (!session.file) {
      setToast("这次识别的来源文件已不可用，请返回对齐后重新识别");
      return;
    }
    // 补全识别的前置：得先有「已读到的号」。本屏的 partialNumbers 就是它（复原失败时
    // 如实记录了读出全集）；没有可沿用的号就退回整盘重读，免得用户点了没反应。
    const known = mode === "complete" ? session.partialNumbers : [];
    const effectiveMode: "full" | "complete" = mode === "complete" && known.length > 0 ? "complete" : "full";
    if (mode === "complete" && known.length === 0) {
      setToast("这次还没有可沿用的已读号，改为整盘重读");
    }
    const setBusy = busyKind === "complete" ? setCompleteRestoreBusy : busyKind === "re" ? setReRestoreBusy : setLocalRestoreBusy;
    setBusy(true);
    try {
      // 识谱增强包（内置）：cell-cls 补位 + 长头数字头读号，让「白底照片只认一半子」
      // 这类图也能完整复原（实测 89 手比赛图 45→89 子、逐坐标全对）。模型没就绪时
      // readers 全为 null，识别器自动回落模板匹配，功能与以前完全一致。
      const readers = await loadRecognitionEnhancement();
      const result = await recognizeBoardImage(session.file, session.recognizeSize, {
        skipMoveOrder: false,
        roi: session.roi ?? undefined,
        parallel: enhancementSettings.fastRecognition,
        digitReader: readers.digitReader ?? undefined,
        boardScanner: readers.boardScanner ?? undefined,
        // 复用导入那一次的网格（2026-10-09）：同一张图、同一画布 → 网格逐值相同。
        // 跳过网格检测这一步实测省 5～7.6 秒（占这条链路的一半）；识别器侧带越界体检，
        // 几何与当前画布不符就自动回落重算，不会给出错位结果。
        knownGrid: session.knownGrid ?? undefined,
        // 补全识别：钉住已读到的号，只对漏读的子开火。
        knownNumbers: effectiveMode === "complete" ? known.map((entry) => ({ row: entry.row, col: entry.col, number: entry.number })) : undefined,
        // 只在本屏这张棋盘上读号（2026-10-13）：用户在核对屏删掉的子不再被重新找回来。
        // 之前这条一直是空壳（接口声明了、识别器没实现、这里也没传），于是「删掉多认的子
        // 再点复原 → 子又冒出来，而复原成功会锁编辑，连再删一次都做不到」。
        knownBoard: session.board.some((line) => line.some(Boolean)) ? session.board : undefined,
      });
      const occupied = result.board.flat().filter(Boolean).length;
      // 「多认一颗子」时识别器会把它排除编号、并在 result 里标出来（见 numberedSkippedStone）：
      // 判定「完整 1..N」要把这颗子从分母里扣掉，否则一次成功的复原会被 71≠72 判成不完整。
      const skipped = result.numberedSkippedStone ?? null;
      const numberingTarget = occupied - (skipped ? 1 : 0);
      const extraStoneNote = skipped
        ? `；另有 1 颗子（${String.fromCharCode(65 + skipped.col)}${result.boardSize - skipped.row}）疑似多认、未参与编号，请在叠图里核对（导入后可用「去子」删掉）`
        : "";
      const numbers = result.numberedMoves.map((move) => move.number).sort((a, b) => a - b);
      const completeSequence = numberingTarget > 0 && result.numberedMoves.length === numberingTarget
        && numbers.every((value, index) => value === index + 1);
      setRestoreAttempted(true);
      // 补全那趟用的是「本屏已读号」当输入，而这一趟可能读出**更多的号**：把新读数
      // 与沿用的号并起来当本屏的最新「已读全集」，用户再点补全时会更加完整。
      const mergedReads = effectiveMode === "complete"
        ? (() => {
          const merged = new Map<string, Position & { player: Player; number: number }>();
          for (const entry of known) merged.set(`${entry.row},${entry.col}`, entry);
          for (const entry of result.readMoveNumbers) merged.set(`${entry.row},${entry.col}`, entry);
          return [...merged.values()];
        })()
        : result.readMoveNumbers;
      if (completeSequence) {
        setImageVerify({
          ...session,
          board: result.board.map((row) => [...row]),
          boardRevision: (session.boardRevision ?? 0) + 1,
          boardSize: result.boardSize,
          numberedMoves: result.numberedMoves,
          partialNumbers: [],
          restoreFromNumbers: true,
          editable: false,
          note: effectiveMode === "complete"
            ? `已沿用上次读到的 ${known.length} 个号，补读其余棋子后按序号复原第 1 手到第 ${result.numberedMoves.length} 手；请对照原图逐颗核对${extraStoneNote}`
            : `本地已按图上序号复原第 1 手到第 ${result.numberedMoves.length} 手，棋子已标上手序；请对照原图逐颗核对${extraStoneNote}`,
        });
        setToast(`${effectiveMode === "complete" ? "补全识别" : "复原手序-本地"}完成：共 ${result.numberedMoves.length} 手${skipped ? "（另有 1 颗子疑似多认、未编号）" : ""}，核对叠图无误后点「确认导入」`);
      } else if (mergedReads.length > 0 || result.moveOrderQuality?.status === "ambiguous") {
        const qualityRejected = result.moveOrderQuality?.status === "ambiguous";
        const readCount = mergedReads.length;
        setImageVerify({
          ...session,
          numberedMoves: [],
          partialNumbers: mergedReads,
          restoreFromNumbers: false,
          editable: true,
          note: qualityRejected
            ? `本地读出 ${readCount}/${occupied} 个序号，但候选存在坐标交换风险，未自动复原；图上已标出结果，请逐颗核对${result.moveOrderQuality?.reason ? `（${result.moveOrderQuality.reason}）` : ""}`
            : `本地只读出 ${readCount} 个序号（共 ${occupied} 子），凑不成完整的第 1 手到第 ${occupied} 手，无法复原手序。「重新识别」整盘重读；「补全识别」只补还没读到号的 ${Math.max(0, occupied - readCount)} 颗（已读的 ${readCount} 个号直接沿用，更快）`,
        });
        setToast(qualityRejected
          ? "序号已读出，但存在坐标交换风险：请核对叠图后再导入"
          : `序号不完整（${readCount}/${occupied}）：可点「重新识别」或「补全识别」继续，或按局面导入`);
      } else {
        setImageVerify({
          ...session,
          numberedMoves: [],
          partialNumbers: [],
          restoreFromNumbers: false,
          editable: true,
          note: `本地没能读出棋子上的序号（共 ${occupied} 子）。可能是序号太小、太淡或被水印挡住；可点「重新识别」再读一遍，或试「复原手序-云端」（识图大模型读整图更强）`,
        });
        setToast("本地没读出序号：图上序号可能太小或太淡，可点「重新识别」或试「复原手序-云端」");
      }
    } catch (error) {
      setToast(`${mode === "complete" ? "补全识别" : "复原手序-本地"}失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * AI 复原手序（用户 09-28 方案③）：把核对屏里的图整张发给用户配置的
   * 识图大模型，换回「第几手·哪颗子」的序列回填本屏。自家识别器在带号
   * 书谱上序号读出 0、豆包实测 66/66（研究文档第 6 节），所以这条通道
   * 与序号识别互补，且以 AI 结果为准重建棋盘叠图供用户核对。
   * 校验不过（序号不连续/坐标重复/颜色矛盾）整段拒绝并说清原因——
   * 错手序看起来和对手序一模一样，只能宁缺毋滥。
   */
  const runAiMoveOrderRestore = async () => {
    const session = imageVerify;
    if (!session || aiRestoreBusy) return;
    if (!isAiVisionConfigured(aiVision)) {
      setToast("还没有配置 AI 识图服务：打开 设置→数据与兼容→AI 识图服务，填接口地址与模型名（豆包、通义千问、MiMo 等识图大模型均可）");
      return;
    }
    setAiRestoreBusy(true);
    try {
      const result = await recognizeMoveOrderViaAi(aiVision, session.url, session.boardSize);
      const board: Cell[][] = Array.from({ length: session.boardSize }, () => Array<Cell>(session.boardSize).fill(null));
      for (const move of result.moves) board[move.row][move.col] = move.player;
      const recognizedStones = session.board.flat().filter(Boolean).length;
      const diff = Math.abs(result.moves.length - recognizedStones);
      setImageVerify({
        ...session,
        board,
        boardRevision: (session.boardRevision ?? 0) + 1,
        numberedMoves: result.moves,
        partialNumbers: [],
        restoreFromNumbers: true,
        editable: false,
        note: `AI 已按图上序号复原第 1 手到第 ${result.moves.length} 手${diff ? `；本地识别是 ${recognizedStones} 子、AI 读到 ${result.moves.length} 子，有出入，请对照原图逐颗核对` : "；与本地识别子数一致"}${result.notes.length ? ` · ${result.notes.join("；")}` : ""}`,
      });
      setToast(`复原手序-云端完成：共 ${result.moves.length} 手，核对叠图无误后点「确认导入」`);
    } catch (error) {
      setToast(`复原手序-云端失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setAiRestoreBusy(false);
    }
  };

  /**
   * AI 辅助识别（用户 2026-10-02 定调：本地为主、云端为辅）：本地 CV 识别
   * 读错时（叠图明显不对），一键把整张图交给大模型重读——局面+手序一次
   * 返回，任意图片风格通用。序号凑成完整 1..N 就与「复原手序」同口径重建
   * 并锁编辑；读不全则按静态局面导入，读到的序号标上叠图供参考。
   */
  const runAiBoardRecognize = async () => {
    const session = imageVerify;
    if (!session || aiRecogBusy) return;
    if (!isAiVisionConfigured(aiVision)) {
      setToast("还没有配置 AI 识图服务：打开 设置→数据与兼容→AI 识图服务，填接口地址与模型名（豆包、通义千问、MiMo 等识图大模型均可）");
      return;
    }
    setAiRecogBusy(true);
    try {
      const result = await recognizePositionViaAi(aiVision, session.file ?? session.url, session.boardSize);
      const board: Cell[][] = Array.from({ length: session.boardSize }, () => Array<Cell>(session.boardSize).fill(null));
      for (const stone of result.stones) board[stone.row][stone.col] = stone.player;
      if (result.completeMoves) {
        setImageVerify({
          ...session,
          board,
          boardRevision: (session.boardRevision ?? 0) + 1,
          numberedMoves: result.completeMoves,
          partialNumbers: [],
          restoreFromNumbers: true,
          editable: false,
          note: `AI 读出 ${result.stones.length} 子并按图上序号复原手序${result.notes.length ? ` · ${result.notes.join("；")}` : ""}；请对照原图逐颗核对`,
        });
        setToast(`AI 辅助识别完成：${result.stones.length} 子 + 完整手序，核对叠图无误后点「确认导入」`);
      } else {
        const partial = result.stones
          .filter((stone) => stone.number !== null)
          .map((stone) => ({ row: stone.row, col: stone.col, player: stone.player, number: stone.number as number }));
        setImageVerify({
          ...session,
          board,
          boardRevision: (session.boardRevision ?? 0) + 1,
          numberedMoves: [],
          partialNumbers: partial,
          restoreFromNumbers: false,
          editable: true,
          note: `AI 读出 ${result.stones.length} 子${result.notes.length ? ` · ${result.notes.join("；")}` : ""}；序号不完整，按静态局面处理，读到的号已标上叠图`,
        });
        setToast(`AI 辅助识别完成：读出 ${result.stones.length} 子，请对照叠图核对`);
      }
    } catch (error) {
      setToast(`AI 辅助识别失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setAiRecogBusy(false);
    }
  };

  const handlePuzzleFile = async (file?: File) => {
    if (!file) return;
    cancelActiveAiComputation("record-switch");
    const progressId = beginImportProgress(file.name, "正在读取题库 JSON");
    try {
      updateImportProgress(progressId, { phase: "parsing", detail: "正在校验题目与棋盘数据" });
      // 必须过一遍归一化：本地文件同样可能是「摆棋小工具」那一套格式（靠 mode 字段区分），
      // 其中的选点题/选择题本应用判不了对错、坐标又一律按 15 路写（与声明 size 无关）。
      // 直接交给导入器会把这些题当普通题收下、坐标还会整体错位——在线路径一直是规整后再导入的，
      // 这里补齐同一条管线（audit 2026-09-17 点名的「本地导入绕过题型归一化」）。
      const normalized = normalizePuzzleSet(await file.text(), file.name.replace(/\.json$/i, ""));
      // 导入前先把"会跳过多少"讲清楚（audit 2026-09-17）：以前是导入完只在 toast 里提一句，
      // 用户不知道自己的题集被吃掉了多少、为什么。数量对得上才继续。
      if (normalized.skipped > 0 || normalized.warnings.length > 0) {
        const lines = [
          `《${normalized.title}》共 ${normalized.total} 条，本应用可做 ${normalized.puzzles} 道。`,
          normalized.skipped > 0 ? `将跳过 ${normalized.skipped} 条：选点题/选择题这类只给点位、不给胜线的题型，本应用判不了对错。` : "",
          ...normalized.warnings.slice(0, 3),
        ].filter(Boolean);
        if (!window.confirm(`${lines.join("\n")}\n\n继续导入吗？`)) { finishImportProgress(progressId, "已取消导入"); return; }
      }
      // 同名题集要先问一句（用户 2026-09-21）：以前每次导入都新建一个题集，反复导入
      // 同一份题库就会在「我的题库」里堆出一排同名条目。默认按题号更新到已有题集，
      // 用户也可以选择另存为新题集。
      const sameName = puzzleCollections.find((collection) => collection.title === normalized.title && !collection.id.startsWith("native-"));
      let updateExisting = false;
      if (sameName) {
        updateExisting = window.confirm(`题库里已经有一个同名题集《${sameName.title}》（${sameName.puzzles.length} 道题）。

点「确定」＝更新它（同名题按题号替换题面与解法，已有的做题进度保留；新增的题追加）
点「取消」＝另存为一个新题集`);
      }
      const report = importKaibaoPuzzleJson(normalized.text, normalized.title);
      updateImportProgress(progressId, { phase: "saving", detail: `正在保存 ${report.collection.puzzles.length} 道题目` });
      let nextCollections: PuzzleCollection[];
      if (sameName && updateExisting) {
        // 题号即导入器生成的 `imported-N` 序号：同号的题按位置就地更新，多出来的追加。
        // 这样「重新导出一份、改了几道题、再导回来」不会把进度冲掉。
        const incoming = report.collection.puzzles;
        const mergedPuzzles = sameName.puzzles.map((puzzle, index) => incoming[index] ? { ...incoming[index], id: puzzle.id, title: puzzle.title } : puzzle);
        const appended = incoming.slice(sameName.puzzles.length).map((puzzle, index) => ({ ...puzzle, id: `${puzzle.id}-add${index + 1}` }));
        nextCollections = puzzleCollections.map((collection) => collection.id === sameName.id ? { ...collection, puzzles: [...mergedPuzzles, ...appended] } : collection);
        setPuzzleCollections(nextCollections); savePuzzleCollections(nextCollections);
        setToast(`已更新题集《${sameName.title}》：就地更新 ${Math.min(sameName.puzzles.length, incoming.length)} 道、新增 ${appended.length} 道，进度已保留`);
        setSheet(null);
        finishImportProgress(progressId, "题库已更新");
        void rememberRecentImport(file, "puzzle");
        return;
      }
      nextCollections = [...puzzleCollections, report.collection];
      setPuzzleCollections(nextCollections); savePuzzleCollections(nextCollections);
      setLibraryFolders((currentFolders) => ({ ...currentFolders, puzzleAssignments: { ...currentFolders.puzzleAssignments, [report.collection.id]: "我的题库" } }));
      if (tab === "library") { setLibrarySection("puzzles"); setExpandedLibraryFolders(new Set(["我的题库"])); }
      else guardedOpenPuzzle(nextCollections.length - 1, 0, nextCollections);
      // 跳过分两类：来源里本应用做不了的题型（选点/选择题，或整集都是封面），以及导入器判定的空项。
      const skippedUnplayable = normalized.skipped;
      const skippedEmpty = report.skipped;
      setToast(`已导入 ${report.collection.puzzles.length} 题${skippedUnplayable ? `，跳过 ${skippedUnplayable} 道本应用做不了的题（选点/选择题）` : ""}${skippedEmpty ? `，跳过 ${skippedEmpty} 个空项` : ""}${report.warnings.length ? `，${report.warnings.length} 条提示` : ""}`);
      void rememberRecentImport(file, "puzzle");
      finishImportProgress(progressId, `${report.collection.puzzles.length} 道题目已保存`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "题库导入失败";
      setToast(message); failImportProgress(progressId, message);
    }
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
    const blob = await renderBoardSharePng(exportDocument, currentId, { ...boardShareOptions, rotation, mirrored, stoneOpacity, nativeLabels: isRenLibWebView(exportDocument) });
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
  // 编辑过动态视图后，当前文档是 detachViewForEditing() 造出的「可编辑副本」，它刻意不带
  // sourceFormat（不该声称还能写回源格式），但**源会话与原文件都还在**——分离会话在
  // detachedDynamicSource，原文件仍在 nativeSourceFile，且打开任何新棋谱时都会被清空，
  // 不会串到别的棋谱上。所以 LIB 导出仍必须基于完整原谱，否则「打开原 lib → 点新分枝 →
  // 存 lib」就是把那份有界副本写出去（用户 09-16 报告的现象，实测仍丢 3 手）。
  const detachedLibSession = detachedDynamicSource.current instanceof RenLibWebViewSession ? detachedDynamicSource.current : null;
  const libCompleteSession = sourceFormat === "lib" ? activeRenLibSession : sourceFormat ? null : detachedLibSession;
  const libCompleteFile = libCompleteSession ? nativeSourceFile.current : null;
  const libCompleteTooLarge = Boolean(libCompleteFile && libCompleteFile.size > MAX_FULL_LIB_TO_SGF_SOURCE_BYTES);
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
      /**
       * 「导出并分享」走 SGF，而 SGF 是**整份棋谱**的语义。
       * 懒加载源（DP/DB 局面库、RenLib 网页核心读的 .lib）只加载了一部分：
       * 分享出去的就是那个子集，收件人看到的却是「一份棋谱」——2026-10-10 排查补的闸。
       * 大型棋谱同理（只加载可视窗口）。要留完整原库得用「原格式直接导出」。
       */
      if (isPartialDocument(exportDocument)) {
        setToast("这份棋谱按局面读取，只加载了一部分：分享 SGF 会丢掉未加载的分支。请先「原格式直接导出」保存完整原库，或改用下方范围明确的导出");
        return;
      }
      const title = exportDocument.metadata.title?.trim() || "半步五子棋打谱";
      const file = new File([exportSgf(exportDocument)], `${title}.sgf`, { type: "application/x-go-sgf" });
      const outcome = await sharePngFile(file, title, "半步五子棋打谱 · SGF 棋谱");
      if (outcome === "shared") setToast("已分享棋谱文件");
      else if (outcome === "unavailable") setToast("当前环境不支持直接分享文件，请用下方格式导出后再手动分享");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "分享失败，请改用下方格式导出");
    }
  };
  /**
   * 这次导出为什么不能进行——返回 null 表示可以。
   *
   * 为什么要有这么一份判定：LIB / PSQ / 原格式直出这三个按钮以前是 `disabled`，触摸设备上
   * 点禁用按钮**毫无反馈**，用户只会觉得「点了没反应」；而 PSQ/POS 只保留主线、LIB 只支持
   * 十五路这类**降级导出**以前也只在弹窗里有一行静态说明。现在三个按钮一律可点，点下去就
   * 把原因用 toast 说出来（见 exportAsFormat / exportDirect 开头）。
   */
  const exportBlockedReason = (format: "lib" | "psq" | "direct"): string | null => {
    const label = format === "lib" ? "LIB" : format === "psq" ? "PSQ" : "原格式直接导出";
    if (exportScope !== "whole") {
      return format === "direct"
        ? "原格式直接导出需要「整份棋谱」范围：请先把上方导出范围切到「整份棋谱」"
        : `${label} 是整份棋谱格式：请先把上方导出范围切到「整份棋谱」`;
    }
    if (format === "direct") {
      return directExportAvailable ? null : "当前棋谱没有保留原始文件字节，无法按原格式直出；请改用 SGF 或 JSON";
    }
    if (binaryExportBlocked) {
      return `动态库视图只加载了当前可见分支，直接导出会丢掉原库其余分支；要保存完整原库请用「原格式直接导出」，编辑棋谱后也可以把所见内容导出为 ${label}`;
    }
    return null;
  };
  /** 主线之外的着法数：只保留主线的格式（PSQ / POS）导出前如实说明代价。 */
  const exportSideLineMoves = () => {
    const all = Object.values(exportDocument.nodes).filter((node) => node.move || node.passPlayer).length;
    return Math.max(0, all - mainLineLength(exportDocument));
  };
  /** 棋形标注（圆/三角/方/叉/勾）的数量。
   *  RenLib 的 .lib 里标注只是**一个布尔位**（官方 C++ MoveNode.cpp 的 MARK=0x10），
   *  没有形状、颜色、坐标——所以图形标注导出 LIB 必然丢失（注释与盘面文字不受影响）。
   *  这是格式的硬限制，必须如实告知，不能让用户以为标注跟着一起存进去了。 */
  const exportShapeMarkCount = () => Object.values(exportDocument.nodes)
    .reduce((total, node) => total + (node.marks || []).filter((mark) => styleForMark(mark) !== "text").length, 0);
  /** 用了**非默认色**的标注数量。SGF / LIB 都没有颜色字段，导出后要如实说明。
   *  默认色是 #1d1c19（与 ANNOTATION_COLORS 第一项一致），只有它不需要提示。 */
  const exportColoredMarkCount = () => Object.values(exportDocument.nodes)
    .reduce((total, node) => total + (node.marks || []).filter((mark) => (mark.color || "#1d1c19").toLowerCase() !== "#1d1c19").length, 0);
  const exportAsFormat = (format: "sgf" | "json" | "lib" | "psq" | "fgf" | "ren" | "renjs" | "wzq") => {
    if (format === "lib" || format === "psq") {
      const reason = exportBlockedReason(format);
      if (reason) { setToast(reason); return; }
    }
    const name = `${safeName(exportDocument.metadata.title)}-${exportScopeSuffix(exportScope)}`;
    if (format === "sgf" || format === "fgf" || format === "ren" || format === "renjs" || format === "wzq") {
      const extension = format === "sgf" ? "sgf" : format;
      void exportRecordFile(exportSgf(scopedExportDocument), `${name}.${extension}`, "application/x-go-sgf;charset=utf-8", `${exportScopeSuffix(exportScope)} ${extension.toUpperCase()} 已导出`);
      // SGF 的标注属性有形状（CR/TR/SQ/MA）但没有颜色字段，彩色的标注到了别的软件
      // 一律按默认色显示。这不是取舍而是格式限制，导出后如实说一句。
      if (exportColoredMarkCount() > 0) setToast(`${extension.toUpperCase()} 已导出：标注形状会保留，但 SGF 格式没有颜色字段，其他软件里会显示默认色（要连颜色一起带走请用 JSON）`);
      return;
    }
    if (format === "lib") {
      // LIB 源走的是官方核心的**动态投影**：非当前路径的每个分支在投影里只有一手
      // （核心只回答「这个深度有哪些候选」）。直接导出这个投影，原库其余分支就被压成
      // 一手——用户 09-16 反馈的「存完再打开，老分枝只剩一步」正是如此。
      // 有原文件时改用完整原谱（核心 lib2sgf）作底板，再把草稿编辑按位置路径叠上去。
      const completeSource = libCompleteSession && libCompleteFile && !libCompleteTooLarge ? libCompleteSession : null;
      void (async () => {
        try {
          const result = completeSource
            ? await libExportFromSource({ session: completeSource, draft, viewDocument, sourceDocument: document, fallback: scopedExportDocument, nonMoveKeys: completeSource instanceof RenLibWebViewSession ? completeSource.nonMoveNodeKeys : undefined })
            : { ...exportLib(applyMarksToLibDocument(scopedExportDocument).document), complete: false };
          void exportRecordFile(result.bytes, `${name}.lib`, "application/octet-stream", `${exportScopeSuffix(exportScope)} LIB 已导出`);
          for (const warning of result.warnings) setToast(warning);
          if (!result.complete && exportsVisibleDatabaseContent) {
            setToast("未能取回完整原谱，本次只导出了当前可见分支；原库其余分支未包含在 LIB 中");
          }
          // 标注已经落到这个生态真正认的地方——盘面文字（boardText）：小工具的标记渲染
          // 就是 innerHTML=文字、读棋谱时把 boardText 当标记画到棋盘上。所以对方棋盘上
          // 该点会直接显示 ○ △ ■ × √ 这些字形；落在空点上、贴不到任何节点的走注释清单。
          const shapeMarks = exportShapeMarkCount();
          if (shapeMarks > 0) setToast(`标注已随 LIB 带走：${shapeMarks} 个标注写成对局软件认得的图形标记（○ △ ■ × √ …），对方棋盘上该点直接显示；导回来仍是标注。标注颜色 LIB 格式存不下，对方看到的是默认色`);
        } catch (error) {
          setToast(error instanceof Error ? error.message : "LIB 导出失败");
        }
      })();
      return;
    }
    if (format === "psq") {
      void exportRecordFile(exportPsq(scopedExportDocument), `${name}.psq`, "text/plain;charset=utf-8", `${exportScopeSuffix(exportScope)} PSQ 已导出`);
      // PSQ 只承载主线，分支会丢——必须在导出后说出来，不能只在弹窗里留一行静态说明。
      const sideLines = exportSideLineMoves();
      if (sideLines > 0) setToast(`PSQ 只保存主线：另有 ${sideLines} 手分支变化未包含，需要完整变化树请用 SGF / JSON / LIB`);
      // 过手比分支更隐蔽：它不是"少一段"，而是会让读回来的棋子**颜色错位**（过手占了一轮），
      // 而 PSQ 只有坐标、连个记号都写不下。
      const passes = mainLinePassCount(scopedExportDocument);
      if (passes > 0) setToast(`PSQ 只有坐标，${passes} 处过手无法写出；读回时过手之后着法的黑白会错位，需要完整保留请用 SGF / JSON / LIB`);
      return;
    }
    void exportRecordFile(exportJson(scopedExportDocument), `${name}.json`, "application/json;charset=utf-8", `${exportScopeSuffix(exportScope)} JSON 已导出`);
  };
  const exportDirect = () => {
    // 按钮不再禁用（禁用态在触摸设备上点了没反馈），所以这里必须自己拦一道并说明原因。
    const directReason = exportBlockedReason("direct");
    if (directReason) { setToast(directReason); return; }
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
      // POS / TXT 只有主线坐标，分支必须明说。
      const sideLines = exportSideLineMoves();
      if (sideLines > 0) setToast(`${sourceFormat.toUpperCase()} 只保存主线：另有 ${sideLines} 手分支变化未包含，需要完整变化树请用 SGF / JSON / LIB`);
      // 过手在 POS 里也写不下（以前写成 "pass" 记号，结果连我们自己的导入器都读不回）。
      const passes = mainLinePassCount(exportDocument);
      if (passes > 0) setToast(`${sourceFormat.toUpperCase()} 只有坐标，${passes} 处过手无法写出；读回时过手之后着法的黑白会错位，需要完整保留请用 SGF / JSON / LIB`);
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
      // 官方核心 lib2sgf 把「空点标注节点」写成着法（凭空多一颗子，09-19 实测：
      // 我们导出的 `LB[dd:○]` 标注被转成 `;W[dd]`）。按 NO_MOVE 语义剔掉幻影节点后再导出；
      // 标注本身不丢——核心已把它写成父节点上的 LB，别的软件读到的仍是标记。
      const stripped = await (async () => {
        try {
          const bytes: ArrayBuffer = sgf instanceof ArrayBuffer ? sgf : new Uint8Array().buffer;
          const cleaned = await documentFromCoreSgf(bytes, session.nonMoveNodeKeys);
          if (!cleaned.removed) return { bytes, removed: 0 };
          return { bytes: exportSgf(cleaned.document), removed: cleaned.removed };
        } catch {
          return { bytes: sgf instanceof ArrayBuffer ? sgf : new Uint8Array().buffer, removed: 0 };
        }
      })();
      await exportRecordFile(
        stripped.bytes,
        `${safeName(exportDocument.metadata.title)}.sgf`,
        "application/x-go-sgf;charset=utf-8",
        stripped.removed ? `完整 LIB 已转换为 SGF（已剔除 ${stripped.removed} 个空点标注造成的幻影着法）` : "完整 LIB 已转换为 SGF",
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

  const sheetTitle = sheet === "comment" ? "节点注释" : sheet === "branches" ? "变化分支" : sheet === "tree" ? "棋谱树" : sheet === "metadata" ? "棋谱信息" : sheet === "save" ? "保存棋谱" : sheet === "folder" ? (folderSheetMode === "batch-move" ? "移动棋谱" : `新建${folderCreationSection === "records" ? "棋谱" : "题库"}文件夹`) : sheet === "rename" ? "重命名" : sheet === "puzzleEdit" ? (puzzleEditTarget ? "编辑题目" : puzzleSplitTarget ? "拆分题集" : puzzleMergeOpen ? "合并题集" : "加入题集") : sheet === "export" ? "导出与分享" : sheet === "manual" ? "使用手册" : sheet === "rules" ? "规则说明" : sheet === "about" ? "关于半步五子棋打谱" : sheet === "feedback" ? "反馈与建议" : sheet === "find" ? "查找本谱" : sheet === "positionSearch" ? "跨谱局面检索" : sheet === "coordinateCode" ? "粘贴坐标代码" : sheet === "import" ? "选择导入方式" : sheet === "aiGame" ? "AI 人机对战" : sheet === "duelResume" ? "回到上次对局" : sheet === "fifthCount" ? "选择五手打数量" : sheet === "wrongbook" ? "错题本" : sheet === "bookmarks" ? "分支书签" : sheet === "favorites" ? "收藏棋谱" : sheet === "puzzleFavorites" ? "收藏题集" : sheet === "trash" ? "回收站" : sheet === "dataSafety" ? "资料安全" : sheet === "vault" ? "本机凭证" : sheet === "puzzleManage" ? "题库管理" : sheet === "versions" ? "版本历史" : sheet === "undoHistory" ? "撤销历史" : sheet === "duelSetups" ? "开局局面库" : sheet === "duelStats" ? "战绩与等级分" : sheet === "achievements" ? "成就" : sheet === "soul" ? "棋魂" : sheet === "shop" ? "棋魂商店" : sheet === "health" ? "库健康检查" : sheet === "batchEdit" ? "批量处理" : "使用提示";
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
    if (tab === 'duel' && generatorOpen) { setGeneratorOpen(false); setGeneratorInitial(null); return true; }
    /* 「对弈」的子页面：返回先回对弈首页，而不是一步跳去打谱。
       VCF 是否真的退（一局未结算要先弹确认）由挑战页自己判，这里只递请求；
       人机对战等同于点「完成」——局面留成可恢复会话，下次「回到上次对局」接着下。 */
    if (tab === 'duel' && vcfChallengeOpen) { setVcfExitRequest((n) => n + 1); return true; }
    /* 每日一题页：与挑战页同一条——是否真的退（做了一半要先问一句）由页面自己判。 */
    if (tab === 'duel' && dailyOpen) { setDailyExitRequest((n) => n + 1); return true; }
    if (tab === 'duel' && aiGame) { closeDuelScreen(); return true; }
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
      // 语音报手（用户 09-23）：自动演示每前进一手念一句。放在动身之前算好，
      // 这样念的是「这一手」而不是等导航完成后再去猜。
      if (speechEnabled && target?.move) speakStep(describeMove(viewDocument, target.move, depthOf(viewDocument, targetId)), true, speechRate);
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
  useWorkspaceShortcuts({
    enabled: enhancementSettings.keyboardShortcuts,
    blocked: tab !== "record" || layoutEditorOpen || quickDrawerOpen || Boolean(sheet || radialMenu || annotationPopover) || boardShiftOpen || flattenPromptOpen || welcomeOpen || clockOpen,
    mode,
    sessionKey: document.id,
    onBack: () => {
      if (!current.parentId) return;
      clearBoardMotion();
      const dynamicSession = dynamicViewSession.current;
      if (dynamicSession && isDynamicDatabaseView(document) && !draftOverlay.added.has(currentId)) { navigateDynamic(dynamicSession, () => dynamicSession.back()); return; }
      if (pagedSession.current) requestPagedIndex((session) => session.parentIndex(currentId));
      else setCurrentId(current.parentId);
    },
    onForward: () => {
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
      if (pagedSession.current) requestPagedIndex((session) => session.preferredIndex(currentId));
      else { const next = preferredNext(viewDocument, currentId); if (next) setCurrentId(next); }
    },
    onJump: jumpToDepth,
    onPlayback: playback.toggle,
    onDelete: deleteCurrentVariation,
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
      const next = withAnalysisToggle(layouts, enabled);
      if (next !== layouts) saveActionLayouts(next);
      return next;
    });
  };
  // 启动/设置变化时对齐「首行快捷滑动开关」：设置说开着、布局里却没有该按钮
  // （或反过来）就自动补齐/移除。旧实现只在用户手动拨动开关时同步布局，
  // 于是「设置开着但首行看不到按钮、要重新开关一次才出现」（用户 09-13 反馈）。
  useEffect(() => {
    applyAnalysisToggleLayout(enhancementSettings.analysisQuickToggle);
  }, [enhancementSettings.analysisQuickToggle]);
  // 手册引导分片的空闲预热（09-23 懒加载配套）：首帧后等浏览器有空再取，启动
  // 关键路径不背这 84KB；取回来后「引导」点击是同步就绪的（manual-tour 门禁
  // 点完立刻断言浮层，不能有异步间隙）。startManualGuide 里的 await 是兜底：
  // 万一用户手快过空闲预热，照样能加载。
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    let id = 0;
    if (typeof w.requestIdleCallback === "function") {
      id = w.requestIdleCallback(() => { void loadManualTours(); });
    } else {
      id = window.setTimeout(() => { void loadManualTours(); }, 2500);
    }
    return () => { if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id); else window.clearTimeout(id); };
  }, []);
  const startManualGuide = async (index: number) => {
    setToast("引导加载中…");
    const tours = await loadManualTours();
    const steps = tours[index];
    if (!steps?.length) { setToast("本章引导正在制作中，先看文字说明吧"); return; }
    setSheet(null);
    setDockPanel(null);
    setGuideTour({ index, steps });
  };
  const handleGuideStep = (step: TourStep) => {
    // tab 在 AppTour mount（首步）时不会触发 goto，这里统一处理，幂等。
    if (step.tab) setTab(step.tab);
    if (step.generator !== undefined) { setGeneratorOpen(step.generator); setGeneratorInitial(null); }
    if (step.vcfChallenge !== undefined) setVcfChallengeOpen(step.vcfChallenge);
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
    // 成就：读过说明（一次性信号位——打开手册没有账本可查）。
    progress.signal({ readManual: true });
  };
  const openManualFromFirstRun = () => {
    dismissFirstRunWelcome();
    setSheet("manual");
    progress.signal({ readManual: true });
  };
  /** 从设置/各处进「关于」都先落回主列表——面板会记住上次看到的子视图，不重置的话
   *  下次点「关于」会直接开在引擎介绍或更新内容上，看起来像打不开列表。 */
  const openAboutMain = () => { setAboutInitialView("main"); setSheet("about"); };
  /** 首运行/换版本弹窗右上角那枚「本版本更新了什么」：关窗后直接开到更新内容（用户 10-01）。 */
  const openReleaseNotesFromFirstRun = () => {
    dismissFirstRunWelcome();
    setAboutInitialView("notes");
    setSheet("about");
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
  const customAppStyle = {
    /* 功能区按钮透明度（用户 2026-10-09 新增）：作为 CSS 变量挂到 app-shell，
       由样式表里那排按钮的底色去乘它 —— 这样三排功能区（首行 / 常用 / 底部导航里的按钮）
       一处改、全部跟着变，也不用把值一路传进每个按钮组件。
       `--action-opacity:1` 时与改动前完全一致（默认值）。

       ⚠ 另写一个**整数百分比** `--action-alpha`，并在 <html> 上打 data-action-alpha：
         老 WebView（K20 实测）不会算 `calc()` 与 `color-mix()`，上面那个变量它用不了，
         于是 legacy-webview.css 用属性选择器按"整十档"兜住。就近取整到 10%，
         宁可差一档也不要"调了完全没反应"（用户报的就是这个）。 */
    "--action-opacity": String(actionOpacity),
    "--action-alpha": String(Math.round(actionOpacity * 10) * 10),
    ...(themePreference === "custom" ? {
      backgroundColor: customBackgroundColor,
      /* ⚠ `backgroundImage` 必须**总是**写出来（哪怕 `none`）。
         上一版只在"有自定义图"时才写它 —— 那时 `data-theme` 是 `custom`，它自己没有
         `background-image`，所以漏写也看不出问题。现在界面主题可以是 cyber / soul 这种，
         它们的 `html[data-theme=X] .app-shell{background-image:url(场景图)}` 会**盖在自定义色上**
         （用户只选了色、没选图时尤其明显：背景颜色被主题场景吞掉）。
         内联样式优先级高于样式表，所以显式写 `none` 就能把主题那层挡掉；
         有自定义图时内联又是那张图，同样压过主题。 */
      backgroundImage: customBackgroundImage
        ? `linear-gradient(#1118, #1118), url("${customBackgroundImage}")`
        : "none",
      ...(customBackgroundImage ? { backgroundSize: "cover", backgroundPosition: "center" } : {}),
    } : {}),
  } as React.CSSProperties;
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
    : aiGame ? aiClockActive
      ? `对弈 · ${formatGameClock(aiHumanElapsedMs)}${aiGame.readOffMs && aiReadOffActive ? ` · 本手 ${formatGameClock(Math.max(0, aiGame.readOffMs - aiMoveElapsedMs))}` : ""}`
      : "AI 对弈"
    : previewDocId === document.id ? "在线预览（未保存）"
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

  /**
   * 「管理 N 道题」展开区（用户 2026-09-21 改造）。
   *
   * 表头给出这个题集的实际进度（正确率与平均用时只在真有完局记录时显示——本地题库
   * 大批题零记录，一律显示 0% 只会是噪声），并提供「加题」（把当前棋盘局面加进来）
   * 与批量入口。每题行从原来的「收藏 + 重命名」扩成三件套：移到其他题集、编辑
   * （标题/题面/难度/先手/规则）、删除（二次确认 + 可撤销）。
   */
  const renderPuzzleManager = (
    collection: PuzzleCollection,
    collectionIndex: number,
    orderedPuzzleIds: string[],
    puzzleById: Map<string, Puzzle>,
    naturalPuzzleIds: string[],
  ) => {
    const summary = summarizeCollection(collection, puzzleProgress, puzzleOverlays);
    const moveTargets = puzzleCollections.filter((item) => item.id !== collection.id && !hiddenPuzzleCollectionIds.includes(item.id));
    const accuracy = summary.attempted ? `${summary.solved} / ${summary.attempted}` : "";
    const averageSeconds = summary.averageDurationMs ? Math.round(summary.averageDurationMs / 1000) : 0;
    return <div className="puzzle-manager-list" key={orderedPuzzleIds.join("|")}>
      <div className="puzzle-manager-head">
        <span className="puzzle-manager-summary">
          <b>共 {summary.total} 道</b>
          {summary.attempted > 0 && <span>正确率 {accuracy}</span>}
          {averageSeconds > 0 && <span>平均 {averageSeconds} 秒/题</span>}
        </span>
        <span className="puzzle-manager-actions">
          <button type="button" onClick={() => { setMode("record"); setTab("record"); setManagedPuzzleCollectionId(collection.id); setPuzzleAddTargetId(collection.id); setSheet("puzzleEdit"); setToast(`摆好局面后点「加入这个题集」，就会存进“${collection.title}”`); }} aria-label={`把当前棋盘局面加入题集“${collection.title}”`} title="把当前棋盘上的局面加为这个题集的一道题"><Plus size={14}/>加题</button>
          {puzzleUndoRef.current && <button type="button" onClick={undoPuzzleEdit} aria-label="撤销最近的题库改动" title="撤销最近一次单题删除、合并或拆分"><Undo2 size={14}/>撤销</button>}
        </span>
      </div>
      {orderedPuzzleIds.map((puzzleId) => {
        const puzzle = puzzleById.get(puzzleId);
        if (!puzzle) return null;
        const puzzleIndexInCollection = naturalPuzzleIds.indexOf(puzzleId);
        const stats = derivePuzzleStats(collection.id, puzzle.id, puzzleProgress, puzzleOverlays);
        const queued = isPuzzleQueued(puzzleReviewQueue, collection.id, puzzle.id);
        return <div key={puzzleId} className="puzzle-manager-row" onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzles", collection.id, naturalPuzzleIds)} data-order-id={puzzleId} data-drag-kind="puzzles" data-drag-key={collection.id}>
          <span className="puzzle-row-drag" draggable data-order-id={puzzleId} data-drag-kind="puzzles" data-drag-key={collection.id} title="拖动调整顺序" onDragStart={onLibraryDragStart("puzzles", collection.id, puzzleId)}><GripVertical size={13}/></span>
          <button onClick={() => guardedOpenPuzzle(collectionIndex, puzzleIndexInCollection)} aria-label={`打开题目“${puzzle.title}”`}>
            <span>{puzzleIndexInCollection + 1}</span><b>{puzzle.title}</b>
            {stats.mastery === "solved" && <small className="puzzle-mastery solved" title="已经做出来了">已解</small>}
            {stats.mastery === "mastered" && <small className="puzzle-mastery mastered" title="已标记为掌握">已掌握</small>}
            {stats.mastery === "wrong" && <small className="puzzle-mastery wrong" title={`尝试 ${stats.attempts} 次，尚未攻克`}>错题 {stats.attempts} 次</small>}
            {queued && <small className="puzzle-mastery queued" title="在重做队列里">待重做</small>}
          </button>
          <button className={isPuzzleFavorite(collection.id, puzzleId) ? "fav-on" : ""} onClick={() => togglePuzzleFav(collection.id, puzzleId)} aria-label={isPuzzleFavorite(collection.id, puzzleId) ? `取消收藏题目“${puzzle.title}”` : `收藏题目“${puzzle.title}”`} title={isPuzzleFavorite(collection.id, puzzleId) ? "取消收藏" : "收藏"}><Star size={14} fill={isPuzzleFavorite(collection.id, puzzleId) ? "currentColor" : "none"}/></button>
          <button onClick={() => openPuzzleEdit(collection, puzzle)} aria-label={`编辑题目“${puzzle.title}”`} title="编辑题面、难度、先手与规则"><Settings2 size={14}/></button>
          {moveTargets.length > 0 && <select className="puzzle-move-select" value="" onChange={(event) => { if (event.target.value) movePuzzleToCollection(collection, puzzle, event.target.value); }} aria-label={`把题目“${puzzle.title}”移到其他题集`} title="移到其他题集">
            <option value="">移到…</option>
            {moveTargets.map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}
          </select>}
          <button className="delete-puzzle" onClick={() => deletePuzzle(collection, puzzle)} aria-label={`删除题目“${puzzle.title}”`} title="从题集删除这道题"><Trash2 size={14}/></button>
        </div>;
      })}
      {!orderedPuzzleIds.length && <p className="puzzle-manager-empty">这个题集还没有题目。用「加题」把当前棋盘局面存进来。</p>}
    </div>;
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
        {orderedIds.map((id) => { const entry = entryById.get(id); if (!entry) return null; const { collection, puzzles, collectionIndex } = entry; const solved = collection.puzzles.filter((puzzle) => puzzleProgress[puzzleProgressKey(collection.id, puzzle.id)]?.solved).length; const managing = managedPuzzleCollectionId === collection.id; const naturalPuzzleIds = collection.puzzles.map((puzzle) => puzzle.id); const orderedPuzzleIds = applyOrder(naturalPuzzleIds, libraryFolders.order?.puzzles?.[collection.id]); const puzzleById = new Map(collection.puzzles.map((puzzle) => [puzzle.id, puzzle])); const puzzleSortMenuId = `puzzles:${collection.id}`; return <article key={collection.id} className={puzzleBatchMode ? `batch-selectable ${puzzleBatchSelectedIds.includes(collection.id) ? "selected" : ""}`.trim() : ""} onClick={() => puzzleBatchMode ? togglePuzzleBatchSelection(collection.id) : undefined} onDragOver={onLibraryDragOver} onDragLeave={onLibraryDragLeave} onDrop={onLibraryDrop("puzzleCollections", folder, naturalIds)} data-order-id={collection.id} data-drag-kind="puzzleCollections" data-drag-key={folder}><div className="puzzle-collection-main"><span className="puzzle-row-drag" draggable={!puzzleBatchMode} data-order-id={collection.id} data-drag-kind="puzzleCollections" data-drag-key={folder} title="拖动调整顺序" onDragStart={onLibraryDragStart("puzzleCollections", folder, collection.id)}><GripVertical size={14}/></span>{puzzleBatchMode && <label className="batch-selection-checkbox" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={puzzleBatchSelectedIds.includes(collection.id)} onChange={() => togglePuzzleBatchSelection(collection.id)} aria-label={`选择题集“${collection.title}”`}/><i/></label>}<button onClick={() => guardedOpenPuzzle(collectionIndex, 0)} disabled={puzzleBatchMode}><span className="puzzle-folder-icon">題</span><div><b>{collection.title}</b><small>{libraryQuery.trim() && puzzles.length !== collection.puzzles.length ? `${puzzles.length} / ${collection.puzzles.length} 道题匹配` : `${solved} / ${collection.puzzles.length} 已完成`}</small></div><ChevronRight size={18}/></button>{!puzzleBatchMode && <><button className={`library-inline-action ${isCollectionFavorite(collection.id) ? "fav-on" : ""}`} onClick={() => toggleCollectionFav(collection.id)} aria-label={isCollectionFavorite(collection.id) ? `取消收藏题集“${collection.title}”` : `收藏题集“${collection.title}”`} title={isCollectionFavorite(collection.id) ? "取消收藏" : "收藏"}><Star size={15} fill={isCollectionFavorite(collection.id) ? "currentColor" : "none"}/></button><button className="library-inline-action" onClick={() => beginLibraryRename({ kind: "puzzle-collection", id: collection.id, name: collection.title })} aria-label={`重命名题集“${collection.title}”`}><PenLine size={15}/></button><button className="library-inline-action" onClick={() => hidePuzzleCollection(collection)} aria-label={`隐藏题集“${collection.title}”`} title="从题库列表隐藏（设置 →「题库管理」可恢复）"><EyeOff size={15}/></button>{!collection.id.startsWith("native-") && <button className="library-inline-action delete-puzzle-collection" onClick={() => deletePuzzleCollection(collection)} aria-label={`删除题集“${collection.title}”`}><Trash2 size={15}/></button>}</>}</div><div className="puzzle-collection-tools"><select value={folder} onChange={(event) => assignLibraryItem("puzzles", collection.id, event.target.value)} aria-label={`移动题集“${collection.title}”到文件夹`}>{folderOptions(libraryFolders.puzzleFolders)}</select><button onClick={() => setManagedPuzzleCollectionId(managing ? null : collection.id)} aria-expanded={managing}>{managing ? "收起题目" : `管理 ${puzzles.length} 道题`}</button>{!puzzleBatchMode && <button className="library-inline-action" onClick={() => { setSheet("puzzleEdit"); setPuzzleSplitTarget({ collectionId: collection.id, title: collection.title, total: collection.puzzles.length, from: "1", to: String(collection.puzzles.length) }); }} aria-label={`拆分题集“${collection.title}”`} title="按题号区间拆出新题集"><Scissors size={15}/></button>}<button className="library-inline-action" data-export-puzzle-collection={collection.title} onClick={() => { downloadFile(exportPuzzleCollectionJson(collection), `${collection.title}.json`, "application/json"); setToast("已导出题集 JSON 文件"); }} aria-label={`导出题集“${collection.title}”为 JSON 文件`} title="导出为 JSON 文件（本机题库文件，可再导入或用别的工具读）"><Download size={15}/></button><button className="library-inline-action" onClick={() => toggleLibrarySortMenu(puzzleSortMenuId)} aria-label={`排序题集“${collection.title}”中的题目`} aria-expanded={librarySortMenu === puzzleSortMenuId} title="排序题目"><ArrowDownUp size={15}/></button>{renderLibrarySortMenu(puzzleSortMenuId, [
          ["题目 A→Z", () => sortLibraryContainer("puzzles", collection.id, naturalPuzzleIds, (id: string) => puzzleById.get(id)?.title || "", "az")],
          ["题目 Z→A", () => sortLibraryContainer("puzzles", collection.id, naturalPuzzleIds, (id: string) => puzzleById.get(id)?.title || "", "za")],
          ["恢复默认排序", () => resetLibraryOrder([["puzzles", collection.id]])],
        ])}</div>{managing && renderPuzzleManager(collection, collectionIndex, orderedPuzzleIds, puzzleById, naturalPuzzleIds)}</article>; })}
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
    navPrev: <button onClick={() => goPrev()} disabled={dynamicNavigationBusy || !current.parentId} aria-label="上一手" title="上一手"><ChevronLeft/></button>,
    navNext: <button className="accent" onClick={goNext} disabled={dynamicNavigationBusy || !preferredNext(viewDocument, currentId)} aria-label="下一手" title="下一手"><ChevronRight/></button>,
    navEnd: <button onClick={goPreferredEnd} disabled={dynamicNavigationBusy} aria-label="到最后一手" title="到最后一手"><ChevronLast/></button>,
    navUndo: <button onClick={undoDraftChange} onPointerDown={(event) => { if (!draft.operations.length) return; if (undoHistoryPress.current !== null) window.clearTimeout(undoHistoryPress.current); undoHistoryPress.current = window.setTimeout(() => { undoHistoryPress.current = null; suppressUndoClick.current = true; setSheet("undoHistory"); swallowHeldClickInSheet(); }, 520); }} onPointerUp={() => { if (undoHistoryPress.current !== null) { window.clearTimeout(undoHistoryPress.current); undoHistoryPress.current = null; } }} onPointerLeave={() => { if (undoHistoryPress.current !== null) { window.clearTimeout(undoHistoryPress.current); undoHistoryPress.current = null; } }} onContextMenu={(event) => { if (draft.operations.length) { event.preventDefault(); setSheet("undoHistory"); } }} disabled={!draft.operations.length} aria-label="撤销编辑" title={draft.operations.length ? `撤销最近一次编辑（右键或长按看历史，共 ${draft.operations.length} 步）` : "暂无可撤销的编辑"}><Undo2/></button>,
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
  // 分析面板里的常驻棋力说明：非 15 路（或超出引擎上限）时一直可见，不随 toast 消失。
  const analysisStrengthNotice = boardSizeStrengthNotice(viewDocument.metadata.boardSize || 15, viewDocument.metadata.rule);
  // ---- 分析面板的沉淀行 + 整局复盘（用户 09-17 第一梯队①②） ------------
  const analysisPanelOpen = dockPanel === "analysis" && mode !== "puzzle";
  const cachedAnalysisEntry = useMemo<AnalysisCacheEntry | null>(() => {
    // 只在「对局进行中」隐藏：对局结束后记录已存档、局面就是普通棋谱，缓存行该照常给
    // （旧写法判 aiGame 真值 → 人机对局结束后的整份棋谱永远看不到「上次分析」，09-19 实测）。
    if (!analysisPanelOpen || (aiGame && !aiGame.outcome) || !enhancementSettings.analysisCache) return null;
    // 正在思考、或本局面的实时结果已在面板上时，不显示缓存行。
    if (aiAnalysis.contextKey === currentPositionKey || aiAnalysis.status === "thinking") return null;
    return getAnalysisCacheEntry(document.id, currentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisPanelOpen, aiGame, enhancementSettings.analysisCache, aiAnalysis.contextKey, aiAnalysis.status, currentPositionKey, document.id, currentId]);
  const restoreCachedAnalysis = () => {
    const entry = getAnalysisCacheEntry(document.id, currentId);
    if (!entry) { setToast("没有找到本局面的缓存结果"); return; }
    setAiAnalysis({
      status: "complete", engine: aiAnalysisEngineRef.current, mover: entry.mover, depth: entry.depth,
      selDepth: entry.selDepth, nodes: entry.nodes, score: entry.score, scoreAvailable: entry.scoreAvailable,
      winRate: entry.winRate, contextKey: currentPositionKey,
      candidates: (entry.candidates || []).map((candidate) => ({ move: candidate.move, score: candidate.score, winRate: candidate.winRate, depth: candidate.depth, pvIndex: -1 })),
    });
    setToast("已载入上次分析结果（缓存）");
  };
  const formatCacheTime = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? `今天 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : `${date.getMonth() + 1}月${date.getDate()}日`;
  };
  const reviewCurvePoints = useMemo(() => (gameReview.samples ? buildReviewCurve(gameReview.samples) : []), [gameReview.samples]);
  const reviewSummary = useMemo(() => (gameReview.entries?.length
    ? buildReviewSummary(gameReview.entries, { openingLastMove: openingProcedureLastMove(viewDocument.metadata.openingRule), openingRuleLabel: viewDocument.metadata.openingRule ? recordRuleDisplayName(viewDocument.metadata).split(" · ")[0] : "", formatCoordinate: (position) => coordinateName(position, viewDocument.metadata.boardSize || 15), totalMoves: gameReview.total || 0 })
    : null), [gameReview.entries, gameReview.total, viewDocument.metadata.boardSize]);
  const reviewTotalForScale = gameReview.total || Math.max(1, (gameReview.samples?.length || 1) - 1);
  // ---- 「胜率」页签：常态胜率图的数据（复盘样本优先，分析缓存补全） --------
  const mainlineNodes = useMemo(() => gameReviewMainline(viewDocument), [viewDocument]); // eslint-disable-line react-hooks/exhaustive-deps
  // 胜率序列按「局面」对齐：根局面 + 每手之后（共 N+1 个），下标即复盘样本下标。
  const winratePositions = useMemo(() => [viewDocument.rootId, ...mainlineNodes.map((node) => node.nodeId)], [viewDocument, mainlineNodes]);
  // 缓存读取单独 memo：只在「棋谱变了」或「写了新缓存」时重新读盘，  // 不让它在每次引擎 INFO（几百毫秒一次）时都 JSON.parse 一遍整份缓存。
  const documentAnalysisCache = useMemo(
    () => (enhancementSettings.analysisCache ? getDocumentAnalysisCache(viewDocument.id) : {}),
    [viewDocument.id, enhancementSettings.analysisCache, analysisCacheVersion],
  );
  const cachedWinrateRates = useMemo(() => {
    const cacheRates: Record<string, number | undefined> = {};
    for (const nodeId of winratePositions) {
      const entry = documentAnalysisCache[nodeId];
      // 缓存的 winRate 是行棋方视角 → 黑方视角百分数。
      if (entry && typeof entry.winRate === "number") { const rate = toBlackWinRate(entry.winRate, entry.mover); if (rate !== undefined) cacheRates[nodeId] = Math.round(rate * 1000) / 10; }
    }
    return cacheRates;
  }, [winratePositions, documentAnalysisCache]);
  // 游标（智子 VictoryCursorContainer 同款交互，09-19 用户钦定）：竖线=棋盘当前
  // 局面，点/拖曲线棋盘同步跳手，棋盘导航竖线跟着走。
  // 当前局面在主线外（分支上）时，游标**钳到最近的主线祖先**（分支点）——直接藏掉
  // 会像「游标莫名消失」（09-19 QA 实测：打谱里同点落第二枝时投影的主线并不跟着
  // 切到新枝）；是否在分支上由 winrateCursorOnBranch 标注在读数里。
  const winrateCursorIndex = useMemo(() => {
    const exact = winratePositions.indexOf(currentId);
    if (exact >= 0) return exact;
    let node = viewDocument.nodes[currentId];
    const seen = new Set<string>();
    while (node?.parentId && !seen.has(node.id)) {
      seen.add(node.id);
      const parentIndex = winratePositions.indexOf(node.parentId);
      if (parentIndex >= 0) return parentIndex;
      node = viewDocument.nodes[node.parentId];
    }
    return 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winratePositions, currentId, viewDocument]);
  const winrateCursorOnBranch = winratePositions.indexOf(currentId) < 0;
  const winrateScrubMoveRef = useRef(-1);
  const nodeIdForMoveNumber = (moveNumber: number) => winratePositions[moveNumber] || viewDocument.rootId;
  /** 胜率曲线渲染（复盘页签与胜率页签共用）。hitAll=true 时每个评估点都可点跳手。 */
  const renderWinrateChart = (points: Array<{ moveNumber: number; blackWinRate: number }>, totalForScale: number, entries: ReviewEntry[] | undefined, hitAll: boolean, caption: string, cursorMove: number | null, onBranch = false) => {
    if (points.length < 2) return null;
    const scale = Math.max(1, totalForScale);
    const yFor = (rate: number) => 100 - Math.max(0, Math.min(100, rate));
    const pointsAttr = points.map((point) => `${(point.moveNumber / scale) * 100},${yFor(point.blackWinRate)}`).join(" ");
    const marked = (entries || []).filter((entry) => entry.grade === "blunder" || entry.grade === "missedWin" || entry.grade === "mistake");
    const scrubFrom = (event: ReactPointerEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const moveNumber = Math.max(0, Math.min(scale, Math.round(((event.clientX - rect.left) / rect.width) * scale)));
      if (winrateScrubMoveRef.current === moveNumber) return;
      winrateScrubMoveRef.current = moveNumber;
      setCurrentId(nodeIdForMoveNumber(moveNumber));
    };
    const cursorInfo = cursorMove === null ? "" : (() => {
      const rate = points.find((point) => point.moveNumber === cursorMove)?.blackWinRate;
      const base = `当前 第 ${cursorMove} 手${rate !== undefined ? ` · 黑方 ${Math.round(rate)}%` : " · 未评估"}`;
      return onBranch ? `${base}（分支局面，游标停在分支点）` : base;
    })();
    // 游标处的胜率读数（用户 09-19：游标指到哪就要看到那一手的胜率）：浮在曲线上方，
    // 贴左右边缘时改用对齐边而不是居中，免得读数被裁掉。
    const cursorRate = cursorMove === null ? undefined : points.find((point) => point.moveNumber === cursorMove)?.blackWinRate;
    const cursorPercent = cursorMove === null ? 0 : (cursorMove / scale) * 100;
    return <div className="ai-review-curve">
      <div className="ai-curve-body">
        {/* 左侧胜率刻度（100/75/50/25/0）。用 HTML 而不是 SVG 文本：这个 svg 是
            preserveAspectRatio="none"，在里面写字会被横向拉伸。竖轴本身是 .ai-curve-plot 的左边框。 */}
        <div className="ai-curve-axis" aria-hidden="true">
          {["100", "75", "50", "25", "0"].map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className="ai-curve-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="胜率曲线（黑方视角，纵轴上下各为黑白优势）；点按或拖动可跳到对应局面"
        onPointerDown={(event) => { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 拖不动就只点选 */ } winrateScrubMoveRef.current = -1; scrubFrom(event); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) scrubFrom(event); }}
        onPointerUp={(event) => { try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ } winrateScrubMoveRef.current = -1; }}>
        <line x1="0" y1="50" x2="100" y2="50" className="ai-review-curve-mid" aria-hidden="true"/>
        <polyline points={pointsAttr} className="ai-review-curve-line" aria-hidden="true"/>
        {hitAll && points.map((point) => <circle key={`hit-${point.moveNumber}`} cx={(point.moveNumber / scale) * 100} cy={yFor(point.blackWinRate)} r="2.2" className="ai-review-dot-hit" aria-label={`第 ${point.moveNumber} 手局面`}/>)}
        {marked.map((entry) => {
          const point = points.find((candidate) => candidate.moveNumber === entry.moveNumber);
          if (!point) return null;
          return <circle key={entry.nodeId || `m${entry.moveNumber}`} cx={(entry.moveNumber / scale) * 100} cy={yFor(point.blackWinRate)} r="1.8" className={entry.grade === "mistake" ? "ai-review-dot mistake" : "ai-review-dot blunder"} aria-label={`第 ${entry.moveNumber} 手，${entry.grade ? REVIEW_GRADE_LABELS[entry.grade] : ""}`}><title>{`第 ${entry.moveNumber} 手 · ${entry.grade ? REVIEW_GRADE_LABELS[entry.grade] : ""}`}</title></circle>;
        })}
        {/* 游标：竖线 + 落在曲线上的圆点。 */}
        {cursorMove !== null && <g data-chart-cursor="true" aria-hidden="true">
          <line x1={(cursorMove / scale) * 100} y1="0" x2={(cursorMove / scale) * 100} y2="100" className="ai-review-cursor"/>
          {(() => { const point = points.find((candidate) => candidate.moveNumber === cursorMove); return point ? <circle cx={(cursorMove / scale) * 100} cy={yFor(point.blackWinRate)} r="1.6" className="ai-review-cursor-dot"/> : null; })()}
        </g>}
      </svg>
          {cursorMove !== null && cursorRate !== undefined && (
            <span className="ai-curve-readout" style={cursorPercent < 10 ? { left: 0 } : cursorPercent > 90 ? { right: 0 } : { left: `${cursorPercent}%`, transform: "translateX(-50%)" }}>
              黑 {Math.round(cursorRate)}%
            </span>
          )}
        </div>
      </div>
      {/* 文字最多两行（用户 09-19：说明太啰嗦）：第一行是图例，第二行是游标读数。 */}
      <small>{caption}</small>
      {cursorMove !== null && <small className="ai-curve-cursor-line">{cursorInfo}</small>}
    </div>;
  };
  const workspaceDockPanel = dockPanel && !(mode === "puzzle" && (dockPanel === "analysis" || dockPanel === "play")) && (<div className={`dock-panel dock-panel-${dockPanel}`}>
            {dockPanel === "analysis" && <div className="ai-analysis-panel" aria-label="AI 分析">
              {/* 三个页签（用户 09-19，对标智子）：计算=原主面板；复盘=整局复盘；胜率=常态胜率图。 */}
              <div className="ai-panel-tabs" role="tablist" aria-label="分析面板视图">
                <button type="button" role="tab" data-panel-tab="compute" aria-selected={analysisPanelTab === "compute"} className={analysisPanelTab === "compute" ? "selected" : ""} onClick={() => setAnalysisPanelTab("compute")}>计算</button>
                <button type="button" role="tab" data-panel-tab="winrate" aria-selected={analysisPanelTab === "winrate"} className={analysisPanelTab === "winrate" ? "selected" : ""} onClick={() => setAnalysisPanelTab("winrate")}>胜率</button>
                <button type="button" role="tab" data-panel-tab="review" aria-selected={analysisPanelTab === "review"} className={analysisPanelTab === "review" ? "selected" : ""} onClick={() => setAnalysisPanelTab("review")}>复盘</button>
              </div>
              {analysisPanelTab === "compute" && <>
              <div className="ai-analysis-head"><div className="ai-analysis-row ai-analysis-row--main"><label className={`analysis-toggle ${enhancementSettings.analysisAuto ? "on" : ""}`}><input type="checkbox" checked={enhancementSettings.analysisAuto} onChange={(event) => toggleAnalysis(event.target.checked)} aria-label={enhancementSettings.analysisSelfPlay ? "自对弈" : "持续分析"}/><i aria-hidden="true"/></label><PanelSelect ariaLabel="分析模式" value={getAnalysisMode(enhancementSettings)} options={[["continuous", "持续"], ["selfplay", "自对弈"], ["hint", "提示"]] as const} onChange={(mode) => { if (changeEnhancementSettings(withAnalysisMode(enhancementSettings, mode as AnalysisMode))) { setAnalysisPreview(null); } }}/><PanelSelect ariaLabel="切换引擎" value={aiEngineChoice === "ikatago" ? "ikatago" : kataActive ? "katago" : "rapfi"} options={([["rapfi", "rapfi"], ...(Capacitor.isNativePlatform() ? [["katago", "katago"]] : []), ["ikatago", "ikatago"]] as [string, string][]).map((pair) => [pair[0], pair[1]] as const)} onChange={(value) => updateAiEngineChoice(value === "katago" ? "kata" : value === "ikatago" ? "ikatago" : "strong")}/><PanelSelect ariaLabel="选点数量" value={String(enhancementSettings.analysisCandidateCount)} options={[[1,"1 选"],[2,"2 选"],[3,"3 选"],[4,"4 选"],[5,"5 选"],[6,"6 选"],[8,"8 选"],[10,"10 选"],[15,"15 选"],[20,"20 选"],[30,"30 选"],[50,"全部"]].map(([count, label]) => [String(count), label as string] as const)} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, analysisCandidateCount: Number(value) })}/><PanelSelect ariaLabel="选点显示内容" value={kataActive && (enhancementSettings.analysisCandidateMetric === "depth" || enhancementSettings.analysisCandidateMetric === "score") ? "winRate" : enhancementSettings.analysisCandidateMetric} options={(kataActive ? [["winRate", "胜率"], ["drawRate", "和棋率"], ["nodes", "访问量"]] : [["winRate", "胜率"], ["score", "评估分"], ["depth", "深度"], ["nodes", "计算量"]]) as ReadonlyArray<readonly [string, string]>} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, analysisCandidateMetric: value as AnalysisCandidateMetric })}/><PanelSelect ariaLabel="选点小数位数" value={String(enhancementSettings.analysisCandidateDecimals)} options={([[0, "0 位"], [1, "1 位"], [2, "2 位"], [3, "3 位"], [4, "4 位"], [5, "5 位"]] as const).map(([count, label]) => [String(count), label] as const)} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, analysisCandidateDecimals: Number(value) })}/></div><div className="ai-analysis-row ai-analysis-row--engine">{aiEngineChoice === "ikatago" ? <IkatagoTuning onNotice={setToast}/> : kataActive ? <KataTuning variant="panel" onNotice={setToast}/> : <>{<button type="button" className={`ai-analysis-mt ${enhancementSettings.engineMultiThread ? "on" : ""}`} aria-pressed={enhancementSettings.engineMultiThread} title="多线程引擎：开启后引擎使用多个核心并行搜索（更快也更热），并可选择线程数" onClick={() => { const next = !enhancementSettings.engineMultiThread; changeEnhancementSettings({ ...enhancementSettings, engineMultiThread: next }); cancelActiveAiComputation("settings-change"); }}><small>多线程</small><b>{enhancementSettings.engineMultiThread ? "开" : "关"}</b></button>}{(enhancementSettings.engineMultiThread || nativeEngineReady) && <PanelSelect ariaLabel="引擎线程数" value={String(enhancementSettings.engineThreads)} options={engineThreadOptionsCompact(undefined, nativeEngineInfo()?.bigCores)} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, engineThreads: Number(value) })}/>}{nativeEngineReady && nativeEngineInfo()?.dotprodPreference !== undefined && (() => { const info = nativeEngineInfo(); const capable = info?.dotprodCapable === true; const preference = info?.dotprodPreference ?? "auto"; const on = preference !== "off" && capable; return <button type="button" className={`ai-analysis-dotprod ${on ? "on" : ""}`} aria-pressed={on} disabled={!capable} title={capable ? "NEON DotProd：NNUE 的 int8 点积硬件加速。切换后引擎会重启，下一轮搜索生效" : "本机 CPU 不支持 NEON DotProd（armv8.2+ 才有），无法开启"} onClick={() => { void setNativeDotprod(on ? "off" : "auto").then((ok) => { if (!ok) { setToast("切换失败：本机原生引擎不支持该开关"); return; } cancelActiveAiComputation("settings-change"); setToast(on ? "已关闭 NEON DotProd，引擎已重启" : "已启用 NEON DotProd，引擎已重启"); }); }}><small>DotProd</small><b>{capable ? (on ? "开" : "关") : "不支持"}</b></button>; })()}<label className="ai-analysis-memory"><span>内存</span><output>{fmtAnalysisMemory(enhancementSettings.analysisMaxMemoryMb)}</output><input aria-label="分析内存滑杆" type="range" min="64" max="2048" step="32" value={enhancementSettings.analysisMaxMemoryMb} onChange={(event) => { const v = Math.min(2048, Math.max(64, Number(event.target.value))); changeEnhancementSettings({ ...enhancementSettings, analysisMaxMemoryMb: v }); }}/></label></>}</div></div>
              {analysisStrengthNotice && <p className="ai-strength-notice" role="note" aria-label="棋力说明"><Info size={13}/><span>{analysisStrengthNotice}</span></p>}
              {/* 缺引擎包时的常驻说明（2026-09-18）：网页版不随包、只装到内置引擎，
                  这时分析照跑但棋力弱，且 toast 一闪就没——常驻一行把「为什么弱」和
                  「去哪装强的」都说出来。等原生探测落定再显示，免得启动瞬间闪一下。 */}
              {nativeProbed && !strongEngineReady && <p className="ai-strength-notice" role="note" aria-label="引擎说明"><Info size={13}/><span>当前用内置引擎（自带轻量网络）计算；设置 →「AI 引擎」里可下载 38.4MB 冠军网络包提升棋力</span></p>}
              {getAnalysisMode(enhancementSettings) === "hint"
                ? <div className="ai-hint-panel" aria-label="提示模式说明"><Gauge size={18}/><p><b>提示模式</b><span>点击分析区域外任意位置或「分析」按钮，引擎会为当前行棋方算一手并直接落子（算出杀棋会立刻落）。</span></p><p className="ai-hint-panel-sub"><span>需要回到持续分析时，把上方模式切回「持续」即可；也可以在快捷中心的「分析模式」里切换。</span></p></div>
                : <>{getAnalysisMode(enhancementSettings) === "selfplay" && <label className="quick-think-slider"><span><b>自对弈每步时限</b><small>到点即落子；提前算出杀棋会立刻落下，五连或满盘自动结束</small></span><output>{(enhancementSettings.analysisSelfPlayTimeMs / 1000).toFixed(1)} 秒</output><input aria-label="自对弈每步时限" type="range" min="1000" max="10000" step="500" value={enhancementSettings.analysisSelfPlayTimeMs} onChange={(event) => changeEnhancementSettings({ ...enhancementSettings, analysisSelfPlayTimeMs: Number(event.target.value) })}/></label>}</>}
              {cachedAnalysisEntry && <div className="ai-analysis-cached" aria-label="上次分析缓存"><small>上次分析 · {formatCacheTime(cachedAnalysisEntry.ts)} · 深度 {cachedAnalysisEntry.depth}{cachedAnalysisEntry.winRate !== undefined ? ` · ${moverWinRateLabel(cachedAnalysisEntry.mover)} ${Math.round(cachedAnalysisEntry.winRate * 100)}%` : ""}</small><button type="button" onClick={restoreCachedAnalysis}>载入上次结果</button></div>}
              <EngineLoadStatus load={engineLoad}/>
              <AnalysisLiveReadout board={board} currentPositionKey={currentPositionKey} analysisContextKey={aiAnalysis.contextKey} aiGame={Boolean(aiGame)} nextPlayer={nextPlayer} analysisShownMetric={analysisShownMetric} analysisCandidateCount={enhancementSettings.analysisCandidateCount} analysisCandidateDecimals={enhancementSettings.analysisCandidateDecimals} analysisShowCandidates={enhancementSettings.analysisShowCandidates} analysisPreview={analysisPreview} onToggleCandidate={toggleCandidatePreview}/>
              </>}
              {analysisPanelTab === "review" && (!aiGame || aiGame.outcome) && <div className="ai-review-panel" aria-label="整局复盘">
                <div className="ai-review-head">
                  <b>整局复盘</b>
                  {gameReview.status === "running"
                    ? <span className="ai-review-progress" role="status">评估中 {gameReview.done || 0}/{gameReview.total || "?"}</span>
                    : <PanelSelect ariaLabel="复盘每手预算" value={String(enhancementSettings.gameReviewBudgetMs)} options={[["400", "快"], ["800", "标准"], ["1500", "深"]] as const} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, gameReviewBudgetMs: Number(value) })}/>}
                  <button type="button" className="ai-review-start" data-review-toggle="true" onClick={() => { if (gameReview.status === "running") cancelGameReview(true); else startGameReview(); }}>{gameReview.status === "running" ? "停止" : gameReview.entries?.length ? "重新复盘" : "开始复盘"}</button>
                </div>
                {gameReview.status === "running" && <div className="ai-review-bar" aria-hidden="true"><i style={{ width: `${Math.round(((gameReview.done || 0) / Math.max(1, gameReview.total || 1)) * 100)}%` }}/></div>}
                {gameReview.status === "running" && <p className="ai-review-note">逐手评估主线，随时可停；已完成的部分会保留。</p>}
                {gameReview.status === "error" && gameReview.message && <p className="ai-review-note">{gameReview.message}</p>}
                {renderWinrateChart(reviewCurvePoints, reviewTotalForScale, gameReview.entries, false, "黑方胜率曲线 · 点/拖可跳到对应局面", winrateCursorIndex, winrateCursorOnBranch)}
                {reviewSummary && <div className="ai-review-summary">
                  <div className="ai-review-grades" aria-label="失误分档统计">
                    {(["best", "inaccuracy", "mistake", "blunder", "opening"] as ReviewGrade[]).map((grade) => reviewSummary.counts[grade] > 0 ? <span key={grade} className={`ai-review-grade ${grade}`}>{REVIEW_GRADE_LABELS[grade]} {reviewSummary.counts[grade]}</span> : null)}
                    {reviewSummary.counts.missedWin > 0 && <span className="ai-review-grade blunder">{REVIEW_GRADE_LABELS.missedWin} {reviewSummary.counts.missedWin}</span>}
                  </div>
                  {reviewSummary.worst.length > 0 && <ul className="ai-review-worst">
                    {reviewSummary.worst.map((entry) => <li key={entry.nodeId}><button type="button" onClick={() => setCurrentId(entry.nodeId)}>第 {entry.moveNumber} 手 {entry.mover === "black" ? "黑" : "白"} {entry.played ? coordinateName(entry.played, viewDocument.metadata.boardSize || 15) : "过手"} · {entry.grade ? REVIEW_GRADE_LABELS[entry.grade] : ""} · -{Math.round(entry.lossForMover || 0)}</button></li>)}
                  </ul>}
                  {/* 讲解词默认收起（用户 09-19：胜率图那块文字太啰嗦，最多两行）——
                      分档 chips 与最差三手已经在一屏内说明问题，整段讲解要看再展开。 */}
                  <details className="ai-review-text-details">
                    <summary>展开讲解</summary>
                    <pre className="ai-review-text">{reviewSummary.text}</pre>
                  </details>
                  <div className="ai-review-actions"><button type="button" className="ai-review-copy" onClick={() => { const clipboard = navigator.clipboard; if (!clipboard?.writeText) { setToast("当前环境不允许访问剪贴板"); return; } void clipboard.writeText(reviewSummary.text).then(() => setToast("讲解已复制到剪贴板"), () => setToast("复制失败")); }}>复制讲解</button></div>
                  <p className="ai-review-note">分档基于本地引擎估算，仅供参考。</p>
                </div>}
              </div>}
              {analysisPanelTab === "winrate" && (!aiGame || aiGame.outcome) && <div className="ai-review-panel ai-winrate-panel" aria-label="胜率图">
                <LiveWinratePanel
                  positions={winratePositions.map((nodeId) => ({ nodeId }))}
                  reviewSamples={gameReview.samples}
                  cacheRates={cachedWinrateRates}
                  currentPositionKey={currentPositionKey}
                  currentId={currentId}
                  nextPlayer={nextPlayer}
                  onOpenReview={() => setAnalysisPanelTab("review")}
                  renderChart={(points) => renderWinrateChart(points, Math.max(1, winratePositions.length - 1), gameReview.entries, true, "黑方胜率 · 点/拖竖线，棋盘同步走到该局面", winrateCursorIndex, winrateCursorOnBranch)}
                />
              </div>}
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
                  {annotationPopover === "style" && <>
                    <p className="mark-studio-note">形状都能带出去：导出 SGF 时写成标准的圆 / 三角 / 方块 / 叉号标记；导出 LIB 时写成同形符号（○ △ ■ × √ ★）。<b>对勾</b>在 SGF 里没有专用属性，对方会按通用「已标记」显示。</p>
                    <div className="mark-studio-options styles">{ANNOTATION_STYLES.map((item) => <button key={item.id} type="button" className={annotationStyle === item.id ? "selected" : ""} onClick={() => { setAnnotationStyle(item.id); setAnnotationPopover(null); }} aria-pressed={annotationStyle === item.id}><MarkGlyph style={item.id} color={annotationColor} value={annotationType === "custom" ? "" : annotationValue}/><small>{item.label}</small></button>)}</div>
                  </>}
                  {annotationPopover === "color" && <>
                    <p className="mark-studio-note">颜色只在<b>本应用</b>与 JSON 备份里保留。导出 SGF / LIB 给其他打谱软件时，SGF 与 LIB 格式都没有颜色字段，对方会按默认色显示——<b>标注的形状、位置和文字仍然会带过去</b>，丢的只是颜色。</p>
                    <div className="mark-studio-options colors">{annotationPalette.map(([color, label]) => <button key={label} type="button" className={annotationColor === color ? "selected" : ""} style={{ "--annotation-color": color } as React.CSSProperties} onClick={() => { setAnnotationColor(color); setAnnotationPopover(null); }} aria-label={`${label}色`} aria-pressed={annotationColor === color} title={label}><span className="mark-studio-swatch"><Check size={12}/></span><small>{label}</small></button>)}</div>
                  </>}
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
             {!isPuzzleMode && dockPanel === "notes" && <><button className={mode === "review" ? "review-blocked" : ""} onClick={mode === "review" ? reviewBlocked : () => setSheet("comment")} title={mode === "review" ? "读谱模式无法进行该操作" : "编辑节点注释"}><MessageSquareText/><span>注释</span></button><button className={mode === "review" ? "review-blocked" : ""} onClick={mode === "review" ? reviewBlocked : () => setSheet("metadata")} title={mode === "review" ? "读谱模式无法进行该操作" : "编辑棋谱信息"}><Save/><span>信息</span></button><button onClick={() => setRotation((value) => ((value + 90) % 360) as BoardRotation)}><RotateCw/><span>旋转</span></button><button onClick={() => setMirrored((value) => !value)}><FlipHorizontal/><span>镜像</span></button><button type="button" className={`erase-stone-button${eraseStone ? " active" : ""}`} onClick={toggleEraseStone} aria-pressed={eraseStone} data-erase-stone={eraseStone ? "on" : "off"} title={eraseStone ? "去子已开启：点棋盘上的棋子即删除，再点这里结束" : "去子：点棋盘上的棋子直接删除（图片导入多子/少子修正，棋谱将转为静态局面）"}>{eraseStone ? <Check size={16}/> : <Eraser/>}<span>去子</span></button><button type="button" className={`board-shift-button${boardShiftOpen ? " active" : ""}`} onClick={() => (boardShiftOpen ? setBoardShiftOpen(false) : openBoardShift())} aria-expanded={boardShiftOpen} title="整体位移：把当前局面所有棋子往一个方向挪一格（图片识谱整体偏一格时最常用）"><Move/><span>位移</span></button></>}
             {dockPanel === "view" && <>{!isPuzzleMode && <><button onClick={() => setSheet("find")}><Search/><span>查找</span></button><button onClick={() => { setDockPanel(null); setSheet("positionSearch"); }}><GitBranch/><span>跨谱查找</span></button><label className={`dock-board-size ${mode === "review" ? "review-blocked" : ""}`}><span>棋盘路数</span><select className="board-size-select" aria-label="选择新棋谱棋盘路数" value={viewDocument.metadata.boardSize || 15} onChange={(event) => { if (mode === "review") reviewBlocked(); else createBoardWithSize(Number(event.target.value)); }}><option value={viewDocument.metadata.boardSize || 15}>{viewDocument.metadata.boardSize || 15}路</option>{BOARD_SIZE_CHOICES.filter((size) => size !== (viewDocument.metadata.boardSize || 15)).map((size) => <option key={size} value={size}>{size}路</option>)}</select></label></>}<button onClick={() => setShowNumbers((value) => !value)}><Tag/><span>{showNumbers ? "隐藏手数" : "显示手数"}</span></button><button onClick={() => setShowCoordinates((value) => !value)}><Menu/><span>{showCoordinates ? "隐藏坐标" : "显示坐标"}</span></button><button onClick={copyCoordinateCode} title="把主线复制成坐标代码，可直接粘到五子棋小工具等站点"><ClipboardCopy/><span>复制坐标代码</span></button></>}
          </div>);
  // 做题的「常驻走棋区」：固定渲染、不进布局池——**永远这五键**（用户 09-10 复选：
  // 摆棋时也保持五键不变，摆棋的局面导航仍在弹出的 dock 面板里）。
  const puzzleNavRow = <div className="moves-row puzzle-nav-row rail-scroll" aria-label="走棋导航">
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
    ? <div className="workspace-status puzzle-mode"><ActionRailBar zone="top" label="常驻做题工具" enabled={enhancementSettings.buttonOverflow === "scroll"}><div className="puzzle-mode-selectors action-top-row action-puzzle-default rail-scroll" aria-label="常驻做题工具">{ids.map((id) => renderWorkspaceAction(id, "top"))}</div></ActionRailBar>{puzzleStatusCopy}{puzzleColorSwitchSlot}</div>
    : <div className={`workspace-status ${isPuzzleMode ? "puzzle-mode" : ""}`}><ActionRailBar zone="top" label={isPuzzleMode ? "常驻做题工具" : "常驻打谱工具"} enabled={enhancementSettings.buttonOverflow === "scroll"}><div className="record-command-bar action-top-row rail-scroll" aria-label={isPuzzleMode ? "常驻做题工具" : "常驻打谱工具"}>{ids.map((id) => renderWorkspaceAction(id, "top"))}</div></ActionRailBar></div>);
  /* ── 自定义开局：摆子阶段的三个动作（撤销摆子 / 清空 / 开始对局）─────────────
     摆下去的子是**真的棋谱节点**（`play()` 的摆子分支用 `addMoveAs` 追加），所以撤销直接用
     现成的 `deleteVariation`（同一个 document.id，只删子树）。**不走** `deleteCurrentVariation`
     那条路——它写的是草稿 overlay（"保存后才生效"），而摆子要的是当场消失。 */
  const duelSetupStones = duelSetupPhase ? path.filter((item) => item.move) : [];
  const duelSetupBlack = duelSetupStones.filter((item) => item.move?.player === "black").length;
  const duelSetupWhite = duelSetupStones.filter((item) => item.move?.player === "white").length;
  const applyDuelSetupDocument = (next: GameDocument, nextId: string) => {
    setDocument(next); setCurrentId(nextId);
    // 游标与"实盘位置"必须一起改：漏了 recordSession 这一句，摆子会被算成"在回看历史局面"，
    // 于是棋盘按 `historicalAiPosition` 的路子走偏（对弈的看门狗也会以为不该点火）。
    recordSession.current = { document: next, currentId: nextId };
    clearBoardMotion(); playSound("navigate");
  };
  const undoDuelSetupStone = () => {
    // 只有游标停在**链尾**才让撤：中途（导入的棋谱有分支时）这一手下面还挂着别的分支，
    // `deleteVariation` 会连子树一起删，那不是"撤销一颗摆子"而是"删掉一条路线"。
    if (!duelSetupPhase || !current.parentId || current.children.length) return;
    const removed = deleteVariation(document, currentId);
    const left = duelSetupStones.length - 1;
    applyDuelSetupDocument(removed.document, removed.nextId);
    setToast(left > 0 ? `已撤销一颗摆子，还剩 ${left} 子` : "已撤销到空盘");
  };
  const clearDuelSetupStones = () => {
    if (!duelSetupPhase) return;
    const root = document.nodes[document.rootId];
    if (!root || (!root.children.length && !root.setup)) return;
    // 直接重建根节点：导入进来的棋谱根上可能挂着**多条**分支（还可能带静态 setup 子），
    // 逐个 `deleteVariation` 反而漏。摆子阶段的"清空"就是把盘恢复成空盘。
    const next: GameDocument = { ...document, nodes: { [document.rootId]: { ...root, children: [], preferredChildId: undefined, setup: undefined } }, updatedAt: new Date().toISOString() };
    applyDuelSetupDocument(next, document.rootId);
    setToast("已清空局面");
  };
  /** 摆子阶段的回看 / 前进（导入的棋谱有分支时要能走到那条分支上再开打）。 */
  const duelSetupStepTo = (targetId: string | null | undefined) => { if (duelSetupPhase && targetId) applyDuelSetupDocument(document, targetId); };
  /**
   * 摆子阶段**允许点分支切换**（用户 2026-10-14：「导入后棋谱的什么分支都正常显示」）。
   * 走的是自己这个包装而不是 `stableNavigateVariation`：后者只动游标，不动
   * `recordSession`（打谱页没有"实盘位置"这个概念），摆子阶段跟着动才不会把游标停在半路
   * 时被当成"在回看历史局面"。
   */
  const duelSetupVariation = (nodeId: string) => duelSetupStepTo(nodeId);
  const duelSetupCanBack = Boolean(duelSetupPhase && current.parentId);
  const duelSetupNextId = current.preferredChildId || current.children[0] || null;
  const duelSetupBranchCount = duelSetupPhase ? current.children.length : 0;
  /** 「撤销摆子」只在链尾可用（中途撤销会连子树一起删，那是"删一条路线"不是"撤一颗"）。 */
  const duelSetupCanUndo = Boolean(duelSetupPhase && current.parentId && !current.children.length);
  const duelSetupCanClear = duelSetupPhase && (current.children.length > 0 || Boolean(document.nodes[document.rootId]?.setup) || duelSetupStones.length > 0);
  /** 存成局面：剪成"根→游标"这一条线（用户说的"保存当前局面"就是盘上这些子）。 */
  const saveDuelSetupHere = () => {
    if (!duelSetupPhase) return;
    const stones = duelSetupStones.length;
    if (!stones) { setToast("空盘没什么可保存：先摆几子或导入一份棋谱"); return; }
    const name = defaultSetupName(document, currentId, stones);
    const next = addDuelSetup({ name, document: lineOnlyDocument(document, currentId), currentId, stones, boardSize: document.metadata.boardSize });
    if (!next) { setToast("存不下：本机存储已满，先去棋谱库删一些"); return; }
    setDuelSetups(next);
    setToast(`已存为局面「${name}」`);
  };
  const loadDuelSetupEntry = (item: DuelSetupEntry) => {
    if (!duelSetupPhase) return;
    const savedSize = item.document.metadata.boardSize;
    if (savedSize !== document.metadata.boardSize) { setToast(`「${item.name}」是 ${savedSize} 路盘的局面，本局是 ${document.metadata.boardSize} 路，对不上`); return; }
    // 老版本存下来的局面、或导入后改名留下的"已经下完"的局面，载入这一道也要拦（摆子分支
    // 当场拒连五，但那是"新落的一子"；这批子是别人摆好的，不会经过那道闸）。
    if (positionAlreadyDecided(boardAt(item.document, item.currentId), item.document.metadata.rule)) { setToast(`「${item.name}」里已经有连五，不能当开局`); return; }
    applyDuelSetupDocument(item.document, item.currentId);
    setSheet(null);
    setToast(`已载入「${item.name}」· ${item.stones} 子`);
  };
  const applyDuelSetupList = (next: DuelSetupEntry[] | null) => { if (next) setDuelSetups(next); else setToast("本机存储写不进去（配额满？）"); };
  /**
   * 「载入」：从**自己的棋谱库 / 题库**里挑一份当开局局面（用户 2026-10-14：
   * 「不是打开文件管理器去找棋谱，而是打开自己的棋谱库，在这些文件夹里面找棋谱、习题什么的」）。
   * 所以这里不再走文件选择器——文件导入在棋谱库那一页有，摆子这一屏要的是"从我已有的东西里挑"。
   *
   * ⚠ 一定要**换 id**：载入后若沿用库里那份的 id，开始对战再点「保存本局」就会**覆盖原谱**
   *   （对局里新走的那些手会把用户存了几十手的谱写成另一份）。换个 id 等于"以它为起点另开一份"。
   */
  const duelSetupFromDocument = (source: GameDocument, tipId: string, label: string) => {
    if (isPartialDocument(source)) { setToast(`${label}是按需读取的大型谱或局面数据库，只读回了一部分节点，不能当完整开局`); return; }
    if (source.metadata.boardSize !== document.metadata.boardSize) { setToast(`${label}是 ${source.metadata.boardSize} 路盘，本局是 ${document.metadata.boardSize} 路，对不上`); return; }
    if (positionAlreadyDecided(boardAt(source, tipId), source.metadata.rule)) { setToast(`${label}停在已经连成五子的局面（一局下完了），不能当开局：往前退几手再载入`); return; }
    const token = Date.now().toString(36);
    const cloned: GameDocument = { ...source, id: `${source.id}-duel-${token}`, savedCurrentId: tipId };
    applyDuelSetupDocument(cloned, tipId);
    setDuelLoad("off");
    const stones = lineStoneCount(cloned, tipId);
    const branches = mainLineBranchCount(cloned);
    setToast(`已载入 ${label}：${stones} 手${branches ? `，${branches} 处分支可切换` : ""}；开始对战时只留当前这一条线`);
  };
  const loadDuelSetupFromRecord = (record: GameDocument) => duelSetupFromDocument(record, lastOnPreferredLine(record, record.rootId), `「${record.metadata.title || "未命名棋谱"}」`);
  const loadDuelSetupFromLargeRecord = () => { setDuelLoad("off"); setToast("大型棋谱要先在棋谱库里打开（它只读回了一部分节点），之后再用「保存局面」存成单线开局"); };
  const loadDuelSetupFromPuzzle = (collectionIndex: number, targetPuzzleIndex: number) => {
    const collection = puzzleCollections[collectionIndex];
    const puzzle = collection?.puzzles[targetPuzzleIndex];
    if (!puzzle) return;
    const built = createPuzzleDocument(puzzle, puzzle.rule || collection.rule || "freestyle");
    duelSetupFromDocument(built.document, built.initialNodeId, `题目「${puzzle.title || `第 ${targetPuzzleIndex + 1} 题`}」`);
  };
  const startDuelFromSetup = () => {
    if (!aiGame || !duelSetupPhase) return;
    const placed = duelSetupStones.length;
    /**
     * 开局的瞬间把树**剪成游标这一条路线**（用户 2026-10-14）：对局期间不该再有分支可走，
     * 复盘与「保存本局」也就是一局干净的单线谱。不剪的话，游标旁边挂着的分支会在
     * 棋谱树里继续可见、还能被回看走到，等于对局带着开局库的分支在跑。
     */
    const lined = lineOnlyDocument(document, currentId);
    if (lined !== document) { setDocument(lined); recordSession.current = { document: lined, currentId }; }
    const nextGame: AiGameState = { ...aiGame, customStarted: true, customSetupCount: placed };
    setAiGame(nextGame);
    setToast(placed ? `本局开始：摆好的 ${placed} 子已锁定，不能再撤` : "本局开始（空盘）");
    // 摆完若正"轮到 AI 的颜色"，必须当场把那一手补上——AI 的应手没有"轮到它就自己下"的
    // 监视 effect（同 `resumeDuelSession` 那段教训），不补就僵在这里。
    if (nextPlayer !== aiGame.humanPlayer) startAiGameReply(lined, currentId, aiGame.aiPlayer, nextGame);
  };
  /**
   * 摆子界面的排版（用户 2026-10-14 两轮口径）：
   *  · **棋盘居中**，上面一行写进度与下一手（`duelSetupInfoElement` → `openingBanner` 槽位）；
   *  · **下面两排**：上一排是「回看 ‹ › + 游标位置 + 保存 / 局面 / 导入」，下一排是主操作
   *    「撤销摆子 / 清空 / 开始对局」（`duelSetupActionsElement` → GameScreen 的底部槽位，
   *    继承 `margin-top:auto` 所以自己沉底）。
   * 第二排是这次加"保存局面 + 导入棋谱"时新增的：主操作要留在最底下不动，
   * 低频动作（存档/取档/导档）压在它上面一行、字号小一档，这样棋盘只让出 ~34px。
   * 属性一律 `data-duel-setup-*`（`data-vcf-items` 这几个名字在对弈页被门禁反向禁止）。
   */
  const duelSetupInfoElement = mode === "record" && aiGame && <div className="duel-setup-info" data-duel-setup-bar="true" aria-live="polite">
    <b data-duel-setup-count>{duelSetupStones.length ? `已摆 ${duelSetupStones.length} 子（黑 ${duelSetupBlack} · 白 ${duelSetupWhite}）` : "还没摆子"}</b>
    <span data-duel-setup-next>下一手 {nextPlayer === "black" ? "黑" : "白"}</span>
    <small>{duelSetupStones.length ? "" : "点棋盘摆子：黑先、白后，轮流落"}</small>
  </div>;
  const duelSetupActionsElement = mode === "record" && aiGame && <>
    <div className="duel-setup-nav" data-duel-setup-nav>
      <button type="button" data-duel-setup-prev disabled={!duelSetupCanBack} onClick={() => duelSetupStepTo(current.parentId)} aria-label="回看上一手"><ChevronLeft size={15}/></button>
      <button type="button" data-duel-setup-next disabled={!duelSetupNextId} onClick={() => duelSetupStepTo(duelSetupNextId)} aria-label="走到下一手"><ChevronRight size={15}/></button>
      <span className="duel-setup-cursor" data-duel-setup-cursor>{duelSetupStones.length ? `第 ${duelSetupStones.length} 手` : "空盘"}{duelSetupBranchCount > 1 ? ` · ${duelSetupBranchCount} 条分支可走` : duelSetupNextId ? " · 下面还有子" : ""}</span>
      <button type="button" data-duel-setup-save onClick={saveDuelSetupHere} title="把当前这条路线存进局面库">保存</button>
      <button type="button" data-duel-setup-library onClick={() => { setDuelSetups(loadDuelSetups()); setSheet("duelSetups"); }}>局面{duelSetups.length ? ` ${duelSetups.length}` : ""}</button>
      <button type="button" data-duel-setup-load-file onClick={() => { setDuelLoad("record"); }} title="从棋谱库或题库里挑一份当开局">载入</button>
    </div>
    <div className="duel-setup-row">
      <button type="button" data-duel-setup-undo disabled={!duelSetupCanUndo} onClick={undoDuelSetupStone}>撤销摆子</button>
      <button type="button" data-duel-setup-clear disabled={!duelSetupCanClear} onClick={clearDuelSetupStones}>清空</button>
      <button type="button" className="accent" data-duel-setup-start onClick={startDuelFromSetup}>开始对局</button>
    </div>
  </>;
  /**
   * 开局决策条与棋盘：打谱页与对弈界面**共用同一份 JSX**（同一时刻只有一处在渲染）。
   * 提取成变量而不是在对弈界面里再写一遍，是因为 Board 有三十来个 props——两份副本必然各自漂移，
   * 少传一个 disabled 就能让人在 AI 思考时落子，这类 bug 最难查。
   */
  const openingBannerElement = duelSetupPhase ? duelSetupInfoElement : mode === "record" && aiGame && aiOpeningStage?.kind !== "normal" && <section className="ai-opening-banner" aria-live="polite"><span className="ai-opening-step">开</span><div><b>{openingRuleName(aiGame.opening.rule, aiGame.opening.n)}</b><small>{aiOpeningBannerText ?? openingInstruction(aiGame.opening)}</small></div>{aiOpeningStage?.kind === "swap2-choice" && aiOpeningStage.chooser === "human" && !aiThinking && <div className="ai-opening-actions"><button onClick={() => chooseSwap2Option("white")}>执白</button><button onClick={() => chooseSwap2Option("black")}>执黑</button><button className="accent" onClick={() => chooseSwap2Option("two-more")}>再下两颗</button></div>}{aiOpeningStage?.kind === "swap2-pick" && aiOpeningStage.chooser === "human" && !aiThinking && <div className="ai-opening-actions"><button onClick={() => chooseSwap2Side("white")}>执白</button><button className="accent" onClick={() => chooseSwap2Side("black")}>执黑</button></div>}{aiOpeningStage?.kind === "taraguchi-fifth" && aiOpeningStage.actor === "human" && !aiThinking && <div className="ai-opening-actions"><button onClick={() => chooseTaraguchiFifthMode("single")}>单点黑5</button><button className="accent" onClick={() => chooseTaraguchiFifthMode("offers")}>给10个打点</button></div>}{aiOpeningStage?.kind === "swap" && aiOpeningStage.chooser === "human" && !aiThinking && <div className="ai-opening-actions"><button onClick={() => chooseOpeningSwap(false)}>不交换</button><button className="accent" onClick={() => chooseOpeningSwap(true)}>交换</button></div>}{aiThinking && <i className="ai-opening-thinking"/>}</section>;
  // 对弈界面有自己的终局面板（结果 / 原因 / 保存 / 复盘 / 再来一局），棋盘自带的那条横幅
  // 在它下面会重复一层（用户会看到两个「本局结束」），所以对局中不给 Board 传 result。
  const boardResultForScreen = tab === "duel" && aiGame ? null : boardResult;
  // 公用效果：全局动效关或总开关关时传 null —— Board 既不 spawn 也不给棋子挂进场类。
  const placeEffectScheme = motionEnabled && motionEffects.placeOn ? findPlaceEffect(motionEffects.placeId) : null;
  const dropEffectScheme = motionEnabled && motionEffects.dropOn ? findDropEffect(motionEffects.dropId) : null;
  const boardElement = <Board document={reviewDocument} currentId={currentId} currentBookmarked={activeBookmarks.some((bookmark) => bookmark.nodeId === currentId)} showNumbers={showNumbers} showCoordinates={showCoordinates} showLastMove={showLastMove} moveNumberScale={moveNumberScale} gridLineWidth={gridLineWidth} coordinateFontSize={coordinateFontSize} boardMargin={boardMargin} stoneSize={stoneSize} largeBoard={largeBoard} rotation={rotation} mirrored={mirrored} boardTheme={boardTheme} stoneTheme={stoneTheme} boardOpacity={boardOpacity} stoneOpacity={stoneOpacity} annotationHighlight={annotationHighlight} initialDepth={isPuzzleMode ? puzzleSetup ? 0 : puzzleInitialDepth : 0} confirmPlacement={placementConfirm} forbiddenMarkers={boardForbiddenMarkers} winningLines={boardWinningLines} openingCandidates={aiGame?.opening.candidates || EMPTY_POSITIONS} analysisCandidates={boardAnalysisCandidates} analysisContextKey={aiAnalysis.contextKey} analysisCandidateMetric={analysisShownMetric} analysisCandidateDecimals={enhancementSettings.analysisCandidateDecimals} analysisShowCandidates={enhancementSettings.analysisShowCandidates} analysisPreviewLine={analysisPreviewLine} analysisPreviewSelection={analysisPreview} analysisPreviewGuide={enhancementSettings.analysisPreviewGuide} openingStage={aiOpeningStage} thinking={machineThinking} thinkingIndicatorPosition={enhancementSettings.thinkingIndicatorPosition} onStopThinking={stableStopUnifiedThinking} motion={boardMotion} placeEffect={placeEffectScheme} dropEffect={dropEffectScheme} feedback={boardFeedback} result={boardResultForScreen} gestureZoomEnabled={enhancementSettings.pinchZoom} gestureSwipeEnabled={enhancementSettings.gestureSwipe} gestureRotateEnabled={enhancementSettings.boardRotateGesture} onRotateStep={stableRotateStep} radialMenuEnabled={!duelSetupPhase && enhancementSettings.radialMenu} onRadialMenu={stableOpenRadialMenu} onStepBack={duelSetupPhase ? undefined : stableStepBack} disabled={dynamicNavigationBusy || (isPuzzleMode && !puzzleSetup && (aiThinking || !!puzzleOutcome)) || aiBoardDisabled} onPlay={stablePlay} onVariation={duelSetupPhase ? duelSetupVariation : !isPuzzleMode && !aiGame && !continuationEditMode && !annotationActive && !eraseStone ? stableNavigateVariation : undefined} onMark={(mode === "record" || mode === "review") && !aiGame ? stableMark : NOOP_MARK} onGestureStep={!isPuzzleMode && !duelSetupPhase ? stableGestureStep : undefined} onReview={aiGame?.outcome ? openReviewStable : undefined}/>;

  // ── 对弈界面的显示数据（都在 App 里算好，GameScreen 只管摆，不含任何对局规则）──────
  const duelMoveList = path.filter((item) => item.move || item.passPlayer);
  /* ── 人机对弈的「悔棋」= **10 棋魂一次**（用户 2026-10-13 定案：「人机对战用上道具卡这个事情
     撤掉吧……人机里面的悔棋按钮可以保留，但是 10 棋魂一次，直接用棋魂消耗使用，
     同样也是 10 手前不能用」）
     ⇒ 对弈页**不再挂道具栏**（`VcfItemBar` 回到只有 VCF 挑战用，三张卡的介绍也退回 VCF 口径）；
       操作条上那枚「悔棋」按钮改成**直接扣账本**，一次 10 魂，走 `soulShop.spendAmount`
       —— 它不是商店商品，所以不进 `soul-unlocks` 那 76 项注册表（那张表按外观/一次性解锁渲染，
       塞一条假商品进去就会出现在商店列表里）。
     ⚠ 这条"前 10 手不许悔"与用户 2026-10-09 报的「摆完打点再悔几步竟然回到打点环节」**不冲突**：
       那条修的是**开局流程**（五手两打那些摆子步骤）里悔棋必须能用、且要把开局状态机一起倒回
       （`rewindOpeningForCursor`）；这里禁的是"本局手数不足 10"这个门槛，两回事。 */
  const DUEL_UNDO_LOCK_MOVES = 10;
  const DUEL_UNDO_COST = 10;
  /**
   * 锁定期只数**开始对局之后的手**。自定义开局里摆的那 N 子不算（`customSetupCount` 是边界）：
   * 否则"摆满 10 子"就等于开局立刻解锁，而那段本来就不可悔。这个边界同时是悔棋的下限——
   * 退不到摆子段以下。
   */
  const duelSetupBoundary = aiGame?.customSetupCount ?? 0;
  const duelPlayMoves = Math.max(0, duelMoveList.length - duelSetupBoundary);
  /**
   * **自定义开局这一局**：悔棋不扣棋魂、不受"前 10 手"限制、**终局之后也还能悔**
   * （用户 2026-10-15：「那里的悔棋好像不能用……这个模式的悔棋可以用而且不消耗棋魂，
   * 并且即便是终局完成了，也还是可以悔棋」）。三条其实是同一件事：这一局本来就不计战绩、
   * 不发棋魂（R198），拿"防开局库作弊"的锁去卡一个用户自己摆的局面，只会得到"悔棋按不动"——
   * 而这类局面常常三五手就结束，10 手锁永远解不开。
   * 下限还是摆子那道边界：退不回摆下去的固定开局（那一段用的是横幅上的「撤销摆子」）。
   */
  const duelIsCustom = Boolean(aiGame?.customOpening);
  const duelUndoCost = duelIsCustom ? 0 : DUEL_UNDO_COST;
  const duelUndoLocked = duelIsCustom ? duelPlayMoves <= 0 : duelPlayMoves < DUEL_UNDO_LOCK_MOVES;
  const duelUndoTitle = duelIsCustom
    ? (duelUndoLocked ? "没有可悔的落子（摆下去的那些子请用横幅上的「撤销摆子」）" : "自定义开局悔棋不花棋魂，退掉「AI 的应手 + 你那一手」；这一局已经下完也可以退")
    : duelUndoLocked
      ? `${duelSetupBoundary ? "开始对局后" : "开局"} ${DUEL_UNDO_LOCK_MOVES} 手内不能悔棋（已走 ${duelPlayMoves} 手）`
      : `悔一次棋花 ${DUEL_UNDO_COST} 棋魂，退掉「AI 的应手 + 你那一手」`;
  const takeDuelUndo = useCallback(() => {
    if (!aiGame) return false;
    if (aiGame.outcome && !duelIsCustom) { setToast("这局已经结束了"); return false; }
    if (duelUndoLocked) {
      setToast(duelIsCustom
        ? "没有可悔的落子（摆下去的那些子请用横幅上的「撤销摆子」）"
        : `${duelSetupBoundary ? "开始对局后" : "开局"} ${DUEL_UNDO_LOCK_MOVES} 手内不能悔棋（没有扣棋魂）`);
      return false;
    }
    /** 站在**实盘局面**上才动手：`goPrev` 退的是"当前 viewed 节点"，在回看历史时点它 = 往更旧走
        一步、实盘一点没变，那是"扣了 10 魂而棋局没退"（自定义开局不扣钱，但同样会退错地方）。 */
    if (!aiLivePosition) { setToast("你在回看历史局面：先点「回到本手」再悔棋（没有扣棋魂）"); return false; }
    if (duelUndoCost > 0) {
      const failure = soulShop.spendAmount(duelUndoCost, "duel-undo", "人机对弈悔棋");
      if (failure) { setToast(`${failure}（本手没悔，棋魂也没扣）`); return false; }
    }
    // 终局后悔棋（只有自定义开局走到这一步）：先把"已结束"清掉，否则 `goPrev` 走的是回看语义、
    // 结果面板也还挂着。这一局不计战绩、不发棋魂 ⇒ 清掉不需要还原任何一笔账。
    // ⚠ 棋钟那两个一次性闩（`aiClockExpired` / `aiReadOffExpired`）**故意不重置**：
    //   时间确实已经用完了，放回 false 会让下一 tick 立刻又判一次负，用户就永远悔不动这局；
    //   留着 true 的后果只是"悔棋后这一局不再被时间判负"——自定义开局是练局面的，可以接受。
    if (aiGame.outcome) {
      aiGameEndReason.current = "";
      setAiGame((game) => game ? { ...game, outcome: null } : game);
    }
    goPrev({ forceDuelRewind: true });
    setToast(duelUndoCost > 0 ? `已悔一手（−${duelUndoCost} 棋魂）` : "已悔一手（自定义开局不扣棋魂）");
    return true;
  }, [aiGame, aiLivePosition, duelIsCustom, duelSetupBoundary, duelUndoCost, duelUndoLocked, goPrev, setToast, soulShop]);
  /**
   * 开局名浮字（用户 2026-10-09）：「摆出这个开局后，会出现弹窗的字，出现在棋盘中心的下面」。
   *
   * 只在**人机对战**里算，且只有前三手能决定名字（26 开局的定义就是黑1 天元 + 白2 相邻
   * + 黑3 落点）。命名与几何的对应表在 `features/duel/opening-name.ts`，那份表由
   * `qa/opening-name-check.mjs` 对着项目自己的两份数据源逐点核对，不靠记忆写。
   *
   * `epoch` 用第三手那个节点的 id：它只在「这一局的第三手」出现，悔棋回到第二手再重下、
   * 或重开一局，id 都会变，于是浮字会重新走一遍「淡入 → 停留 → 淡出」。
   */
  const duelOpening = useMemo(() => {
    if (!aiGame || duelMoveList.length < 3) return null;
    return identifyOpeningFromMoves(
      duelMoveList.map((item) => ({ position: item.move ?? null, player: item.move?.player ?? item.passPlayer ?? "black" })),
      viewDocument.metadata.boardSize || 15,
    );
  }, [aiGame, duelMoveList, viewDocument.metadata.boardSize]);
  const duelOpeningEpoch = aiGame && duelMoveList.length >= 3 ? duelMoveList[2].id : "";
  const duelRecentMoves: DuelRecentMove[] = aiGame ? duelMoveList.slice(-5).map((item, offset) => ({
    turn: duelMoveList.length - Math.min(5, duelMoveList.length) + offset + 1,
    player: item.move?.player || item.passPlayer || "black",
    label: item.move ? coordinateName(item.move) : "过手",
  })) : [];
  /**
   * 引擎过程信息：只给「在想什么量级」的读数（引擎档 / 层数 / 节点数），
   * **永远不给推荐点与胜率**——对局的竞技性优先，要看引擎怎么看这局请终局后复盘。
   * 读数必须属于当前局面才显示（contextKey 对不上就是上一手的数字，拿来骗人）。
   */
  /**
   * 本局用的是哪台引擎：档位 → 实际能跑起来的那个。
   * 「选了旗舰但本机没有 / 盘面超限」会被 `effectiveEngineChoice` 落回 rapfi——状态栏必须
   * 如实写**真正在跑**的那台，不然用户选了 kata 看到「KataGo」却拿不到它的棋力，会以为引擎坏了。
   */
  const duelEngineLabel = () => {
    if (!aiGame) return "内置引擎";
    const effective = effectiveEngineChoice(aiGame.engineChoice, document.metadata.boardSize);
    if (effective === "kata") return "KataGo";
    const packReady = strongEngineReady;
    if (!packReady) return "内置引擎（自带轻量网络）";
    return nativeEngineReady ? "rapfi（本机原生）" : "rapfi";
  };
  /**
   * 标题与 meta 里那一格"规则"的名字。**自定义开局不占 `selectedAiRule`**（那张表是开局流程
   * 预设，五手两打/交换…），所以这里必须改名 —— 否则用户选了自定义开局，界面还写着
   * "五手两打"，而实际一步都不按它走（假信息）。
   */
  const duelRuleLabel = aiGame?.customOpening ? "自定义开局" : selectedAiRule.name;
  /** 状态栏的四项设置：规则 / 难度 / 引擎 / 时间。用户 09-28：「难度，引擎，时间什么的都没显示」。 */
  const duelMetaChips = aiGame ? [
    { label: "规则", value: `${duelRuleLabel}${/禁手/.test(duelRuleLabel) ? "" : `（${aiGame.forbiddenEnabled ? "有禁手" : "无禁手"}）`}${aiGame.customOpening && !aiGame.customStarted ? " · 摆子中" : ""}` },
    { label: "难度", value: `${aiGame.strength}${aiGame.strength === "自由" ? ` · ${(aiGame.thinkTimeMs / 1000).toFixed(1)}s${aiGame.thinkDepth ? ` / 深度 ${aiGame.thinkDepth}` : ""}` : ` · ${(aiGame.thinkTimeMs / 1000).toFixed(1)}s`}` },
    { label: "引擎", value: duelEngineLabel() },
    { label: "时间", value: `我方 ${aiGame.timeLimitMs ? formatTimeLimitLabel(aiGame.timeLimitMs) : "不限"}${aiGame.readOffMs ? ` + ${aiGame.readOffMs / 1000} 秒读秒` : ""} · AI 不计时` },
  ].filter((chip) => !duelSetupPhase || (chip.label !== "规则" && chip.label !== "时间")) : [];
  const duelEngineText = (() => {
    if (!aiGame || !aiThinking) return "";
    const engineLabel = duelEngineLabel();
    // 换引擎后的第一手特别慢（KataGo 要起进程 + 铺模型，Rapfi 强力档要冷加载权重包），
    // 用户设的是 0.6 秒却一直转，不写清楚就像卡死（用户 10-04：把现成的「正在加载」接进对局）。
    if (engineLoad) return `${engineLabel} 正在加载：${engineLoad.label || "准备引擎"}（${engineLoad.percent}%）· 就绪后自动落这一手`;
    const read = aiAnalysis.contextKey === currentPositionKey ? aiAnalysis : null;
    const depth = read && read.depth ? ` · 第 ${read.selDepth && read.selDepth !== read.depth ? `${read.depth}-${read.selDepth}` : read.depth} 层` : "";
    const nodes = read && read.nodes ? ` · ${formatEngineCount(read.nodes)}` : "";
    return `${engineLabel} 正在算这手棋${depth}${nodes}`;
  })();
  const duelResultInfo: DuelResultInfo | null = aiGame?.outcome ? {
    outcome: aiGame.outcome,
    title: aiGame.outcome === "won" ? "你赢了" : aiGame.outcome === "lost" ? "你输了" : "和棋",
    reason: aiGameEndReason.current || (aiGame.outcome === "lost" ? "本局判负" : ""),
    moves: duelMoveList.length,
    humanTimeText: formatGameClock(aiHumanElapsedMs),
    saved: aiGameSavedRef.current === document.id,
  } : null;
  /**
   * 战绩落盘：`outcome` 从 null 变成有值的那一次追加一条。终局的写法散在 11 处
   * （你连成五子 / 判负 / 认输 / 超时 / AI 无合法落子判和 / 满盘和…），这里**一处收口**，
   * 不去逐个改调用点。按 `game.id` 去重；写盘失败（配额满）不打断对局，也不假装记上了。
   */
  useEffect(() => {
    const game = aiGame;
    if (!game?.outcome || duelRecordedRef.current.has(game.id)) return;
    duelRecordedRef.current.add(game.id);
    /**
     * 自定义开局这一局**整段不结算**：不写战绩账本、不发棋魂、不判成就
     * （用户 2026-10-13：「这个模式是没有棋魂奖励的」；三条一起跳过的理由见
     * `shouldRecordDuel` 的注释——成就与等级分都从这份账本现算，只跳发放照样会漏）。
     * 上面那句 `add(game.id)` 仍然要先做：这一局就此标记为"已处理"，
     * 刷新/恢复后不会因为它没记账而被当成幽灵局补记。
     */
    if (!shouldRecordDuel(game)) return;
    const entry: DuelHistoryEntry = {
      id: game.id, at: Date.now(), outcome: game.outcome, reason: aiGameEndReason.current || "",
      humanPlayer: game.humanPlayer, strength: game.strength, engine: game.engineChoice,
      timeLimitMs: game.timeLimitMs, thinkTimeMs: game.thinkTimeMs, thinkDepth: game.thinkDepth,
      moves: duelMoveList.length, humanElapsedMs: aiHumanElapsedMs, forbidden: game.forbiddenEnabled,
      recordId: aiGameSavedRef.current === document.id ? document.id : undefined,
    };
    if (appendDuelHistory(entry)) setDuelHistory(loadDuelHistory());
    // 棋魂（用户 10-09：棋魂不止来自成就）：**取胜**才给（和棋/输不给——它记的是
    // "做成了什么"）。token 带 game.id，所以「终局→刷新→恢复→再结算」不会重复入账；
    // 战胜大师档单独一档（赢一次 60，普通档 8）。
    //
    // 2026-10-10 起改走 `soulForDuelResult`：输/和也纳入**调度口径**（默认仍是 0，
    // 即严格等于用户原话"输了不给也不扣"；想改成"参与就给一点"，在工坊里调
    // `lossAmount` / `drawAmount` 即可，不用改这里）。给的数额为 0 时**不写流水**，
    // 免得账本里堆一堆 0 元记录（`grantSoul` 也会把 0 挡掉，这里是省一次调用）。
    const soulGain = soulForDuelResult(entry.outcome, entry.strength);
    if (soulGain > 0) {
      const masterWin = entry.strength === "大师";
      progress.earn({
        reason: "duel-win",
        amount: soulGain,
        detail: entry.outcome === "won"
          ? (masterWin ? "战胜大师档 AI" : `战胜 ${entry.strength} 档 AI`)
          : `${entry.outcome === "draw" ? "和棋" : "负局"}参与（按调度发放）`,
        token: `duel:${entry.id}`,
      });
    }
    // 成就：账本刚写完就判一次。`appendDuelHistory` 是同步写 localStorage 的，
    // 而判定也是同步读同一份存储，所以这里直接判就能看到这一局——
    // **不要**手工拼一份 duel 覆盖进去：那会把等级分等派生量抄错（账本才是唯一事实）。
    progress.check();
  }, [aiGame, duelMoveList, aiHumanElapsedMs, document.id]);
  /**
   * VCF 挑战解出一题 → 发棋魂（用户 2026-10-09：「接入 vcf 挑战试试，成功会加入棋魂……
   * 只有赢了会加，输了不加不扣」）。
   *
   * **定价在这里**（本页不自己定价，它只回报"赢了、几手"）：基础 6 点 + 手数加成
   * （题越深越值钱：`floor(depth/10) * 2`，10 手 +2、20 手 +4…封顶 +10），
   * 所以一道 20 手题 = 6+4 = 10 点。返回值交给结算弹窗显示。
   *
   * 幂等：token 用 `vcf:<题号>`。VCF 页面自己也有 scoredRef 保证一题只报一次，
   * 两道防线叠着——即使页面那边将来改坏，账本也不会被重复入账。
   */
  /**
   * 「点一下棋魂 +1」（用户 10-09 第十轮：「点一下这个棋魂（面板里面的），就会获得1个棋魂……
   * 这个点击是可以无限点击的，相当于免费的无尽能源」）。
   *
   * 三个要点：
   *  ① **silent: true** —— 不推顶部提示条。这个机制能一直点，若每次都推一条，
   *     队列会被塞满、提示条永远播不完（既挡视线又白耗渲染）。反馈改由面板内就地飘 +1 承担。
   *  ② **token 用单调序号** —— 每次点击都要真的入账（不能幂等去重掉），
   *     但 token 本身仍要有、且每次唯一，否则账本里一堆无 token 的条目不好审计。
   *  ③ 数额固定 1（用户点名「+1」），来源归到 `manual`（"手动调整"），
   *     这样它和"玩游戏挣来的"在流水里一眼可分。
   */
  const soulTapSeq = useRef(0);
  const handleSoulTap = useCallback((amount: number) => {
    soulTapSeq.current += 1;
    progress.earn({
      reason: "manual",
      amount,
      detail: "点了一下魂火",
      // token 必须每次唯一（否则第二次点击会被幂等去重掉、点不动）。
      token: `tap:${Date.now()}:${soulTapSeq.current}`,
      tokenRetention: "session",
      silent: true,
    });
    /**
     * 连点计数（用户 2026-10-10：「点击棋魂也算成就，1下，99下……9999下，都有不同的
     * 成就与奖励」）。
     *
     * 为什么**不**从账本里数 `manual` 条数：账本超上限会被折叠成 carry
     * （那些点击就永远数不到了，九档成就的后面几档会够不着），而且连点还受
     * `tapCountsAsEarned` 口径影响（那是"算不算钱"，与"点了多少下"无关）。
     * 所以走信号位里的独立只增计数。
     *
     * 每次点击都判一次成就：连点的手感就是"点着点着突然弹一个成就"，
     * 攒到面板打开时才判就完全没那个意思了。判定本身是幂等的、且很轻
     * （一次账本读 + 一次解释器跑），连点不会卡。
     */
    progress.countUp("tapCount");
  }, [progress]);

  const handleVcfSolved = useCallback((info: { problemId: string; depth: number; seconds: number; level: number; rating: number }) => {
    const amount = soulForVcfProblem(info.depth);
    progress.earn({
      reason: "vcf-solve",
      amount,
      detail: `VCF 挑战 ${info.depth} 手题`,
      // token 用题号：同一题重做（不计分的那条路径）不会再入账一次。
      token: `vcf:${info.problemId}`,
    });
    /**
     * **等级奖励**（用户 2026-10-10：「vcf挑战达到每个阶段等级都要给奖励，只给一次」）。
     *
     * ⚠ 这里**必须**走 `claimVcfLevelRewards`（水位线），不能再"从 1 级全查一遍
     * 靠 token 幂等挡掉" —— 那条路有个真漏洞：账本超过 1000 条会把最早的记录
     * 并成 `carry`，**被并掉的记录上的 `vcf-level:<n>` token 就永久丢了**，
     * 重启之后再解一题就会把已发的等级**全部重发一遍**
     * （实测：领过 1..11 级 665 魂 → 顶过上限 → 重启 → 又发 665）。
     *
     * 现在的口径：
     *  · 水位线存在 `banbu-vcf-level-paid-v1`，与账本裁剪无关；
     *  · `claimVcfLevelRewards` 在奖励成功入账后推进水位，失败的等级留待下次补发；
     *  · **跳级仍不漏发**（从 1 级直接到 5 级会把 2/3/4 一起补上）——
     *    这是水位线天然支持的：它记的是"发到第几级"，不是"发过哪几级"。
     */
    claimVcfLevelRewards(info.level, vcfLevelSoul, (reward) =>
      progress.earn({ reason: "vcf-solve", amount: reward.amount, detail: reward.detail, token: reward.token }));
    return amount;
  }, [progress]);

  // ── 每日一题（专门界面，2026-10-11）────────────────────────────────
  /**
   * 这一局的题目与文档。定位从 `dailySession` 来（而不是"当前选中的题"）：
   * 这一页可以在用户切去看别的棋谱之后再回来，题目不该跟着变。
   */
  const dailyLocation = dailySession
    ? locatePuzzleIn(puzzleCollections, dailySession.collectionId, dailySession.puzzleId)
    : null;
  /**
   * 每日一题的规则：**固定默认有禁手**，只作用于这一页（用户 2026-10-12：
   * 「不用切换有无禁，默认就有禁吧，但是不是全局生效，就这个生效」）。
   *
   * 所以走 `resolveDailyPuzzleRule`（内部默认 `"forbidden"`）而**不是**
   * `resolvePuzzleRule(..., puzzleRulePreference)` —— 后者会把「打谱 → 做题」那套
   * 用户偏好带进来（默认是无禁手），而内置题集一个都没声明规则，于是 66% 的黑先题
   * 会被当成无禁模式做。题目/题集显式声明的规则照旧优先（显式元数据压过默认值）。
   */
  const dailyRule = resolveDailyPuzzleRule(dailyLocation?.puzzle, dailyLocation?.collection);
  /**
   * 题目文档建在 `useMemo` 里、**以题目 id 为键**：页面自己也有"重来"，
   * 而重来只需要重读这份文档 —— 换个 key 会让它重建，同一道题则复用（省一次深拷贝）。
   */
  const dailyDocument = useMemo(() => {
    if (!dailyLocation) return null;
    const session = createPuzzleDocument(dailyLocation.puzzle, dailyRule.rule);
    return { ...session, puzzle: dailyLocation.puzzle, collection: dailyLocation.collection };
  }, [dailyLocation?.puzzle, dailyLocation?.collection, dailyRule.rule]);

  /**
   * 陪练应一手。
   *
   * 用**同一个 worker**（`puzzle-ai.worker` 的 `purpose: "puzzle"`）——
   * 那正是打谱里做题那条路在用的陪练，所以"陪练有多强"两处一致（不会出现
   * 每日一题里的陪练比工作区里的强/弱这种割裂）。
   *
   * 每局现起一个 worker、算完就 terminate：这一页一局最多几手，
   * 常驻一个 worker 反而要在"退出页面"时记得清理（漏了就是泄漏）。
   */
  const requestDailyReply = useCallback(async (replyBoard: Cell[][], player: Player): Promise<Position | null> => {
    const worker = new PuzzleAiWorker();
    try {
      return await new Promise<Position | null>((resolve) => {
        let settled = false;
        const finish = (move: Position | null) => { if (!settled) { settled = true; resolve(move); } };
        // 兜底：引擎没回（线程起不来/内存不足）也不能让页面永远停在"陪练思考中"。
        const timer = window.setTimeout(() => finish(null), 8000);
        worker.onmessage = (event: MessageEvent<{ result?: { move?: Position | null } }>) => {
          window.clearTimeout(timer);
          finish(event.data?.result?.move ?? null);
        };
        worker.onerror = () => { window.clearTimeout(timer); finish(null); };
        worker.postMessage({
          requestId: `daily-${Date.now()}`,
          board: replyBoard,
          player,
          rule: dailyRule.rule,
          purpose: "puzzle",
          timeMs: 900,
          maxDepth: 4,
        });
      });
    } catch {
      return null;
    } finally {
      worker.terminate();
    }
  }, [dailyRule.rule]);

  /**
   * 每日一题的终局结算。**与工作区那条路共用一份口径**（`planPuzzleSoul`）。
   *
   * 一条真实存在过的漏发在这里被修掉：`puzzle-solve`（"攻克一道题"）的说明写着
   * **"题库、生成器出的题都算"**，而实际上只有**生成器**那条路在发；
   * 从题库做题只发了 `daily`（而且仅限"今天那道"）。也就是"从题库攻克十道题、
   * 一块棋魂都没有，而说明页写着会给" —— 与 `daily` 那次（表里有、代码没有）
   * 是同一类。现在两个入口都走 `planPuzzleSoul`，不可能再各发各的。
   */
  const handleDailyFinished = useCallback((outcome: "won" | "lost", info: { moves: number; seconds: number }) => {
    if (!dailyDocument) return;
    const { puzzle, collection } = dailyDocument;
    const key = puzzleProgressKey(collection.id, puzzle.id);
    const today = localDateKey();
    const solved = outcome === "won";
    try {
      setPuzzleProgress((current) => {
        const next = {
          ...current,
          [key]: nextPuzzleProgressEntry(current[key], solved, true, new Date().toISOString()),
        };
        savePuzzleProgress(next);
        return next;
      });
      // 「今天这道完成了没有」——与对弈页显示的口径同源（`dailyDecision`）。
      const isTodaysDaily = Boolean(dailyDecision
        && dailyDecision.pick.puzzleId === puzzle.id
        && dailyDecision.pick.collectionId === collection.id);
      for (const grant of planPuzzleSoul({
        collectionId: collection.id,
        collectionTitle: collection.title,
        puzzleId: puzzle.id,
        puzzleTitle: puzzle.title,
        solved,
        isTodaysDaily,
        today,
        amountOf: soulAmount,
      })) {
        progress.earn({ reason: grant.reason, amount: grant.amount, detail: grant.detail, token: grant.token });
      }
      setDailyTraining((current) => recordPuzzleCompletion(current, { collectionId: collection.id, puzzleId: puzzle.id, solved, today }));
      // 覆盖层：管理区要显示"最近一次结果/用时"，与工作区那条路同一个口径。
      setPuzzleOverlays((current) => updatePuzzleOverlay(current, collection.id, puzzle.id, {
        lastResult: solved ? "won" : "lost",
        lastPlayedAt: new Date().toISOString(),
        ...(info.seconds > 0 ? { lastDurationMs: info.seconds * 1000 } : {}),
        mastered: false,
      }));
      // 成就：进度刚存盘就读回判定（同一份 localStorage，无时序问题）。
      progress.check();
    } catch {
      setToast("解题结果未能保存，请检查存储空间");
    }
  }, [dailyDocument, dailyDecision, progress]);

  /**
   * 清空人机战绩（**执行**那一步）。
   *
   * ⚠ 确认框与扣费**都不在这里**（2026-10-11 挪走了）：这曾经是个**免费**的清空按钮，
   * 而「设置 → 棋魂解锁」里同一件事是明码标价的一次性商品（`action-reset-duel-rating`，
   * 300 魂）—— 于是商店那件商品形同虚设。
   *
   * 现在这条路径的职责只剩"执行"：问价、确认、扣钱都在 `DuelStatsSheet` 里
   * （它离按钮最近，能就地显示价格与失败原因），扣成功才会调到这里。
   * 之所以分两处而不是全搬过去：战绩是 **App 持有的 state**，
   * 清完必须让 App 重新渲染等级分曲线（`setDuelHistory`），
   * 而这个 setter 只有 App 有。
   */
  const clearDuelStats = () => {
    clearDuelHistory();
    setDuelHistory([]);
    setToast("已清空本机战绩");
  };

  // 双栏（横屏时棋盘与功能区并排 + 右缘竖条导航）从 R109 起**恒开**，不再有「平板横屏双栏」开关
  // —— 用户 10-01：「横屏的时候，就默认启动这个模式，无论是浏览器还是手机，只要横屏都是这样」。
  // 类名留着是因为 CSS 里 61 处 `.split-layout-enabled` 选择器挂在它上面，改名等于重写两份样式表；
  // 真正的门槛在媒体查询里（那些规则全部限定 `@media (orientation:landscape)`），所以竖屏不受影响。
  // 走棋导航行（用户 10-04：双栏横屏要「放到棋盘下面、一屏显示」）。同一份元素按屏幕形态
  // 决定挂在哪：双栏挂在棋盘正下方，竖屏/窄横屏仍留在右栏原来的位置（DOM 顺序不变）。
  const movesBarElement = isPuzzleMode
    ? <ActionRailBar zone="moves" label="走棋导航" enabled={enhancementSettings.buttonOverflow === "scroll"}>{puzzleNavRow}</ActionRailBar>
    : actionLayout.moves.length > 0 && <ActionRailBar zone="moves" label="走棋导航" enabled={enhancementSettings.buttonOverflow === "scroll"}><div className="moves-row rail-scroll" aria-label="走棋导航" data-moves-labels={actionLayout.movesLabels && !actionLayout.iconsOnly ? "on" : "off"}>{actionLayout.moves.map((id) => renderWorkspaceAction(id, "moves"))}</div></ActionRailBar>;
  return <div className={`app-shell ${fontScaleClass(fontScale)} split-layout-enabled${landscapeViewport ? " landscape-viewport" : ""}${chromeCompact ? " chrome-compact" : ""}${chromeStatusHidden ? " chrome-collapsed" : ""}${chromeNavOff ? " chrome-nav-off" : ""}`} lang="zh-CN" data-theme-options={CONCRETE_THEME_IDS.join(" ")} data-ai-worker-state={aiWorkerController.current.snapshot.running ? "running" : "idle"} data-ai-request-id={aiWorkerController.current.snapshot.requestId || undefined} style={customAppStyle}>
      <ThemeScene theme={resolvedTheme} />
      {/* 雪落主题的飘雪装饰层（指针穿透，只 snow 主题显示） */}
      <div className="snow-layer" aria-hidden="true" data-testid="snow-layer"/>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <input ref={singleFileInput} type="file" hidden accept=".sgf,.fgf,.pos,.txt,.psq,.ren,.renjs,.wzq,.lib,.renju,.json,.db,.dp,.zip,*/*" onChange={(event) => { void handleFiles(event.target.files || undefined); event.target.value = ""; }}/>
    <input ref={puzzleFileInput} type="file" hidden accept=".json,.zip,application/json,application/zip" onChange={(event) => { const file = event.target.files?.[0]; void (file?.name.toLowerCase().endsWith(".zip") ? handleZipFile(file) : handlePuzzleFile(file)); event.target.value = ""; }}/>
    {/* accept 以 `image/*` 开头、不带扩展名 token：WebView 的 chooser 一旦看到 `.png/.jpg`
        这类非 MIME 项就按「文档」路径打开，而不是图片集合（用户 10-01：每次点进来都不在相册页）。
        保留 image/heic 字面量 —— 9 条门禁按 `accept*="image/heic"` 选这个元素。 */}
    <input ref={imageFileInput} type="file" hidden accept="image/*,image/heic,image/heif" onChange={(event) => { const picked = event.target.files?.[0]; if (picked) void rememberRecentImport(picked, "image"); beginBoardImageImport(picked); event.target.value = ""; }}/>
    <input ref={backupFileInput} type="file" hidden accept=".json,.zip,application/json,application/zip" onChange={(event) => { void handleBackupFile(event.target.files?.[0]); event.target.value = ""; }}/>
    <input ref={backgroundFileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/*" onChange={(event) => { handleBackgroundImage(event.target.files?.[0]); event.target.value = ""; }}/>
    <header className={`topbar${tab === "record" ? " record-topbar" : ""}${tab === "duel" && generatorOpen ? " generator-topbar" : ""}`}><div className="topbar-left"><div className="brand"><button type="button" className={`brand-trigger${latestUpdate ? " has-update" : ""}`} onClick={() => setQuickDrawerOpen(true)} aria-label={latestUpdate ? "打开快捷中心（有新版本）" : "打开快捷中心"} aria-expanded={quickDrawerOpen} aria-controls="quick-drawer"><img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true"/>{latestUpdate && <span className="update-dot" aria-hidden="true"/>}{tab === "record" && <span className="brand-hint">快捷中心</span>}</button>{tab !== "record" && <div><b>半步五子棋打谱</b><small>本地棋谱研究工具</small></div>}</div>{enhancementSettings.chromeCollapseToggle && <button type="button" className="chrome-collapse-toggle" data-chrome-level={chromeLevel} onClick={() => setChromeLevel(level => (level + 1) % 4)} aria-expanded={chromeLevel === 0} aria-label={CHROME_LEVEL_LABELS[chromeLevel]} title={CHROME_LEVEL_LABELS[chromeLevel]}>{chromeLevel === 0 ? <ChevronUp size={17} aria-hidden="true"/> : chromeLevel === 1 ? <ChevronDown size={17} aria-hidden="true"/> : chromeLevel === 2 ? <ChevronsDown size={17} aria-hidden="true"/> : <TripleChevronDown size={17}/>}</button>}</div>{/* 顶栏左组 .topbar-left（用户 10-07 定稿）：「快捷中心」在前、折叠按钮在后（右邻，gap 7px）。
        快捷中心那段文字现在**在 .brand-trigger 按钮里面**（原来在按钮外面）：折叠成紧凑条时
        图标一收，文字自己就是可点的文字按钮；展开态图标+文字叠着看，与旧外观一致。
        折叠按钮四档都停在快捷中心右边（用户 10-07 二次口径：「折叠后这个按钮不再变到左边」）；
        每点一次进一档、图标跟着换（收起 → 一道 → 两道 → 三道下箭头），第四档再点回到未折叠，
        每档收起什么见 .chrome-compact / .chrome-collapsed / .chrome-nav-off 三组 CSS。
        竖屏也能用（不再限 landscapeViewport）。按钮本身是「可选增强功能 → 顶栏折叠开关」，
        关闭时不渲染，已折叠的界面由上方 effect 自动展开。 */}
      {tab === "record" && <div className="topbar-mode-toggle" role="tablist" aria-label="工作模式"><button type="button" role="tab" aria-selected={mode === "record"} className={mode === "record" ? "selected" : ""} onClick={() => switchMode("record")} aria-label="打谱模式"><PenTool aria-hidden="true"/><span>打谱</span></button><button type="button" role="tab" aria-selected={mode === "review"} className={mode === "review" ? "selected" : ""} onClick={() => switchMode("review")} aria-label="读谱模式"><BookOpen aria-hidden="true"/><span>读谱</span></button><button type="button" role="tab" aria-selected={mode === "puzzle"} className={mode === "puzzle" ? "selected" : ""} onClick={() => switchMode("puzzle")} aria-label="做题模式"><PuzzleIcon aria-hidden="true"/><span>做题</span></button></div>}<div className="top-actions">{tab === "duel" && generatorOpen ? null : tab === "record" ? <><button className="icon-button" onClick={openExportSheet} aria-label="打开导出方式"><Upload size={20}/></button><button className={`icon-button save-action${mode === "review" ? " review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : openSaveDialog} aria-label={mode === "review" ? "读谱模式无法保存棋谱" : "保存棋谱"}><Save size={20}/></button></> : <><button className="icon-button" onClick={openImportSheet} aria-label="打开导入方式"><Download size={20}/></button><button className="icon-button" onClick={openExportSheet} aria-label="打开导出方式"><Upload size={20}/></button><button className={`icon-button save-action${mode === "review" ? " review-blocked" : ""}`} onClick={mode === "review" ? reviewBlocked : openSaveDialog} aria-label={mode === "review" ? "读谱模式无法保存棋谱" : "保存棋谱"}><Save size={20}/></button></>}</div>{/* 折叠按钮已挪进顶栏左组 .topbar-left（最前一段），这里不再重复渲染。 */}
      </header>
    <QuickDrawer
      onOpenLayout={openLayoutEditor}
      suspended={layoutEditorOpen}
      onNotice={setToast}
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
      onThemePreferenceChange={(value) => { if (isThemePreference(value)) { setThemePreference(value); progress.signal({ themes: [value] }); } }}
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
      enginePackReady={strongEngineReady}
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
      boardMargin={boardMargin}
      onBoardMarginChange={setBoardMargin}
      stoneSize={stoneSize}
      onStoneSizeChange={setStoneSize}
      // 透明度两条（用户 2026-10-10 要求在快捷中心也放）
      boardOpacity={boardOpacity}
      onBoardOpacityChange={setBoardOpacity}
      stoneOpacity={stoneOpacity}
      onStoneOpacityChange={setStoneOpacity}
      // 外观锁：未购买的项在下拉里带锁与价格，点了提示购买
      themeLockCost={themeLockCost}
      boardLockCost={boardLockCost}
      stoneLockCost={stoneLockCost}
      onLockedAppearancePick={onLockedAppearancePick}
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
      onOpenAbout={openAboutMain}
    />
     {layoutEditorOpen && <ActionLayoutEditor value={actionLayouts} mode={mode} onApply={applyActionLayout} actionOpacity={actionOpacity} onActionOpacityChange={setActionOpacity} onClose={() => setLayoutEditorOpen(false)}/>}
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
        />
         {tab === "record" && aiGame && <div className="duel-in-record-notice" role="status" data-duel-in-record>
            <span>人机对局进行中 · 第 {duelMoveList.length} 手{aiThinking ? " · AI 正在算" : aiGame.outcome ? " · 已结束" : aiHumanTurn ? " · 轮到你" : ""}</span>
            <button type="button" onClick={() => setTab("duel")} data-duel-back-to-screen>回对弈界面</button>
          </div>}
         {openingBannerElement}
          {boardElement}
          {/* 双栏横屏：走棋区挂在棋盘正下方，一屏内够得着（用户 10-04）。 */}
          {wideSplitViewport && movesBarElement}
          <div className="record-rail">
          <div className="action-layout-workspace" data-action-size={actionLayout.size} data-icons-only={actionLayout.iconsOnly}>
          {/* 手数滑轨（用户 09-17 第二批③；09-23 改版）：横向条放在棋盘下方、首行功能区之上。
              当前手数走与状态条同一个口径（move/passPlayer 都算一手），总数取主线长度，
              否则滑块位置会和「第 N 手 / 共 M 手」对不上。
              10-04 挪进右栏首位：原先它是 .record-page 的直接子元素、又没有任何网格定位，
              双栏时被自动排布丢到棋盘底下（用户报「滑条在横屏下看不太到」）；挪进来之后
              竖屏仍是紧跟棋盘（视觉不变），双栏则落在首行功能区之上。 */}
          {enhancementSettings.moveRail && !isPuzzleMode && <BoardMoveRail total={mainLineLength(viewDocument)} current={depthOf(viewDocument, currentId)} onSeek={stableRailSeek}/>}
          {/* 做题的状态文字 + 黑白切换在首行功能区之上（用户 09-10）；常驻操作区做题默认为空。 */}
          {isPuzzleMode && !compactPuzzleHeader && puzzleStatusRow(puzzleStatusCopy)}
          {actionLayout.bottom.length > 0 && <ActionRailBar zone="bottom" label="首行功能区" enabled={enhancementSettings.buttonOverflow === "scroll"}><nav className="dock-tabs action-bottom-row rail-scroll" aria-label="首行功能区">{actionLayout.bottom.map((id) => renderWorkspaceAction(id, "bottom"))}</nav></ActionRailBar>}
          {/* 注释框挪到首行功能区下面一行（用户 10-03：「点开后出现在首行功能区的下面一行，
              就是中间功能区的上面」）。原先它排在走棋行与子功能区**之后**，也就是整块最底：
              手机竖屏点开「注释框」常要往下滚才看得见，正是群友说"看不到"的那个框。 */}
          {commentPreview}
          {renderTopRow(actionLayout.top)}
        {/* 走棋区的具体内容由 movesBarElement 决定；双栏横屏时它渲染在棋盘正下方，这里不重复挂。 */}
        {!wideSplitViewport && movesBarElement}
        {dockPanel && <section className="context-dock action-subpanels" aria-label="子功能区">
          <div className="action-tool-panel">{workspaceDockPanel}</div>
        </section>}
          </div>
          </div>
      </div>}

      {/* 对局进行中就待在这个界面（用户 09-28：「进入人机对弈后，是进入专门的对弈界面，
          而不是打谱界面」，且这个界面不含打谱 / 读谱 / 做题入口）。 */}
      {tab === "duel" && generatorOpen && <Suspense fallback={<div className="page-padding" role="status">正在打开棋题生成器…</div>}><PuzzleGeneratorPage
        saved={generatedPuzzles} initialPuzzle={generatorInitial} appVisible={appVisible}
        onBack={() => { setGeneratorOpen(false); setGeneratorInitial(null); }}
        onSave={saveGeneratedPuzzles}
        puzzleFolders={libraryFolders.puzzleFolders}
        onSaveImage={async (file) => { await saveBoardShareFile(file); }}
        onNotice={setToast}
        onExport={puzzles => downloadFile(exportPuzzleCollectionJson(generatedCollection(puzzles, 'generated-export', '棋题生成器 · VCF')), '棋题生成器-VCF.json', 'application/json')}
        onSolved={puzzle => {
          const collection = puzzleCollections.find(item => item.puzzles.some(p => p.generated?.id === puzzle.id));
          if (!collection) return;
          const key = puzzleProgressKey(collection.id, puzzle.id);
          try {
            const next = { ...puzzleProgress, [key]: { solved: true, attempts: (puzzleProgress[key]?.attempts || 0) + 1, updatedAt: new Date().toISOString() } };
            savePuzzleProgress(next); setPuzzleProgress(next);
            // 棋魂：攻克一题（token 用题号——同一题重复做对不再给第二份）。
            progress.earn({
              reason: "puzzle-solve",
              // ⚠ 数额**从来源表读**（`soulAmount`），不写数字：写死的话工坊里调了价，
              // 说明页变了、实际发放没变（2026-10-11 修的真 bug）。
              amount: soulAmount("puzzle-solve"),
              detail: `攻克《${collection.title}》${puzzle.title}`,
              token: `puzzle:${key}`,
            });
            // 成就：进度刚存盘就读回判定（同一份 localStorage，无时序问题）。
            // 生成器出的题走的是同一个 onSolved，一视同仁算「攻克」。
            progress.check();
          } catch { setToast('解题成功，但进度未能保存，请检查存储空间'); }
        }}
      /></Suspense>}
      {tab === "duel" && !generatorOpen && !vcfChallengeOpen && aiGame && <GameScreen
        // 规则名里常常已经带「无禁手 / 有禁手」（如「自由·无禁手」），只在没带时才补，
        // 否则标题会念成「无禁手 · 无禁手 · 第 3 手」。
        // 自定义开局在摆子阶段还不算"第几手"（那是局面，不是对局进程），所以这里换成
        // 「摆子中 · N 子」；开始之后照旧按手数走。
        titleText={duelSetupPhase ? `${duelRuleLabel} · ${aiGame.forbiddenEnabled ? "有禁手" : "无禁手"} · 摆子中 · ${duelMoveList.length} 子` : `${duelRuleLabel}${/禁手/.test(duelRuleLabel) ? "" : ` · ${aiGame.forbiddenEnabled ? "有禁手" : "无禁手"}`} · 第 ${duelMoveList.length} 手${aiGame.outcome ? " · 已结束" : ""}`}
        me={{
          name: "我",
          player: aiGame.humanPlayer,
          detail: `${aiGame.timeLimitMs ? `包干 ${formatTimeLimitLabel(aiGame.timeLimitMs)}` : "不限时"}${aiGame.readOffMs ? ` + ${aiGame.readOffMs / 1000} 秒读秒` : ""}`,
          active: !aiGame.outcome && aiHumanTurn,
          // 数字要说清是什么：读秒制式下是本手剩余，包干制式下是剩余，不限时才是累计用时。
          timeText: aiGame.readOffMs ? `本手 ${formatGameClock(Math.max(0, aiGame.readOffMs - aiMoveElapsedMs))}`
            : aiGame.timeLimitMs ? `剩余 ${formatGameClock(Math.max(0, aiGame.timeLimitMs - aiHumanElapsedMs))}`
            : `用时 ${formatGameClock(aiHumanElapsedMs)}`,
          thinking: false,
        }}
        opponent={{
          name: "半步 AI",
          player: aiGame.aiPlayer,
          detail: `${aiGame.strength} · ${aiGame.unlimitedThinking ? "不限时思考" : `每手 ${(aiGame.thinkTimeMs / 1000).toFixed(1)} 秒`}`,
          active: !aiGame.outcome && !aiHumanTurn,
          // 对手那一格不放走动的钟：人机对局 AI 不占钟，思考时显示「思考中」。
          timeText: null,
          thinking: aiThinking,
        }}
        meta={duelMetaChips}
        engineText={duelEngineText}
        board={boardElement}
        openingReveal={enhancementSettings.openingNameHint ? <OpeningReveal name={duelOpening?.name ?? null} code={duelOpening?.code} family={duelOpening?.family} epoch={duelOpeningEpoch}/> : null}
        openingBanner={openingBannerElement}
        recent={duelRecentMoves}
        setupPhase={duelSetupPhase}
        setupActions={duelSetupPhase ? duelSetupActionsElement : undefined}
        canUndo={Boolean((!aiGame.outcome || duelIsCustom) && !aiThinking && current.parentId && !duelUndoLocked)}
        undoTitle={duelUndoTitle}
        // ‹ › 只在终局后当「回看」用：对局进行中 goPrev 的语义是悔棋（用户 09-13 定案），
        // 把它画成浏览按钮会让人误以为在翻看，实际却退掉了两手棋。
        canPrev={Boolean(aiGame.outcome && current.parentId)}
        canNext={Boolean(aiGame.outcome && current.children.length)}
        atLivePosition={currentId === recordSession.current.currentId}
        result={duelResultInfo}
        onPrev={goPrev}
        onNext={goNext}
        onBackToLive={goPreferredEnd}
        onUndo={() => { takeDuelUndo(); }}
        // 自定义开局：终局面板里也给一颗「悔棋继续下」（面板是模态的，盖住了下面那条操作条）
        onUndoAfterEnd={duelIsCustom ? () => { takeDuelUndo(); } : undefined}
        onResign={resignAiGame}
        onRestart={beginAiGame}
        onSave={() => { if (commitAiGameRecord()) setToast("本局已存入棋谱库"); }}
        onReview={openReviewStable}
        onClose={closeDuelScreen}
        onNewGame={beginAiGame}
        onOpenStats={() => setSheet("duelStats")}
        onOpenAchievements={() => setSheet("achievements")}
      />}
      {tab === "duel" && !generatorOpen && !aiGame && !vcfChallengeOpen && !dailyOpen && <DuelPage
        daily={dailyPuzzle ? { title: dailyPuzzle.puzzle.title, collectionTitle: dailyPuzzle.collection.title, reason: dailyDecision?.reason || "fresh", solved: dailyCheckedIn } : null}
        aiGameRunning={false}
        onStartAiGame={openAiGameSheet}
        onStartDaily={startDailyPuzzle}
        onOpenClock={() => setClockOpen(true)}
        onOpenStats={() => setSheet("duelStats")}
        onOpenAchievements={() => setSheet("achievements")}
        soul={progress.balance}
        onOpenSoul={() => setSheet("soul")}
        shopRemaining={shopRemaining}
        onOpenShop={() => setSheet("shop")}
        onOpenGenerator={() => { cancelActiveAiComputation('record-switch'); setDockPanel(null); setGeneratorInitial(null); setGeneratorOpen(true); }}
        onStartVcfChallenge={() => setVcfChallengeOpen(true)}
      />}
      {/* VCF 挑战：切到别的 tab 也**保持挂载**，只把整块隐藏（用户 2026-10-06：切版面再
          回来时题目/局面/计时都还得在）。display:none 下 interval 照跑——切 tab 不是退出这一局。 */}
      {vcfChallengeOpen && (
        <div className="duel-subview" hidden={tab !== "duel"} data-duel-subview="vcf">
          {/* 挑战盘的几何/坐标跟着打谱那几个显示设置走（用户 10-08：「跟着打谱的设置走」）：
              棋盘侧边、坐标字号、棋子大小、坐标开关四项。 */}
          <Suspense fallback={<div className="page-padding" role="status">正在打开 VCF 挑战…</div>}><VcfChallengePage exitRequest={vcfExitRequest} onExit={() => setVcfChallengeOpen(false)} boardTheme={boardTheme} stoneTheme={stoneTheme} boardMargin={boardMargin} coordinateFontSize={coordinateFontSize} stoneScale={stoneSize} showCoordinates={showCoordinates} placementConfirm={placementConfirm} onSolved={handleVcfSolved} /></Suspense>
        </div>
      )}
      {/* 每日一题：**专门界面**（用户 2026-10-11）。与 VCF 挑战同一条挂载策略
          （切 tab 只隐藏、保持挂载）：一局做到一半去看别的棋谱，回来局面还在。 */}
      {dailyOpen && dailyDocument && (
        <div className="duel-subview" hidden={tab !== "duel"} data-duel-subview="daily">
          {/* 棋盘/坐标/棋子大小跟着打谱那几个显示设置走 —— 与挑战页同一套口径。 */}
          <Suspense fallback={<div className="page-padding" role="status">正在打开每日一题…</div>}>
            <DailyPuzzlePage
              placementConfirm={placementConfirm}
              exitRequest={dailyExitRequest}
              onExit={() => setDailyOpen(false)}
              title={dailyDocument.puzzle.title}
              collectionTitle={dailyDocument.collection.title}
              prompt={dailyDocument.puzzle.prompt}
              difficulty={dailyDocument.puzzle.difficulty}
              boardSize={dailyDocument.puzzle.boardSize || 15}
              human={dailyDocument.puzzle.player}
              document={dailyDocument.document}
              initialNodeId={dailyDocument.initialNodeId}
              rule={dailyRule.rule}
              // ⚠ 用**页面刚给的那张盘面**（`board`）判禁手，不能用开局盘面闭包 ——
              // 禁手是"落这一子之后"的性质，跟盘上已有的子直接相关（见 props 注释）。
              checkMove={(board, position, player) => puzzleMoveLegality(board, position, player, dailyRule.mode).reason}
              alreadyDone={dailyCheckedIn}
              requestReply={requestDailyReply}
              onFinished={handleDailyFinished}
              boardTheme={boardTheme}
              stoneTheme={stoneTheme}
              boardMargin={boardMargin}
              coordinateFontSize={coordinateFontSize}
              stoneScale={stoneSize}
              showCoordinates={showCoordinates}
            />
          </Suspense>
        </div>
      )}
      {tab === "library" && <div className="library-page page-padding">
        <div className="library-segment" role="tablist"><button className={librarySection === "records" ? "active" : ""} onClick={() => { setLibrarySection("records"); setExpandedLibraryFolders(new Set([libraryFolders.recordFolders[0] || ""])); }} role="tab">棋谱 <small>{library.length + largeSummaries.length}</small></button><button className={librarySection === "puzzles" ? "active" : ""} onClick={() => { setLibrarySection("puzzles"); setExpandedLibraryFolders(new Set([libraryFolders.puzzleFolders[0] || ""])); }} role="tab" data-library-tab="puzzles">题库 <small>{puzzleCollections.length}</small></button>{enhancementSettings.libraryOnlineEntry && <button className={librarySection === "online" ? "active" : ""} onClick={() => setLibrarySection("online")} role="tab" data-library-tab="online"><Globe size={13}/>在线</button>}</div>
        {librarySection !== "online" && <label className="library-search"><Search size={17}/><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={librarySection === "records" ? "搜索棋谱名、棋手或主题" : "搜索题库、题目或题面"}/><button type="button" onClick={() => setLibraryQuery("")} aria-label="清除搜索"><X size={15}/></button></label>}
        {librarySection === "online" && <OnlineLibraryPanel onImport={importOnlineRecords} onOpenSettings={() => { setSheet(null); setTab("settings"); }}/>}
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
         </> : librarySection === "puzzles" ? <>
           <RecentPuzzleSection items={recentPuzzles} onOpen={(item: RecentPuzzleItem) => guardedOpenPuzzle(item.collectionIndex, item.puzzleIndex)} />
           <div className="library-shortcuts" aria-label="题库快捷入口"><button onClick={() => setSheet("wrongbook")} title="尝试过但尚未攻克的题目"><Layers3/>错题本</button><button onClick={openPuzzleImportPicker} title="导入 puzzles 题库 JSON"><Download/>导入题库</button><button onClick={() => createLibraryFolder("puzzles")} title="自由整理题集"><FolderPlus/>新建文件夹</button><button onClick={() => setSheet("puzzleFavorites")} title="收藏的题集"><Star/>收藏</button><button onClick={() => setSheet("dataSafety")} title="完整备份与恢复"><ArchiveRestore/>资料安全</button><button className="recycle-bin-entry" onClick={() => setSheet("trash")} aria-label="回收站" title="删除的内容可恢复或彻底清理"><Recycle/>回收站</button><button aria-label="批量处理" className={puzzleBatchMode ? "batch-active" : ""} onClick={() => { setPuzzleBatchMode((active) => !active); setPuzzleBatchSelectedIds([]); }}><ClipboardList/>{puzzleBatchMode ? "退出批量" : "批量编辑"}</button><button onClick={() => setSheet("puzzleManage")} title="隐藏的题集恢复、做题进度重置"><Settings2/>题库管理</button></div>
          {puzzleBatchMode && <div className="batch-selection-bar" role="status" aria-live="polite"><span>已选择 {puzzleBatchSelectedIds.length} 个题集</span><button type="button" onClick={selectAllPuzzleBatch}>全选</button><button type="button" onClick={clearPuzzleBatchSelection}>取消全选</button><button type="button" disabled={!puzzleBatchSelectedIds.length} onClick={() => { setFolderSheetMode("batch-move"); setFolderCreationSection("puzzles"); setFolderCreationParent(libraryFolders.puzzleFolders[0] || ""); setSheet("folder"); }}>移动</button><button type="button" disabled={puzzleBatchSelectedIds.length < 2} onClick={() => { setPuzzleMergeDedupe(true); setPuzzleMergeOpen(true); setSheet("puzzleEdit"); }} title="把选中的题集合并成一个（可去掉重复题）">合并</button><button type="button" className="batch-delete-action" disabled={!puzzleBatchSelectedIds.length} onClick={deletePuzzleBatchSelection}>删除</button><button type="button" onClick={closePuzzleBatch}>退出</button></div>}
          <div className="folder-library-list">{folderChildren(libraryFolders.puzzleFolders, "").map(renderPuzzleFolder)}</div>
        </> : null}
      </div>}

      {tab === "settings" && <SettingsPage
        speechAvailable={speechAvailable}
        speechEnabled={speechEnabled}
        speechRate={speechRate}
        onSpeechEnabledChange={(value) => { setSpeechEnabled(value); if (!value) stopSpeaking(); }}
        onSpeechRateChange={(value) => setSpeechRate(value as SpeechRate)}
        onOpenLayout={openLayoutEditor}
        onNotice={setToast}
        onOpenOnlineLibrary={openOnlineLibrary}
          onlineProxy={onlineProxy}
        onOnlineProxyChange={updateOnlineProxy}
        aiVision={aiVision}
        onAiVisionChange={updateAiVision}
        aiEngineChoice={aiEngineChoice}
        enginePackReady={strongEngineReady}
        nativeEngineReady={nativeEngineReady}
        kataEngineReady={kataEngineReady}
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
        customUiTheme={customUiTheme}
        onCustomUiThemeChange={setCustomUiTheme}
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
        // 外观预览：点锁着的卡先看着（不落盘），不买就回到原样
        onPreviewAppearance={previewAppearance}
        onPreviewEnd={endPreview}
        // 棋魂一次性动作改过数据之后，App 要重读自己那份 state（见 SettingsPage 的 props 注释）
        onDataReset={(what) => { if (what === "duel") setDuelHistory(loadDuelHistory()); }}
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
        boardMargin={boardMargin}
        stoneSize={stoneSize}
        onStoneSizeChange={setStoneSize}
         motionEnabled={motionEnabled}
         themeMotion={themeMotion}
         onThemeMotionChange={setThemeMotion}
         motionEffects={motionEffects}
         onMotionEffectsChange={setMotionEffects}
         restoreLastPosition={restoreLastPosition}
        onShowNumbersChange={setShowNumbers}
        onShowCoordinatesChange={setShowCoordinates}
        onShowLastMoveChange={setShowLastMove}
        onMoveNumberScaleChange={setMoveNumberScale}
        onGridLineWidthChange={setGridLineWidth}
        onCoordinateFontSizeChange={setCoordinateFontSize}
        onBoardMarginChange={setBoardMargin}
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
        onOpenVault={() => setSheet("vault")}
        onOpenHelp={() => setSheet("help")}
        onOpenAbout={openAboutMain}
        onOpenManual={() => setSheet("manual")}
        onOpenTour={() => { setTab("record"); setTourOpen(true); }}
        onOpenFeedback={() => setSheet("feedback")}
        enhancementSettings={enhancementSettings}
        onEnhancementSettingsChange={changeEnhancementSettings}
        placementConfirm={placementConfirm}
        onPlacementConfirmChange={(value) => { setPlacementConfirm(value); savePlacementConfirm(value); }}
        updateAutoCheck={updateAutoCheck}
        onUpdateAutoCheckChange={changeUpdateAutoCheck}
      />}
      </main>

      {clockOpen && <DuelClockPanel
        initialSettings={clockSettings}
        onSettingsChange={(next) => { setClockSettings(next); saveClockSettings(next); }}
        onExit={() => setClockOpen(false)}
        onPressSound={(side) => playSound(side === "black" ? "move-black" : "move-white")}
        onTickSound={() => playSound("warning")}
        onFlagSound={() => playSound("error")}
      />}
    <nav className="bottom-nav" aria-label="主导航"><button aria-current={tab === "record" ? "page" : undefined} className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}><Home/><span>{mode === "puzzle" ? "做题" : "打谱"}</span></button><button aria-current={tab === "library" ? "page" : undefined} className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library/><span>棋谱库</span></button><button className="nav-center" onClick={openImportSheet}><Download/><span>导入</span></button><button aria-current={tab === "duel" ? "page" : undefined} className={tab === "duel" || aiGame ? "active" : ""} onClick={() => setTab("duel")}><Bot/><span>对弈</span></button><button aria-current={tab === "settings" ? "page" : undefined} className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings/><span>设置</span></button></nav>
      {importProgress && <ImportProgressCard state={importProgress}/>}
       {enhancementSettings.coachMarks && coachMark && <CoachMark id={coachMark} onAction={handleCoachMarkAction}/>}
     <AppToast message={toast} onClose={() => setToast("")}/>
     {/* 成就解锁弹窗（用户 10-09：要专门弹窗 + 动效 + 不影响操作）。它没有遮罩、
         只占顶栏下方一条，下面照常落子；停留数秒自动滑走。 */}
     {/* 奖励弹窗的两个总开关（用户 2026-10-11）：关掉只是不弹，
         解锁与入账照常发生（那是 useProgress 的事，与这里无关）。 */}
     <ProgressRewardQueue queue={progress.queue} onDrained={progress.drain} showAchievements={enhancementSettings.achievementPopup} showSoul={enhancementSettings.soulPopup}/>

     {/* 首运行欢迎卡只有三个出口（新手引导 / 手册 / 先自己试试）——
         用户 2026-10-11 明确要求把"导入凭证"从这里去掉：那是装过的人才会用的，属设置里的固定位置。 */}
     {welcomeOpen && <FirstRunWelcome onDismiss={dismissFirstRunWelcome} onOpenManual={openManualFromFirstRun} onStartTour={startFirstRunTour} onOpenReleaseNotes={openReleaseNotesFromFirstRun}/>}
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

      {/* 「载入」（用户 2026-10-14 两轮口径：「不是打开文件管理器去找棋谱，而是打开自己的
          棋谱库，在这些文件夹里面找棋谱、习题什么的」＋「不应该是展开往下，而是出现弹窗
          界面，里面是我们的棋谱与题库」）：**一个弹窗**，顶上两栏切「棋谱库 / 题库」，
          栏里就是那两个现成选择器的内容（`embedded` 模式：不自己再套一层浮层、不画返回键）。
          少一次"先选来源再进去找"的往下钻；文件夹树、搜索与本机棋谱库页/做题页完全一致。 */}
      {duelLoad !== "off" && <BottomSheet title="载入局面" manageHistory onClose={() => setDuelLoad("off")}><div className="duel-load-sheet">
        <div className="duel-load-tabs" role="tablist" aria-label="载入来源">
          <button type="button" role="tab" aria-selected={duelLoad === "record"} className={duelLoad === "record" ? "selected" : ""} data-duel-load-records onClick={() => setDuelLoad("record")}>棋谱库 <b>{library.length}</b></button>
          <button type="button" role="tab" aria-selected={duelLoad === "puzzle"} className={duelLoad === "puzzle" ? "selected" : ""} data-duel-load-puzzles onClick={() => setDuelLoad("puzzle")}>题库 <b>{puzzleCollections.length}</b></button>
        </div>
        <p className="helper">挑一份当开局：载入后分支照常在盘上显示，用 ‹ › 或点棋盘上的分支点选一条路线，点「开始对局」时只留那一条线。</p>
        {duelLoad === "record" ? <RecordSelectorSheet
          embedded
          records={library}
          largeRecords={largeSummaries}
          currentId={document.id}
          folders={libraryFolders.recordFolders}
          assignments={libraryFolders.recordAssignments}
          onSelectRecord={loadDuelSetupFromRecord}
          onSelectLargeRecord={loadDuelSetupFromLargeRecord}
          onClose={() => setDuelLoad("off")}
        /> : <PuzzleSelectorSheet
          embedded
          collections={puzzleCollections}
          progress={puzzleProgress}
          currentCollectionIndex={puzzleCollectionIndex}
          currentPuzzleIndex={puzzleIndex}
          folders={libraryFolders.puzzleFolders}
          assignments={libraryFolders.puzzleAssignments}
          onSelect={loadDuelSetupFromPuzzle}
          onClose={() => setDuelLoad("off")}
        />}
      </div></BottomSheet>}
     {flattenChoice && flattenPromptOpen && <BottomSheet appearance="decision" title="这份改动会覆盖带手序的原谱" className="flatten-guard-backdrop" manageHistory onClose={() => setFlattenPromptOpen(false)}><div className="sheet-body"><p className="section-note">刚才的「去子 / 位移」把这份棋谱转成了<strong>无手序的静态局面</strong>（这一步本身不可撤销）。棋谱库里那份还带着落子顺序与分支，目前<strong>还没被改写</strong>——先决定怎么处理，再退出。</p><button className="primary-button" onClick={resolveFlattenCopy}><Copy/>新建修改副本（原谱保持不变）</button><button className="secondary-button" onClick={resolveFlattenOverwrite}><Save/>覆盖棋谱（原谱的手序将丢失）</button><button className="secondary-button" onClick={resolveFlattenDiscard}><X/>放弃这次改动</button><button className="secondary-button" onClick={() => setFlattenPromptOpen(false)}>以后再决定（先不落盘）</button><p className="mark-studio-note">「以后再决定」期间这份改动只留在内存里：棋谱库不会被写，关掉应用也会丢。</p></div></BottomSheet>}
     {pendingSwitch && <BottomSheet appearance="decision" title="有未保存草稿" className="draft-guard-backdrop" manageHistory onClose={() => setPendingSwitch(null)}><div className="sheet-body"><p className="section-note">继续当前操作前请先处理当前未保存的草稿，否则将丢失。</p><button className="primary-button" onClick={savePendingSwitch}><Save/>保存草稿并切换</button><button className="secondary-button" onClick={() => { const action = pendingSwitch; setPendingSwitch(null); createModificationCopyHere(); action?.(); setToast("已另存为「修改副本」并切换，原谱保持不变"); }}><Copy/>创建修改副本并切换</button><button className="secondary-button" onClick={discardPendingSwitch}><X/>放弃草稿并切换</button><button className="secondary-button" onClick={() => setPendingSwitch(null)}>取消</button></div></BottomSheet>}
      {updatePrompt && <BottomSheet appearance="decision" title="发现新版本" manageHistory onClose={dismissUpdatePrompt}><div className="sheet-body update-prompt-sheet">
        <div className="update-prompt-versions"><span><b>v{APP_VERSION}</b><small>当前版本</small></span><ArrowRight size={18} aria-hidden="true"/><span className="to"><b>v{updatePrompt.version}</b><small>最新版本{updatePrompt.publishedAt ? ` · ${updatePrompt.publishedAt.slice(0, 10)}` : ""}</small></span></div>
        <p className="section-note">覆盖安装即可，本地棋谱、题库与设置数据不受影响。现在不方便的话，之后也可以在「设置 → 关于」里随时再次检查。</p>
        <UpdateDownloadLinks
          release={updatePrompt}
          onDownload={() => { void downloadUpdateApk(updatePrompt); }}
          progressText={updateDownload?.text}
          disabled={Boolean(updateDownload)}
          canInstallDirectly={supportsNativeApkInstall()}
        />
        {updateDownload
          ? <button className="secondary-button" onClick={cancelUpdateDownload}>取消下载</button>
          : <button className="secondary-button" onClick={dismissUpdatePrompt}>以后再说</button>}
      </div></BottomSheet>}

    {radialMenu && (() => {
      // 按下点上是否有"当前路径里的一手"——决定「跳到此手」能不能用。
      const stoneNode = [...pathToNode(viewDocument, currentId)].reverse()
        .find((node) => node.move && node.move.row === radialMenu.position.row && node.move.col === radialMenu.position.col);
      // 书签开关读的是"按下的这一手"在不在书签里 → 菜单标签跟着变（加书签 / 取消书签）。
      const bookmarked = Boolean(stoneNode && activeBookmarks.some((bookmark) => bookmark.nodeId === stoneNode.id));
      const page = radialMenu.page;
      const recordEditable = mode === "record" && !aiGame && !isPuzzleMode;
      const items = buildRadialMenuItems({
        canErase: mode === "record",
        canBookmark: mode === "record" && Boolean(stoneNode),
        bookmarkActive: bookmarked,
        canJump: Boolean(stoneNode && stoneNode.id !== currentId),
        canEvaluate: recordEditable && Boolean(stoneNode),
        evaluation: stoneNode?.evaluation || "",
        canSetMain: recordEditable && Boolean(stoneNode?.parentId),
        canCopyBranch: recordEditable && Boolean(stoneNode),
        canPasteBranch: recordEditable && Boolean(treeClipboard) && Boolean(stoneNode),
        canDeleteAfter: recordEditable && Boolean(stoneNode?.parentId),
        canShift: recordEditable,
        canRotate: true,
        canMirror: true,
        canUndo: recordEditable && draftPresent,
        canRedo: recordEditable && draft.redo.length > 0,
      }, page);
      const pick = (id: RadialMenuActionId) => {
        setRadialMenu(null);
        if (id === "cancel") return;
        if (id === "erase") { eraseStoneOnce(radialMenu.position); return; }
        // 加/取消书签（用户 09-26）：复用棋谱树那个开关——指哪颗子就收"这一手之后的面局"，
        // 与树里的书签是同一份数据，标题也照样按手数自动生成。
        if (id === "bookmark" && stoneNode) { toggleTreeBookmark(stoneNode.id); return; }
        if (id === "jump" && stoneNode) { selectTreeNode(stoneNode.id); return; }
        // 「打标」（用户 10-01 第二轮：标注页整页删掉，它搬进默认页）：三档循环，
        // 写在按下的那一手上。标注类动作不在菜单里——底部标注栏有 6 个文字组 ×
        // 12 种样式 × 12 种颜色，六槽外环镜像不过来，而且空位长按本来就是加标注。
        if (id === "evaluate") {
          if (stoneNode) { const grade = nextEvaluation(stoneNode.evaluation); setNodeEvaluationAt(stoneNode.id, grade.value); }
          return;
        }
        // ── 分支页 ──
        if (id === "setMain") { if (stoneNode) setMainBranch(stoneNode.id); return; }
        if (id === "copyBranch") { if (stoneNode) copyTreeBranch(stoneNode.id); return; }
        if (id === "pasteBranch") { if (stoneNode) pasteTreeBranch(stoneNode.id); return; }
        // 「删除这一手及之后」复用树里那个 deleteTreeBranch：它自带确认框 + "保存前可撤销"，
        // 不再另造一层确认（用户 10-01 要的二次确认由它承担）。
        if (id === "deleteAfter") { if (stoneNode) deleteTreeBranch(stoneNode.id); return; }
        // ── 编辑页 ──
        if (id === "shift") { openBoardShift(); return; }
        if (id === "rotate") { setRotation((value) => ((value + 90) % 360) as BoardRotation); return; }
        if (id === "mirror") { setMirrored((value) => !value); return; }
        if (id === "undo") { undoDraftChange(); return; }
        if (id === "redo") { redoDraftChange(); return; }
        if (id === "copyPosition") {
          const clipboard = navigator.clipboard;
          if (!clipboard?.writeText) { setToast("当前环境不允许访问剪贴板"); return; }
          // 复制出来的是**能直接粘回导入**的主线坐标串（用户 09-26 定稿：要能粘回来）。
          // 坐标导入只认"整份都是坐标"的纯文本，所以分支/摆子/过手这些装不进去的东西
          // 只能由 toast 如实交代，不能混进正文（混进去整份就废了）。
          const text = formatRecordAsCoordinates(viewDocument);
          if (!text) { setToast("这份棋谱还没有落子顺序（摆子局面），坐标串还原不了——请用「导出」"); return; }
          const caveats = copyCoordinateCaveats(viewDocument);
          const hands = text.split("\n").length;
          void clipboard.writeText(text).then(
            () => setToast(caveats.length
              ? `已复制主线 ${hands} 手坐标；这份棋谱有${caveats.join("、")}，坐标串装不下，粘回导入只有主线`
              : `已复制 ${hands} 手坐标：粘进导入面板（或存成 .txt）就能还原`),
            () => setToast("复制失败"));
        }
      };
      return <BoardRadialMenu x={radialMenu.x} y={radialMenu.y} page={page} items={items} onPick={pick}
        // 切页只换外环、不关菜单（关了就没法连着选了）。
        onPickPage={(next) => setRadialMenu((state) => (state ? { ...state, page: next } : null))}
        onClose={() => setRadialMenu(null)}/>;
    })()}

    {/* 整体位移方向盘：两个入口——编辑面板里的「位移」按钮，和长按环形菜单「编辑页 → 位移」。
        这份 JSX 以前写在 `dockPanel === "notes"` 里面，于是从环形菜单点「位移」只有名字、
        方向盘根本不出来（用户 10-02：「光有名字，不知道往哪边移动」）；现在跟着 boardShiftOpen 自己出一份。 */}
    {boardShiftOpen && !isPuzzleMode && createPortal(<>
      <div className="mark-studio-backdrop" onClick={() => setBoardShiftOpen(false)} aria-hidden="true"/>
      <div className="mark-studio-popover board-shift-popover" role="dialog" aria-label="整体位移" style={{ bottom: boardShiftBottom }}>
        <p className="mark-studio-note">把当前局面的<b>所有棋子</b>整体挪一格——图片识谱整体偏一格时最常用。有棋子会被移出棋盘时直接拒绝，不会静默裁掉。</p>
        <div className="board-shift-pad" role="group" aria-label="位移方向">
          <button type="button" className="board-shift-up" onClick={() => shiftPosition(0, -1)} aria-label="整体上移一格"><ArrowUp/><span>上移</span></button>
          <button type="button" className="board-shift-left" onClick={() => shiftPosition(-1, 0)} aria-label="整体左移一格"><ArrowLeft/><span>左移</span></button>
          <button type="button" className="board-shift-right" onClick={() => shiftPosition(1, 0)} aria-label="整体右移一格"><ArrowRight/><span>右移</span></button>
          <button type="button" className="board-shift-down" onClick={() => shiftPosition(0, 1)} aria-label="整体下移一格"><ArrowDown/><span>下移</span></button>
        </div>
        <p className="mark-studio-note">带手序或分支的棋谱，第一次位移会先拍平成静态局面（和「去子」同一条规矩，拍平不可撤销）；静态局面下的位移可以用「撤销」逐步退回。</p>
      </div>
    </>, window.document.body)}
    {sheet && <BottomSheet title={displaySheetTitle} appearance={appearanceForSheet(sheet)} className={sheet === "tree" ? "tree-sheet-backdrop" : sheet === "manual" ? "manual-sheet-backdrop" : ""} manageHistory hideTitle={sheet === "tree"} onClose={() => setSheet(null)}>
    {sheet === "batchEdit" && <div className="sheet-body batch-action-sheet">
        <p className="section-note">仅处理普通棋谱，不会改写大型数据库。大型 LIB、DP、DB 只支持单独打开或导出。</p>
        <button className="export-primary-card" disabled={!batchSelectedIds.length || batchExportBusy} onClick={() => { void runBatchExport(); }}><span className="format-icon"><Download/></span><div><b>{batchExportBusy ? "正在打包…" : "批量导出"}</b><small>{!batchSelectedIds.length ? "请先选择至少一份普通棋谱" : `打包成一个 ZIP：${batchSelectedDocuments.length} 份 SGF${skippedBatchItems.length ? `（另有 ${skippedBatchItems.length} 份大型库无法转 SGF，会在 README 里列出）` : ""}`}</small></div><Upload/></button>
        <button className="export-primary-card" disabled={!batchSelectedIds.length} onClick={() => { setFavorites((current) => ({ ...current, records: [...new Set([...current.records, ...batchSelectedIds])] })); setToast(`已收藏 ${batchSelectedIds.length} 份棋谱`); closeBatchEdit(); }}><span className="format-icon"><Star size={18}/></span><div><b>收藏所选</b><small>{batchSelectedIds.length ? "加入收藏文件夹（已收藏的保留）" : "请先选择至少一份普通棋谱"}</small></div><ChevronRight/></button>
        <section className="batch-replace-card"><div className="batch-action-heading"><MessageSquareText size={19}/><div><b>批量替换注释</b><small>同时处理节点注释与局面文字</small></div></div><label>查找文字<input value={batchReplaceFrom} onChange={(event) => setBatchReplaceFrom(event.target.value)} placeholder="例如：待复核"/></label><label>替换为<input value={batchReplaceTo} onChange={(event) => setBatchReplaceTo(event.target.value)} placeholder="留空表示删除"/></label><button className="primary-button" disabled={!batchSelectedIds.length || !batchReplaceFrom} onClick={runBatchReplace}><Save/>执行替换</button></section>
        <button className="secondary-button" onClick={closeBatchEdit}><X/>完成</button>
      </div>}
      {sheet === "duelResume" && duelResume && (() => {
        const summary = duelSessionSummary(duelResume);
        return <div className="sheet-body duel-resume-sheet">
          <p className="section-note" data-duel-resume-summary>{`第 ${summary.turn} 手 · ${openingRuleName(duelResume.game.opening.rule, duelResume.game.opening.n)} · ${duelResume.game.forbiddenEnabled ? "有禁手" : "无禁手"} · AI ${duelResume.game.strength}${duelResume.savedAt ? ` · ${duelResume.savedAt.slice(0, 10)} 退出` : ""}`}</p>
          <p className="section-note duel-resume-awaiting" data-duel-resume-awaiting>{
            summary.finished ? "这局已经结束了：回去可以看结果、回看这盘，或者直接保存进棋谱库。"
              : summary.awaiting === "human" ? "回去后轮到你落子。"
              : "回去后 AI 会接着把这手算完——退出时正轮到它思考，恢复时重新起算这一手。"}</p>
          <button className="primary-button" onClick={resumeDuelSession} data-duel-resume-yes>回到这局</button>
          <button className="secondary-button" onClick={discardDuelSessionAndOpenSetup} data-duel-resume-new>放弃这局，开新局</button>
          <button className="secondary-button" onClick={() => { setDuelResume(null); setSheet(null); }}>先不选（下次再问）</button>
        </div>;
      })()}
      {sheet === "aiGame" && <div className="sheet-body ai-game-setup">
        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><Cpu size={14}/>引擎</div>
          {/* 引擎只有一个档位，所以不再占一整格：状态并进标题行（用户 09-19 要一屏装完）。
              旗舰档（KataGo）选中且可用时要如实改名——否则用户开了旗舰、对话框还写 rapri
              （2026-09-26 真机验收发现）。 */}
          <div className="ai-engine-status"><b>{aiEngineChoice === "kata" ? (kataEngineReady ? "KataGo" : "rapfi") : "rapfi"}</b><small>{aiEngineChoice === "kata" ? (kataEngineReady ? "KataGo 引擎（作者网）· 已启用" : "KataGo 未就绪 · 当前用 rapfi 计算（可在分析面板重试）") : nativeEngineReady ? "本机原生引擎 · 已生效" : strongEngineReady ? "冠军网络 · 已生效" : "内置引擎（自带轻量网络）"}</small></div>
          {/* 引擎调优一行装完（用户 09-19）：内存只留一个「可拖又可读」的控件，
              右侧补多线程/线程数与 ARM 加速开关——不再让说明小字各占一行。 */}
          <EngineLoadStatus load={engineLoad}/>
          {/* 对局引擎在这里直接选（用户 10-04）：以前只能在设置或分析头里换，对弈页连选项都没有。
              切换有上面那条进度条兜着，冷启动的等待看得见，所以当场换引擎不再像卡住。 */}
          <PanelSelect ariaLabel="对局引擎" value={aiEngineChoice === "ikatago" ? "ikatago" : kataActive ? "katago" : "rapfi"} options={([["rapfi", "rapfi"], ...(Capacitor.isNativePlatform() ? [["katago", "KataGo"]] : []), ["ikatago", "iKataGo"]] as [string, string][]).map((pair) => [pair[0], pair[1]] as [string, string])} onChange={(value) => updateAiEngineChoice(value === "katago" ? "kata" : value === "ikatago" ? "ikatago" : "strong")}/>
          <div className="ai-engine-tune">
            {aiEngineChoice === "ikatago" ? <IkatagoTuning onNotice={setToast}/> : kataActive ? <KataTuning variant="panel" onNotice={setToast}/> : <>
            <label className="ai-tune-memory" title="引擎转置表预算：越大长分析越深，分配失败会自动降档">
              <span>内存</span>
              <input aria-label="分析内存滑杆" type="range" min="64" max="2048" step="32" value={enhancementSettings.analysisMaxMemoryMb} onChange={(event) => { const v = Math.min(2048, Math.max(64, Number(event.target.value))); changeEnhancementSettings({ ...enhancementSettings, analysisMaxMemoryMb: v }); }}/>
              <output aria-label="分析内存">{fmtAnalysisMemory(enhancementSettings.analysisMaxMemoryMb)}</output>
            </label>
            <button type="button" className={`ai-tune-switch ${enhancementSettings.engineMultiThread ? "on" : ""}`} aria-pressed={enhancementSettings.engineMultiThread} data-ai-tune="multithread" title="多线程引擎：开启后引擎用多个核心并行搜索（更快也更热），并可选择线程数" onClick={() => { const next = !enhancementSettings.engineMultiThread; changeEnhancementSettings({ ...enhancementSettings, engineMultiThread: next }); cancelActiveAiComputation("settings-change"); }}><span>多线程</span><b>{enhancementSettings.engineMultiThread ? "开" : "关"}</b></button>
            {(enhancementSettings.engineMultiThread || nativeEngineReady) && <PanelSelect ariaLabel="引擎线程数" value={String(enhancementSettings.engineThreads)} options={engineThreadOptionsCompact(undefined, nativeEngineInfo()?.bigCores)} onChange={(value) => changeEnhancementSettings({ ...enhancementSettings, engineThreads: Number(value) })}/>}
            {nativeEngineReady && nativeEngineInfo()?.dotprodPreference !== undefined && (() => { const info = nativeEngineInfo(); const capable = info?.dotprodCapable === true; const preference = info?.dotprodPreference ?? "auto"; const on = preference !== "off" && capable; return <button type="button" className={`ai-tune-switch ai-tune-arm ${on ? "on" : ""}`} aria-pressed={on} disabled={!capable} data-ai-tune="arm" title={capable ? "ARM 加速（NEON DotProd）：NNUE 的 int8 点积硬件加速。切换后引擎会重启，下一轮搜索生效" : "本机 CPU 不支持 NEON DotProd（armv8.2+ 才有），无法开启"} onClick={() => { void setNativeDotprod(on ? "off" : "auto").then((ok) => { if (!ok) { setToast("切换失败：本机原生引擎不支持该开关"); return; } cancelActiveAiComputation("settings-change"); setToast(on ? "已关闭 ARM 加速，引擎已重启" : "已启用 ARM 加速，引擎已重启"); }); }}><span>ARM 加速</span><b>{capable ? (on ? "开" : "关") : "不支持"}</b></button>; })()}
            </>}
          </div>
          {enginePackMissingFor(aiEngineChoice) && <div className="ai-engine-download-row">{enginePackDownloading ? <p className="helper">{aiPackProgress && aiPackProgress.totalBytes > 0 ? `正在下载 rapfi 引擎包… ${Math.floor((aiPackProgress.receivedBytes / aiPackProgress.totalBytes) * 100)}%（${(aiPackProgress.receivedBytes / 1048576).toFixed(1)} / ${(aiPackProgress.totalBytes / 1048576).toFixed(1)}MB），下载完成后自动生效` : "正在连接下载源…（下载完成后自动生效，无需重启）"}</p> : <button type="button" className="primary-button" onClick={() => { setEnginePackDownloading(true); setAiPackProgress(null); downloadEnginePack((next) => setAiPackProgress(next)).then(() => setToast("rapfi 引擎包下载完成，已自动生效")).catch((error) => setToast(error instanceof Error ? error.message : "引擎包下载失败")).finally(() => { setEnginePackDownloading(false); setAiPackProgress(null); }); }}><Download size={16}/>立即下载 rapfi 引擎包（38.4MB）</button>}</div>}
        </section>

        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><BookOpen size={14}/>规则<button type="button" className="ai-rule-help-btn" aria-label="查看所有规则说明" title="查看所有规则说明" onClick={() => setSheet("rules")}>?</button></div>
          {/* 自定义开局下，上面那格只取**禁手判定**这一个比特（有禁/无禁仍然生效），
              开局流程（五手两打 / 交换 / 山口…）不参与 —— 所以这里如实改小字，
              不许出现"选了五手两打、其实一步都不按它走"的假信息。 */}
          <div className="ai-setup-cells two">
            <button type="button" className={selectedAiRule.badge === "无禁" ? "selected" : ""} data-ai-rule="no-forbidden" onClick={() => setAiFloatPanel(aiFloatPanel === "rule-noForbidden" ? null : "rule-noForbidden")} aria-expanded={aiFloatPanel === "rule-noForbidden"}><span>无禁手</span><small>{aiCustomOpening ? (selectedAiRule.badge === "无禁" ? "只取禁手判定" : `${AI_RULE_GROUPS["无禁"].length} 种规则`) : selectedAiRule.badge === "无禁" ? selectedAiRule.name : `${AI_RULE_GROUPS["无禁"].length} 种规则`}</small><ChevronDown size={14}/></button>
            <button type="button" className={selectedAiRule.badge === "有禁" ? "selected" : ""} data-ai-rule="forbidden" onClick={() => setAiFloatPanel(aiFloatPanel === "rule-forbidden" ? null : "rule-forbidden")} aria-expanded={aiFloatPanel === "rule-forbidden"}><span>有禁手</span><small>{aiCustomOpening ? (selectedAiRule.badge === "有禁" ? "只取禁手判定" : `${AI_RULE_GROUPS["有禁"].length} 种规则`) : selectedAiRule.badge === "有禁" ? selectedAiRule.name : `${AI_RULE_GROUPS["有禁"].length} 种规则`}</small><ChevronDown size={14}/></button>
          </div>
        </section>

        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><Sparkles size={14}/>开局</div>
          {/* 「开局方式」单独一行，**不塞进上面那两格当第三格**：规则那两格选的是有禁/无禁与
              开局流程，这一行选的是"按流程走"还是"自己摆局面"，两者是正交的（用户要的顺序正是
              「先选择有禁无禁，再摆棋子」）。做成第三格会让人误以为它与有禁/无禁互斥。
              自定义开局这一局不给棋魂、也不计战绩（见 App 里结算那处的早退）。 */}
          <div className="ai-setup-cells two">
            <button type="button" className={aiCustomOpening ? "" : "selected"} aria-pressed={!aiCustomOpening} data-ai-custom-opening="off" onClick={() => setAiCustomOpening(false)}><span>按规则开局</span><small>{selectedAiRule.name}</small></button>
            <button type="button" className={aiCustomOpening ? "selected" : ""} aria-pressed={aiCustomOpening} data-ai-custom-opening="on" onClick={() => setAiCustomOpening(true)}><span>自定义开局</span><small>自己摆子 · 不给棋魂</small></button>
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
          <button type="button" className="ai-setup-cell single" onClick={() => setAiFloatPanel(aiFloatPanel === "time" ? null : "time")} aria-expanded={aiFloatPanel === "time"}><span>{AI_TIME_OPTIONS.find((option) => option.value === aiTimeLimitMs)?.title}{aiReadOffMs ? ` + ${aiReadOffMs / 1000} 秒读秒` : ""}</span><small>{AI_TIME_OPTIONS.find((option) => option.value === aiTimeLimitMs)?.text}{aiReadOffMs ? ` · 每手 ${aiReadOffMs / 1000} 秒` : ""}</small><ChevronDown size={14}/></button>
        </section>

        <section className="ai-setup-row">
          <div className="ai-setup-row-label"><CircleDot size={14}/>执子</div>
          <div className="ai-setup-cells two">
            <button type="button" className={aiHumanPlayer === "black" ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiHumanPlayer("black"); }} aria-pressed={aiHumanPlayer === "black"}><i className="player-stone black"/><span>执黑</span><small>开局方</small></button>
            <button type="button" className={aiHumanPlayer === "white" ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiHumanPlayer("white"); }} aria-pressed={aiHumanPlayer === "white"}><i className="player-stone white"/><span>执白</span><small>应对方</small></button>
          </div>
        </section>

        <button className="primary-button ai-start-button" onClick={startNewAiGame}><Bot size={18}/>{aiGame ? "按新规则重新开始" : "开始人机对战"}</button>

        {aiFloatPanel && <div className="ai-float-wrap" role="dialog" aria-modal="true">
          <div className="ai-float-backdrop" onClick={() => setAiFloatPanel(null)} />
          <div className="ai-float-panel">
          <div className="compact-overlay-decoration" aria-hidden="true"><OverlayPattern/></div>
            <div className="ai-float-head"><b>{aiFloatPanel === "rule-noForbidden" ? "无禁手规则" : aiFloatPanel === "rule-forbidden" ? "有禁手规则" : aiFloatPanel === "difficulty" ? "AI 难度" : "对局时长"}</b><button type="button" onClick={() => setAiFloatPanel(null)} aria-label="关闭"><X size={16}/></button></div>
            {aiFloatPanel === "rule-noForbidden" && <div className="ai-float-list">{AI_RULE_GROUPS["无禁"].map((choice) => <button type="button" key={choice.key} className={selectedAiRule.key === choice.key ? "selected" : ""} onClick={() => { applyAiRuleChoice(choice); setAiFloatPanel(null); }} aria-pressed={selectedAiRule.key === choice.key}><span>{choice.name}</span><small>{choice.summary}</small></button>)}</div>}
            {aiFloatPanel === "rule-forbidden" && <div className="ai-float-list">{AI_RULE_GROUPS["有禁"].map((choice) => <button type="button" key={choice.key} className={selectedAiRule.key === choice.key ? "selected" : ""} onClick={() => { applyAiRuleChoice(choice); setAiFloatPanel(null); }} aria-pressed={selectedAiRule.key === choice.key}><span>{choice.name}</span><small>{choice.summary}</small></button>)}</div>}
            {aiFloatPanel === "difficulty" && <>
              {/* 选完即关（用户 09-10）：只有「自由」需要继续调参数，留在此面板。 */}
              <div className="ai-float-list">{AI_STRENGTH_OPTIONS.map((option) => <button type="button" key={option.value} className={aiStrength === option.value ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiStrength(option.value); if (option.value !== "自由") setAiFloatPanel(null); }} aria-pressed={aiStrength === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>
              {aiStrength === "自由" && <div className="ai-free-controls"><button type="button" className={`ai-unlimited-option ${aiFreeUnlimited ? "selected" : ""}`} aria-pressed={aiFreeUnlimited} onClick={() => { cancelActiveAiComputation("settings-change"); setAiFreeUnlimited((value) => !value); }}><span><b>不限时思考</b><small>持续搜索，直到你主动停止、切换局面或应用进入后台</small></span><Check/></button><label className={aiFreeUnlimited ? "disabled" : ""}><span>思考时间</span><div className="ai-free-time-entry"><input aria-label="自定义思考时间（秒）" type="number" min="0.3" max="300" step="0.1" disabled={aiFreeUnlimited} value={(aiFreeTimeMs / 1000).toFixed(1)} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeTimeMs(Math.max(300, Math.min(300000, Math.round((Number(event.target.value) || 0.3) * 1000)))); }}/><em>秒</em></div><input aria-label="思考时间滑杆" type="range" min="300" max="300000" step="100" disabled={aiFreeUnlimited} value={aiFreeTimeMs} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeTimeMs(Number(event.target.value)); }}/><small>{aiFreeUnlimited ? "不限时模式不会自动到时落子" : "可输入 0.3–300 秒，最长 5 分钟"}</small></label><label><span>搜索深度</span><output>{aiFreeUnlimited ? "持续加深" : `${aiFreeDepth} 层`}</output><input aria-label="搜索深度滑杆" type="range" min="16" max="128" step="8" disabled={aiFreeUnlimited} value={aiFreeDepth} onChange={(event) => { cancelActiveAiComputation("settings-change"); setAiFreeDepth(Number(event.target.value)); }}/></label></div>}
            </>}
            {/* 对局时长都是预设档，选完即关（无自定义项）。 */}
            {aiFloatPanel === "time" && <>
              <div className="ai-float-list">{AI_TIME_OPTIONS.map((option) => <button type="button" key={option.value} className={aiTimeLimitMs === option.value ? "selected" : ""} onClick={() => { cancelActiveAiComputation("settings-change"); setAiTimeLimitMs(option.value); }} aria-pressed={aiTimeLimitMs === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>
              <p className="ai-float-subhead" aria-hidden="true">每手读秒（超时同样判负，AI 不占钟）</p>
              <div className="ai-float-list">{AI_READ_OFF_OPTIONS.map((option) => <button type="button" key={option.value} className={aiReadOffMs === option.value ? "selected" : ""} onClick={() => { setAiReadOffMs(option.value); setAiFloatPanel(null); }} aria-pressed={aiReadOffMs === option.value}><span>{option.title}</span><small>{option.text}</small></button>)}</div>
            </>}
          </div>
        </div>}
      </div>}
      {sheet === "fifthCount" && aiGame?.opening.stage.kind === "choose-fifth-count" && (() => {
        const openingRule = aiGame.opening.rule;
        const range = openingRule === "soosyrv-8" ? [1, 2, 3, 4, 5, 6, 7, 8] : openingRule === "yamaguchi" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] : [3, 4, 5, 6, 7, 8, 9, 10];
        const note = openingRule === "soosyrv-8"
          ? "索索夫-8：白方落第4手时宣布 1–8 个第5手打点数量；宣布后对方仍有一次交换权。"
          : openingRule === "yamaguchi"
            ? "山口：请宣布本局第5手打点数量（1–15）；宣布后由对方决定是否交换，再由白方落第4手。"
            : "五手多打的数量在对局中决定。请选择本局要提供的不同第5手候选数量。";
        return <div className="sheet-body fifth-count-sheet"><p className="section-note">{note}</p><div className="fifth-count-grid">{range.map((count) => <button key={count} onClick={() => chooseOpeningFifthCount(count)}><b>{count}</b><span>个打点</span><small>A1–A{count}</small></button>)}</div></div>;
      })()}
      {sheet === "folder" && <div className="sheet-body form-grid folder-sheet"><label>{folderSheetMode === "batch-move" ? "移动到文件夹" : "上级文件夹"}<select value={folderCreationParent} onChange={(event) => setFolderCreationParent(event.target.value)}>{folderSheetMode === "create" && <option value="">根目录</option>}{folderOptions(folderCreationSection === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders)}</select></label>{folderSheetMode === "create" ? <><label>文件夹名称<input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder={`例如：${folderCreationSection === "records" ? "我的实战棋谱" : "冲四题库"}`} onKeyDown={(event) => { if (event.key === "Enter") confirmCreateLibraryFolder(); }}/></label><p className="helper">可选择上级文件夹建立子目录；移动棋谱或题集时也会显示完整层级。</p><button className="primary-button" onClick={confirmCreateLibraryFolder}><FolderPlus/>创建文件夹</button></> : <><p className="helper">{folderCreationSection === "puzzles" ? `已选择 ${puzzleBatchSelectedIds.length} 个题集，将移动到所选文件夹。` : `已选择 ${batchSelectedIds.length} 份棋谱，将移动到所选文件夹。`}</p><button className="primary-button" onClick={folderCreationSection === "puzzles" ? movePuzzleBatchToFolder : moveBatchSelectionToFolder}><FolderOpen/>确认移动</button></>}</div>}
      {sheet === "puzzleEdit" && puzzleEditTarget && <div className="sheet-body form-grid rename-sheet puzzle-edit-sheet"><div className="rename-summary"><span><Settings2 size={18}/></span><div><b>编辑题目</b><small>只改这道题的描述与规则，棋子本身请在棋盘上改</small></div></div><label>题目名称<input autoFocus value={puzzleEditTarget.title} onChange={(event) => setPuzzleEditTarget({ ...puzzleEditTarget, title: event.target.value })} maxLength={80} onKeyDown={(event) => { if (event.key === "Enter") confirmPuzzleEdit(); }}/></label><label>题面文字<input value={puzzleEditTarget.prompt} onChange={(event) => setPuzzleEditTarget({ ...puzzleEditTarget, prompt: event.target.value })} maxLength={120} placeholder="例如：黑先，击败陪练"/></label><label>难度<select value={puzzleEditTarget.difficulty} onChange={(event) => setPuzzleEditTarget({ ...puzzleEditTarget, difficulty: Number(event.target.value) as Puzzle["difficulty"] })}>{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{"★".repeat(level)}（{level} 级）</option>)}</select></label><label>先手<select value={puzzleEditTarget.player} onChange={(event) => setPuzzleEditTarget({ ...puzzleEditTarget, player: event.target.value as Player })}><option value="black">黑先</option><option value="white">白先</option></select></label><label>规则<select value={puzzleEditTarget.rule} onChange={(event) => setPuzzleEditTarget({ ...puzzleEditTarget, rule: event.target.value as "" | RuleSet })}><option value="">跟随题集 / 做题偏好</option><option value="renju">有禁手</option><option value="freestyle">无禁手</option></select></label><p className="helper">题集的规则改动只影响还没有单独设规则的题目；已有做题进度不受任何字段改动影响。</p><div className="puzzle-edit-actions"><button className="secondary-button" onClick={() => { setPuzzleEditTarget(null); setSheet(null); }}><X/>取消</button><button className="primary-button" onClick={confirmPuzzleEdit}><Check/>保存题目</button></div></div>}

      {sheet === "puzzleEdit" && puzzleSplitTarget && <div className="sheet-body form-grid rename-sheet"><div className="rename-summary"><span><Scissors size={18}/></span><div><b>拆分题集</b><small>{puzzleSplitTarget.title} · 共 {puzzleSplitTarget.total} 道题</small></div></div><div className="puzzle-split-range"><label>从第<input type="number" min={1} max={puzzleSplitTarget.total} value={puzzleSplitTarget.from} onChange={(event) => setPuzzleSplitTarget({ ...puzzleSplitTarget, from: event.target.value })}/></label><span>到第</span><label><input type="number" min={1} max={puzzleSplitTarget.total} value={puzzleSplitTarget.to} onChange={(event) => setPuzzleSplitTarget({ ...puzzleSplitTarget, to: event.target.value })}/>题</label></div><p className="helper">选中的题目会抽到一个新题集「{puzzleSplitTarget.title}（拆分）」，原题集保留其余题目。题号按当前顺序从 1 数起；做题进度跟着题目走，不会丢。</p><div className="puzzle-edit-actions"><button className="secondary-button" onClick={() => { setPuzzleSplitTarget(null); setSheet(null); }}><X/>取消</button><button className="primary-button" onClick={confirmPuzzleSplit}><Scissors/>拆出新题集</button></div></div>}

      {sheet === "puzzleEdit" && puzzleMergeOpen && <div className="sheet-body form-grid rename-sheet"><div className="rename-summary"><span><Merge size={18}/></span><div><b>合并题集</b><small>已选择 {puzzleBatchSelectedIds.length} 个题集</small></div></div><ul className="puzzle-merge-list">{puzzleCollections.filter((collection) => puzzleBatchSelectedIds.includes(collection.id)).map((collection) => <li key={collection.id}><b>{collection.title}</b><small>{collection.puzzles.length} 道题</small></li>)}</ul><label className="checkbox-row"><input type="checkbox" checked={puzzleMergeDedupe} onChange={(event) => setPuzzleMergeDedupe(event.target.checked)}/>去掉重复题<small>标题与局面都相同的只保留一道（保留排在前面那份及其进度）</small></label><p className="helper">合并会生成一个新题集「合并题集」，原来的题集收起来。做题进度、收藏与重做队列都跟着题目走；合并后可以撤销。</p><div className="puzzle-edit-actions"><button className="secondary-button" onClick={() => { setPuzzleMergeOpen(false); setSheet(null); }}><X/>取消</button><button className="primary-button" onClick={confirmPuzzleMerge}><Merge/>合并</button></div></div>}

      {sheet === "puzzleEdit" && puzzleAddTargetId && (() => {
        const target = puzzleCollections.find((collection) => collection.id === puzzleAddTargetId);
        if (!target) return null;
        const stoneCount = board.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
        return <div className="sheet-body form-grid rename-sheet"><div className="rename-summary"><span><Plus size={18}/></span><div><b>加入题集</b><small>{target.title} · 现在是第 {target.puzzles.length + 1} 道</small></div></div><p className="helper">把棋盘上当前的 {stoneCount} 颗子存成这个题集的一道新题，先手按黑白切换的当前状态记（现在轮到{activePlacementPlayer === "black" ? "黑" : "白"}方）。</p><div className="puzzle-edit-actions"><button className="secondary-button" onClick={() => { setPuzzleAddTargetId(null); setSheet(null); }}><X/>取消</button><button className="primary-button" onClick={() => addCurrentPositionToPuzzleCollection(target.id)}><Plus/>加入这个题集</button></div></div>;
      })()}

      {sheet === "rename" && renameTarget && <div className="sheet-body form-grid rename-sheet"><div className="rename-summary"><span><PenLine size={18}/></span><div><b>{renameTarget.kind.includes("folder") ? "文件夹" : renameTarget.kind === "puzzle" ? "题目" : renameTarget.kind === "puzzle-collection" ? "题集" : "棋谱"}</b><small>当前位置：{renameTarget.kind.includes("folder") ? folderDisplayLabel(renameTarget.name) : renameTarget.name}</small></div></div><label>新的名称<input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={80} onKeyDown={(event) => { if (event.key === "Enter") void confirmLibraryRename(); }}/></label><p className="helper">{renameTarget.kind.includes("folder") ? "重命名父文件夹时，里面的子文件夹和内容会一起保留并更新路径。" : "只修改显示名称，不会改变棋谱内容、题目进度或所在文件夹。"}</p><button className="primary-button" onClick={() => { void confirmLibraryRename(); }}><Check/>确认重命名</button></div>}
      {sheet === "find" && <RecordSearchPanel document={document} query={findQuery} results={findResults} partial={isPartialDocument(document)} onQueryChange={setFindQuery} onJump={(nodeId) => { clearBoardMotion(); setCurrentId(nodeId); }}/>}
      {sheet === "positionSearch" && <div className="sheet-body position-search-sheet"><label className="match-toggle"><span><b>包含旋转与镜像</b><small>不同棋盘朝向也视为同一局面</small></span><input type="checkbox" checked={matchSymmetry} onChange={(event) => setMatchSymmetry(event.target.checked)}/><i/></label><p className="section-note">已扫描 {positionScanDocuments.length} 份本地棋谱的主线和全部变化，找到 {visiblePositionMatches.length} 个其他节点{positionMatches.length >= 60 ? "（只显示前 60 个）" : ""}。{positionScanSkipped > 0 ? `另有 ${positionScanSkipped} 份按局面读取的棋谱（局面库 / 库文件 / 大型棋谱）没有扫描——它们只加载了一部分，扫出来会漏。` : ""}</p><div className="position-match-list">{visiblePositionMatches.map((match) => <button key={`${match.documentId}-${match.nodeId}`} onClick={() => { const target = searchableDocuments.find((item) => item.id === match.documentId); if (!target) return; openRecord(target, match.nodeId, { onOpened: () => { setSheet(null); setToast(`已跳转到《${match.title}》第 ${match.depth} 手`); } }); }}><span>{match.depth}</span><div><b>{match.title}</b><small>第 {match.depth} 手{match.coordinate ? ` · ${match.coordinate}` : " · 起始局面"}</small></div><ChevronRight size={18}/></button>)}</div>{!visiblePositionMatches.length && <div className="sheet-empty"><Search/><b>棋谱库中没有其他相同局面</b><span>{matchSymmetry ? "已同时比较旋转与镜像方向。" : "可开启旋转与镜像后再试。"}</span></div>}<p className="helper">匹配同时比较黑白棋位置和下一手行棋方；点击结果会直接打开对应棋谱节点。</p></div>}
      {sheet === "comment" && <div className="sheet-body"><textarea autoFocus value={current.comment} placeholder="例如：这里白棋若防在 J9，黑棋可以继续冲四…" onChange={(event) => safeUpdateNode({ comment: event.target.value })}/><p className="helper">注释保存在当前节点，导出 SGF 时会写入 C 属性。</p>{current.renLibAnnotations?.length ? <section className="native-annotation-panel"><h3>原谱内容</h3>{annotationLines(current).map((text, index) => <p key={`${current.id}-native-${index}`}>{text}</p>)}</section> : null}<button className="primary-button" onClick={() => setSheet(null)}><Check/>完成</button></div>}
       {sheet === "tree" && <div className="sheet-body tree-sheet"><TreePanel
         document={viewDocument}
         currentId={currentId}
         path={path}
         compactIndex={compactIndexOf(document)}
         partial={isPartialDocument(viewDocument)}
         bookmarks={activeBookmarks}
         clipboard={treeClipboard}
         busy={dynamicNavigationBusy}
         readOnly={false}
         branchNameOverrides={reviewBranchNames[viewDocument.id] || {}}
         onLocate={selectTreeNode}
         onFlowJump={previewTreeNode}
         onCreateBranch={createBranchFromTree}
         onRenameBranch={renameTreeBranch}
         onDeleteBranch={deleteTreeBranch}
         onSetMainBranch={setMainBranch}
         onCopy={copyTreeBranch}
         onCut={cutTreeBranch}
         onPaste={pasteTreeBranch}
         onCancelCopy={() => { setTreeClipboard(null); setToast("已取消分支复制"); }}
         onMergeSamePositions={mergeSamePositionsInto}
         onLoadBranch={loadTreeBranch}
         onToggleBookmark={toggleTreeBookmark}
         onEditBookmark={editTreeBookmark}
         onDeleteBookmark={deleteTreeBookmark}
       /></div>}
       {sheet === "branches" && <div className="sheet-body"><div className="support-row"><b>分支操作已并入棋谱树</b><span>在树中点选节点即可切换、创建、复制、重命名或删除分支。</span></div><button className="primary-button" onClick={() => setSheet("tree")}><ListTree/>打开棋谱树</button></div>}
      {sheet === "save" && <div className="sheet-body form-grid save-sheet"><label>保存名称<input autoFocus value={viewDocument.metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })}/></label><div className="save-destination" role="tablist" aria-label="保存类型"><button className={saveDestination === "records" ? "selected" : ""} onClick={() => { setSaveDestination("records"); setSaveFolder(libraryFolders.recordFolders[0] || "未分类"); }} role="tab">棋谱</button><button className={saveDestination === "puzzles" ? "selected" : ""} onClick={() => { setSaveDestination("puzzles"); setSaveFolder(libraryFolders.puzzleFolders[0] || "我的题库"); }} role="tab">题库</button></div><label>保存到分组<select value={saveFolder} onChange={(event) => setSaveFolder(event.target.value)}>{folderOptions(saveDestination === "records" ? libraryFolders.recordFolders : libraryFolders.puzzleFolders)}</select></label>{saveDestination === "puzzles" && <><label>存到哪个题集<select value={savePuzzleTarget} onChange={(event) => setSavePuzzleTarget(event.target.value)}><option value="">新建题集（用上面的分组名）</option>{puzzleCollections.filter((collection) => !hiddenPuzzleCollectionIds.includes(collection.id)).map((collection) => <option key={collection.id} value={collection.id}>{collection.title}（{collection.puzzles.length} 道）</option>)}</select></label><p className="helper">将当前局面保存为一道练习题，保留当前棋盘上的全部棋子。选一个已有题集就加进去，不选则按分组名新建。</p></>}<details className="save-info-disclosure"><summary><span><b>编辑棋谱信息</b><small>棋手、赛事、规则与开局设置</small></span><ChevronDown/></summary><div className="save-info-content form-grid"><MetadataFields metadata={viewDocument.metadata} onChange={updateMetadata}/></div></details><button className="primary-button" onClick={() => { void confirmSave(); }}><Save/>确认保存</button>{saveDestination !== "puzzles" && <button className="secondary-button" onClick={() => { createModificationCopyHere(); setSheet(null); setToast("已另存为「修改副本」，棋谱库里那份原谱保持不变"); }}><Copy/>创建修改副本</button>}{saveDestination !== "puzzles" && <p className="helper">「确认保存」写回这份棋谱本身；「创建修改副本」把当前盘面存成棋谱库里另一份独立的「· 修改副本」，原谱一个字都不动。改的是别人给的谱、又不确定要不要留时，用后者。</p>}</div>}
      {sheet === "metadata" && <div className="sheet-body form-grid"><MetadataFields metadata={viewDocument.metadata} onChange={updateMetadata}/><button className="primary-button" onClick={() => setSheet(null)}><Save/>保存信息</button></div>}
      {sheet === "import" && <div className="sheet-body import-options"><button className="import-choice" onClick={() => { setSheet(null); if (mode === "puzzle") puzzleFileInput.current?.click(); else singleFileInput.current?.click(); }}><span className="format-icon"><Download/></span><div><b>{mode === "puzzle" ? "导入题库文件" : "导入棋谱文件"}</b><small>{mode === "puzzle" ? "puzzles 题库对象、连续坐标串、二维 JSON 数组" : "SGF、LIB、JSON、POS 等格式；题库 JSON 会自动识别"}</small></div><ChevronRight/></button><button className="import-choice" onClick={() => setSheet("coordinateCode")}><span className="format-icon"><ClipboardPaste/></span><div><b>粘贴坐标代码</b><small>把一串坐标直接变成棋谱，例如 H8 I9 H10 或 h8i9h10</small></div><ChevronRight/></button><button className="import-choice" onClick={() => { setSheet(null); openImageImportPicker(); }}><span className="format-icon json"><Download/></span><div><b>图片识谱</b><small>自动定位网格识别棋子与颜色；棋子印有手序（手数）的图，识别后可点「复原手序-本地 / 复原手序-云端」重建落子顺序</small></div><ChevronRight/></button>{enhancementSettings.importShelf && recentImports.length > 0 && <section className="recent-imports" aria-label="最近导入"><div className="recent-imports-heading"><b>最近导入</b><small>棋谱 / 题库 / 图片识谱 / 坐标代码，保留最近 5 条</small></div><div className="recent-import-list">{recentImports.map((entry) => <button key={entry.id} className="recent-import-item" onClick={() => { void reopenRecentImport(entry); }} aria-label={`重新打开 ${entry.name}`}><span className="recent-import-icon">{entry.kind === "puzzle" ? "题" : entry.kind === "image" ? "图" : entry.kind === "coordinate" ? "坐" : entry.kind === "online" ? "线" : "谱"}</span><span className="recent-import-copy"><b title={entry.name}>{entry.name}</b><small>{entry.kind === "puzzle" ? "题库" : entry.kind === "image" ? "图片识谱" : entry.kind === "coordinate" ? "坐标代码" : entry.kind === "online" ? "在线棋谱" : "棋谱"} · {entry.available ? "可一键重开" : "文件较大，请重新选择"}</small></span><ChevronRight size={16}/></button>)}</div></section>}{mode === "puzzle" && <p className="helper">题库 JSON 可使用 puzzles 包装格式：每题支持 stones 连续坐标串，或 blackStones / whiteStones 分色坐标串；也兼容旧格式的“坐标,颜色编号”二维数组。side 会作为题目先手读取，空题会跳过。</p>}{mode !== "puzzle" && <p className="helper">图片识谱会自动定位网格并识别棋子颜色。识别后请快速核对一遍，题库 JSON 选择后会自动转入题库。</p>}</div>}
      {sheet === "coordinateCode" && <CoordinateCodePanel defaultBoardSize={viewDocument.metadata.boardSize || 15} onCancel={() => setSheet(null)} onNotice={setToast} onApply={applyCoordinateCode}/>}
      {sheet === "imageImport" && imageImportPreview && createPortal(
        <BoardAlignScreen
          src={imageImportPreview.url}
          alt={imageImportPreview.name}
          busy={imageRecognizing}
          anySize={anyBoardSize}
          anySizeEnabled={enhancementSettings.devBoardSizeDetect}
          onAnySizeChange={setAnyBoardSize}
          onCancel={closeImageImportSheet}
          onRecognize={(roi) => { void runBoardImageRecognition(imageImportPreview.file, imageImportPreview.name, { roi: roi || undefined, anyBoardSize: anyBoardSize && enhancementSettings.devBoardSizeDetect }); }}
        />,
        window.document.body,
      )}
      {sheet === "puzzleManage" && <PuzzleManagePanel
        hiddenPuzzleCollections={puzzleCollections.filter((collection) => hiddenPuzzleCollectionIds.includes(collection.id)).map((collection) => ({ id: collection.id, title: collection.title, puzzles: collection.puzzles.length }))}
        masteredPuzzleCount={masteredPuzzleKeys.size}
        puzzleProgressCount={Object.keys(puzzleProgress).length}
        onRestoreHiddenPuzzleCollection={(id) => {
          setHiddenPuzzleCollectionIds((ids) => ids.filter((item) => item !== id));
          const restored = puzzleCollections.find((collection) => collection.id === id);
          setToast(restored ? `已恢复显示“${restored.title}”` : "已恢复显示");
        }}
        onRestoreAllHiddenPuzzleCollections={() => { setHiddenPuzzleCollectionIds([]); setToast("已恢复显示全部题库"); }}
        onResetPuzzleProgress={resetPuzzleProgress}
      />}
      {sheet === "dataSafety" && <DataSafetyPanel backupBusy={backupBusy} onExportBackup={() => { void exportBackup(); }} onRestoreBackup={() => backupFileInput.current?.click()} onOpenVersions={openVersionHistory} versionCount={versionHistory.length} onOpenHealth={openHealthCheck}/>}
      {/* 本机凭证（2026-10-11）：「让每一个机子都有本地凭证，删了软件也能恢复到之前的状态」。
          恢复成功后要 reload —— 与现有「恢复备份」同一条口径（数据换了，
          内存里的 React state 不会自动重读）。 */}
      {sheet === "vault" && <div className="sheet-body"><VaultPanel appVersion={APP_VERSION} onRestored={() => window.setTimeout(() => window.location.reload(), 350)}/></div>}
      {sheet === "undoHistory" && <div className="sheet-body version-history-sheet"><div className="support-row"><b>撤销历史</b><span>当前棋谱这次编辑的全部 ${undoHistoryEntries.length} 步。</span></div>{undoHistoryEntries.length ? <div className="export-options">{[...undoHistoryEntries].reverse().map((entry) => <button key={entry.index} className="settings-link" onClick={() => undoToStep(entry.index - 1)} title={`回退到第 ${entry.index - 1} 步（撤销这一步及之后）`}><span><Undo2/><b>第 {entry.index} 步 · {entry.label}</b><small>点一下回退到这一步之前</small></span><ChevronRight/></button>)}</div> : <div className="sheet-empty"><Undo2 size={34}/><b>没有可撤销的编辑</b><span>落子、改注释或删分支后，这里会列出每一步。</span></div>}</div>}
      {sheet === "duelStats" && <DuelStatsSheet entries={duelHistory} onClear={clearDuelStats}/>}
      {/* 自定义开局的「局面库」（用户 2026-10-14）：载入 / 改名 / 删除。改名就地做，不弹第二层浮层。 */}
      {sheet === "duelSetups" && <div className="sheet-body duel-setups-sheet">
        <p className="helper">摆好的局面存在这台设备上。存的是<b>当前这一条路线</b>（分支不存），下次开「自定义开局」点「局面」就能接着摆或直接开打。</p>
        {duelSetups.length ? <div className="duel-setups-list">{duelSetups.map((item) => <article key={item.id} data-duel-setup-row={item.id}>
          <div className="duel-setups-copy">{duelSetupRenaming === item.id
            ? <input className="duel-setup-name-input" value={duelSetupNameDraft} aria-label="局面名字" onChange={(event) => setDuelSetupNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { applyDuelSetupList(renameDuelSetup(item.id, duelSetupNameDraft)); setDuelSetupRenaming(null); } }}/>
            : <><b>{item.name}</b><small>{item.stones} 子 · {item.boardSize} 路 · {new Date(item.savedAt).toLocaleDateString("zh-CN")}</small></>}</div>
          <div className="duel-setups-actions">
            <button type="button" className="accent" data-duel-setup-load onClick={() => loadDuelSetupEntry(item)}>载入</button>
            {duelSetupRenaming === item.id
              ? <button type="button" onClick={() => { applyDuelSetupList(renameDuelSetup(item.id, duelSetupNameDraft)); setDuelSetupRenaming(null); }}>存名</button>
              : <button type="button" onClick={() => { setDuelSetupRenaming(item.id); setDuelSetupNameDraft(item.name); }}>改名</button>}
            <button type="button" className="danger-text-button" data-duel-setup-remove onClick={() => applyDuelSetupList(removeDuelSetup(item.id))}>删除</button>
          </div>
        </article>)}</div> : <p className="helper">还没有存过局面：在摆子界面摆好子之后点「保存」。</p>}
      </div>}
      {sheet === "achievements" && <div className="sheet-body"><AchievementsPanel state={progress.state} onClose={() => setSheet(null)}/></div>}
      {sheet === "soul" && <div className="sheet-body"><SoulPanel summary={progress.soul} ledger={progress.ledger} tuning={progress.tuning} onTapGain={handleSoulTap} tapAmount={progress.tuning.tapAmount}/></div>}
      {sheet === "shop" && <div className="sheet-body"><SoulShopPanel/></div>}
      {sheet === "health" && <div className="sheet-body version-history-sheet"><div className="support-row"><b>库健康检查</b><span>按内容比对找出棋谱库里的重复（同一盘棋存了多份）。这里只报告、不自动删——同名不同谱、同谱不同注释都是正常存在，删哪份由你决定。</span></div>{duplicateGroups.length ? <><div className="recycle-bin-toolbar"><span>{duplicateSummary(duplicateGroups).groups} 组重复 · 可清理 {duplicateSummary(duplicateGroups).redundant} 份</span></div><div className="export-options">{duplicateGroups.map((group, groupIndex) => <div key={`dup-${groupIndex}`} className="version-history-card"><div className="version-history-copy"><b>第 {groupIndex + 1} 组 · {group.members.length} 份相同内容</b>{group.members.map((member) => <small key={member.id}>{(member.metadata.title || "未命名")} · {(member.metadata.black || "?")} vs {(member.metadata.white || "?")} · {Object.keys(member.nodes).length.toLocaleString()} 局面</small>)}</div></div>)}</div></> : <div className="sheet-empty"><Check size={34}/><b>没有发现重复</b><span>棋谱库里的每一份内容都不一样。</span></div>}</div>}
      {sheet === "versions" && <div className="sheet-body version-history-sheet"><div className="support-row"><b>版本历史</b><span>每次保存前自动留一份旧版本（最多 12 份，重要的可以钉住）。回到旧版本时，当前版本会自动留下保护档，所以这个动作可以再来一次。</span></div>{versionHistory.length ? <div className="export-options">{versionHistory.map((record) => { const stamp = new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false }); const nodes = Object.keys(record.document.nodes).length; return <article key={record.id} className="version-history-card"><div className="version-history-copy"><b>{record.summary}{record.pinned ? "（已钉住）" : ""}</b><small>{stamp} · {nodes.toLocaleString()} 个局面 · {record.document.metadata.title || "未命名"}</small></div><div className="version-history-actions"><button onClick={() => { snapshotRepository.pin(record.id, !record.pinned); setVersionHistory(snapshotRepository.list(document.id)); }} aria-label={record.pinned ? `取消钉住 ${record.summary}` : `钉住 ${record.summary}`} title={record.pinned ? "取消钉住" : "钉住（不会被自动清理）"}><Star size={16} fill={record.pinned ? "currentColor" : "none"}/></button><button onClick={() => restoreVersion(record)} aria-label={`回到 ${stamp} 的版本`} title="回到这个版本"><ArchiveRestore size={16}/></button></div></article>; })}</div> : <div className="sheet-empty"><FileClock size={34}/><b>还没有历史版本</b><span>编辑棋谱并保存后，这里会自动留下上一版。</span></div>}</div>}
      {sheet === "trash" && <div className="sheet-body recycle-bin-sheet"><div className="support-row"><b>已删除内容</b><span>删除后会暂存于此，恢复时会保留原来的文件夹归属。{recycleBinRetentionHint(recycleBin.length)}</span></div>{recycleBin.length ? <><div className="recycle-bin-toolbar"><span>{recycleBin.length} 项</span><button className="danger-text-button" onClick={emptyRecycleBin}><Trash2 size={14}/>清空回收站</button></div><div className="recycle-bin-list">{recycleBin.map((entry) => { const isPuzzle = entry.kind === "puzzle-collection"; const title = isPuzzle ? entry.item.title : entry.item.metadata.title; const detail = isPuzzle ? `${entry.item.puzzles.length} 道题 · ${entry.item.source}` : entry.kind === "large-record" ? `大型棋谱 · ${entry.item.nodeCount.toLocaleString()} 节点` : `${entry.item.metadata.black} vs ${entry.item.metadata.white}`; return <article key={`${entry.kind}-${entry.id}`} className="recycle-bin-card"><div className={`recycle-bin-icon ${isPuzzle ? "puzzle" : "record"}`}><ArchiveRestore size={18}/></div><div className="recycle-bin-copy"><b>{title}</b><small>{detail}</small><small>原文件夹：{entry.folder} · {new Date(entry.deletedAt).toLocaleDateString("zh-CN")}</small></div><div className="recycle-bin-actions"><button onClick={() => restoreRecycleEntry(entry)} aria-label={`恢复“${title}”`} title="恢复"><ArchiveRestore size={16}/></button><button className="delete-record" onClick={() => permanentlyDeleteRecycleEntry(entry)} aria-label={`彻底删除“${title}”`} title="彻底删除"><Trash2 size={16}/></button></div></article>; })}</div></> : <div className="sheet-empty"><ArchiveRestore size={34}/><b>回收站是空的</b><span>从棋谱库删除的棋谱、用户题集会先出现在这里。</span></div>}</div>}
            {sheet === "wrongbook" && <div className="sheet-body wrongbook-sheet"><div className="support-row"><b>错题本</b><span>只收录已尝试但当前尚未攻克的题目；标为「已掌握」的题会收起来。</span></div>{wrongPuzzleEntries.length ? <div className="export-options">{wrongPuzzleEntries.map((entry) => <div key={`${entry.collectionId}/${entry.puzzleId}`} className="wrongbook-row"><button className="settings-link wrongbook-open" onClick={() => { setSheet(null); guardedOpenPuzzle(entry.collectionIndex, entry.puzzleIndex); }}><span><Layers3/><b>{entry.puzzleTitle}</b><small>{entry.collectionTitle} · {entry.attempts} 次尝试 · {new Date(entry.updatedAt).toLocaleDateString("zh-CN")}</small></span></button><span className="wrongbook-actions"><button type="button" onClick={() => redoWrongPuzzle(entry)} title="加入重做队列并打开这道题"><Redo2 size={14}/>重做</button><button type="button" onClick={() => markPuzzleMastered(entry, true)} title="从错题本收起来（可再放回）"><Check size={14}/>已掌握</button></span></div>)}</div> : <div className="sheet-empty"><Layers3 size={34}/><b>还没有错题</b><span>先做几道题，没过的题会自动收进这里。</span></div>}{masteredPuzzleKeys.size > 0 && <div className="wrongbook-footer"><span>已掌握 {masteredPuzzleKeys.size} 道</span><button type="button" onClick={clearMasteredPuzzles}><Undo2 size={14}/>全部放回</button></div>}</div>}
      {sheet === "bookmarks" && <div className="sheet-body bookmark-sheet">{Object.keys(branchBookmarks).length ? <>{orphanBookmarkReport.count > 0 && <div className="bookmark-orphan-bar" role="note"><span><b>{orphanBookmarkReport.count} 条失效书签</b><small>指向的节点或棋谱已经不在了（删分支不会带走挂在它上面的书签）。清理后无法撤销。</small></span><button type="button" className="danger-text-button" onClick={cleanOrphanBookmarks}><Trash2 size={14}/>清理</button></div>}<div className="bookmark-records-list">{Object.entries(branchBookmarks).map(([documentId, bookmarks]) => {
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
          })}</div></> : <div className="sheet-empty"><Bookmark size={34}/><b>还没有分支书签</b><span>在棋谱树面板里选中分支节点点书签，即可在这里回看。</span></div>}</div>}
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
        {/* 纯坐标代码（用户 10-07：导出面板缺它）——复制走 .copyCoordinateCode（同一份主线坐标串），
            导出 TXT 走 exportCoordinateTxt；原来这一步只能靠长按棋子 → 环形菜单 → 复制局面，藏得太深。 */}
        <section className="export-coordinate-card" aria-label="纯坐标代码">
          <div className="export-coordinate-copy"><b>纯坐标代码</b><small>主线落子坐标，如 H8 I8 H9；不含分支与过手，粘回导入即可还原</small></div>
          <div className="export-coordinate-actions">
            <button type="button" className="secondary-button" onClick={copyCoordinateCode}><Copy/>复制</button>
            <button type="button" className="secondary-button" onClick={exportCoordinateTxt}><Download/>导出 TXT</button>
          </div>
        </section>
        {sourceFormat === "lib" && <button className="export-primary-card lib-convert" disabled={exportScope !== "whole" || !fullLibSgfAvailable || libSgfExporting} onClick={() => { void exportFullLibAsSgf(); }}><span className="format-icon">SGF</span><div><b>{libSgfExporting ? "正在转换完整 LIB…" : "完整 LIB 转换为 SGF"}</b><small>{exportScope !== "whole" ? "完整 LIB 转换只适用于“整份棋谱”范围" : libSgfSourceTooLarge ? "源文件超过 64MB；转换会额外申请完整 SGF 缓冲区，为避免设备内存不足已停用" : fullLibSgfAvailable ? "由 RenLib 核心转换当前未编辑的完整源棋谱" : "只对当前刚打开且未编辑、仍保留原文件的 LIB 可用"}</small></div><Upload/></button>}
        <section className="export-format-section">
          <div className="export-format-heading"><b>导出格式</b>{exportScope !== "whole" && <small>LIB 与 PSQ 需“整份棋谱”范围</small>}</div>
          <div className="export-format-grid">
            <button type="button" className={recommendedFormat === "sgf" ? "recommended" : ""} onClick={() => exportAsFormat("sgf")} title={`SGF（${exportScopeSuffix(exportScope)}）· 完整变化树、注释、评价和棋盘标注，最通用`}>{recommendedFormat === "sgf" && <em>原格式 · SGF</em>}<span className="format-icon">SGF</span><b>SGF</b></button>
            <button type="button" onClick={() => exportAsFormat("fgf")} title={`FGF（${exportScopeSuffix(exportScope)}）· SGF 语法内容，供按 .fgf 扩展名识别的五子棋软件使用`}><span className="format-icon sgf-family">FGF</span><b>FGF</b></button>
            <button type="button" onClick={() => exportAsFormat("ren")} title={`REN（${exportScopeSuffix(exportScope)}）· SGF 语法内容，按 .ren 扩展名导出`}><span className="format-icon sgf-family">REN</span><b>REN</b></button>
            <button type="button" onClick={() => exportAsFormat("renjs")} title={`RENJS（${exportScopeSuffix(exportScope)}）· SGF 语法内容，按 .renjs 扩展名导出`}><span className="format-icon sgf-family">RENJS</span><b>RENJS</b></button>
            <button type="button" onClick={() => exportAsFormat("wzq")} title={`WZQ（${exportScopeSuffix(exportScope)}）· SGF 语法内容，按 .wzq 扩展名导出`}><span className="format-icon sgf-family">WZQ</span><b>WZQ</b></button>
            <button type="button" className={recommendedFormat === "lib" ? "recommended" : ""} style={exportBlockedReason("lib") ? { opacity: .55 } : undefined} onClick={() => exportAsFormat("lib")} title={exportBlockedReason("lib") || "RenLib 3.x 棋谱库：完整变化树与注释（首手天元且无过手时写 3.0 兼容格式），爱五子棋等连珠软件可读；仅十五路"}>{recommendedFormat === "lib" && <em>原格式 · LIB</em>}<span className="format-icon lib">LIB</span><b>LIB</b></button>
            <button type="button" className={recommendedFormat === "psq" ? "recommended" : ""} style={exportBlockedReason("psq") ? { opacity: .55 } : undefined} onClick={() => exportAsFormat("psq")} title={exportBlockedReason("psq") || "Piskvorky 视角棋谱（x,y,颜色），弈心 / Gomocup 兼容，只保留主线"}>{recommendedFormat === "psq" && <em>原格式 · PSQ</em>}<span className="format-icon psq">PSQ</span><b>PSQ</b></button>
            <button type="button" className={recommendedFormat === "json" ? "recommended" : ""} onClick={() => exportAsFormat("json")} title={`JSON（${exportScopeSuffix(exportScope)}）· 半步原生数据，保留完整可编辑信息`}>{recommendedFormat === "json" && <em>原格式 · JSON</em>}<span className="format-icon json">JSON</span><b>JSON</b></button>
            <button type="button" className={recommendedFormat === "db" ? "recommended" : ""} disabled={recommendedFormat !== "db"} onClick={() => { if (recommendedFormat === "db") exportDirect(); }} title={recommendedFormat === "db" ? `按原格式 ${sourceFormat ? sourceFormat.toUpperCase() : "DB"} 原样导出（局面数据库不重新编码）` : "DP / DB 局面数据库可原样导出已打开的源文件，但不重新编码或生成新数据库"}>{recommendedFormat === "db" && <em>原格式 · {sourceFormat ? sourceFormat.toUpperCase() : "DB"}</em>}<span className="format-icon muted">DB</span><b>DB</b></button>
          </div>
          <small className="format-fidelity">{fidelityNote}</small>
        </section>
        <button className={`export-primary-card direct${recommendDirect ? " recommended" : ""}`} style={exportBlockedReason("direct") ? { opacity: .55 } : undefined} onClick={exportDirect}>{recommendDirect && <em className="direct-flag">原格式{sourceFormat ? ` · ${sourceFormat.toUpperCase()}` : ""}</em>}<span className="format-icon direct"><Download/></span><div><b>原格式直接导出</b><small>{exportBlockedReason("direct") || (sourceFormat ? `按 ${sourceFormat.toUpperCase()} 原样导出${binarySourceFormats.has(sourceFormat) ? "完整原库与全部注释" : ""}` : "当前没有原始格式，将按默认 SGF 导出")}</small></div><Upload/></button>
      </div>}
       {sheet === "help" && <div className="sheet-body help-content"><div className="support-row"><b>棋谱导入</b><span>RenLib 3.x / 旧版无头 LIB（按设备能力分页导入）、SGF / FGF、REN / RENJS / WZQ（SGF 语法）、JSON、POS，以及 DP / DB 局面数据库。SGF 支持设置局面、过手、UTF-16 和同文件多盘棋。</span></div><div className="support-row"><b>导出与保真</b><span>可导出 SGF、FGF、REN、RENJS、WZQ（均为 SGF 语法内容，扩展名供不同软件识别）、RenLib LIB（十五路，含变化树与注释，首手天元且无过手时写 3.0 兼容格式，爱五子棋等连珠软件可读）、Piskvorky PSQ（只剩主线）、JSON，以及纯坐标代码 TXT（导出面板「纯坐标代码」一张卡里复制或导出；POS 只支持导入）。普通 SGF 和 JSON 会重新生成当前完整变化树。当前刚打开且未编辑的 LIB 在 64MB 以内可由 RenLib 核心完整转换为 SGF，也可原文件直出；大型 LIB 只允许原文件直出或导出当前可见内容。编辑副本可导出 LIB / SGF / JSON 等，但不会写回源 LIB。DP / DB 可原文件直出或导出当前可见内容，不生成新数据库。棋谱库的「批量处理 → 更多 → 批量导出」把选中的棋谱打包成一个 ZIP（每份 SGF + 一份 README 说明份数与格式），选多少导多少；FGF / REN / RENJS / WZQ 与 SGF 内容相同，改扩展名即可。</span></div><div className="support-row"><b>规则与开局</b><span>连珠规则：黑方恰五获胜、白方五个以上获胜，黑方受三三、四四、长连禁手约束；标准五子棋：双方无禁手，必须恰好五连；自由五子棋：双方无禁手，五个以上即可获胜。开局规则目前支持自由开局、无禁 6 不胜、一手交换、三手交换、五手两打、五手多打（山口：先手方开局时宣布 1–15 打，打点之间不得同形）、索索夫-8（白4后宣布 1–8 打，宣布后可再交换）、Swap2（无禁手二次交换：先手连下三子后，后手在执白/执黑/再补两子间选择）、塔十（塔拉山口-10：第4手后先决定交换，再由黑方选单点第5手或摆十个打点）和塔拉（五次交换），可在人机设置的“规则说明”中比较。</span></div><div className="support-row"><b>JSON 的用途</b><span>棋谱库读取本软件的完整变化树或带明确 moves 字段的落子列表对象；题库页读取 puzzles 包装题库、连续坐标串、黑白分色坐标串和旧版二维数组。数字坐标棋谱必须声明 coordinateBase，不猜测任意数组。</span></div><div className="support-row"><b>AI 完全本地</b><span>人机与“思考”使用应用内置 Rapfi WASM 数据，不访问 gomocalc.com，也不会上传当前棋局。</span></div><div className="support-row warning"><b>棋盘路数边界</b><span>棋盘支持 5–30 路方形棋盘，范围外的 SGF SZ 超出 5–30 会明确拒绝，不会缩放后生成错误棋谱；内置题库固定为十五路。</span></div><div className="support-row warning"><b>TXT 不是统一棋谱标准</b><span>TXT 仅作为纯文本坐标序列兼容入口，例如 H8 I8 H9；带专有结构的文本应使用原软件导出的 SGF。</span></div><div className="support-row warning"><b>LIB 兼容边界</b><span>大型 LIB 在后台线程解析并按页存储。完整转 SGF 会额外申请整份输出缓冲区，因此源文件超过 64MB 时主动停用，避免手机或低内存设备崩溃。原谱的普通注释、局面文字和 RenLib 标记会分别保留并在节点详情中显示；超出 RenLib 3.4 的扩展仍会提示。导出 LIB 仅支持十五路；摆局面节点无法在 LIB 中表达，导出时会提升其子分支并提示。</span></div><h3>手机快捷操作</h3><ul><li>点空交叉点：落子；点已有棋子：退回一手，连着点连着退（电脑上右键同样回退；人机对局与做题时不生效）</li><li>底部“标注”：放置数字、胜败平衡和自定义文字</li><li>长按空交叉点：圆圈 → 三角 → 叉号 → 清除；长按已有棋子：呼出两层环形菜单——内环三格切页（通用 / 分支 / 编辑），外环六槽是这一页的动作，点一格或沿环滑过去都切页、切页不关菜单。通用页：去子 / 加书签 / 复制局面（主线纯坐标串，可粘回导入）/ 跳到此手 / 打标（好棋→坏棋→疑问手→清除，标上的那手在子右上角画角标，导出 SGF 写 TE / BM / DO）；分支页：设为主分支 / 复制分支 / 粘贴到这里 / 跳到此手 / 删除这一手及之后（先弹确认，保存前可撤销）；编辑页：位移 / 旋转 / 镜像 / 撤销 / 重做。标注不进菜单（底部标注栏有 6 个文字组 × 12 样式 × 12 颜色，一圈按钮镜像不过来），长按空位仍然是圆圈→三角→叉号→清除</li><li>棋盘下方的手数条：轨道里显示「当前/总手数」，拖动连续跳手，点一下走一手</li><li>外接键盘：左右方向键前后导航、数字键跳到第 N 手、读谱空格播放/暂停、打谱 Delete 删除当前这一手</li></ul><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></div>}
      {sheet === "about" && <AboutPanel initialView={aboutInitialView} onClose={() => setSheet(null)}/>}
      {sheet === "feedback" && <FeedbackPanel version={APP_VERSION} location={tab === "settings" ? "设置" : tab === "library" ? "棋谱库" : "打谱"} onNotice={setToast}/>}
      {sheet === "manual" && <Suspense fallback={<div className="sheet-body" style={{ padding: 20 }}><p className="helper">手册加载中…</p></div>}><UserManual onClose={() => setSheet(null)} onOpenRules={() => setSheet("rules")} onStartGuide={startManualGuide} focusSection={manualFocusSection}/></Suspense>}
      {sheet === "rules" && (
        <RuleGuide onOpenManual={() => setSheet("manual")}/>
      )}
    </BottomSheet>}
    {engineSwitch && createPortal(
      <EngineSwitchOverlay
        from={aiEngineChoiceLabel(engineSwitch.from)}
        to={aiEngineChoiceLabel(engineSwitch.to)}
        channel={engineSwitch.channel}
        status={engineSwitch.status}
        percent={engineSwitch.percent}
        phase={engineSwitch.phase}
        error={engineSwitch.error}
        canCancel={engineSwitch.canCancel}
        fallbackLabel={engineSwitch.fallbackLabel}
        onRetry={engineSwitch.retryAction}
        onFallback={engineSwitch.fallbackAction}
        onCancel={() => { if (!engineSwitch.canCancel) return; if (engineSwitchWatchdogRef.current !== null) window.clearTimeout(engineSwitchWatchdogRef.current); setEngineSwitch(null); engineSwitchTargetRef.current = null; }}
        onClose={() => { if (engineSwitchWatchdogRef.current !== null) { window.clearTimeout(engineSwitchWatchdogRef.current); engineSwitchWatchdogRef.current = null; } setEngineSwitch(null); engineSwitchTargetRef.current = null; }}
      />,
      window.document.body,
    )}
    {/* 识谱叠图核对（用户 09-17）：识别完先核对、可改子，确认后才建谱并进编辑面板。 */}
      {imageVerify && createPortal(
        <ImageVerifyScreen
          url={imageVerify.url}
          name={imageVerify.name}
          board={imageVerify.board}
          boardRevision={imageVerify.boardRevision ?? 1}
          onBoardChange={(next) => setImageVerify((current) => (current && current.board !== next ? { ...current, board: next } : current))}
          boardSize={imageVerify.boardSize}
          grid={imageVerify.grid}
          gridCanvas={imageVerify.gridCanvas}
          note={imageVerify.note}
          confidence={imageVerify.confidence}
          editable={imageVerify.editable}
          numberAt={verifyNumberAt}
          localRestoreBusy={localRestoreBusy}
          onLocalRestore={() => { void runLocalMoveOrderRestore(); }}
          restoreAttempted={restoreAttempted}
          readCount={(imageVerify.partialNumbers?.length ?? 0) || imageVerify.numberedMoves.length}
          stoneCount={imageVerify.board.flat().filter(Boolean).length}
          reRestoreBusy={reRestoreBusy}
          onReRestore={() => { void runReMoveOrderRestore(); }}
          completeRestoreBusy={completeRestoreBusy}
          onCompleteRestore={() => { void runCompleteMoveOrderRestore(); }}
          aiRestoreConfigured={isAiVisionConfigured(aiVision)}
          aiRestoreBusy={aiRestoreBusy}
          onAiRestore={() => { void runAiMoveOrderRestore(); }}
          aiRecogBusy={aiRecogBusy}
          onAiRecog={() => { void runAiBoardRecognize(); }}
          onConfirm={openVerifiedRecognition}
          onBack={() => { closeImageVerify(); setSheet("imageImport"); }}
          onCancel={() => { closeImageVerify(); setSheet(null); }}
        />,
        window.document.body,
      )}
  </div>;
}
