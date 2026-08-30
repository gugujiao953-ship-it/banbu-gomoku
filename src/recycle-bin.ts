import type { GameDocument } from "./types";
import type { PuzzleCollection } from "./puzzles";
import type { LargeDocumentSummary } from "./large-storage";

const RECYCLE_BIN_KEY = "banbu-recycle-bin-v1";

export type RecycleBinEntry =
  | { id: string; kind: "record"; item: GameDocument; folder: string; deletedAt: string }
  | { id: string; kind: "large-record"; item: LargeDocumentSummary; folder: string; deletedAt: string }
  | { id: string; kind: "puzzle-collection"; item: PuzzleCollection; folder: string; deletedAt: string };

const isEntry = (value: unknown): value is RecycleBinEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecycleBinEntry>;
  return typeof entry.id === "string"
    && (entry.kind === "record" || entry.kind === "large-record" || entry.kind === "puzzle-collection")
    && typeof entry.folder === "string"
    && typeof entry.deletedAt === "string"
    && Boolean(entry.item && typeof entry.item === "object");
};

export const loadRecycleBin = (): RecycleBinEntry[] => {
  try {
    const value = JSON.parse(localStorage.getItem(RECYCLE_BIN_KEY) || "[]") as unknown;
    return Array.isArray(value) ? value.filter(isEntry).sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)) : [];
  } catch { return []; }
};

export const saveRecycleBin = (entries: RecycleBinEntry[]) => {
  localStorage.setItem(RECYCLE_BIN_KEY, JSON.stringify(entries));
};

export const addToRecycleBin = (entry: RecycleBinEntry) => {
  const next = [entry, ...loadRecycleBin().filter((item) => !(item.kind === entry.kind && item.id === entry.id))];
  saveRecycleBin(next);
  return next;
};

export const removeFromRecycleBin = (kind: RecycleBinEntry["kind"], id: string) => {
  const next = loadRecycleBin().filter((item) => !(item.kind === kind && item.id === id));
  saveRecycleBin(next);
  return next;
};

export const clearRecycleBin = () => {
  saveRecycleBin([]);
  return [] as RecycleBinEntry[];
};
