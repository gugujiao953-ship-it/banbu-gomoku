import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOTATION_HIGHLIGHT_KEY, annotationHighlightColor, loadAnnotationHighlight, normalizeAnnotationHighlight, saveAnnotationHighlight } from "./annotation-highlight";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

describe("annotation highlight preference", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

  it("defaults malformed or missing preferences to none", () => {
    expect(normalizeAnnotationHighlight(undefined)).toBe("none");
    expect(normalizeAnnotationHighlight("purple")).toBe("none");
    expect(loadAnnotationHighlight()).toBe("none");
  });

  it("persists supported colors and resolves their SVG glow color", () => {
    saveAnnotationHighlight("gold");
    expect(localStorage.getItem(ANNOTATION_HIGHLIGHT_KEY)).toBe("gold");
    expect(loadAnnotationHighlight()).toBe("gold");
    expect(annotationHighlightColor("white")).toBe("#ffffff");
    expect(annotationHighlightColor("gold")).toBe("#ffd76a");
    expect(annotationHighlightColor("blue")).toBe("#6ec8ff");
    expect(annotationHighlightColor("none")).toBeNull();
  });
});
