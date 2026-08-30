import { describe, expect, it } from "vitest";
import { importPhaseLabel, importPhaseStep, importProgressPercent, mergeImportProgress, type ImportProgressState } from "./import-progress";

const base = (overrides: Partial<ImportProgressState> = {}): ImportProgressState => ({
  id: 1,
  phase: "reading",
  fileName: "示例.sgf",
  detail: "正在读取",
  ...overrides,
});

describe("import progress", () => {
  it("maps technical phases to four visible stages", () => {
    expect(["reading", "parsing", "indexing", "saving", "complete"].map((phase) => importPhaseStep(phase as ImportProgressState["phase"]))).toEqual([0, 1, 2, 2, 3]);
    expect(importPhaseLabel("saving")).toBe("正在保存到本机");
  });

  it("shows a percentage only when measurable progress is supplied", () => {
    expect(importProgressPercent()).toBeUndefined();
    expect(importProgressPercent(0.426)).toBe(43);
    expect(importProgressPercent(2)).toBe(100);
  });

  it("does not let updates move backwards within a phase", () => {
    const current = base({ phase: "parsing", progress: 0.6 });
    expect(mergeImportProgress(current, { progress: 0.4 }).progress).toBe(0.6);
    expect(mergeImportProgress(current, { phase: "reading", detail: "迟到的消息" })).toBe(current);
  });

  it("clears an old percentage when moving to an indeterminate phase", () => {
    const next = mergeImportProgress(base({ phase: "parsing", progress: 1 }), { phase: "saving", detail: "写入索引" });
    expect(next.phase).toBe("saving");
    expect(next.progress).toBeUndefined();
  });

  it("retains batch counters and permits terminal states", () => {
    const current = base({ phase: "saving", currentFile: 2, totalFiles: 3, progress: 2 / 3 });
    const next = mergeImportProgress(current, { phase: "complete", detail: "已完成" });
    expect(next).toMatchObject({ phase: "complete", currentFile: 2, totalFiles: 3, detail: "已完成" });
  });

  it("remembers which stage failed", () => {
    const next = mergeImportProgress(base({ phase: "parsing" }), { phase: "error", detail: "格式错误" });
    expect(next.failedAt).toBe("parsing");
  });
});
