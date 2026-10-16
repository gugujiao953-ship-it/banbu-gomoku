/** 用材质数据本身画小预览图（设置里的色块、外观那一栏的实时预览条）。
 *
 *  为什么不是再补一份 CSS：本体现有的 `.board-preview.<id>` / `.stone-preview.<id>`
 *  是**每个主题手写一条**（library.css 里 13 + 25 条），实验室搬进来的 31 套再手写一遍
 *  就是第三份真相，且手写色块根本表达不了渐变/pattern/异形子。
 *  这里直接把材质记录渲染成一个自带 viewBox 的小 SVG —— 和真实棋盘同一份数据，
 *  看到的色块就是盘子上会出现的东西。
 *
 *  本体原有的那 14 盘 / 16 子没有材质记录（还走 CSS 老路），所以传进来查不到时
 *  返回 null，调用方保留原来的 `<i className="board-preview xxx">`。
 *
 *  ⚠ 2026-10-02 修：老值（`wood`/`jade`/…）现在会先**解析到材质那套的同名条目**
 *    （`app-wood`/`app-jade`/…）再画。原因有两个：
 *      ① 老的 `.board-preview.<名字>` 色块在本体已经**不生效** —— 在
 *         `.material-preview-board` 这个容器里它是 inline 元素、内联宽高被忽略，
 *         实测渲染成 **0×0**（隐形）。默认主题正好是老值 `wood`，
 *         于是"外观"里那块实时预览板**打开就是空的**，看着像"预览没生效/固定了"。
 *      ② 同一批设计在本体现在有材质记录了，画真材质比手写色块准。
 *    兜底保留 `<i>`（并补 display:block），万一遇到既没材质记录、也不在老名单里的值。 */
import type { BoardMaterial, StoneMaterial } from "./types";
import { boardLayers, boardLineProps, findBoardMaterial, findStoneMaterial, newMaterialBoard, newMaterialStone, stoneMarkup } from "./render";
import { SvgHtml } from "./svg-html";
import { BOARD_VIEWBOX, DEFAULT_BOARD_MARGIN } from "../features/settings/board-margin";
import { DEFAULT_STONE_SCALE, stoneRadiusFor } from "../features/settings/stone-size";

/** 老主题名 → 材质那套：`wood` → `app-wood`；`gold-diamond` 这类还试一次去连字符的写法。 */
const boardMaterialFor = (theme: string): BoardMaterial | null =>
  newMaterialBoard(theme)
  ?? newMaterialBoard(`app-${theme}`)
  ?? newMaterialBoard(`app-${String(theme).replace(/-/g, "")}`);
const stoneMaterialFor = (theme: string): StoneMaterial | null =>
  newMaterialStone(theme)
  ?? newMaterialStone(`app-${theme}`)
  ?? newMaterialStone(`app-${String(theme).replace(/-/g, "")}`);

/** 缩略图里画几根线：32px 的色块上画 15 根会糊成一团 */
const SWATCH_LINES = 5;

export function BoardSwatch({ theme, size = 32 }: { theme: string; size?: number }) {
  const mat = newMaterialBoard(theme);
  if (!mat) return null;
  return <BoardSwatchFrom mat={mat} size={size} />;
}

/** 拆出来给"没有 theme 只有 mat"的调用方用（如导出图、树预览） */
export function BoardSwatchFrom({ mat, size = 32 }: { mat: BoardMaterial; size?: number }) {
  const step = 620 / (SWATCH_LINES + 1);
  const lines = Array.from({ length: SWATCH_LINES }, (_, i) => step * (i + 1)).map((v) =>
    `M${step * 0.6} ${v}H${620 - step * 0.6}M${v} ${step * 0.6}V${620 - step * 0.6}`).join("");
  const stroke = mat.lineStroke && mat.lineStroke !== "none" ? mat.lineStroke : "#594a36";
  return (
    <svg className="material-swatch" width={size} height={size} viewBox="0 0 620 620" aria-hidden="true">
      <SvgHtml tag="defs" html={mat.defs || ""} />
      <rect x="0" y="0" width="620" height="620" rx={mat.radius ?? 18} fill={mat.fill || "#d8ad69"} />
      {/* 带坐标的装饰按整幅 620 摆，缩略图里只保留底色与线，不然题字会糊成一团黑 */}
      <path d={lines} fill="none" stroke={stroke} strokeWidth={mat.lineW ?? 1.25} opacity={mat.lineOpacity ?? 0.86} />
      <circle cx="310" cy="310" r={mat.starR ? mat.starR * 2.2 : 9} fill={mat.starFill || stroke} />
    </svg>
  );
}

