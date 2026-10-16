// 功能区「按钮宽度溢出后」门禁（用户 09-17 规格；09-26 改成 自动换行(默认) / 横向滚动，箭头改裸图案）：
//   A 默认＝**自动换行**：三行根本没有滑动栏那一层，按钮放不下就换行——不裁切、不被挤出屏幕
//   B 选「横向滚动」后：三行两端各一个贴屏幕边的**裸箭头**（无底色、无描边、无投影）
//   C 有得滑才亮（data-rail-active），没得滑是安静的浅灰（仍在，看得出模式开着）
//   D 点箭头挪一格 / 长按连续挪 / **行本身可拖滑（鼠标）**且拖动后不误点按钮
//   E 切回「自动换行」→ 滑动栏消失，DOM 回到旧结构
//   F 全部主题下亮态箭头 ≥2.5:1、灰态箭头 ≥1.5:1（颜色是实混合色，门禁直接算得出）
//   H 窄屏（320px）不变量：能滑才有亮箭头；换行模式下按钮仍全部可见
// 说明：默认视口 360 是「用户实机看到走棋行最后一个按钮被切在屏幕外」的复现场景。
// Usage: BANBU_URL=http://[::1]:5297/ node scripts/ui-action-rail-check.mjs
// 登记在 qa/regression-manifest.mjs（run-qa.mjs 注入 QA_BASE_URL，已带 ?qa=1）。
import { chromium } from "playwright";
import { readThemeIds, runThemeMatrix, sampleManyScript, weakThemes, minRatioOf } from "./lib/theme-matrix.mjs";

const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://[::1]:5297/";
const url = new URL(base);
if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(url.href, { waitUntil: "domcontentloaded" });

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

/** 进入打谱页并等到功能区真的挂上。
 *  ⚠ 不能只 `waitForTimeout(2400)` 就点：Vite 冷启动/改完文件后的重编译会让首次加载慢到
 *  好几秒，那时底部导航还没渲染，点击落空 → 后面所有断言全变「没有滑动栏」的假失败。
 *  ⚠ 就绪标志必须是**两种模式下都存在**的容器（`.action-layout-workspace`）：自动换行档
 *  根本没有 `.action-railbar`（10-03 起默认档是横向滚动，但门禁里两档都要显式设过再量），
 *  拿它当就绪标志会直接超时崩掉。 */
const openWorkspace = async () => {
  await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("打谱"))?.click(); });
  await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
  await page.waitForTimeout(900);
};

/** 设置「按钮宽度溢出后」的值并重载（wrap = 自动换行，scroll = 横向滚动）。 */
const setOverflow = async (mode) => {
  await page.evaluate((value) => {
    const raw = JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}");
    raw.buttonOverflow = value;
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify(raw));
  }, mode);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openWorkspace();
};

await openWorkspace();

/** 换行模式下的三行：有没有溢出被裁掉、按钮是不是都在屏幕里、行有没有换行。 */
const wrapRows = () => page.evaluate(() => [...document.querySelectorAll(".action-bottom-row, .action-top-row, .moves-row")].map((row) => {
  const kids = [...row.children];
  const rects = kids.map((kid) => kid.getBoundingClientRect());
  return {
    cls: (row.className || "").split(" ").slice(0, 2).join("."),
    overflow: Math.round(row.scrollWidth - row.clientWidth),
    lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
    lastRight: rects.length ? Math.round(rects[rects.length - 1].right) : null,
    vw: window.innerWidth,
  };
}));

