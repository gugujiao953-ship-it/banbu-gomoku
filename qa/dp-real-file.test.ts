import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { openDpDatabaseIndex, queryDpPosition } from "../src/formats";

describe("real DP database", () => {
  const path = "D:/五子棋/定式谱/九天指南v5-1.db";
  let states: Awaited<ReturnType<typeof openDpDatabaseIndex>> | undefined;
  beforeAll(async () => {
    if (fs.existsSync(path)) states = await openDpDatabaseIndex(new File([fs.readFileSync(path)], "九天指南v5-1.db"));
  }, 30_000);

  const queryPath = (moves: string[]) => {
    const board = new Uint8Array(225);
    moves.forEach((move, index) => {
      const col = move.charCodeAt(0) - 65;
      const row = 15 - Number(move.slice(1));
      board[row * 15 + col] = index % 2 + 1;
    });
    return queryDpPosition(states!, board, (moves.length % 2) as 0 | 1);
  };

  it("reads position records instead of treating BTXT labels as moves", () => {
    if (!states) return;
    expect(states.size).toBe(5823);
    const root = queryPath([]);
    expect(root.comment).toContain("标记说明");
    expect(root.marks.find((mark) => mark.label === "九天")).toMatchObject({ row: 7, col: 7 });
    expect(root.branches.map((branch) => `${String.fromCharCode(65 + branch.position.col)}${15 - branch.position.row}`)).toContain("H8");
  });

  it("keeps deep DP paths free of repeated coordinates", () => {
    if (!states) return;
    const path: string[] = [];
    for (let depth = 0; depth < 20; depth += 1) {
      const result = queryPath(path);
      const next = result.branches[0];
      if (!next) break;
      const coordinate = `${next.position.row},${next.position.col}`;
      expect(path.map((move) => `${15 - Number(move.slice(1))},${move.charCodeAt(0) - 65}`).join(";")).not.toContain(coordinate);
      path.push(`${String.fromCharCode(65 + next.position.col)}${15 - next.position.row}`);
    }
    expect(path.length).toBeGreaterThan(5);
  });

  it("renders the complete symmetric annotation field after H8-G9", () => {
    if (!states) return;
    const result = queryPath(["H8", "G9"]);
    expect(result.marks).toHaveLength(13);
    expect(result.branches).toHaveLength(23);
    expect(result.marks.map((mark) => mark.label)).toEqual(expect.arrayContaining(["长", "峡", "恒", "水", "流", "云", "浦", "岚", "银", "明", "斜", "名", "彗"]));
  });

  it("keeps every queried DP branch coordinate-safe", () => {
    if (!states) return;
    const queue: string[][] = [[]];
    let checked = 0;
    for (let cursor = 0; cursor < queue.length && checked < 500; cursor += 1) {
      const path = queue[cursor];
      const result = queryPath(path);
      for (const branch of result.branches.slice(0, 8)) {
        const next = `${String.fromCharCode(65 + branch.position.col)}${15 - branch.position.row}`;
        expect(path).not.toContain(next);
        checked += 1;
        if (path.length < 8 && queue.length < 200) queue.push([...path, next]);
        if (checked >= 500) break;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 30_000);
});