/** 真实棋盘 + 真棋子的**局部截取**预览。
 *
 *  用户 2026-10-02：「我要的是真实棋盘棋子的预览，不是颜色预览、缩略框预览这种的，
 *  之前我们的不就是真实棋盘截取的一部分的预览吗」。
 *  色块（BoardSwatchFrom）把材质当"颜色样本"看，看不出线宽/星位/纹理，也看不出棋子
 *  在盘上的实际关系；截取真实棋盘才等于把「选了这套会看到什么」的**局部原样**给你看。
 *
 *  实现就是走本体真正的那条渲染路：boardLayers()（盘底+装饰）+ 现算网格 + stoneMarkup()
 *  摆几枚真子，然后把 viewBox 收成中心 span×span 格 —— 截取窗口靠 viewBox 完成，
 *  元素一个不删，所以放大后看到的就是真实渲染，不存在"另画一份像不像"的问题。
 *
 *  ⚠ 几何必须用**本体**的公式（viewBox 572、默认边距 34、gap 由路数算、半径走
 *     stoneRadiusFor）。实验室那套是 viewBox 620 / 边距 46 / 15 路写死，
 *     直接搬过来截取窗口会和交点错位 —— 这正是它一直没能复用到这里的原因。 */
export function MaterialBoardCrop({ boardTheme, stoneTheme, size = 200, boardSize = 15, span = 5, part = "all", svgRef }: {
  boardTheme: string;
  stoneTheme: string;
  size?: number;
  /** 路数。默认 15，与本体默认一致 */
  boardSize?: number;
  /** 截取几格（5 = 5 格 = 6×6 个交点） */
  span?: number;
  /** 只画哪一层。设置里"棋盘透明度 / 棋子透明度"是两个滑杆，
   *  要分别作用在两层上，所以同一块截取图会叠两次、各取一层。 */
  part?: "all" | "board" | "stones";
  /** 把这块截取图的 <svg> 暴露出去（外观「特效」版面要把落子特效插进**同一块**预览，
   *  不再另起一块舞台 —— 用户 2026-10-09：「公用特效那里还是一块新棋盘，上面一个下面一个的」）。 */
  svgRef?: React.Ref<SVGSVGElement>;
}) {
  const bm = findBoardMaterial(boardTheme);
  const sm = findStoneMaterial(stoneTheme);
  if (!bm) return <BoardChip theme={boardTheme} size={size} />;
  const margin = DEFAULT_BOARD_MARGIN;
  const gap = (BOARD_VIEWBOX - 2 * margin) / Math.max(1, boardSize - 1);
  const xy = (i: number) => margin + i * gap;
  const cp = boardLineProps(bm);
  const radius = stoneRadiusFor(gap, DEFAULT_STONE_SCALE);
  /* 截取窗口：以盘心为中心、宽 span 格。盘心 = (boardSize-1)/2 号交点。 */
  const mid = (boardSize - 1) / 2;
  const from = xy(mid - span / 2);
  const box = span * gap;
  let lines = "";
  for (let i = 0; i < boardSize; i += 1) {
    lines += `M${xy(0)} ${xy(i)}H${xy(boardSize - 1)}M${xy(i)} ${xy(0)}V${xy(boardSize - 1)}`;
  }
  const stars: Array<[number, number]> = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
  /* 盘心摆一小簇真子（黑白交替）：既看得到材质子的质感，也看得到它在盘底上的对比。
     位置固定、不是随机 —— 同一个材质每次打开预览必须长得一样。 */
  const c = Math.round(mid);
  const stones: Array<[number, number, 1 | 2]> = [[c, c, 1], [c, c + 1, 2], [c + 1, c + 1, 1], [c - 1, c, 2], [c, c - 1, 1]];
  return (
    <svg ref={svgRef} className="material-crop" width={size} height={size}
      viewBox={`${from} ${from} ${box} ${box}`} aria-hidden="true">
      {part !== "stones" && <SvgHtml tag="g" html={boardLayers(bm, boardSize, margin, gap)} />}
      {part !== "stones" && <path d={lines} fill="none" stroke={cp.stroke} strokeWidth={cp.width} opacity={cp.opacity} />}
      {part !== "stones" && <g fill={cp.star} opacity={cp.starOpacity ?? 1}>
        {stars.map(([sr, sc]) => <circle key={`${sr}-${sc}`} cx={xy(sc)} cy={xy(sr)} r={3.6} />)}
      </g>}
      {/* ⚠ 2026-10-09 修「换棋子材质后预览里的子残留旧材质」：
          `stoneMarkup` 出的子引用 `url(#<材质前缀>-kb/kw/sh)` 这类 defs，而这里原来**只注入了
          棋盘材质的 defs**（boardLayers 自带那份），棋子的 defs 从来没注入过。
          平时看着正常，是因为**真实棋盘**（打谱页那个 svg）已经把当前材质的 defs 放进了文档，
          ID 是全局的 `url(#…)`，预览"借用"了它。
          于是换材质时：新材质的 defs 还没进文档（真实棋盘要等它自己重渲染），
          `url(#新渐变)` 解析不到 ⇒ 浏览器沿用上一次的解析结果 ⇒ **看着就是"残留旧材质"**；
          去别的版面再回来正好触发一次重渲染、defs 到位，于是"又好了"。
          修法：预览自己注入所用**棋子**材质的 defs。材质的 id 都带 `P()` 前缀、互不冲突，
          叠着注入也不会串味（正是那份材质注释里点过的历史坑）。 */}
      {part !== "board" && sm?.defs ? <SvgHtml tag="defs" html={sm.defs} key={`sd-${sm.src}`} /> : null}
      {part !== "board" && sm && <g className="material-crop-stones">
        {stones.map(([sr, sc, p]) => (
          <SvgHtml key={`s${sr}-${sc}`} tag="g" html={stoneMarkup(sm, xy(sc), xy(sr), radius, p, false, false)} />
        ))}
      </g>}
    </svg>
  );
}