// ── A 自动换行档：没有滑动栏那层，按钮放不下就换行（不被裁、不被挤出屏幕）──────────────
// ⚠ 10-03 起**默认档换成了横向滚动**（用户：「感觉这个比自动换行省空间」），所以这一档
//   必须显式设出来再量，不能再拿"刚进页面"当它。默认档本身由 J2b/J2c 守。
await setOverflow("wrap");
const defaultRows = await wrapRows();
const defaultRails = await page.evaluate(() => document.querySelectorAll(".action-railbar").length);
console.log("自动换行档三行：", JSON.stringify(defaultRows.map((r) => ({ cls: r.cls, ov: r.overflow, lines: r.lines, lastRight: r.lastRight }))));
check("A1 自动换行档没有滑动栏那一层", defaultRails === 0, `railbars=${defaultRails}`);
check("A2 自动换行档三行都在 DOM 里（首行/常驻/走棋）", defaultRows.length >= 3, JSON.stringify(defaultRows.map((r) => r.cls)));
check("A3 自动换行档按钮不横向溢出（换行解决了「被切在屏幕外」）", defaultRows.every((r) => r.overflow <= 2), JSON.stringify(defaultRows.map((r) => `${r.cls}:${r.overflow}`)));
check("A4 自动换行档最后一个按钮在屏幕内", defaultRows.every((r) => r.lastRight === null || r.lastRight <= r.vw + 1), JSON.stringify(defaultRows.map((r) => `${r.cls}:${r.lastRight}/${r.vw}`)));

// ── B/C 切到「横向滚动」：两端裸箭头 + 亮灰态 ────────────────────────────────────────
await setOverflow("scroll");

const zones = () => page.evaluate(() => {
  const out = [];
  document.querySelectorAll(".action-railbar").forEach((bar) => {
    const track = bar.querySelector(".action-rail-track");
    const scroll = bar.querySelector(".rail-scroll");
    const left = bar.querySelector('.action-rail[data-rail-dir="left"]');
    const right = bar.querySelector('.action-rail[data-rail-dir="right"]');
    const lr = left?.getBoundingClientRect();
    const rr = right?.getBoundingClientRect();
    const kids = [...(scroll?.children || [])];
    const first = kids[0]?.getBoundingClientRect();
    const last = kids[kids.length - 1]?.getBoundingClientRect();
    const wrap = bar.getBoundingClientRect();
    const ls = left ? getComputedStyle(left) : null;
    const paint = (style) => style ? {
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      border: style.borderTopWidth,
    } : null;
    out.push({
      zone: bar.getAttribute("data-rail-zone"),
      vw: window.innerWidth,
      overflow: bar.getAttribute("data-overflow"),
      wrapLeft: Math.round(wrap.left), wrapRight: Math.round(wrap.right),
      trackW: track?.clientWidth ?? 0,
      contentW: scroll?.scrollWidth ?? 0,
      viewW: scroll?.clientWidth ?? 0,
      scrollLeft: Math.round(scroll?.scrollLeft ?? 0),
      maxScroll: Math.round((scroll?.scrollWidth ?? 0) - (scroll?.clientWidth ?? 0)),
      leftEdge: lr ? Math.round(lr.left) : null,
      rightEdge: rr ? Math.round(rr.right) : null,
      railW: lr ? Math.round(lr.width) : 0,
      railDisplay: ls?.display ?? "none",
      railQuietPaint: paint(ls),
      railActivePaint: paint(right ? getComputedStyle(right) : null),
      leftActive: left?.getAttribute("data-rail-active") === "true",
      rightActive: right?.getAttribute("data-rail-active") === "true",
      leftDisabled: left?.disabled ?? null,
      rightDisabled: right?.disabled ?? null,
      firstLeft: first ? Math.round(first.left) : null,
      lastRight: last ? Math.round(last.right) : null,
      lines: new Set(kids.map((kid) => Math.round(kid.getBoundingClientRect().top))).size,
    });
  });
  return out;
});

