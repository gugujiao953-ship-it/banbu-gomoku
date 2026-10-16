import { exportLargeStorageRecords, replaceLargeStorageRecords, type LargeStorageRecords } from "./large-storage";
import { BOARD_SIZE, isSupportedBoardSize } from "./game";
import type { GameDocument } from "./types";
import { isLibraryOrderMaps } from "./library-order";
import { validateJsonDocument } from "./formats";
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings, SOUND_SETTINGS_KEY, type SoundSettings } from "./audio-settings";
import { MOTION_SETTINGS_KEY, normalizeMotionEnabled } from "./motion-settings";
import { contentHash } from "./features/data-safety/export-semantics";
import { DEFAULT_STONE_OPACITY, STONE_OPACITY_KEY, normalizeStoneOpacity } from "./stone-opacity";
import { BOARD_OPACITY_KEY, DEFAULT_BOARD_OPACITY, normalizeBoardOpacity } from "./board-opacity";
import { PUZZLE_RULE_PREFERENCE_KEY, type PuzzleRuleMode } from "./features/puzzles/puzzle-rules";
import type { BoardTheme, ResolvedTheme, StoneTheme, ThemePreference } from "./app-shell-types";
import { FONT_SCALE_STORAGE_KEY, type FontScale } from "./accessibility";
import { DEFAULT_ENHANCEMENT_SETTINGS, ENHANCEMENT_SETTINGS_KEY, normalizeEnhancementSettings, type EnhancementSettings } from "./enhancement-settings";
import { ANNOTATION_HIGHLIGHT_KEY, DEFAULT_ANNOTATION_HIGHLIGHT, normalizeAnnotationHighlight, type AnnotationHighlight } from "./annotation-highlight";
import { ANALYSIS_CACHE_KEY } from "./features/ai/analysis-cache";
import { GAME_REVIEW_STORAGE_KEY } from "./features/research/game-review";
import { FAVORITES_KEY } from "./library-favorites";
import { QUICK_DRAWER_STORAGE_KEY } from "./quick-drawer-customization";
import { ONLINE_PROXY_TEMPLATE_KEY } from "./features/online/online-http";
import { UPDATE_AUTO_CHECK_KEY, UPDATE_PROMPT_DISMISSED_KEY } from "./update-settings";
// 成就与棋魂（2026-10-09）：解锁记录与棋魂账本是用户攒出来的资产，必须进备份
// （对照下面 09-22 那批「换机即永久丢失」的教训）。
import { ACHIEVEMENT_STATE_KEY } from "./features/progress/achievements";
import { resetSoulLedger, SOUL_LEDGER_KEY } from "./features/progress/soul";
// 棋盘/棋子的校验白名单从这里取（材质注册表是唯一来源，见下方 backupBoardThemes 的注释）
import { materialBoards, materialStones } from "./appearance/render";
import { CUSTOM_UI_THEME_KEY, isCustomUiTheme } from "./custom-ui-theme";
import { isThemePreference } from "./theme-options";

const SCHEMA = "banbu-gomoku-backup" as const;
const VERSION = 1 as const;
const DRAFT_PREFIX = "renju-note-draft-v2:";
const LOCAL_KEYS = {
  library: "renju-note-library-v1",
  active: "renju-note-active-v1",
  puzzleCollections: "renju-note-puzzle-collections-v1",
  puzzleProgress: "renju-note-puzzle-progress-v1",
  puzzleRulePreference: PUZZLE_RULE_PREFERENCE_KEY,
  puzzleTitleOverrides: "renju-note-puzzle-title-overrides-v1",
  libraryFolders: "renju-note-library-folders-v1",
  branchBookmarks: "renju-note-branch-bookmarks-v1",
  defaultDocument: "renju-note-default-v1",
  activeLargeRecord: "banbu-active-large-record-v1",
  recycleBin: "banbu-recycle-bin-v1",
  themePreference: "banbu-theme-preference-v1",
  displaySettings: "renju-note-display-settings-v1",
  soundSettings: SOUND_SETTINGS_KEY,
  motionEnabled: MOTION_SETTINGS_KEY,
  stoneOpacity: STONE_OPACITY_KEY,
  boardOpacity: BOARD_OPACITY_KEY,
  boardTheme: "banbu-board-theme-v1",
  stoneTheme: "banbu-stone-theme-v1",
  customBackgroundColor: "banbu-custom-background-color-v1",
  customBackgroundImage: "banbu-custom-background-image-v1",
  customUiTheme: CUSTOM_UI_THEME_KEY,
  defaultBoardSize: "banbu-default-board-size-v1",
  fontScale: FONT_SCALE_STORAGE_KEY,
  enhancementSettings: ENHANCEMENT_SETTINGS_KEY,
  annotationHighlight: ANNOTATION_HIGHLIGHT_KEY,
  // 分析结果沉淀与整局复盘数据（用户 09-17）：随手记但也是用户资产，必须进备份——
  // 收藏（FAVORITES_KEY）漏出键表导致换机即丢的教训不能重演。
  analysisCache: ANALYSIS_CACHE_KEY,
  gameReview: GAME_REVIEW_STORAGE_KEY,
  // 2026-09-19 补齐：这五个键以前都不在备份里——换机/重装后收藏、快捷中心自定义、
  // 在线代理地址、更新偏好全部丢失（审计里点名的「收藏漏出键表」同类事故，一并修）。
  favorites: FAVORITES_KEY,
  quickDrawer: QUICK_DRAWER_STORAGE_KEY,
  onlineProxy: ONLINE_PROXY_TEMPLATE_KEY,
  updateAutoCheck: UPDATE_AUTO_CHECK_KEY,
  updateDismissed: UPDATE_PROMPT_DISMISSED_KEY,
  // 2026-09-22 补齐：这五个键是用户手工攒出来的学习成果（复盘标注、分支命名、
  // 每日一题、自定义布局），以前不在备份里，换机/重装即永久丢失。
  reviewMarks: "banbu-review-marks-v1",
  reviewBranchNames: "banbu-review-branch-names-v1",
  dailyTraining: "banbu-daily-training-v1",
  actionLayout: "banbu-action-layout-v1",
  actionLayoutPresets: "banbu-action-layout-presets-v1",
  // 2026-10-09：成就解锁记录与棋魂账本。注意**信号位**（banbu-achievement-signals-v1）
  // 故意不进备份——它是可达性信号，换机后重新触发即可；而这两份是用户的既得成果。
  achievements: ACHIEVEMENT_STATE_KEY,
  soulLedger: SOUL_LEDGER_KEY,
  /**
   * 2026-10-11 补：棋魂商店的**解锁集合**与其它"花棋魂换来的东西"。
   *
   * ⚠ 上一版只备份了**账本**（钱）而**没备份买到了什么** —— 这是个很糟的组合：
   * 恢复备份/换机之后余额还在（钱在流水里），但买过的主题、棋盘、棋子、
   * VCF 道具全部回到"没买"状态，而钱已经在流水里扣掉了。
   * 用户看到的是"我的钱花了，东西没了"，而且**根本怪不到备份头上**。
   * 这正是本项目反复吃过的那一类（收藏漏出键表、复盘标注漏出键表…），
   * 所以三个键一起补进来：
   *  · `banbu-soul-unlocks-v1` —— 买断了哪些外观；
   *  · `banbu-vcf-items-v1`    —— 还剩几张道具卡（同样是花棋魂买的）；
   *  · `banbu-vcf-level-paid-v1` —— 等级奖励发到第几级的水位线。
   *    这个也**必须**跟账本一起走：它和账本是一对（奖励发过没发过），
   *    只恢复账本会让已发的等级奖励重新变成"可发"，而流水里的 token 可能
   *    已被折叠丢掉 ⇒ 再解一题就重发一遍。
   *  · `banbu-soul-tuning-v1` —— 调度项（倍率/上限/开关）。它不是"资产"而是**偏好**，
   *    但和外观设置同类（都是用户自己调过的选择），所以一并带上。
   */
  soulUnlocks: "banbu-soul-unlocks-v1",
  vcfItems: "banbu-vcf-items-v1",
  vcfLevelPaid: "banbu-vcf-level-paid-v1",
  soulTuning: "banbu-soul-tuning-v1",
  /**
   * 2026-10-11 补：**VCF 挑战状态**（解答力等级分、已解题、错题、连胜、每日、做题记录）。
   *
   * ⚠ 这是个真漏洞，不是"锦上添花"：上一版 `LOCAL_KEYS` 里**根本没有这个键**
   * （`vcfch-state-v1` 定义在 `vcf-challenge/rating.ts:20`），所以
   * **换机 / 重装 / 恢复备份之后，解答力会整个归零** —— 等级分回到最低档（1 级 = 0 分）、
   * 几百道已解题的记录全丢、连胜与每日进度清空。
   *
   * 为什么这条比"少备份一个设置"严重得多：
   *  · 解答力是这个玩法**唯一的进度载体**，用户为它花了真实时间；
   *  · 商店里「VCF 起始等级」五档**卖 500–1600 棋魂**（`action-vcf-start-1/3/6/9/12`）——
   *    也就是说"把解答力往上调"是明码标价的商品，而备份一恢复就白丢；
   *  · 它还会连带影响等级奖励：水位线（上面那个键）恢复了、等级分却没了，
   *    于是"发到第几级"与"现在是第几级"对不上（水位线只升不降，
   *    所以不会重发，但用户会看到"我买过的等级没了"）。
   *
   * 恢复语义与上面四键相同（见 `PRESERVE_ON_RESTORE`）：旧备份里没有这个键时
   * **保持本机现状**，而不是把它清成空 —— 否则"用旧备份恢复"会把解答力抹掉。
   */
  vcfChallenge: "vcfch-state-v1",
} as const;