export function StoneSwatch({ theme, size = 32 }: { theme: string; size?: number }) {
  const mat = newMaterialStone(theme);
  if (!mat) return null;
  return <StoneSwatchFrom mat={mat} size={size} />;
}

/** 两颗子并排：黑在左、白在右，中间留一点距离，避免互相盖住。
 *  注意 stone() 里可能自带落影/护边，所以底色用中性纸色，不预设明暗。 */
export function StoneSwatchFrom({ mat, size = 32 }: { mat: StoneMaterial; size?: number }) {
  const markup = [
    mat.stone({ x: 66, y: 100, r: 44, player: 1 }),
    mat.stone({ x: 138, y: 100, r: 44, player: 2 }),
  ].join("");
  return (
    <svg className="material-swatch" width={size} height={size} viewBox="0 0 204 200" aria-hidden="true">
      <SvgHtml tag="defs" html={mat.defs || ""} />
      <rect x="0" y="0" width="204" height="200" rx="18" fill="#d8ad69" />
      <SvgHtml tag="g" html={markup} />
    </svg>
  );
}

/** 设置列表里的色块：有材质记录的画真材质，没有的（本体原有那 14/16 套）
 *  退回原来的 `<i class="board-preview xxx">` CSS 色块。调用方不用自己判断。 */
export function BoardChip({ theme, size = 32 }: { theme: string; size?: number }) {
  const mat = boardMaterialFor(theme);
  // 回退那支的 display:block 不是装饰：`<i>` 默认 inline，内联宽高会被忽略 → 渲染成 0×0。
  return mat ? <BoardSwatchFrom mat={mat} size={size}/> : <i className={`board-preview ${theme}`} style={{ display: "block", width: size, height: size, flex: `0 0 ${size}px` }} aria-hidden="true" />;
}

export function StoneChip({ theme, size = 32 }: { theme: string; size?: number }) {
  const mat = stoneMaterialFor(theme);
  return mat ? <StoneSwatchFrom mat={mat} size={size}/> : <i className={`stone-preview ${theme}`} style={{ display: "block", width: size, height: size, flex: `0 0 ${size}px` }} aria-hidden="true" />;
}