const rows = await zones();
console.log("横向滚动：行/溢出测量：", JSON.stringify(rows.map((r) => ({ zone: r.zone, ov: r.overflow, row: `${r.contentW}/${r.viewW}`, rail: [r.leftEdge, r.rightEdge], L: r.leftActive, R: r.rightActive })), null, 1));
check("B0 三行都套上了滑动栏容器（首行/常驻/走棋）", rows.length >= 3 && ["bottom", "top", "moves"].every((z) => rows.some((r) => r.zone === z)), JSON.stringify(rows.map((r) => r.zone)));
check("B1 三行两端都有箭头，且贴屏幕边缘（≤2px）",
  rows.every((r) => r.leftEdge !== null && r.rightEdge !== null && r.railDisplay !== "none" && r.railW >= 10 && Math.abs(r.leftEdge) <= 2 && Math.abs(r.rightEdge - r.vw) <= 2),
  JSON.stringify(rows.map((r) => `${r.zone}:display=${r.railDisplay},w=${r.railW},edge=${r.leftEdge}/${r.rightEdge}`)));
for (const r of rows) {
  check(`B2-${r.zone} 箭头不吃按钮宽度（箭头右缘不越过首个按钮）`, r.firstLeft === null || r.leftEdge + r.railW <= r.firstLeft + 1, `railR=${r.leftEdge + r.railW} first=${r.firstLeft}`);
  check(`B3-${r.zone} 箭头是裸图案：无底色、无渐变、无描边、无投影`,
    Boolean(r.railActivePaint) && r.railActivePaint.background === "rgba(0, 0, 0, 0)" && r.railActivePaint.backgroundImage === "none"
      && r.railActivePaint.boxShadow === "none" && Number.parseFloat(r.railActivePaint.border) === 0,
    JSON.stringify(r.railActivePaint));
  check(`B4-${r.zone} 横行内保持单行不换行（横向滚动模式）`, r.lines <= 1, `lines=${r.lines}`);
}

// C 亮态/灰态与能否滑动一致
for (const r of rows) {
  const canLeft = r.overflow === "true" && r.scrollLeft > 2;
  const canRight = r.overflow === "true" && r.maxScroll - r.scrollLeft > 2;
  check(`C1-${r.zone} 亮态与可滑方向一致（左=${canLeft} 右=${canRight}）`, r.leftActive === canLeft && r.rightActive === canRight, `L=${r.leftActive}/${canLeft} R=${r.rightActive}/${canRight}`);
  check(`C2-${r.zone} 不可滑的那一侧为 disabled（安静但仍在）`, r.leftDisabled === !canLeft && r.rightDisabled === !canRight, `Ld=${r.leftDisabled} Rd=${r.rightDisabled}`);
}

const overflowing = rows.filter((r) => r.overflow === "true");
check("D0 至少一行确实溢出（用户说的按钮被挤出去）", overflowing.length >= 1, JSON.stringify(rows.map((r) => `${r.zone}:${r.contentW}>${r.viewW}`)));

