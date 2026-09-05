// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_STATE_KEY, isOverlayPop, useOverlayHistory } from "./useOverlayHistory";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ active, onClose }: { active: boolean; onClose: () => void }) {
  useOverlayHistory(active, onClose);
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const mount = (ui: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(ui); });
};
const rerender = (ui: React.ReactNode) => { act(() => { root!.render(ui); }); };
const unmount = () => { act(() => { root?.unmount(); }); container?.remove(); container = null; root = null; };

afterEach(() => { unmount(); vi.restoreAllMocks(); });

// Simulate the browser having popped to a destination entry: set the live
// state, then fire the popstate event the same way a real pop would. The
// handler reads window.history.state, so this mirrors real pop semantics.
const popTo = (state: Record<string, unknown> | null) => {
  act(() => {
    window.history.replaceState(state, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
};

describe("useOverlayHistory", () => {
  it("claims exactly one history entry while active", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    mount(<Harness active onClose={() => undefined}/>);
    const token = (window.history.state as Record<string, unknown>)[OVERLAY_STATE_KEY];
    expect(typeof token).toBe("string");
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it("does not push a duplicate entry on a StrictMode-style re-run", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    mount(<Harness active onClose={() => undefined}/>);
    // Re-rendering with the same active value must not add another entry.
    rerender(<Harness active onClose={() => undefined}/>);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it("closes when it is the topmost overlay and gets popped", () => {
    const onClose = vi.fn();
    mount(<Harness active onClose={onClose}/>);
    // Popped down to the bare root (no overlay token below).
    popTo(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when a higher overlay is popped and a lower one remains", () => {
    const onClose = vi.fn();
    mount(<Harness active onClose={onClose}/>);
    // A lower overlay's entry is now the top (this one was above it and popped).
    popTo({ [OVERLAY_STATE_KEY]: "lower-overlay" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a child overlay above it is the one popped", () => {
    const onClose = vi.fn();
    mount(<Harness active onClose={onClose}/>);
    const token = (window.history.state as Record<string, unknown>)[OVERLAY_STATE_KEY];
    // A child above us was popped, so our own token is back on top.
    popTo({ [OVERLAY_STATE_KEY]: token });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases its entry when closed without a back press", () => {
    const backSpy = vi.spyOn(window.history, "back");
    mount(<Harness active onClose={() => undefined}/>);
    expect(backSpy).not.toHaveBeenCalled();
    rerender(<Harness active={false} onClose={() => undefined}/>);
    // The release probe runs on a macrotask.
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(backSpy).toHaveBeenCalledTimes(1);
      resolve();
    }, 0));
  });

  it("does not release twice when already closed by a back press", () => {
    const backSpy = vi.spyOn(window.history, "back");
    const onClose = vi.fn();
    mount(<Harness active onClose={onClose}/>);
    popTo(null); // closed via back
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Harness active={false} onClose={onClose}/>);
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(backSpy).not.toHaveBeenCalled(); // back already consumed the entry
      resolve();
    }, 0));
  });
});

describe("isOverlayPop", () => {
  it("recognizes overlay destinations only", () => {
    expect(isOverlayPop({ [OVERLAY_STATE_KEY]: "t" })).toBe(true);
    expect(isOverlayPop({ other: 1 })).toBe(false);
    expect(isOverlayPop(null)).toBe(false);
  });
});
