/**
 * 让标注能跟着 LIB 走到别的打谱软件。
 *
 * **这个生态里的「图形标注」就是盘面文字里的字形**（实测，不是推断）：
 *   · 小工具画一个标记走的是 `point.printLb()`（`CheckerBoard.js:376`），实现就是
 *     `this.d.innerHTML = 文字` + 设字号与颜色——**标记本身就是一个字符**；
 *   · 它读棋谱时也是把 `boardText` 当标记画到棋盘上（`renju_control.js:2047`
 *     `cBoard.wLb(idx, pInfo.boardText, pInfo.color); // 添加标记`）。
 * 所以 LIB 里的「图形标注」与「盘面文字」本就是同一件事，写 boardText 不是降级。
 *
 * **为什么不能把标注做成树枝**：LIB 没有「主线」字段，而读取器读到同级节点后会按坐标
 * 重排（官方核心 `RenLibDoc.addMove`）。实测在已有后续着法的节点上挂一个坐标更小的
 * 标注点，读回来是 `;B[hh]LB[gg:○](;W[gg])(;W[ih])`——标注点排到了真实着法**前面**，
 * 靠「第一个分支＝主线」的读取器（含我们的 `children[0]` 兜底）主线就走偏。
 * 顺序无法控制（writer 换顺序写，读取器照样重排），所以这条路会损伤原谱。
 *
 * **一个节点只能带一个盘面文字**（官方核心 `readBoardText` 硬上限 4 个 GBK 字节，一格
 * 也只能显示一个标签），所以落在同一个节点上的多个标注只有第一个能上棋盘，其余退到
 * 注释清单——这是格式的容量限制，不是取舍。
 */
import type { BoardMark, BoardMarkStyle, GameDocument, RecordNode } from "./types";
import { markKindForStyle, styleForMark } from "./annotation-presets";
import { encodeGbkStringWithReport } from "./gbk-encoding";
import { coordinateName, parseCoordinate } from "./game";

/** 形状 → 字形。都实测在 GBK 里可编码（各 2 字节），别的软件渲染出来就是那个形状。
 *
 *  **这就是这个生态里「图形标注」的真身**：小工具的标记渲染 `point.printLb()`
 *  （`CheckerBoard.js:376`）做的就是 `this.d.innerHTML = 文字` + 设字号/颜色；它读棋谱时
 *  也是把 `boardText` 当标记画上去的（`renju_control.js:2047`
 *  `cBoard.wLb(idx, pInfo.boardText, pInfo.color); // 添加标记`）。所以「图形标注」与
 *  「盘面文字里的字形」在这里是同一件事，不存在降级。 */
export const LIB_MARK_GLYPH: Readonly<Record<BoardMarkStyle, string>> = {
  text: "",
  circle: "○",
  "circle-solid": "●",
  triangle: "△",
  "triangle-solid": "▲",
  "square-solid": "■",
  diamond: "◆",
  cross: "×",
  check: "√",
  star: "☆",
  sun: "◎",
  // GBK 里没有月牙字形（☽/◐ 会被编成 "?"），用「月」这个汉字最清楚。
  moon: "月",
};

/** 字形 → 形状（导入时还原）。同一字形只对应一个画法。 */
const GLYPH_STYLE: ReadonlyMap<string, BoardMarkStyle> = new Map(
  (Object.entries(LIB_MARK_GLYPH) as Array<[BoardMarkStyle, string]>)
    .filter(([, glyph]) => glyph)
    .map(([style, glyph]) => [glyph, style]),
);

/** 注释里的标注清单一行的前缀。带中文方括号，几乎不可能与用户的注释撞车。 */
export const LIB_MARKS_COMMENT_PREFIX = "【标注】";
/** 盘面文字上限：官方核心的 readBoardText 只取 4 个 GBK 字节。 */
const LIB_BOARD_TEXT_MAX_BYTES = 4;

