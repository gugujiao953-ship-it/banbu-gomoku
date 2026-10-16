import { chromium } from "playwright";

/**
 * 落子动效与棋盘触摸反馈门禁。
 *
 * 守六件事：
 *  A. **「界面动效」关掉就是真的没有动效**：落一手后 document.getAnimations() 里不许再有
 *     任何动画（此前用户报「关了界面动效还是像在卡」——实测动画本来就停了，真正的延迟是
 *     dev 构建的 React 开发模式开销，见 scripts/probe-board-placement-latency.mjs；
 *     但这条断言要一直守着，防止哪天又有新动画漏掉 data-motion 关断）。
 *  B. **落子不再弹一下**（内置 stone-enter 已删）；红点 last-dot-settle ≤240ms（原先 220ms/480ms
 *     且回弹到 1.4 倍，落一手画面要动半秒，被反馈「看起来像卡」）。
 *  C. **点棋盘不许出现蓝框**：WebView/移动 Chrome 的默认 tap 高亮是 rgba(51,181,229,.4) 的
 *     半透明蓝，画在 <circle> 上就是「棋子被一个正方形蓝框包住一瞬间」；棋盘必须显式关掉它，
 *     并且关掉文字选择（user-select）。分支树画布同理。
 *  D. **落子不许重播棋盘材质动效**（10-03 复发的「点一下卡一下，棋盘动态重新开始」）：
 *     盘底材质层必须还是同一批 DOM 节点、`bd-*`/`bmo-*` 不许有新的 animationstart、
 *     #material-motion-css 不许被重写。React 19 每次提交都重写 dangerouslySetInnerHTML，
 *     所以材质层走 src/appearance/svg-html.tsx 的 SvgHtml（内容没变就不碰 innerHTML）。
 *  E. **撤销/回退这类「光标自己动」的路径不许给已经在场上的棋子重播落子动画**：
 *     进场动画属于「那一次落子」，只跟着 motion.at 指向的节点。
 *  F. **带伴随特效的棋子进场要真的出现、并且播完自删**（dp-spin/dp-squash/dp-fall/dp-spiral
 *     各有一段插在棋子下面的特效；曾经只挂了子的动画类，伴随特效从没被 spawn 过）。
 *  G. **连点时特效的渐变必须每手一份 id**（同名 `<radialGradient>` 重复出现，前一份自删后
 *     后一份的 `url(#…)` 会指空，正在飞的墨点/爆闪会整块看不见）。
 */
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const qaURL = new URL(baseURL); qaURL.searchParams.set("qa", "1");
// 关掉界面动效的那一轮走 URL 参数：addInitScript 每次导航都会重跑并清 localStorage，
// 直接改 localStorage 再 reload 会被自己的 seed 抹掉（第一版就这么假失败过）。
const motionOffURL = new URL(qaURL); motionOffURL.searchParams.set("motion", "off");
const browser = await chromium.launch({ headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const metadata = { title: "落子动效门禁", black: "黑方", white: "白方", event: "门禁", date: "2026-09-18", result: "", rule: "renju", openingRule: "free", boardSize: 15, tags: [] };
const active = {
  id: "board-motion-gate", version: 1, rootId: "root", savedCurrentId: "m1",
  createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", metadata,
  nodes: {
    root: { id: "root", parentId: null, children: ["m1"], preferredChildId: "m1", move: null, comment: "", marks: [] },
    m1: { id: "m1", parentId: "root", children: [], move: { row: 7, col: 7, player: "black" }, comment: "", marks: [] },
  },
};
const seed = ({ document: doc }) => {
  localStorage.clear();
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("renju-note-active-v1", JSON.stringify(doc));
  localStorage.setItem("renju-note-library-v1", JSON.stringify([doc]));
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ gestureZoom: false, gestureSwipe: false, recentImports: false, aiBoardHints: false, coachMarks: false }));
  // 关掉手数，最后一手才会画成红点（.last-dot）——它的动效时长也要守。
  localStorage.setItem("renju-note-display-settings-v1", JSON.stringify({ showNumbers: false, showCoordinates: true, showForbidden: true, showLastMove: true }));
  if (new URL(location.href).searchParams.get("motion") === "off") localStorage.setItem("banbu-motion-enabled-v2", "false");
  /* 材质巡查用 URL 参数选装载哪些外观/公用效果（addInitScript 每次导航都会重跑，
     中途改 localStorage 再 reload 会被上面这条 seed 抹掉）。 */
  const params = new URL(location.href).searchParams;
  if (params.get("material")) {
    localStorage.setItem("banbu-board-theme-v1", "app-blackgold");
    // ?stoneMotion=1 换上一枚**自带**动效的棋子皮肤（app-aurora 有 bmo-app-aurora-shift），
    // 用来钉「棋子的自带动效不注入」这一半（用户 10-04：只去掉棋子本体的动态效果，棋盘保留）。
    localStorage.setItem("banbu-stone-theme-v1", params.get("stoneMotion") ? "app-aurora" : "app-jade");
  }
  if (params.get("effects")) {
    const [placeId, dropId] = params.get("effects").split(",");
    localStorage.setItem("banbu-motion-effects-v1", JSON.stringify({ placeOn: true, placeId, dropOn: true, dropId }));
  }
  // 动画起跑流水：循环类动效「重播」只体现在 animationstart 上（getAnimations() 里
  // 常驻动画一直都在，看不出重播），所以这里从 document-start 就记。
  window.__anims = [];
  document.addEventListener("animationstart", (event) => { window.__anims.push(String(event.animationName)); }, true);
};

