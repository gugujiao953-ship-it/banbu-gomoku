// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RecentPuzzleSection } from "./RecentPuzzleSection";
import type { RecentPuzzleItem } from "./recent-puzzles";

describe("RecentPuzzleSection", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); });

  it("opens the selected recent puzzle through its callback", () => {
    container = document.createElement("div"); document.body.appendChild(container);
    const item: RecentPuzzleItem = { collectionId: "set", collectionIndex: 1, collectionTitle: "题集", puzzleId: "p", puzzleIndex: 2, puzzleTitle: "最近题", prompt: "黑先", attempts: 1, solved: false, updatedAt: "2026-08-30T00:00:00.000Z" };
    let opened: RecentPuzzleItem | null = null;
    act(() => { root = createRoot(container); root.render(<RecentPuzzleSection items={[item]} onOpen={(value) => { opened = value; }}/>); });
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(opened).toBe(item);
  });
});
