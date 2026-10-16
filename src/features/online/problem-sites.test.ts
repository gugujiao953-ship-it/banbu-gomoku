import { describe, expect, it } from "vitest";
import { PROBLEM_SITES, problemSiteTags, problemSitesCheckedOn, searchProblemSites } from "./problem-sites";

/**
 * 习题站目录（`problem-sites.ts`）的结构守卫。
 *
 * 这些条目是**逐站用浏览器打开核实过**才写进来的，界面上又是「点整张卡片就跳外站」，
 * 所以一条脏数据（缺链接、缺核实日期、重复 id）会直接变成用户点开的坏体验。
 * 这里钉住形状与去重；真实可达性由人工核实（每条的 evidence 记着看到了什么），
 * 单测不发网络请求。
 */
describe("习题站目录", () => {
  it("目录非空，且每条都有可点的 https/http 地址", () => {
    expect(PROBLEM_SITES.length).toBeGreaterThan(0);
    for (const site of PROBLEM_SITES) {
      expect(site.url, `${site.id} 缺地址`).toMatch(/^https?:\/\/[^\s]+$/);
      expect(site.name.trim().length, `${site.id} 缺站名`).toBeGreaterThan(1);
      expect(site.what.trim().length, `${site.id} 缺「有什么题」`).toBeGreaterThan(4);
    }
  });

  it("每条都写了收录依据与核实日期（日期是 YYYY-MM-DD）", () => {
    for (const site of PROBLEM_SITES) {
      expect(site.evidence.trim().length, `${site.id} 缺 evidence`).toBeGreaterThan(10);
      expect(site.checked, `${site.id} 缺核实日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(site.tags.length, `${site.id} 至少要有一个题型标签`).toBeGreaterThan(0);
      expect(site.access.trim().length, `${site.id} 要写清免登录/需要登录`).toBeGreaterThan(1);
    }
  });

  it("id 与地址都不重复（同一个站给两条链接会让人以为有两个来源）", () => {
    const ids = PROBLEM_SITES.map((site) => site.id);
    const urls = PROBLEM_SITES.map((site) => site.url);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("题型 chips 由目录生成，按出现次数从多到少", () => {
    const tags = problemSiteTags();
    expect(tags.length).toBeGreaterThan(0);
    expect(tags).toContain("VCF");
    const counts = tags.map((tag) => PROBLEM_SITES.filter((site) => site.tags.includes(tag)).length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("检索是本地过滤：站名、说明、题型、依据都能命中，空关键词给全部", () => {
    expect(searchProblemSites("")).toHaveLength(PROBLEM_SITES.length);
    expect(searchProblemSites("每日一练").length).toBeGreaterThan(0);
    expect(searchProblemSites("renjuportal").length).toBe(1);
    expect(searchProblemSites("追诘").length).toBeGreaterThan(0);
    expect(searchProblemSites("绝不会有这种词")).toHaveLength(0);
  });

  it("按题型筛选只留带该标签的条目，且与关键词叠加", () => {
    const vcf = searchProblemSites("", "VCF");
    expect(vcf.length).toBeGreaterThan(0);
    expect(vcf.every((site) => site.tags.includes("VCF"))).toBe(true);
    expect(searchProblemSites("日文", "VCF").every((site) => site.tags.includes("VCF"))).toBe(true);
  });

  it("界面显示的「核实于」取最新一条的日期", () => {
    expect(problemSitesCheckedOn()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(problemSitesCheckedOn([{ ...PROBLEM_SITES[0], checked: "2020-01-01" }, { ...PROBLEM_SITES[0], checked: "2024-05-05" }])).toBe("2024-05-05");
    expect(problemSitesCheckedOn([])).toBe("");
  });
});