/** 按整字截断到 n 个 GBK 字节（不能截半个字，否则读回是乱码）。 */
const truncateGbk = (text: string, maxBytes: number): string => {
  let kept = "";
  let used = 0;
  for (const character of text) {
    const size = encodeGbkStringWithReport(character).bytes.length;
    if (used + size > maxBytes) break;
    kept += character;
    used += size;
  }
  return kept;
};

/**
 * 一个标注能带出去的文字：形状字形 + 用户写的文字，按整字截到 4 字节。
 * 例如「实心圆 + 胜」→ `●胜`（4 字节）；「三角 + ABC」→ `△AB`（4 字节）。
 *
 * **只用于「盘面文字」那一格**——4 字节是官方核心 `readBoardText` 的硬上限。
 * 注释清单通道不要用它，见 `libMarkTextFull`。
 */
export const libMarkText = (mark: BoardMark): string => {
  const glyph = LIB_MARK_GLYPH[styleForMark(mark)] || "";
  const label = Array.from((mark.label || "").trim()).slice(0, 4).join("");
  if (!glyph && !label) return "";
  return truncateGbk(glyph + label, LIB_BOARD_TEXT_MAX_BYTES);
};

/**
 * 注释清单用的文字：字形 + **完整**文字，不按字节截断。
 *
 * 修的是一个真丢字 bug：4 字节上限只属于「盘面文字」那一格，而注释是长度自由的 GBK 文本，
 * 以前注释清单也走 `libMarkText`，于是**用户写满 4 个字的标注被砍成 1–2 个字**——
 * 实测「要点提示」→「要」、「长文字测试」→「长文」、「ABCDEFGH」→「AB」。
 * 而 `applyMarksToLibDocument` 的契约本来就写着「无论如何注释清单都写，导回我们这里
 * 形状与文字一个不少」，截断是直接违背它的。
 */
export const libMarkTextFull = (mark: BoardMark): string => {
  const glyph = LIB_MARK_GLYPH[styleForMark(mark)] || "";
  const label = Array.from((mark.label || "").trim()).join("");
  return glyph || label ? glyph + label : "";
};

const samePosition = (node: RecordNode | undefined, point: { row: number; col: number }): boolean => {
  const at = node?.move ?? node?.anchor;
  return Boolean(at && at.row === point.row && at.col === point.col);
};

/** 一个节点当前的盘面文字对应的字形（用来判断「这条盘面文字是不是我们自己写的标注」）。 */
const libMarkTextOf = (node: RecordNode): string => {
  const text = node.boardText || "";
  for (const glyph of Object.values(LIB_MARK_GLYPH)) {
    if (glyph && text.startsWith(glyph)) return text;
  }
  return "";
};

/** 把标注写成一行人类可读、且能原样解析回来的文字。**不截断**——见 `libMarkTextFull`。 */
export const encodeMarksComment = (marks: readonly BoardMark[], boardSize: number): string => {
  const entries = marks
    .map((mark) => {
      const text = libMarkTextFull(mark);
      return text ? `${coordinateName(mark, boardSize)} ${text}` : "";
    })
    .filter(Boolean);
  return entries.length ? `${LIB_MARKS_COMMENT_PREFIX}${entries.join(" · ")}` : "";
};

export interface DecodedMarksComment {
  /** 去掉标注行之后剩下的注释。 */
  comment: string;
  /** 从标注行还原出来的标注（形状/文字都在，颜色取默认——LIB 存不下颜色）。 */
  marks: BoardMark[];
}

/**
 * 从注释里把标注行解析回来。认不出的内容原样留在注释里，不吞用户文字。
 * 颜色无法保留（LIB/注释都没有颜色字段），还原时给默认墨色。
 */
