import { describe, expect, it } from "vitest";
import { createPuzzleDocument, deriveWrongPuzzleEntries, importKaibaoPuzzleJson, isPuzzleJsonText, puzzleProgressKey } from "./puzzles";
import type { PuzzleCollection } from "./puzzles";

describe("puzzle JSON import", () => {
  it("detects puzzle JSON before the general record importer", () => {
    expect(isPuzzleJsonText(JSON.stringify({ puzzles: [{ side: 1, stones: "H8H9" }] }))).toBe(true);
    expect(isPuzzleJsonText(JSON.stringify([[ "H8,1", "H9,2" ]]))).toBe(true);
    expect(isPuzzleJsonText(JSON.stringify({ metadata: {}, nodes: {} }))).toBe(false);
    expect(isPuzzleJsonText(JSON.stringify({ Board: {}, Button: {} }))).toBe(false);
  });

  it("keeps the legacy compact array format", () => {
    const report = importKaibaoPuzzleJson(JSON.stringify([[ "★", "H8,1", "I8,2", "G9,1" ]]), "旧格式");
    expect(report.collection.puzzles).toHaveLength(1);
    expect(report.collection.puzzles[0].stones.map((stone) => stone.player)).toEqual(["black", "white", "black"]);
    expect(report.collection.puzzles[0].difficulty).toBe(1);
  });

  it("imports the native wrapper with a compact stones sequence and explicit side", () => {
    const report = importKaibaoPuzzleJson(JSON.stringify({
      link: "https://lfz084.gitee.io/renju/puzzle.html",
      defaultSettings: { title: "詰め连珠" },
      puzzles: [{
        side: 1,
        rule: 2,
        size: 15,
        comment: "黑先寻找胜着",
        stones: "H10H11F9G9H8I9E7F8G7F7H7I6F6E5",
        level: 4,
      }],
    }), "RenjuPortal");
    const puzzle = report.collection.puzzles[0];
    expect(report.collection.source).toBe("https://lfz084.gitee.io/renju/puzzle.html");
    expect(puzzle.player).toBe("black");
    expect(puzzle.boardSize).toBe(15);
    expect(puzzle.stones).toHaveLength(14);
    expect(puzzle.stones[0]).toMatchObject({ row: 5, col: 7, player: "black" });
    expect(puzzle.prompt).toBe("黑先寻找胜着");
    expect(puzzle.difficulty).toBe(4);
    expect(createPuzzleDocument(puzzle).document.metadata.boardSize).toBe(15);
  });

  it("imports split black and white coordinate strings without deriving the turn from parity", () => {
    const report = importKaibaoPuzzleJson(JSON.stringify({
      puzzles: [{
        side: 2,
        blackStones: "C13C12D14",
        whiteStones: "D11E13",
      }],
    }), "分色题库");
    const puzzle = report.collection.puzzles[0];
    expect(puzzle.player).toBe("white");
    expect(puzzle.stones.filter((stone) => stone.player === "black")).toHaveLength(3);
    expect(puzzle.stones.filter((stone) => stone.player === "white")).toHaveLength(2);
  });

  it("explains when a theme JSON is selected instead of a puzzle collection", () => {
    expect(() => importKaibaoPuzzleJson(JSON.stringify({ Board: {}, Button: {}, fullscreenUI: {} }))).toThrow("主题配置");
  });

  it("derives the wrong-book list from unfinished puzzle attempts only", () => {
    const collections: PuzzleCollection[] = [
      { id: "c1", title: "第一题集", source: "用户", license: "自有", puzzles: [{ id: "p1", title: "A题", prompt: "", difficulty: 2 as const, player: "black", stones: [] }] },
      { id: "c2", title: "第二题集", source: "用户", license: "自有", puzzles: [{ id: "p2", title: "B题", prompt: "", difficulty: 2 as const, player: "black", stones: [] }] },
    ];
    const progress = {
      [puzzleProgressKey("c1", "p1")]: { solved: false, attempts: 3, updatedAt: "2026-08-29T10:00:00.000Z" },
      [puzzleProgressKey("c2", "p2")]: { solved: true, attempts: 5, updatedAt: "2026-08-29T11:00:00.000Z" },
    };
    const review = deriveWrongPuzzleEntries(collections, progress);
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ collectionId: "c1", puzzleId: "p1", attempts: 3, solved: false });
  });
});
