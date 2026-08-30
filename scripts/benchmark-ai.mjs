import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const maxPlies = Number(process.env.AI_BENCHMARK_PLIES || 15);
const limit = process.env.AI_BENCHMARK_LIMIT ? Number(process.env.AI_BENCHMARK_LIMIT) : undefined;
const requestedProfiles = (process.env.AI_BENCHMARK_PROFILES || "高级")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const profiles = {
  "初级": { label: "初级", timeMs: 600, maxDepth: 32 },
  "中级": { label: "中级", timeMs: 1200, maxDepth: 48 },
  "高级": { label: "高级", timeMs: 1800, maxDepth: 64 },
  "大师": { label: "大师", timeMs: 3000, maxDepth: 80 },
  "不限": { label: "不限", timeMs: 300000, maxDepth: 128 },
  quick: { label: "初级", timeMs: 600, maxDepth: 32 },
  standard: { label: "高级", timeMs: 1800, maxDepth: 64 },
  strong: { label: "大师", timeMs: 3000, maxDepth: 80 },
  expert: { label: "不限", timeMs: 300000, maxDepth: 128 },
};
const selectedProfiles = requestedProfiles
  .map((profile) => profiles[profile])
  .filter((profile, index, values) => profile && values.indexOf(profile) === index);
if (!selectedProfiles.length) throw new Error("没有可用的 AI 强度档位：" + requestedProfiles.join(", "));

const collectionTitles = [
  "三手胜1-入门题",
  "三手胜2-初级题",
  "三手胜3-中级题",
  "三手胜4-高级题",
];
const requestedCollections = (process.env.AI_BENCHMARK_COLLECTIONS || collectionTitles.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const selectedCollections = collectionTitles.filter((title) => requestedCollections.includes(title));
if (!selectedCollections.length) throw new Error("没有可用的题库：" + requestedCollections.join(", "));
const puzzleRoot = new URL("../public/puzzles/kaibao/", import.meta.url);
const loadPuzzles = async (title) => {
  const raw = JSON.parse(await readFile(new URL(title + ".json", puzzleRoot), "utf8"));
  const rows = limit ? raw.slice(0, limit) : raw;
  return rows.map((stones, index) => ({
    id: String(index + 1),
    stones: stones.filter((value) => typeof value === "string" && value.includes(",")).map((value) => {
      const [coordinate, color] = value.split(",");
      return {
        col: coordinate.charCodeAt(0) - 65,
        row: 14 - Number(coordinate.slice(1)),
        player: color === "1" ? "black" : "white",
      };
    }),
  }));
};

const other = (player) => player === "black" ? "white" : "black";
const winner = (moves, last) => {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  for (const move of moves) board[move.row][move.col] = move.player;
  const exact = last.player === "black";
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return directions.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      for (let step = 1; board[last.row + dr * step * sign]?.[last.col + dc * step * sign] === last.player; step += 1) count += 1;
    }
    return exact ? count === 5 : count >= 5;
  });
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.Worker));

const analyze = async (moves, player, profile) => page.evaluate(({ nextMoves, nextPlayer, timeMs, maxDepth }) => new Promise((resolve, reject) => {
  const key = "__banbuRapfiBench";
  const state = window[key] || (() => {
    const worker = new Worker("./rapfi/rapfi-worker.js");
    const created = { worker, pending: null, variant: "unknown" };
    worker.onmessage = (event) => {
      if (event.data.type === "ready") { created.variant = event.data.variant || "unknown"; return; }
      if (event.data.type === "result" && created.pending) {
        const current = created.pending;
        created.pending = null;
        current.resolve({ ...event.data.result, engineVariant: created.variant });
      }
      if (event.data.type === "error" && created.pending) {
        const current = created.pending;
        created.pending = null;
        current.reject(new Error(event.data.message || "Rapfi error"));
      }
    };
    window[key] = created;
    return created;
  })();
  state.pending = { resolve, reject };
  state.worker.postMessage({ type: "analyze", engine: "fallback", size: 15, moves: nextMoves, player: nextPlayer, rule: "renju", timeMs, maxDepth });
}), { nextMoves: moves, nextPlayer: player, timeMs: profile.timeMs, maxDepth: profile.maxDepth });

