import { useSyncExternalStore } from "react";
import type { AiAnalysisCandidate } from "../../puzzle-ai";
import type { Player, Position } from "../../types";

export type AiAnalysisEngine = "light" | "full" | "multi" | "native" | "kata" | "ikatago";

export interface AiAnalysisState {
  status: "idle" | "thinking" | "complete" | "error";
  engine: AiAnalysisEngine;
  contextKey?: string;
  mover?: Player;
  depth: number;
  selDepth?: number;
  nodes: number;
  speed?: number;
  score?: number;
  scoreAvailable?: boolean;
  winRate?: number;
  drawRate?: number;
  move?: Position | null;
  candidates?: AiAnalysisCandidate[];
  principalVariation?: Array<Position & { player: Player }>;
  elapsedMs?: number;
}

export const INITIAL_AI_ANALYSIS: AiAnalysisState = {
  status: "idle",
  engine: "light",
  depth: 0,
  nodes: 0,
  contextKey: "",
};

type AnalysisUpdater = AiAnalysisState | ((current: AiAnalysisState) => AiAnalysisState);

let snapshot = INITIAL_AI_ANALYSIS;
const listeners = new Set<() => void>();

export const aiAnalysisStore = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  publish: (next: AiAnalysisState) => {
    if (Object.is(next, snapshot)) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  },
  reset: () => {
    aiAnalysisStore.publish(INITIAL_AI_ANALYSIS);
  },
  update: (updater: AnalysisUpdater) => {
    aiAnalysisStore.publish(typeof updater === "function" ? updater(snapshot) : updater);
    return snapshot;
  },
};

/** Subscribe only the small visual subtree that needs live engine frames. */
export const useAiAnalysisState = () => useSyncExternalStore(
  aiAnalysisStore.subscribe,
  aiAnalysisStore.getSnapshot,
  aiAnalysisStore.getSnapshot,
);

