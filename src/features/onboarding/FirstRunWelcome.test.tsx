// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FirstRunWelcome } from "./FirstRunWelcome";

describe("FirstRunWelcome", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); });

  it("offers acknowledgement and manual paths", () => {
    container = document.createElement("div"); document.body.appendChild(container);
    let dismissed = 0;
    let manual = 0;
    act(() => { root = createRoot(container); root.render(<FirstRunWelcome onDismiss={() => { dismissed += 1; }} onOpenManual={() => { manual += 1; }}/>); });
    const buttons = [...container.querySelectorAll("button")];
    act(() => { buttons[0]?.click(); buttons[1]?.click(); });
    expect(dismissed).toBe(1);
    expect(manual).toBe(1);
    expect(container.textContent).toContain("手机端打谱");
    expect(container.textContent).toContain("图片识谱");
    expect(container.textContent).toContain("多种主题、棋盘、棋子");
    expect(container.textContent).toContain("1091866163");
    const githubLink = container.querySelector<HTMLAnchorElement>("a.first-run-github-link");
    expect(githubLink?.textContent).toContain("GitHub 项目仓库");
    expect(githubLink?.href).toBe("https://github.com/gugujiao953-ship-it/banbu-gomoku");
    expect(githubLink?.target).toBe("_blank");
    expect(githubLink?.rel).toBe("noreferrer");
  });
});
