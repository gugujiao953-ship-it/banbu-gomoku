// qa/scnet-vcf-verify-entry.ts
import { appendFileSync, readFileSync, existsSync } from "node:fs";

// src/features/vcf/vcf-generator.ts
var SIZE = 15;
var VCF_BLACK = 1;
var VCF_WHITE = 2;
var VCF_EMPTY = 0;
var BLACK = VCF_BLACK;
var WHITE = VCF_WHITE;
var EMPTY = VCF_EMPTY;
var DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
var idx = (row, col) => row * SIZE + col;
var inside = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
var contiguous = (board, row, col, player, dr, dc) => {
  if (board[idx(row, col)] !== player) return [];
  const line = [];
  for (let s = 1; inside(row - dr * s, col - dc * s) && board[idx(row - dr * s, col - dc * s)] === player; s += 1) line.unshift(idx(row - dr * s, col - dc * s));
  line.push(idx(row, col));
  for (let s = 1; inside(row + dr * s, col + dc * s) && board[idx(row + dr * s, col + dc * s)] === player; s += 1) line.push(idx(row + dr * s, col + dc * s));
  return line;
};
var runsAround = (board, row, col, player) => DIRECTIONS.map(([dr, dc]) => contiguous(board, row, col, player, dr, dc).length);
var fiveAt = (board, row, col, player, rules) => {
  if (board[idx(row, col)] !== EMPTY) return false;
  board[idx(row, col)] = player;
  const runs = runsAround(board, row, col, player);
  board[idx(row, col)] = EMPTY;
  return rules === "renju" && player === BLACK ? runs.some((n) => n === 5) : runs.some((n) => n >= 5);
};
var fourPatternsThrough = (board, row, col, player, rules) => {
  const patterns = /* @__PURE__ */ new Map();
  DIRECTIONS.forEach(([dr, dc], direction) => {
    for (let off = -5; off <= 5; off += 1) {
      const wr = row + dr * off, wc = col + dc * off;
      if (!inside(wr, wc) || board[idx(wr, wc)] !== EMPTY || !fiveAt(board, wr, wc, player, rules)) continue;
      board[idx(wr, wc)] = player;
      const line = contiguous(board, wr, wc, player, dr, dc);
      board[idx(wr, wc)] = EMPTY;
      if (line.length !== 5 || !line.includes(idx(row, col))) continue;
      const stones = line.filter((i) => i !== idx(wr, wc)).sort((a, b) => a - b);
      const key = `${direction}:${stones.join("|")}`;
      const cur = patterns.get(key);
      if (cur) {
        if (!cur.win.includes(idx(wr, wc))) cur.win.push(idx(wr, wc));
      } else patterns.set(key, { direction, stones, win: [idx(wr, wc)] });
    }
  });
  return [...patterns.values()];
};
var exactFiveAt = (board, row, col, player) => runsAround(board, row, col, player).some((n) => n === 5);
var overlineAt = (board, row, col, player) => runsAround(board, row, col, player).some((n) => n >= 6);
var openThreePatternsThrough = (board, row, col, rules, deep = true) => {
  const patterns = /* @__PURE__ */ new Set();
  DIRECTIONS.forEach(([dr, dc], direction) => {
    for (let off = -4; off <= 4; off += 1) {
      const er = row + dr * off, ec = col + dc * off;
      if (!inside(er, ec) || board[idx(er, ec)] !== EMPTY) continue;
      board[idx(er, ec)] = BLACK;
      const fours = fourPatternsThrough(board, er, ec, BLACK, rules);
      let illegal = true;
      const qualifying = fours.filter((f) => f.direction === direction && f.win.length >= 2 && f.stones.includes(idx(row, col)));
      if (qualifying.length) {
        const extWins = exactFiveAt(board, er, ec, BLACK);
        illegal = overlineAt(board, er, ec, BLACK) || !extWins && fours.length >= 2;
        if (!illegal && !extWins && deep) illegal = openThreePatternsThrough(board, er, ec, rules, false).length >= 2;
      }
      board[idx(er, ec)] = EMPTY;
      if (illegal || !qualifying.length) continue;
      for (const four of qualifying) {
        const three = four.stones.filter((i) => i !== idx(er, ec));
        if (three.length === 3 && three.includes(idx(row, col))) patterns.add(`${direction}:${three.slice().sort((a, b) => a - b).join("|")}`);
      }
    }
  });
  return [...patterns];
};
var blackFourMoves = (board, rules) => {
  const freestyle = rules !== "renju";
  let hasBlack = false;
  for (let i = 0; i < board.length; i += 1) if (board[i] === BLACK) {
    hasBlack = true;
    break;
  }
  if (!hasBlack) return [];
  const nearBlack = (r, c) => {
    for (let dr = -4; dr <= 4; dr += 1) for (let dc = -4; dc <= 4; dc += 1) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[idx(rr, cc)] === BLACK) return true;
    }
    return false;
  };
  const out = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[idx(r, c)] !== EMPTY || !nearBlack(r, c)) continue;
    board[idx(r, c)] = BLACK;
    const runs = runsAround(board, r, c, BLACK);
    if (runs.some((n) => freestyle ? n >= 5 : n === 5)) {
      board[idx(r, c)] = EMPTY;
      continue;
    }
    if (!freestyle && runs.some((n) => n >= 6)) {
      board[idx(r, c)] = EMPTY;
      continue;
    }
    const fours = fourPatternsThrough(board, r, c, BLACK, rules);
    if (!fours.length) {
      board[idx(r, c)] = EMPTY;
      continue;
    }
    if (!freestyle && fours.length >= 2) {
      board[idx(r, c)] = EMPTY;
      continue;
    }
    if (!freestyle && openThreePatternsThrough(board, r, c, rules).length >= 2) {
      board[idx(r, c)] = EMPTY;
      continue;
    }
    board[idx(r, c)] = EMPTY;
    out.push({ row: r, col: c, win: fours[0].win.slice(), open: fours.some((f) => f.win.length >= 2) });
  }
  return out;
};
var fourMovesOf = (board, player, rules) => player === BLACK ? blackFourMoves(board, rules) : whiteFourMoves(board);
var whiteFourMoves = (board) => {
  const out = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[idx(r, c)] !== EMPTY) continue;
    board[idx(r, c)] = WHITE;
    const fours = fourPatternsThrough(board, r, c, WHITE, "renju");
    board[idx(r, c)] = EMPTY;
    if (fours.length) out.push({ row: r, col: c, win: fours[0].win.slice(), open: fours.some((f) => f.win.length >= 2) });
  }
  return out;
};
var vcfFivePoints = (board, player, rules) => {
  const out = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[idx(r, c)] !== EMPTY) continue;
    let near = false;
    for (let dr = -4; dr <= 4 && !near; dr += 1) for (let dc = -4; dc <= 4 && !near; dc += 1) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[idx(rr, cc)] === player) near = true;
    }
    if (near && fiveAt(board, r, c, player, rules)) out.push(idx(r, c));
  }
  return out;
};
function solveVcf(board, { attacker = BLACK, rules = "renju", maxDepth = 9, timeBudget = 0 } = {}) {
  const defender = attacker === BLACK ? WHITE : BLACK;
  let nodes = 0;
  let aborted = false;
  const deadline = timeBudget > 0 ? Date.now() + timeBudget : 0;
  let bestLine = null;
  const path = [];
  const fiveList = (p) => vcfFivePoints(board, p, rules);
  const attackerFours = () => attacker === BLACK ? blackFourMoves(board, rules) : fourMovesOf(board, attacker, rules);
  const attack = (depth) => {
    nodes += 1;
    if (deadline && Date.now() > deadline) {
      aborted = true;
      return false;
    }
    const fives = fiveList(attacker);
    if (fives.length) {
      const p = fives[0];
      path.push({ row: Math.floor(p / SIZE), col: p % SIZE, player: attacker, note: "\u6210\u4E94" });
      bestLine = path.slice();
      path.pop();
      return true;
    }
    if (depth <= 0) return false;
    const threats = fiveList(defender);
    for (const m of attackerFours()) {
      if (m.open) {
        path.push({ row: m.row, col: m.col, player: attacker, note: "\u6D3B\u56DB" });
        bestLine = path.slice();
        path.pop();
        return true;
      }
      if (threats.length && !(threats.length === 1 && m.win.includes(threats[0]))) continue;
      place(board, m, attacker);
      path.push({ row: m.row, col: m.col, player: attacker, note: "\u51B2\u56DB" });
      const won = defend(depth, m);
      remove(board, m);
      path.pop();
      if (won) return true;
    }
    return false;
  };
  const defend = (depth, attackerMove) => {
    nodes += 1;
    if (deadline && Date.now() > deadline) {
      aborted = true;
      return false;
    }
    if (fiveList(defender).length) return false;
    const replies = [];
    if (attackerMove.win.length === 1) {
      const br = Math.floor(attackerMove.win[0] / SIZE), bc = attackerMove.win[0] % SIZE;
      if (defender === BLACK) {
        const legality = evaluateBlackLegality(board, br, bc);
        if (legality) replies.push([br, bc, "\u5835\u56DB"]);
      } else replies.push([br, bc, "\u5835\u56DB"]);
    } else return true;
    for (const cf of fourMovesOf(board, defender, rules)) {
      if (defender === BLACK && rules === "renju" && !blackMoveLegal(board, cf.row, cf.col)) continue;
      replies.push([cf.row, cf.col, "\u53CD\u51FB\u56DB"]);
    }
    if (!replies.length) return true;
    for (const [rr, cc, note] of replies) {
      place(board, { row: rr, col: cc }, defender);
      path.push({ row: rr, col: cc, player: defender, note });
      const survived = attack(depth - 1);
      remove(board, { row: rr, col: cc });
      path.pop();
      if (!survived) return false;
    }
    return true;
  };
  const started = Date.now();
  const win = attack(maxDepth);
  void started;
  return { win, line: bestLine || [], nodes, aborted };
}
var place = (board, p, player) => {
  board[idx(p.row, p.col)] = player;
};
var remove = (board, p) => {
  board[idx(p.row, p.col)] = EMPTY;
};
var blackMoveLegal = (board, row, col) => evaluateBlackLegality(board, row, col);
var evaluateBlackLegality = (board, row, col) => {
  board[idx(row, col)] = BLACK;
  const runs = runsAround(board, row, col, BLACK);
  const exactFive = runs.some((n) => n === 5);
  const overline = runs.some((n) => n >= 6);
  let legal;
  if (exactFive) legal = true;
  else if (overline) legal = false;
  else {
    const fours = fourPatternsThrough(board, row, col, BLACK, "renju");
    if (fours.length >= 2) legal = false;
    else legal = openThreePatternsThrough(board, row, col, "renju").length < 2;
  }
  board[idx(row, col)] = EMPTY;
  return legal;
};

