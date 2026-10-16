import { memo, useId, useMemo } from "react";
import type { BoardMaterial } from "./types";
import { boardLayers, motionCss } from "./render";
import { SvgHtml } from "./svg-html";
import { scopeSvgFragment } from "./svg-scope";
import "./board-material-surface.css";

/** Keep animated background paint in a stable SVG viewport, separate from
 * the stones and frequently updated analysis candidates. Both viewports
 * share the board's sizing/zoom host so pointer targets stay aligned. */
export const BoardMaterialSurface = memo(function BoardMaterialSurface({
  material, boardSize, margin, gap, opacity,
}: {
  material: BoardMaterial;
  boardSize: number;
  margin: number;
  gap: number;
  opacity: number;
}) {
  const id = `board-material-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const content = useMemo(() => scopeSvgFragment(
    boardLayers(material, boardSize, margin, gap),
    motionCss(material.motions, material.id, true).replace(/#board\b/g, `#${id}`),
    id,
  ), [material, boardSize, margin, gap, id]);
  return <svg id={id} className="board-material-surface" viewBox="0 0 572 572" aria-hidden="true" focusable="false">
    <style data-material-motion="">{content.css}</style>
    <SvgHtml tag="g" className="board-material" style={{ opacity }} html={content.html} />
  </svg>;
});
