// @vitest-environment jsdom
/**
 * 奖励弹窗的两个总开关（用户 2026-10-11：「加入两个开关，一个是成就弹窗的开关，
 * 一个是棋魂弹窗的开关，这个关闭了就不会显示弹窗了」）。
 *
 * 这一组守的是**最容易悄悄坏**的那件事：**关掉之后队列不能被堵住**。
 *
 * 为什么这条特别重要：`ProgressRewardQueue` 是"逐项播放、播完调 `onDrained()`
 * 清空 App 里那个队列"的。如果关掉某一类之后只是"不渲染"而不清队列，
 * 那些项就会永远躺在 App 的 `queue` 里 —— 后续**同类**的弹窗排在其后，
 * 永远轮不到（表现是"我关掉又打开，还是不弹了"，刷新才好）。这是典型的
 * "看起来只是不显示，实际把功能卡死"，必须用单测钉住。
 *
 * 渲染方式照 `motion-effects-preview.test.tsx` 的先例：createRoot + act
 * （本项目没装 @testing-library/react，也不打算为这一条测试引入它）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProgressRewardQueue, type RewardItem } from "./ProgressReward";
import { ACHIEVEMENT_CATALOG } from "./achievement-catalog";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const mount = (ui: React.ReactElement) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => { root = createRoot(container!); root.render(ui); });
  return container;
};
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
});

const achievement = (id: string): RewardItem => {
  const definition = ACHIEVEMENT_CATALOG.find((item) => item.id === id) ?? ACHIEVEMENT_CATALOG[0];
  return { kind: "achievement", definition };
};
const soul = (amount: number): RewardItem => ({ kind: "soul", amount, label: "战胜大师档 AI", balance: 100 + amount });

describe("奖励弹窗的开关", () => {
  it("默认都开：两类都能渲染出来", () => {
    expect(mount(<ProgressRewardQueue queue={[achievement("duel-first-win")]} onDrained={() => {}}/>).querySelector("[data-achievement-unlock]")).toBeTruthy();
    expect(mount(<ProgressRewardQueue queue={[soul(60)]} onDrained={() => {}}/>).querySelector("[data-soul-gain]")).toBeTruthy();
  });

  it("**关掉成就弹窗**：不渲染成就卡", () => {
    const box = mount(<ProgressRewardQueue queue={[achievement("duel-first-win")]} onDrained={() => {}} showAchievements={false}/>);
    expect(box.querySelector("[data-achievement-unlock]")).toBeNull();
  });

  it("**关掉棋魂弹窗**：不渲染棋魂条", () => {
    const box = mount(<ProgressRewardQueue queue={[soul(60)]} onDrained={() => {}} showSoul={false}/>);
    expect(box.querySelector("[data-soul-gain]")).toBeNull();
  });

  it("**被关掉的那类会被立刻排空**（否则队列积压、后续同类永远轮不到）", () => {
    const onDrained = vi.fn();
    mount(<ProgressRewardQueue queue={[soul(60), soul(8)]} onDrained={onDrained} showSoul={false}/>);
    // 关掉之后必须马上通知调用方"这批播完了"——那是清空 App 队列的唯一途径。
    expect(onDrained).toHaveBeenCalled();
  });

  it("关掉一类、另一类照常播（只过滤，不整批丢弃）", () => {
    const onDrained = vi.fn();
    const box = mount(<ProgressRewardQueue
      queue={[soul(60), achievement("duel-first-win")]}
      onDrained={onDrained}
      showSoul={false}
      showAchievements
    />);
    // 棋魂被过滤、成就留下 ⇒ 渲染的是成就卡；它还要播完才排空，所以这里不断言 onDrained。
    expect(box.querySelector("[data-achievement-unlock]")).toBeTruthy();
    expect(box.querySelector("[data-soul-gain]")).toBeNull();
  });

  it("两个都关：整批立刻排空，且什么都不渲染", () => {
    const onDrained = vi.fn();
    const box = mount(<ProgressRewardQueue
      queue={[soul(60), achievement("duel-first-win")]}
      onDrained={onDrained}
      showSoul={false}
      showAchievements={false}
    />);
    expect(onDrained).toHaveBeenCalled();
    expect(box.querySelector("[data-achievement-unlock]")).toBeNull();
    expect(box.querySelector("[data-soul-gain]")).toBeNull();
  });

  it("空队列不折腾（不该凭空调 onDrained）", () => {
    const onDrained = vi.fn();
    mount(<ProgressRewardQueue queue={[]} onDrained={onDrained}/>);
    expect(onDrained).not.toHaveBeenCalled();
  });
});