export const decodeMarksComment = (comment: string, boardSize: number): DecodedMarksComment => {
  if (!comment || !comment.includes(LIB_MARKS_COMMENT_PREFIX)) return { comment, marks: [] };
  const lines = comment.split("\n");
  const kept: string[] = [];
  const marks: BoardMark[] = [];
  for (const line of lines) {
    const at = line.indexOf(LIB_MARKS_COMMENT_PREFIX);
    if (at < 0) { kept.push(line); continue; }
    const before = line.slice(0, at);
    const payload = line.slice(at + LIB_MARKS_COMMENT_PREFIX.length);
    let restored = true;
    for (const entry of payload.split("·")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const space = trimmed.indexOf(" ");
      const coordinate = space < 0 ? trimmed : trimmed.slice(0, space);
      const content = space < 0 ? "" : trimmed.slice(space + 1).trim();
      const point = parseCoordinate(coordinate, boardSize);
      if (!point) { restored = false; break; }
      const [first] = Array.from(content);
      const style = first ? GLYPH_STYLE.get(first) : undefined;
      if (style) {
        const label = content.slice(first!.length).trim();
        marks.push({ ...point, kind: markKindForStyle(style), style, label, renLibNativeLabel: false });
      } else if (content) {
        marks.push({ ...point, kind: "label", style: "text", label: content });
      } else {
        restored = false;
        break;
      }
    }
    if (!restored) { kept.push(line); marks.length = 0; break; }
    if (before.trim()) kept.push(before);
  }
  return { comment: kept.join("\n").trim(), marks };
};

export interface LibMarkApplyResult {
  document: GameDocument;
  /** 处理过的标注节点数。 */
  annotated: number;
  /** 真正落到盘面文字上（对方棋盘上看得见）的标注数。 */
  labelledChildren: number;
  /** 因为该点已有**原作者**的盘面文字而主动让位、改走注释清单的标注数。 */
  overwrittenBoardText: number;
  /** 为**真空点**上的标注新建的「非着法节点」数（对局软件里画成棋盘标记，不是一颗子）。 */
  annotationNodes: number;
}

/**
 * 导出 LIB 前调用：把标注落到**这个生态真正认的地方**——盘面文字（boardText）。
 *
 * 依据（实测，不是推断）：小工具的标记渲染就是 `innerHTML = 文字`
 * （`CheckerBoard.js:376 point.printLb`），它读棋谱时把 `boardText` 当标记画到棋盘上
 * （`renju_control.js:2047 cBoard.wLb(idx, pInfo.boardText, pInfo.color); // 添加标记`）。
 * 换句话说，**「图形标注」在 LIB 里就是盘面文字里的字形**，和我们的标注是同一件事。
 *
 * 落点优先级（都不新增节点、不动 children 顺序、不动 preferredChildId）：
 *   ① 标注点正好是**本手位置** → 写本节点的 boardText；对方棋盘上该点直接显示字形。
 *   ② 标注点在本线更深处是某一手 → 写那一手的 boardText（最自然的"这里该走这手"）。
 *   ③ 标注点在**本线更早**（已经走过）或**别的分支**里是某一手 → 写那个节点的 boardText。
 *      （09-17 之前这里只找子树，于是这两种最常见的用法全掉进了注释清单。）
 *   ④ 以上都不是（**真正的空点**）→ 给这个点**造一个非着法节点**（NO_MOVE + 盘面文字），
 *      对局软件在棋盘上画出字形、且不当成一手棋（不消耗轮次、不打乱黑白）。这是生态里唯一
 *      的写法：官方文档层只有按节点挂标记的接口 `RenLibDoc.addBoardText(pMove, text)`。
 *      只有"该格已被原作者写了字"（一格一个标签，物理限制）与放不下的超长文字才退回
 *      **注释清单**（`【标注】E15 ▲ · F15 √`）。
 *
 * **原库已有的盘面文字优先**：盘面文字一格只能放一个标签，而它可能是原作者的标注
 * （实测九天指南的变化点上就写着「九天」）。抢掉读者原有信息去腾地方给我们的标注，
 * 比让我们的标注退回注释糟糕得多，所以**有原文字时我们的标注让位走注释清单**；
 * 只有我们自己上一次导出写进去的字形才会被直接改写（保证反复导出幂等）。
 * 无论如何注释清单都写，导回我们这里形状与文字一个不少。
 */
