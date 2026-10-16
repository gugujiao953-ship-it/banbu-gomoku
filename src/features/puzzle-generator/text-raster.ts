import type { TextRaster } from './model';

// These four characters are used by the holiday presets and have stable,
// hand-tuned point shapes in the portable generator. Reusing the same masks
// on the device avoids font-dependent thickening that wastes intersections on
// a 15-line board.
const CURATED_GLYPHS: Record<string, string[]> = {
  '国': ['111111111','100000001','101111101','100010001','101111101','100010101','101111101','100000001','111111111'],
  '庆': ['000010000','001111111','001000000','001001000','001001000','001111110','010001000','010010100','100100010'],
  '中': ['000010000','000010000','011111110','010010010','010010010','011111110','000010000','000010000','000010000'],
  '秋': ['001000100','111000101','001001010','111000100','011000100','101000100','001001010','001010001','001100001'],
};

function curatedRaster(text: string, layout: 'horizontal' | 'vertical', compact = false): TextRaster | null {
  const characters = [...text];
  if (compact || characters.length > 2 || characters.some(character => !CURATED_GLYPHS[character])) return null;
  const glyphSize = 9, gap = 2, glyphs = characters.map(character => CURATED_GLYPHS[character]);
  const mask = layout === 'horizontal'
    ? Array.from({ length: glyphSize }, (_, row) => glyphs.map(glyph => glyph[row]).join('0'.repeat(gap)))
    : glyphs.flatMap((glyph, index) => index ? [...Array<string>(gap).fill('0'.repeat(glyphSize)), ...glyph] : glyph);
  return { text, mask, textRaster: { source: 'curated-grid', glyphSize, textLayout: layout, gap, characters,
    glyphBoxes: characters.map((character, index) => ({ index, char: character, character,
      row: layout === 'vertical' ? index * (glyphSize + gap) : 0,
      col: layout === 'horizontal' ? index * (glyphSize + gap) : 0,
      height: glyphSize, width: glyphSize })) } };
}

/** Actual platform glyphs, sampled before search; no template puzzle seeds. */
export function rasterizeAppText(text: string, layout: 'horizontal' | 'vertical', compact = false): TextRaster {
  const characters = [...text];
  if (!text || characters.length > 4 || /[\p{White_Space}\p{Cc}\p{Cf}]/u.test(text)) throw new Error('请输入一到四个可见文字');
  const curated = curatedRaster(text, layout, compact);
  if (curated) return curated;
  const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 144;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前设备无法绘制文字');
  // Four glyphs fit inside the 30-line limit at 6x6; keep the larger raster
  // for one or two glyphs so the familiar text shapes remain readable.
  const glyphSize = compact || characters.length >= 3 ? 6 : 9, gap = glyphSize >= 9 ? 2 : 1;
  // A one-third coverage cutoff drops the thin diagonal and horizontal
  // strokes of CJK glyphs after reducing them to six cells. Keep a little
  // anti-aliased ink so the printed outline stays legible and connected.
  const inkThreshold = glyphSize >= 9 ? 0.24 : 0.18;
  context.font = '126px "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
  context.textAlign = 'center';
  const render = (char: string) => {
    context.clearRect(0, 0, 144, 144);
    const metrics = context.measureText(char);
    // Fit the ink bounds rather than the font's em square, so narrow/short
    // characters do not lose their strokes to empty margins on a 9-cell mask.
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (!width || !height) return Array<string>(glyphSize).fill('0'.repeat(glyphSize));
    const scale = 142.4 / Math.max(width,height);
    context.save(); context.translate(72,72); context.scale(scale,scale);
    context.fillText(char,(metrics.actualBoundingBoxLeft-metrics.actualBoundingBoxRight)/2,
      (metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2);
    context.restore();
    const image = context.getImageData(0, 0, 144, 144).data;
    const cell = 144 / glyphSize;
    return Array.from({ length: glyphSize }, (_, row) => Array.from({ length: glyphSize }, (_, col) => {
      let alpha = 0;
      for (let r = Math.floor(row * cell); r < Math.floor((row + 1) * cell); r++) for (let c = Math.floor(col * cell); c < Math.floor((col + 1) * cell); c++) alpha += image[(r * 144 + c) * 4 + 3];
      const area = Math.max(1, Math.floor((row + 1) * cell) - Math.floor(row * cell)) * Math.max(1, Math.floor((col + 1) * cell) - Math.floor(col * cell));
      return alpha / (area * 255) >= inkThreshold ? '1' : '0';
    }).join(''));
  };
  const missing = render('\u0378').join('');
  const glyphs = characters.map(char => {
    const glyph = render(char);
    if (!glyph.join('').includes('1') || glyph.join('') === missing) throw new Error(`设备字体缺少“${char}”，请换一个文字。`);
    return glyph;
  });
  const mask = layout === 'horizontal'
    ? Array.from({ length: glyphSize }, (_, row) => glyphs.map(g => g[row]).join('0'.repeat(gap)))
    : glyphs.flatMap((g, index) => index ? [...Array<string>(gap).fill('0'.repeat(glyphSize)), ...g] : g);
  return { text, mask, textRaster: { source: 'canvas-font', glyphSize, textLayout: layout, gap, characters,
    glyphBoxes: characters.map((character, index) => ({ index, char: character, character,
      row: layout === 'vertical' ? index * (glyphSize + gap) : 0, col: layout === 'horizontal' ? index * (glyphSize + gap) : 0,
      height: glyphSize, width: glyphSize })) } };
}
