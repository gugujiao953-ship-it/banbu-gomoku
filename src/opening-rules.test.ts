import { describe, expect, it } from "vitest";
import { emptyBoard } from "./game";
import { addFifthCandidate, chooseFifthCount, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, openingInstruction, openingPositionAllowed, suggestFifthCandidates } from "./opening-rules";

describe("opening rule state machine", () => {
  it("runs one-hand exchange through a single swap point", () => {
    let session = createOpeningSession("swap1", 0, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 1, chooser: "ai" });
    expect(decideOpeningSwap(session, true)).toMatchObject({ humanPlayer: "white", stage: { kind: "normal" } });
  });

  it("runs three-hand exchange through three unrestricted placements", () => {
    let session = createOpeningSession("swap3", 0, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 3, radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "ai" });
    expect(decideOpeningSwap(session, false)).toMatchObject({ humanPlayer: "black", stage: { kind: "normal" } });
  });

  it("runs five-move two-offer through swap, offer and choice", () => {
    let session = createOpeningSession("five-two", 2, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: 0 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, actor: "human", radius: 1 });
    session = completeOpeningPlacement(session);
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "ai" });
    session = decideOpeningSwap(session, false);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white" });
    session = completeOpeningPlacement(session);
    session = addFifthCandidate(session, { row: 6, col: 6 });
    session = addFifthCandidate(session, { row: 6, col: 7 });
    expect(session.stage).toMatchObject({ kind: "choose-fifth", chooser: "ai" });
    expect(completeFifthChoice(session).stage).toMatchObject({ kind: "place", moveNumber: 6, player: "white", actor: "ai" });
  });

  it("models Taraguchi-10's two paths after move four", () => {
    let session = createOpeningSession("taraguchi-10", 10, "black");
    for (let move = 1; move <= 3; move += 1) {
      session = completeOpeningPlacement(session);
      session = decideOpeningSwap(session, false);
    }
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 4, taraguchiChoice: true });
    expect(decideOpeningSwap(session, false).stage).toMatchObject({ kind: "offer-fifths", count: 10 });
    expect(decideOpeningSwap(session, true)).toMatchObject({ humanPlayer: "white", stage: { kind: "place", moveNumber: 5, radius: 4 } });
  });

  it("enforces center regions", () => {
    const session = createOpeningSession("tarannikov", 0, "black");
    expect(openingPositionAllowed(15, { row: 7, col: 7 }, session.stage)).toBe(true);
    expect(openingPositionAllowed(15, { row: 7, col: 8 }, session.stage)).toBe(false);
  });

  it("can prepare ten non-symmetric legal fifth choices", () => {
    const board = emptyBoard();
    board[7][7] = "black"; board[7][8] = "white"; board[8][7] = "black"; board[6][7] = "white";
    expect(suggestFifthCandidates(board, 10)).toHaveLength(10);
  });

  it("defers five-n count until after move four", () => {
    let session = createOpeningSession("five-n", 8, "white");
    session = completeOpeningPlacement(session);
    session = completeOpeningPlacement(session);
    session = completeOpeningPlacement(session);
    session = decideOpeningSwap(session, false);
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "choose-fifth-count", actor: "human" });
    expect(session.n).toBe(0);
    session = chooseFifthCount(session, 7);
    expect(session.stage).toMatchObject({ kind: "offer-fifths", count: 7 });
    expect(session.n).toBe(7);
  });

  it("runs Yamaguchi: declare before swap, white 4, black offers, white chooses", () => {
    let session = createOpeningSession("yamaguchi", 2, "black");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "human", radius: 0 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, actor: "human", radius: 1 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 3, actor: "human", radius: 2 });
    session = completeOpeningPlacement(session);
    // 宣布发生在交换决定之前（RenjuNet Yamaguchi：先手方摆开局时宣布）。
    expect(session.stage).toMatchObject({ kind: "choose-fifth-count", actor: "human" });
    expect(openingInstruction(session)).toContain("1–10");
    expect(chooseFifthCount(session, 0).n).toBe(1);
    expect(chooseFifthCount(session, 99).n).toBe(10);
    session = chooseFifthCount(session, 4);
    expect(session.n).toBe(4);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "ai" });
    const swapped = decideOpeningSwap(session, true);
    expect(swapped.humanPlayer).toBe("white");
    expect(swapped.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white", actor: "human", radius: null });
    let kept = decideOpeningSwap(session, false);
    expect(kept.humanPlayer).toBe("black");
    expect(kept.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white", actor: "ai", radius: null });
    kept = completeOpeningPlacement(kept);
    expect(kept.stage).toMatchObject({ kind: "offer-fifths", actor: "human", count: 4 });
    for (const [row, col] of [[7, 5], [7, 9], [5, 7], [9, 7]] as const) kept = addFifthCandidate(kept, { row, col });
    expect(kept.stage).toMatchObject({ kind: "choose-fifth", chooser: "ai" });
    const placed6 = completeFifthChoice(kept);
    expect(placed6.stage).toMatchObject({ kind: "place", moveNumber: 6, player: "white", actor: "ai" });
    expect(completeOpeningPlacement(placed6).stage).toMatchObject({ kind: "normal" });
  });

  it("runs Soosyrv-8: swap after 26 openings, white declares 1-8, swap again, black offers", () => {
    let session = createOpeningSession("soosyrv-8", 8, "white");
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 1, actor: "ai", radius: 0 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 2, actor: "ai", radius: 1 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 3, actor: "ai", radius: 2 });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 3, chooser: "human" });
    session = decideOpeningSwap(session, false);
    expect(session.stage).toMatchObject({ kind: "place", moveNumber: 4, player: "white", actor: "human", radius: null });
    session = completeOpeningPlacement(session);
    expect(session.stage).toMatchObject({ kind: "choose-fifth-count", actor: "human" });
    expect(openingInstruction(session)).toContain("1–8");
    expect(chooseFifthCount(session, 0).n).toBe(1);
    expect(chooseFifthCount(session, 9).n).toBe(8);
    session = chooseFifthCount(session, 5);
    expect(session.n).toBe(5);
    expect(session.stage).toMatchObject({ kind: "swap", afterMove: 4, chooser: "ai" });
    expect(openingInstruction(session)).toContain("5 个第5手打点");
    // 第二交换点被执行时，黑方角色易主，由新的黑方放置候选。
    const swapped = decideOpeningSwap(session, true);
    expect(swapped.humanPlayer).toBe("black");
    expect(swapped.stage).toMatchObject({ kind: "offer-fifths", actor: "human", count: 5 });
    // 不交换：AI（执黑）放置候选，白方（人类）选择。
    let kept = decideOpeningSwap(session, false);
    expect(kept.humanPlayer).toBe("white");
    expect(kept.stage).toMatchObject({ kind: "offer-fifths", actor: "ai", count: 5 });
    for (const [row, col] of [[7, 6], [7, 8], [6, 7], [8, 7], [6, 6]] as const) kept = addFifthCandidate(kept, { row, col });
    expect(kept.stage).toMatchObject({ kind: "choose-fifth", chooser: "human" });
    const placed6 = completeFifthChoice(kept);
    expect(placed6.stage).toMatchObject({ kind: "place", moveNumber: 6, player: "white", actor: "human" });
    expect(completeOpeningPlacement(placed6).stage).toMatchObject({ kind: "normal" });
  });

  it("keeps the fifth offer symmetric-dedup and center regions for the new rules", () => {
    const board = emptyBoard();
    board[7][7] = "black"; board[7][8] = "white"; board[8][7] = "black"; board[6][7] = "white";
    expect(suggestFifthCandidates(board, 5)).toHaveLength(5);
    const yamaguchi = createOpeningSession("yamaguchi", 2, "black");
    expect(openingPositionAllowed(15, { row: 7, col: 7 }, yamaguchi.stage)).toBe(true);
    expect(openingPositionAllowed(15, { row: 7, col: 8 }, yamaguchi.stage)).toBe(false);
    const soosyrv = createOpeningSession("soosyrv-8", 8, "black");
    expect(openingPositionAllowed(15, { row: 7, col: 7 }, soosyrv.stage)).toBe(true);
    expect(openingPositionAllowed(15, { row: 7, col: 8 }, soosyrv.stage)).toBe(false);
  });
});
