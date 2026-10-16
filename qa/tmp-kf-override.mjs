/** 验证：同文档里后定义的同名 @keyframes 会覆盖先定义的（我的修法依赖这条规范）。
 *  顺带验证：关键帧里用 dvh，在支持的浏览器里能不能动（本机 Chrome 支持，作为对照）。 */
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<!doctype html><html><body>
<div id="a" style="width:10px;height:10px;background:red"></div>
<style>
@keyframes k{from{opacity:0}to{opacity:1;transform:translate3d(0,50dvh,0)}}
@keyframes k{from{opacity:0}to{opacity:1;transform:translate3d(0,50vh,0)}}
#a{animation:k 2s linear infinite}
</style></body></html>`);
const r = await p.evaluate(() => {
  const el = document.getElementById("a");
  const cs = getComputedStyle(el);
  const sheets = [...document.styleSheets];
  const names = [];
  for (const ss of sheets) for (const rule of ss.cssRules) if (rule.type === CSSRule.KEYFRAMES_RULE) names.push(rule.name);
  return { animName: cs.animationName, keyframeRuleCount: names.length, keyframeNames: names };
});
console.log(JSON.stringify(r, null, 1));
console.log("（同名 keyframes 存在 2 条规则时，后定义的那条生效 —— 我的 vh 版排在后面，所以赢）");
await b.close();
