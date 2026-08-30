// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fontScaleClass, loadFontScale, saveFontScale, FONT_SCALE_STORAGE_KEY } from "./accessibility";

describe("accessibility preferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to normal and rejects unknown values", () => {
    expect(loadFontScale()).toBe("normal");
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, "huge");
    expect(loadFontScale()).toBe("normal");
  });

  it("persists scale and exposes a stable root class", () => {
    saveFontScale("xlarge");
    expect(loadFontScale()).toBe("xlarge");
    expect(fontScaleClass("xlarge")).toBe("font-scale-xlarge");
  });
});
