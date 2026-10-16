// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleGeneratorPage } from './PuzzleGeneratorPage';
import type { GeneratedPuzzle, WorkerReply, WorkerRequest } from './model';

const { workers } = vi.hoisted(() => ({ workers: [] as Array<{
  onmessage: ((event: { data: WorkerReply }) => void) | null;
  onerror: (() => void) | null;
  terminated: boolean;
  requests: WorkerRequest[];
}> }));
vi.mock('./generator.worker?worker', () => ({ default: class {
  onmessage: ((event: { data: WorkerReply }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  requests: WorkerRequest[] = [];
  constructor() { workers.push(this); }
  postMessage(request: WorkerRequest) { this.requests.push(request); }
  terminate() { this.terminated = true; }
} }));

const puzzle: GeneratedPuzzle = {
  schema: 'banbu-vcf-proof/1', id: 'first', title: '测试题', size: 15,
  rules: 'renju', attacker: 'black', depth: 3,
  stones: { black: [], white: [] }, proof: { at: 112, kind: 'five', depth: 3 },
  solution: [{ at: 112, player: 1, note: 'five' }],
  verification: { valid: true, shortest: true, status: 'valid', depth: 3, nodes: 1, elapsedMs: 1 },
  provenance: { method: 'test', corpusUsed: false, seed: 1, canonicalHash: 'first' },
};

describe('生成器 Worker 复用与停止', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    localStorage.clear(); workers.length = 0;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<PuzzleGeneratorPage saved={[]} onBack={() => {}} onSave={() => {}} onExport={() => {}}/>));
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove(); vi.unstubAllGlobals();
  });
  const button = (label: string) => {
    const found = Array.from(container.querySelectorAll('button')).find(b => b.textContent === label);
    expect(found, label).toBeTruthy();
    return found!;
  };
  const click = (label: string) => act(() => button(label).click());
  const finish = () => act(() => {
    const worker = workers[workers.length - 1];
    worker.onmessage?.({ data: { type: 'puzzle', puzzle } });
    worker.onmessage?.({ data: { type: 'done', produced: 1, requested: 1 } });
  });

  it('生成后查看答案、复原、开始做题，下一次仍复用引擎；卸载时释放线程', () => {
    click('生成新题'); finish();
    expect(container.textContent).toContain('独立验题通过');
    click('查看答案'); click('复原题面'); click('开始做题');
    click('生成新题');
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
    expect(workers[0].requests.filter(r => r.type === 'generate')).toHaveLength(2);
    finish();
    act(() => root.render(null));
    expect(workers[0].terminated).toBe(true);
  });

  it('停止活动搜索后释放线程并忽略迟到结果，再生成时使用新线程', () => {
    click('生成新题');
    const lateReply = workers[0].onmessage!;
    click('停止生成');
    expect(workers[0].terminated).toBe(true);
    act(() => lateReply({ data: { type: 'puzzle', puzzle } }));
    expect(container.querySelector('.generator-puzzle-meta')).toBeNull();
    click('生成新题');
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
    finish();
    expect(container.textContent).toContain('验题通过');
  });
});
