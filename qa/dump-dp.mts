import fs from "node:fs";
import { importRecordFile } from "../src/formats";
import { coordinateName, pathToNode } from "../src/game";
const file = new File([fs.readFileSync("D:/五子棋/定式谱/九天指南v5-1.db")], "sample.db");
const result = await importRecordFile(file);
const root = result.document.nodes[result.document.rootId];
console.log(JSON.stringify({ stats: result.stats, warnings: result.warnings, nodeCount: Object.keys(result.document.nodes).length, rootChildren: root.children.length, root: root.children.slice(0, 10).map((id) => pathToNode(result.document, id).map((node) => ({ id: node.id, move: node.move ? coordinateName(node.move) : null, text: node.boardText, comment: node.comment }))) }, null, 2));
