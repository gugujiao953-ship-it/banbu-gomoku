// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { FIRST_RUN_WELCOME_KEY, markFirstRunWelcomeRead, shouldShowFirstRunWelcome } from "./onboarding";

describe("first-run onboarding", () => {
  beforeEach(() => localStorage.clear());

  it("shows the first-run dialog for a new install and records either path", () => {
    expect(shouldShowFirstRunWelcome()).toBe(true);
    markFirstRunWelcomeRead();
    expect(shouldShowFirstRunWelcome()).toBe(false);

    localStorage.clear();
    expect(shouldShowFirstRunWelcome()).toBe(true);
    markFirstRunWelcomeRead();
    expect(localStorage.getItem(FIRST_RUN_WELCOME_KEY)).toBe("true");
  });

  it("does not show repeatedly and auto-migrates an existing install", () => {
    markFirstRunWelcomeRead();
    expect(shouldShowFirstRunWelcome()).toBe(false);
    localStorage.clear();
    localStorage.setItem("renju-note-active-v1", JSON.stringify({ id: "legacy" }));
    expect(shouldShowFirstRunWelcome()).toBe(false);
    expect(localStorage.getItem(FIRST_RUN_WELCOME_KEY)).toBe("true");
  });
});
