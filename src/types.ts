export type Player = "black" | "white";
export type RuleSet = "renju" | "standard" | "freestyle";
export interface Position { row: number; col: number }
export type BoardMarkKind = "circle" | "triangle" | "cross" | "label";
export type BoardMarkStyle = "text" | "circle" | "triangle" | "cross";
export type RenLibSemantic = "good" | "bad" | "special" | "unknown";
export type RenLibDisplayKind = "text" | "black-dot" | "white-dot" | "blue-dot" | "neutral-dot";
export interface RenLibDisplayMark { rawText?: string; rawMark?: number | string; rawColor?: string | number; semantic: RenLibSemantic; displayKind: RenLibDisplayKind; displayText?: string; }
export interface BoardMark extends Position { kind: BoardMarkKind; label?: string; style?: BoardMarkStyle; color?: string }
export interface BoardSetup { black: Position[]; white: Position[]; empty: Position[]; nextPlayer?: Player }
export type NodeEvaluation = "good" | "bad" | "doubtful" | "interesting" | "forced" | "only" | "study";
export type PartialRecordNode = Partial<Pick<RecordNode, "comment" | "marks" | "preferredChildId" | "boardText" | "evaluation" | "evaluationLevel" | "move" | "anchor" | "setup" | "passPlayer">>;
export interface RecordNode {
  id: string; parentId: string | null; children: string[];
  move: (Position & { player: Player }) | null;
  /** SGF setup properties alter a position without counting as a turn. */
  setup?: BoardSetup;
  /** SGF B[] / W[] consumes a turn without placing a stone. */
  passPlayer?: Player;
  /** RenLib can store a non-move node carrying a board-text/comment anchor. */
  anchor?: Position;
  comment: string; marks: BoardMark[]; preferredChildId?: string;
  /** Short text displayed with the position; exported as SGF N. */
  boardText?: string;
  /** Structured move/position judgement; standard values also map to SGF TE/BM/DO/IT. */
  evaluation?: NodeEvaluation;
  /** SGF emphasis level for TE/BM; mobile editing currently creates level 1. */
  evaluationLevel?: 1 | 2;
  /** RenLib node-level flags; these are not board-shape marks. */
  renLibMark?: boolean;
  startPosition?: boolean;
}
export interface GameMetadata {
  title: string; black: string; white: string; event: string; date: string;
  result: string; rule: RuleSet; boardSize: 15; tags: string[];
}
export interface GameDocument {
  id: string; version: 1; rootId: string; nodes: Record<string, RecordNode>;
  metadata: GameMetadata; createdAt: string; updatedAt: string; savedCurrentId?: string;
}
export interface CompactRenLibDraftNode {
  id: string; parent: number; firstChild: number; nextSibling: number; childCount: number;
  preferredChild: number; move: (Position & { player: Player }) | null; anchor?: Position;
  comment: string; boardText?: string; marks: BoardMark[]; evaluation?: NodeEvaluation;
  evaluationLevel?: 1 | 2; renLibMark?: boolean; startPosition?: boolean;
  setup?: BoardSetup; passPlayer?: Player;
}
export interface CompactRenLibDraft {
  rootId: string; nodes: CompactRenLibDraftNode[]; texts?: string[];
}
export interface CompactRenLibIndex {
  version: 2;
  nodeCount: number;
  rootId: string;
  ids: string[];
  parent: Int32Array;
  firstChild: Int32Array;
  nextSibling: Int32Array;
  childCount?: Int32Array;
  preferredChild?: Int32Array;
  moveCode: Uint16Array;
  state: Uint8Array;
  textRefs: Int32Array;
  texts: string[];
  anchorCode: Uint16Array;
  evaluation: Int8Array;
  evaluationLevel: Uint8Array;
  markRefs: Int32Array;
  marks: BoardMark[];
  setupRefs?: Int32Array;
  setups?: BoardSetup[];
}
export type Cell = Player | null;
export interface ImportStats { nodeCount: number; edgeCount: number; branchCount: number; maxChildren: number; maxDepth: number }
export interface ImportResult { document: GameDocument; additionalDocuments?: GameDocument[]; warnings: string[]; format: string; stats?: ImportStats; compactIndex?: CompactRenLibIndex }
