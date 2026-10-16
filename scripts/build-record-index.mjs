/**
 * 生成 `src/features/online/record-index-data.ts`——在线「棋手检索」用的自有目录（打进包里，见
 * `src/features/online/record-index.ts` 顶上的说明：能按棋手查的站点都不允许我们把
 * 它的库内容抓回来列给用户，所以这一面只能读我们自己整理的一份目录）。
 *
 * 跑法：`node scripts/build-record-index.mjs`
 *
 * 数据来源只有两处，**都不含推测**：
 *   1. `public/online/player-aliases.json` —— 本项目 09-15 整理并人工核对过的
 *      「棋手中文名 ↔ 来源站拉丁写法」表（124 人）。
 *   2. 对局清单两份，形状相同，都按「页面地址 + 页面上原文成对的 黑 - 白」记录：
 *      · `scripts/record-index-sources.json` —— 人工逐页打开核实过的页面（09-26 那批）；
 *      · `scripts/record-index-sources.generated.json` —— `scripts/fetch-world-championship-sources.mjs`
 *        逐页读下来的历届世界连珠锦标赛轮次页（09-28 起）。每条都留着页面地址，抽查时按地址回原页对。
 *      这一步把「目录里的人」和「能直接点开的对局」接起来；对局条目的 url 一律是清单里那个页面地址。
 *
 * ⚠ 棋手的**入口链接不在这里生成**：由 `record-index.ts` 的 `playerLinks()` 运行时现拼
 *   （省掉大半体积，也避免这份数据里存着一批没人复核过的 URL——上一版就是在这里把
 *   `game/search?player1=<名字>` 当成正确形状写进了数据，而那个参数其实要站内数字 id，
 *   用户点进去看到的是对方站的一张 404 空棋盘页）。
 *
 * 刻意不做的事：不编年份、不编赛果、不替用户补「他大概参加过哪些比赛」。清单页面上没有
 * 胜负分（励精的轮次页只给对手与走子），这些条目的 result 就留空。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const LJRENJU_SOURCE_LABEL = "励精连珠教室 · 连珠史记";
const OUTPUT = "src/features/online/record-index-data.ts";
/** 对局上限：再多就不是「给棋手补几届赛事」而是把整个档案塞进包里了。按年份从新到旧取。 */
const MAX_GAMES = 2600;

/** 名字归一：小写、去标点、按词排序后拼接——来源站写 "Smetanin Petr"，别名表可能写
 *  "Petr Smetanin"，只比字符串会漏掉。比对不出同一人的宁可少挂（不猜）。
 *  ⚠ 这个口径与 `record-index.ts` 里的 nameKey 必须一致（那边导出为 recordIndexNameKey）。 */
