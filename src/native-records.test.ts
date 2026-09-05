// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeMatchRecords, NATIVE_MATCH_ASSET, NATIVE_MATCH_FOLDER } from "./native-records";

const matchSgf = Array.from({ length: 5 }, (_, index) => `(;GM[4]FF[4]SZ[15]DT[2018-04-${String(15 + index).padStart(2, "0")}]PB[${index === 1 || index === 2 ? "Qi Guan" : "Yixin"}]PW[${index === 1 || index === 2 ? "Yixin" : "Qi Guan"}]RE[0]B[hh]W[ig]B[gj])`).join("");

describe("native match records", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads all five games into one stable built-in record group", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => matchSgf });
    vi.stubGlobal("fetch", fetchMock);

    const records = await loadNativeMatchRecords();

    expect(fetchMock).toHaveBeenCalledWith(`/${NATIVE_MATCH_ASSET}`);
    expect(records).toHaveLength(5);
    expect(records.map((record) => record.metadata.title)).toEqual(["第1局", "第2局", "第3局", "第4局", "第5局"]);
    expect(records.map((record) => record.id)).toEqual([
      "native-record-qiguan-yixin-2018-game-1",
      "native-record-qiguan-yixin-2018-game-2",
      "native-record-qiguan-yixin-2018-game-3",
      "native-record-qiguan-yixin-2018-game-4",
      "native-record-qiguan-yixin-2018-game-5",
    ]);
    expect(records.every((record) => record.metadata.sourceFormat === "sgf")).toBe(true);
    expect(records.every((record) => record.metadata.sourceFileName === NATIVE_MATCH_ASSET)).toBe(true);
    expect(records.every((record) => Object.keys(record.nodes).length === 4)).toBe(true);
    expect(NATIVE_MATCH_FOLDER).toBe("祁观vs弈心 人机大战五局");
  });

  it("rejects a bundled file that is not a five-game SGF collection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "(;SZ[15];B[hh])" }));

    await expect(loadNativeMatchRecords()).rejects.toThrow("应包含 5 局");
  });

});
