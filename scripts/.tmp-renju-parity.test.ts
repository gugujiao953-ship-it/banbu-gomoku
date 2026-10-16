// scripts/.tmp-renju-parity.test.ts —— 禁手判定差分（探针，默认跳过）
// 默认不跑：`BANBU_RENJU_PARITY=1 npx vitest run scripts/.tmp-renju-parity.test.ts`
// 判据：摆棋小工具（renjutool.top）的公开判定器 eval/EvaluatorJScript.js。
// 远端 JS **只在 vm 内存里执行，不落盘**（下载的代码不写进磁盘）。
// 用途：找我们 src/game.ts 的禁手判定与它的差异类别（漏判/误判），再按类修。
import { describe, it } from "vitest";
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { evaluateRenjuMove, boardAt, nodeIdAtDepth } from "../src/game";
import { importRecordFile, mainLineLength } from "../src/formats";

const EVAL_URL = "http://www.renjutool.top/eval/EvaluatorJScript.js";
const enabled = process.env.BANBU_RENJU_PARITY === "1";
const ROUNDS = Number(process.env.BANBU_RENJU_ROUNDS || 300);
const N = 15;
const coord = (r: number, c: number) => String.fromCharCode(65 + c) + (15 - r);

describe.skipIf(!enabled)("禁手差分（判据：renjutool 判定器）", () => {
  it("随机稀疏局面逐点对比", async () => {
    // 宿主只需提供 console / self，以及一个 getLevelB 桩（它在本文件里只被导出语句引用、
    // 全文件从不调用；真实现由兄弟文件给，判禁手走不到它）。
    const sandbox: Record<string, unknown> = { console, self: undefined, getLevelB: () => 0 };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    // 加载顺序照它自己的自检要求来：先判定器（定义 loadEvaluatorJScript），再基础脚本
    // Evaluator.js（常量与坐标助手 + 末尾自检）。基础脚本还会自动调用 wasm 加载器——
    // 那是另一条实现路线，我们只要 JS 版，所以先放一个 no-op 桩把它挡掉（vm 里也没有 fetch）。
    const BASE_URL = "http://www.renjutool.top/eval/Evaluator.js";
    vm.runInContext("var loadEvaluatorWebassembly = function () {};", sandbox);
    vm.runInContext(await (await fetch(EVAL_URL)).text(), sandbox, { timeout: 30000 });
    vm.runInContext(await (await fetch(BASE_URL)).text(), sandbox, { timeout: 30000 });
    vm.runInContext("loadEvaluatorJScript();", sandbox, { timeout: 30000 });
    // 它导出的 setGameRules 是唯一正规的规则开关（改成有禁，禁手判定才生效）。
    vm.runInContext("setGameRules(RENJU_RULES);", sandbox, { timeout: 10000 });
    const isFoul = sandbox.isFoul as (idx: number, arr: number[]) => boolean;
    if (typeof isFoul !== "function") throw new Error("远端判定器没有导出 isFoul");

    let seed = 20261003;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const toArr = (board: (string | null)[][]) => {
      const arr: number[] = new Array(225).fill(0);
      for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) arr[x + y * N] = board[y][x] === "black" ? 1 : board[y][x] === "white" ? 2 : 0;
      return arr;
    };
    const describe = (entry: { board: (string | null)[][]; row: number; col: number }) => {
      const stones: string[] = [];
      entry.board.forEach((row, y) => row.forEach((cell, x) => { if (cell) stones.push(`${cell === "black" ? "B" : "W"}${coord(y, x)}`); }));
      return `${coord(entry.row, entry.col)} 落在 [${stones.join(" ")}]`;
    };

    const missFoul: Array<{ board: (string | null)[][]; row: number; col: number }> = [];
    const falseFoul: Array<{ board: (string | null)[][]; row: number; col: number }> = [];
    let both = 0, neither = 0, compared = 0, missTotal = 0, falseTotal = 0;
    let firstError = "";

    for (let round = 0; round < ROUNDS; round += 1) {
      const board: (string | null)[][] = Array.from({ length: N }, () => Array(N).fill(null));
      // 稀疏随机局面几乎碰不到禁手（200 个局面才 4 个禁手点），所以改成**小窗口内密集摆子**：
      // 三三 / 四四 / 长连都只可能出现在棋形密集处。
      const k = 5 + Math.floor(rnd() * 5);                       // 窗口 5..9 路
      const oy = Math.floor(rnd() * (N - k)); const ox = Math.floor(rnd() * (N - k));
      const stones = 8 + Math.floor(rnd() * 12);                 // 8..19 子
      for (let i = 0; i < stones; i += 1) {
        const r = oy + Math.floor(rnd() * k), c = ox + Math.floor(rnd() * k);
        if (board[r][c]) continue;
        board[r][c] = rnd() < 0.5 ? "black" : "white";
      }
      const arr = toArr(board);
      for (let r = 0; r < N; r += 1) for (let c = 0; c < N; c += 1) {
        if (board[r][c]) continue;
        let theirs = false;
        try { theirs = Boolean(isFoul(c + r * N, arr.slice())); } catch (error) { if (!firstError) firstError = String((error as Error)?.message || error); continue; }
        const mine = evaluateRenjuMove(board, { row: r, col: c }).forbidden !== null;
        compared += 1;
        if (theirs && mine) both += 1;
        else if (!theirs && !mine) neither += 1;
        else if (theirs) { missTotal += 1; if (missFoul.length < 6) missFoul.push({ board: board.map((row) => row.slice()), row: r, col: c }); }
        else { falseTotal += 1; if (falseFoul.length < 6) falseFoul.push({ board: board.map((row) => row.slice()), row: r, col: c }); }
      }
    }

    // ── 真实棋谱语料：主线逐手展开，每个局面都比一遍 ──
    // 随机摆子很难碰到疑难棋形，实战谱里才有成型的跳三/双四/三三与"禁手完成点"。
    const sgfFiles = [
      // 用户 2026-10-06 给的复现样本：15 路摆子局面 + RU[freestyle]（我们因此不标禁手）
      "D:/微信/xwechat_files/wxid_97qn0v3qj24b22_7a7c/msg/file/2026-10/2026-10-06T222621.sgf",
      "D:/五子棋/其他/第1局_Yixin_vs_Qi_Guan_Draw.sgf",
      "D:/五子棋/其他/第2局_Qi_Guan_vs_Yixin_QiGuanwins.sgf",
      "D:/五子棋/其他/第3局_Qi_Guan_vs_Yixin_Draw.sgf",
      "D:/五子棋/其他/第4局_Yixin_vs_Qi_Guan_Yixinwins.sgf",
      "D:/五子棋/其他/第5局_Yixin_vs_Qi_Guan_Draw.sgf",
      "D:/五子棋/其他/世纪之战.lib",
    ];
    let gamePositions = 0;
    for (const file of sgfFiles) {
      if (!existsSync(file)) continue;
      let result: Awaited<ReturnType<typeof importRecordFile>>;
      try { result = await importRecordFile(new File([readFileSync(file)], file.split("/").pop() || "x.sgf")); }
      catch (error) { console.log(`  跳过 ${file}：${(error as Error).message}`); continue; }
      const document = result.document;
      const total = mainLineLength(document);
      console.log(`  ${file.split("/").pop()} → 规则=${document.metadata.rule} 路数=${document.metadata.boardSize} 主线=${total} 手`);
      for (let depth = 0; depth <= total; depth += 1) {
        const nodeId = nodeIdAtDepth(document, depth);
        if (!nodeId) continue;
        const board = boardAt(document, nodeId);
        if (board.length !== N) continue;   // 判定器只认 15 路
        const arr = toArr(board);
        gamePositions += 1;
        for (let r = 0; r < N; r += 1) for (let c = 0; c < N; c += 1) {
          if (board[r][c]) continue;
          let theirs = false;
          try { theirs = Boolean(isFoul(c + r * N, arr.slice())); } catch { continue; }
          const mine = evaluateRenjuMove(board, { row: r, col: c }).forbidden !== null;
          compared += 1;
          if (theirs && mine) both += 1;
          else if (!theirs && !mine) neither += 1;
          else if (theirs) {
            missTotal += 1;
            if (missFoul.length < 6) missFoul.push({ board: board.map((row) => row.slice()), row: r, col: c });
            // 逐线拆解：把它四个方向上的 testLineThree/Four/Foul 返回值与我们自己的
            // fourCount / openThreeCount 并排打出来——差异出在"四的计数"还是"三的定义"。
            const detail = evaluateRenjuMove(board, { row: r, col: c });
            const perLine = [0, 1, 2, 3].map((direction) => {
              const three = (sandbox.testLineThree as (i: number, d: number, color: number, a: number[]) => unknown)(c + r * N, direction, 1, arr.slice());
              const four = (sandbox.testLineFour as (i: number, d: number, color: number, a: number[]) => unknown)(c + r * N, direction, 1, arr.slice());
              const foul = (sandbox.testLineFoul as (i: number, d: number, color: number, a: number[]) => unknown)(c + r * N, direction, 1, arr.slice());
              return `d${direction}[three=${three} four=${four} foul=${foul}]`;
            });
            console.log(`  明细 ${coord(r, c)}：我们 fours=${detail.fourCount} threes=${detail.openThreeCount} reason=${detail.forbidden} ｜ 它 ${perLine.join(" ")}`);
            // 把四个方向的窗口内容打出来（move -5..+5）：. 空 / X 黑 / O 白 / # 出盘
            // DIRECTIONS = [→, ↓, ↘, ↗]
            const dirs = [[0, 1], [1, 0], [1, 1], [-1, 1]];
            const windows = dirs.map(([dr, dc], index) => {
              let out = "";
              for (let move = -5; move <= 5; move += 1) {
                const rr = r + dr * move, cc = c + dc * move;
                if (rr < 0 || cc < 0 || rr >= N || cc >= N) { out += "#"; continue; }
                const v = arr[cc + rr * N];
                out += v === 0 ? "." : v === 1 ? "X" : "O";
              }
              return `d${index}:${out}`;
            });
            console.log(`      窗口 ${windows.join("  ")}`);
          }
          else { falseTotal += 1; if (falseFoul.length < 6) falseFoul.push({ board: board.map((row) => row.slice()), row: r, col: c }); }
        }
      }
    }
    console.log(`\n真实棋谱局面：${gamePositions} 个`);

    console.log(`\n比对了 ${compared} 个空点（${ROUNDS} 个随机局面）`);
    if (firstError) console.log(`  首个异常：${firstError}`);    console.log(`  双方都判禁手 ${both} ｜ 双方都判合法 ${neither}`);
    console.log(`  我们漏判 ${missTotal}${missTotal > missFoul.length ? "（示例 6 个）" : ""}`);
    for (const entry of missFoul) console.log(`    · ${describe(entry)}`);
    console.log(`  我们误判 ${falseTotal}${falseTotal > falseFoul.length ? "（示例 6 个）" : ""}`);
    for (const entry of falseFoul) console.log(`    · ${describe(entry)}`);
  }, 120000);
});
