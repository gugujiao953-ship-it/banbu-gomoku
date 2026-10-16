/**
 * 开局名提示开关的门禁（2026-10-09）。
 *  A. 出厂默认开启（新装就能看到浮字）
 *  B. 关掉 → 摆出花月**不出现**浮字
 *  C. 再打开 → 浮字回来（开关真的双向生效，不是只关不开）
 *  D. 开关落盘（刷新后保持关闭）
 *  E. 芯片仍可被键盘操作（真 input[type=checkbox]，不是 div 假开关）
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:5331/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

const results = [];
let failed = 0;
const assert = (ok, name, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const SIZE = 15, HIT_ORIGIN = 34, HIT_STEP = 36, VIEWBOX = 572;

const gotoDuel = async () => {
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]');
    const b = nav && Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈");
    if (b) b.click();
  });
  await page.waitForTimeout(1000);
};

/**
 * 从进行中的对局回到对弈首页。
 *
 * ⚠ 必须先关掉再开新局：`[data-duel-entry='ai']` 那张入口卡只在**没有进行中对局**时渲染
 * （有对局时页面是 GameScreen）。不先退出的话，`startFiveTwo` 点不到入口卡、静默什么都不做，
 * 接着 playHanatsuki 点的三个点在旧棋盘上已被占住 → 既落不下子也凑不出开局，
 * 看起来就像"开关没生效"（实测踩到，是探针的错，不是产品的错）。
 */
const closeDuelIfOpen = async () => {
  const closed = await page.evaluate(() => {
    const b = document.querySelector("[data-duel-close]");
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(1200);
  return closed;
};

/**
 * 开一局五手两打（执黑）。
 *
 * ⚠ 三个时序坑，全都在实测里踩过，别再改回"一串固定 sleep"：
 *  ① 点「开始对局」后可能弹出「回到上次对局」确认框，它**出现得比固定等待晚**；
 *     不把它处理掉，它就会在你**下一步**才冒出来、把那次点击吞掉
 *     （现象是"第二局开不起来"，看起来像功能坏了）。
 *  ② 入口卡 `[data-duel-entry='ai']` 只在**没有进行中对局**时渲染；上一局没退干净就点不到它。
 *  ③ 开局设置浮层里的「有禁手 → 五手两打」是两步：不点进去就没有规则列表。
 *
 * 所以这里每一步都**等状态真正到位**再继续，最后按"棋盘空着且已进入对局"判定成功。
 */
const startFiveTwo = async () => {
  // ① 确保回到对弈首页（有进行中对局就先退）
  if (await page.evaluate(() => Boolean(document.querySelector("[data-duel-close]")))) {
    await page.evaluate(() => document.querySelector("[data-duel-close]")?.click());
    await page.waitForTimeout(1200);
  }
  // ② 点入口卡打开设置浮层（等入口卡真的渲染出来——从设置页切回来有一帧延迟）
  const entryReady = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      if (await page.evaluate(() => Boolean(document.querySelector("[data-duel-entry='ai'] .duel-entry-action")))) return true;
      await page.waitForTimeout(250);
    }
    return false;
  })();
  if (!entryReady) { console.log("   ⚠ 入口卡始终没出现（说明还停在对局界面）"); return false; }
  await page.evaluate(() => document.querySelector("[data-duel-entry='ai'] .duel-entry-action")?.click());
  /**
   * ⚠ 点入口后可能先弹**「回到上次对局」**而不是开局设置浮层（上一局的会话还在内存里，
   * `duelResume` 正是这个场景）——直接等 `.ai-game-setup` 会超时，看起来像"开不了局"。
   * 两种弹层都要认：看到 resume 就点「放弃这局，开新局」把它让开，再等设置浮层。
   */
  const opened = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const state = await page.evaluate(() => {
        if (document.querySelector(".ai-game-setup")) return "setup";
        const giveUp = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().includes("放弃这局"));
        if (giveUp) { giveUp.click(); return "resume"; }
        return null;
      });
      if (state === "setup") return true;
      if (state === "resume") { await page.waitForTimeout(900); continue; }
      await page.waitForTimeout(250);
    }
    return false;
  })();
  if (!opened) { console.log("   ⚠ 开局设置浮层未出现"); return false; }
  // ③ 执黑
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".ai-setup-cells button")).find((x) => (x.textContent || "").includes("执黑"));
    if (b) b.click();
  });
  await page.waitForTimeout(250);
  // ④ 有禁手 → 五手两打（等规则列表出现再点）
  await page.evaluate(() => {
    const g = Array.from(document.querySelectorAll(".ai-setup-cells button")).find((x) => (x.textContent || "").includes("有禁手"));
    if (g) g.click();
  });
  await page.waitForSelector(".ai-float-list button", { timeout: 6_000 });
  const picked = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll(".ai-float-list button")).find((x) => (x.textContent || "").includes("五手两打"));
    if (t) { t.click(); return true; }
    return false;
  });
  await page.waitForTimeout(400);
  // 选完即关；万一还开着就手动关掉，别让它挡住后面的点击
  await page.evaluate(() => {
    if (document.querySelector(".ai-float-wrap")) document.querySelector(".ai-float-head button")?.click();
  });
  await page.waitForTimeout(250);
  // ⑤ 开始对局
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /开始人机对战|按新规则重新开始/.test(x.textContent || ""));
    if (b) b.click();
  });
  // ⑥ 处理可能出现的「回到上次对局」——**轮询等它出现**，不是睡固定时长后只看一眼
  const resumeHandled = await (async () => {
    for (let i = 0; i < 30; i += 1) {
      const done = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim().includes("放弃这局"));
        if (b) { b.click(); return true; }
        return false;
      });
      if (done) { await page.waitForTimeout(1500); return true; }
      // 已经进对局界面了就不必再等这个弹窗
      if (await page.evaluate(() => Boolean(document.querySelector("[data-duel-board]")))) return false;
      await page.waitForTimeout(250);
    }
    return false;
  })();
  // ⑦ 等真的进入对局且棋盘干净
  const ok = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const state = await page.evaluate(() => ({
        board: Boolean(document.querySelector("[data-duel-board]")),
        setup: Boolean(document.querySelector(".ai-game-setup")),
        stones: document.querySelectorAll("[data-duel-board] svg circle.stone").length,
      }));
      if (state.board && !state.setup && state.stones === 0) return true;
      await page.waitForTimeout(250);
    }
    return false;
  })();
  if (!ok) console.log(`   ⚠ 第二局未就绪（picked=${picked} resumeHandled=${resumeHandled}）`);
  return ok;
};

