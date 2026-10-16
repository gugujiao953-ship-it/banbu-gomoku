import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { formalBrowserRegressions } from "./regression-manifest.mjs";

describe("browser regression entry point", () => {
  it("imports a complete manifest with unique IDs and existing scripts", () => {
    expect(formalBrowserRegressions.length).toBeGreaterThan(0);
    expect(new Set(formalBrowserRegressions.map(({ id }) => id)).size).toBe(formalBrowserRegressions.length);
    expect(formalBrowserRegressions.filter(({ script }) => !existsSync(new URL(`../${script}`, import.meta.url))).map(({ id }) => id)).toEqual([]);
  });
});