// src/renju-forbid.ts
var S = 15;
var BORDER = 1024;
var BLACK2 = 1;
var WHITE2 = -1;
var padLine = (cells) => {
  const line = new Array(S + 4).fill(BORDER);
  for (let i = 0; i < S; i += 1) line[i + 2] = cells[i] ?? BORDER;
  return line;
};
var lineThrough = (board, x, y, direction) => {
  const cells = [];
  if (direction === 0) {
    for (let col = 0; col < S; col += 1) cells.push(board[x][col] ?? 0);
    return { line: padLine(cells), position: y };
  }
  if (direction === 1) {
    for (let row = 0; row < S; row += 1) cells.push(board[row][y] ?? 0);
    return { line: padLine(cells), position: x };
  }
  const key = direction === 2 ? x + y : S - 1 - y + x;
  for (let j = 0; j < S; j += 1) {
    const row = direction === 2 ? key - j : key - j;
    const col = direction === 2 ? j : S - 1 - j;
    cells.push(row >= 0 && row < S && col >= 0 && col < S ? board[row][col] ?? 0 : BORDER);
  }
  return { line: padLine(cells), position: direction === 2 ? y : S - 1 - y };
};
var sum5 = (line, i) => line[i] + line[i + 1] + line[i + 2] + line[i + 3] + line[i + 4];
var lineA5 = (line, rawP) => {
  const p = rawP + 2;
  if (line[p] === 0) return 0;
  const lower = Math.max(2, p - 4);
  const upper = Math.min(S - 3, p);
  for (let i = lower; i <= upper; i += 1) {
    if (sum5(line, i) !== 5) continue;
    if (line[i - 1] !== BLACK2 && line[i + 5] !== BLACK2) return 1;
  }
  return 0;
};
var lineB4 = (line, rawP) => {
  const x0 = BLACK2;
  const p = rawP + 2;
  if (line[p] === 0) return 0;
  const lower = Math.max(2, p - 4);
  const upper = Math.min(S - 3, p);
  for (let i = lower; i <= upper; i += 1) {
    if (sum5(line, i) !== 4) continue;
    const shape = (line[i] << 4) + (line[i + 1] << 3) + (line[i + 2] << 2) + (line[i + 3] << 1) + line[i + 4];
    switch (shape) {
      case 30:
        if (line[i - 1] !== x0 && line[i + 5] !== x0) return 1;
        break;
      case 29:
        if (line[i - 1] !== x0 && line[i + 5] !== x0) {
          if (line[i + 5] === 0 && i <= 8 && line[i + 6] === x0 && line[i + 7] === x0 && line[i + 8] === x0 && line[i + 9] !== x0 && p === i + 4) return 2;
          return 1;
        }
        break;
      case 27:
        if (line[i - 1] !== x0 && line[i + 5] !== x0) {
          if (line[i + 5] === 0 && i <= 9 && line[i + 6] === x0 && line[i + 7] === x0 && line[i + 8] !== x0 && (p === i + 4 || p === i + 3)) return 2;
          return 1;
        }
        break;
      case 23:
        if (line[i - 1] !== x0 && line[i + 5] !== x0) {
          if (line[i + 5] === 0 && i <= 10 && line[i + 6] === x0 && line[i + 7] !== x0 && (p === i + 4 || p === i + 3 || p === i + 2)) return 2;
          return 1;
        }
        break;
      case 15:
        if (line[i - 1] !== x0 && line[i + 5] !== x0) return 1;
        break;
      default:
        break;
    }
  }
  return 0;
};
var COMB = (level, paddedIndex) => level << 8 | paddedIndex - 2;
var COMC = (level, first, second) => COMB(COMB(level, first), second);
var lowByte = (packed) => packed & 255;
var highByte = (packed) => (packed & 65280) >> 8;
var lineA3 = (line, rawP) => {
  const x0 = BLACK2;
  const p = rawP + 2;
  if (line[p] === 0) return 0;
  const lower = Math.max(2, p - 3);
  const upper = Math.min(S - 2, p);
  for (let i = lower; i <= upper; i += 1) {
    const sum = line[i] + line[i + 1] + line[i + 2] + line[i + 3];
    const product = line[i] * line[i + 1] * line[i + 2] * line[i + 3];
    if (sum !== 3 || product !== 0) continue;
    const shape = (line[i] << 3) + (line[i + 1] << 2) + (line[i + 2] << 1) + line[i + 3];
    switch (shape) {
      case 14:
        if (line[i - 1] === 0 && line[i - 2] !== x0 && line[i + 4] !== x0) {
          if (line[i - 2] === 0 && line[i - 3] !== x0 && line[i + 4] === 0 && line[i + 5] !== x0) return COMC(1, i - 1, i + 3);
          if (line[i - 2] === 0 && line[i - 3] !== x0) return COMB(1, i - 1);
          if (line[i + 4] === 0 && line[i + 5] !== x0) return COMB(1, i + 3);
        }
        break;
      case 13:
        if (line[i - 1] === 0 && line[i + 4] === 0 && line[i - 2] !== x0 && line[i + 5] !== x0) return COMB(1, i + 2);
        break;
      case 11:
        if (line[i - 1] === 0 && line[i + 4] === 0 && line[i - 2] !== x0 && line[i + 5] !== x0) return COMB(1, i + 1);
        break;
      default:
        break;
    }
  }
  return 0;
};
var lineA6 = (line, rawP) => {
  const p = rawP + 2;
  if (line[p] !== BLACK2) return 0;
  const lower = Math.max(2, p - 5);
  const upper = Math.min(S - 4, p);
  for (let i = lower; i <= upper; i += 1) {
    if (sum5(line, i) + line[i + 5] === 6) return 1;
  }
  return 0;
};
var perDirection = (board, x, y, run) => {
  const out = [];
  for (let direction = 0; direction < 4; direction += 1) {
    const { line, position } = lineThrough(board, x, y, direction);
    out.push(run(line, position));
  }
  return out;
};
var makesFiveAt = (board, x, y) => {
  const placed = board[x][y] === 0;
  if (placed) board[x][y] = BLACK2;
  const result = perDirection(board, x, y, lineA5).some((value) => value !== 0) ? 1 : 0;
  if (placed) board[x][y] = 0;
  return result;
};
var fourCountAt = (board, x, y) => perDirection(board, x, y, lineB4).reduce((sum, value) => sum + value, 0);
var threeCountAt = (board, x, y) => {
  let count = 0;
  for (let direction = 0; direction < 4; direction += 1) {
    const { line, position } = lineThrough(board, x, y, direction);
    const packed = lineA3(line, position);
    if (packed === 0) continue;
    const toBoard = (value) => {
      if (direction === 0) return [x, value];
      if (direction === 1) return [value, y];
      if (direction === 2) return [x + y - value, value];
      return [S - 1 + x - y - value, S - 1 - value];
    };
    const inspect = (value) => {
      const [row, col] = toBoard(value);
      if (row < 0 || col < 0 || row >= S || col >= S) return false;
      return foulAt(board, row, col) !== null || makesFiveAt(board, row, col) !== 0;
    };
    if (packed < 65536) {
      if (inspect(lowByte(packed))) count -= 1;
    } else if (inspect(lowByte(packed)) && inspect(highByte(packed))) {
      count -= 1;
    }
    count += 1;
  }
  return count;
};
var overlineAt2 = (board, x, y) => perDirection(board, x, y, lineA6).some((value) => value !== 0);
var foulAt = (board, x, y) => {
  if (board[x][y] === WHITE2) return null;
  const placed = board[x][y] === 0;
  if (placed) board[x][y] = BLACK2;
  let result = null;
  if (makesFiveAt(board, x, y) === 0) {
    if (fourCountAt(board, x, y) >= 2) result = "double-four";
    else if (threeCountAt(board, x, y) >= 2) result = "double-three";
    else if (overlineAt2(board, x, y)) result = "overline";
  }
  if (placed) board[x][y] = 0;
  return result;
};
var foulReport = (board, x, y) => {
  var _a;
  const working = board.map((row) => row.slice());
  if (((_a = working[x]) == null ? void 0 : _a[y]) === WHITE2) return { kind: null, fours: 0, threes: 0 };
  const placed = working[x][y] === 0;
  if (placed) working[x][y] = BLACK2;
  const five = makesFiveAt(working, x, y) !== 0;
  const fours = fourCountAt(working, x, y);
  const threes = threeCountAt(working, x, y);
  const over = overlineAt2(working, x, y);
  if (placed) working[x][y] = 0;
  const kind = five ? null : fours >= 2 ? "double-four" : threes >= 2 ? "double-three" : over ? "overline" : null;
  return { kind, fours, threes };
};

