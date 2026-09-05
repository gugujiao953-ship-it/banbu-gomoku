// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PuzzleCollection } from "../../puzzles";
import type { GameDocument } from "../../types";
import { RecordSelectorSheet } from "../workspace/RecordSelectorSheet";
import { PuzzleRuleSelector } from "./PuzzleRuleSelector";
import { PuzzleSelectorSheet } from "./PuzzleSelectorSheet";
import { PuzzleThinkSpeedSelector } from "./PuzzleThinkSpeedSelector";

describe("doing-puzzle controls", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); document.body.innerHTML = ""; });

  it("offers exactly forbidden and unrestricted choices and respects locked metadata", () => {
    container = document.createElement("div"); document.body.appendChild(container);
    let selected = "";
    act(() => { root = createRoot(container); root.render(<PuzzleRuleSelector value={{ mode: "unrestricted", rule: "freestyle", source: "preference", locked: false }} onChange={(value) => { selected = value; }}/>); });
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["禁手", "无禁手"]);
    expect(buttons[1].className).toContain("selected");
    act(() => buttons[0].click());
    expect(selected).toBe("forbidden");
    act(() => { root?.render(<PuzzleRuleSelector value={{ mode: "forbidden", rule: "renju", source: "puzzle", locked: true }} onChange={() => undefined}/>); });
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toContain("由题目指定");
  });

  it("renders long collections inside one selector and restores focus after closing", async () => {
    const trigger = document.createElement("button"); trigger.textContent = "选题"; document.body.appendChild(trigger); trigger.focus();
    container = document.createElement("div"); document.body.appendChild(container);
    const collections: PuzzleCollection[] = [{
      id: "long", title: "长题集", source: "测试", license: "测试", puzzles: Array.from({ length: 80 }, (_, index) => ({
        id: `p-${index}`, title: `第 ${index + 1} 题`, prompt: "黑先", difficulty: 2 as const, player: "black" as const, stones: [],
      })),
    }];
    let selected = -1;
    let closed = 0;
    await act(async () => { root = createRoot(container); root.render(<PuzzleSelectorSheet collections={collections} progress={{}} currentCollectionIndex={0} currentPuzzleIndex={0} folders={["我的题库/赛事/2018"]} assignments={{ long: "我的题库/赛事/2018" }} onSelect={(_collection, puzzle) => { selected = puzzle; }} onNext={() => undefined} onClose={() => { closed += 1; }}/>); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector('.puzzle-selector-current b')?.textContent).toBe("长题集");
    expect(container.querySelector('.puzzle-selector-current')?.textContent).toContain("我的题库 / 赛事 / 2018 / 长题集");
    expect(container.querySelector('.puzzle-selector-progress b')?.textContent).toBe("所在文件夹：我的题库 / 赛事 / 2018 / 长题集");
    expect([...container.querySelectorAll('.puzzle-selector-folder-head')].some((button) => button.textContent?.includes("长题集"))).toBe(false);
    expect([...container.querySelectorAll('.puzzle-selector-folder-head')].every((button) => button.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(container.querySelector('.puzzle-selector-collection.current-folder')).not.toBeNull();
    expect(container.querySelector('.puzzle-selector-collection-head')?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(80);
    act(() => (container.querySelector('.puzzle-selector-folder-head') as HTMLButtonElement).click());
    expect(container.querySelector('.puzzle-selector-collection-head')).toBeNull();
    await act(async () => { (container.querySelector('.puzzle-selector-current') as HTMLButtonElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector('.puzzle-selector-collection-head')?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(80);
    act(() => (container.querySelectorAll('[role="option"]')[50] as HTMLButtonElement).click());
    expect(selected).toBe(50);
    act(() => root?.unmount()); root = null;
    expect(document.activeElement).toBe(trigger);
    expect(closed).toBe(0);
  });

  it("shows the current record folder and supports fast puzzle coaching", async () => {
    container = document.createElement("div"); document.body.appendChild(container);
    const record: GameDocument = {
      id: "record-1", version: 1, rootId: "root", nodes: { root: { id: "root", parentId: null, children: [], move: null, comment: "", marks: [] } },
      metadata: { title: "测试棋谱", black: "黑", white: "白", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
      createdAt: "", updatedAt: "",
    };
    act(() => { root = createRoot(container); root.render(<RecordSelectorSheet records={[record]} largeRecords={[]} currentId="record-1" folders={["我的棋谱/测试赛"]} assignments={{ "record-1": "我的棋谱/测试赛" }} onSelectRecord={() => undefined} onSelectLargeRecord={() => undefined} onClose={() => undefined}/>); });
    expect(container.querySelector('.record-selector-current b')?.textContent).toBe("测试棋谱");
    expect(container.querySelector('.record-selector-current')?.textContent).toContain("我的棋谱 / 测试赛 / 测试棋谱");
    expect([...container.querySelectorAll('.record-selector-folder-head')].some((button) => button.textContent?.includes("测试棋谱"))).toBe(false);
    expect([...container.querySelectorAll('.record-selector-folder-head')].every((button) => button.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(container.querySelector('.record-selector-folder-body > button.current')).not.toBeNull();
    act(() => (container.querySelector('.record-selector-folder-head') as HTMLButtonElement).click());
    expect(container.querySelector('.record-selector-folder-body > button.current')).toBeNull();
    await act(async () => { (container.querySelector('.record-selector-current') as HTMLButtonElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector('.record-selector-folder-body > button.current')).not.toBeNull();

    let speed = "slow";
    act(() => { root?.render(<PuzzleThinkSpeedSelector value={speed as "slow" | "fast"} onChange={(value) => { speed = value; }}/>); });
    const speedButtons = [...container.querySelectorAll("button")];
    expect(speedButtons.map((button) => button.textContent)).toEqual(["慢", "快 · 1秒"]);
    expect(speedButtons[0].getAttribute("aria-checked")).toBe("true");
    act(() => speedButtons[1].click());
    expect(speed).toBe("fast");
  });
});
