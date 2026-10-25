import { preparePortableTextOptions } from '../text-options.mjs';
import { prepareShapeOptions } from '../shapes.mjs';
import { resolveLayout } from '../size-policy.mjs';

// Adapters own environment-specific text preparation. The synthesis core only
// receives a normalized request, so Node font rendering and browser portable
// glyphs cannot drift through separate shape/layout preparation paths.
export function normalizeRequest(options = {}, prepareText = preparePortableTextOptions) {
  const shaped = prepareShapeOptions(options);
  const prepared = prepareText(shaped);
  return { ...prepared, layout: resolveLayout(prepared) };
}
