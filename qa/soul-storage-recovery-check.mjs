import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const url = new URL(base);
url.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
let checks = 0;
let failures = 0;
const check = (label, ok, detail = "") => {
  checks += 1;
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}\n`);
};
const page = await browser.newPage({ viewport: { width: 420, height: 940 } });
await page.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
// onnxruntime 在部分 CPU（本机 cpuinfo_vendor=0）上会把一条 Unknown CPU vendor 警告写到 stderr，
// 浏览器按 console error 报出来。它不影响推理（识谱用例全绿），但不许再冒充"页面出错"。
page.on("console", (message) => { if (message.type() === "error" && !/onnxruntime[\s\S]{0,80}(Unknown CPU vendor|cpuinfo_vendor)/i.test(message.text())) errors.push(message.text()); });
const read = () => page.evaluate(() => ({
  balance: JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]").reduce((total, entry) => total + entry.amount, 0),
  ledger: JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"),
  items: JSON.parse(localStorage.getItem("banbu-vcf-items-v1") || "{}"),
}));
const injectFailure = (mode) => page.evaluate((mode) => {
  const original = window.__storageWriteOriginal || Storage.prototype.setItem;
  window.__storageWriteOriginal = original;
  let inventoryWrites = 0;
  Storage.prototype.setItem = function (key, value) {
    if (key === "banbu-vcf-items-v1" && (mode === "all" || ++inventoryWrites > 1)) throw new DOMException("quota", "QuotaExceededError");
    return original.call(this, key, value);
  };
}, mode);
const restore = () => page.evaluate(() => { Storage.prototype.setItem = window.__storageWriteOriginal; });
const openShop = async () => {
  await page.locator(".bottom-nav button", { hasText: "对弈" }).first().click();
  await page.locator("[data-shop-badge]").first().click();
  await page.locator("[data-shop-panel]").waitFor();
};
const buyHint = async () => {
  await page.locator("[data-shop-item='hint']").click();
  await page.locator("[data-shop-buy-confirm]").click();
};

try {
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav button").first().waitFor({ timeout: 180000 });
  await page.evaluate(() => {
    localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "seed", at: Date.now(), amount: 3000, reason: "manual", detail: "测试本金" }]));
    localStorage.setItem("banbu-vcf-items-v1", JSON.stringify({ hint: 1, undo: 1, "extra-time": 1 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".bottom-nav button").first().waitFor({ timeout: 180000 });
  await openShop();
  const initial = await read();
  await injectFailure("all");
  await buyHint();
  let state = await read();
  check("preflight storage failure does not debit", state.balance === initial.balance);
  check("preflight failure does not grant an item", state.items.hint === 1);
  check("shop displays storage failure accurately", (await page.locator(".soul-buy-error").textContent()).includes("存储"));
  await restore();
  await page.locator("[data-shop-buy-confirm]").click();
  state = await read();
  check("retry completes one purchase", state.items.hint === 2 && state.balance === initial.balance - 30);
  await injectFailure("after-preflight");
  await buyHint();
  state = await read();
  check("failure after debit records a pending delivery", state.items.hint === 2 && state.ledger.some((entry) => entry.pendingPurchases?.length));
  check("shop reports a paid pending delivery", (await page.locator(".soul-buy-error").textContent()).includes("已扣费"));
  await restore();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openShop();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("banbu-vcf-items-v1") || "{}").hint === 3);
  state = await read();
  check("React subscription recovers pending item once", state.items.hint === 3 && state.balance === initial.balance - 60);
  check("recovered ledger has no pending deliveries", !state.ledger.some((entry) => entry.pendingPurchases?.length));
  await page.keyboard.press("Escape");
  await page.locator("[data-duel-entry='vcf'] button").first().click();
  await page.locator("[data-vcf-items]").waitFor({ timeout: 60000 });
  await page.locator(".vcfch-bottom button", { hasText: "开始挑战" }).click();
  await page.locator("[data-vcf-stone]").first().waitFor({ timeout: 60000 });
  await injectFailure("all");
  const timeBefore = Number(await page.locator(".vcfch-clock b").textContent());
  await page.locator("[data-vcf-item='extra-time'] .vcfch-item-use").click();
  const timeAfter = Number(await page.locator(".vcfch-clock b").textContent());
  check("failed item persistence gives no extra time", timeAfter <= timeBefore && timeAfter >= timeBefore - 3);
  await page.locator("[data-vcf-item='hint'] .vcfch-item-use").click();
  check("failed item persistence gives no hint", await page.locator("[data-vcf-hint]").count() === 0);
  check("failed item use keeps stock", (await read()).items.hint === 3 && (await read()).items["extra-time"] === 1);
  await restore();
  await page.locator("[data-vcf-item='hint'] .vcfch-item-use").click();
  check("retry hint applies and consumes one card", await page.locator("[data-vcf-hint]").count() === 1 && (await read()).items.hint === 2);
  check("no React or page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}
process.stdout.write(`\n${checks - failures}/${checks} PASS\n`);
process.exitCode = failures ? 1 : 0;
