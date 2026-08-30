'use strict';
/**
 * CDP 连接现有 Edge 浏览器（已登录大疆），操作已登录标签页，捕获投递状态接口。
 * 前提：Edge 以 --remote-debugging-port=9222 启动。
 * 用法：node har_capture_cdp.js <域名关键词> [输出文件] [等待秒数]
 * 例：node har_capture_cdp.js "apply.careers.dji.com" dji.har 60
 */
const fs = require('node:fs');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const domain = process.argv[2];
if (!domain) { console.error('用法：node har_capture_cdp.js <域名关键词> [输出] [等待秒]'); process.exit(1); }
const outFile = process.argv[3] || 'captured.har';
const waitSec = Number(process.argv[4] || 60);

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });

  // 找已打开该域名的标签页，否则新开
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes(domain));
  if (!page) {
    page = await browser.newPage();
    await page.goto(`https://${domain}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  await page.bringToFront();

  const entries = [];
  const pending = [];
  page.on('request', (req) => {
    const rt = req.resourceType();
    if (['xhr', 'fetch', 'script', 'document'].includes(rt)) {
      const entry = { request: { method: req.method(), url: req.url(), headers: req.headers(), postData: req.postData() || undefined, resourceType: rt }, response: null };
      entries.push(entry);
      pending.push({ url: req.url(), entry });
    }
  });
  page.on('response', async (res) => {
    const u = res.url();
    const idx = pending.findIndex((p) => p.url === u);
    if (idx < 0) return;
    const p = pending[idx];
    pending.splice(idx, 1);
    let body = '';
    try { body = await res.text(); } catch {}
    p.entry.response = { status: res.status(), headers: res.headers(), content: { text: body } };
  });

  console.log(`已连接现有 Edge，操作「${domain}」标签页。请导航到「我的投递/投递记录」页面…`);
  await new Promise((r) => setTimeout(r, waitSec * 1000));

  const har = { log: { version: '1.2', creator: { name: 'job-star har_capture_cdp' }, entries: entries.filter((e) => e.response) } };
  fs.writeFileSync(outFile, JSON.stringify(har, null, 2), 'utf8');
  const xhr = entries.filter((e) => ['xhr', 'fetch'].includes(e.request.resourceType)).length;
  console.log(`\nHAR 已导出：${outFile}（接口 ${xhr} 个，共 ${har.log.entries.length} 条）`);
  browser.disconnect();
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
