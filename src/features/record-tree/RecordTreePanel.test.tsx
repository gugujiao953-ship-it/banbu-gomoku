// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameDocument } from "../../types";
import { RecordTreePanel } from "./RecordTreePanel";

const documentFixture: GameDocument = {
  id: "tree-drag-test",
  version: 1,
  rootId: "root",
  nodes: {
    root: { id: "root", parentId: null, children: ["child"], move: null, comment: "", marks: [] },
    child: { id: "child", parentId: "root", children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
  },
  metadata: { title: "拖拽测试", black: "", white: "", event: "", date: "", result: "", rule: "freestyle", boardSize: 15, tags: [] },
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

const pointerEvent = (type: string, pointerId: number, clientX: number, clientY: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 },
    buttons: { value: type === "pointerup" ? 0 : 1 },
  });
  return event;
};

describe("RecordTreePanel mobile canvas gestures", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("pans with one touch and does not select a node when dragging from it", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(<RecordTreePanel
        document={documentFixture}
        currentId="root"
        path={[documentFixture.nodes.root]}
        bookmarks={[]}
        clipboard={null}
        onLocate={vi.fn()}
        onCreateBranch={vi.fn()}
        onRenameBranch={vi.fn()}
        onDeleteBranch={vi.fn()}
        onCopy={vi.fn()}
        onCut={vi.fn()}
        onPaste={vi.fn()}
        onCancelCopy={vi.fn()}
        onToggleBookmark={vi.fn()}
        onEditBookmark={vi.fn()}
        onDeleteBookmark={vi.fn()}
      />);
    });

    const svg = container.querySelector<SVGSVGElement>(".tree-canvas")!;
    const child = container.querySelector<SVGGElement>('[aria-label^="H8"]')!;
    const content = svg.querySelector<SVGGElement>(":scope > g")!;
    const captures = new Set<number>();
    Object.defineProperties(svg, {
      viewBox: { value: { baseVal: { x: 0, y: 0, width: 430, height: 240 } } },
      setPointerCapture: { value: (id: number) => captures.add(id) },
      hasPointerCapture: { value: (id: number) => captures.has(id) },
      releasePointerCapture: { value: (id: number) => captures.delete(id) },
      getBoundingClientRect: { value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 340, width: 300, height: 340, toJSON: () => ({}) }) },
    });

    expect(content.getAttribute("transform")).toBe("translate(18 18) scale(1)");
    act(() => child.dispatchEvent(pointerEvent("pointerdown", 1, 100, 120)));
    act(() => child.dispatchEvent(pointerEvent("pointermove", 1, 145, 145)));
    act(() => child.dispatchEvent(pointerEvent("pointerup", 1, 145, 145)));

    expect(content.getAttribute("transform")).not.toBe("translate(18 18) scale(1)");
    expect(container.querySelector('[aria-label^="起始局面"]')?.classList.contains("selected")).toBe(true);
    expect(child.classList.contains("selected")).toBe(false);

    act(() => child.dispatchEvent(pointerEvent("pointerdown", 2, 145, 145)));
    act(() => child.dispatchEvent(pointerEvent("pointerup", 2, 145, 145)));
    expect(child.classList.contains("selected")).toBe(true);
  });

  it("shows local branch name overrides in tree nodes, action head and rename input", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(<RecordTreePanel
        document={documentFixture}
        currentId="child"
        path={[documentFixture.nodes.root, documentFixture.nodes.child]}
        bookmarks={[]}
        clipboard={null}
        branchNameOverrides={{ child: "斜月变化" }}
        onLocate={vi.fn()}
        onCreateBranch={vi.fn()}
        onRenameBranch={vi.fn()}
        onDeleteBranch={vi.fn()}
        onCopy={vi.fn()}
        onCut={vi.fn()}
        onPaste={vi.fn()}
        onCancelCopy={vi.fn()}
        onToggleBookmark={vi.fn()}
        onEditBookmark={vi.fn()}
        onDeleteBookmark={vi.fn()}
      />);
    });

    expect(container.querySelector<SVGGElement>('[aria-label^="斜月变化"]')).toBeTruthy();
    expect(container.querySelector(".tree-node-action-head b")?.textContent).toBe("斜月变化");

    const renameButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("重命名"))!;
    act(() => renameButton.click());
    expect(container.querySelector<HTMLInputElement>(".tree-inline-rename input")?.value).toBe("斜月变化");
  });
});