const clickCell = async (row, col) => {
  const box = await page.evaluate(() => {
    const svg = document.querySelector("[data-duel-board] svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) return;
  await page.mouse.click(box.x + ((HIT_ORIGIN + col * HIT_STEP) / VIEWBOX) * box.w, box.y + ((HIT_ORIGIN + row * HIT_STEP) / VIEWBOX) * box.h);
};

const stoneCount = () => page.evaluate(() => document.querySelectorAll("[data-duel-board] svg circle.stone").length);
const revealText = () => page.evaluate(() => (document.querySelector("[data-opening-reveal-name]")?.textContent || "").trim() || null);

/** 摆出「花月」：黑1 天元、白2 直指、黑3 花月位（五手两打三手都由先手摆）。 */
const playHanatsuki = async () => {
  const start = Date.now();
  while (Date.now() - start < 20_000 && (await page.evaluate(() => Boolean(document.querySelector("[data-duel-thinking]"))))) await page.waitForTimeout(200);
  // 每手都确认真的落上了再走下一点（否则"没开成局"会被读成"浮字没出现"）
  const place = async (row, col, expected) => {
    await clickCell(row, col);
    await page.waitForTimeout(700);
    return (await stoneCount()) >= expected;
  };
  if (!(await place(7, 7, 1))) return false;
  if (!(await place(8, 7, 2))) return false;
  if (!(await place(8, 8, 3))) return false;
  await page.waitForTimeout(700); // 等浮字渲染
  return true;
};

/** 打开设置 → 可选增强功能，返回「开局名提示」那枚芯片的 input。 */
const openChip = async () => {
  // 点底部导航「设置」；点完等设置页真的渲染出来再往下走
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]');
    const b = nav && Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "设置");
    b?.click();
  });
  await page.waitForSelector(".settings-page", { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const g = [...document.querySelectorAll("details.settings-group")].find((x) => (x.querySelector(".settings-section-title > b")?.textContent || "") === "可选增强功能");
    if (g && !g.open) g.querySelector("summary.settings-section-toggle")?.click();
  });
  await page.waitForTimeout(700);
  return page.locator('.setting-chip:has-text("开局名提示") input[type="checkbox"]').first();
};