export const applyMarksToLibDocument = (document: GameDocument): LibMarkApplyResult => {
  const boardSize = document.metadata.boardSize || 15;
  const nodes = { ...document.nodes };
  let annotated = 0;
  let annotationNodes = 0;
  let labelled = 0;
  let yieldedToExistingText = 0;
  const at = (id: string): RecordNode | undefined => nodes[id] ?? document.nodes[id];

  /** 在场面上找「正好落在这个坐标」的节点。
   *  只找直接子节点是不够的：标注挂在某一手上，而它标的点常常是**更深**的后续着法
   *  （实测 `hh → ih → ig` 时，标在 ig 的标注因为不是 hh 的直接子节点而被漏掉、
   *  白白退进了注释）。所以在子树里按坐标找，优先取最近的。 */
  const findNodeAt = (rootId: string, point: { row: number; col: number }): string | undefined => {
    const queue = [...(document.nodes[rootId]?.children || [])];
    let guard = 0;
    while (queue.length && guard < 100000) {
      const id = queue.shift() as string;
      guard += 1;
      if (samePosition(at(id), point)) return id;
      const node = at(id);
      if (node) queue.push(...node.children);
    }
    return undefined;
  };

  /** 往上找：这个坐标是不是**本节点之前已经走过**的一手。
   *  「标在已经落过的点上」是最常见的用法之一（复盘时说"这手是关键"），
   *  以前只在子树里找 → 找不到 → 掉进注释清单，对局软件里就只看到注释、棋盘上没有标记（用户 09-17 反馈）。 */
  const findAncestorAt = (fromId: string, point: { row: number; col: number }): string | undefined => {
    let cursor = document.nodes[fromId]?.parentId ?? null;
    let guard = 0;
    while (cursor && guard < 100000) {
      guard += 1;
      if (samePosition(at(cursor), point)) return cursor;
      cursor = document.nodes[cursor]?.parentId ?? null;
    }
    return undefined;
  };

  /** 全谱兜底：这个坐标在**别的分支**里是某一手。全谱都没有，才是真正的空点。 */
  const findAnywhereAt = (point: { row: number; col: number }): string | undefined => {
    for (const id of Object.keys(document.nodes)) if (samePosition(at(id), point)) return id;
    return undefined;
  };

  for (const node of Object.values(document.nodes)) {
    // 从文件里读来的原生标签不再回写，否则越导越多。
    // **必须取累计值而不是 document.nodes 里的原始节点**：别的节点的标注可能已经往
    // 这个节点写过盘面文字，而这里后面会用 next 整体写回。用原始节点当底会把那次写入
    // 覆盖掉——实测「A 标在 B 上、B 又标在 C 上」时，B 的文字会被自己这轮抹掉，
    // 三个字形只剩最后一个能存活。
    const current = at(node.id) ?? node;
    const marks = (current.marks || []).filter((mark) => !mark.renLibNativeLabel);
    if (!marks.length) continue;
    // 先去掉上一次导出留下的标注行，避免反复导出越写越长。
    const decoded = decodeMarksComment(current.comment || "", boardSize);
    let next: RecordNode = { ...current, comment: decoded.comment };
    const unplaced: string[] = [];

    for (const mark of marks) {
      // 盘面文字那一格受官方核心 4 字节上限约束；注释清单是自由文本，必须写全，否则丢字。
      const boardText = libMarkText(mark);
      const full = libMarkTextFull(mark);
      if (!full) continue;
      const entry = `${coordinateName(mark, boardSize)} ${full}`;
      // ①② 标注落在某个**节点**上 → 写它的盘面文字。查找范围要够宽，否则「标在已落过的点」
      // 与「标在别的分支的点」都会掉进注释清单（用户 09-17 报的「我的标注变成注释了」）。
      // 顺序：本手位置 → 当前这条线更深处 → 当前这条线更早的（祖先）→ 全谱任意位置。
      const targetId = (samePosition(next, mark) ? node.id : undefined)
        ?? findNodeAt(node.id, mark)
        ?? findAncestorAt(node.id, mark)
        ?? findAnywhereAt(mark);
      const target = targetId ? at(targetId) : undefined;
      // ③ **真正的空点**（全谱里没有这个坐标的节点）→ 按生态写法**给它造一个非着法节点**
      //    （带 NO_MOVE 位 + 盘面文字）。依据：官方文档层只有按节点挂标记的接口
      //    `RenLibDoc.addBoardText(pMove, text)`，工具自己的编辑器在空点放标记也必然落成一个节点；
      //    而带 NO_MOVE 的节点在官方读取器里**不算一手棋**（装载时 `if (pcMove.isMove()) nNewMoves++`），
      //    所以它不消耗轮次、不打乱黑白交替，对局软件会把它画成棋盘上的标记而不是一颗子。
      //    以前这里退到注释清单 → 对局软件里就只是一条注释（用户 09-17 明确不接受）。
      if (!targetId || !target) {
        if (!boardText) { unplaced.push(entry); continue; }
        // 确定性 id：反复导出同一个标注不会增殖（幂等）。
        const id = `${node.id}-mark-${mark.row}-${mark.col}`;
        const created = nodes[id];
        if (created) {
          // 已经存在：可能是上一次导出留下的，也可能同一格有第二个标注（一格一个标签）。
          if (created.boardText !== boardText) unplaced.push(entry);
          continue;
        }
        nodes[id] = {
          id, parentId: node.id, children: [], move: null, anchor: { row: mark.row, col: mark.col },
          // 盘面文字那一格只能放 4 个 GBK 字节（官方核心 readBoardText 的上限）；装不下的部分
          // 落在**这个节点自己的注释**里，保证文件里不丢字（对方软件里那格显示得下多少算多少）。
          comment: full !== boardText ? full : "",
          marks: [], boardText, renLibNativeLabel: false,
        };
        // 挂到所属节点下；**不动 preferredChildId**（主线偏好不能被标注改动）。
        next = { ...next, children: [...next.children, id] };
        annotationNodes += 1;
        continue;
      }
      // 载不进盘面文字（该格已原作者占用 / 4 字节里放不下）→ 注释清单，信息不丢
      if (!boardText) { unplaced.push(entry); continue; }
      const existing = target.boardText || "";
      if (existing && existing !== boardText) {
        // 不是我们自己写的字形 → 原作者的标注，我们让位（信息进注释清单，不丢）。
        yieldedToExistingText += 1;
        unplaced.push(entry);
        continue;
      }
      if (existing === boardText) continue;                  // 已经是它，幂等
      nodes[targetId] = { ...target, boardText };
      // 标注落在本节点自己身上时，next 也要跟着更新，否则后面的注释行会把 boardText 覆盖回去。
      if (targetId === node.id) next = nodes[targetId];
      labelled += 1;
    }

    // ③ 落不到盘面文字上的（空点、或该点已有原作者文字）→ 注释清单，保证信息不丢
    if (unplaced.length) {
      const extra = `${LIB_MARKS_COMMENT_PREFIX}${unplaced.join(" · ")}`;
      next = { ...next, comment: next.comment ? `${next.comment}\n${extra}` : extra };
    }
    nodes[node.id] = next;
    annotated += 1;
  }
  return { document: { ...document, nodes }, annotated, labelledChildren: labelled, overwrittenBoardText: yieldedToExistingText, annotationNodes };
};

