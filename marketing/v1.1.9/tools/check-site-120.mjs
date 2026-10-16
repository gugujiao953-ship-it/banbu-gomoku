/** 验收 1.2.0 宣传页：版本串、更新条目数、各处新功能文案，另存两张图 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIR = "D:/Projects/五子棋2/marketing/v1.2.0/site";
const OUT = "D:/Projects/五子棋2/marketing/v1.1.9/current-stills";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)); });
await page.goto(pathToFileURL(DIR + "/index.html").href, { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const txt = (document.body.innerText || "");
  return {
    标题: document.title,
    版本出现: [...new Set(txt.match(/1\.[12]\.\d[.\d]*/g) || [])].join(" "),
    更新条数: document.querySelectorAll("#sec03 [data-log], #sec03 .log-row, #sec03 .log").length,
    关键词: ["棋魂", "成就", "道具卡", "自定义开局", "每日一题", "VCF"].map((k) => k + (txt.includes(k) ? "✓" : "✗")).join(" "),
  };
});
console.log(JSON.stringify(info, null, 1));

/* 折叠展开的分区：直接滚到 changelog */
await page.evaluate(() => document.getElementById("sec03")?.scrollIntoView());
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, "90-site-changelog.png") });
await page.evaluate(() => document.getElementById("hero")?.scrollIntoView());
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, "91-site-hero.png") });
console.log("已存 90-site-changelog.png / 91-site-hero.png");
console.log("报错:", errs.length ? errs.join(" | ") : "无");
await browser.close();
process.exit(0);
