// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FirstRunWelcome } from "./FirstRunWelcome";

describe("FirstRunWelcome", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); });

  /** 按文案取底部三个主操作之一（原来按下标点，加一颗按钮就会整套错位）。 */
  const actionButton = (root: HTMLDivElement, label: RegExp): HTMLButtonElement | undefined =>
    [...root.querySelectorAll<HTMLButtonElement>(".first-run-actions button")].find((b) => label.test(b.textContent || ""));

  it("offers tour, manual and acknowledgement paths", () => {
    container = document.createElement("div"); document.body.appendChild(container);
    let dismissed = 0;
    let manual = 0;
    let tour = 0;
    act(() => { root = createRoot(container); root.render(<FirstRunWelcome onDismiss={() => { dismissed += 1; }} onOpenManual={() => { manual += 1; }} onStartTour={() => { tour += 1; }} onOpenReleaseNotes={() => { /* 这枚按钮单独一条用例验 */ }}/>); });
    act(() => {
      actionButton(container, /新手引导/)?.click();
      actionButton(container, /阅读使用手册/)?.click();
      actionButton(container, /先自己试试|我知道了/)?.click();
    });
    expect(tour).toBe(1);
    expect(manual).toBe(1);
    expect(dismissed).toBe(1);
    expect(container.textContent).toContain("新手引导");
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

  // 用户 2026-10-01：这个弹窗每次换版本都会再弹一次，右上角要有一枚直接看更新内容的入口。
  it("右上角有「本版本更新了什么」，点它走独立回调而不是三个主操作之一", () => {
    container = document.createElement("div"); document.body.appendChild(container);
    let dismissed = 0;
    let releaseNotes = 0;
    act(() => { root = createRoot(container); root.render(<FirstRunWelcome onDismiss={() => { dismissed += 1; }} onOpenManual={() => { /* 不点 */ }} onStartTour={() => { /* 不点 */ }} onOpenReleaseNotes={() => { releaseNotes += 1; }}/>); });
    const updates = container.querySelector<HTMLButtonElement>("[data-first-run-updates]");
    expect(updates?.textContent).toContain("本版本更新了什么");
    // 它是弹窗级的角落入口，不该挤进底部三个主操作里（那三格是引导/手册/自己试试）。
    expect(container.querySelector(".first-run-actions [data-first-run-updates]")).toBeNull();
    act(() => { updates?.click(); });
    expect(releaseNotes).toBe(1);
    // 回调自己负责关窗（App 里是 dismissFirstRunWelcome + 打开关于），组件不越权关。
    expect(dismissed).toBe(0);
  });

  it("调用方没接回调时不渲染那枚入口（不给一枚点了没反应的按钮）", () => {
    container = document.createElement("div"); document.body.appendChild(container);
    act(() => { root = createRoot(container); root.render(<FirstRunWelcome onDismiss={() => {}} onOpenManual={() => {}} onStartTour={() => {}}/>); });
    expect(container.querySelector("[data-first-run-updates]")).toBeNull();
    // 三个主操作照旧在
    expect(container.querySelectorAll(".first-run-actions button").length).toBe(3);
  });
});
