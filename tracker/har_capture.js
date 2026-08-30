'use strict';
/**
 * 自动捕获 HAR：puppeteer 打开页面，捕获所有 XHR/fetch 接口 + JS 文件内容，导出 HAR JSON。
 * 这样「投递状态逆向」一条龙：HAR 里同时有「接口 + 加密响应 + 前端 JS（含 key/算法）」。
 * 用法：node har_capture.js <URL> [输出文件] [等待秒数]
 * 例：node har_capture.js "https://campus.jd.com/#/myApply" jd.har 30
 */

const fs = require('node:fs');
const path = require('node:path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('../job-hunter/node_modules/puppeteer-core'); }

const EDGE_PATH = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const USER_DATA_DIR = path.join(__dirname, 'data', 'browser-profile');

const url = process.argv[2];
if (!url) { console.error('用法：node har_capture.js <URL> [输出文件] [等待秒数]'); process.exit(1); }
const outFile = process.argv[3] || 'captured.har';
const waitSec = Number(process.argv[4] || 30);

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', '--start-maximized'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');

  const entries = [];
  const pending = []; // { url, entry }

  page.on('request', (req) => {
    const rt = req.resourceType();
    // 只捕获接口（xhr/fetch）+ JS 文件（script，含解密 key）+ 文档
    if (['xhr', 'fetch', 'script', 'document'].includes(rt)) {
      const entry = {
        request: {
          method: req.method(),
          url: req.url(),
          headers: req.headers(),
          postData: req.postData() || undefined,
          resourceType: rt,
        },
        response: null,
      };
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
    try { body = await res.text(); } catch { /* 二进制/流响应忽略 */ }
    p.entry.response = {
      status: res.status(),
      headers: res.headers(),
      content: { text: body },
    };
  });

  console.log(`打开 ${url}（复用登录态，未登录请在窗口登录）…`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log(`等待 ${waitSec} 秒（期间可翻页/点投递记录触发接口）…`);
  await new Promise((r) => setTimeout(r, waitSec * 1000));
  await browser.close();

  const har = {
    log: {
      version: '1.2',
      creator: { name: 'job-star har_capture' },
      entries: entries.filter((e) => e.response),
    },
  };
  fs.writeFileSync(outFile, JSON.stringify(har, null, 2), 'utf8');
  const xhr = entries.filter((e) => ['xhr', 'fetch'].includes(e.request.resourceType)).length;
  const scripts = entries.filter((e) => e.request.resourceType === 'script').length;
  console.log(`\nHAR 已导出：${outFile}`);
  console.log(`  接口 ${xhr} 个，JS 文件 ${scripts} 个，共 ${har.log.entries.length} 条`);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
