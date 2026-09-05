// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legacy WebView assets", () => {
  it("keeps the Rapfi worker free of logical assignment syntax unsupported by the supported WebView", () => {
    const source = readFileSync(new URL("../public/rapfi/fallback/rapfi-single.js", import.meta.url), "utf8");
    expect(source).not.toContain("||=");
  });

  it("ships an explicit old-WebView CSS fallback layer", () => {
    const source = readFileSync(new URL("./legacy-webview.css", import.meta.url), "utf8");
    expect(source).toContain(".legacy-webview .app-shell");
    expect(source).toContain(".legacy-webview .sheet-backdrop");
    expect(source).toContain("top:0;");
    expect(source).toContain("right:0;");
    expect(source).toContain("bottom:0;");
    expect(source).toContain("left:0;");
    expect(source).toContain("100vh");
    expect(source).toContain(".batch-selectable.selected");
    expect(source).toContain(".legacy-webview .puzzle-selector-current");
    expect(source).toContain(".legacy-webview .record-selector-current");
    expect(source).not.toContain(":has(");
    expect(source).not.toContain("color-mix(");
  });
});
