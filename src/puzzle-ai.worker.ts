/// <reference lib="webworker" />
import { findBestMoveDetailed } from "./puzzle-ai";
import { searchVcf, verifyVcfProof } from "./vcf";
import type { Cell, Player, RuleSet } from "./types";

interface AiWorkerMessage { board: Cell[][]; player: Player; rule?: RuleSet; purpose?: "game" | "puzzle" | "think" }

self.onmessage = (event: MessageEvent<AiWorkerMessage>) => {
  const started = performance.now();
  const purpose = event.data.purpose || "game";
  const rule = event.data.rule || "renju";
  const board = event.data.board.map((row) => [...row]);
  // VCF is a small but important strength multiplier: when a forced sequence
  // exists, do not let a shallow positional search overlook it. The proof is
  // independently checked before its first move is exposed to the UI.
  const tactical = searchVcf(board, event.data.player, {
    rule,
    maxAttackMoves: 5,
    timeBudgetMs: purpose === "think" ? 700 : 220,
    nodeBudget: purpose === "think" ? 70000 : 24000,
  });
  if (tactical.status === "win" && tactical.proof) {
    const verified = verifyVcfProof(board, tactical.proof, event.data.player, rule);
    const first = tactical.principalVariation[0];
    if (verified.valid && first) {
      const result = {
        move: { row: first.row, col: first.col },
        score: 1_000_000,
        depth: tactical.principalVariation.length,
        nodes: tactical.nodes,
        elapsedMs: performance.now() - started,
        illegalRejected: 0,
        reason: "verified-vcf",
      source: "verified-vcf" as const,
      principalVariation: tactical.principalVariation,
        candidates: first ? [{ move: { row: first.row, col: first.col }, score: 1_000_000, principalVariation: tactical.principalVariation }] : undefined,
      };
      const delay = Math.max(0, 220 - (performance.now() - started));
      setTimeout(() => self.postMessage(result), delay);
      return;
    }
  }
  const result = findBestMoveDetailed(board, event.data.player, {
    maxDepth: purpose === "think" ? 5 : 4,
    timeBudgetMs: purpose === "think" ? 1500 : 1000,
    width: purpose === "think" ? 12 : 8,
    rule,
  });
  const delay = Math.max(0, 220 - (performance.now() - started));
  setTimeout(() => self.postMessage(result), delay);
};