/**
 * 导入 LIB 后调用：把注释里的标注行还原成真正的标注，并把那行从注释里摘掉。
 * 同一个点上已经有标注就跳过（否则「导出→导入→再导出」会把标注越还原越多）。
 */
export const restoreMarksFromComments = (document: GameDocument): GameDocument => {
  const boardSize = document.metadata.boardSize || 15;
  const key = (point: { row: number; col: number }) => `${point.row},${point.col}`;
  let changed = false;
  const nodes: Record<string, RecordNode> = { ...document.nodes };
  for (const node of Object.values(document.nodes)) {
    if (!node.comment || !node.comment.includes(LIB_MARKS_COMMENT_PREFIX)) continue;
    const decoded = decodeMarksComment(node.comment, boardSize);
    if (!decoded.marks.length && decoded.comment === node.comment) continue;
    const present = new Set((node.marks || []).map(key));
    const added = decoded.marks.filter((mark) => !present.has(key(mark)));
    nodes[node.id] = { ...node, comment: decoded.comment, marks: [...(node.marks || []), ...added] };
    changed = true;
  }
  return changed ? { ...document, nodes } : document;
};

/**
 * 官方核心的 `lib2sgf` 会把「非着法节点」（空点标注：`move=null` + `anchor` + NO_MOVE 位）
 * **写成一手棋**——实测：我们导出的 `;…LB[dd:○]` 空点标注，经核心转 SGF 变成
 * `;B[hh]LB[dd:○];W[dd]`，凭空多一颗子。核心自己的读取器认 NO_MOVE（`isMove()=!NO_MOVE`），
 * 所以**文件本身是对的**，错的只是 `lib2sgf` 这条转换路径；而我们的「完整 LIB 转 SGF」
 * 与「编辑后另存 LIB」都用它当底板，必须按 NO_MOVE 语义把这些幻影着法剔掉。
 *
 * 键的约定与 `renlib-web-view-session` 的 `scanNonMoveNodes` 完全一致：
 * `父路径的着法坐标序列|本节点坐标`（序列只并真着法、用 `-` 连接）。用坐标序列而不是
 * 兄弟下标，是因为核心读回时会按坐标重排兄弟，下标对不上、序列对得上。
 */
