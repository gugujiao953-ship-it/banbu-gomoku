// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { UserManual } from "./UserManual";

describe("UserManual", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("shows a friendly expanded quick start and separates feature explanations", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    let closed = 0;
    let rulesOpened = 0;
    act(() => {
      root = createRoot(container!);
      root.render(<UserManual onClose={() => { closed += 1; }} onOpenRules={() => { rulesOpened += 1; }}/>);
    });

    const sections = [...container.querySelectorAll<HTMLDetailsElement>(".manual-item")];
    expect(sections).toHaveLength(20);
    // 不再默认展开任何章节（用户 09-12：引导完成后回来只定位目标章节，避免翻页））
    expect(sections.every((s) => !s.open)).toBe(true);
    expect(sections[1]?.textContent).toContain("引导");
    expect(container.querySelectorAll(".manual-feature").length).toBeGreaterThan(70);
    // 下面几行是「关键主题有没有写进手册」的抽样断言：文案会随功能迭代重写，
    // 人工改文案后如有意调整，同步这里即可（不要为了过测试写回旧说法）。
    expect(container.textContent).toContain("打谱模式不提供播放按钮");
    expect(container.textContent).toContain("图片识谱");
    expect(container.textContent).toContain("卡哇伊");
    expect(container.textContent).toContain("白色、金色或蓝色轮廓高亮");
    expect(container.textContent).toContain("小数位");
    expect(container.textContent).toContain("批量编辑（题库）");
    expect(container.textContent).toContain("棋题生成器");
    expect(container.textContent).toContain("索索夫-8");
    expect(container.textContent).toContain("共 11 项");
    // 2026-10-05 新增第 20 章「VCF 挑战」+ 外观材质清单改口径，抽样钉住关键主题
    expect(container.textContent).toContain("每一手必须带四");
    expect(container.textContent).toContain("题目等级 = 手数");
    expect(container.textContent).not.toContain("题分 = 1000");   // 旧曲线已整条删除，说明里不该再出现
    expect(container.textContent).toContain("琥珀木盘");
    expect(container.textContent).toContain("经典黑白");

    const thumbs = [...container.querySelectorAll<HTMLButtonElement>(".manual-feature-thumb")];
    expect(thumbs.length).toBeGreaterThanOrEqual(4);
    const firstImg = thumbs[0]?.querySelector("img");
    expect(firstImg?.getAttribute("src")).toMatch(/^\/manual\/s\d+f\d+\.jpg$/);
    expect(firstImg?.getAttribute("loading")).toBe("lazy");
    act(() => thumbs[0]!.click());
    expect(container!.querySelector(".manual-lightbox")).toBeTruthy();
    act(() => (container!.querySelector(".manual-lightbox-close") as HTMLButtonElement).click());
    expect(container!.querySelector(".manual-lightbox")).toBeFalsy();

    const ruleButton = container.querySelector<HTMLButtonElement>(".manual-rule-entry")!;
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    const closeButton = buttons[buttons.length - 1]!;
    act(() => { ruleButton.click(); closeButton.click(); });
    expect(rulesOpened).toBe(1);
    expect(closed).toBe(1);
  });

  it("把正文里的 **粗体** 渲染成加粗，而不是把星号露给用户（用户 09-26）", () => {
    // 章节数据从 09-17 起就在写 Markdown 的星号，但渲染层一直没解析——用户读到的是字面的 **。
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => { root = createRoot(container!); root.render(<UserManual onClose={() => {}}/>); });
    const featureTexts = [...container.querySelectorAll<HTMLElement>(".manual-feature small")];
    expect(featureTexts.length).toBeGreaterThan(20);
    // 全部章节的正文里都不该再有裸露的星号
    const withAsterisk = featureTexts.filter((element) => (element.textContent || "").includes("*"));
    expect(withAsterisk.map((element) => element.textContent?.slice(0, 30))).toEqual([]);
    // 而该加粗的地方真的用了 <b>（ch05「画布是**横铺**的」是既有写法）
    const bolded = featureTexts.flatMap((element) => [...element.querySelectorAll("b")].map((bold) => bold.textContent));
    expect(bolded).toContain("横铺");
  });
});
