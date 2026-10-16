import { afterEach, describe, expect, it, vi } from 'vitest';
import { verify } from '../../../vcf-generator/lib/browser.mjs';
import type { WorkerReply, WorkerRequest } from './model';

describe('生成器 Worker 自定义轮廓链路', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('按页面请求格式生成自定义轮廓题并回传独立验题证书', async () => {
    const replies: WorkerReply[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<WorkerRequest>) => void) | null,
      postMessage: (reply: WorkerReply) => replies.push(reply),
    };
    vi.resetModules();
    vi.stubGlobal('self', scope);
    await import('./generator.worker');

    const request: WorkerRequest = {
      type: 'generate',
      seed: 1,
      exclude: [],
      settings: {
        engine: 'vcf', kind: 'shape', attacker: 'black', rules: 'renju', depth: 8,
        count: 1, expand: true, maxSize: 15, shape: 'custom', shapeComplexity: false,
        customShape: {
          id: 'custom', label: '测试菱形', source: 'custom-mask',
          mask: ['0001000', '0011100', '0111110', '0011100', '0001000'],
          parts: [{ id: 'outline', label: '整个轮廓', points: [
            { row: 0, col: 3 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 },
            { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 }, { row: 2, col: 5 },
            { row: 3, col: 2 }, { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 4, col: 3 },
          ] }],
        },
        text: '', textLayout: 'horizontal', seconds: 15, uniqueFirst: true,
        qualityRoute: true, moreObstacles: false, hardSearch: false,
      },
    };
    scope.onmessage!(new MessageEvent('message', { data: request }));

    const puzzleReply = replies.find((reply): reply is Extract<WorkerReply, { type: 'puzzle' }> => reply.type === 'puzzle');
    expect(puzzleReply).toBeDefined();
    expect((puzzleReply!.puzzle.theme?.shape as { source?: string } | undefined)?.source).toBe('custom-mask');
    expect(puzzleReply!.puzzle.verification?.valid).toBe(true);
    expect(verify(puzzleReply!.puzzle, { timeMs: 30_000 }).valid).toBe(true);
    expect(replies[replies.length - 1]).toMatchObject({ type: 'done', produced: 1, requested: 1 });
  }, 45_000);
});