const runPuzzle = async (puzzle, profile) => {
  let moves = [...puzzle.stones];
  const attacker = moves.length % 2 === 0 ? "black" : "white";
  let solved = false;
  let error = "";
  let engineVariant = "unknown";
  try {
    for (let ply = 0; ply < maxPlies; ply += 1) {
      const player = ply % 2 === 0 ? attacker : other(attacker);
      const result = await analyze(moves.map((move) => ({ ...move })), player, profile);
      engineVariant = result.engineVariant || engineVariant;
      if (!result?.move) { error = "Rapfi 没有返回落点"; break; }
      const move = { ...result.move, player };
      if (moves.some((item) => item.row === move.row && item.col === move.col)) { error = "返回了重复落点"; break; }
      moves.push(move);
      if (winner(moves, move)) { solved = player === attacker; break; }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return {
    id: puzzle.id,
    solved,
    plies: moves.length - puzzle.stones.length,
    error,
    engineVariant,
  };
};

const groups = [];
for (const profile of selectedProfiles) {
  for (const collectionTitle of selectedCollections) {
    const puzzles = await loadPuzzles(collectionTitle);
    const results = [];
    for (const puzzle of puzzles) {
      const result = await runPuzzle(puzzle, profile);
      results.push(result);
      console.log(JSON.stringify({ profile: profile.label, collection: collectionTitle, ...result }));
    }
    const solved = results.filter((result) => result.solved).length;
    groups.push({
      profile: profile.label,
      timeMs: profile.timeMs,
      maxDepth: profile.maxDepth,
      collectionTitle,
      total: results.length,
      solved,
      passRate: results.length ? solved / results.length : 0,
      failedPuzzleIds: results.filter((result) => !result.solved).map((result) => result.id),
      errorCount: results.filter((result) => result.error).length,
      averagePlies: results.length ? results.reduce((sum, result) => sum + result.plies, 0) / results.length : 0,
      engineVariants: [...new Set(results.map((result) => result.engineVariant))],
      results,
    });
  }
}
await browser.close();

const payload = {
  generatedAt: new Date().toISOString(),
  engine: "Rapfi fallback WASM",
  scope: "网页人机 AI 的实际解题通过率；不等同于 VCF 完整证明能力",
  maxPlies,
  profiles: selectedProfiles.map((profile) => ({ label: profile.label, timeMs: profile.timeMs, maxDepth: profile.maxDepth })),
  groups,
};
const percent = (value) => (value * 100).toFixed(1) + "%";
const markdown = [
  "# AI 强度基准报告（" + new Date().toISOString().slice(0, 10) + "）",
  "",
  "- 引擎：Rapfi fallback WASM；测试范围：四组三手胜题库；每题最多 " + maxPlies + " 半步。",
  "- 这份报告衡量网页实际人机 AI 的解题通过率；VCF proof 是独立的战术证明专项，不混入本等级。",
  "",
  "## 四档中文强度",
  "",
  "| AI 档位 | 思考时间 | 最大深度 | 说明 |",
  "|---|---:|---:|---|",
  "| 初级 | 600ms | 32 | 快速应对 |",
  "| 中级 | 1200ms | 48 | 平衡速度与深度 |",
  "| 高级 | 1800ms | 64 | 默认推荐，接近历史基准 |",
  "| 大师 | 3000ms | 80 | 更长思考，优先寻找强制手 |",
  "| 不限 | 300000ms（5分钟） | 128 | 尽可能深搜，保留浏览器保护上限 |",
  "",
  "## 通过率",
  "",
  "| AI 档位 | 题库 | 通过 | 通过率 | 平均新增半步 | 引擎 |",
  "|---|---|---:|---:|---:|---|",
  ...groups.map((group) => "| " + group.profile + " | " + group.collectionTitle + " | " + group.solved + "/" + group.total + " | " + percent(group.passRate) + " | " + group.averagePlies.toFixed(1) + " | " + group.engineVariants.join(", ") + " |"),
  "",
  "## 失败题目",
  "",
  ...groups.map((group) => "- " + group.profile + " / " + group.collectionTitle + "：" + (group.failedPuzzleIds.length ? group.failedPuzzleIds.join(", ") : "无")),
  "",
].join("\n");

const reportPath = process.env.AI_BENCHMARK_REPORT || new URL("../docs/ai-strength-benchmark-2026-08-29.md", import.meta.url);
await writeFile(reportPath, markdown, "utf8");
console.log(JSON.stringify(payload, null, 2));
console.log("\nMarkdown report: " + (reportPath.pathname || reportPath));
if (process.env.AI_BENCHMARK_FAIL_ON_INCOMPLETE === "1" && groups.some((group) => group.solved !== group.total)) process.exitCode = 1;
