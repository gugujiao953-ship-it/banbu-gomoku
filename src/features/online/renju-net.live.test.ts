// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { RENJU_NET_ORIGIN, RENJU_NET_SOURCE, parseRenjuNetGamePage, parseRenjuNetTournamentPage, peopleSearchUrlFor, searchUrlFor, tournamentLookupUrlFor } from "./renju-net";
import { resetOnlineTransportState } from "./online-http";

/**
 * 真实站点漂移检查（默认跳过）。
 *
 * 单测用的是 2026-09-15 从 renju.net 抓下来的真实页面夹具；对方改版会让解析器
 * 静默失效（夹具永远是对的）。改过解析器、或隔一段时间后，跑一次真站核对：
 *
 *   ONLINE_LIVE=1 npx vitest run src/features/online/renju-net.live.test.ts
 *
 * 只发 3 个请求（检索 1 页 + 1 局 + 1 个赛事），且要求至少解析出内容；站点不可达
 * 时按跳过处理，不把「网络不通」误判成解析器坏了。
 */
// 这个文件只在 Node 下跑（vitest），项目 tsconfig 没有引 @types/node，
// 因此就地声明用到的那一个全局，而不是给整个测试套件打开 Node 类型。
declare const process: { env: Record<string, string | undefined> };

const live = process.env.ONLINE_LIVE === "1";

describe.skipIf(!live)("renju.net 真站漂移检查", () => {
  it("检索、单局与赛事三处解析仍然对得上", async () => {
    resetOnlineTransportState();
    const page = await RENJU_NET_SOURCE.search({ yearFrom: "2024", yearTo: "2024" }, 1);
    expect(page.total).toBeGreaterThan(1000);
    expect(page.items.length).toBeGreaterThan(50);
    const first = page.items[0];
    expect(first.black.length).toBeGreaterThan(0);
    expect(first.white.length).toBeGreaterThan(0);
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const record = await RENJU_NET_SOURCE.fetchGame(first);
    expect(record.sgf.startsWith("(;GM[4]")).toBe(true);
    const moves = [...record.sgf.matchAll(/[BW]\[([a-o]{2})\]/g)];
    expect(moves.length).toBeGreaterThan(4);
    expect(record.filename).toMatch(/^renju-\d+-.+\.sgf$/);
    expect(record.info.sourceUrl).toBe(first.url);
    expect(record.info.ruleText?.length).toBeGreaterThan(0);

    const tournamentId = first.url.match(/\/tournament\/(\d+)\//)?.[1];
    if (tournamentId) {
      const html = await fetch(`https://www.renju.net/tournament/${tournamentId}/`).then((response) => response.text());
      const tournament = parseRenjuNetTournamentPage(html, tournamentId);
      expect(tournament.name.length).toBeGreaterThan(0);
    }
  }, 60_000);

  /**
   * **上屏的外链形状**也要问站点，不能只按我们自己的代码断言。
   *
   * 教训（用户 09-28）：棋手链接一直拼成 `game/search?player1=<名字>`，单测与门禁都只断言
   * 「字符串长这样」，从没问过 renju.net——而那个参数要的是站内数字 id，填名字会被判成
   * `[404] Page not found`，且 404 页上正好带着一张空棋盘，用户看到的就是「404 的空棋盘界面」。
   * 现在这条漂移检查逐个真发一次请求，断言 200 且页面里没有 404 文案。
   */
  it("面板上会出现的三类外链，在真站上仍然不是 404", async () => {
    const check = async (url: string, pattern: RegExp) => {
      const response = await fetch(url, { headers: { "user-agent": "banbu-gomoku-link-check" } });
      expect(response.status, `${url} 应该 200`).toBe(200);
      const html = await response.text();
      expect(html, `${url} 落到了 404 页`).not.toMatch(/Page not found/i);
      expect(html, `${url} 页面里没有预期的结果行`).toMatch(pattern);
    };
    // 棋手检索（people/search?name=）：应列出 /people/<id>/
    await check(peopleSearchUrlFor("Mesila Villem"), /href="\/people\/\d+\//);
    // 赛事检索（按名字）：应列出 /tournament/<id>/
    await check(tournamentLookupUrlFor("World Championship"), /href="\/tournament\/\d+\//);
    // 棋谱检索按年份（应用内抓取用的那条）：应列出对局行
    await check(searchUrlFor({ yearFrom: "2024", yearTo: "2024" }, 1), /\/game\//);
    // 反向：旧的那条错误形状确实会被站点判 404（钉住这条，防止有人改回去）
    const wrong = await fetch(`${RENJU_NET_ORIGIN}/game/search?player1=mesila`, { headers: { "user-agent": "banbu-gomoku-link-check" } });
    expect(await wrong.text(), "旧形状若已能用，请连同本条注释一起更新").toMatch(/Page not found/i);
  }, 60_000);
});
