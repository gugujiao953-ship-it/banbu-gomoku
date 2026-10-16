// 长按环形菜单（用户 09-17 第二批①）：长按已有棋子/右键呼出，围绕按下点摆一圈动作。
// 纯逻辑放这里（圆环摆位、命中判定、菜单项过滤、局面文本），DOM 在 BoardRadialMenu 里。

import type { GameDocument, NodeEvaluation, RecordNode } from "../../types";
import { coordinateName } from "../../game";

/** 外环半径（px）。用户 10-01 要加内环切页后从 78 放大到 96：78 时外环按钮占掉
 * 46–110 这条带，中心只剩 46px 可放内环，四格扇区只有 30px 厚——低于本项目按 44px
 * 算的最小可点尺寸。96 时内环可用带 14–58（44px 厚、每格弧宽 56px），外环六槽相邻
 * 中心距 96px（按钮 64px 仍不重叠），菜单最外沿 128px，在门禁统一的 392px 宽视口里
 * 左右各余 68px。 */
export const RADIAL_MENU_RADIUS = 96;
/** 按钮中心到指针的命中半径。 */
export const RADIAL_MENU_HIT_RADIUS = 46;
/** 外环固定六槽。各页项数不同，但同一槽位永远是同一类动作（「取消」永远第五槽），
 * 否则切页时同一个动作会在屏幕上跳位置，肌肉记忆白练。 */
export const RADIAL_MENU_SLOTS = 6;
/** 内环（切页扇区）的半径带。外沿 58 与外环按钮内沿 64 之间留 6px 间隙。 */
export const RADIAL_PAGE_INNER_RADIUS = 14;
export const RADIAL_PAGE_OUTER_RADIUS = 58;

export type RadialMenuActionId =
  | "erase" | "bookmark" | "copyPosition" | "jump" | "evaluate" | "cancel"
  | "setMain" | "copyBranch" | "pasteBranch" | "deleteAfter"
  | "shift" | "rotate" | "mirror" | "undo" | "redo";

/** 内环的三页（用户 10-01 第二轮重排定稿：标注页删掉）。
 * 顺序＝顺时针，第一格在正上方，沿环往右划就是下一页。三页时每格 120°、
 * 中弧宽 75px（四页时是 90°/56px），切页更不容易点错。
 * 为什么不留标注页：底部标注栏的可选面是 6 个文字组 × 12 种样式 × 12 种颜色＝30 个控件，
 * 外环只有六槽、而且槽位是 64px 圆片，镜像不过来；那四项又每一项都是别处已有的入口
 * （加标注＝空位长按/标注栏，换样式·擦标注＝标注栏，写注释＝动作条的「注释框」）。 */
export type RadialMenuPageId = "general" | "branch" | "edit";
export interface RadialMenuPage { id: RadialMenuPageId; label: string }
export const RADIAL_MENU_PAGES: RadialMenuPage[] = [
  { id: "general", label: "通用" },
  { id: "branch", label: "分支" },
  { id: "edit", label: "编辑" },
];

export interface RadialMenuItem {
  id: RadialMenuActionId;
  label: string;
  /** 外环槽位（0 = 正上方，顺时针）。不连续也允许——空槽就是不渲染。 */
  slot: number;
  /** 不可用（置灰但仍显示，让用户知道有这项、只是当前用不了）。 */
  disabled?: boolean;
}

export interface RadialMenuPoint { x: number; y: number }

/** 从正上方开始顺时针均匀摆位（旧口径，按项数均分；单测与"不分页"时仍用）。 */
export const radialItemPositions = (count: number, radius = RADIAL_MENU_RADIUS): RadialMenuPoint[] => {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
};

/** 六槽里的某一槽在哪。分页后的外环用这个，切页时动作不会跳位。 */
export const radialSlotPosition = (slot: number, radius = RADIAL_MENU_RADIUS): RadialMenuPoint => {
  const angle = -Math.PI / 2 + (slot * Math.PI * 2) / RADIAL_MENU_SLOTS;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};

/** 指针落在哪一槽（拖动选中用）。 */
export const radialSlotAt = (offset: RadialMenuPoint, radius = RADIAL_MENU_RADIUS, hitRadius = RADIAL_MENU_HIT_RADIUS): number | null => {
  let best: number | null = null;
  let bestDistance = hitRadius;
  for (let slot = 0; slot < RADIAL_MENU_SLOTS; slot += 1) {
    const position = radialSlotPosition(slot, radius);
    const distance = Math.hypot(offset.x - position.x, offset.y - position.y);
    if (distance <= bestDistance) { best = slot; bestDistance = distance; }
  }
  return best;
};

/** 指针落在内环的哪一格（切页：点击与沿环滑动都走这里）。
 * 落在中心孔（< 14）或扇区环之外（> 58）返回 null——长按呼出菜单时手指就抬起在圆心附近，
 * 那一下不能被当成切页。 */
