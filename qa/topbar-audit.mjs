import { chromium } from "playwright";
/* 顶栏/折叠按钮的横切审计：主题 × 视口 × 折叠态 × 标签页 × 模拟刘海。
   只报"量出来的异常"，不做主观评价。 */
const b = await chromium.launch({ headless: true });
const bad = [];
const note = (s) => console.log(s);
const open = async (vp) => {
  const ctx = await b.newContext({ viewport: vp });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
  await p.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(4200);
  for (const t of ["先自己试试", "跳过"]) {
    await p.evaluate((l) => {
      const el = [...document.querySelectorAll("button,[role=button]")].find((e) => (e.textContent || "").trim() === l && e.getBoundingClientRect().width > 0);
      el?.click();
    }, t);
    await p.waitForTimeout(600);
  }
  return { ctx, p, errs };
};
const probe = (p) => p.evaluate(() => {
  const tg = document.querySelector(".chrome-collapse-toggle");
  const bar = document.querySelector(".topbar");
  const de = document.documentElement;
  if (!tg || !bar) return { err: "没找到折叠按钮或顶栏" };
  const r = (el) => el.getBoundingClientRect();
  const cs = getComputedStyle(tg);
  // 顶栏内任一可见子项的底边是否越出顶栏底边（纵向溢出）
  const kids = [...bar.children].filter((k) => getComputedStyle(k).visibility !== "hidden" && getComputedStyle(k).display !== "none");
  const over = kids.some((k) => r(k).bottom > r(bar).bottom + 1);
  return { x: Math.round(r(tg).x), w: Math.round(r(tg).width), h: Math.round(r(tg).height),
    barH: Math.round(r(bar).height), over,
    横向溢出: de.scrollWidth > de.clientWidth + 1,
    按钮色: cs.color, 按钮底色: cs.backgroundColor, 边框色: cs.borderTopColor,
    图标数: tg.querySelectorAll("svg").length, 文字: tg.textContent.trim(),
    折叠态: document.querySelector(".app-shell").className.includes("chrome-collapsed") };
});
// ── ① 各视口 × 展开/收起 ──
const VPS = [[320, 568, "小屏320"], [360, 740, "常见360"], [430, 900, "大屏430"], [900, 500, "横屏900x500"], [820, 1180, "平板竖820"], [1180, 820, "平板横1180"]];
for (const [w, h, name] of VPS) {
  const { ctx, p, errs } = await open({ width: w, height: h });
  const a = await probe(p);
  await p.evaluate(() => document.querySelector(".chrome-collapse-toggle")?.click());
  await p.waitForTimeout(700);
  const c = await probe(p);
  const dx = a.x !== undefined && c.x !== undefined ? c.x - a.x : null;
  const ok = a.over === false && c.over === false && a.横向溢出 === false && c.横向溢出 === false
    && Math.abs(dx ?? 99) <= 3 && a.图标数 === 1 && a.文字 === "";
  if (!ok) bad.push(`${name} 视口异常`);
  note(`${ok ? "PASS" : "FAIL"} ${name.padEnd(12)} 展开[x${a.x} 顶栏${a.barH} 溢出${a.over}] 收起[x${c.x} 顶栏${c.barH} 溢出${c.over} 横向溢出${c.横向溢出}] 位移${dx} 图标${a.图标数} 文字"${a.文字}"`);
  if (errs.length) { bad.push(name + " 页面错误"); note("   ⚠ 页面错误: " + errs[0]); }
  await ctx.close();
}
// ── ② 全主题下的可见性/对比 ──
{
  const { ctx, p } = await open({ width: 430, height: 900 });
  const themes = await p.evaluate(() => (document.querySelector(".app-shell")?.getAttribute("data-theme-options") || "").split(/\s+/).filter(Boolean));
  note(`\n主题数：${themes.length}`);
  for (const th of themes) {
    await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, th);
    await p.waitForTimeout(120);
    const r = await p.evaluate(() => {
      const tg = document.querySelector(".chrome-collapse-toggle");
      const cs = getComputedStyle(tg);
      const lum = (c) => { const m = c.match(/\d+/g); if (!m) return null; const [R, G, B] = m.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * R + .7152 * G + .0722 * B; };
      const a = lum(cs.color), b2 = lum(cs.backgroundColor);
      return { c: cs.color, bg: cs.backgroundColor, 对比: a !== null && b2 !== null ? +((Math.max(a, b2) + .05) / (Math.min(a, b2) + .05)).toFixed(2) : null, dis: cs.display };
    });
    if (r.dis === "none") bad.push(`主题 ${th}: 按钮不显示`);
    else if (r.对比 !== null && r.对比 < 3) bad.push(`主题 ${th}: 图标/底色对比仅 ${r.对比}`);
  }
  note("主题对比检查完成（<3:1 的已计入问题）");
  await ctx.close();
}
// ── ③ 各标签页 ──
{
  const { ctx, p, errs } = await open({ width: 430, height: 900 });
  for (const tab of ["打谱", "棋谱库", "对弈", "设置"]) {
    await p.evaluate((t) => {
      const el = [...document.querySelectorAll("button,[role=button]")].find((e) => (e.textContent || "").trim() === t && e.getBoundingClientRect().width > 0);
      el?.click();
    }, tab);
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => {
      const tg = document.querySelector(".chrome-collapse-toggle");
      const bar = document.querySelector(".topbar");
      if (!tg) return { err: "按钮不存在" };
      return { x: Math.round(tg.getBoundingClientRect().x), 顶栏: Math.round(bar.getBoundingClientRect().height),
        溢出: [...bar.children].filter((k) => getComputedStyle(k).visibility !== "hidden").some((k) => k.getBoundingClientRect().bottom > bar.getBoundingClientRect().bottom + 1) };
    });
    if (r.err || r.溢出) bad.push(`标签页 ${tab}: ${r.err || "顶栏溢出"}`);
    note(`标签「${tab}」 按钮x=${r.x} 顶栏高=${r.顶栏} 溢出=${r.溢出}`);
  }
  if (errs.length) { bad.push("切标签页有页面错误"); note("⚠ " + errs[0]); }
  await ctx.close();
}
// ── ④ 模拟刘海（可用高度 21px）──
{
  const { ctx, p } = await open({ width: 430, height: 900 });
  await p.addStyleTag({ content: ".topbar{--topbar-usable:21px!important;padding-top:47px!important}" });
  await p.waitForTimeout(400);
  const r = await probe(p);
  const mode = await p.evaluate(() => {
    const t = document.querySelector(".topbar-mode-toggle");
    const bar = document.querySelector(".topbar");
    return { 溢出错位: t ? Math.round(t.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom) : null,
      文字可见: t ? [...t.querySelectorAll("span")].some((s) => s.getBoundingClientRect().width > 0) : null,
      按钮高: t ? Math.round(t.querySelector("button").getBoundingClientRect().height) : null };
  });
  note(`\n模拟刘海：折叠按钮 溢出${r.over} · 分段控件 底边越出${mode.溢出错位}px · 按钮高${mode.按钮高} · 文字仍可见=${mode.文字可见}`);
  if (mode.溢出错位 > 1) bad.push("刘海模拟：分段控件仍溢出");
  if (mode.文字可见) bad.push("刘海模拟：文字未隐藏（纯图标未生效）");
  await ctx.close();
}
await b.close();
console.log(bad.length ? `\n✗ ${bad.length} 项问题：\n - ` + bad.join("\n - ") : "\n✓ 全部通过");
process.exit(bad.length ? 1 : 0);