// src/game.ts
var BOARD_SIZE = 15;
var DIRECTIONS2 = [[1, 0], [0, 1], [1, 1], [1, -1]];
var pointKey = ({ row, col }) => `${row},${col}`;
var samePoint = (left, right) => left.row === right.row && left.col === right.col;
var cloneBoard = (board) => board.map((row) => [...row]);
var insideBoard = (board, row, col) => {
  var _a;
  return row >= 0 && row < board.length && col >= 0 && col < (((_a = board[row]) == null ? void 0 : _a.length) || 0);
};
var contiguousLine = (board, position, player, dr, dc) => {
  var _a, _b, _c;
  if (((_a = board[position.row]) == null ? void 0 : _a[position.col]) !== player) return [];
  const before = [];
  for (let step = 1; ((_b = board[position.row - dr * step]) == null ? void 0 : _b[position.col - dc * step]) === player; step += 1) {
    before.unshift({ row: position.row - dr * step, col: position.col - dc * step });
  }
  const after = [];
  for (let step = 1; ((_c = board[position.row + dr * step]) == null ? void 0 : _c[position.col + dc * step]) === player; step += 1) {
    after.push({ row: position.row + dr * step, col: position.col + dc * step });
  }
  return [...before, position, ...after];
};
var pointsOnAxis = (board, origin, dr, dc, radius = board.length - 1) => {
  const result = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const row = origin.row + dr * offset, col = origin.col + dc * offset;
    if (insideBoard(board, row, col)) result.push({ row, col });
  }
  return result;
};
var fourPatternsThrough2 = (board, origin) => {
  const patterns = /* @__PURE__ */ new Map();
  DIRECTIONS2.forEach(([dr, dc], direction) => {
    var _a;
    for (const winningPoint of pointsOnAxis(board, origin, dr, dc, 5)) {
      if (((_a = board[winningPoint.row]) == null ? void 0 : _a[winningPoint.col]) !== null) continue;
      board[winningPoint.row][winningPoint.col] = "black";
      const line = contiguousLine(board, winningPoint, "black", dr, dc);
      board[winningPoint.row][winningPoint.col] = null;
      if (line.length !== 5 || !line.some((point) => samePoint(point, origin))) continue;
      const stones = line.filter((point) => !samePoint(point, winningPoint));
      const key = `${direction}:${stones.map(pointKey).sort().join("|")}`;
      const current = patterns.get(key);
      if (current) {
        if (!current.winningPoints.some((point) => samePoint(point, winningPoint))) current.winningPoints.push(winningPoint);
      } else patterns.set(key, { direction, stones, winningPoints: [winningPoint] });
    }
  });
  return [...patterns.values()];
};
var hasOverlineAt = (board, position) => DIRECTIONS2.some(([dr, dc]) => contiguousLine(board, position, "black", dr, dc).length > 5);
var hasExactFiveAt = (board, position) => DIRECTIONS2.some(([dr, dc]) => contiguousLine(board, position, "black", dr, dc).length === 5);
var openThreePatternsThrough2 = (board, origin, validateExtensionDoubleThree = true) => {
  const patterns = /* @__PURE__ */ new Set();
  DIRECTIONS2.forEach(([dr, dc], direction) => {
    var _a;
    for (const extension of pointsOnAxis(board, origin, dr, dc, 4)) {
      if (((_a = board[extension.row]) == null ? void 0 : _a[extension.col]) !== null) continue;
      board[extension.row][extension.col] = "black";
      const extensionFours = fourPatternsThrough2(board, extension);
      const qualifyingFours = extensionFours.filter((four) => four.direction === direction && four.winningPoints.length >= 2 && four.stones.some((point) => samePoint(point, extension)));
      if (!qualifyingFours.length) {
        board[extension.row][extension.col] = null;
        continue;
      }
      const extensionWins = hasExactFiveAt(board, extension);
      let illegalExtension = hasOverlineAt(board, extension) || !extensionWins && extensionFours.length >= 2;
      if (!illegalExtension && !extensionWins && validateExtensionDoubleThree) {
        illegalExtension = openThreePatternsThrough2(board, extension, false).length >= 2;
      }
      board[extension.row][extension.col] = null;
      if (illegalExtension || extensionWins) continue;
      for (const four of qualifyingFours) {
        const three = four.stones.filter((point) => !samePoint(point, extension));
        if (three.length === 3 && three.some((point) => samePoint(point, origin))) patterns.add(`${direction}:${three.map(pointKey).sort().join("|")}`);
      }
    }
  });
  return [...patterns];
};
var renjuEvaluationCache = /* @__PURE__ */ new WeakMap();
var toNumericBoard = (board) => board.map((row) => row.map((cell) => cell === "black" ? 1 : cell === "white" ? -1 : 0));
var blackMoveEvaluation = (next, position) => {
  if (next.length === BOARD_SIZE && next.every((row) => row.length === BOARD_SIZE)) {
    const report = foulReport(toNumericBoard(next), position.row, position.col);
    const exactFive2 = hasExactFiveAt(next, position);
    if (!report.kind) return { legal: true, forbidden: null, reason: null, exactFive: exactFive2, fourCount: report.fours, openThreeCount: report.threes };
    const reason = report.kind === "double-three" ? "\u4E09\u4E09\u7981\u624B" : report.kind === "double-four" ? "\u56DB\u56DB\u7981\u624B" : "\u957F\u8FDE\u7981\u624B";
    return { legal: false, forbidden: report.kind, reason, exactFive: exactFive2, fourCount: report.fours, openThreeCount: report.threes };
  }
  const overline = hasOverlineAt(next, position);
  const exactFive = hasExactFiveAt(next, position);
  if (exactFive) return { legal: true, forbidden: null, reason: null, exactFive: true, fourCount: 0, openThreeCount: 0 };
  if (overline) return { legal: false, forbidden: "overline", reason: "\u957F\u8FDE\u7981\u624B", exactFive: false, fourCount: 0, openThreeCount: 0 };
  const fours = fourPatternsThrough2(next, position);
  if (fours.length >= 2) return { legal: false, forbidden: "double-four", reason: "\u56DB\u56DB\u7981\u624B", exactFive: false, fourCount: fours.length, openThreeCount: 0 };
  const threes = openThreePatternsThrough2(next, position);
  if (threes.length >= 2) return { legal: false, forbidden: "double-three", reason: "\u4E09\u4E09\u7981\u624B", exactFive: false, fourCount: fours.length, openThreeCount: threes.length };
  return { legal: true, forbidden: null, reason: null, exactFive: false, fourCount: fours.length, openThreeCount: threes.length };
};
var evaluateRenjuMove = (board, position) => {
  var _a, _b;
  const boardKey = board.map((row) => row.map((cell) => cell === "black" ? "1" : cell === "white" ? "2" : "0").join("")).join("/");
  const cacheKey = `${pointKey(position)}:${boardKey}`;
  const cached = (_a = renjuEvaluationCache.get(board)) == null ? void 0 : _a.get(cacheKey);
  if (cached) return cached;
  const remember = (evaluation) => {
    let cache = renjuEvaluationCache.get(board);
    if (!cache) {
      cache = /* @__PURE__ */ new Map();
      renjuEvaluationCache.set(board, cache);
    }
    cache.set(cacheKey, evaluation);
    return evaluation;
  };
  if (((_b = board[position.row]) == null ? void 0 : _b[position.col]) !== null) return remember({ legal: false, forbidden: null, reason: "\u8BE5\u4F4D\u7F6E\u5DF2\u6709\u68CB\u5B50", exactFive: false, fourCount: 0, openThreeCount: 0 });
  const next = cloneBoard(board);
  next[position.row][position.col] = "black";
  return remember(blackMoveEvaluation(next, position));
};

