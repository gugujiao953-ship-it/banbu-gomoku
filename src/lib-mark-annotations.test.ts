import { describe, expect, it } from "vitest";
import { addMove, createDocument } from "./game";
import { exportSgf, importRecordFile, importRenLibLegacy } from "./formats";
import { exportLib } from "./lib-export";
import { libExportFromSource } from "./lib-source-export";
import { emptyDraft } from "./draft-operations";
import {
  LIB_MARK_GLYPH, applyMarksToLibDocument, decodeMarksComment, encodeMarksComment,
  libMarkText, restoreMarksFromComments,
} from "./lib-mark-annotations";
import type { BoardMark, GameDocument, RecordNode } from "./types";

const doc = (marks: Array<Partial<BoardMark> & { row: number; col: number }>) => {
  let d = createDocument("标注互通");
  const step = (parent: string, row: number, col: number) => {
    const added = addMove(d, parent, { row, col });
    d = added.document;
    return added.nodeId;
  };
  const m1 = step(d.rootId, 7, 7);
  const m2 = step(m1, 7, 8);
  step(m2, 6, 8);
  step(m1, 8, 8);
  d.nodes[m2] = {
    ...d.nodes[m2],
    marks: marks.map((mark) => ({ kind: "circle" as const, style: "circle" as const, color: "#2872b8", label: "", ...mark })),
  };
  return { document: d, markedId: m2 };
};

