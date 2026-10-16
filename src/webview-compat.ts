export interface CssSupportProbe {
  supports(property: string, value: string): boolean;
  supports(condition: string): boolean;
}

const safelySupports = (probe: CssSupportProbe | undefined, ...args: [string] | [string, string]) => {
  if (!probe) return false;
  try { return args.length === 1 ? probe.supports(args[0]) : probe.supports(args[0], args[1]); }
  catch { return false; }
};

export const needsLegacyWebViewCss = (probe: CssSupportProbe | undefined) => !(
  safelySupports(probe, "selector(:is(*))")
  && safelySupports(probe, "selector(:where(*))")
  && safelySupports(probe, "selector(:has(*))")
  && safelySupports(probe, "color", "color-mix(in srgb, #000 50%, #fff)")
  && safelySupports(probe, "height", "100dvh")
  && safelySupports(probe, "inset", "0")
  && safelySupports(probe, "selector(:focus-visible)")
);

export const applyWebViewCompatibilityClass = (
  root: Pick<HTMLElement, "classList">,
  probe: CssSupportProbe | undefined = globalThis.CSS,
) => {
  const legacy = needsLegacyWebViewCss(probe);
  root.classList.toggle("legacy-webview", legacy);
  return legacy;
};

/** CSS.supports(gap) tests Grid too; Chrome 79 supports Grid gaps but silently
 * ignores them in Flexbox. Measure the layout instead of guessing from UA. */
export const applyFlexGapCompatibilityClass = (root: HTMLElement) => {
  const document = root.ownerDocument;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;padding:0;border:0;";
  for (let i = 0; i < 2; i++) {
    const child = document.createElement("div");
    child.style.cssText = "height:1px;min-height:1px;flex:none;padding:0;border:0;margin:0;";
    probe.appendChild(child);
  }
  (document.body || document.documentElement).appendChild(probe);
  const missing = probe.scrollHeight !== 3;
  probe.remove();
  root.classList.toggle("no-flex-gap", missing);
  return missing;
};
