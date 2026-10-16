import { dpRecordValue, DpStateIndex, openDpDatabaseIndex, queryDpPosition } from "./formats";

// 空的索引当初始值：open 之前来到的查询会照直返回"没有这个局面"，而不是抛空指针
let states = new DpStateIndex(1);

const query = (path: Array<{ row: number; col: number }>) => {
  const board = new Uint8Array(225);
  path.forEach((point, index) => { board[point.row * 15 + point.col] = index % 2 + 1; });
  const result = queryDpPosition(states, board, (path.length % 2) as 0 | 1);
  return {
    comment: result.comment,
    marks: result.marks,
    // value 供「主分支」排序用：越小越利于该局面的行棋方（见 dpRecordValue 注释）。
    branches: result.branches.map((branch) => ({ position: branch.position, label: branch.label, value: dpRecordValue(branch.state.record) })),
  };
};

self.onmessage = async (event: MessageEvent<{ requestId: number; cmd: "open" | "query" | "queryMany"; file?: File; path?: Array<{ row: number; col: number }>; paths?: Array<Array<{ row: number; col: number }>> }>) => {
  const { requestId, cmd } = event.data;
  try {
    if (cmd === "open") {
      if (!event.data.file) throw new Error("缺少 DP 数据库文件");
      states = await openDpDatabaseIndex(event.data.file);
      self.postMessage({ requestId, ok: true, count: states.size, query: query([]) });
    } else if (cmd === "queryMany") {
      // 预取用：一次消息带一批局面，省掉每局面一次 postMessage 的往返。
      const queries = (event.data.paths || []).map((path) => query(path));
      self.postMessage({ requestId, ok: true, queries });
    } else self.postMessage({ requestId, ok: true, query: query(event.data.path || []) });
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : "DP 数据库查询失败" });
  }
};
