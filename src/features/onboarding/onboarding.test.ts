// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { FIRST_RUN_WELCOME_KEY, hasOnboardingTourSeen, markFirstRunWelcomeRead, markOnboardingTourSeen, ONBOARDING_TOUR_KEY, shouldShowFirstRunWelcome } from "./onboarding";
import { TOUR_STEPS } from "./tour-steps";

describe("first-run onboarding", () => {
  beforeEach(() => localStorage.clear());

  it("shows the first-run dialog for a new install and records either path", () => {
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.8")).toBe(true);
    markFirstRunWelcomeRead(localStorage, "1.1.8");
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.8")).toBe(false);
    expect(localStorage.getItem(FIRST_RUN_WELCOME_KEY)).toBe("1.1.8");
  });

  it("shows again after a version update, then stays quiet for that version", () => {
    // 用户 09-14：版本更新后首运行页要重新出现一次。
    markFirstRunWelcomeRead(localStorage, "1.1.7");
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.7")).toBe(false);
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.8")).toBe(true);
    markFirstRunWelcomeRead(localStorage, "1.1.8");
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.8")).toBe(false);
  });

  it("re-arms the legacy literal \"true\" for the current version", () => {
    // v1.1.7 及更早（以及靠写这个键跳过引导的旧脚本）留下的 "true" 只代表「更早版本看过」。
    localStorage.setItem(FIRST_RUN_WELCOME_KEY, "true");
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.8")).toBe(true);
  });

  it("does not show repeatedly and auto-migrates an existing install", () => {
    markFirstRunWelcomeRead(localStorage, "1.1.8");
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.8")).toBe(false);
    localStorage.clear();
    localStorage.setItem("renju-note-active-v1", JSON.stringify({ id: "legacy" }));
    expect(shouldShowFirstRunWelcome(localStorage, "1.1.8")).toBe(false);
    expect(localStorage.getItem(FIRST_RUN_WELCOME_KEY)).toBe("1.1.8");
  });

  it("records the tour as seen once, replay ignores the flag", () => {
    expect(hasOnboardingTourSeen()).toBe(false);
    markOnboardingTourSeen();
    expect(hasOnboardingTourSeen()).toBe(true);
    expect(localStorage.getItem(ONBOARDING_TOUR_KEY)).toBe("seen");
  });

  it("step table is well-formed and covers the core surfaces", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    for (const step of TOUR_STEPS) {
      expect(step.tips.length).toBeGreaterThan(0);
      for (const tip of step.tips) {
        expect(tip.sel.length).toBeGreaterThan(0);
        expect(tip.name.length).toBeGreaterThan(0);
        expect(tip.desc.length).toBeGreaterThan(4);
      }
    }
    // 核心承诺：功能区三组、快捷中心、棋谱库、AI、设置都被讲到
    const sels = TOUR_STEPS.flatMap((s) => s.tips.map((t) => t.sel)).join(" ");
    for (const anchor of ["navStart", "analysis", "save", "brand-trigger", ".library-search", ".renju-board"]) {
      expect(sels).toContain(anchor);
    }
    expect(TOUR_STEPS.some((s) => s.tab === "library")).toBe(true);
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]?.final).toBe(true);
  });
});
