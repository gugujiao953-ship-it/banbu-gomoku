import { exportLargeStorageRecords, replaceLargeStorageRecords, type LargeStorageRecords } from "./large-storage";
import type { GameDocument } from "./types";
import { isLibraryOrderMaps } from "./library-order";
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings, SOUND_SETTINGS_KEY, type SoundSettings } from "./audio-settings";
import { MOTION_SETTINGS_KEY, normalizeMotionEnabled } from "./motion-settings";
import { contentHash } from "./features/data-safety/export-semantics";
import { DEFAULT_STONE_OPACITY, STONE_OPACITY_KEY, normalizeStoneOpacity } from "./stone-opacity";
import { BOARD_OPACITY_KEY, DEFAULT_BOARD_OPACITY, normalizeBoardOpacity } from "./board-opacity";
import { PUZZLE_RULE_PREFERENCE_KEY, type PuzzleRuleMode } from "./features/puzzles/puzzle-rules";
import type { BoardTheme, StoneTheme, ThemePreference } from "./app-shell-types";
import { FONT_SCALE_STORAGE_KEY, type FontScale } from "./accessibility";
import { DEFAULT_ENHANCEMENT_SETTINGS, ENHANCEMENT_SETTINGS_KEY, normalizeEnhancementSettings, type EnhancementSettings } from "./enhancement-settings";
import { ANNOTATION_HIGHLIGHT_KEY, DEFAULT_ANNOTATION_HIGHLIGHT, normalizeAnnotationHighlight, type AnnotationHighlight } from "./annotation-highlight";

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
  defaultBoardSize: "banbu-default-board-size-v1",
  fontScale: FONT_SCALE_STORAGE_KEY,
  enhancementSettings: ENHANCEMENT_SETTINGS_KEY,
  annotationHighlight: ANNOTATION_HIGHLIGHT_KEY,
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
  displaySettings: { showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean };
  soundSettings?: SoundSettings;
  motionEnabled?: boolean;
  stoneOpacity?: number;
  boardOpacity?: number;
  /** Optional so backups made before the expanded appearance system stay valid. */
  boardTheme?: BoardTheme;
  stoneTheme?: StoneTheme;
  customBackgroundColor?: string;
  customBackgroundImage?: string;
  defaultBoardSize?: number;
  fontScale?: FontScale;
  enhancementSettings?: EnhancementSettings;
  annotationHighlight?: AnnotationHighlight;
}

export interface BackupSnapshot {
  schema: typeof SCHEMA;
  version: typeof VERSION;
  /** Stable schema marker for newer tooling; `version` remains for v1 import compatibility. */
  schemaVersion?: 1;
  appVersion: string;
  exportedAt: string;
  contentHash?: string;
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
const backupThemes: ThemePreference[] = ["system", "light", "dark", "eye", "mono", "rain", "bamboo", "snow", "porcelain", "plum", "jiangnan", "firefly", "rice", "pixel", "cyber", "blackgold", "pale", "kawaii", "aurora", "deepsea", "baroque", "custom"];
const isThemePreference = (value: unknown): value is ThemePreference => typeof value === "string" && backupThemes.includes(value as ThemePreference);
const backupBoardThemes: BoardTheme[] = ["wood", "jade", "notebook", "emerald", "porcelain", "whitejade", "walnut", "frosted", "circuit", "minimal", "blackgold", "pale", "kawaii", "aurora"];
const backupStoneThemes: StoneTheme[] = ["classic", "jade", "yun", "ink", "mono", "notebook", "porcelain", "snow", "terminal", "gold-diamond", "gold", "diamond", "blackgold", "pale", "kawaii", "aurora"];
const isBoardTheme = (value: unknown): value is BoardTheme => typeof value === "string" && backupBoardThemes.includes(value as BoardTheme);
const isStoneTheme = (value: unknown): value is StoneTheme => typeof value === "string" && backupStoneThemes.includes(value as StoneTheme);
const isFontScale = (value: unknown): value is FontScale => value === "normal" || value === "large" || value === "xlarge";
const hasValidPoint = (value: unknown) => {
  if (!isRecord(value)) return false;
  const row = value.row, col = value.col;
  return Number.isInteger(row) && Number.isInteger(col) && Number(row) >= 0 && Number(row) < 15 && Number(col) >= 0 && Number(col) < 15;
};

const isGameDocument = (value: unknown): value is GameDocument => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.rootId !== "string" || typeof value.updatedAt !== "string" || !isRecord(value.metadata) || typeof value.metadata.title !== "string" || !isRecord(value.nodes) || !isRecord(value.nodes[value.rootId])) return false;
  return Object.values(value.nodes).every((node) => isRecord(node) && typeof node.id === "string" && Array.isArray(node.children) && node.children.every((child) => typeof child === "string"));
};

