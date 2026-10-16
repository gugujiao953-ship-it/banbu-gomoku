import { describe, expect, it } from "vitest";
import { boardAt, nextPlayerAt } from "./game";
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
    expect(createPuzzleDocument(puzzle).document.metadata.rule).toBe("freestyle");
  });

  it("imports explicit textual puzzle rules without guessing numeric third-party codes", () => {
    const report = importKaibaoPuzzleJson(JSON.stringify({
      rule: "renju",
      puzzles: [
        { title: "继承题集规则", side: "black", stones: "H8I8" },
        { title: "题目覆盖", side: "black", rule: "无禁手", stones: "H8I8" },
      ],
    }), "规则题集");
    expect(report.collection.rule).toBe("renju");
    expect(report.collection.puzzles[0].rule).toBeUndefined();
    expect(report.collection.puzzles[1].rule).toBe("freestyle");
  });

  it("preserves non-15 board sizes when a saved puzzle is reopened", () => {
    const puzzle = {
      id: "saved-19",
      title: "19路题目",
      prompt: "从这个局面开始练习",
      difficulty: 3 as const,
      player: "black" as const,
      boardSize: 19,
      stones: [{ row: 3, col: 16, player: "black" as const }],
    };
    const session = createPuzzleDocument(puzzle);
    expect(session.document.metadata.boardSize).toBe(19);
    expect(session.document.nodes[session.initialNodeId].move).toMatchObject({ row: 3, col: 16 });
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

  // 用户 2026-09-14（bug 3）：白先题的预置子是一组「局面棋子」，导入顺序不是手序，
  // 最后一张子常是白子；若按最后落子颜色反推行棋方，白先题会被算成黑先——分析的
  // player 也就传成黑方，落子还会被「现在轮到陪练落子」挡掉。行棋方必须以题目的
  // player（首手方）为准。
  it("白先题的初始行棋方是白（预置子顺序不代表手序）", () => {
    const report = importKaibaoPuzzleJson(JSON.stringify([[
      "★", "I10,2", "J10,2", "H9,2", "I9,1", "G8,1", "H8,1", "I8,2", "K8,1",
      "F7,2", "G7,1", "I7,2", "J7,1", "K7,1", "F6,2", "H6,1", "I6,1", "H5,2",
    ]]), "白先题集");
    const puzzle = report.collection.puzzles[0];
    expect(puzzle.player).toBe("white");
    const session = createPuzzleDocument(puzzle);
    expect(nextPlayerAt(session.document, session.initialNodeId)).toBe("white");
    // 修复只是补上权威轮次，不能在预置局面上多/少子。
    expect(boardAt(session.document, session.initialNodeId).flat().filter(Boolean)).toHaveLength(puzzle.stones.length);
    expect(boardAt(session.document, session.initialNodeId)[6][8]).toBe("black"); // I9,1
  });

  it("白先题里显式声明的行棋方压过最后一手的颜色（分析/提示按白方算）", () => {
    const report = importKaibaoPuzzleJson(JSON.stringify({
      puzzles: [{ side: 2, blackStones: "C13C12D14", whiteStones: "D11E13" }],
    }), "分色白先题集");
    const puzzle = report.collection.puzzles[0];
    // 分色导入先黑后白，最后一张是白子；黑白子数 3:2 说明该白走。
    expect(puzzle.stones[puzzle.stones.length - 1].player).toBe("white");
    expect(puzzle.player).toBe("white");
    const session = createPuzzleDocument(puzzle);
    expect(nextPlayerAt(session.document, session.initialNodeId)).toBe("white");
    expect(session.document.nodes[session.initialNodeId].move).toBeTruthy();
  });

  it("黑先题的行棋方仍是黑（白先修复不越界）", () => {
    const blackFirst = importKaibaoPuzzleJson(JSON.stringify({
      puzzles: [{ side: 1, blackStones: "H8H9", whiteStones: "I8" }],
    }), "黑先").collection.puzzles[0];
    expect(blackFirst.player).toBe("black");
    const session = createPuzzleDocument(blackFirst);
    expect(nextPlayerAt(session.document, session.initialNodeId)).toBe("black");
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

  // 用户 2026-09-21：错题本可把「不想再练但也确实没解出」的题标为已掌握收起。
  // masteredKeys 是可选的（不传＝一个都不收起），既有调用点与旧存档都不受影响。
  it("keeps mastered puzzles out of the wrong-book without touching solved", () => {
    const collections: PuzzleCollection[] = [
      { id: "c1", title: "第一题集", source: "用户", license: "自有", puzzles: [
        { id: "p1", title: "A题", prompt: "", difficulty: 2 as const, player: "black", stones: [] },
        { id: "p2", title: "B题", prompt: "", difficulty: 2 as const, player: "black", stones: [] },
      ] },
    ];
    const progress = {
      [puzzleProgressKey("c1", "p1")]: { solved: false, attempts: 3, updatedAt: "2026-08-29T10:00:00.000Z" },
      [puzzleProgressKey("c1", "p2")]: { solved: false, attempts: 1, updatedAt: "2026-08-29T11:00:00.000Z" },
    };
    // 不传掌握集合：两道都还在（向后兼容）。
    expect(deriveWrongPuzzleEntries(collections, progress)).toHaveLength(2);
    // 收起 p1：只剩 p2；进度记录本身不动，所以取消标记后还能回来。
    const mastered = new Set([puzzleProgressKey("c1", "p1")]);
    const review = deriveWrongPuzzleEntries(collections, progress, mastered);
    expect(review).toHaveLength(1);
    expect(review[0].puzzleId).toBe("p2");
    expect(progress[puzzleProgressKey("c1", "p1")]).toEqual({ solved: false, attempts: 3, updatedAt: "2026-08-29T10:00:00.000Z" });
  });
});
