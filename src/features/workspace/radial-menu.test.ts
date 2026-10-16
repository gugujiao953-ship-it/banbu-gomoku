import { describe, expect, it } from "vitest";
import { buildRadialMenuItems, chineseNumber, copyCoordinateCaveats, evaluationLabel, formatRecordAsCoordinates, nextEvaluation, radialItemPositions, radialPageAt, radialSlotAt, RADIAL_MENU_PAGES, RADIAL_MENU_RADIUS, RADIAL_MENU_SLOTS, shouldOpenRadialMenu } from "./radial-menu";
describe("长按环形菜单（用户 09-17 第二批①；10-01 内环分页）", () => {
  it("圆环从正上方开始顺时针均匀摆位", () => {
    const positions = radialItemPositions(4);
    expect(positions[0].x).toBeCloseTo(0, 6);
    expect(positions[0].y).toBeCloseTo(-RADIAL_MENU_RADIUS, 6);
    expect(positions[1].x).toBeCloseTo(RADIAL_MENU_RADIUS, 6);
    expect(positions[1].y).toBeCloseTo(0, 6);
    expect(positions[2].x).toBeCloseTo(0, 6);
    expect(positions[2].y).toBeCloseTo(RADIAL_MENU_RADIUS, 6);
    expect(positions[3].x).toBeCloseTo(-RADIAL_MENU_RADIUS, 6);
    expect(positions[3].y).toBeCloseTo(0, 6);
  });

  it("零项不产生任何位置", () => {
    expect(radialItemPositions(0)).toEqual([]);
    expect(radialItemPositions(-3)).toEqual([]);
  });

  it("六槽命中：落在某槽附近返回该槽，落在圆心与远处返回 null", () => {
    expect(radialSlotAt({ x: 0, y: -RADIAL_MENU_RADIUS })).toBe(0);
    // 第三槽在正下方（六槽、每槽 60°：0=上、3=下）。
    expect(radialSlotAt({ x: 0, y: RADIAL_MENU_RADIUS })).toBe(3);
    expect(radialSlotAt({ x: 0, y: 0 })).toBeNull();
    expect(radialSlotAt({ x: 999, y: 999 })).toBeNull();
    // 两槽之间（正上方偏 30°，半径同）离两槽都超过命中半径 → 谁都不选。
    expect(radialSlotAt({ x: Math.sin(Math.PI / 6) * RADIAL_MENU_RADIUS, y: -Math.cos(Math.PI / 6) * RADIAL_MENU_RADIUS })).toBeNull();
  });

  it("内环切页命中：三格扇区（通用上、分支右下、编辑左下），中心孔与外环不算", () => {
    const inRing = (deg: number) => ({ x: Math.sin(deg * Math.PI / 180) * 36, y: -Math.cos(deg * Math.PI / 180) * 36 });
    expect(radialPageAt(inRing(0))).toBe(0);      // 通用：正上方
    expect(radialPageAt(inRing(120))).toBe(1);    // 分支：右下
    expect(radialPageAt(inRing(240))).toBe(2);    // 编辑：左下
    // 通用这一格以正上方为中心跨 ±60°；越过缝的点归左边那格（编辑），首尾相接不重叠。
    expect(radialPageAt(inRing(-59))).toBe(0);
    expect(radialPageAt(inRing(-61))).toBe(2);
    // 中心孔与外环都不算切页：长按呼出菜单时手指就在圆心附近，那一下不能改页。
    expect(radialPageAt({ x: 0, y: 0 })).toBeNull();
    expect(radialPageAt({ x: 10, y: 0 })).toBeNull();
    expect(radialPageAt({ x: 60, y: 0 })).toBeNull();
    expect(radialPageAt({ x: RADIAL_MENU_RADIUS, y: 0 })).toBeNull();
  });

  it("打标三档循环：未标→好棋→坏棋→疑问手→清掉（第四下是清除，槽位不够不再加按钮）", () => {
    expect(nextEvaluation(undefined)).toEqual({ value: "good", label: "好棋" });
    expect(nextEvaluation("good")).toEqual({ value: "bad", label: "坏棋" });
    expect(nextEvaluation("bad")).toEqual({ value: "doubtful", label: "疑问手" });
    expect(nextEvaluation("doubtful")).toEqual({ value: "", label: "清除标记" });
    expect(evaluationLabel("bad")).toBe("坏棋");
    expect(evaluationLabel("interesting")).toBe("");   // 三档之外的旧数据不显示成按钮标签
  });

  it("通用页：去子/加书签/复制局面/跳到此手/打标/取消（六槽满，取消恒第五槽）", () => {
    const all = buildRadialMenuItems({ canErase: true, canBookmark: true, bookmarkActive: false, canJump: true, canEvaluate: true, evaluation: "" });
    expect(all.map((item) => item.id)).toEqual(["erase", "bookmark", "copyPosition", "jump", "evaluate", "cancel"]);
    expect(all.map((item) => item.label)).toEqual(["去子", "加书签", "复制局面", "跳到此手", "打标", "取消"]);
    expect(all.map((item) => item.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(all.every((item) => !item.disabled)).toBe(true);
    // 这一手已经收进书签 → 同一槽变成「取消书签」（一次点击就是开关）。
    const bookmarked = buildRadialMenuItems({ canErase: true, canBookmark: true, bookmarkActive: true, canJump: true });
    expect(bookmarked.find((item) => item.id === "bookmark")?.label).toBe("取消书签");
    const limited = buildRadialMenuItems({ canErase: false, canBookmark: false, bookmarkActive: false, canJump: false });
    expect(limited.find((item) => item.id === "erase")?.disabled).toBe(true);
    expect(limited.find((item) => item.id === "bookmark")?.disabled).toBe(true);
    expect(limited.find((item) => item.id === "jump")?.disabled).toBe(true);
    // 打标在不能改谱时置灰（读谱、对弈、做题，或按下的点不在当前路径上）。
    expect(limited.find((item) => item.id === "evaluate")?.disabled).toBe(true);
    // 复制局面与取消永远可用。
    expect(limited.find((item) => item.id === "copyPosition")?.disabled).toBeUndefined();
    expect(limited.find((item) => item.id === "cancel")?.disabled).toBeUndefined();
  });

  it("三页各六槽以内、跨页槽位尽量对齐（取消恒第五槽；通用与分支的第 3 槽都是跳到此手）", () => {
    const context = {
      canErase: true, canBookmark: true, bookmarkActive: false, canJump: true, canEvaluate: true, evaluation: "" as const,
      canSetMain: true, canCopyBranch: true, canPasteBranch: true, canDeleteAfter: true,
      canShift: true, canRotate: true, canMirror: true, canUndo: true, canRedo: true,
    };
    expect(RADIAL_MENU_PAGES.map((item) => item.id)).toEqual(["general", "branch", "edit"]);
    for (const page of RADIAL_MENU_PAGES) {
      const items = buildRadialMenuItems(context, page.id);
      expect(items.length, page.id).toBeLessThanOrEqual(RADIAL_MENU_SLOTS);
      expect(items.length, page.id).toBeGreaterThanOrEqual(5);
      const slots = items.map((item) => item.slot);
      expect(new Set(slots).size, page.id).toBe(slots.length);           // 同页不撞槽
      expect(slots.every((slot) => slot >= 0 && slot < RADIAL_MENU_SLOTS), page.id).toBe(true);
      expect(items[items.length - 1].id, page.id).toBe("cancel");
      expect(items[items.length - 1].slot, page.id).toBe(5);
    }
    expect(buildRadialMenuItems(context, "general")[3].id).toBe("jump");
    expect(buildRadialMenuItems(context, "branch")[3].id).toBe("jump");
    // 分支页：复制与粘贴成对出现（只有「复制分支」而没有粘贴入口，复制完就没下文）。
    expect(buildRadialMenuItems(context, "branch").map((item) => item.id))
      .toEqual(["setMain", "copyBranch", "pasteBranch", "jump", "deleteAfter", "cancel"]);
    // 打标按钮的标签跟着当前档走（未标→「打标」，已标好棋→「打标·好棋」，点了往下一档）。
    expect(buildRadialMenuItems({ ...context, evaluation: undefined }, "general")[4].label).toBe("打标");
    expect(buildRadialMenuItems({ ...context, evaluation: "good" }, "general")[4].label).toBe("打标·好棋");
  });

  it("菜单里不再有标注类按钮与「新建分支」（用户 10-01 第二轮重排）", () => {
    const context = { canErase: true, canBookmark: true, bookmarkActive: false, canJump: true, canEvaluate: true };
    const ids: string[] = RADIAL_MENU_PAGES.flatMap((page) => buildRadialMenuItems(context, page.id).map((item) => item.id));
    // 标注：底部标注栏有 6 个文字组 × 12 样式 × 12 颜色，六槽外环镜像不过来；空位长按仍是加标注。
    for (const gone of ["addMark", "cycleMarkStyle", "eraseMark", "editComment"]) expect(ids, gone).not.toContain(gone);
    // 新建分支：createBranchFromTree 只是 setCurrentId + 一句提示，与「跳到此手」同义。
    expect(ids, "newBranch").not.toContain("newBranch");
  });
});

import { coordinateName } from "../../game";
import { importRecordFile } from "../../formats";
import type { GameDocument, Player, Position, RecordNode } from "../../types";

/** 只填被测函数真正会读的字段：metadata 只用 boardSize，节点只用 move / passPlayer /
 * setup / children / preferredChildId。补齐类型要拖进整份 metadata 定义，
 * 反而让测试跟着无关字段的改动一起坏掉。 */
const documentWith = (root: Partial<RecordNode> & { id: string }, extra: RecordNode[] = [], boardSize = 15) => ({
  id: "doc", version: 1, rootId: root.id,
  nodes: { [root.id]: root, ...Object.fromEntries(extra.map((node) => [node.id, node])) },
  metadata: { boardSize },
  createdAt: "", updatedAt: "",
} as unknown as GameDocument);

const node = (id: string, parentId: string, move: (Position & { player: Player }) | null, children: string[] = [], extra: Partial<RecordNode> = {}): RecordNode => ({
  id, parentId, children, move, comment: "", marks: [], ...extra,
});

describe("环形菜单的局面文本与呼出条件（09-26 定稿口径）", () => {

  it("中文数字按读法写：十X 不写一十X，中间补零", () => {
    expect(chineseNumber(1)).toBe("一");
    expect(chineseNumber(5)).toBe("五");
    expect(chineseNumber(10)).toBe("十");
    expect(chineseNumber(11)).toBe("十一");
    expect(chineseNumber(20)).toBe("二十");
    expect(chineseNumber(27)).toBe("二十七");
    expect(chineseNumber(105)).toBe("一百零五");
    expect(chineseNumber(1010)).toBe("一千零一十");
    // 越界回退阿拉伯数字，不丢整段文本。
    expect(chineseNumber(0)).toBe("0");
    expect(chineseNumber(10000)).toBe("10000");
  });

  it("复制局面：主线写成一手一行的纯坐标串（导入唯一认的写法）", () => {
    const document = documentWith(
      node("root", "", null, ["m1"]) as Partial<RecordNode> & { id: string },
      [
        node("m1", "root", { row: 7, col: 7, player: "black" }, ["m2"]),
        node("m2", "m1", { row: 7, col: 8, player: "white" }),
      ],
    );
    const text = formatRecordAsCoordinates(document);
    expect(text.split("\n")).toEqual([coordinateName({ row: 7, col: 7 }, 15), coordinateName({ row: 7, col: 8 }, 15)]);
    // 严格到"整份文本都要是坐标"——这正是 formats.ts 里 parsePosMoves 的口径，
    // 夹一个中文字整份就作废，所以正文里绝不能出现别的字符。
    expect(text).toMatch(/^(?:[A-O](?:1[0-5]|[1-9])\n?)+$/);
  });

  it("复制局面：只走主线，分支不进坐标串（preferredChildId 优先）", () => {
    const document = documentWith(
      node("root", "", null, ["m1"]) as Partial<RecordNode> & { id: string },
      [
        node("m1", "root", { row: 7, col: 7, player: "black" }, ["main", "side"], { preferredChildId: "main" }),
        node("main", "m1", { row: 6, col: 6, player: "white" }),
        node("side", "m1", { row: 5, col: 5, player: "white" }),
      ],
    );
    expect(formatRecordAsCoordinates(document).split("\n")).toEqual([
      coordinateName({ row: 7, col: 7 }, 15),
      coordinateName({ row: 6, col: 6 }, 15),
    ]);
  });

  it("复制局面：没有落子顺序（只摆了子）→ 空串，调用方据此提示改用导出", () => {
    const document = documentWith(node("root", "", null, [], {
      setup: { black: [{ row: 7, col: 7 }], white: [], empty: [], nextPlayer: "black" },
    }) as Partial<RecordNode> & { id: string });
    expect(formatRecordAsCoordinates(document)).toBe("");
  });

  it("复制局面：如实交代粘回来会少什么（路数/摆子/变化/过手）", () => {
    const document = documentWith(
      node("root", "", null, ["m1", "m2"], {
        setup: { black: [{ row: 0, col: 0 }], white: [{ row: 0, col: 1 }], empty: [], nextPlayer: "black" },
      }) as Partial<RecordNode> & { id: string },
      [
        node("m1", "root", { row: 7, col: 7, player: "black" }, ["m3"]),
        node("m2", "root", { row: 8, col: 8, player: "black" }),
        node("m3", "m1", null, [], { passPlayer: "white" }),
      ],
    );
    const caveats = copyCoordinateCaveats(document);
    expect(caveats.join("｜")).toContain("2 颗先摆的子");
    expect(caveats.join("｜")).toContain("1 处变化");
    expect(caveats.join("｜")).toContain("1 手过手");
    // 干净的 15 路主线：没有任何"会少什么"。
    const clean = documentWith(
      node("root", "", null, ["m1"]) as Partial<RecordNode> & { id: string },
      [node("m1", "root", { row: 7, col: 7, player: "black" })],
    );
    expect(copyCoordinateCaveats(clean)).toEqual([]);
    // 非 15 路也可以在坐标粘贴面板里选择对应路数，不能再提示会丢失路数。
    const big = documentWith(node("root", "", null, ["m1"]) as Partial<RecordNode> & { id: string }, [node("m1", "root", { row: 7, col: 7, player: "black" })], 19);
    expect(copyCoordinateCaveats(big)).toEqual([]);
  });

  it("复制出来的坐标串能被导入器原样吃回去（真闭环：走 formats 的 TXT 导入）", async () => {
    const document = documentWith(
      node("root", "", null, ["m1"]) as Partial<RecordNode> & { id: string },
      [
        node("m1", "root", { row: 7, col: 7, player: "black" }, ["m2"]),
        node("m2", "m1", { row: 7, col: 8, player: "white" }, ["m3"]),
        node("m3", "m2", { row: 8, col: 8, player: "black" }),
      ],
    );
    const text = formatRecordAsCoordinates(document);
    const result = await importRecordFile(new File([text], "copy.txt", { type: "text/plain" }));
    expect(result.format).toBe("POS/TXT");
    // 复制 → 导入 → 再复制：字符串逐字相同，才算真的"粘得回来"。
    expect(formatRecordAsCoordinates(result.document)).toBe(text);
  });

  it("呼出条件：空位长按不抢标注，右键与有子长按才开菜单", () => {
    const base = { enabled: true, hasHandler: true };
    expect(shouldOpenRadialMenu({ ...base, source: "longPress", hasStone: false })).toBe(false);
    expect(shouldOpenRadialMenu({ ...base, source: "longPress", hasStone: true })).toBe(true);
    expect(shouldOpenRadialMenu({ ...base, source: "contextMenu", hasStone: false })).toBe(true);
    expect(shouldOpenRadialMenu({ ...base, source: "contextMenu", hasStone: true })).toBe(true);
    // 开关关掉或没有回调时一律不开（关闭开关 = 老行为）。
    expect(shouldOpenRadialMenu({ ...base, enabled: false, source: "longPress", hasStone: true })).toBe(false);
    expect(shouldOpenRadialMenu({ ...base, hasHandler: false, source: "contextMenu", hasStone: true })).toBe(false);
  });
});
