/** 离线自测：不连真机，只验证 android-bridge 的辅助逻辑（byText / 选择器）在浏览器里成立。 */
import { chromium } from "playwright";
import { HELPERS } from "./android-bridge.mjs";

const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<button>外观与音效</button><button>主题 跟随系统</button><button disabled>禁用项</button>
<div class="moves-row"><button class="accent"><svg width="18" height="18"></svg><span>下一手</span></button></div>`);
const hit = await p.evaluate(`(() => { ${HELPERS}
  const a = __bbq.byText("外观与音效");
  const c = __bbq.byText("下一手");
  const d = __bbq.byText("禁用项");
  return {
    命中外观: a ? a.textContent : null,
    命中下一手: c ? c.className : null,
    跳过禁用: d === null,
    按部分文字: __bbq.byText("跟随系统") ? "ok" : "fail",
  };
})()`);
console.log(JSON.stringify(hit, null, 1));
await b.close();
if (!hit.命中外观 || !hit.跳过禁用 || hit.按部分文字 !== "ok") { console.error("✗ 自测失败"); process.exit(1); }
console.log("✓ 调试桥辅助逻辑自测通过");