// src/features/vcf-challenge/engine.ts
var VCF_SIZE = 15;
var vidx = (row, col) => row * VCF_SIZE + col;
var inVcfBoard = (row, col) => row >= 0 && row < VCF_SIZE && col >= 0 && col < VCF_SIZE;
var codeOf = (p) => p === "black" ? VCF_BLACK : VCF_WHITE;
var toCellGrid = (board) => {
  const grid = [];
  for (let r = 0; r < VCF_SIZE; r += 1) {
    const row = [];
    for (let c = 0; c < VCF_SIZE; c += 1) {
      const v = board[vidx(r, c)];
      row.push(v === VCF_BLACK ? "black" : v === VCF_WHITE ? "white" : null);
    }
    grid.push(row);
  }
  return grid;
};
var isFiveAt = (board, row, col, player, exactFiveForBlack) => {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let len = 1;
    for (let i = 1; ; i += 1) {
      const rr = row + dr * i, cc = col + dc * i;
      if (!inVcfBoard(rr, cc) || board[vidx(rr, cc)] !== player) break;
      len += 1;
    }
    for (let i = 1; ; i += 1) {
      const rr = row - dr * i, cc = col - dc * i;
      if (!inVcfBoard(rr, cc) || board[vidx(rr, cc)] !== player) break;
      len += 1;
    }
    if (exactFiveForBlack ? len === 5 : len >= 5) return true;
  }
  return false;
};
var forbiddenMessage = (kind) => kind === "overline" ? "\u9ED1\u65B9\u4E0D\u80FD\u5F62\u6210\u957F\u8FDE\uFF08\u516D\u8FDE\u4EE5\u4E0A\uFF09" : kind === "double-four" ? "\u9ED1\u65B9\u4E0D\u80FD\u5F62\u6210\u56DB\u56DB" : "\u9ED1\u65B9\u4E0D\u80FD\u5F62\u6210\u4E09\u4E09";
function classifyAttack(board, row, col, attacker) {
  if (attacker === "black") {
    const ev = evaluateRenjuMove(toCellGrid(board), { row, col });
    if (ev.forbidden) return { ok: false, outcome: "continue", message: forbiddenMessage(ev.forbidden) };
  }
  const player = codeOf(attacker);
  const next = board.slice();
  next[vidx(row, col)] = player;
  if (isFiveAt(next, row, col, player, attacker === "black")) {
    return { ok: true, outcome: "win", message: "\u4E94\u8FDE\uFF01\u6311\u6218\u6210\u529F" };
  }
  const defender = attacker === "black" ? "white" : "black";
  if (vcfFivePoints(next, codeOf(defender), "renju").length > 0) {
    return { ok: false, outcome: "continue", message: "\u5B88\u65B9\u6709\u53CD\u56DB\u2014\u2014\u8FD9\u4E00\u624B\u5FC5\u987B\u5E26\u56DB\u5E76\u6321\u4F4F\u5B83" };
  }
  const winPoints = vcfFivePoints(next, player, "renju");
  if (winPoints.length === 0) {
    return { ok: false, outcome: "continue", message: "\u8BF7\u5F62\u6210\u56DB" };
  }
  if (winPoints.length >= 2) {
    return { ok: true, outcome: "win", message: "\u6D3B\u56DB/\u53CC\u56DB\uFF0C\u5B88\u65B9\u65E0\u89E3\uFF0C\u6311\u6218\u6210\u529F" };
  }
  const block = winPoints[0];
  if (defender === "black") {
    const ev = evaluateRenjuMove(toCellGrid(next), { row: Math.floor(block / VCF_SIZE), col: block % VCF_SIZE });
    if (ev.forbidden) return { ok: true, outcome: "win", message: "\u65E0\u6CD5\u9632\u5B88\u7684\u51B2\u56DB\uFF0C\u6311\u6218\u6210\u529F" };
  }
  return { ok: true, outcome: "continue", block, message: "\u51B2\u56DB" };
}