/** 落一手后立刻取样：跑了哪些动画、棋盘触摸反馈属性是什么。 */
const sample = (page) => page.evaluate(() => {
  const board = document.querySelector(".renju-board");
  const hit = document.querySelector(".board-hit");
  const canvas = document.querySelector(".tree-canvas");
  const read = (element, property) => element ? getComputedStyle(element).getPropertyValue(property) : "";
  return {
    animations: document.getAnimations().map((animation) => ({
      name: animation.animationName || "(transition)",
      target: animation.effect?.target?.getAttribute?.("class") || "",
      duration: animation.effect?.getComputedTiming?.().duration,
    })),
    stoneClasses: [...document.querySelectorAll(".stone-piece")].map((stone) => stone.getAttribute("class") || ""),
    htmlMotion: document.documentElement.dataset.motion || "(unset)",
    boardTapHighlight: read(board, "-webkit-tap-highlight-color"),
    hitTapHighlight: read(hit, "-webkit-tap-highlight-color"),
    boardUserSelect: read(board, "user-select"),
    canvasTapHighlight: canvas ? read(canvas, "-webkit-tap-highlight-color") : "(no tree open)",
  };
});

const openApp = async (page, motionOff = false) => {
  await page.goto(motionOff ? motionOffURL.href : qaURL.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".renju-board", { timeout: 30_000 });
  await page.waitForTimeout(700);
};

