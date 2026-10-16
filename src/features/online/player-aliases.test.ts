import { describe, expect, it } from "vitest";
import { hasCjk, resolvePlayerQueryWith, toSiteQueryText, type PlayerAlias } from "./player-aliases";

// 用一张小表做纯函数测试（真实表在 public/online/player-aliases.json，靠 fetch 加载）。
const ALIASES: PlayerAlias[] = [
  { cn: "曹冬", latin: ["Cao Dong"] },
  { cn: "中村茂", latin: ["Nakamura Shigeru"] },
  { cn: "安度·麦利蒂", latin: ["Meritee Ando", "Ando Meritee"] },
];

describe("player alias resolution", () => {
  it("maps a Chinese name to the latin spelling the source expects", () => {
    expect(resolvePlayerQueryWith(ALIASES, "曹冬")).toEqual({ query: "cao dong", alias: ALIASES[0] });
    expect(resolvePlayerQueryWith(ALIASES, "  中村茂 ").query).toBe("nakamura shigeru");
    // 多个写法取第一个（站点检索是多词子串匹配，够用）。
    expect(resolvePlayerQueryWith(ALIASES, "安度·麦利蒂").query).toBe("meritee ando");
  });

  it("lowercases latin input, because renju.net only matches lowercase", () => {
    // 实测：/media/people.json?query=Cao 返回空、query=cao 才有结果。
    expect(resolvePlayerQueryWith(ALIASES, "Cao Dong").query).toBe("cao dong");
    expect(resolvePlayerQueryWith(ALIASES, "KAWADA").query).toBe("kawada");
    expect(toSiteQueryText("  Miki  Kawada ")).toBe("miki kawada");
  });

  it("passes unknown input through untouched so the source can decide", () => {
    // 不在表里的中文名：不猜、不丢，原样交给来源；面板会显示「将按…检索」并允许失败提示。
    expect(resolvePlayerQueryWith(ALIASES, "某某棋手")).toEqual({ query: "某某棋手", alias: null });
    expect(resolvePlayerQueryWith(ALIASES, "")).toEqual({ query: "", alias: null });
    expect(hasCjk("曹冬")).toBe(true);
    expect(hasCjk("Cao Dong")).toBe(false);
  });
});
