import { describe, expect, it } from "vitest";
import type { PuzzleCollection } from "../../puzzles";
import { puzzleProgressKey } from "../../puzzles";
import { recentPuzzleItems } from "./recent-puzzles";

const collections: PuzzleCollection[] = [{ id: "set-1", title: "入门题", source: "测试", license: "", puzzles: [
  { id: "p-1", title: "冲四", prompt: "黑先", difficulty: 1, stones: [], player: "black" },
  { id: "p-2", title: "防守", prompt: "白先", difficulty: 2, stones: [], player: "white" },
] }];

describe("recent puzzle items", () => {
  it("sorts attempted puzzles by latest progress and keeps the open target", () => {
    const progress = {
      [puzzleProgressKey("set-1", "p-1")]: { solved: false, attempts: 2, updatedAt: "2026-08-30T02:00:00.000Z" },
      [puzzleProgressKey("set-1", "p-2")]: { solved: true, attempts: 1, updatedAt: "2026-08-30T03:00:00.000Z" },
    };
    const items = recentPuzzleItems(collections, progress);
    expect(items.map((item) => item.puzzleId)).toEqual(["p-2", "p-1"]);
    expect(items[1]).toMatchObject({ collectionIndex: 0, puzzleIndex: 0, attempts: 2, solved: false });
  });

  it("limits the section to four entries", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      id: `p-${index}`, title: `题 ${index}`, prompt: "", difficulty: 1 as const, stones: [], player: "black" as const,
    }));
    const set = [{ ...collections[0], puzzles: many }];
    const progress = Object.fromEntries(many.map((puzzle, index) => [puzzleProgressKey("set-1", puzzle.id), { solved: false, attempts: 1, updatedAt: `2026-08-30T0${index}:00:00.000Z` }]));
    expect(recentPuzzleItems(set, progress)).toHaveLength(4);
  });
});
