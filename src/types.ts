export type Player = "black" | "white";
export type RuleSet = "renju" | "standard" | "freestyle";
export interface Position { row: number; col: number }
export type BoardMarkKind = "circle" | "triangle" | "cross" | "label";
export interface BoardMark extends Position { kind: BoardMarkKind; label?: string }
export type NodeEvaluation = "good" | "bad" | "doubtful" | "interesting" | "forced" | "only" | "study";
export interface RecordNode {
  id: string; parentId: string | null; children: string[];
  move: (Position & { player: Player }) | null;
  comment: string; marks: BoardMark[]; preferredChildId?: string;
  /** Short text displayed with the position; exported as SGF N. */
  boardText?: string;
  /** Structured move/position judgement; standard values also map to SGF TE/BM/DO/IT. */
  evaluation?: NodeEvaluation;
  /** SGF emphasis level for TE/BM; mobile editing currently creates level 1. */
  evaluationLevel?: 1 | 2;
}
export interface GameMetadata {
  title: string; black: string; white: string; event: string; date: string;
  result: string; rule: RuleSet; boardSize: 15; tags: string[];
}
export interface GameDocument {
  id: string; version: 1; rootId: string; nodes: Record<string, RecordNode>;
  metadata: GameMetadata; createdAt: string; updatedAt: string;
}
export type Cell = Player | null;
export interface ImportResult { document: GameDocument; warnings: string[]; format: string }
