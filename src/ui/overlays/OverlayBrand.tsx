export type OverlayAppearance = "utility" | "gateway" | "arena" | "archive" | "decision" | "story" | "clock";

/** Use the exact mark already shown in the app header and quick drawer.
 * Its wood/black/ivory colors are brand colors; supporting chrome takes the
 * active theme. This decorative image never contributes an accessible name. */
export function OverlayBrandMark() {
  return <img className="overlay-brand-mark" src="./icon.svg" width={56} height={56} alt="" aria-hidden="true" draggable={false}/>;
}

/** Low contrast support patterns. Grid intersections and paired circular arcs
 * echo the existing logo without introducing another competing brand mark. */
export function OverlayPattern() {
  return <svg className="overlay-pattern" viewBox="0 0 520 190" preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
    <g className="overlay-pattern-cloud" fill="none" stroke="currentColor" strokeWidth=".7">
      <path d="M372-36a94 94 0 1 0 0 188M411-36a94 94 0 1 0 0 188"/>
      <path d="M346 14v110m22-110v110m22-110v110m22-110v110m22-110v110M328 33h125m-125 22h125m-125 22h125m-125 22h125"/>
    </g>
    <g className="overlay-pattern-circuit" fill="none" stroke="currentColor" strokeWidth=".8">
      <path d="M520 27h-56l-28 28h-61l-22 22h-67M520 140h-65l-25-25h-37M408 0v25l-18 18h-47"/>
      {[286,375,436].map((x, i) => <rect key={x} x={x-2} y={i===0?75:53} width="4" height="4" fill="currentColor"/>)}
    </g>
    <g className="overlay-pattern-stars" fill="none" stroke="currentColor" strokeWidth=".7">
      <path d="M490 67l-46-43-56 40-28-25M465 150l9-39-66-13"/>
      {[360,388,444,490].map((x, i) => <circle key={x} cx={x} cy={[39,64,24,67][i]} r="2" fill="currentColor"/>)}
      <path d="M422 26v10m-5-5h10"/>
    </g>
  </svg>;
}
