import { describe, expect, it } from "vitest";
import { OTHER_RESOURCES, otherResourceCopyText } from "./other-resources";

/**
 * 「在线 → 其他」的网盘清单（`other-resources.ts`）结构守卫。
 *
 * 这一面是「点整张卡片就跳外站」，一条脏数据（缺链接、重复 id、提取码串了位）会直接变成
 * 用户点开的坏体验。单测只钉形状与文案，**不发任何网络请求**（与习题站目录同一纪律）。
 */
describe("网盘资料清单", () => {
  it("清单非空，且每条都有可点的 https 地址与上屏文案", () => {
    expect(OTHER_RESOURCES.length).toBeGreaterThan(0);
    for (const resource of OTHER_RESOURCES) {
      expect(resource.url, `${resource.id} 缺地址`).toMatch(/^https:\/\/[^\s]+$/);
      expect(resource.site.trim().length, `${resource.id} 缺网盘名`).toBeGreaterThan(1);
      expect(resource.label.trim().length, `${resource.id} 缺资料名`).toBeGreaterThan(1);
      expect(resource.note.trim().length, `${resource.id} 缺一行说明`).toBeGreaterThan(6);
      expect(resource.addedOn, `${resource.id} 缺收录日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("id 不重复（卡片 key 与探针钩子都靠它）", () => {
    const ids = OTHER_RESOURCES.map((resource) => resource.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("复制串：有提取码的带上「提取码:」，没有的不写空值", () => {
    for (const resource of OTHER_RESOURCES) {
      const text = otherResourceCopyText(resource);
      expect(text.startsWith(resource.url), `${resource.id} 复制串要以地址开头`).toBe(true);
      if (resource.accessCode) expect(text).toContain(`提取码: ${resource.accessCode}`);
      else expect(text).not.toContain("提取码");
    }
  });

  it("两条网盘地址各就各位（写错域名就是让用户白跑一趟）", () => {
    expect(OTHER_RESOURCES.find((r) => r.id === "baidu-pan")?.url).toContain("pan.baidu.com/s/");
    expect(OTHER_RESOURCES.find((r) => r.id === "quark-pan")?.url).toContain("pan.quark.cn/s/");
  });
});
