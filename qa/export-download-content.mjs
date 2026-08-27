import { chromium } from 'playwright';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
await page.goto('http://localhost:5190/', { waitUntil: 'domcontentloaded' });
const results = [];
for (const [source, expectExt] of [['sgf', '.sgf'], ['renju-json', '.renju'], ['pos', '.pos.txt'], ['lib', '.sgf']]) {
  await page.getByRole('combobox', { name: '原始棋谱格式' }).selectOption(source);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '生成导出文件' }).click()]);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(path, 'utf8');
  const filename = download.suggestedFilename();
  assert(filename.endsWith(expectExt), `${source} 文件名错误：${filename}`);
  if (expectExt === '.sgf') assert(content.startsWith('(') && content.includes(';B['), 'SGF 内容无效');
  if (expectExt === '.renju') { JSON.parse(content); }
  if (expectExt === '.pos.txt') assert(/^\s*[A-O][0-9]/.test(content), 'POS 内容无效');
  results.push({ source, filename, bytes: content.length, ok: true });
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
