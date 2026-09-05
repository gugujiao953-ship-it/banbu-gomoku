import { describe, expect, it } from "vitest";
import { addMoveAs, boardAt, createDocument } from "../../game";
import { createPuzzleSetupSession, movePuzzleSetupCursor, placePuzzleSetupStone, puzzleSetupView } from "./puzzle-setup-session";

describe("puzzle setup session", () => {
  it("starts from the current puzzle position without mutating the source document", () => {
    const source = createDocument("测试题");
    const initial = addMoveAs(source, source.rootId, { row: 7, col: 7 }, "black");
    const snapshot = JSON.stringify(initial.document);
    const session = createPuzzleSetupSession(initial.document, initial.nodeId);
    const view = puzzleSetupView(session);

    expect(boardAt(view.document, view.currentId)[7][7]).toBe("black");
    expect(JSON.stringify(initial.document)).toBe(snapshot);
    expect(view.document.nodes[view.document.rootId].children).toEqual([]);
  });

  it("keeps one linear line and discards the old future after placing from history", () => {
    const source = createDocument("测试题");
    let session = createPuzzleSetupSession(source, source.rootId);
    session = placePuzzleSetupStone(session, { row: 7, col: 7 }, "black").session;
    session = placePuzzleSetupStone(session, { row: 7, col: 8 }, "white").session;
    session = movePuzzleSetupCursor(session, 1);
    session = placePuzzleSetupStone(session, { row: 8, col: 7 }, "white").session;
    const view = puzzleSetupView(session);
    const board = boardAt(view.document, view.currentId);

    expect(session.cursor).toBe(2);
    expect(session.moves).toEqual([
      { row: 7, col: 7, player: "black" },
      { row: 8, col: 7, player: "white" },
    ]);
    expect(board[7][8]).toBeNull();
    expect(board[8][7]).toBe("white");
    expect(Object.values(view.document.nodes).every((node) => node.children.length <= 1)).toBe(true);
  });

  it("supports root, previous, next and end cursor navigation", () => {
    const source = createDocument("测试题");
    let session = createPuzzleSetupSession(source, source.rootId);
    session = placePuzzleSetupStone(session, { row: 7, col: 7 }, "black").session;
    session = placePuzzleSetupStone(session, { row: 7, col: 8 }, "white").session;

    expect(movePuzzleSetupCursor(session, 0).cursor).toBe(0);
    expect(movePuzzleSetupCursor(session, session.cursor - 1).cursor).toBe(1);
    expect(movePuzzleSetupCursor(movePuzzleSetupCursor(session, 0), 1).cursor).toBe(1);
    expect(movePuzzleSetupCursor(session, session.moves.length).cursor).toBe(2);
  });

  it("rejects occupied points without changing history", () => {
    const source = createDocument("测试题");
    const initial = addMoveAs(source, source.rootId, { row: 7, col: 7 }, "black");
    const session = createPuzzleSetupSession(initial.document, initial.nodeId);
    const result = placePuzzleSetupStone(session, { row: 7, col: 7 }, "white");

    expect(result.placed).toBe(false);
    expect(result.session).toBe(session);
  });
});