export interface BackupLocalStorage {
  library: unknown[];
  active: unknown | null;
  drafts: Record<string, unknown>;
  puzzleCollections: unknown[];
  puzzleProgress: Record<string, unknown>;
  puzzleRulePreference?: PuzzleRuleMode;
  puzzleTitleOverrides: { collections: Record<string, string>; puzzles: Record<string, string> };
  libraryFolders: {
    recordFolders: string[];
    puzzleFolders: string[];
    recordAssignments: Record<string, string>;
    puzzleAssignments: Record<string, string>;
    order?: Record<string, Record<string, string[]>>;
  };
  branchBookmarks: Record<string, unknown>;
  defaultDocument: unknown | null;
  activeLargeRecord: string | null;
  recycleBin: unknown[];
  themePreference: ThemePreference;
  displaySettings: { showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean; showLastMove?: boolean; moveNumberScale?: number; gridLineWidth?: number; coordinateFontSize?: number };
  soundSettings?: SoundSettings;
  motionEnabled?: boolean;
  stoneOpacity?: number;
  boardOpacity?: number;
  /** Optional so backups made before the expanded appearance system stay valid. */
  boardTheme?: BoardTheme;
  stoneTheme?: StoneTheme;
  customBackgroundColor?: string;
  customBackgroundImage?: string;
  /** 「自定义背景」的界面主题（2026-10-12）。旧备份没有它，可选。 */
  customUiTheme?: ResolvedTheme;
  defaultBoardSize?: number;
  fontScale?: FontScale;
  enhancementSettings?: EnhancementSettings;
  annotationHighlight?: AnnotationHighlight;
  /** 分析结果沉淀 / 整局复盘数据。旧备份没有这两个键，必须可选。 */
  analysisCache?: Record<string, unknown>;
  gameReview?: Record<string, unknown>;
  /** 收藏 / 快捷中心自定义 / 在线代理 / 更新偏好（2026-09-19 补进备份）。 */
  favorites?: { records: string[]; puzzleCollections: string[]; puzzles: Record<string, string[]> };
  quickDrawer?: Record<string, unknown>;
  onlineProxy?: string;
  updateAutoCheck?: boolean;
  updateDismissed?: string;
  /** 成就解锁记录（id → 时刻）与棋魂账本（流水数组）。旧备份没有这两个键，必须可选。 */
  achievements?: Record<string, unknown>;
  soulLedger?: unknown[];
  /**
   * 棋魂买来的东西（2026-10-11 补进备份）。**没有这几个键的旧备份仍然合法** ——
   * 恢复时按"缺失即跳过"处理（不能因为旧备份没这几项就拒绝导入）。
   *
   * ⚠ 它们必须和 `soulLedger` 一起走：只恢复账本会让"钱还在、东西没了"
   * （详见 LOCAL_KEYS 那段注释）。
   */
  soulUnlocks?: unknown[];
  vcfItems?: Record<string, unknown>;
  vcfLevelPaid?: string;
  soulTuning?: Record<string, unknown>;
  /** 用户手工产出的学习内容（2026-09-22 补进备份）：复盘标注、分支命名、
   * 每日一题记录、自定义布局预设。这几个都是用户一个个点/打字攒出来的，
   * 换机重装后无法复原，和当年收藏漏出键表是同一类事故。 */
  reviewMarks?: Record<string, unknown>;
  reviewBranchNames?: Record<string, unknown>;
  dailyTraining?: Record<string, unknown>;
  actionLayout?: Record<string, unknown>;
  actionLayoutPresets?: unknown[];
  /**
   * VCF 挑战状态（2026-10-11 补）。**不校验内部结构**，只要求"是个对象"——
   * 理由是它由 `vcf-challenge/rating.ts` 自己的 `loadState()` 做逐字段归一化
   * （缺字段补默认、坏值回落），比在这里再抄一份校验可靠得多。
   * 备份的职责是"原样搬运"，不是"重新定义别人的数据格式"。
   */
  vcfChallenge?: Record<string, unknown>;
}

