// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionEffectsPreview } from "./MotionEffectsPreview";
import { findDropEffect, findPlaceEffect, loadMotionEffectsSettings } from "../../motion-effects-settings";

/**
 * 「外观 → 公用效果」预览的守门用例（用户 2026-10-02：「公用动效没有预览，加一个，
 * 切换后都可以看到预览」）。这里盯的是三件容易悄悄坏掉的事：
 *  ① 预览确实在跑**真方案**（棋子挂的是所选进场方案的类名、落子特效由该方案的 spawn 插进来），
 *     而不是另画一份看着像的动画；
 *  ② 换方案会立刻重播（`useEffect` 依赖没写错，不然切了没反应）；
 *  ③ 「界面动效」总开关关着时，预览仍然能看，但必须**明说实盘不会播**——
 *     否则用户挑完方案发现棋盘上什么都没发生。
 */
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const render = (ui: React.ReactElement) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => { root = createRoot(container!); root.render(ui); });
  return container;
};

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

const classes = (el: HTMLElement) => [...el.querySelectorAll("[class]")].flatMap((node) =>
  (node.getAttribute("class") || "").split(/\s+/).filter((token) => /^(pl-|dp-)/.test(token)));

describe("公用效果预览", () => {
  it("棋子挂上所选的进场方案，落子特效由该方案自己插进舞台", () => {
    const el = render(<MotionEffectsPreview place={findPlaceEffect("pl-spark")} drop={findDropEffect("dp-settle")} live/>);
    const stone = el.querySelector("[data-preview-stone]");
    expect(stone?.getAttribute("class")).toContain("dp-settle");
    expect(classes(el)).toContain("pl-spark");
  });

  it("换方案后重渲染，预览跟着换成新方案", () => {
    const first = render(<MotionEffectsPreview place={findPlaceEffect("pl-ripple")} drop={findDropEffect("dp-settle")} live/>);
    expect(classes(first)).toContain("pl-ripple");
    act(() => { root!.render(<MotionEffectsPreview place={findPlaceEffect("pl-ink")} drop={findDropEffect("dp-squash")} live/>); });
    expect(classes(first)).toContain("pl-ink");
    expect(first.querySelector("[data-preview-stone]")?.getAttribute("class")).toContain("dp-squash");
  });

  it("关掉其中一套就只播另一套；两套都关时说明已关闭，但舞台仍播各自选中的方案", () => {
    const onlyDrop = render(<MotionEffectsPreview place={null} drop={findDropEffect("dp-pop")} live/>);
    expect(onlyDrop.textContent).toContain("只播棋子进场");
    expect(onlyDrop.querySelector("[data-preview-stone]")?.getAttribute("class")).toContain("dp-pop");
    // 1.1.9 起两套默认关：这块预览是每个新用户进设置第一眼看到的，不许变成一颗静止棋子
    // （它的意义是"让你看清要不要开"）。父组件此时传的是两个 null，方案由组件自己
    // 从持久化设置里取回——所以下面断言的是"存着的那两套"仍然挂在舞台上。
    act(() => { root!.render(<MotionEffectsPreview place={null} drop={null} live/>); });
    const saved = loadMotionEffectsSettings();
    expect(onlyDrop.textContent).toContain("当前已关闭 · 这里播的是各自选中的方案，打开开关后实盘生效");
    expect(onlyDrop.querySelector("[data-preview-stone]")?.getAttribute("class")).toContain(findDropEffect(saved.dropId).id);
    expect(classes(onlyDrop)).toContain(findPlaceEffect(saved.placeId).id);
  });

  it("「界面动效」关着时：预览照播，但明说实盘不会播", () => {
    const el = render(<MotionEffectsPreview place={findPlaceEffect("pl-ripple")} drop={findDropEffect("dp-settle")} live={false}/>);
    const hint = el.querySelector(".motion-effects-preview-off");
    expect(hint?.textContent).toContain("界面动效");
    expect(hint?.textContent).toContain("实盘不会播");
    expect(el.querySelector("[data-preview-stone]")).toBeTruthy();
  });

  it("预览不受总开关影响这一点写在组件里，文案不许被删成空话", () => {
    const el = render(<MotionEffectsPreview place={findPlaceEffect("pl-ripple")} drop={null} live/>);
    expect(el.textContent).toContain("涟漪扩散");
    // 说明取自方案自己的 desc，不是再抄一份（抄一份就会和列表不同步）
    expect(el.textContent).toContain(findPlaceEffect("pl-ripple").desc);
  });

  it("舞台用**不带 reduced-motion 降级**的原始方案（老安卓上预览被自己那条规则静音过）", () => {
    // 用户 2026-10-05：老安卓（K20）上「公用效果预览总是出不了」。成因是注入的 CSS 带
    // `@media(prefers-reduced-motion:reduce){…animation:none!important}`，而老 Android WebView
    // 常把 prefers-reduced-motion 报成 reduce —— 预览被自己那条规则掐掉。
    const el = render(<MotionEffectsPreview place={findPlaceEffect("pl-spark")} drop={findDropEffect("dp-pop")} live/>);
    const css = el.querySelector("style")?.textContent ?? "";
    // 舞台认 id（pl-spark 的动画仍在），但不许再带那条媒体查询
    expect(css).toContain("pl-spark");
    expect(css).not.toContain("prefers-reduced-motion");
    expect(el.querySelector("[data-preview-stone]")?.getAttribute("class")).toContain("dp-pop");
  });

  it("系统报告「减少动态效果」时：预览照播，但明确写出实盘不播", () => {
    const original = window.matchMedia;
    // 老 WebView 只有 addListener（没有 addEventListener）——这里就按老接口造
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addListener: () => {},
      removeListener: () => {},
    });
    try {
      const el = render(<MotionEffectsPreview place={findPlaceEffect("pl-ripple")} drop={findDropEffect("dp-settle")} live/>);
      const note = el.querySelector("[data-motion-preview-reduced]");
      expect(note?.textContent).toContain("减少动态效果");
      expect(note?.textContent).toContain("实盘");
      expect(el.querySelector("[data-preview-stone]")).toBeTruthy();
    } finally {
      (window as unknown as { matchMedia: unknown }).matchMedia = original;
    }
  });
});
