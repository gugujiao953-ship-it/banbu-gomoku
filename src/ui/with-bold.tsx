import type { ReactNode } from "react";

/**
 * 正文里的 `**粗体**` → `<b>`。
 *
 * 数据侧从 09-17 起就一直在用 Markdown 的星号写法（手册各章、更新内容条目都是），
 * 但渲染层从来没有解析过 ⇒ 用户读到的是字面星号。用户 09-26 对手册点过一次名
 * （「把正文里的 **粗体** 渲染成加粗，而不是把星号露给用户」），这次是「关于 → 本版本
 * 更新内容」那一页犯同一个毛病，所以把解析收成一个共用的最小实现，两边都走它。
 *
 * 只做**成对**的 `**`：落单（奇数个）时原样返回，绝不吞字。
 */
export const withBold = (text: string): ReactNode => {
  const parts = text.split("**");
  if (parts.length % 2 === 0) return text;
  return parts.map((part, index) => index % 2 ? <b key={index}>{part}</b> : part);
};