// D1 点右箭头 → 整行挪一格
if (overflowing.length) {
  const zone = overflowing[0].zone;
  const before = (await zones()).find((r) => r.zone === zone).scrollLeft;
  await page.evaluate((z) => { document.querySelector(`.action-railbar[data-rail-zone="${z}"] .action-rail[data-rail-dir="right"]`)?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse" })); }, zone);
  await page.waitForTimeout(120);
  await page.evaluate((z) => { document.querySelector(`.action-railbar[data-rail-zone="${z}"] .action-rail[data-rail-dir="right"]`)?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse" })); }, zone);
  await page.waitForTimeout(700);
  const after = (await zones()).find((r) => r.zone === zone);
  check(`D1 点右箭头整行挪一格（${zone}）`, after.scrollLeft > before, `${before} → ${after.scrollLeft}（上限 ${after.maxScroll}）`);
  // 连续点到末尾 → 右箭头灰掉，且最后一个按钮进入视口
  for (let i = 0; i < 8; i += 1) {
    await page.evaluate((z) => { const b = document.querySelector(`.action-railbar[data-rail-zone="${z}"] .action-rail[data-rail-dir="right"]`); if (b && !b.disabled) { b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse" })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse" })); } }, zone);
    await page.waitForTimeout(450);
  }
  const end = (await zones()).find((r) => r.zone === zone);
  const lastInView = await page.evaluate((z) => {
    const bar = document.querySelector(`.action-railbar[data-rail-zone="${z}"]`);
    const track = bar?.querySelector(".rail-scroll");
    const kids = [...(track?.children || [])];
    const last = kids[kids.length - 1]?.getBoundingClientRect();
    return last ? { left: Math.round(last.left), right: Math.round(last.right) } : null;
  }, zone);
  check("D2 滑到末尾后右箭头灰掉", end.rightDisabled === true && end.rightActive === false, `scrollLeft=${end.scrollLeft}/${end.maxScroll} R=${end.rightActive}`);
  check("D3 末尾按钮已滑进视口（原先被挤出屏幕）", Boolean(lastInView) && lastInView.right <= end.vw && lastInView.left >= 0, JSON.stringify(lastInView));
}

// D4 行本身可拖滑（鼠标）——用户说的「左右滑动根本做不了」
const dragZone = overflowing.length ? overflowing[0].zone : null;
if (dragZone) {
  await page.evaluate((z) => { document.querySelector(`.action-railbar[data-rail-zone="${z}"] .rail-scroll`).scrollLeft = 0; }, dragZone);
  await page.waitForTimeout(300);
  const stonesBefore = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
  const box = await page.evaluate((z) => { const r = document.querySelector(`.action-railbar[data-rail-zone="${z}"] .rail-scroll`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, dragZone);
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x - 20, box.y, { steps: 5 });
    await page.mouse.move(box.x - 60, box.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  const afterDrag = await page.evaluate((z) => ({
    left: Math.round(document.querySelector(`.action-railbar[data-rail-zone="${z}"] .rail-scroll`)?.scrollLeft ?? -1),
    dragging: document.querySelector(`.action-railbar[data-rail-zone="${z}"]`)?.getAttribute("data-dragging"),
    stones: document.querySelectorAll(".stone-piece").length,
    toast: [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join(" | "),
  }), dragZone);
  check(`D4 鼠标拖动行本身即可滑动（${dragZone}）`, afterDrag.left > 10, `scrollLeft=${afterDrag.left}`);
  check("D5 拖动结束复位拖动标志", afterDrag.dragging === "false", `data-dragging=${afterDrag.dragging}`);
  check("D6 拖动不会误点按钮（棋子数不变、无提示）", afterDrag.stones === stonesBefore && afterDrag.toast === "", `stones ${stonesBefore}→${afterDrag.stones} toast="${afterDrag.toast}"`);
}

// ── E 切回「自动换行」→ 滑动栏消失、DOM 回到旧结构 ─────────────────────────────────
await setOverflow("wrap");
const off = await page.evaluate(() => ({
  rails: document.querySelectorAll(".action-railbar").length,
  bottomRows: document.querySelectorAll(".action-bottom-row").length,
  movesRows: document.querySelectorAll(".moves-row").length,
}));
const wrapAfter = await wrapRows();
check("E1 切回自动换行后不再出现滑动栏（DOM 回到旧结构）", off.rails === 0 && off.bottomRows >= 1 && off.movesRows >= 1, JSON.stringify(off));
check("E2 切回自动换行后按钮依旧都在屏幕里（不被裁）", wrapAfter.every((r) => r.overflow <= 2 && (r.lastRight === null || r.lastRight <= r.vw + 1)), JSON.stringify(wrapAfter.map((r) => `${r.cls}:${r.overflow}/${r.lastRight}`)));

// ── F 再切到横向滚动：**全部**主题下箭头都看得见、有对比度（清单从应用读，新增主题自动覆盖）
await setOverflow("scroll");
const themeIds = await readThemeIds(page);
const themeRows = await runThemeMatrix(page, themeIds, () => page.evaluate(sampleManyScript(['.action-rail[data-rail-active="true"]', ".action-rail:disabled"])));
const weakActive = weakThemes(themeRows, '.action-rail[data-rail-active="true"]', 2.5, { minWidth: 10 });
const weakQuiet = weakThemes(themeRows, ".action-rail:disabled", 1.5, { minWidth: 10 });
check(`F1 全部 ${themeIds.length} 套主题下亮态箭头可见且 ≥2.5:1`, weakActive.length === 0, weakActive.length ? weakActive.join(", ") : `最低 ${minRatioOf(themeRows, '.action-rail[data-rail-active="true"]')}`);
check(`F2 全部 ${themeIds.length} 套主题下灰态箭头也看得见`, weakQuiet.length === 0, weakQuiet.length ? weakQuiet.join(", ") : `最低 ${minRatioOf(themeRows, ".action-rail:disabled")}`);

// ── H 窄屏（320px）：不变量——放不下就必然有亮箭头；横向滚动模式仍是单行 ──────────────
await page.setViewportSize({ width: 320, height: 640 });
await page.waitForTimeout(1200);
const narrow = await zones();
for (const r of narrow) {
  const expectActive = r.overflow === "true" && r.maxScroll > 2;
  check(`H1-${r.zone} 320px 下溢出与亮箭头一致`, expectActive ? r.rightActive || r.leftActive : !r.rightActive && !r.leftActive, `ov=${r.overflow} max=${r.maxScroll} L=${r.leftActive} R=${r.rightActive}`);
}
const narrowMoves = narrow.find((r) => r.zone === "moves");
check("H2 320px 下走棋行保持单行（横向滚动模式不换行）", narrowMoves?.lines === 1, `lines=${narrowMoves?.lines}`);

// 长按连续滑动（1 秒推进多于一格）
const holdZone = narrow.find((r) => r.rightActive)?.zone ?? "moves";
const holdBefore = await page.evaluate((zone) => { const row = document.querySelector(`.action-railbar[data-rail-zone="${zone}"] .rail-scroll`); if (row) row.scrollLeft = 0; return Math.round(row?.scrollLeft ?? -1); }, holdZone);
await page.evaluate((zone) => {
  const rail = document.querySelector(`.action-railbar[data-rail-zone="${zone}"] .action-rail[data-rail-dir="right"]`);
  rail?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse" }));
}, holdZone);
await page.waitForTimeout(1100);
await page.evaluate((zone) => {
  const rail = document.querySelector(`.action-railbar[data-rail-zone="${zone}"] .action-rail[data-rail-dir="right"]`);
  rail?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse" }));
}, holdZone);
await page.waitForTimeout(700);
const holdAfter = await page.evaluate((zone) => Math.round(document.querySelector(`.action-railbar[data-rail-zone="${zone}"] .rail-scroll`)?.scrollLeft ?? -1), holdZone);
check("H3 长按箭头连续滑动（1 秒推进多于一格）", holdBefore >= 0 && holdAfter - holdBefore > 60, `${holdZone}: ${holdBefore} → ${holdAfter}`);

// ── I 窄屏 320 + 自动换行：按钮全部可见（这是「换行」相对「滑动」的兑现）────────────────
await setOverflow("wrap");
const narrowWrap = await wrapRows();
console.log("320px 自动换行三行：", JSON.stringify(narrowWrap.map((r) => ({ cls: r.cls, ov: r.overflow, lines: r.lines, lastRight: r.lastRight }))));
check("I1 320px 下换行模式按钮不横向溢出", narrowWrap.every((r) => r.overflow <= 2), JSON.stringify(narrowWrap.map((r) => `${r.cls}:${r.overflow}`)));
check("I2 320px 下换行模式最后一个按钮在屏幕内", narrowWrap.every((r) => r.lastRight === null || r.lastRight <= r.vw + 1), JSON.stringify(narrowWrap.map((r) => `${r.cls}:${r.lastRight}/${r.vw}`)));

check("G2 无页面错误（末段）", errors.length === 0, errors.join(" | "));

// ── J 设置页里那一档真的接管功能区（端到端：设置 → 打谱，来回各一次）────────────────
// 用户 09-26 要求这个开关放在设置里、默认关闭（自动换行）。这里从设置页改档，再回打谱看 DOM。
const openSettings = async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("设置"))?.click(); });
  await page.waitForSelector('input[aria-label="搜索设置"]', { timeout: 20000 });
  await page.waitForTimeout(300);
};
const pickOverflow = async (value) => {
  await page.locator('input[aria-label="搜索设置"]').fill("换行");
  await page.waitForTimeout(300);
  const select = page.getByLabel("按钮宽度溢出后");
  check(`J0 设置搜索「换行」能找到「按钮宽度溢出后」`, await select.count() === 1, `找到 ${await select.count()} 个`);
  await select.selectOption(value);
  await page.waitForTimeout(200);
  await page.locator('input[aria-label="搜索设置"]').fill("");
  await page.waitForTimeout(200);
};

