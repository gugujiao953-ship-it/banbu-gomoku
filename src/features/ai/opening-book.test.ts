import { describe, expect, it } from "vitest";
// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import fs from "node:fs";
// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import { fileURLToPath } from "node:url";
// @ts-expect-error The application intentionally excludes Node typings; Vitest runs this file in Node.
import zlib from "node:zlib";
import shippedBookJson from "../../../public/opening-book/sosyov-v1.json";
import { bookDeclareCount, bookRank, openingBookKindFor, queryOpeningBookMove, queryOpeningBookRanked, type OpeningBookData } from "./opening-book";

const book: OpeningBookData = {
  version: 2,
  positions: {
    "[[7,7],[8,7],[9,7]]": [
      { p: [10, 7], l: "8" }, { p: [9, 8], l: "5" }, { p: [9, 9], l: "9" }, { p: [8, 8], l: "4*" },
      { p: [8, 9], l: "6" }, { p: [7, 8], l: "5" }, { p: [7, 9], l: "8" }, { p: [6, 7], l: "7*" }, { p: [6, 8], l: "8*" },
    ],
    "[[7,7],[8,7]]": [{ p: [9, 7], l: "寒" }, { p: [9, 8], l: "溪" }],
    "[[7,7],[8,7],[6,8]]": [{ p: [5, 9], l: "A" }],
  },
};
// SGF coord: first letter = col (a=0), second = y from top (row). "hh" = row7/col7.
const moves = (list: Array<[number, number]>) => list.map(([row, col]) => ({ row, col }));

describe("bookRank", () => {
  it("parses numeric ranks with optional * suffix", () => {
    expect(bookRank("5")).toBe(5);
    expect(bookRank("4*")).toBe(4);
    expect(bookRank("12")).toBe(12);
  });
  it("rejects non-rank labels", () => {
    expect(bookRank("A")).toBeNull();
    expect(bookRank("A*")).toBeNull();
    expect(bookRank("寒")).toBeNull();
    expect(bookRank("0")).toBeNull();
    expect(bookRank("7/9")).toBeNull();
  });
});

describe("queryOpeningBookMove", () => {
  it("picks the lowest rank group (strongest 打点)", () => {
    const move = queryOpeningBookMove(book, moves([[7, 7], [8, 7], [9, 7]]));
    expect(move).not.toBeNull();
    expect(move!.rank).toBe(4);
    expect(move!.label).toBe("4*");
  });
  it("maps SGF coordinates back to board rows (row 0 = top)", () => {
    const move = queryOpeningBookMove(book, moves([[7, 7], [8, 7], [9, 7]]));
    expect(move!.row).toBe(8); // "ig": y=g(6) → row = 15-1-6 = 8
    expect(move!.col).toBe(8); // i = 8
  });
  it("misses on empty/unknown sequences, but falls back to the opening-name layer", () => {
    expect(queryOpeningBookMove(book, [])).toBeNull();
    // [[7,7],[8,7]]（H8/H9）只有汉字开局名层：2026-09-10 起作为同组可下点回退
    // （rank=1），否则白2/黑3 永远书 miss、整局打点簿失效。
    const opening = queryOpeningBookMove(book, moves([[7, 7], [8, 7]]));
    expect(opening).not.toBeNull();
    expect(opening!.rank).toBe(1);
    expect(queryOpeningBookMove(book, moves([[7, 7], [8, 7], [6, 8]]))).toBeNull();
  });
});

