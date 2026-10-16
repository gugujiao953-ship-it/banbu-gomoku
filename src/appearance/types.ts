/** 外观材质的类型契约 —— 与皮肤实验室（`预览/skins/*.js`）里那些对象一一对应。
 *
 *  ⚠ `src/appearance/materials/*.ts` 是 `scripts/sync-appearance-materials.mjs`
 *     从实验室的 JS **机械转换**出来的（只替换 `window.SKINS` → 模块内数组，正文一字不改）。
 *     所以这里的字段名必须保持和实验室一致，不要"顺手改成更好的名字"——
 *     一改，同步脚本就要加一层重命名映射，实验室和本体立刻开始漂移。
 *
 *  为什么长这样而不是复用本体的 `BoardTheme` / `StoneTheme` 枚举：
 *     那套枚举要求每加一种外观就手写一段 `.board-X` CSS + 一段 defs +（异形子）一段 JSX，
 *     三处分散、且和实验室各存一份。这里是一条记录自带全部信息，渲染端只管读。
 */

/** 一段自带动效：`css(id)` 收到的是**零件 id**（`bd-<皮肤id>` / `st-<皮肤id>`），
 *  生成的选择器要能被 `#board` 限定住，否则会漏到页面上别的 SVG。 */
export interface MotionScheme {
  id: string;
  /** 设置里给人看的名字 */
  name: string;
  /** 一句话说明它动的是画面里的什么东西 */
  desc?: string;
  css: (id: string) => string;
}

/** 一个交叉点上要画的棋子。`r` 是标准子半径，`player` 1=黑 2=白。 */
export type StonePainter = (args: {
  x: number;
  y: number;
  r: number;
  player: 1 | 2;
  isLast?: boolean;
  isWin?: boolean;
}) => string;

/** 一套外观 = 一个皮肤对象，可能只有盘、只有子、或两半都有。 */
export interface Skin {
  id: string;
  name: string;
  /** 实验室里的分组标签。**只在没有 sub 时**兜底显示在选择列表第二行
   *  （SettingsPage 的 motionText：自带动效 → sub → group → 「材质」）。
   *  像「软件本体材质」这种内部说法不该给用户看，所以移植进来的材质一律各自写 sub。 */
  group?: string;
  /** 选择列表第二行的一句话说明（这块盘/这枚子长什么样）。有自带动效时列表优先转动效名。 */
  sub?: string;
  /** 选择列表里的小色块 */
  swatch?: string;
  /** 页面底色（实验室用来铺背景，本体里对应外壳） */
  pageBg?: string;
  /** 圆角 */
  radius?: number;
  /** 注入到 `<svg>` 上的 CSS 自定义属性（`--bd-*` / `--st-*`） */
  vars?: Record<string, string>;
  /** 共享 `<defs>` 内容。同一份 SVG 里会同时注入「这块盘的 defs」和
   *  「那枚子的 defs」，所以**同名 id 必须逐字同定义**（古风一族就是共用同一段
   *  手书滤镜）。同名不同内容是 appearance.test.ts 里的硬断言。 */
  defs?: string;

  /* ── 棋盘半边 ──
     判定规则（与实验室 `预览/parts/parts.js` 的 `derive()` 完全一致）：
     下面这些字段**任一存在**才算"这套皮肤画了盘"，否则不生成棋盘零件。 */
  boardFill?: string;
  boardOverlay?: string;
  frame?: string;
  gridExtra?: string;
  lineStroke?: string;
  lineW?: number;
  lineOpacity?: number;
  lineFilter?: string;
  starFill?: string;
  starR?: number;
  starOpacity?: number;
  boardMotions?: MotionScheme[];

  /* ── 棋子半边 ── */
  stone?: StonePainter;
  stoneMotions?: MotionScheme[];
  /** 这套子自己解决对比（例如在圈底下垫一层粉笔色），引擎不要再套护边圆盘 */
  selfRim?: boolean;
  /** 用户点名删掉了这套皮肤的子、盘要留 —— 见 `derive()` 里那两处半边删除的声明位 */
  noStone?: boolean;

  /** 与动效无关的静态 CSS（题字字体、装饰样式等） */
  css?: string;
}

/** 派生出来的棋盘零件：`Skin` 的盘半边 + 它来自哪套皮肤。 */
export interface BoardMaterial {
  id: string;
  src: string;
  name: string;
  group: string;
  sub?: string;
  swatch?: string;
  pageBg?: string;
  radius?: number;
  fill?: string;
  overlay?: string;
  frame?: string;
  gridExtra?: string;
  lineStroke?: string;
  lineW?: number;
  lineOpacity?: number;
  lineFilter?: string;
  starFill?: string;
  starR?: number;
  starOpacity?: number;
  defs?: string;
  vars?: Record<string, string>;
  css?: string;
  motions: MotionScheme[];
}

/** 派生出来的棋子零件。 */
export interface StoneMaterial {
  id: string;
  src: string;
  name: string;
  group: string;
  sub?: string;
  swatch?: string;
  stone: StonePainter;
  defs?: string;
  vars?: Record<string, string>;
  selfRim: boolean;
  motions: MotionScheme[];
}
