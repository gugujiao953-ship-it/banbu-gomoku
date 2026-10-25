import { generateNormalized } from './generate-core.mjs';
import { normalizeRequest } from './orchestration/normalize.mjs';
import { prepareTextOptions } from './text-mask.mjs';
export { canonicalKey } from './generate-core.mjs';

// Preserve the existing CLI/Node API, including its native font preparation.
export function generate(options = {}) {
  const compactTextWithoutRaster = options.layout === 'compact' && (options.text || options.mask)
    && !options.shapeInfo && !options.textRaster?.glyphBoxes;
  if (compactTextWithoutRaster) throw new Error('Compact text layout requires per-character glyph boxes (glyph constraints)');
  return generateNormalized(normalizeRequest(options, prepareTextOptions));
}