describe("shipped book data (public/opening-book/sosyov-v1.json)", () => {
  const shipped = shippedBookJson as unknown as OpeningBookData;

  it("loads with the expected shape", () => {
    expect(shipped.version).toBe(2);
    expect(Object.keys(shipped.positions).length).toBeGreaterThan(100);
  });

  it("answers the 寒星 line with the strongest 打点 (4* → ig)", () => {
    // H8 (hh) → H7 (hg) → H6 (hf): the book ranks ig as 4*, the lowest.
    const move = queryOpeningBookMove(shipped, moves([[7, 7], [8, 7], [9, 7]]), 15, () => 0);
    expect(move).not.toBeNull();
    expect(move!.rank).toBe(4);
    expect(move!.col).toBe(8); // i
    expect(move!.row).toBe(8); // g → 15-1-6
  });

  it("treats an opening-name-only layer as one equal playable group (白2/黑3 走簿)", () => {
    // The 2-stone position only carries opening names (寒/溪/…) → no numeric
    // ranks → the fallback returns all of them as one rank-1 group, so the AI
    // picks its 白2/黑3 from the book instead of free-searching (2026-09-10).
    const key = Object.keys(shipped.positions).find((k) => (JSON.parse(k) as unknown[]).length === 2);
    expect(key).toBeTruthy();
    const seq = (JSON.parse(key as string) as [number, number][]).map(([row, col]) => ({ row, col }));
    const move = queryOpeningBookMove(shipped, seq, 15, () => 0);
    expect(move).not.toBeNull();
    expect(move!.rank).toBe(1);
    // 数字 rank 层存在时仍然按 rank 排序，开局名不会被当作打点。
    const ranked = queryOpeningBookRanked(shipped, moves([[7, 7], [8, 7], [9, 7]]));
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((candidate) => /^\d+\*?$/.test(candidate.label))).toBe(true);
  });

  it("hits mirrored lines (book only records one quadrant)", () => {
    // H8, H7, then the AI's real 3rd move G7 (row 8, col 6) = mirror of ig (花月).
    // The mirrored key must resolve and the suggested point must map back to the
    // real (left-side) coordinates.
    const move = queryOpeningBookMove(shipped, moves([[7, 7], [8, 7], [8, 6]]), 15, () => 0);
    expect(move).not.toBeNull();
    expect(move!.col).toBeLessThan(7); // mirrored back to the left half
    expect(move!.rank).toBeLessThanOrEqual(9); // 花月 mirrored line carries ranks
  });

  it("returns all ranks in strength order (lowest first)", () => {
    const ranked = queryOpeningBookRanked(shipped, moves([[7, 7], [8, 7], [9, 7]]));
    expect(ranked.length).toBeGreaterThan(3);
    for (let i = 1; i < ranked.length; i += 1) expect(ranked[i].rank).toBeGreaterThanOrEqual(ranked[i - 1].rank);
    expect(ranked[0].rank).toBe(4); // 4* is the strongest entry of the 寒星 4th-move list
  });

  it("mirrors ranked results back to real coordinates", () => {
    const right = queryOpeningBookRanked(shipped, moves([[7, 7], [8, 7], [9, 7]])); // 寒星 line
    const left = queryOpeningBookRanked(shipped, moves([[7, 7], [8, 7], [8, 6]]));  // its mirror line (…G7)
    expect(right.length).toBeGreaterThan(3);
    expect(left.length).toBeGreaterThan(0); // 花月镜像线的 rank 层本就稀疏
    // The mirror line's strongest point is the mirror image of some book point,
    // i.e. it must itself be a legal board coordinate distinct from the direct hit.
    expect(left[0].row).toBeGreaterThanOrEqual(0);
    expect(left[0].col).toBeLessThan(15);
    expect(`${left[0].row},${left[0].col}`).not.toBe(`${right[0].row},${right[0].col}`);
  });
});

describe("双书路由 openingBookKindFor", () => {
  it("旧请求/索索夫走 sosyov，山口家族走 yamaguchi", () => {
    expect(openingBookKindFor({})).toBe("sosyov");
    expect(openingBookKindFor({ openingRule: "soosyrv-8" })).toBe("sosyov");
    expect(openingBookKindFor({ openingRule: "free" })).toBe("sosyov");
    expect(openingBookKindFor({ openingRule: "yamaguchi" })).toBe("yamaguchi");
    expect(openingBookKindFor({ openingRule: "five-two" })).toBe("yamaguchi");
    expect(openingBookKindFor({ openingRule: "five-n" })).toBe("yamaguchi");
    expect(openingBookKindFor({ openingRule: "taraguchi-10" })).toBe("yamaguchi");
    expect(openingBookKindFor({ openingRule: "tarannikov" })).toBe("yamaguchi");
  });
});

describe("bookDeclareCount（T31 AI 宣布打点数）", () => {
  it("书内好点数 K → 宣布 K+1，无信息退回保守 3", () => {
    expect(bookDeclareCount([], 3, 10)).toBe(3);
    expect(bookDeclareCount([1, 2], 3, 10)).toBe(3); // K=2 → 3（旧写死值天然吻合两打）
    expect(bookDeclareCount([1, 1, 2, 2, 3, 4], 3, 10)).toBe(7); // K=6 → 7 逼出库外劣点
    expect(bookDeclareCount([9, 12, 14], 3, 10)).toBe(3); // 全是败点级排名 → 不算好点
  });
  it("按规则区间钳制", () => {
    expect(bookDeclareCount([1, 2, 3, 4, 4, 4, 4, 4, 4], 1, 8)).toBe(8); // soosyrv-8 上限
    expect(bookDeclareCount([1], 3, 10)).toBe(3); // five-n 下限
    expect(bookDeclareCount([2], 1, 8, 3)).toBe(2); // K=1 → 2（soosyrv-8 允许低宣）
  });
});

