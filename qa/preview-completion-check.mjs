import { chromium } from "playwright";
const file = process.argv[2]; const base = process.env.QA_BASE_URL || "http://localhost:5173/";
if (!file) throw new Error("usage: node qa/preview-completion-check.mjs file.lib");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const errors = []; page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(file);
await page.waitForFunction(() => window.__banbuStorageDiagnostic?.ok === true, null, { timeout: 600000 });
const samples = [];
for (const waitMs of [0, 5000, 15000, 30000, 60000]) {
  if (waitMs) await page.waitForTimeout(waitMs);
  const sample = await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r=indexedDB.open("banbu-gomoku-large-library"); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
    const db=await open(); const tx=db.transaction(["summaries","documents"],"readonly"); const sr=tx.objectStore("summaries").getAll(); const summaries=await new Promise(r=>sr.onsuccess=()=>r(sr.result)); db.close();
    return { title: document.querySelector(".workspace-current b")?.textContent || "", status: document.querySelector(".workspace-status")?.textContent?.trim() || "", diagnostic: window.__banbuImportDiagnostic||null, storage: window.__banbuStorageDiagnostic||null, summaries: summaries.map(s=>({id:s.id,nodeCount:s.nodeCount,storageMode:s.storageMode})) };
  }); samples.push({waitMs, sample});
}
console.log(JSON.stringify({file,samples,errors},null,2)); await browser.close();
