// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DROP_EFFECTS, PLACE_EFFECTS } from "./appearance/effects";
import {
  DEFAULT_MOTION_EFFECTS_SETTINGS,
  MOTION_EFFECTS_SETTINGS_KEY,
  findDropEffect,
  findPlaceEffect,
  loadMotionEffectsSettings,
  normalizeMotionEffectsSettings,
  saveMotionEffectsSettings,
} from "./motion-effects-settings";

describe("公用效果设置", () => {
  beforeEach(() => localStorage.clear());

  it("默认两个都关（公用动效不替新用户打开），place=pl-ripple / drop=dp-settle", () => {
    expect(DEFAULT_MOTION_EFFECTS_SETTINGS).toEqual({ placeOn: false, placeId: "pl-ripple", dropOn: false, dropId: "dp-settle" });
    expect(loadMotionEffectsSettings()).toEqual(DEFAULT_MOTION_EFFECTS_SETTINGS);
    // 只改默认值、不升 storage key：存过值的老用户保持自己的选择（打开开关仍是那套默认方案）。
    localStorage.setItem(MOTION_EFFECTS_SETTINGS_KEY, JSON.stringify({ placeOn: true, placeId: "pl-flash", dropOn: true, dropId: "dp-jelly" }));
    expect(loadMotionEffectsSettings()).toEqual({ placeOn: true, placeId: "pl-flash", dropOn: true, dropId: "dp-jelly" });
  });

  it("持久化用户的选择", () => {
    saveMotionEffectsSettings({ placeOn: false, placeId: "pl-flash", dropOn: true, dropId: "dp-jelly" });
    expect(loadMotionEffectsSettings()).toEqual({ placeOn: false, placeId: "pl-flash", dropOn: true, dropId: "dp-jelly" });
    expect(JSON.parse(localStorage.getItem(MOTION_EFFECTS_SETTINGS_KEY) || "{}").placeId).toBe("pl-flash");
  });

  it("非法/缺失/坏 id 一律回落第一套，不崩不空白", () => {
    expect(normalizeMotionEffectsSettings(null)).toEqual(DEFAULT_MOTION_EFFECTS_SETTINGS);
    expect(normalizeMotionEffectsSettings({ placeId: "pl-does-not-exist", dropId: 42 }).placeId).toBe(PLACE_EFFECTS[0].id);
    expect(normalizeMotionEffectsSettings({ placeId: "pl-does-not-exist", dropId: 42 }).dropId).toBe(DROP_EFFECTS[0].id);
    localStorage.setItem(MOTION_EFFECTS_SETTINGS_KEY, "not-json");
    expect(loadMotionEffectsSettings()).toEqual(DEFAULT_MOTION_EFFECTS_SETTINGS);
    // 开关类型不对时回落默认（都关）
    expect(normalizeMotionEffectsSettings({ placeOn: "yes", dropOn: 0 })).toMatchObject({ placeOn: false, dropOn: false });
  });

  it("按 id 找不到时 find* 也回落第一套", () => {
    expect(findPlaceEffect("nope").id).toBe(PLACE_EFFECTS[0].id);
    expect(findDropEffect("nope").id).toBe(DROP_EFFECTS[0].id);
    expect(findPlaceEffect("pl-flash").id).toBe("pl-flash");
  });

  it("数组 id 唯一（设置存的就是它，重复会让回落变得不确定）", () => {
    expect(new Set(PLACE_EFFECTS.map((s) => s.id)).size).toBe(PLACE_EFFECTS.length);
    expect(new Set(DROP_EFFECTS.map((s) => s.id)).size).toBe(DROP_EFFECTS.length);
  });
});