await setOverflow("wrap");
await openSettings();
const choiceLabels = await page.getByLabel("按钮宽度溢出后").locator("option").allTextContents();
check("J1 设置页有「按钮宽度溢出后」，两档就叫 自动换行 / 横向滚动", choiceLabels.join(",") === "自动换行（Wrap）,横向滚动（Scroll）", JSON.stringify(choiceLabels));
const defaultChoice = await page.getByLabel("按钮宽度溢出后").inputValue();
check("J2 存过「自动换行」之后读回来还是它，不会被默认档吞掉", defaultChoice === "wrap", `value=${defaultChoice}`);
// 用户 10-03：「现在我们默认横向滚动吧」。默认值这件事必须对着**全新存档**量，
// 上面那条已经存过 wrap 了，所以清掉存档重载再读一次。
await page.evaluate(() => localStorage.removeItem("banbu-enhancement-settings-v1"));
await page.reload({ waitUntil: "domcontentloaded" });
await openWorkspace();
check("J2c 默认横向滚动时三行都套上了滑动栏", await page.evaluate(() => document.querySelectorAll(".action-railbar").length) >= 3, `railbars=${await page.evaluate(() => document.querySelectorAll(".action-railbar").length)}`);
await openSettings();
const freshChoice = await page.getByLabel("按钮宽度溢出后").inputValue();
check("J2b 没动过这项时默认档就是「横向滚动」", freshChoice === "scroll", `value=${freshChoice}`);
// 换代迁移：老存档里 `actionOverflow:"wrap"` 写的是**上一版的默认值**、不是用户的选择，
// 升上来必须落到新默认（否则「改默认」对已经动过任何一项增强设置的人永远不生效——
// 存档是整份写回的），同时不能把别的键一起清掉。
await page.evaluate(() => localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ actionOverflow: "wrap", haptics: true })));
await page.reload({ waitUntil: "domcontentloaded" });
await openWorkspace();
await openSettings();
const upgraded = await page.getByLabel("按钮宽度溢出后").inputValue();
const keptHaptics = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").haptics);
check("J2d 旧键存档升上来按新默认走，别的键照旧留着", upgraded === "scroll" && keptHaptics === true, `value=${upgraded} haptics=${keptHaptics}`);
await pickOverflow("scroll");
const storedScroll = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").buttonOverflow);
check("J3 选「横向滚动」后写进了设置存档", storedScroll === "scroll", `buttonOverflow=${storedScroll}`);
await openWorkspace();
check("J4 选「横向滚动」后功能区真的出现滑动栏", await page.evaluate(() => document.querySelectorAll(".action-railbar").length) >= 3, "没出现");
await openSettings();
await pickOverflow("wrap");
const storedWrap = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").buttonOverflow);
check("J5 选回「自动换行」后存档跟着变", storedWrap === "wrap", `buttonOverflow=${storedWrap}`);
await openWorkspace();
check("J6 选回「自动换行」后滑动栏消失", await page.evaluate(() => document.querySelectorAll(".action-railbar").length) === 0, "还在");
check("G3 无页面错误（设置来回之后）", errors.length === 0, errors.join(" | "));

console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
await browser.close();
process.exit(failed ? 1 : 0);