describe("v3 紧凑编码（扁平 row*15+col key + [point,rank] 值）", () => {
  const book3: OpeningBookData = {
    version: 3,
    positions: {
      "[112]": [127, 1, 128, 1],
      "[112,127,142,157]": [128, 1, 98, 2, 144, 2],
    },
  };
  it("命中 v3 键并解码点坐标", () => {
    // 黑1 H8 后白2 候选两类（hg/ig 同 rank1）：random()=>0 取排序首位 hg
    const move = queryOpeningBookMove(book3, moves([[7, 7]]), 15, () => 0);
    expect(move).not.toBeNull();
    expect(move!.rank).toBe(1);
    expect(move!.row).toBe(8);
    expect(move!.col).toBe(7);
  });
  it("v3 也做 D4 对称查询（书只记一象限）", () => {
    // [hh,hg] 转置镜像线 [hh,(7,8)] 必须命中 [112,127,142,157] 的转置变换
    const hit = queryOpeningBookMove(book3, moves([[7, 7], [8, 7], [9, 7], [10, 7]]), 15, () => 0);
    expect(hit).not.toBeNull();
    expect(hit!.rank).toBe(1);
    expect(`${hit!.row},${hit!.col}`).toBe("8,8"); // ig:a1
    const mirrored = queryOpeningBookRanked(book3, moves([[7, 7], [8, 7], [9, 7], [10, 7]]));
    expect(mirrored.length).toBe(3);
  });
  it("v2/v3 顶分并列取随机（山口开局名组防复读）", () => {
    const first = queryOpeningBookMove(book3, moves([[7, 7]]), 15, () => 0);
    const last = queryOpeningBookMove(book3, moves([[7, 7]]), 15, () => 0.999);
    expect(`${first!.row},${first!.col}`).not.toBe(`${last!.row},${last!.col}`);
  });
});

describe("shipped yamaguchi book (public/opening-book/yamaguchi-v1.json.gz)", () => {
  const gzPath = fileURLToPath(new URL("../../../public/opening-book/yamaguchi-v1.json.gz", import.meta.url));
  const shipped = JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString()) as OpeningBookData;

  it("loads with the expected shape", () => {
    expect(shipped.version).toBe(3);
    expect((shipped as { maxMoves?: number }).maxMoves).toBe(15);
    expect(Object.keys(shipped.positions).length).toBeGreaterThan(50000);
  });

  it("黑1 后白2 两类（数字标=rank1）", () => {
    const ranked = queryOpeningBookRanked(shipped, moves([[7, 7]]));
    expect(ranked.length).toBe(2);
    expect(ranked.every((entry) => entry.rank === 1)).toBe(true);
  });

  it("白2 后黑3 定式候选成组（开局名 rank2，可下!）", () => {
    const ranked = queryOpeningBookRanked(shipped, moves([[7, 7], [8, 7]]));
    expect(ranked.length).toBeGreaterThanOrEqual(8); // 寒星溪月疏星花月残月雨星金星松星瑞星…
    expect(ranked[0].rank).toBe(2);
  });

  it("寒星线宣布位给出第1打/第2打", () => {
    // H8 H7 H6(寒星) + 白4 he(4打)：ig=a1 rank1、ii=a2 rank2
    const ranked = queryOpeningBookRanked(shipped, moves([[7, 7], [8, 7], [9, 7], [10, 7]]));
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked[0]).toMatchObject({ row: 8, col: 8, rank: 1 }); // ig
    expect(ranked.some((entry) => entry.rank === 2)).toBe(true);
  });

  it("败点层不入书：全部 rank ∈ [1,14] 且键长 ≤15", { timeout: 20000 }, () => {
    for (const [key, values] of Object.entries(shipped.positions)) {
      // key = "[112,127,...]"：元素数 = 逗号数 + 1（免逐键 JSON.parse，73k 键）
      const depth = key.length > 2 ? key.split(",").length : 1;
      expect(depth).toBeLessThanOrEqual(15);
      const flat = values as number[];
      expect(flat.length % 2).toBe(0);
      for (let i = 1; i < flat.length; i += 2) {
        expect(flat[i]).toBeGreaterThanOrEqual(1);
        expect(flat[i]).toBeLessThanOrEqual(14);
      }
    }
  });
});