describe("标注随 LIB 出去（注释清单 + 已有节点贴字形，不改结构）", () => {
  it("形状用同形字形表示，整体不超过 4 个 GBK 字节", () => {
    expect(libMarkText({ row: 0, col: 0, kind: "circle", style: "circle" })).toBe("○");
    expect(libMarkText({ row: 0, col: 0, kind: "triangle", style: "triangle-solid", label: "胜" })).toBe("▲胜");
    // 字形 2 字节 + 文字最多 2 字节；「要点」放不下第二字
    expect(libMarkText({ row: 0, col: 0, kind: "square", style: "square-solid", label: "要点" })).toBe("■要");
    expect(libMarkText({ row: 0, col: 0, kind: "label", style: "text", label: "A" })).toBe("A");
    expect(libMarkText({ row: 0, col: 0, kind: "label", style: "text", label: "" })).toBe("");
  });

  it("注释清单可读，且能原样解析回来（形状/文字都保住）", () => {
    const marks: BoardMark[] = [
      { row: 3, col: 3, kind: "circle", style: "circle", label: "" },
      { row: 5, col: 9, kind: "triangle", style: "triangle-solid", label: "胜" },
      { row: 6, col: 6, kind: "label", style: "text", label: "要点" },
    ];
    const line = encodeMarksComment(marks, 15);
    // (6,6) → 列 6 = G、行 15-6 = 9，所以是 G9。
    expect(line).toBe("【标注】D12 ○ · J10 ▲胜 · G9 要点");
    const back = decodeMarksComment(line, 15);
    expect(back.comment).toBe("");
    expect(back.marks.map((m) => `${m.style}|${m.label}`)).toEqual(["circle|", "triangle-solid|胜", "text|要点"]);
  });

  it("注释清单**不截断**标注文字：4 字节上限只属于「盘面文字」那一格", () => {
    // 真丢字 bug：4 字节上限是官方核心 readBoardText 对**盘面文字那一格**的限制，
    // 而注释是长度自由的 GBK 文本。以前注释清单也走 libMarkText，于是用户写满 4 个字
    // （UI 允许的上限）会被砍成 1–2 个字：实测「要点提示」→「要」、「长文字测试」→「长文」。
    const marks: BoardMark[] = [
      { row: 3, col: 3, kind: "circle", style: "circle", label: "要点提示" },
      { row: 4, col: 4, kind: "cross", style: "cross", label: "ABCD" },
      { row: 5, col: 5, kind: "label", style: "text", label: "长文字测试" },
    ];
    const back = decodeMarksComment(encodeMarksComment(marks, 15), 15);
    expect(back.marks.map((m) => m.label)).toEqual(["要点提示", "ABCD", "长文字测试"]);
    // 盘面文字那一格仍然守 4 字节上限（不能被顺手放开）
    expect(libMarkText(marks[0])).toBe("○要");
  });

  it("端到端往返：空点标注导出后，我们自己的读取器读回来是**非着法节点**（不是一颗子）", async () => {
    // 这条守的是最关键的一点：造出来的节点**不能**被读成一手棋，否则棋盘上凭空多一颗子。
    // 生产路径过去走 SGF 转换桥（不认 NO_MOVE）会读成着法；我们自己的读取器认（info & 0x02）。
    const { document } = doc([{ row: 3, col: 3, style: "circle", kind: "circle", label: "" }]);
    const bytes = exportLib(applyMarksToLibDocument(document).document).bytes;
    const back = await importRenLibLegacy(new File([bytes], "t.lib", { type: "application/octet-stream" }), "t.lib");
    const nonMove = Object.values(back.document.nodes).filter((node) => !node.move && node.anchor);
    expect(nonMove).toHaveLength(1);
    expect(nonMove[0].anchor).toEqual({ row: 3, col: 3 });
    expect(nonMove[0].boardText).toBe("○");
    // 步数一手不差：标注没有被算成一手棋
    const countMoves = (target: GameDocument) => Object.values(target.nodes).filter((node) => node.move).length;
    expect(countMoves(back.document)).toBe(countMoves(document));
  });

  it("标在**已走过的点**和**别的分支的点**上也要落到棋盘（以前掉进注释清单）", () => {
    // 用户 09-17 报「我在半步里的标注，到对局软件里变成了注释」。
    // 根因：落点查找只在**标注所属节点的子树**里找，于是
    //   · (7,7) 是祖先那一手（复盘最常见用法「这手是关键」）
    //   · (8,8) 是同一父节点下的**另一个分支**
    // 两个都找不到 → 双双进了注释清单。注释在对局软件里只会显示成一条注释，棋盘上没有标记。
    const { document } = doc([{ row: 7, col: 7 }, { row: 8, col: 8 }]);
    const after = applyMarksToLibDocument(document).document;
    // 两处都应该写成盘面文字（对局软件据此在棋盘上画字形）
    const written = Object.entries(after.nodes).filter(([, n]) => n.boardText).map(([, n]) => `${n.move?.row},${n.move?.col}=${n.boardText}`).sort();
    expect(written).toEqual(["7,7=○", "8,8=○"]);
    // 一个都不许留在注释清单里
    const comments = Object.values(after.nodes).map((n) => n.comment || "").join("\n");
    expect(comments).not.toContain("【标注】");
  });

  it("真空点：给它造一个**非着法节点**（对局软件画成棋盘标记，且不是一手棋）", () => {
    // 生态里唯一的写法：官方文档层只有按节点挂标记的接口（`RenLibDoc.addBoardText(pMove, text)`），
    // 而带 NO_MOVE 的节点在官方读取器里**不算着法**（装载时 `if (isMove()) nNewMoves++`），
    // 所以它不消耗轮次、不打乱黑白——比"棋盘上多一颗子"轻得多。用户 09-17 明确不接受退成注释。
    const { document, markedId } = doc([{ row: 3, col: 3 }]);
    const result = applyMarksToLibDocument(document);
    expect(result.annotationNodes).toBe(1);
    const created = Object.values(result.document.nodes).find((node) => !node.move && node.anchor);
    expect(created?.anchor).toEqual({ row: 3, col: 3 });
    expect(created?.boardText).toBe("○");
    expect(created?.move).toBeNull();                       // 绝不是着法
    expect(created?.parentId).toBe(markedId);                // 挂在标注所属节点下
    // 该点不再出现在注释清单里（用户就是不要它变注释）
    expect(Object.values(result.document.nodes).map((n) => n.comment || "").join("\n")).not.toContain("D12");
    // 主线偏好不能被标注改动
    expect(result.document.nodes[document.rootId].preferredChildId).toBe(document.nodes[document.rootId].preferredChildId);
  });

  it("空点标注的完整文字不许丢：装不进 4 字节的部分落在该节点自己的注释里", () => {
    const { document } = doc([
      { row: 3, col: 3, style: "circle", kind: "circle", label: "要点提示" },
      { row: 5, col: 5, style: "text", kind: "label", label: "长文字测试" },
    ]);
    const after = applyMarksToLibDocument(document).document;
    const created = Object.values(after.nodes).filter((node) => !node.move && node.anchor).sort((a, b) => a.anchor!.row - b.anchor!.row);
    expect(created).toHaveLength(2);
    // 盘面文字那一格受官方核心 4 字节上限（对局软件也只能显示这么多）
    expect(created[0].boardText).toBe("○要");
    expect(created[1].boardText).toBe("长文");
    // 完整文字必须落在文件里，否则信息就丢了
    expect(created[0].comment).toBe("○要点提示");
    expect(created[1].comment).toBe("长文字测试");
  });

  it("同一格两个标注：第二个进注释清单（一格只能一个标签），且再导出不会越写越长", () => {
    const { document, markedId } = doc([
      { row: 3, col: 3, style: "circle", kind: "circle", label: "" },
      { row: 3, col: 3, style: "cross", kind: "cross", label: "" },
    ]);
    document.nodes[markedId] = { ...document.nodes[markedId], comment: "原有注释" };
    const once = applyMarksToLibDocument(document).document;
    expect(once.nodes[markedId].comment).toBe("原有注释\n【标注】D12 ×");
    const twice = applyMarksToLibDocument(once).document;
    expect(twice.nodes[markedId].comment).toBe("原有注释\n【标注】D12 ×");
  });

  it("不损伤原有分支：既有节点的兄弟顺序与主线偏好都不动，新增的只是「非着法节点」", () => {
    const { document, markedId } = doc([{ row: 3, col: 3 }, { row: 5, col: 9 }]);
    const after = applyMarksToLibDocument(document).document;
    // 既有节点逐个对比：原有子节点**顺序不变**（新标注节点只追加在后面）、主线偏好一字不动
    for (const [id, node] of Object.entries(document.nodes)) {
      expect(after.nodes[id].children.slice(0, node.children.length), `${id} 的原有子节点顺序`).toEqual(node.children);
      expect(after.nodes[id].preferredChildId, `${id} 的主线偏好`).toBe(node.preferredChildId);
    }
    // 新增的只能是"非着法节点"，且只挂在标注所属节点下
    const added = Object.keys(after.nodes).filter((id) => !document.nodes[id]);
    expect(added).toHaveLength(2);
    for (const id of added) {
      expect(after.nodes[id].move).toBeNull();
      expect(after.nodes[id].parentId).toBe(markedId);
    }
    // 原有盘面文字也不能被覆盖
    const withLabel = { ...document, nodes: { ...document.nodes, [markedId]: { ...document.nodes[markedId], boardText: "原标签" } } };
    expect(applyMarksToLibDocument(withLabel).document.nodes[markedId].boardText).toBe("原标签");
  });

  it("标在本手位置或已有分支上时，顺手写进盘面文字（对方棋盘上能看到字形）", () => {
    const { document, markedId } = doc([{ row: 7, col: 8 }]);   // 正好是本手位置
    const after = applyMarksToLibDocument(document).document;
    expect(after.nodes[markedId].boardText).toBe("○");

    // (6,8) 正是 markedId 这个节点已有的一个分支
    const branch = doc([{ row: 6, col: 8 }]);
    const branchAfter = applyMarksToLibDocument(branch.document).document;
    const childId = branchAfter.nodes[branch.markedId].children[0];
    expect(branchAfter.nodes[childId].boardText).toBe("○");
  });

  it("还原是幂等的：导出→导入→再导出，标注不会越还原越多", () => {
    const { document } = doc([{ row: 3, col: 3 }, { row: 5, col: 9, style: "triangle-solid", kind: "triangle", label: "胜" }]);
    const exported = applyMarksToLibDocument(document).document;
    const once = restoreMarksFromComments(exported);
    const twice = restoreMarksFromComments(once);
    const count = (d: GameDocument) => Object.values(d.nodes).flatMap((n) => n.marks || []).length;
    expect(count(once)).toBe(2);
    expect(count(twice)).toBe(2);
    // 注释里的标注行已被摘掉，不会把「【标注】」当成正文留在注释里
    expect(Object.values(once.nodes).some((n) => n.comment.includes("【标注】"))).toBe(false);
  });

  it("落在棋子/已有分支上的标注写进盘面文字 —— 这就是对局软件认的「图形标记」通道", () => {
    // 小工具画标记 = innerHTML 一个字符（CheckerBoard.js:376 printLb），
    // 读棋谱 = 把 boardText 当标记画（renju_control.js:2047 wLb）。所以字形进 boardText 即可。
    const { document, markedId } = doc([
      { row: 7, col: 8, style: "triangle-solid", kind: "triangle", label: "胜" },   // 本手位置
      { row: 6, col: 8, style: "circle", kind: "circle" },                          // 已有分支
    ]);
    const after = applyMarksToLibDocument(document).document;
    const texts = Object.values(after.nodes).map((n) => n.boardText).filter(Boolean).sort();
    expect(texts).toEqual(["○", "▲胜"].sort());
    void markedId;
  });

  it("一个节点只能带一个盘面文字（4 字节上限），多出来的走注释清单，信息不丢", () => {
    // 同一个节点上放 2 个标注 → 只有 1 个能上棋盘（boardText 一格只能一个标签），
    // 另一个进注释清单。这是格式容量限制，必须保证「信息不丢」。
    const { document, markedId } = doc([
      { row: 7, col: 8, style: "circle", kind: "circle" },
      { row: 6, col: 8, style: "cross", kind: "cross" },
    ]);
    const after = applyMarksToLibDocument(document).document;
    const onBoard = Object.values(after.nodes).map((n) => n.boardText).filter(Boolean);
    const comment = after.nodes[markedId].comment || "";
    expect(onBoard.length).toBeGreaterThanOrEqual(1);
    // 没上棋盘的至少要在注释里出现，且【标注】行一定写了
    const restored = Object.values(restoreMarksFromComments(after).nodes).flatMap((n) => n.marks || []);
    expect(restored.length).toBe(2);
    expect(comment.includes("【标注】") || onBoard.length === 2).toBe(true);
  });

  it("原库自带的盘面文字优先：我们的标注让位走注释，绝不挤掉原作者的标注", () => {
    // 实测九天指南的变化点上写着「九天」。抢掉读者原有信息去腾地方给我们的标注，
    // 比让标注退回注释糟糕得多，所以有原文字时标注让位。
    const { document, markedId } = doc([{ row: 7, col: 8, style: "circle", kind: "circle" }]);
    document.nodes[markedId] = { ...document.nodes[markedId], boardText: "九天" };
    const applied = applyMarksToLibDocument(document);
    const after = applied.document;
    expect(after.nodes[markedId].boardText).toBe("九天");                 // 原文字原封不动
    expect(after.nodes[markedId].comment).toContain("【标注】");           // 标注退到注释，信息不丢
    expect(after.nodes[markedId].comment).toContain("○");
    expect(applied.overwrittenBoardText).toBe(1);
    expect(Object.values(restoreMarksFromComments(after).nodes).flatMap((n) => n.marks || []).length).toBeGreaterThanOrEqual(1);
  });

  it("我们自己上一次写进去的字形会被改写（反复导出幂等，不会越堆越多）", () => {
    const { document, markedId } = doc([{ row: 7, col: 8, style: "circle", kind: "circle" }]);
    const once = applyMarksToLibDocument(document).document;
    expect(once.nodes[markedId].boardText).toBe("○");
    const twice = applyMarksToLibDocument(once).document;
    expect(twice.nodes[markedId].boardText).toBe("○");
    expect(twice.nodes[markedId].comment).toBe(once.nodes[markedId].comment);
  });

  it("标在**更深**的后续着法上也能落到棋盘（只找直接子节点会漏）", () => {
    // 实测 bug：hh→ih→ig 的局面里，标在 ig 的标注因为不是 hh 的直接子节点而被漏掉、
    // 白白退进注释。现在按子树找。
    const { document, markedId } = doc([
      { row: 7, col: 8, style: "triangle-solid", kind: "triangle" },   // 直接子节点
      { row: 3, col: 3, style: "circle", kind: "circle" },             // 更深处（3,3 不在本谱）
    ]);
    // 手工造一个「深一级」的节点挂在已有的 (6,8) 之后
    const deepParent = document.nodes[markedId].children[0];
    const deepId = "deep-node";
    document.nodes[deepId] = { id: deepId, parentId: deepParent, children: [], move: { row: 6, col: 9, player: "black" }, comment: "", marks: [] };
    document.nodes[deepParent] = { ...document.nodes[deepParent], children: [...document.nodes[deepParent].children, deepId] };
    document.nodes[markedId] = { ...document.nodes[markedId], marks: [{ row: 6, col: 9, style: "check", kind: "check", label: "" }] };
    const after = applyMarksToLibDocument(document).document;
    // 标在深一层的 (6,9) 上 → 必须写进那个深层节点的盘面文字，而不是退进注释
    expect(after.nodes[deepId].boardText).toBe("√");
    expect(after.nodes[markedId].comment).not.toContain("√");
  });

  it("链式标注不会被自己这轮覆盖：A 标在 B、B 又标在 C，两条盘面文字都要在", () => {
    // 实测 bug：处理节点 B 时用 document.nodes 里的**原始**对象当底整体写回，
    // 把上一步刚写进 B 的盘面文字覆盖掉了——连续三个节点各带标记时只剩最后一个存活。
    let d = createDocument("链式");
    const A = addMove(d, d.rootId, { row: 7, col: 7 }); d = A.document;
    const B = addMove(d, A.nodeId, { row: 7, col: 8 }); d = B.document;
    const C = addMove(d, B.nodeId, { row: 6, col: 8 }); d = C.document;
    addMove(d, C.nodeId, { row: 6, col: 9 });
    d.nodes[A.nodeId] = { ...d.nodes[A.nodeId], marks: [{ row: 7, col: 8, kind: "circle", style: "circle", label: "" }] };
    d.nodes[B.nodeId] = { ...d.nodes[B.nodeId], marks: [{ row: 6, col: 8, kind: "triangle", style: "triangle-solid", label: "" }] };
    const after = applyMarksToLibDocument(d).document;
    expect(after.nodes[B.nodeId].boardText).toBe("○");
    expect(after.nodes[C.nodeId].boardText).toBe("▲");
  });

  it("端到端：外来 LIB（每手一个标记）经完整原谱通道再导出，标记一个不少", async () => {
    // 小工具 / 爱五子棋 / 九天指南 的棋谱就是「连续几手各带一个盘面文字」的形态。
    // 这条链路里 restoreBoardTextFromLabels 曾用快照写回，把前两个标记覆盖掉，只剩最后一个。
    // SGF 声明 CA[gb2312]，所以字形必须是**真的 GBK 字节**（按 UTF-8 编码会读成乱码）。
    const GBK: Record<string, number[]> = { "○": [0xa1, 0xf0], "▲": [0xa1, 0xf8], "■": [0xa1, 0xf6] };
    const toGbk = (text: string) =>
      Uint8Array.from([...text].flatMap((ch) => GBK[ch] ?? [...new TextEncoder().encode(ch)]));
    const buffer = toGbk("(;GM[1]CA[gb2312]SZ[15];B[hh]LB[ih:○];W[ih]LB[ig:▲];B[ig]LB[jg:■];W[jg])").buffer;
    const result = await libExportFromSource({
      session: { exportOriginalSgf: async () => buffer },
      draft: emptyDraft(),
      viewDocument: (await importRecordFile(new File([buffer], "v.sgf", { type: "application/x-go-sgf" }))).document,
      fallback: createDocument("fallback"),
    });
    const has = (pattern: number[]) => result.bytes.some((_, i) => pattern.every((b, j) => result.bytes[i + j] === b));
    expect(result.complete).toBe(true);
    expect(has([0xa1, 0xf0])).toBe(true);   // ○
    expect(has([0xa1, 0xf8])).toBe(true);   // ▲
    expect(has([0xa1, 0xf6])).toBe(true);   // ■
  });

  it("压力回归：**每一手**都带标记时，LIB 往返一个都不许少", async () => {
    // 防「快照写回覆盖」那一类 bug 的**行为护栏**：该类 bug 只在「连续多个节点都被写入」
    // 时暴露，一两个节点测不出来。
    //
    // 关键：底板必须是**核心 lib2sgf 那种形态**——盘面文字写成父节点上的
    // `LB[子节点位置:文字]`（这是官方核心的编码方式），才会走到 restoreBoardTextFromLabels。
    // 用我们自己的 exportSgf 当底板是不行的：它把盘面文字写成 `N[]`，根本不经那条路径
    // （反向验证时实测过：那样写护栏对旧 bug 照样通过，等于没测）。
    const GLYPHS = ["○", "●", "△", "▲", "■", "◆", "×", "√"];
    const GBK: Record<string, number[]> = {
      "○": [0xa1, 0xf0], "●": [0xa1, 0xf1], "△": [0xa1, 0xf7], "▲": [0xa1, 0xf8],
      "■": [0xa1, 0xf6], "◆": [0xa1, 0xf4], "×": [0xa1, 0xc1], "√": [0xa1, 0xcc],
    };
    const coord = (row: number, col: number) => `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`;
    // 8 手斜向排开；每手的盘面文字按核心约定写在**父节点**上、指向自己
    let sgf = "(;GM[1]CA[gb2312]SZ[15]";
    for (let i = 0; i < GLYPHS.length; i += 1) {
      const row = 3 + i, col = 3 + i;
      const player = i % 2 === 0 ? "B" : "W";
      sgf += `;${player}[${coord(row, col)}]`;
      if (i + 1 < GLYPHS.length) {
        const nextRow = 4 + i, nextCol = 4 + i;
        sgf += `LB[${coord(nextRow, nextCol)}:${GLYPHS[i + 1]}]`;
      }
    }
    sgf += ")";
    const toGbk = (text: string) => Uint8Array.from([...text].flatMap((ch) => GBK[ch] ?? [...new TextEncoder().encode(ch)]));
    const buffer = toGbk(sgf).buffer;
    const result = await libExportFromSource({
      session: { exportOriginalSgf: async () => buffer },
      draft: emptyDraft(),
      viewDocument: (await importRecordFile(new File([buffer], "s.sgf", { type: "application/x-go-sgf" }))).document,
      fallback: createDocument("fallback"),
    });
    const has = (pattern: number[]) => result.bytes.some((_, i) => pattern.every((b, j) => result.bytes[i + j] === b));
    // 下标 1..7 的标记（第 0 个没有父节点可挂）必须一个不少
    const missing = GLYPHS.slice(1).filter((glyph) => !has(GBK[glyph]));
    expect(missing).toEqual([]);
  });

  it("端到端：经真实 exportLib 出去，标注真的写进了文件字节", async () => {
    const { document } = doc([{ row: 3, col: 3 }, { row: 5, col: 9, style: "check", kind: "check", label: "" }]);
    const plain = exportLib(document).bytes;
    const annotated = exportLib(applyMarksToLibDocument(document).document).bytes;
    expect(annotated.length).toBeGreaterThan(plain.length);   // 多了两个非着法节点
    // 直接找 GBK 字节，不整段解码（把二进制整段当 GBK 解会错位，读不出标记）
    const has = (bytes: Uint8Array, pattern: number[]) =>
      bytes.some((_, i) => pattern.every((b, j) => bytes[i + j] === b));
    expect(has(annotated, [0xa1, 0xf0])).toBe(true);   // ○
    expect(has(annotated, [0xa1, 0xcc])).toBe(true);   // √（对勾）
    // 09-17 起空点标注**不再**靠注释清单，字形是写在节点自己的盘面文字上的
    const markerGbk = [0xa1, 0xbe, 0xb1, 0xea, 0xd7, 0xa2, 0xa1, 0xbf];  // 【标注】
    expect(has(annotated, markerGbk)).toBe(false);
  });

  it("认不出的标注行原样保留，不吞用户注释", () => {
    const decoded = decodeMarksComment("正文\n【标注】不是坐标的东西", 15);
    expect(decoded.comment).toContain("不是坐标的东西");
  });

  it("每个画法都有 GBK 字形（除纯文字画法）", () => {
    for (const [style, glyph] of Object.entries(LIB_MARK_GLYPH)) {
      if (style === "text") { expect(glyph).toBe(""); continue; }
      expect(glyph.length).toBeGreaterThan(0);
      expect(libMarkText({ row: 0, col: 0, kind: "circle", style: style as never })).toBe(glyph);
    }
  });
});
