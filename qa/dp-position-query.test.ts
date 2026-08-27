import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { openDpDatabaseIndex, queryDpPosition } from "../src/formats";

describe("Rapfi-compatible DP position query", () => {
  const path = "D:/五子棋/定式谱/九天指南v5-1.db";

  it("queries branches without materializing a game tree", async () => {
    if (!fs.existsSync(path)) return;
    const states = await openDpDatabaseIndex(new File([fs.readFileSync(path)], "九天指南v5-1.db"));
    expect(states.size).toBe(5823);

    const board = new Uint8Array(225);
    let query = queryDpPosition(states, board, 0);
    expect(query.comment).toContain("标记说明");
    expect(query.branches.some((branch) => branch.position.row === 7 && branch.position.col === 7)).toBe(true);

    board[7 * 15 + 7] = 1; // H8
    query = queryDpPosition(states, board, 1);
    expect(query.branches.some((branch) => branch.position.row === 6 && branch.position.col === 6)).toBe(true);
    expect(query.branches).toHaveLength(8);
    expect(query.branches.every((branch) => branch.label === "斜" || branch.label === "直")).toBe(true);

    board[6 * 15 + 6] = 2; // G9
    query = queryDpPosition(states, board, 0);
    expect(query.marks).toHaveLength(13);
    expect(query.branches).toHaveLength(23);
    expect(query.branches.every((branch) => !["●", "○"].includes(branch.label))).toBe(true);
    expect(query.marks.map((mark) => mark.label)).toEqual(expect.arrayContaining(["长", "峡", "恒", "水", "流", "云", "浦", "岚", "银", "明", "斜", "名", "彗"]));
  });
});
