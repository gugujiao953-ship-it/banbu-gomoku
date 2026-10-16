import { memo, type CSSProperties } from "react";
import type { ResolvedTheme } from "../app-shell-types";
import pelicanBody from "../../public/theme-assets/pelican-body.svg?raw";

// Stable positions keep particles from jumping when the application rerenders.
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 37 + 13) % 92 + 4,
  y: 54 + ((i * 53 + 17) % 37),
}));

/** Shared by the application and the unobstructed theme preview. */
export const ThemeScene = memo(function ThemeScene({ theme }: { theme: ResolvedTheme }) {
  return <div className="theme-scene" aria-hidden="true" data-testid="theme-scene">
    <i className="ts-layer ts-far" />
    <i className="ts-layer ts-mid" />
    <i className="ts-layer ts-near" />
    <span className="ts-sway">
      {[0, 1, 2, 3].map((i) => <b key={i} style={{ "--i": i } as CSSProperties} />)}
    </span>
    {theme === "pelican" && <span className="ts-ride">
      <b className="tr-wheel tr-wheel-rear" />
      <b className="tr-wheel tr-wheel-front" />
      <b className="tr-crank-far" />
      <b className="tr-far-thigh" />
      <b className="tr-far-shin" />
      <b className="tr-far-foot" />
      <b className="tr-frame" />
      <b className="tr-crank" />
      <b className="tr-thigh" />
      <b className="tr-shin" />
      <b className="tr-foot" />
      {/* Local, trusted SVG: render with the bicycle, without a second image request. */}
      <b className="tr-body tr-body-inline" dangerouslySetInnerHTML={{ __html: pelicanBody }} />
    </span>}
    <span className="ts-parts">
      {PARTICLES.map((p, i) => <i key={i} style={{ "--i": i, "--x": `${p.x}%`, "--y": `${p.y}%` } as CSSProperties} />)}
    </span>
  </div>;
});
