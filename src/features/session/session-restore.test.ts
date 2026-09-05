// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearLastSession, loadLastSession, loadRestoreLastPosition, saveLastSession, saveRestoreLastPosition, sessionRestoreKeys } from "./session-restore";

describe("session restore", () => {
  beforeEach(() => localStorage.clear());

  it("defaults on and persists the restore preference", () => {
    expect(loadRestoreLastPosition()).toBe(true);
    saveRestoreLastPosition(false);
    expect(loadRestoreLastPosition()).toBe(false);
    saveRestoreLastPosition(true);
    expect(loadRestoreLastPosition()).toBe(true);
  });

  it("stores the minimal record node and mode state", () => {
    saveLastSession({ documentId: "record-1", nodeId: "node-8", mode: "record", largeId: "large-1" });
    expect(loadLastSession()).toMatchObject({ documentId: "record-1", nodeId: "node-8", mode: "record", largeId: "large-1" });
    expect(loadLastSession()?.updatedAt).toBeTruthy();
  });

  it("returns null for malformed or cleared state", () => {
    localStorage.setItem(sessionRestoreKeys.SESSION_KEY, JSON.stringify({ documentId: "x", nodeId: "y", mode: "unknown" }));
    expect(loadLastSession()).toBeNull();
    saveLastSession({ documentId: "x", nodeId: "root", mode: "record" });
    clearLastSession();
    expect(loadLastSession()).toBeNull();
  });
});
