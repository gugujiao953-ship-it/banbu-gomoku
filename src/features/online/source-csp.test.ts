import { describe, expect, it } from "vitest";
// 用 Vite 的 ?raw 直接读站点入口，避免为了这个断言把 Node 类型引进浏览器工程。
import indexHtml from "../../../index.html?raw";
import { ONLINE_GAME_SOURCES, ONLINE_PUZZLE_SOURCES, QUARANTINED_ONLINE_SOURCES } from "./sources";
import { EXTERNAL_SOURCES } from "./external-links";

/**
 * 结构性守卫：每加一个在线来源（棋谱或题库），都必须把它的域名写进 index.html 的 CSP connect-src。
 *
 * 踩过的坑（2026-09-15 接励精连珠教室时）：漏加 origin 后 fetch 会被 CSP 直接拒掉，
 * 控制台是 "Refused to connect because it violates the document's Content Security
 * Policy"，而应用侧只能看到 `Failed to fetch` —— 表现和「跨域失败」一模一样，
 * 会被误判成站点不支持跨域 / 代理没配，白查半天。
 *
 * 反向也要守：**停用的来源不许留在启用清单里**，而且它的域名要从 CSP 里收掉。
 * 这样一旦有人把停用来源挪回启用位，会先撞门禁（提示补 CSP），而不是上线后表现成功能坏掉。
 */
const ENABLED_ORIGINS = [
  ...ONLINE_GAME_SOURCES.map((source) => new URL(source.homepage).origin),
  ...ONLINE_PUZZLE_SOURCES.map((source) => new URL(source.homepage).origin),
];

const connectSrc = () => {
  const csp = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i)?.[1] ?? "";
  const directive = csp.split(";").map((part: string) => part.trim()).find((part: string) => part.startsWith("connect-src"));
  expect(directive, "index.html 里找不到 connect-src").toBeTruthy();
  return directive!;
};

describe("在线来源的 CSP 放行", () => {
  it("启用中的来源，域名都在 connect-src 里", () => {
    const missing = ENABLED_ORIGINS.filter((origin) => !connectSrc().includes(origin));
    expect(missing, `这些来源域名没写进 CSP connect-src：${missing.join("、")}（在 index.html 里补上，否则浏览器会直接拒发请求）`).toEqual([]);
  });

  it("停用的来源既不在启用清单里，域名也已从 connect-src 收紧", () => {
    const enabled = new Set(ENABLED_ORIGINS);
    for (const entry of QUARANTINED_ONLINE_SOURCES) {
      expect(entry.reason.length, `${entry.label} 的停用原因不能为空`).toBeGreaterThan(4);
      expect(enabled.has(entry.origin), `${entry.label} 已停用（${entry.reason}），不该出现在启用清单里`).toBe(false);
      expect(connectSrc().includes(entry.origin), `${entry.label} 已停用，域名应从 CSP connect-src 移除（若确实要重新启用，先取得授权再加回 CSP）`).toBe(false);
    }
  });

  it("题库来源目前为空（自建题库已下架），但入口不能是死胡同", () => {
    // 2026-10-05：用户要求去掉「填自己网址当题库」那条通道 ⇒ 不再注册任何题库来源。
    // 那条通道推荐的三个托管域名（github.com / raw.githubusercontent.com / …github.io）
    // 也已从 CSP 收掉；下面的反向断言钉住这一点，免得以后有人把域名悄悄加回来。
    expect(ONLINE_PUZZLE_SOURCES).toEqual([]);
    for (const origin of ["https://raw.githubusercontent.com", "https://github.com"]) {
      expect(connectSrc().includes(origin), `${origin} 只服务已下架的自建题库，不该留在 connect-src`).toBe(false);
    }
  });

  it("棋谱来源可以全部停用，但必须由「只给链接」的来源兜底", () => {
    // 2026-09-19：棋谱通道一律改成只给链接（下载会成规模复制第三方内容），
    // 所以 ONLINE_GAME_SOURCES 允许为空——但**不能空得没有出路**：外部链接来源必须还在，
    // 否则用户看到的是一个没有任何入口的空白界面。
    if (ONLINE_GAME_SOURCES.length === 0) expect(EXTERNAL_SOURCES.length).toBeGreaterThan(0);
  });

  it("只给链接的来源，域名不许留在 connect-src 里（留了就等于默许以后去抓它）", () => {
    for (const entry of EXTERNAL_SOURCES) {
      const origin = new URL(entry.origin).origin;
      expect(connectSrc().includes(origin),
        `${entry.label} 是只给链接的来源（不抓取），域名不该出现在 CSP connect-src；若确实要改成抓取，先取得授权、再把它挪进 ONLINE_GAME_SOURCES`).toBe(false);
    }
  });
});
