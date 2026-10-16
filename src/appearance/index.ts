/* ⚠ 生成文件，别手改：改外观请改 预览/skins/ 里对应那份，然后跑
   node scripts/sync-appearance-materials.mjs
   正文与实验室源保持逐字一致，只有 window.SKINS 的挂法换成了模块内数组。 */
// @ts-nocheck —— 实验室那边是无构建步骤的裸 JS；类型契约见 src/appearance/types.ts

import type { Skin } from "./types";

import { SKINS as SK_app_materials } from "./materials/app-materials";
import { SKINS as SK_blues } from "./materials/blues";
import { SKINS as SK_bronze_verdigris } from "./materials/bronze-verdigris";
import { SKINS as SK_colored_pencil } from "./materials/colored-pencil";
import { SKINS as SK_gufeng } from "./materials/gufeng";
import { SKINS as SK_illustrated_handmade } from "./materials/illustrated-handmade";
import { SKINS as SK_illustrated_indie } from "./materials/illustrated-indie";
import { SKINS as SK_illustrated_print } from "./materials/illustrated-print";
import { SKINS as SK_jade_glass } from "./materials/jade-glass";
import { SKINS as SK_lab_stones } from "./materials/lab-stones";
import { SKINS as SK_ripple } from "./materials/ripple";
import { SKINS as SK_theme_animation_rest } from "./materials/theme-animation-rest";
import { SKINS as SK_theme_dunhuang } from "./materials/theme-dunhuang";
import { SKINS as SK_theme_soul } from "./materials/theme-soul";
import { SKINS as SK_theme_tiexian } from "./materials/theme-tiexian";
import { SKINS as SK_verdant } from "./materials/verdant";
import { SKINS as SK_walnut_wood } from "./materials/walnut-wood";

/** 实验室 loader.js 的 KEEP —— 只有名单里的外观上架。 */
export const KEEP = [
  "app-wood",
  "app-classic",
  "app-amberboard",
  "app-flatstone",
  "pencil-forest",
  "pencil-berry",
  "blue-midnight",
  "blue-enamel",
  "verdant-pine",
  "ripple-onsen",
  "gu-xuanzhi",
  "gu-meihua",
  "tx-zhusha",
  "hard-08",
  "indie-hyperlight-dusk",
  "indie-monument-ink",
  "indie-spire-day",
  "print-woodengrave",
  "naive-papercut",
  "dh-feitian",
  "soul-inkflame",
  "bronze",
  "app-jade",
  "app-notebook",
  "app-porcelain",
  "app-blackgold",
  "app-pale",
  "app-kawaii",
  "app-aurora",
  "app-emerald",
  "app-whitejade",
  "app-walnut",
  "app-circuit",
  "app-minimal",
  "app-yun",
  "app-ink",
  "app-mono",
  "app-snow",
  "app-terminal",
  "app-diamond",
  "app-golddiamond"
];

const SKINS_BY_FILE: Skin[] = [...SK_app_materials, ...SK_blues, ...SK_bronze_verdigris, ...SK_colored_pencil, ...SK_gufeng, ...SK_illustrated_handmade, ...SK_illustrated_indie, ...SK_illustrated_print, ...SK_jade_glass, ...SK_ripple, ...SK_theme_animation_rest, ...SK_theme_dunhuang, ...SK_theme_soul, ...SK_theme_tiexian, ...SK_verdant, ...SK_walnut_wood];
/** 手工零件（大漆、敦煌候选·联珠莲瓣）：不走 KEEP 过滤，实验室也是先过滤再追加。 */
const HANDMADE: Skin[] = [...SK_lab_stones];

/** 上架的全部皮肤，按 KEEP 的顺序。名单里写了但库里没有的 id 会被丢掉，
 *  由 appearance.test.ts 那条"KEEP 每个 id 都要找得到"的断言兜住。 */
export const SKINS: Skin[] = [
  ...KEEP.map((id) => SKINS_BY_FILE.find((s) => s.id === id)).filter(Boolean) as Skin[],
  ...HANDMADE,
];
