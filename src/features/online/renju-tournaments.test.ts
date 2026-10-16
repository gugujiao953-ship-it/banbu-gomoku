import { describe, expect, it } from "vitest";
import {
  RENJU_NET_ORIGIN,
  isMajorRenjuEvent,
  parseRenjuNetTournamentList,
  tournamentListUrlFor,
} from "./renju-net";
import fixture from "./__fixtures__/renju-net/tournament-search-2026.html?raw";

describe("renju.net tournament index", () => {
  it("builds the documented /tournament/search url", () => {
    expect(tournamentListUrlFor({ yearFrom: "2026", yearTo: "2026", page: 1 }))
      .toBe(`${RENJU_NET_ORIGIN}/tournament/search?year_from=2026&year_to=2026`);
    expect(tournamentListUrlFor({ yearFrom: "2026", yearTo: "2026", page: 3 }))
      .toContain("p=3");
  });

  it("parses the real tournament list page", () => {
    // 夹具是 2026-09-15 从 renju.net 抓的真实页面（/tournament/search?year_from=2026&year_to=2026）。
    const list = parseRenjuNetTournamentList(fixture, 1);
    expect(list.items.length).toBe(50);
    expect(list.pageCount).toBeGreaterThan(1);

    const first = list.items[0];
    expect(first.id).toMatch(/^\d+$/);
    expect(first.name.length).toBeGreaterThan(4);
    expect(first.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 日期区间、地点、规则都来自同一行；缺一项解析就会串位。
    expect(first.dateTo >= first.dateFrom).toBe(true);
    expect(typeof first.rated).toBe("boolean");

    // 每一行都必须有 id + 名称，且 id 不重复（重复说明行切分把同一行算了两次）。
    const ids = list.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.items.every((item) => item.id && item.name)).toBe(true);
    // 至少要有几行解析出地点，否则说明 <p> 段落切分失效。
    expect(list.items.filter((item) => item.place).length).toBeGreaterThan(20);
  });

  it("flags championships and international events as major, club events as not", () => {
    expect(isMajorRenjuEvent("2026 Beijing Renju Championship, A Group")).toBe(true);
    expect(isMajorRenjuEvent("World Renju Championship 2026")).toBe(true);
    expect(isMajorRenjuEvent("European Championship - Blitz")).toBe(true);
    expect(isMajorRenjuEvent("Japanese Renju Meijin Title Match")).toBe(true);
    expect(isMajorRenjuEvent("Upsala Renju Open")).toBe(false);
    expect(isMajorRenjuEvent("Piškohraní 2026")).toBe(false);
  });
});
