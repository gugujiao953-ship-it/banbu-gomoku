/**
 * **本地日期键**：`YYYY-MM-DD`。
 *
 * 为什么单独一个模块：这个格式在项目里被**手抄过 4 遍**
 * （`vcf-challenge/rating.ts`、`VcfChallengePage.tsx`、`duel/DuelStatsSheet.tsx`、
 * `progress/achievement-sources.ts`，另有 `AchievementsPanel` 一份等价写法）。
 * 四处都是同一句
 * `` `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` `` ——
 * 而它决定的键一旦不一致，"今日进度"就会**各算各的**（页面显示 3、成就判定读不到），
 * 正是本项目反复吃过的那一类（"两处各记一份"）。
 *
 * ## 为什么是**本地**日期而不是 UTC
 *
 * 用户说的"今天"是手机上的今天。用 `toISOString().slice(0, 10)` 会按 UTC 切日 ——
 * 在东八区，晚上 8 点之后就会被算成"明天"，于是"今天的进度"在夜里突然清零。
 * 所以这个函数**只用本地时间字段**（`getFullYear` / `getMonth` / `getDate`）。
 *
 * ## 为什么放在顶层而不是某个 feature 下
 *
 * 用到它的有 vcf-challenge、duel、progress 三块，互相之间没有依赖关系 ——
 * 放在任何一个 feature 里都会让另外两个"跨 feature 引用一个日期工具"，
 * 那种引用迟早会让人觉得别扭、然后再抄一份。它零依赖，和 `game.ts` 同级最合适。
 */

/** 取某个时刻的本地日期键（默认现在）。 */
export const localDateKey = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