/** 从设置页回打谱页（点底部导航）。 */
const gotoRecord = async () => {
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]');
    const b = nav && Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "打谱");
    b?.click();
  });
  await page.waitForTimeout(500);
};

// ── A 默认开启 + E 真 input ──────────────────────────────────────────────
const targetUrl = new URL(BASE);
targetUrl.searchParams.set("qa", "1");
await page.goto(targetUrl.href, { waitUntil: "load" });
await page.waitForTimeout(4500);
const chip = await openChip();
assert(await chip.count() === 1, "设置页有「开局名提示」芯片");
const isCheckbox = await chip.evaluate((el) => el.tagName.toLowerCase() === "input" && el.type === "checkbox");
assert(isCheckbox, "它是真 input[type=checkbox]（可键盘操作，不是假开关）");
assert(await chip.isChecked(), "出厂默认开启", String(await chip.isChecked()));

// 键盘可达性：聚焦并空格切换
await chip.focus();
const focused = await page.evaluate(() => document.activeElement?.type === "checkbox");
assert(focused, "可以用 Tab/脚本聚焦到它");

// ── B 关掉后不出现浮字 ──────────────────────────────────────────────────
await chip.click();
await page.waitForTimeout(400);
assert(!(await chip.isChecked()), "点一下即关闭", String(await chip.isChecked()));

await gotoRecord();
await gotoDuel();
assert(await startFiveTwo(), "关掉开关后能开一局五手两打");
const playedOff = await playHanatsuki();
assert(playedOff, "关掉后仍能正常摆出三手");
assert((await revealText()) === null, "**关闭时不出现开局名浮字**", String(await revealText()));
// ── D 落盘 ─────────────────────────────────────────────────────────────
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "null"));
assert(stored?.openingNameHint === false, "关闭状态已落盘", JSON.stringify(stored?.openingNameHint));

// ── C 再打开 → 浮字回来 ─────────────────────────────────────────────────
// 先退出刚才那局（否则对弈页停在 GameScreen，入口卡不在，开不了新局）。
await closeDuelIfOpen();
await page.getByRole("button", { name: "设置", exact: true }).click();
await page.waitForTimeout(900);
const chip2 = await openChip();
await chip2.click();
await page.waitForTimeout(400);
assert(await chip2.isChecked(), "再点一下可重新打开");
await gotoRecord();
await gotoDuel();
assert(await startFiveTwo(), "重新打开后能再开一局五手两打");
const playedOn = await playHanatsuki();
assert(playedOn, "打开后仍能正常摆出三手");
const back = await revealText();
assert(back === "花月", "**打开后浮字回来（花月）**", String(back));

// ── 刷新后保持 ──────────────────────────────────────────────────────────
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(4500);
/**
 * 刷新后应用会恢复上次的存档状态，可能停在打谱页而不是设置页；若上一局还留着
 * 「回到上次对局」的待确认态，直接点底部导航会没反应（`.settings-page` 等不到）。
 * 所以先兜底退出对局、再打开设置。
 */
await closeDuelIfOpen();
const chip3 = await openChip();
assert(await chip3.isChecked(), "刷新后仍是打开状态（与上次操作一致）");

