import { describe, expect, it, vi } from "vitest";
import { applyFlexGapCompatibilityClass, applyWebViewCompatibilityClass, needsLegacyWebViewCss, type CssSupportProbe } from "./webview-compat";

describe("WebView CSS compatibility", () => {
  it("keeps modern browsers on the primary CSS path", () => {
    const modernProbe: CssSupportProbe = { supports: vi.fn(() => true) };
    expect(needsLegacyWebViewCss(modernProbe)).toBe(false);
  });

  it("activates the fallback when WebView 83 lacks modern selectors or colors", () => {
    const legacyProbe: CssSupportProbe = { supports: vi.fn((first: string) => !first.includes(":has")) };
    const classList = { toggle: vi.fn() } as unknown as DOMTokenList;
    expect(applyWebViewCompatibilityClass({ classList }, legacyProbe)).toBe(true);
    expect(classList.toggle).toHaveBeenCalledWith("legacy-webview", true);
  });

  it.each(["selector(:where(*))", "inset"])("activates the fallback when %s is unsupported", (unsupported) => {
    const legacyProbe: CssSupportProbe = { supports: vi.fn((first: string) => first !== unsupported) };
    expect(needsLegacyWebViewCss(legacyProbe)).toBe(true);
  });

  it("fails safe when selector feature detection throws", () => {
    const throwingProbe: CssSupportProbe = { supports: vi.fn(() => { throw new Error("unsupported"); }) };
    expect(needsLegacyWebViewCss(throwingProbe)).toBe(true);
  });

  it("marks runtimes whose Flexbox gap is parsed but ignored", () => {
    const classList = { contains: vi.fn(() => false), toggle: vi.fn(), remove: vi.fn() };
    const probe = { style: {}, scrollHeight: 0, appendChild: vi.fn(), remove: vi.fn() };
    const doc = { createElement: vi.fn(() => probe), body: { appendChild: vi.fn() }, documentElement: {} };
    const root = { ownerDocument: doc, classList } as unknown as HTMLElement;
    applyFlexGapCompatibilityClass(root);
    expect(classList.toggle).toHaveBeenCalledWith("no-flex-gap", true);
  });
});
