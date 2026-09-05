// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AboutPanel } from "./AboutPanel";

describe("AboutPanel", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("shows the QQ group contact", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(<AboutPanel onClose={() => undefined}/>);
    });
    expect(container.textContent).toContain("1091866163");
  });
});
