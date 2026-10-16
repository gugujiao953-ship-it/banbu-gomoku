import { chromium } from "playwright";
import { readFileSync } from "node:fs";

// 首运行欢迎层的 .first-run-backdrop（fixed; inset:0）会拦住后面每一次点击。那个键自
// 09-14 起**按版本号**存（src/features/onboarding/onboarding.ts），下面 addInitScript 写
// 的 "true" 只代表「更早的版本上看过」，当前版本照样再弹——真正关掉它的只有 URL 上的 ?qa=1。
// run-qa 注入的地址自带 ?qa=1，手动导出 QA_BASE_URL 时多半没有，所以这里补上（与
// scripts/verify-ai-rules.mjs 的写法一致；已有查询串就不动）。
const rawBaseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const baseURL = rawBaseURL.includes("?") ? rawBaseURL : `${rawBaseURL}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(10_000);
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** 已退役的外观设计（用户点名删掉的那几套）不许从新清单里爬回来。
 *  清单在 App 那边（src/appearance/render.ts 的 RETIRED_BOARD_THEMES / RETIRED_STONE_THEMES），
 *  门禁里再抄一份就是第三份真相——所以直接读它自己的声明；读不到就报错，
 *  绝不允许解析失败后当成「没有退役项」安静地放过（本仓库已经被这种空转门禁咬过两次）。 */
const retiredIdsOf = (exportName) => {
  const source = readFileSync(new URL("../src/appearance/render.ts", import.meta.url), "utf8");
  const matched = source.match(new RegExp(`export const ${exportName}\\s*[^;{]*\\{([^}]*)\\}`));
  assert(matched, `读不到 src/appearance/render.ts 里的 ${exportName} 声明（写法改了？这条把关不能默默跳过）`);
  const ids = [...matched[1].matchAll(/([A-Za-z][\w-]*)\s*:/g)].map((entry) => entry[1]);
  assert(ids.length > 0, `${exportName} 解析出 0 项，据此把关等于没把关`);
  return ids;
};

try {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "打开快捷中心" }).click();
  // 快捷中心按分区折叠，「外观与声音」默认收起时里面三个选择器都还没挂载。
  // 先展开再读，否则拿到空数组、报成「缺少主题」——那是假失败。
  if (await page.locator(".quick-visual-card .quick-drawer-section-toggle").count()
    && !(await page.getByLabel("选择应用主题").count())) {
    await page.locator(".quick-visual-card .quick-drawer-section-toggle").click();
    await page.getByLabel("选择应用主题").waitFor({ state: "visible" });
  }
  const quickThemeValues = await page.getByLabel("选择应用主题").locator("option").evaluateAll((options) => options.map((option) => option.value));
  const quickBoardOptions = await page.getByLabel("选择棋盘").locator("option").evaluateAll((options) => options.map((option) => ({ value: option.value, name: (option.textContent || "").trim() })));
  const quickStoneOptions = await page.getByLabel("选择棋子").locator("option").evaluateAll((options) => options.map((option) => ({ value: option.value, name: (option.textContent || "").trim() })));
  const quickBoardValues = quickBoardOptions.map((option) => option.value);
  const quickStoneValues = quickStoneOptions.map((option) => option.value);
  // 应用主题清单不在门禁里抄第二份：App 把可测主题自声明在 `.app-shell[data-theme-options]`
  // （唯一来源 src/theme-options.ts），这里按它逐项核对。以前抄的那 6 个名字就是会漂的那份。
  const declaredThemes = (await page.locator(".app-shell").getAttribute("data-theme-options") || "").split(/\s+/).filter(Boolean);
  assert(declaredThemes.length >= 10, `应用没有自声明主题清单（data-theme-options 只有 ${declaredThemes.length} 项），这条断言会失去意义`);
  for (const theme of declaredThemes) assert(quickThemeValues.includes(theme), `快捷中心缺少应用主题 ${theme}（App 自声明的 data-theme-options 里有它）`);
  await page.getByRole("dialog", { name: "快捷中心" }).getByRole("button", { name: "关闭快捷中心" }).click();

  const titleLayouts = [];
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator(".unified-status-name").evaluate((node) => {
      node.textContent = "一份用于验证手机端超长棋谱名称不会与副标题重叠的测试棋谱";
    });
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const name = rect(".unified-status-name");
      const lines = rect(".unified-status-lines");
      const kind = rect(".unified-status-kind");
      const copy = rect(".unified-status-copy");
      const chevron = rect(".unified-status-title > svg");
      const shell = document.querySelector(".app-shell");
      return {
        name, lines, kind, copy, chevron,
        overflow: shell ? shell.scrollWidth - shell.clientWidth : 999,
      };
    });
    assert(layout.name && layout.lines && layout.kind && layout.copy && layout.chevron, `${width}px 顶部状态区元素缺失`);
    // On phones the title sits on the left and the two status lines on the
    // right; an over-long title must truncate rather than overlap the status.
    assert(layout.name.right <= layout.lines.left + 0.5, `${width}px 棋谱名与状态栏重叠`);
    assert(layout.copy.left >= layout.kind.right - 0.5, `${width}px 棋谱名向左侵入图标`);
    assert(layout.copy.right <= layout.chevron.left + 0.5, `${width}px 棋谱名侵入展开箭头`);
    assert(layout.overflow <= 1, `${width}px 页面横向溢出 ${layout.overflow}px`);
    titleLayouts.push({ width, overflow: layout.overflow });
  }

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("搜索设置").waitFor();

  const legacyHeadingCount = await page.locator(".settings-page .page-title h1").count();
  const pseudoHeading = await page.locator(".settings-page").evaluate((node) => getComputedStyle(node, "::before").content);
  assert(legacyHeadingCount === 0, "旧的设置页标题仍存在");
  assert(["none", "normal", "\"\""].includes(pseudoHeading), `设置页伪标题仍存在：${pseudoHeading}`);

  const groups = page.locator("details.settings-group");
  const groupCount = await groups.count();
  assert(groupCount >= 11, `设置分组数量异常：${groupCount}`);
  const missingIconCount = await groups.locator("summary.settings-section-toggle:not(:has(.settings-section-icon svg))").count();
  assert(missingIconCount === 0, `有 ${missingIconCount} 个主分类缺少图标`);
  // 定位主分类一律按**分类小标题**，不用 hasText 全文匹配：分类正文里的说明文字随时会提到
  // 别的分类名——2026-10-02 新增的「公用效果」helper 里就写着「关闭「无障碍与反馈」里的
  // 「界面动效」后…」，于是 `filter({ hasText: "无障碍与反馈" }).first()` 抓到的是排在前面的
  // 「外观与音效」（和本文件下面「关于」那条踩过的坑同一个）。
  const groupOf = async (title) => {
    const matched = groups.filter({ has: page.locator(".settings-section-title > b").filter({ hasText: new RegExp(`^${title}$`) }) });
    const found = await matched.count();
    assert(found === 1, `设置页里标题为「${title}」的主分类应有且只有 1 个，实际 ${found} 个`);
    return matched.first();
  };

  await page.getByLabel("搜索设置").fill("字号");
  const visibleGroups = groups.filter({ visible: true });
  assert(await visibleGroups.count() === 1, `搜索字号后应只显示 1 个分类，实际 ${await visibleGroups.count()}`);
  assert((await visibleGroups.first().innerText()).includes("无障碍与反馈"), "搜索字号未定位到无障碍分类");
  assert(await visibleGroups.first().getAttribute("open") !== null, "搜索命中的分类没有自动展开");

  await page.getByRole("button", { name: "清除设置搜索" }).click();
  assert(await groups.count() === groupCount, "清除搜索后分类未恢复");

  const appearance = await groupOf("外观与音效");
  if (await appearance.getAttribute("open") === null) await appearance.locator("> summary").click();
  const appearanceSections = appearance.locator("details.appearance-center-subsection");
  // 钉**子目录标题**而不是数量：2026-10-02 加「公用效果」（落子交互 / 棋子进场预览）之后
  // 数量从 4 变 5，原来那条只报「数量异常」，看不出是改名还是加项。
  // 2026-10-09 用户要求**把棋盘/棋子/公用特效合成一块、共用一块预览**（三个版面横向切换），
  // 于是 5 段并为 3 段（主题 / 棋盘与棋子 / 声音与音效）—— 三段式是当前的正确形态，
  // 若再改动，请同步这里的期望值，而不是放宽成"只要非空"。
  const appearanceSectionTitles = await appearanceSections.evaluateAll((items) => items.map((item) => (item.querySelector("summary .appearance-center-label b")?.textContent || "").trim()));
  const expectedAppearanceSections = ["主题", "棋盘与棋子", "声音与音效"];
  assert(appearanceSectionTitles.length === expectedAppearanceSections.length, `外观与音效子目录数量异常：${appearanceSectionTitles.length}（${appearanceSectionTitles.join(" / ") || "空"}；应为 ${expectedAppearanceSections.join(" / ")}）`);
  for (const [index, title] of expectedAppearanceSections.entries()) {
    assert(appearanceSectionTitles[index] === title, `外观与音效第 ${index + 1} 个子目录不是「${title}」而是「${appearanceSectionTitles[index] || "（缺）"}」，实际顺序：${appearanceSectionTitles.join(" / ")}`);
  }
  // 快捷中心的三份清单都不再抄第二份：设置页「外观」的材质卡片就是 App 自己认定的在售清单
  // （和快捷中心同源，都出自 src/appearance 的材质数据，但两边的过滤逻辑各写一遍：
  //  QuickDrawer 的 BOARD_OPTIONS/STONE_OPTIONS 与 SettingsPage 的 VisualThemeSettings）。
  // 2026-10-02 材质 id 统一带 `app-` 前缀、又把实验室那 20 多套搬进本体之后，
  // 旧断言里写死的 ["blackgold","pale","kawaii","aurora"] 指的是一个不存在的世界
  //（现在是 app-blackgold…，棋盘 27 项、棋子 30 项；旧断言里的棋子 "gold" 恰恰是**已退役**的）。
  // 这里改成两处清单逐项对齐 + 退役项两边都不许出现。
  // ⚠ 2026-10-09 三版面改造：棋盘/棋子材质现在**一次只渲染一个**（预览下方的「棋盘 / 棋子 / 特效」
  //    横向标签切换），所以不能再"一次 evaluate 收全两份清单"——必须逐个点标签再收。
  //    另外小标题（.visual-theme-label）已按用户要求删掉，清单改按标签页的 aria-label 归位。
  // ⚠ 材质清单是**分页**的（VisualOptionPager 用 scroll-snap，**所有页同时挂在 DOM 里**），
  //    所以一次把每个 `.visual-pager-page` 里的网格都收下来即可，不用点箭头翻页
  //    （点箭头反而可能因平滑滚动未结束而读到旧页）。
  // ⚠ 2026-10-11：选择器从 `.visual-option-grid > button` 改成 **`.visual-option-grid button`**
  //    （去掉直接子代）。原因是材质卡之外又包了一层（卡片本身现在是个 `<button>`，
  //    而 `MaterialOptionButton` 内部还会渲染价格徽章那个 `<button>`），
  //    用 `>` 严格匹配会**一个都收不到**（实测 0 项 → 报"清单塌了"）。
  //    这里要的是"网格里的卡片"，后代选择器才对；下面用 `drawn`/`name` 两条断言保证
  //    收上来的确实是卡片而不是徽章（徽章没有 `span b`、也没有材质 svg）。
  const readMaterialList = async (paneLabel) => {
    // 三版面在「棋盘与棋子」子目录里，而该子目录默认是收起的（上面那条断言还专门验证过
    // "打开外观后子目录不应全部展开"）——点标签前必须先把它展开、并等它真的可见。
    const panesSubsection = appearance.locator('details.appearance-center-subsection:has(> summary .appearance-center-label b:text-is("棋盘与棋子"))');
    if (await panesSubsection.getAttribute("open") === null) await panesSubsection.locator("> summary").click();
    const tab = appearance.locator(`.appearance-pane-tabs > button:text-is("${paneLabel}")`);
    await tab.waitFor({ state: "visible", timeout: 8000 });
    await tab.click();
    await page.waitForTimeout(450);
    const items = await appearance.evaluate((node) => {
      const body = node.querySelector(".appearance-pane-body");
      if (!body) return null;
      // 只认"画着材质、且有名字"的卡片：网格里还有价格徽章那种纯 `<button>`，
      // 用 `span b`（卡片名）与材质 svg 两个特征把它排除掉。
      return [...body.querySelectorAll(".visual-option-grid button")]
        .map((button) => ({
          name: (button.querySelector("span b")?.textContent || "").trim(),
          // 卡片必须真的把材质画出来：BoardChip/StoneChip 出的是 <svg class="material-swatch">。
          // ⚠ 别再用旧的 `i.board-preview` / `.visual-check`：三版面改造后卡片结构变了
          //   （选中态直接体现在 .selected 类上，不再有独立的勾选图标）。
          drawn: Boolean(button.querySelector("svg.material-swatch, svg, i.board-preview, i.stone-preview")),
          selectable: button.classList.contains("selected") || Boolean(button.querySelector(".visual-check")) || String(button.className).includes("is-soul-locked"),
        }))
        // 没有名字的不是卡片（价格徽章等），剔除。
        .filter((item) => item.name);
    });
    // 读完后收回：下面还有一条"外观打开后子目录不应全部展开"的断言，
    // 若这里把子目录留着展开，那条会被我们自己弄挂（本脚本按顺序执行）。
    await panesSubsection.locator("> summary").click();
    await page.waitForTimeout(250);
    return items;
  };
  const appMaterialLists = { 棋盘材质: await readMaterialList("棋盘"), 棋子材质: await readMaterialList("棋子") };
  const compareMaterialList = (label, quickOptions, appCards) => {
    assert(Array.isArray(appCards) && appCards.length > 15, `设置页「${label}」只列出 ${appCards?.length ?? 0} 项材质，清单塌了——两边比对会因空对空而失去意义`);
    assert(quickOptions.length === appCards.length, `快捷中心「${label}」有 ${quickOptions.length} 项，设置页有 ${appCards.length} 项，两处清单不一致`);
    for (const [index, card] of appCards.entries()) {
      assert(card.name, `设置页「${label}」第 ${index + 1} 张卡没有名字`);
      assert(card.drawn && card.selectable, `设置页「${label}」的「${card.name}」卡片没画出材质或缺少选中态`);
      // ⚠ 快捷中心的下拉给未解锁项加装饰（`🔒 琥珀木盘 · 500 棋魂`），设置页的卡片只写名字。
      //    两边**比的是同一份清单**，不是文案格式，所以这里把装饰剥掉再比 ——
      //    否则这条断言会在"棋魂解锁"上线后一直红（实测就是它先红的）。
      const bare = String(quickOptions[index]?.name || "").replace(/^🔒\s*/, "").replace(/\s*·\s*\d+\s*棋魂\s*$/, "").trim();
      assert(bare === card.name, `快捷中心「${label}」第 ${index + 1} 项是「${quickOptions[index]?.name}」，设置页却是「${card.name}」`);
    }
    return appCards.map((card) => card.name);
  };
  compareMaterialList("棋盘材质", quickBoardOptions, appMaterialLists["棋盘材质"]);
  compareMaterialList("棋子材质", quickStoneOptions, appMaterialLists["棋子材质"]);
  for (const id of retiredIdsOf("RETIRED_BOARD_THEMES")) {
    assert(!quickBoardValues.includes(id) && !quickBoardValues.includes(`app-${id}`), `快捷中心的棋盘清单里又出现了已退役的 ${id}`);
  }
  for (const id of retiredIdsOf("RETIRED_STONE_THEMES")) {
    assert(!quickStoneValues.includes(id) && !quickStoneValues.includes(`app-${id}`), `快捷中心的棋子清单里又出现了已退役的 ${id}`);
  }
  assert(await appearanceSections.evaluateAll((items) => items.every((item) => !item.open)), "外观与音效打开后子目录不应全部展开");
  // 子目录同样按小标题锚定，不用 hasText：正文里的说明文字会写到别的子目录名
  // （「公用效果」的 helper 里就有「换任何棋盘、棋子材质都不受影响」这句）。
  const appearanceSectionOf = async (title) => {
    const matched = appearance.locator(`details.appearance-center-subsection:has(> summary .appearance-center-label b:text-is("${title}"))`);
    const found = await matched.count();
    assert(found === 1, `外观与音效下标题为「${title}」的子目录应有且只有 1 个，实际 ${found} 个`);
    return matched.first();
  };
  // ⚠ 2026-10-08：透明度两项从「外观与音效 → 棋盘 / 棋子」搬到了「棋盘显示」区
  // （用户：「把外观、棋盘里面的透明度设置放到棋盘显示的设置里面」），所以下面这段
  // 搜索→展开的路径整体改到新分类；外观那边改验证「不再有透明度滑杆」。
  const boardDisplay = await groupOf("棋盘显示");
  await page.getByLabel("搜索设置").fill("棋盘透明度");
  assert(await groups.filter({ visible: true }).count() === 1, "搜索棋盘透明度后应只显示棋盘显示");
  assert((await groups.filter({ visible: true }).first().innerText()).includes("棋盘显示"), "搜索棋盘透明度未定位到棋盘显示分类");
  assert(await boardDisplay.getAttribute("open") !== null, "搜索棋盘透明度没有自动展开棋盘显示分类");
  await boardDisplay.getByRole("slider", { name: "棋盘透明度" }).waitFor();
  await boardDisplay.getByRole("slider", { name: "棋子透明度" }).waitFor();
  await page.getByRole("button", { name: "清除设置搜索" }).click();
  assert(await groups.count() === groupCount, "清除搜索后分类未恢复");
  // 搜索「棋盘透明度」不该再动「外观与音效」的子目录（命中的分类已经换成棋盘显示）。
  assert(await appearanceSections.evaluateAll((items) => items.every((item) => !item.open)), "清除搜索后外观子目录没有恢复收起");
  // ⚠ getByRole 默认不看折叠起来的内容（`<details>` 收起时子树不进可访问性树），
  // 所以下面这几条计数断言必须**先展开再数**，否则收着数到 0。
  if (await boardDisplay.getAttribute("open") === null) await boardDisplay.locator("> summary").click();
  if (await appearance.getAttribute("open") === null) await appearance.locator("> summary").click();
  // 透明度的两套控件确实**只在**棋盘显示里（外观与音效一节里一份都不许留，
  // 否则同名滑杆会让 getByRole 变歧义、也说明搬家没搬干净）。
  assert(await appearance.getByRole("slider", { name: "棋盘透明度" }).count() === 0, "外观与音效里仍留着棋盘透明度滑杆");
  assert(await appearance.getByRole("slider", { name: "棋子透明度" }).count() === 0, "外观与音效里仍留着棋子透明度滑杆");
  assert(await boardDisplay.getByRole("slider", { name: "棋盘透明度" }).count() === 1, "棋盘显示里棋盘透明度滑杆数量异常");
  assert(await boardDisplay.getByRole("slider", { name: "棋子透明度" }).count() === 1, "棋盘显示里棋子透明度滑杆数量异常");
  const soundSection = await appearanceSectionOf("声音与音效");
  await soundSection.locator(":scope > summary").click();
  // 「音效」面板本身仍在「外观与音效 → 声音与音效」下（音量/落子音色那几个滑杆）。
  await appearance.getByText("启用音效", { exact: true }).waitFor();

  const accessibility = await groupOf("无障碍与反馈");
  if (await accessibility.getAttribute("open") === null) await accessibility.locator("> summary").click();
  // 2026-09-23 分区口径整理：「界面动效」「触觉反馈」「色觉友好配色」从「声音与音效」
  // 搬到了「无障碍与反馈」——它们都是"反馈"而不是"声音"，原先挤在音效里语义不对。
  await accessibility.getByText("界面动效", { exact: true }).waitFor();
  await accessibility.getByText("触觉反馈", { exact: true }).waitFor();
  await accessibility.getByText("色觉友好配色", { exact: true }).waitFor();
  await accessibility.getByRole("radio", { name: /特大字/ }).click();
  await page.waitForFunction(() => localStorage.getItem("banbu-font-scale-v1") === "xlarge");

  // 「关于」两字全文匹配会先命中别的分区（网页环境「AI 引擎」分区的 helper 里就有一句
  // 指向「关于」的说明），所以走上面的 groupOf 按分类小标题锚定。
  const about = await groupOf("关于");
  if (await about.getAttribute("open") === null) await about.locator("> summary").click();
  await about.getByRole("button", { name: /关于半步五子棋打谱/ }).click();
  await page.getByText("检查更新", { exact: true }).waitFor();
  const aboutFocusInside = await page.evaluate(() => Boolean(document.activeElement?.closest(".bottom-sheet")));
  await page.keyboard.press("Escape");
  await page.locator(".bottom-sheet").waitFor({ state: "detached" });

  const help = await groupOf("使用手册与反馈");
  if (await help.getAttribute("open") === null) await help.locator("> summary").click();
  await help.getByRole("button", { name: /使用手册/ }).click();
  await page.getByText("别担心，跟着做一遍就会了", { exact: true }).waitFor();
  await page.locator(".manual-item").filter({ hasText: "第一次打开：先认识主界面" }).first().waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".bottom-sheet").waitFor({ state: "detached" });

  assert(aboutFocusInside, "关于面板打开后焦点未进入 Sheet");

  // 引擎介绍**只该有一份**，就在「关于 → 引擎与模型介绍」那一页（用户 2026-10-01 与
  // 2026-10-02 两次报同一件事：「强力 ai 引擎的介绍怎么又跑出来了…之前早就放关于里面去了」）。
  // 09-30/10-01 那轮的修法是「分区留着、只删分区里复述的介绍正文」，结果安卓用户看到的
  // 仍然是「强力 AI 引擎（本机原生引擎）」标题 + 两张引擎卡——分区本身就是那份介绍。
  // 现在原生环境整个分区 return null（EnginePackSection），网页环境保留分区，因为它带着
  // downloadEnginePack / deleteEnginePack 唯一的 UI。
  // 本门禁跑在桌面浏览器：原生探针恒为 false，够到的只有网页面，所以这里钉三面——
  //   ① 网页面：「AI 引擎」分区在、下载入口在；
  //   ② 原生那一面的文案与状态卡不许出现在设置页任何位置（桌面必然为真，真正把 nativeReady
  //      喂成 true 的断言在 src/features/ai/engine-pack-section.test.tsx，另一面在
  //      scripts/verify-web-deploy.mjs 的 CHECK_STATE 假原生桥里）；
  //   ③ 分区删了不许把出口一起删没：设置里仍要看得见指回介绍页的文字。
  // 用 textContent 而不是 innerText：折叠着的 <details> 里 innerText 取不到。
  const engineSurface = await page.evaluate(() => {
    const flat = (node) => (node?.textContent || "").replace(/\s+/g, " ");
    const groups = [...document.querySelectorAll("details.settings-group")];
    const titleOf = (g) => (g.querySelector(".settings-section-title b")?.textContent || "").trim();
    const packSection = groups.find((g) => titleOf(g) === "AI 引擎");
    const aboutSection = groups.find((g) => titleOf(g) === "关于");
    return {
      settingsText: flat(document.querySelector(".settings-page")),
      packTitleLeaked: groups.some((g) => titleOf(g).includes("强力 AI 引擎")),
      downloadLinks: [...(packSection?.querySelectorAll("button.settings-link b") || [])].map((b) => (b.textContent || "").trim()),
      packExists: Boolean(packSection),
      aboutText: flat(aboutSection),
    };
  });
  assert(engineSurface.packExists, "设置页里没有「AI 引擎」分区（网页环境那份冠军网络包的下载入口就在里面）");
  assert(engineSurface.downloadLinks.some((title) => title.includes("下载")), `引擎分区缺下载入口：${engineSurface.downloadLinks.join(" / ") || "无入口"}`);
  assert(!engineSurface.packTitleLeaked, "设置页里又出现了原生的「强力 AI 引擎」分区（原生环境这一节应整节不渲染）");
  // 注意别把网页面自己合法说的话当成副本删掉：「KataGo 旗舰引擎」那张卡在网页面是存在的
  // （那里它只会是「仅安卓原生环境可用」的未就绪形态），所以下面不列它。
  for (const needle of ["强力 AI 引擎", "本机原生引擎已生效", "两个 AI 引擎"]) {
    assert(!engineSurface.settingsText.includes(needle), `设置页里又出现了一份引擎介绍（「${needle}」——介绍只放在「关于 → 引擎与模型介绍」，原生那一面更是整节都不该渲染）`);
  }
  assert(engineSurface.settingsText.includes("关于 → 引擎与模型介绍"), "设置页的 AI 引擎分区没有指回「关于 → 引擎与模型介绍」");
  // 原生环境没有引擎分区，介绍页在设置里就只剩「关于」那一行指路——它必须一直在。
  assert(engineSurface.aboutText.includes("引擎与模型介绍"), "设置 →「关于」没有指路到「引擎与模型介绍」（原生环境删掉引擎分区后这是唯一出口）");
  if (errors.length) throw new Error(errors.join("\n"));

  console.log(JSON.stringify({
    pass: true,
    groupCount,
    titleLayouts,
    fontScale: await page.evaluate(() => localStorage.getItem("banbu-font-scale-v1")),
    searchRestored: true,
    allCategoryIconsPresent: true,
    aboutFocusInside,
    sheetsCloseWithEscape: true,
    quickThemeCount: quickThemeValues.length,
    quickBoardCount: quickBoardValues.length,
    quickStoneCount: quickStoneValues.length,
    declaredThemeCount: declaredThemes.length,
    appearanceSectionTitles,
    materialBoardCount: quickBoardOptions.length,
    materialStoneCount: quickStoneOptions.length,
  }, null, 2));
} finally {
  await browser.close();
}