// src/features/vcf-challenge/solution-line.ts
var buildSolutionLine = (black, white, attacker, coords) => {
  if (!coords.length) return null;
  const attackerNum = attacker === "black" ? 1 : 2;
  const defender = attacker === "black" ? "white" : "black";
  const board = new Int8Array(VCF_SIZE * VCF_SIZE);
  for (const s of black) board[vidx(s.row, s.col)] = 1;
  for (const s of white) board[vidx(s.row, s.col)] = 2;
  const line = [];
  let ending = null;
  let cursor = 0;
  for (let guard = 0; guard < 80 && cursor < coords.length; guard += 1) {
    const atk = coords[cursor];
    if (board[vidx(atk.row, atk.col)] !== 0) return null;
    const verdict = classifyAttack(board, atk.row, atk.col, attacker);
    if (!verdict.ok) return null;
    board[vidx(atk.row, atk.col)] = attackerNum;
    line.push({ row: atk.row, col: atk.col, player: attacker });
    cursor += 1;
    if (verdict.outcome === "win") {
      ending = verdict.message.includes("\u7981\u624B") ? "forbidden" : verdict.message.includes("\u6D3B\u56DB") ? "openFour" : "five";
      break;
    }
    const block = verdict.block;
    if (block === void 0) return null;
    const blockRow = Math.floor(block / VCF_SIZE), blockCol = block % VCF_SIZE;
    const listed = coords[cursor];
    if (listed && listed.row === blockRow && listed.col === blockCol) cursor += 1;
    board[block] = defender === "black" ? 1 : 2;
    line.push({ row: blockRow, col: blockCol, player: defender });
  }
  if (!line.length || !ending) return null;
  return { line, depth: line.filter((m) => m.player === attacker).length, ending };
};
var solveAppLine = (black, white, attacker, maxDepth, perLevelMs = 800) => {
  const start = new Int8Array(VCF_SIZE * VCF_SIZE);
  for (const s of black) start[vidx(s.row, s.col)] = 1;
  for (const s of white) start[vidx(s.row, s.col)] = 2;
  const attackerNum = attacker === "black" ? 1 : 2;
  const defenderNum = attacker === "black" ? 2 : 1;
  const board = start.slice();
  const wins = [];
  for (let remaining = maxDepth; remaining >= 1 && wins.length < maxDepth; remaining -= 1) {
    const sol = solveVcf(board, { attacker: attackerNum, rules: "renju", maxDepth: remaining, timeBudget: perLevelMs });
    if (!sol.win) return null;
    const mv = sol.line.find((m) => m.player === attackerNum);
    if (!mv) return null;
    const verdict = classifyAttack(board, mv.row, mv.col, attacker);
    if (!verdict.ok) return null;
    wins.push({ row: mv.row, col: mv.col });
    board[vidx(mv.row, mv.col)] = attackerNum;
    if (verdict.outcome === "win") return buildSolutionLine(black, white, attacker, wins);
    const block = verdict.block;
    if (block === void 0) return null;
    board[block] = defenderNum;
  }
  return null;
};