/**
 * 设置分区的结构约定（用户 2026-10-09 第二轮：「如果分组内比较少，那就整合到『其他』分组里面」，
 * 以及「长按的说明我咋没看到」）。这几条钉住的是**跨门禁与跨用户都依赖的结构**：
 *   · 分组固定为 4 个、单项分组并进「其他」——防以后又出现"一枚芯片一个板块"；
 *   · 每枚芯片都有 ⓘ，点开能读到**完整说明**（第一版把说明只留给读屏，用户看不到，这是回归）；
 *   · ⓘ 的可访问名**不含该芯片标题**——含了会让 `getByLabel("AI 棋盘提示点")` 命中 2 个元素，
 *     把 verify-ai-rules 整条门禁搞成 strict mode violation（实测踩到）。
 */
const layout = await page.evaluate(() => {
  const panel = document.querySelector(".enhancement-settings");
  if (!panel) return null;
  const groups = [...panel.querySelectorAll(".setting-chip-group")].map((g) => ({
    title: (g.querySelector(".setting-chip-group-head > b")?.textContent || "").trim(),
    count: g.querySelectorAll(".setting-chip").length,
  }));
  const chips = [...panel.querySelectorAll(".setting-chip")];
  return {
    groups,
    chipCount: chips.length,
    allHaveInfo: chips.every((c) => Boolean(c.querySelector(".setting-chip-info"))),
    // ⓘ 的 aria-label 不该重复标题（否则 getByLabel 命中两个）
    infoLabelCollides: chips.some((c) => {
      const title = (c.querySelector(".setting-chip-title")?.textContent || "").trim();
      const label = c.querySelector(".setting-chip-info")?.getAttribute("aria-label") || "";
      return title && label.includes(title);
    }),
    // input 必须可被 Playwright .check() 命中（不能加 pointer-events:none）
    inputHitTestable: chips.every((c) => {
      const input = c.querySelector('input[type="checkbox"]');
      if (!input) return false;
      const r = input.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(input).pointerEvents !== "none";
    }),
  };
});
assert(Boolean(layout), "能读到设置分区结构");
assert(layout.groups.length === 4, "分区为 4 个分组（单项分组已并进「其他」）",
  layout.groups.map((g) => `${g.title}(${g.count})`).join(" / "));
assert(layout.groups.some((g) => g.title === "其他"), "存在「其他」分组兜底");
// 计数从 17 抬到 20：中途新增的芯片（「点击确认落子」R196 等）没同步这条，红的是账不是功能。
// 这条**故意保持精确相等**：它的作用是"有人悄悄少渲染/多渲染了一枚芯片"时必须有人来看一眼。
assert(layout.chipCount === 20, "芯片共 20 枚", String(layout.chipCount));
assert(layout.allHaveInfo, "每枚芯片都有 ⓘ 说明按钮");
assert(!layout.infoLabelCollides, "ⓘ 的可访问名不含芯片标题（否则 getByLabel 会命重）");
assert(layout.inputHitTestable, "复选框可被 Playwright 命中（未被 pointer-events 挡掉）");

// ⓘ 点开能读到完整说明，且不误切换开关
const longChipSel = '.setting-chip:has-text("长按环形菜单")';
const beforeInfo = await page.locator(`${longChipSel} input[type="checkbox"]`).first().isChecked();
await page.locator('[data-chip-info="长按环形菜单"]').click();
await page.waitForTimeout(700);
const noteText = await page.evaluate(() => (document.querySelector(".chip-note-sheet .chip-note-text")?.textContent || ""));
assert(noteText.length > 300, "ⓘ 浮层显示完整说明（不是摘要）", `${noteText.length} 字`);
assert(noteText.includes("电脑上按住不放"), "说明里写明电脑鼠标也能长按（用户问过这件事）");
const afterInfo = await page.locator(`${longChipSel} input[type="checkbox"]`).first().isChecked();
assert(beforeInfo === afterInfo, "点 ⓘ 没有误切换开关", `${beforeInfo} → ${afterInfo}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

assert(errors.length === 0, "全程无 console/page 错误", errors.slice(0, 3).join(" | "));
console.log(failed === 0 ? `\n✅ 开局名提示开关门禁 ${results.length} 项全过` : `\n❌ ${failed}/${results.length} 项失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
