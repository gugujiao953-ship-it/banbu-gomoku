import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 手册「目录引导」锚点门禁（2026-09-14 新增）。
 *
 * 为什么需要：引导每步靠 `tip.sel` 在真实界面里找元素，而宿主（AppTour）对找不到
 * 的目标是**静默灭孔**——UI 一改，引导就悄悄失效，没有任何东西会报错。本次手册
 * 更新中发现第 11/12/13/18/19 章都有指向已不存在元素的选择器。
 *
 * 做法：从 `src/features/manual/tours/ch*.ts` 解析每章每一步的锚点与上下文，然后
 * 用应用自己的引导宿主逐章进入（宿主会按步骤应用 tab / mode / panel / sheet /
 * openQuickDrawer），再独立检查：
 *   · missing     —— 选择器在当前上下文里查不到（引导必然灭孔）→ 硬失败
 *   · unreachable —— 查得到但滚动到视口后仍是 0×0 或不在视口内 → 硬失败
 *   · offscreen   —— 需要滚动才进视口（既有机制：宿主不自动滚动）→ 只作提示
 * 顺带核对每章解析出的步数与引导卡片显示的步数一致（防止 MANUAL_TOURS 与宿主脱节）。
 *
 * 两个必须遵守的前提（否则会大面积假失败）：
 *   ① 每章用**全新浏览器上下文**（全新安装、首次运行欢迎页在）并从中进手册——
 *      底层停在打谱页。从设置页进手册会停在设置标签，没声明 tab 的步骤全找不到。
 *   ② 不要复用同一个上下文连跑多章：上一章引导会把工作模式切到读谱／做题，串味后
 *      「上一手/下一手」这类只在打谱模式存在的锚点会假失败。
 *
 * Usage: QA_BASE_URL=http://[::1]:5193/ node qa/manual-tour-targets.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const TOURS_DIR = join(process.cwd(), "src/features/manual/tours");