export interface BackupSnapshot {
  schema: typeof SCHEMA;
  version: typeof VERSION;
  /** Stable schema marker for newer tooling; `version` remains for v1 import compatibility. */
  schemaVersion?: 1;
  appVersion: string;
  exportedAt: string;
  contentHash?: string;
  /**
   * 这份快照的范围（2026-10-11 随本机凭证一起加）。
   *
   * **可选**：老备份没有这个字段 —— 那时按 `"full"` 理解（它们本来就是全量）。
   * 校验**不检查**它的值（未知值当 full 处理即可，不必因此判一份备份非法）——
   * 它是给"凭证自动写入"用的标记，不是数据结构的一部分。
   */
  scope?: BackupScope;
  compatibility?: { importableBy: string[]; notes: string[] };
  contentSummary?: { records: number; puzzles: number; drafts: number; largeRecords: number; includesHistory: boolean };
  localStorage: BackupLocalStorage;
  indexedDb: LargeStorageRecords;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isStringRecord = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every((item) => typeof item === "string");
const isSoundSettings = (value: unknown): value is SoundSettings => isRecord(value)
  && typeof value.enabled === "boolean" && typeof value.feedbackEnabled === "boolean"
  // moveEnabled pre-dates the merged stone-sound switch; navigateEnabled may be absent in old backups
  && (value.moveEnabled === undefined || typeof value.moveEnabled === "boolean")
  && (value.navigateEnabled === undefined || typeof value.navigateEnabled === "boolean")
  && typeof value.volume === "number" && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1
  // "jade" was a profile for one day only; normalizeSoundSettings maps it to "classic" on load
  && (value.profile === undefined || value.profile === "classic" || value.profile === "wood" || value.profile === "crystal" || value.profile === "jade" || value.profile === "real");
/**
 * 棋盘 / 棋子主题的**校验白名单**。
 *
 * ⚠ 2026-10-10 修的真 bug：这两份原来是**手抄的老 14 套**（`wood, jade, …, aurora`），
 * 而外观早就不止那 14 套 —— 皮肤实验室搬进来的那批（`pencil-forest`、`gu-xuanzhi`、
 * `dh-feitian`…）以及本次新增的 `soul-inkflame` **都不在名单里**。
 *
 * 后果比"少几个选项"严重：`isBoardTheme` 返回 false ⇒ 备份里**静默写成兜底的
 * `wood`**（见下面 boardTheme 那一行），也就是**用实验室材质的用户，备份出去的
 * 其实是他没在用的默认盘**；还原之后外观还会被改掉。
 * 这类"校验名单漏一项就悄悄改数据"的坑，本项目在主题清单上已经踩过一次
 * （见 theme-options.ts 文件头："5 个门禁各写一份 7 项主题列表"）。
 *
 * 所以现在**从材质注册表现取**（`materialBoards()` / `materialStones()` 是同一份
 * 数据的唯一来源，`soul-unlocks.ts` 的定价也是这么做的），再并上只存在于类型里的
 * 老 id（退役的 notebook/porcelain/frosted 等 —— 老存档可能还记着，
 * 得让它**通过校验**而不是被改写成默认）。
 */
const LEGACY_BOARD_IDS: readonly string[] = ["wood", "jade", "notebook", "emerald", "porcelain", "whitejade", "walnut", "frosted", "circuit", "minimal", "blackgold", "pale", "kawaii", "aurora"];
const LEGACY_STONE_IDS: readonly string[] = ["classic", "jade", "yun", "ink", "mono", "notebook", "porcelain", "snow", "terminal", "gold-diamond", "gold", "diamond", "blackgold", "pale", "kawaii", "aurora"];
const backupBoardThemes: readonly string[] = [...new Set([...LEGACY_BOARD_IDS, ...materialBoards().map((m) => m.src)])];
const backupStoneThemes: readonly string[] = [...new Set([...LEGACY_STONE_IDS, ...materialStones().map((m) => m.src)])];
const isBoardTheme = (value: unknown): value is BoardTheme => typeof value === "string" && backupBoardThemes.includes(value);
const isStoneTheme = (value: unknown): value is StoneTheme => typeof value === "string" && backupStoneThemes.includes(value);
const isFontScale = (value: unknown): value is FontScale => value === "normal" || value === "large" || value === "xlarge";
// 边界必须跟着题目的路数走：写死 15 会把 >15 路题目的棋子判成非法，
// 备份/还原时整题被静默丢弃（引擎已支持多路数，19 路题目是合法数据）。
const hasValidPoint = (value: unknown, boardSize = BOARD_SIZE) => {
  if (!isRecord(value)) return false;
  const row = value.row, col = value.col;
  return Number.isInteger(row) && Number.isInteger(col) && Number(row) >= 0 && Number(row) < boardSize && Number(col) >= 0 && Number(col) < boardSize;
};

const isGameDocument = (value: unknown): value is GameDocument => {
  try { validateJsonDocument(value); return true; } catch { return false; }
};

const isPuzzle = (value: unknown) => isRecord(value)
  && typeof value.id === "string" && typeof value.title === "string" && typeof value.prompt === "string"
  && (value.player === "black" || value.player === "white") && Number.isInteger(value.difficulty) && Number(value.difficulty) >= 1 && Number(value.difficulty) <= 5
  // 老题库不带 boardSize，按 15 路兜底；带了就按它自己那一路校验。
  && Array.isArray(value.stones) && value.stones.every((stone) => hasValidPoint(stone, isSupportedBoardSize(Number(value.boardSize)) ? Number(value.boardSize) : BOARD_SIZE) && isRecord(stone) && (stone.player === "black" || stone.player === "white"));

const isPuzzleCollection = (value: unknown) => isRecord(value)
  && typeof value.id === "string" && typeof value.title === "string" && typeof value.source === "string" && typeof value.license === "string"
  && Array.isArray(value.puzzles) && value.puzzles.every(isPuzzle);

const jsonValue = (key: string): unknown => {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

const captureLocalStorage = (): BackupLocalStorage => {
  const drafts: Record<string, unknown> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(DRAFT_PREFIX)) drafts[key] = jsonValue(key);
  }
  const rawTheme = localStorage.getItem(LOCAL_KEYS.themePreference);
  const theme = isThemePreference(rawTheme) ? rawTheme : jsonValue(LOCAL_KEYS.themePreference);
  const display = jsonValue(LOCAL_KEYS.displaySettings);
  return {
    library: Array.isArray(jsonValue(LOCAL_KEYS.library)) ? jsonValue(LOCAL_KEYS.library) as unknown[] : [],
    active: jsonValue(LOCAL_KEYS.active),
    drafts,
    puzzleCollections: Array.isArray(jsonValue(LOCAL_KEYS.puzzleCollections)) ? jsonValue(LOCAL_KEYS.puzzleCollections) as unknown[] : [],
    puzzleProgress: isRecord(jsonValue(LOCAL_KEYS.puzzleProgress)) ? jsonValue(LOCAL_KEYS.puzzleProgress) as Record<string, unknown> : {},
    puzzleRulePreference: localStorage.getItem(LOCAL_KEYS.puzzleRulePreference) === "forbidden" ? "forbidden" : "unrestricted",
    puzzleTitleOverrides: isRecord(jsonValue(LOCAL_KEYS.puzzleTitleOverrides)) ? {
      collections: isStringRecord(jsonValue(LOCAL_KEYS.puzzleTitleOverrides) && (jsonValue(LOCAL_KEYS.puzzleTitleOverrides) as Record<string, unknown>).collections) ? (jsonValue(LOCAL_KEYS.puzzleTitleOverrides) as { collections: Record<string, string> }).collections : {},
      puzzles: isStringRecord(jsonValue(LOCAL_KEYS.puzzleTitleOverrides) && (jsonValue(LOCAL_KEYS.puzzleTitleOverrides) as Record<string, unknown>).puzzles) ? (jsonValue(LOCAL_KEYS.puzzleTitleOverrides) as { puzzles: Record<string, string> }).puzzles : {},
    } : { collections: {}, puzzles: {} },
    libraryFolders: (() => {
      const value = jsonValue(LOCAL_KEYS.libraryFolders);
      return isRecord(value) ? {
        recordFolders: Array.isArray(value.recordFolders) ? value.recordFolders.filter((item): item is string => typeof item === "string") : [],
        puzzleFolders: Array.isArray(value.puzzleFolders) ? value.puzzleFolders.filter((item): item is string => typeof item === "string") : [],
        recordAssignments: isStringRecord(value.recordAssignments) ? value.recordAssignments : {},
        puzzleAssignments: isStringRecord(value.puzzleAssignments) ? value.puzzleAssignments : {},
        ...(isLibraryOrderMaps(value.order) ? { order: value.order } : {}),
      } : { recordFolders: [], puzzleFolders: [], recordAssignments: {}, puzzleAssignments: {} };
    })(),
    branchBookmarks: isRecord(jsonValue(LOCAL_KEYS.branchBookmarks)) ? jsonValue(LOCAL_KEYS.branchBookmarks) as Record<string, unknown> : {},
    defaultDocument: jsonValue(LOCAL_KEYS.defaultDocument),
    activeLargeRecord: typeof localStorage.getItem(LOCAL_KEYS.activeLargeRecord) === "string" ? localStorage.getItem(LOCAL_KEYS.activeLargeRecord) : null,
    recycleBin: Array.isArray(jsonValue(LOCAL_KEYS.recycleBin)) ? jsonValue(LOCAL_KEYS.recycleBin) as unknown[] : [],
    themePreference: isThemePreference(theme) ? theme : "system",
    displaySettings: isRecord(display) ? {
      showNumbers: display.showNumbers !== false,
      showCoordinates: display.showCoordinates !== false,
      showForbidden: display.showForbidden !== false,
      showLastMove: display.showLastMove !== false,
      moveNumberScale: typeof display.moveNumberScale === "number" && Number.isFinite(display.moveNumberScale) && display.moveNumberScale > 0 ? display.moveNumberScale : undefined,
      gridLineWidth: typeof display.gridLineWidth === "number" && Number.isFinite(display.gridLineWidth) && display.gridLineWidth > 0 ? display.gridLineWidth : undefined,
      coordinateFontSize: typeof display.coordinateFontSize === "number" && Number.isFinite(display.coordinateFontSize) && display.coordinateFontSize > 0 ? display.coordinateFontSize : undefined,
    } : { showNumbers: true, showCoordinates: true, showForbidden: true, showLastMove: true },
    soundSettings: normalizeSoundSettings(jsonValue(LOCAL_KEYS.soundSettings)),
    motionEnabled: normalizeMotionEnabled(jsonValue(LOCAL_KEYS.motionEnabled)),
    stoneOpacity: normalizeStoneOpacity(jsonValue(LOCAL_KEYS.stoneOpacity)),
    boardOpacity: normalizeBoardOpacity(jsonValue(LOCAL_KEYS.boardOpacity)),
    boardTheme: isBoardTheme(localStorage.getItem(LOCAL_KEYS.boardTheme)) ? localStorage.getItem(LOCAL_KEYS.boardTheme) as BoardTheme : "wood",
    stoneTheme: isStoneTheme(localStorage.getItem(LOCAL_KEYS.stoneTheme)) ? localStorage.getItem(LOCAL_KEYS.stoneTheme) as StoneTheme : "classic",
    customBackgroundColor: /^#[0-9a-f]{6}$/i.test(localStorage.getItem(LOCAL_KEYS.customBackgroundColor) || "") ? localStorage.getItem(LOCAL_KEYS.customBackgroundColor)! : "#e8e4dc",
    customBackgroundImage: (localStorage.getItem(LOCAL_KEYS.customBackgroundImage) || "").startsWith("data:image/") ? localStorage.getItem(LOCAL_KEYS.customBackgroundImage)! : "",
    customUiTheme: isCustomUiTheme(localStorage.getItem(LOCAL_KEYS.customUiTheme)) ? localStorage.getItem(LOCAL_KEYS.customUiTheme) as ResolvedTheme : "light",
    defaultBoardSize: (() => { const size = Number(localStorage.getItem(LOCAL_KEYS.defaultBoardSize) || 15); return isSupportedBoardSize(size) ? size : 15; })(),
    fontScale: isFontScale(localStorage.getItem(LOCAL_KEYS.fontScale)) ? localStorage.getItem(LOCAL_KEYS.fontScale) as FontScale : "normal",
    enhancementSettings: normalizeEnhancementSettings(jsonValue(LOCAL_KEYS.enhancementSettings)),
    annotationHighlight: normalizeAnnotationHighlight(localStorage.getItem(LOCAL_KEYS.annotationHighlight)),
    analysisCache: isRecord(jsonValue(LOCAL_KEYS.analysisCache)) ? jsonValue(LOCAL_KEYS.analysisCache) as Record<string, unknown> : {},
    gameReview: isRecord(jsonValue(LOCAL_KEYS.gameReview)) ? jsonValue(LOCAL_KEYS.gameReview) as Record<string, unknown> : {},
    // 成就与棋魂（2026-10-09）：解锁记录是 id→时刻的对象；棋魂是流水数组。
    // 两者都按「结构像样才收，否则给空」处理——坏数据不该让整份备份判非法。
    achievements: isRecord(jsonValue(LOCAL_KEYS.achievements)) ? jsonValue(LOCAL_KEYS.achievements) as Record<string, unknown> : {},
    soulLedger: Array.isArray(jsonValue(LOCAL_KEYS.soulLedger)) ? jsonValue(LOCAL_KEYS.soulLedger) as unknown[] : [],
    // 棋魂买来的东西（2026-10-11 补）。与上面同一口径：结构像样才收，否则给空。
    // `vcfLevelPaid` 存的是个数字字符串（水位线），不是 JSON —— 所以这里读**裸字符串**。
    soulUnlocks: Array.isArray(jsonValue(LOCAL_KEYS.soulUnlocks)) ? jsonValue(LOCAL_KEYS.soulUnlocks) as unknown[] : [],
    vcfItems: isRecord(jsonValue(LOCAL_KEYS.vcfItems)) ? jsonValue(LOCAL_KEYS.vcfItems) as Record<string, unknown> : {},
    vcfLevelPaid: typeof localStorage.getItem(LOCAL_KEYS.vcfLevelPaid) === "string" ? localStorage.getItem(LOCAL_KEYS.vcfLevelPaid)! : "",
    soulTuning: isRecord(jsonValue(LOCAL_KEYS.soulTuning)) ? jsonValue(LOCAL_KEYS.soulTuning) as Record<string, unknown> : {},
    // VCF 挑战状态（2026-10-11 补，修的是"换机就丢解答力"那个漏洞）。
    // 只要求"是个对象"：内部结构由 `vcf-challenge/rating.ts` 的 `loadState()` 归一化，
    // 备份不重新定义别人的格式（见 `BackupLocalStorage.vcfChallenge` 的注释）。
    vcfChallenge: isRecord(jsonValue(LOCAL_KEYS.vcfChallenge)) ? jsonValue(LOCAL_KEYS.vcfChallenge) as Record<string, unknown> : {},
    favorites: (() => {
      const value = jsonValue(LOCAL_KEYS.favorites);
      if (!isRecord(value)) return { records: [], puzzleCollections: [], puzzles: {} };
      return {
        records: Array.isArray(value.records) ? value.records.filter((item): item is string => typeof item === "string") : [],
        puzzleCollections: Array.isArray(value.puzzleCollections) ? value.puzzleCollections.filter((item): item is string => typeof item === "string") : [],
        puzzles: isRecord(value.puzzles)
          ? Object.fromEntries(Object.entries(value.puzzles).filter(([, ids]) => Array.isArray(ids) && ids.every((id) => typeof id === "string")).map(([key, ids]) => [key, ids as string[]]))
          : {},
      };
    })(),
    quickDrawer: isRecord(jsonValue(LOCAL_KEYS.quickDrawer)) ? jsonValue(LOCAL_KEYS.quickDrawer) as Record<string, unknown> : {},
    onlineProxy: typeof localStorage.getItem(LOCAL_KEYS.onlineProxy) === "string" ? localStorage.getItem(LOCAL_KEYS.onlineProxy)! : "",
    updateAutoCheck: typeof jsonValue(LOCAL_KEYS.updateAutoCheck) === "boolean" ? jsonValue(LOCAL_KEYS.updateAutoCheck) as boolean : true,
    updateDismissed: typeof localStorage.getItem(LOCAL_KEYS.updateDismissed) === "string" ? localStorage.getItem(LOCAL_KEYS.updateDismissed)! : "",
    reviewMarks: isRecord(jsonValue(LOCAL_KEYS.reviewMarks)) ? jsonValue(LOCAL_KEYS.reviewMarks) as Record<string, unknown> : {},
    reviewBranchNames: isRecord(jsonValue(LOCAL_KEYS.reviewBranchNames)) ? jsonValue(LOCAL_KEYS.reviewBranchNames) as Record<string, unknown> : {},
    dailyTraining: isRecord(jsonValue(LOCAL_KEYS.dailyTraining)) ? jsonValue(LOCAL_KEYS.dailyTraining) as Record<string, unknown> : {},
    actionLayout: isRecord(jsonValue(LOCAL_KEYS.actionLayout)) ? jsonValue(LOCAL_KEYS.actionLayout) as Record<string, unknown> : {},
    // 布局预设是数组（SavedLayoutPreset[]），不能用 isRecord 判——那会把数组当非法丢掉。
    actionLayoutPresets: Array.isArray(jsonValue(LOCAL_KEYS.actionLayoutPresets)) ? jsonValue(LOCAL_KEYS.actionLayoutPresets) as unknown[] : [],
  };
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const encodeValue = (value: unknown): unknown => {
  if (value instanceof ArrayBuffer) return { __banbuType: "ArrayBuffer", data: bytesToBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { __banbuType: "TypedArray", name: value.constructor.name, data: bytesToBase64(bytes) };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
  return value;
};

const typedArrayConstructors: Record<string, (buffer: ArrayBuffer) => unknown> = {
  Int8Array: (buffer) => new Int8Array(buffer), Uint8Array: (buffer) => new Uint8Array(buffer), Uint8ClampedArray: (buffer) => new Uint8ClampedArray(buffer),
  Int16Array: (buffer) => new Int16Array(buffer), Uint16Array: (buffer) => new Uint16Array(buffer), Int32Array: (buffer) => new Int32Array(buffer),
  Uint32Array: (buffer) => new Uint32Array(buffer), Float32Array: (buffer) => new Float32Array(buffer), Float64Array: (buffer) => new Float64Array(buffer),
  BigInt64Array: (buffer) => new BigInt64Array(buffer), BigUint64Array: (buffer) => new BigUint64Array(buffer),
};

const decodeValue = (value: unknown): unknown => {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  if (!isRecord(value)) return value;
  if (value.__banbuType === "ArrayBuffer" && typeof value.data === "string") return base64ToBytes(value.data).buffer;
  if (value.__banbuType === "TypedArray" && typeof value.name === "string" && typeof value.data === "string") {
    const constructor = typedArrayConstructors[value.name];
    if (!constructor) throw new Error(`备份包含不支持的二进制类型：${value.name}`);
    return constructor(base64ToBytes(value.data).buffer);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item)]));
};

