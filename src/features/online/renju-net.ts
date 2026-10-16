/**
 * renju.net (RIF, the international renju federation) as an online record source.
 *
 * The site is server-rendered HTML with three useful endpoints:
 *   /media/people.json?query=      player picker (JSON)
 *   /media/tournaments.json?query= tournament picker (JSON)
 *   /game/search?...&p=N           result list, 100 games per page
 *   /tournament/<tid>/game/<gid>/  one game: the move list lives in the
 *                                  `game` attribute of the board element
 *
 * Coordinate contract (verified against the site's own board.js, which renders
 * rows from 15 down to 1 and names cells `<column letter><row number>`): the
 * number counts from the bottom, so a stone's internal row index is `15 - n`.
 * That matches this app's POS reader in formats.ts. Columns are `a`..`o`.
 *
 * robots.txt on this host disallows generic crawlers, so this adapter is built
 * for user-driven lookups only: requests are spaced out by the transport layer,
 * results are cached for the session, and nothing here walks the database.
 * Each game also carries its source URL so the record keeps its provenance.
 */
import type { GameMetadata, Position } from "../../types";
import { fetchOnlineText } from "./online-http";
import { RENJU_OPENINGS, renjuOpeningByCode, renjuOpeningCodeForId, renjuOpeningLabel, renjuOpeningRuleFor, renjuRuleSetFor } from "./renju-reference";
import type { OnlineFetchedRecord, OnlineGameSummary, OnlineLookupEntry, OnlineSearchQuery, OnlineSearchResult, OnlineSource, OnlineTournamentList, OnlineTournamentSummary } from "./types";

export const RENJU_NET_ORIGIN = "https://www.renju.net";
const SEARCH_PATH = "/game/search";
/** 棋手**按名字**检索页（2026-09-28 真站核实：`/people/search?name=cao%20dong` → 200，
 *  页面写「1 player found」并给出 `/people/100069/` 这样的结果行）。
 *
 * ⚠ 给用户跳「看某个棋手」只能走这条路，**不要**用 `/game/search?player1=<名字>`：
 *  那个 `player1` 要的是站内的**数字 person id**（表单里 `player1` 是个 `<select>`，
 *  页面上那个「Search by name」输入框先把名字换成 id 再提交），填名字站点会回一张
 *  `[404] Page not found` —— 而那张 404 页上正好带着一个空棋盘，用户 09-28 报的
 *  「跳转后不是搜索时的界面，而是一个 404 的空棋盘界面」就是它。
 *  （`searchUrlFor` 仍然保留：应用内抓取那条路传的是真实字段——数字 id、年份等。） */
const PEOPLE_SEARCH_PATH = "/people/search";
/** 名字统一成小写单空格再拼：站点自己也会 302 到小写，直接给小写少一次跳转。 */
export const peopleSearchUrlFor = (name: string) =>
  `${RENJU_NET_ORIGIN}${PEOPLE_SEARCH_PATH}?name=${encodeURIComponent(String(name || "").trim().toLowerCase().replace(/\s+/g, " "))}`;
export const RENJU_NET_PAGE_SIZE = 100;

const decodeEntities = (value: string) => value
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

const text = (value: string) => decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const attribute = (tag: string, name: string) => {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? "") : "";
};

export interface RenjuNetGameListRow extends OnlineGameSummary {
  tournamentId: string;
  gameId: string;
}

/** Parses the results list plus the total/page controls.
 *  The page carries a statistics table that also uses `class="gamelist"`, so
 *  rows are selected by their content (a game link plus two player links)
 *  rather than by position. */