export const radialPageAt = (offset: RadialMenuPoint,
  pageCount: number = RADIAL_MENU_PAGES.length,
  innerRadius = RADIAL_PAGE_INNER_RADIUS,
  outerRadius = RADIAL_PAGE_OUTER_RADIUS): number | null => {
  if (pageCount <= 0) return null;
  const distance = Math.hypot(offset.x, offset.y);
  if (distance < innerRadius || distance > outerRadius) return null;
  // 相对正上方顺时针计量，再把起点往后挪半格：这样第一格**以正上方为中心**跨 ±(180/页数)°，
  // 而不是从正上方开始切一刀——缝正好落在两格中间，手指压在 12 点上永远是「通用」。
  const step = (Math.PI * 2) / pageCount;
  const angle = (Math.atan2(offset.y, offset.x) + Math.PI / 2 + step / 2 + Math.PI * 2) % (Math.PI * 2);
  return Math.floor(angle / step) % pageCount;
};

/** 打标循环的三档（用户 10-01：并入这一轮，就做这三档）。
 * interesting/forced/only/study 先不进菜单——六槽是硬上限，多一档就得再开一页。 */
export const EVALUATION_CYCLE: { value: NodeEvaluation; label: string }[] = [
  { value: "good", label: "好棋" },
  { value: "bad", label: "坏棋" },
  { value: "doubtful", label: "疑问手" },
];

export const evaluationLabel = (value: NodeEvaluation | "" | undefined): string =>
  EVALUATION_CYCLE.find((item) => item.value === value)?.label || "";

/** 点一下「打标」变成哪一档：未标 → 好棋 → 坏棋 → 疑问手 → 清掉。
 * 第四下清除，是为了不给这一档另设第二个按钮（槽位不够）。 */
export const nextEvaluation = (current: NodeEvaluation | "" | undefined): { value: NodeEvaluation | ""; label: string } => {
  const index = EVALUATION_CYCLE.findIndex((item) => item.value === current);
  if (index < 0) return { value: "good", label: "好棋" };
  if (index === EVALUATION_CYCLE.length - 1) return { value: "", label: "清除标记" };
  return { value: EVALUATION_CYCLE[index + 1].value, label: EVALUATION_CYCLE[index + 1].label };
};

export interface RadialMenuContext {
  canErase: boolean;
  canBookmark: boolean;
  bookmarkActive: boolean;
  canJump: boolean;
  /** 打标（评价三档）：要能改这份谱，且按下的点确实对应当前路径上的一手。 */
  canEvaluate?: boolean;
  /** 按下的那一手当前的评价档（"" 或 undefined = 未标）。 */
  evaluation?: NodeEvaluation | "";
  canSetMain?: boolean;
  canCopyBranch?: boolean;
  /** 剪贴板里有分支才亮，否则置灰（点了只会得到一句"请先复制"，不如不亮）。 */
  canPasteBranch?: boolean;
  canDeleteAfter?: boolean;
  canShift?: boolean;
  canRotate?: boolean;
  canMirror?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
}

/** 某一页的外环按钮。槽位跨页尽量对齐：「取消」恒第 5 槽，
 * 通用页与分支页的第 3 槽都是「跳到此手」（同一类导航动作落在同一方向）。 */
export const buildRadialMenuItems = (context: RadialMenuContext, page: RadialMenuPageId = "general"): RadialMenuItem[] => {
  if (page === "branch") {
    return [
      { id: "setMain", label: "设为主分支", slot: 0, disabled: !context.canSetMain },
      { id: "copyBranch", label: "复制分支", slot: 1, disabled: !context.canCopyBranch },
      { id: "pasteBranch", label: "粘贴到这里", slot: 2, disabled: !context.canPasteBranch },
      { id: "jump", label: "跳到此手", slot: 3, disabled: !context.canJump },
      { id: "deleteAfter", label: "删除这一手及之后", slot: 4, disabled: !context.canDeleteAfter },
      { id: "cancel", label: "取消", slot: 5 },
    ];
  }
  if (page === "edit") {
    return [
      { id: "shift", label: "位移", slot: 0, disabled: !context.canShift },
      { id: "rotate", label: "旋转", slot: 1, disabled: !context.canRotate },
      { id: "mirror", label: "镜像", slot: 2, disabled: !context.canMirror },
      { id: "undo", label: "撤销", slot: 3, disabled: !context.canUndo },
      { id: "redo", label: "重做", slot: 4, disabled: !context.canRedo },
      { id: "cancel", label: "取消", slot: 5 },
    ];
  }
  return [
    { id: "erase", label: "去子", slot: 0, disabled: !context.canErase },
    { id: "bookmark", label: context.bookmarkActive ? "取消书签" : "加书签", slot: 1, disabled: !context.canBookmark },
    { id: "copyPosition", label: "复制局面", slot: 2 },
    { id: "jump", label: "跳到此手", slot: 3, disabled: !context.canJump },
    // 打标从原来的标注页挪到默认页（用户 10-01 重排）：它是"这一手"的属性，
    // 而且标注页整个删掉之后，这是评价三档唯一的入口。
    { id: "evaluate", label: context.evaluation ? `打标·${evaluationLabel(context.evaluation)}` : "打标", slot: 4, disabled: !context.canEvaluate },
    { id: "cancel", label: "取消", slot: 5 },
  ];
};