const validateLocalStorage = (value: unknown): value is BackupLocalStorage => {
  if (!isRecord(value) || !Array.isArray(value.library) || !value.library.every(isGameDocument) || (value.active !== null && !isGameDocument(value.active)) || !isRecord(value.drafts) || !Object.values(value.drafts).every((draft) => isRecord(draft) && Array.isArray(draft.operations) && Array.isArray(draft.redo)) || !Array.isArray(value.puzzleCollections) || !value.puzzleCollections.every(isPuzzleCollection) || !isRecord(value.puzzleProgress) || (value.puzzleRulePreference !== undefined && value.puzzleRulePreference !== "forbidden" && value.puzzleRulePreference !== "unrestricted") || !isRecord(value.puzzleTitleOverrides) || !isStringRecord(value.puzzleTitleOverrides.collections) || !isStringRecord(value.puzzleTitleOverrides.puzzles) || !isRecord(value.libraryFolders) || !Array.isArray(value.libraryFolders.recordFolders) || !Array.isArray(value.libraryFolders.puzzleFolders) || !isStringRecord(value.libraryFolders.recordAssignments) || !isStringRecord(value.libraryFolders.puzzleAssignments) || (value.libraryFolders.order !== undefined && !isLibraryOrderMaps(value.libraryFolders.order)) || !isRecord(value.branchBookmarks) || (value.defaultDocument !== null && !isGameDocument(value.defaultDocument)) || (value.activeLargeRecord !== null && typeof value.activeLargeRecord !== "string") || !Array.isArray(value.recycleBin) || !isThemePreference(value.themePreference) || !isRecord(value.displaySettings) || typeof value.displaySettings.showNumbers !== "boolean" || typeof value.displaySettings.showCoordinates !== "boolean" || typeof value.displaySettings.showForbidden !== "boolean" || (value.displaySettings.showLastMove !== undefined && typeof value.displaySettings.showLastMove !== "boolean") || (value.displaySettings.moveNumberScale !== undefined && (typeof value.displaySettings.moveNumberScale !== "number" || !Number.isFinite(value.displaySettings.moveNumberScale) || value.displaySettings.moveNumberScale <= 0)) || (value.displaySettings.gridLineWidth !== undefined && (typeof value.displaySettings.gridLineWidth !== "number" || !Number.isFinite(value.displaySettings.gridLineWidth) || value.displaySettings.gridLineWidth <= 0)) || (value.displaySettings.coordinateFontSize !== undefined && (typeof value.displaySettings.coordinateFontSize !== "number" || !Number.isFinite(value.displaySettings.coordinateFontSize) || value.displaySettings.coordinateFontSize <= 0)) || (value.soundSettings !== undefined && !isSoundSettings(value.soundSettings)) || (value.motionEnabled !== undefined && typeof value.motionEnabled !== "boolean") || (value.stoneOpacity !== undefined && (typeof value.stoneOpacity !== "number" || !Number.isFinite(value.stoneOpacity))) || (value.boardOpacity !== undefined && (typeof value.boardOpacity !== "number" || !Number.isFinite(value.boardOpacity))) || (value.boardTheme !== undefined && !isBoardTheme(value.boardTheme)) || (value.stoneTheme !== undefined && !isStoneTheme(value.stoneTheme)) || (value.customBackgroundColor !== undefined && (typeof value.customBackgroundColor !== "string" || !/^#[0-9a-f]{6}$/i.test(value.customBackgroundColor))) || (value.customBackgroundImage !== undefined && (typeof value.customBackgroundImage !== "string" || (value.customBackgroundImage !== "" && !value.customBackgroundImage.startsWith("data:image/")))) || (value.customUiTheme !== undefined && !isCustomUiTheme(value.customUiTheme)) || (value.defaultBoardSize !== undefined && !isSupportedBoardSize(Number(value.defaultBoardSize))) || (value.fontScale !== undefined && !isFontScale(value.fontScale)) || (value.enhancementSettings !== undefined && !isRecord(value.enhancementSettings)) || (value.annotationHighlight !== undefined && normalizeAnnotationHighlight(value.annotationHighlight) !== value.annotationHighlight) || (value.analysisCache !== undefined && !isRecord(value.analysisCache)) || (value.gameReview !== undefined && !isRecord(value.gameReview)) || (value.favorites !== undefined && (!isRecord(value.favorites) || !Array.isArray(value.favorites.records) || !value.favorites.records.every((item) => typeof item === "string") || !Array.isArray(value.favorites.puzzleCollections) || !value.favorites.puzzleCollections.every((item) => typeof item === "string") || !isRecord(value.favorites.puzzles))) || (value.quickDrawer !== undefined && !isRecord(value.quickDrawer)) || (value.onlineProxy !== undefined && typeof value.onlineProxy !== "string") || (value.updateAutoCheck !== undefined && typeof value.updateAutoCheck !== "boolean") || (value.updateDismissed !== undefined && typeof value.updateDismissed !== "string") || (value.reviewMarks !== undefined && !isRecord(value.reviewMarks)) || (value.reviewBranchNames !== undefined && !isRecord(value.reviewBranchNames)) || (value.dailyTraining !== undefined && !isRecord(value.dailyTraining)) || (value.actionLayout !== undefined && !isRecord(value.actionLayout)) || (value.actionLayoutPresets !== undefined && !Array.isArray(value.actionLayoutPresets)) || (value.achievements !== undefined && !isRecord(value.achievements)) || (value.soulLedger !== undefined && !Array.isArray(value.soulLedger)) || (value.soulUnlocks !== undefined && !Array.isArray(value.soulUnlocks)) || (value.vcfItems !== undefined && !isRecord(value.vcfItems)) || (value.vcfLevelPaid !== undefined && typeof value.vcfLevelPaid !== "string") || (value.soulTuning !== undefined && !isRecord(value.soulTuning)) || (value.vcfChallenge !== undefined && !isRecord(value.vcfChallenge))) return false;
  return Object.keys(value.drafts).every((key) => key.startsWith(DRAFT_PREFIX) && key.length > DRAFT_PREFIX.length)
    && value.libraryFolders.recordFolders.every((item) => typeof item === "string") && value.libraryFolders.puzzleFolders.every((item) => typeof item === "string");
};

const validateLargeStorage = (value: unknown): value is LargeStorageRecords => {
  if (!isRecord(value) || !Array.isArray(value.documents) || !Array.isArray(value.summaries) || !Array.isArray(value.drafts) || !Array.isArray(value.indexChunks)) return false;
  const validDocuments = value.documents.every((item) => isRecord(item) && typeof item.id === "string" && (item.chunkedIndex === true || item.compactIndex !== undefined || item.baseId !== undefined || item.nodes !== undefined));
  const validSummaries = value.summaries.every((item) => isRecord(item) && typeof item.id === "string" && isRecord(item.metadata) && typeof item.metadata.title === "string");
  const validDrafts = value.drafts.every((item) => isRecord(item) && typeof item.documentId === "string" && Array.isArray(item.operations) && Array.isArray(item.redo) && typeof item.baseFingerprint === "string");
  const validChunks = value.indexChunks.every((item) => isRecord(item) && typeof item.key === "string" && typeof item.id === "string" && typeof item.field === "string" && Number.isInteger(item.offset));
  const validTrash = validateOptionalRecords(value.trashDocuments, (item) => isRecord(item) && typeof item.id === "string" && (item.chunkedIndex === true || item.compactIndex !== undefined || item.baseId !== undefined || item.nodes !== undefined))
    && validateOptionalRecords(value.trashSummaries, (item) => isRecord(item) && typeof item.id === "string" && isRecord(item.metadata) && typeof item.metadata.title === "string")
    && validateOptionalRecords(value.trashDrafts, (item) => isRecord(item) && typeof item.documentId === "string" && Array.isArray(item.operations) && Array.isArray(item.redo) && typeof item.baseFingerprint === "string")
    && validateOptionalRecords(value.trashIndexChunks, (item) => isRecord(item) && typeof item.key === "string" && typeof item.id === "string" && typeof item.field === "string" && Number.isInteger(item.offset));
  const unique = (items: unknown, key: string) => {
    if (!Array.isArray(items)) return false;
    const keys = items.map((item) => isRecord(item) ? item[key] : undefined);
    return keys.every((item) => typeof item === "string") && new Set(keys).size === keys.length;
  };
  return validDocuments && validSummaries && validDrafts && validChunks && validTrash
    && unique(value.documents, "id") && unique(value.summaries, "id") && unique(value.drafts, "documentId") && unique(value.indexChunks, "key")
    && unique(value.trashDocuments || [], "id") && unique(value.trashSummaries || [], "id") && unique(value.trashDrafts || [], "documentId") && unique(value.trashIndexChunks || [], "key");
};

const validateOptionalRecords = (value: unknown, predicate: (item: unknown) => boolean) => value === undefined || (Array.isArray(value) && value.every(predicate));

export const validateBackup = (value: unknown): value is BackupSnapshot => isRecord(value)
  && value.schema === SCHEMA && value.version === VERSION && typeof value.appVersion === "string" && typeof value.exportedAt === "string"
  && !Number.isNaN(Date.parse(value.exportedAt)) && validateLocalStorage(value.localStorage) && validateLargeStorage(value.indexedDb);

/**
 * 快照的**范围**：
 *  · `full` —— 全量（棋谱库 + 题库 + 大型棋谱 + 状态）。「一键备份」走这条，
 *    它是用户主动点的、存到哪由用户决定，所以"大而全"就是对的；
 *  · `state` —— **只含状态**（设置、进度、成就、棋魂、战绩、VCF…），
 *    不含自建棋谱与大型棋谱。本机凭证的自动写入走这条。
 *
 * 为什么要分：凭证是**每次切后台都静默写一次**的。若含棋谱，
 * 手机上每次退出都要序列化几十 MB 甚至 GB 级的大棋谱（用户那个 1.1GB 定式谱），
 * 会明显卡顿、耗电、写盘磨损 —— 而"卸载后恢复到之前的状态"这件事，
 * 主体本来就是状态（进度/成就/棋魂/设置），不是棋谱。
 * 棋谱另给一个手动开关（`scope: "full"`），要的人显式触发。
 */
export type BackupScope = "state" | "full";

export const createBackupSnapshot = async (appVersion = "unknown", scope: BackupScope = "full"): Promise<BackupSnapshot> => {
  const local = captureLocalStorage();
  /**
   * ⚠ `scope: "state"` 时**大型棋谱与自建棋谱都留空**。
   *
   * 两处都要清：
   *  · `indexedDb` —— 大型棋谱、它们的索引分块、以及大型棋谱的草稿；
   *  · `local.library` / `local.drafts` —— 普通棋谱与它们的草稿（在 localStorage 里）。
   *
   * ⚠ 但 **`recycleBin`（回收站）也属于"棋谱"**，所以一并清空 ——
   * 它装的是用户删掉的棋谱，跟着"含不含棋谱"这个开关走才自洽；
   * 否则会出现"凭证里没有棋谱，却有一份能还原回来的回收站"。
   * 题库进度（`puzzleProgress`）**保留**：它是进度不是内容，
   * 而且内置题库本来就在包里（换机也在），进度丢了才是真损失。
   */
  const stateOnly = scope === "state";
  const indexedDbSource = stateOnly
    ? { documents: [], summaries: [], indexChunks: [], drafts: [], trashDocuments: [], trashSummaries: [], trashIndexChunks: [], trashDrafts: [] } as LargeStorageRecords
    : await exportLargeStorageRecords();
  const indexedDb = encodeValue(indexedDbSource) as LargeStorageRecords;
  if (stateOnly) {
    local.library = [];
    local.drafts = {};
    local.recycleBin = [];
    // 当前打开的棋谱与默认新建文档是"棋谱"（指向 library 里的某一份），一并清掉 ——
    // 留着它们会在恢复后指向不存在的棋谱。
    local.active = null;
    local.defaultDocument = null;
    local.activeLargeRecord = null;
  }
  const snapshot: BackupSnapshot = {
    schema: SCHEMA,
    version: VERSION,
    schemaVersion: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
    scope,
    localStorage: local,
    indexedDb,
    compatibility: { importableBy: ["半步五子棋打谱 1.x"], notes: ["应用原生备份；用于无损恢复，不等同于保存当前棋谱"] },
    contentSummary: { records: local.library.length, puzzles: local.puzzleCollections.reduce<number>((sum, item) => sum + (isRecord(item) && Array.isArray(item.puzzles) ? item.puzzles.length : 0), 0), drafts: Object.keys(local.drafts).length + indexedDb.drafts.length, largeRecords: indexedDb.documents.length, includesHistory: true },
    contentHash: "",
  };
  snapshot.contentHash = contentHash({ localStorage: snapshot.localStorage, indexedDb: snapshot.indexedDb });
  return snapshot;
};

export const serializeBackup = (snapshot: BackupSnapshot) => {
  if (!validateBackup(snapshot)) throw new Error("备份数据未通过格式校验");
  return JSON.stringify(snapshot, null, 2);
};

export const parseBackup = (text: string): BackupSnapshot => {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("备份文件不是有效的 JSON"); }
  if (!validateBackup(value)) throw new Error("备份文件版本、字段或数据结构无效");
  if (typeof value.contentHash === "string" && value.contentHash && value.contentHash !== contentHash({ localStorage: value.localStorage, indexedDb: value.indexedDb })) throw new Error("备份文件内容校验失败，文件可能已损坏");
  // Decode once here so malformed binary markers are rejected before any write.
  value.indexedDb = decodeValue(value.indexedDb) as LargeStorageRecords;
  return value;
};

/**
 * 恢复时**不许清空**的键（见 `writeLocalStorage` 里的长注释）。
 *
 * ⚠ 2026-10-11 加进 `vcfch-state-v1` 时把注释里"那四个键"改成"这几个键"，
 * 并在理由里补上它特有的那一层：旧备份里没有 VCF 状态，
 * 若按"没有就清空"处理，**用旧备份恢复会把解答力整个抹掉**
 * （等级分归零、几百道解题记录丢失）—— 而「VCF 起始等级」是花棋魂买的（五档 500–1600 魂）。
 */
const PRESERVE_ON_RESTORE: readonly string[] = [
  "banbu-soul-unlocks-v1", "banbu-vcf-items-v1", "banbu-vcf-level-paid-v1", "banbu-soul-tuning-v1",
  "vcfch-state-v1",
];

/**
 * **只含状态**的那些键：棋魂 / 成就 / 战绩 / VCF / 进度 / 设置 / 收藏 / 复盘。
 *
 * 这是"本机凭证只导数值"这条口径的**唯一定义处** —— 备份快照的生成
 * （`createBackupSnapshot` 的 `scope: "state"`）与凭证的恢复
 * （`writeLocalStorage` 的 `stateOnly`）都读它，两边不会各写一份而慢慢分叉。
 *
 * 判据是"这条数据是**数值/进度/偏好**，还是**用户产出的内容**"：
 *  · 在里面：棋魂账本与解锁、成就、战绩（由 `duel-history` 推导）、
 *    VCF 状态、题库进度与错题、每日训练、复习标记、收藏、复盘结果、
 *    各种设置与外观选择；
 *  · **不在**里面：棋谱库、草稿、回收站、大型棋谱、题库本身
 *    （题库是内容，不是进度 —— 内置题库随包分发，用户题集则属于"内容"）。
 */
const stateOnlyEntries = (value: BackupLocalStorage): Array<[string, unknown]> => [
  // ── 进度类 ──
  [LOCAL_KEYS.puzzleProgress, value.puzzleProgress],
  [LOCAL_KEYS.puzzleTitleOverrides, value.puzzleTitleOverrides],
  [LOCAL_KEYS.branchBookmarks, value.branchBookmarks],
  [LOCAL_KEYS.dailyTraining, value.dailyTraining],
  [LOCAL_KEYS.reviewMarks, value.reviewMarks],
  [LOCAL_KEYS.reviewBranchNames, value.reviewBranchNames],
  [LOCAL_KEYS.gameReview, value.gameReview],
  [LOCAL_KEYS.analysisCache, value.analysisCache],
  [LOCAL_KEYS.favorites, value.favorites],
  // ── 数值类（用户点名"关于棋魂、成就、战绩这些数值类的"）──
  [LOCAL_KEYS.achievements, value.achievements],
  [LOCAL_KEYS.soulLedger, value.soulLedger],
  [LOCAL_KEYS.soulUnlocks, value.soulUnlocks],
  [LOCAL_KEYS.vcfItems, value.vcfItems],
  [LOCAL_KEYS.vcfLevelPaid, value.vcfLevelPaid],
  [LOCAL_KEYS.vcfChallenge, value.vcfChallenge],
  [LOCAL_KEYS.soulTuning, value.soulTuning],
  // ── 偏好类 ──
  [LOCAL_KEYS.displaySettings, value.displaySettings],
  [LOCAL_KEYS.soundSettings, value.soundSettings],
  [LOCAL_KEYS.motionEnabled, value.motionEnabled],
  [LOCAL_KEYS.stoneOpacity, value.stoneOpacity],
  [LOCAL_KEYS.boardOpacity, value.boardOpacity],
  [LOCAL_KEYS.enhancementSettings, value.enhancementSettings],
  [LOCAL_KEYS.quickDrawer, value.quickDrawer],
  [LOCAL_KEYS.actionLayout, value.actionLayout],
  [LOCAL_KEYS.actionLayoutPresets, value.actionLayoutPresets],
  [LOCAL_KEYS.themePreference, value.themePreference],
  [LOCAL_KEYS.boardTheme, value.boardTheme],
  [LOCAL_KEYS.stoneTheme, value.stoneTheme],
  [LOCAL_KEYS.customBackgroundColor, value.customBackgroundColor],
  [LOCAL_KEYS.customUiTheme, value.customUiTheme],
  [LOCAL_KEYS.defaultBoardSize, value.defaultBoardSize === undefined ? null : String(value.defaultBoardSize)],
  [LOCAL_KEYS.fontScale, value.fontScale],
  [LOCAL_KEYS.annotationHighlight, value.annotationHighlight],
  [LOCAL_KEYS.puzzleRulePreference, value.puzzleRulePreference],
];

const writeLocalStorage = (value: BackupLocalStorage, options: { stateOnly?: boolean } = {}) => {
  /**
   * `stateOnly`（本机凭证只含数值/进度时用）：
   * **只覆盖"状态类"的键，绝不删任何东西**。
   *
   * ⚠ 这一条是 2026-10-11 修的一个**会造成数据丢失**的 bug：
   * 上一版凭证恢复走的是 `restoreBackup` —— 它是"整份替换"语义（先清空、
   * 再按备份写回）。而"只含状态"的凭证里棋谱库、大型棋谱都是**空的**
   * （见 `createBackupSnapshot` 的 `scope: "state"`）。于是用户拿一份
   * 只含棋魂/成就/战绩的凭证去恢复，**棋谱库会被整个清空** ——
   * 而他本来只是想同步数值。
   *
   * 用户对这一点的原话：「这个凭证一般就导出关于棋魂，成就，战绩等这些数值类的」——
   * 既然只导数值，恢复时就只能**写数值**，不能碰棋谱。
   * 所以凭证恢复用叠加（overlay）：有就写、没有就留着本机的。
   */
  if (options.stateOnly) {
    for (const [key, item] of stateOnlyEntries(value)) {
      if (item !== null && item !== undefined) localStorage.setItem(key, typeof item === "string" ? item : JSON.stringify(item));
    }
    return;
  }
  const keys = Object.values(LOCAL_KEYS);
  /**
   * ⚠ 清旧值时要**跳过"棋魂买来的东西"那四个键**（2026-10-11 修）。
   *
   * 恢复的语义是"用备份替换本机数据"，所以这里会把 `LOCAL_KEYS` 里的键全部删掉
   * 再按备份写回。这对棋谱、设置那些是对的 —— 但**对这四个键是灾难**：
   * 一份 2026-10-11 之前导出的旧备份里没有它们（那时还没有商店），
   * 于是"删掉 → 备份里没有 → 不写回"= **把用户买过的外观全删了**，
   * 而账本里的钱照旧扣着。用户看到的是"恢复一次备份，东西没了"。
   *
   * 所以这四个键**只做"备份里有才覆盖"，绝不做"备份里没有就清空"**：
   * 旧备份恢复 = 这几样保持本机现状（不丢），新备份恢复 = 正常覆盖。
   * 这也是唯一合理的口径 —— 回退到旧版本再恢复不该把人家的家当抹掉。
   */
  for (const key of keys) if (!PRESERVE_ON_RESTORE.includes(key)) localStorage.removeItem(key);
  const draftKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(DRAFT_PREFIX)) draftKeys.push(key);
  }
  for (const key of draftKeys) localStorage.removeItem(key);
  const jsonEntries: Array<[string, unknown]> = [
    [LOCAL_KEYS.library, value.library], [LOCAL_KEYS.active, value.active], [LOCAL_KEYS.puzzleCollections, value.puzzleCollections],
    [LOCAL_KEYS.puzzleProgress, value.puzzleProgress], [LOCAL_KEYS.puzzleTitleOverrides, value.puzzleTitleOverrides], [LOCAL_KEYS.libraryFolders, value.libraryFolders],
    [LOCAL_KEYS.branchBookmarks, value.branchBookmarks], [LOCAL_KEYS.defaultDocument, value.defaultDocument], [LOCAL_KEYS.recycleBin, value.recycleBin],
    [LOCAL_KEYS.displaySettings, value.displaySettings], [LOCAL_KEYS.soundSettings, value.soundSettings || DEFAULT_SOUND_SETTINGS],
    [LOCAL_KEYS.motionEnabled, value.motionEnabled ?? true],
    [LOCAL_KEYS.stoneOpacity, normalizeStoneOpacity(value.stoneOpacity ?? DEFAULT_STONE_OPACITY)],
    [LOCAL_KEYS.boardOpacity, normalizeBoardOpacity(value.boardOpacity ?? DEFAULT_BOARD_OPACITY)],
    [LOCAL_KEYS.enhancementSettings, normalizeEnhancementSettings(value.enhancementSettings ?? DEFAULT_ENHANCEMENT_SETTINGS)],
    [LOCAL_KEYS.analysisCache, value.analysisCache ?? {}],
    [LOCAL_KEYS.gameReview, value.gameReview ?? {}],
    [LOCAL_KEYS.favorites, value.favorites ?? { records: [], puzzleCollections: [], puzzles: {} }],
    [LOCAL_KEYS.quickDrawer, value.quickDrawer ?? {}],
    [LOCAL_KEYS.reviewMarks, value.reviewMarks ?? {}],
    [LOCAL_KEYS.reviewBranchNames, value.reviewBranchNames ?? {}],
    [LOCAL_KEYS.dailyTraining, value.dailyTraining ?? {}],
    [LOCAL_KEYS.actionLayout, value.actionLayout ?? {}],
    [LOCAL_KEYS.actionLayoutPresets, value.actionLayoutPresets ?? {}],
    [LOCAL_KEYS.achievements, value.achievements ?? {}],
    [LOCAL_KEYS.soulLedger, value.soulLedger ?? []],
  ];
  for (const [key, item] of jsonEntries) if (item !== null) localStorage.setItem(key, JSON.stringify(item));
  /**
   * 棋魂商店的四个键（2026-10-11 补）。
   *
   * ⚠ 这里**必须"缺就跳过"，不能"缺就给默认值"** —— 与上面那张表不同：
   *  · 上面的键（favorites / quickDrawer…）缺失时给空值是合理的（本来就没有的那些功能）；
   *  · 而这几个键恢复成空值等于**把用户买过的东西删掉**（余额还在、货没了），
   *    或者**把解答力抹掉**（VCF 状态）。一份旧备份没有这几项，
   *    恢复时绝不能顺手把它们清空 —— 那会比不恢复更糟。所以只在备份里**真的有**才写。
   */
  if (Array.isArray(value.soulUnlocks)) localStorage.setItem(LOCAL_KEYS.soulUnlocks, JSON.stringify(value.soulUnlocks));
  if (isRecord(value.vcfItems)) localStorage.setItem(LOCAL_KEYS.vcfItems, JSON.stringify(value.vcfItems));
  if (typeof value.vcfLevelPaid === "string" && value.vcfLevelPaid) localStorage.setItem(LOCAL_KEYS.vcfLevelPaid, value.vcfLevelPaid);
  if (isRecord(value.soulTuning)) localStorage.setItem(LOCAL_KEYS.soulTuning, JSON.stringify(value.soulTuning));
  if (isRecord(value.vcfChallenge)) localStorage.setItem(LOCAL_KEYS.vcfChallenge, JSON.stringify(value.vcfChallenge));
  for (const [key, item] of Object.entries(value.drafts)) localStorage.setItem(key, JSON.stringify(item));
  if (value.activeLargeRecord !== null) localStorage.setItem(LOCAL_KEYS.activeLargeRecord, value.activeLargeRecord);
  localStorage.setItem(LOCAL_KEYS.themePreference, value.themePreference);
  localStorage.setItem(LOCAL_KEYS.puzzleRulePreference, value.puzzleRulePreference === "forbidden" ? "forbidden" : "unrestricted");
  localStorage.setItem(LOCAL_KEYS.boardTheme, value.boardTheme || "wood");
  localStorage.setItem(LOCAL_KEYS.stoneTheme, value.stoneTheme || "classic");
  localStorage.setItem(LOCAL_KEYS.customBackgroundColor, value.customBackgroundColor || "#e8e4dc");
  if (value.customBackgroundImage) localStorage.setItem(LOCAL_KEYS.customBackgroundImage, value.customBackgroundImage);
  if (isCustomUiTheme(value.customUiTheme)) localStorage.setItem(LOCAL_KEYS.customUiTheme, value.customUiTheme);
  localStorage.setItem(LOCAL_KEYS.defaultBoardSize, String(value.defaultBoardSize || 15));
  localStorage.setItem(LOCAL_KEYS.fontScale, value.fontScale || "normal");
  localStorage.setItem(LOCAL_KEYS.annotationHighlight, normalizeAnnotationHighlight(value.annotationHighlight ?? DEFAULT_ANNOTATION_HIGHLIGHT));
  localStorage.setItem(LOCAL_KEYS.onlineProxy, value.onlineProxy ?? "");
  localStorage.setItem(LOCAL_KEYS.updateAutoCheck, JSON.stringify(value.updateAutoCheck !== false));
  localStorage.setItem(LOCAL_KEYS.updateDismissed, value.updateDismissed ?? "");
};