export const nonMoveKeysFromLibDocument = (document: GameDocument): Set<string> => {
  const keys = new Set<string>();
  const walk = (id: string, parentPath: string) => {
    const node = document.nodes[id];
    if (!node) return;
    if (!node.move && node.anchor) keys.add(`${parentPath}|${node.anchor.row},${node.anchor.col}`);
    const nextPath = node.move
      ? (parentPath ? `${parentPath}-${node.move.row},${node.move.col}` : `${node.move.row},${node.move.col}`)
      : parentPath;
    for (const child of node.children) walk(child, nextPath);
  };
  walk(document.rootId, "");
  return keys;
};

/**
 * 从 lib2sgf 转出来的文档里剔除幻影着法节点（见 `nonMoveKeysFromLibDocument`）。
 * 只删**叶子**节点：真着法节点即使坐标命中（那种情况本来就少见）也不会被误删——
 * 我们的非着法标注节点一律无子节点。标注本身不丢：核心已把它写成父节点上的
 * `LB[坐标:字形]`，我们的 SGF 导入会还原成父节点上的文字标注。
 */
export const stripLibPhantomNodes = (document: GameDocument, nonMoveKeys: ReadonlySet<string>): { document: GameDocument; removed: number } => {
  if (!nonMoveKeys.size) return { document, removed: 0 };
  const nodes: Record<string, RecordNode> = { ...document.nodes };
  let removed = 0;
  const walk = (id: string, parentPath: string) => {
    const node = nodes[id];
    if (!node) return;
    const nextPath = node.move
      ? (parentPath ? `${parentPath}-${node.move.row},${node.move.col}` : `${node.move.row},${node.move.col}`)
      : parentPath;
    const kept: string[] = [];
    for (const childId of node.children) {
      const child = nodes[childId];
      if (child?.move && !child.children.length && nonMoveKeys.has(`${nextPath}|${child.move.row},${child.move.col}`)) {
        delete nodes[childId];
        removed += 1;
        continue;
      }
      kept.push(childId);
      walk(childId, nextPath);
    }
    if (kept.length !== node.children.length) {
      nodes[id] = {
        ...node,
        children: kept,
        preferredChildId: node.preferredChildId && kept.includes(node.preferredChildId) ? node.preferredChildId : kept[0],
      };
    }
  };
  walk(document.rootId, "");
  return removed ? { document: { ...document, nodes }, removed } : { document, removed: 0 };
};
