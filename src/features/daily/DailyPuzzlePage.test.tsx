// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "../../game";
import { vcfGeometry } from "../vcf-challenge/board-geometry";
import { DailyPuzzlePage } from "./DailyPuzzlePage";

describe("每日一题终局与悔棋接线", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const renderPuzzle = async (strict = false) => {
    const game = createDocument("双方四子测试", 15);
    game.nodes[game.rootId].setup = {
      black: [0, 1, 2, 3].map((col) => ({ row: 0, col })),
      white: [0, 1, 2, 3].map((col) => ({ row: 1, col })),
      empty: [], nextPlayer: "black",
    };
    const onFinished = vi.fn();
    const page = <DailyPuzzlePage title="测试" collectionTitle="题集" prompt="黑先" difficulty={1}
      boardSize={15} human="black" document={game} initialNodeId={game.rootId} rule="freestyle"
      checkMove={(board, position) => board[position.row]?.[position.col] ? "已有棋子" : null}
      alreadyDone={false} requestReply={async () => ({ row: 1, col: 4 })}
      onFinished={onFinished} onExit={() => undefined}/>;
    await act(async () => root.render(strict ? <StrictMode>{page}</StrictMode> : page));
    return onFinished;
  };

  const clickCell = async (row: number, col: number) => {
    const geo = vcfGeometry();
    const board = container.querySelector("svg.dailyp-board") as SVGSVGElement;
    board.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0,
      right: geo.viewBox, bottom: geo.viewBox, width: geo.viewBox, height: geo.viewBox, toJSON: () => ({}) });
    await act(async () => {
      board.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: geo.line(col), clientY: geo.line(row) }));
    });
  };

  it("输局悔棋后再赢仍结算，保留同题奖励的上层幂等", async () => {
    const finished = await renderPuzzle();
    await clickCell(2, 0);
    expect(finished.mock.calls.map(([outcome]) => outcome)).toEqual(["lost"]);
    act(() => (container.querySelector("[data-dailyp-settle-close]") as HTMLButtonElement).click());
    act(() => (container.querySelector("[data-dailyp-undo]") as HTMLButtonElement).click());
    await clickCell(0, 4);
    expect(container.querySelector("[data-dailyp-outcome]")?.getAttribute("data-dailyp-outcome")).toBe("won");
    expect(finished.mock.calls.map(([outcome]) => outcome)).toEqual(["lost", "won"]);
  });

  it("StrictMode 重挂副作用后仍接受陪练应手", async () => {
    const finished = await renderPuzzle(true);
    await clickCell(2, 0);
    expect(finished.mock.calls.map(([outcome]) => outcome)).toEqual(["lost"]);
    expect(container.querySelector("[data-dailyp-state]")?.getAttribute("data-dailyp-state")).toBe("lost");
  });
});
