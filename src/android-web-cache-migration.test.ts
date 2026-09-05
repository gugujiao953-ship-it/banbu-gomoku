// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android bundled web UI migration", () => {
  it("keeps the WebView cache-clearing migration and ties gradle version to package.json", () => {
    const activity = readFileSync(new URL("../android/app/src/main/java/cn/renjunote/mobile/MainActivity.java", import.meta.url), "utf8");
    const gradle = readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

    expect(activity).toContain("service_worker_cache_cleared_v116_ui3");
    expect(activity).toContain("clearCache(true)");
    expect(activity).toContain("getWebView().reload()");
    expect(activity).not.toContain("WebStorage.getInstance().deleteAllData");
    expect(activity).not.toContain("deleteDatabase");
    expect(gradle).toMatch(/versionCode\s+\d+\b/);
    expect(gradle).toContain(`versionName "${pkg.version}"`);
  });
});
