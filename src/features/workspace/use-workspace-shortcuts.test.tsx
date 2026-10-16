// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Options = Parameters<typeof useWorkspaceShortcuts>[0];
function Harness(props: Options) { useWorkspaceShortcuts(props); return null; }
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const render = (props: Options) => {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => { root!.render(<Harness {...props}/>); });
};
const options = (): Options => ({ enabled: true, blocked: false, mode: "record", sessionKey: "record:a", onBack: vi.fn(), onForward: vi.fn(), onJump: vi.fn(), onPlayback: vi.fn(), onDelete: vi.fn() });
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
};
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove(); root = undefined; container = undefined;
  vi.restoreAllMocks();
});

describe("workspace shortcuts", () => {
  it("honors the main switch and overlays for arrow navigation as well as editing", () => {
    const props = options();
    render(props);
    expect(press("ArrowLeft").defaultPrevented).toBe(true);
    expect(props.onBack).toHaveBeenCalledTimes(1);
    render({ ...props, enabled: false });
    expect(press("ArrowLeft").defaultPrevented).toBe(false);
    press("ArrowRight"); press("1"); press("Delete");
    render({ ...props, blocked: true });
    press("ArrowLeft"); press("ArrowRight"); press("2"); press("Delete");
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onForward).not.toHaveBeenCalled();
    expect(props.onJump).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });
  it("leaves modified, composing, handled and text-input keys alone", () => {
    const props = options(); render(props);
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) press("ArrowLeft", init);
    const input = document.createElement("input"); container!.append(input);
    press("ArrowLeft", {}, input);
    const handled = new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true });
    handled.preventDefault(); window.dispatchEvent(handled);
    expect(props.onBack).not.toHaveBeenCalled();
  });
  it("discards partial numeric jumps when sessions, blockers or another action change", () => {
    const props = options(); render(props);
    press("1"); press("2");
    expect(props.onJump).toHaveBeenLastCalledWith(12);
    press("ArrowLeft"); press("3");
    expect(props.onJump).toHaveBeenLastCalledWith(3);
    render({ ...props, sessionKey: "record:b" }); press("4");
    expect(props.onJump).toHaveBeenLastCalledWith(4);
    render({ ...props, blocked: true }); render(props); press("5");
    expect(props.onJump).toHaveBeenLastCalledWith(5);
  });
  it("uses current callbacks and keeps playback/deletion restricted to their modes", () => {
    const props = options(); render(props); press(" "); press("Delete");
    expect(props.onPlayback).not.toHaveBeenCalled(); expect(props.onDelete).toHaveBeenCalledTimes(1);
    const playback = vi.fn(); render({ ...props, mode: "review", onPlayback: playback }); press(" "); press("Delete");
    expect(playback).toHaveBeenCalledTimes(1); expect(props.onDelete).toHaveBeenCalledTimes(1);
    render({ ...props, mode: "puzzle" }); press("6"); press("Delete");
    expect(props.onJump).not.toHaveBeenCalled(); expect(props.onDelete).toHaveBeenCalledTimes(1);
  });
});
