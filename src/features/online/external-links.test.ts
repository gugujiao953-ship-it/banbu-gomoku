import { describe, expect, it } from "vitest";
import { EXTERNAL_ENTRY_LINKS, EXTERNAL_SOURCES, buildExternalArchiveUrl, buildExternalEventSearchUrl, buildExternalPlayerSearchUrl } from "./external-links";
import { ONLINE_GAME_SOURCES } from "./sources";

describe("在线棋谱的跳转入口", () => {
  it("把检索拼成来源站点自己的检索页，且只拼字符串（不抓取）", () => {
    // 棋手那条必须是**棋手检索页**：`game/search?player1=` 的 player1 要的是站内数字 id，
    // 填名字会被站点判成 [404] Page not found（404 页上还带一张空棋盘，用户 09-28 报的就是它）。
    expect(buildExternalPlayerSearchUrl("Kawada")).toBe("https://www.renju.net/people/search?name=kawada");
    expect(buildExternalEventSearchUrl("World Championship")).toBe("https://www.renju.net/tournament/search?name=World%20Championship");
    expect(buildExternalArchiveUrl(2024)).toBe("https://www.renju.net/tournament/search?year_from=2024&year_to=2024");
  });

  it("关键词去掉首尾空格，空关键词不会拼出半截 URL", () => {
    expect(buildExternalPlayerSearchUrl("  Kawada  ")).toBe("https://www.renju.net/people/search?name=kawada");
    // 多个空格归一、整体小写（站点自己也会 302 到小写，直接给小写少一次跳转）
    expect(buildExternalPlayerSearchUrl("  Nakamura   SHIGERU ")).toBe("https://www.renju.net/people/search?name=nakamura%20shigeru");
    expect(buildExternalEventSearchUrl("   ")).toBe("https://www.renju.net/tournament/search?name=");
  });

  it("面板是统一的：入口只有一条列表（检索框已合并到在线面顶部，用户 09-26）", () => {
    // 用户 09-19：不要按来源分成两块面板。检索目标只有一个（避免两套输入互相干扰）。
    // 09-19 晚起励精连珠教室改为**应用内浏览**（不再需要跳转入口），所以这条列表只剩 renju.net；
    // 它之所以仍走跳转，是因为该站 robots 对未列名客户端 Disallow: /，不能抓。
    expect(EXTERNAL_ENTRY_LINKS.length).toBeGreaterThan(0);
    for (const link of EXTERNAL_ENTRY_LINKS) {
      expect(link.label.length).toBeGreaterThan(1);
      expect(/^https:\/\/(www\.)?renju\.net(\/|$)/.test(link.url)).toBe(true);
      // 跳转入口只能属于「只给链接」的来源——会抓取的来源有应用内界面，不需要跳转列表
      expect(ONLINE_GAME_SOURCES.some((source) => source.id === link.sourceId)).toBe(false);
    }
  });

  it("信息来源只登记「只给链接」的站点，且不导出任何合规论述给界面用", () => {
    // 09-19 晚：励精连珠教室已改为应用内浏览，不再是跳转来源；这里只应剩 renju.net。
    expect(EXTERNAL_SOURCES.map((entry) => entry.id)).toEqual(["renju-net"]);
    for (const entry of EXTERNAL_SOURCES) {
      expect(entry.label.length).toBeGreaterThan(2);
      expect(entry.credit.length).toBeGreaterThan(2);
      // 署名行是给用户看的短文案：不该出现 robots / 条款 / 抓取 这类内部理由
      expect(/robots|条款|抓取|授权/.test(`${entry.label}${entry.credit}`)).toBe(false);
      // 反向断言：跳转来源绝不能同时出现在会抓取的来源清单里
      expect(ONLINE_GAME_SOURCES.some((source) => source.id === entry.id)).toBe(false);
    }
  });
});
