/** 本体外观数据层的契约测试。
 *
 *  这层是从 `预览/skins/*.js` **机械生成**的（见 scripts/sync-appearance-materials.mjs），
 *  所以本测试管两件事：
 *    ① 生成物有没有过期（实验室改了、本体没跟着同步）—— 最容易悄悄发生的一种漂移；
 *    ② 每条记录本身是否自洽（id 前缀、黑白两面、动效选择器限定）。
 *
 *  ⚠ 刻意**不**断言具体颜色字符串。旧的 appearance-materials.test.ts 是按原文 grep
 *     CSS/TSX 里的渐变字面量来断言的，那种测试改个排版就一片红，测的是"字符串还在不在"
 *     而不是"外观对不对"。这里只测结构不变量。 */
import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest executes this contract test in Node; the browser app intentionally does not ship Node typings.
import { execFileSync } from "node:child_process";
import { KEEP, SKINS } from "./appearance";
import { deriveBoards, deriveStones } from "./appearance/derive";
import { boardLayers, findBoardMaterial, findStoneMaterial } from "./appearance/render";

const boards = deriveBoards(SKINS);
const stones = deriveStones(SKINS);

describe("外观数据层", () => {
  it("生成物与实验室同步（实验室改了就得重跑 sync 脚本）", () => {
    // --check 只比对不写盘；不一致就非零退出
    expect(() => execFileSync("node", ["scripts/sync-appearance-materials.mjs", "--check"], {
      stdio: "pipe",
    })).not.toThrow();
  });

  it("KEEP 里每个 id 都能在库里找到（改名/删文件会在这里断）", () => {
    const missing = KEEP.filter((id) => !SKINS.some((s) => s.id === id));
    expect(missing).toEqual([]);
  });

  it("派生出 30 块盘 + 33 枚子", () => {
    // 数量是用户一轮一轮删出来的，写死是有意的：改动它必须是有意识的决定
    // 2026-10-05 +1/+1：VCF 挑战同款的「琥珀木盘」「经典黑白」由用户点名加进棋盘/棋子清单
    // 2026-10-10 +1/+1：棋魂主题配套的「棋魂 · 墨焰宣纸」（盘 + 墨焰/魂芯双子）
    // 2026-10-12 +1/+1：豆包新方向的「青铜锈绿 · 出土铜镜」（盘 + 子）。
    //   同批的「胡桃木棋墩」（walnut）与「翡翠琉璃」（jade）**已下架** ——
    //   它们的 id 撞了 LEGACY_BOARD_THEMES 里的旧名，导致列表缩略图与点开预览
    //   画的是两套东西（用户实测发现）。详见 `预览/skins/loader.js` 的 KEEP 注释。
    expect(boards.length).toBe(30);
    expect(stones.length).toBe(33);
  });

  it("零件 id 不重名，且都带 bd-/st- 前缀", () => {
    const ids = [...boards.map((b) => b.id), ...stones.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((i) => !/^(bd|st)-/.test(i))).toEqual([]);
  });

  /** 同名 id 可以出现在多套皮肤里（古风一族就是共用同一段手书滤镜），
   *  但**定义必须逐字相同** —— 本体同时注入"这块盘的 defs + 那枚子的 defs"，
   *  同名不同内容就会一个盖掉另一个，表现为"换了子之后山的抖动变了"这种查半天的事。
   *  所以这里不要求前缀一定带皮肤 id，只要求同名即同定义。 */
  it("同名 defs id 跨皮肤必须是逐字相同的定义", () => {
    /** 取某个 id 声明处到下一个 id 声明之间的那段（近似"这个元素本身"） */
    const chunksOf = (defs: string) => {
      const marks = [...defs.matchAll(/id="([^"]+)"/g)];
      const out = new Map<string, string>();
      marks.forEach((m, i) => {
        const from = (i > 0 ? defs.lastIndexOf("<", m.index) : 0);
        const to = i + 1 < marks.length ? defs.lastIndexOf("<", marks[i + 1].index) : defs.length;
        out.set(m[1], defs.slice(from, to).trim());
      });
      return out;
    };
    const seen = new Map<string, { skin: string; body: string }>();
    const clashes: string[] = [];
    for (const sk of SKINS) {
      if (!sk.defs) continue;
      for (const [id, body] of chunksOf(String(sk.defs))) {
        const prior = seen.get(id);
        if (prior && prior.body !== body) clashes.push(`${id}：${prior.skin} 与 ${sk.id} 同名但定义不同`);
        if (!prior) seen.set(id, { skin: sk.id, body });
      }
    }
    expect(clashes).toEqual([]);
  });

  it("每枚子都画得出东西，且黑白两面不一样", () => {
    const bad: string[] = [];
    for (const st of stones) {
      const b = st.stone({ x: 200, y: 200, r: 15.84, player: 1 });
      const w = st.stone({ x: 200, y: 200, r: 15.84, player: 2 });
      if (b.length < 20 || w.length < 20) bad.push(`${st.id} 画出来是空的`);
      else if (b === w) bad.push(`${st.id} 黑白两面一模一样`);
    }
    expect(bad).toEqual([]);
  });

  /** 摊平成「零件 × 它的一套动效」，两条断言共用 */
  const allMotions = () => [...boards, ...stones].flatMap((p) => p.motions.map((mo) => ({ part: p.id, mo })));

  it("动效的 css 都被 #board 限定住（漏出去就会改到页面上别的 SVG）", () => {
    const loose = allMotions()
      .filter(({ part, mo }) => { const css = mo.css(part); return css.includes("{") && !css.includes("#board"); })
      .map(({ part, mo }) => `${part}/${mo.id}`);
    expect(loose).toEqual([]);
  });

  it("每套自带动效都带减少动态效果的兜底", () => {
    const missing = allMotions()
      .filter(({ part, mo }) => !mo.css(part).includes("prefers-reduced-motion"))
      .map(({ part, mo }) => `${part}/${mo.id}`);
    expect(missing).toEqual([]);
  });

  /** 本体移植那批皮肤 id 带 app- 前缀，而本体的 theme 值是裸名。
   *  别名解析不了的话，14 套老材质会静默走回 .board-X CSS 那条路 —— 表现就是"改了没生效"。 */
  it("本体的 theme 值能查到材质（裸名与 app- 前缀都认）", () => {
    expect(findBoardMaterial("wood")?.id).toBe("bd-app-wood");
    expect(findStoneMaterial("blackgold")?.id).toBe("st-app-blackgold");
    // 实验室原创的画风没有 app- 前缀，直接命中
    expect(findBoardMaterial("dh-feitian")?.id).toBe("bd-dh-feitian");
    expect(findBoardMaterial("没有这套材质")).toBeNull();
  });

  it("带坐标的装饰只在 15 路下出，颜色层任何路数都出", () => {
    const mat = findBoardMaterial("dh-feitian");
    expect(mat).not.toBeNull();
    const at15 = boardLayers(mat!, 15, 34, 36);
    const at19 = boardLayers(mat!, 19, 34, 29);
    // 盘底 + defs 两边都在
    expect(at19).toContain("<defs>");
    expect(at19).toContain('rx="');
    // 网格锚定的装饰只允许出现在 15 路
    if (mat!.gridExtra) {
      expect(at15).toContain(mat!.gridExtra.slice(0, 40));
      expect(at19).not.toContain(mat!.gridExtra.slice(0, 40));
    }
  });
});
