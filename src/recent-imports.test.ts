import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadRecentImports, openRecentImport, readRecentImportText, saveRecentImport, saveRecentText } from "./recent-imports";

const deleteDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase("banbu-gomoku-recent-imports");
  request.onsuccess = request.onerror = request.onblocked = () => resolve();
});

describe("recent imports", () => {
  beforeEach(() => deleteDatabase());

  it("keeps the latest eight files and reopens a stored file", async () => {
    for (let index = 0; index < 9; index += 1) {
      await saveRecentImport(new File([`(;SZ[15]C[${index}])`], `棋谱-${index}.sgf`, { type: "application/x-go-sgf", lastModified: index }), "record");
    }
    const entries = await loadRecentImports();
    expect(entries).toHaveLength(8);
    expect(entries.map((entry) => entry.name)).toEqual(["棋谱-8.sgf", "棋谱-7.sgf", "棋谱-6.sgf", "棋谱-5.sgf", "棋谱-4.sgf", "棋谱-3.sgf", "棋谱-2.sgf", "棋谱-1.sgf"]);
    const reopened = await openRecentImport(entries[0].id);
    expect(reopened?.name).toBe("棋谱-8.sgf");
    expect(await reopened?.text()).toContain("C[8]");
  });

  it("keeps metadata but does not copy oversized files", async () => {
    const file = new File([new Uint8Array(48 * 1024 * 1024 + 1)], "large.lib", { type: "application/octet-stream" });
    const entry = await saveRecentImport(file, "record");
    expect(entry.available).toBe(false);
    expect(await openRecentImport(entry.id)).toBeNull();
  });

  it("keeps distinct coordinate texts with the same length and prefix", async () => {
    const prefix = "a1b2c3d4e5f6g7h8i9j10k11";
    const first = await saveRecentText(`${prefix}l12`, "coordinate", "第一份");
    const second = await saveRecentText(`${prefix}m13`, "coordinate", "第二份");
    expect(first.id).not.toBe(second.id);
    expect(await readRecentImportText(first.id)).toBe(`${prefix}l12`);
    expect(await readRecentImportText(second.id)).toBe(`${prefix}m13`);
    expect(await loadRecentImports()).toHaveLength(2);
  });

  it("updates the name when the same text is imported again", async () => {
    await saveRecentText("a1b2c3", "coordinate", "原名称");
    const latest = await saveRecentText("a1b2c3", "coordinate", "新名称");
    expect(await loadRecentImports()).toEqual([latest]);
    expect(await readRecentImportText(latest.id)).toBe("a1b2c3");
  });

  it("keeps both equally sized texts with the same display name", async () => {
    const first = await saveRecentText("a1b2c3", "coordinate", "坐标代码");
    const second = await saveRecentText("d4e5f6", "coordinate", "坐标代码");
    expect(await loadRecentImports()).toHaveLength(2);
    expect(await readRecentImportText(first.id)).toBe("a1b2c3");
    expect(await readRecentImportText(second.id)).toBe("d4e5f6");
  });

  it("retains the latest eight during concurrent imports", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => saveRecentText(`a${index + 1}`, "coordinate", `文本 ${index}`)));
    const entries = await loadRecentImports();
    expect(entries).toHaveLength(8);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(8);
    for (const entry of entries) expect(await readRecentImportText(entry.id)).toBe(entry.text);
  });
});
