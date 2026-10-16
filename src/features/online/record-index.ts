/**
 * 在线「棋手检索」的**自有目录**层（用户 09-26：搜索棋手不要一点就跳走，先在应用里
 * 给出棋手和他的对局，点了某一条才打开浏览器网页）。
 *
 * 为什么要自建一份目录：能按棋手检索的站点里，renju.net 的 robots 对未列名客户端是
 * `Disallow: /`、条款也禁止库内容用于任何在线系统（见 `sources.ts`），励精连珠教室
 * 没有服务端检索接口（见 `ljrenju.ts`）。也就是说**没有任何一个站允许我们把「某棋手的
 * 全部对局」抓回来列给用户**。所以这一面的数据只可能来自我们自己整理的一份目录。
 *
 * 目录**打进包里**（`record-index-data.ts`，由 `scripts/build-record-index.mjs` 生成），
 * 不是运行时去取的文件：上一版放成 `public/online/record-index.json` 让网页版去 fetch，
 * 只要那个文件在对方环境里取不到（旧预缓存、还没部署到该文件），检索就永远出不来结果。
 * 打进包里还顺带解决了离线首次安装、以及加载态/失败态的一整类分支。
 *
 * 但**不进启动主包**：目录从 09-28 起收录了 18 届世界锦标赛的正赛对局（一千多局），
 * 静态引就会把这坨字节压到首屏上。所以这里用 `loadRecordIndex()` 动态 import——
 * 与 R87 对手册正文做的事一模一样：Service Worker 的预缓存按「所有 js 文件」全量收录，
 * 分片自动进离线清单，离线打开照样能搜。（注释里不写那个 glob 的字面量：
 * 它含「星号斜杠」，会提前把这段块注释关掉。）
 *
 * 目录里存的是**事实 + 链接**：谁对谁、哪一届、哪一轮、结果如何，以及这一局在来源站的
 * 网页地址。走子内容一个字都不进这份目录——那属于来源的内容，要看得由用户点跳转去
 * 对方站点看。对局**只存一份**（`RECORD_INDEX_GAMES`），棋手身上挂的是下标：同一局挂在
 * 黑白两人名下会把字节数翻倍（一千局就是两百 KB 的白付）。链接不存字符串，由下面的
 * `playerLinks()` 现拼。
 *
 * 一个输入框同时查两类东西（用户 09-26：「两个搜索占空间，来源合并，搜到后显示是哪个
 * 来源的哪个东西」）：**棋手**与**赛事**。每条结果都带着它是谁、在哪一届、来自哪个站。
 * 定位与别名表（`player-aliases.ts`）一致：**辅助而非权威**。表里有的就列出来，没有的
 * 就如实说「目录里还没有」并给一条到来源站检索的跳转，绝不猜、绝不编对局。
 */
import { peopleSearchUrlFor } from "./renju-net";
import { lookupPlayerAliasIn, type PlayerAlias } from "./player-aliases";
import type { RawIndexGame, RawIndexPlayer } from "./record-index-data";

export interface IndexGameEntry {
  black: string;
  white: string;
  /** 赛事名：来源怎么写就怎么写，不做二次加工。 */
  event: string;
  year: string;
  /** 结果原样存文本（"黑胜" / "1:0" / "和"），来源没给就留空。 */
  result: string;
  url: string;
  /** 可选补充：轮次、台号、开局名等，来源给了才填。 */
  note?: string;
  /** 这一局是从哪个站看到的（合并来源后，界面上每条都要能回答「这是哪来的」）。 */
  source: string;
}

export interface IndexLink { label: string; url: string }

export interface IndexPlayerEntry {
  name: string;
  latin: string[];
  games: IndexGameEntry[];
  links: IndexLink[];
}

/** 目录里出现过的一个赛事（按赛事名搜时的结果单位）。 */
export interface IndexEventEntry {
  name: string;
  year: string;
  source: string;
  games: IndexGameEntry[];
}

/** 一份可用的目录（加载完成后交给界面与检索函数）。 */
export interface RecordIndex {
  updated: string;
  credit: string;
  players: IndexPlayerEntry[];
  events: IndexEventEntry[];
  /** 对局总条数（去重后的一份，用于状态行）。 */
  gameCount: number;
}

const LJRENJU_ORIGIN = "https://www.ljrenju.com";
/** 史记索引：励精按国家/年份归档的中文赛事档案入口（本项目实测可浏览）。 */
const LJRENJU_INDEX_URL = `${LJRENJU_ORIGIN}/news/index.htm`;
/** 棋手资料页：国内棋手等级分与名录（2026-09-26 浏览器实测该页在）。 */
const LJRENJU_PLAYERS_URL = `${LJRENJU_ORIGIN}/player/index.htm`;

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
/** 名字归一：小写、去标点、按词排序后拼接——来源站写 "Smetanin Petr"，别名表可能写
 *  "Petr Smetanin"，只比字符串会漏掉；比对不出同一人的宁可少挂（不猜）。 */
