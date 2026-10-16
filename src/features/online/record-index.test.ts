import { describe, expect, it } from "vitest";
import { buildRecordIndex, indexGames, loadRecordIndex, playerLinks, searchRecordIndex } from "./record-index";
import type { RawIndexGame, RawIndexPlayer } from "./record-index-data";
import type { PlayerAlias } from "./player-aliases";

/**
 * 在线棋手检索的自有目录层（`record-index.ts`）。
 *
 * 钉五件事：
 *   1. **目录是打进包里的**（不再运行时 fetch 一个文件——网页版取不到那个文件时检索会
 *      永远出不来结果，用户 09-26 报的「网页版不能搜索」就是这个），所以数据形状必须
 *      自己站得住：每人有名字与写法，每局有可点地址与来源标注。
 *   2. 09-28 起目录**懒加载成分片**（一千多局不该进启动主包）：`loadRecordIndex()` 要能
 *      真的把那份数据读出来，且多次调用复用同一份。
 *   3. 一个输入框同时查**棋手与赛事**（用户：「两个搜索占空间，来源合并，搜到后显示是
 *      哪个来源的哪个东西」），且每条结果都能回答「这是哪来的」。
 *   4. 命中口径：中文名靠别名表读成拉丁写法、大小写与词序都不影响、查不到就给空。
 *   5. 入口链接的形状：renju.net 那条必须是**棋手检索页**（`people/search?name=`）。
 *      ⚠ 不能再是 `game/search?player1=<名字>`——那个参数要站内数字 id，填名字会被站点
 *      判成 404（404 页上还带一张空棋盘，用户 09-28 报的就是它）。
 */
const ALIASES: PlayerAlias[] = [{ cn: "梅凡", latin: ["Mei Fan"] }];

/** 一份最小可用的目录数据（对局表 + 棋手挂下标），用来验组装/聚合逻辑，不依赖包里的数据。 */
const rawGames: RawIndexGame[] = [
  { black: "Mei Fan", white: "Cao Dong", event: "第18届世界连珠锦标赛", year: "2025", result: "", url: "https://www.ljrenju.com/news/rif2025/a1.htm", note: "决赛 第一轮", source: "励精连珠教室 · 连珠史记" },
  { black: "Li Xiaoqing", white: "Mei Fan", event: "第18届世界连珠锦标赛", year: "2025", result: "", url: "https://www.ljrenju.com/news/rif2025/a2.htm", note: "决赛 第二轮", source: "励精连珠教室 · 连珠史记" },
  { black: "Nakamura Shigeru", white: "Mei Fan", event: "第14届世界连珠锦标赛", year: "2005", result: "", url: "https://www.ljrenju.com/news/rif2005/a3.htm", source: "励精连珠教室 · 连珠史记" },
];
const rawPlayers: RawIndexPlayer[] = [
  { name: "梅凡", latin: ["Mei Fan"], games: [0, 1, 2] },
  { name: "曹冬", latin: ["Cao Dong"], games: [0] },
  { name: "李小青", latin: ["Li Xiaoqing"], games: [1] },
  // 越界下标（生成器与包不同步时会出现）必须被丢掉，而不是让整份目录崩掉
  { name: "中村茂", latin: ["Nakamura Shigeru"], games: [2, 99] },
];
const fixture = buildRecordIndex(rawPlayers, rawGames, "2026-09-28", "测试用目录");