const isPuzzle = (value: unknown) => isRecord(value)
  && typeof value.id === "string" && typeof value.title === "string" && typeof value.prompt === "string"
  && (value.player === "black" || value.player === "white") && Number.isInteger(value.difficulty) && Number(value.difficulty) >= 1 && Number(value.difficulty) <= 5
  && Array.isArray(value.stones) && value.stones.every((stone) => hasValidPoint(stone) && isRecord(stone) && (stone.player === "black" || stone.player === "white"));

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
  const theme = jsonValue(LOCAL_KEYS.themePreference);
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
    } : { showNumbers: true, showCoordinates: true, showForbidden: true },
    soundSettings: normalizeSoundSettings(jsonValue(LOCAL_KEYS.soundSettings)),
    motionEnabled: normalizeMotionEnabled(jsonValue(LOCAL_KEYS.motionEnabled)),
    stoneOpacity: normalizeStoneOpacity(jsonValue(LOCAL_KEYS.stoneOpacity)),
    boardOpacity: normalizeBoardOpacity(jsonValue(LOCAL_KEYS.boardOpacity)),
    boardTheme: isBoardTheme(localStorage.getItem(LOCAL_KEYS.boardTheme)) ? localStorage.getItem(LOCAL_KEYS.boardTheme) as BoardTheme : "wood",
    stoneTheme: isStoneTheme(localStorage.getItem(LOCAL_KEYS.stoneTheme)) ? localStorage.getItem(LOCAL_KEYS.stoneTheme) as StoneTheme : "classic",
    customBackgroundColor: /^#[0-9a-f]{6}$/i.test(localStorage.getItem(LOCAL_KEYS.customBackgroundColor) || "") ? localStorage.getItem(LOCAL_KEYS.customBackgroundColor)! : "#e8e4dc",
    customBackgroundImage: (localStorage.getItem(LOCAL_KEYS.customBackgroundImage) || "").startsWith("data:image/") ? localStorage.getItem(LOCAL_KEYS.customBackgroundImage)! : "",
    defaultBoardSize: (() => { const size = Number(localStorage.getItem(LOCAL_KEYS.defaultBoardSize) || 15); return Number.isInteger(size) && size >= 5 && size <= 21 ? size : 15; })(),
    fontScale: isFontScale(localStorage.getItem(LOCAL_KEYS.fontScale)) ? localStorage.getItem(LOCAL_KEYS.fontScale) as FontScale : "normal",
    enhancementSettings: normalizeEnhancementSettings(jsonValue(LOCAL_KEYS.enhancementSettings)),
    annotationHighlight: normalizeAnnotationHighlight(localStorage.getItem(LOCAL_KEYS.annotationHighlight)),
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
  if (!isRecord(value) || !Array.isArray(value.library) || !value.library.every(isGameDocument) || (value.active !== null && !isGameDocument(value.active)) || !isRecord(value.drafts) || !Object.values(value.drafts).every((draft) => isRecord(draft) && Array.isArray(draft.operations) && Array.isArray(draft.redo)) || !Array.isArray(value.puzzleCollections) || !value.puzzleCollections.every(isPuzzleCollection) || !isRecord(value.puzzleProgress) || (value.puzzleRulePreference !== undefined && value.puzzleRulePreference !== "forbidden" && value.puzzleRulePreference !== "unrestricted") || !isRecord(value.puzzleTitleOverrides) || !isStringRecord(value.puzzleTitleOverrides.collections) || !isStringRecord(value.puzzleTitleOverrides.puzzles) || !isRecord(value.libraryFolders) || !Array.isArray(value.libraryFolders.recordFolders) || !Array.isArray(value.libraryFolders.puzzleFolders) || !isStringRecord(value.libraryFolders.recordAssignments) || !isStringRecord(value.libraryFolders.puzzleAssignments) || (value.libraryFolders.order !== undefined && !isLibraryOrderMaps(value.libraryFolders.order)) || !isRecord(value.branchBookmarks) || (value.defaultDocument !== null && !isGameDocument(value.defaultDocument)) || (value.activeLargeRecord !== null && typeof value.activeLargeRecord !== "string") || !Array.isArray(value.recycleBin) || !isThemePreference(value.themePreference) || !isRecord(value.displaySettings) || typeof value.displaySettings.showNumbers !== "boolean" || typeof value.displaySettings.showCoordinates !== "boolean" || typeof value.displaySettings.showForbidden !== "boolean" || (value.soundSettings !== undefined && !isSoundSettings(value.soundSettings)) || (value.motionEnabled !== undefined && typeof value.motionEnabled !== "boolean") || (value.stoneOpacity !== undefined && (typeof value.stoneOpacity !== "number" || !Number.isFinite(value.stoneOpacity))) || (value.boardOpacity !== undefined && (typeof value.boardOpacity !== "number" || !Number.isFinite(value.boardOpacity))) || (value.boardTheme !== undefined && !isBoardTheme(value.boardTheme)) || (value.stoneTheme !== undefined && !isStoneTheme(value.stoneTheme)) || (value.customBackgroundColor !== undefined && (typeof value.customBackgroundColor !== "string" || !/^#[0-9a-f]{6}$/i.test(value.customBackgroundColor))) || (value.customBackgroundImage !== undefined && (typeof value.customBackgroundImage !== "string" || (value.customBackgroundImage !== "" && !value.customBackgroundImage.startsWith("data:image/")))) || (value.defaultBoardSize !== undefined && (!Number.isInteger(value.defaultBoardSize) || Number(value.defaultBoardSize) < 5 || Number(value.defaultBoardSize) > 21)) || (value.fontScale !== undefined && !isFontScale(value.fontScale)) || (value.enhancementSettings !== undefined && !isRecord(value.enhancementSettings)) || (value.annotationHighlight !== undefined && normalizeAnnotationHighlight(value.annotationHighlight) !== value.annotationHighlight)) return false;
  return value.libraryFolders.recordFolders.every((item) => typeof item === "string") && value.libraryFolders.puzzleFolders.every((item) => typeof item === "string");
};

const validateLargeStorage = (value: unknown): value is LargeStorageRecords => {
  if (!isRecord(value) || !Array.isArray(value.documents) || !Array.isArray(value.summaries) || !Array.isArray(value.drafts) || !Array.isArray(value.indexChunks)) return false;
  const validDocuments = value.documents.every((item) => isRecord(item) && typeof item.id === "string" && (item.chunkedIndex === true || item.compactIndex !== undefined || item.baseId !== undefined || item.nodes !== undefined));
  const validSummaries = value.summaries.every((item) => isRecord(item) && typeof item.id === "string" && isRecord(item.metadata) && typeof item.metadata.title === "string");
  const validDrafts = value.drafts.every((item) => isRecord(item) && typeof item.documentId === "string" && Array.isArray(item.operations) && Array.isArray(item.redo) && typeof item.baseFingerprint === "string");
  const validChunks = value.indexChunks.every((item) => isRecord(item) && typeof item.key === "string" && typeof item.id === "string" && typeof item.field === "string" && Number.isInteger(item.offset));
  return validDocuments && validSummaries && validDrafts && validChunks;
};

export const validateBackup = (value: unknown): value is BackupSnapshot => isRecord(value)
  && value.schema === SCHEMA && value.version === VERSION && typeof value.appVersion === "string" && typeof value.exportedAt === "string"
  && !Number.isNaN(Date.parse(value.exportedAt)) && validateLocalStorage(value.localStorage) && validateLargeStorage(value.indexedDb);

export const createBackupSnapshot = async (appVersion = "unknown"): Promise<BackupSnapshot> => {
  const local = captureLocalStorage();
  const indexedDb = encodeValue(await exportLargeStorageRecords()) as LargeStorageRecords;
  const snapshot: BackupSnapshot = {
    schema: SCHEMA,
    version: VERSION,
    schemaVersion: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
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

const writeLocalStorage = (value: BackupLocalStorage) => {
  const keys = Object.values(LOCAL_KEYS);
  for (const key of keys) localStorage.removeItem(key);
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
  ];
  for (const [key, item] of jsonEntries) if (item !== null) localStorage.setItem(key, JSON.stringify(item));
  for (const [key, item] of Object.entries(value.drafts)) localStorage.setItem(key, JSON.stringify(item));
  if (value.activeLargeRecord !== null) localStorage.setItem(LOCAL_KEYS.activeLargeRecord, value.activeLargeRecord);
  localStorage.setItem(LOCAL_KEYS.themePreference, value.themePreference);
  localStorage.setItem(LOCAL_KEYS.puzzleRulePreference, value.puzzleRulePreference === "forbidden" ? "forbidden" : "unrestricted");
  localStorage.setItem(LOCAL_KEYS.boardTheme, value.boardTheme || "wood");
  localStorage.setItem(LOCAL_KEYS.stoneTheme, value.stoneTheme || "classic");
  localStorage.setItem(LOCAL_KEYS.customBackgroundColor, value.customBackgroundColor || "#e8e4dc");
  if (value.customBackgroundImage) localStorage.setItem(LOCAL_KEYS.customBackgroundImage, value.customBackgroundImage);
  localStorage.setItem(LOCAL_KEYS.defaultBoardSize, String(value.defaultBoardSize || 15));
  localStorage.setItem(LOCAL_KEYS.fontScale, value.fontScale || "normal");
  localStorage.setItem(LOCAL_KEYS.annotationHighlight, normalizeAnnotationHighlight(value.annotationHighlight ?? DEFAULT_ANNOTATION_HIGHLIGHT));
};

export const restoreBackup = async (input: BackupSnapshot | string): Promise<void> => {
  const incoming = typeof input === "string" ? parseBackup(input) : input;
  if (!validateBackup(incoming)) throw new Error("备份文件版本、字段或数据结构无效");
  const previousLocal = captureLocalStorage();
  const previousLarge = await exportLargeStorageRecords();
  const incomingLarge = decodeValue(incoming.indexedDb) as LargeStorageRecords;
  try {
    await replaceLargeStorageRecords(incomingLarge);
    writeLocalStorage(incoming.localStorage);
  } catch (error) {
    try {
      await replaceLargeStorageRecords(previousLarge);
      writeLocalStorage(previousLocal);
    } catch {
      throw new Error("恢复备份失败，且回滚未完成；请立即关闭页面并保留当前浏览器数据以便进一步处理");
    }
    throw error instanceof Error ? error : new Error("恢复备份失败");
  }
};

export const backupSchema = SCHEMA;
export const backupVersion = VERSION;
