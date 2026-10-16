// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANALYSIS_CACHE_KEY,
  analysisCacheEntryCount,
  clearAnalysisCache,
  getAnalysisCacheEntry,
  putAnalysisCacheEntry,
  removeDocumentAnalysisCache,
  type AnalysisCacheEntry,
} from "./analysis-cache";

const makeEntry = (over: Partial<AnalysisCacheEntry> = {}): AnalysisCacheEntry => ({
  ts: 1000,
  mover: "black",
  depth: 14,
  nodes: 12345,
  winRate: 0.62,
  score: 35,
  scoreAvailable: true,
  candidates: [
    { move: { row: 7, col: 8 }, winRate: 0.62, score: 35, depth: 14 },
    { move: { row: 7, col: 7 }, winRate: 0.58, score: 21, depth: 13 },
  ],
  ...over,
});

describe("analysis cache", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips an entry by document and node id", () => {
    putAnalysisCacheEntry("doc1", "node1", makeEntry());
    const loaded = getAnalysisCacheEntry("doc1", "node1");
    expect(loaded?.depth).toBe(14);
    expect(loaded?.mover).toBe("black");
    expect(loaded?.winRate).toBe(0.62);
    expect(loaded?.candidates?.[0]?.move).toEqual({ row: 7, col: 8 });
    expect(getAnalysisCacheEntry("doc1", "node2")).toBeNull();
    expect(getAnalysisCacheEntry("doc2", "node1")).toBeNull();
  });

  it("keeps at most three candidates when storing", () => {
    const entry = makeEntry({
      candidates: [
        { move: { row: 1, col: 1 } },
        { move: { row: 2, col: 2 } },
        { move: { row: 3, col: 3 } },
        { move: { row: 4, col: 4 } },
        { move: { row: 5, col: 5 } },
      ],
    });
    putAnalysisCacheEntry("doc", "node", entry);
    expect(getAnalysisCacheEntry("doc", "node")?.candidates?.length).toBe(3);
  });

  it("drops malformed entries instead of throwing", () => {
    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify({ version: 1, entries: { "a::b": { ts: "x" }, "c::d": { ts: 5, mover: "white", depth: 3, nodes: 9 } } }));
    expect(getAnalysisCacheEntry("a", "b")).toBeNull();
    expect(getAnalysisCacheEntry("c", "d")?.mover).toBe("white");
    putAnalysisCacheEntry("e", "f", makeEntry());
    expect(getAnalysisCacheEntry("a", "b")).toBeNull(); // 重写时坏条目被清掉
    expect(getAnalysisCacheEntry("c", "d")).not.toBeNull(); // 合法条目保留
  });

  it("survives corrupted storage", () => {
    localStorage.setItem(ANALYSIS_CACHE_KEY, "{not json");
    expect(getAnalysisCacheEntry("a", "b")).toBeNull();
    expect(() => putAnalysisCacheEntry("a", "b", makeEntry())).not.toThrow();
    expect(getAnalysisCacheEntry("a", "b")?.depth).toBe(14);
  });

  it("evicts the oldest entries beyond the LRU cap", () => {
    for (let index = 0; index < 640; index += 1) {
      putAnalysisCacheEntry("doc", `node-${index}`, makeEntry({ ts: index }));
    }
    expect(analysisCacheEntryCount()).toBeLessThanOrEqual(600);
    expect(getAnalysisCacheEntry("doc", "node-0")).toBeNull();
    expect(getAnalysisCacheEntry("doc", "node-639")?.ts).toBe(639);
  });

  it("removes all entries of one document", () => {
    putAnalysisCacheEntry("docA", "n1", makeEntry());
    putAnalysisCacheEntry("docA", "n2", makeEntry({ ts: 2 }));
    putAnalysisCacheEntry("docB", "n1", makeEntry({ ts: 3 }));
    removeDocumentAnalysisCache("docA");
    expect(getAnalysisCacheEntry("docA", "n1")).toBeNull();
    expect(getAnalysisCacheEntry("docB", "n1")).not.toBeNull();
  });

  it("clearAnalysisCache empties everything", () => {
    putAnalysisCacheEntry("doc", "node", makeEntry());
    clearAnalysisCache();
    expect(analysisCacheEntryCount()).toBe(0);
  });
});
