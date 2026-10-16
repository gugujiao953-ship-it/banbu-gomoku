import { describe, expect, it } from "vitest";
import { isMajorRenjuEvent, parseRenjuNetSearchPage } from "./renju-net";
import searchHtml from "./__fixtures__/renju-net/search-2024.html?raw";

/**
 * 「重大赛事」判据。用户的要求很具体：世界级 + 各国国家级都收（国内全国赛、杯赛、公开赛
 * 如灵峰杯），欧美那边的地区性小赛不收。
 */
describe("重大赛事判据", () => {
  it("收录国内与各国的全国级赛事（中文名也要认）", () => {
    // 这一组是本次改动的核心：原来只按英文关键词筛，中文赛事整批漏掉。
    for (const name of [
      "灵峰杯全国五子棋公开赛",
      "全国五子棋锦标赛",
      "中国五子棋锦标赛（成人组）",
      "2026年北京市五子棋锦标赛",
      "全国智力运动会五子棋项目",
      "中国智力运动大会",
      "全国青少年五子棋锦标赛",
    ]) {
      expect(isMajorRenjuEvent(name), name).toBe(true);
    }
  });

  it("收录世界级与传统连珠强国的国家级赛事", () => {
    for (const name of [
      "World Renju Championship 2026",
      "第18届世界五子棋锦标赛",
      "Gomoku Team World Championship 2026 - Blitz Tournament",
      "European Championship, A Group", // 洲际锦标赛带 championship + 无地区小赛词
      "Japanese Renju Meijin Title Match",
      "第63期名人戦",
      "Korea Omok Master Tournament",
      "Russian Renju Championship",
      "Estonian Championship",
      "2026 Beijing Renju Championship, A Group",
    ]) {
      expect(isMajorRenjuEvent(name), name).toBe(true);
    }
  });

  it("不收欧洲各站公开赛与地方/俱乐部小赛", () => {
    for (const name of [
      "Upsala Renju Open",
      "Swedish Open Team Championship 2026",
      "Scandinavian Open",
      "Nordic Championship",
      "Baltic Cup",
      "Prague Local Club Championship",
      "Győri Gomoku Championship 2026",
      "Piškohraní 2026",
      "Piškohraní 2026 - Blitz",
    ]) {
      // 注意：带 Championship 的瑞典/匈牙利站属于地区性站点赛，判为不收。
      expect(isMajorRenjuEvent(name), name).toBe(false);
    }
  });

  it("空名与无级别信息的一律不收", () => {
    expect(isMajorRenjuEvent("")).toBe(false);
    expect(isMajorRenjuEvent("   ")).toBe(false);
    expect(isMajorRenjuEvent("Friendly Match")).toBe(false);
  });
});

describe("检索结果带赛事名（面板据此分组）", () => {
  it("筛了某个赛事时，整页结果都带上该赛事名", () => {
    // 站点结果行只有黑白/结果/日期，没有赛事名；但启用中的 tournament 选项就是它。
    // 夹具片段里没有 <body>，直接在开头插入站点那种「启用中的 tournament 选项」。
    const html = '<select name="tournament"><option value="3416" selected>Swedish Open Team Championship 2026 (2026-11-28)</option></select>' + searchHtml;
    const result = parseRenjuNetSearchPage(html, 1);
    expect(result.items.length).toBeGreaterThan(3);
    expect(result.items.every((item) => item.event === "Swedish Open Team Championship 2026 (2026-11-28)")).toBe(true);
  });

  it("没有筛赛事时 event 为空，面板会退回到「未知赛事」分组", () => {
    const result = parseRenjuNetSearchPage(searchHtml, 1);
    expect(result.items.length).toBeGreaterThan(3);
    expect(result.items.every((item) => item.event === "")).toBe(true);
  });
});