const captureRawLocalStorage = (): Map<string, string | null> => {
  const values = new Map<string, string | null>(Object.values(LOCAL_KEYS).map((key) => [key, localStorage.getItem(key)]));
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(DRAFT_PREFIX)) values.set(key, localStorage.getItem(key));
  }
  return values;
};

const restoreRawLocalStorage = (values: Map<string, string | null>, includeDrafts = false) => {
  const keys = new Set<string>(values.keys());
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (includeDrafts && key?.startsWith(DRAFT_PREFIX)) keys.add(key);
  }
  // Free the incoming payload's space before putting the original bytes back.
  for (const key of keys) localStorage.removeItem(key);
  for (const [key, value] of values) if (value !== null) localStorage.setItem(key, value);
};

export const restoreBackup = async (input: BackupSnapshot | string): Promise<void> => {
  const incoming = typeof input === "string" ? parseBackup(input) : input;
  if (!validateBackup(incoming)) throw new Error("备份文件版本、字段或数据结构无效");
  if (incoming.scope === "state") return restoreBackupStateOnly(incoming);
  const previousLocal = captureRawLocalStorage();
  const previousLarge = await exportLargeStorageRecords();
  const incomingLarge = decodeValue(incoming.indexedDb) as LargeStorageRecords;
  let largeReplaced = false, localWriteStarted = false;
  try {
    await replaceLargeStorageRecords(incomingLarge);
    largeReplaced = true;
    localWriteStarted = true;
    writeLocalStorage(incoming.localStorage);
  } catch (error) {
    let rollbackFailed = false;
    if (largeReplaced) {
      try { await replaceLargeStorageRecords(previousLarge); } catch { rollbackFailed = true; }
    }
    if (localWriteStarted) {
      try { restoreRawLocalStorage(previousLocal, true); } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) {
      throw new Error("恢复备份失败，且回滚未完成；请立即关闭页面并保留当前浏览器数据以便进一步处理");
    }
    throw error instanceof Error ? error : new Error("恢复备份失败");
  }
  // All ledger, unlock and inventory writes must finish before notifying
  // consumers: their next action must use the restored ledger and deliveries.
  resetSoulLedger();
};

