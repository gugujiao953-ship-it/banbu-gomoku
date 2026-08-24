/// <reference lib="webworker" />
import { findBestMove } from "./puzzle-ai";
import type { Cell, Player } from "./types";

self.onmessage = (event: MessageEvent<{ board: Cell[][]; player: Player }>) => {
  const started = performance.now();
  const move = findBestMove(event.data.board.map((row) => [...row]), event.data.player, { maxDepth: 4, timeBudgetMs: 1100, width: 8 });
  const delay = Math.max(0, 220 - (performance.now() - started));
  setTimeout(() => self.postMessage({ move }), delay);
};
