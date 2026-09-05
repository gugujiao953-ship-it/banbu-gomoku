// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_STATE_KEY } from "./useOverlayHistory";
import { useRootBackExit } from "./useRootBackExit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onRootBack }: { onRootBack: () => void }) {
  useRootBackExit(onRootBack);
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const mount = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
};
const render = (onRootBack: () => void) => { act(() => { root!.render(<Harness onRootBack={onRootBack}/>); }); };
const unmount = () => { act(() => { root?.unmount(); }); container?.remove(); container = null; root = null; };

afterEach(() => { unmount(); vi.useRealTimers(); vi.restoreAllMocks(); });

const popTo = (state: Record<string, unknown> | null) => {
  act(() => {
    window.history.replaceState(state, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
};

describe("useRootBackExit", () => {
  it("arms the sentinel on mount but never overwrites existing entries", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    mount(); render(vi.fn());
    expect((window.history.state as Record<string, unknown>).__banbuRootSentinel).toBe(1);
    // Re-arming with a non-empty state must not push again.
    act(() => { popTo({ [OVERLAY_STATE_KEY]: "token" }); });
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it("notifies only when a pop lands on the bare root", () => {
    const onRootBack = vi.fn();
    mount(); render(onRootBack);
    popTo({ [OVERLAY_STATE_KEY]: "token" });
    expect(onRootBack).not.toHaveBeenCalled();
    popTo({ __banbuRootSentinel: 1 });
    expect(onRootBack).not.toHaveBeenCalled();
    popTo(null);
    expect(onRootBack).toHaveBeenCalledTimes(1);
  });

  it("re-arms the sentinel after the exit window so the next back warns again", () => {
    vi.useFakeTimers();
    const onRootBack = vi.fn();
    mount(); render(onRootBack);
    popTo(null);
    expect(onRootBack).toHaveBeenCalledTimes(1);
    // In a real browser the second press within the window leaves the app
    // without firing popstate (there is no entry above the root); the
    // handler still stays honest and counts every bare-root pop.
    popTo(null);
    expect(onRootBack).toHaveBeenCalledTimes(2);
    // After the window elapses the sentinel is re-armed; a pop landing back
    // on it is not an exit attempt, and a later bare-root pop warns again.
    act(() => { vi.advanceTimersByTime(2100); });
    popTo({ __banbuRootSentinel: 1 });
    expect(onRootBack).toHaveBeenCalledTimes(2);
    popTo(null);
    expect(onRootBack).toHaveBeenCalledTimes(3);
  });
});
