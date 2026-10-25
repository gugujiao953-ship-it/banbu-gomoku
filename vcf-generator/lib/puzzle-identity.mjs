// The canonical hash identifies only the diagram (including symmetry). Rules
// belong to the playable puzzle: the same cells can have different solutions.
// Keep historical Renju IDs stable so saved collections still deduplicate.
export function generatedPuzzleId(canonicalHash, rules) {
  return 'synth-' + canonicalHash.slice(0, 16) + (rules === 'freestyle' ? '-freestyle' : '');
}
