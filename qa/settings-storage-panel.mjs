import { chromium } from "playwright";

/**
 * 「文件与存储」储存位置门禁。
 *
 * 用户在 2026-09-13 明确否决了「手填导出路径」的做法：安卓端必须弹系统文件夹
 * 选择器（SAF），而不是让用户自己敲路径。这个门禁把该交互固化下来：
 *   1. 面板里不允许出现任何可输入的文本框；
 *   2. 安卓端按钮必须是「选择文件夹」，并给出默认位置说明；
 *   3. 网页端保留「选择 / 更换」的目录授权按钮；
 *   4. 设置搜索必须能搜到「储存位置 / 文件夹」。
 *
 * 2026-09-14 补场景三/四/五（用户报「选完文件夹路径行不变 / 文件仍落到默认位置」，
 * 以及「默认放到下载文件夹，设备没有就退回文档」）：
 * 浏览器里用**假原生桥**把安卓分支跑起来（PluginHeaders 声明插件 + androidBridge
 * 让 Capacitor 判定平台为 android + 注入 nativePromise，Capacitor 的 web 运行时
 * 只读不覆盖它），断言：
 *   5. 选完文件夹，路径行跟着变成所选位置（原实现是写死的默认位置文案）；
 *   6. 重选时把当前文件夹作为系统选择器的起始位置（initialUri）；
 *   7. 导出真的写进所选文件夹（writeFile 的 uri 是所选那个，而不是默认位置）；
 *   8. 重载后仍记得所选文件夹（授权校验通过）；
 *   9. 默认位置优先公共「下载」目录（MediaStore 写 writeFileToDownloads，带子文件夹）；
 *  10. 设备没有公共下载目录（API < 29）时退回「文档」（Filesystem.writeFile + DOCUMENTS）。
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const errors = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** 假 SAF 文件夹：uri 用真实 Android 树 Uri 形状，location 是插件会返回的目录描述。 */
const FAKE_FOLDER = {
  uri: "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2F%E6%A3%8B%E8%B0%B1",
  name: "棋谱",
  location: "Documents/棋谱",
};
const EXPORT_FOLDER = "半步五子棋打谱/导出";

const newMobileContext = async (initScript, arg) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
  if (initScript) await context.addInitScript(initScript, arg);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  return { context, page };
};

/** 假原生桥：声明 ExportDirectory / Filesystem 两个插件的方法，全部由 nativePromise 应答。
 *  这样「插件/系统能力」在浏览器里可控，安卓分支不再只能靠真机验证。 */
const FAKE_BRIDGE = (options) => {
  window.androidBridge = {};
  window.__pluginCalls = [];
  const methods = (names) => names.map((name) => ({ name, rtype: "promise" }));
  window.Capacitor = {
    PluginHeaders: [
      { name: "ExportDirectory", methods: methods(["chooseDirectory", "checkDirectory", "releaseDirectory", "writeFile", "checkDownloads", "writeFileToDownloads"]) },
      { name: "Filesystem", methods: methods(["writeFile", "checkPermissions", "requestPermissions", "readFile", "mkdir", "stat"]) },
    ],
    nativePromise: (plugin, method, callOptions) => {
      window.__pluginCalls.push({ plugin, method, options: callOptions });
      if (plugin === "ExportDirectory") {
        if (method === "checkDownloads") return Promise.resolve({ available: options.downloadsAvailable });
        if (method === "chooseDirectory") return Promise.resolve(options.folder);
        if (method === "checkDirectory") return Promise.resolve({ granted: true, name: options.folder.name, location: options.folder.location });
        return Promise.resolve({});
      }
      if (plugin === "Filesystem") {
        if (method === "checkPermissions") return Promise.resolve({ publicStorage: "granted" });
        if (method === "requestPermissions") return Promise.resolve({ publicStorage: "granted" });
        return Promise.resolve({ uri: "file:///fake" });
      }
      return Promise.resolve({});
    },
  };
};

const openStoragePanel = async (page) => {
  await page.getByRole("button", { name: "设置" }).click();
  const group = page.locator(".settings-group").filter({ hasText: "文件与存储" });
  await group.locator("summary").click();
  await page.waitForTimeout(1200);
  return group;
};

const readPanel = (group) => group.evaluate((node) => ({
  text: node.innerText,
  usage: node.querySelector(".storage-usage")?.textContent ?? null,
  path: node.querySelector(".storage-path")?.textContent ?? null,
  action: node.querySelector(".storage-action")?.textContent ?? null,
  remove: node.querySelector(".storage-remove")?.textContent ?? null,
  inputs: node.querySelectorAll("input[type=text], input:not([type])").length,
}));

/** 顶部导出入口 → 整份棋谱 → SGF。格式按钮的可访问名是「SGFSGF」这种拼接（按钮里
 *  标签出现两次），所以按前缀匹配而不是全名。 */