/** 解析一章的引导步骤：id / title / 锚点列表 / 上下文。 */
const parseTourFile = (path) => {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("[", text.indexOf(": TourStep[] = "));
  const end = text.lastIndexOf("];");
  if (start < 0 || end < 0) throw new Error(`${path}: 找不到数组边界`);
  const body = text.slice(start + 1, end);

  // 顶层步骤对象：按花括号深度切分（对象内还有 tips 数组与对象）。
  const steps = [];
  let depth = 0;
  let buffer = "";
  for (const char of body) {
    if (char === "{") { depth += 1; buffer += char; continue; }
    if (char === "}") {
      depth -= 1;
      buffer += char;
      if (depth === 0) { steps.push(buffer); buffer = ""; }
      continue;
    }
    if (depth > 0) buffer += char;
  }

  return steps.map((block) => {
    // 解析出的字符串是 TS 源码字面量（含 \" 转义），必须还原成真实选择器再交给
    // document.querySelector，否则 `[data-action-id=\"x\"]` 这类锚点会全部假失败。
    // 两种引号写法都要认：只认双引号会让单引号写的锚点被**静默漏检**（漏检比误报危险）。
    const sels = [...block.matchAll(/sel:\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g)]
      .map((match) => (match[1] !== undefined ? match[1].replace(/\\(["\\])/g, "$1") : match[2]));
    const context = {};
    for (const match of block.matchAll(/(?:^|[\s,{])(tab|mode|panel|sheet):\s*"([^"]+)"/g)) context[match[1]] = match[2];
    if (/openQuickDrawer:\s*true/.test(block)) context.openQuickDrawer = true;
    return {
      id: (block.match(/id:\s*"([^"]+)"/) || [])[1] ?? "(无 id)",
      title: (block.match(/title:\s*"([^"]+)"/) || [])[1] ?? "(无标题)",
      sels,
      context,
    };
  });
};

const chapterFiles = readdirSync(TOURS_DIR).filter((name) => /^ch\d+-.*\.ts$/.test(name)).sort();
const chapters = chapterFiles.map((name) => ({ name, steps: parseTourFile(join(TOURS_DIR, name)) }));
const totalSels = chapters.reduce((sum, chapter) => sum + chapter.steps.reduce((n, step) => n + step.sels.length, 0), 0);
// 自检：源码里 `sel:` 的字面出现次数必须等于解析出的锚点数，否则说明有写法没被认出来，
// 门禁会「全绿」但其实没检查——必须直接失败。
const literalSelCount = chapterFiles.reduce((sum, name) => sum + (readFileSync(join(TOURS_DIR, name), "utf8").match(/\bsel:/g) ?? []).length, 0);
console.log(`解析到 ${chapters.length} 章，共 ${chapters.reduce((sum, chapter) => sum + chapter.steps.length, 0)} 步，${totalSels} 个锚点（源码 sel: 字面 ${literalSelCount} 处）`);
if (literalSelCount !== totalSels) {
  console.log(`FAIL 锚点解析有遗漏：源码 ${literalSelCount} 处，只解析出 ${totalSels} 个——检查本文件的解析规则`);
  process.exit(1);
}

/** 检查一个锚点：存在性 → 滚动到视口 → 可达性。 */
const probeAnchor = (page, sel) => page.evaluate((selector) => {
  let element = null;
  try { element = document.querySelector(selector); } catch { return { state: "missing", detail: "选择器语法无效" }; }
  if (!element) return { state: "missing" };
  const before = element.getBoundingClientRect();
  const offscreenBefore = before.bottom < 0 || before.top > window.innerHeight || before.width < 2 || before.height < 2;
  element.scrollIntoView({ block: "center" });
  return new Promise((resolve) => {
    window.setTimeout(() => {
      const rect = element.getBoundingClientRect();
      const visible = rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.top < window.innerHeight;
      resolve(visible
        ? { state: "ok", offscreenBefore }
        : { state: "unreachable", detail: `rect ${Math.round(rect.width)}×${Math.round(rect.height)}` });
    }, 200);
  });
}, sel);

const failures = [];
const offscreen = [];
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });

try {
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
    const chapter = chapters[chapterIndex];
    // ① 全新上下文（全新安装）→ 首次运行欢迎页停在打谱页、打谱模式。
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 160)));
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      await page.getByRole("button", { name: /阅读使用手册/ }).click();
      await page.locator(".manual-item").first().waitFor();
      if (chapterIndex === 0) console.log(`手册打开：${await page.locator(".manual-item").count()} 章`);

      await page.locator(".manual-item").nth(chapterIndex).locator(".manual-guide-entry").click();
      const tour = page.locator(".app-tour");
      if (!(await tour.count())) {
        failures.push(`${chapter.name}：点击「引导」没有打开引导层（MANUAL_TOURS[${chapterIndex}] 可能为空）`);
        continue;
      }
      await page.waitForTimeout(400);
      const badge = await page.locator(".app-tour-badge").textContent();
      const total = Number((badge ?? "").match(/(\d+)\/(\d+)/)?.[2] ?? 0);
      if (total !== chapter.steps.length) {
        failures.push(`${chapter.name}：引导卡片显示 ${total} 步，源码解析到 ${chapter.steps.length} 步（宿主 steps 与手册章节下标脱节？）`);
      }
      for (let stepIndex = 0; stepIndex < chapter.steps.length && stepIndex < total; stepIndex += 1) {
        // 用进度点直接跳步：goto() 同样会触发宿主的 tab/panel/sheet 上下文切换。
        await page.locator(".app-tour-dots button").nth(stepIndex).click();
        await page.waitForTimeout(500);
        const step = chapter.steps[stepIndex];
        for (const sel of step.sels) {
          const result = await probeAnchor(page, sel);
          if (result.state !== "ok") {
            failures.push(`${chapter.name} 第 ${stepIndex + 1} 步「${step.title}」(${step.id}) 锚点 ${result.state}：${sel}${result.detail ? ` — ${result.detail}` : ""}`);
          } else if (result.offscreenBefore) {
            offscreen.push(`${chapter.name} 第 ${stepIndex + 1} 步「${step.title}」：${sel}`);
          }
        }
      }
      if (pageErrors.length) failures.push(`${chapter.name} 页面报错：${pageErrors.join(" | ")}`);
    } finally {
      await context.close();
    }
  }

  console.log(`\n需要滚动才进视口的锚点（既有机制，非缺陷）：${offscreen.length}`);
  offscreen.slice(0, 15).forEach((line) => console.log(`  · ${line}`));

  if (failures.length) {
    console.log(`\nFAIL ${failures.length} 项：`);
    failures.forEach((line) => console.log(`  ✗ ${line}`));
    process.exitCode = 1;
  } else {
    console.log("\n全部章节引导锚点均可在真实界面里找到并可见");
  }
} finally {
  await browser.close();
}
