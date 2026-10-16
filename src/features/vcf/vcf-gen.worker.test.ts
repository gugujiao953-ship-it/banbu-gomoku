import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate } from '../../../vcf-generator/lib/browser.mjs';

vi.mock('../../../vcf-generator/lib/browser.mjs', () => ({
  generate: vi.fn(() => ({ puzzles: [] })),
}));
vi.mock('./on-demand-puzzles', () => ({ toChallengePuzzles: vi.fn(() => []) }));

describe('挑战 Worker 的固定复杂路线', () => {
  const scope = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn() };
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    scope.onmessage = null;
    vi.stubGlobal('self', scope);
    // A generator-page preference must never enter challenge construction.
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => JSON.stringify({ qualityRoute: false })) });
    await import('./vcf-gen.worker');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('独立生成器选快速路线时，挑战仍调用高质量复杂构造', () => {
    scope.onmessage!(new MessageEvent('message', { data: {
      type: 'generate', count: 1, seed: 7, depth: 20, attacker: 'white',
      qualityRoute: false, settings: { qualityRoute: false },
    } }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      count: 1, depth: 20, attacker: 'white', size: 15, maxSize: 15,
      layout: 'compact', naturalStyle: true, simple: false, uniqueFirst: true,
    }));
    expect(localStorage.getItem).not.toHaveBeenCalled();
  });

  it('旧请求的100手目标限制到35手，预算与复杂路线保持完整', () => {
    scope.onmessage!(new MessageEvent('message', { data: {
      type: 'generate', count: 1, seed: 19, depth: 100, attacker: 'black',
    } }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      depth: 35, timeMs: 60000, naturalStyle: true, simple: false, uniqueFirst: true,
    }));
  });
});
