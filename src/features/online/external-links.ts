import { RENJU_NET_ORIGIN, peopleSearchUrlFor, tournamentListUrlFor, tournamentLookupUrlFor } from "./renju-net";

/**
 * 「在线棋谱」的**跳转入口**（只给链接、永不抓取）。
 *
 * 用户 09-26：这里原来还带一个自己的检索框（`EXTERNAL_SEARCH`，两个按钮分别落到棋手 /
 * 赛事检索页），与在线面顶上的检索框重复，已删——检索只留那一个，它同时查棋手与赛事，
 * 查不到时由结果自己给出「到来源站检索」的链接（用的就是下面的 URL 构造器）。
 *
 * 现在只有 renju.net 走这条路：它的 robots 对未列名客户端 `Disallow: /`、条款也禁止把库内容
 * 用于任何网站或在线系统，所以只拼 URL 把用户送过去，我们不抓取、不缓存、不落库。
 * （励精连珠教室已改为应用内浏览：它在 `ONLINE_GAME_SOURCES` 里，不再属于本模块。）
 * 细节与恢复步骤见 `sources.ts`。
 *
 * ⚠️ 这些理由**只留在代码里**（用户 09-19：「用户没必要知道这个，你就说可以跳转到网站就行了」）：
 * 界面上只说「点入口跳转到来源网站查看局面」，外加一行署名。所以本模块导出的都是
 * 「能直接上屏的短文案」，不导出任何合规论述。
 *
 * 实现纪律：本模块**只允许纯字符串拼接**（下面的 builder 都是 `renju-net.ts` 里的纯函数），
 * 任何 fetch/网络代码都不许进来——`qa/online-library-check.mjs` 有「零请求」断言盯着。
 */
export interface ExternalEntryLink {
  label: string;
  url: string;
  /** 归属哪个来源，用于在界面上标注或分组。 */
  sourceId: string;
}

export interface ExternalSourceInfo {
  id: string;
  label: string;
  origin: string;
  /** 署名一行（谁的数据、内容是什么）。 */
  credit: string;
}

/**
 * 按棋手检索：落到对方站点自己的**棋手检索结果页**（`/people/search?name=…`，2026-09-28 真站核实）。
 *
 * ⚠ 以前这里拼的是 `/game/search?player1=<名字>`，看着像「按棋手搜棋谱」，实际那个参数要的是
 * 站内数字 id，填名字会被站点判成 `[404] Page not found`（那页上还带着一张空棋盘）——
 * 用户 09-28 报的「跳转后是个 404 的空棋盘界面」。改成棋手检索页：给它名字，它列出对得上的人，
 * 用户点进那个人的资料页/棋谱页，比直接猜一个 id 或摆一张 404 都诚实。
 */
export const buildExternalPlayerSearchUrl = (query: string) => peopleSearchUrlFor(query);

/** 按赛事名检索：落到对方站点的赛事检索页（`/tournament/search?name=…`）。 */
export const buildExternalEventSearchUrl = (query: string) => tournamentLookupUrlFor(query.trim());

/** 赛事档案（按年份列出）——不填关键词时的默认去处。 */
export const buildExternalArchiveUrl = (year = new Date().getFullYear()) =>
  tournamentListUrlFor({ yearFrom: String(year), yearTo: String(year), page: 1 });

export const EXTERNAL_SOURCES: ExternalSourceInfo[] = [
  {
    id: "renju-net",
    label: "RIF 国际连珠联盟 · renju.net",
    origin: RENJU_NET_ORIGIN,
    credit: "国际赛事棋谱库，含棋手、赛事、规则与开局名",
  },
];

/** 跳转入口：两个来源的入口**放在同一条列表里**（用户 09-19：不要分两块面板）。 */
export const EXTERNAL_ENTRY_LINKS: ExternalEntryLink[] = [
  { label: "赛事档案（今年）", url: buildExternalArchiveUrl(), sourceId: "renju-net" },
  { label: "全部赛事检索", url: `${RENJU_NET_ORIGIN}/tournament/search`, sourceId: "renju-net" },
];
