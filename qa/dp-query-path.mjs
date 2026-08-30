import fs from "node:fs";
import { openDpDatabaseIndex, queryDpPosition } from "../src/formats";
import { coordinateName, emptyBoard } from "../src/game";

const filePath = process.argv[2] || String.raw`D:\五子棋\其他\九天指南v4-2.db`;
const coordinates = (process.argv[3] || "H8,G9,J6,G10").split(",");
const states = await openDpDatabaseIndex(new File([fs.readFileSync(filePath)], "sample.db"));
let board = emptyBoard(15);
const snapshots = [];
for (let index = 0; index <= coordinates.length; index += 1) {
  const position = new Uint8Array(board.flat().map((cell) => cell === "black" ? 1 : cell === "white" ? 2 : 0));
  const result = queryDpPosition(states, position, (index % 2) === 0 ? 0 : 1);
  snapshots.push({ depth: index, path: coordinates.slice(0, index), stateFound: Boolean(result.state), branches: result.branches.slice(0, 20).map((branch) => ({ coordinate: coordinateName(branch.position), label: branch.label })) });
  if (index < coordinates.length) {
    const wanted = coordinates[index];
    const branch = result.branches.find((item) => coordinateName(item.position) === wanted);
    if (!branch) throw new Error(`未找到 ${wanted} at depth ${index}`);
    board = board.map((row, rowIndex) => row.map((cell, colIndex) => rowIndex === branch.position.row && colIndex === branch.position.col ? (index % 2 === 0 ? "black" : "white") : cell));
  }
}
console.log(JSON.stringify({ filePath, coordinates, stateCount: states.size, snapshots }, null, 2));
