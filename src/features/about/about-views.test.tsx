// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../../diagnostics";
import { RELEASE_NOTES } from "../../release-notes";
import { EngineInfoView } from "./EngineInfoView";
import { ReleaseNotesView } from "./ReleaseNotesView";

/**
 * 「关于」两个子视图的渲染用例（用户 2026-10-01：引擎介绍单独成页、更新内容单独成页）。
 * 这里主要钉两件事：① 页面确实把该说的说全了（引擎一个都不能少）；
 * ② **已知短板不许被文案抹掉**——云端只接了分析、没接对弈，这句必须在页面上。
 */
describe("关于 → 引擎与模型介绍", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); });
  const render = (ui: React.ReactElement) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => { root = createRoot(container); root.render(ui); });
    return container;
  };

  it("六个引擎/角色一行不少，每行都有名称与一句定位", () => {
    const el = render(<EngineInfoView onBack={() => { /* 由下一条用例验 */ }}/>);
    const rows = [...el.querySelectorAll("[data-engine-list] li")];
    const names = rows.map((li) => li.querySelector("b")?.textContent || "");
    expect(names).toEqual(expect.arrayContaining([
      "rapfi", "rapfi 冠军权重包", "katago · b10c128 小网", "katago · b24c256 大网", "云端引擎（iKataGo）", "内置兜底",
    ]));
    rows.forEach((li) => {
      expect(li.querySelector(".engine-tag")?.textContent?.trim().length).toBeGreaterThan(2);
      // 说明那一行不能空着——只有名字等于没介绍。
      const spans = [...li.querySelectorAll("span")].map((s) => (s.textContent || "").trim());
      expect(Math.max(...spans.map((s) => s.length))).toBeGreaterThan(20);
    });
  });

  it("如实写着「云端只接了分析、人机对弈还没接」，不让人以为云端能下棋", () => {
    const el = render(<EngineInfoView onBack={() => {}}/>);
    const cloud = [...el.querySelectorAll("[data-engine-list] li")]
      .find((li) => (li.querySelector("b")?.textContent || "").includes("云端"));
    expect(cloud?.textContent).toContain("人机对弈还没接");
  });

  it("许可不在这页重写一遍，只指回「第三方引擎与模型许可」那张卡", () => {
    const el = render(<EngineInfoView onBack={() => {}}/>);
    // 用户 2026-10-02：「不要牵着到作者什么的了，就简单介绍」——所以这一页既不写授权条款、
    // 也不写谁的作品/社区来源，只留一句指路。
    expect(el.textContent).toContain("第三方引擎与模型许可");
    expect(el.textContent).not.toContain("GPL-3.0");
    expect(el.textContent).not.toContain("MIT");
    expect(el.textContent).not.toContain("作者");
    expect(el.textContent).not.toContain("全文见安装包的 licenses/");
  });

  it("第一行就是「返回关于」，点了回调 onBack", () => {
    const el = render(<EngineInfoView onBack={() => {}}/>);
    const back = el.querySelector<HTMLButtonElement>("[data-about-back]");
    expect(back?.textContent).toContain("返回");
    let called = 0;
    el.remove();
    const el2 = render(<EngineInfoView onBack={() => { called += 1; }}/>);
    act(() => { el2.querySelector<HTMLButtonElement>("[data-about-back]")?.click(); });
    expect(called).toBe(1);
  });
});

describe("关于 → 本版本更新内容", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); });

  it("列出的条数与数据源一致，标题都渲染出来", () => {
    container = document.createElement("div"); document.body.appendChild(container);
    act(() => { root = createRoot(container); root.render(<ReleaseNotesView onBack={() => {}}/>); });
    const expected = RELEASE_NOTES[APP_VERSION];
    expect(expected).toBeDefined();
    expect(container.textContent).toContain(`版本 ${APP_VERSION}`);
    // 星号必须被解析掉（用户 09-26 对手册点过一次名，这一页是同一个毛病）：
    // 所以这里比的是"去掉 ** 之后的正文"，而不是原样字符串。
    expect(container.textContent).toContain(expected.summary.replace(/\*\*/g, ""));
    // `li > b` 只取标题那颗：正文里的加粗是 `li span b`，混在一起会把强调词当成标题
    const titles = [...container.querySelectorAll("[data-release-notes] li > b")].map((b) => b.textContent);
    expect(titles).toEqual(expected.items.map((item) => item.title));
  });

  it("不把 Markdown 的星号露给用户，成对的 ** 渲染成加粗", () => {
    const source = RELEASE_NOTES[APP_VERSION];
    expect(source.items.some((item) => item.text.includes("**"))).toBe(true);   // 数据里确实有星号，这条才有意义
    container = document.createElement("div"); document.body.appendChild(container);
    act(() => { root = createRoot(container); root.render(<ReleaseNotesView onBack={() => {}}/>); });
    expect(container.textContent ?? "").not.toContain("**");
    const bolds = [...container.querySelectorAll("[data-release-notes] li span b")];
    expect(bolds.length).toBeGreaterThan(0);
    expect(bolds.some((b) => (b.textContent || "").length > 0)).toBe(true);
  });
});
