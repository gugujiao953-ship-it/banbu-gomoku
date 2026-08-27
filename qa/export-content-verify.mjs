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
// 编辑 -> 导出
await page.locator('.dock-panel button', { hasText: '导出' }).click();
await page.waitForTimeout(200);
const [sgfDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /标准 SGF 棋谱/ }).click()]);
const [renjuDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /RENJU 跨端文件/ }).click()]);
assert(sgfDownload.suggestedFilename().endsWith('.sgf'), 'SGF 文件名错误');
assert(renjuDownload.suggestedFilename().endsWith('.renju'), 'RENJU 文件名错误');
const sgfPath = join(dir, 'export.sgf'), renjuPath = join(dir, 'export.renju');
await sgfDownload.saveAs(sgfPath); await renjuDownload.saveAs(renjuPath);
const sgfContent = await readFile(sgfPath, 'utf8'), renjuContent = await readFile(renjuPath, 'utf8');
assert(sgfContent.includes(';B['), 'SGF 缺少黑棋着法');
assert(sgfContent.includes('导出往返验证注释'), 'SGF 未包含节点注释');
assert(sgfContent.includes('W[i') , 'SGF 缺少白棋着法');
assert((sgfContent.match(/\(/g) || []).length >= 2, 'SGF 未包含变化分支');
const renjuDoc = JSON.parse(renjuContent);
assert(Object.keys(renjuDoc.nodes).length >= 4, 'RENJU 节点数不足');
assert(Object.values(renjuDoc.nodes).some(n => n.comment === '导出往返验证注释'), 'RENJU 未包含注释');
// 往返：重新导入 RENJU
await page.locator('.sheet-head button[aria-label="关闭"]').click().catch(() => {});
await page.setInputFiles('input[type="file"]', { name: 'roundtrip.renju', mimeType: 'application/json', buffer: Buffer.from(renjuContent) });
await page.waitForTimeout(1500);
const reimportStones = await page.locator('.renju-board .stone').count();
assert(reimportStones >= 2, `重新导入后棋子数异常：${reimportStones}`);
console.log(JSON.stringify({
  pass: true,
  sgfFile: sgfDownload.suggestedFilename(),
  renjuFile: renjuDownload.suggestedFilename(),
  sgfBranchMarkers: (sgfContent.match(/\(/g) || []).length,
  renjuNodes: Object.keys(renjuDoc.nodes).length,
  reimportStones,
  consoleErrors,
}, null, 2));
await browser.close();
