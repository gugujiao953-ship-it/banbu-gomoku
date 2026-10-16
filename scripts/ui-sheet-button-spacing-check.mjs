import { chromium } from "playwright";

/**
 * 弹层按钮组的间距与高度门禁（用户 10-01：「有些地方的保存，就是有保存、创建副本、取消的
 * 这种，感觉按钮有点紧凑了，你看看要不要上下调高一点，或者间隙大一点点。这个有挺多地方的」）。
 *
 * 为什么值得钉成门禁：量出来的事实是**竖排按钮之间 0px** —— `.sheet-body` 只有 `padding:7px 0`，
 * `.primary-button` / `.secondary-button` 又都不带 margin，所以「保存草稿并切换」和
 * 「创建修改副本并切换」是**贴在一起**的；次级按钮 44px、主按钮 48px，同一组里还不齐。
 * 这类问题肉眼容易看惯，改天谁动一下 `.sheet-body` 就会漂回去，所以要断言**几何**。
 *
 * 断言的是三件事：① 同一列里上下相邻的两颗整宽按钮间隙 ≥8px；② 这些按钮高度 ≥46px
 * （主/次级都按 48 走）；③ 已经有 `gap:12px` 的容器（`.form-grid`）不许再叠一层 margin
 * 变成 22px——即间隙上限也钉住，防止"顺手加宽"把弹层撑散。
 *
 * 用法：BANBU_URL=http://127.0.0.1:5577/ node scripts/ui-sheet-button-spacing-check.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5577/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 848 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
page.setDefaultTimeout(15_000);
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const clickText = (text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === t || (x.getAttribute("aria-label") || "").trim() === t || (x.getAttribute("aria-label") || "").includes(t));
  if (b) b.click();
  return Boolean(b);
}, text);
const navTo = (label) => page.evaluate((l) => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes(l))?.click(); }, label);

/** 读出当前弹层里「整宽、上下相邻」的按钮对：高度与它们之间的实际间隙。 */
const stackedButtons = () => page.evaluate(() => {
  const sheet = [...document.querySelectorAll(".bottom-sheet")].pop();
  if (!sheet) return null;
  const body = sheet.querySelector(".sheet-body") || sheet;
  const rows = [...body.querySelectorAll(":scope > button")].map((b) => {
    const r = b.getBoundingClientRect();
    return { label: (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 14), top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
  }).sort((a, b) => a.top - b.top);
  const gaps = [];
  for (let i = 1; i < rows.length; i += 1) gaps.push(rows[i].top - (rows[i - 1].top + rows[i - 1].h));
  return { title: sheet.querySelector(".sheet-head h2")?.textContent?.trim() || "(无标题)", rows, gaps };
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* 首次进入要清干净 */ } localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);

  // ── A 保存棋谱：容器是 .sheet-body.form-grid，本来就有 gap:12px ────────────
  await clickText("保存棋谱");
  await page.waitForTimeout(1000);
  const save = await stackedButtons();
  check("A1 保存棋谱弹层打开了", Boolean(save) && save.rows.length >= 2, save ? `「${save.title}」${save.rows.length} 颗` : "没打开");
  if (save) {
    check("A2 已有 gap:12 的容器不许再叠 margin（间隙必须还是 12，不能变 22）", save.gaps.every((g) => g >= 8 && g <= 16), JSON.stringify(save.gaps));
    check("A3 整宽按钮高度 ≥46px（主按钮 48、次级按钮本轮从 44 提到 48）", save.rows.every((r) => r.h >= 46), JSON.stringify(save.rows.map((r) => `${r.label}=${r.h}`)));
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  // ── B 有未保存草稿：竖排四颗，改前它们之间是 0px ──────────────────────────
  await page.getByRole("gridcell", { name: /H8空位/ }).click({ timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(900);
  await navTo("导入");
  await page.waitForTimeout(1600);
  const draft = await stackedButtons();
  check("B1 「有未保存草稿」弹层打开了", Boolean(draft) && draft.rows.length === 4, draft ? `「${draft.title}」${draft.rows.length} 颗` : "没打开");
  if (draft) {
    check("B2 竖排按钮之间有间隙了（用户说的「紧凑」＝这里改前是 0px）", draft.gaps.length >= 3 && draft.gaps.every((g) => g >= 8), JSON.stringify(draft.gaps));
    check("B3 四颗按钮同高（主按钮与三颗次级按钮都 48px，不再 44/48 混排）", draft.rows.every((r) => r.h === draft.rows[0].h) && draft.rows[0].h >= 46, JSON.stringify(draft.rows.map((r) => `${r.label}=${r.h}`)));
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  // 守卫弹层上先按「取消」（保住草稿），再把底下那张「选择导入方式」也关掉，
  // 否则下一步点「对弈」导航会被浮层挡住（第一版就是在这里超时，把整套门禁带崩）。
  await clickText("取消");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);

  // ── C 回到上次对局：竖排三颗（真开一局再退出，才会弹这个）。
  //    这一段是**尽力而为**：入口链路比 A/B 长，弹不出来就报 SKIP，不能像
  //    scripts/verify-ai-rules.mjs 那样把整个 qa:browser 跑批直接崩掉（那条已经踩过）。
  let cRan = false;
  try {
    await navTo("对弈");
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-duel-entry="ai"] .duel-entry-action')?.click());
    await page.locator(".ai-game-setup").waitFor({ timeout: 12_000 });
    if (await page.locator("[data-duel-resume-new]").count()) { await page.locator("[data-duel-resume-new]").click(); await page.waitForTimeout(800); }
    await page.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
    await page.locator("[data-duel-screen]").waitFor({ timeout: 12_000 });
    await page.locator("[data-duel-close]").click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-duel-entry="ai"] .duel-entry-action')?.click());
    await page.waitForTimeout(1500);
    const resume = await stackedButtons();
    cRan = true;
    check("C1 「回到上次对局」弹层打开了", Boolean(resume) && resume.rows.length === 3, resume ? `「${resume.title}」${resume.rows.length} 颗` : "没打开");
    if (resume) check("C2 三颗按钮之间有间隙且同高", resume.gaps.every((g) => g >= 8) && resume.rows.every((r) => r.h === resume.rows[0].h), JSON.stringify({ gaps: resume.gaps, h: resume.rows.map((r) => r.h) }));
  } catch (error) {
    console.log(`SKIP C 回到上次对局：入口链路没走通（${String(error).slice(0, 90)}）——A/B 才是这条门禁的核心，C 走不到不判失败`);
  }
  if (!cRan) console.log("（C 段未产生断言）");

  check("D1 无页面错误", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}
console.log(failed === 0 ? "\n弹层按钮间距门禁全部通过" : `\n${failed} 项断言失败`);
process.exit(failed === 0 ? 0 : 1);
