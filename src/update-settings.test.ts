import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UPDATE_AUTO_CHECK, loadUpdateAutoCheck, normalizeUpdateAutoCheck, saveUpdateAutoCheck, UPDATE_AUTO_CHECK_KEY } from "./update-settings";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { return this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { return void this.values.delete(key); }
  setItem(key: string, value: string) { return void this.values.set(key, String(value)); }
}

describe("启动自动检查新版本开关", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认开启", () => {
    expect(DEFAULT_UPDATE_AUTO_CHECK).toBe(true);
    expect(loadUpdateAutoCheck()).toBe(true);
  });

  it("保存后读回相同值", () => {
    saveUpdateAutoCheck(false);
    expect(loadUpdateAutoCheck()).toBe(false);
    saveUpdateAutoCheck(true);
    expect(loadUpdateAutoCheck()).toBe(true);
  });

  it("损坏或缺失的存储回落默认值", () => {
    localStorage.setItem(UPDATE_AUTO_CHECK_KEY, "{broken");
    expect(loadUpdateAutoCheck()).toBe(DEFAULT_UPDATE_AUTO_CHECK);
    localStorage.setItem(UPDATE_AUTO_CHECK_KEY, JSON.stringify("yes"));
    expect(normalizeUpdateAutoCheck("yes")).toBe(DEFAULT_UPDATE_AUTO_CHECK);
    expect(loadUpdateAutoCheck()).toBe(DEFAULT_UPDATE_AUTO_CHECK);
  });
});
