/**
 * 色觉友好（色盲 / 色弱）配色（用户 09-23 要求）。
 *
 * 标注默认 12 色是按「好看、在棋盘上都分得开」选的，但其中有一对在红绿色觉
 * 异常下几乎会糊成同一个颜色：**朱红 #b94b3f 与 松绿 #365e4b**。同样危险的还有
 * 金 #b27b18 与 棕 #6b4f3a（都偏黄褐）、莓红 #b04474 与 紫 #7b4fb3。
 *
 * 做法不是"换一套色卡"——那会让老棋谱里的颜色含义全乱。这里只把**需要区分度
 * 的那几档**沿明度轴拉开，并保留原有色相语义（朱红仍是红、松绿仍是绿），于是：
 *  · 同一个人在开/关这个开关前后，看得出"还是那些颜色"，只是更容易分辨；
 *  · 已经存在棋谱里的旧颜色值不受影响（颜色是随标注存进棋谱的，这里只改
 *    选择器提供的**可选色**与画布上的**显示兜底**）。
 *
 * 除标注色之外，还有两处红绿易混、但对理解局面更关键的颜色：
 *  · 最后一手标记（默认 #c94c40 红点）——红色盲看不出它和背景的区别；
 *  · 胜负线 / 获胜棋子环（#d63c34 / #ef5148）——赢线看不出等于结果看不出。
 * 这两处改成**蓝**系：蓝在红绿色觉异常下最可靠，且原本没有蓝色语义冲突
 * （标注蓝 #2872b8 是用户手动放的，胜负线是系统标记，位置也不重叠）。
 *
 * 存储与开关见 enhancement-settings 的 colorVisionFriendly；本模块保持纯数据 +
 * 纯函数，便于单测，也不依赖 React。
 */

/** 红绿色觉异常下最容易糊在一起的那几档，沿明度轴拉开后的替代值。 */
export const COLOR_VISION_FRIENDLY_COLORS: Readonly<Record<string, string>> = {
  // 朱红 → 提亮并推橙，与松绿彻底分开
  "#b94b3f": "#e2571f",
  // 松绿 → 压深并偏青，进一步远离红
  "#365e4b": "#145049",
  // 棕 → 提亮到明确的可可色，与金拉开
  "#6b4f3a": "#8a5a25",
  // 金 → 提亮，避免与棕同调
  "#b27b18": "#d9a300",
  // 莓红 → 偏洋红，与紫分开
  "#b04474": "#d61f77",
  // 紫 → 压深偏蓝
  "#7b4fb3": "#5b3fd6",
};

/** 开关键名（本机设置），供设置页与 App 共用，避免各处写字面量。 */
export const COLOR_VISION_SETTING_LABEL = "色觉友好配色";

/** 把一枚标注色换成色觉友好版本；没有对应替代值时原样返回。 */
export const friendlyAnnotationColor = (color: string): string =>
  COLOR_VISION_FRIENDLY_COLORS[color.toLowerCase()] ?? color;

/** 整份色板转换（选择器用；顺序与标签不变，只换色值）。 */
export const friendlyAnnotationPalette = <T extends readonly [string, string]>(palette: readonly T[]): Array<[string, string]> =>
  palette.map(([color, label]) => [friendlyAnnotationColor(color), label]);