const exportSgf = async (page) => {
  await page.getByRole("button", { name: "打开导出方式" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "整份棋谱" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^SGF/ }).click();
  await page.waitForTimeout(1500);
};

const placeTwoStones = async (page) => {
  await page.getByRole("button", { name: "打谱" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("gridcell", { name: "H8空位" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("gridcell", { name: "I9空位" }).click();
  await page.waitForTimeout(300);
};

try {
  // ---- 场景一：网页端（不应出现路径行，也不应有文本框）----------------------
  const web = await newMobileContext(null);
  await web.page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const webPanel = await readPanel(await openStoragePanel(web.page));
  assert(webPanel.text.includes("应用内数据"), "文件与存储面板缺少「应用内数据」说明");
  assert(webPanel.text.includes("导出位置"), "文件与存储面板缺少「导出位置」");
  assert(webPanel.usage, "文件与存储面板没有显示已用空间");
  assert(webPanel.inputs === 0, `网页端面板出现了可输入路径文本框（${webPanel.inputs} 个）`);
  assert(webPanel.path === null, "网页端不应显示安卓默认位置提示");
  assert(["选择", "更换"].includes(webPanel.action ?? ""), `网页端导出按钮文案异常：${webPanel.action}`);
  await web.context.close();

  // ---- 场景二：安卓端未选择，且设备没有公共下载目录（退回文档）--------------
  const native = await newMobileContext(() => { window.androidBridge = {}; });
  await native.page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const nativePanel = await readPanel(await openStoragePanel(native.page));
  assert(nativePanel.inputs === 0, `安卓端面板出现手填路径文本框（${nativePanel.inputs} 个）`);
  assert(nativePanel.action === "选择文件夹", `安卓端导出按钮应为「选择文件夹」，实际为「${nativePanel.action}」`);
  assert(nativePanel.text.includes("系统文件夹选择器"), "安卓端没有说明会打开系统文件夹选择器");
  assert((nativePanel.path ?? "").includes("文档 / 半步五子棋打谱 / 导出"), `安卓端没有显示默认位置：${nativePanel.path}`);
  assert(nativePanel.remove === null, "未选择文件夹时不应出现「恢复默认位置」");

  await native.page.getByPlaceholder("搜索设置").fill("文件夹");
  await native.page.waitForTimeout(300);
  const searched = await native.page.locator(".settings-group").evaluateAll((nodes) => nodes
    .filter((node) => node.offsetParent !== null)
    .map((node) => node.querySelector("summary b")?.textContent ?? ""));
  assert(searched.includes("文件与存储"), `搜索「文件夹」没有命中文件与存储，实际命中：${searched.join("/") || "无"}`);
  await native.context.close();

  // ---- 场景三：默认位置 = 公共下载目录（MediaStore），导出走 writeFileToDownloads
  const downloads = await newMobileContext(FAKE_BRIDGE, { downloadsAvailable: true, folder: FAKE_FOLDER });
  await downloads.page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const downloadsPanel = await readPanel(await openStoragePanel(downloads.page));
  assert(downloadsPanel.action === "选择文件夹", `设备支持下载目录时按钮应为「选择文件夹」，实际为「${downloadsPanel.action}」`);
  assert((downloadsPanel.path ?? "").includes(`下载 / ${EXPORT_FOLDER.split("/").join(" / ")}`), `默认位置没有指向下载目录：${downloadsPanel.path}`);
  await placeTwoStones(downloads.page);
  await exportSgf(downloads.page);
  const downloadWrites = await downloads.page.evaluate(() => window.__pluginCalls.filter((call) => call.method === "writeFileToDownloads"));
  assert(downloadWrites.length === 1, `默认导出没有写入下载目录（writeFileToDownloads 调用 ${downloadWrites.length} 次）`);
  assert(downloadWrites[0].options?.folder === EXPORT_FOLDER, `下载目录里的子文件夹不对：${downloadWrites[0].options?.folder}`);
  assert(/\.sgf$/.test(downloadWrites[0].options?.filename ?? ""), `下载目录文件名异常：${downloadWrites[0].options?.filename}`);
  const noDocumentsWrite = await downloads.page.evaluate(() => window.__pluginCalls.filter((call) => call.plugin === "Filesystem" && call.method === "writeFile").length);
  assert(noDocumentsWrite === 0, `默认位置已是下载目录，却又写了文档目录 ${noDocumentsWrite} 次`);
  await downloads.context.close();

  // ---- 场景四：设备没有公共下载目录 → 退回文档（Filesystem + DOCUMENTS）-----
  const legacy = await newMobileContext(FAKE_BRIDGE, { downloadsAvailable: false, folder: FAKE_FOLDER });
  await legacy.page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const legacyPanel = await readPanel(await openStoragePanel(legacy.page));
  assert((legacyPanel.path ?? "").includes("文档 / 半步五子棋打谱 / 导出"), `下载目录不可用时没有退回文档默认位置：${legacyPanel.path}`);
  await placeTwoStones(legacy.page);
  await exportSgf(legacy.page);
  const legacyWrites = await legacy.page.evaluate(() => window.__pluginCalls.filter((call) => call.plugin === "Filesystem" && call.method === "writeFile"));
  assert(legacyWrites.length === 1, `退回文档后没有走 Filesystem.writeFile（调用 ${legacyWrites.length} 次）`);
  assert(legacyWrites[0].options?.directory === "DOCUMENTS", `退回文档后目录不是 DOCUMENTS：${legacyWrites[0].options?.directory}`);
  assert((legacyWrites[0].options?.path ?? "").includes(EXPORT_FOLDER), `退回文档后路径不含导出子文件夹：${legacyWrites[0].options?.path}`);
  await legacy.context.close();

  // ---- 场景五：真的走一遍「选择文件夹 → 导出 → 重载」------------------------
  const picker = await newMobileContext(FAKE_BRIDGE, { downloadsAvailable: true, folder: FAKE_FOLDER });
  await picker.page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const pickerGroup = await openStoragePanel(picker.page);
  const picks = () => picker.page.evaluate(() => window.__pluginCalls.filter((call) => call.method === "chooseDirectory"));
  const safWrites = () => picker.page.evaluate(() => window.__pluginCalls.filter((call) => call.method === "writeFile"));

  await picker.page.getByRole("button", { name: "选择文件夹" }).click();
  await picker.page.waitForTimeout(900);
  const pickedPanel = await readPanel(pickerGroup);
  assert(pickedPanel.text.includes("已设置"), "选完文件夹后没有显示「已设置」");
  assert(pickedPanel.path === `当前文件夹：${FAKE_FOLDER.location}`, `选完文件夹后路径行没跟着变：${pickedPanel.path}`);
  assert((pickedPanel.remove ?? "").includes("恢复默认位置"), "选完文件夹后没有出现「恢复默认位置」");
  const firstPicks = await picks();
  assert(firstPicks.length === 1, `首次选择文件夹的插件调用次数异常：${firstPicks.length}`);
  assert(firstPicks[0].options?.initialUri === undefined, `首次选择不该带起始位置：${firstPicks[0].options?.initialUri}`);

  // 重选：应把当前文件夹交给系统选择器当起点（否则每次从「文档」翻起）。
  await picker.page.getByRole("button", { name: "更换文件夹" }).click();
  await picker.page.waitForTimeout(900);
  const secondPicks = await picks();
  assert(secondPicks.length === 2, `重选文件夹的插件调用次数异常：${secondPicks.length}`);
  assert(secondPicks[1].options?.initialUri === FAKE_FOLDER.uri, `重选没有把当前文件夹作为选择器起点：${secondPicks[1].options?.initialUri}`);

  // 导出必须写进所选的文件夹（用户症状：文件仍落到默认位置）。
  await placeTwoStones(picker.page);
  await exportSgf(picker.page);
  const exportWrites = await safWrites();
  assert(exportWrites.length === 1, `导出没有写入所选文件夹（writeFile 调用 ${exportWrites.length} 次）`);
  assert(exportWrites[0].options?.uri === FAKE_FOLDER.uri, `导出写到了别的文件夹：${exportWrites[0].options?.uri}`);
  assert(/\.sgf$/.test(exportWrites[0].options?.filename ?? ""), `导出文件名异常：${exportWrites[0].options?.filename}`);

  // 重载后应记得所选文件夹（授权校验通过 → 面板仍显示「已设置」）。
  await picker.page.reload({ waitUntil: "domcontentloaded" });
  await picker.page.waitForTimeout(1600);
  const reloadedPanel = await readPanel(await openStoragePanel(picker.page));
  assert(reloadedPanel.text.includes("已设置"), "重载后忘掉了所选文件夹（授权校验未通过）");
  assert(reloadedPanel.path === `当前文件夹：${FAKE_FOLDER.location}`, `重载后路径行不对：${reloadedPanel.path}`);
  await picker.context.close();

  assert(errors.length === 0, `页面出现错误：${errors.join(" | ")}`);
  console.log(JSON.stringify({
    ok: true,
    web: { action: webPanel.action, usage: webPanel.usage },
    native: { action: nativePanel.action, defaultPath: nativePanel.path },
    downloadsDefault: { path: downloadsPanel.path, target: downloadWrites[0].options?.folder },
    documentsFallback: { path: legacyPanel.path, target: legacyWrites[0].options?.path },
    picker: { path: pickedPanel.path, initialUriOnRepick: secondPicks[1].options?.initialUri, exportTarget: exportWrites[0].options?.uri },
  }, null, 2));
} finally {
  await browser.close();
}