/** 中文数字（1–9999）：手序按中文读法写（「二十七手」）。越界时回退阿拉伯数字，
 * 不因为一个异常值把整段文本丢掉。 */
export const chineseNumber = (value: number): string => {
  if (!Number.isInteger(value) || value < 1 || value > 9999) return String(value);
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const text = String(value);
  let out = "";
  let zero = false;
  for (let index = 0; index < text.length; index += 1) {
    const digit = Number(text[index]);
    const unit = units[text.length - 1 - index];
    if (digit === 0) { if (out) zero = true; continue; }
    // 10–19 读「十X」，不写「一十X」。
    if (out === "" && digit === 1 && unit === "十") { out = "十"; continue; }
    if (zero) { out += "零"; zero = false; }
    out += digits[digit] + unit;
  }
  return out;
};

/** 整谱文本的行数上限：大谱（尤其 DP/数据库视图）可能有几万手，剪贴板背不动、
 * 粘出来也没法看。到顶就停，并在末尾如实写明有内容没写进去。 */
export const RADIAL_TEXT_LINE_LIMIT = 4000;

/** 「复制局面」的正文（用户 09-26 第三次定稿：**要能粘回来**）。
 * 主线按落子顺序、**一手一行**写成纯坐标串（H8 / I8 / H9…）——这正是应用自己的
 * TXT 坐标导入（formats.ts 的 parsePosMoves）唯一认的写法：它把空白/逗号/分号/连字符
 * 全剥掉后要求**整份文本**是纯坐标 token，夹一个中文字就整份作废。
 * 所以"给人看的手序说明"不能混进正文（只放在 toast 里），分支/摆子/过手也**写不进去**
 * ——格式没有承载它们的位置，调用方必须如实告诉用户"粘回来只有主线"。 */
export const formatRecordAsCoordinates = (document: GameDocument): string => {
  const size = document.metadata.boardSize || 15;
  const root = document.nodes[document.rootId];
  if (!root) return "";
  const lines: string[] = [];
  const seen = new Set<string>();
  let node: RecordNode | undefined = root;
  // 只走主线：preferredChildId 一路到底，没有它就走第一个子节点（与棋盘显示的口径一致）。
  while (node) {
    const current: RecordNode = node;
    const children: RecordNode[] = current.children.map((id) => document.nodes[id]).filter((child): child is RecordNode => Boolean(child));
    if (!children.length) break;
    const preferred = current.preferredChildId;
    const next: RecordNode | undefined = children.find((child) => child.id === preferred) || children[0];
    if (!next || seen.has(next.id)) break;   // 环保护：坏文档不至于把这里挂死
    seen.add(next.id);
    if (next.move) lines.push(coordinateName(next.move, size));
    node = next;
  }
  return lines.join("\n");
};

/** 复制坐标串时如实交代「粘回来会少什么」（用户 09-26：宁可先说清楚，
 * 也别让他粘进去才发现不对）。返回人话短语，空数组＝可以精确还原。
 *
 * 懒加载源（DP/DB 局面库、RenLib 网页核心读的 .lib）上，未读回来的分支只记在
 * `unloadedChildren` 里、没有节点——遍历 `document.nodes` 数不到它们，
 * 会少报「几处变化」（2026-10-10 排查：与分支树那条同属一类，拿子集当全谱）。
 * 所以这里把未加载的分支也算进去，并单独交代一句。 */
export const copyCoordinateCaveats = (document: GameDocument): string[] => {
  const caveats: string[] = [];
  const root = document.nodes[document.rootId];
  if (!root) return caveats;
  const setupCount = (root.setup?.black?.length || 0) + (root.setup?.white?.length || 0);
  if (setupCount) caveats.push(`${setupCount} 颗先摆的子`);
  let branches = 0;
  let passes = 0;
  let unloaded = 0;
  for (const node of Object.values(document.nodes)) {
    if (node.children.length > 1) branches += node.children.length - 1;
    if (!node.move && node.passPlayer) passes += 1;
    if (node.unloadedChildren) unloaded += node.unloadedChildren;
  }
  if (branches) caveats.push(`${branches} 处变化`);
  if (passes) caveats.push(`${passes} 手过手`);
  if (unloaded) caveats.push(`另有 ${unloaded} 支未加载（这份棋谱按局面读取）`);
  return caveats;
};

/** 长按/右键是否应该呼出环形菜单：开关开着、回调存在、且不是"空位长按"。
 * 空位长按仍按老规矩加标注——那是既有肌肉记忆，不抢。 */
export const shouldOpenRadialMenu = (context: {
  enabled: boolean;
  hasHandler: boolean;
  source: "longPress" | "contextMenu";
  hasStone: boolean;
}): boolean => {
  if (!context.enabled || !context.hasHandler) return false;
  return context.source === "contextMenu" || context.hasStone;
};
