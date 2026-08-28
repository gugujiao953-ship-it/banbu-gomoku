import { describe, expect, it } from "vitest";
import { emptyBoard } from "./game";
import { addFifthCandidate, completeFifthChoice, completeOpeningPlacement, createOpeningSession, decideOpeningSwap, openingPositionAllowed, suggestFifthCandidates } from "./opening-rules";

describe("opening rule state machine", () => {
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
});
