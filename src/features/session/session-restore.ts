import type { AppMode } from "../../app-shell-types";

const RESTORE_PREFERENCE_KEY = "banbu-restore-last-position-v1";
const SESSION_KEY = "banbu-last-session-v1";

export interface LastSessionState {
  documentId: string;
  nodeId: string;
  mode: AppMode;
  largeId?: string;
  puzzleCollectionId?: string;
  puzzleId?: string;
  updatedAt: string;
}

const isMode = (value: unknown): value is AppMode => value === "record" || value === "review" || value === "puzzle";

export const loadRestoreLastPosition = (): boolean => {
  try { return localStorage.getItem(RESTORE_PREFERENCE_KEY) !== "false"; } catch { return true; }
};

export const saveRestoreLastPosition = (enabled: boolean) => {
  try { localStorage.setItem(RESTORE_PREFERENCE_KEY, String(enabled)); } catch { /* storage is optional */ }
};

export const loadLastSession = (): LastSessionState | null => {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as Partial<LastSessionState> | null;
    if (!value || typeof value.documentId !== "string" || typeof value.nodeId !== "string" || !isMode(value.mode)) return null;
    return {
      documentId: value.documentId,
      nodeId: value.nodeId,
      mode: value.mode,
      ...(typeof value.largeId === "string" ? { largeId: value.largeId } : {}),
      ...(typeof value.puzzleCollectionId === "string" ? { puzzleCollectionId: value.puzzleCollectionId } : {}),
      ...(typeof value.puzzleId === "string" ? { puzzleId: value.puzzleId } : {}),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  } catch { return null; }
};

export const saveLastSession = (state: Omit<LastSessionState, "updatedAt">) => {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() })); } catch { /* storage is optional */ }
};

export const clearLastSession = () => {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* storage is optional */ }
};

export const sessionRestoreKeys = { RESTORE_PREFERENCE_KEY, SESSION_KEY } as const;
