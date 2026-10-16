/**
 * 「自定义背景」的界面主题（`src/custom-ui-theme.ts`）。
 *
 * 这几条断言都对着**具体的误读风险**，不是"跑一遍覆盖率"：
 *  · 旧存档里没有这个键 ⇒ 必须落回 `light`（改前 custom 就是浅色界面，
 *    默认值错了会让老用户打开应用莫名变暗）；
 *  · 存档里写着 `system` / `custom` ⇒ 也必须是非法值（它们不是"一套界面"，见文件头）；
 *  · 存进去再读出来要一致（预览买下那条路靠它落盘）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTheme } from "./app-shell-types";
import {
  CUSTOM_UI_THEME_KEY, DEFAULT_CUSTOM_UI_THEME, isCustomUiTheme, loadCustomUiTheme, saveCustomUiTheme,
} from "./custom-ui-theme";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("自定义背景的界面主题", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", new MemoryStorage()); });

  it("旧存档没有这个键时落回浅色（改前 custom 就是浅色界面）", () => {
    expect(loadCustomUiTheme()).toBe("light");
    expect(DEFAULT_CUSTOM_UI_THEME).toBe("light");
  });

  it("system / custom 不是合法的界面主题", () => {
    for (const bad of ["system", "custom", "", "not-a-theme", null, 42, {}]) {
      expect(isCustomUiTheme(bad)).toBe(false);
    }
    localStorage.setItem(CUSTOM_UI_THEME_KEY, "custom");
    expect(loadCustomUiTheme()).toBe("light");
    localStorage.setItem(CUSTOM_UI_THEME_KEY, "system");
    expect(loadCustomUiTheme()).toBe("light");
  });

  it("可测主题（深浅都算）是合法的，存读一致", () => {
    const good: ResolvedTheme[] = ["light", "dark", "cyber", "soul", "porcelain", "kawaii", "dunhuang", "pelican"];
    for (const id of good) {
      expect(isCustomUiTheme(id)).toBe(true);
      saveCustomUiTheme(id);
      expect(loadCustomUiTheme()).toBe(id);
    }
  });

  it("存储抛异常时不崩、读回默认", () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("storage unavailable"); },
      setItem() { throw new Error("storage unavailable"); },
    } as unknown as Storage);
    expect(loadCustomUiTheme()).toBe("light");
    expect(() => saveCustomUiTheme("cyber")).not.toThrow();
  });
});