const nameKey = (value) => String(value || "")
  .replace(/&nbsp;/gi, " ")
  .toLowerCase()
  .replace(/[.,'’\-]/g, " ")
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(" ");

/**
 * 抓取清单里的赛事名是链接文字「第18届」——那是 wcall.htm（**世界连珠锦标赛**总页）下面的一届，
 * 补全成「第18届世界连珠锦标赛」是照站点自己的层级，不是编名字；补全后它才能和 09-26 那批
 * 人工核实的同名赛事并成一组（否则界面上会同时出现「第18届」与「第18届世界连珠锦标赛」
 * 两个看起来不一样的假赛事）。轮次名里同样去掉重复的届名前缀（行上已经写着赛事名）。
 */
const eventNameOf = (entry) => (/^第\d+届$/.test(entry.event) ? `${entry.event}世界连珠锦标赛` : entry.event);
const noteOf = (page) => String(page.stage || "").replace(/^第\d+届\s*/, "").trim();

/** 从一份清单读出对局：每条都是页面上原文的「黑 - 白」顺序（黑方在前，见清单的 method 字段）。 */
const gamesFromList = (entry) => (entry.pages || []).flatMap((page) => (page.games || []).map((line) => {
  const [black, white] = String(line).split(/\s+-\s+/);
  if (!black || !white) return null;
  const event = eventNameOf(entry);
  return {
    black: black.trim(),
    white: white.trim(),
    event,
    year: entry.year,
    result: "",
    url: page.url,
    note: noteOf(page),
  };
}).filter(Boolean));

/** 读全部清单来源（抓取清单缺文件就跳过：抓取脚本不是每次都要重跑）。 */
const allGames = () => {
  const out = [];
  const hand = JSON.parse(read("scripts/record-index-sources.json"));
  out.push(...gamesFromList(hand));
  const generatedPath = "scripts/record-index-sources.generated.json";
  if (existsSync(resolve(root, generatedPath))) {
    const generated = JSON.parse(read(generatedPath));
    for (const entry of generated.events || []) out.push(...gamesFromList(entry));
  }
  // 去重：同一局在两个页面/两份清单里都出现过时只留一条（按「黑 白 赛事 页面」判等，不猜）。
  const seen = new Set();
  const unique = out.filter((game) => {
    const key = `${nameKey(game.black)}|${nameKey(game.white)}|${game.event}|${game.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique
    .sort((a, b) => Number(b.year) - Number(a.year) || a.event.localeCompare(b.event, "zh"))
    .slice(0, MAX_GAMES)
    .map((game) => ({ ...game, source: LJRENJU_SOURCE_LABEL }));
};

const realGames = allGames();
const gameIndexes = realGames.map((_game, index) => index);

/** 别名表 → 棋手条目；真实对局按「归一化后同一人」挂到人身上（挂的是对局表的下标）。 */
const indexesFor = (wanted) => gameIndexes.filter((index) => wanted.has(nameKey(realGames[index].black)) || wanted.has(nameKey(realGames[index].white)));

const aliases = JSON.parse(read("public/online/player-aliases.json")).aliases || [];
const players = aliases
  .filter((entry) => entry && typeof entry.cn === "string" && Array.isArray(entry.latin) && entry.latin.length)
  .map((entry) => {
    const latin = [...new Set(entry.latin.map((value) => String(value).trim()).filter(Boolean))];
    const wanted = new Set([nameKey(entry.cn), ...latin.map(nameKey)].filter(Boolean));
    return { name: entry.cn.trim(), latin, games: indexesFor(wanted) };
  });

/** 清单里出现、但别名表没有的人：也建条目（名字用站点原文，不替他猜中文名）。
 *  别名表 124 人是以中文名为主的表，覆盖不到早年世锦赛的选手，两边并起来才有对局可列。 */
const known = new Set(players.flatMap((entry) => [nameKey(entry.name), ...entry.latin.map(nameKey)]));
for (const game of realGames) {
  for (const side of [game.black, game.white]) {
    const key = nameKey(side);
    if (!key || known.has(key)) continue;
    known.add(key);
    players.push({ name: side.trim(), latin: [side.trim()], games: indexesFor(new Set([key])) });
  }
}
players.sort((a, b) => a.name.localeCompare(b.name, "zh"));

const updated = new Date().toISOString().slice(0, 10);
const credit = `棋手名单来自本项目 2026-09-15 整理并人工核对的别名表；对局只登记公开页面上原文成对的「黑 - 白」，页面地址逐条保留、可回原页抽查（来源：${LJRENJU_SOURCE_LABEL}）。本模块只含姓名、赛事名与页面地址，不含任何走子内容。`;
// 输出成 **TS 模块**而不是 public/ 下的 JSON：上一版把目录放成运行时 fetch 的文件，
// 网页版只要那个文件取不到（旧预缓存、还没部署到该文件的环境），棋手检索就永远出不来结果
// ——「网页版不能搜索」就是这么来的。编进包里就没有这个失败模式，也不用处理加载态。
// 09-28 起这个模块由 `record-index.ts` 的 loadRecordIndex() **动态 import**（分片），
// 不再静态挂在启动主包上：目录已经两千来局，进主包等于把首屏压胖。
const rows = players.map((entry) => ({
  name: entry.name,
  latin: entry.latin,
  ...(entry.games.length ? { games: entry.games } : {}),
}));
const games = realGames.map((game) => ({
  black: game.black, white: game.white, event: game.event, year: game.year, result: game.result, url: game.url, ...(game.note ? { note: game.note } : {}), source: game.source,
}));
const body = [
  "// 由 scripts/build-record-index.mjs 生成，不要手改：要改数据请改 scripts/record-index-sources*.json 后重新生成。",
  "// 对局来自逐页打开核实过的公开页面（人工清单 + 抓取清单，页面地址逐条保留）；只含姓名 / 赛事名 / 页面地址，不含走子内容。",
  "export interface RawIndexGame { black: string; white: string; event: string; year: string; result: string; url: string; note?: string; source: string }",
  "/** games 是 RECORD_INDEX_GAMES 的下标：同一局挂在黑白两人名下，只存一份（09-28）。 */",
  "export interface RawIndexPlayer { name: string; latin: string[]; games?: number[] }",
  `export const RECORD_INDEX_UPDATED = ${JSON.stringify(updated)};`,
  `export const RECORD_INDEX_CREDIT = ${JSON.stringify(credit)};`,
  `export const RECORD_INDEX_GAMES: RawIndexGame[] = ${JSON.stringify(games)};`,
  `export const RECORD_INDEX_PLAYERS: RawIndexPlayer[] = ${JSON.stringify(rows)};`,
  "",
].join("\n");
writeFileSync(resolve(root, OUTPUT), body, "utf8");
const withGames = players.filter((entry) => entry.games.length).length;
const eventCount = new Set(games.map((game) => `${game.event}|${game.year}`)).size;
console.log(`已生成 ${OUTPUT}：${players.length} 位棋手（${withGames} 位有对局）· ${games.length} 局 · ${eventCount} 届赛事`);
