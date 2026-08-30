import { describe, expect, it } from "vitest";
import { buildFeedbackBody, buildGithubIssueUrl, buildMailtoUrl, isValidFeedbackEmail } from "./feedback";

const context = { version: "1.1.4", userAgent: "Test Browser", location: "settings" };

describe("feedback links", () => {
  it("builds a readable mailto URL without losing Chinese content", () => {
    const url = buildMailtoUrl({ kind: "suggestion", message: "希望增加棋局标签", contactEmail: "reader@example.com" }, context, "owner@example.com");
    expect(url).toContain("mailto:owner%40example.com");
    expect(decodeURIComponent(url)).toContain("希望增加棋局标签");
    expect(decodeURIComponent(url)).toContain("版本：1.1.4");
    expect(decodeURIComponent(url)).toContain("回复邮箱：reader@example.com");
  });

  it("builds a prefilled GitHub Issue URL", () => {
    const url = buildGithubIssueUrl({ kind: "bug", message: "导入后页面没有响应" }, context);
    expect(url).toContain("github.com/gugujiao953-ship-it/banbu-gomoku/issues/new");
    expect(decodeURIComponent(url)).toContain("问题反馈");
    expect(decodeURIComponent(url)).toContain("导入后页面没有响应");
  });

  it("validates only practical email addresses", () => {
    expect(isValidFeedbackEmail(" owner@example.com ")).toBe(true);
    expect(isValidFeedbackEmail("owner@example")).toBe(false);
    expect(isValidFeedbackEmail("owner example.com")).toBe(false);
  });

  it("keeps environment data separate from the user's message", () => {
    const body = buildFeedbackBody({ kind: "other", message: "建议增加快捷键" }, context);
    expect(body).toContain("建议增加快捷键");
    expect(body).toContain("设备：Test Browser");
  });
});
