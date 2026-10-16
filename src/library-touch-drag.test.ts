// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { HAPTIC_PATTERNS } from "./haptics";
import { attachLibraryTouchDrag } from "./library-touch-drag";

/**
 * 拖拽起手的轻震必须跟随「触觉反馈」开关。
 *
 * 这里刻意测的是「接线」而不是震动本身：历史实现直接调 `navigator.vibrate?.(12)`，
 * 于是用户把震动关掉后，拖动棋谱库列表仍然会震——开关形同虚设。用一条守卫断言
 * 把这条线钉住：任何绕过 playHapticCue 直调 vibrate 的实现都会让这里的记录对不上。
 */

const calls: Array<number | number[]> = [];
const stubVibrate = () => {
  calls.length = 0;
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    writable: true,
    value: (pattern: number | number[]) => { calls.push(pattern); return true; },
  });
};

// jsdom 没有 Touch 构造器，用手写对象顶替：被测代码只读 identifier / clientX / clientY / target。
// target 必须是真正被触摸的那个元素——监听器挂 document 上，靠 event.target.closest 找可拖拽行。
type FakeTouch = { identifier: number; clientX: number; clientY: number; target: EventTarget };
const touch = (x: number, y: number, target: EventTarget): FakeTouch => ({ identifier: 1, clientX: x, clientY: y, target });
const fireTouch = (type: string, target: EventTarget, x: number, y: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { changedTouches: FakeTouch[]; touches: FakeTouch[] };
  Object.defineProperty(event, "changedTouches", { value: [touch(x, y, target)] });
  Object.defineProperty(event, "touches", { value: [touch(x, y, target)] });
  target.dispatchEvent(event);
};

/** 造一个可拖拽行，长按 220ms 后触发 startDrag。 */
const mountDraggableRow = () => {
  const row = document.createElement("div");
  row.setAttribute("data-drag-kind", "records");
  row.setAttribute("data-order-id", "rec-1");
  document.body.appendChild(row);
  return row;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("棋谱库拖拽的起手震动", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "vibrate");
    document.body.innerHTML = "";
    calls.length = 0;
  });

  /** 起拖后先抬手结束拖动再断言：否则 autoScrollFrame 的 rAF 循环会在测试结束后继续跑。 */
  const longPressThenRelease = async () => {
    const row = mountDraggableRow();
    const detach = attachLibraryTouchDrag({
      enabled: () => true,
      hapticsEnabled: () => haptics,
      performDrop: () => {},
    });
    fireTouch("touchstart", row, 40, 40);
    await wait(320);
    fireTouch("touchend", row, 40, 40);
    detach();
    return calls.slice();
  };
  let haptics = false;

  it("开关关闭时，长按起拖不产生任何震动", async () => {
    stubVibrate();
    haptics = false;
    expect(await longPressThenRelease()).toEqual([]);
  });

  it("开关开启时，长按起拖震一次「导航」节奏", async () => {
    stubVibrate();
    haptics = true;
    expect(await longPressThenRelease()).toEqual([HAPTIC_PATTERNS.navigate]);
  });
});
