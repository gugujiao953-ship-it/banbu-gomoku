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
