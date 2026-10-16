// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DIGIT_JUMP_WINDOW_MS, EMPTY_DIGIT_JUMP, digitJumpPending, feedMoveJumpDigit, isTextEntryTarget, shortcutsBlocked } from "./keyboard-shortcuts";

describe("键盘流补全（用户 09-17 第二批⑤）", () => {
  it("单键直接跳，连续数字在窗口内拼成多位数", () => {
    const first = feedMoveJumpDigit(EMPTY_DIGIT_JUMP, "1", 1000);
    expect(first).toEqual({ state: { digits: "1", at: 1000 }, jump: 1 });
    const second = feedMoveJumpDigit(first!.state, "2", 1000 + DIGIT_JUMP_WINDOW_MS);
    expect(second).toEqual({ state: { digits: "12", at: 1800 }, jump: 12 });
  });

  it("超出窗口视为重新输入，不会拼成 12", () => {
    const first = feedMoveJumpDigit(EMPTY_DIGIT_JUMP, "1", 1000);
    const second = feedMoveJumpDigit(first!.state, "2", 1000 + DIGIT_JUMP_WINDOW_MS + 1);
    expect(second).toEqual({ state: { digits: "2", at: 1801 }, jump: 2 });
  });

  it("最多拼三位，超出的数字顶掉最高位", () => {
    let state = EMPTY_DIGIT_JUMP;
    let jump = 0;
    for (const digit of ["1", "2", "3", "4"]) {
      const step = feedMoveJumpDigit(state, digit, 1000)!;
      state = step.state; jump = step.jump;
    }
    expect(state.digits).toBe("234");
    expect(jump).toBe(234);
  });

  it("非数字键返回 null，不污染缓冲", () => {
    expect(feedMoveJumpDigit({ digits: "1", at: 1000 }, "a", 1010)).toBeNull();
    expect(feedMoveJumpDigit(EMPTY_DIGIT_JUMP, "ArrowLeft", 1000)).toBeNull();
  });

  it("digitJumpPending 只在窗口内为真", () => {
    const state = { digits: "3", at: 1000 };
    expect(digitJumpPending(state, 1000 + DIGIT_JUMP_WINDOW_MS)).toBe(true);
    expect(digitJumpPending(state, 1000 + DIGIT_JUMP_WINDOW_MS + 1)).toBe(false);
    expect(digitJumpPending(EMPTY_DIGIT_JUMP, 1000)).toBe(false);
  });

  it("文本输入目标判定覆盖 input/textarea/select/contenteditable", () => {
    const input = document.createElement("input");
    const wrapper = document.createElement("div");
    const button = document.createElement("button");
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);
    document.body.appendChild(button);
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(button)).toBe(false);
    expect(isTextEntryTarget(document.body)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.appendChild(inner);
    document.body.appendChild(editable);
    expect(isTextEntryTarget(inner)).toBe(true);
    input.remove(); wrapper.remove(); button.remove(); editable.remove();
  });

  it("快捷键忽略判定：开关关闭或任一浮层打开都让路", () => {
    const base = { layoutEditorOpen: false, quickDrawerOpen: false, sheetOpen: false, moveJumpOpen: false, enabled: true };
    expect(shortcutsBlocked(base)).toBe(false);
    expect(shortcutsBlocked({ ...base, enabled: false })).toBe(true);
    expect(shortcutsBlocked({ ...base, sheetOpen: true })).toBe(true);
    expect(shortcutsBlocked({ ...base, moveJumpOpen: true })).toBe(true);
    expect(shortcutsBlocked({ ...base, layoutEditorOpen: true })).toBe(true);
    expect(shortcutsBlocked({ ...base, quickDrawerOpen: true })).toBe(true);
  });
});
