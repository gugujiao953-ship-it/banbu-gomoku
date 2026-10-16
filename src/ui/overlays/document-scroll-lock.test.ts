// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lockDocumentScroll } from "./document-scroll-lock";

describe("document overlay scroll lock", () => {
  const releases: Array<() => void> = [];
  const acquire = () => { const release = lockDocumentScroll(); releases.push(release); return release; };
  beforeEach(() => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth);
  });
  afterEach(() => {
    releases.splice(0).forEach((release) => release());
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    vi.restoreAllMocks();
  });

  it("locks the root without changing the sticky header's body scroll ancestor", () => {
    document.body.style.overflow = "visible";
    const originalBodyStyle = document.body.getAttribute("style");
    const release = acquire();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.documentElement.classList.contains("overlay-open")).toBe(true);
    expect(document.body.getAttribute("style")).toBe(originalBodyStyle);
    release();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.documentElement.classList.contains("overlay-open")).toBe(false);
    expect(document.body.getAttribute("style")).toBe(originalBodyStyle);
  });

  it.each([false, true])("retains the lock until both overlays close (parent first: %s)", (parentFirst) => {
    const parent = acquire();
    const child = acquire();
    const [first, last] = parentFirst ? [parent, child] : [child, parent];
    first();
    first(); // Cleanup must be idempotent.
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.documentElement.classList.contains("overlay-open")).toBe(true);
    last();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.documentElement.classList.contains("overlay-open")).toBe(false);
  });

  it("restores each overflow axis and priority without overwriting theme changes", () => {
    const style = document.documentElement.style;
    style.setProperty("overflow-x", "clip", "important");
    style.setProperty("overflow-y", "scroll");
    const release = acquire();
    style.setProperty("--safe-area-top", "12px");
    release();
    expect(style.getPropertyValue("overflow-x")).toBe("clip");
    expect(style.getPropertyPriority("overflow-x")).toBe("important");
    expect(style.getPropertyValue("overflow-y")).toBe("scroll");
    expect(style.getPropertyPriority("overflow-y")).toBe("");
    expect(style.getPropertyValue("--safe-area-top")).toBe("12px");
  });

  it("compensates a desktop scrollbar once and restores existing padding", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth - 16);
    document.body.style.setProperty("padding-right", "7px", "important");
    const parent = acquire();
    const child = acquire();
    expect(document.body.style.paddingRight).toBe("23px");
    parent();
    expect(document.body.style.paddingRight).toBe("23px");
    child();
    expect(document.body.style.paddingRight).toBe("7px");
    expect(document.body.style.getPropertyPriority("padding-right")).toBe("important");
  });

  it("allows a fresh acquire after a StrictMode-style cleanup", () => {
    acquire()();
    const release = acquire();
    expect(document.documentElement.style.overflow).toBe("hidden");
    release();
    expect(document.documentElement.style.overflow).toBe("");
  });
});
