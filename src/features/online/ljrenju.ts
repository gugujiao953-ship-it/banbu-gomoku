/**
 * 励精连珠教室（ljrenju.com，石玲维护的中文连珠站）作为一个浏览式来源。
 *
 * 与 renju.net 的分工：那边是「按棋手/赛事检索」的国际官方库；这边是**中文赛事档案**
 * （连珠史记：chn/rif/jpn/kor/est… 按国家+年份归档，赛事名是中文），所以它只提供
 * 浏览（赛事 → 轮次 → 棋谱），没有服务端检索，`supports()` 一律 false——面板会据此
 * 把检索区收起来。
 *
 * 站点形态（实测 2026-09-15）：
 *   news/index.htm            连珠史记索引：290 个赛事链接，目录名自带国家+年份（rif2026/…）
 *   news/<dir>/<slug>.htm     赛事某一轮的页面：一页多局，每局一个
 *                             `pb-rawstring="h8 h9 i8 …"`（空格分隔的走子坐标）+ 棋手表 + 台号
 *   站内混编码：首页是 GBK、news 页是 UTF-8 → 用共用的 decodeText（先 UTF-8 再 gb18030）。
 *
 * 最大的好处：**走子就在列表页里**，所以取一局不需要额外请求，批量下载对站点几乎无压力。
 * 坐标口径与 renju.net 相同（列字母 + 自下而上的行号）：row = 15 - 数字、col = 字母 - 97。
 */
import type { GameMetadata, Position } from "../../types";
import { fetchOnlineText } from "./online-http";
import { buildSgfFromMoves, safeFilenamePart, sgfResultValue } from "./sgf-text";
import type { OnlineFetchedRecord, OnlineGameSummary, OnlineSearchResult, OnlineSource, OnlineTournamentList, OnlineTournamentSummary } from "./types";

export const LJRENJU_ORIGIN = "https://www.ljrenju.com";
const INDEX_PATH = "/news/index.htm";
const PAGE_SIZE = 40;
/** 一页最多解析多少局：个别轮次页会很长（一页几十局），设个上限防止一次吃太多。 */
const MAX_GAMES_PER_PAGE = 120;

const decodeEntities = (value: string) => value
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

const stripScripts = (html: string) => html.replace(/<(script|style)[^>]*>[\s\S]*?<\/>/gi, " ");
const text = (value: string) => decodeEntities(stripScripts(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** `h9` → { row: 15 - 9, col: 8 }；站内坐标与 renju.net 同口径（行号自下而上）。 */
export const parseLjRenjuPoint = (token: string): Position | null => {
  const match = token.trim().toLowerCase().match(/^([a-o])(\d{1,2})$/);
  if (!match) return null;
  const col = match[1].charCodeAt(0) - 97;
  const row = 15 - Number(match[2]);
  return row >= 0 && row < 15 && col >= 0 && col < 15 ? { row, col } : null;
};

export const parseLjRenjuMoves = (raw: string): Position[] =>
  raw.split(/\s+/).map(parseLjRenjuPoint).filter((point): point is Position => Boolean(point));

/** 索引页里的目录名带国家+年份：`rif2026` → 2026。 */
export const yearFromLjRenjuPath = (path: string) => Number(path.match(/[a-z]{3}(\d{4})\//i)?.[1] ?? 0);

export interface LjRenjuEvent { url: string; name: string; year: number }

/** 国内分站：`cn11bej.htm`（北京市）、`cncall.htm`（国家体育总局棋牌运动管理中心）、
 *  `cmsg.htm`（中国智力运动大会）。这些页里再列该地区历届赛事。 */
export const isLjRenjuChinaIndex = (path: string) => /^cn[a-z0-9]{2,}\.htm[l]?$/i.test(path);

/** 连珠史记索引里「赛事条」是 `<a href="rif2026/wc18.htm">名称</a>`（国家码+年份目录），
 *  与之并列的还有国内分站 `<a href="cn11bej.htm">北京市</a>`。这里只取国际赛事条。 */
export const parseLjRenjuIndex = (html: string): LjRenjuEvent[] => {
  const events: LjRenjuEvent[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a[^>]*href="([a-z]{3}\d{4}\/[^"]+\.htm[l]?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const path = match[1];
    const name = text(match[2]);
    // 只留赛事页：索引用的是相对路径，且标题必须是有内容的赛事名（导航链接被过滤掉）。
    // 索引页里的年份表头（"2026年"）、纯数字标题都不是赛事，别混进列表。
    if (!name || name.length < 3 || /^\d{4}\s*年?$/.test(name) || seen.has(path)) continue;
    seen.add(path);
    events.push({ url: `${LJRENJU_ORIGIN}/news/${path}`, name, year: yearFromLjRenjuPath(path) });
  }
  return events.sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, "zh"));
};

export interface LjRenjuGame extends OnlineGameSummary { moves: string }

export interface LjRenjuEventLink { url: string; name: string; year: number }

/** 国内分站页（如 cn11bej.htm）里列的下辖赛事：链接形如 `cnbej2026/bej5.htm`（第五届）。
 *  这类页面**多数只有成绩表、没有棋谱**，所以解析出的条目要带上 hasGames 让界面如实标注。 */
export const parseLjRenjuRegionPage = (html: string, baseUrl: string): LjRenjuEventLink[] => {
  const base = baseUrl.replace(/[^/]*$/, "");
  const events: LjRenjuEventLink[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a[^>]*href="((?:cn|rif|jpn|kor|rus|est|swe)[a-z0-9]*\/[^"]+\.htm[l]?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const path = match[1];
    const name = text(match[2]);
    if (!name || name.length < 2 || seen.has(path)) continue;
    seen.add(path);
    const url = new URL(path, base).href;
    events.push({ url, name, year: yearFromLjRenjuPath(path) });
  }
  return events;
};

