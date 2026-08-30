import fs from "node:fs";
import { openDpDatabaseIndex, queryDpPosition } from "../src/formats";
import { coordinateName, emptyBoard } from "../src/game";

const filePath = process.argv[2] || String.raw`D:\五子棋\其他\九天指南v4-2.db`;
const bytes = fs.readFileSync(filePath);
const states = await openDpDatabaseIndex(new File([bytes], filePath.split(/[\\/]/).pop() || "sample.db"));
const queue = [{ path: [], board: emptyBoard(15) }];
const seen = new Set();
const matches = [];
const maxDepth = Number(process.argv[3] || 15);

const keyOf = (board, depth) => `${depth}:${board.flat().map((cell) => cell === "black" ? "b" : cell === "white" ? "w" : ".").join("")}`;
const place = (board, point, player) => board.map((row, rowIndex) => row.map((cell, colIndex) => rowIndex === point.row && colIndex === point.col ? player : cell));

while (queue.length && matches.length < 12) {
  const current = queue.shift();
  const stateKey = keyOf(current.board, current.path.length);
  if (seen.has(stateKey)) continue;
  seen.add(stateKey);
  const position = new Uint8Array(current.board.flat().map((cell) => cell === "black" ? 1 : cell === "white" ? 2 : 0));
  const result = queryDpPosition(states, position, (current.path.length % 2) === 0 ? 0 : 1);
  for (const branch of result.branches) {
    if (branch.label.trim().toUpperCase() === "A") {
      const childBoard = place(current.board, branch.position, current.path.length % 2 === 0 ? "black" : "white");
      const childPosition = new Uint8Array(childBoard.flat().map((cell) => cell === "black" ? 1 : cell === "white" ? 2 : 0));
      const childResult = queryDpPosition(states, childPosition, ((current.path.length + 1) % 2) === 0 ? 0 : 1);
      matches.push({
        path: current.path.map((point) => coordinateName(point)),
        branch: coordinateName(branch.position),
        label: branch.label,
        depth: current.path.length,
        stateFound: Boolean(result.state),
        childBranches: childResult.branches.length,
      });
    }
    if (current.path.length < maxDepth) {
      queue.push({ path: [...current.path, branch.position], board: place(current.board, branch.position, current.path.length % 2 === 0 ? "black" : "white") });
    }
  }
}

console.log(JSON.stringify({ filePath, stateCount: states.size, visited: seen.size, queued: queue.length, matches }, null, 2));