export const parseRenjuNetSearchPage = (html: string, page = 1): OnlineSearchResult => {
  const total = Number(html.match(/([\d,]+)\s*games?\s+found/i)?.[1]?.replace(/,/g, "") ?? 0);
  // 结果列表每行只有「黑白/结果/日期」，没有赛事名——但**筛选了某个赛事时整页都属于它**，
  // 面板要按赛事分组展示，所以这里把正在筛的赛事名（启用中的 tournament 选项）带上。
  const activeTournament = html.match(/<option[^>]*value="(\d+)"[^>]*selected[^>]*>([^<]*)</i)
    || html.match(/<select[^>]*name="tournament"[\s\S]*?<option[^>]*value="(\d+)"[^>]*>([^<]*)</i);
  const activeTournamentName = activeTournament ? decodeEntities(activeTournament[2]).trim() : "";
  const items: RenjuNetGameListRow[] = [];
  for (const table of html.matchAll(/<table class="gamelist">([\s\S]*?)<\/table>/gi)) {
    for (const row of table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
      const body = row[1];
      const link = body.match(/href="([^"]*?\/game\/(\d+)\/)"[^>]*>([^<]*)</i);
      if (!link) continue;
      const people = [...body.matchAll(/href="\/people\/(\d+)\/">([^<]*)</g)];
      if (people.length < 2) continue;
      const dateCell = [...body.matchAll(/<td[^>]*class=['"][^'"]*num[^'"]*['"][^>]*>([^<]*)<\/td>/gi)].map((cell) => cell[1].trim());
      const href = link[1].startsWith("/") ? link[1] : `/${link[1]}`;
      items.push({
        id: link[2],
        gameId: link[2],
        tournamentId: href.match(/\/tournament\/(\d+)\//)?.[1] ?? "",
        black: decodeEntities(people[0][2]).trim(),
        white: decodeEntities(people[1][2]).trim(),
        result: text(link[3]),
        date: dateCell[dateCell.length - 1] || "",
        event: activeTournamentName,
        round: "",
        ruleName: "",
        openingCode: "",
        url: `${RENJU_NET_ORIGIN}${href}`,
      });
    }
  }
  const pageNumbers = [...html.matchAll(/[?&]p=(\d+)/g)].map((match) => Number(match[1]));
  const pageCount = Math.max(page, ...pageNumbers, 1);
  return { items, total, page, pageCount };
};

export interface RenjuNetGameDetail {
  black: string;
  white: string;
  blackResult: string;
  whiteResult: string;
  event: string;
  tournamentId: string;
  round: string;
  ruleName: string;
  openingCode: string;
  swap: string;
  alter: string;
  /** Raw `game` attribute exactly as published. */
  rawMoves: string;
  /** Alternative 5th moves offered by the swap rules, when present. */
  rawAlters: string;
  moves: Position[];
  publishedBy: string;
  publishedAt: string;
}

/** RIF coordinate string (`h8h9h6`, and `h8 h9` in older records) -> positions. */
export const parseRenjuNetMoves = (raw: string): Position[] => {
  const normalized = raw.replace(/[\s,;]+/g, "").toLowerCase();
  return [...normalized.matchAll(/([a-o])(1[0-5]|[1-9])/g)].map((match) => ({
    col: match[1].charCodeAt(0) - 97,
    row: 15 - Number(match[2]),
  }));
};

export const parseRenjuNetGamePage = (html: string): RenjuNetGameDetail => {
  const boardTag = html.match(/<div[^>]*class="[^"]*renjuboardbbcode[^"]*"[^>]*>/i)?.[0] ?? "";
  const rawMoves = attribute(boardTag, "game");
  if (!rawMoves) throw new Error("该棋谱没有公开着法记录，无法下载");
  const heading = text(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
  // The anchor tag wraps its href onto the next line, so the gap must allow whitespace.
  const participants = [...html.matchAll(/<a\s+href="\/people\/(\d+)\/"[^>]*>([^<]*)<\/a>/g)].map((match) => decodeEntities(match[2]).trim()).filter(Boolean);
  const detailRow = html.match(/<th>\s*R\s*<\/th>[\s\S]*?<\/tr>\s*<tr>([\s\S]*?)<\/tr>/i)?.[1] ?? "";
  const cells = [...detailRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => text(match[1]));
  const results = [...html.matchAll(/<td class="(?:win|loss|draw)"[^>]*>([^<]*)<\/td>/gi)].map((match) => match[1].trim().toLowerCase());
  const tournamentLink = html.match(/<th colspan="5">\s*<a href="\/tournament\/(\d+)\/">([^<]*)<\/a>/i);
  const published = html.match(/Published by\s+([\s\S]{1,80}?)\s+at\s+([\d:.\- ]+)/i);
  // Two player rows: the first is black, the second white. The page heading is
  // the fallback when a player has been removed from the people database.
  const names = participants.length >= 2 ? participants : heading.split(/\s+-\s+/);
  return {
    black: names[0]?.trim() || "黑方",
    white: names[1]?.trim() || "白方",
    blackResult: results[0] || "",
    whiteResult: results[1] || "",
    event: tournamentLink ? decodeEntities(tournamentLink[2]).trim() : "",
    tournamentId: tournamentLink?.[1] ?? "",
    round: cells[0] || "",
    ruleName: cells[1] || "",
    openingCode: (cells[2] || "").toLowerCase(),
    swap: cells[3] || "",
    alter: cells[4] || "",
    rawMoves,
    rawAlters: attribute(boardTag, "alters"),
    moves: parseRenjuNetMoves(rawMoves),
    publishedBy: published ? text(published[1]) : "",
    publishedAt: published ? published[2].trim() : "",
  };
};

export interface RenjuNetTournament {
  id: string;
  name: string;
  place: string;
  ruleName: string;
  rated: string;
  dateFrom: string;
  dateTo: string;
}

export const parseRenjuNetTournamentPage = (html: string, id = ""): RenjuNetTournament => {
  const name = text(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
  // Fields are written as <p><b>Place:</b> …</p>, and Rule/Rated share one
  // paragraph, so each capture stops at the next bold label or the paragraph end.
  const field = (label: string) => {
    const match = html.match(new RegExp(`<b>\\s*${label}:\\s*</b>([\\s\\S]*?)(?=<b>|</p>|</td>|$)`, "i"));
    return match ? text(match[1]) : "";
  };
  const rawDate = field("Date");
  const [dateFrom = "", dateTo = ""] = rawDate.split(/\s+-\s+/).map((part) => part.trim());
  return { id, name, place: field("Place"), ruleName: field("Rule"), rated: field("Rated"), dateFrom, dateTo: dateTo || dateFrom };
};

/** RIF result text -> SGF RE value. */
export const renjuNetResultValue = (result: string) => {
  const compact = result.replace(/\s+/g, "");
  if (compact === "1:0") return "B+";
  if (compact === "0:1") return "W+";
  if (compact === "0.5:0.5" || compact === "0:0") return "0";
  return result.trim();
};

const sgfEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
const sgfPoint = ({ row, col }: Position) => `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`;

const safeFilenamePart = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export interface RenjuNetSgfInput {
  detail: RenjuNetGameDetail;
  /** Raw result text from the result list (`1 : 0`); the detail page only has
   *  Win/Loss words, so the list value is preferred when it is available. */
  result?: string;
  date: string;
  sourceUrl: string;
  tournament?: RenjuNetTournament | null;
}

export const buildRenjuNetSgf = ({ detail, result, date, sourceUrl, tournament }: RenjuNetSgfInput) => {
  const opening = renjuOpeningByCode(detail.openingCode);
  const rawResult = result
    || (detail.blackResult === "win" ? "1 : 0" : detail.whiteResult === "win" ? "0 : 1" : detail.blackResult === "draw" ? "0.5 : 0.5" : "");
  const properties: Array<[string, string]> = [
    ["GM", "4"], ["FF", "4"], ["CA", "UTF-8"], ["AP", "RenjuNote:1.0"], ["SZ", "15"],
    ["GN", `${detail.black} - ${detail.white}`],
    ["PB", detail.black], ["PW", detail.white],
    // DT must not be empty: the importer treats a missing date as "today".
    ["DT", date || tournament?.dateFrom || ""],
    ["EV", tournament?.name || detail.event],
    ["RE", renjuNetResultValue(rawResult)],
    // RU keeps the source's own wording. The importer understands both
    // RU[Renju]/RU[Gomoku] vocabulary and explicit keywords, so no semantic
    // guess is baked into the file here.
    ["RU", detail.ruleName],
    ["RO", detail.round],
    ["PC", tournament?.place || ""],
    ["ON", opening ? `${opening.zhName}（${opening.code}）` : detail.openingCode ? renjuOpeningLabel(detail.openingCode) : ""],
    ["SO", sourceUrl],
  ];
  const header = properties.filter(([, value]) => value !== "").map(([key, value]) => `${key}[${sgfEscape(value)}]`).join("");
  const moves = detail.moves.map((move, index) => `${index % 2 === 0 ? "B" : "W"}[${sgfPoint(move)}]`).join("");
  return `(;${header}${moves})`;
};

const lookup = async (path: string, text_: string, label: string): Promise<OnlineLookupEntry[]> => {
  const payload = await fetchOnlineText(`${RENJU_NET_ORIGIN}${path}?query=${encodeURIComponent(text_)}&escape=1`, { label });
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(`${label}返回了无法解析的结果`);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 20).map((entry) => {
    const row = Array.isArray(entry) ? entry : [];
    const [id, name, detail] = row as [unknown, unknown, unknown];
    return { id: String(id ?? ""), name: String(name ?? ""), detail: String(detail ?? "") };
  }).filter((entry) => entry.id && entry.name);
};

/** 赛事检索走站点自己的 /tournament/search?name=——它按子串匹配赛事名，
 *  比 /media/tournaments.json（联想限定词表）更适合「我知道赛事名叫什么」的场景。 */
const tournamentLookup = async (text_: string): Promise<OnlineLookupEntry[]> => {
  const name = text_.trim();
  if (name.length < 2) return [];
  const html = await fetchOnlineText(tournamentLookupUrlFor(name), { label: "赛事检索" });
  return parseRenjuNetTournamentList(html, 1).items.slice(0, 20).map((item) => ({
    id: item.id,
    name: item.name,
    detail: [item.dateFrom, item.place].filter(Boolean).join(" · "),
  }));
};

/** Tournament pages carry the place and the date range; one fetch is reused for
 *  every game taken from the same tournament. */
const tournamentCache = new Map<string, RenjuNetTournament | null>();

const loadTournament = async (tournamentId: string): Promise<RenjuNetTournament | null> => {
  if (!tournamentId) return null;
  if (tournamentCache.has(tournamentId)) return tournamentCache.get(tournamentId) ?? null;
  try {
    const html = await fetchOnlineText(`${RENJU_NET_ORIGIN}/tournament/${tournamentId}/`, { label: "赛事信息" });
    const tournament = parseRenjuNetTournamentPage(html, tournamentId);
    tournamentCache.set(tournamentId, tournament);
    return tournament;
  } catch {
    // Place/date enrichment is optional: the game itself is still complete.
    tournamentCache.set(tournamentId, null);
    return null;
  }
};

export const resetRenjuNetCaches = () => tournamentCache.clear();

/** 赛事清单端点：/tournament/search 支持 name / year_from / year_to 等筛选。 */
const TOURNAMENT_SEARCH_PATH = "/tournament/search";

export const tournamentListUrlFor = (range: { yearFrom: string; yearTo: string; page: number }) => {
  const params = new URLSearchParams();
  if (range.yearFrom) params.set("year_from", range.yearFrom);
  if (range.yearTo) params.set("year_to", range.yearTo);
  if (range.page > 1) params.set("p", String(range.page));
  return `${RENJU_NET_ORIGIN}${TOURNAMENT_SEARCH_PATH}?${params.toString()}`;
};

/** 按名字找赛事（「名字」栏输入的不是棋手时走这条路）。 */
export const tournamentLookupUrlFor = (name: string) =>
  `${RENJU_NET_ORIGIN}${TOURNAMENT_SEARCH_PATH}?name=${encodeURIComponent(name)}`;

/** 重大赛事的判据。来源没有级别字段，只能按赛事名筛，但**必须中英一起认**——
 *  只按英文关键词筛会把中文赛事（灵峰杯、全国五子棋锦标赛…）整批漏掉，那是实测踩过的坑。
 *
 *  收录：世界级（世锦赛/世界杯/世团赛）、国家级（中国全国赛、各省市冠军赛、灵峰杯一类
 *  国内公开赛与杯赛，以及日/韩/俄/爱沙尼亚等传统连珠强国的国家级赛事）。
 *  排除：地区性/洲际的小比赛（欧洲各站公开赛、北欧、斯堪的纳维亚、地方俱乐部赛等），
 *  除非它同时命中世界级或国家级词。青少年/女子等分项保留——它们是正式成人组之外的
 *  正式项目，不是「地区小赛」。 */
/** 注意必须带 `i`：站点赛事名首字母大写（World / Championship），没有 `i` 时
 *  所有英文赛事都匹配不到——这正是「重大赛事里一个都没有」的直接原因之一。 */
const WORLD_EVENT_PATTERN = /world|世界|世界杯|世锦赛|世团赛|olympiad|wch|twc|ywc|wc\d|international|国际/i;
/** 国家级/全国性：中英两套。`championship` 单独出现时只在带「国家名」词时才收（见 isMajorRenjuEvent）。 */
const NATIONAL_EVENT_PATTERN = /china|chinese|beijing|shanghai|tianjin|chongqing|province|national|全国|中国|中华|省市|灵峰|锦标赛|冠军赛|大师赛|名人|棋王|公开赛|杯赛|团体赛|联赛|甲级|乙级|[^\u4e00-\u9fff]cup\b/i;
/** 传统连珠强国：它们的国家级赛事等同于「全国级」，不算地区小赛。
 *  注意 meijin/title 这类词在日文标题里常写成汉字（名人戦），所以中英都要认。 */
const STRONG_RENJU_COUNTRY_PATTERN = /japan|japanese|korea|korean|russia|russian|estonia|estonian|jpn|kor|rus|est|日本|韩国|俄罗斯|爱沙尼亚|連珠|连珠社|名人戦|名人战|王座|棋聖|棋圣|title match/i;
/** 洲际锦标赛（欧洲/亚洲/美洲）：是正式洲际级别、常作世锦赛资格赛，收；
 *  区别于「某国公开赛」这类地区站点赛。 */
const CONTINENTAL_CHAMPIONSHIP_PATTERN = /\b(?:european|asian|pan[- ]?american|african|oceanian)\s+(?:championship|cup)|欧洲锦标赛|亚洲锦标赛|泛美锦标赛/i;
/** 地区性/洲际小赛：北欧、波罗的海、中欧各站站点赛、地方俱乐部赛，以及「某国公开赛」。
 *  注意**不能**把 european championship 放进来——那是洲际锦标赛（见上一条）。 */
const REGIONAL_EVENT_PATTERN = /scandinavian|nordic|baltic|uppsala|upsala|prague|tallinn|vilnius|riga|győr|gyor|piškohraní|piskohrani|region|regional|local|club|瑞典|挪威|芬兰|丹麦|匈牙利|捷克|波罗的海|北欧|地区|地方|俱乐部/;
/** 「某国 + open/cup」这类站点赛：`Swedish Open`、`Polish Open`、`Baltic Cup`…属于地区性站点赛。 */
const COUNTRY_OPEN_PATTERN = /\b(swedish|polish|czech|hungarian|latvian|lithuanian|armenian|croatian|serbian|slovak|slovenian|austrian|dutch|belgian|french|german|italian|spanish|portuguese|british|american|canadian|brazilian|turkish|israeli|indian|thai|singapore|malaysian|indonesian|australian|baltic|nordic|scandinavian)\s+(?:open|cup|championship)/i;

/** 只写「锦标赛」而不带国家/世界限定的，无法判断级别——按不收录处理（宁缺毋滥）。 */
const GENERIC_CHAMPIONSHIP = /championship|锦标赛|冠军赛/i;

export const isMajorRenjuEvent = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return false;
  // 顺序很关键：先世界级，再洲际锦标赛，再挡地区站点赛，最后才轮到国家级。
  if (WORLD_EVENT_PATTERN.test(trimmed)) return true;
  if (CONTINENTAL_CHAMPIONSHIP_PATTERN.test(trimmed) && !COUNTRY_OPEN_PATTERN.test(trimmed)) return true;
  // 「瑞典公开赛」「波罗的海杯」这类地区站点赛：带 open/cup 但不是国家级。
  if (COUNTRY_OPEN_PATTERN.test(trimmed)) return false;
  if (REGIONAL_EVENT_PATTERN.test(trimmed)) return false;
  // 国家级：命中「国家/组织/杯赛/公开赛/联赛」这类限定词就收（灵峰杯、全国锦标赛、中国公开赛……）。
  if (NATIONAL_EVENT_PATTERN.test(trimmed)) return true;
  if (STRONG_RENJU_COUNTRY_PATTERN.test(trimmed)) return true;
  // 剩下只有裸「championship/锦标赛」的，级别不明，不收（避免把某市某俱乐部赛混进来）。
  if (GENERIC_CHAMPIONSHIP.test(trimmed)) return false;
  return false;
};

/** 解析 /tournament/search 的列表。行形如：
 *  `<h5><a href="/tournament/3619/">名称</a></h5><p>地点</p><p>日期, <a>规则</a>, Rated</p>` */
export const parseRenjuNetTournamentList = (html: string, page = 1): OnlineTournamentList => {
  const items: OnlineTournamentSummary[] = [];
  for (const row of html.matchAll(/<h5[^>]*>\s*<a href="\/tournament\/(\d+)\/">([\s\S]*?)<\/a>\s*<\/h5>([\s\S]{0,400}?)(?=<h5|<\/table>|<\/td>)/gi)) {
    const id = row[1];
    const name = text(row[2]);
    if (!id || !name) continue;
    const tail = row[3];
    // 注意：页面里日期的那个 <p> 是**没有闭合**的（只有地点那段有 </p>），所以按「下一个
    // <p / </p / 结束」切段，不能按 </p> 切——按后者会只拿到地点、日期和规则全丢。
    const paragraphs = [...tail.matchAll(/<p[^>]*>([\s\S]*?)(?=<\/p>|<p[^>]*>|$)/gi)].map((match) => text(match[1]));
    const place = paragraphs[0] || "";
    const detail = paragraphs.find((line) => /\d{4}-\d{2}-\d{2}/.test(line)) || "";
    const dates = detail.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
    const ruleLink = tail.match(/\/rule\/\d+\/">([^<]*)</i);
    items.push({
      id,
      name,
      place,
      dateFrom: dates?.[1] || "",
      dateTo: dates?.[2] || dates?.[1] || "",
      ruleName: ruleLink ? decodeEntities(ruleLink[1]).trim() : "",
      rated: /\bRated\b/i.test(detail),
    });
  }
  const pageNumbers = [...html.matchAll(/[?&]p=(\d+)/g)].map((match) => Number(match[1]));
  const totalMatch = html.match(/([\d,]+)\s*tournaments?\s+found/i);
  return {
    items,
    total: Number(totalMatch?.[1]?.replace(/,/g, "") ?? items.length),
    page,
    pageCount: Math.max(page, ...pageNumbers, 1),
  };
};

export const searchUrlFor = (query: OnlineSearchQuery, page: number) => {
  const params = new URLSearchParams();
  if (query.player1) params.set("player1", query.player1);
  if (query.player2) params.set("player2", query.player2);
  if (query.yearFrom) params.set("year_from", query.yearFrom);
  if (query.yearTo) params.set("year_to", query.yearTo);
  if (query.minMoves) params.set("n_moves", query.minMoves);
  if (query.maxMoves) params.set("max_n_moves", query.maxMoves);
  if (query.ruleId) params.set("rule", query.ruleId);
  if (query.openingId) params.set("opening", query.openingId);
  if (query.typeId) params.set("type", query.typeId);
  if (query.tournamentId) params.set("tournament", query.tournamentId);
  if (query.countryId) params.set("country", query.countryId);
  if (page > 1) params.set("p", String(page));
  return `${RENJU_NET_ORIGIN}${SEARCH_PATH}${params.size ? `?${params.toString()}` : ""}`;
};

export const RENJU_NET_SOURCE: OnlineSource = {
  id: "renju-net",
  label: "RIF 国际连珠联盟 · renju.net",
  homepage: RENJU_NET_ORIGIN,
  credit: "棋谱数据来自国际连珠联盟（RIF）官方数据库 renju.net，版权归原作者所有，仅供个人打谱研究。",
  notes: [
    "官方赛事棋谱库，含棋手、赛事、规则与开局名",
    "棋手可用中文名搜（应用内自动翻成站点的拉丁写法），也可直接输拼音/英文名",
    "赛事列表只有日期没有轮次，轮次在单局下载后写进棋谱信息",
    "每页 100 局，下载时逐局取回并自动间隔请求",
    "renju.net 未开放跨域访问：安卓应用内可直接下载，网页版需在设置里填写代理地址",
  ],
  supports: (query) => query === "player" || query === "tournament",
  async search(query, page) {
    const url = searchUrlFor(query, page);
    const html = await fetchOnlineText(url, { label: "棋谱检索" });
    const result = parseRenjuNetSearchPage(html, page);
    if (!result.items.length && result.total === 0) return result;
    return result;
  },
  async fetchGame(summary) {
    const html = await fetchOnlineText(summary.url, { label: "棋谱页面" });
    const detail = parseRenjuNetGamePage(html);
    const tournamentId = detail.tournamentId || summary.url.match(/\/tournament\/(\d+)\//)?.[1] || "";
    const tournament = await loadTournament(tournamentId);
    const sgf = buildRenjuNetSgf({ detail, result: summary.result, date: summary.date, sourceUrl: summary.url, tournament });
    const name = `${safeFilenamePart(detail.black) || "black"}-vs-${safeFilenamePart(detail.white) || "white"}`;
    const opening = renjuOpeningByCode(detail.openingCode);
    const info: Partial<GameMetadata> = {
      event: tournament?.name || detail.event || summary.event,
      place: tournament?.place || undefined,
      round: detail.round || undefined,
      openingName: opening ? `${opening.zhName}（${detail.openingCode}）` : undefined,
      ruleText: detail.ruleName || undefined,
      // Resolved from the federation's own rule table: the RIF name is free
      // text and cannot be mapped by keyword matching.
      rule: renjuRuleSetFor(detail.ruleName),
      openingRule: renjuOpeningRuleFor(detail.ruleName),
      sourceUrl: summary.url,
    };
    return { filename: `renju-${summary.id}-${name}.sgf`, sgf, url: summary.url, info } satisfies OnlineFetchedRecord;
  },
  lookup: (kind, value) => kind === "player"
    ? lookup("/media/people.json", value, "棋手检索")
    : tournamentLookup(value),
  async listTournaments(range) {
    const html = await fetchOnlineText(tournamentListUrlFor(range), { label: "赛事清单" });
    return parseRenjuNetTournamentList(html, range.page);
  },
  async listTournamentGames(tournamentId, page) {
    // 赛事页本身不带棋谱，站点自己的入口是「棋谱检索 + tournament 参数」。
    const html = await fetchOnlineText(searchUrlFor({ tournamentId }, page), { label: "赛事棋谱" });
    return parseRenjuNetSearchPage(html, page);
  },
  isMajorEvent: isMajorRenjuEvent,
};

/** Exposed so the picker can label the opening filter exactly like the site. */
export const renjuOpeningOptions = () => RENJU_OPENINGS.map((opening, index) => ({ id: String(index + 1), label: `${opening.zhName}（${opening.code}）` }));

export { renjuOpeningCodeForId };
