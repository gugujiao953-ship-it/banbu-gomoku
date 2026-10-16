import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Board } from '../vcf-generator/lib/board.mjs';
import { decoyAudit } from '../vcf-generator/lib/quality.mjs';

const baseUrl = process.env.VCF_QA_URL || 'http://127.0.0.1:4173/';
const assets = await readdir(new URL('../dist/assets/', import.meta.url));
const workerAsset = assets.find(name => /^vcf-gen\.worker-.*\.js$/.test(name));
assert.ok(workerAsset, 'Build the production challenge worker first');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'commit', timeout: 15000 });
  const started = Date.now();
  const result = await page.evaluate(workerPath => new Promise((resolve, reject) => {
    localStorage.setItem('banbu-puzzle-generator-settings-v2', JSON.stringify({ qualityRoute: false }));
    // Production uses a classic Worker after syntax lowering for Android.
    const worker = new Worker(workerPath);
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Worker timed out')); }, 75000);
    const finish = value => { clearTimeout(timeout); worker.terminate(); resolve(value); };
    worker.onerror = error => { clearTimeout(timeout); worker.terminate(); reject(new Error(error.message)); };
    worker.onmessage = event => { if (event.data.type === 'result') finish(event.data); };
    worker.postMessage({ type: 'generate', count: 1, seed: 19, depth: 35,
      attacker: 'black', qualityRoute: false, settings: { qualityRoute: false } });
  }), `assets/${workerAsset}`);
  const elapsedMs = Date.now() - started;
  assert.equal(result.error, null);
  assert.equal(result.puzzles.length, 1);
  const puzzle = result.puzzles[0];
  assert.equal(puzzle.novel, true);
  assert.equal(puzzle.uniqueFirst, true);
  assert.equal(puzzle.attacker, 'black');
  assert.ok(puzzle.depth >= 34 && puzzle.depth <= 35);
  const board = new Board(15);
  for (const stone of puzzle.black) board.put(stone.row * 15 + stone.col, 1);
  for (const stone of puzzle.white) board.put(stone.row * 15 + stone.col, 2);
  const line = puzzle.solution.map(move => ({ at: move.row * 15 + move.col,
    player: move.player === 'black' ? 1 : 2 }));
  const audit = decoyAudit(board, 1, 'renju', line, () => 500);
  assert.equal(audit.secondLine, 0);
  assert.equal(audit.unproven, 0);
  assert.ok(audit.plausible >= Math.ceil(audit.turns * 0.3), JSON.stringify(audit));
  assert.deepEqual(errors, []);
  const output = { baseUrl, workerAsset, elapsedMs, depth: puzzle.depth, title: puzzle.title, audit, errors };
  await writeFile(new URL('vcf-production-deep-worker-20261014.json', import.meta.url), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
} finally {
  await browser.close();
}
