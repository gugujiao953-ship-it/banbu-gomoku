import { withAlpha } from "./action-opacity";

/** sRGB interpolation with premultiplied alpha, as used by our theme mixes. */
export const mixLegacyColors = (first: string, second: string, weight: number): string => {
  const parse = (color: string) => {
    if (color.trim() === "transparent") return [0, 0, 0, 0];
    const match = withAlpha(color, 1).match(/^rgba\(([^)]+)\)$/);
    const values = match?.[1].split(",").map(Number);
    return values?.length === 4 && values.every(Number.isFinite) ? values : null;
  };
  const a = parse(first), b = parse(second);
  if (!a || !b) return first;
  const ratio = Math.min(1, Math.max(0, weight));
  const alpha = a[3] * ratio + b[3] * (1 - ratio);
  const channels = [0, 1, 2].map((i) => alpha ? Math.round((a[i] * a[3] * ratio + b[i] * b[3] * (1 - ratio)) / alpha) : 0);
  return `rgba(${channels.join(", ")}, ${alpha})`;
};

/** CSS custom properties accept unsupported color syntax, so var()'s fallback
 * never runs. Supply real colors after every theme change, also for portals. */
export const applyLegacyThemeColors = (root: HTMLElement) => {
  if (!root.classList.contains("legacy-webview")) return;
  const style = getComputedStyle(root);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const mix = (name: string, first: string, second: string, weight: number) => root.style.setProperty(name, mixLegacyColors(first, second, weight));
  mix("--red-2", read("--red"), read("--ink"), .52);
  for (const [name, token, color, weight] of [
    ["jade", "--color-accent", "#0f766e", .88],
    ["blue", "--color-accent", "#1d5688", .55],
    ["rose", "--color-danger", "#d6336c", .7],
    ["violet", "--color-accent", "#7c3aed", .45],
    ["teal", "--color-accent", "#0d9488", .6],
    ["orange", "--color-warning", "#ea580c", .65],
    ["slate", "--color-text-muted", "#475569", .7],
  ] as const) mix(`--bookmark-${name}`, read(token), color, weight);
};
