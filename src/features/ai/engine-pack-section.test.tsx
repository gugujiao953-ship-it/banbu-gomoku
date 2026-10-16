// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EnginePackSection } from "./EnginePackSection";

/**
 * 设置 → 引擎包分区的两面断言（用户 2026-10-02：「设置里面那个强力 ai 引擎的介绍怎么又跑出来
 * 了，去掉那个外面的这个按钮，之前早就放关于里面去了」）。
 *
 * 为什么要有这个单测而不是只靠浏览器门禁：`nativeReady` 来自 Capacitor 原生引擎探针，
 * 桌面浏览器里它恒为 false，qa/settings-page-regression.mjs 与 scripts/verify-engine-pack-ui.mjs
 * 只能钉住「网页面」（下载入口还在），原生那一面根本没有可点的东西可验。这里直接把 prop 喂进去，
 * 两面都钉死：
 *   ① 原生面：整节不渲染——不出现「强力 AI 引擎」「本机原生引擎已生效」这些介绍文案与状态卡；
 *   ② 网页面：分区必须还在，且带下载入口（那是 downloadEnginePack / deleteEnginePack 唯一的 UI）。
 */
describe("设置 → 引擎包分区", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = null;
    container?.remove();
    container = null;
  });

  const render = (ui: ReactElement) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      const next = createRoot(container as HTMLDivElement);
      root = next;
      next.render(ui);
    });
    return container as HTMLDivElement;
  };

  it("原生（安卓）环境整节不渲染：设置里不再有一份引擎介绍副本", () => {
    const el = render(<EnginePackSection order={66} search="" nativeReady kataReady kataSelected/>);
    expect(el.innerHTML).toBe("");
    const text = el.textContent || "";
    // 这些就是 2026-10-01 那轮没删干净、被用户认成「介绍又冒出来了」的东西。
    expect(text).not.toContain("强力 AI 引擎");
    expect(text).not.toContain("本机原生引擎已生效");
    expect(text).not.toContain("KataGo 旗舰引擎");
    expect(el.querySelector("details.settings-group")).toBeNull();
  });

  it("网页环境保留分区与下载/删除入口（downloadEnginePack / deleteEnginePack 的唯一 UI）", () => {
    const el = render(<EnginePackSection order={66} search=""/>);
    const group = el.querySelector("details.settings-group");
    expect(group).not.toBeNull();
    expect(group?.querySelector("summary .settings-section-title b")?.textContent?.trim()).toBe("AI 引擎");
    const links = [...(group?.querySelectorAll("button.settings-link b") || [])].map((node) => node.textContent?.trim() || "");
    // 未装包是「下载冠军网络包（可选）」，已装包是「重新下载引擎包」+「删除引擎包」——
    // 两种状态都必须留着下载入口（用户 09-14：只留删除等于下载功能看不见）。
    expect(links.filter((title) => title.includes("下载")).length).toBeGreaterThanOrEqual(1);
    expect(group?.textContent || "").toContain("关于 → 引擎与模型介绍");
    // 网页面上也不许出现原生那一面的介绍文案（它只可能在原生分支里，而原生分支已经删掉）。
    expect(group?.textContent || "").not.toContain("强力 AI 引擎");
  });
});
