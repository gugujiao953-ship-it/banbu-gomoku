import { generate, verify, evaluateMove } from '../../../vcf-generator/lib/browser.mjs';
import { isGeneratedPuzzle, validateSettings, type WorkerRequest, type WorkerReply } from './model';

const reply = (message: WorkerReply) => self.postMessage(message);
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const request = event.data;
    if (request.type === 'verify') {
      if (!isGeneratedPuzzle(request.puzzle)) throw new Error('题目数据不完整或路数超出 30');
      const check = verify(request.puzzle, { timeMs: 30000 });
      reply({ type: 'verified', valid: check.valid, note: check.valid ? '独立验题通过' : check.status === 'budget' ? '验题尚未完成，请重新打开重试。' : '题目验证失败，不能用于解题。' });
      return;
    }
    if (request.type === 'move') {
      reply({ type: 'move', result: evaluateMove(request.puzzle, request.moves, request.proof, request.at) });
      return;
    }
    validateSettings(request.settings);
    const s = request.settings, seen = new Set(request.exclude);
    // The UI exposes the route choice explicitly. Keep the old route small and
    // predictable; the quality route retains the woven natural search and its
    // stricter retry budget. Both paths still pass the same verifier below.
    const qualityRoute = s.qualityRoute !== false;
    let produced = 0;
    for (let index = 0; index < s.count; index++) {
      reply({ type: 'progress', index: index + 1, count: s.count });
      // Each slot has a bounded budget. Duplicates never fill the requested
      // count, and an exhausted slot never falls back to an easier/seed puzzle.
      const isText = s.kind === 'text';
      const routeAttempts = qualityRoute
        ? (isText ? ([...s.text].length >= 3 ? 160 : 200) : s.depth >= 50 ? 120 : 400)
        : (isText ? 80 : s.depth >= 50 ? 80 : 120);
      const result = generate({ count: 1, depth: s.depth, attacker: s.attacker, rules: s.rules,
        // At 80+ attacker moves the standard-board retries spend most of the
        // budget on layouts that cannot hold a long causal route. The 30-line
        // cap is already enforced by settings, so start there directly.
         size: s.depth >= 80 ? 30 : s.expand ? 'auto' : 15, maxSize: s.expand ? s.maxSize : 15,
         // Both routes use compact coordinates so themed/custom boards remain
         // available. The route switch below controls the construction policy.
         layout: 'compact',
        seed: (request.seed + Math.imul(index, 1013904223)) | 0,
        // seconds is the complete per-question budget. Do not silently extend
        // it for deep jobs: the selected choice is a real upper bound.
        timeMs: s.seconds * 1000,
        // Compact text routing now rejects missing-character branches before
        // solving. Keep enough restarts for difficult four-character/long
        // requests, while avoiding hundreds of redundant full solves on a
        // phone when a layout is plainly infeasible.
        solveMs: qualityRoute
          ? Math.max(1000, Math.floor(s.seconds * 1000 * (isText ? .58 : .62)))
          : Math.max(700, Math.floor(s.seconds * 1000 * (isText ? .42 : .45))),
        verifyMs: qualityRoute
          ? Math.max(1000, Math.floor(s.seconds * 1000 * .28))
          : Math.max(700, Math.floor(s.seconds * 1000 * .20)),
        maxAttempts: routeAttempts,
        // The app's VCF contract is a single correct first move. Keep the
        // persisted field for older settings files, but never generate a
        // multi-answer puzzle from the UI.
        uniqueFirst: true,
        // New route: woven supports, decoys and natural routing. Old route:
        // the compact single-chain constructor, which is substantially faster
        // on repeated 15-line/deep requests while preserving exact checks.
        ...(qualityRoute ? { naturalStyle: true, routingNoise: 1, simple: false } : { naturalStyle: false, simple: true }),
        ...(s.kind === 'forbidden' ? { ending: 'forbidden' } : {}),
        ...(s.kind === 'shape' ? { ...(s.shape === 'custom' ? { shapeInfo: s.customShape } : { shape: s.shape }), shapeComplexity: s.shapeComplexity ? 'multi-step' : 'standard' } : {}),
        ...(s.kind === 'text' ? { text: s.text, ...request.raster } : {}),
        onProgress: (p: { size?: number }) => reply({ type: 'progress', index: index + 1, count: s.count, size: p.size }),
      });
      for (const puzzle of result.puzzles) {
        if (!puzzle.verification?.valid || !puzzle.verification.shortest || seen.has(puzzle.id)) continue;
        seen.add(puzzle.id); produced++; reply({ type: 'puzzle', puzzle });
      }
    }
    reply({ type: 'done', produced, requested: s.count });
  } catch (error) { reply({ type: 'error', message: error instanceof Error ? error.message : '生成线程发生错误' }); }
};
