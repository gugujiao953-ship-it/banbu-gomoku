import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 识谱的**输入质量门禁**（用户 09-14 真机反馈「手机少子、错子」的实测固化）。
 *
 * 背景：识别器只看「选择器交给它解码后的那张图」，长边超 1600px 才会被它自己缩放。
 * 用用户真实的两张微信谱图实测出的悬崖：
 *   原图 931×931 / 86–89KB  → 完全正确（43 子 / 36 子且 36 个序号全对）
 *   同尺寸重压 q0.6         → 99 仍正确；98 掉一颗色 + 36 个序号全丢
 *   缩到 600px              → 两张仍与基线完全一致
 *   缩到 500px / 400px      → 开始出错，400px 掉 6–12 颗子
 * 这正是「同一张图、手机与电脑结果不同」的机制候选：微信每次传输都会重压，
 * 手机相册里那份和电脑上那份可以不是同一份字节。
 *
 * 门禁只钉住**保证**，不去钉住已知的脆弱点（否则等于把 bug 写进基线）：
 *   A. 原图必须给出精确局面（位置+颜色，逐颗对照）。
 *   B. 缩到 600px 且高质量 JPEG 时，仍必须与基线逐颗一致（实测鲁棒边界）。
 *   C. 重度退化（q0.6 / 400px）只守子数下限——那一段本来就不可靠，但要防止
 *      整盘崩掉。同时把实测梯队打印出来当台账。
 *
 * 跑法：需要 dev 服务器（模块级导入 /src/image-recognition.ts）
 *   npm run dev -- --port 5173
 *   QA_BASE_URL=http://127.0.0.1:5173/ node qa/recognition-input-quality.mjs
 */
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const fixtureDir = resolve(process.env.RECOGNITION_PARITY_FIXTURES || "qa/fixtures/recognition");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** 用户实测正确的局面（本地按原图跑出，与其网页端结果一致）。 */
const SAMPLES = [
  {
    file: "user-99-43.jpg",
    stones: "43",
    expected: "I12白 H11黑 I11黑 J11黑 K11白 G10黑 I10白 J10白 K10黑 E9白 F9黑 G9白 H9白 J9黑 E8黑 G8白 H8黑 I8白 J8黑 D7白 E7黑 H7白 I7黑 J7白 E6黑 G6白 H6白 I6白 J6黑 E5黑 F5黑 G5黑 H5白 K5白 L5黑 E4白 G4黑 H4白 I4黑 K4黑 H3黑 J3白 I2白",
    numbers: null,
    degradedFloor: 30,
  },
  {
    file: "user-98-36.jpg",
    stones: "36",
    expected: "I12白 H11黑 I11黑 J11黑 K11白 G10黑 I10白 J10白 K10黑 E9白 F9黑 G9白 H9白 J9黑 E8黑 G8白 H8黑 I8白 J8黑 D7白 E7黑 H7白 I7黑 J7白 E6黑 G6白 H6白 I6白 J6黑 G5黑 H5白 K5白 L5黑 G4黑 H4白 H3黑",
    numbers: 36,
    degradedFloor: 24,
  },
];

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
await page.route("**/qa-recognition-host.html", (route) => route.fulfill({
  contentType: "text/html; charset=utf-8",
  body: "<!doctype html><html><head><meta charset=\"utf-8\"><title>input quality host</title></head><body></body></html>",
}));

const ladder = [];
try {
  await page.goto(new URL("qa-recognition-host.html", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  const report = await page.evaluate(async (items) => {
    const mod = await import("/src/image-recognition.ts");
    const out = [];
    for (const item of items) {
      const blob = await (await fetch("data:image/jpeg;base64," + item.b64)).blob();
      const bitmap = await createImageBitmap(blob);
      const recognise = async (file) => {
        const result = await mod.recognizeBoardImage(file, 15, {});
        const stones = [];
        result.board.forEach((row, r) => row.forEach((p, c) => { if (p) stones.push(`${String.fromCharCode(65 + c)}${15 - r}${p === "black" ? "黑" : "白"}`); }));
        return { stoneMap: stones.join(" "), count: stones.length, numbers: result.numberedMoves.length };
      };
      const original = await recognise(new File([blob], item.file, { type: "image/jpeg" }));
      const variants = [];
      for (const [side, quality] of [[null, 0.6], [600, 0.9], [500, 0.9], [400, 0.9]]) {
        const scale = side ? side / Math.max(bitmap.width, bitmap.height) : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const rendered = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
        variants.push({
          label: side ? `${side}px q${quality}` : `${bitmap.width}px q${quality}`,
          ...(await recognise(new File([rendered], `v-${side}-${quality}.jpg`, { type: "image/jpeg" }))),
        });
      }
      out.push({ file: item.file, original, variants });
    }
    return out;
  }, SAMPLES.map((sample) => ({ file: sample.file, b64: readFileSync(resolve(fixtureDir, sample.file)).toString("base64") })));

  for (let index = 0; index < SAMPLES.length; index += 1) {
    const sample = SAMPLES[index];
    const entry = report[index];
    // A：原图必须逐颗精确。
    assert(entry.original.stoneMap === sample.expected,
      `${sample.file} 原图局面与实测基线不一致：得到「${entry.original.stoneMap}」`);
    assert(`${entry.original.count}` === sample.stones, `${sample.file} 原图子数应为 ${sample.stones}，实际 ${entry.original.count}`);
    if (sample.numbers !== null) {
      assert(entry.original.numbers === sample.numbers,
        `${sample.file} 原图应恢复 ${sample.numbers} 个序号，实际 ${entry.original.numbers}`);
    }
    // B/C：缩放与重压的梯队。
    for (const variant of entry.variants) {
      const identical = variant.stoneMap === sample.expected;
      ladder.push(`${sample.file}  ${variant.label.padEnd(14)} ${String(variant.count).padStart(2)} 子 序号${String(variant.numbers).padStart(3)} ${identical ? "与基线一致" : "与基线不同"}`);
      if (variant.label === "600px q0.9") {
        assert(identical, `${sample.file} 缩到 600px 高质量后局面变了（实测该档应与基线一致）：${variant.count} 子`);
      } else {
        assert(variant.count >= sample.degradedFloor,
          `${sample.file} 在 ${variant.label} 下只剩 ${variant.count} 子（下限 ${sample.degradedFloor}）：重度退化把整盘拖崩了`);
      }
    }
    console.log(`[recognition-input-quality] ${sample.file}: 原图 ${entry.original.count} 子${sample.numbers !== null ? ` / 序号 ${entry.original.numbers}` : ""} 精确匹配`);
  }
  console.log("\n实测梯队（台账，非断言）：");
  for (const line of ladder) console.log("  " + line);
  console.log("[recognition-input-quality] pass");
} finally {
  await browser.close();
}
