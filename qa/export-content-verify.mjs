import { chromium } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const baseUrl = process.env.QA_BASE_URL || 'http://localhost:5173/';
const dir = await mkdtemp(join(tmpdir(), 'banbu-export-'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true, serviceWorkers: 'block' });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  localStorage.clear();
  localStorage.setItem('banbu-first-run-welcome-v1', 'true');
  if (indexedDB.databases) { const dbs = await indexedDB.databases(); await Promise.all(dbs.map(d => d.name ? new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }) : null)); }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
// 主线 H8 -> I8，回第 1 手走 I9 形成分支
await page.locator('[role="gridcell"][aria-label$="空位"]').first().click();
await page.getByRole('gridcell', { name: 'I8空位' }).click();
await page.locator('button[aria-label="上一手"]').click();
await page.getByRole('gridcell', { name: 'I9空位' }).click();
// 编辑 -> 注释
await page.locator('.dock-tabs button', { hasText: '编辑' }).click();
await page.waitForTimeout(200);
await page.locator('.dock-panel button', { hasText: '注释' }).click();
await page.waitForTimeout(200);
const textarea = page.locator('.sheet-body textarea');
assert(await textarea.count() === 1, '注释输入框未出现');
await textarea.fill('导出往返验证注释');
await page.locator('.sheet-body').getByRole('button', { name: /完成/ }).click();
await page.waitForTimeout(300);
// 顶部常驻导出入口
await page.getByRole('button', { name: '打开导出方式' }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: '选择格式导出' }).click();
const [sgfDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /SGF（整谱）/ }).click()]);
await page.getByRole('button', { name: '打开导出方式' }).click();
if (await page.getByRole('button', { name: /JSON（整谱）/ }).count() === 0) {
  await page.getByRole('button', { name: '选择格式导出' }).click();
}
const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /JSON（整谱）/ }).click()]);
assert(sgfDownload.suggestedFilename().endsWith('.sgf'), 'SGF 文件名错误');
assert(jsonDownload.suggestedFilename().endsWith('.json'), 'JSON 文件名错误');
const sgfPath = join(dir, 'export.sgf'), jsonPath = join(dir, 'export.json');
await sgfDownload.saveAs(sgfPath); await jsonDownload.saveAs(jsonPath);
const sgfContent = await readFile(sgfPath, 'utf8'), jsonContent = await readFile(jsonPath, 'utf8');
assert(sgfContent.includes(';B['), 'SGF 缺少黑棋着法');
assert(sgfContent.includes('导出往返验证注释'), 'SGF 未包含节点注释');
assert(sgfContent.includes('W[i') , 'SGF 缺少白棋着法');
assert((sgfContent.match(/\(/g) || []).length >= 2, 'SGF 未包含变化分支');
const jsonDoc = JSON.parse(jsonContent);
assert(Object.keys(jsonDoc.nodes).length >= 4, 'JSON 节点数不足');
assert(Object.values(jsonDoc.nodes).some(n => n.comment === '导出往返验证注释'), 'JSON 未包含注释');
// 往返：重新导入原生 JSON
await page.locator('.sheet-head button[aria-label="关闭"]').click().catch(() => {});
await page.locator('input[type="file"]').first().setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(jsonContent) });
await page.waitForTimeout(1500);
const reimportStones = await page.locator('.renju-board .stone').count();
assert(reimportStones >= 2, `重新导入后棋子数异常：${reimportStones}`);
console.log(JSON.stringify({
  pass: true,
  sgfFile: sgfDownload.suggestedFilename(),
  jsonFile: jsonDownload.suggestedFilename(),
  sgfBranchMarkers: (sgfContent.match(/\(/g) || []).length,
  jsonNodes: Object.keys(jsonDoc.nodes).length,
  reimportStones,
  consoleErrors,
}, null, 2));
await browser.close();

