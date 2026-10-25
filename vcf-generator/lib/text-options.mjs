import { textMask } from './theme.mjs';

// Other text arrives as a real font mask prepared by the host (Canvas in the
// app, the Windows font renderer in the CLI), never as a replacement glyph.
export function preparePortableTextOptions(options) {
  if (!options.text || options.mask) return { ...options };
  textMask(options.text);
  const characters = [...options.text];
  return { ...options, textRaster: { source: 'builtin-dot-glyphs', glyphSize: 9,
    textLayout: 'horizontal', gap: 2, characters,
    glyphBoxes: characters.map((character, index) => ({ text: options.text, char: character, character, index,
      row: 0, col: index * 11, height: 9, width: 9 })) } };
}
