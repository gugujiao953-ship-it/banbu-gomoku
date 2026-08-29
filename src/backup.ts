import { exportLargeStorageRecords, replaceLargeStorageRecords, type LargeStorageRecords } from "./large-storage";
import type { GameDocument } from "./types";
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings, SOUND_SETTINGS_KEY, type SoundSettings } from "./audio-settings";

const SCHEMA = "banbu-gomoku-backup" as const;
const VERSION = 1 as const;
const DRAFT_PREFIX = "renju-note-draft-v2:";
const LOCAL_KEYS = {
  library: "renju-note-library-v1",
  active: "renju-note-active-v1",
  puzzleCollections: "renju-note-puzzle-collections-v1",
  puzzleProgress: "renju-note-puzzle-progress-v1",
  puzzleTitleOverrides: "renju-note-puzzle-title-overrides-v1",
  libraryFolders: "renju-note-library-folders-v1",
  branchBookmarks: "renju-note-branch-bookmarks-v1",
  defaultDocument: "renju-note-default-v1",
  activeLargeRecord: "banbu-active-large-record-v1",
  themePreference: "banbu-theme-preference-v1",
  displaySettings: "renju-note-display-settings-v1",
  soundSettings: SOUND_SETTINGS_KEY,
} as const;

export interface BackupLocalStorage {
  library: unknown[];
  active: unknown | null;
  drafts: Record<string, unknown>;
  puzzleCollections: unknown[];
  puzzleProgress: Record<string, unknown>;
  puzzleTitleOverrides: { collections: Record<string, string>; puzzles: Record<string, string> };
  libraryFolders: {
    recordFolders: string[];
    puzzleFolders: string[];
    recordAssignments: Record<string, string>;
    puzzleAssignments: Record<string, string>;
  };
  branchBookmarks: Record<string, unknown>;
  defaultDocument: unknown | null;
  activeLargeRecord: string | null;
  themePreference: "system" | "light" | "dark";
  displaySettings: { showNumbers: boolean; showCoordinates: boolean; showForbidden: boolean };
  soundSettings?: SoundSettings;
}

export interface BackupSnapshot {
  schema: typeof SCHEMA;
  version: typeof VERSION;
  appVersion: string;
  exportedAt: string;
  localStorage: BackupLocalStorage;
  indexedDb: LargeStorageRecords;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isStringRecord = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every((item) => typeof item === "string");
const isSoundSettings = (value: unknown): value is SoundSettings => isRecord(value)
  && typeof value.enabled === "boolean" && typeof value.moveEnabled === "boolean" && typeof value.feedbackEnabled === "boolean"
  && typeof value.volume === "number" && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1;
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
      } : { recordFolders: [], puzzleFolders: [], recordAssignments: {}, puzzleAssignments: {} };
    })(),
    branchBookmarks: isRecord(jsonValue(LOCAL_KEYS.branchBookmarks)) ? jsonValue(LOCAL_KEYS.branchBookmarks) as Record<string, unknown> : {},
    defaultDocument: jsonValue(LOCAL_KEYS.defaultDocument),
    activeLargeRecord: typeof localStorage.getItem(LOCAL_KEYS.activeLargeRecord) === "string" ? localStorage.getItem(LOCAL_KEYS.activeLargeRecord) : null,
    themePreference: theme === "light" || theme === "dark" ? theme : "system",
    displaySettings: isRecord(display) ? {
      showNumbers: display.showNumbers !== false,
      showCoordinates: display.showCoordinates !== false,
      showForbidden: display.showForbidden !== false,
    } : { showNumbers: true, showCoordinates: true, showForbidden: true },
    soundSettings: normalizeSoundSettings(jsonValue(LOCAL_KEYS.soundSettings)),
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
  if (!isRecord(value) || !Array.isArray(value.library) || !value.library.every(isGameDocument) || (value.active !== null && !isGameDocument(value.active)) || !isRecord(value.drafts) || !Object.values(value.drafts).every((draft) => isRecord(draft) && Array.isArray(draft.operations) && Array.isArray(draft.redo)) || !Array.isArray(value.puzzleCollections) || !value.puzzleCollections.every(isPuzzleCollection) || !isRecord(value.puzzleProgress) || !isRecord(value.puzzleTitleOverrides) || !isStringRecord(value.puzzleTitleOverrides.collections) || !isStringRecord(value.puzzleTitleOverrides.puzzles) || !isRecord(value.libraryFolders) || !Array.isArray(value.libraryFolders.recordFolders) || !Array.isArray(value.libraryFolders.puzzleFolders) || !isStringRecord(value.libraryFolders.recordAssignments) || !isStringRecord(value.libraryFolders.puzzleAssignments) || !isRecord(value.branchBookmarks) || (value.defaultDocument !== null && !isGameDocument(value.defaultDocument)) || (value.activeLargeRecord !== null && typeof value.activeLargeRecord !== "string") || !["system", "light", "dark"].includes(String(value.themePreference)) || !isRecord(value.displaySettings) || typeof value.displaySettings.showNumbers !== "boolean" || typeof value.displaySettings.showCoordinates !== "boolean" || typeof value.displaySettings.showForbidden !== "boolean" || (value.soundSettings !== undefined && !isSoundSettings(value.soundSettings))) return false;
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

export const createBackupSnapshot = async (appVersion = "unknown"): Promise<BackupSnapshot> => ({
  schema: SCHEMA,
  version: VERSION,
  appVersion,
  exportedAt: new Date().toISOString(),
  localStorage: captureLocalStorage(),
  indexedDb: encodeValue(await exportLargeStorageRecords()) as LargeStorageRecords,
});

export const serializeBackup = (snapshot: BackupSnapshot) => {
  if (!validateBackup(snapshot)) throw new Error("备份数据未通过格式校验");
  return JSON.stringify(snapshot, null, 2);
};

export const parseBackup = (text: string): BackupSnapshot => {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("备份文件不是有效的 JSON"); }
  if (!validateBackup(value)) throw new Error("备份文件版本、字段或数据结构无效");
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
    [LOCAL_KEYS.branchBookmarks, value.branchBookmarks], [LOCAL_KEYS.defaultDocument, value.defaultDocument],
    [LOCAL_KEYS.displaySettings, value.displaySettings], [LOCAL_KEYS.soundSettings, value.soundSettings || DEFAULT_SOUND_SETTINGS],
  ];
  for (const [key, item] of jsonEntries) if (item !== null) localStorage.setItem(key, JSON.stringify(item));
  for (const [key, item] of Object.entries(value.drafts)) localStorage.setItem(key, JSON.stringify(item));
  if (value.activeLargeRecord !== null) localStorage.setItem(LOCAL_KEYS.activeLargeRecord, value.activeLargeRecord);
  localStorage.setItem(LOCAL_KEYS.themePreference, value.themePreference);
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
