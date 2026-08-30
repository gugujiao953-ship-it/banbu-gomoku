import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadRecentImports, openRecentImport, saveRecentImport } from "./recent-imports";

const deleteDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase("banbu-gomoku-recent-imports");
  request.onsuccess = request.onerror = request.onblocked = () => resolve();
});

describe("recent imports", () => {
  beforeEach(() => deleteDatabase());

  it("keeps the latest five files and reopens a stored file", async () => {
    for (let index = 0; index < 6; index += 1) {
      await saveRecentImport(new File([`(;SZ[15]C[${index}])`], `棋谱-${index}.sgf`, { type: "application/x-go-sgf", lastModified: index }), "record");
    }
    const entries = await loadRecentImports();
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.name)).toEqual(["棋谱-5.sgf", "棋谱-4.sgf", "棋谱-3.sgf", "棋谱-2.sgf", "棋谱-1.sgf"]);
    const reopened = await openRecentImport(entries[0].id);
    expect(reopened?.name).toBe("棋谱-5.sgf");
    expect(await reopened?.text()).toContain("C[5]");
  });

  it("keeps metadata but does not copy oversized files", async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024 + 1)], "large.lib", { type: "application/octet-stream" });
    const entry = await saveRecentImport(file, "record");
    expect(entry.available).toBe(false);
    expect(await openRecentImport(entry.id)).toBeNull();
  });
});
