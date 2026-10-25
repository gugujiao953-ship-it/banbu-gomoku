// Stable boundaries between generation phases.
//
// This module intentionally contains no search or board logic.  It gives the
// orchestrator names for lifecycle states and rejection reasons so a future
// constructor can be replaced without changing the proof/adapter contract.

export const GENERATION_PHASES = Object.freeze([
  'normalized-request',
  'search-plan',
  'constructed-candidate',
  'balanced-position',
  'exact-solution',
  'verified-puzzle',
  'exportable-artifact',
]);

// Keep these keys compatible with the existing proofs.json `rejected` object.
// New strategies may add details beside a count, but must use one of these
// stable buckets for aggregate reporting.
export const REJECTION_CODES = Object.freeze([
  'construction',
  'balance',
  'noWin',
  'shortcut',
  'solverBudget',
  'verifier',
  'duplicate',
  'nonunique',
  'shallow',
  'glyphNonessential',
  'glyphNonparticipating',
  'forbiddenNonessential',
  'shapeComplexity',
  'hardDifficulty',
  'secondLine',
  'decoyUnproven',
  'thinDecoys',
]);

// These are the fields emitted by the original generator.  Keeping the
// default ledger limited to them is part of the JSON compatibility contract;
// experimental reasons are added lazily when an experimental gate rejects a
// candidate.
const LEGACY_REJECTION_CODES = Object.freeze([
  'construction', 'balance', 'noWin', 'shortcut', 'solverBudget',
  'verifier', 'duplicate', 'nonunique', 'glyphNonessential',
  'glyphNonparticipating', 'forbiddenNonessential',
]);

export function createRejectionLedger() {
  return Object.fromEntries(LEGACY_REJECTION_CODES.map(code => [code, 0]));
}

export function recordRejection(ledger, code, amount = 1) {
  if (!ledger || !REJECTION_CODES.includes(code)) throw new Error(`Unknown rejection code: ${code}`);
  if (!Number.isInteger(amount) || amount < 1) throw new Error('Rejection amount must be a positive integer');
  ledger[code] = (ledger[code] || 0) + amount;
  return ledger[code];
}

export function phaseIndex(phase) {
  const index = GENERATION_PHASES.indexOf(phase);
  if (index < 0) throw new Error(`Unknown generation phase: ${phase}`);
  return index;
}

export function assertPhaseAdvance(previous, next) {
  if (phaseIndex(next) !== phaseIndex(previous) + 1) {
    throw new Error(`Invalid generation phase transition: ${previous} -> ${next}`);
  }
  return next;
}

// Any board mutation invalidates construction-time certificates. Return a new
// candidate value so callers cannot accidentally keep using the pre-mutation
// compact proof or cached solve. The reason is diagnostic-only and is not
// serialized into the legacy output.
export function invalidateCandidate(candidate, reason = 'board-mutated') {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('Candidate must be an object');
  }
  if (typeof reason !== 'string' || !reason) throw new Error('Invalid candidate invalidation reason');
  const next = { ...candidate };
  delete next.compact;
  delete next.proof;
  delete next.solution;
  delete next.winningFirst;
  delete next.canonicalKey;
  return next;
}

