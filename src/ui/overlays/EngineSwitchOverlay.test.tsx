// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineSwitchOverlay } from "./EngineSwitchOverlay";

/**
 * 「引擎起不来时**让人选**，别偷偷回落」（用户 2026-10-15 的原话）：
 * 他切 KataGo 的大小网配置，等了很久，结果跑的是 rapfi 的速度，而且界面上还写着 KataGo。
 *
 * 这条必须在单测里钉住：KataGo 只存在于安卓原生侧，浏览器里根本走不到这条路径，
 * 只能在真机上肉眼验——所以「失败弹窗里有没有『重试切换』和『改用 rapfi 继续』两个按钮」
 * 由这里保证，真机只验「它有没有弹出来」。
 */
describe("引擎切换浮层（失败时的选择）", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const render = (props: Parameters<typeof EngineSwitchOverlay>[0]) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(<EngineSwitchOverlay {...props} />);
    });
    return container;
  };
  const buttonsOf = (el: HTMLElement) => [...el.querySelectorAll("button")].map((button) => button.textContent?.trim() || "");

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("失败时给出「重试切换」与「改用 rapfi 继续」，且点了各自回调", () => {
    const onRetry = vi.fn();
    const onFallback = vi.fn();
    const el = render({
      from: "KataGo", to: "KataGo", channel: "local", status: "failure",
      error: "KataGo 启动失败，本局已用内置轻量引擎继续。",
      canCancel: true, onCancel: () => {}, onClose: () => {},
      onRetry, onFallback, fallbackLabel: "改用 rapfi 继续",
    });
    expect(el.textContent).toContain("KataGo 启动失败");
    const labels = buttonsOf(el);
    expect(labels.some((text) => text.includes("重试切换"))).toBe(true);
    expect(labels.some((text) => text === "改用 rapfi 继续")).toBe(true);
    [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("改用 rapfi"))!.click();
    expect(onFallback).toHaveBeenCalledTimes(1);
    [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("重试切换"))!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("没有回落回调时不显示那个按钮（不改变既有切换流程的界面）", () => {
    const el = render({
      from: "rapfi", to: "KataGo", channel: "local", status: "failure",
      error: "引擎切换未完成", canCancel: true, onCancel: () => {}, onClose: () => {},
    });
    expect(buttonsOf(el).some((text) => text.includes("改用"))).toBe(false);
  });
});
