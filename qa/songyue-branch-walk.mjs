import { chromium } from "playwright";
const file = process.argv[2] || "D:/五子棋/定式谱/松月.lib";
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5216/";
const target = Number(process.env.BRANCH_TARGET || 1000);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.stack || String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(file);
await page.waitForFunction(() => window.__banbuImportDiagnostic?.hasCompact && !document.querySelector(".import-progress"), null, { timeout: 900000 });
const result = await page.evaluate(async ({ target }) => {
  const waitFrame = () => new Promise(requestAnimationFrame);
  const nextButton = () => document.querySelector('button[aria-label="下一手"]');
  const firstButton = () => document.querySelector('button[aria-label="到第一手"]');
  const branchButton = () => [...document.querySelectorAll(".dock-panel button")].find((b) => b.textContent?.trim() === "变化");
  const openBranches = async () => {
    const button = branchButton(); if (!button) return [];
    button.click(); await waitFrame();
    const list = document.querySelector(".branch-list");
    if (!list) return [];
    return [...list.querySelectorAll("button")].filter((b) => !b.classList.contains("secondary-button"));
  };
  const closeSheet = async () => { document.querySelector(".sheet-head button")?.click(); await waitFrame(); };
  firstButton()?.click(); await waitFrame();
  let branchClicks = 0, navigations = 0, panels = 0, rows = 0;
  const visited = new Set();
  const failures = [];
  for (let step = 0; step < target * 3 && branchClicks < target; step += 1) {
    const buttons = await openBranches(); panels += 1; rows += buttons.length;
    if (buttons.length) {
      for (const button of buttons) {
        if (branchClicks >= target) break;
        const label = button.textContent?.trim() || "";
        const before = document.querySelector(".workspace-status")?.textContent || "";
        button.click(); await waitFrame(); await waitFrame();
        const after = document.querySelector(".workspace-status")?.textContent || "";
        branchClicks += 1;
        const key = `${label}|${after}`;
        visited.add(key);
        if (!document.querySelector(".renju-board") || document.querySelector(".import-progress")) failures.push({ type: "bad-screen", branchClicks, label });
        // Re-selecting the current preferred child is a valid no-op; only page/runtime failures are errors.
        const reopened = await openBranches();
        if (reopened.length) { rows += reopened.length; }
        await closeSheet();
      }
    } else {
      await closeSheet();
      const next = nextButton();
      if (!next || next.disabled) { firstButton()?.click(); await waitFrame(); } else { next.click(); navigations += 1; await waitFrame(); }
    }
  }
  return { branchClicks, target, panels, rows, navigations, uniqueSelections: visited.size, failures, finalTitle: document.querySelector(".workspace-current b")?.textContent || "", domNodes: document.querySelectorAll("*").length };
}, { target });
console.log(JSON.stringify({ file, target, result, errors }, null, 2));
await browser.close();
if (result.branchClicks < target || result.failures.length || errors.length) process.exitCode = 1;
