import { chromium } from "playwright";

// 常驻门禁：外部文件进入应用（用户 2026-09-23 文件关联）
//
// 这条门禁**验不了原生**（真机上点文件能不能打开只能装包手点），它验的是「文件进到网页层
// 之后的接线是不是真的通」——也就是原生文件关联最容易失败的下一半：
//   F1 .sgf 从外部进来 → 进导入流程（不是被静默忽略）
//   F2 图片进来 → 进图片识谱（不是被当成棋谱解析）
//   F3 不支持的扩展名 → 明确说「不支持」，而不是静默失败
//   F4 拖拽 .sgf 也能进（此前拖拽只认图片，棋谱会被静默丢掉——本轮一并修掉）
//   F5 多份棋谱一次进来 → 全部处理
//   F2 图片 → 进图片识谱（而不是被当棋谱解析）
//   F3 不支持的格式 → 明确提示（不是静默失败）
//   Z  全程零 pageerror
//
// 用法：BANBU_URL=http://127.0.0.1:5321 node qa/incoming-files-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5321/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

// 一个最小的合法 SGF（黑 H8 / 白 I9），带正确的手数以便走完整解析。
const SGF = "(;GM[1]FF[4]SZ[15]CA[UTF-8];B[hh];W[ii])";
const sgfFile = (name) => ({ name, mimeType: "application/x-go-sgf", buffer: Buffer.from(SGF, "utf8") });

/** 走「拖拽」这条路投递文件：这是网页层真实可触发的外部文件入口。 */
const dropFiles = async (files) => page.evaluate(async (encoded) => {
  const transfer = new DataTransfer();
  for (const item of encoded) {
    const binary = atob(item.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    transfer.items.add(new File([bytes], item.name, { type: item.mimeType }));
  }
  window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
}, files.map((file) => ({ name: file.name, mimeType: file.mimeType, base64: file.buffer.toString("base64") })));

const toastText = async () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((el) => el.textContent || "").join(" | "));
// 导入成功的判据用「状态条上的总手数」与「棋谱库份数」——不是棋盘上的棋子数。
// 导入后应用停在**起始局面**（第 0 手），所以棋盘上本来就是 0 颗子，拿它当判据会假失败。
// 状态条有多行（第一行是规则/棋手，手数在后面的行），所以要遍历全部行再取匹配。
const totalMoves = async () => {
  const lines = await page.evaluate(() => [...document.querySelectorAll(".unified-status-line")].map((el) => el.textContent || ""));
  for (const line of lines) {
    const matched = /第\s*(\d+)\s*手\s*\/\s*(\d+)/.exec(line);
    if (matched) return Number(matched[2]);
  }
  return 0;
};
const libraryCount = async () => page.evaluate(() => JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]").length);

// ── F1 拖入 .sgf → 进导入流程 ───────────────────────────
await dropFiles([sgfFile("门禁样例.sgf")]);
await page.waitForTimeout(2800);
check("F1 外部 .sgf 已导入（状态条读到 2 手）", (await totalMoves()) === 2, `总手数=${await totalMoves()}`);
check("F1 未报「不支持」", !(await toastText()).includes("不支持"), await toastText());


// ── F2 送一张图片 → 进图片识谱（不是被当成棋谱解析）──────
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
await dropFiles([{ name: "棋盘截图.png", mimeType: "image/png", buffer: PNG_1X1 }]);
await page.waitForTimeout(1800);
// 识谱入口是「对齐屏 / imageImport 浮层」；出现它就说明走对了管线。
// 识谱入口是 BoardAlignScreen（全屏对齐屏，根元素 .board-fs，经 portal 挂在 body 上）。
const imageSheetOpen = await page.evaluate(() => Boolean(document.querySelector(".board-fs")));
check("F2 图片进入识谱流程（打开对齐屏）", imageSheetOpen, imageSheetOpen ? "对齐屏已开" : "没找到 .board-fs");
check("F2 图片没被当成棋谱导入", !(await toastText()).includes("已导入 SGF"), await toastText());
await page.keyboard.press("Escape");
await page.waitForTimeout(700);

// ── F3 不支持的扩展名 → 明确说不支持，而不是静默失败 ────
await dropFiles([{ name: "说明文档.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("not a record", "utf8") }]);
await page.waitForTimeout(1800);
check("F3 不支持的格式有明确提示（不静默失败）", (await toastText()).includes("不支持"), (await toastText()).slice(0, 120));

// ── F5 一次送两份棋谱 → 两份都要入库 ────────────────────
const before = await libraryCount();
await dropFiles([sgfFile("门禁甲.sgf"), sgfFile("门禁乙.sgf")]);
await page.waitForTimeout(3400);
const after = await libraryCount();
check("F5 多份棋谱都被处理（不是只看第一份）", after >= before + 2, `库内 ${before} → ${after} 份`);
check("Z 无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(failed ? `\n${failed} 项未通过` : "\n全部通过（注：原生文件关联需真机确认，见 docs/Android发布流程.md）");
await browser.close();
process.exit(failed ? 1 : 0);
