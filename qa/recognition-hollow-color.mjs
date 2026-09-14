import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 柔化/异设备下的**颜色稳定性**门禁（用户 09-14 真机反馈：手机上「之前缺的那几个
 * 白子变成了黑子」）。
 *
 * 机制：印谱空心白子的「前景色」统计到的是那圈细描边（深色）。2-means 聚类在
 * `darkDiscShare >= 0.3` 时会改用「前景最暗四分位」作为聚类输入，于是柔化只要把
 * 这项推过 0.3，白子就被判进黑簇——桌面清晰图能对纯属阈值侥幸，不是判据。
 * 修法见 image-recognition.ts 的颜色判定分支（空心签名 + 前景中值够亮 ⇒ 白）。
 *
 * 门禁守两件相反的事：
 *   A. **柔化不翻色**：真实印谱图（paper02）清晰导入与 0.8/1/1.4px 柔化导入，局面
 *      （位置+颜色）必须完全一致。1px 柔化正是线上手机现象的本地复现（改前
 *      paper02 22黑/21白 → 24黑/19白）。只对真实截图断言：heavyborder.png 这类
 *      合成边界图在柔化下连**检出**都会崩（84 子掉到 12 子，与颜色无关），
 *      把它拉进不变性断言只会掩盖真正的问题。
 *   B. **不许过度翻白**：带白色序号的实心黑子也会命中「空心签名」（盘内被白字
 *      挖空），一度让 heavyborder 从 36黑/48白 变成 2黑/82白。这里用黑子数量下限
 *      把这条守住——规则再怎么调，实心黑子都不许被刷成白的。
 *
 * 跑法：需要 dev 服务器（模块级导入 /src/image-recognition.ts）
 *   npm run dev -- --port 5173
 *   QA_BASE_URL=http://127.0.0.1:5173/ node qa/recognition-hollow-color.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const fixtureDir = resolve(process.env.RECOGNITION_PARITY_FIXTURES || "qa/fixtures/recognition");
// 柔化 + 变暗两类都要盖：判据曾经用绝对亮度阈值（foregroundLight >= 128），在
// blur+brightness(0.75) 下空心白子只剩 12 点余量；改成相对量后 brightness(0.65)
// 也稳。变暗变体正是当年那条细余量所在，必须留在门禁里。
const SOFTEN_KERNELS = ["blur(0.8px)", "blur(1px)", "blur(1.4px)", "blur(1px) brightness(0.75)", "blur(1px) brightness(0.65)"];
/** 柔化不变性用例：真实印谱图（手机症状的本地复现）。 */
const SOFTEN_CASES = [{ name: "paper02.jpg", blackFloor: 15 }];
/** 反过度翻白用例：实心黑子多的图，只在清晰图上检查黑子下限。 */
const SOLID_CASES = [{ name: "heavyborder.png", blackFloor: 30 }];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
await page.route("**/qa-recognition-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"><title>hollow colour host</title></head><body></body></html>",
}));

try {
  await page.goto(new URL("qa-recognition-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  const cases = [...SOFTEN_CASES, ...SOLID_CASES].map((item) => ({
    name: item.name,
    blackFloor: item.blackFloor,
    soften: SOFTEN_CASES.some((entry) => entry.name === item.name),
    b64: readFileSync(resolve(fixtureDir, item.name)).toString("base64"),
  }));
  const report = await page.evaluate(async ({ items, kernels }) => {
    const mod = await import("/src/image-recognition.ts");
    const out = [];
    for (const item of items) {
      const source = await createImageBitmap(await (await fetch("data:image/jpeg;base64," + item.b64)).blob());
      const runs = [];
      for (const filter of item.soften ? ["", ...kernels] : [""]) {
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (filter) ctx.filter = filter;
        ctx.drawImage(source, 0, 0);
        ctx.filter = "none";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
        const result = await mod.recognizeBoardImage(new File([blob], `${item.name}-${filter || "clean"}.jpg`, { type: "image/jpeg" }), 15, { skipMoveOrder: true });
        const flat = result.board.flat().filter(Boolean);
        runs.push({
          filter: filter || "clean",
          black: flat.filter((player) => player === "black").length,
          white: flat.filter((player) => player === "white").length,
          total: flat.length,
          fingerprint: JSON.stringify(result.board),
        });
      }
      out.push({ name: item.name, blackFloor: item.blackFloor, soften: item.soften, runs });
    }
    return out;
  }, { items: cases, kernels: SOFTEN_KERNELS });

  for (const entry of report) {
    const [clean, ...softened] = entry.runs;
    for (const run of softened) {
      // A：柔化/变暗后局面必须与清晰图完全一致（位置与颜色）。
      assert(run.fingerprint === clean.fingerprint,
        `${entry.name} 在 ${run.filter} 下局面变了：清晰 ${clean.black}黑/${clean.white}白 → ${run.black}黑/${run.white}白`);
    }
    // B：实心黑子不许被刷白。
    assert(clean.black >= entry.blackFloor,
      `${entry.name} 黑子只剩 ${clean.black} 个（下限 ${entry.blackFloor}）：颜色规则把实心黑子判成白子了`);
    const detail = entry.soften
      ? `${SOFTEN_KERNELS.length} 个柔化/变暗变体局面一致`
      : "仅清晰图（合成边界图柔化下检出会崩，不在本门禁范围）";
    console.log(`[recognition-hollow-color] ${entry.name}: 清晰 ${clean.black}黑/${clean.white}白，${detail}`);
  }
  console.log("[recognition-hollow-color] pass");
} finally {
  await browser.close();
}