try {
  const results = [];
  for (const item of [{ name: "desktop", width: 1280, height: 900, mobile: false }, { name: "mobile", width: 390, height: 844, mobile: true }]) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, isMobile: item.mobile, hasTouch: item.mobile, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    await page.addInitScript(seed, { document: active });
    await openApp(page);

    // A + C：开着动效时，落一手应当只有「短」的落子动效，且棋盘不带 tap 高亮
    const rest = await sample(page);
    assert(rest.boardTapHighlight === "rgba(0, 0, 0, 0)", `${item.name} 棋盘仍带 tap 高亮：${rest.boardTapHighlight}（会画成蓝框）`);
    assert(rest.hitTapHighlight === "rgba(0, 0, 0, 0)", `${item.name} 落点热区仍带 tap 高亮：${rest.hitTapHighlight}`);
    assert(rest.boardUserSelect === "none", `${item.name} 棋盘没有关掉文字选择：${rest.boardUserSelect}`);
    assert(rest.htmlMotion === "on", `${item.name} 默认应为「界面动效」开启：${rest.htmlMotion}`);

    await page.locator(".board-hit").nth(40).click({ force: true });
    const placing = await sample(page);
    // 内置的「落子弹一下」已按用户 10-04 的决定删掉：没开「棋子进场」时，落子不该有任何动画。
    assert(!placing.animations.some((animation) => animation.name === "stone-enter"), `${item.name} 落子又弹了一下（内置 stone-enter 应已移除）`);
    assert(!placing.stoneClasses.some((value) => value.includes("stone-enter")), `${item.name} 刚落的那枚棋子又带上了内置进场类`);
    const lastDot = placing.animations.find((animation) => animation.name === "last-dot-settle");
    assert(lastDot, `${item.name} 最后一手红点没有动效（取样落空，门禁会失去意义）：${JSON.stringify(placing.animations)}`);
    assert(Number(lastDot.duration) <= 240, `${item.name} 最后一手红点动效过长：${lastDot.duration}ms`);

    // A：关掉「界面动效」后，落一手不许有任何动画
    await openApp(page, true);
    const off = await sample(page);
    assert(off.htmlMotion === "off", `${item.name} 关掉界面动效后 data-motion 不是 off：${off.htmlMotion}`);
    await page.locator(".board-hit").nth(44).click({ force: true });
    const offPlacing = await sample(page);
    assert(offPlacing.animations.length === 0, `${item.name} 关掉界面动效后仍有动画在跑：${JSON.stringify(offPlacing.animations)}`);
    assert(!offPlacing.stoneClasses.some((value) => value.includes("stone-enter")), `${item.name} 关掉界面动效后新棋子仍带落子动效类`);
    assert(offPlacing.boardTapHighlight === "rgba(0, 0, 0, 0)", `${item.name} 关掉动效后棋盘 tap 高亮变了：${offPlacing.boardTapHighlight}`);

    // C：分支树画布同样不许有 tap 高亮（同一类蓝框）
    await page.getByRole("button", { name: "打开分支树" }).click().catch(async () => {
      await page.getByRole("button", { name: "行棋" }).click();
      await page.getByRole("button", { name: "打开分支树" }).click();
    });
    await page.waitForSelector(".tree-canvas", { timeout: 20_000 });
    const withTree = await sample(page);
    assert(withTree.canvasTapHighlight === "rgba(0, 0, 0, 0)", `${item.name} 分支树画布仍带 tap 高亮：${withTree.canvasTapHighlight}`);

    // D/E/F（用户 10-03 巡查出来的两个真 bug，各钉一条）：
    //  D. 材质动效棋盘**落子时不许重播**。React 19 每次提交都会重写 dangerouslySetInnerHTML，
    //     于是盘底材质层整段重挂、`bd-*`/`bmo-*` 循环动画从 0 重来 —— 实测就是用户报的
    //     「点一下卡一下，然后棋盘动态重新开始」。现在走 SvgHtml（只在内容真的变了才写 innerHTML），
    //     这条断言用「节点同一 + 循环动画没有新的 animationstart + 样式表没被重写」三向来钉。
    //  E. **撤销不许让已经在场上的那颗子再弹一次落子动画**。进场类原来只看 `isLast`，
    //     而撤销这条路径不落子、不改 motion.version，光标退回老子 → 老子被套上 place 态的
    //     类名并重挂 → `stone-enter`/`dp-*` 又播一遍。
    //  F. 带伴随特效的「棋子进场」（dp-spin 拖尾 / dp-squash 冲击环 / dp-fall 扬尘 /
    //     dp-spiral 螺旋）必须真的把特效插进棋盘，并且播完自删。
    const materialURL = new URL(qaURL.href);
    materialURL.searchParams.set("material", "1");
    materialURL.searchParams.set("effects", "pl-ink,dp-fall");
    await page.goto(materialURL.href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".board-material", { timeout: 20_000 });
    await page.waitForTimeout(700);
    // 棋盘自带的动效仍应注入（用户 10-04：只去掉棋子本体的动效）。
    assert(await page.evaluate(() => Boolean(document.querySelector(".board-material-surface style[data-material-motion]"))), `${item.name} 棋盘的自带动效样式表没注入（不该一起砍掉）`);

    const stage = await page.evaluate(() => {
      window.__anims = [];
      const mat = document.querySelector(".board-material");
      window.__mat = mat;
      window.__matKids = [...mat.children];
      window.__stones = [...document.querySelectorAll(".material-stone")];
      window.__cssWrites = 0;
      const css = document.querySelector(".board-material-surface style[data-material-motion]");
      // 样式表现在不该存在；万一被注回来，这里照样盯住它有没有被重写（重写会让在跑的 @keyframes 从 0 重来）。
      if (css) new MutationObserver((records) => { window.__cssWrites += records.length; }).observe(css, { childList: true, characterData: true, subtree: true });
      return { kids: window.__matKids.length, stones: window.__stones.length };
    });
    assert(stage.stones > 0, `${item.name} fixture 里应有材质棋子`);
    await page.locator(".board-hit").nth(52).click({ force: true });
    await page.waitForTimeout(260);
    const companion = await page.evaluate(() => ({
      // dp-fall 的伴随特效是插进 #board 的一层 g[pointer-events=none]，里面的元素带
      // `-d`/`-p` 派生类名。必须按**这个方案自己的类名**找：`#board > g[pointer-events="none"]`
      // 会被同时开着的落子交互（pl-ripple 也插一层 g）满足，负验证时它就假 PASS 过。
      dropParts: document.querySelectorAll('#board g[pointer-events="none"] [class*="dp-fall-"]').length,
      effectWrappers: document.querySelectorAll('#board > g[pointer-events="none"]').length,
    }));
    await page.waitForTimeout(500);
    await page.locator(".board-hit").nth(53).click({ force: true });
    await page.waitForTimeout(240);
    const placed = await page.evaluate(() => {
      const mat = document.querySelector(".board-material");
      const now = [...document.querySelectorAll(".material-stone")];
      const seen = new Map();
      for (const el of document.querySelectorAll("#board [id]")) seen.set(el.id, (seen.get(el.id) || 0) + 1);
      return {
        loop: window.__anims.filter((name) => name.startsWith("bd-") || name.startsWith("bmo-")),
        started: window.__anims.slice(),
        cssWrites: window.__cssWrites,
        matSame: mat === window.__mat,
        kidsSame: mat.children.length === window.__matKids.length && [...mat.children].every((kid, i) => kid === window.__matKids[i]),
        survivors: now.filter((stone) => window.__stones.includes(stone)).length,
        dupeIds: [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`),
      };
    });
    assert(placed.matSame && placed.kidsSame, `${item.name} 落子把盘底材质层整段重挂了（循环动效必然从头重播）`);
    assert(placed.loop.length === 0, `${item.name} 落子时棋盘循环动效重播了：${placed.loop.join(", ")}`);
    assert(placed.cssWrites === 0, `${item.name} 落子时重写了 #material-motion-css（在跑的 @keyframes 会从 0 重来）`);
    assert(placed.survivors === stage.stones, `${item.name} 落子时旧的材质棋子被重挂：${placed.survivors}/${stage.stones} 幸存`);
    assert(placed.started.some((name) => name.startsWith("pl-") || name.startsWith("dp-")), `${item.name} 公用效果开了却一帧动画都没播：${JSON.stringify(placed.started)}`);
    assert(companion.dropParts >= 1, `${item.name} dp-fall 的落地扬尘没插进棋盘（方案说明写着「落地扬尘」，实盘必须真有；特效层数=${companion.effectWrappers}）`);
    // G. 连点两下（间隔小于动画时长）时，特效自带的径向渐变必须**每手一份 id**。
    //    过去固定 `${id}-g`，两份同名 defs 同时在场，后一份解析到前一份；前一份随它自己的
    //    特效组自删 → 还在飞的那滴墨可能整块看不见（而且重复 id 本身就是非法文档状态）。
    assert(placed.dupeIds.length === 0, `${item.name} 连点后 #board 里出现重复 id：${placed.dupeIds.join(", ")}`);

    await page.waitForTimeout(2400);
    const settled = await page.evaluate(() => document.querySelectorAll('#board > g[pointer-events="none"]').length);
    assert(settled === 0, `${item.name} 特效元素动画跑完没自删，残留 ${settled} 个节点（连下 100 手就堆 100 个）`);

    // E：撤销之后，场上已经在的那两枚子必须「一动都不播」
    const beforeUndo = await page.evaluate(() => {
      window.__stones2 = [...document.querySelectorAll(".stone-piece")];
      window.__anims = [];
      const button = [...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") || "") === "撤销编辑");
      if (!button || button.disabled) return null;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return window.__stones2.length;
    });
    assert(beforeUndo !== null, `${item.name} 撤销后「撤销编辑」按钮不可用（撤销重播那条断言失去意义）`);
    await page.waitForTimeout(500);
    const undone = await page.evaluate(() => ({
      anims: window.__anims.slice(),
      survivors: [...document.querySelectorAll(".stone-piece")].filter((stone) => window.__stones2.includes(stone)).length,
    }));
    const replay = undone.anims.filter((name) => name === "stone-enter" || name.startsWith("dp-") || name.startsWith("pl-"));
    assert(replay.length === 0, `${item.name} 点撤销没有落子，却在场上那颗老子重播了落子动画：${replay.join(", ")}`);
    assert(undone.survivors === beforeUndo - 1, `${item.name} 撤销一枚子却把留下的棋子重挂了：${undone.survivors}/${beforeUndo - 1}`);

    // H. 皮肤自带的 infinite 动画不许在本体跑（用户 10-04：默认就该没有动效，动效只从「公用效果」来）。
    //    敦煌这类盘的 animation 写在皮肤 CSS 里、总开关管不到 → 静止不动也在每帧重绘整块盘，
    //    6 秒 98 帧、100% 掉帧、中位 129ms；过去只有系统 prefers-reduced-motion 能关）。
    // 先钉住这条不是空过：开着界面动效时这块盘**必须真的在跑循环动画**。
    const skinOn = await page.evaluate(() => document.getAnimations()
      .filter((anim) => anim.playState === "running")
      .map((anim) => anim.animationName || "?").filter((name) => name.startsWith("bd-") || name.startsWith("bmo-")));
    assert(skinOn.length > 0, `${item.name} 材质盘开着界面动效却没有循环动画在跑（H 这条就失去意义）：${skinOn.join(", ")}`);
    const materialOffURL = new URL(materialURL.href);
    materialOffURL.searchParams.set("motion", "off");
    await page.goto(materialOffURL.href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".board-material", { timeout: 20_000 });
    await page.waitForTimeout(900);
    const skinOff = await page.evaluate(() => ({
      motion: document.documentElement.dataset.motion,
      running: document.getAnimations().filter((anim) => anim.playState === "running").map((anim) => anim.animationName || anim.transitionProperty || "?"),
    }));
    assert(skinOff.motion === "off", `${item.name} 材质盘 fixture 没接上 motion=off：${skinOff.motion}`);
    assert(skinOff.running.length === 0, `${item.name} 关掉界面动效后皮肤自带动画仍在跑（静止也白烧帧）：${skinOff.running.slice(0, 6).join(", ")}`);
    // I. 棋子**自带**的动效不许注入本体（用户 10-04：只去掉棋子本体的动态效果，棋盘那些保留）。
    //    换上一枚自带 bmo-app-aurora-shift 的棋子皮肤，样式表里不该出现它的名字，
    //    而棋盘那半边的注入必须还在（否则这条断言会因为「整段都没注入」而假 PASS）。
    const stoneMotionURL = new URL(materialURL.href);
    stoneMotionURL.searchParams.set("stoneMotion", "1");
    await page.goto(stoneMotionURL.href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".board-material", { timeout: 20_000 });
    await page.waitForTimeout(900);
    const injected = await page.evaluate(() => document.querySelector(".board-material-surface style[data-material-motion]")?.textContent || "");
    assert(injected.includes("aurora") === false, `${item.name} 棋子自带的动效又被注入了：${injected.slice(0, 120)}`);
    assert(/@keyframes\s+(bd-|bmo-)/.test(injected), `${item.name} 棋盘自带动效的样式表空了（I 这条失去意义）`);
    if (errors.length) throw new Error(errors.join("\n"));
    results.push({ viewport: item.name, stoneEnter: "已移除", lastDot: lastDot ? lastDot.duration : null, animationsWhenOff: offPlacing.animations.length, tapHighlight: rest.boardTapHighlight });
    await context.close();
  }

  console.log(JSON.stringify({ pass: true, results }, null, 1));
  await browser.close();
} catch (error) {
  console.error(`FAIL ${error.message}`);
  await browser.close();
  process.exit(1);
}
