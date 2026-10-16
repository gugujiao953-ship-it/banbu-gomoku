/** 主题动效开关（用户 2026-10-09 反馈 K20 上"主题只有颜色、没有动效"）。
 *
 *  背景：主题里的装饰动画（花瓣飘落、黄昏骑行蹬车、极光流动…）被这条规则统一停掉——
 *    `@media(prefers-reduced-motion:reduce){ .theme-scene *{animation:none!important} }`
 *  这条规则本身是对的（尊重系统的"减少动态效果"）。问题是**老 Android WebView（K20 实测）
 *  常年把它误报成 reduce**，于是那台机器上所有主题动效都不播，用户看到的只有静态颜色。
 *
 *  取舍：主题动画是**纯背景装饰**、不承载任何操作反馈（按钮/弹窗那类动效仍严格尊重系统设置）。
 *  所以给它一个独立开关，**默认开**：
 *    · 默认开 → K20 这种误报机器上也能看到动效（用户要的就是这个）；
 *    · 仍然可关 → 真需要减少动效的人（或想省电）能一键停掉；
 *    · 与既有的「无障碍与反馈 → 界面动效」并存：那个是总闸（关掉时主题动效也停），
 *      这个是主题装饰的单独闸门。
 *
 *  实现：真值写在 <html> 的 `data-theme-motion` 上（"on"/"off"），
 *  styles.css 里那条 reduce 规则用 `:root[data-theme-motion="on"]` 重新启用。
 *  与 `motion-settings.ts`（界面动效总闸，写 `data-motion`）是两条独立的线。 */
export const THEME_MOTION_KEY = "banbu-theme-motion-v1";
/** 默认开：见文件头说明（K20 的误报是这次加它的直接原因）。 */
export const DEFAULT_THEME_MOTION = true;

export const loadThemeMotion = (): boolean => {
  try {
    const raw = localStorage.getItem(THEME_MOTION_KEY);
    if (raw === null) return DEFAULT_THEME_MOTION;
    return raw !== "off" && raw !== "false" && raw !== "0";
  } catch {
    return DEFAULT_THEME_MOTION;
  }
};

export const saveThemeMotion = (value: boolean) => {
  try { localStorage.setItem(THEME_MOTION_KEY, value ? "on" : "off"); } catch { /* optional preference */ }
};
