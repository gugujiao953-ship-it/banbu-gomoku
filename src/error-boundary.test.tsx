// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import ErrorBoundary from "./ErrorBoundary";
import { buildDiagnosticsReport, diagnosticsFilename, recentActions, recordAction } from "./diagnostics";

const Thrower = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe("diagnostics ring buffer", () => {
  it("keeps only the most recent actions", () => {
    for (let index = 0; index < 70; index += 1) recordAction(`操作 ${index}`);
    const actions = recentActions();
    expect(actions).toHaveLength(60);
    expect(actions[0].action).toBe("操作 10");
    expect(actions[59].action).toBe("操作 69");
    expect(actions[59].time).toBeTruthy();
  });

  it("builds a report with environment fields and error details", () => {
    recordAction("导出一键备份");
    const report = buildDiagnosticsReport(new Error("测试异常"));
    expect(report.app).toBe("banbu-gomoku");
    expect(report.version).toBeTruthy();
    expect(report.userAgent).toBeTruthy();
    expect(report.mode).toBe("test");
    expect(report.url).not.toContain("?");
    expect(report.error?.message).toBe("测试异常");
    expect(report.componentStack).toBeUndefined();
    expect(report.recentActions[report.recentActions.length - 1]?.action).toBe("导出一键备份");
    expect(diagnosticsFilename()).toMatch(/^半步五子棋诊断-\d{4}-\d{2}-\d{2}T/);
  });

  it("includes a component stack when one is supplied", () => {
    const report = buildDiagnosticsReport(new Error("测试异常"), "\n    in Thrower");
    expect(report.componentStack).toContain("Thrower");
  });
});

describe("top-level ErrorBoundary", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = null;
    container.remove();
    consoleError.mockClear();
  });

  it("renders children while nothing throws", () => {
    act(() => {
      root = createRoot(container);
      root.render(createElement(ErrorBoundary, null, createElement("div", null, "正常内容")));
    });
    expect(container.textContent).toContain("正常内容");
    expect(container.querySelector(".error-boundary-card")).toBeNull();
  });

  it("shows the recovery card with diagnostics instead of a blank page", () => {
    act(() => {
      root = createRoot(container);
      root.render(createElement(ErrorBoundary, null, createElement(Thrower, { message: "人为注入的渲染异常" })));
    });
    const card = container.querySelector(".error-boundary-card");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("半步五子棋遇到异常");
    expect(card?.textContent).toContain("人为注入的渲染异常");
    expect(card?.textContent).toContain("导出诊断信息");
    expect(card?.textContent).toContain("重新加载应用");
  });

  it("keeps the crash card on the same mount and recovers on a fresh mount", () => {
    act(() => {
      root = createRoot(container);
      root.render(createElement(ErrorBoundary, null, createElement(Thrower, { message: "第一次异常" })));
    });
    expect(container.querySelector(".error-boundary-card")).not.toBeNull();
    // React semantics: a boundary that caught an error stays broken until the
    // app remounts — which is exactly why the card's only recovery is reload.
    act(() => {
      root?.render(createElement(ErrorBoundary, null, createElement("div", null, "不会自动恢复")));
    });
    expect(container.querySelector(".error-boundary-card")).not.toBeNull();
    act(() => { root?.unmount(); });
    root = null;
    act(() => {
      root = createRoot(container);
      root.render(createElement(ErrorBoundary, null, createElement("div", null, "重新加载后的内容")));
    });
    expect(container.textContent).toContain("重新加载后的内容");
    expect(container.querySelector(".error-boundary-card")).toBeNull();
  });
});