/**
 * **只恢复状态**（本机凭证的路径）：写数值与进度，**不碰棋谱**。
 *
 * 相关状态必须一起恢复：例如棋魂账本与购买的解锁、水位线不能只写一半。
 * localStorage 没有事务，写入失败时用原始字符串回滚，保留键缺失状态。
 *
 * ⚠ 也**不做 `replaceLargeStorageRecords`**：那会清掉大型棋谱。
 * 状态类数据全在 localStorage 里，IndexedDB 那部分（棋谱内容）与本函数无关。
 */
export const restoreBackupStateOnly = async (input: BackupSnapshot | string): Promise<void> => {
  const incoming = typeof input === "string" ? parseBackup(input) : input;
  if (!validateBackup(incoming)) throw new Error("凭证内容版本、字段或数据结构无效");
  const previous = new Map(stateOnlyEntries(incoming.localStorage).map(([key]) => [key, localStorage.getItem(key)]));
  try {
    writeLocalStorage(incoming.localStorage, { stateOnly: true });
  } catch (error) {
    try { restoreRawLocalStorage(previous); }
    catch { throw new Error("恢复凭证失败，且状态回滚未完成；请保留当前浏览器数据以便进一步处理"); }
    throw error;
  }
  resetSoulLedger();
};

export const backupSchema = SCHEMA;
export const backupVersion = VERSION;
