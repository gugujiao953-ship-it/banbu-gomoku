import { describe, expect, it } from "vitest";
import { createDocument } from "./game";
import { exportJson, exportPos, exportSgf, importRecordFile, mainLinePassCount } from "./formats";
import { exportPsq } from "./lib-export";
import type { GameDocument, RecordNode } from "./types";

/**
 * 导出/导入无缝性总表：一份「什么都有」的棋谱，逐一验证每种导出格式能带回什么。
 *
 * 这里守的是用户口径「所有格式都要完美」：**能表达的东西必须一字不差地回来**，
 * 表达不了的东西（PSQ / POS 只有主线；LIB 由 qa/lib-reader-parity.mjs 用官方核心核）
 * 必须是格式本身的限制，而不是我们转丢了。
 */

interface NodeSpec {
  row: number; col: number; player: "black" | "white";
  comment?: string; boardText?: string;
  marks?: Array<{ row: number; col: number; kind: "circle" | "triangle" | "cross" | "label"; label?: string }>;
  evaluation?: "good" | "bad" | "doubtful" | "interesting";
  startPosition?: boolean;
  pass?: boolean;
  setup?: { black: Array<{ row: number; col: number }>; white: Array<{ row: number; col: number }> };
  children?: NodeSpec[];
}

/** 结构签名：落子/过手/摆局 + 注释 + 标注 + 评价 + 起始标记，子节点按顺序展开。 */
const signature = (document: GameDocument, id: string): string => {
  const node = document.nodes[id];
  if (!node) return "missing";
  const own = node.move
    ? `${node.move.player[0]}:${node.move.row},${node.move.col}`
    : node.passPlayer ? `pass:${node.passPlayer}` : node.anchor ? `anchor:${node.anchor.row},${node.anchor.col}` : "root";
  const bits = [
    node.comment ? `C(${node.comment})` : "",
    node.boardText ? `N(${node.boardText})` : "",
    node.marks.length ? `M(${node.marks.map((mark) => `${mark.kind}@${mark.row},${mark.col}${mark.label ? `:${mark.label}` : ""}`).sort().join("+")})` : "",
    node.evaluation ? `E(${node.evaluation}${node.evaluationLevel || 1})` : "",
    node.startPosition ? "S" : "",
    node.setup ? `AB(${node.setup.black.map((point) => `${point.row},${point.col}`).sort().join("+")})AW(${node.setup.white.map((point) => `${point.row},${point.col}`).sort().join("+")})` : "",
  ].filter(Boolean).join(" ");
  const children = node.children.map((child) => signature(document, child)).join("|");
  return `${own}${bits ? `[${bits}]` : ""}{${children}}`;
};

const buildRichDocument = (): GameDocument => {
  const document = createDocument("rich");
  const nodes: Record<string, RecordNode> = { ...document.nodes };
  let sequence = 0;
  const attach = (parentId: string, spec: NodeSpec): string => {
    sequence += 1;
    const id = `n${sequence}`;
    const node: RecordNode = {
      id, parentId, children: [],
      move: spec.pass ? null : { row: spec.row, col: spec.col, player: spec.player },
      comment: spec.comment || "",
      marks: spec.marks || [],
      ...(spec.pass ? { passPlayer: spec.player } : {}),
      ...(spec.boardText ? { boardText: spec.boardText } : {}),
      ...(spec.evaluation ? { evaluation: spec.evaluation, evaluationLevel: 1 as const } : {}),
      ...(spec.startPosition ? { startPosition: true } : {}),
      ...(spec.setup ? { setup: { black: spec.setup.black, white: spec.setup.white, empty: [] } } : {}),
    };
    nodes[id] = node;
    nodes[parentId] = { ...nodes[parentId], children: [...nodes[parentId].children, id] };
    for (const child of spec.children || []) attach(id, child);
    return id;
  };
  attach(document.rootId, {
    row: 7, col: 7, player: "black",
    comment: "第一手注释\n第二行（多行）", boardText: "开局", startPosition: true,
    marks: [{ row: 7, col: 7, kind: "circle" }, { row: 6, col: 6, kind: "label", label: "A" }],
    children: [
      {
        row: 7, col: 8, player: "white", comment: "白2", evaluation: "good",
        children: [
          { row: 6, col: 8, player: "black", comment: "主线的黑3" },
          { row: 8, col: 8, player: "black", marks: [{ row: 8, col: 8, kind: "triangle" }], children: [{ row: 8, col: 9, player: "white" }] },
        ],
      },
      { row: 6, col: 6, player: "white", comment: "另一分支" },
    ],
  });
  const document2: GameDocument = {
    ...document,
    nodes,
    metadata: {
      ...document.metadata,
      black: "黑方甲", white: "白方乙", event: "测试赛", date: "2026-09-16",
      result: "B+1", rule: "renju", round: "第 3 轮", place: "线上", blackRank: "5段", whiteRank: "4段",
      komi: "0", timeLimit: "30分", overtime: "3×30秒", openingName: "瑞星", annotator: "张三",
      copyright: "CC BY 4.0", sourceUrl: "https://www.renju.net/game/1/",
    },
  };
  return document2;
};