const nameKey = (value: string) => norm(String(value || "").replace(/[.,'’\-]/g, " ")).split(" ").filter(Boolean).sort().join(" ");

/**
 * 一位棋手的入口链接。
 *
 * renju.net 那一条走**棋手检索页**（`/people/search?name=<拉丁名>`，2026-09-28 真站核实：
 * 给它 `cao dong` 会回「1 player found」并列出 `/people/100069/`）。
 * ⚠ 不要拼 `/game/search?player1=<名字>`——那个参数要的是站内数字 id，填名字会被站点判成
 * `[404] Page not found`（404 页上还带着一张空棋盘，用户 09-28 就是看到这个）。
 * 励精那两条是本站实测可浏览的档案入口（史记索引 / 棋手名录）。
 */
export const playerLinks = (entry: Pick<IndexPlayerEntry, "name" | "latin">): IndexLink[] => {
  const query = norm(entry.latin[0] || entry.name);
  return [
    { label: "在 renju.net 检索他的名字", url: peopleSearchUrlFor(query) },
    { label: "在连珠史记里按赛事找他的棋谱", url: LJRENJU_INDEX_URL },
    { label: "在连珠棋手名录里看他", url: LJRENJU_PLAYERS_URL },
  ];
};

/**
 * 把生成器写出的两份表（棋手 + 去重后的对局表）组装成界面要用的目录。
 * 单独导出是为了让单测能喂自己的一份小数据，不必依赖打包里的那一千多条。
 */
export const buildRecordIndex = (rawPlayers: RawIndexPlayer[], rawGames: RawIndexGame[], updated: string, credit: string): RecordIndex => {
  const games: IndexGameEntry[] = rawGames.map((game) => ({ ...game }));
  const players = rawPlayers.map((raw) => ({
    name: raw.name,
    latin: raw.latin,
    // 下标越界（手改过数据、生成器与包不同步）时丢掉那一条，不让整份目录崩掉。
    games: (raw.games || []).map((index) => games[index]).filter(Boolean),
    links: playerLinks(raw),
  }));
  const byKey = new Map<string, IndexEventEntry>();
  for (const game of games) {
    const key = `${game.event}|${game.year}`;
    const found = byKey.get(key);
    if (found) found.games.push(game);
    else byKey.set(key, { name: game.event, year: game.year, source: game.source, games: [game] });
  }
  const events = [...byKey.values()].sort((a, b) => Number(b.year) - Number(a.year) || b.games.length - a.games.length);
  return { updated, credit, players, events, gameCount: games.length };
};

let indexPromise: Promise<RecordIndex> | null = null;

/**
 * 懒加载目录分片（只加载一次，之后复用同一份）。
 *
 * ⚠ 为什么动态 import：09-28 起目录里有 18 届世界锦标赛的正赛对局（一千多局、上百 KB），
 * 静态引会把它们压进启动主包。分片由 Service Worker 的预缓存全量收录（它的 glob 覆盖所有
 * js 文件），离线也能用（R87 手册分片已经验证过这条路径安全）。
 */
export const loadRecordIndex = (): Promise<RecordIndex> => {
  if (!indexPromise) {
    indexPromise = import("./record-index-data")
      .then((data) => buildRecordIndex(data.RECORD_INDEX_PLAYERS, data.RECORD_INDEX_GAMES, data.RECORD_INDEX_UPDATED, data.RECORD_INDEX_CREDIT))
      .catch((error) => { indexPromise = null; throw error; });
  }
  return indexPromise;
};

/**
 * 一次检索同时给两类结果：棋手（本名 / 各种写法命中）与赛事（赛事名命中）。
 *   · 中文名先过别名表（`player-aliases.ts`）：用户输「中村茂」也该命中 latin 写着
 *     "Nakamura Shigeru" 的那条。
 *   · 命中口径从严到宽：完全相等 → 前缀 → 子串，同一档里按名长短排。
 *   · 两类都空时界面如实说「目录里还没有」，并给一条到来源站检索的跳转。
 */
export const searchRecordIndex = (index: RecordIndex, text: string, aliases: PlayerAlias[] = []): { players: IndexPlayerEntry[]; events: IndexEventEntry[] } => {
  const wanted = norm(text);
  if (!wanted) return { players: [], events: [] };
  const candidates = [wanted];
  const alias = lookupPlayerAliasIn(aliases, wanted);
  if (alias) candidates.push(...alias.latin.map(norm).filter(Boolean));
  const scored: Array<{ entry: IndexPlayerEntry; score: number }> = [];
  for (const entry of index.players) {
    if (!norm(entry.name)) continue;
    const names = [entry.name, ...entry.latin].map(norm).filter(Boolean);
    let score = 3;
    for (const query of candidates) {
      if (!query) continue;
      for (const name of names) {
        if (name === query) score = Math.min(score, 0);
        else if (name.startsWith(query) || query.startsWith(name)) score = Math.min(score, 1);
        else if (name.includes(query) || query.includes(name)) score = Math.min(score, 2);
      }
    }
    if (score < 3) scored.push({ entry, score });
  }
  const players = scored.sort((a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length).map((item) => item.entry);
  const events = index.events.filter((event) => candidates.some((query) => norm(event.name).includes(query) || query.includes(norm(event.name)) || norm(`${event.name}${event.year}`).includes(query)));
  return { players, events };
};

/** 一位棋手在目录里能列出的对局（没有 games 时返回空，界面会退化成只给入口链接）。 */
export const indexGames = (entry: IndexPlayerEntry): IndexGameEntry[] => (entry.games || []).filter((game) => game && game.url);

/** 目录里出现过的赛事（按年份新→旧、局数多→少）。挂在 index.events 上，这里只是给旧调用一个名字。 */
export const recordIndexEvents = (index: RecordIndex): IndexEventEntry[] => index.events;

/** 名字归一化口径对外共享一份（生成器与检索必须一致，否则「挂不到人身上」）。 */
export const recordIndexNameKey = nameKey;
