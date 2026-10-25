import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { textMask } from './theme.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/render-text.ps1', import.meta.url));
// Sans-serif strokes survive a nine-cell downsample better than fine Song
// horizontal strokes. Keep Song only as a fallback for unusual characters.
const FALLBACK_FONTS = ['Microsoft YaHei', 'Microsoft YaHei UI', 'Noto Sans SC', 'DengXian', 'Microsoft JhengHei', 'SimSun', 'Segoe UI'];
const cache = new Map();
const glyphCache = new Map();

// A font-rendered mask contains the actual supplied text. Unknown glyphs are
// rejected before rendering, so a missing-font square cannot become a puzzle.
// Invoke a fixed script with a base64 JSON argument, never interpolate input
// into PowerShell source. Cache masks before jobs are dispatched to workers.
export function rasterizeText(text, { glyphSize = 9, textLayout = 'horizontal', fontName, gap = 2, threshold = 170 } = {}) {
  if (typeof text !== 'string' || !text.length || [...text].length > 8 || /[\p{White_Space}\p{Cc}\p{Cf}]/u.test(text)) {
    throw new Error('Text must contain 1..8 visible characters without spaces or controls');
  }
  if (!Number.isInteger(glyphSize) || glyphSize < 9 || glyphSize > 15) throw new Error('glyphSize must be an integer in 9..15');
  if (!['horizontal', 'vertical'].includes(textLayout)) throw new Error('textLayout must be horizontal or vertical');
  if (!Number.isInteger(gap) || gap < 1 || gap > 5) throw new Error('Text gap must be an integer in 1..5');
  if (!Number.isInteger(threshold) || threshold < 80 || threshold > 220) throw new Error('Text threshold must be an integer in 80..220');
  if (fontName !== undefined && (typeof fontName !== 'string' || !fontName.trim() || /[\r\n\0]/.test(fontName))) throw new Error('fontName must be a nonempty installed font name');
  const request = { text, glyphSize, textLayout, gap, threshold, fontNames: fontName ? [fontName] : FALLBACK_FONTS };
  const key = JSON.stringify(request);
  if (cache.has(key)) return structuredClone(cache.get(key));
  if (process.platform !== 'win32') throw new Error('Automatic font masks currently require Windows; supply mask rows on other platforms');
  const drawingRequest = { text, glyphSize, threshold, fontNames: request.fontNames }, drawingKey = JSON.stringify(drawingRequest);
  let rendered = glyphCache.get(drawingKey);
  if (!rendered) {
    const input = Buffer.from(JSON.stringify(drawingRequest), 'utf8').toString('base64');
    const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-RequestBase64', input], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    if (run.error || run.status !== 0) throw new Error(`Cannot rasterize text: ${run.error?.message || run.stderr.trim() || `PowerShell exited ${run.status}`}`);
    try { rendered = JSON.parse(run.stdout.replace(/^\uFEFF/, '').trim()); } catch { throw new Error('Text rasterizer returned invalid JSON'); }
  }
  const glyphs = rendered.Glyphs;
  if (!Array.isArray(glyphs) || glyphs.length !== [...text].length || glyphs.some(rows => !Array.isArray(rows) || rows.length !== glyphSize || rows.some(row => typeof row !== 'string' || row.length !== glyphSize || !/^[01]+$/.test(row)))) {
    throw new Error('Text rasterizer returned invalid glyph rows');
  }
  glyphCache.set(drawingKey, rendered);
  const zero = '0'.repeat(gap);
  const mask = textLayout === 'horizontal'
    ? Array.from({ length: glyphSize }, (_, row) => glyphs.map(glyph => glyph[row]).join(zero))
    : glyphs.flatMap((glyph, index) => index ? [...Array(gap).fill('0'.repeat(glyphSize)), ...glyph] : glyph);
  const glyphBoxes = [...text].map((character, index) => ({
    text, char: character, character, index, row: textLayout === 'vertical' ? index * (glyphSize + gap) : 0,
    col: textLayout === 'horizontal' ? index * (glyphSize + gap) : 0, height: glyphSize, width: glyphSize,
  }));
  const result = { text, mask, textRaster: { source: 'windows-font', fontName: rendered.FontName, glyphSize, textLayout, gap, threshold, characters: [...text], glyphBoxes } };
  cache.set(key, result);
  return structuredClone(result);
}

export function prepareTextOptions(options = {}) {
  if (!options.text || options.mask) return { ...options };
  // Preserve portable hand-drawn glyphs unless an explicit font/size/layout
  // requests rasterization. This keeps the original examples reproducible.
  if (options.textFont === undefined && options.glyphSize === undefined && options.textLayout === undefined && options.textThreshold === undefined && options.textGap === undefined) {
    try {
      textMask(options.text);
      const characters = [...options.text];
      return { ...options, textRaster: { source: 'builtin-dot-glyphs', glyphSize: 9, textLayout: 'horizontal', gap: 2, characters,
        glyphBoxes: characters.map((character, index) => ({ text: options.text, char: character, character, index, row: 0, col: index * 11, height: 9, width: 9 })) } };
    } catch { /* Font fallback below. */ }
  }
  const rendered = rasterizeText(options.text, {
    glyphSize: options.glyphSize, textLayout: options.textLayout, fontName: options.textFont,
    gap: options.textGap, threshold: options.textThreshold,
  });
  return { ...options, mask: rendered.mask, textRaster: rendered.textRaster };
}
