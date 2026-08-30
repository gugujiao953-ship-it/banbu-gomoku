export type ImportPhase = "reading" | "parsing" | "indexing" | "saving" | "complete" | "error";

export interface ImportProgressState {
  id: number;
  phase: ImportPhase;
  fileName: string;
  detail: string;
  currentFile?: number;
  totalFiles?: number;
  progress?: number;
  background?: boolean;
  failedAt?: Exclude<ImportPhase, "complete" | "error">;
}

export type ImportProgressPatch = Partial<Omit<ImportProgressState, "id">>;

const phaseOrder: Record<ImportPhase, number> = {
  reading: 0,
  parsing: 1,
  indexing: 2,
  saving: 3,
  complete: 4,
  error: 5,
};

export const importPhaseLabel = (phase: ImportPhase) => ({
  reading: "正在读取文件",
  parsing: "正在解析棋谱",
  indexing: "正在建立索引",
  saving: "正在保存到本机",
  complete: "导入完成",
  error: "导入未完成",
}[phase]);

export const importPhaseStep = (phase: ImportPhase) => {
  if (phase === "reading") return 0;
  if (phase === "parsing") return 1;
  if (phase === "indexing" || phase === "saving") return 2;
  return 3;
};

export const importProgressPercent = (progress?: number) => progress === undefined
  ? undefined
  : Math.round(Math.min(1, Math.max(0, progress)) * 100);

export const mergeImportProgress = (current: ImportProgressState, patch: ImportProgressPatch): ImportProgressState => {
  const nextPhase = patch.phase || current.phase;
  if (nextPhase !== "error" && nextPhase !== "complete" && phaseOrder[nextPhase] < phaseOrder[current.phase]) return current;

  const phaseChanged = nextPhase !== current.phase;
  let progress = phaseChanged ? patch.progress : patch.progress ?? current.progress;
  if (!phaseChanged && progress !== undefined && current.progress !== undefined) progress = Math.max(progress, current.progress);
  if (progress !== undefined) progress = Math.min(1, Math.max(0, progress));

  const failedAt = nextPhase === "error" && current.phase !== "complete" && current.phase !== "error"
    ? current.phase
    : patch.failedAt ?? current.failedAt;
  return { ...current, ...patch, phase: nextPhase, progress, failedAt };
};
