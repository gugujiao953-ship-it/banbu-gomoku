import { describe, expect, it } from "vitest";
import { createDocument } from "../../game";
import { createExportEnvelope, filenameForExport, parseExportEnvelope, serializeExportEnvelope } from "./export-semantics";

describe("export semantics", () => {
  it("writes explicit scope, purpose, metadata and verifies payload hash", () => {
    const document = createDocument("语义棋谱");
    const envelope = createExportEnvelope(document, { appVersion: "1.1.6", scope: "full-tree", format: "json" });
    const parsed = parseExportEnvelope(serializeExportEnvelope(envelope));
    expect(parsed.summary.scope).toBe("full-tree");
    expect(parsed.summary.includes.metadata).toBe(true);
    expect(parsed.contentHash).toBe(envelope.contentHash);
  });
  it("migrates the existing v1 backup envelope", () => {
    const parsed = parseExportEnvelope(JSON.stringify({ schema: "banbu-gomoku-backup", version: 1, appVersion: "1.0", exportedAt: "2026-08-30T00:00:00.000Z", localStorage: {}, indexedDb: {} }));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.scope).toBe("library-backup");
  });
  it("uses readable, unambiguous filenames", () => {
    expect(filenameForExport("A/B", "current-variation", "json", new Date("2026-08-30T00:00:00.000Z"))).toContain("A-B-当前分支");
  });
});
