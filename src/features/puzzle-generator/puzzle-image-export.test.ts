import { describe, expect, it } from 'vitest';
import { createPuzzleShareSvg, puzzleShareFilename } from './puzzle-image-export';
import type { GeneratedPuzzle } from './model';

const puzzle: GeneratedPuzzle = {
  schema: 'banbu-vcf-proof/1', id: 'share-test-123456789', title: '节日<题>', size: 15,
  rules: 'renju', attacker: 'black', depth: 8,
  stones: { black: [{ row: 7, col: 7 }], white: [{ row: 7, col: 8 }] },
  proof: { at: 0, kind: 'four', depth: 1 }, solution: [],
  theme: { text: '国庆', mask: ['1'], row: 0, col: 0, width: 1, height: 1, fixed: [{ at: 112, player: 1 }], critical: [{ at: 113, player: 2 }] },
  provenance: { method: 'test', corpusUsed: false, seed: 1, canonicalHash: 'test' },
};

describe('puzzle image export', () => {
  it('renders a safe, shareable SVG with puzzle metadata and board stones', () => {
    const svg = createPuzzleShareSvg(puzzle);
    expect(svg).toContain('节日&lt;题&gt;');
    expect(svg).toContain('文字题 · 黑先 · 8 手 · 15×15 · 有禁手');
    expect(svg).toContain('data-export-role="coordinate"');
    expect(svg).toContain('stroke="#2171b8"');
    expect(svg).toContain('stroke="#c256df"');
    expect(svg).toContain('PUZZLE · share-test-');
  });

  it('uses a filesystem-safe filename', () => {
    expect(puzzleShareFilename(puzzle)).toBe('节日-题--15路.png');
  });
});