/** 该页有没有棋谱（`pb-rawstring` 是我们解析走子的可靠标记）。 */
export const ljRenjuPageHasGames = (html: string) => html.includes("pb-rawstring");

/** 一页里可能有多个组/轮次（D组 第九轮），games 会各自带上自己的轮次文字。 */
export const parseLjRenjuRoundPage = (html: string, sourceUrl: string): { title: string; groups: string[]; games: LjRenjuGame[] } => {
  const title = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  // 页面顶部的组别+轮次（如 "D组 第九轮"）：这是这一页所有对局的轮次。
  const centered = [...stripScripts(html).matchAll(/<p[^>]*align="center"[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => text(match[1]));
  const pageRound = centered.find((line) => line.length > 1 && line.length < 40 && /[轮組组決决]/.test(line)) || "";
  // 每局 = 一张棋手表 + 紧跟其后的 pb-rawstring 走子容器。两者必须在同一个单元格里，
  // 所以按「表 + 最多 600 字符内的 rawstring」成对匹配，避免把上一局的表配到下一局的走子。
  const pattern = /<table class="text">([\s\S]*?)<\/table>([\s\S]{0,600}?)pb-rawstring="([^"]*)"/gi;
  const games: LjRenjuGame[] = [];
  for (const match of html.matchAll(pattern)) {
    const table = match[1];
    const raw = match[3];
    const moves = parseLjRenjuMoves(raw);
    if (moves.length < 2) continue;
    const black = text(table.match(/黑:\s*<\/b>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "");
    const white = text(table.match(/白:\s*<\/b>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "");
    if (!black || !white) continue;
    const boardRow = text(table.match(/第\s*(\d+)\s*台/i)?.[0] ?? "");
    const scores = [...table.matchAll(/<td[^>]*align="right"[^>]*width="25"[^>]*>\s*([\d.]+)\s*<\/td>/gi)].map((item) => item[1]);
    const result = scores.length >= 2 ? (scores[0] === scores[1] ? "0 : 0" : Number(scores[0]) > Number(scores[1]) ? "1 : 0" : "0 : 1") : "";
    const id = `${moves.length}-${black}-${white}-${moves[0].row}${moves[0].col}`.replace(/\s+/g, "_");
    games.push({
      id,
      black,
      white,
      result,
      date: "",
      event: title,
      // 轮次是页面级的（"D组 第九轮"）：面板按 round 分组就是「赛事 → 轮次 → 棋谱」。
      // 台号不能并进来——每局台号都不同，并进来会变成「一组一局」的空壳嵌套。
      round: pageRound || boardRow,
      ruleName: "",
      openingCode: "",
      moveCount: moves.length,
      url: sourceUrl,
      moves: raw,
    });
    if (games.length >= MAX_GAMES_PER_PAGE) break;
  }
  const groups = [...new Set(games.map((game) => game.round).filter(Boolean))];
  return { title, groups, games };
};

export const buildLjRenjuGameList = (html: string, sourceUrl: string, eventName: string): OnlineSearchResult => {
  const parsed = parseLjRenjuRoundPage(html, sourceUrl);
  const group = text(html.match(/<p align="center"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
  const items = parsed.games.map((game) => ({ ...game, event: eventName || parsed.title }));
  return { items, total: items.length, page: 1, pageCount: 1 };
};

/** 赛事页（如 rif2025/wc18.htm）本身没有棋谱，只是各轮的目录：链接形如 `wc18qtr1.htm`。
 *  解析出各轮页的绝对地址，顺序即轮次顺序。 */
export const parseLjRenjuRoundLinks = (html: string, eventUrl: string): string[] => {
  const base = eventUrl.replace(/[^/]*$/, "");
  const rounds: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/href="([^"#?]+\.htm[l]?)"/gi)) {
    const href = match[1];
    // 只认同目录下的纯文件名：站点的导航里有 `../../intro/r0.htm` 这种带路径的链接，
    // 它同样匹配 rN 的形状，会把「棋手介绍」当成一轮棋谱混进来。
    if (href.includes("/")) continue;
    // 轮次页的命名是 <赛事前缀>rN.htm（wc18qtr1 = 四分之一决赛第1轮、wryc7dr9 = 第9轮），
    // 所以 rN 出现在文件名中间，不能用 `(^|\/)r` 这种锚点去匹配。
    if (!/r\d+\.htm/i.test(href)) continue;
    const absolute = new URL(href, base).href;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    rounds.push(absolute);
  }
  return rounds;
};

/** 赛事页只取一次：轮次目录 + 赛事名，后续每轮的请求都要用它。 */
const eventCache = new Map<string, { rounds: string[]; name: string }>();
export const resetLjRenjuCache = () => eventCache.clear();
const loadEvent = async (eventUrl: string) => {
  const cached = eventCache.get(eventUrl);
  if (cached) return cached;
  const html = await fetchOnlineText(eventUrl, { label: "赛事目录" });
  const name = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const entry = { rounds: parseLjRenjuRoundLinks(html, eventUrl), name };
  eventCache.set(eventUrl, entry);
  return entry;
};

export const LJRENJU_SOURCE: OnlineSource = {
  id: "ljrenju",
  label: "励精连珠教室 · ljrenju.com",
  homepage: LJRENJU_ORIGIN,
  credit: "棋谱数据来自励精连珠教室（ljrenju.com），中文连珠赛事档案，版权归原作者所有，仅供个人打谱研究。",
  notes: [
    "中文赛事档案（连珠史记）：按国家/年份归档，赛事名与棋手名都是站上原文",
    "只能按赛事浏览：这里没有服务端检索；按棋手找对局用上面「棋手名」那一步（读我们自己的目录），没记到的人那里会给一条去来源站检索的入口",
    "每一行都是「点了才在浏览器打开该页」：本应用不再把这里的棋谱取回本机看，也不下载入库",
    "走子就内嵌在轮次页里，所以列出一轮棋谱只需要取那一页（一次点击一页，不并发、不预取）",
    "站点是人工维护的老站，页面更新不频繁；赛事是否收录取决于站长",
  ],
  // 没有服务端检索：面板会据此收起检索区，只留「最近赛事」浏览。
  supports: () => false,
  async search() {
    throw new Error("励精连珠教室只能按赛事浏览；本应用已不提供按棋手/赛事检索的来源");
  },
  async fetchGame(summary) {
    const moves = parseLjRenjuMoves((summary as LjRenjuGame).moves || "");
    const header: Array<[string, string]> = [
      ["GM", "4"], ["FF", "4"], ["CA", "UTF-8"], ["AP", "RenjuNote:1.0"], ["SZ", "15"],
      ["GN", `${summary.black} - ${summary.white}`],
      ["PB", summary.black], ["PW", summary.white],
      ["EV", summary.event],
      ["RO", summary.round],
      ["RE", sgfResultValue(summary.result)],
      ["SO", summary.url],
    ];
    const info: Partial<GameMetadata> = {
      event: summary.event || undefined,
      round: summary.round || undefined,
      sourceUrl: summary.url,
    };
    const filename = `ljrenju-${safeFilenamePart(summary.black) || "black"}-vs-${safeFilenamePart(summary.white) || "white"}.sgf`;
    return { filename, sgf: buildSgfFromMoves(header, moves), url: summary.url, info } satisfies OnlineFetchedRecord;
  },
  async listTournaments(range): Promise<OnlineTournamentList> {
    const html = await fetchOnlineText(`${LJRENJU_ORIGIN}${INDEX_PATH}`, { label: "连珠史记索引" });
    const from = Number(range.yearFrom) || 0;
    const to = Number(range.yearTo) || 9999;
    // 国际赛事条（rif2026/wc18.htm 这种）+ 国内分站（cn11bej.htm 北京市…）。
    // 国内赛事的棋谱这个站基本没有（只有成绩表），但赛事名要能列出来——
    // 用户明确要求「多收国内的」，看得见才有意义；点开会如实说明有没有棋谱。
    const events = parseLjRenjuIndex(html).filter((event) => event.year >= from && event.year <= to);
    const chinaRoots = [...new Set([...html.matchAll(/href="(cn[a-z0-9]{2,}\.htm[l]?)"/gi)].map((match) => match[1]))];
    const china = chinaRoots.map((path) => ({
      url: new URL(path, `${LJRENJU_ORIGIN}/news/`).href,
      name: text(html.match(new RegExp(`<a[^>]*href="${path}"[^>]*>([\\s\\S]*?)</a>`, "i"))?.[1] ?? ""),
      year: 0,
    })).filter((event) => event.name);
    const merged = [
      ...china.map((event) => ({ ...event, name: `🇨🇳 ${event.name}` })),
      ...events.map((event) => ({ ...event, name: event.name })),
    ];
    const pageCount = Math.max(1, Math.ceil(merged.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, range.page), pageCount);
    const slice = merged.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const items: OnlineTournamentSummary[] = slice.map((event) => ({
      id: event.url,
      name: event.name,
      place: "",
      dateFrom: event.year ? String(event.year) : "",
      dateTo: event.year ? String(event.year) : "",
      ruleName: "",
      rated: false,
    }));
    return { items, total: merged.length, page, pageCount };
  },
  /** page = 第几轮（站点的赛事页是各轮的目录，一页一轮）。 */
  async listTournamentGames(tournamentId, page): Promise<OnlineSearchResult> {
    const event = await loadEvent(tournamentId);
    // 国内分站页（cn11bej 北京市…）：页里列的是历届赛事而不是轮次，且多数只有成绩表。
    // 这里把它们当成「一场一场」列出来，点开任一场再由上面那层继续解析。
    if (!event.rounds.length && isLjRenjuChinaIndex(new URL(tournamentId).pathname.split("/").pop() || "")) {
      const html = await fetchOnlineText(tournamentId, { label: "地区赛事" });
      const links = parseLjRenjuRegionPage(html, tournamentId);
      const items: OnlineGameSummary[] = links.map((link) => ({
        id: link.url,
        black: link.name,
        white: "",
        result: "",
        date: link.year ? String(link.year) : "",
        event: event.name,
        round: "",
        ruleName: "",
        openingCode: "",
        moveCount: 0,
        url: link.url,
      }));
      return { items, total: items.length, page: 1, pageCount: 1, pageUnit: "轮" };
    }
    // 有些索引条目本身就是轮次页（没有子轮次）→ 把它自己当作唯一一轮。
    const rounds = event.rounds.length ? event.rounds : [tournamentId];
    const index = Math.min(Math.max(1, page || 1), rounds.length);
    const target = rounds[index - 1];
    const html = await fetchOnlineText(target, { label: "赛事棋谱" });
    const list = buildLjRenjuGameList(html, target, event.name);
    return { ...list, page: index, pageCount: rounds.length, pageUnit: "轮" };
  },
};
