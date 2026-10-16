import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "current-stills");
const RECOGNITION_FIXTURE = path.resolve("qa/fixtures/recognition/app-played-game.png");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
  colorScheme: "light",
  reducedMotion: "reduce",
  serviceWorkers: "block",
});
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-onboarding-tour-v1", "seen");
  /* dev 构建会自动挂调试桥，屏幕底部有一条绿色 DIAG 条（<pre data-tempdiag>）。
     抓图时只把它隐藏，产品 UI 一点不动。 */
  const hide = () => {
    const s = document.createElement("style");
    s.textContent = "[data-tempdiag]{display:none !important}";
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.head) hide();
  else document.addEventListener("DOMContentLoaded", hide);
});
const page = await context.newPage();
page.setDefaultTimeout(9000);
page.setDefaultNavigationTimeout(30000);
const failures = [];
page.on("pageerror", (error) => console.log("pageerror", String(error).slice(0, 240)));
page.on("console", (message) => {
  if (message.type() === "error") console.log("console-error", message.text().slice(0, 240));
});

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false, timeout: 30000 });
  console.log("shot", name);
};
const wait = (ms) => page.waitForTimeout(ms);
const nav = async (name) => {
  await page.getByRole("button", { name, exact: true }).last().click({ force: true });
  await wait(500);
};
const boot = async () => {
  await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 30000 });
  await wait(650);
  // The app may restore the last open sheet from the prior capture step.
  // Close only visible overlays so each shot starts from a deterministic page.
  for (let i = 0; i < 3; i += 1) {
    const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
    if (!(await close.count())) break;
    await close.click({ force: true }).catch(() => {});
    await wait(250);
  }
};
const step = async (name, fn) => {
  try {
    console.log("step", name);
    await fn();
  } catch (error) {
    const message = String(error?.message || error).split("\n")[0];
    failures.push(`${name}: ${message}`);
    console.log("FAIL", name, message);
  }
};