describe("在线棋手目录（打进包里、按需加载）", () => {
  it("懒加载分片能读出来，且两次调用复用同一份", async () => {
    const first = await loadRecordIndex();
    const second = await loadRecordIndex();
    expect(second).toBe(first);
    expect(first.players.length).toBeGreaterThan(50);
    expect(first.gameCount).toBeGreaterThan(0);
    expect(first.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.credit.length).toBeGreaterThan(10);
    for (const entry of first.players.slice(0, 30)) {
      expect(entry.name.trim().length, "目录里有空名字的条目").toBeGreaterThan(0);
      expect(entry.latin.length, `${entry.name} 缺写法`).toBeGreaterThan(0);
    }
  });

  it("每条对局都带着可点的地址与来源标注（合并来源后界面要能回答「这是哪来的」）", async () => {
    const index = await loadRecordIndex();
    const games = index.players.flatMap((entry) => entry.games);
    expect(games.length).toBeGreaterThan(0);
    for (const game of games) {
      expect(game.url).toMatch(/^https?:\/\/[^\s]+$/);
      expect(game.source.length, `${game.black} 那局没标来源`).toBeGreaterThan(1);
      expect(game.black && game.white).toBeTruthy();
    }
  });

  it("组装：下标解析成人能读的对局，越界的那条丢掉而不整份崩", () => {
    const mei = fixture.players.find((entry) => entry.name === "梅凡")!;
    expect(indexGames(mei).map((game) => game.black)).toEqual(["Mei Fan", "Li Xiaoqing", "Nakamura Shigeru"]);
    const nakamura = fixture.players.find((entry) => entry.name === "中村茂")!;
    expect(nakamura.games).toHaveLength(1);
  });

  it("一个输入框同时查棋手与赛事：搜人名出人，搜赛事名出赛事与其对局", () => {
    const byPlayer = searchRecordIndex(fixture, "梅凡", ALIASES);
    expect(byPlayer.players.map((entry) => entry.name)).toContain("梅凡");
    expect(byPlayer.players[0].games.length).toBeGreaterThan(0);
    const byEvent = searchRecordIndex(fixture, "世界连珠锦标赛", []);
    expect(byEvent.events.length).toBe(2);
    // 赛事按年份新→旧排：2025 那届在前
    expect(byEvent.events[0].year).toBe("2025");
    expect(byEvent.events[0].games.every((game) => game.event.includes("世界连珠锦标赛"))).toBe(true);
    expect(byEvent.events[0].source.length).toBeGreaterThan(1);
  });

  it("拉丁写法与词序、大小写都不影响命中；空输入与查无此词都给空", () => {
    expect(searchRecordIndex(fixture, "  MEI   FAN ", []).players[0]?.name).toBe("梅凡");
    expect(searchRecordIndex(fixture, "", ALIASES)).toEqual({ players: [], events: [] });
    const miss = searchRecordIndex(fixture, "绝不存在的人名zzz", ALIASES);
    expect(miss.players).toHaveLength(0);
    expect(miss.events).toHaveLength(0);
  });

  it("每位棋手三条入口：renju.net 棋手检索页 + 史记索引 + 棋手名录", () => {
    const links = playerLinks({ name: "梅凡", latin: ["Mei Fan"] });
    expect(links).toHaveLength(3);
    // ⚠ 旧形状 game/search?player1=<名字> 会被站点判 404（那个参数要数字 id），不许回潮
    expect(links[0].url).toBe("https://www.renju.net/people/search?name=mei%20fan");
    expect(links[1].url).toBe("https://www.ljrenju.com/news/index.htm");
    expect(links[2].url).toBe("https://www.ljrenju.com/player/index.htm");
  });

  it("包里的每个人都是同一处生成链接，不会出现半截地址或 404 形状", async () => {
    const index = await loadRecordIndex();
    for (const entry of index.players) {
      for (const link of entry.links) {
        expect(/^https:\/\/[^\s]+$/.test(link.url), `${entry.name} 的链接不像地址：${link.url}`).toBe(true);
        expect(link.url, `${entry.name} 用了会 404 的旧形状`).not.toMatch(/game\/search\?player1=/);
      }
    }
  });

  it("赛事清单是从对局表聚合出来的（不另存一份会漂移的副本），同一局不重复计", async () => {
    const events = fixture.events;
    expect(events.map((event) => `${event.name}|${event.year}`)).toEqual([
      "第18届世界连珠锦标赛|2025",
      "第14届世界连珠锦标赛|2005",
    ]);
    // 一局挂在两个人名下，聚合后仍然只算一次
    expect(events.reduce((sum, event) => sum + event.games.length, 0)).toBe(rawGames.length);
    const index = await loadRecordIndex();
    for (const event of index.events) {
      const keys = event.games.map((game) => `${game.url}#${game.black}#${game.white}`);
      expect(new Set(keys).size, `${event.name} 里有重复局`).toBe(keys.length);
    }
  });

  it("09-28 扩了 18 届世锦赛之后，老棋手也要搜得出具体届次", async () => {
    const index = await loadRecordIndex();
    // 别名表里的人（中文名）与站点原文写法都要能落到至少一届
    const withGames = index.players.filter((entry) => entry.games.length > 0);
    expect(withGames.length).toBeGreaterThan(80);
    expect(index.events.length).toBeGreaterThan(5);
    // 每一届都带页面地址（点得开，不是一句空话）
    for (const event of index.events) {
      expect(event.games[0].url, `${event.name} 没有可点地址`).toMatch(/^https?:\/\//);
      expect(event.year).toMatch(/^\d{4}$/);
    }
  });
});
