export type Player = "black" | "white";
export type RuleSet = "renju" | "standard" | "freestyle";
export type OpeningRule = "free" | "swap1" | "swap2" | "swap3" | "five-two" | "five-n" | "yamaguchi" | "soosyrv-8" | "taraguchi-10" | "tarannikov";
export type RecordSourceFormat = "sgf" | "fgf" | "ren" | "renjs" | "wzq" | "json" | "renju" | "pos" | "txt" | "psq" | "lib" | "dp" | "db";
export interface Position { row: number; col: number }
/** 标注的语义类别：决定导出成哪个 SGF 属性（circle→CR、triangle→TR、square→SQ、
 *  cross/check→MA、label→LB）。形状与语义分开，是因为同一个语义可以有多种画法
 *  （实心/空心），而别的软件只认语义。 */
export type BoardMarkKind = "circle" | "triangle" | "square" | "cross" | "check" | "label";
/** 标注的画法。实心类（*-solid）只影响我们这边的观感，导出时按语义类别降级。 */
export type BoardMarkStyle = "text" | "circle" | "circle-solid" | "triangle" | "triangle-solid" | "square-solid" | "diamond" | "cross" | "check" | "star" | "sun" | "moon";
export type RenLibSemantic = "good" | "bad" | "special" | "unknown";
export type RenLibDisplayKind = "text" | "black-dot" | "white-dot" | "blue-dot" | "neutral-dot";
export interface RenLibDisplayMark { rawText?: string; rawMark?: number | string; rawColor?: string | number; semantic: RenLibSemantic; displayKind: RenLibDisplayKind; displayText?: string; }
export type NativeAnnotationKind = "one-line-comment" | "multi-line-comment" | "board-text" | "mark" | "unknown";
/** Native RenLib content. The decoded text is for display; raw metadata is kept
 * so a future exporter can round-trip extensions without guessing semantics. */
export interface NativeAnnotation {
  kind: NativeAnnotationKind;
  text?: string;
  rawBytes?: Uint8Array;
  sourceOffset?: number;
  encoding?: string;
}
export interface BoardMark extends Position { kind: BoardMarkKind; label?: string; style?: BoardMarkStyle; color?: string; nativeSymmetry?: boolean; renLibNativeLabel?: boolean }
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
  /** RenLib-native annotations are kept separately from the editable fields. */
  renLibAnnotations?: NativeAnnotation[];
  renLibFlags?: number;
  renLibExtendedFlags?: number;
  /** Short text displayed with the position; exported as SGF N. */
  boardText?: string;
  /** Raw label returned by the webpage RenLib core; never reinterpret as a user mark. */
  renLibNativeLabel?: boolean;
  renLibLabelColor?: string;
  /** Structured move/position judgement; standard values also map to SGF TE/BM/DO/IT. */
  evaluation?: NodeEvaluation;
  /** SGF emphasis level for TE/BM; mobile editing currently creates level 1. */
  evaluationLevel?: 1 | 2;
  /** RenLib node-level flags; these are not board-shape marks. */
  renLibMark?: boolean;
  startPosition?: boolean;
  /**
   * 懒加载数据源（DP/DB 局面数据库）里「这个局面还有几支子节点没查回来」。
   * 树上会画成一行「还有 N 支未加载」（点一下才读取），不能当成「分支末端」。
   * 只记数量、不给每支都造一个占位节点——造占位节点会让投影从几百个膨胀到上万个
   * （实测 900 个已加载局面 → 11023 个节点、58.6ms，走一步就卡）。普通棋谱不使用。
   */
  unloadedChildren?: number;
}
export interface GameMetadata {
  title: string; black: string; white: string; event: string; date: string;
  result: string; rule: RuleSet; boardSize: number; tags: string[];
  /** Optional because records created before opening-rule support must remain readable. */
  openingRule?: OpeningRule;
  openingN?: number;
  /** Full game-information properties (SGF RO/PC/BR/WR/KM/TM/OT/AN/CP/ON/US/SO).
   * All optional: records saved before these fields existed must stay readable,
   * and an empty value must never be written back as an empty SGF property. */
  round?: string;
  place?: string;
  blackRank?: string;
  whiteRank?: string;
  komi?: string;
  timeLimit?: string;
  overtime?: string;
  /** Opening name in words (SGF ON), e.g. 瑞星 / 花月. Distinct from openingRule. */
  openingName?: string;
  annotator?: string;
  copyright?: string;
  /** Where this record was obtained, e.g. an online database page. */
  sourceUrl?: string;
  /** Original rule text as written by the source when it does not map onto RuleSet. */
  ruleText?: string;
  /** Original record format, used only to choose an honest direct-export path. */
  sourceFormat?: RecordSourceFormat;
  sourceFileName?: string;
}
export interface GameDocument {
  id: string; version: 1; rootId: string; nodes: Record<string, RecordNode>;
  metadata: GameMetadata; createdAt: string; updatedAt: string; savedCurrentId?: string;
  /**
   * 这份棋谱**只是来源的一部分**——`nodes` 里只有「已经读回来的」那部分局面。
   *
   * 谁会置它：懒加载源（DP/DB 局面库、RenLib 网页核心读的 .lib）的投影，
   * 以及按需窗口的大型棋谱。它们的未读分支只以 `RecordNode.unloadedChildren`
   * 记数量、没有节点（见 dp-projection.ts 的说明）。
   *
   * 为什么要落成**文档上的普通布尔字段**（2026-10-11 P5）：早先各功能靠
   * `isDpDatabaseView(document)` 这类**不可枚举的 Symbol 标记**判断，而
   * `createEditableViewCopy`（在懒加载谱上做任何编辑都会自动生成「编辑副本」）
   * 是对象展开、**刻意不让那些 Symbol 跨过去**（它们只对原会话有意义），
   * 于是副本的 `unloadedChildren` 还在、却不再被认作不完整 ⇒ 同型局面、查找、
   * 复制分支这些功能会拿子集当全谱给结论。布尔字段会随展开自然带过去，
   * 语义也对：副本继承的正是这份「不完整」。
   */
  partial?: boolean;
}
export interface CompactRenLibDraftNode {
  id: string; parent: number; firstChild: number; nextSibling: number; childCount: number;
  preferredChild: number; move: (Position & { player: Player }) | null; anchor?: Position;
  comment: string; boardText?: string; marks: BoardMark[]; evaluation?: NodeEvaluation;
  renLibAnnotations?: NativeAnnotation[]; renLibFlags?: number; renLibExtendedFlags?: number;
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
  /** Generated RenLib IDs use this prefix; ids may then contain only rootId. */
  idPrefix?: string;
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
  annotationRefs: Int32Array;
  annotations: NativeAnnotation[];
  renLibFlags: Uint8Array;
  renLibExtendedFlags: Uint32Array;
  setupRefs?: Int32Array;
  setups?: BoardSetup[];
}
export type Cell = Player | null;
export interface ImportStats { nodeCount: number; edgeCount: number; branchCount: number; maxChildren: number; maxDepth: number }
export interface ImportResult { document: GameDocument; additionalDocuments?: GameDocument[]; warnings: string[]; format: string; stats?: ImportStats; compactIndex?: CompactRenLibIndex }