if (process.env.CAPTURE_ONLY === "engine") {
  await step("engine-model-info", async () => {
    await boot();
    await page.locator("nav.bottom-nav button").filter({ hasText: "设置" }).last().click({ force: true });
    await wait(700);
    const about = page.locator("details.settings-collapsible").filter({ hasText: "关于" }).last();
    await about.waitFor({ timeout: 15000 });
    if ((await about.getAttribute("open")) === null) await about.locator(":scope > summary").click({ force: true });
    const aboutLink = about.getByRole("button", { name: /关于半步五子棋打谱/ });
    await aboutLink.waitFor({ timeout: 15000 });
    await aboutLink.evaluate((element) => (element instanceof HTMLElement ? element.click() : undefined));
    const aboutDialog = page.getByRole("dialog", { name: "关于半步五子棋打谱" });
    await aboutDialog.waitFor({ timeout: 15000 });
    await aboutDialog.locator('[data-about-entry="engine"]').click({ force: true });
    await wait(700);
    await shot("16-engine-model-info.png");
  });
  await context.close();
  await browser.close();
  console.log("done", JSON.stringify({ output: OUT, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} else {

await step("home", async () => {
  await boot();
  await shot("00-home.png");
});

await step("duel-home", async () => {
  await boot();
  await nav("对弈");
  await page.locator("[data-duel-page]").waitFor();
  await shot("01-duel-home.png");
});

await step("ai-setup-and-playing", async () => {
  await boot();
  await nav("对弈");
  await page.getByRole("button", { name: "开始 AI 对战", exact: true }).click({ force: true });
  await page.getByRole("dialog", { name: "AI 人机对战" }).waitFor();
  await shot("02-ai-setup.png");
  await page.getByRole("button", { name: "开始人机对战", exact: true }).click({ force: true });
  const draft = page.getByRole("dialog", { name: "未保存草稿" });
  if (await draft.isVisible().catch(() => false)) await draft.getByRole("button", { name: "放弃草稿并切换", exact: true }).click({ force: true });
  await page.locator("[data-duel-screen]").waitFor({ timeout: 30000 });
  await wait(1300);
  await shot("03-ai-playing.png");
  const cell = page.locator('[role="gridcell"][aria-label^="H8"]').first();
  if (await cell.isVisible().catch(() => false)) {
    await cell.dispatchEvent("click");
    await wait(350);
    await shot("03b-ai-thinking.png");
    await wait(2200);
    await shot("03c-ai-response.png");
  }
});

await step("vcf-challenge", async () => {
  await boot();
  await nav("对弈");
  await page.getByRole("button", { name: "开始 VCF 挑战", exact: true }).click({ force: true });
  await page.locator(".vcfch-page").waitFor({ timeout: 15000 });
  await shot("04-vcf-setup.png");
  await page.getByRole("button", { name: "开始挑战", exact: true }).click({ force: true });
  await wait(900);
  await shot("05-vcf-challenge.png");
});

await step("puzzle-generator", async () => {
  await boot();
  await nav("对弈");
  await page.getByRole("button", { name: "打开棋题生成器", exact: true }).click({ force: true });
  await page.getByText("棋题生成器", { exact: true }).first().waitFor();
  await shot("06-vcf-generator.png");
  await page.getByRole("button", { name: "生成新题", exact: true }).click({ force: true });
  await wait(1800);
  await shot("07-vcf-generated.png");
});

await step("image-recognition-verify", async () => {
  await boot();
  await nav("打谱");
  await page.locator(".bottom-nav .nav-center").click({ force: true });
  const importDialog = page.getByRole("dialog", { name: "选择导入方式" });
  await importDialog.waitFor();
  await shot("08-import-formats.png");
  await importDialog.locator("button.import-choice").filter({ hasText: "图片识谱" }).click({ force: true });
  await page.locator('input[type="file"][accept*="image"]').first().setInputFiles(RECOGNITION_FIXTURE);
  await page.locator(".board-fs-actions").waitFor({ timeout: 20000 });
  await wait(500);
  await shot("09-image-align.png");
  await page.locator(".board-fs-actions button").filter({ hasText: "识别" }).click({ force: true });
  await page.locator(".image-verify").waitFor({ timeout: 120000 });
  await wait(800);
  await shot("10-image-verify.png");
  const localRestore = page.locator("button[data-local-restore]");
  if (await localRestore.isVisible().catch(() => false)) {
    await localRestore.click({ force: true });
    await wait(3200);
    await shot("10b-image-restore-order.png");
  }
  const edit = page.locator(".image-verify-modes button").filter({ hasText: "编辑" }).first();
  if (await edit.isVisible().catch(() => false)) {
    await edit.click({ force: true });
    await wait(400);
    await shot("11-image-verify-edit.png");
  }
});

await step("record-branches", async () => {
  await boot();
  await nav("打谱");
  const moves = ["H8", "I9", "G7", "J10", "F6", "K11"];
  for (const coord of moves) {
    const cell = page.locator(`[role="gridcell"][aria-label^="${coord}"]`).first();
    await cell.dispatchEvent("click");
    await wait(180);
  }
  await shot("14-board-sequence.png");
  const branches = page.getByRole("button", { name: "打开分支树", exact: true }).first();
  if (await branches.isVisible().catch(() => false)) {
    await branches.click({ force: true });
    await page.getByRole("dialog", { name: "分支树" }).waitFor({ timeout: 10000 });
    await wait(500);
    await shot("15-branch-tree.png");
    await page.getByRole("dialog", { name: "分支树" }).getByRole("button", { name: "关闭", exact: true }).click({ force: true }).catch(() => {});
    await wait(300);
  }
});

await step("engine-model-info", async () => {
  await boot();
  await page.locator("nav.bottom-nav").getByRole("button", { name: "设置", exact: true }).click({ force: true });
  await wait(500);
  const about = page.locator("details.settings-collapsible").filter({ hasText: "关于" }).last();
  if ((await about.getAttribute("open")) === null) await about.locator(":scope > summary").click({ force: true });
  await about.getByRole("button", { name: /关于半步五子棋打谱/ }).evaluate((element) => (element instanceof HTMLElement ? element.click() : undefined));
  const dialog = page.getByRole("dialog", { name: "关于半步五子棋打谱" });
  await dialog.waitFor({ timeout: 15000 });
  await dialog.locator('[data-about-entry="engine"]').waitFor({ timeout: 15000 });
  await dialog.locator('[data-about-entry="engine"]').click({ force: true });
  await wait(650);
  await shot("16-engine-model-info.png");
});

await step("appearance-preview", async () => {
  await boot();
  await nav("设置");
  const appearance = page.locator("details.settings-collapsible").filter({ hasText: "外观与音效" }).first();
  await appearance.waitFor();
  if (!(await appearance.getAttribute("open"))) await appearance.locator(":scope > summary").click({ force: true });
  const effects = appearance.locator("details.appearance-center-subsection").filter({ hasText: "公用效果" }).first();
  if ((await effects.getAttribute("open")) === null) await effects.locator(":scope > summary").click({ force: true });
  const preview = effects.locator(".motion-effects-preview");
  await preview.scrollIntoViewIfNeeded();
  await preview.waitFor();
  await wait(700);
  await shot("12-appearance-motion-preview.png");
  const boards = appearance.locator("details.appearance-center-subsection").filter({ hasText: "棋盘材质、标注高亮" }).first();
  if ((await boards.getAttribute("open")) === null) await boards.locator(":scope > summary").click({ force: true });
  const material = boards.locator(".material-live-preview").first();
  await material.scrollIntoViewIfNeeded();
  await wait(400);
  await shot("13-appearance-material-preview.png");
});

await context.close();
await browser.close();
console.log("done", JSON.stringify({ output: OUT, failures }, null, 2));
if (failures.length) process.exitCode = 1;
}