// qa/scnet-vcf-verify-entry.ts
var parseCoord = (t) => {
  const m = t.trim().match(/^([A-Oa-o])(\d{1,2})$/);
  if (!m) return null;
  const row = 15 - Number(m[2]), col = m[1].toUpperCase().charCodeAt(0) - 65;
  return row >= 0 && row < 15 && col >= 0 && col < 15 ? { row, col } : null;
};
var parseRun = (s) => (s.match(/[A-Oa-o]\d{1,2}/g) ?? []).map(parseCoord).filter((p) => p !== null);
function loadProblems(files) {
  var _a;
  const out = [];
  for (const f of files) {
    const data = JSON.parse(readFileSync(f, "utf8"));
    if (Array.isArray(data.items)) {
      const offset = String(f).includes("material-12") ? 2e6 : String(f).includes("material-3") ? 1e6 : 0;
      for (const it of data.items) {
        const attacker = it.a === "white" ? "white" : "black";
        const depth = typeof it.d === "number" && it.d > 0 ? it.d : it.l.length;
        if (depth < 1 || depth > 40 || !it.l.length) continue;
        out.push({ id: `m-${it.i + offset}`, attacker, depth, black: it.b.map(([r, c]) => ({ row: r, col: c })), white: it.w.map(([r, c]) => ({ row: r, col: c })), coords: it.l.map(([r, c]) => ({ row: r, col: c })) });
      }
      continue;
    }
    const puzzles = data.puzzles ?? [];
    const fileNum = Number(((_a = String(f).match(/batch-(\d+)/)) == null ? void 0 : _a[1]) ?? 0);
    const fi = fileNum === 1001 ? 0 : fileNum === 2002 ? 1 : fileNum === 3003 ? 2 : 0;
    puzzles.forEach((p, ei) => {
      var _a2, _b;
      const cm = (_a2 = p.comment) == null ? void 0 : _a2.match(/正解：(.+)$/m);
      if (!cm) return;
      const coords = cm[1].split("\u2192").map(parseCoord);
      if (!coords.length || coords.some((x) => x === null)) return;
      const black = parseRun(p.blackStones ?? ""), white = parseRun(p.whiteStones ?? "");
      if (!black.length) return;
      const attacker = p.side === "white" ? "white" : "black";
      const depth = Number(((_b = (p.prompt ?? "").match(/(\d+)\s*手/)) == null ? void 0 : _b[1]) ?? coords.length);
      if (depth < 1 || depth > 40) return;
      out.push({ id: `b-${fi}-${ei}`, attacker, depth, black, white, coords });
    });
  }
  return out;
}
var startBoard = (p) => {
  const b = new Int8Array(VCF_SIZE * VCF_SIZE);
  for (const s of p.black) b[vidx(s.row, s.col)] = 1;
  for (const s of p.white) b[vidx(s.row, s.col)] = 2;
  return b;
};
function dfsSolve(p, maxDepth, budgetMs) {
  const t0 = Date.now();
  const board = startBoard(p);
  const attackerNum = p.attacker === "black" ? 1 : 2;
  const defender = p.attacker === "black" ? "white" : "black";
  const defenderNum = p.attacker === "black" ? 2 : 1;
  const path = [];
  let nodes = 0;
  let timedOut = false;
  const nearStone = (r, c) => {
    for (let dr = -4; dr <= 4; dr += 1) for (let dc = -4; dc <= 4; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < VCF_SIZE && cc >= 0 && cc < VCF_SIZE && board[vidx(rr, cc)] !== 0) return true;
    }
    return false;
  };
  const dfs = (depth) => {
    if (depth <= 0) return false;
    for (let r = 0; r < VCF_SIZE; r += 1) for (let c = 0; c < VCF_SIZE; c += 1) {
      if (Date.now() - t0 > budgetMs) {
        timedOut = true;
        return false;
      }
      if (board[vidx(r, c)] !== 0 || !nearStone(r, c)) continue;
      nodes += 1;
      const verdict = classifyAttack(board, r, c, p.attacker);
      if (!verdict.ok) continue;
      board[vidx(r, c)] = attackerNum;
      path.push({ row: r, col: c, player: p.attacker });
      if (verdict.outcome === "win") return true;
      const block = verdict.block;
      if (block === void 0) {
        path.pop();
        board[vidx(r, c)] = 0;
        continue;
      }
      const br = Math.floor(block / VCF_SIZE), bc = block % VCF_SIZE;
      board[block] = defenderNum;
      path.push({ row: br, col: bc, player: defender });
      if (dfs(depth - 1)) return true;
      path.pop();
      board[block] = 0;
      path.pop();
      board[vidx(r, c)] = 0;
    }
    return false;
  };
  const win = dfs(maxDepth);
  const ms = Date.now() - t0;
  if (win) return { verdict: "fixed", line: path.slice(), nodes, ms };
  return { verdict: timedOut ? "unknown" : "unsolvable", nodes, ms };
}
var main = () => {
  const [mode, inPath, outPath, shardArg, shardsArg, budgetArg] = process.argv.slice(2);
  const shard = Number(shardArg ?? 0), shards = Number(shardsArg ?? 1);
  const budgetMs = Number(budgetArg ?? 2e4);
  if (!mode || !inPath || !outPath) {
    console.error("usage: node vcf-verify.mjs walk|dfs <in> <out> <shard> <shards> [budget]");
    process.exit(2);
  }
  const done = /* @__PURE__ */ new Set();
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, "utf8").split("\n")) {
      const m = line.match(/"id"\s*:\s*"([^"]+)"/);
      if (m) done.add(m[1]);
    }
  }
  const log = (obj) => appendFileSync(outPath, JSON.stringify(obj) + "\n", "utf8");
  if (mode === "walk") {
    const files = inPath.split(",");
    const problems = loadProblems(files);
    let n = 0, ok = 0, fixed = 0, bad = 0;
    for (let i = 0; i < problems.length; i += 1) {
      if (i % shards !== shard) continue;
      const p = problems[i];
      if (done.has(p.id)) continue;
      n += 1;
      const t0 = Date.now();
      const built = buildSolutionLine(p.black, p.white, p.attacker, p.coords);
      if (built) {
        ok += 1;
        log({ id: p.id, verdict: "ok", d: built.depth, e: built.ending });
        continue;
      }
      const repaired = solveAppLine(p.black, p.white, p.attacker, Math.min(p.depth, 13), budgetMs);
      if (repaired) {
        fixed += 1;
        log({ id: p.id, verdict: "fixed", d: repaired.depth, e: repaired.ending, line: repaired.line.map((m) => [m.row, m.col, m.player]), ms: Date.now() - t0 });
      } else {
        bad += 1;
        log({ id: p.id, verdict: "bad", src: p, ms: Date.now() - t0 });
      }
      if (n % 25 === 0) console.log(`shard ${shard}: ${n} \u9053\u5904\u7406\u5B8C\uFF08ok=${ok} fixed=${fixed} bad=${bad}\uFF09`);
    }
    console.log(`shard ${shard} \u5B8C\u6210\uFF1A\u5904\u7406 ${n}\uFF0Cok=${ok} fixed=${fixed} bad=${bad}`);
    return;
  }
  if (mode === "dfs") {
    const lines = readFileSync(inPath, "utf8").split("\n").filter(Boolean);
    const bads = [];
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.verdict === "bad" && rec.src) bads.push(rec.src);
      } catch {
      }
    }
    let n = 0, fixed = 0, unsolvable = 0, unknown = 0;
    for (let i = 0; i < bads.length; i += 1) {
      if (i % shards !== shard) continue;
      const p = bads[i];
      if (done.has(p.id)) continue;
      n += 1;
      const r = dfsSolve(p, Math.min(p.depth, 13), budgetMs);
      if (r.verdict === "fixed") fixed += 1;
      else if (r.verdict === "unsolvable") unsolvable += 1;
      else unknown += 1;
      log({ id: p.id, verdict: r.verdict, d: r.line ? r.line.filter((m) => m.player === p.attacker).length : void 0, line: r.line, nodes: r.nodes, ms: r.ms });
      if (n % 5 === 0) console.log(`shard ${shard}: ${n} \u9053\uFF08fixed=${fixed} unsolvable=${unsolvable} unknown=${unknown}\uFF09`);
    }
    console.log(`shard ${shard} \u5B8C\u6210\uFF1A\u5904\u7406 ${n}\uFF0Cfixed=${fixed} unsolvable=${unsolvable} unknown=${unknown}`);
    return;
  }
  console.error(`\u672A\u77E5\u6A21\u5F0F ${mode}`);
  process.exit(2);
};
main();
