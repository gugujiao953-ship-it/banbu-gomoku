import type { GameMetadata } from "../../types";

/** Everything the panel needs to render a result row. Source-agnostic so a
 *  second source can be added without touching the UI. */
export interface OnlineGameSummary {
  /** Stable id within the source (used for de-duplication in the picker). */
  id: string;
  black: string;
  white: string;
  /** Raw result text as the source prints it, e.g. `1 : 0`. */
  result: string;
  date: string;
  event: string;
  round: string;
  ruleName: string;
  openingCode: string;
  moveCount?: number;
  url: string;
}

export interface OnlineSearchQuery {
  player1?: string;
  player2?: string;
  yearFrom?: string;
  yearTo?: string;
  ruleId?: string;
  openingId?: string;
  typeId?: string;
  tournamentId?: string;
  countryId?: string;
  minMoves?: string;
  maxMoves?: string;
}

export interface OnlineSearchResult {
  items: OnlineGameSummary[];
  total: number;
  page: number;
  pageCount: number;
  /** 翻页单位的中文名，给「加载更多（还有 N …）」用：renju.net 是「页」，
   *  励精连珠教室的赛事下钻是「轮」。缺省按「页」。 */
  pageUnit?: string;
}

export interface OnlineLookupEntry { id: string; name: string; detail: string }

/** 一个赛事条目（「最近赛事」用）。只列来源真能给出来的字段，不编造级别。 */
export interface OnlineTournamentSummary {
  id: string;
  name: string;
  place: string;
  dateFrom: string;
  dateTo: string;
  ruleName: string;
  rated: boolean;
}

export interface OnlineTournamentList {
  items: OnlineTournamentSummary[];
  total: number;
  page: number;
  pageCount: number;
}

export interface OnlineFetchedRecord {
  filename: string;
  sgf: string;
  url: string;
  /** Extra information the list row could not show (place, opening name …). */
  info: Partial<GameMetadata>;
}

export interface OnlineSource {
  id: string;
  label: string;
  homepage: string;
  /** Attribution line shown under the results: who owns the data. */
  credit: string;
  /** Honest limits, shown in the panel before the user starts downloading. */
  notes: string[];
  supports(query: "player" | "tournament"): boolean;
  search(query: OnlineSearchQuery, page: number): Promise<OnlineSearchResult>;
  fetchGame(summary: OnlineGameSummary): Promise<OnlineFetchedRecord>;
  lookup?(kind: "player" | "tournament", text: string): Promise<OnlineLookupEntry[]>;
  /** 「最近赛事」：来源的赛事清单。没有赛事索引的来源不实现即可，面板会隐藏该区块。 */
  listTournaments?(range: { yearFrom: string; yearTo: string; page: number }): Promise<OnlineTournamentList>;
  /** 展开某个赛事时取它的棋谱（同一套结果结构，便于复用选中/下载逻辑）。
   *  `page` 的语义由来源决定（renju.net 是结果页、励精连珠教室是轮次），
   *  用 `pageUnit` 告诉面板怎么称呼它。 */
  listTournamentGames?(tournamentId: string, page: number): Promise<OnlineSearchResult>;
  /** 「重大赛事」的判据必须由来源自己给：站点命名各语言不同，用英文关键词去筛中文赛事
   *  会把整张表清空（实测踩过）。不实现＝该来源不做级别筛选，面板也隐藏级别选择。 */
  isMajorEvent?(name: string): boolean;
}

/** 题库目录里的一个题集。题数与题型来自来源清单（自建题库的清单由用户自己写），
 *  清单没写就显示「未知 / 下载后可见」，不编造。 */
export interface OnlinePuzzleSetSummary {
  /** 稳定 id，同时也是去重键：题集文件的地址。 */
  id: string;
  title: string;
  /** 题型/归类：来源给的自由文本，筛选器的选项直接由出现过的值拼出来。 */
  category: string;
  /** 人读题型（与 category 同源，来源没给就是「未标注」）。 */
  typeLabel: string;
  /** 来源声明的题目数；没声明为 null。 */
  total: number | null;
  url: string;
}

export interface OnlinePuzzleSearchResult {
  items: OnlinePuzzleSetSummary[];
  total: number;
}

/** 取回并已按本应用口径规整过的题集：`text` 可直接交给题库导入器。 */
export interface OnlineFetchedPuzzleSet {
  filename: string;
  title: string;
  text: string;
  /** 来源给的条目数。 */
  total: number;
  /** 规整后能当题目做的数量。 */
  importable: number;
  /** 因解题模式本应用不支持而跳过的数量（选点题 / 选择题 / 封面）。 */
  unsupported: number;
  warnings: string[];
}

/** 题库来源：与棋谱来源分开，因为两者的检索单位（题集 vs 对局）和导入产物
 *  （PuzzleCollection vs GameDocument）都不一样，硬塞进一套接口只会互相将就。 */
export interface OnlinePuzzleSource {
  id: string;
  label: string;
  homepage: string;
  /** Attribution line shown under the results: who owns the data. */
  credit: string;
  /** Honest limits, shown in the panel before the user starts downloading. */
  notes: string[];
  /** 取回题集目录。必须由用户动作触发，打开面板本身零请求。 */
  listSets(): Promise<OnlinePuzzleSearchResult>;
  /** 取回一个题集并规整成本应用题库能直接导入的 JSON 文本。 */
  fetchSet(set: OnlinePuzzleSetSummary): Promise<OnlineFetchedPuzzleSet>;
}

/** 一次在线导入的结果。棋谱与题库共用一套字段，题库相关的几项可选。 */
export interface OnlineImportOutcome {
  inserted: number;
  duplicates: number;
  failures: Array<{ name: string; reason: string }>;
  /** 题库导入：本次写入 / 更新的题集数。 */
  puzzleSets?: number;
  updatedSets?: number;
  /** 题库导入：写入的题目总数。 */
  puzzleCount?: number;
  /** 题库导入：来源侧如实记下的说明（跳过了哪类题、哪些坐标越界等）。 */
  notes?: string[];
}
