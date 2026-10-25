import { verify } from '../verify.mjs';

export function verifyPuzzleDraft(puzzle, { verifyMs }, { guard, remainingTime }) {
  // Independent check, including a fresh D-1 search. Never downgrade it.
  guard.check();
  const check = verify(puzzle, { timeMs: remainingTime(verifyMs) });
  if (!check.valid) { return { ok: false, reason: 'verifier' }; }
  puzzle.verification = check;
  return { ok: true };
}
