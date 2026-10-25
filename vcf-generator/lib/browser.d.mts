import type { GeneratedPuzzle, MoveResult, ProofNode, SolutionMove } from '../../src/features/puzzle-generator/model';
export function generate(options: Record<string, unknown>): { puzzles: GeneratedPuzzle[]; attempts: number; status: string };
export function verify(puzzle: GeneratedPuzzle, options?: { timeMs?: number; nodeLimit?: number; checkShortest?: boolean }): { valid: boolean; status: string; error?: string };
export function evaluateMove(puzzle: GeneratedPuzzle, moves: SolutionMove[], proof: ProofNode | null, at: number): MoveResult;
