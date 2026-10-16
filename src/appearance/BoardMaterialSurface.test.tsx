// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardMaterialSurface } from "./BoardMaterialSurface";
import { findBoardMaterial } from "./render";
import { scopeSvgFragment } from "./svg-scope";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); });

describe("animated material isolation", () => {
  const material = findBoardMaterial("app-blackgold")!;
  const render = (tick: number, opacity = 1) => act(() => root.render(<div className="board-canvas">
    <BoardMaterialSurface material={material} boardSize={15} margin={34} gap={36} opacity={opacity} />
    <svg id="board"><g className="analysis-candidate-point"><text>{tick}</text></g></svg>
  </div>));
  it("keeps the animated nodes and stylesheet unchanged across analysis frames", async () => {
    await render(0);
    const materialHost = host.querySelector(".board-material")!;
    const nodes = [...materialHost.querySelectorAll("*")];
    const style = host.querySelector("style")!;
    const text = style.firstChild;
    for (let tick = 1; tick <= 20; tick++) await render(tick);
    expect(host.querySelector("#board")!.contains(materialHost)).toBe(false);
    expect(host.querySelector(".board-material")).toBe(materialHost);
    expect([...materialHost.querySelectorAll("*")]).toEqual(nodes);
    expect(style.firstChild).toBe(text);
    expect(host.querySelector("#board text")!.textContent).toBe("20");
    await render(21, 0.4);
    expect((materialHost as SVGGElement).style.opacity).toBe("0.4");
    expect([...materialHost.querySelectorAll("*")]).toEqual(nodes);
  });
  it("gives concurrent boards private gradients, clips and motion selectors", async () => {
    await act(() => root.render(<><BoardMaterialSurface material={material} boardSize={15} margin={34} gap={36} opacity={1} /><BoardMaterialSurface material={material} boardSize={15} margin={34} gap={36} opacity={1} /></>));
    const ids = [...host.querySelectorAll("[id]")].map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of host.querySelectorAll("svg")) {
      expect(svg.querySelector("style")!.textContent).toContain(`#${svg.id} .app-blackgold-lustre`);
      for (const match of svg.innerHTML.matchAll(/url\(#([^)]*)\)/g)) {
        expect(svg.querySelector(`[id="${match[1]}"]`)).not.toBeNull();
      }
    }
  });
  it("rewrites resource references without rewriting colors or external references", () => {
    const result = scopeSvgFragment(`<defs><g id='shape'/><filter id="blur"/></defs><use href='#shape'/><use xlink:href="#shape"/><g filter="url(#blur)" fill="#abc"/>`, `.a{filter:url('#blur');fill:url(#outside);color:#abc}`, "surface");
    expect(result.html).toContain("href='#surface-shape'");
    expect(result.html).toContain('xlink:href="#surface-shape"');
    expect(result.html).toContain('filter="url(#surface-blur)"');
    expect(result.css).toBe(".a{filter:url('#surface-blur');fill:url(#outside);color:#abc}");
  });
});
