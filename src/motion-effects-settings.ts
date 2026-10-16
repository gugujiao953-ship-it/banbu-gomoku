/** 公用效果的持久化设置：落子交互（place）+ 棋子进场（drop）各一个总开关 + 方案 id。
 *
 *  与材质无关 —— 换任何棋盘/棋子都不改这两项，所以独立于 `boardTheme`/`stoneTheme`
 *  存在自己的 storage key 里。写法照 `src/motion-settings.ts`：
 *  load/save + 默认值 + 非法值归一化。
 *
 *  ⚠ id 找不到（改名/删方案/存档来自旧版本）时必须**回落到列表第一套**，
 *    不能因为一个坏 id 就崩或空白。列表本身从 `src/appearance/effects.ts` 读，
 *    所以两边永远对得上。 */
import { DROP_EFFECTS, PLACE_EFFECTS, type EffectScheme } from "./appearance/effects";

export const MOTION_EFFECTS_SETTINGS_KEY = "banbu-motion-effects-v1";

export interface MotionEffectsSettings {
  /** 落子交互总开关 */
  placeOn: boolean;
  /** 落子交互方案 id */
  placeId: string;
  /** 棋子进场总开关 */
  dropOn: boolean;
  /** 棋子进场方案 id */
  dropId: string;
}

/** 两套公用效果**默认关**（用户 10-02：「我们的公用动效应该默认是关闭的吧，不是的话就默认关闭」）——
 *  它们是可选的装饰，不该由我们替新用户打开。`placeId`/`dropId` 保持原方案不变：
 *  开关一开就是这套默认方案，方案列表也照旧可换。
 *
 *  ⚠ 这次**不**把 key 升到 v2（对照 `src/motion-settings.ts:1-4` 的先例：那次 v1 的默认值是
 *  没初始化过的 `false`，老用户被卡在坏默认上，只能升 key 才能把他们捞出来）。
 *  情形不同：`banbu-motion-effects-v1` 存过的都是用户自己挑的值，升 key 等于静默丢掉他们的选择。
 *  只改默认值的效果正好是我们想要的——新装/清档拿到「关」，老用户保持自己原来的开关。 */
export const DEFAULT_MOTION_EFFECTS_SETTINGS: MotionEffectsSettings = {
  placeOn: false,
  placeId: "pl-ripple",
  dropOn: false,
  dropId: "dp-settle",
};

/** 关掉「棋子进场」（`dropOn: false`）后，落子**不播任何动画**——棋子瞬间出现。
 *  以前这里会回落到应用内置的 `stone-enter`（140ms 的缩放弹一下），用户 10-04 判定它就是
 *  「看着卡」的来源，已连同 CSS 与 keyframes 一起删掉；三元在 `src/App.tsx` 里是
 *  `dropEffect ? dropEffect.id : ""`。所以「棋子进场」现在是落子动画的唯一来源。 */

const firstId = (list: EffectScheme[], fallback: string) => list[0]?.id ?? fallback;

/** 按 id 取方案；找不到回落第一套（列表为空才用 fallbackId）。 */
export const findPlaceEffect = (id: string): EffectScheme =>
  PLACE_EFFECTS.find((scheme) => scheme.id === id)
  ?? PLACE_EFFECTS[0]
  ?? { id, name: id, desc: "", css: () => "" };

export const findDropEffect = (id: string): EffectScheme =>
  DROP_EFFECTS.find((scheme) => scheme.id === id)
  ?? DROP_EFFECTS[0]
  ?? { id, name: id, desc: "", css: () => "" };

const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
/** 只有 id 真的在列表里才认，否则回落第一套。 */
const knownId = (value: unknown, list: EffectScheme[], fallback: string) =>
  typeof value === "string" && list.some((scheme) => scheme.id === value) ? value : firstId(list, fallback);

export const normalizeMotionEffectsSettings = (value: unknown): MotionEffectsSettings => {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<MotionEffectsSettings>;
  return {
    placeOn: bool(raw.placeOn, DEFAULT_MOTION_EFFECTS_SETTINGS.placeOn),
    placeId: knownId(raw.placeId, PLACE_EFFECTS, DEFAULT_MOTION_EFFECTS_SETTINGS.placeId),
    dropOn: bool(raw.dropOn, DEFAULT_MOTION_EFFECTS_SETTINGS.dropOn),
    dropId: knownId(raw.dropId, DROP_EFFECTS, DEFAULT_MOTION_EFFECTS_SETTINGS.dropId),
  };
};

export const loadMotionEffectsSettings = (): MotionEffectsSettings => {
  try {
    return normalizeMotionEffectsSettings(JSON.parse(localStorage.getItem(MOTION_EFFECTS_SETTINGS_KEY) || "null"));
  } catch {
    return { ...DEFAULT_MOTION_EFFECTS_SETTINGS };
  }
};

export const saveMotionEffectsSettings = (settings: MotionEffectsSettings) => {
  try {
    localStorage.setItem(MOTION_EFFECTS_SETTINGS_KEY, JSON.stringify(normalizeMotionEffectsSettings(settings)));
  } catch { /* storage can be unavailable */ }
};
