import { useLayoutEffect, useRef, type CSSProperties } from "react";

/**
 * SVG 里用 HTML 字符串注入内容（材质盘面 / defs / 棋子）的稳定宿主。
 *
 * React 19 在**每次提交都会重写 dangerouslySetInnerHTML** —— 实测连字符串一模一样
 * 也会写（2026-10-03 探针：点一下棋盘，g.board-material 被重写、子节点整批换新，
 * 而写入值前后完全相同）。后果两类：
 *  ① 带 @keyframes 的材质盘（尊贵黑金 / 苍白世界 / 极光）每点一下所有循环动画从头播 ——
 *     用户报的「点一下卡一下、棋盘动态重播」就是这个；
 *  ② 每颗材质棋子每次渲染重解析一遍 SVG 字符串（落子时的卡顿感）。
 * 改成 ref + useLayoutEffect，内容真的变了才写 —— 与 head 里那两条动效 <style>、
 * 实验室 applyMotionCss 的 `if (el.textContent !== next)` 是同一个套路。
 */
export function SvgHtml({ tag, html, className, style }: {
  tag: "g" | "defs";
  html: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<SVGGElement & SVGDefsElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);
  if (tag === "defs") return <defs ref={ref} className={className} style={style} />;
  return <g ref={ref} className={className} style={style} />;
}