const importDocument = async (text: string, name: string): Promise<GameDocument> =>
  (await importRecordFile(new File([text], name))).document;

describe("导出/导入无缝性", () => {
  it("SGF 全族（sgf/fgf/ren/renjs/wzq）：结构、注释、标注、评价、起始标记、对弈信息全部原样回来", async () => {
    const source = buildRichDocument();
    const expected = signature(source, source.rootId);
    const text = exportSgf(source);
    for (const extension of ["sgf", "fgf", "ren", "renjs", "wzq"]) {
      const imported = await importDocument(text, `roundtrip.${extension}`);
      expect(signature(imported, imported.rootId), `${extension} 的结构签名`).toBe(expected);
      const meta = imported.metadata;
      for (const key of ["black", "white", "event", "date", "result", "round", "place", "blackRank", "whiteRank", "komi", "timeLimit", "overtime", "openingName", "annotator", "copyright", "sourceUrl"] as const) {
        expect(meta[key], `${extension} 的 ${key}`).toBe(source.metadata[key]);
      }
    }
  });

  it("JSON：结构与全部元数据逐字段一致", async () => {
    const source = buildRichDocument();
    const imported = await importDocument(exportJson(source), "roundtrip.json");
    expect(signature(imported, imported.rootId)).toBe(signature(source, source.rootId));
    expect(imported.metadata).toEqual(source.metadata);
  });

  it("SGF 带摆局与过手：不落子节点不丢", async () => {
    const document = createDocument("setup-pass");
    const nodes: Record<string, RecordNode> = { ...document.nodes };
    nodes.setup1 = { id: "setup1", parentId: document.rootId, children: ["pass1"], move: null, comment: "", marks: [], setup: { black: [{ row: 3, col: 3 }], white: [{ row: 4, col: 4 }], empty: [] } };
    nodes.pass1 = { id: "pass1", parentId: "setup1", children: [], move: null, passPlayer: "black", comment: "过手", marks: [] };
    nodes[document.rootId] = { ...nodes[document.rootId], children: ["setup1"] };
    const rich: GameDocument = { ...document, nodes };

    const imported = await importDocument(exportSgf(rich), "setup-pass.sgf");
    const setup = Object.values(imported.nodes).find((node) => node.setup);
    expect(setup?.setup?.black).toEqual([{ row: 3, col: 3 }]);
    expect(setup?.setup?.white).toEqual([{ row: 4, col: 4 }]);
    expect(Object.values(imported.nodes).some((node) => node.passPlayer === "black")).toBe(true);
  });

  it("PSQ：主线逐手与颜色保真（格式本身只承载主线）", async () => {
    const source = buildRichDocument();
    const imported = await importDocument(exportPsq(source), "roundtrip.psq");
    const moves = Object.values(imported.nodes).filter((node) => node.move).map((node) => `${node.move!.player[0]}:${node.move!.row},${node.move!.col}`);
    expect(moves).toEqual(["b:7,7", "w:7,8", "b:6,8"]);
  });

  it("POS：主线逐手保真（格式本身只承载主线）", async () => {
    const source = buildRichDocument();
    const imported = await importDocument(exportPos(source), "roundtrip.pos");
    const moves = Object.values(imported.nodes).filter((node) => node.move).map((node) => `${node.move!.row},${node.move!.col}`);
    expect(moves).toEqual(["7,7", "7,8", "6,8"]);
  });

  it("POS 里写不下过手：不写记号（写了连我们自己的导入器都读不回），但要报数", async () => {
    // 这里以前把过手写成 `pass` 这个记号，而 importPos 只认 A1–O15 坐标，
    // 于是**我们自己导出的 POS 文件自己读不回来**（「没有识别到 A1–O15 形式的落子序列」）。
    const document = createDocument("pos-pass");
    const nodes: Record<string, RecordNode> = { ...document.nodes };
    nodes.m1 = { id: "m1", parentId: document.rootId, children: ["p1"], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] };
    nodes.p1 = { id: "p1", parentId: "m1", children: ["m2"], move: null, passPlayer: "white", comment: "", marks: [] };
    nodes.m2 = { id: "m2", parentId: "p1", children: [], move: { row: 8, col: 8, player: "black" }, comment: "", marks: [] };
    nodes[document.rootId] = { ...nodes[document.rootId], children: ["m1"], preferredChildId: "m1" };
    const source: GameDocument = { ...document, nodes };

    const text = exportPos(source);
    expect(text).not.toContain("pass");
    expect(text).toBe("H8 I7\n");                       // 只有两手坐标，过手跳过
    const imported = await importDocument(text, "pos-pass.pos"); // 必须读得回来（以前这里抛错）
    expect(Object.values(imported.nodes).filter((node) => node.move)).toHaveLength(2);
    expect(mainLinePassCount(source)).toBe(1);          // 导出侧据此如实提示用户
  });

  it("GB2312 声明的 SGF 不乱码（CA[gb2312] 的中文注释）", async () => {
    // 中文软件导出的 SGF 常声明 CA[gb2312]；GBK 字节常恰好也是合法 UTF-8，
    // 若按 UTF-8 先解会静默乱码。这里直接给 GBK 字节，断言注释正确。
    const gbk = new Uint8Array([
      0x28, 0x3b, 0x47, 0x4d, 0x5b, 0x31, 0x5d, 0x43, 0x41, 0x5b, 0x67, 0x62, 0x32, 0x33, 0x31, 0x32, 0x5d, 0x53, 0x5a, 0x5b, 0x31, 0x35, 0x5d,
      0x3b, 0x42, 0x5b, 0x68, 0x68, 0x5d,
      0x43, 0x5b, 0xbe, 0xf8, 0xc9, 0xb1, 0x5d, // C[绝杀]
      0x29,
    ]);
    const parsed = await importRecordFile(new File([gbk], "gbk.sgf", { type: "application/x-go-sgf" }));
    const node = Object.values(parsed.document.nodes).find((entry) => entry.move);
    expect(node?.comment).toBe("绝杀");
  });
});

