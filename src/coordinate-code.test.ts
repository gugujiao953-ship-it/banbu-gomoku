import { describe, expect, it } from "vitest";
import { addMove, coordinateName } from "./game";
import type { GameDocument } from "./types";
import { branchCountOf, buildDocumentFromCoordinateCode, formatCoordinateCode, mainLineBranchCount, parseCoordinateCode } from "./coordinate-code";

const names = (positions: ReadonlyArray<{ row: number; col: number }>, size = 15) => positions.map((position) => coordinateName(position, size));

describe("坐标代码解析", () => {
  it("空格、逗号、分号、换行、顿号分隔都读得懂", () => {
    for (const text of ["H8 I9 H10", "H8,I9;H10", "H8\nI9\tH10", "H8、I9、H10", "H8|I9/H10"]) {
      expect(names(parseCoordinateCode(text, 15).positions)).toEqual(["H8", "I9", "H10"]);
    }
  });

  it("连续写法与全角字符都读得懂", () => {
    expect(names(parseCoordinateCode("h8i9h10", 15).positions)).toEqual(["H8", "I9", "H10"]);
    expect(names(parseCoordinateCode("Ｈ８　Ｉ９", 15).positions)).toEqual(["H8", "I9"]);
  });

  it("带手数前缀、颜色标记、数字在前的写法都读得懂", () => {
    expect(names(parseCoordinateCode("1.H8 2.I9 (3)H10", 15).positions)).toEqual(["H8", "I9", "H10"]);
    expect(names(parseCoordinateCode("8H 9I", 15).positions)).toEqual(["H8", "I9"]);
    const colored = parseCoordinateCode("黑 H8 白 I9", 15);
    expect(names(colored.positions)).toEqual(["H8", "I9"]);
    expect(colored.colorMarkers).toBe(2);
    expect(colored.warnings).toEqual([]);
  });

  it("路数决定合法字母与行号", () => {
    expect(names(parseCoordinateCode("P8", 15).positions)).toEqual([]);
    expect(names(parseCoordinateCode("P8", 17).positions, 17)).toEqual(["P8"]);
    const overflow = parseCoordinateCode("H16", 15);
    expect(overflow.positions).toEqual([]);
    expect(overflow.warnings.join()).toContain("超出 15 路范围");
  });

  it("越界、重复、看不懂的片段如实报数并跳过", () => {
    const parsed = parseCoordinateCode("H8 H8 zz H16 I9", 15);
    expect(names(parsed.positions)).toEqual(["H8", "I9"]);
    expect(parsed.skipped).toBe(3);
    expect(parsed.warnings.join()).toContain("重复");
    expect(parsed.warnings.join()).toContain("看不懂");
    expect(parsed.warnings.join()).toContain("超出");
  });

  it("颜色标记与黑白交替不一致时提示，但仍按交替上色", () => {
    const parsed = parseCoordinateCode("黑 H8 黑 I9", 15);
    expect(names(parsed.positions)).toEqual(["H8", "I9"]);
    expect(parsed.warnings.join()).toContain("不一致");
  });

  it("空输入与非法路数都不抛错", () => {
    expect(parseCoordinateCode("", 15).positions).toEqual([]);
    expect(parseCoordinateCode("   \n  ", 15).positions).toEqual([]);
    const bad = parseCoordinateCode("H8", 40);
    expect(bad.positions).toEqual([]);
    expect(bad.warnings.join()).toContain("5–30");
  });
});

describe("坐标代码生成与往返", () => {
  it("生成棋谱：路数正确、手数一致、颜色按落子顺序交替", () => {
    const document = buildDocumentFromCoordinateCode(parseCoordinateCode("H8 I9 H10", 15).positions, 15);
    expect(document.metadata.boardSize).toBe(15);
    expect(formatCoordinateCode(document)).toBe("H8 I9 H10");
    let node = document.nodes[document.rootId];
    const players: string[] = [];
    while (node?.children.length) {
      const next = document.nodes[node.preferredChildId || node.children[0]];
      if (!next) break;
      if (next.move) players.push(next.move.player);
      node = next;
    }
    expect(players).toEqual(["black", "white", "black"]);
  });

  it("棋谱 → 代码 → 棋谱 逐手一致", () => {
    const source = buildDocumentFromCoordinateCode(parseCoordinateCode("H8 I9 J10 K11", 15).positions, 15);
    const code = formatCoordinateCode(source);
    expect(code).toBe("H8 I9 J10 K11");
    const rebuilt = buildDocumentFromCoordinateCode(parseCoordinateCode(code, 15).positions, 15);
    expect(formatCoordinateCode(rebuilt)).toBe(code);
  });

  it("分支点计数只数主线上的分叉，主线仍按 preferredChildId 走", () => {
    const base = buildDocumentFromCoordinateCode(parseCoordinateCode("H8 I9", 15).positions, 15);
    expect(mainLineBranchCount(base)).toBe(0);
    // 在根节点再加一个变化：根成为分支点，同时新落子成为首选子（addMove 的既有语义），
    // 所以代码会跟着首选子走——这里断言的是"只含一条线"，不是"含所有分支"。
    const branched = addMove(base, base.rootId, { row: 8, col: 8 }).document;
    expect(mainLineBranchCount(branched)).toBe(1);
    expect(formatCoordinateCode(branched)).toBe("I7");
  });

  it("懒加载棋谱：未读回来的分支也要算进分支数（2026-10-10 同类 bug）", () => {
    // DP/DB 局面库与 RenLib 网页核心读的 .lib，文档只是投影：没问过的分支只记
    // `unloadedChildren`、没有节点。旧实现只看 children.length，于是
    // 「库里 11 支、已加载 0 支」会报 0 处分支——而棋盘与树上明明写着「还有 11 支」。
    const base = buildDocumentFromCoordinateCode(parseCoordinateCode("H8 I9", 15).positions, 15);
    const rootId = base.rootId;
    const root = base.nodes[rootId];
    const unresolved: GameDocument = {
      ...base,
      nodes: { ...base.nodes, [rootId]: { ...root, unloadedChildren: 11 } },
    };
    // branchCountOf 把「已加载 + 未加载」都算进去：这里 1 个已加载孩子 + 11 支未读回来 = 12。
    // 旧口径只看 children.length（=1），会漏掉那 11 支——真实库上实测就是「报 0、库里 11」。
    expect(branchCountOf(unresolved.nodes[rootId])).toBe(root.children.length + 11);
    expect(branchCountOf(unresolved.nodes[rootId])).toBeGreaterThan(root.children.length);

    // 对照：完全加载的双分支文档，两个口径一致（不误伤正常棋谱）
    const branched = addMove(base, base.rootId, { row: 8, col: 8 }).document;
    const branchedRoot = branched.nodes[branched.rootId];
    expect(branchCountOf(branchedRoot)).toBe(branchedRoot.children.length);
    expect(mainLineBranchCount(branched)).toBe(1);
  });
});
