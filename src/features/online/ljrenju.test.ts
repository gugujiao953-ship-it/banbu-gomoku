import { describe, expect, it } from "vitest";
import { LJRENJU_SOURCE, buildLjRenjuGameList, parseLjRenjuIndex, parseLjRenjuMoves, parseLjRenjuPoint, parseLjRenjuRoundLinks, parseLjRenjuRoundPage } from "./ljrenju";
import indexHtml from "./__fixtures__/ljrenju/news-index.html?raw";
import eventHtml from "./__fixtures__/ljrenju/event-wc18.html?raw";
import roundHtml from "./__fixtures__/ljrenju/round-wryc7dr9.html?raw";

// 三个夹具都是 2026-09-15 从 ljrenju.com 抓的真实页面。这里只测纯函数与不联网的
// 构造路径；真正走网络的浏览流程由 qa/online-library-check.mjs 用 route 夹具覆盖。
describe("ljrenju.com 浏览式来源", () => {
  it("decodes the site's coordinates with the same contract as renju.net", () => {
    // 站点口径：列字母 + 自下而上的行号。h8 → col 7、row 15-8=7。
    expect(parseLjRenjuPoint("h8")).toEqual({ row: 7, col: 7 });
    expect(parseLjRenjuPoint("a15")).toEqual({ row: 0, col: 0 });
    expect(parseLjRenjuPoint("o1")).toEqual({ row: 14, col: 14 });
    expect(parseLjRenjuPoint("z9")).toBeNull();
    expect(parseLjRenjuPoint("")).toBeNull();
  });

  it("parses a real round page into games with full move lists", () => {
    const parsed = parseLjRenjuRoundPage(roundHtml, "https://www.ljrenju.com/news/rif2026/wryc7dr9.htm");
    expect(parsed.title).toContain("青少年杯");
    expect(parsed.games.length).toBeGreaterThan(5);

    const first = parsed.games[0];
    expect(first.black).toBe("Han Yichen");
    expect(first.white).toBe("Yin Yifan");
    expect(first.moveCount).toBe(first.moves.split(/\s+/).length);
    expect(first.moveCount).toBeGreaterThan(30);
    // 轮次是页面级的（这一页所有对局同一轮），不是各局的台号——面板按它分组才是
    // 「赛事 → 轮次 → 棋谱」；若把台号并进来会变成一组一局。
    expect(first.round).toBe("D组 第九轮");
    expect(parsed.games.every((game) => game.round === first.round)).toBe(true);
    // 广告脚本的正文不能混进任何字段（老页面里夹着 adsbygoogle 的 <script>）。
    expect(JSON.stringify(parsed)).not.toContain("adsbygoogle");
    // 首手必须是天元（连珠规则）：坐标口径写错会立刻在这里暴露。
    expect(parseLjRenjuMoves(first.moves)[0]).toEqual({ row: 7, col: 7 });
    expect(parsed.groups.length).toBeGreaterThan(0);
  });

  it("labels every game with the event name so imported records keep context", () => {
    const list = buildLjRenjuGameList(roundHtml, "https://www.ljrenju.com/news/rif2026/wryc7dr9.htm", "第18届世界五子棋锦标赛");
    expect(list.items.length).toBeGreaterThan(5);
    expect(list.items.every((item) => item.event.includes("第18届世界五子棋锦标赛"))).toBe(true);
    expect(new Set(list.items.map((item) => item.id)).size).toBe(list.items.length);
  });

  it("builds the SGF straight from the page's move list (no request per game)", async () => {
    const list = buildLjRenjuGameList(roundHtml, "https://www.ljrenju.com/news/rif2026/wryc7dr9.htm", "第7届世界连珠青少年杯");
    const record = await LJRENJU_SOURCE.fetchGame(list.items[0]);
    expect(record.sgf.startsWith("(;")).toBe(true);
    expect(record.sgf).toContain("SZ[15]");
    expect(record.sgf).toContain("PB[");
    expect(record.sgf).toContain("B[hh]"); // 首手天元 h8 → SGF 的 hh
    expect(record.filename.endsWith(".sgf")).toBe(true);
    expect(record.info.sourceUrl).toBeTruthy();
  });

  it("lists the 连珠史记 index as events with a year taken from the folder", () => {
    const events = parseLjRenjuIndex(indexHtml);
    // 索引里带「国家+年份」目录的链接实测 100 条，其中 82 条是真赛事
    // （其余是「2026年」这类年份表头、各省/机构索引与站内导航）。
    expect(events.length).toBeGreaterThanOrEqual(70);
    expect(events.every((event) => !/^\d{4}\s*年?$/.test(event.name))).toBe(true);
    const recent = events.filter((event) => event.year >= 2024);
    expect(recent.length).toBeGreaterThan(5);
    // 站点是国家+年份归档：目录名前三位是国家代码。
    expect(events.every((event) => event.year >= 1980 && event.year <= 2100)).toBe(true);
    expect(events.every((event) => event.url.startsWith("https://www.ljrenju.com/news/"))).toBe(true);
    // 中文赛事名（这正是接这个源的动机：中文内容）。
    expect(recent.some((event) => /[\u4e00-\u9fff]/.test(event.name))).toBe(true);
  });

  it("finds the round pages of an event page, ignoring site navigation", () => {
    const rounds = parseLjRenjuRoundLinks(eventHtml, "https://www.ljrenju.com/news/rif2025/wc18.htm");
    expect(rounds.length).toBeGreaterThan(3);
    // 站内导航里有个 ../../intro/r0.htm（棋手介绍），形状像轮次页但不能进来。
    expect(rounds.every((url) => url.startsWith("https://www.ljrenju.com/news/rif2025/wc18"))).toBe(true);
    expect(new Set(rounds).size).toBe(rounds.length);
  });

  it("is browse-only: it refuses search instead of pretending", async () => {
    expect(LJRENJU_SOURCE.supports("player")).toBe(false);
    expect(LJRENJU_SOURCE.supports("tournament")).toBe(false);
    await expect(LJRENJU_SOURCE.search({}, 1)).rejects.toThrow(/浏览/);
  });
});
