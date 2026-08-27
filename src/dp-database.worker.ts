import { openDpDatabaseIndex, queryDpPosition, type DpState } from "./formats";

let states = new Map<string, DpState>();

const query = (path: Array<{ row: number; col: number }>) => {
  const board = new Uint8Array(225);
  path.forEach((point, index) => { board[point.row * 15 + point.col] = index % 2 + 1; });
  const result = queryDpPosition(states, board, (path.length % 2) as 0 | 1);
  return {
    comment: result.comment,
    marks: result.marks,
    branches: result.branches.map((branch) => ({ position: branch.position, label: branch.label })),
  };
};

self.onmessage = async (event: MessageEvent<{ requestId: number; cmd: "open" | "query"; file?: File; path?: Array<{ row: number; col: number }> }>) => {
  const { requestId, cmd } = event.data;
  try {
    if (cmd === "open") {
      if (!event.data.file) throw new Error("缺少 DP 数据库文件");
      states = await openDpDatabaseIndex(event.data.file);
      self.postMessage({ requestId, ok: true, count: states.size, query: query([]) });
    } else self.postMessage({ requestId, ok: true, query: query(event.data.path || []) });
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : "DP 数据库查询失败" });
  }
};
