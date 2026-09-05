import { describe, expect, it } from "vitest";
import { createDocument } from "../../game";
import { MemorySyncProvider, SyncEngine } from "./sync";

describe("optional local-first sync", () => {
  it("does not call a provider while disabled", async () => {
    const provider = new MemorySyncProvider();
    let persisted = 0;
    const engine = new SyncEngine({ enabled: false, provider, persistLocal: () => { persisted += 1; } });
    expect(await engine.syncNow(createDocument("离线"))).toBe("disabled");
    expect(persisted).toBe(0);
  });
  it("uploads after durable local persistence and reports synced", async () => {
    const provider = new MemorySyncProvider();
    const order: string[] = [];
    const document = createDocument("同步");
    const engine = new SyncEngine({ enabled: true, provider, persistLocal: () => { order.push("local"); } });
    expect(await engine.syncNow(document)).toBe("synced");
    expect(order).toEqual(["local"]);
    expect(await provider.get(document.id)).not.toBeNull();
  });
});