describe("标注导出（形状必须进 SGF，不能退化成问号）", () => {
  /**
   * 用户报的 bug：UI 建标注时 kind 恒为 "label"，而导出按 kind 选属性，
   * 于是圆圈/三角/叉全变成 `LB[xx:?]`——导出到别的软件只剩一个问号。
   * 语义必须由**画法**（style）推导。
   */
  const withMarks = (marks: Array<{ row: number; col: number; kind?: string; style?: string; label?: string }>) => {
    const document = createDocument("标注导出");
    const id = "n1";
    document.nodes[id] = {
      id, parentId: document.rootId, children: [], move: { row: 7, col: 7, player: "black" },
      comment: "", marks: marks as never,
    };
    document.nodes[document.rootId] = { ...document.nodes[document.rootId], children: [id] };
    return document;
  };

  it("老文档：kind 恒为 label 时也要按 style 导出成 CR/TR/SQ/MA", async () => {
    const document = withMarks([
      { row: 5, col: 5, kind: "label", style: "circle" },
      { row: 5, col: 7, kind: "label", style: "triangle" },
      { row: 5, col: 9, kind: "label", style: "cross" },
      { row: 7, col: 5, kind: "label", style: "square-solid" },
      { row: 9, col: 5, kind: "label", style: "text", label: "A" },
    ]);
    const sgf = await exportSgf(document);
    expect(sgf).toContain("CR[ff]");
    expect(sgf).toContain("TR[hf]");
    expect(sgf).toContain("MA[jf]");
    expect(sgf).toContain("SQ[fh]");
    expect(sgf).toContain("LB[fj:A]");
    expect(sgf).not.toContain(":?]");
  });

  it("新文档：kind 由 style 推导，导出同样正确", async () => {
    const document = withMarks([
      { row: 5, col: 5, kind: "circle", style: "circle" },
      { row: 5, col: 7, kind: "triangle", style: "triangle" },
      { row: 5, col: 9, kind: "square", style: "square-solid" },
    ]);
    const sgf = await exportSgf(document);
    expect(sgf).toContain("CR[ff]");
    expect(sgf).toContain("TR[hf]");
    expect(sgf).toContain("SQ[jf]");
  });

  it("内容「无」的图形标注不写出 LB，也不产生问号占位", async () => {
    const document = withMarks([
      { row: 5, col: 5, kind: "circle", style: "circle", label: "" },
      { row: 5, col: 7, kind: "label", style: "text", label: "" },
    ]);
    const sgf = await exportSgf(document);
    expect(sgf).toContain("CR[ff]");
    expect(sgf).not.toContain("LB[");
    expect(sgf).not.toContain("?");
  });

  it("同类标注合并成一个多值属性（CR[aa][bb]），不是重复属性名", async () => {
    const document = withMarks([
      { row: 5, col: 5, kind: "circle", style: "circle" },
      { row: 5, col: 7, kind: "circle", style: "circle" },
    ]);
    const sgf = await exportSgf(document);
    expect(sgf).toContain("CR[ff][hf]");
    expect((sgf.match(/CR\[/g) || []).length).toBe(1);
  });

  it("SGF 回环：多种标注一个不少地读回来，方块 SQ 也支持", async () => {
    const document = withMarks([
      { row: 5, col: 5, kind: "circle", style: "circle" },
      { row: 5, col: 7, kind: "triangle", style: "triangle" },
      { row: 5, col: 9, kind: "cross", style: "cross" },
      { row: 7, col: 5, kind: "square", style: "square-solid" },
      { row: 7, col: 9, kind: "label", style: "text", label: "B" },
    ]);
    const parsed = await importRecordFile(new File([await exportSgf(document)], "m.sgf", { type: "application/x-go-sgf" }));
    const marks = Object.values(parsed.document.nodes).flatMap((node) => node.marks || [])
      .map((mark) => `${mark.kind}@${mark.row},${mark.col}`).sort();
    expect(marks).toEqual(["circle@5,5", "cross@5,9", "label@7,9", "square@7,5", "triangle@5,7"]);
  });

  it("图形标注上的文字不丢：形状属性没有文字位，同点再补一条 LB，读回并回同一个标注", async () => {
    const document = withMarks([{ row: 5, col: 5, kind: "triangle", style: "triangle-solid", label: "胜" }]);
    const sgf = await exportSgf(document);
    expect(sgf).toContain("TR[ff]");     // 形状
    expect(sgf).toContain("LB[ff:胜]");  // 文字
    const parsed = await importRecordFile(new File([sgf], "m.sgf", { type: "application/x-go-sgf" }));
    const marks = Object.values(parsed.document.nodes).flatMap((node) => node.marks || []);
    // 不能变成两条标注（形状一条、文字一条）
    expect(marks.length).toBe(1);
    expect(marks[0].kind).toBe("triangle");
    expect(marks[0].label).toBe("胜");
  });

  it("第三方 SGF 把同名属性写两次时合并而不是丢弃（CR[aa]CR[bb]）", async () => {
    const sgf = "(;GM[4]FF[4]SZ[15];B[hh]CR[ff]CR[hf]TR[gi])";
    const parsed = await importRecordFile(new File([sgf], "dup.sgf", { type: "application/x-go-sgf" }));
    const marks = Object.values(parsed.document.nodes).flatMap((node) => node.marks || [])
      .map((mark) => `${mark.kind}@${mark.row},${mark.col}`).sort();
    // SGF 坐标是 [列][行]：gi = 列 g(6)、行 i(8)。
    expect(marks).toEqual(["circle@5,5", "circle@5,7", "triangle@8,6"]);
  });

  it("JSON 回环保留全部画法与语义（含新增的 square/check）", async () => {
    // 校验器里曾经写死旧的四种 kind，导致带方块/对勾的 JSON 被判「无效棋盘标记」
    // 而整份导不回来；.json 还会静默回落到别的解析器、把画法也弄丢。
    const styles: Array<[string, string]> = [
      ["circle", "circle"], ["circle-solid", "circle"], ["triangle", "triangle"], ["triangle-solid", "triangle"],
      ["square-solid", "square"], ["diamond", "square"], ["cross", "cross"], ["check", "check"], ["text", "label"],
    ];
    const document = withMarks(styles.map(([style, kind], i) => ({ row: i, col: i, style, kind })));
    const json = await exportJson(document);
    const parsed = await importRecordFile(new File([json], "marks.json", { type: "application/json" }));
    const marks = Object.values(parsed.document.nodes).flatMap((node) => node.marks || [])
      .map((mark) => `${mark.style}/${mark.kind}`).sort();
    expect(marks).toEqual(styles.map(([style, kind]) => `${style}/${kind}`).sort());
  });

  it("SGF 的 LB：长文字不截断、首尾空格归一、空文字不造看不见的标注（2026-09-19 实测）", async () => {
    const load = async (text: string) => (await importRecordFile(new File([new TextEncoder().encode(text)], "t.sgf", { type: "application/x-go-sgf" }))).document;
    const marksOf = (document: GameDocument) => Object.values(document.nodes).flatMap((node) => node.marks || []);
    const labelAt = (document: GameDocument, row: number, col: number) =>
      marksOf(document).find((mark) => mark.row === row && mark.col === col)?.label;

    // ① 长文字（别的软件常写整句话）：导入不许截到 4 字，导出要原样带回
    const long = await load("(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]LB[dd:这是一个很长的标注文字])");
    expect(labelAt(long, 3, 3)).toBe("这是一个很长的标注文字");
    expect(exportSgf(long)).toContain("这是一个很长的标注文字");

    // ② 首尾空格：导入即 trim（导出侧本来就裁，导入不裁会让「导入→导出→再导入」不一致）
    const spaced = await load("(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]LB[dd: 空格 ])");
    expect(labelAt(spaced, 3, 3)).toBe("空格");

    // ③ 空文字 LB（别的软件用它「清掉标签」）：不造标注，免得留下看不见也删不掉的标注
    const empty = await load("(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]LB[dd:])");
    expect(marksOf(empty)).toHaveLength(0);

    // ④ 形状 + 空文字 LB：形状保留、文字为空（别把形状一起丢掉）
    const shapeOnly = await load("(;GM[1]FF[4]CA[UTF-8]SZ[15];B[hh]MA[dd]LB[dd:])");
    expect(marksOf(shapeOnly)).toHaveLength(1);
    expect(marksOf(shapeOnly)[0].kind).toBe("cross");
    expect(marksOf(shapeOnly)[0].label || "").toBe("");
  });
});

describe("SGF 读取容错（用户 2026-10-03 那批外部文件）", () => {
  it("接受尾部与树之间的 NUL 填充（.lib 导出按固定缓冲区落盘留下的）", async () => {
    const padded = "(;SZ[15];B[hh];W[ig]\0\0(;B[ji]))" + "\0".repeat(20045);
    const parsed = await importRecordFile(new File([padded], "山口打点.sgf", { type: "application/x-go-sgf" }));
    const moves = Object.values(parsed.document.nodes).filter((node) => node.move)
      .map((node) => `${node.move?.player}:${node.move?.row},${node.move?.col}`);
    expect(moves).toEqual(["black:7,7", "white:6,8", "black:8,9"]);
    expect(parsed.format).toBe("SGF");
  });

  it("属性值里面的 0 是内容，不许跟着一起丢", async () => {
    const withNullInComment = "(;SZ[15];B[hh]C[x\0y])";
    const parsed = await importRecordFile(new File([withNullInComment], "值内0.sgf", { type: "application/x-go-sgf" }));
    const commented = Object.values(parsed.document.nodes).find((node) => node.comment);
    expect(commented?.comment).toBe("x\0y");
  });

  it("多树集合照旧逐盘导入，尾部填充不影响盘数", async () => {
    const collection = "(;SZ[15];B[hh])(;SZ[15];B[hi];W[ig])" + "\0".repeat(300);
    const parsed = await importRecordFile(new File([collection], "两盘.sgf", { type: "application/x-go-sgf" }));
    expect(parsed.format).toBe("SGF Collection (2)");
    expect(parsed.additionalDocuments?.length).toBe(1);
  });

  it("括号配不平的坏文件要说清在第几个字符，不能只讲「没有闭合」", async () => {
    const broken = "(;SZ[15];B[hh];W[ig])))(;W[ll];B[fh])";
    await expect(importRecordFile(new File([broken], "坏谱.sgf", { type: "application/x-go-sgf" })))
      .rejects.toThrow(/第 \d+ 个字符处/);
  });
});
