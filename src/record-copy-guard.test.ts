import { describe, expect, it } from "vitest";
import { createModificationCopy, storedRecordHasMoveOrder } from "./record-editing";
import type { GameDocument, RecordNode } from "./types";

/** 只填这两个纯函数真正会读的字段，整份 metadata 的无关改动不该连带把测试弄坏。 */
const node = (id: string, parentId: string | null, children: string[] = []): RecordNode => ({
  id, parentId, children, move: null, comment: "", marks: [],
});

const documentWith = (root: RecordNode, extra: RecordNode[] = [], title = "测试谱", boardSize = 15) => ({
  id: "doc-1", version: 1, rootId: root.id,
  nodes: { [root.id]: root, ...Object.fromEntries(extra.map((item) => [item.id, item])) },
  metadata: { title, boardSize },
  createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z",
} as unknown as GameDocument);

describe("原谱保护的两个纯函数（用户 2026-09-28：去子/位移静默覆盖原谱＝会坏谱）", () => {
  it("库里那份带手序才算「拍平会弄坏它」", () => {
    expect(storedRecordHasMoveOrder(documentWith(node("r", null, ["m1"]), [node("m1", "r", ["m2"])]))).toBe(true);
  });

  it("库里本来就是静态局面（识谱导入那类）→ 拍平不丢已保存的手序，不该弹三选", () => {
    expect(storedRecordHasMoveOrder(documentWith(node("r", null, [])))).toBe(false);
  });

  it("库里没有这一份（新建的、刚导入还没入库）→ 没有可坏的原谱", () => {
    expect(storedRecordHasMoveOrder(undefined)).toBe(false);
    expect(storedRecordHasMoveOrder(null)).toBe(false);
  });

  it("缺 rootId / 缺 nodes 的坏数据不炸，按「不会弄坏」处理", () => {
    expect(storedRecordHasMoveOrder({} as unknown as GameDocument)).toBe(false);
    expect(storedRecordHasMoveOrder({ id: "x", rootId: "missing", nodes: {} } as unknown as GameDocument)).toBe(false);
  });

  it("修改副本：独立 id、标题写明「· 修改副本」，且是深拷贝（动副本不碰原谱）", () => {
    const source = documentWith(node("r", null, ["m1"]), [node("m1", "r")]);
    const copy = createModificationCopy(source, "m1", { token: "test" });
    expect(copy.id).toBe("doc-1-copy-test");
    expect(copy.metadata.title).toBe("测试谱 · 修改副本");
    expect(copy.savedCurrentId).toBe("m1");
    // 深拷贝：副本里把根节点的子分支清空，原谱那份必须还带着 m1。
    (copy.nodes.r as RecordNode).children = [];
    expect(source.nodes.r.children).toEqual(["m1"]);
  });

  it("副本指向不存在的 currentId 时退回根节点，不留下一个指不到节点的棋谱", () => {
    const source = documentWith(node("r", null, ["m1"]), [node("m1", "r")]);
    expect(createModificationCopy(source, "不存在的节点", { token: "t2" }).savedCurrentId).toBe("r");
  });

  it("已经带「· 编辑副本 / · 修改副本」的标题不会被越叠越长", () => {
    const study = documentWith(node("r", null, []), [], "九天指南 · 编辑副本");
    expect(createModificationCopy(study, "r", { token: "t3" }).metadata.title).toBe("九天指南 · 修改副本");
    const again = documentWith(node("r", null, []), [], "九天指南 · 修改副本");
    expect(createModificationCopy(again, "r", { token: "t4" }).metadata.title).toBe("九天指南 · 修改副本");
  });
});
